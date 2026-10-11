import { describe, expect, it } from "vitest";
import { UNITS_SEED, UnitsCatalog, UnitsConversionError } from "../server/domain/units";

const catalog = new UnitsCatalog(UNITS_SEED);

describe("UnitsCatalog — identidad y conversiones", () => {
  it("misma unidad no convierte", () => {
    expect(catalog.toBase(1_500_000, "kg", "kg")).toBe(1_500_000);
    expect(catalog.toBase(7, "kg", "kg")).toBe(7);
  });

  it("convierte dentro de la dimensión masa", () => {
    expect(catalog.toBase(1_000_000, "kg", "g")).toBe(1_000_000_000);
    expect(catalog.toBase(500_000, "g", "kg")).toBe(500);
    expect(catalog.toBase(1_000_000, "lb", "kg")).toBe(453_592);
  });

  it("convierte dentro de la dimensión volumen", () => {
    expect(catalog.toBase(1_000_000, "l", "ml")).toBe(1_000_000_000);
    expect(catalog.toBase(2_500_000, "ml", "l")).toBe(2_500);
  });

  it("redondea half-away-from-zero en conversiones", () => {
    expect(catalog.toBase(1_500, "g", "kg")).toBe(2);
    expect(catalog.toBase(1_499, "g", "kg")).toBe(1);
    expect(catalog.toBase(-1_500, "g", "kg")).toBe(-2);
  });
});

describe("UnitsCatalog — prohibiciones", () => {
  it("no convierte entre dimensiones distintas", () => {
    expect(() => catalog.toBase(1_000_000, "kg", "l")).toThrow(UnitsConversionError);
    expect(() => catalog.toBase(1_000_000, "kg", "l")).toThrow(/dimensiones distintas/);
    expect(() => catalog.toBase(1_000_000, "unidad", "kg")).toThrow(UnitsConversionError);
  });

  it("no convierte automáticamente entre unidades de conteo", () => {
    expect(() => catalog.toBase(1_000_000, "paquete", "unidad")).toThrow(UnitsConversionError);
    expect(() => catalog.toBase(1_000_000, "paquete", "unidad")).toThrow(/No se permite la conversión/);
    expect(() => catalog.toBase(1_000_000, "caja", "paquete")).toThrow(UnitsConversionError);
  });

  it("assertCompatible permite la misma dimensión (incluye conteo) y rechaza cruces", () => {
    expect(() => catalog.assertCompatible("kg", "g")).not.toThrow();
    expect(() => catalog.assertCompatible("paquete", "unidad")).not.toThrow();
    expect(() => catalog.assertCompatible("kg", "l")).toThrow(UnitsConversionError);
    expect(() => catalog.assertCompatible("kg", "kg")).not.toThrow();
  });

  it("rechaza unidades desconocidas", () => {
    expect(() => catalog.toBase(1, "galón", "kg")).toThrow(/Unidad desconocida/);
    expect(() => catalog.get("xyz")).toThrow(/Unidad desconocida/);
  });

  it("el semilla de unidades es consistente (8 unidades, bases marcadas)", () => {
    expect(UNITS_SEED).toHaveLength(8);
    const bases = UNITS_SEED.filter((u) => u.isBase);
    expect(bases.map((u) => u.code).sort()).toEqual(["kg", "l", "unidad"]);
  });
});
