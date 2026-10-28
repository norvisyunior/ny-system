import { Router } from "express";
import {
  createProduct,
  getProductDetail,
  listProducts,
  productInput,
  updateProduct,
} from "../services/products";
import { handle, idParam } from "./helpers";
import { pageParams, pagedJson } from "./paging";

export const productsRouter = Router();

productsRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const pp = pageParams(req);
  const result = listProducts(handle(req).db, { q }, pp);
  pagedJson(res, pp, result);
});

productsRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getProductDetail(handle(req).db, id) });
});

productsRouter.post("/", (req, res) => {
  const h = handle(req);
  const input = productInput.parse(req.body);
  res.json({ ok: true, data: createProduct(h.db, input) });
});

productsRouter.put("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  const h = handle(req);
  const input = productInput.parse(req.body);
  res.json({ ok: true, data: updateProduct(h.db, id, input) });
});
