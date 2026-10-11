/**
 * Seed de datos de ejemplo �?" claramente identificado como DEMO.
 * Uso: npm run seed:demo
 * Requiere un día no cerrado. Idempotente: no se re-ejecuta si ya hay DEMO.
 *
 * Modelo nuevo: UNA receta por producto; la masa se cuenta en unidades;
 * ingredientes por masa + empaques por paquete; planificación inversa.
 */
import { createDb } from "../server/db";
import { lastClosedDate, todayISO } from "../server/domain/dates";
import { supplierInput, createSupplier } from "../server/services/suppliers";
import { materialInput, createMaterial } from "../server/services/materials";
import { massInput, createMass } from "../server/services/masses";
import { recipeCreateInput, createRecipe } from "../server/services/recipes";
import { productInput, createProduct } from "../server/services/products";
import { purchaseInput, createPurchase } from "../server/services/purchases";
import { planInput, createPlan } from "../server/services/planning";
import { productionInput, confirmProduction } from "../server/services/productions";
import { transformationInput, confirmTransformation } from "../server/services/transformations";
import { saleInput, confirmSale } from "../server/services/sales";
import { expenseInput, createExpense } from "../server/services/expenses";
import { getSettings, setDemoFlag, updateSettings } from "../server/services/settings";

function main(): void {
  const handle = createDb();
  const { db, units } = handle;

  if (getSettings(db).demoMode) {
    console.log("[demo] Los datos DEMO ya están cargados. Nada que hacer.");
    return;
  }
  const closed = lastClosedDate(db);
  const today = todayISO();
  if (closed && closed >= today) {
    console.error(`[demo] El día ${today} está cerrado. Reábralo antes de cargar el DEMO.`);
    process.exit(1);
  }

  const sup = createSupplier(db, supplierInput.parse({ name: "Distribuidora Demo", phone: "5555-0001", address: "Habana" }));
  const harina = createMaterial(db, materialInput.parse({ name: "Harina de trigo", unitId: "kg", category: "Secos", minStock: "10" }));
  const picadillo = createMaterial(db, materialInput.parse({ name: "Picadillo de cerdo", unitId: "kg", category: "Carne", minStock: "5" }));
  const empaque = createMaterial(db, materialInput.parse({ name: "Empaque de cartón", unitId: "paquete", category: "Empaques", minStock: "20" }));

  // La masa se CUENTA en unidades completas (dimensión conteo), no se pesa.
  const masa = createMass(db, massInput.parse({ name: "Masa de empanada", unitId: "unidad", minStock: "5" }));

  const productoStd = createProduct(db, productInput.parse({
    name: "Empanada estándar", category: "Empanadas",
    presentation: "caja x 12", saleUnitId: "paquete", unitsPerPackage: 12, price: "5.00", minStock: "10",
  }));
  const productoGde = createProduct(db, productInput.parse({
    name: "Empanada grande", category: "Empanadas",
    presentation: "caja x 6", saleUnitId: "paquete", unitsPerPackage: 6, price: "8.00", minStock: "5",
  }));

  // UNA receta por producto: rendimiento en paquetes (unidad de venta).
  const recipe = createRecipe(db, units, recipeCreateInput.parse({
    name: "Empanada estándar",
    description: "Receta de masa + empaque por paquete",
    productId: productoStd.id,
    version: {
      massId: masa.id,
      expectedYield: "10",
      yieldUnitId: "paquete",
      validFrom: today,
      instructions: "Amasar, reposar 30 min, armar y empacar de a 12.",
      items: [
        { rawMaterialId: harina.id, unitId: "kg", qty: "6", phase: "masa" },
        { rawMaterialId: picadillo.id, unitId: "kg", qty: "3", phase: "masa" },
        { rawMaterialId: empaque.id, unitId: "paquete", qty: "1", phase: "paquete" },
      ],
    },
  }));

  // Segunda receta (producto grande) para demostrar la regla 1 receta = 1 producto.
  const recipeGde = createRecipe(db, units, recipeCreateInput.parse({
    name: "Empanada grande",
    description: "Receta grande: 6 paquetes por masa",
    productId: productoGde.id,
    version: {
      massId: masa.id,
      expectedYield: "6",
      yieldUnitId: "paquete",
      validFrom: today,
      items: [
        { rawMaterialId: harina.id, unitId: "kg", qty: "6", phase: "masa" },
        { rawMaterialId: picadillo.id, unitId: "kg", qty: "3", phase: "masa" },
        { rawMaterialId: empaque.id, unitId: "paquete", qty: "1", phase: "paquete" },
      ],
    },
  }));

  const compra = createPurchase(db, units, purchaseInput.parse({
    supplierId: sup.id,
    purchaseDate: today,
    docNumber: "DEMO-001",
    items: [
      { rawMaterialId: harina.id, unitId: "kg", qty: "50", unitPrice: "1.50" },
      { rawMaterialId: picadillo.id, unitId: "kg", qty: "30", unitPrice: "4.50" },
      { rawMaterialId: empaque.id, unitId: "paquete", qty: "200", unitPrice: "2.00" },
    ],
  }));

  // Planificación inversa: 20 paquetes �?' 2 masas (techo de 20/10).
  const plan = createPlan(db, units, planInput.parse({
    planDate: today,
    recipeVersionId: recipe.versionId,
    targetPackages: "20",
    notes: "DEMO: plan para 20 paquetes",
  }));

  const produccion = confirmProduction(db, units, productionInput.parse({
    productionDate: today,
    recipeVersionId: recipe.versionId,
    massesCount: "2",
    planId: plan.id,
    responsible: "DEMO",
    notes: "DEMO: hornada vinculada al plan",
  }));

  // Terminación con paquetes REALES: 18 de 20 esperados �?' desviación �^'2.
  const transformacion = confirmTransformation(db, units, transformationInput.parse({
    transformDate: today,
    massId: masa.id,
    massQty: "2",
    outputs: [{ productId: productoStd.id, qty: "18" }],
    recipeVersionId: recipe.versionId,
    planId: plan.id,
    notes: "DEMO: merma real de armado",
  }));

  const venta = confirmSale(db, saleInput.parse({
    saleDate: today,
    paymentMethod: "efectivo",
    items: [{ productId: productoStd.id, qty: "10", unitPrice: "5.00" }],
  }));

  createExpense(db, expenseInput.parse({
    expenseDate: today,
    category: "Transporte",
    description: "DEMO: entrega de insumos",
    amount: "1.50",
    paymentMethod: "efectivo",
    responsible: "demo",
  }));

  setDemoFlag(db, true);
  updateSettings(db, { businessName: "NY SYSTEM (DEMO)" });

  console.log("[demo] Datos DEMO cargados con éxito:");
  console.log(`  proveedor #${sup.id}, materiales: Harina de trigo / Picadillo de cerdo / Empaque de cartón`);
  console.log(`  masa "${masa.name}" (unidad), productos "${productoStd.name}" y "${productoGde.name}"`);
  console.log(`  recetas "${recipe.name}" v1 y "${recipeGde.name}" v1`);
  console.log(`  compra #${compra.number}, plan #${plan.number} (20 paq �?' 2 masas)`);
  console.log(`  producción #${produccion.number}, terminación #${transformacion.number} (18/20 paq, desviación �^'2)`);
  console.log(`  venta #${venta.number} + gasto de ejemplo`);
  console.log(`  Fecha: ${today}. El día queda ABIERTO para que pruebe el cierre.`);
}

main();
