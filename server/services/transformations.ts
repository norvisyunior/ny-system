import {
  transformations,
  transformationConsumptions,
  transformationMaterialConsumptions,
  transformationOutputs,
  recipeVersions,
  recipeItems,
  recipes,
  masses,
  rawMaterials,
  finishedProducts,
  productionPlans,
  stockLots,
  inventoryMovements,
} from "../../db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { conflictError, domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { nextDocNumber } from "../domain/counters";
import { assertValidBusinessDate, nowISO } from "../domain/dates";
import { consumeFIFO, createLot } from "../domain/fifo";
import { decMicro, divRoundAway, mulQtyPrice } from "../domain/zod-helpers";
import { formatCUP, microToDecimal } from "../../shared/money";
import type { DBOrTx } from "../domain/types";
import type { UnitsCatalog } from "../domain/units";

const outputInput = z.object({
  productId: z.number().int().positive("Producto requerido."),
  qty: decMicro({ minExclusive: true }),
});

export const transformationInput = z.object({
  transformDate: z.string().min(1, "Fecha requerida."),
  massId: z.number().int().positive("Masa requerida."),
  // Cantidad de masas COMPLETAS consumidas (unidad de la masa).
  massQty: decMicro({ minExclusive: true }),
  outputs: z.array(outputInput).min(1, "Agregue al menos un producto de salida."),
  // Versión de receta congelada: define empaques (por paquete) y rendimiento esperado.
  recipeVersionId: z.number().int().positive().optional().nullable(),
  planId: z.number().int().positive().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  // Token de idempotencia: reenvíos (doble clic) no duplican la operación.
  clientToken: z.string().trim().min(8).max(64).optional().nullable(),
});
export type TransformationInput = z.infer<typeof transformationInput>;

export interface TransformationConfirmResult {
  id: number;
  number: number;
  totalCostMicro: number;
  expectedPackagesMicro: number;
  deviationMicro: number;
  duplicated: boolean;
}

interface RecipeMode {
  versionId: number;
  recipeName: string;
  version: number;
  yieldMicro: number; // paquetes por masa
  productSaleUnit: string;
}

/**
 * Terminación masa → productos terminados en una única transacción:
 * 1. consume las masas PEPS (costo real congelado);
 * 2. si corresponde a una receta, consume los materiales de fase 'paquete'
 *    según los paquetes REALES obtenidos (no los esperados);
 * 3. reparte el costo total (masas + terminación) entre los productos de salida;
 * 4. conserva paquetes esperados, reales y desviación del histórico.
 */
export function confirmTransformation(
  db: DBOrTx,
  catalog: UnitsCatalog,
  input: TransformationInput,
) {
  return db.transaction((tx) => {
    if (input.clientToken) {
      const existing = tx
        .select()
        .from(transformations)
        .where(eq(transformations.clientToken, input.clientToken))
        .get();
      if (existing) {
        return {
          id: existing.id,
          number: existing.number,
          totalCostMicro: existing.totalCostMicro,
          expectedPackagesMicro: existing.expectedPackagesMicro,
          deviationMicro: existing.deviationMicro,
          duplicated: true,
        } satisfies TransformationConfirmResult;
      }
    }

    assertValidBusinessDate(tx, input.transformDate, { label: "La fecha de transformación" });

    const mass = tx.select().from(masses).where(eq(masses.id, input.massId)).get();
    if (!mass) throw notFoundError("Masa");
    if (!mass.active) throw domainError(`La masa "${mass.name}" está inactiva.`);

    const seen = new Set<number>();
    for (const out of input.outputs) {
      const prod = tx.select().from(finishedProducts).where(eq(finishedProducts.id, out.productId)).get();
      if (!prod) throw notFoundError("Producto");
      if (!prod.active) throw domainError(`El producto "${prod.name}" está inactivo.`);
      if (seen.has(out.productId)) {
        throw domainError(`El producto "${prod.name}" está repetido en la salida.`);
      }
      seen.add(out.productId);
    }

    // --- Modo receta (una receta por producto): empaques y rendimiento ---
    let recipeMode: RecipeMode | null = null;
    if (input.recipeVersionId) {
      const row = tx
        .select({
          versionId: recipeVersions.id,
          version: recipeVersions.version,
          status: recipeVersions.status,
          massId: recipeVersions.massId,
          yieldMicro: recipeVersions.expectedYieldMicro,
          yieldUnitId: recipeVersions.yieldUnitId,
          recipeId: recipes.id,
          recipeName: recipes.name,
          recipeActive: recipes.active,
          productId: recipes.productId,
          productSaleUnit: finishedProducts.saleUnitId,
        })
        .from(recipeVersions)
        .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
        .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
        .where(eq(recipeVersions.id, input.recipeVersionId))
        .get();
      if (!row) throw notFoundError("Versión de receta");
      if (!row.recipeActive) throw domainError(`La receta "${row.recipeName}" está inactiva.`);
      if (row.massId !== input.massId) {
        throw domainError(
          `La masa seleccionada no corresponde a la receta "${row.recipeName}".`,
        );
      }
      if (row.productId != null) {
        if (input.outputs.length !== 1 || input.outputs[0].productId !== row.productId) {
          throw domainError(
            "La terminación con receta corresponde a un solo producto (el de la receta).",
          );
        }
        if (row.yieldUnitId !== row.productSaleUnit) {
          throw domainError(
            `El rendimiento de la receta debe expresarse en la unidad de venta del producto (${row.productSaleUnit}).`,
          );
        }
        recipeMode = {
          versionId: row.versionId,
          recipeName: row.recipeName,
          version: row.version,
          yieldMicro: row.yieldMicro,
          productSaleUnit: row.productSaleUnit,
        };
      }
    } else if (input.outputs.length === 1) {
      // Derivación automática: producto con receta activa y misma masa.
      const single = input.outputs[0];
      const row = tx
        .select({
          versionId: recipeVersions.id,
          version: recipeVersions.version,
          massId: recipeVersions.massId,
          yieldMicro: recipeVersions.expectedYieldMicro,
          yieldUnitId: recipeVersions.yieldUnitId,
          recipeName: recipes.name,
          productSaleUnit: finishedProducts.saleUnitId,
        })
        .from(recipes)
        .innerJoin(recipeVersions, and(eq(recipeVersions.recipeId, recipes.id), eq(recipeVersions.status, "activa")))
        .innerJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
        .where(and(eq(recipes.productId, single.productId), eq(recipes.active, true)))
        .get();
      if (row) {
        if (row.massId !== input.massId) {
          throw domainError(
            `La masa seleccionada no corresponde a la receta "${row.recipeName}".`,
          );
        }
        recipeMode = {
          versionId: row.versionId,
          recipeName: row.recipeName,
          version: row.version,
          yieldMicro: row.yieldMicro,
          productSaleUnit: row.productSaleUnit,
        };
      }
    }

    if (input.planId) {
      const plan = tx.select().from(productionPlans).where(eq(productionPlans.id, input.planId)).get();
      if (!plan) throw notFoundError("Plan de producción");
      if (recipeMode && plan.recipeVersionId !== recipeMode.versionId) {
        throw domainError("El plan seleccionado corresponde a otra receta.");
      }
    }

    const realPackagesMicro = input.outputs.reduce((acc, o) => acc + o.qty, 0);
    // paquetes esperados = masas consumidas × rendimiento esperado por masa
    const expectedPackagesMicro = recipeMode
      ? Number(
          divRoundAway(
            BigInt(input.massQty) * BigInt(recipeMode.yieldMicro),
            BigInt(1_000_000),
          ),
        )
      : 0;
    const deviationMicro = recipeMode ? realPackagesMicro - expectedPackagesMicro : 0;

    const number = nextDocNumber(tx, "transformation");
    const [tf] = tx
      .insert(transformations)
      .values({
        number,
        transformDate: input.transformDate,
        massId: input.massId,
        recipeVersionId: recipeMode?.versionId ?? input.recipeVersionId ?? null,
        planId: input.planId ?? null,
        expectedPackagesMicro,
        deviationMicro,
        totalCostMicro: 0,
        notes: input.notes ?? null,
        clientToken: input.clientToken ?? null,
      })
      .returning()
      .all();

    // --- 1) Consumo de masas (PEPS) ---
    const consumed = consumeFIFO(
      tx,
      "mass",
      input.massId,
      input.massQty,
      mass.name,
      (m) => `${microToDecimal(m, 3)} ${mass.unitId}`,
    );
    let totalCostMicro = 0;
    for (const c of consumed) {
      totalCostMicro += c.lineCostMicro;
      tx.insert(transformationConsumptions)
        .values({
          transformationId: tf.id,
          lotId: c.lotId,
          qtyMicro: c.qtyMicro,
          unitCostMicro: c.unitCostMicro,
          lineCostMicro: c.lineCostMicro,
        })
        .run();
      tx.insert(inventoryMovements)
        .values({
          businessDate: input.transformDate,
          itemType: "mass",
          itemId: input.massId,
          movementType: "transformation_out",
          qtyDeltaMicro: -c.qtyMicro,
          unitCostMicro: c.unitCostMicro,
          valueMicro: -c.lineCostMicro,
          lotId: c.lotId,
          refType: "transformation",
          refId: tf.id,
          notes: `Terminación #${String(number).padStart(5, "0")}`,
        })
        .run();
    }
    tx.update(masses)
      .set({ stockMicro: sql`${masses.stockMicro} - ${input.massQty}`, updatedAt: nowISO() })
      .where(eq(masses.id, input.massId))
      .run();

    // --- 2) Materiales de fase 'paquete' sobre los paquetes REALES ---
    if (recipeMode) {
      const packItems = tx
        .select()
        .from(recipeItems)
        .where(and(eq(recipeItems.recipeVersionId, recipeMode.versionId), eq(recipeItems.phase, "paquete")))
        .all();
      for (const item of packItems) {
        const mat = tx
          .select()
          .from(rawMaterials)
          .where(eq(rawMaterials.id, item.rawMaterialId))
          .get();
        if (!mat) throw notFoundError("Materia prima");
        catalog.assertCompatible(item.unitId, mat.unitId);
        // cantidad por paquete × paquetes reales obtenidos
        const totalItemUnit = Number(
          divRoundAway(BigInt(item.qtyMicro) * BigInt(realPackagesMicro), BigInt(1_000_000)),
        );
        const qtyBase = catalog.toBase(totalItemUnit, item.unitId, mat.unitId);
        if (qtyBase <= 0) continue;
        const mats = consumeFIFO(tx, "raw", mat.id, qtyBase, mat.name, (m) =>
          `${microToDecimal(m, 3)} ${mat.unitId}`,
        );
        for (const c of mats) {
          totalCostMicro += c.lineCostMicro;
          tx.insert(transformationMaterialConsumptions)
            .values({
              transformationId: tf.id,
              rawMaterialId: mat.id,
              lotId: c.lotId,
              qtyMicro: c.qtyMicro,
              unitCostMicro: c.unitCostMicro,
              lineCostMicro: c.lineCostMicro,
            })
            .run();
          tx.insert(inventoryMovements)
            .values({
              businessDate: input.transformDate,
              itemType: "raw",
              itemId: mat.id,
              movementType: "transformation_out",
              qtyDeltaMicro: -c.qtyMicro,
              unitCostMicro: c.unitCostMicro,
              valueMicro: -c.lineCostMicro,
              lotId: c.lotId,
              refType: "transformation",
              refId: tf.id,
              notes: `Terminación #${String(number).padStart(5, "0")} (empaque)`,
            })
            .run();
        }
        tx.update(rawMaterials)
          .set({ stockMicro: sql`${rawMaterials.stockMicro} - ${qtyBase}`, updatedAt: nowISO() })
          .where(eq(rawMaterials.id, mat.id))
          .run();
      }
    }

    // --- 3) Reparto del costo entre los productos de salida ---
    if (realPackagesMicro <= 0) throw domainError("La cantidad total de salida debe ser mayor que cero.");
    let allocated = 0n;
    const allocs: number[] = [];
    for (let i = 0; i < input.outputs.length; i++) {
      const last = i === input.outputs.length - 1;
      const q = BigInt(input.outputs[i].qty);
      const a = last
        ? BigInt(totalCostMicro) - allocated
        : (BigInt(totalCostMicro) * q) / BigInt(realPackagesMicro);
      allocs.push(Number(a));
      allocated += a;
    }

    for (let i = 0; i < input.outputs.length; i++) {
      const out = input.outputs[i];
      const alloc = allocs[i];
      const unitCostMicro = Number(divRoundAway(BigInt(alloc) * BigInt(1_000_000), BigInt(out.qty)));
      const lotId = createLot(tx, {
        itemType: "product",
        itemId: out.productId,
        refType: "transformation",
        refId: tf.id,
        qtyMicro: out.qty,
        unitCostMicro,
        businessDate: input.transformDate,
      });
      tx.insert(transformationOutputs)
        .values({
          transformationId: tf.id,
          productId: out.productId,
          lotId,
          qtyMicro: out.qty,
          costAllocatedMicro: alloc,
          unitCostMicro,
        })
        .run();
      tx.insert(inventoryMovements)
        .values({
          businessDate: input.transformDate,
          itemType: "product",
          itemId: out.productId,
          movementType: "transformation_in",
          qtyDeltaMicro: out.qty,
          unitCostMicro,
          valueMicro: mulQtyPrice(out.qty, unitCostMicro),
          lotId,
          refType: "transformation",
          refId: tf.id,
          notes: `Terminación #${String(number).padStart(5, "0")}`,
        })
        .run();
      tx.update(finishedProducts)
        .set({ stockMicro: sql`${finishedProducts.stockMicro} + ${out.qty}`, updatedAt: nowISO() })
        .where(eq(finishedProducts.id, out.productId))
        .run();
    }

    tx.update(transformations)
      .set({ totalCostMicro })
      .where(eq(transformations.id, tf.id))
      .run();

    logAudit(tx, {
      action: "transformation.confirm",
      entityType: "transformation",
      entityId: tf.id,
      summary:
        `Terminación #${String(number).padStart(5, "0")}: ` +
        `${microToDecimal(input.massQty, 3)} ${mass.unitId} de ${mass.name} → ` +
        `${microToDecimal(realPackagesMicro, 0)} paquetes` +
        (recipeMode ? ` (esperados ${microToDecimal(expectedPackagesMicro, 0)})` : "") +
        `, costo ${formatCUP(totalCostMicro)}`,
      details: {
        totalCostMicro,
        massQty: input.massQty,
        expectedPackagesMicro,
        realPackagesMicro,
        deviationMicro,
        recipeVersionId: recipeMode?.versionId ?? null,
        planId: input.planId ?? null,
      },
    });

    return {
      id: tf.id,
      number,
      totalCostMicro,
      expectedPackagesMicro,
      deviationMicro,
      duplicated: false,
    } satisfies TransformationConfirmResult;
  });
}

export interface TransformationListRow {
  id: number;
  number: number;
  transformDate: string;
  massName: string;
  massUnit: string;
  massQtyMicro: number;
  outputsCount: number;
  realPackagesMicro: number;
  expectedPackagesMicro: number;
  deviationMicro: number;
  productName: string | null;
  recipeName: string | null;
  recipeVersion: number | null;
  planId: number | null;
  totalCostMicro: number;
  status: string;
}

export function listTransformations(db: DBOrTx): TransformationListRow[] {
  const rows = db
    .select({
      id: transformations.id,
      number: transformations.number,
      transformDate: transformations.transformDate,
      massName: masses.name,
      massUnit: masses.unitId,
      totalCostMicro: transformations.totalCostMicro,
      status: transformations.status,
      expectedPackagesMicro: transformations.expectedPackagesMicro,
      deviationMicro: transformations.deviationMicro,
      planId: transformations.planId,
      recipeName: recipes.name,
      recipeVersion: recipeVersions.version,
      productName: finishedProducts.name,
      massQtyMicro: sql<number>`COALESCE((SELECT SUM(tc.qty_micro) FROM transformation_consumptions tc WHERE tc.transformation_id = ${transformations.id}), 0)`,
      realPackagesMicro: sql<number>`COALESCE((SELECT SUM(tr.qty_micro) FROM transformation_outputs tr WHERE tr.transformation_id = ${transformations.id}), 0)`,
      outputsCount: sql<number>`(SELECT COUNT(*) FROM transformation_outputs tr WHERE tr.transformation_id = ${transformations.id})`,
    })
    .from(transformations)
    .innerJoin(masses, eq(masses.id, transformations.massId))
    .leftJoin(recipeVersions, eq(recipeVersions.id, transformations.recipeVersionId))
    .leftJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
    .orderBy(desc(transformations.transformDate), desc(transformations.number))
    .all();
  return rows;
}

export function getTransformationDetail(db: DBOrTx, id: number) {
  const tf = db
    .select({
      id: transformations.id,
      number: transformations.number,
      transformDate: transformations.transformDate,
      massId: transformations.massId,
      massName: masses.name,
      massUnit: masses.unitId,
      recipeVersionId: transformations.recipeVersionId,
      recipeName: recipes.name,
      recipeVersion: recipeVersions.version,
      productName: finishedProducts.name,
      planId: transformations.planId,
      expectedPackagesMicro: transformations.expectedPackagesMicro,
      deviationMicro: transformations.deviationMicro,
      totalCostMicro: transformations.totalCostMicro,
      status: transformations.status,
      notes: transformations.notes,
      cancelledAt: transformations.cancelledAt,
      cancelReason: transformations.cancelReason,
    })
    .from(transformations)
    .innerJoin(masses, eq(masses.id, transformations.massId))
    .leftJoin(recipeVersions, eq(recipeVersions.id, transformations.recipeVersionId))
    .leftJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
    .where(eq(transformations.id, id))
    .get();
  if (!tf) throw notFoundError("Transformación");

  const consumptions = db
    .select({
      id: transformationConsumptions.id,
      lotId: transformationConsumptions.lotId,
      qtyMicro: transformationConsumptions.qtyMicro,
      unitCostMicro: transformationConsumptions.unitCostMicro,
      lineCostMicro: transformationConsumptions.lineCostMicro,
      lotDate: stockLots.businessDate,
    })
    .from(transformationConsumptions)
    .innerJoin(stockLots, eq(stockLots.id, transformationConsumptions.lotId))
    .where(eq(transformationConsumptions.transformationId, id))
    .orderBy(asc(transformationConsumptions.id))
    .all();

  const materials = db
    .select({
      id: transformationMaterialConsumptions.id,
      rawMaterialId: transformationMaterialConsumptions.rawMaterialId,
      materialName: rawMaterials.name,
      unitId: rawMaterials.unitId,
      qtyMicro: transformationMaterialConsumptions.qtyMicro,
      unitCostMicro: transformationMaterialConsumptions.unitCostMicro,
      lineCostMicro: transformationMaterialConsumptions.lineCostMicro,
    })
    .from(transformationMaterialConsumptions)
    .innerJoin(rawMaterials, eq(rawMaterials.id, transformationMaterialConsumptions.rawMaterialId))
    .where(eq(transformationMaterialConsumptions.transformationId, id))
    .orderBy(asc(transformationMaterialConsumptions.id))
    .all();

  const outputs = db
    .select({
      id: transformationOutputs.id,
      productId: transformationOutputs.productId,
      productName: finishedProducts.name,
      saleUnitId: finishedProducts.saleUnitId,
      qtyMicro: transformationOutputs.qtyMicro,
      costAllocatedMicro: transformationOutputs.costAllocatedMicro,
      unitCostMicro: transformationOutputs.unitCostMicro,
    })
    .from(transformationOutputs)
    .innerJoin(finishedProducts, eq(finishedProducts.id, transformationOutputs.productId))
    .where(eq(transformationOutputs.transformationId, id))
    .orderBy(asc(transformationOutputs.id))
    .all();

  const massQtyMicro = consumptions.reduce((acc, c) => acc + c.qtyMicro, 0);
  return { ...tf, massQtyMicro, consumptions, materials, outputs };
}

/**
 * Anula una terminación: cancela los lotes de PT (si ningún producto fue
 * vendido), devuelve la masa a sus lotes y repone los materiales de empaque.
 */
export function annulTransformation(db: DBOrTx, id: number, reason: string) {
  return db.transaction((tx) => {
    const tf = tx.select().from(transformations).where(eq(transformations.id, id)).get();
    if (!tf) throw notFoundError("Transformación");
    if (tf.status === "anulada") throw conflictError("La transformación ya fue anulada.");
    assertValidBusinessDate(tx, tf.transformDate, { label: "La fecha de transformación" });

    const outputs = tx
      .select()
      .from(transformationOutputs)
      .where(eq(transformationOutputs.transformationId, id))
      .all();
    for (const out of outputs) {
      const lot = tx.select().from(stockLots).where(eq(stockLots.id, out.lotId)).get();
      if (lot && lot.qtyRemainingMicro < lot.qtyInitialMicro) {
        const prod = tx.select().from(finishedProducts).where(eq(finishedProducts.id, out.productId)).get();
        throw domainError(
          `No se puede anular: el producto "${prod?.name ?? out.productId}" de esta terminación ya fue vendido.`,
        );
      }
    }

    const consumptions = tx
      .select()
      .from(transformationConsumptions)
      .where(eq(transformationConsumptions.transformationId, id))
      .all();
    for (const c of consumptions) {
      const lot = tx.select().from(stockLots).where(eq(stockLots.id, c.lotId)).get();
      if (lot && lot.qtyRemainingMicro < lot.qtyInitialMicro - c.qtyMicro) {
        throw domainError(
          "No se puede anular: uno de los lotes de masa consumidos tuvo movimientos posteriores.",
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
          businessDate: tf.transformDate,
          itemType: "product",
          itemId: out.productId,
          movementType: "cancel_transformation_in",
          qtyDeltaMicro: -out.qtyMicro,
          unitCostMicro: out.unitCostMicro,
          valueMicro: -mulQtyPrice(out.qtyMicro, out.unitCostMicro),
          lotId: out.lotId,
          refType: "transformation",
          refId: id,
          reason,
          notes: `Anulación Terminación #${String(tf.number).padStart(5, "0")}`,
        })
        .run();
      tx.update(finishedProducts)
        .set({ stockMicro: sql`${finishedProducts.stockMicro} - ${out.qtyMicro}`, updatedAt: now })
        .where(eq(finishedProducts.id, out.productId))
        .run();
    }

    const mass = tx.select().from(masses).where(eq(masses.id, tf.massId)).get();
    if (!mass) throw notFoundError("Masa");
    for (const c of consumptions) {
      tx.update(stockLots)
        .set({ qtyRemainingMicro: sql`${stockLots.qtyRemainingMicro} + ${c.qtyMicro}` })
        .where(eq(stockLots.id, c.lotId))
        .run();
      tx.insert(inventoryMovements)
        .values({
          businessDate: tf.transformDate,
          itemType: "mass",
          itemId: tf.massId,
          movementType: "cancel_transformation_out",
          qtyDeltaMicro: c.qtyMicro,
          unitCostMicro: c.unitCostMicro,
          valueMicro: mulQtyPrice(c.qtyMicro, c.unitCostMicro),
          lotId: c.lotId,
          refType: "transformation",
          refId: id,
          reason,
          notes: `Anulación Terminación #${String(tf.number).padStart(5, "0")}`,
        })
        .run();
      tx.update(masses)
        .set({ stockMicro: sql`${masses.stockMicro} + ${c.qtyMicro}`, updatedAt: now })
        .where(eq(masses.id, tf.massId))
        .run();
    }

    // Reposición de materiales de empaque (empaques, nylon, etc.)
    const matConsumptions = tx
      .select()
      .from(transformationMaterialConsumptions)
      .where(eq(transformationMaterialConsumptions.transformationId, id))
      .all();
    for (const c of matConsumptions) {
      tx.update(stockLots)
        .set({ qtyRemainingMicro: sql`${stockLots.qtyRemainingMicro} + ${c.qtyMicro}` })
        .where(eq(stockLots.id, c.lotId))
        .run();
      tx.insert(inventoryMovements)
        .values({
          businessDate: tf.transformDate,
          itemType: "raw",
          itemId: c.rawMaterialId,
          movementType: "cancel_transformation_out",
          qtyDeltaMicro: c.qtyMicro,
          unitCostMicro: c.unitCostMicro,
          valueMicro: mulQtyPrice(c.qtyMicro, c.unitCostMicro),
          lotId: c.lotId,
          refType: "transformation",
          refId: id,
          reason,
          notes: `Anulación Terminación #${String(tf.number).padStart(5, "0")} (empaque)`,
        })
        .run();
      tx.update(rawMaterials)
        .set({ stockMicro: sql`${rawMaterials.stockMicro} + ${c.qtyMicro}`, updatedAt: now })
        .where(eq(rawMaterials.id, c.rawMaterialId))
        .run();
    }

    tx.update(transformations)
      .set({ status: "anulada", cancelledAt: now, cancelReason: reason })
      .where(eq(transformations.id, id))
      .run();

    logAudit(tx, {
      action: "transformation.annul",
      entityType: "transformation",
      entityId: id,
      summary: `Terminación #${String(tf.number).padStart(5, "0")} anulada`,
      details: { reason },
    });
    return { id, status: "anulada" as const };
  });
}
