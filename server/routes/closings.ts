import { Router } from "express";
import { z } from "zod";
import {
  closeDayInput,
  closeDay,
  getClosing,
  listClosings,
  previewClosing,
  reopenDay,
} from "../services/closings";
import { handle } from "./helpers";

export const closingsRouter = Router();

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const listQuery = z.object({
  from: z.string().regex(dateRe).optional(),
  to: z.string().regex(dateRe).optional(),
});

closingsRouter.get("/", (req, res) => {
  const opts = listQuery.parse(req.query);
  res.json({ ok: true, data: listClosings(handle(req).db, opts) });
});

closingsRouter.get("/preview", (req, res) => {
  const { date } = z.object({ date: z.string().regex(dateRe, "Fecha requerida (YYYY-MM-DD).") }).parse(req.query);
  res.json({ ok: true, data: previewClosing(handle(req).db, date) });
});

closingsRouter.get("/:date", (req, res) => {
  const { date } = z.object({ date: z.string().regex(dateRe) }).parse(req.params);
  res.json({ ok: true, data: getClosing(handle(req).db, date) });
});

closingsRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = closeDayInput.parse(req.body);
  res.json({ ok: true, data: closeDay(h.db, input) });
});

const reopenBody = z.object({
  reason: z.string().trim().min(3, "Indique el motivo de la reapertura.").max(300),
});

closingsRouter.post("/:date/reopen", (req, res) => {
  const { date } = z.object({ date: z.string().regex(dateRe) }).parse(req.params);
  const { reason } = reopenBody.parse(req.body);
  res.json({ ok: true, data: reopenDay(handle(req).db, date, reason) });
});
