import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { fmtMoney, fmtQty } from "../ui";
import { CHART_COLORS, type DayProductSalesRow } from "./types";

export function TopProductsCard({ rows }: { rows: DayProductSalesRow[] }) {
  const ordered = [...rows].sort((a, b) => b.totalMicro - a.totalMicro);
  const total = ordered.reduce((acc, r) => acc + r.totalMicro, 0);
  const max = ordered[0]?.totalMicro ?? 1;

  return (
    <section className="card flex min-w-0 flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-500">
            <Trophy size={16} />
          </span>
          Productos Más Vendidos
        </h2>
        <Link to="/reportes" className="text-xs font-semibold text-emerald-700 hover:underline">
          Ver reporte →
        </Link>
      </div>

      {ordered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center text-sm text-slate-400">
          Sin ventas registradas este día.
        </div>
      ) : (
        <ol className="space-y-3">
          {ordered.slice(0, 5).map((r, i) => {
            const share = total > 0 ? (r.totalMicro / total) * 100 : 0;
            const width = (r.totalMicro / max) * 100;
            return (
              <li key={r.productId} className="flex items-center gap-3">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: i === 0 ? "#0f766e" : "#334155" }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-slate-700">{r.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {fmtMoney(r.totalMicro)} · {share.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(6, width)}%`,
                        background: CHART_COLORS.donut[i % CHART_COLORS.donut.length],
                      }}
                    />
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {fmtQty(r.qtyMicro, r.unitId, 0)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
