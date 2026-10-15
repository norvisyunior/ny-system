import { Router } from "express";
import { z } from "zod";
import {
  annulPlan,
  createPlan,
  deletePlan,
  getPlanDetail,
  listPlans,
  planInput,
  planPreviewInput,
  previewPlan,
} from "../services/planning";
import { handle, idParam } from "./helpers";

export const plansRouter = Router();

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const listQuery = z.object({
  from: z.string().regex(dateRe).optional(),
  to: z.string().regex(dateRe).optional(),
});

plansRouter.get("/", (req, res) => {
  const opts = listQuery.parse(req.query);
  res.json({ ok: true, data: listPlans(handle(req).db, opts) });
});

const annulBody = z.object({
  reason: z.string().trim().min(3, "Indique el motivo de anulación.").max(300),
});

// Vista previa del plan: calcula masas, materiales, faltantes y costos
// SIN descontar inventario ni registrar nada.
plansRouter.post("/preview", (req, res) => {
  const h = handle(req);
  const input = planPreviewInput.parse(req.body);
  res.json({ ok: true, data: previewPlan(h.db, h.units, input) });
});

plansRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getPlanDetail(handle(req).db, id) });
});

plansRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = planInput.parse(req.body);
  res.json({ ok: true, data: createPlan(h.db, h.units, input) });
});

plansRouter.post("/:id/annul", (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = annulBody.parse(req.body);
  res.json({ ok: true, data: annulPlan(handle(req).db, id, reason) });
});

plansRouter.delete("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: deletePlan(handle(req).db, id) });
});
