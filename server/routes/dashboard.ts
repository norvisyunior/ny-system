import { Router } from "express";
import { z } from "zod";
import { getDashboard } from "../services/dashboard";
import { handle } from "./helpers";

export const dashboardRouter = Router();

const query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

dashboardRouter.get("/", (req, res) => {
  const { date } = query.parse(req.query);
  res.json({ ok: true, data: getDashboard(handle(req).db, date) });
});
