/**
 * Otros insumos (consumibles no productivos) — inventario PEPS propio.
 *
 * Comparten el motor de lotes/movimientos con item_type='supply'. Las compras
 * entran por el módulo Compras (purchase_items.supply_id). Además del ajuste y
 * la merma (que ya cubre el servicio de inventario), un insumo admite "consumo":
 * descuenta PEPS sin generar gasto, porque el costo ya se registró al comprar.
 */
import { supplies, purchaseItems, purchases, stockLots, inventoryMovements, units } from "../../db/schema";
import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { assertValidBusinessDate, nowISO, todayISO } from "../domain/dates";
import { consumeFIFO } from "../domain/fifo";
import { microToDecimalTrim, mulQtyPrice, parseDecimalToMicro } from "../../shared/money";
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

export const supplyInput = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(120),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  unitId: z.string().trim().min(1, "La unidad de medida es obligatoria."),
  minStock: qtyDec.optional(),
  active: z.boolean().optional(),
});
export type SupplyInput = z.infer<typeof supplyInput>;

export const supplyConsumeInput = z.object({
  qty: qtyDec,
  businessDate: z.string().optional(),
  notes: z.string().trim().max(300).optional().nullable(),
});
export type SupplyConsumeInput = z.infer<typeof supplyConsumeInput>;

export interface SupplyListItem {
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

const suppliersName = sql<string>`(SELECT name FROM suppliers s WHERE s.id = ${purchases.supplierId})`;
const purchaseUnit = aliasedTable(units, "purchase_unit");

export function listSupplies(
  db: DBOrTx,
  opts?: { q?: string; activeOnly?: boolean },
): SupplyListItem[];
export function listSupplies(
  db: DBOrTx,
  opts: { q?: string; activeOnly?: boolean } | undefined,
  paging: ListPaging,
): PageResult<SupplyListItem>;
export function listSupplies(
  db: DBOrTx,
  opts: { q?: string; activeOnly?: boolean } | undefined,
  paging: ListPaging | undefined,
): SupplyListItem[] | PageResult<SupplyListItem>;
export function listSupplies(
  db: DBOrTx,
  opts: { q?: string; activeOnly?: boolean } = {},
  paging?: ListPaging,
): SupplyListItem[] | PageResult<SupplyListItem> {
  const conds = [];
  if (opts.q) {
    conds.push(
      sql`(${supplies.name} LIKE ${"%" + opts.q + "%"} OR ${supplies.category} LIKE ${"%" + opts.q + "%"})`,
    );
  }
  if (opts.activeOnly) conds.push(eq(supplies.active, true));
  const where = conds.length ? and(...conds) : undefined;

  const base = db
    .select()
    .from(supplies)
    .leftJoin(units, eq(units.code, supplies.unitId))
    .where(where)
    .orderBy(asc(supplies.name));

  let pageRows: ReturnType<typeof base.all> = [];
  let total = 0;
  if (paging?.limit != null) {
    const totalRow = db
      .select({ c: sql<number>`COUNT(*)` })
      .from(supplies)
      .where(where)
      .get() as { c: number } | undefined;
    total = Number(totalRow?.c ?? 0);
    pageRows = base.limit(paging.limit).offset(paging.offset ?? 0).all();
  } else {
    pageRows = base.all();
  }

  const ids = pageRows.map((r) => r.supplies.id);
  const valueByItem = new Map<number, number>();
  let lastPrices: Array<{
    supplyId: number | null;
    priceMicro: number;
    unitId: string;
    unitLabel: string;
    date: string;
    supplier: string | null;
    rn: number;
  }> = [];
  const lastByItem = new Map<number, (typeof lastPrices)[number]>();

  if (ids.length > 0) {
    const values = db
      .select({
        itemId: stockLots.itemId,
        total: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro} * ${stockLots.unitCostMicro}), 0)`,
      })
      .from(stockLots)
      .where(
        and(
          eq(stockLots.itemType, "supply"),
          isNull(stockLots.cancelledAt),
          inArray(stockLots.itemId, ids),
        ),
      )
      .groupBy(stockLots.itemId)
      .all();
    for (const v of values) valueByItem.set(v.itemId, Math.trunc(Number(v.total) / 1_000_000));

    lastPrices = db
      .select({
        supplyId: purchaseItems.supplyId,
        priceMicro: purchaseItems.unitPriceMicro,
        unitId: purchaseItems.unitId,
        unitLabel: purchaseUnit.label,
        date: purchases.purchaseDate,
        supplier: suppliersName,
        rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${purchaseItems.supplyId} ORDER BY ${purchases.purchaseDate} DESC, ${purchases.id} DESC)`,
      })
      .from(purchaseItems)
      .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
      .innerJoin(purchaseUnit, eq(purchaseUnit.code, purchaseItems.unitId))
      .where(and(eq(purchases.status, "confirmada"), inArray(purchaseItems.supplyId, ids)))
      .all()
      .filter((r) => r.rn === 1);
    for (const p of lastPrices) {
      if (p.supplyId != null) lastByItem.set(p.supplyId, p);
    }
  }

  const result: SupplyListItem[] = pageRows.map((r) => {
    const s = r.supplies;
    const lp = lastByItem.get(s.id);
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      unitId: s.unitId,
      unitLabel: r.units?.label ?? s.unitId,
      dimension: r.units?.dimension ?? "",
      stockMicro: s.stockMicro,
      minStockMicro: s.minStockMicro,
      active: s.active,
      stockValueMicro: valueByItem.get(s.id) ?? 0,
      lastPrice: lp
        ? {
            priceMicro: lp.priceMicro,
            unitId: lp.unitId,
            unitLabel: lp.unitLabel,
            date: lp.date,
            supplier: lp.supplier ?? "",
          }
        : null,
    };
  });

  if (paging?.limit != null) return { items: result, total };
  return result;
}

export function getSupplyDetail(db: DBOrTx, id: number) {
  const supply = db.select().from(supplies).where(eq(supplies.id, id)).get();
  if (!supply) throw notFoundError("Insumo");

  const lots = db
    .select()
    .from(stockLots)
    .where(
      and(
        eq(stockLots.itemType, "supply"),
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
    .where(and(eq(purchaseItems.supplyId, id), eq(purchases.status, "confirmada")))
    .orderBy(desc(purchases.purchaseDate), desc(purchases.id))
    .limit(5)
    .all();

  const priceHistoryTotal =
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(purchaseItems)
      .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
      .where(and(eq(purchaseItems.supplyId, id), eq(purchases.status, "confirmada")))
      .get()?.total ?? 0;

  const movements = db
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.itemType, "supply"), eq(inventoryMovements.itemId, id)))
    .orderBy(desc(inventoryMovements.id))
    .limit(5)
    .all();

  const movementsTotal =
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.itemType, "supply"), eq(inventoryMovements.itemId, id)))
      .get()?.total ?? 0;

  return {
    supply,
    lots: lots.slice(0, 5),
    lotsTotal: lots.length,
    priceHistory,
    priceHistoryTotal,
    movements,
    movementsTotal,
    stockValueMicro,
  };
}

export function createSupply(db: DB, input: SupplyInput) {
  return db.transaction((tx) => {
    const unit = tx.select().from(units).where(eq(units.code, input.unitId)).get();
    if (!unit) throw domainError(`La unidad "${input.unitId}" no existe.`);

    const dup = tx
      .select({ id: supplies.id })
      .from(supplies)
      .where(sql`upper(${supplies.name}) = upper(${input.name})`)
      .get();
    if (dup) throw domainError(`Ya existe un insumo con el nombre "${input.name}".`);

    const [row] = tx
      .insert(supplies)
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
      entityType: "supply",
      entityId: row.id,
      summary: `Insumo creado: ${row.name}`,
    });
    return row;
  });
}

export function updateSupply(db: DB, id: number, input: SupplyInput) {
  return db.transaction((tx) => {
    const existing = tx.select().from(supplies).where(eq(supplies.id, id)).get();
    if (!existing) throw notFoundError("Insumo");

    const unit = tx.select().from(units).where(eq(units.code, input.unitId)).get();
    if (!unit) throw domainError(`La unidad "${input.unitId}" no existe.`);
    if (existing.stockMicro !== 0 && input.unitId !== existing.unitId) {
      throw domainError(
        `No se puede cambiar la unidad de "${existing.name}" porque tiene inventario (${microToDecimalTrim(existing.stockMicro, 3)} ${existing.unitId}).`,
      );
    }

    const dup = tx
      .select({ id: supplies.id })
      .from(supplies)
      .where(sql`upper(${supplies.name}) = upper(${input.name}) AND ${supplies.id} <> ${id}`)
      .get();
    if (dup) throw domainError(`Ya existe otro insumo con el nombre "${input.name}".`);

    const [row] = tx
      .update(supplies)
      .set({
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        unitId: input.unitId,
        minStockMicro: input.minStock ?? existing.minStockMicro,
        active: input.active ?? existing.active,
        updatedAt: nowISO(),
      })
      .where(eq(supplies.id, id))
      .returning()
      .all();

    logAudit(tx, {
      action: "update",
      entityType: "supply",
      entityId: id,
      summary: `Insumo actualizado: ${row.name}`,
      details: { before: existing, after: row },
    });
    return row;
  });
}

export interface SupplyConsumeResult {
  supplyId: number;
  name: string;
  unitId: string;
  stockMicro: number;
  qtyMicro: number;
  costValueMicro: number;
  /** Siempre null: el consumo no crea gasto (el costo se pagó al comprar). */
  expenseId: number | null;
}

/** Consume insumo (uso operativo) por PEPS. No genera gasto: ya se pagó al comprar. */
export function consumeSupply(db: DB, id: number, input: SupplyConsumeInput): SupplyConsumeResult {
  return db.transaction((tx) => {
    const supply = tx.select().from(supplies).where(eq(supplies.id, id)).get();
    if (!supply) throw notFoundError("Insumo");
    if (!supply.active) throw domainError(`El insumo "${supply.name}" está inactivo.`);
    if (input.qty <= 0) throw domainError("La cantidad a consumir debe ser mayor que cero.");

    const businessDate = input.businessDate ?? todayISO();
    assertValidBusinessDate(tx, businessDate, { label: "La fecha del consumo" });
    const fmt = (m: number) => `${microToDecimalTrim(m, 3)} ${supply.unitId}`;

    const consumed = consumeFIFO(tx, "supply", id, input.qty, supply.name, fmt);
    let costValueMicro = 0;
    for (const c of consumed) {
      const lineValue = mulQtyPrice(c.qtyMicro, c.unitCostMicro);
      costValueMicro += lineValue;
      tx.insert(inventoryMovements)
        .values({
          businessDate,
          itemType: "supply",
          itemId: id,
          movementType: "consumo",
          qtyDeltaMicro: -c.qtyMicro,
          unitCostMicro: c.unitCostMicro,
          valueMicro: lineValue,
          lotId: c.lotId,
          refType: "consumo",
          refId: null,
          reason: input.notes ?? "Consumo operativo",
        })
        .run();
    }

    tx.update(supplies)
      .set({ stockMicro: sql`${supplies.stockMicro} - ${input.qty}`, updatedAt: nowISO() })
      .where(eq(supplies.id, id))
      .run();

    logAudit(tx, {
      action: "supply.consume",
      entityType: "supply",
      entityId: id,
      summary: `Consumo de "${supply.name}": ${fmt(input.qty)} — ${input.notes?.trim() || "sin notas"}`,
      details: { qtyMicro: input.qty, costValueMicro, expenseId: null, businessDate },
    });

    return {
      supplyId: id,
      name: supply.name,
      unitId: supply.unitId,
      stockMicro: supply.stockMicro - input.qty,
      qtyMicro: input.qty,
      costValueMicro,
      expenseId: null,
    };
  });
}
