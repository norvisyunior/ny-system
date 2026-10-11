import { suppliers } from "../../db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import type { DB } from "../domain/types";

export const supplierInput = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres."),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
});
export type SupplierInput = z.infer<typeof supplierInput>;

export function listSuppliers(db: DB) {
  return db
    .select()
    .from(suppliers)
    .orderBy(asc(suppliers.name))
    .all();
}

export function createSupplier(db: DB, input: SupplierInput) {
  return db.transaction((tx) => {
    const dup = tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(sql`lower(${suppliers.name}) = lower(${input.name})`)
      .get();
    if (dup) throw domainError(`Ya existe un proveedor con el nombre "${input.name}".`);

    const [row] = tx
      .insert(suppliers)
      .values({
        name: input.name,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        active: input.active ?? true,
      })
      .returning()
      .all();

    logAudit(tx, {
      action: "create",
      entityType: "supplier",
      entityId: row.id,
      summary: `Proveedor creado: ${row.name}`,
    });
    return row;
  });
}

export function updateSupplier(db: DB, id: number, input: SupplierInput) {
  return db.transaction((tx) => {
    const existing = tx.select().from(suppliers).where(eq(suppliers.id, id)).get();
    if (!existing) throw notFoundError("Proveedor");

    const dup = tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(sql`lower(${suppliers.name}) = lower(${input.name}) AND ${suppliers.id} <> ${id}`)
      .get();
    if (dup) throw domainError(`Ya existe otro proveedor con el nombre "${input.name}".`);

    const [row] = tx
      .update(suppliers)
      .set({
        name: input.name,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        active: input.active ?? existing.active,
      })
      .where(eq(suppliers.id, id))
      .returning()
      .all();

    logAudit(tx, {
      action: "update",
      entityType: "supplier",
      entityId: id,
      summary: `Proveedor actualizado: ${row.name}`,
      details: { before: existing, after: row },
    });
    return row;
  });
}
