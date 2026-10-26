/**
 * Mano de obra en producción de masas y terminación:
 * - elaboración: tarifa por masa × masas (o monto indicado)
 * - terminación: tarifa por unidad individual × (paquetes × u/paquete)
 * El costo de MO entra al lote de masa y se reparte en la terminación.
 */
import { describe, expect, it } from "vitest";
import {
  annulProduction,
  confirmProduction,
  getProductionDetail,
  listProductions,
  productionInput,
} from "../server/services/productions";
import {
  annulTransformation,
  confirmTransformation,
  getTransformationDetail,
  transformationInput,
} from "../server/services/transformations";
import { laborRateInput, setLaborRate } from "../server/services/laborrates";
import {
  setupFlow,
  bolsaStock,
  massStock,
  productStock,
  rawStock,
} from "./helpers";

describe("Producción de masas — mano de obra", () => {
  it("sin laborCost usa la tarifa configurada × masas (2 × 1,50 = 3,00 sobre 6,00)", () => {
    const flow = setupFlow();
    setLaborRate(flow.h.db, laborRateInput.parse({ kind: "masa", massId: flow.masaId, rate: "1.50" }));
    const before = rawStock(flow);

    const batch = confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "2",
      }),
    );
    // materiales 2 × 3,00 = 6,00; MO 3,00 → total 9,00 y 4,50 por masa
    expect(batch.laborCostMicro).toBe(3_000_000);
    expect(batch.totalCostMicro).toBe(9_000_000);
    expect(batch.unitCostMicro).toBe(4_500_000);
    const detail = getProductionDetail(flow.h.db, batch.id);
    expect(detail.laborCostMicro).toBe(3_000_000);
    expect(detail.totalCostMicro).toBe(9_000_000);
    expect(rawStock(flow)).toBe(before - 12_000_000);
  });

  it("laborCost indicado reemplaza la tarifa configurada", () => {
    const flow = setupFlow();
    setLaborRate(flow.h.db, laborRateInput.parse({ kind: "masa", massId: flow.masaId, rate: "100" }));
    const batch = confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "1",
        laborCost: "2",
      }),
    );
    expect(batch.laborCostMicro).toBe(2_000_000);
    expect(batch.totalCostMicro).toBe(5_000_000); // 3,00 + 2,00
  });

  it("sin tarifa configurada ni laborCost la MO es 0", () => {
    const flow = setupFlow();
    const batch = confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "1",
      }),
    );
    expect(batch.laborCostMicro).toBe(0);
    expect(batch.totalCostMicro).toBe(3_000_000);
  });

  it("anulación con MO repone solo los materiales", () => {
    const flow = setupFlow();
    setLaborRate(flow.h.db, laborRateInput.parse({ kind: "masa", massId: flow.masaId, rate: "1.50" }));
    const beforeRaw = rawStock(flow);
    const batch = confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "1",
      }),
    );
    annulProduction(flow.h.db, batch.id, "error de digitación");
    expect(rawStock(flow)).toBe(beforeRaw);
    expect(massStock(flow)).toBe(0);
    const [row] = listProductions(flow.h.db);
    expect(row.status).toBe("anulada");
    expect(row.laborCostMicro).toBe(1_500_000); // histórico conservado
  });
});

describe("Terminación — mano de obra", () => {
  it("tarifa por unidad individual × unidades reales se reparte en el costo", () => {
    const flow = setupFlow();
    setLaborRate(flow.h.db, laborRateInput.parse({ kind: "masa", massId: flow.masaId, rate: "1.50" }));
    setLaborRate(
      flow.h.db,
      laborRateInput.parse({ kind: "terminacion", productId: flow.productId, rate: "0.10" }),
    );
    const lot = confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "1",
      }),
    );
    // lote de masa con MO incluida: 4,50 por unidad de masa
    expect(lot.unitCostMicro).toBe(4_500_000);

    const tf = confirmTransformation(
      flow.h.db,
      flow.h.units,
      transformationInput.parse({
        transformDate: flow.today,
        massId: flow.masaId,
        massQty: "1",
        outputs: [{ productId: flow.productId, qty: "10" }],
      }),
    );
    // masa 4,50 + empaque 0,50 + MO 1,00 (10 u × 0,10) = 6,00 → 0,60 por paquete
    expect(tf.laborCostMicro).toBe(1_000_000);
    expect(tf.totalCostMicro).toBe(6_000_000);
    const detail = getTransformationDetail(flow.h.db, tf.id);
    expect(detail.laborCostMicro).toBe(1_000_000);
    expect(detail.outputs[0].unitCostMicro).toBe(600_000);
    expect(detail.outputs[0].costAllocatedMicro).toBe(6_000_000);
  });

  it("laborCost indicado en la terminación se aplica tal cual", () => {
    const flow = setupFlow();
    setLaborRate(flow.h.db, laborRateInput.parse({ kind: "masa", massId: flow.masaId, rate: "1.50" }));
    setLaborRate(
      flow.h.db,
      laborRateInput.parse({ kind: "terminacion", productId: flow.productId, rate: "99" }),
    );
    confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "1",
      }),
    );
    const tf = confirmTransformation(
      flow.h.db,
      flow.h.units,
      transformationInput.parse({
        transformDate: flow.today,
        massId: flow.masaId,
        massQty: "1",
        laborCost: "0.80",
        outputs: [{ productId: flow.productId, qty: "10" }],
      }),
    );
    expect(tf.laborCostMicro).toBe(800_000);
    expect(tf.totalCostMicro).toBe(5_800_000); // 4,50 + 0,50 + 0,80
  });

  it("anulación de la terminación repone masa, empaque y cancela productos", () => {
    const flow = setupFlow();
    setLaborRate(flow.h.db, laborRateInput.parse({ kind: "masa", massId: flow.masaId, rate: "1.50" }));
    setLaborRate(
      flow.h.db,
      laborRateInput.parse({ kind: "terminacion", productId: flow.productId, rate: "0.10" }),
    );
    const beforeRaw = rawStock(flow);
    const beforeBolsa = bolsaStock(flow);
    confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "1",
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
      }),
    );
    annulTransformation(flow.h.db, tf.id, "mala pesada");
    expect(massStock(flow)).toBe(1_000_000);
    // la elaboración consumió 6 kg; su anulación es aparte
    expect(rawStock(flow)).toBe(beforeRaw - 6_000_000);
    expect(bolsaStock(flow)).toBe(beforeBolsa);
    expect(productStock(flow)).toBe(0);
  });
});
