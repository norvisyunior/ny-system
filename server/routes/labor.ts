import { Router } from "express";
import { z } from "zod";
import { currentWeekStartISO, laborSummary, validateLaborRange } from "../services/labor";
import { todayISO } from "../domain/dates";
import { handle } from "./helpers";

export const laborRouter = Router();

const rangeQuery = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha desde debe tener formato YYYY-MM-DD."),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha hasta debe tener formato YYYY-MM-DD."),
  })
  .partial();

laborRouter.get("/summary", (req, res) => {
  const parsed = rangeQuery.parse(req.query);
  const from = parsed.from ?? currentWeekStartISO();
  const to = parsed.to ?? todayISO();
  validateLaborRange(from, to);
  res.json({ ok: true, data: laborSummary(handle(req).db, from, to) });
});
