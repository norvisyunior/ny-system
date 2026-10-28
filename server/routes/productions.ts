import { Router } from "express";
import { z } from "zod";
import {
  annulProduction,
  confirmProduction,
  getProductionDetail,
  listProductions,
  listYields,
  productionInput,
} from "../services/productions";
import { handle, idParam } from "./helpers";
import { pageParams, pagedJson } from "./paging";

export const productionsRouter = Router();

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().max(60).optional(),
});

productionsRouter.get("/", (req, res) => {
  const opts = listQuery.parse(req.query);
  const pp = pageParams(req);
  const result = listProductions(handle(req).db, opts, pp);
  pagedJson(res, pp, result);
});

productionsRouter.get("/yields", (req, res) => {
  const listQueryY = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    q: z.string().max(60).optional(),
  });
  const opts = listQueryY.parse(req.query);
  const pp = pageParams(req);
  const result = listYields(handle(req).db, opts, pp);
  pagedJson(res, pp, result);
});

productionsRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getProductionDetail(handle(req).db, id) });
});

productionsRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = productionInput.parse(req.body);
  res.json({ ok: true, data: confirmProduction(h.db, h.units, input) });
});

const annulBody = z.object({
  reason: z.string().trim().min(3, "Indique el motivo de anulación.").max(300),
});

productionsRouter.post("/:id/annul", (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = annulBody.parse(req.body);
  res.json({ ok: true, data: annulProduction(handle(req).db, id, reason) });
});
