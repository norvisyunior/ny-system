import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useSelectedDate } from "../app/SelectedDateContext";
import { ErrorAlert, fmtLongDate, fmtMoney, fmtPct } from "../components/ui";
import { AlertsCard, buildAlertItems } from "../components/dashboard/AlertsCard";
import { FinancialSummaryCard } from "../components/dashboard/FinancialSummaryCard";
import { InsightCard } from "../components/dashboard/InsightCard";
import { InventoryCard } from "../components/dashboard/InventoryCard";
import { KpiCard, type KpiDelta } from "../components/dashboard/KpiCard";
import { ProductionStatusCard } from "../components/dashboard/ProductionStatusCard";
import { RecentProductionsTable } from "../components/dashboard/RecentProductionsTable";
import { SalesCostChart } from "../components/dashboard/SalesCostChart";
import { SalesMixDonut } from "../components/dashboard/SalesMixDonut";
import { TopProductsCard } from "../components/dashboard/TopProductsCard";
import type { DailyPoint, DashboardData } from "../components/dashboard/types";
import { Banknote, ChartColumn, Receipt, Target, Wallet } from "lucide-react";

function pctOf(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return fmtPct((part / whole) * 100);
}

/**
 * Delta "vs. ayer" solo cuando el día anterior tuvo datos (prev > 0).
 * `higherIsBetter` define si subir es bueno (ventas) o malo (costos/gastos).
 */
function vsYesterday(
  current: number,
  previous: DailyPoint | undefined,
  pick: (p: DailyPoint) => number,
  higherIsBetter: boolean,
): KpiDelta | null {
  if (!previous) return null;
  const prev = pick(previous);
  if (prev <= 0) return null;
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.05) return null;
  const good = higherIsBetter ? pct > 0 : pct < 0;
  return { pct, good, label: "vs. ayer" };
}

export function DashboardPage() {
  const { date, setNotificationCount } = useSelectedDate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<DashboardData>(`/dashboard?date=${date}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  }, [date]);
  useEffect(load, [load]);

  const prevDay: DailyPoint | undefined = data?.daily[data.daily.length - 2];

  useEffect(() => {
    if (!data) return;
    setNotificationCount(buildAlertItems(data).length);
  }, [data, setNotificationCount]);

  const kpis = data
    ? [
        {
          label: "Ventas del día",
          value: fmtMoney(data.salesMicro),
          sub: `${data.salesCount} ${data.salesCount === 1 ? "venta" : "ventas"}`,
          delta: vsYesterday(data.salesMicro, prevDay, (p) => p.salesMicro, true),
          icon: Banknote,
          tone: "sales" as const,
        },
        {
          label: "Costo de ventas",
          value: fmtMoney(data.cogsMicro),
          sub: pctOf(data.cogsMicro, data.salesMicro)
            ? `${pctOf(data.cogsMicro, data.salesMicro)} del total`
            : "Histórico PEPS",
          delta: vsYesterday(data.cogsMicro, prevDay, (p) => p.cogsMicro, false),
          icon: Receipt,
          tone: "costs" as const,
        },
        {
          label: "Utilidad bruta",
          value: fmtMoney(data.grossMicro),
          sub: pctOf(data.grossMicro, data.salesMicro)
            ? `${pctOf(data.grossMicro, data.salesMicro)} de margen`
            : "Sin ventas",
          delta: vsYesterday(data.grossMicro, prevDay, (p) => p.grossMicro, true),
          icon: ChartColumn,
          tone: "gross" as const,
        },
        {
          label: "Gastos operativos",
          value: fmtMoney(data.expensesMicro),
          sub: pctOf(data.expensesMicro, data.salesMicro)
            ? `${pctOf(data.expensesMicro, data.salesMicro)} del total`
            : `${data.dayExpenses.length} registro(s)`,
          delta: vsYesterday(data.expensesMicro, prevDay, (p) => p.expensesMicro, false),
          icon: Wallet,
          tone: "expenses" as const,
        },
        {
          label: "Resultado neto",
          value: fmtMoney(data.netMicro),
          sub: pctOf(data.netMicro, data.salesMicro)
            ? `${pctOf(data.netMicro, data.salesMicro)} de margen`
            : "Ventas − costos − gastos",
          delta: vsYesterday(data.netMicro, prevDay, (p) => p.netMicro, true),
          icon: Target,
          tone: "net" as const,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <ErrorAlert message={error} />

      {!data && !error && (
        <div className="card p-6 text-sm text-slate-500">Cargando indicadores…</div>
      )}

      {data && (
        <>
          {/* 5 tarjetas KPI */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {kpis.map((k) => (
              <KpiCard
                key={k.label}
                label={k.label}
                value={k.value}
                sub={k.sub}
                delta={k.delta}
                icon={k.icon}
                tone={k.tone}
              />
            ))}
          </div>

          {/* Columna principal + columna lateral */}
          <div className="grid items-start gap-4 xl:grid-cols-3">
            <div className="min-w-0 space-y-4 xl:col-span-2">
              <div className="grid gap-4 lg:grid-cols-2">
                <SalesCostChart data={data.daily} />
                <SalesMixDonut rows={data.dayProductSales} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ProductionStatusCard data={data} />
                <InventoryCard data={data} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <RecentProductionsTable rows={data.recentProductions} />
                <TopProductsCard rows={data.dayProductSales} />
              </div>

              {/* Semana y mes */}
              <section className="card overflow-hidden">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="text-sm font-bold text-slate-800">
                    Semana y mes{" "}
                    <span className="font-normal text-slate-400">
                      · al {fmtLongDate(data.date)}
                    </span>
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="table-ny">
                    <thead>
                      <tr>
                        <th>Período</th>
                        <th className="num">Ventas</th>
                        <th className="num">Costo</th>
                        <th className="num">Margen bruto</th>
                        <th className="num">Gastos</th>
                        <th className="num">Utilidad neta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([["Últimos 7 días", data.week], ["Mes en curso", data.month]] as const).map(
                        ([label, s]) => (
                          <tr key={label}>
                            <td>
                              <div className="font-semibold text-slate-800">{label}</div>
                              <div className="text-xs text-slate-400">
                                {s.from} → {s.to}
                              </div>
                            </td>
                            <td className="num font-semibold">{fmtMoney(s.salesMicro)}</td>
                            <td className="num text-slate-500">{fmtMoney(s.cogsMicro)}</td>
                            <td className="num">{fmtMoney(s.grossMicro)}</td>
                            <td className="num text-slate-500">{fmtMoney(s.expensesMicro)}</td>
                            <td
                              className={`num font-bold ${
                                s.netMicro < 0 ? "text-red-600" : "text-emerald-700"
                              }`}
                            >
                              {fmtMoney(s.netMicro)}
                              {s.salesMicro > 0 && (
                                <div className="text-[11px] font-normal text-slate-400">
                                  {fmtPct((s.netMicro / s.salesMicro) * 100)} de ventas
                                </div>
                              )}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {/* Columna lateral */}
            <div className="min-w-0 space-y-4">
              <AlertsCard data={data} />
              <FinancialSummaryCard data={data} />
              <InsightCard data={data} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
