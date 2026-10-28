import { describe, expect, it } from "vitest";
import { availableStock } from "../server/domain/fifo";
import { isAppError } from "../server/domain/errors";
import {
  listStockAdjustments,
  runStockAdjustment,
  stockAdjustmentInput,
  type StockAdjustmentInput,
} from "../server/services/inventory";
import { massStock, productStock, produce, setupFlow, transform } from "./helpers";
import type { Flow } from "./helpers";

function adjust(flow: Flow, input: Record<string, unknown>) {
  return runStockAdjustment(flow.h.db, stockAdjustmentInput.parse(input) as StockAdjustmentInput);
}

describe("Ajustes de inventario y mermas", () => {
  it("un ajuste positivo crea un lote a costo cero y sube el stock", () => {
    const flow = setupFlow();
    const result = adjust(flow, {
      kind: "ajuste",
      itemType: "raw",
      itemId: flow.harinaId,
      newTotal: "600",
      reason: "Conteo físico",
    });

    expect(result.stockMicro).toBe(600_000_000);
    expect(result.deltaMicro).toBe(100_000_000);
    expect(result.lossValueMicro).toBe(0);
    expect(availableStock(flow.h.db, "raw", flow.harinaId)).toBe(600_000_000);

    const rows = listStockAdjustments(flow.h.db);
    expect(Array.isArray(rows)).toBe(true);
    const last = (rows as Array<{ movementType: string; valueMicro: number; itemName: string; unitId: string }>)[0];
    expect(last.movementType).toBe("adjustment_in");
    expect(last.valueMicro).toBe(0);
    expect(last.itemName).toBe("Harina");
    expect(last.unitId).toBe("kg");
  });

  it("una merma descuenta PEPS y valoriza la pérdida al costo del lote", () => {
    const flow = setupFlow();
    const result = adjust(flow, {
      kind: "merma",
      itemType: "raw",
      itemId: flow.harinaId,
      qty: "10",
      reason: "Harina vencida",
    });

    expect(result.deltaMicro).toBe(-10_000_000);
    expect(result.stockMicro).toBe(490_000_000);
    // 10 kg × 0.50 CUP = 5 CUP
    expect(result.lossValueMicro).toBe(5_000_000);
    expect(availableStock(flow.h.db, "raw", flow.harinaId)).toBe(490_000_000);

    const rows = listStockAdjustments(flow.h.db, { itemType: "raw", itemId: flow.harinaId });
    const last = (rows as Array<{ movementType: string; qtyDeltaMicro: number; reason: string }>)[0];
    expect(last.movementType).toBe("waste");
    expect(last.qtyDeltaMicro).toBe(-10_000_000);
    expect(last.reason).toBe("Harina vencida");
  });

  it("un ajuste negativo consume lotes PEPS y registra la salida", () => {
    const flow = setupFlow();
    const result = adjust(flow, {
      kind: "ajuste",
      itemType: "raw",
      itemId: flow.harinaId,
      newTotal: "400",
      reason: "Merma no registrada",
    });

    expect(result.deltaMicro).toBe(-100_000_000);
    expect(result.stockMicro).toBe(400_000_000);
    expect(result.lossValueMicro).toBe(50_000_000);
    expect(availableStock(flow.h.db, "raw", flow.harinaId)).toBe(400_000_000);
  });

  it("una merma sobre producto terminado usa su costo de producción", () => {
    const flow = setupFlow();
    produce(flow, "1");
    transform(flow);
    expect(productStock(flow)).toBe(10_000_000);

    const result = adjust(flow, {
      kind: "merma",
      itemType: "product",
      itemId: flow.productId,
      qty: "2",
      reason: "Producto dañado",
    });

    expect(productStock(flow)).toBe(8_000_000);
    // Costo de la masa terminada: 3.5 CUP / 10 unidades → 2 × 0.35 = 0.70 CUP
    expect(result.lossValueMicro).toBe(700_000);
  });

  it("una merma sobre masa descuenta el inventario de masas", () => {
    const flow = setupFlow();
    produce(flow, "2");
    expect(massStock(flow)).toBe(2_000_000);

    adjust(flow, {
      kind: "merma",
      itemType: "mass",
      itemId: flow.masaId,
      qty: "1",
      reason: "Masa caída",
    });
    expect(massStock(flow)).toBe(1_000_000);
  });

  it("no permite mermar más de lo disponible (rollback completo)", () => {
    const flow = setupFlow();
    let error: unknown;
    try {
      adjust(flow, {
        kind: "merma",
        itemType: "raw",
        itemId: flow.harinaId,
        qty: "999",
        reason: "Prueba",
      });
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    expect(availableStock(flow.h.db, "raw", flow.harinaId)).toBe(500_000_000);
    expect(listStockAdjustments(flow.h.db)).toHaveLength(0);
  });

  it("rechaza un ajuste que deja el stock igual", () => {
    const flow = setupFlow();
    let error: unknown;
    try {
      adjust(flow, {
        kind: "ajuste",
        itemType: "raw",
        itemId: flow.harinaId,
        newTotal: "500",
        reason: "Sin cambios",
      });
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    expect(availableStock(flow.h.db, "raw", flow.harinaId)).toBe(500_000_000);
  });

  it("valida tipo, cantidad y motivo del ajuste", () => {
    const base = {
      kind: "merma",
      itemType: "raw",
      itemId: 1,
      qty: "1",
      reason: "Motivo válido",
    };
    expect(stockAdjustmentInput.safeParse(base).success).toBe(true);
    expect(stockAdjustmentInput.safeParse({ ...base, itemType: "otro" }).success).toBe(false);
    expect(stockAdjustmentInput.safeParse({ ...base, qty: "0" }).success).toBe(false);
    expect(stockAdjustmentInput.safeParse({ ...base, reason: "x" }).success).toBe(false);
    expect(stockAdjustmentInput.safeParse({ ...base, kind: "otro" }).success).toBe(false);
  });

  it("el historial pagina y conserva el total real", () => {
    const flow = setupFlow();
    adjust(flow, {
      kind: "ajuste",
      itemType: "raw",
      itemId: flow.harinaId,
      newTotal: "600",
      reason: "Ajuste uno",
    });
    adjust(flow, {
      kind: "ajuste",
      itemType: "raw",
      itemId: flow.harinaId,
      newTotal: "450",
      reason: "Ajuste dos",
    });
    adjust(flow, {
      kind: "merma",
      itemType: "raw",
      itemId: flow.harinaId,
      qty: "5",
      reason: "Merma tres",
    });

    const first = listStockAdjustments(flow.h.db, {}, { limit: 2, offset: 0 });
    expect(Array.isArray(first)).toBe(false);
    if (Array.isArray(first)) throw new Error("se esperaba resultado paginado");
    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(first.items[0].reason).toBe("Merma tres");

    const second = listStockAdjustments(flow.h.db, {}, { limit: 2, offset: 2 });
    if (Array.isArray(second)) throw new Error("se esperaba resultado paginado");
    expect(second.total).toBe(3);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].reason).toBe("Ajuste uno");
  });
});
