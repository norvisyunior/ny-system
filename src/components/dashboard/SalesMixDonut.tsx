import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import { fmtMoney } from "../ui";
import { CHART_COLORS, type DayProductSalesRow } from "./types";

const TOP = 5;

export function SalesMixDonut({ rows }: { rows: DayProductSalesRow[] }) {
  const total = rows.reduce((acc, r) => acc + r.totalMicro, 0);
  const ordered = [...rows].sort((a, b) => b.totalMicro - a.totalMicro);
  const top = ordered.slice(0, TOP);
  const rest = ordered.slice(TOP);
  const data = [
    ...top.map((r) => ({ name: r.name, value: r.totalMicro, qtyMicro: r.qtyMicro, unitId: r.unitId })),
    ...(rest.length > 0
      ? [
          {
            name: "Otros",
            value: rest.reduce((acc, r) => acc + r.totalMicro, 0),
            qtyMicro: rest.reduce((acc, r) => acc + r.qtyMicro, 0),
            unitId: top[0]?.unitId ?? null,
          },
        ]
      : []),
  ];

  return (
    <section className="card flex min-h-[19rem] min-w-0 flex-col p-4 @container">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
          <PieChartIcon size={16} />
        </span>
        Distribución de Ventas por Producto
      </h2>

      {data.length === 0 || total <= 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center text-sm text-slate-400">
          Sin ventas registradas este día.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-row items-center gap-2">
          <div className="relative h-36 w-36 shrink-0 sm:h-40 sm:w-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="95%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS.donut[i % CHART_COLORS.donut.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [fmtMoney(Math.round(Number(value))), String(name)]}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                    boxShadow: "0 4px 12px rgb(15 41 37 / 0.08)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2">
              <div className="max-w-full text-center text-xs font-bold leading-tight tabular-nums text-slate-800 sm:text-sm">
                {fmtMoney(total)}
              </div>
              <div className="text-[10px] text-slate-400">Total ventas</div>
            </div>
          </div>

          <ul className="min-w-0 flex-1 space-y-1 overflow-y-auto pr-1" style={{ maxHeight: "10rem" }}>
            {data.map((d, i) => {
              const pct = (d.value / total) * 100;
              return (
                <li key={d.name} className="flex items-start gap-1.5 text-[11px]">
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: CHART_COLORS.donut[i % CHART_COLORS.donut.length] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 leading-snug text-slate-600">{d.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-700">
                    {pct.toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
