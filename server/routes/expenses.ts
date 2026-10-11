import { Router } from "express";
import { z } from "zod";
import {
  annulExpense,
  createExpense,
  expenseInput,
  listExpenses,
} from "../services/expenses";
import { handle, idParam } from "./helpers";

export const expensesRouter = Router();

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.string().max(60).optional(),
});

expensesRouter.get("/", (req, res) => {
  const opts = listQuery.parse(req.query);
  res.json({ ok: true, data: listExpenses(handle(req).db, opts) });
});

expensesRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = expenseInput.parse(req.body);
  res.json({ ok: true, data: createExpense(h.db, input) });
});

const annulBody = z.object({
  reason: z.string().trim().min(3, "Indique el motivo de anulación.").max(300),
});

expensesRouter.post("/:id/annul", (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = annulBody.parse(req.body);
  res.json({ ok: true, data: annulExpense(handle(req).db, id, reason) });
});
