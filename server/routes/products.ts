import { Router } from "express";
import {
  createProduct,
  getProductDetail,
  listProducts,
  productInput,
  updateProduct,
} from "../services/products";
import { handle, idParam } from "./helpers";

export const productsRouter = Router();

productsRouter.get("/", (req, res) => {
  res.json({ ok: true, data: listProducts(handle(req).db) });
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
