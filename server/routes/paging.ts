/**
 * Paginación de listados por HTTP: `?page=&pageSize=`.
 * Cuando `page` está presente la ruta responde con la envoltura paged y
 * `Paged<T>`; cuando no lo está mantiene la respuesta en array (retrocompat).
 */
import type { Request } from "express";

export interface PagedEnvelope {
  items: never[];
  total: number;
  page: number;
  pageSize: number;
}

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export interface PageParams {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 10;

/** Interpreta ?page/?pageSize; undefined cuando no hay paginación pedida. */
export function pageParams(req: Request): PageParams | undefined {
  const raw = req.query.page;
  if (raw == null || raw === "") return undefined;
  const page = Math.max(1, Math.trunc(Number(Array.isArray(raw) ? raw[0] : raw)) || 1);
  const rawSize = req.query.pageSize;
  const parsedSize =
    rawSize == null || rawSize === ""
      ? DEFAULT_PAGE_SIZE
      : Number(Array.isArray(rawSize) ? rawSize[0] : rawSize);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      Math.trunc(Number.isFinite(parsedSize) ? parsedSize : DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE,
    ),
  );
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

/** Envuelve los resultados (recorte ya aplicado por el servicio). */
export function envelope<T>(rows: T[], total: number, pp: PageParams): Paginated<T> {
  return { items: rows, total, page: pp.page, pageSize: pp.pageSize };
}

/** Recorta un array ya en memoria (listados pequeños, reportes). */
export function slicePage<T>(rows: T[], pp: PageParams): Paginated<T> {
  return {
    items: rows.slice(pp.offset, pp.offset + pp.limit),
    total: rows.length,
    page: pp.page,
    pageSize: pp.pageSize,
  };
}

/** Envoltorio de respuesta cuando el servicio devuelve { items, total }. */
export function isPageResult<T extends { items?: unknown; total?: unknown }>(
  value: unknown,
): value is { items: T[]; total: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { total?: unknown }).total === "number"
  );
}

import type { Response } from "express";

/** Respuesta estándar: array cuando no hay ?page, envoltura paged cuando sí. */
export function pagedJson<T>(
  res: Response,
  pp: PageParams | undefined,
  result: T[] | { items: T[]; total: number },
): void {
  if (pp && isPageResult(result)) {
    res.json({
      ok: true,
      data: { items: result.items, total: result.total, page: pp.page, pageSize: pp.pageSize },
    });
    return;
  }
  res.json({ ok: true, data: result });
}
