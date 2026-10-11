import { expenses } from "../../db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { conflictError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { assertValidBusinessDate, nowISO } from "../domain/dates";
import { decMicro } from "../domain/zod-helpers";
import { formatCUP } from "../../shared/money";
import type { DBOrTx } from "../domain/types";

const PAYMENT_METHODS = ["efectivo", "tarjeta", "transferencia", "otro"] as const;

export const expenseInput = z.object({
  expenseDate: z.string().min(1, "Fecha requerida."),
  category: z.string().trim().min(2, "La categoría es obligatoria.").max(60),
  description: z.string().trim().min(2, "La descripción es obligatoria.").max(200),
  amount: decMicro({ minExclusive: true }),
  paymentMethod: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Método de pago inválido." }),
  }),
  responsible: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});
export type ExpenseInput = z.infer<typeof expenseInput>;

export function createExpense(db: DBOrTx, input: ExpenseInput) {
  return db.transaction((tx) => {
    assertValidBusinessDate(tx, input.expenseDate, { label: "La fecha del gasto" });
    const [row] = tx
      .insert(expenses)
      .values({
        expenseDate: input.expenseDate,
        category: input.category,
        description: input.description,
        amountMicro: input.amount,
        paymentMethod: input.paymentMethod,
        responsible: input.responsible ?? null,
        notes: input.notes ?? null,
      })
      .returning()
      .all();
    logAudit(tx, {
      action: "expense.create",
      entityType: "expense",
      entityId: row.id,
      summary: `Gasto: ${input.category} — ${formatCUP(input.amount)} (${input.description})`,
    });
    return row;
  });
}

export interface ExpenseListRow {
  id: number;
  expenseDate: string;
  category: string;
  description: string;
  amountMicro: number;
  paymentMethod: string;
  responsible: string | null;
  status: string;
}

export function listExpenses(
  db: DBOrTx,
  opts: { from?: string; to?: string; category?: string } = {},
): ExpenseListRow[] {
  const conds = [];
  if (opts.from) conds.push(sql`${expenses.expenseDate} >= ${opts.from}`);
  if (opts.to) conds.push(sql`${expenses.expenseDate} <= ${opts.to}`);
  if (opts.category) conds.push(eq(expenses.category, opts.category));
  return db
    .select({
      id: expenses.id,
      expenseDate: expenses.expenseDate,
      category: expenses.category,
      description: expenses.description,
      amountMicro: expenses.amountMicro,
      paymentMethod: expenses.paymentMethod,
      responsible: expenses.responsible,
      status: expenses.status,
    })
    .from(expenses)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .all();
}

export function annulExpense(db: DBOrTx, id: number, reason: string) {
  return db.transaction((tx) => {
    const row = tx.select().from(expenses).where(eq(expenses.id, id)).get();
    if (!row) throw notFoundError("Gasto");
    if (row.status === "anulada") throw conflictError("El gasto ya fue anulado.");
    assertValidBusinessDate(tx, row.expenseDate, { label: "La fecha del gasto" });
    tx.update(expenses)
      .set({ status: "anulada", cancelledAt: nowISO(), cancelReason: reason })
      .where(eq(expenses.id, id))
      .run();
    logAudit(tx, {
      action: "expense.annul",
      entityType: "expense",
      entityId: id,
      summary: `Gasto anulado: ${row.category} — ${formatCUP(row.amountMicro)}`,
      details: { reason },
    });
    return { id, status: "anulada" as const };
  });
}
