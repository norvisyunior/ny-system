import { masses, stockLots, inventoryMovements } from "../../db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { decMicro } from "../domain/zod-helpers";
import { mulQtyPrice } from "../../shared/money";
import type { DB } from "../domain/types";

export const massInput = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(120),
  unitId: z.string().trim().min(1, "La unidad es obligatoria."),
  minStock: decMicro().optional(),
  active: z.boolean().optional(),
});
export type MassInput = z.infer<typeof massInput>;

export interface MassListItem {
  id: number;
  name: string;
  unitId: string;
  stockMicro: number;
  minStockMicro: number;
  active: boolean;
  stockValueMicro: number;
}

export function listMasses(db: DB): MassListItem[] {
  const rows = db.select().from(masses).orderBy(asc(masses.name)).all();
  const values = db
    .select({
      itemId: stockLots.itemId,
      total: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro} * ${stockLots.unitCostMicro}), 0)`,
    })
    .from(stockLots)
    .where(and(eq(stockLots.itemType, "mass"), isNull(stockLots.cancelledAt)))
    .groupBy(stockLots.itemId)
    .all();
  const valueBy = new Map(values.map((v) => [v.itemId, Math.trunc(Number(v.total) / 1_000_000)]));
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    unitId: m.unitId,
    stockMicro: m.stockMicro,
    minStockMicro: m.minStockMicro,
    active: m.active,
    stockValueMicro: valueBy.get(m.id) ?? 0,
  }));
}

export function createMass(db: DB, input: MassInput) {
  return db.transaction((tx) => {
    const dup = tx
      .select({ id: masses.id })
      .from(masses)
      .where(sql`upper(${masses.name}) = upper(${input.name})`)
      .get();
    if (dup) throw domainError(`Ya existe una masa con el nombre "${input.name}".`);
    const [row] = tx
      .insert(masses)
      .values({
        name: input.name,
        unitId: input.unitId,
        minStockMicro: input.minStock ?? 0,
        active: input.active ?? true,
      })
      .returning()
      .all();
    logAudit(tx, {
      action: "create",
      entityType: "mass",
      entityId: row.id,
      summary: `Masa creada: ${row.name}`,
    });
    return row;
  });
}

export function updateMass(db: DB, id: number, input: MassInput) {
  return db.transaction((tx) => {
    const existing = tx.select().from(masses).where(eq(masses.id, id)).get();
    if (!existing) throw notFoundError("Masa");
    if (existing.stockMicro !== 0 && input.unitId !== existing.unitId) {
      throw domainError(
        `No se puede cambiar la unidad de "${existing.name}" porque tiene inventario.`,
      );
    }
    const dup = tx
      .select({ id: masses.id })
      .from(masses)
      .where(sql`upper(${masses.name}) = upper(${input.name}) AND ${masses.id} <> ${id}`)
      .get();
    if (dup) throw domainError(`Ya existe otra masa con el nombre "${input.name}".`);
    const [row] = tx
      .update(masses)
      .set({
        name: input.name,
        unitId: input.unitId,
        minStockMicro: input.minStock ?? existing.minStockMicro,
        active: input.active ?? existing.active,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(masses.id, id))
      .returning()
      .all();
    logAudit(tx, {
      action: "update",
      entityType: "mass",
      entityId: id,
      summary: `Masa actualizada: ${row.name}`,
    });
    return row;
  });
}

export function getMassDetail(db: DB, id: number) {
  const mass = db.select().from(masses).where(eq(masses.id, id)).get();
  if (!mass) throw notFoundError("Masa");
  const lots = db
    .select()
    .from(stockLots)
    .where(
      and(
        eq(stockLots.itemType, "mass"),
        eq(stockLots.itemId, id),
        isNull(stockLots.cancelledAt),
        sql`${stockLots.qtyRemainingMicro} > 0`,
      ),
    )
    .orderBy(asc(stockLots.businessDate), asc(stockLots.id))
    .all();
  const stockValueMicro = lots.reduce(
    (acc, l) => acc + mulQtyPrice(l.qtyRemainingMicro, l.unitCostMicro),
    0,
  );
  const movements = db
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.itemType, "mass"), eq(inventoryMovements.itemId, id)))
    .orderBy(desc(inventoryMovements.id))
    .limit(100)
    .all();
  return { mass, lots, movements, stockValueMicro };
}
