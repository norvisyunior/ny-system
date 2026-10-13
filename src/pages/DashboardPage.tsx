import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, Callout, ErrorAlert, FlowGuide, Kpi, fmtMoney, fmtQty, todayISO } from "../components/ui";

interface StockAlert {
  itemType: string;
  itemId: number;
  name: string;
  unitId: string;
  stockMicro: number;
  minStockMicro: number;
  level: "agotado" | "bajo";
}

interface DayPoint {
  date: string;
  salesMicro: number;
  cogsMicro: number;
  netMicro: number;
}

interface TopProduct {
  productId: number;
  name: string;
  qtyMicro: number;
  totalMicro: number;
  costMicro: number;
  marginMicro: number;
}

interface DashboardData {
  date: string;
  salesMicro: number;
  cogsMicro: number;
  grossMicro: number;
  expensesMicro: number;
  netMicro: number;
  salesCount: number;
  productionBatches: number;
  productionYieldMicro: number;
  stockValueMicro: number;
  alerts: StockAlert[];
  closingDiffCount: number;
  series: DayPoint[];
  topProducts: TopProduct[];
  byPayment: { method: string; totalMicro: number; count: number }[];
  pendingClosings: string[];
  lastClosing: { businessDate: string; status: string; netResultMicro: number } | null;
  auditCount: number;
}

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  otro: "Otro",
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<DashboardData>("/dashboard")
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const maxSales = Math.max(1, ...(data?.series.map((p) => p.salesMicro) ?? [1]));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Indicadores del negocio en tiempo real" />
      <FlowGuide />
      <Callout tone="info" title="Cómo leer este tablero">
        Todo corresponde al día seleccionado: Ventas − Costo de ventas = margen bruto; margen −
        Gastos = utilidad neta. El valor de inventario usa costos PEPS, las alertas salen del stock
        mínimo de cada catálogo y los cierres pendientes indican qué días faltan por cerrar.
      </Callout>
      <ErrorAlert message={error} />

      {data && (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3 lg:grid-cols-7">
            <Kpi label="Ventas" value={fmtMoney(data.salesMicro)} sub={`${data.salesCount} venta(s)`} />
            <Kpi label="Costo de ventas" value={fmtMoney(data.cogsMicro)} muted />
            <Kpi
              label="Margen bruto"
              value={fmtMoney(data.grossMicro)}
              tone={data.grossMicro < 0 ? "red" : "green"}
            />
            <Kpi label="Gastos" value={fmtMoney(data.expensesMicro)} muted />
            <Kpi
              label="Utilidad neta"
              value={fmtMoney(data.netMicro)}
              tone={data.netMicro < 0 ? "red" : "green"}
              big
            />
            <Kpi
              label="Producción hoy"
              value={`${fmtQty(data.productionYieldMicro, null, 0)} masa(s)`}
              sub={`${data.productionBatches} elaboración(es)`}
            />
            <Kpi label="Inventario" value={fmtMoney(data.stockValueMicro)} sub="Valor PEPS" />
          </div>

          {(data.alerts.length > 0 || data.pendingClosings.length > 0 || data.closingDiffCount > 0) && (
            <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="mb-2 text-sm font-bold text-amber-800">Alertas</div>
              <ul className="space-y-1 text-sm text-amber-900">
                {data.pendingClosings.length > 0 && (
                  <li>
                    • Días sin cerrar: <strong>{data.pendingClosings.join(", ")}</strong>
                  </li>
                )}
                {data.closingDiffCount > 0 && (
                  <li>
                    • {data.closingDiffCount} diferencia(s) de inventario registrada(s) en cierres.
                  </li>
                )}
                {data.alerts.map((a) => (
                  <li key={`${a.itemType}:${a.itemId}`}>
                    • {a.level === "agotado" ? "Agotado:" : "Stock bajo:"} {a.name} —{" "}
                    {fmtQty(a.stockMicro, a.unitId)} / mín. {fmtQty(a.minStockMicro, a.unitId)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="card p-4 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">Últimos 14 días</h3>
                <span className="text-xs text-slate-400">
                  <span className="mr-2 inline-block h-2 w-2 rounded-sm bg-slate-400" /> ventas
                  <span className="ml-3 mr-2 inline-block h-2 w-2 rounded-sm bg-emerald-500" /> neto
                </span>
              </div>
              <div className="flex h-44 items-end gap-1.5">
                {data.series.map((p) => {
                  const hSales = Math.round((Math.abs(p.salesMicro) / maxSales) * 100);
                  const hNet = Math.round((Math.abs(p.netMicro) / maxSales) * 100);
                  return (
                    <div key={p.date} className="flex flex-1 flex-col items-center gap-0.5" title={p.date}>
                      <div className="flex h-40 w-full items-end justify-center gap-0.5">
                        <div
                          className="w-1/2 rounded-t bg-slate-400"
                          style={{ height: `${Math.max(hSales, p.salesMicro ? 3 : 0)}%` }}
                        />
                        <div
                          className={`w-1/2 rounded-t ${p.netMicro < 0 ? "bg-red-400" : "bg-emerald-500"}`}
                          style={{ height: `${Math.max(hNet, p.netMicro ? 3 : 0)}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-slate-400">{p.date.slice(8)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Neto acumulado 14 días:{" "}
                <strong>
                  {fmtMoney(data.series.reduce((acc, p) => acc + p.netMicro, 0))}
                </strong>
              </div>
            </div>

            <div className="card p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-700">Ventas de hoy por método</h3>
              {data.byPayment.length === 0 && (
                <p className="text-sm text-slate-400">Sin ventas hoy.</p>
              )}
              <ul className="space-y-2 text-sm">
                {data.byPayment.map((p) => (
                  <li key={p.method} className="flex justify-between">
                    <span>
                      {PAYMENT_LABELS[p.method] ?? p.method}{" "}
                      <span className="text-slate-400">({p.count})</span>
                    </span>
                    <span className="font-semibold">{fmtMoney(p.totalMicro)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>Último cierre</span>
                  <span>
                    {data.lastClosing ? (
                      <Badge tone={data.lastClosing.status === "cerrado" ? "green" : "amber"}>
                        {data.lastClosing.businessDate}
                      </Badge>
                    ) : (
                      "Ninguno"
                    )}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-slate-500">
                  <span>Eventos de auditoría</span>
                  <span className="font-semibold">{data.auditCount}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-bold text-slate-700">Productos más vendidos (30 días)</h3>
            </div>
            <table className="table-ny">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Vendido</th>
                  <th className="num">Ventas</th>
                  <th className="num">Costo</th>
                  <th className="num">Margen</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      Aún no hay ventas.
                    </td>
                  </tr>
                )}
                {data.topProducts.map((t) => (
                  <tr key={t.productId}>
                    <td>{t.name}</td>
                    <td className="num">{fmtQty(t.qtyMicro)}</td>
                    <td className="num font-semibold">{fmtMoney(t.totalMicro)}</td>
                    <td className="num text-slate-500">{fmtMoney(t.costMicro)}</td>
                    <td className={`num font-semibold ${t.marginMicro < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {fmtMoney(t.marginMicro)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !error && (
        <div className="card p-6 text-sm text-slate-500">Cargando indicadores…</div>
      )}
      <div className="mt-3 text-xs text-slate-400">Fecha de referencia: {todayISO()}</div>
    </div>
  );
}
