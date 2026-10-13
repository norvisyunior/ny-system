/**
 * Pruebas obligatorias de la sección 13 de la spec:
 * planificación inversa, elaboración de masas completas, terminación con
 * paquetes reales, costos históricos, idempotencia y cierre de día.
 */
import { describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { inventoryMovements, productionBatches, transformations } from "../db/schema";
import { availableStock } from "../server/domain/fifo";
import { isAppError } from "../server/domain/errors";
import {
  annulPlan,
  createPlan,
  deletePlan,
  previewPlan,
  getPlanDetail,
  listPlans,
} from "../server/services/planning";
import {
  previewTransformation,
  transformationPreviewInput,
} from "../server/services/transformations";
import {
  confirmProduction,
  getProductionDetail,
  listProductions,
  productionInput,
} from "../server/services/productions";
import {
  confirmTransformation,
  getTransformationDetail,
  listTransformations,
  transformationInput,
} from "../server/services/transformations";
import {
  createRecipe,
  createRecipeVersion,
  recipeCreateInput,
  versionInput,
} from "../server/services/recipes";
import { productInput, createProduct } from "../server/services/products";
import { massInput, createMass } from "../server/services/masses";
import { createPurchase, purchaseInput } from "../server/services/purchases";
import { closeDay, reopenDay } from "../server/services/closings";
import { setupFlow, transform, productStock, massStock, rawStock, bolsaStock, produce } from "./helpers";
import type { Flow } from "./helpers";

const yesterdayISO = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function flowYield80() {
  return setupFlow({ yieldPerMass: "80" });
}

function movementsCount(flow: Flow): number {
  const row = flow.h.db.select({ n: count() }).from(inventoryMovements).get();
  return Math.trunc(row?.n ?? 0);
}

describe("§13 Planificación inversa (techo de masas)", () => {
  it("1. calcula 25 masas para 2000 paquetes con rendimiento 80 (2000/80 exacto)", () => {
    const flow = flowYield80();
    const preview = previewPlan(flow.h.db, flow.h.units, {
      recipeVersionId: flow.recipeVersionId,
      targetPackages: 2_000_000_000,
    });
    expect(preview.plannedMassesMicro).toBe(25_000_000);
    expect(preview.expectedYieldMicro).toBe(80_000_000);
    expect(preview.ingredients.length).toBeGreaterThan(0);
    expect(preview.packaging.length).toBeGreaterThan(0);
  });

  it("2. redondea hacia arriba: 2001 paquetes requieren 26 masas", () => {
    const flow = flowYield80();
    const preview = previewPlan(flow.h.db, flow.h.units, {
      recipeVersionId: flow.recipeVersionId,
      targetPackages: 2_001_000_000,
    });
    expect(preview.plannedMassesMicro).toBe(26_000_000);
  });

  it("3. el plan solo calcula: no descuenta inventario ni registra movimientos", () => {
    const flow = flowYield80();
    const before = {
      harina: rawStock(flow),
      bolsa: bolsaStock(flow),
      masa: massStock(flow),
      producto: productStock(flow),
      movements: movementsCount(flow),
    };

    const plan = createPlan(flow.h.db, flow.h.units, {
      planDate: flow.today,
      recipeVersionId: flow.recipeVersionId,
      targetPackages: 2_000_000_000,
      notes: "Plan de prueba",
      clientToken: "plan-token-0001",
    });
    expect(plan.status).toBe("planificada");
    expect(plan.plannedMassesMicro).toBe(25_000_000);

    expect(rawStock(flow)).toBe(before.harina);
    expect(bolsaStock(flow)).toBe(before.bolsa);
    expect(massStock(flow)).toBe(before.masa);
    expect(productStock(flow)).toBe(before.producto);
    expect(movementsCount(flow)).toBe(before.movements);
    expect(listProductions(flow.h.db)).toHaveLength(0);

    // El detalle conserva el snapshot del preview (nada que recalcular en stock).
    const detail = getPlanDetail(flow.h.db, plan.id);
    expect(detail.preview).not.toBeNull();
    expect(detail.preview?.plannedMassesMicro).toBe(25_000_000);
    expect(listPlans(flow.h.db)).toHaveLength(1);
  });
});

describe("§13 Elaboración de masas (solo enteras)", () => {
  it("4. descuenta los ingredientes de fase masa, crea el lote y rechaza masas fraccionadas", () => {
    const flow = setupFlow();
    const before = rawStock(flow);

    const batch = produce(flow, "2");
    expect(batch.totalCostMicro).toBe(6_000_000);
    expect(batch.realYieldMicro).toBe(2_000_000);
    expect(rawStock(flow)).toBe(before - 12_000_000); // 2 masas × 6 kg
    expect(massStock(flow)).toBe(2_000_000);
    // Los materiales de fase paquete NO se tocan en la elaboración.
    expect(bolsaStock(flow)).toBe(5_000_000_000);

    let error: unknown;
    try {
      confirmProduction(
        flow.h.db,
        flow.h.units,
        productionInput.parse({
          productionDate: flow.today,
          recipeVersionId: flow.recipeVersionId,
          massesCount: "0.5",
        }),
      );
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.message).toContain("entero");
    }
    expect(massStock(flow)).toBe(2_000_000);
  });

  it("5. produce ayer y termina hoy: las masas se elaboran un día y se usan otro", () => {
    const flow = setupFlow();
    const yesterday = yesterdayISO();

    const batch = confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: yesterday,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "1",
        responsible: "Operario A",
      }),
    );
    expect(batch.duplicated).toBe(false);
    const batchDetail = getProductionDetail(flow.h.db, batch.id);
    expect(batchDetail.productionDate).toBe(yesterday);

    const tf = transform(flow, "1"); // fecha de hoy
    expect(tf.totalCostMicro).toBe(3_500_000);
    expect(massStock(flow)).toBe(0);
    expect(productStock(flow)).toBe(10_000_000);

    const tfDetail = getTransformationDetail(flow.h.db, tf.id);
    expect(tfDetail.transformDate).toBe(flow.today);
  });
});

describe("§13 Terminación con paquetes reales", () => {
  it("6. 25 masas → 1900 paquetes exactos: costo total repartido sin residuos", () => {
    const flow = flowYield80();
    produce(flow, "25");
    expect(massStock(flow)).toBe(25_000_000);
    expect(rawStock(flow)).toBe(350_000_000); // 500 − 25×6

    const tf = transform(flow, "25", [{ productId: flow.productId, qty: "1900" }]);
    // 25 masas × 3 CUP + 1900 bolsas × 0.05 = 75 + 95 = 170 CUP
    expect(tf.totalCostMicro).toBe(170_000_000);
    expect(productStock(flow)).toBe(1_900_000_000);
    expect(massStock(flow)).toBe(0);

    const detail = getTransformationDetail(flow.h.db, tf.id);
    expect(detail.outputs).toHaveLength(1);
    expect(detail.outputs[0].qtyMicro).toBe(1_900_000_000);
    expect(detail.outputs[0].costAllocatedMicro).toBe(170_000_000);
    expect(detail.massQtyMicro).toBe(25_000_000);
  });

  it("7. registra desviación de −100 paquetes sin alterar el rendimiento esperado", () => {
    const flow = flowYield80();
    produce(flow, "25");
    const tf = transform(flow, "25", [{ productId: flow.productId, qty: "1900" }]);

    expect(tf.expectedPackagesMicro).toBe(2_000_000_000);
    expect(tf.deviationMicro).toBe(-100_000_000);

    const row = listTransformations(flow.h.db)[0];
    expect(row.expectedPackagesMicro).toBe(2_000_000_000);
    expect(row.deviationMicro).toBe(-100_000_000);
    expect(row.realPackagesMicro).toBe(1_900_000_000);

    // El rendimiento de la receta sigue intacto: planificar 2000 sigue dando 25 masas.
    const preview = previewPlan(flow.h.db, flow.h.units, {
      recipeVersionId: flow.recipeVersionId,
      targetPackages: 2_000_000_000,
    });
    expect(preview.expectedYieldMicro).toBe(80_000_000);
    expect(preview.plannedMassesMicro).toBe(25_000_000);
  });

  it("8. consume empaques por los paquetes REALES, no por los esperados", () => {
    const flow = flowYield80();
    produce(flow, "25");
    expect(bolsaStock(flow)).toBe(5_000_000_000);

    transform(flow, "25", [{ productId: flow.productId, qty: "1900" }]);

    // 1900 bolsas reales (esperados serían 2000).
    expect(bolsaStock(flow)).toBe(3_100_000_000);
    const detail = getTransformationDetail(flow.h.db, listTransformations(flow.h.db)[0].id);
    expect(detail.materials).toHaveLength(1);
    expect(detail.materials[0].qtyMicro).toBe(1_900_000_000);
  });
});

describe("§13 Costos históricos", () => {
  it("9. cambiar de versión de receta o de precio no altera el histórico", () => {
    const flow = setupFlow();
    const batch1 = produce(flow, "1");
    const tf1 = transform(flow);
    expect(batch1.totalCostMicro).toBe(3_000_000);
    expect(tf1.totalCostMicro).toBe(3_500_000);

    // Precio nuevo: lote de harina a 2.00 CUP/kg (entra por PEPS después del viejo).
    createPurchase(
      flow.h.db,
      flow.h.units,
      purchaseInput.parse({
        supplierId: flow.supplierId,
        purchaseDate: flow.today,
        items: [{ rawMaterialId: flow.harinaId, unitId: "kg", qty: "500", unitPrice: "2.00" }],
      }),
    );

    // 84 masas × 6 kg = 504 kg → 494 kg a 0.50 (247) + 10 kg a 2.00 (20) = 267 CUP.
    const batch2 = produce(flow, "84");
    expect(batch2.totalCostMicro).toBe(267_000_000);

    // Nueva versión de receta con otros ingredientes.
    const v2 = createRecipeVersion(flow.h.db, flow.h.units, flow.recipeId, versionInput.parse({
      massId: flow.masaId,
      expectedYield: "10",
      yieldUnitId: "unidad",
      validFrom: flow.today,
      items: [
        { rawMaterialId: flow.harinaId, unitId: "kg", qty: "12", phase: "masa" },
        { rawMaterialId: flow.bolsaId, unitId: "unidad", qty: "1", phase: "paquete" },
      ],
    }));

    // El histórico queda intacto.
    const b1 = getProductionDetail(flow.h.db, batch1.id);
    expect(b1.totalCostMicro).toBe(3_000_000);
    const t1 = getTransformationDetail(flow.h.db, tf1.id);
    expect(t1.totalCostMicro).toBe(3_500_000);
    const b2 = getProductionDetail(flow.h.db, batch2.id);
    expect(b2.totalCostMicro).toBe(267_000_000);

    // La nueva versión produce a su nuevo costo (12 kg × 2.00 = 24 CUP).
    const batch3 = confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: v2.versionId,
        massesCount: "1",
      }),
    );
    expect(batch3.totalCostMicro).toBe(24_000_000);
  });
});

describe("§13 Integridad transaccional e idempotencia", () => {
  it("10. stock insuficiente en terminación revierte todo (sin estado parcial)", () => {
    const flow = setupFlow();
    produce(flow, "1");
    const before = {
      masa: massStock(flow),
      bolsa: bolsaStock(flow),
      producto: productStock(flow),
      movements: movementsCount(flow),
    };

    let error: unknown;
    try {
      confirmTransformation(
        flow.h.db,
        flow.h.units,
        transformationInput.parse({
          transformDate: flow.today,
          massId: flow.masaId,
          massQty: "1",
          outputs: [{ productId: flow.productId, qty: "10000" }],
        }),
      );
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe("INSUFFICIENT_STOCK");
      expect(error.message).toContain("insuficiente");
    }
    // Nada quedó a medias: la masa no se consumió, no hay PT y no hubo movimientos.
    expect(massStock(flow)).toBe(before.masa);
    expect(bolsaStock(flow)).toBe(before.bolsa);
    expect(productStock(flow)).toBe(before.producto);
    expect(movementsCount(flow)).toBe(before.movements);
    expect(listTransformations(flow.h.db)).toHaveLength(0);
  });

  it("11. el clientToken evita duplicar producción y terminación ante doble envío", () => {
    const flow = setupFlow();
    const before = { harina: rawStock(flow), movements: movementsCount(flow) };

    const input = productionInput.parse({
      productionDate: flow.today,
      recipeVersionId: flow.recipeVersionId,
      massesCount: "1",
      clientToken: "prod-token-doble-0001",
      responsible: "Operario A",
    });
    const first = confirmProduction(flow.h.db, flow.h.units, input);
    const second = confirmProduction(flow.h.db, flow.h.units, input);
    expect(first.duplicated).toBe(false);
    expect(second.duplicated).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.totalCostMicro).toBe(first.totalCostMicro);
    expect(listProductions(flow.h.db)).toHaveLength(1);
    expect(rawStock(flow)).toBe(before.harina - 6_000_000);

    const tInput = transformationInput.parse({
      transformDate: flow.today,
      massId: flow.masaId,
      massQty: "1",
      outputs: [{ productId: flow.productId, qty: "10" }],
      clientToken: "trans-token-doble-0001",
    });
    const t1 = confirmTransformation(flow.h.db, flow.h.units, tInput);
    const t2 = confirmTransformation(flow.h.db, flow.h.units, tInput);
    expect(t1.duplicated).toBe(false);
    expect(t2.duplicated).toBe(true);
    expect(t2.id).toBe(t1.id);
    expect(listTransformations(flow.h.db)).toHaveLength(1);
    expect(productStock(flow)).toBe(10_000_000);
    expect(bolsaStock(flow)).toBe(4_990_000_000);
  });

  it("12. cerrar y reabrir el día conserva inventarios y costos", () => {
    const flow = setupFlow();
    const batch = produce(flow, "1");
    const tf = transform(flow);
    const before = {
      harina: rawStock(flow),
      bolsa: bolsaStock(flow),
      masa: massStock(flow),
      producto: productStock(flow),
      movements: movementsCount(flow),
    };

    closeDay(flow.h.db, { businessDate: flow.today, counts: [] });
    expect(rawStock(flow)).toBe(before.harina);
    expect(massStock(flow)).toBe(before.masa);
    expect(productStock(flow)).toBe(before.producto);
    expect(getProductionDetail(flow.h.db, batch.id).totalCostMicro).toBe(3_000_000);
    expect(getTransformationDetail(flow.h.db, tf.id).totalCostMicro).toBe(3_500_000);

    reopenDay(flow.h.db, flow.today, "Revisión de inventario");
    expect(rawStock(flow)).toBe(before.harina);
    expect(bolsaStock(flow)).toBe(before.bolsa);
    expect(massStock(flow)).toBe(before.masa);
    expect(productStock(flow)).toBe(before.producto);
    expect(movementsCount(flow)).toBe(before.movements);
    expect(getProductionDetail(flow.h.db, batch.id).status).toBe("confirmada");
    expect(getTransformationDetail(flow.h.db, tf.id).totalCostMicro).toBe(3_500_000);
  });
});

describe("§13 Reglas de receta", () => {
  it("13. rechaza elaborar con una versión archivada de la receta (409)", () => {
    const flow = setupFlow();
    // Nueva versión → v1 queda archivada.
    createRecipeVersion(flow.h.db, flow.h.units, flow.recipeId, versionInput.parse({
      massId: flow.masaId,
      expectedYield: "10",
      yieldUnitId: "unidad",
      validFrom: flow.today,
      items: [
        { rawMaterialId: flow.harinaId, unitId: "kg", qty: "6", phase: "masa" },
        { rawMaterialId: flow.bolsaId, unitId: "unidad", qty: "1", phase: "paquete" },
      ],
    }));

    let error: unknown;
    try {
      confirmProduction(
        flow.h.db,
        flow.h.units,
        productionInput.parse({
          productionDate: flow.today,
          recipeVersionId: flow.recipeVersionId, // v1, ahora archivada
          massesCount: "1",
        }),
      );
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe("RECIPE_ARCHIVED");
      expect(error.status).toBe(409);
    }
    expect(listProductions(flow.h.db)).toHaveLength(0);
    expect(rawStock(flow)).toBe(500_000_000);
  });

  it("14. una receta por producto y la masa se cuenta en unidades (no se pesa)", () => {
    const flow = setupFlow();

    // Segunda receta para el mismo producto → rechazada.
    const otherProduct = createProduct(
      flow.h.db,
      productInput.parse({
        name: "Producto Dos",
        saleUnitId: "unidad",
        price: "1.00",
        minStock: "1",
      }),
    );
    let dupError: unknown;
    try {
      createRecipe(flow.h.db, flow.h.units, recipeCreateInput.parse({
        name: "Segunda receta del producto",
        productId: flow.productId,
        version: {
          massId: flow.masaId,
          expectedYield: "10",
          yieldUnitId: "unidad",
          validFrom: flow.today,
          items: [{ rawMaterialId: flow.harinaId, unitId: "kg", qty: "6", phase: "masa" }],
        },
      }));
    } catch (e) {
      dupError = e;
    }
    expect(isAppError(dupError)).toBe(true);
    if (isAppError(dupError)) {
      expect(dupError.message).toContain("Ya existe una receta para el producto");
    }

    // Masa pesada (kg) para una receta de producto → rechazada.
    const masaKg = createMass(
      flow.h.db,
      massInput.parse({ name: "Masa Pesada", unitId: "kg" }),
    );
    let weighError: unknown;
    try {
      createRecipe(flow.h.db, flow.h.units, recipeCreateInput.parse({
        name: "Receta con masa pesada",
        productId: otherProduct.id,
        version: {
          massId: masaKg.id,
          expectedYield: "10",
          yieldUnitId: "unidad",
          validFrom: flow.today,
          items: [{ rawMaterialId: flow.harinaId, unitId: "kg", qty: "6", phase: "masa" }],
        },
      }));
    } catch (e) {
      weighError = e;
    }
    expect(isAppError(weighError)).toBe(true);
    if (isAppError(weighError)) {
      expect(weighError.message).toContain("dimensión conteo");
    }

    expect(listProductions(flow.h.db)).toHaveLength(0);
    expect(availableStock(flow.h.db, "raw", flow.harinaId)).toBe(500_000_000);
  });
});

describe("§13 Eliminación de planes", () => {
  function newPlan(flow: Flow, token: string) {
    return createPlan(flow.h.db, flow.h.units, {
      planDate: flow.today,
      recipeVersionId: flow.recipeVersionId,
      targetPackages: 2_000_000_000,
      notes: "Plan a eliminar",
      clientToken: token,
    });
  }

  it("15. elimina un plan sin referencias; un segundo intento responde 404", () => {
    const flow = flowYield80();
    const plan = newPlan(flow, "plan-token-del-0001");
    expect(listPlans(flow.h.db)).toHaveLength(1);

    const res = deletePlan(flow.h.db, plan.id);
    expect(res.deleted).toBe(true);
    expect(listPlans(flow.h.db)).toHaveLength(0);

    let error: unknown;
    try {
      deletePlan(flow.h.db, plan.id);
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe("NOT_FOUND");
      expect(error.status).toBe(404);
    }
  });

  it("16. elimina un plan con producción y terminación vinculadas: ambas quedan desvinculadas", () => {
    const flow = flowYield80();
    const plan = newPlan(flow, "plan-token-del-0002");
    const batch = confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "1",
        planId: plan.id,
      }),
    );
    const tf = confirmTransformation(
      flow.h.db,
      flow.h.units,
      transformationInput.parse({
        transformDate: flow.today,
        massId: flow.masaId,
        massQty: "1",
        outputs: [{ productId: flow.productId, qty: "10" }],
        planId: plan.id,
      }),
    );

    deletePlan(flow.h.db, plan.id);

    expect(listPlans(flow.h.db)).toHaveLength(0);
    // Producción y terminación siguen existiendo, solo pierden la referencia al plan.
    expect(listProductions(flow.h.db)).toHaveLength(1);
    expect(listTransformations(flow.h.db)).toHaveLength(1);
    const batchRow = flow.h.db
      .select({ planId: productionBatches.planId })
      .from(productionBatches)
      .where(eq(productionBatches.id, batch.id))
      .get();
    expect(batchRow?.planId).toBeNull();
    const tfRow = flow.h.db
      .select({ planId: transformations.planId })
      .from(transformations)
      .where(eq(transformations.id, tf.id))
      .get();
    expect(tfRow?.planId).toBeNull();
  });

  it("17. un plan anulado sin producciones sí se puede eliminar", () => {
    const flow = flowYield80();
    const plan = newPlan(flow, "plan-token-del-0003");
    annulPlan(flow.h.db, plan.id, "No se requiere");
    expect(listPlans(flow.h.db)[0].status).toBe("anulada");

    deletePlan(flow.h.db, plan.id);
    expect(listPlans(flow.h.db)).toHaveLength(0);
  });
});

describe("§13 Formato de los avisos de disponibilidad", () => {
  it("18. las cantidades faltantes se muestran sin decimales engañosos (1000, no 1000.000)", () => {
    const flow = flowYield80();
    // 20000 paquetes / 80 = 250 masas → 1500 kg de harina (hay 500) y
    // 20000 bolsas (hay 5000).
    const preview = previewPlan(flow.h.db, flow.h.units, {
      recipeVersionId: flow.recipeVersionId,
      targetPackages: 20_000_000_000,
    });
    expect(preview.warnings).toContain("Falta 1000 kg de Harina.");
    expect(preview.warnings).toContain("Falta 15000 unidad de Bolsa.");
    // Ningún aviso debe mostrar tres decimales: "215.000" se lee como 215 mil.
    expect(preview.warnings.every((w) => !/\d\.\d{3}(?!\d)/.test(w))).toBe(true);
  });
});

describe("§13 Empaques en la terminación (previsualización)", () => {
  it("19. calcula los empaques sobre los paquetes REALES sin tocar el stock", () => {
    const flow = flowYield80();
    const before = bolsaStock(flow);

    const preview = previewTransformation(
      flow.h.db,
      flow.h.units,
      transformationPreviewInput.parse({
        recipeVersionId: flow.recipeVersionId,
        realPackages: "1900",
      }),
    );

    expect(preview.packaging).toHaveLength(1);
    const line = preview.packaging[0];
    expect(line.name).toBe("Bolsa");
    expect(line.qtyPerPackageMicro).toBe(1_000_000); // 1 bolsa por paquete
    expect(line.neededMicro).toBe(1_900_000_000);
    expect(line.availableMicro).toBe(5_000_000_000);
    expect(line.missingMicro).toBe(0);
    expect(line.estimatedCostMicro).toBe(95_000_000); // 1900 × 0.05 CUP
    expect(bolsaStock(flow)).toBe(before); // solo cálculo
  });

  it("20. marca el faltante de empaque cuando el stock no alcanza", () => {
    const flow = flowYield80();
    const preview = previewTransformation(
      flow.h.db,
      flow.h.units,
      transformationPreviewInput.parse({
        recipeVersionId: flow.recipeVersionId,
        realPackages: "6000",
      }),
    );
    expect(preview.packaging[0].neededMicro).toBe(6_000_000_000);
    expect(preview.packaging[0].availableMicro).toBe(5_000_000_000);
    expect(preview.packaging[0].missingMicro).toBe(1_000_000_000);
    expect(listTransformations(flow.h.db)).toHaveLength(0);
  });
});
