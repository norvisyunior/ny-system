/**
 * Ajustes de inventario y registro de mermas.
 *
 * Todo ajuste es trazable: mueve el inventario por lotes (PEPS), escribe el
 * ledger (inventory_movements) con los tipos 'waste' | 'adjustment_in' |
 * 'adjustment_out' y actualiza el stock cacheado del ítem. Las entradas
 * positivas crean un lote de ajuste con costo 0: el costo real solo entra
 * por compras/producción, nunca por un ajuste manual.
 *
 * Las mermas con valor PEPS generan además un gasto automático (categoría
 * "Merma") para que la pérdida impacte el resultado del día.
 */
import {
  finishedProducts,
  inventoryMovements,
  masses,
  rawMaterials,
  supplies,
} from "../../db/schema";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { assertValidBusinessDate, nowISO, todayISO } from "../domain/dates";
import { consumeFIFO, createLot, availableStock } from "../domain/fifo";
import { decMicro } from "../domain/zod-helpers";
import { microToDecimalTrim, mulQtyPrice } from "../../shared/money";
import { createExpense, expenseInput } from "./expenses";
import type { DBOrTx } from "../domain/types";

export type InventoryItemType = "raw" | "mass" | "product" | "supply";
const ITEM_TYPES = ["raw", "mass", "product", "supply"] as const;

const adjustBase = z.object({
  itemType: z.enum(ITEM_TYPES, {
    errorMap: () => ({
      message: "Tipo de inventario inválido (materia prima, masa, producto u otro insumo).",
    }),
  }),
  itemId: z.number().int().positive(),
  businessDate: z.string().optional(),
  reason: z.string().trim().min(3, "Describa el motivo del ajuste (mínimo 3 caracteres).").max(300),
});

const ajusteInput = adjustBase.extend({
  kind: z.literal("ajuste"),
  /** Cantidad total final deseada, en la unidad base del ítem. */
  newTotal: decMicro({ minExclusive: false }),
});

const mermaInput = adjustBase.extend({
  kind: z.literal("merma"),
  /** Cantidad que se pierde, mayor que cero. */
  qty: decMicro({ minExclusive: true, maxLabel: "la cantidad registrada" }),
});

export const stockAdjustmentInput = z.discriminatedUnion("kind", [ajusteInput, mermaInput]);
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInput>;

function loadTarget(
  tx: DBOrTx,
  itemType: InventoryItemType,
  itemId: number,
): { name: string; unitId: string; active: boolean } {
  if (itemType === "raw") {
    const row = tx.select().from(rawMaterials).where(eq(rawMaterials.id, itemId)).get();
    if (row) return { name: row.name, unitId: row.unitId, active: row.active };
  }
  if (itemType === "mass") {
    const row = tx.select().from(masses).where(eq(masses.id, itemId)).get();
    if (row) return { name: row.name, unitId: row.unitId, active: row.active };
  }
  if (itemType === "supply") {
    const row = tx.select().from(supplies).where(eq(supplies.id, itemId)).get();
    if (row) return { name: row.name, unitId: row.unitId, active: row.active };
  }
  const row = tx.select().from(finishedProducts).where(eq(finishedProducts.id, itemId)).get();
  if (!row) throw notFoundError("Producto del inventario");
  return { name: row.name, unitId: row.saleUnitId, active: row.active };
}

const fmtQty = (micro: number, unitId: string) => `${microToDecimalTrim(micro, 3)} ${unitId}`;

/** Descripción de gasto dentro del límite de 200 caracteres. */
function expenseDescription(base: string, reason: string): string {
  const text = `${base}: ${reason}`;
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

interface ConsumedLot {
  lotId: number;
  qtyMicro: number;
  unitCostMicro: number;
  lineCostMicro: number;
}

export interface StockAdjustmentResult {
  itemType: InventoryItemType;
  itemId: number;
  name: string;
  unitId: string;
  stockMicro: number;
  deltaMicro: number;
  lossValueMicro: number;
  /** Gasto creado automáticamente por la merma (null si no hubo pérdida). */
  expenseId: number | null;
}

/**
 * Ajusta el stock a una cantidad exacta (delta ± contra el inventario PEPS) o
 * registra una merma (pérdida). Siempre dentro de una transacción.
 */
export function runStockAdjustment(db: DBOrTx, input: StockAdjustmentInput): StockAdjustmentResult {
  return db.transaction((tx) => {
    const target = loadTarget(tx, input.itemType, input.itemId);
    const fmt = (m: number) => fmtQty(m, target.unitId);
    const businessDate = input.businessDate ?? todayISO();
    assertValidBusinessDate(tx, businessDate, { label: "La fecha del ajuste" });

    const available = availableStock(tx, input.itemType, input.itemId);

    const updateCache = (delta: number) => {
      if (input.itemType === "raw") {
        tx.update(rawMaterials)
          .set({ stockMicro: sql`${rawMaterials.stockMicro} + ${delta}`, updatedAt: nowISO() })
          .where(eq(rawMaterials.id, input.itemId))
          .run();
      } else if (input.itemType === "mass") {
        tx.update(masses)
          .set({ stockMicro: sql`${masses.stockMicro} + ${delta}`, updatedAt: nowISO() })
          .where(eq(masses.id, input.itemId))
          .run();
      } else if (input.itemType === "supply") {
        tx.update(supplies)
          .set({ stockMicro: sql`${supplies.stockMicro} + ${delta}`, updatedAt: nowISO() })
          .where(eq(supplies.id, input.itemId))
          .run();
      } else {
        tx.update(finishedProducts)
          .set({ stockMicro: sql`${finishedProducts.stockMicro} + ${delta}`, updatedAt: nowISO() })
          .where(eq(finishedProducts.id, input.itemId))
          .run();
      }
    };

    const writeMovement = (
      movementType: "waste" | "adjustment_in" | "adjustment_out",
      qtyDeltaMicro: number,
      unitCostMicro: number,
      valueMicro: number,
      lotId: number | null,
      refType: "merma" | "ajuste",
    ): number => {
      return tx
        .insert(inventoryMovements)
        .values({
          businessDate,
          itemType: input.itemType,
          itemId: input.itemId,
          movementType,
          qtyDeltaMicro,
          unitCostMicro,
          valueMicro,
          lotId,
          refType,
          refId: null,
          reason: input.reason,
        })
        .returning({ id: inventoryMovements.id })
        .get().id;
    };

    let deltaMicro: number;
    let lossValueMicro = 0;
    let expenseId: number | null = null;

    if (input.kind === "merma") {
      // Si no alcanza el inventario PEPS, consumeFIFO lanza error claro
      // (sin estado parcial: la transacción hace rollback completo).
      const consumed = consumeFIFO(tx, input.itemType, input.itemId, input.qty, target.name, fmt);
      const movementIds: number[] = [];
      for (const c of consumed) {
        const lineValue = mulQtyPrice(c.qtyMicro, c.unitCostMicro);
        lossValueMicro += lineValue;
        movementIds.push(
          writeMovement("waste", -c.qtyMicro, c.unitCostMicro, lineValue, c.lotId, "merma"),
        );
      }
      deltaMicro = -input.qty;

      // La merma con valor PEPS genera un gasto automático en Gastos.
      if (lossValueMicro > 0) {
        const expense = createExpense(
          tx,
          expenseInput.parse({
            expenseDate: businessDate,
            category: "Merma",
            description: expenseDescription(
              `Merma de "${target.name}" (${fmt(input.qty)})`,
              input.reason,
            ),
            amount: microToDecimalTrim(lossValueMicro, 6),
            paymentMethod: "otro",
            notes: `Gasto automático por merma de inventario (movimientos #${movementIds.join(", ")}).`,
          }),
        );
        expenseId = expense.id;
        tx.update(inventoryMovements)
          .set({ refId: expense.id })
          .where(inArray(inventoryMovements.id, movementIds))
          .run();
      }

      logAudit(tx, {
        action: "inventory.merma",
        entityType: `inventory_${input.itemType}`,
        entityId: input.itemId,
        summary: `Merma de "${target.name}": ${fmt(input.qty)} — ${input.reason}`,
        details: {
          kind: "merma",
          qtyMicro: input.qty,
          lossValueMicro,
          expenseId,
          reason: input.reason,
          businessDate,
        },
      });
    } else {
      const delta = input.newTotal - available;
      if (delta === 0) {
        throw domainError(
          `El stock de "${target.name}" ya es ${fmt(available)}; no hay nada que ajustar.`,
        );
      }
      if (delta > 0) {
        const lotId = createLot(tx, {
          itemType: input.itemType,
          itemId: input.itemId,
          refType: "ajuste",
          refId: 0,
          qtyMicro: delta,
          unitCostMicro: 0,
          businessDate,
        });
        writeMovement("adjustment_in", delta, 0, 0, lotId, "ajuste");
      } else {
        const consumed: ConsumedLot[] = consumeFIFO(
          tx,
          input.itemType,
          input.itemId,
          -delta,
          target.name,
          fmt,
        );
        for (const c of consumed) {
          const lineValue = mulQtyPrice(c.qtyMicro, c.unitCostMicro);
          lossValueMicro += lineValue;
          writeMovement("adjustment_out", -c.qtyMicro, c.unitCostMicro, lineValue, c.lotId, "ajuste");
        }
      }
      deltaMicro = delta;
      logAudit(tx, {
        action: "inventory.ajuste",
        entityType: `inventory_${input.itemType}`,
        entityId: input.itemId,
        summary: `Ajuste de stock de "${target.name}": ${fmt(available)} → ${fmt(input.newTotal)} — ${input.reason}`,
        details: {
          kind: "ajuste",
          deltaMicro,
          lossValueMicro,
          reason: input.reason,
          businessDate,
        },
      });
    }

    updateCache(deltaMicro);

    return {
      itemType: input.itemType,
      itemId: input.itemId,
      name: target.name,
      unitId: target.unitId,
      stockMicro: available + deltaMicro,
      deltaMicro,
      lossValueMicro,
      expenseId,
    };
  });
}

// ---------------------------------------------------------------------------
// Historial de ajustes y mermas
// ---------------------------------------------------------------------------

export interface StockAdjustmentRow {
  id: number;
  businessDate: string;
  createdAt: string | null;
  movementType: string;
  itemType: string;
  itemTypeLabel: string;
  itemId: number;
  itemName: string | null;
  unitId: string | null;
  qtyDeltaMicro: number;
  valueMicro: number;
  reason: string | null;
}

const nameExpr = sql<string>`(
  CASE ${inventoryMovements.itemType}
    WHEN 'raw' THEN (SELECT name FROM raw_materials m WHERE m.id = ${inventoryMovements.itemId})
    WHEN 'mass' THEN (SELECT name FROM masses m WHERE m.id = ${inventoryMovements.itemId})
    WHEN 'supply' THEN (SELECT name FROM supplies s WHERE s.id = ${inventoryMovements.itemId})
    ELSE (SELECT name FROM finished_products p WHERE p.id = ${inventoryMovements.itemId})
  END
)`;

const unitExpr = sql<string>`(
  CASE ${inventoryMovements.itemType}
    WHEN 'raw' THEN (SELECT unit_id FROM raw_materials m WHERE m.id = ${inventoryMovements.itemId})
    WHEN 'mass' THEN (SELECT unit_id FROM masses m WHERE m.id = ${inventoryMovements.itemId})
    WHEN 'supply' THEN (SELECT unit_id FROM supplies s WHERE s.id = ${inventoryMovements.itemId})
    ELSE (SELECT sale_unit_id FROM finished_products p WHERE p.id = ${inventoryMovements.itemId})
  END
)`;

export interface AdjustmentPaging {
  limit?: number;
  offset?: number;
}

export interface StockAdjustmentStats {
  items: StockAdjustmentRow[];
  total: number;
}

type StockAdjustmentBase = Omit<StockAdjustmentRow, "itemTypeLabel">;

export function listStockAdjustments(
  db: DBOrTx,
  opts?: { itemType?: string; itemId?: number; from?: string; to?: string; q?: string },
): StockAdjustmentRow[];
export function listStockAdjustments(
  db: DBOrTx,
  opts: { itemType?: string; itemId?: number; from?: string; to?: string; q?: string } | undefined,
  paging: AdjustmentPaging,
): StockAdjustmentStats;
export function listStockAdjustments(
  db: DBOrTx,
  opts: { itemType?: string; itemId?: number; from?: string; to?: string; q?: string } | undefined,
  paging: AdjustmentPaging | undefined,
): StockAdjustmentRow[] | StockAdjustmentStats;
export function listStockAdjustments(
  db: DBOrTx,
  opts: { itemType?: string; itemId?: number; from?: string; to?: string; q?: string } = {},
  paging?: AdjustmentPaging,
): StockAdjustmentRow[] | StockAdjustmentStats {
  const conds = [
    sql`${inventoryMovements.movementType} IN ('waste', 'adjustment_in', 'adjustment_out')`,
  ]
    .concat(
      opts.q
        ? [sql`(${inventoryMovements.reason} LIKE ${"%" + opts.q + "%"})`]
        : [],
    );
  if (opts.itemType) conds.push(eq(inventoryMovements.itemType, opts.itemType));
  if (opts.itemId != null) conds.push(eq(inventoryMovements.itemId, opts.itemId));
  if (opts.from) conds.push(gte(inventoryMovements.businessDate, opts.from));
  if (opts.to) conds.push(lte(inventoryMovements.businessDate, opts.to));
  const where = and(...conds);

  const label = (t: string): string =>
    t === "raw"
      ? "Materia prima"
      : t === "mass"
        ? "Masa"
        : t === "supply"
          ? "Otro insumo"
          : "Producto terminado";
  const map = (r: StockAdjustmentBase): StockAdjustmentRow => ({
    ...r,
    itemTypeLabel: label(r.itemType),
  });

  if (paging?.limit != null) {
    const totalRow = db
      .select({ c: sql<number>`COUNT(*)` })
      .from(inventoryMovements)
      .where(where)
      .get() as { c: number };
    const items = (db
      .select({
        id: inventoryMovements.id,
        businessDate: inventoryMovements.businessDate,
        createdAt: inventoryMovements.createdAt,
        movementType: inventoryMovements.movementType,
        itemType: inventoryMovements.itemType,
        itemId: inventoryMovements.itemId,
        qtyDeltaMicro: inventoryMovements.qtyDeltaMicro,
        valueMicro: inventoryMovements.valueMicro,
        reason: inventoryMovements.reason,
        itemName: nameExpr,
        unitId: unitExpr,
      })
      .from(inventoryMovements)
      .where(where)
      .orderBy(desc(inventoryMovements.id))
      .limit(paging.limit)
      .offset(paging.offset ?? 0)
      .all() as StockAdjustmentBase[]).map(map);
    return {
      items,
      total: Number(totalRow?.c ?? 0),
    };
  }
  return (db
    .select({
      id: inventoryMovements.id,
      businessDate: inventoryMovements.businessDate,
      createdAt: inventoryMovements.createdAt,
      movementType: inventoryMovements.movementType,
      itemType: inventoryMovements.itemType,
      itemId: inventoryMovements.itemId,
      qtyDeltaMicro: inventoryMovements.qtyDeltaMicro,
      valueMicro: inventoryMovements.valueMicro,
      reason: inventoryMovements.reason,
      itemName: nameExpr,
      unitId: unitExpr,
    })
    .from(inventoryMovements)
    .where(where)
    .orderBy(desc(inventoryMovements.id))
    .all() as StockAdjustmentBase[]).map(map);
}
