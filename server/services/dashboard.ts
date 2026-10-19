import {
  closingCountLines,
  dailyClosings,
  expenses,
  finishedProducts,
  masses,
  productionBatches,
  productionPlans,
  purchases,
  rawMaterials,
  recipes,
  recipeVersions,
  saleItems,
  sales,
  stockLots,
  suppliers,
  transformationOutputs,
  transformations,
} from "../../db/schema";
import { and, asc, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { todayISO } from "../domain/dates";
import { availableStock } from "../domain/fifo";
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

export interface DaySaleItem {
  name: string;
  qtyMicro: number;
  unitId: string;
}

export interface DaySaleRow {
  number: number;
  paymentMethod: string;
  items: DaySaleItem[];
  totalMicro: number;
  costMicro: number;
  marginMicro: number;
}

export interface DayExpenseRow {
  category: string;
  description: string;
  amountMicro: number;
}

export interface DayProductionRow {
  number: number;
  massName: string;
  realYieldMicro: number;
  yieldUnitId: string;
  totalCostMicro: number;
}

export interface DayOutputRow {
  productName: string;
  qtyMicro: number;
  unitId: string;
  costMicro: number;
}

export interface DayPurchaseRow {
  number: number;
  supplierName: string;
  totalMicro: number;
}

export interface PeriodSummary {
  from: string;
  to: string;
  salesMicro: number;
  cogsMicro: number;
  grossMicro: number;
  expensesMicro: number;
  netMicro: number;
  salesCount: number;
  productionCount: number;
  transformationCount: number;
  purchaseCount: number;
  purchaseTotalMicro: number;
}

export interface TopProductRow {
  productId: number;
  name: string;
  unitId: string;
  qtyMicro: number;
  totalMicro: number;
  costMicro: number;
  marginMicro: number;
}

/** Serie diaria (ventas, COGS, gastos) para gráfico de barras/línea. */
export interface DailyPoint {
  date: string;
  salesMicro: number;
  cogsMicro: number;
  grossMicro: number;
  expensesMicro: number;
  netMicro: number;
  salesCount: number;
}

/** Distribución de ventas del día por producto (dona + ranking). */
export interface DayProductSalesRow {
  productId: number;
  name: string;
  unitId: string;
  qtyMicro: number;
  totalMicro: number;
  costMicro: number;
  marginMicro: number;
}

export interface InventoryTypeSummary {
  activeCount: number;
  stockedCount: number;
  valueMicro: number;
  lowCount: number;
  outCount: number;
}

export interface InventorySummary {
  raw: InventoryTypeSummary;
  mass: InventoryTypeSummary;
  product: InventoryTypeSummary;
  totalValueMicro: number;
}

export type ProductionPlanState =
  | "pendiente"
  | "en_proceso"
  | "completado"
  | "con_desviaciones"
  | "bloqueado";

export interface PlanMaterialStatus {
  name: string;
  unitId: string;
  neededMicro: number;
  availableMicro: number;
  missingMicro: number;
}

export interface ProductionPlanStatus {
  id: number;
  number: number;
  planDate: string;
  recipeName: string;
  productName: string | null;
  massName: string;
  targetPackagesMicro: number;
  plannedMassesMicro: number;
  elaboratedMassesMicro: number;
  producedPackagesMicro: number;
  pendingPackagesMicro: number;
  progressPct: number;
  status: ProductionPlanState;
  missingMaterials: PlanMaterialStatus[];
}

export interface RecentProductionRow {
  kind: "elaboracion" | "terminacion";
  number: number;
  date: string;
  title: string;
  detail: string | null;
  expectedMicro: number;
  actualMicro: number;
  unitId: string | null;
  yieldPct: number | null;
  costMicro: number;
  status: string;
}

export interface LowYieldRow {
  kind: "elaboracion" | "terminacion";
  number: number;
  date: string;
  title: string;
  expectedMicro: number;
  actualMicro: number;
  unitId: string | null;
  gapPct: number;
}

export interface DashboardData {
  date: string;
  /** "day" = fecha seleccionada; "totals" = acumulado histórico del negocio. */
  mode?: "day" | "totals";
  salesMicro: number;
  cogsMicro: number;
  grossMicro: number;
  expensesMicro: number;
  netMicro: number;
  salesCount: number;
  stockValueMicro: number;
  alerts: StockAlert[];
  closingDiffCount: number;
  pendingClosings: string[];
  daySales: DaySaleRow[];
  dayExpenses: DayExpenseRow[];
  dayProductions: DayProductionRow[];
  dayOutputs: DayOutputRow[];
  dayPurchases: DayPurchaseRow[];
  week: PeriodSummary;
  month: PeriodSummary;
  topProducts: TopProductRow[];
  daily: DailyPoint[];
  dayProductSales: DayProductSalesRow[];
  inventory: InventorySummary;
  plan: ProductionPlanStatus | null;
  recentProductions: RecentProductionRow[];
  lowYields: LowYieldRow[];
  /** Utilidad neta histórica de todo el negocio (ventas − costos − gastos). */
  allTimeNetMicro: number;
  /** Presente solo en mode "totals": agregados históricos de producción. */
  productionTotals?: {
    massesMicro: number;
    packagesMicro: number;
    elaborationsCount: number;
    outputsCount: number;
  };
}

const num = (v: unknown): number => Math.trunc(Number(v ?? 0));

/** ISO días anteriores (ej. shiftDays("2026-10-15", -6) → "2026-10-09"). */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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

function buildAlerts(db: DBOrTx): {
  alerts: StockAlert[];
  stockValueMicro: number;
  stockRows: ReturnType<typeof stockByItem>;
} {
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
  return { alerts, stockValueMicro, stockRows };
}

/** Ventas confirmadas del día, una fila por venta con sus ítems. */
function daySales(db: DBOrTx, date: string): DaySaleRow[] {
  const rows = db
    .select({
      id: sales.id,
      number: sales.number,
      method: sales.paymentMethod,
      total: sales.totalMicro,
      cost: sales.totalCostMicro,
    })
    .from(sales)
    .where(and(eq(sales.saleDate, date), eq(sales.status, "confirmada")))
    .orderBy(desc(sales.number))
    .all();
  if (rows.length === 0) return [];

  const itemRows = db
    .select({
      saleId: saleItems.saleId,
      name: finishedProducts.name,
      unitId: finishedProducts.saleUnitId,
      qty: saleItems.qtyMicro,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .innerJoin(finishedProducts, eq(finishedProducts.id, saleItems.productId))
    .where(and(eq(sales.saleDate, date), eq(sales.status, "confirmada")))
    .orderBy(asc(saleItems.id))
    .all();

  const bySale = new Map<number, DaySaleItem[]>();
  for (const r of itemRows) {
    const arr = bySale.get(r.saleId) ?? [];
    arr.push({ name: r.name, qtyMicro: num(r.qty), unitId: r.unitId });
    bySale.set(r.saleId, arr);
  }

  return rows.map((s) => ({
    number: s.number,
    paymentMethod: s.method,
    items: bySale.get(s.id) ?? [],
    totalMicro: num(s.total),
    costMicro: num(s.cost),
    marginMicro: num(s.total) - num(s.cost),
  }));
}

function dayExpenses(db: DBOrTx, date: string): DayExpenseRow[] {
  return db
    .select({
      category: expenses.category,
      description: expenses.description,
      amount: expenses.amountMicro,
    })
    .from(expenses)
    .where(and(eq(expenses.expenseDate, date), eq(expenses.status, "confirmada")))
    .orderBy(desc(expenses.amountMicro))
    .all()
    .map((r) => ({ category: r.category, description: r.description, amountMicro: num(r.amount) }));
}

/** Elaboraciones de masas confirmadas del día. */
function dayProductions(db: DBOrTx, date: string): DayProductionRow[] {
  return db
    .select({
      number: productionBatches.number,
      massName: masses.name,
      realYield: productionBatches.realYieldMicro,
      yieldUnitId: productionBatches.yieldUnitId,
      cost: productionBatches.totalCostMicro,
    })
    .from(productionBatches)
    .innerJoin(recipeVersions, eq(recipeVersions.id, productionBatches.recipeVersionId))
    .innerJoin(masses, eq(masses.id, recipeVersions.massId))
    .where(
      and(
        eq(productionBatches.productionDate, date),
        eq(productionBatches.status, "confirmada"),
      ),
    )
    .orderBy(desc(productionBatches.number))
    .all()
    .map((r) => ({
      number: r.number,
      massName: r.massName,
      realYieldMicro: num(r.realYield),
      yieldUnitId: r.yieldUnitId,
      totalCostMicro: num(r.cost),
    }));
}

/** Productos terminados del día: paquetes obtenidos y costo total asignado. */
function dayOutputs(db: DBOrTx, date: string): DayOutputRow[] {
  return db
    .select({
      productId: finishedProducts.id,
      productName: finishedProducts.name,
      unitId: finishedProducts.saleUnitId,
      qty: sql<number>`COALESCE(SUM(${transformationOutputs.qtyMicro}), 0)`,
      cost: sql<number>`COALESCE(SUM(${transformationOutputs.costAllocatedMicro}), 0)`,
    })
    .from(transformationOutputs)
    .innerJoin(transformations, eq(transformations.id, transformationOutputs.transformationId))
    .innerJoin(finishedProducts, eq(finishedProducts.id, transformationOutputs.productId))
    .where(
      and(eq(transformations.transformDate, date), eq(transformations.status, "confirmada")),
    )
    .groupBy(finishedProducts.id, finishedProducts.name, finishedProducts.saleUnitId)
    .orderBy(sql`SUM(${transformationOutputs.qtyMicro}) DESC`)
    .all()
    .map((r) => ({
      productName: r.productName,
      qtyMicro: num(r.qty),
      unitId: r.unitId,
      costMicro: num(r.cost),
    }));
}

function dayPurchases(db: DBOrTx, date: string): DayPurchaseRow[] {
  return db
    .select({
      number: purchases.number,
      supplierName: suppliers.name,
      total: purchases.totalMicro,
    })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(and(eq(purchases.purchaseDate, date), eq(purchases.status, "confirmada")))
    .orderBy(desc(purchases.number))
    .all()
    .map((r) => ({ number: r.number, supplierName: r.supplierName, totalMicro: num(r.total) }));
}

/** Resumen general de un período (ventas, costo, gastos, utilidad y conteos). */
function periodSummary(db: DBOrTx, from: string, to: string): PeriodSummary {
  const s = db
    .select({
      total: sql<number>`COALESCE(SUM(${sales.totalMicro}), 0)`,
      cogs: sql<number>`COALESCE(SUM(${sales.totalCostMicro}), 0)`,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(sales)
    .where(and(eq(sales.status, "confirmada"), gte(sales.saleDate, from), lte(sales.saleDate, to)))
    .get();
  const e = db
    .select({ total: sql<number>`COALESCE(SUM(${expenses.amountMicro}), 0)` })
    .from(expenses)
    .where(
      and(eq(expenses.status, "confirmada"), gte(expenses.expenseDate, from), lte(expenses.expenseDate, to)),
    )
    .get();
  const p = db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(productionBatches)
    .where(
      and(eq(productionBatches.status, "confirmada"), gte(productionBatches.productionDate, from), lte(productionBatches.productionDate, to)),
    )
    .get();
  const t = db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(transformations)
    .where(
      and(eq(transformations.status, "confirmada"), gte(transformations.transformDate, from), lte(transformations.transformDate, to)),
    )
    .get();
  const pu = db
    .select({
      cnt: sql<number>`COUNT(*)`,
      total: sql<number>`COALESCE(SUM(${purchases.totalMicro}), 0)`,
    })
    .from(purchases)
    .where(
      and(eq(purchases.status, "confirmada"), gte(purchases.purchaseDate, from), lte(purchases.purchaseDate, to)),
    )
    .get();

  const salesMicro = num(s?.total);
  const cogsMicro = num(s?.cogs);
  const expensesMicro = num(e?.total);
  const grossMicro = salesMicro - cogsMicro;
  return {
    from,
    to,
    salesMicro,
    cogsMicro,
    grossMicro,
    expensesMicro,
    netMicro: grossMicro - expensesMicro,
    salesCount: num(s?.cnt),
    productionCount: num(p?.cnt),
    transformationCount: num(t?.cnt),
    purchaseCount: num(pu?.cnt),
    purchaseTotalMicro: num(pu?.total),
  };
}

function topProducts(db: DBOrTx, endDate: string, limit = 20, from?: string): TopProductRow[] {
  const rangeFrom = from ?? shiftDays(endDate, -29);
  const rows = db
    .select({
      productId: finishedProducts.id,
      name: finishedProducts.name,
      unitId: finishedProducts.saleUnitId,
      qty: sql<number>`COALESCE(SUM(${saleItems.qtyMicro}), 0)`,
      total: sql<number>`COALESCE(SUM(${saleItems.lineTotalMicro}), 0)`,
      cost: sql<number>`COALESCE(SUM(${saleItems.lineCostMicro}), 0)`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(finishedProducts, eq(finishedProducts.id, saleItems.productId))
    .where(and(eq(sales.status, "confirmada"), gte(sales.saleDate, rangeFrom), lte(sales.saleDate, endDate)))
    .groupBy(finishedProducts.id, finishedProducts.name, finishedProducts.saleUnitId)
    .orderBy(sql`SUM(${saleItems.lineTotalMicro}) DESC`)
    .limit(limit)
    .all();
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    unitId: r.unitId,
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

/** Serie diaria de ventas/COGS/gastos para los `days` días terminando en endDate. */
function dailySeries(db: DBOrTx, endDate: string, days = 7): DailyPoint[] {
  const from = shiftDays(endDate, -(days - 1));
  const salesRows = db
    .select({
      d: sales.saleDate,
      total: sql<number>`COALESCE(SUM(${sales.totalMicro}), 0)`,
      cogs: sql<number>`COALESCE(SUM(${sales.totalCostMicro}), 0)`,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(sales)
    .where(and(eq(sales.status, "confirmada"), gte(sales.saleDate, from), lte(sales.saleDate, endDate)))
    .groupBy(sales.saleDate)
    .all();
  const expRows = db
    .select({ d: expenses.expenseDate, total: sql<number>`COALESCE(SUM(${expenses.amountMicro}), 0)` })
    .from(expenses)
    .where(
      and(eq(expenses.status, "confirmada"), gte(expenses.expenseDate, from), lte(expenses.expenseDate, endDate)),
    )
    .groupBy(expenses.expenseDate)
    .all();

  const salesByDate = new Map(salesRows.map((r) => [r.d, r]));
  const expByDate = new Map(expRows.map((r) => [r.d, r]));
  const out: DailyPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = shiftDays(from, i);
    const s = salesByDate.get(d);
    const e = expByDate.get(d);
    const salesMicro = num(s?.total);
    const cogsMicro = num(s?.cogs);
    const expensesMicro = num(e?.total);
    out.push({
      date: d,
      salesMicro,
      cogsMicro,
      grossMicro: salesMicro - cogsMicro,
      expensesMicro,
      netMicro: salesMicro - cogsMicro - expensesMicro,
      salesCount: num(s?.cnt),
    });
  }
  return out;
}

/** Ventas del día agrupadas por producto (distribución de la dona y ranking). */
function dayProductSales(db: DBOrTx, date: string): DayProductSalesRow[] {
  const rows = db
    .select({
      productId: finishedProducts.id,
      name: finishedProducts.name,
      unitId: finishedProducts.saleUnitId,
      qty: sql<number>`COALESCE(SUM(${saleItems.qtyMicro}), 0)`,
      total: sql<number>`COALESCE(SUM(${saleItems.lineTotalMicro}), 0)`,
      cost: sql<number>`COALESCE(SUM(${saleItems.lineCostMicro}), 0)`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .innerJoin(finishedProducts, eq(finishedProducts.id, saleItems.productId))
    .where(and(eq(sales.saleDate, date), eq(sales.status, "confirmada")))
    .groupBy(finishedProducts.id, finishedProducts.name, finishedProducts.saleUnitId)
    .orderBy(sql`SUM(${saleItems.lineTotalMicro}) DESC`)
    .all();
  return rows.map((r) => {
    const totalMicro = num(r.total);
    const costMicro = num(r.cost);
    return {
      productId: r.productId,
      name: r.name,
      unitId: r.unitId,
      qtyMicro: num(r.qty),
      totalMicro,
      costMicro,
      marginMicro: totalMicro - costMicro,
    };
  });
}

/** Inventario por tipo: referencias activas, valor de lotes y alertas de mínimo. */
function inventorySummary(
  db: DBOrTx,
  alerts: StockAlert[],
  stockRows: ReturnType<typeof stockByItem>,
): InventorySummary {
  const valueOf = (type: "raw" | "mass" | "product") =>
    stockRows.filter((r) => r.itemType === type).reduce((acc, r) => acc + r.value, 0);
  const stockedCount = (type: "raw" | "mass" | "product") =>
    stockRows.filter((r) => r.itemType === type && r.qty > 0).length;
  const build = (type: "raw" | "mass" | "product", activeCount: number): InventoryTypeSummary => ({
    activeCount,
    stockedCount: stockedCount(type),
    valueMicro: valueOf(type),
    lowCount: alerts.filter((a) => a.itemType === type && a.level === "bajo").length,
    outCount: alerts.filter((a) => a.itemType === type && a.level === "agotado").length,
  });

  const countActive = (table: typeof rawMaterials | typeof masses | typeof finishedProducts) =>
    num(
      db
        .select({ n: sql<number>`COUNT(*)` })
        .from(table)
        .where(sql`${table}.active = 1`)
        .get()?.n,
    );

  const raw = build("raw", countActive(rawMaterials));
  const mass = build("mass", countActive(masses));
  const product = build("product", countActive(finishedProducts));
  const totalValueMicro = raw.valueMicro + mass.valueMicro + product.valueMicro;
  return { raw, mass, product, totalValueMicro };
}

interface PreviewLine {
  rawMaterialId?: number;
  name?: string;
  unitId?: string;
  qtyNeededMicro?: number;
}

function planMissingMaterials(
  db: DBOrTx,
  previewJson: string,
  target: number,
  produced: number,
): PlanMaterialStatus[] {
  let parsed: { ingredients?: PreviewLine[]; packaging?: PreviewLine[] };
  try {
    parsed = JSON.parse(previewJson) as typeof parsed;
  } catch {
    return [];
  }
  const lines = [...(parsed.ingredients ?? []), ...(parsed.packaging ?? [])];
  const pendingFraction = target > 0 ? Math.max(0, target - produced) / target : 0;
  if (pendingFraction <= 0) return [];
  const out: PlanMaterialStatus[] = [];
  for (const l of lines) {
    if (!l.name || !l.unitId || typeof l.qtyNeededMicro !== "number" || !l.rawMaterialId) continue;
    const neededScaled = Math.round(l.qtyNeededMicro * pendingFraction);
    const available = availableStock(db, "raw", l.rawMaterialId);
    const missing = Math.max(0, neededScaled - available);
    out.push({ name: l.name, unitId: l.unitId, neededMicro: neededScaled, availableMicro: available, missingMicro: missing });
  }
  return out.filter((l) => l.missingMicro > 0);
}

/** Último plan no anulado con fecha <= date, con progreso real de ejecución. */
function productionPlanStatus(db: DBOrTx, date: string): ProductionPlanStatus | null {
  const plan = db
    .select({
      id: productionPlans.id,
      number: productionPlans.number,
      planDate: productionPlans.planDate,
      target: productionPlans.targetPackagesMicro,
      planned: productionPlans.plannedMassesMicro,
      previewJson: productionPlans.previewJson,
      recipeName: recipes.name,
      productName: finishedProducts.name,
      massName: masses.name,
    })
    .from(productionPlans)
    .innerJoin(recipeVersions, eq(recipeVersions.id, productionPlans.recipeVersionId))
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(masses, eq(masses.id, recipeVersions.massId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
    .where(and(ne(productionPlans.status, "anulada"), lte(productionPlans.planDate, date)))
    .orderBy(desc(productionPlans.planDate), desc(productionPlans.number))
    .limit(1)
    .get();
  if (!plan) return null;

  const target = num(plan.target);
  const produced = num(
    db
      .select({ t: sql<number>`COALESCE(SUM(${transformationOutputs.qtyMicro}), 0)` })
      .from(transformationOutputs)
      .innerJoin(transformations, eq(transformations.id, transformationOutputs.transformationId))
      .where(and(eq(transformations.planId, plan.id), eq(transformations.status, "confirmada")))
      .get()?.t,
  );
  const elaborated = num(
    db
      .select({ m: sql<number>`COALESCE(SUM(${productionBatches.realYieldMicro}), 0)` })
      .from(productionBatches)
      .where(and(eq(productionBatches.planId, plan.id), eq(productionBatches.status, "confirmada")))
      .get()?.m,
  );
  const deviationCount = num(
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(transformations)
      .where(
        and(eq(transformations.planId, plan.id), eq(transformations.status, "confirmada"), sql`${transformations.deviationMicro} < 0`),
      )
      .get()?.n,
  );
  const missing = planMissingMaterials(db, plan.previewJson, target, produced);
  const pending = Math.max(0, target - produced);
  const progressPct = target > 0 ? Math.min(100, Math.round((produced / target) * 1000) / 10) : 0;

  let status: ProductionPlanState;
  if (target > 0 && produced >= target) status = "completado";
  else if (missing.length > 0 && produced === 0) status = "bloqueado";
  else if (deviationCount > 0) status = "con_desviaciones";
  else if (produced > 0) status = "en_proceso";
  else status = "pendiente";

  return {
    id: plan.id,
    number: plan.number,
    planDate: plan.planDate,
    recipeName: plan.recipeName,
    productName: plan.productName,
    massName: plan.massName,
    targetPackagesMicro: target,
    plannedMassesMicro: num(plan.planned),
    elaboratedMassesMicro: elaborated,
    producedPackagesMicro: produced,
    pendingPackagesMicro: pending,
    progressPct,
    status,
    missingMaterials: missing,
  };
}

/** Últimas elaboraciones y terminaciones (unión ordenada por fecha desc). */
function recentProductions(db: DBOrTx, date: string, limit = 6): RecentProductionRow[] {
  const batches = db
    .select({
      number: productionBatches.number,
      d: productionBatches.productionDate,
      recipeName: recipes.name,
      massName: masses.name,
      expected: productionBatches.expectedYieldMicro,
      actual: productionBatches.realYieldMicro,
      unitId: productionBatches.yieldUnitId,
      cost: productionBatches.totalCostMicro,
      status: productionBatches.status,
    })
    .from(productionBatches)
    .innerJoin(recipeVersions, eq(recipeVersions.id, productionBatches.recipeVersionId))
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(masses, eq(masses.id, recipeVersions.massId))
    .where(and(eq(productionBatches.status, "confirmada"), lte(productionBatches.productionDate, date)))
    .orderBy(desc(productionBatches.productionDate), desc(productionBatches.number))
    .limit(limit)
    .all();

  const tfs = db
    .select({
      number: transformations.number,
      d: transformations.transformDate,
      massName: masses.name,
      expected: transformations.expectedPackagesMicro,
      actual: sql<number>`COALESCE((SELECT SUM(tr.qty_micro) FROM transformation_outputs tr WHERE tr.transformation_id = ${transformations.id}), 0)`,
      unitId: finishedProducts.saleUnitId,
      productName: finishedProducts.name,
      recipeName: recipes.name,
      cost: transformations.totalCostMicro,
      status: transformations.status,
    })
    .from(transformations)
    .innerJoin(masses, eq(masses.id, transformations.massId))
    .leftJoin(recipeVersions, eq(recipeVersions.id, transformations.recipeVersionId))
    .leftJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
    .where(and(eq(transformations.status, "confirmada"), lte(transformations.transformDate, date)))
    .orderBy(desc(transformations.transformDate), desc(transformations.number))
    .limit(limit)
    .all();

  const rows: RecentProductionRow[] = [
    ...batches.map((b) => {
      const expectedMicro = num(b.expected);
      const actualMicro = num(b.actual);
      return {
        kind: "elaboracion" as const,
        number: b.number,
        date: b.d,
        title: b.massName,
        detail: b.recipeName,
        expectedMicro,
        actualMicro,
        unitId: b.unitId,
        yieldPct: expectedMicro > 0 ? Math.round((actualMicro / expectedMicro) * 1000) / 10 : null,
        costMicro: num(b.cost),
        status: b.status,
      };
    }),
    ...tfs.map((t) => {
      const expectedMicro = num(t.expected);
      const actualMicro = num(t.actual);
      return {
        kind: "terminacion" as const,
        number: t.number,
        date: t.d,
        title: t.productName ?? t.recipeName ?? t.massName,
        detail: t.massName,
        expectedMicro,
        actualMicro,
        unitId: t.productName ? t.unitId : null,
        yieldPct: expectedMicro > 0 && t.productName ? Math.round((actualMicro / expectedMicro) * 1000) / 10 : null,
        costMicro: num(t.cost),
        status: t.status,
      };
    }),
  ];
  return rows
    .sort((a, b) => (a.date === b.date ? b.number - a.number : a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

/** Operaciones recientes (7 días) cuyo rendimiento real quedó por debajo del esperado. */
function lowYields(db: DBOrTx, endDate: string, limit = 5): LowYieldRow[] {
  const from = shiftDays(endDate, -6);
  const batches = db
    .select({
      number: productionBatches.number,
      d: productionBatches.productionDate,
      massName: masses.name,
      expected: productionBatches.expectedYieldMicro,
      actual: productionBatches.realYieldMicro,
      unitId: productionBatches.yieldUnitId,
    })
    .from(productionBatches)
    .innerJoin(recipeVersions, eq(recipeVersions.id, productionBatches.recipeVersionId))
    .innerJoin(masses, eq(masses.id, recipeVersions.massId))
    .where(
      and(
        eq(productionBatches.status, "confirmada"),
        gte(productionBatches.productionDate, from),
        lte(productionBatches.productionDate, endDate),
        sql`${productionBatches.realYieldMicro} < ${productionBatches.expectedYieldMicro}`,
      ),
    )
    .all();

  const tfs = db
    .select({
      number: transformations.number,
      d: transformations.transformDate,
      productName: finishedProducts.name,
      recipeName: recipes.name,
      expected: transformations.expectedPackagesMicro,
      actual: sql<number>`COALESCE((SELECT SUM(tr.qty_micro) FROM transformation_outputs tr WHERE tr.transformation_id = ${transformations.id}), 0)`,
      unitId: finishedProducts.saleUnitId,
    })
    .from(transformations)
    .leftJoin(recipeVersions, eq(recipeVersions.id, transformations.recipeVersionId))
    .leftJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
    .where(
      and(
        eq(transformations.status, "confirmada"),
        gte(transformations.transformDate, from),
        lte(transformations.transformDate, endDate),
        sql`${transformations.deviationMicro} < 0`,
      ),
    )
    .all();

  const toRow = (kind: "elaboracion" | "terminacion", r: {
    number: number;
    d: string;
    title: string;
    expected: number;
    actual: number;
    unitId: string | null;
  }): LowYieldRow => {
    const expectedMicro = num(r.expected);
    const actualMicro = num(r.actual);
    return {
      kind,
      number: r.number,
      date: r.d,
      title: r.title,
      expectedMicro,
      actualMicro,
      unitId: r.unitId,
      gapPct: expectedMicro > 0 ? Math.round(((actualMicro - expectedMicro) / expectedMicro) * 1000) / 10 : 0,
    };
  };

  return [
    ...batches.map((b) => toRow("elaboracion", { number: b.number, d: b.d, title: b.massName, expected: b.expected, actual: b.actual, unitId: b.unitId })),
    ...tfs.map((t) => toRow("terminacion", { number: t.number, d: t.d, title: t.productName ?? t.recipeName ?? "", expected: t.expected, actual: t.actual, unitId: t.productName ? t.unitId : null })),
  ]
    .filter((r) => r.title)
    .sort((a, b) => (a.date === b.date ? b.number - a.number : a.date < b.date ? 1 : -1))
    .slice(0, limit);
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

  const { alerts, stockValueMicro, stockRows } = buildAlerts(db);
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
    mode: "day",
    salesMicro,
    cogsMicro,
    grossMicro,
    expensesMicro,
    netMicro: grossMicro - expensesMicro,
    salesCount: num(salesAgg?.cnt),
    stockValueMicro,
    alerts,
    closingDiffCount,
    pendingClosings: pendingClosings(db),
    daySales: daySales(db, date),
    dayExpenses: dayExpenses(db, date),
    dayProductions: dayProductions(db, date),
    dayOutputs: dayOutputs(db, date),
    dayPurchases: dayPurchases(db, date),
    week: periodSummary(db, shiftDays(date, -6), date),
    month: periodSummary(db, `${date.slice(0, 8)}01`, date),
    topProducts: topProducts(db, date),
    daily: dailySeries(db, date, 15),
    dayProductSales: dayProductSales(db, date),
    inventory: inventorySummary(db, alerts, stockRows),
    plan: productionPlanStatus(db, date),
    recentProductions: recentProductions(db, date),
    lowYields: lowYields(db, date),
    allTimeNetMicro: allTimeNet(db),
  };
}

const ALL_TIME_FROM = "1970-01-01";

function allTimeNet(db: DBOrTx): number {
  const s = db
    .select({
      total: sql<number>`COALESCE(SUM(${sales.totalMicro}), 0)`,
      cogs: sql<number>`COALESCE(SUM(${sales.totalCostMicro}), 0)`,
    })
    .from(sales)
    .where(eq(sales.status, "confirmada"))
    .get();
  const e = db
    .select({ total: sql<number>`COALESCE(SUM(${expenses.amountMicro}), 0)` })
    .from(expenses)
    .where(eq(expenses.status, "confirmada"))
    .get();
  return num(s?.total) - num(s?.cogs) - num(e?.total);
}

/** Acumulados históricos de todo el negocio (sin filtro de día). */
export function getDashboardTotals(db: DBOrTx): DashboardData {
  const today = todayISO();
  const summary = periodSummary(db, ALL_TIME_FROM, today);

  const prodAgg = db
    .select({
      cnt: sql<number>`COUNT(*)`,
      yieldSum: sql<number>`COALESCE(SUM(${productionBatches.realYieldMicro}), 0)`,
    })
    .from(productionBatches)
    .where(
      and(
        eq(productionBatches.status, "confirmada"),
        gte(productionBatches.productionDate, ALL_TIME_FROM),
        lte(productionBatches.productionDate, today),
      ),
    )
    .get();

  const outAgg = db
    .select({
      cnt: sql<number>`COUNT(*)`,
      qtySum: sql<number>`COALESCE(SUM(${transformationOutputs.qtyMicro}), 0)`,
    })
    .from(transformationOutputs)
    .innerJoin(transformations, eq(transformations.id, transformationOutputs.transformationId))
    .where(
      and(
        eq(transformations.status, "confirmada"),
        gte(transformations.transformDate, ALL_TIME_FROM),
        lte(transformations.transformDate, today),
      ),
    )
    .get();

  const { alerts, stockValueMicro, stockRows } = buildAlerts(db);
  const closingDiffCount = num(
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(closingCountLines)
      .where(sql`${closingCountLines.diffMicro} != 0`)
      .get()?.n,
  );

  // Ventas por producto históricas (para dona y ranking)
  const productRows = db
    .select({
      productId: finishedProducts.id,
      name: finishedProducts.name,
      unitId: finishedProducts.saleUnitId,
      qty: sql<number>`COALESCE(SUM(${saleItems.qtyMicro}), 0)`,
      total: sql<number>`COALESCE(SUM(${saleItems.lineTotalMicro}), 0)`,
      cost: sql<number>`COALESCE(SUM(${saleItems.lineCostMicro}), 0)`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .innerJoin(finishedProducts, eq(finishedProducts.id, saleItems.productId))
    .where(and(eq(sales.status, "confirmada"), gte(sales.saleDate, ALL_TIME_FROM)))
    .groupBy(finishedProducts.id, finishedProducts.name, finishedProducts.saleUnitId)
    .orderBy(sql`SUM(${saleItems.lineTotalMicro}) DESC`)
    .all();

  const dayProductSales: DayProductSalesRow[] = productRows.map((r) => {
    const totalMicro = num(r.total);
    const costMicro = num(r.cost);
    return {
      productId: r.productId,
      name: r.name,
      unitId: r.unitId,
      qtyMicro: num(r.qty),
      totalMicro,
      costMicro,
      marginMicro: totalMicro - costMicro,
    };
  });

  return {
    date: today,
    mode: "totals",
    salesMicro: summary.salesMicro,
    cogsMicro: summary.cogsMicro,
    grossMicro: summary.grossMicro,
    expensesMicro: summary.expensesMicro,
    netMicro: summary.netMicro,
    salesCount: summary.salesCount,
    stockValueMicro,
    alerts,
    closingDiffCount,
    pendingClosings: pendingClosings(db),
    daySales: [],
    dayExpenses: [],
    dayProductions: [],
    dayOutputs: [],
    dayPurchases: [],
    week: periodSummary(db, shiftDays(today, -6), today),
    month: periodSummary(db, `${today.slice(0, 8)}01`, today),
    topProducts: topProducts(db, today, 20, ALL_TIME_FROM),
    daily: dailySeries(db, today, 15),
    dayProductSales,
    inventory: inventorySummary(db, alerts, stockRows),
    plan: productionPlanStatus(db, today),
    recentProductions: recentProductions(db, today, 20),
    lowYields: [],
    allTimeNetMicro: summary.netMicro,
    productionTotals: {
      massesMicro: num(prodAgg?.yieldSum),
      packagesMicro: num(outAgg?.qtySum),
      elaborationsCount: num(prodAgg?.cnt),
      outputsCount: num(outAgg?.cnt),
    },
  };
}
