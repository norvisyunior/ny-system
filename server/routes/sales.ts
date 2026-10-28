import { Router } from "express";
import { z } from "zod";
import {
  annulSale,
  confirmSale,
  getSaleDetail,
  getSalesSummary,
  listSales,
  saleInput,
} from "../services/sales";
import { handle, idParam } from "./helpers";
import { pageParams, pagedJson } from "./paging";

export const salesRouter = Router();

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().max(60).optional(),
});

salesRouter.get("/", (req, res) => {
  const opts = listQuery.parse(req.query);
  const pp = pageParams(req);
  const result = listSales(handle(req).db, opts, pp);
  pagedJson(res, pp, result);
});

// Totales de ventas confirmadas para el filtro (no solo de la página visible).
salesRouter.get("/summary", (req, res) => {
  const opts = listQuery.omit({ q: true }).parse(req.query);
  res.json({ ok: true, data: getSalesSummary(handle(req).db, opts) });
});

salesRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getSaleDetail(handle(req).db, id) });
});

salesRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = saleInput.parse(req.body);
  res.json({ ok: true, data: confirmSale(h.db, input) });
});

const annulBody = z.object({
  reason: z.string().trim().min(3, "Indique el motivo de anulación.").max(300),
});

salesRouter.post("/:id/annul", (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = annulBody.parse(req.body);
  res.json({ ok: true, data: annulSale(handle(req).db, id, reason) });
});
