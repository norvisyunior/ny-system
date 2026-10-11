import { Router } from "express";
import { createMass, getMassDetail, listMasses, massInput, updateMass } from "../services/masses";
import { handle, idParam } from "./helpers";

export const massesRouter = Router();

massesRouter.get("/", (req, res) => {
  res.json({ ok: true, data: listMasses(handle(req).db) });
});

massesRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getMassDetail(handle(req).db, id) });
});

massesRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = massInput.parse(req.body);
  res.json({ ok: true, data: createMass(h.db, input) });
});

massesRouter.put("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  const h = handle(req);
  const input = massInput.parse(req.body);
  res.json({ ok: true, data: updateMass(h.db, id, input) });
});
