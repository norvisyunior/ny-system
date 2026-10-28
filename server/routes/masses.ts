import { Router } from "express";
import { createMass, getMassDetail, listMasses, massInput, updateMass } from "../services/masses";
import { handle, idParam } from "./helpers";
import { pageParams, pagedJson } from "./paging";

export const massesRouter = Router();

massesRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const pp = pageParams(req);
  const result = listMasses(handle(req).db, { q }, pp);
  pagedJson(res, pp, result);
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
