import {
  elaborationTemplateLines,
  elaborationTemplates,
  inventoryMovements,
  rawElaborationLines,
  rawElaborations,
  rawMaterials,
  stockLots,
} from "../../db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { conflictError, domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { nextDocNumber } from "../domain/counters";
import { assertValidBusinessDate, nowISO } from "../domain/dates";
import { availableStock, consumeFIFO, createLot, estimatedAvgCost } from "../domain/fifo";
import { decMicro, divRoundAway } from "../domain/zod-helpers";
import { formatCUP, microToDecimalTrim, mulQtyPrice } from "../../shared/money";
import type { ListPaging, PageResult } from "../domain/paging";
import type { DB, DBOrTx } from "../domain/types";
import type { UnitsCatalog } from "../domain/units";

const MICRO = 1_000_000;
const fmt = (micro: number, unit: string) => `${microToDecimalTrim(micro, 3)} ${unit}`;
const pad = (n: number) => String(n).padStart(5, "0");

export const elaborationInput = z.object({
  elaborationDate: z.string().min(1, "Fecha requerida."),
  // Materia prima resultante: debe estar marcada como elaborada (no comprable).
  outputMaterialId: z.number().int().positive("Material de salida requerido."),
  outputQty: decMicro({ minExclusive: true }),
  // Tarifa de mano de obra POR UNIDAD producida. El total del lote es
  // tarifa × cantidad a elaborar. Editable por operación.
  laborCost: decMicro().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  // Token de idempotencia: reenvíos (doble clic) no duplican la operación.
  clientToken: z.string().trim().min(8).max(64).optional().nullable(),
  items: z
    .array(
      z.object({
        rawMaterialId: z.number().int().positive("Insumo requerido."),
        unitId: z.string().min(1, "Unidad requerida."),
        qty: decMicro({ minExclusive: true }),
      }),
    )
    .min(1, "Agregue al menos un insumo a consumir."),
});
export type ElaborationInput = z.infer<typeof elaborationInput>;

export const elaborationPreviewInput = z.object({
  // Opcional: el estimado por insumo funciona sin elegir el material resultante.
  outputMaterialId: z.number().int().positive().optional(),
  outputQty: decMicro({ minExclusive: true }).optional(),
  // Tarifa de MO por unidad (opcional en el estimado).
  laborCost: decMicro().optional().nullable(),
  items: z
    .array(
      z.object({
        rawMaterialId: z.number().int().positive(),
        unitId: z.string().min(1),
        qty: decMicro({ minExclusive: true }),
      }),
    )
    .optional()
    .default([]),
});
export type ElaborationPreviewInput = z.infer<typeof elaborationPreviewInput>;

interface ResolvedLine {
  material: typeof rawMaterials.$inferSelect;
  unitId: string;
  qtyMicro: number;
  qtyBaseMicro: number;
}

function resolveOutput(tx: DBOrTx, catalog: UnitsCatalog, outputMaterialId: number) {
  const output = tx.select().from(rawMaterials).where(eq(rawMaterials.id, outputMaterialId)).get();
  if (!output) throw notFoundError("Materia prima de salida");
  if (!output.elaborated) {
    throw domainError(
      `"${output.name}" no está marcada como elaborada. Actívela en Materias primas ("Se elabora internamente") antes de elaborarla.`,
    );
  }
  if (!output.active) throw domainError(`La materia prima "${output.name}" está inactiva.`);
  void catalog;
  return output;
}

function resolveLines(
  tx: DBOrTx,
  catalog: UnitsCatalog,
  output: typeof rawMaterials.$inferSelect,
  items: ElaborationInput["items"],
): ResolvedLine[] {
  const seen = new Set<number>();
  const lines: ResolvedLine[] = [];
  for (const it of items) {
    if (it.rawMaterialId === output.id) {
      throw domainError(
        `"${output.name}" no puede ser insumo de su propia elaboración.`,
      );
    }
    if (seen.has(it.rawMaterialId)) {
      throw domainError("Un insumo está repetido: combine las cantidades en una sola línea.");
    }
    seen.add(it.rawMaterialId);

    const material = tx
      .select()
      .from(rawMaterials)
      .where(eq(rawMaterials.id, it.rawMaterialId))
      .get();
    if (!material) throw notFoundError("Materia prima insumo");
    if (!material.active) {
      throw domainError(`La materia prima "${material.name}" está inactiva y no puede consumirse.`);
    }
    catalog.assertCompatible(it.unitId, material.unitId);
    const qtyBaseMicro = catalog.toBase(it.qty, it.unitId, material.unitId);
    if (qtyBaseMicro <= 0) {
      throw domainError(
        `La cantidad de "${material.name}" es demasiado pequeña para su unidad base (${material.unitId}).`,
      );
    }
    lines.push({ material, unitId: it.unitId, qtyMicro: it.qty, qtyBaseMicro });
  }
  return lines;
}

export interface ElaborationConfirmResult {
  id: number;
  number: number;
  outputQtyMicro: number;
  materialCostMicro: number;
  laborCostMicro: number;
  totalCostMicro: number;
  unitCostMicro: number;
  duplicated: boolean;
}

/**
 * Confirma una elaboración de materia prima en una única transacción:
 * consume los insumos por PEPS (costo real congelado), suma la mano de obra,
 * crea el lote del material resultante y actualiza el stock. El material de
 * salida queda disponible como cualquier materia prima (recetas, fichas, etc.).
 */
export function confirmElaboration(
  db: DB,
  catalog: UnitsCatalog,
  input: ElaborationInput,
): ElaborationConfirmResult {
  return db.transaction((tx) => {
    if (input.clientToken) {
      const existing = tx
        .select()
        .from(rawElaborations)
        .where(eq(rawElaborations.clientToken, input.clientToken))
        .get();
      if (existing) {
        return {
          id: existing.id,
          number: existing.number,
          outputQtyMicro: existing.outputQtyMicro,
          materialCostMicro: existing.totalCostMicro - existing.laborCostMicro,
          laborCostMicro: existing.laborCostMicro,
          totalCostMicro: existing.totalCostMicro,
          unitCostMicro: existing.unitCostMicro,
          duplicated: true,
        } satisfies ElaborationConfirmResult;
      }
    }

    assertValidBusinessDate(tx, input.elaborationDate, { label: "La fecha de elaboración" });
    const output = resolveOutput(tx, catalog, input.outputMaterialId);
    const lines = resolveLines(tx, catalog, output, input.items);

    const number = nextDocNumber(tx, "elaboration");
    // MO por unidad × cantidad producida = MO total del lote.
    // La plantilla guarda la tarifa por unidad ("última usada" por unidad).
    const laborRateMicro = input.laborCost ?? 0;
    const laborCostMicro = Number(
      divRoundAway(BigInt(laborRateMicro) * BigInt(input.outputQty), BigInt(MICRO)),
    );

    // La tarifa de MO de la plantilla (si existe o se crea) siempre refleja la
    // última tarifa usada en un lote real de este material ("última usada").
    const tplRow = tx
      .select()
      .from(elaborationTemplates)
      .where(eq(elaborationTemplates.outputMaterialId, output.id))
      .get();
    if (tplRow) {
      tx.update(elaborationTemplates)
        .set({ laborCostMicro: laborRateMicro, updatedAt: nowISO() })
        .where(eq(elaborationTemplates.id, tplRow.id))
        .run();
    } else {
      tx.insert(elaborationTemplates)
        .values({ outputMaterialId: output.id, laborCostMicro: laborRateMicro })
        .run();
    }

    const [elaboration] = tx
      .insert(rawElaborations)
      .values({
        number,
        elaborationDate: input.elaborationDate,
        outputMaterialId: output.id,
        outputQtyMicro: input.outputQty,
        laborCostMicro,
        totalCostMicro: 0,
        unitCostMicro: 0,
        notes: input.notes ?? null,
        clientToken: input.clientToken ?? null,
      })
      .returning()
      .all();

    let materialCostMicro = 0;
    for (const line of lines) {
      const consumed = consumeFIFO(
        tx,
        "raw",
        line.material.id,
        line.qtyBaseMicro,
        line.material.name,
        (m) => fmt(m, line.material.unitId),
      );
      for (const c of consumed) {
        materialCostMicro += c.lineCostMicro;
        tx.insert(rawElaborationLines)
          .values({
            elaborationId: elaboration.id,
            rawMaterialId: line.material.id,
            lotId: c.lotId,
            qtyMicro: c.qtyMicro,
            unitCostMicro: c.unitCostMicro,
            lineCostMicro: c.lineCostMicro,
          })
          .run();
        tx.insert(inventoryMovements)
          .values({
            businessDate: input.elaborationDate,
            itemType: "raw",
            itemId: line.material.id,
            movementType: "elab_out",
            qtyDeltaMicro: -c.qtyMicro,
            unitCostMicro: c.unitCostMicro,
            valueMicro: -c.lineCostMicro,
            lotId: c.lotId,
            refType: "elaboration",
            refId: elaboration.id,
            notes: `Elaboración #${pad(number)} (${output.name})`,
          })
          .run();
      }
      tx.update(rawMaterials)
        .set({
          stockMicro: sql`${rawMaterials.stockMicro} - ${line.qtyBaseMicro}`,
          updatedAt: nowISO(),
        })
        .where(eq(rawMaterials.id, line.material.id))
        .run();
    }

    const totalCostMicro = materialCostMicro + laborCostMicro;
    const unitCostMicro = Number(
      divRoundAway(BigInt(totalCostMicro) * BigInt(MICRO), BigInt(input.outputQty)),
    );

    const lotId = createLot(tx, {
      itemType: "raw",
      itemId: output.id,
      refType: "elaboration",
      refId: elaboration.id,
      qtyMicro: input.outputQty,
      unitCostMicro,
      businessDate: input.elaborationDate,
    });
    tx.insert(inventoryMovements)
      .values({
        businessDate: input.elaborationDate,
        itemType: "raw",
        itemId: output.id,
        movementType: "elab_in",
        qtyDeltaMicro: input.outputQty,
        unitCostMicro,
        valueMicro: mulQtyPrice(input.outputQty, unitCostMicro),
        lotId,
        refType: "elaboration",
        refId: elaboration.id,
        notes: `Elaboración #${pad(number)}`,
      })
      .run();
    tx.update(rawMaterials)
      .set({
        stockMicro: sql`${rawMaterials.stockMicro} + ${input.outputQty}`,
        updatedAt: nowISO(),
      })
      .where(eq(rawMaterials.id, output.id))
      .run();

    tx.update(rawElaborations)
      .set({ totalCostMicro, unitCostMicro })
      .where(eq(rawElaborations.id, elaboration.id))
      .run();

    logAudit(tx, {
      action: "elaboration.confirm",
      entityType: "elaboration",
      entityId: elaboration.id,
      summary:
        `Elaboración #${pad(number)} confirmada: ${microToDecimalTrim(input.outputQty, 3)} ${output.unitId} de ` +
        `"${output.name}" — costo ${formatCUP(totalCostMicro)} (incluye MO ${formatCUP(laborCostMicro)}, ` +
        `${microToDecimalTrim(laborRateMicro, 2)}/${output.unitId})`,
      details: {
        outputMaterialId: output.id,
        outputQtyMicro: input.outputQty,
        materialCostMicro,
        laborCostMicro,
        totalCostMicro,
        unitCostMicro,
        lines: lines.map((l) => ({
          rawMaterialId: l.material.id,
          qtyBaseMicro: l.qtyBaseMicro,
        })),
      },
    });

    return {
      id: elaboration.id,
      number,
      outputQtyMicro: input.outputQty,
      materialCostMicro,
      laborCostMicro,
      totalCostMicro,
      unitCostMicro,
      duplicated: false,
    } satisfies ElaborationConfirmResult;
  });
}

export interface ElaborationListRow {
  id: number;
  number: number;
  elaborationDate: string;
  outputMaterialId: number;
  outputMaterialName: string;
  outputUnitId: string;
  outputQtyMicro: number;
  laborCostMicro: number;
  totalCostMicro: number;
  unitCostMicro: number;
  status: string;
  notes: string | null;
}

export function listElaborations(
  db: DB,
  opts?: { from?: string; to?: string; q?: string },
): ElaborationListRow[];
export function listElaborations(
  db: DB,
  opts: { from?: string; to?: string; q?: string } | undefined,
  paging: ListPaging,
): PageResult<ElaborationListRow>;
export function listElaborations(
  db: DB,
  opts: { from?: string; to?: string; q?: string } | undefined,
  paging: ListPaging | undefined,
): ElaborationListRow[] | PageResult<ElaborationListRow>;
export function listElaborations(
  db: DB,
  opts: { from?: string; to?: string; q?: string } = {},
  paging?: ListPaging,
): ElaborationListRow[] | PageResult<ElaborationListRow> {
  const conds = [];
  if (opts.from) conds.push(sql`${rawElaborations.elaborationDate} >= ${opts.from}`);
  if (opts.to) conds.push(sql`${rawElaborations.elaborationDate} <= ${opts.to}`);
  if (opts.q) {
    const like = "%" + opts.q + "%";
    conds.push(
      sql`(CAST(${rawElaborations.number} AS TEXT) LIKE ${like} OR ${rawMaterials.name} LIKE ${like})`,
    );
  }
  const where = conds.length ? and(...conds) : undefined;

  const select = {
    id: rawElaborations.id,
    number: rawElaborations.number,
    elaborationDate: rawElaborations.elaborationDate,
    outputMaterialId: rawElaborations.outputMaterialId,
    outputMaterialName: rawMaterials.name,
    outputUnitId: rawMaterials.unitId,
    outputQtyMicro: rawElaborations.outputQtyMicro,
    laborCostMicro: rawElaborations.laborCostMicro,
    totalCostMicro: rawElaborations.totalCostMicro,
    unitCostMicro: rawElaborations.unitCostMicro,
    status: rawElaborations.status,
    notes: rawElaborations.notes,
  };

  const base = db
    .select(select)
    .from(rawElaborations)
    .innerJoin(rawMaterials, eq(rawMaterials.id, rawElaborations.outputMaterialId))
    .where(where)
    .orderBy(desc(rawElaborations.elaborationDate), desc(rawElaborations.number));

  if (paging?.limit != null) {
    const totalRow = db
      .select({ c: sql<number>`COUNT(*)` })
      .from(rawElaborations)
      .innerJoin(rawMaterials, eq(rawMaterials.id, rawElaborations.outputMaterialId))
      .where(where)
      .get() as { c: number } | undefined;
    return {
      items: base.limit(paging.limit).offset(paging.offset ?? 0).all(),
      total: Number(totalRow?.c ?? 0),
    };
  }
  return base.all();
}

export function getElaborationDetail(db: DB, id: number) {
  const elaboration = db
    .select({
      id: rawElaborations.id,
      number: rawElaborations.number,
      elaborationDate: rawElaborations.elaborationDate,
      outputMaterialId: rawElaborations.outputMaterialId,
      outputMaterialName: rawMaterials.name,
      outputUnitId: rawMaterials.unitId,
      outputQtyMicro: rawElaborations.outputQtyMicro,
      laborCostMicro: rawElaborations.laborCostMicro,
      totalCostMicro: rawElaborations.totalCostMicro,
      unitCostMicro: rawElaborations.unitCostMicro,
      status: rawElaborations.status,
      notes: rawElaborations.notes,
      cancelledAt: rawElaborations.cancelledAt,
      cancelReason: rawElaborations.cancelReason,
      createdAt: rawElaborations.createdAt,
    })
    .from(rawElaborations)
    .innerJoin(rawMaterials, eq(rawMaterials.id, rawElaborations.outputMaterialId))
    .where(eq(rawElaborations.id, id))
    .get();
  if (!elaboration) throw notFoundError("Elaboración");

  const lines = db
    .select({
      id: rawElaborationLines.id,
      rawMaterialId: rawElaborationLines.rawMaterialId,
      materialName: rawMaterials.name,
      materialUnit: rawMaterials.unitId,
      lotId: rawElaborationLines.lotId,
      qtyMicro: rawElaborationLines.qtyMicro,
      unitCostMicro: rawElaborationLines.unitCostMicro,
      lineCostMicro: rawElaborationLines.lineCostMicro,
    })
    .from(rawElaborationLines)
    .innerJoin(rawMaterials, eq(rawMaterials.id, rawElaborationLines.rawMaterialId))
    .where(eq(rawElaborationLines.elaborationId, id))
    .orderBy(asc(rawElaborationLines.id))
    .all();

  return { ...elaboration, lines };
}

/**
 * Anula una elaboración: revierte los insumos consumidos y cancela el lote
 * producido. Se bloquea si el resultado ya fue consumido o si alguno de los
 * lotes de insumos tuvo movimientos posteriores.
 */
export function annulElaboration(db: DB, id: number, reason: string) {
  return db.transaction((tx) => {
    const elaboration = tx
      .select()
      .from(rawElaborations)
      .where(eq(rawElaborations.id, id))
      .get();
    if (!elaboration) throw notFoundError("Elaboración");
    if (elaboration.status === "anulada") throw conflictError("La elaboración ya fue anulada.");
    assertValidBusinessDate(tx, elaboration.elaborationDate, {
      label: "La fecha de elaboración",
    });

    const outputLots = tx
      .select()
      .from(stockLots)
      .where(and(eq(stockLots.refType, "elaboration"), eq(stockLots.refId, id)))
      .all();
    for (const lot of outputLots) {
      if (lot.qtyRemainingMicro < lot.qtyInitialMicro) {
        const mat = tx.select().from(rawMaterials).where(eq(rawMaterials.id, lot.itemId)).get();
        throw domainError(
          `No se puede anular: "${mat?.name ?? lot.itemId}" de esta elaboración ya fue consumido.`,
        );
      }
    }

    const lines = tx
      .select()
      .from(rawElaborationLines)
      .where(eq(rawElaborationLines.elaborationId, id))
      .all();
    const consumedByLot = new Map<number, number>();
    for (const line of lines) {
      consumedByLot.set(line.lotId, (consumedByLot.get(line.lotId) ?? 0) + line.qtyMicro);
    }
    for (const [lotId, qty] of consumedByLot) {
      const lot = tx.select().from(stockLots).where(eq(stockLots.id, lotId)).get();
      if (lot && lot.qtyRemainingMicro < lot.qtyInitialMicro - qty) {
        throw domainError(
          "No se puede anular: uno de los lotes de insumos tuvo movimientos posteriores.",
        );
      }
    }

    const now = nowISO();
    for (const lot of outputLots) {
      tx.update(stockLots).set({ cancelledAt: now }).where(eq(stockLots.id, lot.id)).run();
      tx.insert(inventoryMovements)
        .values({
          businessDate: elaboration.elaborationDate,
          itemType: "raw",
          itemId: lot.itemId,
          movementType: "cancel_elab_in",
          qtyDeltaMicro: -lot.qtyRemainingMicro,
          unitCostMicro: lot.unitCostMicro,
          valueMicro: -mulQtyPrice(lot.qtyRemainingMicro, lot.unitCostMicro),
          lotId: lot.id,
          refType: "elaboration",
          refId: id,
          reason,
          notes: `Anulación Elaboración #${pad(elaboration.number)}`,
        })
        .run();
      tx.update(rawMaterials)
        .set({
          stockMicro: sql`${rawMaterials.stockMicro} - ${lot.qtyRemainingMicro}`,
          updatedAt: now,
        })
        .where(eq(rawMaterials.id, lot.itemId))
        .run();
    }

    for (const line of lines) {
      tx.update(stockLots)
        .set({ qtyRemainingMicro: sql`${stockLots.qtyRemainingMicro} + ${line.qtyMicro}` })
        .where(eq(stockLots.id, line.lotId))
        .run();
      tx.insert(inventoryMovements)
        .values({
          businessDate: elaboration.elaborationDate,
          itemType: "raw",
          itemId: line.rawMaterialId,
          movementType: "cancel_elab_out",
          qtyDeltaMicro: line.qtyMicro,
          unitCostMicro: line.unitCostMicro,
          valueMicro: mulQtyPrice(line.qtyMicro, line.unitCostMicro),
          lotId: line.lotId,
          refType: "elaboration",
          refId: id,
          reason,
          notes: `Anulación Elaboración #${pad(elaboration.number)}`,
        })
        .run();
      tx.update(rawMaterials)
        .set({
          stockMicro: sql`${rawMaterials.stockMicro} + ${line.qtyMicro}`,
          updatedAt: now,
        })
        .where(eq(rawMaterials.id, line.rawMaterialId))
        .run();
    }

    tx.update(rawElaborations)
      .set({ status: "anulada", cancelledAt: now, cancelReason: reason })
      .where(eq(rawElaborations.id, id))
      .run();

    logAudit(tx, {
      action: "elaboration.annul",
      entityType: "elaboration",
      entityId: id,
      summary: `Elaboración #${pad(elaboration.number)} anulada`,
      details: { reason },
    });
    return { id, status: "anulada" as const };
  });
}

/**
 * Última tarifa de MO por unidad usada para el material de salida
 * (MO total del último lote ÷ unidades producidas). Precarga del formulario.
 */
export function lastElaborationLabor(db: DB, outputMaterialId: number): number | null {
  const row = db
    .select({ laborCostMicro: rawElaborations.laborCostMicro, outputQtyMicro: rawElaborations.outputQtyMicro })
    .from(rawElaborations)
    .where(
      and(
        eq(rawElaborations.outputMaterialId, outputMaterialId),
        sql`${rawElaborations.status} <> 'anulada'`,
      ),
    )
    .orderBy(desc(rawElaborations.elaborationDate), desc(rawElaborations.number))
    .limit(1)
    .get();
  if (!row || row.outputQtyMicro <= 0) return null;
  return Number(
    divRoundAway(BigInt(row.laborCostMicro) * BigInt(MICRO), BigInt(row.outputQtyMicro)),
  );
}

// ---------------------------------------------------------------------------
// Plantillas de elaboración (una por material resultante, editable)
// ---------------------------------------------------------------------------

export interface TemplateLineInfo {
  rawMaterialId: number;
  materialName: string;
  unitId: string; // unidad base del insumo
  qtyPerUnitMicro: number; // en unidad base del insumo
}

export interface TemplateInfo {
  outputMaterialId: number;
  laborCostMicro: number;
  lines: TemplateLineInfo[];
}

export const templateInput = z.object({
  // Tarifa de MO POR UNIDAD de la plantilla; null/ausente = se mantiene vigente.
  laborCost: decMicro().optional().nullable(),
  lines: z
    .array(
      z.object({
        rawMaterialId: z.number().int().positive("Insumo requerido."),
        unitId: z.string().min(1, "Unidad requerida."),
        // Cantidad del insumo (en unitId) por 1 unidad completa del material.
        qtyPerUnit: decMicro({ minExclusive: true }),
      }),
    )
    .optional()
    .default([]),
});
export type TemplateInput = z.infer<typeof templateInput>;

/** Plantilla de un material resultante (null si no existe). */
export function getElaborationTemplate(db: DB, outputMaterialId: number): TemplateInfo | null {
  const material = db
    .select({ id: rawMaterials.id })
    .from(rawMaterials)
    .where(eq(rawMaterials.id, outputMaterialId))
    .get();
  if (!material) throw notFoundError("Materia prima");
  const tpl = db
    .select()
    .from(elaborationTemplates)
    .where(eq(elaborationTemplates.outputMaterialId, outputMaterialId))
    .get();
  if (!tpl) return null;
  const lines = db
    .select({
      rawMaterialId: elaborationTemplateLines.rawMaterialId,
      materialName: rawMaterials.name,
      unitId: rawMaterials.unitId,
      qtyPerUnitMicro: elaborationTemplateLines.qtyPerUnitMicro,
    })
    .from(elaborationTemplateLines)
    .innerJoin(rawMaterials, eq(rawMaterials.id, elaborationTemplateLines.rawMaterialId))
    .where(eq(elaborationTemplateLines.templateId, tpl.id))
    .orderBy(asc(elaborationTemplateLines.id))
    .all();
  return {
    outputMaterialId: outputMaterialId,
    laborCostMicro: tpl.laborCostMicro,
    lines,
  };
}

/**
 * Guarda (upsert) la plantilla única del material resultante: reemplaza
 * líneas y MO. Las cantidades se aceptan en cualquier unidad compatible y
 * quedan normalizadas a la unidad base del insumo.
 */
export function saveElaborationTemplate(
  db: DB,
  catalog: UnitsCatalog,
  outputMaterialId: number,
  input: TemplateInput,
): TemplateInfo {
  return db.transaction((tx) => {
    const output = resolveOutput(tx, catalog, outputMaterialId);
    const seen = new Set<number>();
    const rows: Array<typeof elaborationTemplateLines.$inferInsert> = [];
    for (const line of input.lines) {
      if (line.rawMaterialId === output.id) {
        throw domainError(`"${output.name}" no puede ser insumo de su propia elaboración.`);
      }
      if (seen.has(line.rawMaterialId)) {
        throw domainError("Un insumo está repetido en la plantilla.");
      }
      seen.add(line.rawMaterialId);
      const material = tx
        .select()
        .from(rawMaterials)
        .where(eq(rawMaterials.id, line.rawMaterialId))
        .get();
      if (!material) throw notFoundError("Materia prima insumo");
      if (!material.active) {
        throw domainError(
          `La materia prima "${material.name}" está inactiva y no puede estar en la plantilla.`,
        );
      }
      catalog.assertCompatible(line.unitId, material.unitId);
      // qty por 1 unidad completa del material resultante, en base del insumo.
      const qtyPerUnitBase = catalog.toBase(line.qtyPerUnit, line.unitId, material.unitId);
      if (qtyPerUnitBase <= 0) {
        throw domainError(
          `La cantidad por unidad de "${material.name}" es demasiado pequeña para su unidad base (${material.unitId}).`,
        );
      }
      rows.push({
        templateId: 0, // repuesto tras crear/actualizar la cabecera
        rawMaterialId: material.id,
        qtyPerUnitMicro: qtyPerUnitBase,
      });
    }

    const now = nowISO();
    let tpl = tx
      .select()
      .from(elaborationTemplates)
      .where(eq(elaborationTemplates.outputMaterialId, outputMaterialId))
      .get();
    if (tpl) {
      tx.update(elaborationTemplates)
        .set({ laborCostMicro: input.laborCost ?? tpl.laborCostMicro, updatedAt: now })
        .where(eq(elaborationTemplates.id, tpl.id))
        .run();
      tx.delete(elaborationTemplateLines)
        .where(eq(elaborationTemplateLines.templateId, tpl.id))
        .run();
    } else {
      const [created] = tx
        .insert(elaborationTemplates)
        .values({
          outputMaterialId,
          laborCostMicro: input.laborCost ?? 0,
        })
        .returning()
        .all();
      tpl = created;
    }
    for (const row of rows) {
      tx.insert(elaborationTemplateLines)
        .values({ ...row, templateId: tpl.id })
        .run();
    }

    logAudit(tx, {
      action: "elaboration.template.save",
      entityType: "elaboration_template",
      entityId: tpl.id,
      summary:
        `Plantilla de elaboración guardada para "${output.name}" — ` +
        `${rows.length} insumo(s), MO ${formatCUP(tpl.laborCostMicro)} por unidad`,
      details: { outputMaterialId, lines: rows, laborCostMicro: tpl.laborCostMicro },
    });

    return getElaborationTemplate(db, outputMaterialId) as TemplateInfo;
  });
}

export interface ElaborationPreviewLine {
  rawMaterialId: number;
  materialName: string;
  unitId: string;
  qtyMicro: number;
  qtyBaseMicro: number;
  availableMicro: number;
  avgCostMicro: number;
  estimatedCostMicro: number;
  insufficient: boolean;
}

export interface ElaborationPreviewResult {
  outputMaterialId: number | null;
  outputMaterialName: string | null;
  outputUnitId: string | null;
  outputQtyMicro: number | null;
  outputStockMicro: number | null;
  laborCostMicro: number;
  materialCostMicro: number;
  totalCostMicro: number;
  unitCostMicro: number | null;
  lastLaborCostMicro: number | null;
  lines: ElaborationPreviewLine[];
  hasInsufficient: boolean;
}

/**
 * Estimación previa (no persiste nada): valúa los insumos con el promedio PEPS
 * vigente y, si se eligió material resultante con cantidad, el costo unitario
 * esperado de la elaboración.
 */
export function previewElaboration(
  db: DBOrTx,
  catalog: UnitsCatalog,
  input: ElaborationPreviewInput,
): ElaborationPreviewResult {
  const output = input.outputMaterialId ? resolveOutput(db, catalog, input.outputMaterialId) : null;
  const items = input.items ?? [];
  const lines: ElaborationPreviewLine[] = [];
  const seen = new Set<number>();
  let materialCostMicro = 0;
  let hasInsufficient = false;

  for (const it of items) {
    if (output && it.rawMaterialId === output.id) {
      throw domainError(`"${output.name}" no puede ser insumo de su propia elaboración.`);
    }
    if (seen.has(it.rawMaterialId)) {
      throw domainError("Un insumo está repetido: combine las cantidades en una sola línea.");
    }
    seen.add(it.rawMaterialId);

    const material = db
      .select()
      .from(rawMaterials)
      .where(eq(rawMaterials.id, it.rawMaterialId))
      .get();
    if (!material) throw notFoundError("Materia prima insumo");
    if (!material.active) {
      throw domainError(`La materia prima "${material.name}" está inactiva y no puede consumirse.`);
    }
    catalog.assertCompatible(it.unitId, material.unitId);
    const qtyBaseMicro = catalog.toBase(it.qty, it.unitId, material.unitId);
    const availableMicro = availableStock(db, "raw", material.id);
    const avgCostMicro = estimatedAvgCost(db, "raw", material.id);
    const estimatedCostMicro = mulQtyPrice(qtyBaseMicro, avgCostMicro);
    const insufficient = availableMicro < qtyBaseMicro;
    if (insufficient) hasInsufficient = true;
    materialCostMicro += estimatedCostMicro;
    lines.push({
      rawMaterialId: material.id,
      materialName: material.name,
      unitId: it.unitId,
      qtyMicro: it.qty,
      qtyBaseMicro,
      availableMicro,
      avgCostMicro,
      estimatedCostMicro,
      insufficient,
    });
  }

  // MO total del estimado = tarifa por unidad × cantidad a elaborar.
  const laborRateMicro = input.laborCost ?? 0;
  const laborCostMicro =
    output && input.outputQty != null
      ? Number(divRoundAway(BigInt(laborRateMicro) * BigInt(input.outputQty), BigInt(MICRO)))
      : 0;
  const totalCostMicro = materialCostMicro + laborCostMicro;
  const outputQtyMicro = output ? (input.outputQty ?? null) : null;
  const unitCostMicro =
    output && input.outputQty != null && input.outputQty > 0
      ? Number(
          divRoundAway(BigInt(totalCostMicro) * BigInt(MICRO), BigInt(input.outputQty)),
        )
      : null;

  return {
    outputMaterialId: output?.id ?? null,
    outputMaterialName: output?.name ?? null,
    outputUnitId: output?.unitId ?? null,
    outputQtyMicro,
    outputStockMicro: output ? availableStock(db, "raw", output.id) : null,
    laborCostMicro,
    materialCostMicro,
    totalCostMicro,
    unitCostMicro,
    lastLaborCostMicro: output ? lastElaborationLabor(db as DB, output.id) : null,
    lines,
    hasInsufficient,
  };
}
