import type { InferSelectModel } from "drizzle-orm";
import { units } from "../../db/schema";

export type UnitRow = InferSelectModel<typeof units>;

export const DIMENSIONS = ["masa", "volumen", "longitud", "conteo"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/**
 * Catálogo en memoria de unidades. Se carga al arrancar el servidor.
 * Conversión: cantidades en micro-unidades de la unidad BASE de su dimensión.
 *
 * Reglas:
 * - Solo se convierte entre unidades de la MISMA dimensión.
 * - En dimensión 'conteo' NO hay conversión automática entre unidades
 *   distintas (paquete ≠ caja ≠ unidad): cada ítem se mide en su propia unidad.
 */
export class UnitsCatalog {
  private byCode = new Map<string, UnitRow>();

  constructor(rows: UnitRow[]) {
    for (const row of rows) this.byCode.set(row.code, row);
  }

  get(code: string): UnitRow {
    const unit = this.byCode.get(code);
    if (!unit) throw new Error(`Unidad desconocida: ${code}`);
    return unit;
  }

  all(): UnitRow[] {
    return [...this.byCode.values()];
  }

  /** Convierte una cantidad en micro-unidades de `unitCode` a micro-unidades de `baseCode`. */
  toBase(qtyMicro: number, unitCode: string, baseCode: string): number {
    if (unitCode === baseCode) return Math.trunc(qtyMicro);
    const unit = this.get(unitCode);
    const base = this.get(baseCode);
    if (unit.dimension !== base.dimension) {
      throw new UnitsConversionError(
        `No se puede convertir "${unitCode}" (${unit.dimension}) a "${baseCode}" (${base.dimension}): dimensiones distintas.`,
      );
    }
    if (unit.dimension === "conteo") {
      throw new UnitsConversionError(
        `No se permite la conversión automática entre unidades de conteo ("${unitCode}" → "${baseCode}"). Use la unidad base del ítem.`,
      );
    }
    // qtyBaseMicro = qtyMicro × factor(unit) / factor(base)
    const num = BigInt(Math.trunc(qtyMicro)) * BigInt(unit.factor);
    const den = BigInt(base.factor);
    const neg = num < 0n;
    const abs = neg ? -num : num;
    const q = abs / den;
    const r = abs % den;
    const rounded = r * 2n >= den ? q + 1n : q;
    const result = neg ? -rounded : rounded;
    return Number(result);
  }

  /** Verifica que la unidad sea válida para el ítem (misma dimensión que la base). */
  assertCompatible(unitCode: string, baseCode: string): void {
    if (unitCode === baseCode) return;
    const unit = this.get(unitCode);
    const base = this.get(baseCode);
    if (unit.dimension !== base.dimension) {
      throw new UnitsConversionError(
        `La unidad "${unitCode}" no es compatible con la unidad base "${baseCode}".`,
      );
    }
  }
}

export class UnitsConversionError extends Error {
  readonly userFacing = true;
  constructor(message: string) {
    super(message);
    this.name = "UnitsConversionError";
  }
}

/** Semilla de unidades. Se insertan solo si la tabla está vacía. */
export const UNITS_SEED: UnitRow[] = [
  { code: "kg", label: "Kilogramo", dimension: "masa", factor: 1_000_000, isBase: true },
  { code: "g", label: "Gramo", dimension: "masa", factor: 1_000, isBase: false },
  { code: "lb", label: "Libra", dimension: "masa", factor: 453_592, isBase: false },
  { code: "l", label: "Litro", dimension: "volumen", factor: 1_000_000, isBase: true },
  { code: "ml", label: "Mililitro", dimension: "volumen", factor: 1_000, isBase: false },
  { code: "m", label: "Metro", dimension: "longitud", factor: 1_000_000, isBase: true },
  { code: "cm", label: "Centímetro", dimension: "longitud", factor: 10_000, isBase: false },
  { code: "mm", label: "Milímetro", dimension: "longitud", factor: 1_000, isBase: false },
  { code: "unidad", label: "Unidad", dimension: "conteo", factor: 1_000_000, isBase: true },
  { code: "paquete", label: "Paquete", dimension: "conteo", factor: 1_000_000, isBase: false },
  { code: "caja", label: "Caja", dimension: "conteo", factor: 1_000_000, isBase: false },
];
