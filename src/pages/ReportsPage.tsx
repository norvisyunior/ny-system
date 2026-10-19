import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Callout, ErrorAlert, FlowGuide, fmtMoney, fmtQty, todayISO } from "../components/ui";

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

const REPORT_LABELS: Record<string, string> = {
  inventario: "Inventario valorizado",
  productos: "Productos terminados",
  compras: "Compras",
  produccion: "Producción",
  ventas: "Ventas",
  rentabilidad: "Rentabilidad por día",
  auditoria: "Auditoría",
};

/** Reportes de estado actual: no usan rango de fechas. */
const NO_RANGE_REPORTS = new Set(["inventario"]);

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function ReportsPage() {
  const [name, setName] = useState("inventario");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayISO());
  const [report, setReport] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (reportName: string, f: string, t: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = NO_RANGE_REPORTS.has(reportName) ? "" : `?from=${f}&to=${t}`;
        setReport(await api.get<ReportResult>(`/reports/${reportName}${qs}`));
      } catch (e) {
        setReport(null);
        setError((e as ApiError).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(name, from, to);
  }, [name, from, to, load]);

  const csvHref = () =>
    NO_RANGE_REPORTS.has(name)
      ? `/api/reports/${name}/csv`
      : `/api/reports/${name}/csv?from=${from}&to=${to}`;

  const cell = (col: ReportColumn, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (col.fmt === "money") return fmtMoney(Number(value));
    if (col.fmt === "qty") return fmtQty(Number(value));
    return String(value);
  };

  return (
    <div className="print-page">
      <PageHeader
        title="Reportes"
        subtitle="Inventario, productos terminados, compras, producción, ventas, rentabilidad y auditoría · PDF con Imprimir"
        actions={
          <div className="flex gap-2">
            <a className="btn btn-secondary" href={csvHref()} download>
              Descargar CSV
            </a>
            <button className="btn btn-secondary" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
          </div>
        }
      />
      <FlowGuide current="reportes" />
      <Callout tone="info" title="Cómo funcionan los reportes">
        Se calculan al vuelo desde los movimientos confirmados: por eso reflejan el estado actual
        del negocio. Elige el rango de fechas, descarga el CSV (UTF-8, compatible con Excel) o
        usa Imprimir / PDF. El reporte de inventario valoriza con costo PEPS.
      </Callout>
      <ErrorAlert message={error} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="field">
          <label>Reporte</label>
          <select value={name} onChange={(e) => setName(e.target.value)}>
            {Object.entries(REPORT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {!NO_RANGE_REPORTS.has(name) && (
          <>
            <div className="field">
              <label>Desde</label>
              <input type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>Hasta</label>
              <input type="date" max={todayISO()} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        <button className="btn btn-secondary" onClick={() => load(name, from, to)}>
          {loading ? "Calculando…" : "Actualizar"}
        </button>
        {report && (
          <span className="text-sm text-slate-500">
            {report.rows.length} fila(s)
            {report.from ? ` · ${report.from} → ${report.to}` : ""}
          </span>
        )}
      </div>

      {report && (
        <div className="card overflow-hidden print-area">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
            {report.title}
          </div>
          <div className="max-h-[65vh] overflow-auto">
            <table className="table-ny">
              <thead>
                <tr>
                  {report.columns.map((c) => (
                    <th key={c.key} className={c.align === "num" ? "num" : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.length === 0 && (
                  <tr>
                    <td colSpan={report.columns.length} className="py-8 text-center text-slate-400">
                      Sin datos en el período.
                    </td>
                  </tr>
                )}
                {report.rows.map((row, idx) => (
                  <tr key={idx}>
                    {report.columns.map((c) => (
                      <td
                        key={c.key}
                        className={
                          (c.align === "num" ? "num " : "") +
                          (c.fmt === "money" || c.fmt === "qty" ? "font-mono" : "")
                        }
                      >
                        {cell(c, row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!report && !error && <div className="card p-6 text-sm text-slate-500">Cargando reporte…</div>}
    </div>
  );
}
