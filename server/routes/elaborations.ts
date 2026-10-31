import { Router } from "express";
import { z } from "zod";
import {
  annulElaboration,
  confirmElaboration,
  elaborationInput,
  elaborationPreviewInput,
  getElaborationDetail,
  getElaborationTemplate,
  lastElaborationLabor,
  listElaborations,
  previewElaboration,
  saveElaborationTemplate,
  templateInput,
} from "../services/elaborations";
import { handle, idParam } from "./helpers";
import { pageParams, pagedJson } from "./paging";

export const elaborationsRouter = Router();

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().max(60).optional(),
});

elaborationsRouter.get("/", (req, res) => {
  const opts = listQuery.parse(req.query);
  const pp = pageParams(req);
  const result = listElaborations(handle(req).db, opts, pp);
  pagedJson(res, pp, result);
});

elaborationsRouter.get("/templates/:materialId", (req, res) => {
  const { materialId } = z
    .object({ materialId: z.coerce.number().int().positive() })
    .parse(req.params);
  res.json({ ok: true, data: getElaborationTemplate(handle(req).db, materialId) });
});

elaborationsRouter.put("/templates/:materialId", (req, res) => {
  const h = handle(req);
  const { materialId } = z
    .object({ materialId: z.coerce.number().int().positive() })
    .parse(req.params);
  const input = templateInput.parse(req.body);
  res.json({ ok: true, data: saveElaborationTemplate(h.db, h.units, materialId, input) });
});

elaborationsRouter.get("/last-labor/:materialId", (req, res) => {
  const { materialId } = z
    .object({ materialId: z.coerce.number().int().positive() })
    .parse(req.params);
  res.json({
    ok: true,
    data: { laborCostMicro: lastElaborationLabor(handle(req).db, materialId) },
  });
});

elaborationsRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getElaborationDetail(handle(req).db, id) });
});

elaborationsRouter.post("/preview", (req, res) => {
  const h = handle(req);
  const input = elaborationPreviewInput.parse(req.body);
  res.json({ ok: true, data: previewElaboration(h.db, h.units, input) });
});

elaborationsRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = elaborationInput.parse(req.body);
  res.json({ ok: true, data: confirmElaboration(h.db, h.units, input) });
});

const annulBody = z.object({
  reason: z.string().trim().min(3, "Indique el motivo de anulación.").max(300),
});

elaborationsRouter.post("/:id/annul", (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = annulBody.parse(req.body);
  res.json({ ok: true, data: annulElaboration(handle(req).db, id, reason) });
});
