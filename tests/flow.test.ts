import { describe, expect, it } from "vitest";
import { availableStock } from "../server/domain/fifo";
import { isAppError } from "../server/domain/errors";
import { recipeCreateInput, createRecipe } from "../server/services/recipes";
import { productInput, createProduct, updateProduct } from "../server/services/products";
import { confirmProduction, listProductions, productionInput } from "../server/services/productions";
import { listSales, getSaleDetail, confirmSale, saleInput } from "../server/services/sales";
import { getPurchaseDetail, listPurchases } from "../server/services/purchases";
import { massStock, produce, productStock, rawStock, sell, setupFlow, transform, bolsaStock } from "./helpers";
import type { Flow } from "./helpers";

describe("Flujo compras → elaboración → terminación → venta", () => {
  it("la compra entra por PEPS con su costo unitario", () => {
    const flow = setupFlow();
    expect(rawStock(flow)).toBe(500_000_000);

    const purchases = listPurchases(flow.h.db);
    expect(purchases).toHaveLength(1);
    const detail = getPurchaseDetail(flow.h.db, purchases[0].id);
    expect(detail.totalMicro).toBe(500_000_000);
    expect(detail.items[0].unitPriceMicro).toBe(500_000);
    expect(detail.items[0].qtyMicro).toBe(500_000_000);
  });

  it("la elaboración consume los ingredientes de fase masa y crea la masa completa", () => {
    const flow = setupFlow();
    const batch = produce(flow, "1");

    expect(batch.totalCostMicro).toBe(3_000_000);
    expect(batch.unitCostMicro).toBe(3_000_000);
    expect(batch.expectedYieldMicro).toBe(1_000_000);
    expect(batch.realYieldMicro).toBe(1_000_000);
    expect(batch.deviationMicro).toBe(0);
    expect(rawStock(flow)).toBe(494_000_000);
    expect(massStock(flow)).toBe(1_000_000);
    expect(listProductions(flow.h.db)).toHaveLength(1);
  });

  it("la terminación reparte el costo proporcionalmente entre los productos", () => {
    const flow = setupFlow();
    produce(flow, "1");
    const tf = transform(flow, "1", [{ productId: flow.productId, qty: "40" }]);

    // 3 CUP de masa + 40 bolsas × 0.05 = 2 CUP → 5 CUP
    expect(tf.totalCostMicro).toBe(5_000_000);
    expect(tf.expectedPackagesMicro).toBe(10_000_000);
    expect(tf.deviationMicro).toBe(30_000_000);
    expect(productStock(flow)).toBe(40_000_000);
    expect(massStock(flow)).toBe(0);
    expect(bolsaStock(flow)).toBe(4_960_000_000);
  });

  it("la venta congela precio y costo aunque el precio del producto cambie después", () => {
    const flow = setupFlow();
    produce(flow, "1");
    const tf = transform(flow);
    expect(productStock(flow)).toBe(10_000_000);
    expect(tf.totalCostMicro).toBe(3_500_000);

    const sale = sell(flow, [{ productId: flow.productId, qty: "10", unitPrice: "0.60" }]);
    expect(sale.subtotalMicro).toBe(6_000_000);
    expect(sale.totalMicro).toBe(6_000_000);
    expect(sale.totalCostMicro).toBe(3_500_000);

    const detail = getSaleDetail(flow.h.db, sale.id);
    const line = detail.items[0];
    expect(line.unitPriceMicro).toBe(600_000);
    expect(line.lineTotalMicro).toBe(6_000_000);
    expect(line.unitCostMicro).toBe(350_000);
    expect(line.lineCostMicro).toBe(3_500_000);

    updateProduct(
      flow.h.db,
      flow.productId,
      productInput.parse({
        name: "Producto Test",
        saleUnitId: "unidad",
        price: "1.20",
        minStock: "5",
      }),
    );

    const after = getSaleDetail(flow.h.db, sale.id);
    expect(after.items[0].unitPriceMicro).toBe(600_000);
    expect(after.totalMicro).toBe(6_000_000);

    expect(productStock(flow)).toBe(0);
  });

  it("rechaza vender más de lo disponible sin dejar registro de la venta", () => {
    const flow = setupFlow();
    produce(flow, "1");
    transform(flow);

    let error: unknown;
    try {
      sell(flow, [{ productId: flow.productId, qty: "999", unitPrice: "0.60" }]);
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe("INSUFFICIENT_STOCK");
      expect(error.message).toContain("insuficiente");
    }
    expect(listSales(flow.h.db)).toHaveLength(0);
    expect(productStock(flow)).toBe(10_000_000);
  });

  it("una producción que excede el stock revierte todo (rollback transaccional)", () => {
    const flow = setupFlow();
    const hungryProduct = createProduct(
      flow.h.db,
      productInput.parse({
        name: "Producto Hambriento",
        saleUnitId: "unidad",
        price: "1.00",
        minStock: "1",
      }),
    );
    const hungry = createRecipe(flow.h.db, flow.h.units, recipeCreateInput.parse({
      name: "Receta que necesita mucho",
      productId: hungryProduct.id,
      version: {
        massId: flow.masaId,
        expectedYield: "5",
        yieldUnitId: "unidad",
        validFrom: flow.today,
        items: [{ rawMaterialId: flow.harinaId, unitId: "kg", qty: "600", phase: "masa" }],
      },
    }));

    let error: unknown;
    try {
      confirmProduction(
        flow.h.db,
        flow.h.units,
        productionInput.parse({
          productionDate: flow.today,
          recipeVersionId: hungry.versionId,
          massesCount: "1",
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

    expect(rawStock(flow)).toBe(500_000_000);
    expect(massStock(flow)).toBe(0);
    expect(listProductions(flow.h.db)).toHaveLength(0);
  });

  it("no permite producir con una versión de receta inexistente", () => {
    const flow = setupFlow();
    let error: unknown;
    try {
      produceVersion(flow, 999_999, "1");
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe("NOT_FOUND");
      expect(error.status).toBe(404);
    }
  });

  it("la venta puede agotar todo el producto por PEPS", () => {
    const flow = setupFlow();
    produce(flow, "1");
    transform(flow);
    const sale = confirmSale(
      flow.h.db,
      saleInput.parse({
        saleDate: flow.today,
        paymentMethod: "tarjeta",
        items: [{ productId: flow.productId, qty: "10", unitPrice: "0.60" }],
      }),
    );
    expect(sale.totalMicro).toBe(6_000_000);
    expect(productStock(flow)).toBe(0);
    expect(availableStock(flow.h.db, "product", flow.productId)).toBe(0);
  });
});

function produceVersion(flow: Flow, recipeVersionId: number, massesCount: string) {
  return confirmProduction(
    flow.h.db,
    flow.h.units,
    productionInput.parse({
      productionDate: flow.today,
      recipeVersionId,
      massesCount,
    }),
  );
}
