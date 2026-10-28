import { Router } from "express";
import { z } from "zod";
import {
  annulPurchase,
  createPurchase,
  getPurchaseDetail,
  listPurchases,
  purchaseInput,
} from "../services/purchases";
import { handle, idParam } from "./helpers";
import { pageParams, pagedJson } from "./paging";

export const purchasesRouter = Router();

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  q: z.string().max(60).optional(),
});

purchasesRouter.get("/", (req, res) => {
  const opts = listQuery.parse(req.query);
  const pp = pageParams(req);
  const result = listPurchases(handle(req).db, opts, pp);
  pagedJson(res, pp, result);
});

purchasesRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getPurchaseDetail(handle(req).db, id) });
});

purchasesRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = purchaseInput.parse(req.body);
  const data = createPurchase(h.db, h.units, input);
  res.json({ ok: true, data });
});

const annulBody = z.object({
  reason: z.string().trim().min(3, "Indique el motivo de anulación.").max(300),
});

purchasesRouter.post("/:id/annul", (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = annulBody.parse(req.body);
  res.json({ ok: true, data: annulPurchase(handle(req).db, id, reason) });
});
