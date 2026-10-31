import { describe, expect, it } from "vitest";
import { createPurchase, purchaseInput } from "../server/services/purchases";
import { getMaterialDetail } from "../server/services/materials";
import { getMassDetail } from "../server/services/masses";
import { getProductDetail } from "../server/services/products";
import { produce, setupFlow, transform } from "./helpers";
import type { Flow } from "./helpers";

function extraPurchase(flow: Flow, qty: string, unitPrice: string) {
  return createPurchase(
    flow.h.db,
    flow.h.units,
    purchaseInput.parse({
      supplierId: flow.supplierId,
      purchaseDate: flow.today,
      items: [{ rawMaterialId: flow.harinaId, unitId: "kg", qty, unitPrice }],
    }),
  );
}

describe("Detalle de inventario con historial acotado", () => {
  it("materia prima: 5 lotes más antiguos, totales y valor FIFO completo", () => {
    const flow = setupFlow();
    for (let i = 0; i < 5; i += 1) extraPurchase(flow, "1", "0.50");

    const detail = getMaterialDetail(flow.h.db, flow.harinaId);

    expect(detail.lotsTotal).toBe(6);
    expect(detail.lots).toHaveLength(5);
    expect(detail.lots[0].id).toBeLessThan(detail.lots[4].id);
    // 500 kg + 5 compras de 1 kg a $0.50 = $252.50 (aunque solo se muestren 5 lotes)
    expect(detail.stockValueMicro).toBe(252_500_000);
    // El lote omitido queda fuera del payload pero dentro de la valorización.
    const shownMicro = detail.lots.reduce((acc, l) => acc + l.qtyRemainingMicro, 0);
    expect(shownMicro).toBe(504_000_000);

    expect(detail.priceHistoryTotal).toBe(6);
    expect(detail.priceHistory).toHaveLength(5);
  });

  it("masa: 5 lotes y 5 movimientos más recientes", () => {
    const flow = setupFlow();
    for (let i = 0; i < 6; i += 1) produce(flow);

    const detail = getMassDetail(flow.h.db, flow.masaId);

    expect(detail.lotsTotal).toBe(6);
    expect(detail.lots).toHaveLength(5);
    expect(detail.lots[0].id).toBeLessThan(detail.lots[4].id);
    expect(detail.movements).toHaveLength(5);
    expect(detail.movements[0].id).toBeGreaterThan(detail.movements[4].id);
  });

  it("producto: 5 lotes, 5 movimientos y 5 precios", () => {
    const flow = setupFlow();
    produce(flow, "6");
    for (let i = 0; i < 6; i += 1) transform(flow);

    const detail = getProductDetail(flow.h.db, flow.productId);

    expect(detail.lotsTotal).toBe(6);
    expect(detail.lots).toHaveLength(5);
    expect(detail.lots[0].id).toBeLessThan(detail.lots[4].id);
    expect(detail.movements).toHaveLength(5);
    expect(detail.movements[0].id).toBeGreaterThan(detail.movements[4].id);
    expect(detail.priceHistoryTotal).toBe(1);
    expect(detail.priceHistory).toHaveLength(1);
  });
});
