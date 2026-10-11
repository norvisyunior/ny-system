import {
  productionPlans,
  productionBatches,
  recipeVersions,
  recipeItems,
  recipes,
  finishedProducts,
  masses,
  rawMaterials,
} from "../../db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { nextDocNumber } from "../domain/counters";
import { assertValidBusinessDate } from "../domain/dates";
import { availableStock, estimatedAvgCost } from "../domain/fifo";
import { decMicro, divRoundAway, mulQtyPrice } from "../domain/zod-helpers";
import { microToDecimal } from "../../shared/money";
import type { DBOrTx } from "../domain/types";
import type { UnitsCatalog } from "../domain/units";

export const planPreviewInput = z.object({
  recipeVersionId: z.number().int().positive("Versión de receta requerida."),
  targetPackages: decMicro({ minExclusive: true }),
});
export type PlanPreviewInput = z.infer<typeof planPreviewInput>;

export const planInput = planPreviewInput.extend({
  planDate: z.string().min(1, "Fecha requerida."),
  notes: z.string().trim().max(500).optional().nullable(),
  clientToken: z.string().trim().min(8).max(64).optional().nullable(),
});
export type PlanInput = z.infer<typeof planInput>;

export interface PlanMaterialLine {
  rawMaterialId: number;
  name: string;
  unitId: string; // unidad base del material
  itemUnitId: string; // unidad del ítem de receta (perMasa / perPaquete)
  phase: "masa" | "paquete";
  perMasaMicro: number | null; // por masa (solo fase masa)
  perPaqueteMicro: number | null; // por paquete (solo fase paquete)
  qtyNeededMicro: number; // total convertido a unidad base
  availableMicro: number;
  missingMicro: number;
  avgCostMicro: number; // costo promedio actual por unidad base (estimación)
  estimatedCostMicro: number;
}

export interface PlanPreview {
  recipeId: number;
  recipeVersionId: number;
  recipeName: string;
  version: number;
  productId: number;
  productName: string;
  productSaleUnit: string;
  massId: number;
  massName: string;
  massUnit: string;
  targetPackagesMicro: number;
  expectedYieldMicro: number; // paquetes por masa
  plannedMassesMicro: number; // masas necesarias (enteras)
  ingredients: PlanMaterialLine[]; // fase masa
  packaging: PlanMaterialLine[]; // fase paquete
  estimatedTotalCostMicro: number;
  estimatedCostPerPackageMicro: number;
  warnings: string[];
}

const MICRO = 1_000_000;

function assertWholeNumber(micro: number, what: string): void {
  if (micro % MICRO !== 0) {
    throw domainError(`${what} debe ser un número entero.`);
  }
}

/** masas necesarias = ceil(paquetes deseados / rendimiento esperado por masa). Devuelve masas ENTERAS. */
export function plannedMasses(targetPackagesMicro: number, yieldPerMassMicro: number): number {
  if (yieldPerMassMicro <= 0) throw domainError("El rendimiento esperado debe ser mayor que cero.");
  const t = BigInt(targetPackagesMicro);
  const y = BigInt(yieldPerMassMicro);
  const massesCount = (t + y - 1n) / y; // techo
  return Number(massesCount);
}

function lineFor(
  catalog: UnitsCatalog,
  tx: DBOrTx,
  item: { rawMaterialId: number; unitId: string; qtyMicro: number; phase: string },
  multiplierMicro: number,
  opts: { perMasa: boolean },
): PlanMaterialLine {
  const mat = tx.select().from(rawMaterials).where(eq(rawMaterials.id, item.rawMaterialId)).get();
  if (!mat) throw notFoundError("Materia prima");
  // total en la unidad del ítem de receta → unidad base del material
  const totalItemUnit = Number(
    divRoundAway(BigInt(item.qtyMicro) * BigInt(multiplierMicro), BigInt(MICRO)),
  );
  const neededBase = catalog.toBase(totalItemUnit, item.unitId, mat.unitId);
  const available = availableStock(tx, "raw", mat.id);
  const missing = Math.max(0, neededBase - available);
  const avgCost = estimatedAvgCost(tx, "raw", mat.id);
  return {
    rawMaterialId: mat.id,
    name: mat.name,
    unitId: mat.unitId,
    itemUnitId: item.unitId,
    phase: item.phase === "paquete" ? "paquete" : "masa",
    perMasaMicro: opts.perMasa ? item.qtyMicro : null,
    perPaqueteMicro: opts.perMasa ? null : item.qtyMicro,
    qtyNeededMicro: neededBase,
    availableMicro: available,
    missingMicro: missing,
    avgCostMicro: avgCost,
    estimatedCostMicro: mulQtyPrice(neededBase, avgCost),
  };
}

/**
 * Calcula el plan de producción para un objetivo de paquetes.
 * Solo calcula: NO descuenta inventario ni registra movimientos.
 */
export function computePlanPreview(
  tx: DBOrTx,
  catalog: UnitsCatalog,
  recipeVersionId: number,
  targetPackagesMicro: number,
): PlanPreview {
  assertWholeNumber(targetPackagesMicro, "La cantidad deseada de paquetes");

  const row = tx
    .select({
      versionId: recipeVersions.id,
      recipeId: recipes.id,
      recipeName: recipes.name,
      recipeActive: recipes.active,
      productId: recipes.productId,
      version: recipeVersions.version,
      status: recipeVersions.status,
      massId: recipeVersions.massId,
      expectedYieldMicro: recipeVersions.expectedYieldMicro,
      yieldUnitId: recipeVersions.yieldUnitId,
      massName: masses.name,
      massUnit: masses.unitId,
      productName: finishedProducts.name,
      productSaleUnit: finishedProducts.saleUnitId,
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
      `La versión v${row.version} de la receta está archivada. Planifique con la versión activa.`,
    );
  }
  if (row.productId == null || !row.productName) {
    throw domainError(
      "La receta no está asociada a un producto terminado; no se puede planificar la producción.",
    );
  }
  if (row.yieldUnitId !== row.productSaleUnit) {
    throw domainError(
      `El rendimiento de la receta debe expresarse en la unidad de venta del producto (${row.productSaleUnit}).`,
    );
  }

  const massesNeeded = plannedMasses(targetPackagesMicro, row.expectedYieldMicro);
  const plannedMassesMicro = massesNeeded * MICRO;

  const recipeItemsRows = tx
    .select()
    .from(recipeItems)
    .where(eq(recipeItems.recipeVersionId, recipeVersionId))
    .all();

  const ingredients: PlanMaterialLine[] = [];
  const packaging: PlanMaterialLine[] = [];
  const warnings: string[] = [];

  for (const item of recipeItemsRows) {
    if (item.phase === "masa") {
      const line = lineFor(catalog, tx, item, plannedMassesMicro, { perMasa: true });
      ingredients.push(line);
    } else {
      const line = lineFor(catalog, tx, item, targetPackagesMicro, { perMasa: false });
      packaging.push(line);
    }
  }
  if (ingredients.length === 0) {
    throw domainError("La versión de la receta no tiene ingredientes por masa.");
  }

  let estimatedTotalCostMicro = 0;
  for (const line of [...ingredients, ...packaging]) {
    estimatedTotalCostMicro += line.estimatedCostMicro;
    if (line.missingMicro > 0) {
      warnings.push(
        `Falta ${microToDecimal(line.missingMicro, 3)} ${line.unitId} de ${line.name}.`,
      );
    }
    if (line.availableMicro <= 0) {
      warnings.push(`Sin existencias de ${line.name} para estimar su costo.`);
    }
  }

  const estimatedCostPerPackageMicro =
    targetPackagesMicro > 0
      ? Number(divRoundAway(BigInt(estimatedTotalCostMicro) * BigInt(MICRO), BigInt(targetPackagesMicro)))
      : 0;

  return {
    recipeId: row.recipeId,
    recipeVersionId: row.versionId,
    recipeName: row.recipeName,
    version: row.version,
    productId: row.productId,
    productName: row.productName,
    productSaleUnit: row.productSaleUnit,
    massId: row.massId,
    massName: row.massName ?? "",
    massUnit: row.massUnit ?? "",
    targetPackagesMicro,
    expectedYieldMicro: row.expectedYieldMicro,
    plannedMassesMicro,
    ingredients,
    packaging,
    estimatedTotalCostMicro,
    estimatedCostPerPackageMicro,
    warnings,
  };
}

/** Vista previa sin efectos secundarios (no descuenta inventario). */
export function previewPlan(
  db: DBOrTx,
  catalog: UnitsCatalog,
  input: PlanPreviewInput,
): PlanPreview {
  return db.transaction((tx) =>
    computePlanPreview(tx, catalog, input.recipeVersionId, input.targetPackages),
  );
}

/** Confirma (registra) la planificación. No modifica inventarios. */
export function createPlan(db: DBOrTx, catalog: UnitsCatalog, input: PlanInput) {
  return db.transaction((tx) => {
    if (input.clientToken) {
      const existing = tx
        .select()
        .from(productionPlans)
        .where(eq(productionPlans.clientToken, input.clientToken))
        .get();
      if (existing) return planRowToResult(existing);
    }
    assertValidBusinessDate(tx, input.planDate, { label: "La fecha del plan" });

    const preview = computePlanPreview(tx, catalog, input.recipeVersionId, input.targetPackages);
    const number = nextDocNumber(tx, "plan");
    const [plan] = tx
      .insert(productionPlans)
      .values({
        number,
        planDate: input.planDate,
        recipeVersionId: input.recipeVersionId,
        targetPackagesMicro: input.targetPackages,
        expectedYieldMicro: preview.expectedYieldMicro,
        plannedMassesMicro: preview.plannedMassesMicro,
        previewJson: JSON.stringify(preview),
        notes: input.notes ?? null,
        clientToken: input.clientToken ?? null,
      })
      .returning()
      .all();

    logAudit(tx, {
      action: "plan.create",
      entityType: "production_plan",
      entityId: plan.id,
      summary:
        `Plan #${String(number).padStart(5, "0")} creado: ${preview.productName} — ` +
        `${microToDecimal(input.targetPackages, 0)} paquetes → ` +
        `${microToDecimal(preview.plannedMassesMicro, 0)} masas`,
      details: {
        targetPackagesMicro: input.targetPackages,
        plannedMassesMicro: preview.plannedMassesMicro,
        estimatedTotalCostMicro: preview.estimatedTotalCostMicro,
        warnings: preview.warnings,
      },
    });

    return planRowToResult(plan, preview);
  });
}

function planRowToResult(plan: typeof productionPlans.$inferSelect, preview?: PlanPreview) {
  const parsed: PlanPreview | undefined = preview ?? safeParsePreview(plan.previewJson);
  return {
    id: plan.id,
    number: plan.number,
    planDate: plan.planDate,
    recipeVersionId: plan.recipeVersionId,
    targetPackagesMicro: plan.targetPackagesMicro,
    expectedYieldMicro: plan.expectedYieldMicro,
    plannedMassesMicro: plan.plannedMassesMicro,
    status: plan.status,
    notes: plan.notes,
    preview: parsed ?? null,
  };
}

function safeParsePreview(json: string): PlanPreview | undefined {
  try {
    return JSON.parse(json) as PlanPreview;
  } catch {
    return undefined;
  }
}

export interface PlanListRow {
  id: number;
  number: number;
  planDate: string;
  status: string;
  recipeName: string | null;
  version: number | null;
  productName: string | null;
  massName: string | null;
  targetPackagesMicro: number;
  expectedYieldMicro: number;
  plannedMassesMicro: number;
  elaboratedMassesMicro: number;
  notes: string | null;
  createdAt: string;
}

export function listPlans(db: DBOrTx): PlanListRow[] {
  return db
    .select({
      id: productionPlans.id,
      number: productionPlans.number,
      planDate: productionPlans.planDate,
      status: productionPlans.status,
      recipeName: recipes.name,
      version: recipeVersions.version,
      productName: finishedProducts.name,
      massName: masses.name,
      targetPackagesMicro: productionPlans.targetPackagesMicro,
      expectedYieldMicro: productionPlans.expectedYieldMicro,
      plannedMassesMicro: productionPlans.plannedMassesMicro,
      elaboratedMassesMicro: sql<number>`COALESCE((
        SELECT SUM(pb.real_yield_micro) FROM production_batches pb
        WHERE pb.plan_id = ${productionPlans.id} AND pb.status = 'confirmada'
      ), 0)`,
      notes: productionPlans.notes,
      createdAt: productionPlans.createdAt,
    })
    .from(productionPlans)
    .innerJoin(recipeVersions, eq(recipeVersions.id, productionPlans.recipeVersionId))
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
    .leftJoin(masses, eq(masses.id, recipeVersions.massId))
    .orderBy(desc(productionPlans.planDate), desc(productionPlans.number))
    .all();
}

export function getPlanDetail(db: DBOrTx, id: number) {
  const plan = db.select().from(productionPlans).where(eq(productionPlans.id, id)).get();
  if (!plan) throw notFoundError("Plan de producción");
  const preview = safeParsePreview(plan.previewJson) ?? null;
  const productions = db
    .select({
      id: productionBatches.id,
      number: productionBatches.number,
      productionDate: productionBatches.productionDate,
      realYieldMicro: productionBatches.realYieldMicro,
      yieldUnitId: productionBatches.yieldUnitId,
      totalCostMicro: productionBatches.totalCostMicro,
      status: productionBatches.status,
    })
    .from(productionBatches)
    .where(eq(productionBatches.planId, id))
    .orderBy(desc(productionBatches.number))
    .all();
  const { previewJson: _ignored, ...rest } = plan;
  return { ...rest, preview, productions };
}

/** Anula un plan (auditoría conservada; nunca se borra). */
export function annulPlan(db: DBOrTx, id: number, reason: string) {
  return db.transaction((tx) => {
    const plan = tx.select().from(productionPlans).where(eq(productionPlans.id, id)).get();
    if (!plan) throw notFoundError("Plan de producción");
    if (plan.status === "anulada") throw domainError("El plan ya fue anulado.");
    tx.update(productionPlans)
      .set({ status: "anulada", cancelledAt: new Date().toISOString(), cancelReason: reason })
      .where(eq(productionPlans.id, id))
      .run();
    logAudit(tx, {
      action: "plan.annul",
      entityType: "production_plan",
      entityId: id,
      summary: `Plan #${String(plan.number).padStart(5, "0")} anulado`,
      details: { reason },
    });
    return { id, status: "anulada" as const };
  });
}
