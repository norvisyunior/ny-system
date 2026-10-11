import { Router } from "express";
import { z } from "zod";
import {
  createRecipe,
  createRecipeVersion,
  getRecipeVersionDetail,
  getRecipeVersions,
  listRecipes,
  recipeCreateInput,
  recipeUpdateInput,
  updateRecipe,
  versionInput,
} from "../services/recipes";
import { handle, idParam } from "./helpers";

export const recipesRouter = Router();

recipesRouter.get("/", (req, res) => {
  res.json({ ok: true, data: listRecipes(handle(req).db) });
});

recipesRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = recipeCreateInput.parse(req.body);
  res.json({ ok: true, data: createRecipe(h.db, h.units, input) });
});

const recipeId = z.object({ id: z.coerce.number().int().positive() });

recipesRouter.get("/:id/versions", (req, res) => {
  const { id } = recipeId.parse(req.params);
  res.json({ ok: true, data: getRecipeVersions(handle(req).db, id) });
});

recipesRouter.put("/:id", (req, res) => {
  const { id } = recipeId.parse(req.params);
  const h = handle(req);
  const input = recipeUpdateInput.parse(req.body);
  res.json({ ok: true, data: updateRecipe(h.db, id, input) });
});

recipesRouter.post("/:id/versions", (req, res) => {
  const { id } = recipeId.parse(req.params);
  const h = handle(req);
  const input = versionInput.parse(req.body);
  res.json({ ok: true, data: createRecipeVersion(h.db, h.units, id, input) });
});

export const recipeVersionsRouter = Router();

recipeVersionsRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getRecipeVersionDetail(handle(req).db, id) });
});
