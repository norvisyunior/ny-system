import { Router } from "express";
import { handle } from "./helpers";

export const unitsRouter = Router();

unitsRouter.get("/", (req, res) => {
  const { units } = handle(req);
  res.json({ ok: true, data: units.all() });
});
