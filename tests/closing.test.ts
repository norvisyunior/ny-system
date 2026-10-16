import { describe, expect, it } from "vitest";
import { isAppError } from "../server/domain/errors";
import { lastClosedDate } from "../server/domain/dates";
import { closeDay, getClosing, reopenDay } from "../server/services/closings";
import { listSales, confirmSale, saleInput } from "../server/services/sales";
import { createExpense, expenseInput } from "../server/services/expenses";
import { produce, sell, setupFlow, shiftIso, transform } from "./helpers";
import type { Flow } from "./helpers";

function sellSomething(flow: Flow) {
  produce(flow, "2");
  transform(flow, "2", [{ productId: flow.productId, qty: "20" }]);
  return sell(flow, [{ productId: flow.productId, qty: "10", unitPrice: "0.60" }]);
}

describe("Cierre diario", () => {
  it("exige motivo cuando el conteo físico tiene diferencia", () => {
    const flow = setupFlow();
    sellSomething(flow);

    let error: unknown;
    try {
      closeDay(flow.h.db, {
        businessDate: flow.today,
        counts: [{ itemType: "raw", itemId: flow.harinaId, counted: "487" }],
      });
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.message).toContain("diferencia");
      expect(error.status).toBe(400);
    }
    expect(lastClosedDate(flow.h.db)).toBeNull();
  });

  it("cierra con totales correctos (ventas − COGS − gastos) y registra el conteo", () => {
    const flow = setupFlow();
    sellSomething(flow);
    createExpense(
      flow.h.db,
      expenseInput.parse({
        expenseDate: flow.today,
        category: "Transporte",
        description: "Reparto",
        amount: "1.50",
        paymentMethod: "efectivo",
      }),
    );

    closeDay(flow.h.db, {
      businessDate: flow.today,
      counts: [{ itemType: "raw", itemId: flow.harinaId, counted: "487", reason: "Merma de proceso" }],
      notes: "Cierre de prueba",
    });

    const closing = getClosing(flow.h.db, flow.today);
    expect(closing.status).toBe("cerrado");
    expect(closing.salesTotalMicro).toBe(6_000_000);
    expect(closing.cogsMicro).toBe(3_500_000);
    expect(closing.expensesMicro).toBe(1_500_000);
    expect(closing.grossProfitMicro).toBe(2_500_000);
    expect(closing.netResultMicro).toBe(1_000_000);
    expect(closing.counts).toHaveLength(1);
    expect(closing.counts[0].expectedMicro).toBe(488_000_000);
    expect(closing.counts[0].countedMicro).toBe(487_000_000);
    expect(closing.counts[0].diffMicro).toBe(-1_000_000);
    expect(closing.counts[0].reason).toBe("Merma de proceso");
    expect(lastClosedDate(flow.h.db)).toBe(flow.today);
  });

  it("no permite cerrar dos veces el mismo día (409 ALREADY_CLOSED)", () => {
    const flow = setupFlow();
    sellSomething(flow);
    closeDay(flow.h.db, { businessDate: flow.today, counts: [] });

    let error: unknown;
    try {
      closeDay(flow.h.db, { businessDate: flow.today, counts: [] });
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe("ALREADY_CLOSED");
      expect(error.status).toBe(409);
      expect(error.message).toContain("cerrado");
    }
  });

  it("el día cerrado rechaza ventas y gastos nuevos (409 DAY_CLOSED)", () => {
    const flow = setupFlow();
    sellSomething(flow);
    closeDay(flow.h.db, { businessDate: flow.today, counts: [] });

    let saleError: unknown;
    try {
      confirmSale(
        flow.h.db,
        saleInput.parse({
          saleDate: flow.today,
          paymentMethod: "efectivo",
          items: [{ productId: flow.productId, qty: "1", unitPrice: "0.60" }],
        }),
      );
    } catch (e) {
      saleError = e;
    }
    expect(isAppError(saleError)).toBe(true);
    if (isAppError(saleError)) {
      expect(saleError.code).toBe("DAY_CLOSED");
      expect(saleError.status).toBe(409);
      expect(saleError.message).toContain("reabra el día desde Cierre diario");
    }

    let expenseError: unknown;
    try {
      createExpense(
        flow.h.db,
        expenseInput.parse({
          expenseDate: flow.today,
          category: "Varios",
          description: "Intento posterior",
          amount: "1",
          paymentMethod: "efectivo",
        }),
      );
    } catch (e) {
      expenseError = e;
    }
    expect(isAppError(expenseError)).toBe(true);
    if (isAppError(expenseError)) {
      expect(expenseError.code).toBe("DAY_CLOSED");
    }

    expect(listSales(flow.h.db)).toHaveLength(1);
  });

  it("reabre el día con motivo auditado y permite operar de nuevo", () => {
    const flow = setupFlow();
    sellSomething(flow);
    closeDay(flow.h.db, { businessDate: flow.today, counts: [] });

    const reopened = reopenDay(flow.h.db, flow.today, "Conteo corregido");
    expect(reopened.status).toBe("reabierto");
    expect(lastClosedDate(flow.h.db)).toBeNull();

    const closing = getClosing(flow.h.db, flow.today);
    expect(closing.status).toBe("reabierto");
    expect(closing.reopenReason).toBe("Conteo corregido");
    expect(closing.reopenedAt).not.toBeNull();

    const extra = sell(flow, [{ productId: flow.productId, qty: "1", unitPrice: "0.60" }]);
    expect(extra.totalMicro).toBe(600_000);
    expect(listSales(flow.h.db)).toHaveLength(2);

    closeDay(flow.h.db, { businessDate: flow.today, counts: [] });
    expect(getClosing(flow.h.db, flow.today).status).toBe("cerrado");
  });

  it("solo permite reabrir el último día cerrado", () => {
    const flow = setupFlow();
    // Ayer en zona local (derivado de hoy, no de UTC): evita cruzar la medianoche UTC
    const yesterday = shiftIso(flow.today, -1);
    closeDay(flow.h.db, { businessDate: yesterday, counts: [] });
    sellSomething(flow);
    closeDay(flow.h.db, { businessDate: flow.today, counts: [] });

    let error: unknown;
    try {
      reopenDay(flow.h.db, yesterday, "Intento de reapertura del día anterior");
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe("NOT_LATEST_CLOSING");
      expect(error.status).toBe(409);
      expect(error.message).toContain(flow.today);
    }
    expect(getClosing(flow.h.db, yesterday).status).toBe("cerrado");

    expect(reopenDay(flow.h.db, flow.today, "Reapertura válida").status).toBe("reabierto");
  });
});
