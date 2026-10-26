import { Router } from "express";
import { laborRateInput, listLaborRates, setLaborRate } from "../services/laborrates";
import { handle } from "./helpers";

export const laborRatesRouter = Router();

laborRatesRouter.get("/", (req, res) => {
  res.json({ ok: true, data: listLaborRates(handle(req).db) });
});

// Alta/actualización (upsert) de una tarifa: por masa o por unidad individual.
laborRatesRouter.put("/", (req, res) => {
  const h = handle(req);
  const input = laborRateInput.parse(req.body);
  res.json({ ok: true, data: setLaborRate(h.db, input) });
});
