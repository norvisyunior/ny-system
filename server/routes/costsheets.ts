import { Router } from "express";
import {
  costSheetInput,
  getCostSheet,
  previewCostSheet,
} from "../services/costsheets";
import { handle, idParam } from "./helpers";

export const costSheetsRouter = Router();

// Ficha base del producto asociado a la versión de receta (sin overrides).
costSheetsRouter.get("/:recipeVersionId", (req, res) => {
  const { id } = idParam.parse(req.params);
  const h = handle(req);
  res.json({ ok: true, data: getCostSheet(h.db, h.units, id) });
});

// Ficha recalculada con la simulación (no toca inventario ni recetas).
costSheetsRouter.post("/preview", (req, res) => {
  const h = handle(req);
  const input = costSheetInput.parse(req.body);
  res.json({ ok: true, data: previewCostSheet(h.db, h.units, input) });
});
