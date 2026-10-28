import { Router } from "express";
import type { DbHandle } from "../db";
import { listStockAdjustments, runStockAdjustment, stockAdjustmentInput } from "../services/inventory";
import type { StockAdjustmentRow } from "../services/inventory";
import { pageParams, pagedJson } from "./paging";

export const inventoryRouter = Router();

function handle(req: Express.Request): DbHandle {
  return (req as unknown as { app: { get(n: string): DbHandle } }).app.get("handle");
}

// Ajuste de stock (a cantidad exacta) o registro de merma — siempre por lote PEPS.
inventoryRouter.post("/adjustments", (req, res) => {
  const input = stockAdjustmentInput.parse(req.body);
  res.json({ ok: true, data: runStockAdjustment(handle(req).db, input) });
});

// Historial de ajustes y mermas (paginación ?page=?pageSize= y filtros).
inventoryRouter.get("/adjustments", (req, res) => {
  const itemType = typeof req.query.itemType === "string" ? req.query.itemType : undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const itemIdQ = req.query.itemId;
  const itemIdRaw = itemIdQ == null || itemIdQ === "" ? undefined : Number(itemIdQ);
  const itemId = itemIdRaw != null && Number.isFinite(itemIdRaw) ? itemIdRaw : undefined;
  const pp = pageParams(req);
  const data = listStockAdjustments(
    handle(req).db,
    { itemType, itemId, from, to, q },
    pp ? { limit: pp.limit, offset: pp.offset } : undefined,
  );
  pagedJson<StockAdjustmentRow>(res, pp, data);
});
