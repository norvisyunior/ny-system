/**
 * Fórmulas centralizadas de la ficha de costo (simulación tipo hoja de cálculo).
 * TODO aquí es cálculo puro: NO descuenta inventario, NO escribe lotes,
 * NO modifica recetas ni precios. Las operaciones reales del negocio
 * (producciones.ts / transformations.ts) conservan su propia lógica PEPS.
 */
import { divRoundAway } from "../../shared/money";
import type { UnitsCatalog } from "./units";

const MICRO = 1_000_000n;

/** Precio por unidad completa `toUnit` a partir de un precio por unidad `fromUnit`. */
export function priceBetweenUnits(
  catalog: UnitsCatalog,
  pricePerFromUnitMicro: number,
  fromUnit: string,
  toUnit: string,
): number {
  if (fromUnit === toUnit) return pricePerFromUnitMicro;
  const from = catalog.get(fromUnit);
  const to = catalog.get(toUnit);
  if (from.dimension !== to.dimension) {
    throw new Error(
      `No se puede expresar el precio en "${toUnit}": unidad incompatible con "${fromUnit}".`,
    );
  }
  // precio por micro-unidad = precio / factor(from); precio por unidad to = precio/micro × factor(to)
  return Number(
    divRoundAway(BigInt(Math.trunc(pricePerFromUnitMicro)) * BigInt(to.factor), BigInt(from.factor)),
  );
}

/** Eleva un porcentaje en micro (30 → 3e7) a fracción en micro (0.30 → 3e5). */
export function percentMicroToFractionMicro(percentMicro: number): number {
  return Number(BigInt(Math.trunc(percentMicro)) / 100n);
}

/** Margen bruto (%) en micro: 30% → 3e7. null si el precio de venta es 0. */
export function marginPctMicro(
  salePriceMicro: number,
  costPerPackageMicro: number,
): number | null {
  if (salePriceMicro <= 0) return null;
  const profit = BigInt(Math.trunc(salePriceMicro - costPerPackageMicro));
  return Number(divRoundAway(profit * 100n * MICRO, BigInt(Math.trunc(salePriceMicro))));
}

/**
 * Bloque económico de la ficha. `marginTargetFractionMicro`: fracción en micro
 * (30% → 3e5); nulo = sin margen objetivo configurado.
 */
export interface SheetEconomics {
  salePriceMicro: number;
  costPerPackageMicro: number | null;
  grossProfitMicro: number | null;
  marginPctMicro: number | null;
  marginTargetFractionMicro: number | null;
  recommendedPriceMicro: number | null;
  notes: string[];
}

export function computeEconomics(
  costPerPackageMicro: number | null,
  salePriceMicro: number | null,
  marginTargetFractionMicro: number | null,
): SheetEconomics {
  const economics: SheetEconomics = {
    salePriceMicro: salePriceMicro ?? 0,
    costPerPackageMicro,
    grossProfitMicro: null,
    marginPctMicro: null,
    marginTargetFractionMicro,
    recommendedPriceMicro: null,
    notes: [],
  };
  if (costPerPackageMicro == null) {
    economics.notes.push(
      "Sin costo por paquete: no se puede calcular el margen ni el precio recomendado.",
    );
    return economics;
  }
  if (economics.salePriceMicro == null || economics.salePriceMicro <= 0) {
    economics.notes.push("Introduzca un precio de venta para calcular la ganancia y el margen.");
    return economics;
  }
  economics.grossProfitMicro = economics.salePriceMicro - costPerPackageMicro;
  economics.marginPctMicro = marginPctMicro(economics.salePriceMicro, costPerPackageMicro);
  if (marginTargetFractionMicro != null) {
    // precio recomendado = costo / (1 − margen objetivo) — margen sobre venta, no recargo sobre costo
    const denom = MICRO - BigInt(Math.trunc(marginTargetFractionMicro));
    if (denom <= 0n) {
      economics.notes.push(
        "El margen objetivo debe ser menor que 100 % para poder calcular un precio recomendado.",
      );
    } else {
      economics.recommendedPriceMicro = Number(
        divRoundAway(BigInt(costPerPackageMicro) * MICRO, denom),
      );
    }
  } else {
    economics.notes.push(
      "Indique un margen objetivo para obtener el precio de venta recomendado.",
    );
  }
  return economics;
}
