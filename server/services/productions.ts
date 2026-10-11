import {
  productionBatches,
  productionConsumptions,
  productionOutputs,
  productionPlans,
  recipeVersions,
  recipeItems,
  recipes,
  masses,
  rawMaterials,
  inventoryMovements,
  stockLots,
} from "../../db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { conflictError, domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { nextDocNumber } from "../domain/counters";
import { assertValidBusinessDate, nowISO } from "../domain/dates";
import { consumeFIFO, createLot } from "../domain/fifo";
import { decMicro } from "../domain/zod-helpers";
import { divRoundAway, formatCUP, microToDecimal, mulQtyPrice } from "../../shared/money";
import type { DB } from "../domain/types";
import type { UnitsCatalog } from "../domain/units";

export const productionInput = z.object({
  productionDate: z.string().min(1, "Fecha requerida."),
  recipeVersionId: z.number().int().positive("Versión de receta requerida."),
  // Número de masas o lotes completos elaborados (entero, unidad de la masa).
  massesCount: decMicro({ minExclusive: true }),
  planId: z.number().int().positive().optional().nullable(),
  responsible: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  // Token de idempotencia: reenvíos (doble clic) no duplican la operación.
  clientToken: z.string().trim().min(8).max(64).optional().nullable(),
});
export type ProductionInput = z.infer<typeof productionInput>;

const fmt = (micro: number, unit: string) => `${microToDecimal(micro, 3)} ${unit}`;
const MICRO = 1_000_000;

export interface ProductionConfirmResult {
  id: number;
  number: number;
  totalCostMicro: number;
  unitCostMicro: number;
  expectedYieldMicro: number;
  realYieldMicro: number;
  deviationMicro: number;
  duplicated: boolean;
}

/**
 * Confirma la elaboración de N masas completas en una única transacción:
 * consume los ingredientes de fase 'masa' (PEPS, precio real congelado),
 * registra movimientos y crea el lote de masa en el inventario intermedio.
 * No consume materiales de fase 'paquete': esos se descuentan al terminar.
 */
export function confirmProduction(db: DB, catalog: UnitsCatalog, input: ProductionInput) {
  return db.transaction((tx) => {
    if (input.clientToken) {
      const existing = tx
        .select()
        .from(productionBatches)
        .where(eq(productionBatches.clientToken, input.clientToken))
        .get();
      if (existing) {
        return {
          id: existing.id,
          number: existing.number,
          totalCostMicro: existing.totalCostMicro,
          unitCostMicro: existing.unitCostMicro,
          expectedYieldMicro: existing.expectedYieldMicro,
          realYieldMicro: existing.realYieldMicro,
          deviationMicro: existing.realYieldMicro - existing.expectedYieldMicro,
          duplicated: true,
        } satisfies ProductionConfirmResult;
      }
    }

    if (input.massesCount % MICRO !== 0) {
      throw domainError("La cantidad de masas debe ser un número entero (masas completas).");
    }
    assertValidBusinessDate(tx, input.productionDate, { label: "La fecha de producción" });

    const version = tx
      .select()
      .from(recipeVersions)
      .where(eq(recipeVersions.id, input.recipeVersionId))
      .get();
    if (!version) throw notFoundError("Versión de receta");
    if (version.status !== "activa") {
      throw conflictError(
        `La versión v${version.version} de la receta está archivada. Seleccione la versión activa.`,
        "RECIPE_ARCHIVED",
      );
    }
    const recipe = tx.select().from(recipes).where(eq(recipes.id, version.recipeId)).get();
    const mass = tx.select().from(masses).where(eq(masses.id, version.massId)).get();
    if (!mass) throw notFoundError("Masa");
    if (!mass.active) throw domainError(`La masa "${mass.name}" está inactiva.`);

    // Plan vinculado: aporta las masas esperadas (planificadas).
    let expectedYieldMicro = input.massesCount;
    if (input.planId) {
      const plan = tx
        .select()
        .from(productionPlans)
        .where(eq(productionPlans.id, input.planId))
        .get();
      if (!plan) throw notFoundError("Plan de producción");
      if (plan.status !== "planificada") {
        throw domainError("El plan seleccionado no está activo.");
      }
      if (plan.recipeVersionId !== version.id) {
        throw domainError("El plan seleccionado corresponde a otra receta.");
      }
      expectedYieldMicro = plan.plannedMassesMicro;
    }

    const items = tx
      .select()
      .from(recipeItems)
      .where(eq(recipeItems.recipeVersionId, version.id))
      .all();
    const masaItems = items.filter((i) => i.phase === "masa");
    if (masaItems.length === 0) {
      throw domainError("La versión de la receta no tiene ingredientes por masa.");
    }

    const massesInt = input.massesCount / MICRO;
    const number = nextDocNumber(tx, "production");
    const [batch] = tx
      .insert(productionBatches)
      .values({
        number,
        productionDate: input.productionDate,
        recipeVersionId: version.id,
        planId: input.planId ?? null,
        expectedYieldMicro,
        realYieldMicro: input.massesCount,
        yieldUnitId: mass.unitId,
        totalCostMicro: 0,
        unitCostMicro: 0,
        responsible: input.responsible ?? null,
        notes: input.notes ?? null,
        clientToken: input.clientToken ?? null,
      })
      .returning()
      .all();

    let totalCostMicro = 0;
    for (const item of masaItems) {
      const mat = tx.select().from(rawMaterials).where(eq(rawMaterials.id, item.rawMaterialId)).get();
      if (!mat) throw notFoundError("Materia prima");
      catalog.assertCompatible(item.unitId, mat.unitId);
      const qtyBase = catalog.toBase(item.qtyMicro * massesInt, item.unitId, mat.unitId);
      if (qtyBase <= 0) {
        throw domainError(
          `El ingrediente "${mat.name}" tiene una cantidad demasiado pequeña en la receta.`,
        );
      }
      const consumed = consumeFIFO(tx, "raw", mat.id, qtyBase, mat.name, (m) => fmt(m, mat.unitId));
      for (const c of consumed) {
        totalCostMicro += c.lineCostMicro;
        tx.insert(productionConsumptions)
          .values({
            batchId: batch.id,
            rawMaterialId: mat.id,
            lotId: c.lotId,
            qtyMicro: c.qtyMicro,
            unitCostMicro: c.unitCostMicro,
            lineCostMicro: c.lineCostMicro,
          })
          .run();
        tx.insert(inventoryMovements)
          .values({
            businessDate: input.productionDate,
            itemType: "raw",
            itemId: mat.id,
            movementType: "production_out",
            qtyDeltaMicro: -c.qtyMicro,
            unitCostMicro: c.unitCostMicro,
            valueMicro: -c.lineCostMicro,
            lotId: c.lotId,
            refType: "production",
            refId: batch.id,
            notes: `Elaboración #${String(number).padStart(5, "0")} (${recipe?.name ?? ""} v${version.version})`,
          })
          .run();
      }
      tx.update(rawMaterials)
        .set({ stockMicro: sql`${rawMaterials.stockMicro} - ${qtyBase}`, updatedAt: nowISO() })
        .where(eq(rawMaterials.id, mat.id))
        .run();
    }

    // costo unitario real por masa completa (micro-CUP)
    const unitCostMicro = Number(
      divRoundAway(BigInt(totalCostMicro) * BigInt(MICRO), BigInt(input.massesCount)),
    );

    const lotId = createLot(tx, {
      itemType: "mass",
      itemId: mass.id,
      refType: "production",
      refId: batch.id,
      qtyMicro: input.massesCount,
      unitCostMicro,
      businessDate: input.productionDate,
    });
    tx.insert(productionOutputs)
      .values({
        batchId: batch.id,
        massId: mass.id,
        lotId,
        qtyMicro: input.massesCount,
        unitCostMicro,
      })
      .run();
    tx.insert(inventoryMovements)
      .values({
        businessDate: input.productionDate,
        itemType: "mass",
        itemId: mass.id,
        movementType: "production_in",
        qtyDeltaMicro: input.massesCount,
        unitCostMicro,
        valueMicro: mulQtyPrice(input.massesCount, unitCostMicro),
        lotId,
        refType: "production",
        refId: batch.id,
        notes: `Elaboración #${String(number).padStart(5, "0")}`,
      })
      .run();
    tx.update(masses)
      .set({ stockMicro: sql`${masses.stockMicro} + ${input.massesCount}`, updatedAt: nowISO() })
      .where(eq(masses.id, mass.id))
      .run();

    tx.update(productionBatches)
      .set({ totalCostMicro, unitCostMicro })
      .where(eq(productionBatches.id, batch.id))
      .run();

    logAudit(tx, {
      action: "production.confirm",
      entityType: "production",
      entityId: batch.id,
      summary:
        `Elaboración #${String(number).padStart(5, "0")} confirmada: ${recipe?.name ?? ""} v${version.version} — ` +
        `${massesInt} masa(s), costo ${formatCUP(totalCostMicro)}`,
      details: {
        totalCostMicro,
        unitCostMicro,
        expected: expectedYieldMicro,
        real: input.massesCount,
        planId: input.planId ?? null,
        responsible: input.responsible ?? null,
      },
    });

    return {
      id: batch.id,
      number,
      totalCostMicro,
      unitCostMicro,
      expectedYieldMicro,
      realYieldMicro: input.massesCount,
      deviationMicro: input.massesCount - expectedYieldMicro,
      duplicated: false,
    } satisfies ProductionConfirmResult;
  });
}

export interface ProductionListRow {
  id: number;
  number: number;
  productionDate: string;
  recipeName: string;
  version: number;
  massName: string;
  expectedYieldMicro: number;
  realYieldMicro: number;
  yieldUnitId: string;
  totalCostMicro: number;
  unitCostMicro: number;
  status: string;
}

export function listProductions(db: DB, opts: { from?: string; to?: string } = {}): ProductionListRow[] {
  const conds = [];
  if (opts.from) conds.push(sql`${productionBatches.productionDate} >= ${opts.from}`);
  if (opts.to) conds.push(sql`${productionBatches.productionDate} <= ${opts.to}`);
  return db
    .select({
      id: productionBatches.id,
      number: productionBatches.number,
      productionDate: productionBatches.productionDate,
      recipeName: recipes.name,
      version: recipeVersions.version,
      massName: masses.name,
      expectedYieldMicro: productionBatches.expectedYieldMicro,
      realYieldMicro: productionBatches.realYieldMicro,
      yieldUnitId: productionBatches.yieldUnitId,
      totalCostMicro: productionBatches.totalCostMicro,
      unitCostMicro: productionBatches.unitCostMicro,
      status: productionBatches.status,
    })
    .from(productionBatches)
    .innerJoin(recipeVersions, eq(recipeVersions.id, productionBatches.recipeVersionId))
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(masses, eq(masses.id, recipeVersions.massId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(productionBatches.productionDate), desc(productionBatches.number))
    .all();
}

export function getProductionDetail(db: DB, id: number) {
  const batch = db
    .select({
      id: productionBatches.id,
      number: productionBatches.number,
      productionDate: productionBatches.productionDate,
      recipeVersionId: productionBatches.recipeVersionId,
      recipeName: recipes.name,
      version: recipeVersions.version,
      massId: masses.id,
      massName: masses.name,
      massUnit: masses.unitId,
      expectedYieldMicro: productionBatches.expectedYieldMicro,
      realYieldMicro: productionBatches.realYieldMicro,
      yieldUnitId: productionBatches.yieldUnitId,
      totalCostMicro: productionBatches.totalCostMicro,
      unitCostMicro: productionBatches.unitCostMicro,
      status: productionBatches.status,
      notes: productionBatches.notes,
      cancelledAt: productionBatches.cancelledAt,
      cancelReason: productionBatches.cancelReason,
      createdAt: productionBatches.createdAt,
    })
    .from(productionBatches)
    .innerJoin(recipeVersions, eq(recipeVersions.id, productionBatches.recipeVersionId))
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(masses, eq(masses.id, recipeVersions.massId))
    .where(eq(productionBatches.id, id))
    .get();
  if (!batch) throw notFoundError("Producción");

  const consumptions = db
    .select({
      id: productionConsumptions.id,
      materialName: rawMaterials.name,
      materialUnit: rawMaterials.unitId,
      qtyMicro: productionConsumptions.qtyMicro,
      unitCostMicro: productionConsumptions.unitCostMicro,
      lineCostMicro: productionConsumptions.lineCostMicro,
    })
    .from(productionConsumptions)
    .innerJoin(rawMaterials, eq(rawMaterials.id, productionConsumptions.rawMaterialId))
    .where(eq(productionConsumptions.batchId, id))
    .orderBy(asc(productionConsumptions.id))
    .all();

  return { ...batch, consumptions };
}

/** Anula una producción: revierte consumos y cancela el lote de masa si no fue consumido. */
export function annulProduction(db: DB, id: number, reason: string) {
  return db.transaction((tx) => {
    const batch = tx.select().from(productionBatches).where(eq(productionBatches.id, id)).get();
    if (!batch) throw notFoundError("Producción");
    if (batch.status === "anulada") throw conflictError("La producción ya fue anulada.");
    assertValidBusinessDate(tx, batch.productionDate, { label: "La fecha de producción" });

    const outputs = tx
      .select()
      .from(productionOutputs)
      .where(eq(productionOutputs.batchId, id))
      .all();
    for (const out of outputs) {
      const lot = tx.select().from(stockLots).where(eq(stockLots.id, out.lotId)).get();
      if (lot && lot.qtyRemainingMicro < lot.qtyInitialMicro) {
        const mass = tx.select().from(masses).where(eq(masses.id, out.massId)).get();
        throw domainError(
          `No se puede anular: la masa "${mass?.name ?? out.massId}" de esta producción ya fue consumida en transformaciones.`,
        );
      }
    }

    const now = nowISO();
    for (const out of outputs) {
      tx.update(stockLots)
        .set({ cancelledAt: now })
        .where(eq(stockLots.id, out.lotId))
        .run();
      tx.insert(inventoryMovements)
        .values({
          businessDate: batch.productionDate,
          itemType: "mass",
          itemId: out.massId,
          movementType: "cancel_production_in",
          qtyDeltaMicro: -out.qtyMicro,
          unitCostMicro: out.unitCostMicro,
          valueMicro: -mulQtyPrice(out.qtyMicro, out.unitCostMicro),
          lotId: out.lotId,
          refType: "production",
          refId: id,
          reason,
          notes: `Anulación Producción #${String(batch.number).padStart(5, "0")}`,
        })
        .run();
      tx.update(masses)
        .set({ stockMicro: sql`${masses.stockMicro} - ${out.qtyMicro}`, updatedAt: now })
        .where(eq(masses.id, out.massId))
        .run();
    }

    const consumptions = tx
      .select()
      .from(productionConsumptions)
      .where(eq(productionConsumptions.batchId, id))
      .all();
    for (const c of consumptions) {
      tx.update(stockLots)
        .set({ qtyRemainingMicro: sql`${stockLots.qtyRemainingMicro} + ${c.qtyMicro}` })
        .where(eq(stockLots.id, c.lotId))
        .run();
      tx.insert(inventoryMovements)
        .values({
          businessDate: batch.productionDate,
          itemType: "raw",
          itemId: c.rawMaterialId,
          movementType: "cancel_production_out",
          qtyDeltaMicro: c.qtyMicro,
          unitCostMicro: c.unitCostMicro,
          valueMicro: mulQtyPrice(c.qtyMicro, c.unitCostMicro),
          lotId: c.lotId,
          refType: "production",
          refId: id,
          reason,
          notes: `Anulación Producción #${String(batch.number).padStart(5, "0")}`,
        })
        .run();
      tx.update(rawMaterials)
        .set({ stockMicro: sql`${rawMaterials.stockMicro} + ${c.qtyMicro}`, updatedAt: now })
        .where(eq(rawMaterials.id, c.rawMaterialId))
        .run();
    }

    tx.update(productionBatches)
      .set({ status: "anulada", cancelledAt: now, cancelReason: reason })
      .where(eq(productionBatches.id, id))
      .run();

    logAudit(tx, {
      action: "production.annul",
      entityType: "production",
      entityId: id,
      summary: `Producción #${String(batch.number).padStart(5, "0")} anulada`,
      details: { reason },
    });
    return { id, status: "anulada" as const };
  });
}

export function listYields(db: DB) {
  return listProductions(db).map((p) => ({
    ...p,
    deviationMicro: p.realYieldMicro - p.expectedYieldMicro,
    yieldPercent:
      p.expectedYieldMicro > 0
        ? Math.round((p.realYieldMicro / p.expectedYieldMicro) * 10000) / 100
        : 0,
  }));
}
