import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, ErrorAlert, Kpi, fmtMoney, fmtQty, todayISO } from "../components/ui";

interface ReportResult {
  name: string;
  title: string;
  from: string | null;
  to: string | null;
  rows: Record<string, unknown>[];
}

interface DayRow {
  fecha: string;
  ventas: number;
  cogs: number;
  bruto: number;
  gastos: number;
  neto: number;
  cerrado: string;
}

interface ProductRow {
  producto: string;
  categoria: string;
  unidad: string;
  cantidad: number;
  ventas: number;
  costo: number;
  margen: number;
  margenPct: number;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}

/** P&L del período: Ventas − Costo de ventas = Bruto − Gastos = Utilidad neta. */
export function ProfitabilityPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayISO());
  const [days, setDays] = useState<DayRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const [rr, rp] = await Promise.all([
        api.get<ReportResult>(`/reports/rentabilidad?from=${f}&to=${t}`),
        api.get<ReportResult>(`/reports/rentabilidad-productos?from=${f}&to=${t}`),
      ]);
      setDays(rr.rows as unknown as DayRow[]);
      setProducts(rp.rows as unknown as ProductRow[]);
    } catch (e) {
      setDays([]);
      setProducts([]);
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(from, to);
  }, [from, to, load]);

  const ventas = days.reduce((a, r) => a + r.ventas, 0);
  const cogs = days.reduce((a, r) => a + r.cogs, 0);
  const bruto = ventas - cogs;
  const gastos = days.reduce((a, r) => a + r.gastos, 0);
  const neto = bruto - gastos;
  const cerrados = days.filter((r) => r.cerrado === "Sí").length;
  const pendientes = days.filter((r) => r.cerrado === "No").length;

  const maxVentas = Math.max(1, ...days.map((r) => r.ventas));

  const maxAbsNeto = Math.max(1, ...days.map((r) => Math.abs(r.neto)));

  return (
    <div className="print-page">
      <PageHeader
        title="Rentabilidad"
        subtitle="Resultado del período: ventas − costo de ventas − gastos"
        actions={
          <div className="flex gap-2">
            <a className="btn btn-secondary" href={`/api/reports/rentabilidad/csv?from=${from}&to=${to}`} download>
              CSV diario
            </a>
            <a
              className="btn btn-secondary"
              href={`/api/reports/rentabilidad-productos/csv?from=${from}&to=${to}`}
              download
            >
              CSV productos
            </a>
            <button className="btn btn-secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
          </div>
        }
      />
      <ErrorAlert message={error} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="field">
          <label>Desde</label>
          <input type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input type="date" max={todayISO()} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={() => load(from, to)}>
          {loading ? "Calculando…" : "Actualizar"}
        </button>
        <span className="text-sm text-slate-500">
          {cerrados} día(s) cerrado(s) · {pendientes} abierto(s)
        </span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 print-area">
        <Kpi label="Ingresos por ventas" value={fmtMoney(ventas)} big />
        <Kpi label="Costo de ventas" value={fmtMoney(cogs)} muted sub={`Margen bruto ${pct(bruto, ventas)}`} />
        <Kpi label="Utilidad bruta" value={fmtMoney(bruto)} tone={bruto < 0 ? "red" : "green"} sub={pct(bruto, ventas)} />
        <Kpi label="Utilidad neta" value={fmtMoney(neto)} tone={neto < 0 ? "red" : "green"} big sub={`s/ ingresos: ${pct(neto, ventas)}`} />
      </div>

      <div className="mb-5 card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">Evolución diaria del período</h3>
          <span className="text-xs text-slate-400">
            <span className="mr-2 inline-block h-2 w-2 rounded-sm bg-slate-400" /> ingresos
            <span className="ml-3 mr-2 inline-block h-2 w-2 rounded-sm bg-emerald-500" /> neto positivo
            <span className="ml-3 mr-2 inline-block h-2 w-2 rounded-sm bg-red-400" /> neto negativo
          </span>
        </div>
        {days.length === 0 && <p className="text-sm text-slate-400">Sin movimiento en el período.</p>}
        {days.length > 0 && (
          <div className="flex h-44 items-end gap-1.5">
            {days.map((r) => {
              const hSales = Math.round((r.ventas / maxVentas) * 100);
              const hNet = Math.round((Math.abs(r.neto) / maxAbsNeto) * 100);
              return (
                <div key={r.fecha} className="flex flex-1 flex-col items-center gap-0.5" title={`${r.fecha}: ventas ${fmtMoney(r.ventas)}, neto ${fmtMoney(r.neto)}`}>
                  <div className="flex h-40 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/2 rounded-t bg-slate-400"
                      style={{ height: `${Math.max(hSales, r.ventas ? 3 : 0)}%` }}
                    />
                    <div
                      className={`w-1/2 rounded-t ${r.neto < 0 ? "bg-red-400" : "bg-emerald-500"}`}
                      style={{ height: `${Math.max(hNet, r.neto ? 3 : 0)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-slate-400">{r.fecha.slice(8)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-5 card overflow-hidden print-area">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          Resultado por día
        </div>
        <div className="max-h-[50vh] overflow-auto">
          <table className="table-ny">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="num">Ventas</th>
                <th className="num">Costo de ventas</th>
                <th className="num">Bruto</th>
                <th className="num">Gastos</th>
                <th className="num">Neto</th>
                <th className="center">Cerrado</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Sin datos en el período.
                  </td>
                </tr>
              )}
              {days.map((r) => (
                <tr key={r.fecha}>
                  <td>{r.fecha}</td>
                  <td className="num font-mono">{fmtMoney(r.ventas)}</td>
                  <td className="num font-mono text-slate-500">{fmtMoney(r.cogs)}</td>
                  <td className={`num font-mono ${r.bruto < 0 ? "text-red-600" : "text-slate-700"}`}>
                    {fmtMoney(r.bruto)}
                  </td>
                  <td className="num font-mono text-slate-500">{fmtMoney(r.gastos)}</td>
                  <td className={`num font-semibold font-mono ${r.neto < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {fmtMoney(r.neto)}
                  </td>
                  <td className="center">
                    {r.cerrado === "Sí" ? (
                      <Badge tone="green">Cerrado</Badge>
                    ) : r.cerrado === "Reabierto" ? (
                      <Badge tone="amber">Reabierto</Badge>
                    ) : (
                      <Badge tone="slate">Abierto</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {days.length > 0 && (
                <tr className="bg-slate-50 font-bold">
                  <td>Total período</td>
                  <td className="num font-mono">{fmtMoney(ventas)}</td>
                  <td className="num font-mono">{fmtMoney(cogs)}</td>
                  <td className={`num font-mono ${bruto < 0 ? "text-red-600" : ""}`}>{fmtMoney(bruto)}</td>
                  <td className="num font-mono">{fmtMoney(gastos)}</td>
                  <td className={`num font-mono ${neto < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {fmtMoney(neto)}
                  </td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden print-area">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          Rentabilidad por producto
        </div>
        <table className="table-ny">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th className="num">Vendido</th>
              <th className="num">Ingresos</th>
              <th className="num">Costo</th>
              <th className="num">Margen</th>
              <th className="num">Margen %</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  Sin ventas confirmadas en el período.
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.producto}>
                <td className="font-semibold">{p.producto}</td>
                <td>{p.categoria}</td>
                <td className="num">{fmtQty(p.cantidad, p.unidad)}</td>
                <td className="num font-mono">{fmtMoney(p.ventas)}</td>
                <td className="num font-mono text-slate-500">{fmtMoney(p.costo)}</td>
                <td className={`num font-semibold font-mono ${p.margen < 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {fmtMoney(p.margen)}
                </td>
                <td className={`num font-semibold ${p.margenPct < 0 ? "text-red-600" : "text-slate-700"}`}>
                  {p.margenPct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
