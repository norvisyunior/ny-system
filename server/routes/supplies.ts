import { Router } from "express";
import { z } from "zod";
import type { DbHandle } from "../db";
import {
  consumeSupply,
  createSupply,
  getSupplyDetail,
  listSupplies,
  supplyConsumeInput,
  supplyInput,
  updateSupply,
} from "../services/supplies";
import { pageParams, pagedJson } from "./paging";

export const suppliesRouter = Router();

function handle(req: Express.Request): DbHandle {
  return (req as unknown as { app: { get(n: string): DbHandle } }).app.get("handle");
}

suppliesRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const activeOnly = req.query.active === "1";
  const pp = pageParams(req);
  const result = listSupplies(handle(req).db, { q, activeOnly }, pp);
  pagedJson(res, pp, result);
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

suppliesRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getSupplyDetail(handle(req).db, id) });
});

suppliesRouter.post("/", (req, res) => {
  const input = supplyInput.parse(req.body);
  res.json({ ok: true, data: createSupply(handle(req).db, input) });
});

suppliesRouter.put("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = supplyInput.parse(req.body);
  res.json({ ok: true, data: updateSupply(handle(req).db, id, input) });
});

// Consumo operativo: descuenta PEPS y crea el gasto real consumido.
suppliesRouter.post("/:id/consume", (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = supplyConsumeInput.parse(req.body);
  res.json({ ok: true, data: consumeSupply(handle(req).db, id, input) });
});
