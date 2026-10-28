/**
 * Paginación en capa de servicios (SQL LIMIT/OFFSET + COUNT).
 * Los servicios expuestos por HTTP aceptan un último parámetro opcional:
 *  - sin `paging` → devuelven el array completo (compat con tests y usos viejos);
 *  - con `paging` → devuelven `{ items, total }` (la ruta arma la envoltura).
 */
export interface ListPaging {
  limit?: number;
  offset?: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export type ListResult<T> = T[] | PageResult<T>;

export function isPageResult<T>(value: unknown): value is PageResult<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { total?: unknown }).total === "number"
  );
}
