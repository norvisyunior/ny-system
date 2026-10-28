import { rawMaterials, purchaseItems, purchases, stockLots, units } from "../../db/schema";
import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { parseDecimalToMicro, mulQtyPrice } from "../../shared/money";
import type { ListPaging, PageResult } from "../domain/paging";
import type { DB, DBOrTx } from "../domain/types";

const qtyDec = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      const micro = parseDecimalToMicro(v);
      if (micro < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "No puede ser negativo." });
        return z.NEVER;
      }
      return micro;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Cantidad decimal inválida." });
      return z.NEVER;
    }
  });

export const materialInput = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(120),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  unitId: z.string().trim().min(1, "La unidad de medida es obligatoria."),
  minStock: qtyDec.optional(),
  active: z.boolean().optional(),
});
export type MaterialInput = z.infer<typeof materialInput>;

export interface MaterialListItem {
  id: number;
  name: string;
  category: string | null;
  unitId: string;
  unitLabel: string;
  dimension: string;
  stockMicro: number;
  minStockMicro: number;
  active: boolean;
  stockValueMicro: number;
  lastPrice: {
    priceMicro: number;
    unitId: string;
    unitLabel: string;
    date: string;
    supplier: string;
  } | null;
}

export function listMaterials(
  db: DBOrTx,
  opts?: { q?: string; activeOnly?: boolean },
): MaterialListItem[];
export function listMaterials(
  db: DBOrTx,
  opts: { q?: string; activeOnly?: boolean } | undefined,
  paging: ListPaging,
): PageResult<MaterialListItem>;
export function listMaterials(
  db: DBOrTx,
  opts: { q?: string; activeOnly?: boolean } | undefined,
  paging: ListPaging | undefined,
): MaterialListItem[] | PageResult<MaterialListItem>;
export function listMaterials(
  db: DBOrTx,
  opts: { q?: string; activeOnly?: boolean } = {},
  paging?: ListPaging,
): MaterialListItem[] | PageResult<MaterialListItem> {
  const conds = [];
  if (opts.q) conds.push(sql`(${rawMaterials.name} LIKE ${"%" + opts.q + "%"})`);
  if (opts.activeOnly) conds.push(eq(rawMaterials.active, true));
  const where = conds.length ? and(...conds) : undefined;

  const base = db
    .select()
    .from(rawMaterials)
    .leftJoin(units, eq(units.code, rawMaterials.unitId))
    .where(where)
    .orderBy(asc(rawMaterials.name));

  let pageRows: ReturnType<typeof base.all> = [];
  let total = 0;
  if (paging?.limit != null) {
    const totalRow = db
      .select({ c: sql<number>`COUNT(*)` })
      .from(rawMaterials)
      .where(where)
      .get() as { c: number } | undefined;
    total = Number(totalRow?.c ?? 0);
    pageRows = base.limit(paging.limit).offset(paging.offset ?? 0).all();
  } else {
    pageRows = base.all();
  }

  const ids = pageRows.map((r) => r.raw_materials.id);

  const valueByMaterial = new Map<number, number>();
  if (ids.length > 0) {
    const values = db
      .select({
        itemId: stockLots.itemId,
        total: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro} * ${stockLots.unitCostMicro}), 0)`,
      })
      .from(stockLots)
      .where(
        and(eq(stockLots.itemType, "raw"), isNull(stockLots.cancelledAt), inArray(stockLots.itemId, ids)),
      )
      .groupBy(stockLots.itemId)
      .all();
    for (const v of values) valueByMaterial.set(v.itemId, Math.trunc(Number(v.total) / 1_000_000));

    const lastPrices = db
      .select({
        materialId: purchaseItems.rawMaterialId,
        priceMicro: purchaseItems.unitPriceMicro,
        unitId: purchaseItems.unitId,
        unitLabel: purchaseUnit.label,
        date: purchases.purchaseDate,
        supplier: suppliersName,
        rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${purchaseItems.rawMaterialId} ORDER BY ${purchases.purchaseDate} DESC, ${purchases.id} DESC)`,
      })
      .from(purchaseItems)
      .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
      .innerJoin(purchaseUnit, eq(purchaseUnit.code, purchaseItems.unitId))
      .where(and(eq(purchases.status, "confirmada"), inArray(purchaseItems.rawMaterialId, ids)))
      .all()
      .filter((r) => r.rn === 1);

    const lastByMaterial = new Map<number, (typeof lastPrices)[number]>();
    for (const p of lastPrices) lastByMaterial.set(p.materialId, p);

    const result: MaterialListItem[] = pageRows.map((r) => {
      const m = r.raw_materials;
      const lp = lastByMaterial.get(m.id);
      const unitLabel = r.units?.label ?? m.unitId;
      const lastPrice = lp
        ? {
            priceMicro: lp.priceMicro,
            unitId: lp.unitId,
            unitLabel: lp.unitLabel,
            date: lp.date,
            supplier: lp.supplier ?? "",
          }
        : null;
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        unitId: m.unitId,
        unitLabel,
        dimension: r.units?.dimension ?? "",
        stockMicro: m.stockMicro,
        minStockMicro: m.minStockMicro,
        active: m.active,
        stockValueMicro: valueByMaterial.get(m.id) ?? 0,
        lastPrice,
      };
    });

    if (paging?.limit != null) return { items: result, total };
    return result;
  }

  if (paging?.limit != null) return { items: [], total };
  return [];
}

const suppliersName = sql<string>`(SELECT name FROM suppliers s WHERE s.id = ${purchases.supplierId})`;
const purchaseUnit = aliasedTable(units, "purchase_unit");

export function getMaterialDetail(db: DB, id: number) {
  const material = db.select().from(rawMaterials).where(eq(rawMaterials.id, id)).get();
  if (!material) throw notFoundError("Materia prima");

  const lots = db
    .select()
    .from(stockLots)
    .where(
      and(
        eq(stockLots.itemType, "raw"),
        eq(stockLots.itemId, id),
        isNull(stockLots.cancelledAt),
        sql`${stockLots.qtyRemainingMicro} > 0`,
      ),
    )
    .orderBy(asc(stockLots.id))
    .all();

  const priceHistory = db
    .select({
      date: purchases.purchaseDate,
      purchaseNumber: purchases.number,
      supplier: suppliersName,
      qtyMicro: purchaseItems.qtyMicro,
      unitId: purchaseItems.unitId,
      priceMicro: purchaseItems.unitPriceMicro,
      lineTotalMicro: purchaseItems.lineTotalMicro,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .where(and(eq(purchaseItems.rawMaterialId, id), eq(purchases.status, "confirmada")))
    .orderBy(desc(purchases.purchaseDate), desc(purchases.id))
    .all();

  const stockValueMicro = lots.reduce(
    (acc, l) => acc + mulQtyPrice(l.qtyRemainingMicro, l.unitCostMicro),
    0,
  );

  return { material, lots, priceHistory, stockValueMicro };
}

export function createMaterial(db: DB, input: MaterialInput) {
  return db.transaction((tx) => {
    const unit = tx.select().from(units).where(eq(units.code, input.unitId)).get();
    if (!unit) throw domainError(`La unidad "${input.unitId}" no existe.`);

    const dup = tx
      .select({ id: rawMaterials.id })
      .from(rawMaterials)
      .where(sql`upper(${rawMaterials.name}) = upper(${input.name})`)
      .get();
    if (dup) throw domainError(`Ya existe una materia prima con el nombre "${input.name}".`);

    const [row] = tx
      .insert(rawMaterials)
      .values({
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        unitId: input.unitId,
        minStockMicro: input.minStock ?? 0,
        active: input.active ?? true,
      })
      .returning()
      .all();

    logAudit(tx, {
      action: "create",
      entityType: "raw_material",
      entityId: row.id,
      summary: `Materia prima creada: ${row.name}`,
    });
    return row;
  });
}

export function updateMaterial(db: DB, id: number, input: MaterialInput) {
  return db.transaction((tx) => {
    const existing = tx.select().from(rawMaterials).where(eq(rawMaterials.id, id)).get();
    if (!existing) throw notFoundError("Materia prima");

    const unit = tx.select().from(units).where(eq(units.code, input.unitId)).get();
    if (!unit) throw domainError(`La unidad "${input.unitId}" no existe.`);
    if (existing.stockMicro !== 0 && input.unitId !== existing.unitId) {
      throw domainError(
        `No se puede cambiar la unidad de "${existing.name}" porque tiene inventario (${existing.stockMicro / 1_000_000} ${existing.unitId}).`,
      );
    }

    const dup = tx
      .select({ id: rawMaterials.id })
      .from(rawMaterials)
      .where(sql`upper(${rawMaterials.name}) = upper(${input.name}) AND ${rawMaterials.id} <> ${id}`)
      .get();
    if (dup) throw domainError(`Ya existe otra materia prima con el nombre "${input.name}".`);

    const [row] = tx
      .update(rawMaterials)
      .set({
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        unitId: input.unitId,
        minStockMicro: input.minStock ?? existing.minStockMicro,
        active: input.active ?? existing.active,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(rawMaterials.id, id))
      .returning()
      .all();

    logAudit(tx, {
      action: "update",
      entityType: "raw_material",
      entityId: id,
      summary: `Materia prima actualizada: ${row.name}`,
      details: { before: existing, after: row },
    });
    return row;
  });
}
