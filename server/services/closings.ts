import {
  dailyClosings,
  closingCountLines,
  sales,
  expenses as expensesTable,
  finishedProducts,
  masses,
  rawMaterials,
  stockLots,
} from "../../db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { conflictError, domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import {
  assertValidBusinessDate,
  lastClosedDate,
  nowISO,
} from "../domain/dates";
import { mulQtyPrice } from "../domain/zod-helpers";
import { formatCUP, microToDecimalTrim } from "../../shared/money";
import type { DBOrTx } from "../domain/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ITEM_TABLES = {
  raw: rawMaterials,
  mass: masses,
  product: finishedProducts,
} as const;

export type ItemType = keyof typeof ITEM_TABLES;

export interface ClosingItemRow {
  itemType: ItemType;
  itemId: number;
  name: string;
  unitId: string;
  expectedMicro: number;
  avgCostMicro: number;
}

export interface ClosingPreview {
  businessDate: string;
  salesTotalMicro: number;
  cogsMicro: number;
  grossProfitMicro: number;
  expensesMicro: number;
  netResultMicro: number;
  pendingSalesCount: number;
  items: ClosingItemRow[];
  existingCounts: number;
  closingStatus: string | null;
}

function assertPreviewDate(date: string): void {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw domainError(`La fecha "${date}" no es válida (YYYY-MM-DD).`);
  }
  if (date > nowISO().slice(0, 10)) {
    throw domainError(`La fecha no puede ser futura (${date}).`);
  }
}

function computeTotals(tx: DBOrTx, date: string) {
  const salesRow = tx
    .select({
      total: sql<number>`COALESCE(SUM(${sales.totalMicro}), 0)`,
      cogs: sql<number>`COALESCE(SUM(${sales.totalCostMicro}), 0)`,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(sales)
    .where(and(eq(sales.saleDate, date), eq(sales.status, "confirmada")))
    .get();
  const expRow = tx
    .select({ total: sql<number>`COALESCE(SUM(${expensesTable.amountMicro}), 0)` })
    .from(expensesTable)
    .where(and(eq(expensesTable.expenseDate, date), eq(expensesTable.status, "confirmada")))
    .get();
  const salesTotalMicro = Math.trunc(Number(salesRow?.total ?? 0));
  const cogsMicro = Math.trunc(Number(salesRow?.cogs ?? 0));
  const expensesMicro = Math.trunc(Number(expRow?.total ?? 0));
  const grossProfitMicro = salesTotalMicro - cogsMicro;
  const netResultMicro = grossProfitMicro - expensesMicro;
  return {
    salesTotalMicro,
    cogsMicro,
    expensesMicro,
    grossProfitMicro,
    netResultMicro,
    salesCount: Math.trunc(Number(salesRow?.cnt ?? 0)),
  };
}

function computeItems(tx: DBOrTx): ClosingItemRow[] {
  const rows: ClosingItemRow[] = [];
  const defs: { itemType: ItemType; items: { id: number; name: string; unitId: string }[] }[] = [
    {
      itemType: "raw",
      items: tx
        .select({ id: rawMaterials.id, name: rawMaterials.name, unitId: rawMaterials.unitId })
        .from(rawMaterials)
        .all(),
    },
    {
      itemType: "mass",
      items: tx
        .select({ id: masses.id, name: masses.name, unitId: masses.unitId })
        .from(masses)
        .all(),
    },
    {
      itemType: "product",
      items: tx
        .select({
          id: finishedProducts.id,
          name: finishedProducts.name,
          unitId: finishedProducts.saleUnitId,
        })
        .from(finishedProducts)
        .all(),
    },
  ];

  for (const { itemType, items } of defs) {
    const lots = tx
      .select({
        itemId: stockLots.itemId,
        qty: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro}), 0)`,
        value: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro} * ${stockLots.unitCostMicro}), 0)`,
        lastCost: sql<number>`COALESCE(MAX(${stockLots.unitCostMicro}), 0)`,
      })
      .from(stockLots)
      .where(and(eq(stockLots.itemType, itemType), isNull(stockLots.cancelledAt)))
      .groupBy(stockLots.itemId)
      .all();

    const byItem = new Map(lots.map((l) => [l.itemId, l]));
    for (const item of items) {
      const lot = byItem.get(item.id);
      const expectedMicro = Math.trunc(Number(lot?.qty ?? 0));
      const valueMicro = Math.trunc(Number(lot?.value ?? 0));
      const avgCostMicro =
        expectedMicro > 0
          ? Math.trunc(valueMicro / expectedMicro)
          : Math.trunc(Number(lot?.lastCost ?? 0));
      rows.push({
        itemType,
        itemId: item.id,
        name: item.name,
        unitId: item.unitId,
        expectedMicro,
        avgCostMicro,
      });
    }
  }
  return rows;
}

export function previewClosing(db: DBOrTx, date: string): ClosingPreview {
  assertPreviewDate(date);
  const totals = computeTotals(db, date);
  const items = computeItems(db);
  const existing = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(closingCountLines)
    .where(eq(closingCountLines.businessDate, date))
    .get();
  const closing = db
    .select({ status: dailyClosings.status })
    .from(dailyClosings)
    .where(eq(dailyClosings.businessDate, date))
    .get();
  return {
    businessDate: date,
    salesTotalMicro: totals.salesTotalMicro,
    cogsMicro: totals.cogsMicro,
    grossProfitMicro: totals.grossProfitMicro,
    expensesMicro: totals.expensesMicro,
    netResultMicro: totals.netResultMicro,
    pendingSalesCount: totals.salesCount,
    items,
    existingCounts: Math.trunc(Number(existing?.n ?? 0)),
    closingStatus: closing?.status ?? null,
  };
}

export const countLineInput = z.object({
  itemType: z.enum(["raw", "mass", "product"]),
  itemId: z.number().int().positive(),
  counted: z.string().min(1, "Conteo requerido."),
  reason: z.string().trim().max(300).optional().nullable(),
});

export const closeDayInput = z.object({
  businessDate: z.string().min(1, "Fecha requerida."),
  counts: z.array(countLineInput).max(2000),
  notes: z.string().trim().max(500).optional().nullable(),
});
export type CloseDayInput = z.infer<typeof closeDayInput>;

/**
 * Cierra el día: congura totales (ventas − COGS − gastos), registra el conteo
 * físico con diferencias y deja la fecha inmutable hasta una reapertura auditada.
 */
export function closeDay(db: DBOrTx, input: CloseDayInput) {
  return db.transaction((tx) => {
    // Primero el chequeo explícito de doble cierre (mensaje más claro que
    // el genérico de "día cerrado" que dispara la validación de fecha).
    const existing = tx
      .select()
      .from(dailyClosings)
      .where(eq(dailyClosings.businessDate, input.businessDate))
      .get();
    if (existing && existing.status === "cerrado") {
      throw conflictError(
        `El día ${input.businessDate} ya está cerrado. Reábralo para modificarlo.`,
        "ALREADY_CLOSED",
      );
    }

    assertValidBusinessDate(tx, input.businessDate, { label: "La fecha de cierre" });

    const totals = computeTotals(tx, input.businessDate);
    const itemRows = computeItems(tx);
    const itemByKey = new Map(itemRows.map((r) => [`${r.itemType}:${r.itemId}`, r]));

    const now = nowISO();
    const values = {
      salesTotalMicro: totals.salesTotalMicro,
      cogsMicro: totals.cogsMicro,
      expensesMicro: totals.expensesMicro,
      grossProfitMicro: totals.grossProfitMicro,
      netResultMicro: totals.netResultMicro,
      status: "cerrado" as const,
      closedAt: now,
      reopenedAt: null,
      reopenReason: null,
      notes: input.notes ?? existing?.notes ?? null,
    };
    if (existing) {
      tx.update(dailyClosings).set(values).where(eq(dailyClosings.businessDate, input.businessDate)).run();
    } else {
      tx.insert(dailyClosings)
        .values({ businessDate: input.businessDate, ...values })
        .run();
    }

    tx.delete(closingCountLines)
      .where(eq(closingCountLines.businessDate, input.businessDate))
      .run();

    const parseCounted = (raw: string): number => {
      const m = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(raw.trim());
      if (!m) throw domainError(`Valor de conteo inválido: "${raw}".`);
      const sign = m[1] === "-" ? -1 : 1;
      const whole = BigInt(m[2]);
      const frac = BigInt((m[3] ?? "").padEnd(6, "0"));
      return sign * Number(whole * 1_000_000n + frac);
    };

    for (const line of input.counts) {
      const item = itemByKey.get(`${line.itemType}:${line.itemId}`);
      if (!item) throw notFoundError("Ítem de inventario");
      const countedMicro = parseCounted(line.counted);
      if (countedMicro < 0) throw domainError("El conteo no puede ser negativo.");
      const diffMicro = countedMicro - item.expectedMicro;
      if (diffMicro !== 0 && (line.reason ?? "").trim().length < 3) {
        throw domainError(
          `${item.name}: hay una diferencia de ${microToDecimalTrim(diffMicro, 3)} ${item.unitId}; indique el motivo.`,
        );
      }
      const diffValueMicro = mulQtyPrice(diffMicro, item.avgCostMicro);
      tx.insert(closingCountLines)
        .values({
          businessDate: input.businessDate,
          itemType: line.itemType,
          itemId: line.itemId,
          expectedMicro: item.expectedMicro,
          countedMicro,
          diffMicro,
          unitCostMicro: item.avgCostMicro,
          diffValueMicro,
          reason: line.reason || null,
        })
        .run();
    }

    logAudit(tx, {
      action: "closing.close",
      entityType: "daily_closing",
      entityId: null,
      summary:
        `Día ${input.businessDate} cerrado: ventas ${formatCUP(totals.salesTotalMicro)}, ` +
        `utilidad neta ${formatCUP(totals.netResultMicro)}`,
      details: {
        ...totals,
        counts: input.counts.length,
      },
    });

    return {
      businessDate: input.businessDate,
      ...totals,
      countsRegistered: input.counts.length,
    };
  });
}

/** Reabre el último día cerrado; queda auditado con motivo obligatorio. */
export function reopenDay(db: DBOrTx, date: string, reason: string) {
  return db.transaction((tx) => {
    const row = tx.select().from(dailyClosings).where(eq(dailyClosings.businessDate, date)).get();
    if (!row) throw notFoundError("Cierre de día");
    if (row.status !== "cerrado") throw conflictError(`El día ${date} no está cerrado.`);
    const last = lastClosedDate(tx);
    if (last !== date) {
      throw conflictError(
        `Solo se puede reabrir el último día cerrado (${last ?? "ninguno"}).`,
        "NOT_LATEST_CLOSING",
      );
    }
    tx.update(dailyClosings)
      .set({ status: "reabierto", reopenedAt: nowISO(), reopenReason: reason })
      .where(eq(dailyClosings.businessDate, date))
      .run();
    logAudit(tx, {
      action: "closing.reopen",
      entityType: "daily_closing",
      entityId: null,
      summary: `Día ${date} reabierto`,
      details: { reason },
    });
    return { businessDate: date, status: "reabierto" as const };
  });
}

export interface ClosingRow {
  businessDate: string;
  salesTotalMicro: number;
  cogsMicro: number;
  expensesMicro: number;
  grossProfitMicro: number;
  netResultMicro: number;
  status: string;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  notes: string | null;
}

export function listClosings(db: DBOrTx, opts: { from?: string; to?: string } = {}): ClosingRow[] {
  const conds = [];
  if (opts.from) conds.push(sql`${dailyClosings.businessDate} >= ${opts.from}`);
  if (opts.to) conds.push(sql`${dailyClosings.businessDate} <= ${opts.to}`);
  return db
    .select()
    .from(dailyClosings)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${dailyClosings.businessDate} DESC`)
    .all();
}

export function getClosing(db: DBOrTx, date: string) {
  const row = db
    .select()
    .from(dailyClosings)
    .where(eq(dailyClosings.businessDate, date))
    .get();
  if (!row) throw notFoundError("Cierre de día");
  const counts = db
    .select()
    .from(closingCountLines)
    .where(eq(closingCountLines.businessDate, date))
    .all();
  return { ...row, counts };
}
