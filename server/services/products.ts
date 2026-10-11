import { finishedProducts, priceHistory, stockLots, inventoryMovements, units } from "../../db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { decMicro } from "../domain/zod-helpers";
import { formatCUP, mulQtyPrice } from "../../shared/money";
import { todayISO, nowISO } from "../domain/dates";
import type { DBOrTx } from "../domain/types";

export const productInput = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(120),
  category: z.string().trim().max(80).optional().nullable(),
  presentation: z.string().trim().max(120).optional().nullable(),
  saleUnitId: z.string().min(1, "La unidad de venta es obligatoria."),
  unitsPerPackage: z.number().int().positive("Unidades por paquete debe ser ≥ 1.").optional(),
  price: decMicro({ minExclusive: false }),
  minStock: decMicro().optional(),
  active: z.boolean().optional(),
});
export type ProductInput = z.infer<typeof productInput>;

export interface ProductListRow {
  id: number;
  name: string;
  category: string | null;
  presentation: string | null;
  saleUnitId: string;
  unitsPerPackage: number;
  priceMicro: number;
  stockMicro: number;
  minStockMicro: number;
  active: boolean;
  stockValueMicro: number;
}

export function listProducts(db: DBOrTx): ProductListRow[] {
  const rows = db.select().from(finishedProducts).orderBy(asc(finishedProducts.name)).all();
  const values = db
    .select({
      itemId: stockLots.itemId,
      total: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro} * ${stockLots.unitCostMicro}), 0)`,
    })
    .from(stockLots)
    .where(and(eq(stockLots.itemType, "product"), isNull(stockLots.cancelledAt)))
    .groupBy(stockLots.itemId)
    .all();
  const valueBy = new Map(values.map((v) => [v.itemId, Math.trunc(Number(v.total) / 1_000_000)]));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    presentation: p.presentation,
    saleUnitId: p.saleUnitId,
    unitsPerPackage: p.unitsPerPackage,
    priceMicro: p.priceMicro,
    stockMicro: p.stockMicro,
    minStockMicro: p.minStockMicro,
    active: p.active,
    stockValueMicro: valueBy.get(p.id) ?? 0,
  }));
}

export function createProduct(db: DBOrTx, input: ProductInput) {
  return db.transaction((tx) => {
    const dup = tx
      .select({ id: finishedProducts.id })
      .from(finishedProducts)
      .where(sql`upper(${finishedProducts.name}) = upper(${input.name})`)
      .get();
    if (dup) throw domainError(`Ya existe un producto con el nombre "${input.name}".`);
    const unit = tx.select().from(units).where(eq(units.code, input.saleUnitId)).get();
    if (!unit) throw domainError(`La unidad "${input.saleUnitId}" no existe.`);

    const [row] = tx
      .insert(finishedProducts)
      .values({
        name: input.name,
        category: input.category ?? null,
        presentation: input.presentation ?? null,
        saleUnitId: input.saleUnitId,
        unitsPerPackage: input.unitsPerPackage ?? 1,
        priceMicro: input.price,
        minStockMicro: input.minStock ?? 0,
        active: input.active ?? true,
      })
      .returning()
      .all();
    tx.insert(priceHistory)
      .values({
        productId: row.id,
        priceMicro: input.price,
        validFrom: todayISO(),
        reason: "Alta de producto",
      })
      .run();
    logAudit(tx, {
      action: "create",
      entityType: "product",
      entityId: row.id,
      summary: `Producto creado: ${row.name} — precio ${formatCUP(input.price)}`,
    });
    return row;
  });
}

export function updateProduct(db: DBOrTx, id: number, input: ProductInput) {
  return db.transaction((tx) => {
    const existing = tx.select().from(finishedProducts).where(eq(finishedProducts.id, id)).get();
    if (!existing) throw notFoundError("Producto");
    if (existing.stockMicro !== 0 && input.saleUnitId !== existing.saleUnitId) {
      throw domainError(
        `No se puede cambiar la unidad de "${existing.name}" porque tiene inventario.`,
      );
    }
    const dup = tx
      .select({ id: finishedProducts.id })
      .from(finishedProducts)
      .where(sql`upper(${finishedProducts.name}) = upper(${input.name}) AND ${finishedProducts.id} <> ${id}`)
      .get();
    if (dup) throw domainError(`Ya existe otro producto con el nombre "${input.name}".`);
    const [row] = tx
      .update(finishedProducts)
      .set({
        name: input.name,
        category: input.category ?? null,
        presentation: input.presentation ?? null,
        saleUnitId: input.saleUnitId,
        unitsPerPackage: input.unitsPerPackage ?? existing.unitsPerPackage,
        priceMicro: input.price,
        minStockMicro: input.minStock ?? existing.minStockMicro,
        active: input.active ?? existing.active,
        updatedAt: nowISO(),
      })
      .where(eq(finishedProducts.id, id))
      .returning()
      .all();

    if (row.priceMicro !== existing.priceMicro) {
      tx.insert(priceHistory)
        .values({
          productId: id,
          priceMicro: row.priceMicro,
          validFrom: todayISO(),
          reason: "Cambio de precio",
        })
        .run();
    }
    logAudit(tx, {
      action: "update",
      entityType: "product",
      entityId: id,
      summary: `Producto actualizado: ${row.name} (precio ${formatCUP(row.priceMicro)})`,
    });
    return row;
  });
}

export function getProductDetail(db: DBOrTx, id: number) {
  const product = db.select().from(finishedProducts).where(eq(finishedProducts.id, id)).get();
  if (!product) throw notFoundError("Producto");
  const lots = db
    .select()
    .from(stockLots)
    .where(
      and(
        eq(stockLots.itemType, "product"),
        eq(stockLots.itemId, id),
        isNull(stockLots.cancelledAt),
        sql`${stockLots.qtyRemainingMicro} > 0`,
      ),
    )
    .orderBy(asc(stockLots.businessDate), asc(stockLots.id))
    .all();
  const stockValueMicro = lots.reduce(
    (acc, l) => acc + mulQtyPrice(l.qtyRemainingMicro, l.unitCostMicro),
    0,
  );
  const movements = db
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.itemType, "product"), eq(inventoryMovements.itemId, id)))
    .orderBy(desc(inventoryMovements.id))
    .limit(100)
    .all();
  const priceHistoryRows = db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.productId, id))
    .orderBy(desc(priceHistory.validFrom), desc(priceHistory.id))
    .all();
  return { product, lots, movements, priceHistory: priceHistoryRows, stockValueMicro };
}
