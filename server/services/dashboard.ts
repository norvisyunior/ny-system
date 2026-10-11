import {
  auditLogs,
  closingCountLines,
  dailyClosings,
  expenses,
  finishedProducts,
  masses,
  productionBatches,
  rawMaterials,
  saleItems,
  sales,
  stockLots,
} from "../../db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { todayISO } from "../domain/dates";
import type { DBOrTx } from "../domain/types";

export interface StockAlert {
  itemType: "raw" | "mass" | "product";
  itemId: number;
  name: string;
  unitId: string;
  stockMicro: number;
  minStockMicro: number;
  level: "agotado" | "bajo";
}

export interface DaySeriesPoint {
  date: string;
  salesMicro: number;
  cogsMicro: number;
  netMicro: number;
}

export interface TopProductRow {
  productId: number;
  name: string;
  qtyMicro: number;
  totalMicro: number;
  costMicro: number;
  marginMicro: number;
}

export interface DashboardData {
  date: string;
  salesMicro: number;
  cogsMicro: number;
  grossMicro: number;
  expensesMicro: number;
  netMicro: number;
  salesCount: number;
  productionBatches: number;
  productionYieldMicro: number;
  stockValueMicro: number;
  alerts: StockAlert[];
  series: DaySeriesPoint[];
  topProducts: TopProductRow[];
  byPayment: { method: string; totalMicro: number; count: number }[];
  pendingClosings: string[];
  closingDiffCount: number;
  lastClosing: { businessDate: string; status: string; netResultMicro: number } | null;
  auditCount: number;
}

const num = (v: unknown): number => Math.trunc(Number(v ?? 0));

function stockByItem(db: DBOrTx) {
  const rows = db
    .select({
      itemType: stockLots.itemType,
      itemId: stockLots.itemId,
      qty: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro}), 0)`,
      value: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro} * ${stockLots.unitCostMicro}), 0) / 1000000`,
    })
    .from(stockLots)
    .where(isNull(stockLots.cancelledAt))
    .groupBy(stockLots.itemType, stockLots.itemId)
    .all();
  return rows.map((r) => ({
    itemType: r.itemType as "raw" | "mass" | "product",
    itemId: r.itemId,
    qty: num(r.qty),
    value: num(r.value),
  }));
}

function buildAlerts(db: DBOrTx): { alerts: StockAlert[]; stockValueMicro: number } {
  const stockRows = stockByItem(db);
  const stockValueMicro = stockRows.reduce((acc, r) => acc + r.value, 0);
  const byKey = new Map(stockRows.map((r) => [`${r.itemType}:${r.itemId}`, r]));

  const alerts: StockAlert[] = [];
  const defs: {
    itemType: "raw" | "mass" | "product";
    items: { id: number; name: string; unitId: string; minStockMicro: number }[];
  }[] = [
    {
      itemType: "raw",
      items: db
        .select({
          id: rawMaterials.id,
          name: rawMaterials.name,
          unitId: rawMaterials.unitId,
          minStockMicro: rawMaterials.minStockMicro,
        })
        .from(rawMaterials)
        .where(eq(rawMaterials.active, true))
        .all(),
    },
    {
      itemType: "mass",
      items: db
        .select({
          id: masses.id,
          name: masses.name,
          unitId: masses.unitId,
          minStockMicro: masses.minStockMicro,
        })
        .from(masses)
        .where(eq(masses.active, true))
        .all(),
    },
    {
      itemType: "product",
      items: db
        .select({
          id: finishedProducts.id,
          name: finishedProducts.name,
          unitId: finishedProducts.saleUnitId,
          minStockMicro: finishedProducts.minStockMicro,
        })
        .from(finishedProducts)
        .where(eq(finishedProducts.active, true))
        .all(),
    },
  ];

  for (const { itemType, items } of defs) {
    for (const it of items) {
      if (it.minStockMicro <= 0) continue;
      const stock = byKey.get(`${itemType}:${it.id}`)?.qty ?? 0;
      if (stock <= 0) {
        alerts.push({ ...it, itemType, itemId: it.id, stockMicro: 0, level: "agotado" });
      } else if (stock <= it.minStockMicro) {
        alerts.push({ ...it, itemType, itemId: it.id, stockMicro: stock, level: "bajo" });
      }
    }
  }
  return { alerts, stockValueMicro };
}

function buildSeries(db: DBOrTx, endDate: string, days = 14): DaySeriesPoint[] {
  const dates: string[] = [];
  const end = new Date(`${endDate}T12:00:00`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const from = dates[0];
  const salesRows = db
    .select({
      date: sales.saleDate,
      total: sql<number>`COALESCE(SUM(${sales.totalMicro}), 0)`,
      cogs: sql<number>`COALESCE(SUM(${sales.totalCostMicro}), 0)`,
    })
    .from(sales)
    .where(and(eq(sales.status, "confirmada"), sql`${sales.saleDate} >= ${from}`))
    .groupBy(sales.saleDate)
    .all();
  const expRows = db
    .select({
      date: expenses.expenseDate,
      total: sql<number>`COALESCE(SUM(${expenses.amountMicro}), 0)`,
    })
    .from(expenses)
    .where(and(eq(expenses.status, "confirmada"), sql`${expenses.expenseDate} >= ${from}`))
    .groupBy(expenses.expenseDate)
    .all();

  const salesMap = new Map(salesRows.map((r) => [r.date, r]));
  const expMap = new Map(expRows.map((r) => [r.date, r]));
  return dates.map((date) => {
    const s = salesMap.get(date);
    const e = expMap.get(date);
    const salesMicro = num(s?.total);
    const cogsMicro = num(s?.cogs);
    const expensesMicro = num(e?.total);
    return { date, salesMicro, cogsMicro, netMicro: salesMicro - cogsMicro - expensesMicro };
  });
}

function topProducts(db: DBOrTx, endDate: string, limit = 5): TopProductRow[] {
  const from = (() => {
    const d = new Date(`${endDate}T12:00:00`);
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  })();
  const rows = db
    .select({
      productId: finishedProducts.id,
      name: finishedProducts.name,
      qty: sql<number>`COALESCE(SUM(${saleItems.qtyMicro}), 0)`,
      total: sql<number>`COALESCE(SUM(${saleItems.lineTotalMicro}), 0)`,
      cost: sql<number>`COALESCE(SUM(${saleItems.lineCostMicro}), 0)`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(finishedProducts, eq(saleItems.productId, finishedProducts.id))
    .where(and(eq(sales.status, "confirmada"), sql`${sales.saleDate} >= ${from}`, sql`${sales.saleDate} <= ${endDate}`))
    .groupBy(finishedProducts.id, finishedProducts.name)
    .orderBy(sql`SUM(${saleItems.lineTotalMicro}) DESC`)
    .limit(limit)
    .all();
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    qtyMicro: num(r.qty),
    totalMicro: num(r.total),
    costMicro: num(r.cost),
    marginMicro: num(r.total) - num(r.cost),
  }));
}

function pendingClosings(db: DBOrTx): string[] {
  const last = db
    .select({ d: dailyClosings.businessDate })
    .from(dailyClosings)
    .where(eq(dailyClosings.status, "cerrado"))
    .orderBy(desc(dailyClosings.businessDate))
    .limit(1)
    .get();
  const cutoff = last?.d ?? "";
  const dates = new Set<string>();
  const collect = (rows: { date: string }[]) => rows.forEach((r) => dates.add(r.date));
  collect(
    db
      .selectDistinct({ date: sales.saleDate })
      .from(sales)
      .where(and(eq(sales.status, "confirmada"), sql`${sales.saleDate} > ${cutoff}`))
      .all(),
  );
  collect(
    db
      .selectDistinct({ date: expenses.expenseDate })
      .from(expenses)
      .where(and(eq(expenses.status, "confirmada"), sql`${expenses.expenseDate} > ${cutoff}`))
      .all(),
  );
  collect(
    db
      .selectDistinct({ date: productionBatches.productionDate })
      .from(productionBatches)
      .where(and(eq(productionBatches.status, "confirmada"), sql`${productionBatches.productionDate} > ${cutoff}`))
      .all(),
  );
  const today = todayISO();
  return [...dates].filter((d) => d <= today).sort().reverse();
}

export function getDashboard(db: DBOrTx, date = todayISO()): DashboardData {
  const salesAgg = db
    .select({
      total: sql<number>`COALESCE(SUM(${sales.totalMicro}), 0)`,
      cogs: sql<number>`COALESCE(SUM(${sales.totalCostMicro}), 0)`,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(sales)
    .where(and(eq(sales.saleDate, date), eq(sales.status, "confirmada")))
    .get();
  const expAgg = db
    .select({ total: sql<number>`COALESCE(SUM(${expenses.amountMicro}), 0)` })
    .from(expenses)
    .where(and(eq(expenses.expenseDate, date), eq(expenses.status, "confirmada")))
    .get();
  const prodAgg = db
    .select({
      cnt: sql<number>`COUNT(*)`,
      yield: sql<number>`COALESCE(SUM(${productionBatches.realYieldMicro}), 0)`,
    })
    .from(productionBatches)
    .where(and(eq(productionBatches.productionDate, date), eq(productionBatches.status, "confirmada")))
    .get();
  const byPayment = db
    .select({
      method: sales.paymentMethod,
      total: sql<number>`COALESCE(SUM(${sales.totalMicro}), 0)`,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(sales)
    .where(and(eq(sales.saleDate, date), eq(sales.status, "confirmada")))
    .groupBy(sales.paymentMethod)
    .all();

  const { alerts, stockValueMicro } = buildAlerts(db);
  const lastClosing = db
    .select({
      businessDate: dailyClosings.businessDate,
      status: dailyClosings.status,
      netResultMicro: dailyClosings.netResultMicro,
    })
    .from(dailyClosings)
    .orderBy(desc(dailyClosings.businessDate))
    .limit(1)
    .get();
  const auditCount = num(
    db.select({ n: sql<number>`COUNT(*)` }).from(auditLogs).get()?.n,
  );
  const closingDiffCount = num(
    db.select({ n: sql<number>`COUNT(*)` }).from(closingCountLines)
      .where(sql`${closingCountLines.diffMicro} != 0`)
      .get()?.n,
  );

  const salesMicro = num(salesAgg?.total);
  const cogsMicro = num(salesAgg?.cogs);
  const expensesMicro = num(expAgg?.total);
  const grossMicro = salesMicro - cogsMicro;

  return {
    date,
    salesMicro,
    cogsMicro,
    grossMicro,
    expensesMicro,
    netMicro: grossMicro - expensesMicro,
    salesCount: num(salesAgg?.cnt),
    productionBatches: num(prodAgg?.cnt),
    productionYieldMicro: num(prodAgg?.yield),
    stockValueMicro,
    alerts,
    closingDiffCount,
    series: buildSeries(db, date),
    topProducts: topProducts(db, date),
    byPayment: byPayment.map((r) => ({
      method: r.method,
      totalMicro: num(r.total),
      count: num(r.cnt),
    })),
    pendingClosings: pendingClosings(db),
    lastClosing: lastClosing
      ? { ...lastClosing, netResultMicro: num(lastClosing.netResultMicro) }
      : null,
    auditCount,
  };
}
