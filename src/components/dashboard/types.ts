export interface StockAlert {
  itemType: string;
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

export interface DailyPoint {
  date: string;
  salesMicro: number;
  cogsMicro: number;
  grossMicro: number;
  expensesMicro: number;
  netMicro: number;
  salesCount: number;
}

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
}

/** Paleta de marca para gráficos. */
export const CHART_COLORS = {
  sales: "#059669",
  costs: "#2563EB",
  gross: "#7C3AED",
  expenses: "#EA580C",
  net: "#047857",
  donut: ["#059669", "#2563EB", "#7C3AED", "#EA580C", "#EAB308", "#94A3B8"],
} as const;
