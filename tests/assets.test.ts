import { describe, expect, it } from "vitest";
import { expenses } from "../db/schema";
import { addMonthsToPeriod, monthOfISO, todayISO } from "../server/domain/dates";
import { isAppError } from "../server/domain/errors";
import {
  assetInput,
  createAsset,
  depreciateAssets,
  disposeAsset,
  getAssetDetail,
  listAssets,
  updateAsset,
} from "../server/services/assets";
import { newDb } from "./helpers";

const TODAY = todayISO();
const CURRENT = monthOfISO(TODAY);
const TWO_MONTHS_AGO = `${addMonthsToPeriod(CURRENT, -2)}-01`;

function create(h: ReturnType<typeof newDb>, overrides: Record<string, unknown> = {}) {
  return createAsset(
    h.db,
    assetInput.parse({
      name: "Laptop Lenovo",
      category: "Equipos de cómputo",
      acquiredAt: TWO_MONTHS_AGO,
      cost: "100",
      residual: "0",
      usefulLifeMonths: 10,
      ...overrides,
    }),
  );
}

describe("Activos fijos y depreciación", () => {
  it("asigna código automático, lista cuota y valor en libros", () => {
    const h = newDb();
    const asset = create(h);
    const second = create(h, { name: "Impresora" });

    expect(asset.code).toBe("AF-0001");
    expect(second.code).toBe("AF-0002");

    const rows = listAssets(h.db);
    expect(rows).toHaveLength(2);
    const row = rows.find((r) => r.id === asset.id);
    expect(row?.monthlyMicro).toBe(10_000_000);
    expect(row?.depreciatedMicro).toBe(0);
    expect(row?.bookValueMicro).toBe(100_000_000);
    expect(row?.status).toBe("en_uso");
  });

  it("deprecia todos los meses pendientes, absorbe el redondeo y es idempotente", () => {
    const h = newDb();
    const asset = create(h, { usefulLifeMonths: 3, cost: "100" });

    const first = depreciateAssets(h.db);
    expect(first.untilPeriod).toBe(CURRENT);
    expect(first.created).toBe(3);
    expect(first.totalMicro).toBe(100_000_000);

    const detail = getAssetDetail(h.db, asset.id);
    expect(detail.depreciations).toHaveLength(3);
    const amounts = detail.depreciations.map((d) => d.amountMicro).sort((a, b) => a - b);
    expect(amounts).toEqual([33_333_333, 33_333_333, 33_333_334]);
    expect(detail.depreciatedMicro).toBe(100_000_000);
    expect(detail.bookValueMicro).toBe(0);

    const second = depreciateAssets(h.db);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.totalMicro).toBe(0);

    const rows = h.db.select().from(expenses).all();
    expect(rows).toHaveLength(3);
    expect(rows.every((e) => e.category === "Depreciación de activos")).toBe(true);
  });

  it("no permite cambiar campos financieros después de la primera depreciación", () => {
    const h = newDb();
    const asset = create(h);
    depreciateAssets(h.db);

    let error: unknown;
    try {
      updateAsset(h.db, asset.id, assetInput.parse({
        name: asset.name,
        category: asset.category,
        acquiredAt: asset.acquiredAt,
        cost: "120",
        residual: "0",
        usefulLifeMonths: asset.usefulLifeMonths,
      }));
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);

    const updated = updateAsset(h.db, asset.id, assetInput.parse({
      name: "Laptop Lenovo (oficina)",
      category: "Equipos de cómputo",
      acquiredAt: asset.acquiredAt,
      cost: "100",
      residual: "0",
      usefulLifeMonths: asset.usefulLifeMonths,
      location: "Oficina",
    }));
    expect(updated.name).toBe("Laptop Lenovo (oficina)");
    expect(updated.location).toBe("Oficina");
  });

  it("la baja deprecia hasta el mes de la baja y registra la pérdida como gasto", () => {
    const h = newDb();
    const asset = create(h, { usefulLifeMonths: 10, cost: "100" });

    const result = disposeAsset(h.db, asset.id, {
      disposeDate: TODAY,
      disposeType: "venta",
      recoveryValue: 20_000_000,
      reason: "Renovación de equipos",
    });

    expect(result.depreciatedMicro).toBe(30_000_000);
    expect(result.bookValueMicro).toBe(70_000_000);
    expect(result.lossMicro).toBe(50_000_000);
    expect(result.gainMicro).toBe(0);
    expect(result.expenseId).not.toBeNull();
    expect(result.asset.status).toBe("baja");
    expect(result.asset.disposedAt).toBe(TODAY);

    const expense = h.db
      .select()
      .from(expenses)
      .all()
      .find((e) => e.id === result.expenseId);
    expect(expense?.category).toBe("Pérdida por baja de activo");
    expect(expense?.amountMicro).toBe(50_000_000);
    expect(expense?.expenseDate).toBe(TODAY);

    const later = depreciateAssets(h.db);
    expect(later.created).toBe(0);
    expect(getAssetDetail(h.db, asset.id).depreciations).toHaveLength(3);

    let error: unknown;
    try {
      disposeAsset(h.db, asset.id, { disposeDate: TODAY, disposeType: "otro" });
    } catch (e) {
      error = e;
    }
    expect(isAppError(error)).toBe(true);
  });

  it("una baja con recupero mayor al valor en libros no genera gasto", () => {
    const h = newDb();
    const asset = create(h, { usefulLifeMonths: 10, cost: "100" });

    const result = disposeAsset(h.db, asset.id, {
      disposeDate: TODAY,
      disposeType: "venta",
      recoveryValue: 90_000_000,
    });

    expect(result.bookValueMicro).toBe(70_000_000);
    expect(result.lossMicro).toBe(0);
    expect(result.gainMicro).toBe(20_000_000);
    expect(result.expenseId).toBeNull();
    expect(
      h.db
        .select()
        .from(expenses)
        .all()
        .filter((e) => e.category === "Pérdida por baja de activo"),
    ).toHaveLength(0);
  });
});
