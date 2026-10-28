import { ChevronLeft, ChevronRight } from "lucide-react";

/** Controles de paginación + resumen "mostrando X–Y de N". */
export function Pager({
  page,
  pages,
  total,
  pageSize,
  rowsCount,
  onPage,
  label = "registros",
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  rowsCount: number;
  onPage: (p: number) => void;
  label?: string;
}) {
  if (total === 0) {
    return <div className="mt-3 text-sm text-slate-400">0 {label}</div>;
  }
  const from = (page - 1) * pageSize;
  const to = from + rowsCount;
  const summary = `${from + 1}–${to} de ${total}`;

  const btn =
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="mt-3 flex items-center justify-between">
      <div className="text-sm text-slate-500">{summary} {label}</div>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} title="Página anterior">
            <ChevronLeft size={15} />
          </button>
          {page > 3 && <span className="px-1 text-xs text-slate-400">…</span>}
          {pageWindow(page, pages).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              className={`h-8 min-w-8 rounded-md px-2 text-sm font-semibold transition-colors ${
                p === page
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {p}
            </button>
          ))}
          {page < pages - 2 && <span className="px-1 text-xs text-slate-400">…</span>}
          <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} title="Página siguiente">
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Ventana de páginas: hasta 5 números centrados en la actual. */
function pageWindow(page: number, pages: number): number[] {
  const span = 5;
  let start = Math.max(1, page - Math.floor(span / 2));
  const end = Math.min(pages, start + span - 1);
  start = Math.max(1, end - span + 1);
  const out: number[] = [];
  for (let p = start; p <= end; p++) out.push(p);
  return out;
}
