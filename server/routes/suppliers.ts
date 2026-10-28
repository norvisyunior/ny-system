import { Router } from "express";
import {
  createSupplier,
  listSuppliers,
  supplierInput,
  updateSupplier,
} from "../services/suppliers";
import { handle, idParam } from "./helpers";
import { pageParams, pagedJson } from "./paging";

export const suppliersRouter = Router();

suppliersRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const activeOnly = req.query.active === "1";
  const pp = pageParams(req);
  const result = listSuppliers(handle(req).db, { q, activeOnly }, pp);
  pagedJson(res, pp, result);
});

suppliersRouter.post("/", (req, res) => {
  const input = supplierInput.parse(req.body);
  res.json({ ok: true, data: createSupplier(handle(req).db, input) });
});

suppliersRouter.put("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = supplierInput.parse(req.body);
  res.json({ ok: true, data: updateSupplier(handle(req).db, id, input) });
});
