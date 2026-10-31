import { describe, expect, it } from "vitest";
import { todayISO } from "../server/domain/dates";
import { currentWeekStartISO, laborSummary, weekStartOf } from "../server/services/labor";
import { annulProduction, productionInput, confirmProduction } from "../server/services/productions";
import { confirmTransformation, transformationInput } from "../server/services/transformations";
import { produce, setupFlow, shiftIso, transform } from "./helpers";

function prod(flow: ReturnType<typeof setupFlow>, date: string, masses: string, mo: string) {
  return confirmProduction(
    flow.h.db,
    flow.h.units,
    productionInput.parse({
      productionDate: date,
      recipeVersionId: flow.recipeVersionId,
      massesCount: masses,
      laborCost: mo,
    }),
  );
}

describe("Mano de obra (labor summary)", () => {
  it("agrupa por día y por semana la MO de producción y terminación, con total exacto", () => {
    const flow = setupFlow();
    const dayA = todayISO();
    const dayB = shiftIso(dayA, -1);
    const p1 = prod(flow, dayA, "2", "4");
    const t1 = confirmTransformation(
      flow.h.db,
      flow.h.units,
      transformationInput.parse({
        transformDate: dayA,
        massId: flow.masaId,
        massQty: "1",
        laborCost: "2",
        outputs: [{ productId: flow.productId, qty: "10" }],
      }),
    );
    prod(flow, dayB, "1", "3");

    const s = laborSummary(flow.h.db, dayB, dayA);
    expect(s.ops).toHaveLength(3);
    expect(s.totals.totalMicro).toBe(9_000_000);
    expect(s.totals.opsCount).toBe(3);
    expect(s.totals.byKind.produccion).toBe(7_000_000);
    expect(s.totals.byKind.terminacion).toBe(2_000_000);
    expect(s.totals.byKind.elaboracion).toBe(0);

    expect(s.days).toHaveLength(2);
    const dayARow = s.days.find((d) => d.date === dayA)!;
    expect(dayARow.totalMicro).toBe(6_000_000);
    expect(dayARow.opsCount).toBe(2);
    const dayBRow = s.days.find((d) => d.date === dayB)!;
    expect(dayBRow.totalMicro).toBe(3_000_000);

    expect(s.weeks).toHaveLength(1);
    expect(s.weeks[0].totalMicro).toBe(9_000_000);
    expect(s.weeks[0].days).toHaveLength(2);

    const prodOp = s.ops.find((o) => o.kind === "produccion" && o.id === p1.id)!;
    expect(prodOp.name).toContain("Masa");
    expect(prodOp.detail).toContain("2 masa");
    const termOp = s.ops.find((o) => o.kind === "terminacion" && o.id === t1.id)!;
    expect(termOp.detail).toContain("10 paquete");
  });

  it("las operaciones anuladas se excluyen del resumen", () => {
    const flow = setupFlow();
    const day = todayISO();
    const p = prod(flow, day, "2", "4");
    annulProduction(flow.h.db, p.id, "Prueba");

    const s = laborSummary(flow.h.db, day, day);
    expect(s.ops).toHaveLength(0);
    expect(s.totals.totalMicro).toBe(0);
    expect(s.days).toHaveLength(0);
    expect(s.weeks).toHaveLength(0);
  });

  it("lista operaciones sin MO declarada con costo 0", () => {
    const flow = setupFlow();
    const day = todayISO();
    produce(flow, "1");
    transform(flow);

    const s = laborSummary(flow.h.db, day, day);
    expect(s.ops).toHaveLength(2);
    expect(s.ops.every((o) => o.laborCostMicro === 0)).toBe(true);
    expect(s.totals.totalMicro).toBe(0);
  });

  it("valida el rango y el cálculo del inicio de semana (lunes)", () => {
    const flow = setupFlow();
    const today = todayISO();
    expect(() => laborSummary(flow.h.db, today, shiftIso(today, -1))).toThrow();
    // 2026-10-31 es sábado → la semana inicia el lunes 26.
    expect(weekStartOf("2026-10-31")).toBe("2026-10-26");
    expect(weekStartOf(today)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(currentWeekStartISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
