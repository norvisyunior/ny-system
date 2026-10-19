import { Router } from "express";
import { z } from "zod";
import { getDashboard, getDashboardTotals } from "../services/dashboard";
import { handle } from "./helpers";

export const dashboardRouter = Router();

const query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  totals: z.enum(["0", "1"]).optional(),
});

dashboardRouter.get("/", (req, res) => {
  const { date, totals } = query.parse(req.query);
  const db = handle(req).db;
  const data = totals === "1" ? getDashboardTotals(db) : getDashboard(db, date);
  res.json({ ok: true, data });
});
