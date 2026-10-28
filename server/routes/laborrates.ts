import { Router } from "express";
import { laborRateInput, listLaborRates, setLaborRate } from "../services/laborrates";
import { handle } from "./helpers";
import { pageParams, pagedJson } from "./paging";

export const laborRatesRouter = Router();

laborRatesRouter.get("/", (req, res) => {
  const pp = pageParams(req);
  const result = listLaborRates(handle(req).db, pp);
  pagedJson(res, pp, result);
});

// Alta/actualización (upsert) de una tarifa: por masa o por unidad individual.
laborRatesRouter.put("/", (req, res) => {
  const h = handle(req);
  const input = laborRateInput.parse(req.body);
  res.json({ ok: true, data: setLaborRate(h.db, input) });
});
