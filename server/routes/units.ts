import { Router } from "express";
import { handle } from "./helpers";
import { pageParams, slicePage } from "./paging";

export const unitsRouter = Router();

unitsRouter.get("/", (req, res) => {
  const { units } = handle(req);
  const rows = units.all();
  const pp = pageParams(req);
  if (pp) {
    res.json({ ok: true, data: slicePage(rows, pp) });
    return;
  }
  res.json({ ok: true, data: rows });
});
