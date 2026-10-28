import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { isPaged, type Paged } from "../api/client";

export const PAGE_SIZE = 10;

export interface LoadOptions {
  page?: number | null;
  pageSize?: number | null;
  search?: string | null;
  extra?: string | null;
}

/**
 * Cargado de listados paginados del server.
 * `fetchPage` recibe página, tamaño y búsqueda (ya debounced) y devuelve los
 * datos: puede ser Paged<T> (endpoints paginados) o T[] (endpoints sin paging).
 */
export function usePaged<T>(
  fetchPage: (opts: LoadOptions) => Promise<T[] | Paged<T>>,
  deps: unknown[] = [],
) {
  const [page, setPage] = useState(1);
  const [search, setSearchRaw] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (debounced !== "") setPage(1);
  }, [debounced]);

  const reload = useCallback(() => setTick((v) => v + 1), []);

  useEffect(() => {
    const gen = ++genRef.current;
    setLoading(true);
    fetchPage({ page, pageSize: PAGE_SIZE, search: debounced })
      .then((data) => {
        if (genRef.current !== gen) return;
        if (isPaged<T>(data)) {
          setRows(data.items);
          setTotal(data.total);
        } else {
          setRows(data);
          setTotal(data.length);
        }
        setError(null);
      })
      .catch((e: ApiError) => {
        if (genRef.current !== gen) return;
        setError(e.message);
      })
      .finally(() => {
        if (genRef.current === gen) setLoading(false);
      });
    // deps del caller se propagan manualmente por diseño
  }, [page, debounced, tick, ...deps]);

  const setSearch = useCallback((v: string) => setSearchRaw(v), []);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    rows,
    total,
    page: Math.min(page, pages),
    pages,
    pageSize: PAGE_SIZE,
    search,
    setSearch,
    setPage,
    reload,
    loading,
    error,
  };
}
