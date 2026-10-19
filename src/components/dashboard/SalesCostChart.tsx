import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney } from "../ui";
import { CHART_COLORS, type DailyPoint } from "./types";
import { ChartColumn } from "lucide-react";

function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]}`;
}

function axisMoney(v: number): string {
  if (v === 0) return "$0";
  const abs = Math.abs(v);
  const text =
    abs >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : abs >= 1_000
        ? `${Math.round(v / 1_000)}k`
        : String(Math.round(v));
  return `$${text}`;
}

export function SalesCostChart({ data }: { data: DailyPoint[] }) {
  const hasData = data.some((p) => p.salesMicro !== 0 || p.cogsMicro !== 0);
  const rows = data.map((p) => ({
    date: fmtShortDate(p.date),
    Ventas: p.salesMicro / 1_000_000,
    Costos: p.cogsMicro / 1_000_000,
    Utilidad: p.grossMicro / 1_000_000,
  }));

  return (
    <section className="card flex min-h-[19rem] min-w-0 flex-col p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <ChartColumn size={16} />
          </span>
          Ventas vs. Costos{" "}
          <span className="font-normal text-slate-400">(últimos 15 días)</span>
        </h2>
        <ul className="flex items-center gap-3 text-xs text-slate-500" aria-hidden>
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS.sales }} />
            Ventas
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS.costs }} />
            Costos
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS.expenses }} />
            Utilidad
          </li>
        </ul>
      </div>

      {!hasData ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center text-sm text-slate-400">
          Sin ventas ni costos registrados en el período.
        </div>
      ) : (
        <div className="min-h-0 flex-1" style={{ minHeight: "14rem" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={{ stroke: "#e2e8f0" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={axisMoney}
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                formatter={(value, name) => [fmtMoney(Math.round(Number(value) * 1_000_000)), String(name)]}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgb(15 41 37 / 0.08)",
                }}
              />
              <Bar dataKey="Ventas" fill={CHART_COLORS.sales} radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Bar dataKey="Costos" fill={CHART_COLORS.costs} radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Line
                type="monotone"
                dataKey="Utilidad"
                stroke={CHART_COLORS.expenses}
                strokeWidth={2.5}
                dot={{ r: 3, fill: CHART_COLORS.expenses, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
