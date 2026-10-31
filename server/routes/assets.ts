import { Router } from "express";
import { z } from "zod";
import type { DbHandle } from "../db";
import {
  assetDisposeInput,
  assetInput,
  createAsset,
  depreciateAssets,
  disposeAsset,
  getAssetDetail,
  listAssets,
  updateAsset,
} from "../services/assets";
import { microToDecimalTrim } from "../../shared/money";
import { pageParams, pagedJson } from "./paging";

export const assetsRouter = Router();

function handle(req: Express.Request): DbHandle {
  return (req as unknown as { app: { get(n: string): DbHandle } }).app.get("handle");
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

assetsRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const pp = pageParams(req);
  const result = listAssets(handle(req).db, { q, status, category }, pp);
  pagedJson(res, pp, result);
});

// Exportación CSV del inventario de activos (fija, sin paginar).
assetsRouter.get("/csv", (req, res) => {
  const rows = listAssets(handle(req).db, {});
  const money = (micro: number) => microToDecimalTrim(micro, 6);
  const header = [
    "Codigo",
    "Nombre",
    "Categoria",
    "Proveedor",
    "Adquisicion",
    "Costo",
    "Residual",
    "VidaMeses",
    "CuotaMensual",
    "DepreciacionAcumulada",
    "ValorLibros",
    "Estado",
    "Ubicacion",
  ];
  const lines = rows.map((r) =>
    [
      r.code,
      r.name,
      r.category ?? "",
      r.supplierName ?? "",
      r.acquiredAt,
      money(r.costMicro),
      money(r.residualMicro),
      r.usefulLifeMonths,
      money(r.monthlyMicro),
      money(r.depreciatedMicro),
      money(r.bookValueMicro),
      r.status === "en_uso" ? "En uso" : "Dado de baja",
      r.location ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = `\uFEFF${[header.map(csvCell).join(","), ...lines].join("\r\n")}`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="activos-fijos.csv"');
  res.send(csv);
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

assetsRouter.get("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ ok: true, data: getAssetDetail(handle(req).db, id) });
});

assetsRouter.post("/", (req, res) => {
  const input = assetInput.parse(req.body);
  res.json({ ok: true, data: createAsset(handle(req).db, input) });
});

assetsRouter.put("/:id", (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = assetInput.parse(req.body);
  res.json({ ok: true, data: updateAsset(handle(req).db, id, input) });
});

assetsRouter.post("/depreciate", (req, res) => {
  const input = z
    .object({ untilPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() })
    .parse(req.body ?? {});
  res.json({ ok: true, data: depreciateAssets(handle(req).db, input) });
});

assetsRouter.post("/:id/baja", (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = assetDisposeInput.parse(req.body);
  res.json({ ok: true, data: disposeAsset(handle(req).db, id, input) });
});
