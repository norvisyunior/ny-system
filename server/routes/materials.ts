import { Router } from "express";
import { z } from "zod";
import type { DbHandle } from "../db";
import {
  createMaterial,
  getMaterialDetail,
  listMaterials,
  materialInput,
  updateMaterial,
} from "../services/materials";

export const materialsRouter = Router();

function handle(req: Express.Request): DbHandle {
  return (req as unknown as { app: { get(n: string): DbHandle } }).app.get("handle");
}

materialsRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const activeOnly = req.query.active === "1";
  res.json({ ok: true, data: listMaterials(handle(req).db, { q, activeOnly }) });
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

materialsRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getMaterialDetail(handle(req).db, id) });
});

materialsRouter.post("/", (req, res) => {
  const input = materialInput.parse(req.body);
  res.json({ ok: true, data: createMaterial(handle(req).db, input) });
});

materialsRouter.put("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = materialInput.parse(req.body);
  res.json({ ok: true, data: updateMaterial(handle(req).db, id, input) });
});
