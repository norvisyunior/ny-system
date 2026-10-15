import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, ErrorAlert, FlowGuide, fmtMoney, fmtPct, fmtQty } from "../components/ui";

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

const ITEM_TYPE_LABELS: Record<string, string> = {
  raw: "Materia prima",
  mass: "Masa",
  product: "Producto terminado",
};

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "2026-10-13" → "13 de octubre de 2026" */
function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

/** "2026-10-13" → "13/10" */
function fmtShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Porcentaje de margen sobre las ventas (0 si no hay ventas). */
function marginPct(marginMicro: number, salesMicro: number): number | null {
  if (salesMicro <= 0) return null;
  return (marginMicro / salesMicro) * 100;
}

/** Celda de la cinta de resultado: etiqueta, monto y nota secundaria. */
function BandStat({
  label,
  value,
  sub,
  strong = false,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex-1 px-4 py-3.5 sm:min-w-[9rem]">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div
        className={`mt-0.5 tabular-nums ${
          strong ? "text-lg font-bold text-slate-900" : "text-base font-semibold text-slate-600"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

/** Conector aritmético entre bloques de la cinta (−, =). */
function BandOp({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="hidden w-7 shrink-0 select-none items-center justify-center text-xl font-light text-slate-300 sm:flex"
    >
      {children}
    </div>
  );
}

/** Tarjeta pequeña de métrica secundaria. */
function MiniStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

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
  const acumNet = data ? data.series.reduce((acc, p) => acc + p.netMicro, 0) : 0;

  const agotados = data?.alerts.filter((a) => a.level === "agotado") ?? [];
  const bajos = data?.alerts.filter((a) => a.level === "bajo") ?? [];
  const cierresPendientes = data?.pendingClosings.length ?? 0;
  const alertCount = agotados.length + bajos.length + cierresPendientes;

  const grossPct = data ? marginPct(data.grossMicro, data.salesMicro) : null;
  const netPct = data ? marginPct(data.netMicro, data.salesMicro) : null;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          data ? `Resultados del negocio al ${fmtLongDate(data.date)}` : "Indicadores del negocio"
        }
      />
      <FlowGuide />
      <ErrorAlert message={error} />

      {data && (
        <>
          {/* Cinta de resultado del día: Ventas − Costo = Margen − Gastos = Utilidad */}
          <div className="card mb-5 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-stretch">
              <BandStat
                label="Ventas"
                value={fmtMoney(data.salesMicro)}
                sub={`${data.salesCount} ${data.salesCount === 1 ? "venta" : "ventas"} hoy`}
                strong
              />
              <BandOp>−</BandOp>
              <BandStat
                label="Costo de ventas"
                value={fmtMoney(data.cogsMicro)}
                sub={grossPct != null ? `${fmtPct(100 - grossPct)} de las ventas` : "Del día"}
              />
              <BandOp>=</BandOp>
              <BandStat
                label="Margen bruto"
                value={fmtMoney(data.grossMicro)}
                sub={grossPct != null ? `${fmtPct(grossPct)} de las ventas` : "Sin ventas"}
                strong
              />
              <BandOp>−</BandOp>
              <BandStat label="Gastos" value={fmtMoney(data.expensesMicro)} sub="Del día" />
              <BandOp>=</BandOp>
              <div className="flex flex-[1.3] flex-col justify-center bg-[#0b1220] px-5 py-4 sm:min-w-[13rem]">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Utilidad neta del día
                </div>
                <div
                  className={`mt-0.5 text-3xl font-bold tabular-nums ${
                    data.netMicro < 0 ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {fmtMoney(data.netMicro)}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {netPct != null ? `${fmtPct(netPct)} de las ventas` : "Sin ventas hoy"}
                </div>
              </div>
            </div>
            <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
              Cómo se calcula: Ventas − Costo de ventas = Margen bruto; Margen bruto − Gastos =
              Utilidad neta. El inventario y el costo de ventas usan costo PEPS.
            </div>
          </div>

          {/* Métricas secundarias */}
          <div className="mb-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MiniStat
              label="Inventario"
              value={fmtMoney(data.stockValueMicro)}
              sub="Valor a costo PEPS"
            />
            <MiniStat
              label="Producción de hoy"
              value={`${fmtQty(data.productionYieldMicro, null, 0)} masas`}
              sub={`${data.productionBatches} ${
                data.productionBatches === 1 ? "elaboración" : "elaboraciones"
              } confirmada(s)`}
            />
            <div className="card p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Ventas de hoy por método
              </div>
              {data.byPayment.length === 0 ? (
                <div className="mt-1 text-sm text-slate-400">Sin ventas hoy.</div>
              ) : (
                <ul className="mt-1.5 space-y-1.5 text-sm">
                  {data.byPayment.map((p) => (
                    <li key={p.method} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-600">
                        {PAYMENT_LABELS[p.method] ?? p.method}{" "}
                        <span className="text-xs text-slate-400">({p.count})</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                        {fmtMoney(p.totalMicro)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Cierre y auditoría
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">Último cierre</span>
                {data.lastClosing ? (
                  <Badge tone={data.lastClosing.status === "cerrado" ? "green" : "amber"}>
                    {fmtShortDate(data.lastClosing.businessDate)}
                  </Badge>
                ) : (
                  <span className="text-slate-400">Ninguno</span>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">Eventos de auditoría</span>
                <span className="font-semibold tabular-nums text-slate-900">{data.auditCount}</span>
              </div>
            </div>
          </div>

          {/* Alertas y pendientes */}
          <div className="card mb-5 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-700">Alertas y pendientes</h3>
              <Badge tone={alertCount > 0 ? "amber" : "green"}>
                {alertCount > 0
                  ? `${alertCount} ${alertCount === 1 ? "pendiente" : "pendientes"}`
                  : "Todo en orden"}
              </Badge>
            </div>

            {alertCount === 0 ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Sin alertas: el stock está por encima del mínimo y todos los días están cerrados.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-red-600">
                    Agotados ({agotados.length})
                  </div>
                  {agotados.length === 0 ? (
                    <p className="text-sm text-slate-400">Ninguno.</p>
                  ) : (
                    <ul className="space-y-2">
                      {agotados.map((a) => (
                        <li
                          key={`${a.itemType}:${a.itemId}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-800">
                              {a.name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {ITEM_TYPE_LABELS[a.itemType] ?? a.itemType}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-bold tabular-nums text-red-700">
                              {fmtQty(a.stockMicro, a.unitId)}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              mín. {fmtQty(a.minStockMicro, a.unitId)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-amber-600">
                    Stock bajo ({bajos.length})
                  </div>
                  {bajos.length === 0 ? (
                    <p className="text-sm text-slate-400">Ninguno.</p>
                  ) : (
                    <ul className="space-y-2">
                      {bajos.map((a) => (
                        <li
                          key={`${a.itemType}:${a.itemId}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-800">
                              {a.name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {ITEM_TYPE_LABELS[a.itemType] ?? a.itemType}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-bold tabular-nums text-amber-700">
                              {fmtQty(a.stockMicro, a.unitId)}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              mín. {fmtQty(a.minStockMicro, a.unitId)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-amber-600">
                    Cierres pendientes ({cierresPendientes})
                  </div>
                  {cierresPendientes === 0 ? (
                    <p className="text-sm text-slate-400">Todos los días están cerrados.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {data.pendingClosings.map((d) => (
                          <Badge key={d} tone="amber">
                            {fmtShortDate(d)}
                          </Badge>
                        ))}
                      </div>
                      {data.closingDiffCount > 0 && (
                        <p className="mt-2 text-xs text-amber-700">
                          {data.closingDiffCount} diferencia(s) de inventario registradas en cierres.
                        </p>
                      )}
                    </>
                  )}
                  <NavLink
                    to="/operaciones/cierre"
                    className="mt-3 inline-block text-xs font-semibold text-blue-700 hover:underline"
                  >
                    Ir al cierre diario →
                  </NavLink>
                </div>
              </div>
            )}
          </div>

          {/* Tendencia de 14 días */}
          <div className="card mb-5 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-700">
                Ventas y utilidad neta · últimos 14 días
              </h3>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" /> Ventas
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Utilidad
                  neta
                </span>
                <span>
                  Acumulado neto:{" "}
                  <strong className="font-semibold tabular-nums text-slate-800">
                    {fmtMoney(acumNet)}
                  </strong>
                </span>
              </div>
            </div>
            <div className="mb-1 text-[11px] text-slate-400">
              Máximo del período: {fmtMoney(maxSales)}
            </div>
            <div className="flex h-48 items-end gap-1.5 border-b border-slate-200">
              {data.series.map((p) => {
                const hSales = Math.round((Math.abs(p.salesMicro) / maxSales) * 100);
                const hNet = Math.round((Math.abs(p.netMicro) / maxSales) * 100);
                const isToday = p.date === data.date;
                return (
                  <div
                    key={p.date}
                    className="group flex flex-1 flex-col items-center gap-0.5"
                    title={`${fmtLongDate(p.date)} — Ventas ${fmtMoney(p.salesMicro)} · Utilidad neta ${fmtMoney(p.netMicro)}`}
                  >
                    <div className="flex h-44 w-full items-end justify-center gap-0.5">
                      <div
                        className="w-1/2 rounded-t bg-slate-300 group-hover:bg-slate-400"
                        style={{ height: `${Math.max(hSales, p.salesMicro ? 3 : 0)}%` }}
                      />
                      <div
                        className={`w-1/2 rounded-t ${
                          p.netMicro < 0 ? "bg-red-400" : "bg-emerald-500"
                        }`}
                        style={{ height: `${Math.max(hNet, p.netMicro ? 3 : 0)}%` }}
                      />
                    </div>
                    <span
                      className={`text-[10px] ${isToday ? "font-bold text-blue-600" : "text-slate-400"}`}
                    >
                      {p.date.slice(8)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-1 text-center text-[10px] text-slate-400">
              Día del mes · el día en azul es hoy
            </div>
          </div>

          {/* Productos más vendidos */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-bold text-slate-700">
                Productos más vendidos · últimos 30 días
              </h3>
              <span className="text-xs text-slate-400">
                {data.topProducts.length} producto(s)
              </span>
            </div>
            <table className="table-ny">
              <thead>
                <tr>
                  <th className="center">#</th>
                  <th>Producto</th>
                  <th className="num">Unidades</th>
                  <th className="num">Ventas</th>
                  <th className="num">Costo</th>
                  <th className="num">Margen</th>
                  <th className="num">% margen</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-400">
                      Aún no hay ventas registradas.
                    </td>
                  </tr>
                )}
                {data.topProducts.map((t, i) => {
                  const pct = marginPct(t.marginMicro, t.totalMicro);
                  return (
                    <tr key={t.productId}>
                      <td className="center">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                          {i + 1}
                        </span>
                      </td>
                      <td className="font-semibold">{t.name}</td>
                      <td className="num">{fmtQty(t.qtyMicro)}</td>
                      <td className="num font-semibold tabular-nums">{fmtMoney(t.totalMicro)}</td>
                      <td className="num tabular-nums text-slate-500">{fmtMoney(t.costMicro)}</td>
                      <td
                        className={`num font-semibold tabular-nums ${
                          t.marginMicro < 0 ? "text-red-600" : "text-emerald-700"
                        }`}
                      >
                        {fmtMoney(t.marginMicro)}
                      </td>
                      <td
                        className={`num tabular-nums ${
                          pct == null
                            ? "text-slate-400"
                            : pct < 0
                              ? "text-red-600"
                              : "text-slate-600"
                        }`}
                      >
                        {pct == null ? "—" : fmtPct(pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !error && (
        <div className="card p-6 text-sm text-slate-500">Cargando indicadores…</div>
      )}
    </div>
  );
}
