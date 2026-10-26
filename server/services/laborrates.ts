/**
 * Tarifas de mano de obra (integración mínima para las fichas de costo).
 * Solo guardan el dato que la ficha necesita: tarifa por masa elaborada y
 * tarifa por unidad individual terminada. NO generan obligaciones salariales
 * ni afectan operaciones reales.
 */
import { laborRates, masses, finishedProducts } from "../../db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { decMicro } from "../domain/zod-helpers";
import { formatCUP } from "../../shared/money";
import type { DBOrTx } from "../domain/types";

export const laborRateInput = z.object({
  kind: z.enum(["masa", "terminacion"]),
  massId: z.number().int().positive("Identificador de masa inválido.").optional(),
  productId: z.number().int().positive("Identificador de producto inválido.").optional(),
  // ≥ 0: un 0 explícito es válido (mano de obra sin costo en el escenario).
  rate: decMicro(),
});
export type LaborRateInput = z.infer<typeof laborRateInput>;

export interface LaborRateRow {
  id: number;
  kind: "masa" | "terminacion";
  massId: number | null;
  productId: number | null;
  itemLabel: string | null;
  rateMicro: number;
  unitLabel: string; // "por masa" | "por unidad individual"
  updatedAt: string | null;
}

export function listLaborRates(db: DBOrTx): LaborRateRow[] {
  const rows = db
    .select({
      id: laborRates.id,
      kind: laborRates.kind,
      massId: laborRates.massId,
      productId: laborRates.productId,
      massName: masses.name,
      productName: finishedProducts.name,
      rateMicro: laborRates.rateMicro,
      updatedAt: laborRates.updatedAt,
    })
    .from(laborRates)
    .leftJoin(masses, eq(masses.id, laborRates.massId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, laborRates.productId))
    .all();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind === "terminacion" ? "terminacion" : "masa",
    massId: r.massId,
    productId: r.productId,
    itemLabel: r.kind === "masa" ? (r.massName ?? null) : (r.productName ?? null),
    rateMicro: r.rateMicro,
    unitLabel: r.kind === "masa" ? "por masa" : "por unidad individual",
    updatedAt: r.updatedAt,
  }));
}

export function setLaborRate(db: DBOrTx, input: LaborRateInput): LaborRateRow {
  return db.transaction((tx) => {
    const isMass = input.kind === "masa";
    if (isMass && input.massId == null) {
      throw domainError("Indique la masa a la que corresponde la tarifa.");
    }
    if (!isMass && input.productId == null) {
      throw domainError("Indique el producto al que corresponde la tarifa.");
    }
    const massId = isMass ? (input.massId as number) : null;
    const productId = !isMass ? (input.productId as number) : null;

    if (isMass) {
      const mass = tx.select().from(masses).where(eq(masses.id, massId as number)).get();
      if (!mass) throw notFoundError("Masa");
    } else {
      const product = tx
        .select()
        .from(finishedProducts)
        .where(eq(finishedProducts.id, productId as number))
        .get();
      if (!product) throw notFoundError("Producto");
    }

    const existing = isMass
      ? tx.select().from(laborRates).where(eq(laborRates.massId, massId as number)).get()
      : tx.select().from(laborRates).where(eq(laborRates.productId, productId as number)).get();

    let id: number;
    if (existing) {
      tx.update(laborRates)
        .set({ rateMicro: input.rate, updatedAt: new Date().toISOString() })
        .where(eq(laborRates.id, existing.id))
        .run();
      id = existing.id;
    } else {
      const [row] = tx
        .insert(laborRates)
        .values({
          kind: input.kind,
          massId: isMass ? massId : null,
          productId: !isMass ? productId : null,
          rateMicro: input.rate,
        })
        .returning()
        .all();
      id = row.id;
    }

    logAudit(tx, {
      action: existing ? "labor_rate.update" : "labor_rate.set",
      entityType: "labor_rate",
      entityId: id,
      summary:
        input.kind === "masa"
          ? `Tarifa de elaboración: ${formatCUP(input.rate)} por masa (ID ${massId})${existing ? " — actualizada" : ""}`
          : `Tarifa de terminación: ${formatCUP(input.rate)} por unidad individual (ID ${productId})${existing ? " — actualizada" : ""}`,
      details: { kind: input.kind, massId, productId, rateMicro: input.rate },
    });
    return listLaborRates(tx).find((r) =>
      isMass ? r.massId === massId : r.productId === productId,
    ) as LaborRateRow;
  });
}
