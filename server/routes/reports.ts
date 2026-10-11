import { Router } from "express";
import { z } from "zod";
import { buildReport, toCsv, REPORT_NAMES } from "../services/reports";
import { notFoundError } from "../domain/errors";
import { handle } from "./helpers";

export const reportsRouter = Router();

const rangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function nameParam(raw: string): string {
  if (!REPORT_NAMES.includes(raw as never)) {
    throw notFoundError(
      `Reporte "${raw}" (disponibles: ${REPORT_NAMES.join(", ")})`,
    );
  }
  return raw;
}

reportsRouter.get("/names", (_req, res) => {
  res.json({ ok: true, data: REPORT_NAMES });
});

reportsRouter.get("/:name/csv", (req, res) => {
  const name = nameParam(String(req.params.name));
  const range = rangeQuery.parse(req.query);
  const report = buildReport(handle(req).db, name, range);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="ny-${name}-${report.from ?? "actual"}.csv"`,
  );
  res.send(toCsv(report));
});

reportsRouter.get("/:name", (req, res) => {
  const name = nameParam(String(req.params.name));
  const range = rangeQuery.parse(req.query);
  res.json({ ok: true, data: buildReport(handle(req).db, name, range) });
});
