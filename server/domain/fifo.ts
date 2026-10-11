import { stockLots } from "../../db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { insufficientStockError, domainError } from "./errors";
import { mulQtyPrice } from "../../shared/money";
import type { DBOrTx } from "./types";

export interface LotConsume {
  lotId: number;
  qtyMicro: number;
  unitCostMicro: number;
  lineCostMicro: number;
}

export interface CreateLotInput {
  itemType: "raw" | "mass" | "product";
  itemId: number;
  refType: "purchase" | "production" | "transformation";
  refId: number;
  qtyMicro: number;
  unitCostMicro: number;
  businessDate: string;
}

/**
 * Crea un lote de entrada (PEPS: el orden FIFO es businessDate, luego id de creación).
 * Debe ejecutarse dentro de la transacción de la operación.
 */
export function createLot(tx: DBOrTx, input: CreateLotInput): number {
  if (input.qtyMicro <= 0) {
    throw domainError("La cantidad del lote debe ser mayor que cero.");
  }
  const [lot] = tx
    .insert(stockLots)
    .values({
      itemType: input.itemType,
      itemId: input.itemId,
      refType: input.refType,
      refId: input.refId,
      qtyInitialMicro: input.qtyMicro,
      qtyRemainingMicro: input.qtyMicro,
      unitCostMicro: input.unitCostMicro,
      businessDate: input.businessDate,
    })
    .returning()
    .all();
  return lot.id;
}

export function availableStock(tx: DBOrTx, itemType: string, itemId: number): number {
  const row = tx
    .select({
      total: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro}), 0)`,
    })
    .from(stockLots)
    .where(
      and(
        eq(stockLots.itemType, itemType),
        eq(stockLots.itemId, itemId),
        isNull(stockLots.cancelledAt),
      ),
    )
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Costo promedio ponderado actual de las existencias activas de un ítem
 * (micro-CUP por unidad base). 0 cuando no hay existencias valorizadas.
 * Solo se usa para estimaciones de planificación; las operaciones reales
 * siguen valorando por PEPS con precio real.
 */
export function estimatedAvgCost(tx: DBOrTx, itemType: string, itemId: number): number {
  const lots = tx
    .select()
    .from(stockLots)
    .where(
      and(
        eq(stockLots.itemType, itemType),
        eq(stockLots.itemId, itemId),
        isNull(stockLots.cancelledAt),
        sql`${stockLots.qtyRemainingMicro} > 0`,
      ),
    )
    .all();
  let totalQty = 0n;
  let totalValue = 0n;
  for (const lot of lots) {
    totalQty += BigInt(lot.qtyRemainingMicro);
    totalValue += BigInt(lot.qtyRemainingMicro) * BigInt(lot.unitCostMicro);
  }
  if (totalQty <= 0n) return 0;
  const half = totalQty / 2n;
  return Number((totalValue + half) / totalQty);
}

/**
 * Consume qtyMicro (unidad base) siguiendo PEPS: lotes activos ordenados por
 * businessDate y luego por id (orden de creación). Actualiza los lotes.
 * NO escribe movimientos: el llamador decide el detalle del ledger.
 * Lanza error claro si el stock es insuficiente (sin dejar estado parcial:
 * debe usarse dentro de una transacción con rollback).
 */
export function consumeFIFO(
  tx: DBOrTx,
  itemType: "raw" | "mass" | "product",
  itemId: number,
  qtyMicro: number,
  itemName: string,
  formatQty: (micro: number) => string,
): LotConsume[] {
  if (qtyMicro <= 0) {
    throw domainError("La cantidad a consumir debe ser mayor que cero.");
  }
  const lots = tx
    .select()
    .from(stockLots)
    .where(
      and(
        eq(stockLots.itemType, itemType),
        eq(stockLots.itemId, itemId),
        isNull(stockLots.cancelledAt),
        sql`${stockLots.qtyRemainingMicro} > 0`,
      ),
    )
    .orderBy(asc(stockLots.businessDate), asc(stockLots.id))
    .all();

  const available = lots.reduce((acc, l) => acc + l.qtyRemainingMicro, 0);
  if (available < qtyMicro) {
    throw insufficientStockError(itemName, formatQty(available), formatQty(qtyMicro));
  }

  const result: LotConsume[] = [];
  let pending = qtyMicro;
  for (const lot of lots) {
    if (pending <= 0) break;
    const take = Math.min(pending, lot.qtyRemainingMicro);
    tx.update(stockLots)
      .set({ qtyRemainingMicro: lot.qtyRemainingMicro - take })
      .where(eq(stockLots.id, lot.id))
      .run();
    result.push({
      lotId: lot.id,
      qtyMicro: take,
      unitCostMicro: lot.unitCostMicro,
      lineCostMicro: mulQtyPrice(take, lot.unitCostMicro),
    });
    pending -= take;
  }
  return result;
}
