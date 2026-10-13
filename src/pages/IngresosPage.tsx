import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, ErrorAlert, Kpi, fmtMoney, todayISO } from "../components/ui";

interface ReportColumn {
  key: string;
  label: string;
  fmt?: "money" | "qty" | "none";
  align?: "num";
}

interface ReportResult {
  name: string;
  title: string;
  from: string | null;
  to: string | null;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  generatedAt: string;
}

interface SaleRow {
  id: number;
  numero: number;
  fecha: string;
  metodo: string;
  productos: string;
  subtotal: number;
  descuento: number;
  total: number;
  costo: number;
  margen: number;
  estado: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  otro: "Otro",
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Ingresos del negocio: ventas cobradas por período, método de pago y tendencia diaria. */
export function IngresosPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const report = await api.get<ReportResult>(`/reports/ventas?from=${f}&to=${t}`);
      setRows(report.rows as unknown as SaleRow[]);
    } catch (e) {
      setRows([]);
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(from, to);
  }, [from, to, load]);

  const conf = rows.filter((r) => r.estado === "confirmada");
  const totalCobrado = conf.reduce((a, r) => a + r.total, 0);
  const totalDescuentos = conf.reduce((a, r) => a + r.descuento, 0);
  const totalSubtotal = conf.reduce((a, r) => a + r.subtotal, 0);
  const ticket = conf.length > 0 ? Math.trunc(totalCobrado / conf.length) : 0;

  const byPayment = new Map<string, { total: number; count: number }>();
  for (const r of conf) {
    const cur = byPayment.get(r.metodo) ?? { total: 0, count: 0 };
    byPayment.set(r.metodo, { total: cur.total + r.total, count: cur.count + 1 });
  }
  const payments = [...byPayment.entries()].sort((a, b) => b[1].total - a[1].total);

  const byDay = new Map<string, number>();
  for (const r of conf) byDay.set(r.fecha, (byDay.get(r.fecha) ?? 0) + r.total);
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const maxDay = Math.max(1, ...days.map(([, v]) => v));

  return (
    <div>
      <PageHeader
        title="Ingresos"
        subtitle="Ventas cobradas por período · se registran en Operaciones → Ventas"
        actions={
          <a className="btn btn-secondary" href={`/api/reports/ventas/csv?from=${from}&to=${to}`} download>
            Descargar CSV
          </a>
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
          {conf.length} venta(s) confirmada(s)
          {rows.length > conf.length ? ` · ${rows.length - conf.length} anulada(s)` : ""}
        </span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Ingresos totales" value={fmtMoney(totalCobrado)} big />
        <Kpi label="Subtotal bruto" value={fmtMoney(totalSubtotal)} muted />
        <Kpi label="Descuentos" value={fmtMoney(totalDescuentos)} muted />
        <Kpi label="Ticket promedio" value={fmtMoney(ticket)} sub={`${conf.length} venta(s)`} />
        <Kpi
          label="Mejor método"
          value={payments[0] ? (PAYMENT_LABELS[payments[0][0]] ?? payments[0][0]) : "—"}
          sub={payments[0] ? fmtMoney(payments[0][1].total) : "Sin ventas"}
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-bold text-slate-700">Ingresos por día</h3>
          {days.length === 0 && <p className="text-sm text-slate-400">Sin ventas en el período.</p>}
          {days.length > 0 && (
            <div className="flex h-40 items-end gap-1.5">
              {days.map(([date, total]) => {
                const h = Math.round((total / maxDay) * 100);
                return (
                  <div key={date} className="flex flex-1 flex-col items-center gap-0.5" title={`${date}: ${fmtMoney(total)}`}>
                    <div
                      className="w-full rounded-t bg-blue-500"
                      style={{ height: `${Math.max(h, 3)}%` }}
                    />
                    <span className="text-[9px] text-slate-400">{date.slice(8)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-700">Por método de pago</h3>
          {payments.length === 0 && <p className="text-sm text-slate-400">Sin ventas en el período.</p>}
          <ul className="space-y-2 text-sm">
            {payments.map(([method, v]) => (
              <li key={method} className="flex justify-between">
                <span>
                  {PAYMENT_LABELS[method] ?? method} <span className="text-slate-400">({v.count})</span>
                </span>
                <span className="font-semibold">{fmtMoney(v.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          Ventas del período
        </div>
        <div className="max-h-[55vh] overflow-auto">
          <table className="table-ny">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Fecha</th>
                <th>Método</th>
                <th>Productos</th>
                <th className="num">Subtotal</th>
                <th className="num">Descuento</th>
                <th className="num">Total</th>
                <th className="center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    Sin ventas en el período.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className={r.estado === "anulada" ? "opacity-60" : undefined}>
                  <td>{String(r.numero).padStart(5, "0")}</td>
                  <td>{r.fecha}</td>
                  <td>{PAYMENT_LABELS[r.metodo] ?? r.metodo}</td>
                  <td className="max-w-xs truncate">{r.productos}</td>
                  <td className="num font-mono">{fmtMoney(r.subtotal)}</td>
                  <td className="num font-mono">{fmtMoney(r.descuento)}</td>
                  <td className="num font-semibold font-mono">{fmtMoney(r.total)}</td>
                  <td className="center">
                    {r.estado === "confirmada" ? (
                      <Badge tone="green">Confirmada</Badge>
                    ) : (
                      <Badge tone="red">Anulada</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
