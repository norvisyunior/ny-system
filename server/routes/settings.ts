import { Router } from "express";
import { getSettings, settingsInput, updateSettings } from "../services/settings";
import { handle } from "./helpers";

export const settingsRouter = Router();

settingsRouter.get("/", (req, res) => {
  res.json({ ok: true, data: getSettings(handle(req).db) });
});

settingsRouter.put("/", (req, res) => {
  const h = handle(req);
  const input = settingsInput.parse(req.body);
  res.json({ ok: true, data: updateSettings(h.db, input) });
});
