import {
  sales,
  saleItems,
  saleItemLots,
  finishedProducts,
  inventoryMovements,
  stockLots,
} from "../../db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { conflictError, domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { nextDocNumber } from "../domain/counters";
import { assertValidBusinessDate, nowISO } from "../domain/dates";
import { consumeFIFO } from "../domain/fifo";
import { decMicro, mulQtyPrice, divRoundAway } from "../domain/zod-helpers";
import { formatCUP, microToDecimal } from "../../shared/money";
import type { DBOrTx } from "../domain/types";

const PAYMENT_METHODS = ["efectivo", "tarjeta", "transferencia", "otro"] as const;

const saleItemInput = z.object({
  productId: z.number().int().positive("Producto requerido."),
  qty: decMicro({ minExclusive: true }),
  unitPrice: decMicro({ minExclusive: false }),
});

export const saleInput = z.object({
  saleDate: z.string().min(1, "Fecha requerida."),
  paymentMethod: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Método de pago inválido." }),
  }),
  discount: decMicro().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  items: z.array(saleItemInput).min(1, "Agregue al menos un producto."),
});
export type SaleInput = z.infer<typeof saleInput>;

/**
 * Registra una venta del día en curso: congela precio y costo, consume PT por
 * PEPS y deja el detalle por lote (sale_item_lots) para anulación exacta.
 */
export function confirmSale(db: DBOrTx, input: SaleInput) {
  return db.transaction((tx) => {
    assertValidBusinessDate(tx, input.saleDate, {
      requireToday: true,
      label: "La fecha de venta",
    });

    const seen = new Set<number>();
    for (const item of input.items) {
      const prod = tx.select().from(finishedProducts).where(eq(finishedProducts.id, item.productId)).get();
      if (!prod) throw notFoundError("Producto");
      if (!prod.active) throw domainError(`El producto "${prod.name}" está inactivo.`);
      if (seen.has(item.productId)) {
        throw domainError(`El producto "${prod.name}" está repetido en la venta.`);
      }
      seen.add(item.productId);
    }

    const discountMicro = input.discount ?? 0;
    const number = nextDocNumber(tx, "sale");
    const [sale] = tx
      .insert(sales)
      .values({
        number,
        saleDate: input.saleDate,
        paymentMethod: input.paymentMethod,
        subtotalMicro: 0,
        discountMicro,
        totalMicro: 0,
        totalCostMicro: 0,
        notes: input.notes ?? null,
      })
      .returning()
      .all();

    let subtotalMicro = 0;
    let totalCostMicro = 0;
    for (const item of input.items) {
      const prod = tx.select().from(finishedProducts).where(eq(finishedProducts.id, item.productId)).get();
      if (!prod) throw notFoundError("Producto");

      const lineTotalMicro = mulQtyPrice(item.qty, item.unitPrice);
      const consumed = consumeFIFO(
        tx,
        "product",
        item.productId,
        item.qty,
        prod.name,
        (m) => `${microToDecimal(m, 3)} ${prod.saleUnitId}`,
      );
      let lineCostMicro = 0;
      for (const c of consumed) lineCostMicro += c.lineCostMicro;

      const unitCostMicro = Number(
        divRoundAway(BigInt(lineCostMicro) * 1_000_000n, BigInt(item.qty)),
      );

      const [line] = tx
        .insert(saleItems)
        .values({
          saleId: sale.id,
          productId: item.productId,
          qtyMicro: item.qty,
          unitPriceMicro: item.unitPrice,
          unitCostMicro,
          lineTotalMicro,
          lineCostMicro,
        })
        .returning()
        .all();

      for (const c of consumed) {
        tx.insert(saleItemLots)
          .values({
            saleItemId: line.id,
            lotId: c.lotId,
            qtyMicro: c.qtyMicro,
            unitCostMicro: c.unitCostMicro,
          })
          .run();
        tx.insert(inventoryMovements)
          .values({
            businessDate: input.saleDate,
            itemType: "product",
            itemId: item.productId,
            movementType: "sale_out",
            qtyDeltaMicro: -c.qtyMicro,
            unitCostMicro: c.unitCostMicro,
            valueMicro: -c.lineCostMicro,
            lotId: c.lotId,
            refType: "sale",
            refId: sale.id,
            notes: `Venta #${String(number).padStart(5, "0")}`,
          })
          .run();
      }

      tx.update(finishedProducts)
        .set({ stockMicro: sql`${finishedProducts.stockMicro} - ${item.qty}`, updatedAt: nowISO() })
        .where(eq(finishedProducts.id, item.productId))
        .run();

      subtotalMicro += lineTotalMicro;
      totalCostMicro += lineCostMicro;
    }

    if (discountMicro > subtotalMicro) {
      throw domainError("El descuento no puede superar el subtotal de la venta.");
    }
    const totalMicro = subtotalMicro - discountMicro;

    tx.update(sales)
      .set({ subtotalMicro, totalMicro, totalCostMicro })
      .where(eq(sales.id, sale.id))
      .run();

    logAudit(tx, {
      action: "sale.confirm",
      entityType: "sale",
      entityId: sale.id,
      summary:
        `Venta #${String(number).padStart(5, "0")}: ${formatCUP(totalMicro)} ` +
        `(${input.paymentMethod}), costo ${formatCUP(totalCostMicro)}`,
      details: { totalMicro, totalCostMicro, discountMicro },
    });

    return { id: sale.id, number, subtotalMicro, discountMicro, totalMicro, totalCostMicro };
  });
}

export interface SaleListRow {
  id: number;
  number: number;
  saleDate: string;
  paymentMethod: string;
  subtotalMicro: number;
  discountMicro: number;
  totalMicro: number;
  totalCostMicro: number;
  status: string;
  itemsCount: number;
}

export function listSales(db: DBOrTx, opts: { from?: string; to?: string } = {}): SaleListRow[] {
  const conds = [];
  if (opts.from) conds.push(sql`${sales.saleDate} >= ${opts.from}`);
  if (opts.to) conds.push(sql`${sales.saleDate} <= ${opts.to}`);
  return db
    .select({
      id: sales.id,
      number: sales.number,
      saleDate: sales.saleDate,
      paymentMethod: sales.paymentMethod,
      subtotalMicro: sales.subtotalMicro,
      discountMicro: sales.discountMicro,
      totalMicro: sales.totalMicro,
      totalCostMicro: sales.totalCostMicro,
      status: sales.status,
      itemsCount: sql<number>`(SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = ${sales.id})`,
    })
    .from(sales)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sales.saleDate), desc(sales.number))
    .all();
}

export function getSaleDetail(db: DBOrTx, id: number) {
  const sale = db.select().from(sales).where(eq(sales.id, id)).get();
  if (!sale) throw notFoundError("Venta");
  const items = db
    .select({
      id: saleItems.id,
      productId: saleItems.productId,
      productName: finishedProducts.name,
      saleUnitId: finishedProducts.saleUnitId,
      qtyMicro: saleItems.qtyMicro,
      unitPriceMicro: saleItems.unitPriceMicro,
      unitCostMicro: saleItems.unitCostMicro,
      lineTotalMicro: saleItems.lineTotalMicro,
      lineCostMicro: saleItems.lineCostMicro,
    })
    .from(saleItems)
    .innerJoin(finishedProducts, eq(finishedProducts.id, saleItems.productId))
    .where(eq(saleItems.saleId, id))
    .orderBy(asc(saleItems.id))
    .all();
  return { ...sale, items };
}

/** Anula una venta: devuelve los lotes exactamente como se consumieron. */
export function annulSale(db: DBOrTx, id: number, reason: string) {
  return db.transaction((tx) => {
    const sale = tx.select().from(sales).where(eq(sales.id, id)).get();
    if (!sale) throw notFoundError("Venta");
    if (sale.status === "anulada") throw conflictError("La venta ya fue anulada.");
    assertValidBusinessDate(tx, sale.saleDate, { label: "La fecha de venta" });

    const lines = tx.select().from(saleItems).where(eq(saleItems.saleId, id)).all();
    const now = nowISO();
    for (const line of lines) {
      const lots = tx.select().from(saleItemLots).where(eq(saleItemLots.saleItemId, line.id)).all();
      for (const sl of lots) {
        const lot = tx.select().from(stockLots).where(eq(stockLots.id, sl.lotId)).get();
        if (lot?.cancelledAt) {
          throw conflictError(
            "No se puede anular: uno de los lotes vendidos fue cancelado por otra operación.",
          );
        }
        tx.update(stockLots)
          .set({ qtyRemainingMicro: sql`${stockLots.qtyRemainingMicro} + ${sl.qtyMicro}` })
          .where(eq(stockLots.id, sl.lotId))
          .run();
        tx.insert(inventoryMovements)
          .values({
            businessDate: sale.saleDate,
            itemType: "product",
            itemId: line.productId,
            movementType: "cancel_sale_out",
            qtyDeltaMicro: sl.qtyMicro,
            unitCostMicro: sl.unitCostMicro,
            valueMicro: mulQtyPrice(sl.qtyMicro, sl.unitCostMicro),
            lotId: sl.lotId,
            refType: "sale",
            refId: id,
            reason,
            notes: `Anulación Venta #${String(sale.number).padStart(5, "0")}`,
          })
          .run();
      }
      tx.update(finishedProducts)
        .set({ stockMicro: sql`${finishedProducts.stockMicro} + ${line.qtyMicro}`, updatedAt: now })
        .where(eq(finishedProducts.id, line.productId))
        .run();
    }

    tx.update(sales)
      .set({ status: "anulada", cancelledAt: now, cancelReason: reason })
      .where(eq(sales.id, id))
      .run();

    logAudit(tx, {
      action: "sale.annul",
      entityType: "sale",
      entityId: id,
      summary: `Venta #${String(sale.number).padStart(5, "0")} anulada`,
      details: { reason },
    });
    return { id, status: "anulada" as const };
  });
}
