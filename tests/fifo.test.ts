import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { stockLots } from "../db/schema";
import { availableStock, consumeFIFO, createLot } from "../server/domain/fifo";
import { isAppError } from "../server/domain/errors";
import { newDb } from "./helpers";

function makeLots(db: Parameters<typeof createLot>[0]) {
  const old = createLot(db, {
    itemType: "raw",
    itemId: 1,
    refType: "purchase",
    refId: 1,
    qtyMicro: 10_000_000,
    unitCostMicro: 1_500_000,
    businessDate: "2026-01-01",
  });
  const recent = createLot(db, {
    itemType: "raw",
    itemId: 1,
    refType: "purchase",
    refId: 2,
    qtyMicro: 10_000_000,
    unitCostMicro: 1_800_000,
    businessDate: "2026-01-02",
  });
  return { old, recent };
}

describe("PEPS/FIFO", () => {
  it("consume primero el lote más antiguo a su costo original", () => {
    const { db } = newDb();
    const { old, recent } = makeLots(db);

    const consumed = consumeFIFO(db, "raw", 1, 15_000_000, "Harina", (m) => String(m));
    expect(consumed).toHaveLength(2);
    expect(consumed[0]).toEqual({
      lotId: old,
      qtyMicro: 10_000_000,
      unitCostMicro: 1_500_000,
      lineCostMicro: 15_000_000,
    });
    expect(consumed[1]).toEqual({
      lotId: recent,
      qtyMicro: 5_000_000,
      unitCostMicro: 1_800_000,
      lineCostMicro: 9_000_000,
    });
    expect(availableStock(db, "raw", 1)).toBe(5_000_000);
  });

  it("después del más antiguo consume el siguiente (orden por fecha, luego id)", () => {
    const { db } = newDb();
    makeLots(db);
    consumeFIFO(db, "raw", 1, 10_000_000, "Harina", (m) => String(m));
    const second = consumeFIFO(db, "raw", 1, 5_000_000, "Harina", (m) => String(m));
    expect(second).toHaveLength(1);
    expect(second[0].unitCostMicro).toBe(1_800_000);
    expect(second[0].qtyMicro).toBe(5_000_000);
    expect(availableStock(db, "raw", 1)).toBe(5_000_000);
  });

  it("ordena por businessDate aunque un lote posterior tenga id menor", () => {
    const { db } = newDb();
    const later = createLot(db, {
      itemType: "raw",
      itemId: 2,
      refType: "purchase",
      refId: 1,
      qtyMicro: 5_000_000,
      unitCostMicro: 2_000_000,
      businessDate: "2026-03-01",
    });
    const earlier = createLot(db, {
      itemType: "raw",
      itemId: 2,
      refType: "purchase",
      refId: 2,
      qtyMicro: 5_000_000,
      unitCostMicro: 1_000_000,
      businessDate: "2026-02-01",
    });
    const consumed = consumeFIFO(db, "raw", 2, 5_000_000, "Arroz", (m) => String(m));
    expect(consumed[0].lotId).toBe(earlier);
    expect(consumed[0].unitCostMicro).toBe(1_000_000);
    expect(availableStock(db, "raw", 2)).toBe(5_000_000);
    const rest = consumeFIFO(db, "raw", 2, 5_000_000, "Arroz", (m) => String(m));
    expect(rest[0].lotId).toBe(later);
  });

  it("falla con stock insuficiente sin tocar los lotes", () => {
    const { db } = newDb();
    makeLots(db);
    let error: unknown;
    try {
      consumeFIFO(db, "raw", 1, 25_000_000, "Harina", (m) => String(m));
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe("INSUFFICIENT_STOCK");
      expect(error.status).toBe(400);
      expect(error.message).toContain("insuficiente");
      expect(error.details).toMatchObject({ itemName: "Harina" });
    }
    expect(availableStock(db, "raw", 1)).toBe(20_000_000);
  });

  it("rechaza cantidades no positivas", () => {
    const { db } = newDb();
    makeLots(db);
    expect(() => consumeFIFO(db, "raw", 1, 0, "Harina", (m) => String(m))).toThrow();
    expect(() => consumeFIFO(db, "raw", 1, -1, "Harina", (m) => String(m))).toThrow();
    expect(() => createLot(db, {
      itemType: "raw",
      itemId: 1,
      refType: "purchase",
      refId: 9,
      qtyMicro: 0,
      unitCostMicro: 1,
      businessDate: "2026-01-01",
    })).toThrow();
  });

  it("ignora lotes cancelados (cancelledAt) en el cálculo de stock", () => {
    const { db } = newDb();
    const id = createLot(db, {
      itemType: "raw",
      itemId: 3,
      refType: "purchase",
      refId: 1,
      qtyMicro: 7_000_000,
      unitCostMicro: 1_000_000,
      businessDate: "2026-01-01",
    });
    expect(availableStock(db, "raw", 3)).toBe(7_000_000);
    db.update(stockLots)
      .set({ cancelledAt: "2026-01-02T00:00:00.000" })
      .where(eq(stockLots.id, id))
      .run();
    expect(availableStock(db, "raw", 3)).toBe(0);
  });
});
