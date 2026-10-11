import { Router } from "express";
import {
  createSupplier,
  listSuppliers,
  supplierInput,
  updateSupplier,
} from "../services/suppliers";
import { handle, idParam } from "./helpers";

export const suppliersRouter = Router();

suppliersRouter.get("/", (req, res) => {
  res.json({ ok: true, data: listSuppliers(handle(req).db) });
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
