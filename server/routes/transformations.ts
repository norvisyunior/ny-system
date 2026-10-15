import { Router } from "express";
import { z } from "zod";
import {
  annulTransformation,
  confirmTransformation,
  getTransformationDetail,
  listTransformations,
  previewTransformation,
  transformationInput,
  transformationPreviewInput,
} from "../services/transformations";
import { handle, idParam } from "./helpers";

export const transformationsRouter = Router();

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const listQuery = z.object({
  from: z.string().regex(dateRe).optional(),
  to: z.string().regex(dateRe).optional(),
});

// Vista previa: empaques de fase 'paquete' según los paquetes reales (sin tocar stock).
transformationsRouter.post("/preview", (req, res) => {
  const h = handle(req);
  const input = transformationPreviewInput.parse(req.body);
  res.json({ ok: true, data: previewTransformation(h.db, h.units, input) });
});

transformationsRouter.get("/", (req, res) => {
  const opts = listQuery.parse(req.query);
  res.json({ ok: true, data: listTransformations(handle(req).db, opts) });
});

transformationsRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getTransformationDetail(handle(req).db, id) });
});

transformationsRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = transformationInput.parse(req.body);
  res.json({ ok: true, data: confirmTransformation(h.db, h.units, input) });
});

const annulBody = z.object({
  reason: z.string().trim().min(3, "Indique el motivo de anulación.").max(300),
});

transformationsRouter.post("/:id/annul", (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = annulBody.parse(req.body);
  res.json({ ok: true, data: annulTransformation(handle(req).db, id, reason) });
});
