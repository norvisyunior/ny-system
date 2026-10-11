import { describe, expect, it } from "vitest";
import {
  addMicro,
  assertSafeInt,
  divRoundAway,
  formatCUP,
  microToDecimal,
  mulQtyPrice,
  parseDecimalToMicro,
} from "../shared/money";

describe("parseDecimalToMicro", () => {
  it("convierte decimales a micro-CUP enteros", () => {
    expect(parseDecimalToMicro("1.50")).toBe(1_500_000);
    expect(parseDecimalToMicro("0.000001")).toBe(1);
    expect(parseDecimalToMicro("100")).toBe(100_000_000);
    expect(parseDecimalToMicro("0")).toBe(0);
    expect(parseDecimalToMicro("  2.5  ")).toBe(2_500_000);
    expect(parseDecimalToMicro("1.123456")).toBe(1_123_456);
  });

  it("acepta negativos", () => {
    expect(parseDecimalToMicro("-2.5")).toBe(-2_500_000);
    expect(parseDecimalToMicro("-0.000001")).toBe(-1);
  });

  it("acepta numbers usando su representación decimal corta", () => {
    expect(parseDecimalToMicro(1.5)).toBe(1_500_000);
    expect(parseDecimalToMicro(0.1)).toBe(100_000);
    expect(parseDecimalToMicro(0)).toBe(0);
  });

  it("rechaza entradas inválidas", () => {
    expect(() => parseDecimalToMicro("1.2.3")).toThrow();
    expect(() => parseDecimalToMicro("")).toThrow();
    expect(() => parseDecimalToMicro("abc")).toThrow();
    expect(() => parseDecimalToMicro("1e5")).toThrow();
    expect(() => parseDecimalToMicro("1.1234567")).toThrow();
    expect(() => parseDecimalToMicro(Number.NaN)).toThrow();
    expect(() => parseDecimalToMicro(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("microToDecimal", () => {
  it("formatea con 2 decimales y redondea half-away-from-zero", () => {
    expect(microToDecimal(1_500_000)).toBe("1.50");
    expect(microToDecimal(1_234_567)).toBe("1.23");
    expect(microToDecimal(1_235_000)).toBe("1.24");
    expect(microToDecimal(0)).toBe("0.00");
    expect(microToDecimal(-1_500_000)).toBe("-1.50");
    expect(microToDecimal(-1_235_000)).toBe("-1.24");
  });

  it("media unidad redondea alejándose de cero en ambos sentidos", () => {
    expect(microToDecimal(1_500_000, 0)).toBe("2");
    expect(microToDecimal(-1_500_000, 0)).toBe("-2");
    expect(microToDecimal(1_499_999, 0)).toBe("1");
    expect(microToDecimal(-1_499_999, 0)).toBe("-1");
  });

  it("soporta 0 a 6 decimales", () => {
    expect(microToDecimal(1, 6)).toBe("0.000001");
    expect(microToDecimal(1_000_000, 0)).toBe("1");
    expect(microToDecimal(9_999_999, 2)).toBe("10.00");
    expect(microToDecimal(1_000_000, 3)).toBe("1.000");
    expect(microToDecimal(123_456, 5)).toBe("0.12346");
    expect(microToDecimal(123_456, 4)).toBe("0.1235");
  });

  it("rechaza decimales fuera de rango o no enteros", () => {
    expect(() => microToDecimal(1, 7)).toThrow();
    expect(() => microToDecimal(1, -1)).toThrow();
    expect(() => microToDecimal(1, 1.5)).toThrow();
  });
});

describe("mulQtyPrice", () => {
  it("multiplica cantidad × precio en micro-enteros", () => {
    expect(mulQtyPrice(1_500_000, 1_500_000)).toBe(2_250_000);
    expect(mulQtyPrice(50_000_000, 1_500_000)).toBe(75_000_000);
    expect(mulQtyPrice(10_000_000, 600_000)).toBe(6_000_000);
    expect(mulQtyPrice(0, 1_500_000)).toBe(0);
  });

  it("redondea half-away-from-zero en fracciones de micro-CUP", () => {
    expect(mulQtyPrice(1, 500_000)).toBe(1);
    expect(mulQtyPrice(1, 499_999)).toBe(0);
    expect(mulQtyPrice(-1, 500_000)).toBe(-1);
    expect(mulQtyPrice(-1, 499_999)).toBe(0);
  });
});

describe("divRoundAway", () => {
  it("redondea .5 alejándose de cero", () => {
    expect(divRoundAway(1n, 2n)).toBe(1n);
    expect(divRoundAway(-1n, 2n)).toBe(-1n);
    expect(divRoundAway(3n, 2n)).toBe(2n);
    expect(divRoundAway(1n, 3n)).toBe(0n);
    expect(divRoundAway(2n, 3n)).toBe(1n);
  });

  it("rechaza división por cero", () => {
    expect(() => divRoundAway(1n, 0n)).toThrow();
  });
});

describe("addMicro y assertSafeInt", () => {
  it("suma micro-enteros sin error de rango", () => {
    expect(addMicro(1_500_000, 2_500_000, -1_000_000)).toBe(3_000_000);
    expect(addMicro()).toBe(0);
  });

  it("detecta enteros fuera de rango seguro", () => {
    expect(() => assertSafeInt(Number.MAX_SAFE_INTEGER + 2)).toThrow();
    expect(assertSafeInt(42)).toBe(42);
  });
});

describe("formatCUP", () => {
  it("formatea con separadores de miles", () => {
    expect(formatCUP(123_456_789)).toBe("$ 123.46");
    expect(formatCUP(1_234_567_890_123)).toBe("$ 1,234,567.89");
    expect(formatCUP(0)).toBe("$ 0.00");
    expect(formatCUP(500_000)).toBe("$ 0.50");
    expect(formatCUP(-1_500_000)).toBe("$ -1.50");
    expect(formatCUP(1_500_000, { symbol: false })).toBe("1.50");
  });
});
