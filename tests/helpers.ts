/**
 * Utilidades compartidas de las pruebas: base SQLite en memoria + un flujo
 * completo de negocio (compra → plan → elaboración de masas → terminación → venta).
 *
 * Modelo nuevo: una receta por producto; la masa se CUENTA (unidad, no kg);
 * la receta define ingredientes por masa y materiales de empaque por paquete.
 */
import { createDb, type DbHandle } from "../server/db";
import { todayISO } from "../server/domain/dates";
import { availableStock } from "../server/domain/fifo";
import { supplierInput, createSupplier } from "../server/services/suppliers";
import { materialInput, createMaterial } from "../server/services/materials";
import { massInput, createMass } from "../server/services/masses";
import { recipeCreateInput, createRecipe } from "../server/services/recipes";
import { productInput, createProduct } from "../server/services/products";
import { purchaseInput, createPurchase } from "../server/services/purchases";
import { productionInput, confirmProduction } from "../server/services/productions";
import { transformationInput, confirmTransformation } from "../server/services/transformations";
import { saleInput, confirmSale } from "../server/services/sales";

export interface Flow {
  h: DbHandle;
  today: string;
  supplierId: number;
  harinaId: number;
  bolsaId: number;
  masaId: number;
  productId: number;
  recipeId: number;
  recipeVersionId: number;
}

export function newDb(): DbHandle {
  return createDb(":memory:");
}

/**
 * Desplaza una fecha ISO ±N días usando la zona local del sistema.
 * Evita el desfase de `toISOString()` (UTC) alrededor de la medianoche.
 */
export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface SetupOptions {
  /** Paquetes esperados por masa (por defecto 10). */
  yieldPerMass?: string;
}

/**
 * Monta el escenario base: proveedor, harina (MP), bolsa (empaque), masa
 * contada en unidades, producto terminado, UNA receta por producto con
 * ingredientes por masa y empaque por paquete, y una compra de
 * 500 kg de harina a $0.50 + 5000 bolsas a $0.05.
 */
export function setupFlow(opts: SetupOptions = {}): Flow {
  const h = newDb();
  const today = todayISO();

  const supplier = createSupplier(h.db, supplierInput.parse({ name: "Proveedor Test" }));
  const harina = createMaterial(
    h.db,
    materialInput.parse({ name: "Harina", unitId: "kg", category: "Secos", minStock: "10" }),
  );
  const bolsa = createMaterial(
    h.db,
    materialInput.parse({ name: "Bolsa", unitId: "unidad", category: "Empaques" }),
  );
  const masa = createMass(h.db, massInput.parse({ name: "Masa", unitId: "unidad", minStock: "5" }));
  const product = createProduct(
    h.db,
    productInput.parse({
      name: "Producto Test",
      saleUnitId: "unidad",
      price: "0.60",
      minStock: "5",
    }),
  );
  const recipe = createRecipe(
    h.db,
    h.units,
    recipeCreateInput.parse({
      name: "Receta Producto Test",
      productId: product.id,
      version: {
        massId: masa.id,
        expectedYield: opts.yieldPerMass ?? "10",
        yieldUnitId: "unidad",
        validFrom: today,
        items: [
          { rawMaterialId: harina.id, unitId: "kg", qty: "6", phase: "masa" },
          { rawMaterialId: bolsa.id, unitId: "unidad", qty: "1", phase: "paquete" },
        ],
      },
    }),
  );
  createPurchase(
    h.db,
    h.units,
    purchaseInput.parse({
      supplierId: supplier.id,
      purchaseDate: today,
      items: [
        { rawMaterialId: harina.id, unitId: "kg", qty: "500", unitPrice: "0.50" },
        { rawMaterialId: bolsa.id, unitId: "unidad", qty: "5000", unitPrice: "0.05" },
      ],
    }),
  );

  return {
    h,
    today,
    supplierId: supplier.id,
    harinaId: harina.id,
    bolsaId: bolsa.id,
    masaId: masa.id,
    productId: product.id,
    recipeId: recipe.id,
    recipeVersionId: recipe.versionId,
  };
}

/**
 * Elaboración estándar de N masas completas:
 * consume 6×N kg de harina ($3 de costo por masa) y crea N masas.
 */
export function produce(flow: Flow, massesCount = "1") {
  return confirmProduction(
    flow.h.db,
    flow.h.units,
    productionInput.parse({
      productionDate: flow.today,
      recipeVersionId: flow.recipeVersionId,
      massesCount,
    }),
  );
}

/**
 * Terminación estándar: consume masas y registra paquetes reales de PT01.
 * Consumo de empaque = 1 bolsa × paquetes reales obtenidos.
 */
export function transform(
  flow: Flow,
  massQty = "1",
  outputs: Array<{ productId: number; qty: string }> | null = null,
) {
  return confirmTransformation(
    flow.h.db,
    flow.h.units,
    transformationInput.parse({
      transformDate: flow.today,
      massId: flow.masaId,
      massQty,
      outputs: outputs ?? [{ productId: flow.productId, qty: "10" }],
    }),
  );
}

/** Venta estándar del día en curso. */
export function sell(flow: Flow, items: Array<{ productId: number; qty: string; unitPrice: string }>) {
  return confirmSale(
    flow.h.db,
    saleInput.parse({
      saleDate: flow.today,
      paymentMethod: "efectivo",
      items,
    }),
  );
}

export function rawStock(flow: Flow): number {
  return availableStock(flow.h.db, "raw", flow.harinaId);
}

export function bolsaStock(flow: Flow): number {
  return availableStock(flow.h.db, "raw", flow.bolsaId);
}

export function massStock(flow: Flow): number {
  return availableStock(flow.h.db, "mass", flow.masaId);
}

export function productStock(flow: Flow): number {
  return availableStock(flow.h.db, "product", flow.productId);
}
