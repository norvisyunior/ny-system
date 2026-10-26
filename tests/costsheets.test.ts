/**
 * Pruebas de la Fase 1 — Fichas de costo (simulación tipo hoja de cálculo).
 * Cubre los casos A–I del requisito. No toca datos reales (SQLite en memoria).
 */
import { describe, it, expect } from "vitest";
import { newDb } from "./helpers";
import { supplierInput, createSupplier } from "../server/services/suppliers";
import { materialInput, createMaterial } from "../server/services/materials";
import { massInput, createMass } from "../server/services/masses";
import { recipeCreateInput, createRecipe } from "../server/services/recipes";
import { productInput, createProduct } from "../server/services/products";
import { purchaseInput, createPurchase } from "../server/services/purchases";
import {
  costSheetInput,
  previewCostSheet,
  getCostSheet,
} from "../server/services/costsheets";
import { laborRateInput, setLaborRate, listLaborRates } from "../server/services/laborrates";
import { availableStock } from "../server/domain/fifo";

/**
 * Escenario grande (CUP reales):
 * - Harina: 300 kg @ 80 CUP/kg (compra confirmada).
 * - Azúcar: 100 kg @ 20 CUP/kg; Aceite: 50 l @ 90 CUP/l (para sustituciones).
 * - Sazón: sin compras (sin precio).
 * - Bolsa: 5.000 @ 2 CUP/unidad (empaque).
 * - Masa "Masa Grande" (unidad); producto "Empanada" (venta 'paquete', 4 u/paq, precio 400).
 * - Receta v1: harina 3 kg por masa; bolsa 2 unidades por paquete.
 * - Tarifa de elaboración 1.150 CUP/masa; terminación 2 CUP/unidad individual.
 */
function setupSpec() {
  const h = newDb();
  const supplier = createSupplier(h.db, supplierInput.parse({ name: "Distribuidor" }));
  const harina = createMaterial(
    h.db,
    materialInput.parse({ name: "Harina", unitId: "kg", category: "Secos" }),
  );
  const azucar = createMaterial(
    h.db,
    materialInput.parse({ name: "Azúcar", unitId: "kg", category: "Secos" }),
  );
  const aceite = createMaterial(
    h.db,
    materialInput.parse({ name: "Aceite", unitId: "l", category: "Líquidos" }),
  );
  const sazon = createMaterial(
    h.db,
    materialInput.parse({ name: "Sazón", unitId: "kg", category: "Otros" }),
  );
  const bolsa = createMaterial(
    h.db,
    materialInput.parse({ name: "Bolsa", unitId: "unidad", category: "Empaques" }),
  );
  const masa = createMass(h.db, massInput.parse({ name: "Masa Grande", unitId: "unidad" }));
  const product = createProduct(
    h.db,
    productInput.parse({
      name: "Empanada",
      saleUnitId: "paquete",
      unitsPerPackage: 4,
      price: "400",
      minStock: "5",
    }),
  );
  const recipe = createRecipe(
    h.db,
    h.units,
    recipeCreateInput.parse({
      name: "Receta Empanada",
      productId: product.id,
      version: {
        massId: masa.id,
        expectedYield: "20",
        yieldUnitId: "paquete",
        validFrom: "2026-01-01",
        items: [
          { rawMaterialId: harina.id, unitId: "kg", qty: "3", phase: "masa" },
          { rawMaterialId: bolsa.id, unitId: "unidad", qty: "2", phase: "paquete" },
        ],
      },
    }),
  );
  createPurchase(
    h.db,
    h.units,
    purchaseInput.parse({
      supplierId: supplier.id,
      purchaseDate: "2026-01-01",
      items: [
        { rawMaterialId: harina.id, unitId: "kg", qty: "300", unitPrice: "80" },
        { rawMaterialId: azucar.id, unitId: "kg", qty: "100", unitPrice: "20" },
        { rawMaterialId: aceite.id, unitId: "l", qty: "50", unitPrice: "90" },
        { rawMaterialId: bolsa.id, unitId: "unidad", qty: "5000", unitPrice: "2" },
      ],
    }),
  );
  return {
    h,
    masaId: masa.id,
    productId: product.id,
    versionId: recipe.versionId,
    harinaId: harina.id,
    azucarId: azucar.id,
    aceiteId: aceite.id,
    sazonId: sazon.id,
    bolsaId: bolsa.id,
    itemHarinaId: 0,
  };
}

function detailId(h: ReturnType<typeof setupSpec>): number {
  const sheet = getCostSheet(h.h.db, h.h.units, h.versionId);
  return sheet.ingredients[0].recipeItemId;
}

/**
 * Escenario de economía (pruebas E/F):
 * - Harina X: 100 kg @ 1.200 CUP/kg.
 * - Producto: 4 u/paq, 20 paquetes/masa.
 * - Receta: 5 kg de harina por masa; sin empaques.
 * - 4 masas → 100 paquetes; ingrediente 24.000 + elaboración 4.000 = 28.000 CUP.
 */
function setupEconomy() {
  const h = newDb();
  const supplier = createSupplier(h.db, supplierInput.parse({ name: "D1" }));
  const harina = createMaterial(h.db, materialInput.parse({ name: "Harina X", unitId: "kg" }));
  const masa = createMass(h.db, massInput.parse({ name: "Masa X", unitId: "unidad" }));
  const product = createProduct(
    h.db,
    productInput.parse({ name: "Producto X", saleUnitId: "paquete", unitsPerPackage: 4, price: "400" }),
  );
  const recipe = createRecipe(
    h.db,
    h.units,
    recipeCreateInput.parse({
      name: "Receta X",
      productId: product.id,
      version: {
        massId: masa.id,
        expectedYield: "20",
        yieldUnitId: "paquete",
        validFrom: "2026-01-01",
        items: [{ rawMaterialId: harina.id, unitId: "kg", qty: "5", phase: "masa" }],
      },
    }),
  );
  createPurchase(
    h.db,
    h.units,
    purchaseInput.parse({
      supplierId: supplier.id,
      purchaseDate: "2026-01-01",
      items: [{ rawMaterialId: harina.id, unitId: "kg", qty: "100", unitPrice: "1200" }],
    }),
  );
  setLaborRate(
    h.db,
    laborRateInput.parse({ kind: "masa", massId: masa.id, rate: "1000" }),
  );
  return { h, versionId: recipe.versionId, masaId: masa.id, productId: product.id, harinaId: harina.id };
}

describe("Fichas de costo — ingredientes", () => {
  it("Prueba A/B: 4 masas × 3 kg = 12 kg a 80 CUP/kg = 960 CUP", () => {
    const h = setupSpec();
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({ recipeVersionId: h.versionId, masses: "4" }),
    );
    const line = sheet.ingredients[0];
    // cantidad total en kilogramos
    expect(line.totalItemUnitMicro).toBe(12_000_000);
    expect(line.totalBaseMicro).toBe(12_000_000);
    // subtotal por kg
    const kg = sheet.qtyTotals.find((t) => t.unitId === "kg");
    expect(kg?.qtyMicro).toBe(12_000_000);
    // costo: 12 kg × 80 CUP = 960 CUP
    expect(line.priceBasis).toBe("promedio");
    expect(line.pricePerBaseMicro).toBe(80_000_000);
    expect(line.costMicro).toBe(960_000_000);
    expect(sheet.costs.ingredientsMicro).toBe(960_000_000);
  });
});

describe("Fichas de costo — mano de obra", () => {
  it("Prueba C: 4 masas × 1.150 CUP/masa = 4.600 CUP", () => {
    const h = setupSpec();
    setLaborRate(h.h.db, laborRateInput.parse({ kind: "masa", massId: h.masaId, rate: "1150" }));
    setLaborRate(
      h.h.db,
      laborRateInput.parse({ kind: "terminacion", productId: h.productId, rate: "2" }),
    );
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({ recipeVersionId: h.versionId, masses: "4" }),
    );
    expect(sheet.laborElab.rateBasis).toBe("configurada");
    expect(sheet.laborElab.costMicro).toBe(4_600_000_000); // 4.600 CUP
    expect(sheet.costs.laborElabMicro).toBe(4_600_000_000);
  });

  it("Prueba D: 380 paquetes × 4 u/paq × 2 CUP/u = 3.040 CUP", () => {
    const h = setupSpec();
    setLaborRate(h.h.db, laborRateInput.parse({ kind: "masa", massId: h.masaId, rate: "1150" }));
    setLaborRate(
      h.h.db,
      laborRateInput.parse({ kind: "terminacion", productId: h.productId, rate: "2" }),
    );
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({ recipeVersionId: h.versionId, masses: "4", packages: "380" }),
    );
    expect(sheet.laborTerm.unitsTotalMicro).toBe(1_520_000_000); // 1.520 unidades
    expect(sheet.laborTerm.costMicro).toBe(3_040_000_000); // 3.040 CUP
    expect(sheet.sim.unitsTotalMicro).toBe(1_520_000_000);
  });

  it("Prueba I (tarifas): sin tarifa configurada avisa y no sustituye por 0 silencio", () => {
    const h = setupSpec();
    const sheet = getCostSheet(h.h.db, h.h.units, h.versionId);
    expect(sheet.laborElab.rateBasis).toBe("sin_configurar");
    expect(sheet.laborElab.rateMicro).toBeNull();
    expect(sheet.laborTerm.rateBasis).toBe("sin_configurar");
    expect(sheet.warnings.some((w) => w.includes("tarifa de elaboración"))).toBe(true);
    expect(
      sheet.warnings.some((w) => w.includes("tarifa de terminación")),
    ).toBe(true);
  });

  it("Precio unitario manual por ítem: reemplaza promedio/último con basis 'manual'", () => {
    const h = setupSpec();
    const itemId = detailId(h);
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({
        recipeVersionId: h.versionId,
        masses: "4",
        items: [{ id: itemId, unitPrice: "100" }],
      }),
    );
    const [first] = sheet.ingredients;
    expect(first.priceBasis).toBe("manual");
    expect(first.pricePerBaseMicro).toBe(100_000_000);
    expect(first.priceUnitId).toBeNull();
    expect(first.priceDate).toBeNull();
    expect(first.priceSupplier).toBeNull();
    expect(first.costMicro).toBe((100 * 12) * 1_000_000); // 100 CUP/kg × 12 kg
    expect(sheet.hasMissingPrice).toBe(false);
  });

  it("Tarifa hipotética en la simulación (basis 'simulada')", () => {
    const h = setupSpec();
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({ recipeVersionId: h.versionId, masses: "4", elabRate: "500" }),
    );
    expect(sheet.laborElab.rateBasis).toBe("simulada");
    expect(sheet.laborElab.costMicro).toBe(2_000_000_000); // 2.000 CUP
  });
});

describe("Fichas de costo — empaques", () => {
  it("Empaques por paquete: 80 paquetes × 2 bolsas × 2 CUP = 320 CUP", () => {
    const h = setupSpec();
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({ recipeVersionId: h.versionId, masses: "4" }),
    );
    expect(sheet.packaging).toHaveLength(1);
    expect(sheet.packaging[0].totalItemUnitMicro).toBe(160_000_000); // 160 bolsas
    expect(sheet.costs.packagingMicro).toBe(320_000_000); // 320 CUP
  });
});

describe("Fichas de costo — totales y economía", () => {
  it("Prueba E: total 28.000 CUP ÷ 100 paquetes = 280 CUP por paquete", () => {
    const h = setupEconomy();
    setLaborRate(h.h.db, laborRateInput.parse({ kind: "masa", massId: h.masaId, rate: "1000" }));
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({
        recipeVersionId: h.versionId,
        masses: "4",
        packages: "100",
      }),
    );
    // 4 masas × 5 kg × 1.200 = 24.000; + elaboración 4.000 = 28.000 (sin empaques/terminación)
    expect(sheet.costs.totalMicro).toBe(28_000_000_000);
    expect(sheet.costPerPackageMicro).toBe(280_000_000); // 280 CUP
  });

  it("Prueba F: margen objetivo 30 % con costo 280 → precio recomendado 400; venta 400 → margen 30 %", () => {
    const h = setupEconomy();
    setLaborRate(h.h.db, laborRateInput.parse({ kind: "masa", massId: h.masaId, rate: "1000" }));
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({
        recipeVersionId: h.versionId,
        masses: "4",
        packages: "100",
        salePrice: "400",
        marginTargetPct: "30",
      }),
    );
    expect(sheet.economics.grossProfitMicro).toBe(120_000_000); // 120 CUP
    expect(sheet.economics.marginPctMicro).toBe(30_000_000); // 30 %
    expect(sheet.economics.recommendedPriceMicro).toBe(400_000_000); // 400 CUP
  });

  it("Paquetes = 0: sin costo por paquete y con aviso", () => {
    const h = setupEconomy();
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({ recipeVersionId: h.versionId, masses: "4", packages: "0" }),
    );
    expect(sheet.costPerPackageMicro).toBeNull();
    expect(sheet.warnings.some((w) => w.includes("paquete"))).toBe(true);
  });

  it("Margen objetivo ≥ 100 % se rechaza en la validación de entrada", () => {
    const h = setupEconomy();
    expect(() =>
      costSheetInput.parse({ recipeVersionId: h.versionId, marginTargetPct: "100" }),
    ).toThrow();
  });
});

describe("Fichas de costo — datos intactos (Pruebas G/H/I)", () => {
  it("Prueba G: la simulación no modifica inventario, recetas ni precios", () => {
    const h = setupSpec();
    const itemId = detailId(h);
    const db = h.h.db;
    const client = h.h.client;
    const stockHarina = availableStock(db, "raw", h.harinaId);
    const stockBolsa = availableStock(db, "raw", h.bolsaId);
    const movBefore = client.prepare("SELECT COUNT(*) c FROM inventory_movements").get() as {
      c: number;
    };
    const itemsBefore = client.prepare("SELECT id, qty_micro FROM recipe_items ORDER BY id").all();
    const lotsBefore = client.prepare("SELECT COUNT(*) c FROM stock_lots").get() as { c: number };
    const lotsValBefore = client
      .prepare("SELECT COALESCE(SUM(unit_cost_micro), 0) v FROM stock_lots")
      .get() as { v: number };
    const productBefore = client
      .prepare("SELECT price_micro FROM finished_products WHERE id = ?")
      .get(h.productId) as { price_micro: number };

    // varias simulaciones agresivas
    previewCostSheet(
      db,
      h.h.units,
      costSheetInput.parse({
        recipeVersionId: h.versionId,
        masses: "50",
        packages: "999",
        elabRate: "99999",
        termRate: "999",
        salePrice: "999",
        marginTargetPct: "90",
        items: [{ id: itemId, qty: "25", materialId: h.azucarId }],
      }),
    );
    previewCostSheet(
      db,
      h.h.units,
      costSheetInput.parse({ recipeVersionId: h.versionId, masses: "1.5", packages: "0.25" }),
    );

    const movAfter = client.prepare("SELECT COUNT(*) c FROM inventory_movements").get() as {
      c: number;
    };
    const itemsAfter = client.prepare("SELECT id, qty_micro FROM recipe_items ORDER BY id").all();
    const lotsAfter = client.prepare("SELECT COUNT(*) c FROM stock_lots").get() as { c: number };
    const lotsValAfter = client
      .prepare("SELECT COALESCE(SUM(unit_cost_micro), 0) v FROM stock_lots")
      .get() as { v: number };
    const productAfter = client
      .prepare("SELECT price_micro FROM finished_products WHERE id = ?")
      .get(h.productId) as { price_micro: number };

    expect(availableStock(db, "raw", h.harinaId)).toBe(stockHarina);
    expect(availableStock(db, "raw", h.bolsaId)).toBe(stockBolsa);
    expect(movAfter.c).toBe(movBefore.c);
    expect(itemsAfter).toEqual(itemsBefore);
    expect(lotsAfter.c).toBe(lotsBefore.c);
    expect(lotsValAfter.v).toBe(lotsValBefore.v);
    expect(productAfter.price_micro).toBe(productBefore.price_micro);
  });

  it("Prueba H: sustitución actualiza costos y no toca la receta original", () => {
    const h = setupSpec();
    const itemId = detailId(h);

    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({
        recipeVersionId: h.versionId,
        masses: "4",
        items: [{ id: itemId, materialId: h.azucarId }],
      }),
    );
    const line = sheet.ingredients[0];
    expect(line.substituted).toBe(true);
    expect(line.name).toBe("Azúcar");
    expect(line.originalMaterialId).toBe(h.harinaId);
    expect(line.pricePerBaseMicro).toBe(20_000_000); // 20 CUP/kg
    expect(line.costMicro).toBe(240_000_000); // 12 kg × 20 = 240 CUP

    // receta intacta
    const items = h.h.client
      .prepare("SELECT raw_material_id FROM recipe_items WHERE id = ?")
      .get(itemId) as { raw_material_id: number };
    expect(items.raw_material_id).toBe(h.harinaId);
  });

  it("Prueba H incompatible: sustitución kg→l marca el problema y no factura", () => {
    const h = setupSpec();
    const itemId = detailId(h);
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({
        recipeVersionId: h.versionId,
        masses: "4",
        items: [{ id: itemId, materialId: h.aceiteId }],
      }),
    );
    const line = sheet.ingredients[0];
    expect(line.substituted).toBe(true);
    expect(line.totalItemUnitMicro).toBeGreaterThan(0);
    expect(line.costMicro).toBe(0);
    expect(line.pricePerBaseMicro).toBeNull();
    expect(line.warnings.some((w) => w.includes("Sustitución incompatible"))).toBe(true);
    expect(sheet.warnings.some((w) => w.includes("Sustitución incompatible"))).toBe(true);
  });

  it("Prueba I: material sin precio produce aviso y costo no incluido", () => {
    const h = setupSpec();
    const itemId = detailId(h);
    const sheet = previewCostSheet(
      h.h.db,
      h.h.units,
      costSheetInput.parse({
        recipeVersionId: h.versionId,
        masses: "4",
        items: [{ id: itemId, materialId: h.sazonId }],
      }),
    );
    const line = sheet.ingredients[0];
    expect(line.priceBasis).toBe("ninguno");
    expect(line.pricePerBaseMicro).toBeNull();
    expect(line.costMicro).toBe(0);
    expect(line.warnings.some((w) => w.includes("no tiene precio"))).toBe(true);
    expect(sheet.hasMissingPrice).toBe(true);
  });
});

describe("Fichas de costo — ficha base y tarifas", () => {
  it("GET base: defaults = 1 masa, paquetes = rendimiento, tarifas pre-cargadas", () => {
    const h = setupSpec();
    setLaborRate(h.h.db, laborRateInput.parse({ kind: "masa", massId: h.masaId, rate: "1150" }));
    const sheet = getCostSheet(h.h.db, h.h.units, h.versionId);
    expect(sheet.defaults.massesMicro).toBe(1_000_000);
    expect(sheet.sim.massesMicro).toBe(1_000_000);
    expect(sheet.sim.packagesMicro).toBe(20_000_000); // 1 masa × 20 paquetes
    expect(sheet.defaults.elabRateMicro).toBe(1_150_000_000);
    expect(sheet.defaults.termRateMicro).toBeNull();
    expect(sheet.laborElab.rateBasis).toBe("configurada");
  });

  it("listLaborRates devuelve las tarifas configuradas", () => {
    const h = setupSpec();
    setLaborRate(h.h.db, laborRateInput.parse({ kind: "masa", massId: h.masaId, rate: "1150" }));
    setLaborRate(
      h.h.db,
      laborRateInput.parse({ kind: "terminacion", productId: h.productId, rate: "2" }),
    );
    const rows = listLaborRates(h.h.db);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.kind === "masa" && r.rateMicro === 1_150_000_000)).toBe(true);
    expect(rows.some((r) => r.kind === "terminacion" && r.rateMicro === 2_000_000)).toBe(true);
  });
});
