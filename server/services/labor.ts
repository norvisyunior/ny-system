/**
 * Resumen de mano de obra a pagar a los trabajadores.
 *
 * Cada proceso productivo registró su mano de obra como costo directo:
 * - production_batches.labor_cost_micro   → producción de N masas completas;
 * - raw_elaborations.labor_cost_micro     → elaboración de materias primas;
 * - transformations.labor_cost_micro      → terminación/empaquetado.
 *
 * El resumen lista las operaciones confirmadas del rango, agrupadas por día y
 * por semana (la semana inicia el lunes). Las anuladas se excluyen porque su
 * costo fue revertido.
 */
import {
  masses,
  productionBatches,
  rawElaborations,
  rawMaterials,
  recipeVersions,
  recipes,
  transformations,
} from "../../db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { domainError } from "../domain/errors";
import { microToDecimalTrim } from "../../shared/money";
import type { DBOrTx } from "../domain/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type LaborKind = "produccion" | "elaboracion" | "terminacion";

export const LABOR_KIND_LABEL: Record<LaborKind, string> = {
  produccion: "Producción de masas",
  elaboracion: "Elaboración de materias primas",
  terminacion: "Terminación / empaquetado",
};

export interface LaborOpRow {
  id: number;
  kind: LaborKind;
  kindLabel: string;
  number: number;
  date: string;
  name: string;
  detail: string;
  responsible: string | null;
  laborCostMicro: number;
}

export interface LaborDayRow {
  date: string;
  opsCount: number;
  totalMicro: number;
  byKind: Record<LaborKind, number>;
  ops: LaborOpRow[];
}

export interface LaborWeekRow {
  weekStart: string;
  weekEnd: string;
  opsCount: number;
  totalMicro: number;
  byKind: Record<LaborKind, number>;
  days: LaborDayRow[];
}

export interface LaborSummary {
  from: string;
  to: string;
  ops: LaborOpRow[];
  days: LaborDayRow[];
  weeks: LaborWeekRow[];
  totals: {
    opsCount: number;
    totalMicro: number;
    byKind: Record<LaborKind, number>;
  };
}

function emptyKind(): Record<LaborKind, number> {
  return { produccion: 0, elaboracion: 0, terminacion: 0 };
}

/** Lunes de la semana a la que pertenece la fecha ISO (zona local). */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const dow = d.getDay(); // 0 domingo … 6 sábado
  const back = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - back);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Domingo (fin) de la semana que inicia en `weekStart`. */
function weekEndOf(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00`);
  d.setDate(d.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lunes de la semana en curso (para el rango por defecto). */
export function currentWeekStartISO(): string {
  const d = new Date();
  const dow = d.getDay();
  const back = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - back);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function validateLaborRange(from: string, to: string): void {
  if (!DATE_RE.test(from) || Number.isNaN(Date.parse(from))) {
    throw domainError(`La fecha desde "${from}" no es válida (YYYY-MM-DD).`);
  }
  if (!DATE_RE.test(to) || Number.isNaN(Date.parse(to))) {
    throw domainError(`La fecha hasta "${to}" no es válida (YYYY-MM-DD).`);
  }
  if (from > to) {
    throw domainError(`La fecha desde (${from}) no puede ser posterior a hasta (${to}).`);
  }
}

export function laborSummary(db: DBOrTx, from: string, to: string): LaborSummary {
  validateLaborRange(from, to);
  const ops: LaborOpRow[] = [];

  const productions = db
    .select({
      id: productionBatches.id,
      number: productionBatches.number,
      date: productionBatches.productionDate,
      recipeName: recipes.name,
      version: recipeVersions.version,
      massName: masses.name,
      realYieldMicro: productionBatches.realYieldMicro,
      yieldUnitId: productionBatches.yieldUnitId,
      responsible: productionBatches.responsible,
      laborCostMicro: productionBatches.laborCostMicro,
    })
    .from(productionBatches)
    .innerJoin(recipeVersions, eq(recipeVersions.id, productionBatches.recipeVersionId))
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(masses, eq(masses.id, recipeVersions.massId))
    .where(
      and(
        eq(productionBatches.status, "confirmada"),
        sql`${productionBatches.productionDate} >= ${from}`,
        sql`${productionBatches.productionDate} <= ${to}`,
      ),
    )
    .orderBy(asc(productionBatches.productionDate), asc(productionBatches.number))
    .all();

  for (const p of productions) {
    const masas = Number(microToDecimalTrim(Math.trunc(Number(p.realYieldMicro ?? 0)), 3));
    ops.push({
      id: p.id,
      kind: "produccion",
      kindLabel: LABOR_KIND_LABEL.produccion,
      number: p.number,
      date: p.date,
      name: `${p.recipeName ?? "Receta"} · masa ${p.massName}`,
      detail: `${masas} masa(s) elaborada(s) — ${p.massName}`,
      responsible: p.responsible ?? null,
      laborCostMicro: Math.trunc(Number(p.laborCostMicro ?? 0)),
    });
  }

  const elaborations = db
    .select({
      id: rawElaborations.id,
      number: rawElaborations.number,
      date: rawElaborations.elaborationDate,
      materialName: rawMaterials.name,
      unitId: rawMaterials.unitId,
      outputQtyMicro: rawElaborations.outputQtyMicro,
      laborCostMicro: rawElaborations.laborCostMicro,
    })
    .from(rawElaborations)
    .innerJoin(rawMaterials, eq(rawMaterials.id, rawElaborations.outputMaterialId))
    .where(
      and(
        eq(rawElaborations.status, "confirmada"),
        sql`${rawElaborations.elaborationDate} >= ${from}`,
        sql`${rawElaborations.elaborationDate} <= ${to}`,
      ),
    )
    .orderBy(asc(rawElaborations.elaborationDate), asc(rawElaborations.number))
    .all();

  for (const e of elaborations) {
    const qty = microToDecimalTrim(Math.trunc(Number(e.outputQtyMicro ?? 0)), 3);
    ops.push({
      id: e.id,
      kind: "elaboracion",
      kindLabel: LABOR_KIND_LABEL.elaboracion,
      number: e.number,
      date: e.date,
      name: `Elaboración de ${e.materialName}`,
      detail: `${qty} ${e.unitId} de ${e.materialName}`,
      responsible: null,
      laborCostMicro: Math.trunc(Number(e.laborCostMicro ?? 0)),
    });
  }

  const termRows = db
    .select({
      id: transformations.id,
      number: transformations.number,
      date: transformations.transformDate,
      massName: masses.name,
      realPackagesMicro: sql<number>`COALESCE((SELECT SUM(tr.qty_micro) FROM transformation_outputs tr WHERE tr.transformation_id = ${transformations.id}), 0)`,
      laborCostMicro: transformations.laborCostMicro,
    })
    .from(transformations)
    .innerJoin(masses, eq(masses.id, transformations.massId))
    .where(
      and(
        eq(transformations.status, "confirmada"),
        sql`${transformations.transformDate} >= ${from}`,
        sql`${transformations.transformDate} <= ${to}`,
      ),
    )
    .orderBy(asc(transformations.transformDate), asc(transformations.number))
    .all();

  for (const t of termRows) {
    const pkgs = microToDecimalTrim(Math.trunc(Number(t.realPackagesMicro ?? 0)), 3);
    ops.push({
      id: t.id,
      kind: "terminacion",
      kindLabel: LABOR_KIND_LABEL.terminacion,
      number: t.number,
      date: t.date,
      name: `Terminación de ${t.massName}`,
      detail: `${pkgs} paquete(s) obtenido(s) de ${t.massName}`,
      responsible: null,
      laborCostMicro: Math.trunc(Number(t.laborCostMicro ?? 0)),
    });
  }

  ops.sort((a, b) => (a.date === b.date ? a.number - b.number : a.date < b.date ? 1 : -1));

  const byDate = new Map<string, LaborDayRow>();
  const totalsByKind = emptyKind();
  let total = 0;
  for (const op of ops) {
    let day = byDate.get(op.date);
    if (!day) {
      day = { date: op.date, opsCount: 0, totalMicro: 0, byKind: emptyKind(), ops: [] };
      byDate.set(op.date, day);
    }
    day.opsCount += 1;
    day.totalMicro = Math.trunc(day.totalMicro + op.laborCostMicro);
    day.byKind[op.kind] = Math.trunc(day.byKind[op.kind] + op.laborCostMicro);
    day.ops.push(op);
    totalsByKind[op.kind] = Math.trunc(totalsByKind[op.kind] + op.laborCostMicro);
    total = Math.trunc(total + op.laborCostMicro);
  }

  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  const weeks: LaborWeekRow[] = [];
  let currentWeekStart: string | null = null;
  let currentWeek: LaborWeekRow | null = null;
  for (const day of days) {
    const ws = weekStartOf(day.date);
    if (ws !== currentWeekStart) {
      currentWeekStart = ws;
      currentWeek = {
        weekStart: ws,
        weekEnd: weekEndOf(ws),
        opsCount: 0,
        totalMicro: 0,
        byKind: emptyKind(),
        days: [],
      };
      weeks.push(currentWeek);
    }
    currentWeek!.opsCount += day.opsCount;
    currentWeek!.totalMicro = Math.trunc(currentWeek!.totalMicro + day.totalMicro);
    for (const k of ["produccion", "elaboracion", "terminacion"] as LaborKind[]) {
      currentWeek!.byKind[k] = Math.trunc(currentWeek!.byKind[k] + day.byKind[k]);
    }
    currentWeek!.days.push(day);
  }

  return {
    from,
    to,
    ops,
    days,
    weeks,
    totals: {
      opsCount: ops.length,
      totalMicro: total,
      byKind: totalsByKind,
    },
  };
}
