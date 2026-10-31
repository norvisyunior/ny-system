/**
 * Activos fijos tangibles — registro profesional con depreciación lineal.
 *
 * Cada activo es un bien unitario (no usa stock_lots ni inventario PEPS).
 * La depreciación se asienta por mes (periodo 'YYYY-MM') de forma idempotente:
 * - método lineal: cuota = (costo − valor residual) / vida útil en meses;
 * - el último mes absorbe el redondeo para que la suma sea exacta;
 * - cada mes asentado crea un gasto "Depreciación de activos" (impacta el P&L);
 * - la baja deprecia hasta el mes de la baja y reconoce la pérdida contable
 *   (valor en libros − valor recuperado) como gasto, si la hay.
 *
 * Nota: los asientos de depreciación se insertan directo en expenses (sin la
 * validación de día cerrado) porque son ajustes contables de periodo.
 */
import {
  expenses,
  fixedAssetDepreciations,
  fixedAssets,
  suppliers,
} from "../../db/schema";
import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import {
  addMonthsToPeriod,
  lastDayOfMonth,
  monthOfISO,
  nowISO,
  todayISO,
} from "../domain/dates";
import { decMicro } from "../domain/zod-helpers";
import { formatCUP } from "../../shared/money";
import type { ListPaging, PageResult } from "../domain/paging";
import type { DB, DBOrTx } from "../domain/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const DISPOSE_TYPES = ["venta", "danado", "obsoleto", "otro"] as const;

export const assetInput = z
  .object({
    name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(120),
    category: z.string().trim().max(80).optional().nullable(),
    acquiredAt: z.string().min(1, "La fecha de adquisición es obligatoria."),
    cost: decMicro({ minExclusive: true }),
    residual: decMicro().optional(),
    usefulLifeMonths: z
      .number()
      .int("La vida útil debe ser en meses enteros.")
      .min(1, "La vida útil debe ser al menos 1 mes.")
      .max(600, "La vida útil no puede exceder 600 meses."),
    supplierId: z.number().int().positive().optional().nullable(),
    location: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => (v.residual ?? 0) < v.cost, {
    message: "El valor residual debe ser menor que el costo de adquisición.",
    path: ["residual"],
  });
export type AssetInput = z.infer<typeof assetInput>;

export const assetDisposeInput = z.object({
  disposeDate: z.string().min(1, "La fecha de baja es obligatoria."),
  disposeType: z.enum(DISPOSE_TYPES, {
    errorMap: () => ({ message: "Tipo de baja inválido (venta, dañado, obsoleto u otro)." }),
  }),
  recoveryValue: decMicro().optional(),
  reason: z.string().trim().max(300).optional().nullable(),
});
export type AssetDisposeInput = z.infer<typeof assetDisposeInput>;

export interface AssetListRow {
  id: number;
  code: string;
  name: string;
  category: string | null;
  acquiredAt: string;
  costMicro: number;
  residualMicro: number;
  usefulLifeMonths: number;
  method: string;
  supplierId: number | null;
  supplierName: string | null;
  location: string | null;
  status: string;
  disposedAt: string | null;
  disposeType: string | null;
  recoveryValueMicro: number;
  monthlyMicro: number;
  depreciatedMicro: number;
  bookValueMicro: number;
}

function validateDate(date: string, label: string): void {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw domainError(`${label} "${date}" no es una fecha válida (YYYY-MM-DD).`);
  }
  if (date > todayISO()) {
    throw domainError(`${label} no puede ser futura (${date}).`);
  }
}

/** Cuota base mensual (el último mes absorbe el resto por redondeo). */
export function monthlyAmount(asset: {
  costMicro: number;
  residualMicro: number;
  usefulLifeMonths: number;
}): number {
  const depreciable = asset.costMicro - asset.residualMicro;
  return Math.floor(depreciable / asset.usefulLifeMonths);
}

function amountForMonth(
  asset: { costMicro: number; residualMicro: number; usefulLifeMonths: number },
  monthIndex: number,
): number {
  const depreciable = asset.costMicro - asset.residualMicro;
  const base = monthlyAmount(asset);
  return monthIndex === asset.usefulLifeMonths - 1
    ? depreciable - base * (asset.usefulLifeMonths - 1)
    : base;
}

function validateSupplier(tx: DBOrTx, supplierId: number | null | undefined): void {
  if (supplierId == null) return;
  const supplier = tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).get();
  if (!supplier) throw notFoundError("Proveedor");
}

export function createAsset(db: DB, input: AssetInput) {
  return db.transaction((tx) => {
    validateDate(input.acquiredAt, "La fecha de adquisición");
    validateSupplier(tx, input.supplierId);

    const [created] = tx
      .insert(fixedAssets)
      .values({
        code: "AF-TMP",
        name: input.name,
        category: input.category ?? null,
        acquiredAt: input.acquiredAt,
        costMicro: input.cost,
        residualMicro: input.residual ?? 0,
        usefulLifeMonths: input.usefulLifeMonths,
        supplierId: input.supplierId ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
      })
      .returning()
      .all();

    const code = `AF-${String(created.id).padStart(4, "0")}`;
    const [row] = tx
      .update(fixedAssets)
      .set({ code })
      .where(eq(fixedAssets.id, created.id))
      .returning()
      .all();

    logAudit(tx, {
      action: "asset.create",
      entityType: "fixed_asset",
      entityId: row.id,
      summary: `Activo fijo creado: ${row.code} — ${row.name} (${formatCUP(row.costMicro)})`,
      details: {
        acquiredAt: row.acquiredAt,
        usefulLifeMonths: row.usefulLifeMonths,
        residualMicro: row.residualMicro,
      },
    });
    return row;
  });
}

export function updateAsset(db: DB, id: number, input: AssetInput) {
  return db.transaction((tx) => {
    const existing = tx.select().from(fixedAssets).where(eq(fixedAssets.id, id)).get();
    if (!existing) throw notFoundError("Activo fijo");
    if (existing.status === "baja") {
      throw domainError("El activo está dado de baja y no puede editarse.");
    }
    validateDate(input.acquiredAt, "La fecha de adquisición");
    validateSupplier(tx, input.supplierId);

    const depCount =
      tx
        .select({ c: sql<number>`COUNT(*)` })
        .from(fixedAssetDepreciations)
        .where(eq(fixedAssetDepreciations.assetId, id))
        .get()?.c ?? 0;
    const financialChanged =
      input.acquiredAt !== existing.acquiredAt ||
      input.cost !== existing.costMicro ||
      (input.residual ?? 0) !== existing.residualMicro ||
      input.usefulLifeMonths !== existing.usefulLifeMonths;
    if (Number(depCount) > 0 && financialChanged) {
      throw domainError(
        `"${existing.name}" ya tiene depreciaciones asentadas: no se puede cambiar fecha, costo, residual ni vida útil. ` +
          `Solo se permiten cambios descriptivos (nombre, categoría, proveedor, ubicación, notas).`,
      );
    }

    const [row] = tx
      .update(fixedAssets)
      .set({
        name: input.name,
        category: input.category ?? null,
        acquiredAt: input.acquiredAt,
        costMicro: input.cost,
        residualMicro: input.residual ?? 0,
        usefulLifeMonths: input.usefulLifeMonths,
        supplierId: input.supplierId ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        updatedAt: nowISO(),
      })
      .where(eq(fixedAssets.id, id))
      .returning()
      .all();

    logAudit(tx, {
      action: "asset.update",
      entityType: "fixed_asset",
      entityId: id,
      summary: `Activo fijo actualizado: ${row.code} — ${row.name}`,
      details: { before: existing, after: row },
    });
    return row;
  });
}

export function listAssets(
  db: DBOrTx,
  opts?: { q?: string; status?: string; category?: string },
): AssetListRow[];
export function listAssets(
  db: DBOrTx,
  opts: { q?: string; status?: string; category?: string } | undefined,
  paging: ListPaging,
): PageResult<AssetListRow>;
export function listAssets(
  db: DBOrTx,
  opts: { q?: string; status?: string; category?: string } | undefined,
  paging: ListPaging | undefined,
): AssetListRow[] | PageResult<AssetListRow>;
export function listAssets(
  db: DBOrTx,
  opts: { q?: string; status?: string; category?: string } = {},
  paging?: ListPaging,
): AssetListRow[] | PageResult<AssetListRow> {
  const conds = [];
  if (opts.q) {
    conds.push(
      sql`(${fixedAssets.code} LIKE ${"%" + opts.q + "%"} OR ${fixedAssets.name} LIKE ${"%" + opts.q + "%"} OR ${fixedAssets.category} LIKE ${"%" + opts.q + "%"})`,
    );
  }
  if (opts.status) conds.push(eq(fixedAssets.status, opts.status));
  if (opts.category) conds.push(eq(fixedAssets.category, opts.category));
  const where = conds.length ? and(...conds) : undefined;

  const depreciated = sql<number>`COALESCE((SELECT SUM(d.amount_micro) FROM fixed_asset_depreciations d WHERE d.asset_id = ${fixedAssets.id}), 0)`;

  const base = db
    .select({ ...getTableColumns(fixedAssets), supplierName: suppliers.name, depreciatedMicro: depreciated })
    .from(fixedAssets)
    .leftJoin(suppliers, eq(suppliers.id, fixedAssets.supplierId))
    .where(where)
    .orderBy(asc(fixedAssets.code));

  let rows: ReturnType<typeof base.all> = [];
  let total = 0;
  if (paging?.limit != null) {
    const totalRow = db
      .select({ c: sql<number>`COUNT(*)` })
      .from(fixedAssets)
      .where(where)
      .get() as { c: number } | undefined;
    total = Number(totalRow?.c ?? 0);
    rows = base.limit(paging.limit).offset(paging.offset ?? 0).all();
  } else {
    rows = base.all();
  }

  const mapped: AssetListRow[] = rows.map((r) => {
    const depreciatedMicro = Math.trunc(Number(r.depreciatedMicro ?? 0));
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      acquiredAt: r.acquiredAt,
      costMicro: r.costMicro,
      residualMicro: r.residualMicro,
      usefulLifeMonths: r.usefulLifeMonths,
      method: r.method,
      supplierId: r.supplierId,
      supplierName: r.supplierName ?? null,
      location: r.location,
      status: r.status,
      disposedAt: r.disposedAt,
      disposeType: r.disposeType,
      recoveryValueMicro: r.recoveryValueMicro,
      monthlyMicro: monthlyAmount(r),
      depreciatedMicro,
      bookValueMicro: r.costMicro - depreciatedMicro,
    };
  });

  if (paging?.limit != null) return { items: mapped, total };
  return mapped;
}

export function getAssetDetail(db: DBOrTx, id: number) {
  const row = db
    .select({ ...getTableColumns(fixedAssets), supplierName: suppliers.name })
    .from(fixedAssets)
    .leftJoin(suppliers, eq(suppliers.id, fixedAssets.supplierId))
    .where(eq(fixedAssets.id, id))
    .get();
  if (!row) throw notFoundError("Activo fijo");

  const depreciations = db
    .select({
      id: fixedAssetDepreciations.id,
      period: fixedAssetDepreciations.period,
      amountMicro: fixedAssetDepreciations.amountMicro,
      expenseId: fixedAssetDepreciations.expenseId,
      expenseStatus: expenses.status,
      createdAt: fixedAssetDepreciations.createdAt,
    })
    .from(fixedAssetDepreciations)
    .leftJoin(expenses, eq(expenses.id, fixedAssetDepreciations.expenseId))
    .where(eq(fixedAssetDepreciations.assetId, id))
    .orderBy(desc(fixedAssetDepreciations.period))
    .all();

  const depreciatedMicro = depreciations.reduce((acc, d) => acc + d.amountMicro, 0);

  return {
    asset: row,
    depreciations,
    monthlyMicro: monthlyAmount(row),
    depreciatedMicro,
    bookValueMicro: row.costMicro - depreciatedMicro,
    depreciableMicro: row.costMicro - row.residualMicro,
  };
}

interface DepreciationSummary {
  created: number;
  skipped: number;
  totalMicro: number;
}

/** Asienta en la transacción los meses pendientes de un activo hasta el periodo. */
function depreciateAssetInTx(
  tx: DBOrTx,
  asset: {
    id: number;
    code: string;
    name: string;
    acquiredAt: string;
    costMicro: number;
    residualMicro: number;
    usefulLifeMonths: number;
  },
  untilPeriod: string,
): DepreciationSummary {
  const existing = new Set(
    tx
      .select({ period: fixedAssetDepreciations.period })
      .from(fixedAssetDepreciations)
      .where(eq(fixedAssetDepreciations.assetId, asset.id))
      .all()
      .map((r) => r.period),
  );

  const currentPeriod = monthOfISO(todayISO());
  const firstPeriod = monthOfISO(asset.acquiredAt);
  let created = 0;
  let skipped = 0;
  let totalMicro = 0;

  for (let i = 0; i < asset.usefulLifeMonths; i += 1) {
    const period = addMonthsToPeriod(firstPeriod, i);
    if (period > untilPeriod) break;
    if (existing.has(period)) {
      skipped += 1;
      continue;
    }
    const amount = amountForMonth(asset, i);
    if (amount <= 0) continue;

    // En el mes en curso se usa la fecha de hoy para que el gasto pueda verse
    // de inmediato; en periodos pasados, el último día del mes.
    const expenseDate = period === currentPeriod ? todayISO() : lastDayOfMonth(period);
    const [expense] = tx
      .insert(expenses)
      .values({
        expenseDate,
        category: "Depreciación de activos",
        description: `Depreciación ${asset.code} — ${asset.name} (${period})`,
        amountMicro: amount,
        paymentMethod: "otro",
        notes: `Depreciación automática mensual (método lineal).`,
      })
      .returning()
      .all();

    tx.insert(fixedAssetDepreciations)
      .values({ assetId: asset.id, period, amountMicro: amount, expenseId: expense.id })
      .run();
    created += 1;
    totalMicro += amount;
  }

  return { created, skipped, totalMicro };
}

export function depreciateAssets(db: DB, opts: { untilPeriod?: string } = {}) {
  return db.transaction((tx) => {
    const currentPeriod = monthOfISO(todayISO());
    const untilPeriod = opts.untilPeriod ?? currentPeriod;
    if (!PERIOD_RE.test(untilPeriod)) {
      throw domainError(`El periodo "${untilPeriod}" no es válido (formato YYYY-MM).`);
    }
    if (untilPeriod > currentPeriod) {
      throw domainError(`No se puede depreciar un periodo futuro (${untilPeriod}).`);
    }

    const assets = tx.select().from(fixedAssets).where(eq(fixedAssets.status, "en_uso")).all();
    let created = 0;
    let skipped = 0;
    let totalMicro = 0;
    for (const asset of assets) {
      const r = depreciateAssetInTx(tx, asset, untilPeriod);
      created += r.created;
      skipped += r.skipped;
      totalMicro += r.totalMicro;
    }

    logAudit(tx, {
      action: "asset.depreciate",
      entityType: "fixed_asset",
      summary: `Depreciación asentada hasta ${untilPeriod}: ${created} cuota(s) — ${formatCUP(totalMicro)}`,
      details: { untilPeriod, assets: assets.length, created, skipped, totalMicro },
    });

    return { untilPeriod, assetsProcessed: assets.length, created, skipped, totalMicro };
  });
}

export function disposeAsset(db: DB, id: number, input: AssetDisposeInput) {
  return db.transaction((tx) => {
    const asset = tx.select().from(fixedAssets).where(eq(fixedAssets.id, id)).get();
    if (!asset) throw notFoundError("Activo fijo");
    if (asset.status === "baja") throw domainError("El activo ya está dado de baja.");
    validateDate(input.disposeDate, "La fecha de baja");
    if (input.disposeDate < asset.acquiredAt) {
      throw domainError("La fecha de baja no puede ser anterior a la adquisición del activo.");
    }

    // Deprecia hasta el mes de la baja para reconocer la pérdida real.
    const untilPeriod = monthOfISO(input.disposeDate);
    depreciateAssetInTx(tx, asset, untilPeriod);

    const rows = tx
      .select({ amountMicro: fixedAssetDepreciations.amountMicro })
      .from(fixedAssetDepreciations)
      .where(eq(fixedAssetDepreciations.assetId, id))
      .all();
    const depreciatedMicro = rows.reduce((acc, r) => acc + r.amountMicro, 0);
    const bookValueMicro = asset.costMicro - depreciatedMicro;
    const recoveryValueMicro = input.recoveryValue ?? 0;
    const lossMicro = Math.max(0, bookValueMicro - recoveryValueMicro);
    const gainMicro = Math.max(0, recoveryValueMicro - bookValueMicro);

    let expenseId: number | null = null;
    if (lossMicro > 0) {
      const [expense] = tx
        .insert(expenses)
        .values({
          expenseDate: input.disposeDate,
          category: "Pérdida por baja de activo",
          description: `Baja de ${asset.code} — ${asset.name} (${input.disposeType})`,
          amountMicro: lossMicro,
          paymentMethod: "otro",
          notes: `Valor en libros ${formatCUP(bookValueMicro)}, recuperado ${formatCUP(recoveryValueMicro)}.`,
        })
        .returning()
        .all();
      expenseId = expense.id;
    }

    const note = input.reason?.trim();
    const [row] = tx
      .update(fixedAssets)
      .set({
        status: "baja",
        disposedAt: input.disposeDate,
        disposeType: input.disposeType,
        recoveryValueMicro,
        notes: note ? (asset.notes ? `${asset.notes}\n${note}` : note) : asset.notes,
        updatedAt: nowISO(),
      })
      .where(eq(fixedAssets.id, id))
      .returning()
      .all();

    logAudit(tx, {
      action: "asset.dispose",
      entityType: "fixed_asset",
      entityId: id,
      summary: `Activo ${asset.code} dado de baja (${input.disposeType}) — pérdida ${formatCUP(lossMicro)}`,
      details: {
        disposeDate: input.disposeDate,
        disposeType: input.disposeType,
        recoveryValueMicro,
        bookValueMicro,
        lossMicro,
        gainMicro,
        expenseId,
        reason: input.reason ?? null,
      },
    });

    return {
      asset: row,
      bookValueMicro,
      depreciatedMicro,
      recoveryValueMicro,
      lossMicro,
      gainMicro,
      expenseId,
    };
  });
}
