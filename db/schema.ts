import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Escalas fijas del sistema (nunca se usa float para dinero ni cantidades):
 * - Dinero: micro-CUP (entero = 1/1,000,000 CUP). $1.50 = 1_500_000.
 * - Cantidades: micro-unidades de la unidad base del ítem (entero).
 * - Fechas de negocio: 'YYYY-MM-DD' (local). Timestamps: ISO local 'YYYY-MM-DDTHH:mm:ss.sss'.
 */

export const CREATED_AT = () =>
  text("created_at").notNull().default(sql`(datetime('now','localtime'))`);

// ---------------------------------------------------------------------------
// Unidades de medida
// ---------------------------------------------------------------------------
export const units = sqliteTable("units", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  dimension: text("dimension").notNull(), // 'masa' | 'volumen' | 'conteo'
  // micro-unidades de la unidad BASE de la dimensión que equivalen a 1 unidad completa
  factor: integer("factor").notNull(),
  isBase: integer("is_base", { mode: "boolean" }).notNull().default(false),
});

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------
export const suppliers = sqliteTable("suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: CREATED_AT(),
});

// ---------------------------------------------------------------------------
// Materias primas (incluye empaques)
// ---------------------------------------------------------------------------
export const rawMaterials = sqliteTable(
  "raw_materials",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.code),
    stockMicro: integer("stock_micro").notNull().default(0),
    minStockMicro: integer("min_stock_micro").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: CREATED_AT(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("raw_materials_name_uq").on(t.name)],
);

// ---------------------------------------------------------------------------
// Masas (inventario interno de semielaborados)
// ---------------------------------------------------------------------------
export const masses = sqliteTable(
  "masses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.code),
    stockMicro: integer("stock_micro").notNull().default(0),
    minStockMicro: integer("min_stock_micro").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: CREATED_AT(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("masses_name_uq").on(t.name)],
);

// ---------------------------------------------------------------------------
// Productos terminados
// ---------------------------------------------------------------------------
export const finishedProducts = sqliteTable(
  "finished_products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    category: text("category"),
    presentation: text("presentation"),
    saleUnitId: text("sale_unit_id")
      .notNull()
      .references(() => units.code),
    unitsPerPackage: integer("units_per_package").notNull().default(1),
    priceMicro: integer("price_micro").notNull().default(0),
    stockMicro: integer("stock_micro").notNull().default(0),
    minStockMicro: integer("min_stock_micro").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: CREATED_AT(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("finished_products_name_uq").on(t.name)],
);

// Historial de precios de venta: jamás se recalcula una venta con el precio actual.
export const priceHistory = sqliteTable("price_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id")
    .notNull()
    .references(() => finishedProducts.id),
  priceMicro: integer("price_micro").notNull(),
  validFrom: text("valid_from").notNull(),
  reason: text("reason"),
  createdAt: CREATED_AT(),
});

// ---------------------------------------------------------------------------
// Lotes de inventario — base del costo promedio NO, es PEPS/FIFO con precio real
// Cada entrada de stock crea un lote con su costo real; los consumos retiran
// primero el lote más antiguo.
// ---------------------------------------------------------------------------
export const stockLots = sqliteTable(
  "stock_lots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemType: text("item_type").notNull(), // 'raw' | 'mass' | 'product'
    itemId: integer("item_id").notNull(),
    refType: text("ref_type").notNull(), // 'purchase' | 'production' | 'transformation'
    refId: integer("ref_id").notNull(),
    qtyInitialMicro: integer("qty_initial_micro").notNull(),
    qtyRemainingMicro: integer("qty_remaining_micro").notNull(),
    // costo real por 1 unidad completa de la unidad base del ítem (micro-CUP)
    unitCostMicro: integer("unit_cost_micro").notNull(),
    businessDate: text("business_date").notNull(),
    createdAt: CREATED_AT(),
    cancelledAt: text("cancelled_at"),
  },
  (t) => [
    index("stock_lots_fifo_idx").on(t.itemType, t.itemId, t.id),
    index("stock_lots_ref_idx").on(t.refType, t.refId),
  ],
);

// ---------------------------------------------------------------------------
// Ledger de movimientos de inventario (fuente de verdad para reconstrucción)
// ---------------------------------------------------------------------------
export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    businessDate: text("business_date").notNull(),
    itemType: text("item_type").notNull(), // 'raw' | 'mass' | 'product'
    itemId: integer("item_id").notNull(),
    movementType: text("movement_type").notNull(),
    // 'purchase' | 'production_in' | 'production_out' | 'transform_in' |
    // 'transform_out' | 'sale' | 'adjustment' | 'waste' | 'closing_diff' | 'cancel_*'
    qtyDeltaMicro: integer("qty_delta_micro").notNull(), // signo: + entrada, − salida
    unitCostMicro: integer("unit_cost_micro").notNull().default(0),
    valueMicro: integer("value_micro").notNull().default(0), // qtyDelta × unitCost
    lotId: integer("lot_id").references(() => stockLots.id),
    refType: text("ref_type"), // tabla de origen
    refId: integer("ref_id"),
    reason: text("reason"),
    notes: text("notes"),
    createdAt: CREATED_AT(),
  },
  (t) => [
    index("inv_mov_item_idx").on(t.itemType, t.itemId, t.id),
    index("inv_mov_date_idx").on(t.businessDate),
    index("inv_mov_ref_idx").on(t.refType, t.refId),
  ],
);

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------
export const purchases = sqliteTable(
  "purchases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    number: integer("number").notNull(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    purchaseDate: text("purchase_date").notNull(),
    docNumber: text("doc_number"),
    notes: text("notes"),
    totalMicro: integer("total_micro").notNull().default(0),
    status: text("status").notNull().default("confirmada"), // confirmada | anulada
    createdAt: CREATED_AT(),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("purchases_number_uq").on(t.number),
    index("purchases_date_idx").on(t.purchaseDate),
  ],
);

export const purchaseItems = sqliteTable("purchase_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  purchaseId: integer("purchase_id")
    .notNull()
    .references(() => purchases.id),
  rawMaterialId: integer("raw_material_id")
    .notNull()
    .references(() => rawMaterials.id),
  unitId: text("unit_id")
    .notNull()
    .references(() => units.code),
  qtyMicro: integer("qty_micro").notNull(), // micro-unidades de la unidad `unitId`
  qtyBaseMicro: integer("qty_base_micro").notNull(), // convertido a unidad base
  unitPriceMicro: integer("unit_price_micro").notNull(), // micro-CUP por unidad completa de `unitId`
  lineTotalMicro: integer("line_total_micro").notNull(),
});

// ---------------------------------------------------------------------------
// Recetas (versionado: producción apunta a recipe_versions)
// UNA receta por producto (índice único sobre product_id).
// ---------------------------------------------------------------------------
export const recipes = sqliteTable(
  "recipes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    // Producto terminado al que corresponde esta receta (1 receta por producto).
    productId: integer("product_id").references(() => finishedProducts.id),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: CREATED_AT(),
    updatedAt: text("updated_at"),
  },
  (t) => [
    uniqueIndex("recipes_name_uq").on(t.name),
    uniqueIndex("recipes_product_uq").on(t.productId),
  ],
);

export const recipeVersions = sqliteTable(
  "recipe_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id),
    version: integer("version").notNull(),
    status: text("status").notNull().default("activa"), // activa | archivada
    massId: integer("mass_id")
      .notNull()
      .references(() => masses.id),
    // Rendimiento esperado de UNA masa, expresado en paquetes (unidad de venta
    // del producto). Es una referencia de planificación, no una garantía.
    // Método del rendimiento:
    // - 'directo': paquetes fijos por masa (expectedYieldMicro).
    // - 'peso': paquetes teóricos = pesoTotalMasa × pesoUnidad / unidadesPorPaquete
    //   (compatibilidad Excel; unidades configuradas por el usuario).
    yieldMethod: text("yield_method").notNull().default("directo"), // directo | peso
    // Peso de UNA unidad de producto (paso clave del método por peso), en micros
    // de unitMassUnitId (conserva las unidades originales del usuario).
    unitMassMicro: integer("unit_mass_micro"),
    unitMassUnitId: text("unit_mass_unit_id").references(() => units.code),
    // Unidad en que se suma (y muestra) el peso total de los ingredientes de masa.
    yieldMassUnitId: text("yield_mass_unit_id").references(() => units.code),
    expectedYieldMicro: integer("expected_yield_micro").notNull(),
    yieldUnitId: text("yield_unit_id")
      .notNull()
      .references(() => units.code),
    instructions: text("instructions"),
    validFrom: text("valid_from").notNull(),
    notes: text("notes"),
    createdAt: CREATED_AT(),
  },
  (t) => [uniqueIndex("recipe_versions_uq").on(t.recipeId, t.version)],
);

export const recipeItems = sqliteTable("recipe_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipeVersionId: integer("recipe_version_id")
    .notNull()
    .references(() => recipeVersions.id),
  rawMaterialId: integer("raw_material_id")
    .notNull()
    .references(() => rawMaterials.id),
  unitId: text("unit_id")
    .notNull()
    .references(() => units.code),
  // micro de `unitId` (puede ser unidad de compra distinta de la base)
  qtyMicro: integer("qty_micro").notNull(),
  // Momento de consumo: 'masa' = cantidad por masa (al elaborar);
  // 'paquete' = cantidad por paquete (al terminar/empaquetar).
  phase: text("phase").notNull().default("masa"),
});

// ---------------------------------------------------------------------------
// Planificación de producción (referencia de planificación; NO descuenta stock)
// masas necesarias = ceil(paquetes deseados / rendimiento esperado por masa)
// ---------------------------------------------------------------------------
export const productionPlans = sqliteTable(
  "production_plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    number: integer("number").notNull(),
    planDate: text("plan_date").notNull(),
    recipeVersionId: integer("recipe_version_id")
      .notNull()
      .references(() => recipeVersions.id),
    targetPackagesMicro: integer("target_packages_micro").notNull(),
    // snapshot del rendimiento esperado al planificar (paquetes por masa)
    expectedYieldMicro: integer("expected_yield_micro").notNull(),
    plannedMassesMicro: integer("planned_masses_micro").notNull(),
    // snapshot JSON del cálculo (ingredientes, empaques, faltantes y costos)
    previewJson: text("preview_json").notNull().default("{}"),
    status: text("status").notNull().default("planificada"), // planificada | anulada
    notes: text("notes"),
    clientToken: text("client_token"),
    createdAt: CREATED_AT(),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("production_plans_number_uq").on(t.number),
    uniqueIndex("production_plans_token_uq").on(t.clientToken),
    index("production_plans_date_idx").on(t.planDate),
  ],
);

// ---------------------------------------------------------------------------
// Producción de masas (elaboración de N masas completas)
// ---------------------------------------------------------------------------
export const productionBatches = sqliteTable(
  "production_batches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    number: integer("number").notNull(),
    productionDate: text("production_date").notNull(),
    recipeVersionId: integer("recipe_version_id")
      .notNull()
      .references(() => recipeVersions.id),
    planId: integer("plan_id").references(() => productionPlans.id),
    // esperado/real medidos en MASAS completas (unidad de la masa)
    expectedYieldMicro: integer("expected_yield_micro").notNull(),
    realYieldMicro: integer("real_yield_micro").notNull(),
    yieldUnitId: text("yield_unit_id")
      .notNull()
      .references(() => units.code),
    // Mano de obra de elaboración (tarifa por masa × masas). Es costo directo
    // del lote: unit_cost = (materiales + MO) / masas.
    laborCostMicro: integer("labor_cost_micro").notNull().default(0),
    totalCostMicro: integer("total_cost_micro").notNull().default(0),
    unitCostMicro: integer("unit_cost_micro").notNull().default(0),
    status: text("status").notNull().default("confirmada"), // confirmada | anulada
    responsible: text("responsible"),
    notes: text("notes"),
    clientToken: text("client_token"),
    createdAt: CREATED_AT(),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("production_batches_number_uq").on(t.number),
    uniqueIndex("production_batches_token_uq").on(t.clientToken),
    index("production_batches_date_idx").on(t.productionDate),
  ],
);

// Consumo real por lote (precio REAL del lote congelado al confirmar)
export const productionConsumptions = sqliteTable(
  "production_consumptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => productionBatches.id),
    rawMaterialId: integer("raw_material_id")
      .notNull()
      .references(() => rawMaterials.id),
    lotId: integer("lot_id")
      .notNull()
      .references(() => stockLots.id),
    qtyMicro: integer("qty_micro").notNull(), // micro-unidades unidad base
    unitCostMicro: integer("unit_cost_micro").notNull(), // congelado
    lineCostMicro: integer("line_cost_micro").notNull(),
  },
  (t) => [index("prod_consumptions_batch_idx").on(t.batchId)],
);

// Salida de masa generada por la producción (lote de masa con su costo real)
export const productionOutputs = sqliteTable("production_outputs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: integer("batch_id")
    .notNull()
    .references(() => productionBatches.id),
  massId: integer("mass_id")
    .notNull()
    .references(() => masses.id),
  lotId: integer("lot_id")
    .notNull()
    .references(() => stockLots.id),
  qtyMicro: integer("qty_micro").notNull(),
  unitCostMicro: integer("unit_cost_micro").notNull(),
});

// ---------------------------------------------------------------------------
// Transformación masa → productos terminados
// ---------------------------------------------------------------------------
export const transformations = sqliteTable(
  "transformations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    number: integer("number").notNull(),
    transformDate: text("transform_date").notNull(),
    massId: integer("mass_id")
      .notNull()
      .references(() => masses.id),
    // versión de receta congelada al terminar (referencia de empaques y rendimiento)
    recipeVersionId: integer("recipe_version_id").references(() => recipeVersions.id),
    planId: integer("plan_id").references(() => productionPlans.id),
    // paquetes esperados = masas consumidas × rendimiento esperado por masa
    expectedPackagesMicro: integer("expected_packages_micro").notNull().default(0),
    // desviación = paquetes reales − paquetes esperados (conservada históricamente)
    deviationMicro: integer("deviation_micro").notNull().default(0),
    // Mano de obra de terminación (tarifa por unidad individual × unidades).
    laborCostMicro: integer("labor_cost_micro").notNull().default(0),
    totalCostMicro: integer("total_cost_micro").notNull().default(0),
    status: text("status").notNull().default("confirmada"), // confirmada | anulada
    notes: text("notes"),
    clientToken: text("client_token"),
    createdAt: CREATED_AT(),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("transformations_number_uq").on(t.number),
    uniqueIndex("transformations_token_uq").on(t.clientToken),
    index("transformations_date_idx").on(t.transformDate),
  ],
);

export const transformationConsumptions = sqliteTable(
  "transformation_consumptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transformationId: integer("transformation_id")
      .notNull()
      .references(() => transformations.id),
    lotId: integer("lot_id")
      .notNull()
      .references(() => stockLots.id),
    qtyMicro: integer("qty_micro").notNull(),
    unitCostMicro: integer("unit_cost_micro").notNull(), // congelado
    lineCostMicro: integer("line_cost_micro").notNull(),
  },
);

export const transformationOutputs = sqliteTable(
  "transformation_outputs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transformationId: integer("transformation_id")
      .notNull()
      .references(() => transformations.id),
    productId: integer("product_id")
      .notNull()
      .references(() => finishedProducts.id),
    lotId: integer("lot_id")
      .notNull()
      .references(() => stockLots.id),
    qtyMicro: integer("qty_micro").notNull(),
    // costo total de la masa repartido proporcionalmente a la cantidad
    costAllocatedMicro: integer("cost_allocated_micro").notNull(),
    unitCostMicro: integer("unit_cost_micro").notNull(),
  },
);

// Consumo de materiales (empaques, etc.) durante la terminación:
// cantidad = por-paquete de la receta × paquetes reales obtenidos.
export const transformationMaterialConsumptions = sqliteTable(
  "transformation_material_consumptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transformationId: integer("transformation_id")
      .notNull()
      .references(() => transformations.id),
    rawMaterialId: integer("raw_material_id")
      .notNull()
      .references(() => rawMaterials.id),
    lotId: integer("lot_id")
      .notNull()
      .references(() => stockLots.id),
    qtyMicro: integer("qty_micro").notNull(), // micro-unidades unidad base
    unitCostMicro: integer("unit_cost_micro").notNull(), // congelado
    lineCostMicro: integer("line_cost_micro").notNull(),
  },
  (t) => [index("tf_mat_consumptions_tf_idx").on(t.transformationId)],
);

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------
export const sales = sqliteTable(
  "sales",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    number: integer("number").notNull(),
    saleDate: text("sale_date").notNull(),
    paymentMethod: text("payment_method").notNull(), // efectivo | tarjeta | transferencia | otro
    subtotalMicro: integer("subtotal_micro").notNull().default(0),
    discountMicro: integer("discount_micro").notNull().default(0),
    totalMicro: integer("total_micro").notNull().default(0),
    totalCostMicro: integer("total_cost_micro").notNull().default(0),
    status: text("status").notNull().default("confirmada"), // confirmada | anulada
    notes: text("notes"),
    createdAt: CREATED_AT(),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("sales_number_uq").on(t.number),
    index("sales_date_idx").on(t.saleDate),
  ],
);

export const saleItems = sqliteTable("sale_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  saleId: integer("sale_id")
    .notNull()
    .references(() => sales.id),
  productId: integer("product_id")
    .notNull()
    .references(() => finishedProducts.id),
  qtyMicro: integer("qty_micro").notNull(),
  unitPriceMicro: integer("unit_price_micro").notNull(), // congelado
  unitCostMicro: integer("unit_cost_micro").notNull(), // congelado (costo real del lote)
  lineTotalMicro: integer("line_total_micro").notNull(),
  lineCostMicro: integer("line_cost_micro").notNull(),
});

// Consumo por lote dentro de cada línea de venta (para anulación exacta)
export const saleItemLots = sqliteTable("sale_item_lots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  saleItemId: integer("sale_item_id")
    .notNull()
    .references(() => saleItems.id),
  lotId: integer("lot_id")
    .notNull()
    .references(() => stockLots.id),
  qtyMicro: integer("qty_micro").notNull(),
  unitCostMicro: integer("unit_cost_micro").notNull(),
});

// ---------------------------------------------------------------------------
// Gastos operativos
// ---------------------------------------------------------------------------
export const expenses = sqliteTable(
  "expenses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    expenseDate: text("expense_date").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amountMicro: integer("amount_micro").notNull(),
    paymentMethod: text("payment_method").notNull().default("efectivo"),
    responsible: text("responsible"),
    notes: text("notes"),
    status: text("status").notNull().default("confirmada"), // confirmada | anulada
    createdAt: CREATED_AT(),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [index("expenses_date_idx").on(t.expenseDate)],
);

// ---------------------------------------------------------------------------
// Cierres diarios
// ---------------------------------------------------------------------------
export const dailyClosings = sqliteTable(
  "daily_closings",
  {
    businessDate: text("business_date").primaryKey(),
    salesTotalMicro: integer("sales_total_micro").notNull().default(0),
    cogsMicro: integer("cogs_micro").notNull().default(0),
    expensesMicro: integer("expenses_micro").notNull().default(0),
    grossProfitMicro: integer("gross_profit_micro").notNull().default(0),
    netResultMicro: integer("net_result_micro").notNull().default(0),
    status: text("status").notNull().default("cerrado"), // cerrado | reabierto
    closedAt: text("closed_at"),
    reopenedAt: text("reopened_at"),
    reopenReason: text("reopen_reason"),
    notes: text("notes"),
  },
  (t) => [index("daily_closings_status_idx").on(t.status)],
);

export const closingCountLines = sqliteTable("closing_count_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessDate: text("business_date")
    .notNull()
    .references(() => dailyClosings.businessDate),
  itemType: text("item_type").notNull(),
  itemId: integer("item_id").notNull(),
  expectedMicro: integer("expected_micro").notNull(),
  countedMicro: integer("counted_micro").notNull(),
  diffMicro: integer("diff_micro").notNull(),
  unitCostMicro: integer("unit_cost_micro").notNull().default(0),
  diffValueMicro: integer("diff_value_micro").notNull().default(0),
  reason: text("reason"),
});

// ---------------------------------------------------------------------------
// Auditoría (siempre registra "admin": sistema de un solo usuario)
// ---------------------------------------------------------------------------
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: CREATED_AT(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    summary: text("summary").notNull(),
    detailsJson: text("details_json"),
  },
  (t) => [index("audit_logs_date_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Contadores de documentos (numeración secuencial transaccional)
// ---------------------------------------------------------------------------
export const docCounters = sqliteTable("doc_counters", {
  type: text("type").primaryKey(),
  nextNumber: integer("next_number").notNull().default(1),
});

// ---------------------------------------------------------------------------
// Tarifas de mano de obra (fichas de costo)
// kind 'masa' → tarifa por elaborar UNA masa completa de un tipo de masa.
// kind 'terminacion' → tarifa por UNA unidad individual terminada de un producto.
// Solo definen el costo de la ficha/estimación: NO generan obligaciones salariales.
// ---------------------------------------------------------------------------
export const laborRates = sqliteTable(
  "labor_rates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(), // 'masa' | 'terminacion'
    massId: integer("mass_id").references(() => masses.id),
    productId: integer("product_id").references(() => finishedProducts.id),
    // micro-CUP por 1 masa (kind 'masa') o por 1 unidad individual (kind 'terminacion')
    rateMicro: integer("rate_micro").notNull(),
    createdAt: CREATED_AT(),
    updatedAt: text("updated_at"),
  },
  (t) => [
    index("labor_rates_mass_idx").on(t.massId),
    index("labor_rates_product_idx").on(t.productId),
  ],
);

// ---------------------------------------------------------------------------
// Ajustes de la aplicación
// ---------------------------------------------------------------------------
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
