import { describe, expect, it } from "vitest";
import { expenses, inventoryMovements } from "../db/schema";
import { availableStock } from "../server/domain/fifo";
import { todayISO } from "../server/domain/dates";
import { createSupplier, supplierInput } from "../server/services/suppliers";
import { createMaterial, materialInput } from "../server/services/materials";
import {
  consumeSupply,
  createSupply,
  getSupplyDetail,
  listSupplies,
  supplyInput,
} from "../server/services/supplies";
import {
  annulPurchase,
  createPurchase,
  getPurchaseDetail,
  purchaseInput,
} from "../server/services/purchases";
import { runStockAdjustment, stockAdjustmentInput } from "../server/services/inventory";
import { newDb } from "./helpers";

function setup() {
  const h = newDb();
  const today = todayISO();
  const supplier = createSupplier(h.db, supplierInput.parse({ name: "Proveedor Insumos" }));
  const supply = createSupply(
    h.db,
    supplyInput.parse({ name: "Detergente", unitId: "unidad", category: "Limpieza", minStock: "2" }),
  );
  return { h, today, supplierId: supplier.id, supplyId: supply.id };
}

function buy(
  ctx: ReturnType<typeof setup>,
  qty: string,
  unitPrice: string,
  extraItems: Array<Record<string, unknown>> = [],
) {
  return createPurchase(
    ctx.h.db,
    ctx.h.units,
    purchaseInput.parse({
      supplierId: ctx.supplierId,
      purchaseDate: ctx.today,
      items: [
        { supplyId: ctx.supplyId, unitId: "unidad", qty, unitPrice },
        ...extraItems,
      ],
    }),
  );
}

describe("Otros insumos", () => {
  it("una compra mixta (materia prima + insumo) carga ambos inventarios y se anula completa", () => {
    const ctx = setup();
    const harina = createMaterial(
      ctx.h.db,
      materialInput.parse({ name: "Harina", unitId: "kg" }),
    );
    const purchase = buy(ctx, "10", "2.00", [
      { rawMaterialId: harina.id, unitId: "kg", qty: "5", unitPrice: "0.50" },
    ]);

    expect(availableStock(ctx.h.db, "supply", ctx.supplyId)).toBe(10_000_000);
    expect(availableStock(ctx.h.db, "raw", harina.id)).toBe(5_000_000);

    const detail = getPurchaseDetail(ctx.h.db, purchase.id);
    expect(detail.items).toHaveLength(2);
    expect(detail.items.find((i) => i.supplyId === ctx.supplyId)?.itemType).toBe("supply");
    expect(detail.items.find((i) => i.rawMaterialId === harina.id)?.itemType).toBe("raw");

    const list = listSupplies(ctx.h.db);
    expect(list).toHaveLength(1);
    expect(list[0].stockMicro).toBe(10_000_000);
    expect(list[0].stockValueMicro).toBe(20_000_000);
    expect(list[0].lastPrice?.priceMicro).toBe(2_000_000);

    annulPurchase(ctx.h.db, purchase.id, "Compra duplicada");
    expect(availableStock(ctx.h.db, "supply", ctx.supplyId)).toBe(0);
    expect(availableStock(ctx.h.db, "raw", harina.id)).toBe(0);
    expect(getPurchaseDetail(ctx.h.db, purchase.id).status).toBe("anulada");
  });

  it("el consumo descuenta PEPS sin crear gasto (el costo se pagó al comprar)", () => {
    const ctx = setup();
    buy(ctx, "5", "1.00");
    buy(ctx, "5", "3.00");

    const result = consumeSupply(ctx.h.db, ctx.supplyId, {
      qty: 6_000_000,
      businessDate: ctx.today,
      notes: "Limpieza del local",
    });

    expect(result.stockMicro).toBe(4_000_000);
    expect(result.qtyMicro).toBe(6_000_000);
    expect(result.costValueMicro).toBe(8_000_000);
    expect(result.expenseId).toBeNull();
    expect(availableStock(ctx.h.db, "supply", ctx.supplyId)).toBe(4_000_000);

    expect(ctx.h.db.select().from(expenses).all()).toHaveLength(0);

    const moves = ctx.h.db
      .select()
      .from(inventoryMovements)
      .all()
      .filter((m) => m.movementType === "consumo");
    expect(moves).toHaveLength(2);
    expect(moves.reduce((acc, m) => acc + m.qtyDeltaMicro, 0)).toBe(-6_000_000);
    expect(moves.every((m) => m.refId === null)).toBe(true);
  });

  it("la merma de un insumo crea gasto «Merma» y el ajuste a la baja no", () => {
    const ctx = setup();
    buy(ctx, "10", "2.00");

    const waste = runStockAdjustment(
      ctx.h.db,
      stockAdjustmentInput.parse({
        kind: "merma",
        itemType: "supply",
        itemId: ctx.supplyId,
        qty: "2",
        reason: "Envase roto",
      }),
    );
    expect(waste.lossValueMicro).toBe(4_000_000);
    expect(waste.expenseId).not.toBeNull();

    const expense = ctx.h.db
      .select()
      .from(expenses)
      .all()
      .find((e) => e.id === waste.expenseId);
    expect(expense?.category).toBe("Merma");
    expect(expense?.amountMicro).toBe(4_000_000);

    const before = ctx.h.db.select().from(expenses).all().length;
    const adjust = runStockAdjustment(
      ctx.h.db,
      stockAdjustmentInput.parse({
        kind: "ajuste",
        itemType: "supply",
        itemId: ctx.supplyId,
        newTotal: "5",
        reason: "Recuento físico",
      }),
    );
    expect(adjust.lossValueMicro).toBe(6_000_000);
    expect(adjust.expenseId).toBeNull();
    expect(ctx.h.db.select().from(expenses).all()).toHaveLength(before);
    expect(availableStock(ctx.h.db, "supply", ctx.supplyId)).toBe(5_000_000);
  });

  it("el detalle acota lotes, precios y movimientos a 5 sin perder la valorización", () => {
    const ctx = setup();
    buy(ctx, "1", "2.00");
    for (let i = 0; i < 5; i += 1) buy(ctx, "1", "2.00");

    const detail = getSupplyDetail(ctx.h.db, ctx.supplyId);

    expect(detail.lotsTotal).toBe(6);
    expect(detail.lots).toHaveLength(5);
    expect(detail.lots[0].id).toBeLessThan(detail.lots[4].id);
    expect(detail.stockValueMicro).toBe(12_000_000);
    expect(detail.priceHistoryTotal).toBe(6);
    expect(detail.priceHistory).toHaveLength(5);
    expect(detail.movementsTotal).toBe(6);
    expect(detail.movements).toHaveLength(5);
  });
});
