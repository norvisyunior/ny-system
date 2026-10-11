import {
  purchases,
  purchaseItems,
  rawMaterials,
  suppliers,
  units,
  inventoryMovements,
  stockLots,
} from "../../db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { conflictError, domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { nextDocNumber } from "../domain/counters";
import { assertValidBusinessDate, nowISO } from "../domain/dates";
import { createLot } from "../domain/fifo";
import { decMicro, mulQtyPrice, divRoundAway } from "../domain/zod-helpers";
import { formatCUP } from "../../shared/money";
import type { DB } from "../domain/types";
import type { UnitsCatalog } from "../domain/units";

export const purchaseLineInput = z.object({
  rawMaterialId: z.number().int().positive("Materia prima requerida."),
  unitId: z.string().min(1, "Unidad requerida."),
  qty: decMicro({ minExclusive: true }),
  unitPrice: decMicro(),
});
export type PurchaseLineInput = z.infer<typeof purchaseLineInput>;

export const purchaseInput = z.object({
  supplierId: z.number().int().positive("Proveedor requerido."),
  purchaseDate: z.string().min(1, "Fecha requerida."),
  docNumber: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  items: z.array(purchaseLineInput).min(1, "Agregue al menos un material."),
});
export type PurchaseInput = z.infer<typeof purchaseInput>;

/** Confirmación inmediata: crea la compra y la registra en una sola transacción. */
export function createPurchase(db: DB, catalog: UnitsCatalog, input: PurchaseInput) {
  return db.transaction((tx) => {
    assertValidBusinessDate(tx, input.purchaseDate, { label: "La fecha de compra" });

    const supplier = tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).get();
    if (!supplier) throw notFoundError("Proveedor");
    if (!supplier.active) throw domainError(`El proveedor "${supplier.name}" está inactivo.`);

    interface Line {
      materialId: number;
      materialName: string;
      unitId: string;
      baseUnitId: string;
      qtyMicro: number;
      qtyBaseMicro: number;
      unitPriceMicro: number;
      lineTotalMicro: number;
      unitCostPerBaseMicro: number;
    }
    const lines: Line[] = [];
    let totalMicro = 0;

    for (const it of input.items) {
      const mat = tx
        .select()
        .from(rawMaterials)
        .where(eq(rawMaterials.id, it.rawMaterialId))
        .get();
      if (!mat) throw notFoundError("Materia prima");
      if (!mat.active) {
        throw domainError(`La materia prima "${mat.name}" está inactiva y no puede comprarse.`);
      }
      catalog.assertCompatible(it.unitId, mat.unitId);
      const qtyBaseMicro = catalog.toBase(it.qty, it.unitId, mat.unitId);
      if (qtyBaseMicro <= 0) {
        throw domainError(
          `La cantidad de "${mat.name}" es demasiado pequeña para su unidad base (${mat.unitId}).`,
        );
      }
      const lineTotalMicro = mulQtyPrice(it.qty, it.unitPrice);
      // costo real por 1 unidad COMPLETA de la unidad base del material
      const fU = catalog.get(it.unitId).factor;
      const fB = catalog.get(mat.unitId).factor;
      const unitCostPerBaseMicro = Number(
        divRoundAway(BigInt(it.unitPrice) * BigInt(fB), BigInt(fU)),
      );

      lines.push({
        materialId: mat.id,
        materialName: mat.name,
        unitId: it.unitId,
        baseUnitId: mat.unitId,
        qtyMicro: it.qty,
        qtyBaseMicro,
        unitPriceMicro: it.unitPrice,
        lineTotalMicro,
        unitCostPerBaseMicro,
      });
      totalMicro += lineTotalMicro;
    }

    const number = nextDocNumber(tx, "purchase");
    const [purchase] = tx
      .insert(purchases)
      .values({
        number,
        supplierId: input.supplierId,
        purchaseDate: input.purchaseDate,
        docNumber: input.docNumber ?? null,
        notes: input.notes ?? null,
        totalMicro,
        status: "confirmada",
      })
      .returning()
      .all();

    for (const line of lines) {
      const [item] = tx
        .insert(purchaseItems)
        .values({
          purchaseId: purchase.id,
          rawMaterialId: line.materialId,
          unitId: line.unitId,
          qtyMicro: line.qtyMicro,
          qtyBaseMicro: line.qtyBaseMicro,
          unitPriceMicro: line.unitPriceMicro,
          lineTotalMicro: line.lineTotalMicro,
        })
        .returning()
        .all();

      const lotId = createLot(tx, {
        itemType: "raw",
        itemId: line.materialId,
        refType: "purchase",
        refId: purchase.id,
        qtyMicro: line.qtyBaseMicro,
        unitCostMicro: line.unitCostPerBaseMicro,
        businessDate: input.purchaseDate,
      });

      tx.insert(inventoryMovements)
        .values({
          businessDate: input.purchaseDate,
          itemType: "raw",
          itemId: line.materialId,
          movementType: "purchase",
          qtyDeltaMicro: line.qtyBaseMicro,
          unitCostMicro: line.unitCostPerBaseMicro,
          valueMicro: mulQtyPrice(line.qtyBaseMicro, line.unitCostPerBaseMicro),
          lotId,
          refType: "purchase",
          refId: purchase.id,
          notes: `Compra #${String(number).padStart(5, "0")}`,
        })
        .run();

      tx.update(rawMaterials)
        .set({ stockMicro: sql`${rawMaterials.stockMicro} + ${line.qtyBaseMicro}`, updatedAt: nowISO() })
        .where(eq(rawMaterials.id, line.materialId))
        .run();

      void item;
    }

    logAudit(tx, {
      action: "purchase.confirm",
      entityType: "purchase",
      entityId: purchase.id,
      summary: `Compra #${String(number).padStart(5, "0")} confirmada a ${supplier.name} — total ${formatCUP(totalMicro)}`,
      details: { purchaseDate: input.purchaseDate, totalMicro, items: lines.length },
    });

    return { ...purchase, itemsCount: lines.length };
  });
}

export interface PurchaseListRow {
  id: number;
  number: number;
  purchaseDate: string;
  docNumber: string | null;
  supplierName: string;
  totalMicro: number;
  status: string;
  itemsCount: number;
}

export function listPurchases(
  db: DB,
  opts: { from?: string; to?: string; supplierId?: number; q?: string } = {},
): PurchaseListRow[] {
  const conds = [];
  if (opts.from) conds.push(sql`${purchases.purchaseDate} >= ${opts.from}`);
  if (opts.to) conds.push(sql`${purchases.purchaseDate} <= ${opts.to}`);
  if (opts.supplierId) conds.push(eq(purchases.supplierId, opts.supplierId));
  if (opts.q) {
    conds.push(
      sql`(${purchases.docNumber} LIKE ${"%" + opts.q + "%"} OR CAST(${purchases.number} AS TEXT) LIKE ${"%" + opts.q + "%"})`,
    );
  }
  return db
    .select({
      id: purchases.id,
      number: purchases.number,
      purchaseDate: purchases.purchaseDate,
      docNumber: purchases.docNumber,
      supplierName: suppliers.name,
      totalMicro: purchases.totalMicro,
      status: purchases.status,
      itemsCount: sql<number>`(SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = ${purchases.id})`,
    })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(purchases.purchaseDate), desc(purchases.number))
    .all();
}

export function getPurchaseDetail(db: DB, id: number) {
  const purchase = db
    .select({
      id: purchases.id,
      number: purchases.number,
      purchaseDate: purchases.purchaseDate,
      docNumber: purchases.docNumber,
      notes: purchases.notes,
      totalMicro: purchases.totalMicro,
      status: purchases.status,
      cancelledAt: purchases.cancelledAt,
      cancelReason: purchases.cancelReason,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(eq(purchases.id, id))
    .get();
  if (!purchase) throw notFoundError("Compra");

  const items = db
    .select({
      id: purchaseItems.id,
      rawMaterialId: purchaseItems.rawMaterialId,
      materialName: rawMaterials.name,
      materialUnit: rawMaterials.unitId,
      unitId: purchaseItems.unitId,
      unitLabel: units.label,
      qtyMicro: purchaseItems.qtyMicro,
      qtyBaseMicro: purchaseItems.qtyBaseMicro,
      unitPriceMicro: purchaseItems.unitPriceMicro,
      lineTotalMicro: purchaseItems.lineTotalMicro,
    })
    .from(purchaseItems)
    .innerJoin(rawMaterials, eq(rawMaterials.id, purchaseItems.rawMaterialId))
    .innerJoin(units, eq(units.code, purchaseItems.unitId))
    .where(eq(purchaseItems.purchaseId, id))
    .orderBy(asc(purchaseItems.id))
    .all();

  return { ...purchase, items };
}

/** Anulación con trazabilidad: nunca borra; revierte inventario si los lotes no fueron consumidos. */
export function annulPurchase(db: DB, id: number, reason: string) {
  return db.transaction((tx) => {
    const purchase = tx.select().from(purchases).where(eq(purchases.id, id)).get();
    if (!purchase) throw notFoundError("Compra");
    if (purchase.status === "anulada") {
      throw conflictError("La compra ya fue anulada.", "ALREADY_CANCELLED");
    }
    assertValidBusinessDate(tx, purchase.purchaseDate, { label: "La fecha de compra" });

    const items = tx
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, id))
      .all();
    if (items.length === 0) throw domainError("La compra no tiene materiales registrados.");

    const lots = tx
      .select()
      .from(stockLots)
      .where(and(eq(stockLots.itemType, "raw"), eq(stockLots.refType, "purchase"), eq(stockLots.refId, id)))
      .all();

    for (const lot of lots) {
      if (lot.qtyRemainingMicro < lot.qtyInitialMicro) {
        const mat = tx.select().from(rawMaterials).where(eq(rawMaterials.id, lot.itemId)).get();
        throw domainError(
          `No se puede anular: el material "${mat?.name ?? lot.itemId}" de esta compra ya fue consumido parcialmente en producciones. ` +
            `Contacte al administrador para un ajuste con trazabilidad.`,
        );
      }
    }

    const now = nowISO();
    const totalsByMaterial = new Map<number, number>();
    for (const lot of lots) {
      totalsByMaterial.set(
        lot.itemId,
        (totalsByMaterial.get(lot.itemId) ?? 0) + lot.qtyRemainingMicro,
      );
      tx.update(stockLots)
        .set({ cancelledAt: now })
        .where(eq(stockLots.id, lot.id))
        .run();

      tx.insert(inventoryMovements)
        .values({
          businessDate: purchase.purchaseDate,
          itemType: "raw",
          itemId: lot.itemId,
          movementType: "cancel_purchase",
          qtyDeltaMicro: -lot.qtyRemainingMicro,
          unitCostMicro: lot.unitCostMicro,
          valueMicro: -mulQtyPrice(lot.qtyRemainingMicro, lot.unitCostMicro),
          lotId: lot.id,
          refType: "purchase",
          refId: id,
          reason,
          notes: `Anulación de Compra #${String(purchase.number).padStart(5, "0")}`,
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

    tx.update(purchases)
      .set({ status: "anulada", cancelledAt: now, cancelReason: reason })
      .where(eq(purchases.id, id))
      .run();

    logAudit(tx, {
      action: "purchase.annul",
      entityType: "purchase",
      entityId: id,
      summary: `Compra #${String(purchase.number).padStart(5, "0")} anulada`,
      details: { reason, totalMicro: purchase.totalMicro, materials: totalsByMaterial.size },
    });

    return { id, status: "anulada" as const };
  });
}
