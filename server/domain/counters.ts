import { docCounters } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { DBOrTx } from "./types";

/**
 * Obtiene el siguiente número de documento para `type` (ej. 'purchase').
 * Debe llamarse SIEMPRE dentro de la transacción que confirma el documento,
 * para que la numeración sea atómica (sin duplicados ni huecos por fallos).
 */
export function nextDocNumber(db: DBOrTx, type: string): number {
  const existing = db
    .select({ nextNumber: docCounters.nextNumber })
    .from(docCounters)
    .where(eq(docCounters.type, type))
    .get();

  if (!existing) {
    db.insert(docCounters).values({ type, nextNumber: 2 }).run();
    return 1;
  }
  const current = existing.nextNumber;
  db.update(docCounters)
    .set({ nextNumber: current + 1 })
    .where(eq(docCounters.type, type))
    .run();
  return current;
}
