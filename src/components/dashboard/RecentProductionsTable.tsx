import { Link } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { fmtDocNumber, fmtMoney, fmtQty } from "../ui";
import type { RecentProductionRow } from "./types";

const KIND_LABEL: Record<RecentProductionRow["kind"], string> = {
  elaboracion: "Elaboración",
  terminacion: "Terminación",
};

function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function YieldCell({ pct }: { pct: number | null }) {
  if (pct == null) return <td className="num text-slate-400">—</td>;
  const cls = pct < 90 ? "text-red-600" : pct < 100 ? "text-amber-600" : "text-emerald-700";
  return <td className={`num font-semibold ${cls}`}>{pct.toFixed(1)}%</td>;
}

export function RecentProductionsTable({ rows }: { rows: RecentProductionRow[] }) {
  return (
    <section className="card min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <ClipboardCheck size={16} />
          </span>
          Producciones Recientes
        </h2>
        <Link
          to="/produccion/producciones"
          className="text-xs font-semibold text-emerald-700 hover:underline"
        >
          Ver todas →
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="table-ny">
          <thead>
            <tr>
              <th>Fecha</th>
              <th className="center">#</th>
              <th>Tipo</th>
              <th>Detalle</th>
              <th className="num">Esperado</th>
              <th className="num">Obtenido</th>
              <th className="num">Rend.</th>
              <th className="num">Costo total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">
                  Aún no hay producciones registradas.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.kind}:${r.number}`}>
                <td className="whitespace-nowrap text-slate-600">{fmtShortDate(r.date)}</td>
                <td className="center font-mono font-semibold">{fmtDocNumber(r.number)}</td>
                <td>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      r.kind === "elaboracion"
                        ? "bg-sky-50 text-sky-700"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {KIND_LABEL[r.kind]}
                  </span>
                </td>
                <td>
                  <div className="font-semibold text-slate-800">{r.title}</div>
                  {r.detail && <div className="text-[11px] text-slate-400">{r.detail}</div>}
                </td>
                <td className="num text-slate-500">{fmtQty(r.expectedMicro, r.unitId, 0)}</td>
                <td className="num font-semibold text-slate-800">
                  {fmtQty(r.actualMicro, r.unitId, 0)}
                </td>
                <YieldCell pct={r.yieldPct} />
                <td className="num text-slate-600">{fmtMoney(r.costMicro)}</td>
                <td>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      r.status === "confirmada"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {r.status === "confirmada" ? "Confirmada" : r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
