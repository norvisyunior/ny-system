/**
 * Fichas de costo (simulación tipo hoja de cálculo).
 * Lógica centralizada de la Fase 1: calcula la ficha de un producto a partir de
 * su receta VIGENTE y los datos existentes (materias primas, unidades, tarifas
 * configuradas, empaques por paquete). Solo lectura: NO descuenta inventario,
 * NO escribe lotes, NO modifica recetas ni precios oficiales.
 */
import {
  masses,
  rawMaterials,
  recipeItems,
  recipeVersions,
  recipes,
  finishedProducts,
  laborRates,
} from "../../db/schema";
import { asc, eq } from "drizzle-orm";
import { z as zr } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { estimatedAvgCost } from "../domain/fifo";
import { decMicro, divRoundAway, mulQtyPrice } from "../domain/zod-helpers";
import { todayISO } from "../domain/dates";
import {
  computeEconomics,
  percentMicroToFractionMicro,
  priceBetweenUnits,
  type SheetEconomics,
} from "../domain/costsheets";
import type { DBOrTx } from "../domain/types";
import type { UnitsCatalog } from "../domain/units";
import { microToDecimalTrim } from "../../shared/money";
import { listMaterials } from "./materials";

const MICRO = 1_000_000;

// Límite sanidad del rendimiento por masa (paquetes): 1000 paquetes choque con
// erros de escritura (p. ej. cantidades cargadas en micro sin convertir).
export const MAX_YIELD_PER_MASS_MICRO = 1_000_000_000;

// ---------------------------------------------------------------------------
// Entrada de la simulación
// ---------------------------------------------------------------------------
export const costSheetInput = zr.object({
  recipeVersionId: zr.number().int().positive("Versión de receta requerida."),
  // Masas a simular (> 0). Se permite decimal en la simulación.
  masses: decMicro({ minExclusive: true }).optional(),
  // Paquetes previstos (0 permitido → sin costo por paquete).
  packages: decMicro().optional(),
  // Rendimiento simulado (> 0): paquetes por masa. Ausente → el de la receta.
  yield: decMicro({
    minExclusive: true,
    max: MAX_YIELD_PER_MASS_MICRO,
    maxLabel: "paquetes por masa",
  }).optional(),
  unitsPerPackage: zr
    .number()
    .int()
    .min(1, "Unidades por paquete debe ser entero ≥ 1.")
    .optional(),
  // Precio de venta simulado (micro-CUP). Ausente → precio oficial del producto.
  salePrice: decMicro().optional(),
  // Margen objetivo como porcentaje (30 → 30 %). Debe ser entre 0 y 100 %.
  marginTargetPct: decMicro()
    .optional()
    .refine(
      (v) => v === undefined || v < 100_000_000,
      "El margen objetivo debe ser menor que 100 %.",
    ),
  // Tarifas hipotéticas de la ficha (0 permitido → costo de mano de obra nulo).
  elabRate: decMicro().optional(),
  termRate: decMicro().optional(),
  // Overrides por ítem de receta: cantidad editada, material sustituto y/o
  // precio unitario manual por base (simulación tipo hoja de cálculo).
  items: zr
    .array(
      zr.object({
        id: zr.number().int("Ítem inválido."),
        qty: decMicro().optional(),
        materialId: zr.number().int().positive().optional(),
        unitPrice: decMicro().optional(),
      }),
    )
    .optional(),
  // Ítems de receta eliminados en la simulación (solo ficha; no toca la receta).
  removedIds: zr.array(zr.number().int().positive()).optional(),
  // Líneas nuevas de la simulación: material + cantidad (id temporal negativo
  // asignado por el frontend para referenciarlas en items).
  addItems: zr
    .array(
      zr.object({
        materialId: zr.number().int().positive("Material requerido."),
        qty: decMicro({ minExclusive: true }).optional(),
        phase: zr.enum(["masa", "paquete"]).default("masa"),
      }),
    )
    .optional(),
});
export type CostSheetInput = zr.infer<typeof costSheetInput>;

// ---------------------------------------------------------------------------
// Tipos de salida
// ---------------------------------------------------------------------------
export type PriceBasis = "promedio" | "ultimo" | "ninguno" | "manual";
export type RateBasis = "configurada" | "simulada" | "sin_configurar";

export interface CostItemLine {
  recipeItemId: number;
  rawMaterialId: number;
  originalMaterialId: number;
  originalName: string;
  substituted: boolean;
  name: string;
  category: string | null;
  phase: "masa" | "paquete";
  unitId: string; // unidad del ítem (de la receta)
  unitLabel: string;
  baseUnitId: string; // unidad base del material efectivo
  baseUnitLabel: string;
  qtyPerMicro: number; // por masa (fase masa) o por paquete (fase paquete)
  qtyPerOriginalMicro: number;
  qtyEdited: boolean;
  totalItemUnitMicro: number; // cantidad total en la unidad del ítem
  totalBaseMicro: number; // cantidad total en la unidad base del material
  pricePerBaseMicro: number | null;
  pricePerItemUnitMicro: number | null;
  priceBasis: PriceBasis;
  priceUnitId: string | null;
  priceDate: string | null;
  priceSupplier: string | null;
  costMicro: number;
  warnings: string[];
}

export interface QtyTotal {
  unitId: string;
  label: string;
  dimension: string;
  qtyMicro: number;
}

export interface CostSheet {
  recipeVersionId: number;
  recipeId: number;
  recipeName: string;
  version: number;
  productId: number;
  productName: string;
  productPresentation: string | null;
  saleUnitId: string;
  officialSalePriceMicro: number;
  officialUnitsPerPackage: number;
  massId: number;
  massName: string;
  massUnitId: string;
  expectedYieldMicro: number;
  yieldUnitId: string;
  consultationDate: string;

  defaults: {
    massesMicro: number;
    packagesMicro: number;
    unitsPerPackage: number;
    elabRateMicro: number | null;
    termRateMicro: number | null;
    salePriceMicro: number;
  };
  sim: {
    massesMicro: number;
    packagesMicro: number;
    expectedPackagesMicro: number; // masas × rendimiento (referencia teórica)
    unitsPerPackage: number;
    unitsTotalMicro: number;
    salePriceMicro: number;
    marginTargetPctMicro: number | null;
  };

  ingredients: CostItemLine[]; // fase 'masa'
  packaging: CostItemLine[]; // fase 'paquete'
  qtyTotals: QtyTotal[];
  laborElab: {
    massId: number;
    massName: string;
    massesMicro: number;
    rateMicro: number | null;
    rateBasis: RateBasis;
    costMicro: number;
  };
  laborTerm: {
    productId: number;
    productName: string;
    packagesMicro: number;
    unitsPerPackage: number;
    unitsTotalMicro: number;
    rateMicro: number | null;
    rateBasis: RateBasis;
    costMicro: number;
  };
  costs: {
    ingredientsMicro: number;
    laborElabMicro: number;
    laborTermMicro: number;
    packagingMicro: number;
    totalMicro: number;
  };
  hasMissingPrice: boolean;
  costPerPackageMicro: number | null;
  economics: SheetEconomics;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------
interface BuildOpts {
  massesMicro?: number;
  packagesMicro?: number;
  // Rendimiento simulado (paquetes por masa). Ausente → el de la receta.
  yieldMicro?: number;
  unitsPerPackage?: number;
  salePriceMicro?: number;
  marginTargetPctMicro?: number;
  elabRateMicro?: number;
  termRateMicro?: number;
  itemQty?: Map<number, number>;
  itemMaterial?: Map<number, number>;
  itemPrice?: Map<number, number>;
  removedIds?: Set<number>;
  addedItems?: { materialId: number; qtyMicro: number; phase: "masa" | "paquete" }[];
}

/** Mismo catálogo de unidades: compatible si la dimensión coincide y,
 *  en 'conteo', solo cuando la unidad es idéntica (no se convierten conteos). */
function compatibleUnits(catalog: UnitsCatalog, unitCode: string, baseCode: string): boolean {
  if (unitCode === baseCode) return true;
  try {
    const u = catalog.get(unitCode);
    const b = catalog.get(baseCode);
    return u.dimension === b.dimension && u.dimension !== "conteo";
  } catch {
    return false;
  }
}

/** Subtotales de cantidad: masa → kg; volumen → l; conteo → por unidad propia. */
function buildQtyTotals(catalog: UnitsCatalog, lines: CostItemLine[]): QtyTotal[] {
  const keys: { unit: string; dimension: string }[] = [];
  for (const l of lines) {
    const dim = catalog.get(l.baseUnitId).dimension;
    const unit = dim === "conteo" ? l.baseUnitId : dim === "masa" ? "kg" : "l";
    if (!keys.some((k) => k.unit === unit)) keys.push({ unit, dimension: dim });
  }
  const totals: QtyTotal[] = [];
  for (const k of keys) {
    let total = 0n;
    for (const l of lines) {
      if (l.baseUnitId === k.unit) {
        total += BigInt(l.totalBaseMicro);
      } else if (k.dimension !== "conteo" && catalog.get(l.baseUnitId).dimension === k.dimension) {
        total += BigInt(catalog.toBase(l.totalBaseMicro, l.baseUnitId, k.unit));
      }
    }
    totals.push({
      unitId: k.unit,
      label: catalog.get(k.unit).label,
      dimension: k.dimension,
      qtyMicro: Number(total),
    });
  }
  return totals;
}

function buildCostSheet(
  tx: DBOrTx,
  catalog: UnitsCatalog,
  recipeVersionId: number,
  opts: BuildOpts,
): CostSheet {
  const row = tx
    .select({
      versionId: recipeVersions.id,
      recipeId: recipes.id,
      recipeName: recipes.name,
      version: recipeVersions.version,
      status: recipeVersions.status,
      recipeActive: recipes.active,
      productId: recipes.productId,
      productName: finishedProducts.name,
      productPresentation: finishedProducts.presentation,
      productSaleUnit: finishedProducts.saleUnitId,
      productPriceMicro: finishedProducts.priceMicro,
      productUpp: finishedProducts.unitsPerPackage,
      massId: recipeVersions.massId,
      expectedYieldMicro: recipeVersions.expectedYieldMicro,
      yieldUnitId: recipeVersions.yieldUnitId,
      massName: masses.name,
      massUnitId: masses.unitId,
    })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .leftJoin(masses, eq(masses.id, recipeVersions.massId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
    .where(eq(recipeVersions.id, recipeVersionId))
    .get();
  if (!row) throw notFoundError("Versión de receta");
  if (!row.recipeActive) throw domainError(`La receta "${row.recipeName}" está inactiva.`);
  if (row.status !== "activa") {
    throw domainError(
      "La versión de la receta está archivada: la ficha de costo se calcula sobre una receta activa.",
    );
  }
  if (row.productId == null || !row.productName) {
    throw domainError(
      "La receta no está asociada a un producto terminado; la ficha de costo requiere un producto.",
    );
  }

  const itemRowsRaw = tx
    .select()
    .from(recipeItems)
    .where(eq(recipeItems.recipeVersionId, recipeVersionId))
    .orderBy(asc(recipeItems.id))
    .all();
  const itemsById = new Map(itemRowsRaw.map((i) => [i.id, i]));

  // Materias primas + último precio de compra confirmado (criterio actual del sistema).
  const matById = new Map(tx.select().from(rawMaterials).all().map((m) => [m.id, m]));

  // Ítems eliminados en la simulación (solo de la vista: nunca toca la receta).
  const removed = opts.removedIds ?? new Set<number>();
  const itemRows = itemRowsRaw.filter((i) => !removed.has(i.id));

  // Líneas nuevas de la simulación: material elegido + cantidad (id temporal
  // negativo), expresadas en la unidad base del material.
  const addedRows: (typeof recipeItems.$inferSelect)[] = [];
  for (let i = 0; i < (opts.addedItems?.length ?? 0); i++) {
    const add = opts.addedItems![i];
    const mat = matById.get(add.materialId);
    if (!mat) throw notFoundError("Materia prima agregada");
    if (!mat.active) {
      throw domainError(`El material "${mat.name}" está inactivo y no puede agregarse.`);
    }
    addedRows.push({
      id: -(i + 1),
      recipeVersionId: 0,
      rawMaterialId: mat.id,
      unitId: mat.unitId,
      qtyMicro: add.qtyMicro > 0 ? add.qtyMicro : 1_000_000,
      phase: add.phase,
    });
  }

  for (const [iid] of opts.itemQty ?? new Map<number, number>()) {
    if (iid >= 0 && !itemsById.has(iid)) throw domainError(`El ítem ${iid} no pertenece a la receta.`);
  }
  for (const [iid] of opts.itemMaterial ?? new Map<number, number>()) {
    if (iid >= 0 && !itemsById.has(iid)) throw domainError(`El ítem ${iid} no pertenece a la receta.`);
  }
  const lastByMat = new Map(
    listMaterials(tx, {}).map((m) => [m.id, m.lastPrice] as const),
  );

  // Tarifas configuradas (integración mínima: tabla labor_rates).
  const rateRows = tx.select().from(laborRates).all();
  const elabRateRow = rateRows.find((r) => r.kind === "masa" && r.massId === row.massId) ?? null;
  const termRateRow =
    rateRows.find((r) => r.kind === "terminacion" && r.productId === row.productId) ?? null;

  // --- Parámetros de la simulación (respaldo = ficha original) ---
  // Si solo se indican masas → paquetes derivados (masas × rendimiento).
  // Si solo se indican paquetes → masas derivadas (techo, como los planes).
  const yieldMicro = opts.yieldMicro ?? row.expectedYieldMicro;
  if (yieldMicro <= 0 || yieldMicro > MAX_YIELD_PER_MASS_MICRO) {
    const grande = microToDecimalTrim(yieldMicro, 3);
    throw domainError(
      yieldMicro <= 0
        ? "El rendimiento no puede ser cero: edite la receta o la simulación."
        : `El rendimiento (${grande} paquetes por masa) es irreal (máximo 1000): revísalo.`,
    );
  }
  const expectedYield = BigInt(yieldMicro);
  const packagesForMasses = (m: number): number =>
    Number(divRoundAway(BigInt(m) * expectedYield, BigInt(MICRO)));
  // Masas derivadas: techo(p ÷ y) en unidades y luego × MICRO (las masas van
  // siempre en micro-unidades; permite decimales como el resto de la ficha).
  const massesForPackages = (p: number): number =>
    p <= 0
      ? MICRO
      : Number((BigInt(Math.trunc(p)) + expectedYield - 1n) / expectedYield) * MICRO;
  let massesMicro: number;
  let packagesMicro: number;
  if (opts.massesMicro != null) {
    massesMicro = opts.massesMicro;
    packagesMicro = opts.packagesMicro ?? packagesForMasses(massesMicro);
  } else if (opts.packagesMicro != null) {
    packagesMicro = opts.packagesMicro;
    massesMicro = massesForPackages(packagesMicro);
  } else {
    massesMicro = MICRO; // 1 masa
    packagesMicro = packagesForMasses(massesMicro);
  }
  const unitsPerPackage = opts.unitsPerPackage ?? (row.productUpp ?? 1);
  const salePriceMicro = opts.salePriceMicro ?? (row.productPriceMicro ?? 0);
  const marginTargetPctMicro = opts.marginTargetPctMicro ?? null;

  const elabRate = opts.elabRateMicro ?? (elabRateRow ? elabRateRow.rateMicro : null);
  const termRate = opts.termRateMicro ?? (termRateRow ? termRateRow.rateMicro : null);
  const elabRateBasis: RateBasis =
    opts.elabRateMicro != null ? "simulada" : elabRateRow ? "configurada" : "sin_configurar";
  const termRateBasis: RateBasis =
    opts.termRateMicro != null ? "simulada" : termRateRow ? "configurada" : "sin_configurar";

  const warnings: string[] = [];

  const buildLine = (item: typeof recipeItems.$inferSelect): CostItemLine => {
    const overrideMatId = opts.itemMaterial?.get(item.id);
    const overrideQty = opts.itemQty?.get(item.id);
    const originalMat = matById.get(item.rawMaterialId);
    if (!originalMat) throw notFoundError("Materia prima de la receta");
    const effectiveMat =
      overrideMatId != null ? matById.get(overrideMatId) : originalMat;
    if (!effectiveMat) throw notFoundError("Materia prima sustituta");

    const line: CostItemLine = {
      recipeItemId: item.id,
      rawMaterialId: effectiveMat.id,
      originalMaterialId: originalMat.id,
      originalName: originalMat.name,
      substituted: overrideMatId != null && overrideMatId !== originalMat.id,
      name: effectiveMat.name,
      category: effectiveMat.category,
      phase: item.phase === "paquete" ? "paquete" : "masa",
      unitId: item.unitId,
      unitLabel: catalog.get(item.unitId).label,
      baseUnitId: effectiveMat.unitId,
      baseUnitLabel: catalog.get(effectiveMat.unitId).label,
      qtyPerMicro: overrideQty ?? item.qtyMicro,
      qtyPerOriginalMicro: item.qtyMicro,
      qtyEdited: overrideQty != null && overrideQty !== item.qtyMicro,
      totalItemUnitMicro: 0,
      totalBaseMicro: 0,
      pricePerBaseMicro: null,
      pricePerItemUnitMicro: null,
      priceBasis: "ninguno",
      priceUnitId: null,
      priceDate: null,
      priceSupplier: null,
      costMicro: 0,
      warnings: [],
    };

    const multiplierMicro = line.phase === "masa" ? massesMicro : packagesMicro;
    line.totalItemUnitMicro = Number(
      divRoundAway(
        BigInt(line.qtyPerMicro) * BigInt(Math.max(0, Math.trunc(multiplierMicro))),
        BigInt(MICRO),
      ),
    );

    // Conversión de cantidad (reglas vigentes del catálogo de unidades).
    const compatible =
      line.substituted === true || overrideMatId != null
        ? compatibleUnits(catalog, item.unitId, effectiveMat.unitId)
        : true;
    if (compatible) {
      line.totalBaseMicro = catalog.toBase(
        line.totalItemUnitMicro,
        item.unitId,
        effectiveMat.unitId,
      );
    } else {
      line.warnings.push(
        `Sustitución incompatible: la unidad "${line.unitId}" no se puede convertir a la unidad base ` +
          `"${effectiveMat.unitId}" del material. Revise la sustitución.`,
      );
    }

    if (!effectiveMat.active) {
      line.warnings.push(
        `El material "${effectiveMat.name}" está inactivo: su costo no puede estimarse. Revise la sustitución.`,
      );
      return line;
    }
    if (compatible) {
      // Precio por unidad base: override manual → promedio PEPS vigente →
      // último precio de compra confirmado.
      const manualPriceMicro = opts.itemPrice?.get(item.id);
      if (manualPriceMicro != null) {
        line.priceBasis = "manual";
        line.pricePerBaseMicro = manualPriceMicro;
      } else {
        const avg = estimatedAvgCost(tx, "raw", effectiveMat.id);
        if (avg > 0) {
          line.priceBasis = "promedio";
          line.pricePerBaseMicro = avg;
        } else {
          const lp = lastByMat.get(effectiveMat.id) ?? null;
          if (lp) {
            if (compatibleUnits(catalog, lp.unitId, effectiveMat.unitId)) {
              line.priceBasis = "ultimo";
              line.pricePerBaseMicro = priceBetweenUnits(
                catalog,
                lp.priceMicro,
                lp.unitId,
                effectiveMat.unitId,
              );
              line.priceUnitId = lp.unitId;
              line.priceDate = lp.date;
              line.priceSupplier = lp.supplier;
            } else {
              line.warnings.push(
                `El último precio de "${effectiveMat.name}" está expresado en "${lp.unitId}", unidad incompatible con su base: sin precio usable.`,
              );
            }
          }
        }
      }
      if (line.pricePerBaseMicro != null) {
        line.pricePerItemUnitMicro = priceBetweenUnits(
          catalog,
          line.pricePerBaseMicro,
          effectiveMat.unitId,
          item.unitId,
        );
        line.costMicro = mulQtyPrice(line.totalBaseMicro, line.pricePerBaseMicro);
      } else {
        line.warnings.push(
          `"${effectiveMat.name}" no tiene precio (sin existencias valorizadas ni compras confirmadas): su costo NO está incluido en el total.`,
        );
      }
    }
    return line;
  };

  const ingredients: CostItemLine[] = [];
  const packaging: CostItemLine[] = [];
  let hasMissingPrice = false;
  for (const item of [...itemRows, ...addedRows]) {
    const line = buildLine(item);
    if (line.pricePerBaseMicro == null) hasMissingPrice = true;
    if (line.phase === "masa") ingredients.push(line);
    else packaging.push(line);
  }
  if (ingredients.length === 0) {
    throw domainError("La ficha no tiene ingredientes de masa desde los que calcular el costo.");
  }

  let ingredientsMicro = 0;
  let packagingMicro = 0;
  for (const l of [...ingredients, ...packaging]) {
    if (l.phase === "masa") ingredientsMicro += l.costMicro;
    else packagingMicro += l.costMicro;
    warnings.push(...l.warnings);
  }

  const qtyTotals = buildQtyTotals(catalog, ingredients);

  // --- Mano de obra ---
  const elabCostMicro = elabRate != null ? mulQtyPrice(massesMicro, elabRate) : 0;
  if (elabRate == null) {
    warnings.push(
      `Falta configurar la tarifa de elaboración para la masa "${row.massName ?? ""}": el total NO incluye mano de obra de elaboración.`,
    );
  }
  const unitsTotalMicro = Number(
    BigInt(packagesMicro) * BigInt(unitsPerPackage),
  ); // paquetes (micro conteo) × unidades por paquete → unidades individuales en micro
  const termCostMicro = termRate != null ? mulQtyPrice(unitsTotalMicro, termRate) : 0;
  if (termRate == null) {
    warnings.push(
      `Falta configurar la tarifa de terminación para el producto "${row.productName}" (tarifa por unidad individual): el total NO incluye mano de obra de terminación.`,
    );
  }
  if (packagesMicro <= 0 && packaging.length > 0) {
    warnings.push(
      "La cantidad prevista de paquetes es 0: no hay consumo de empaques por paquete ni costo por paquete.",
    );
  }

  // --- Totales y economía ---
  const totalMicro = ingredientsMicro + elabCostMicro + termCostMicro + packagingMicro;
  const costPerPackageMicro =
    packagesMicro > 0
      ? Number(divRoundAway(BigInt(totalMicro) * BigInt(MICRO), BigInt(packagesMicro)))
      : null;

  const marginTargetFractionMicro =
    marginTargetPctMicro != null ? percentMicroToFractionMicro(marginTargetPctMicro) : null;
  const economics = computeEconomics(costPerPackageMicro, salePriceMicro, marginTargetFractionMicro);
  warnings.push(...economics.notes);

  return {
    recipeVersionId: row.versionId,
    recipeId: row.recipeId,
    recipeName: row.recipeName,
    version: row.version,
    productId: row.productId,
    productName: row.productName,
    productPresentation: row.productPresentation ?? null,
    saleUnitId: row.productSaleUnit ?? "unidad",
    officialSalePriceMicro: row.productPriceMicro ?? 0,
    officialUnitsPerPackage: row.productUpp ?? 1,
    massId: row.massId,
    massName: row.massName ?? "",
    massUnitId: row.massUnitId ?? "",
    expectedYieldMicro: row.expectedYieldMicro,
    yieldUnitId: row.yieldUnitId,
    consultationDate: todayISO(),
    defaults: {
      massesMicro: MICRO,
      packagesMicro: packagesForMasses(MICRO),
      unitsPerPackage: row.productUpp ?? 1,
      elabRateMicro: elabRateRow ? elabRateRow.rateMicro : null,
      termRateMicro: termRateRow ? termRateRow.rateMicro : null,
      salePriceMicro: row.productPriceMicro ?? 0,
    },
    sim: {
      massesMicro,
      packagesMicro,
      expectedPackagesMicro: Number(
        divRoundAway(BigInt(massesMicro) * BigInt(yieldMicro), BigInt(MICRO)),
      ),
      unitsPerPackage,
      unitsTotalMicro,
      salePriceMicro,
      marginTargetPctMicro,
    },
    ingredients,
    packaging,
    qtyTotals,
    laborElab: {
      massId: row.massId,
      massName: row.massName ?? "",
      massesMicro,
      rateMicro: elabRate,
      rateBasis: elabRateBasis,
      costMicro: elabCostMicro,
    },
    laborTerm: {
      productId: row.productId,
      productName: row.productName,
      packagesMicro,
      unitsPerPackage,
      unitsTotalMicro,
      rateMicro: termRate,
      rateBasis: termRateBasis,
      costMicro: termCostMicro,
    },
    costs: {
      ingredientsMicro,
      laborElabMicro: elabCostMicro,
      laborTermMicro: termCostMicro,
      packagingMicro,
      totalMicro,
    },
    hasMissingPrice,
    costPerPackageMicro,
    economics,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// API pública (solo cálculo; nunca descuenta inventario)
// ---------------------------------------------------------------------------
export function getCostSheet(
  db: DBOrTx,
  catalog: UnitsCatalog,
  recipeVersionId: number,
): CostSheet {
  return buildCostSheet(db, catalog, recipeVersionId, {});
}

export function previewCostSheet(
  db: DBOrTx,
  catalog: UnitsCatalog,
  input: CostSheetInput,
): CostSheet {
  return buildCostSheet(db, catalog, input.recipeVersionId, {
    massesMicro: input.masses,
    packagesMicro: input.packages,
    yieldMicro: input.yield,
    unitsPerPackage: input.unitsPerPackage,
    salePriceMicro: input.salePrice,
    marginTargetPctMicro: input.marginTargetPct,
    elabRateMicro: input.elabRate,
    termRateMicro: input.termRate,
    itemQty: new Map(
      (input.items ?? [])
        .filter((i) => i.qty !== undefined)
        .map((i) => [i.id, i.qty as number]),
    ),
    itemMaterial: new Map(
      (input.items ?? [])
        .filter((i) => i.materialId !== undefined)
        .map((i) => [i.id, i.materialId as number]),
    ),
    itemPrice: new Map(
      (input.items ?? [])
        .filter((i) => i.unitPrice !== undefined)
        .map((i) => [i.id, i.unitPrice as number]),
    ),
    removedIds: new Set(input.removedIds ?? []),
    addedItems: (input.addItems ?? []).map((a) => ({
      materialId: a.materialId,
      qtyMicro: a.qty && a.qty > 0 ? a.qty : 1_000_000, // sin cantidad → 1 unidad base
      phase: a.phase,
    })),
  });
}

export function normalizeCostSheetInput(rhs: unknown): CostSheetInput {
  return costSheetInput.parse(rhs);
}
