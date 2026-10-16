import { Link } from "react-router-dom";
import { ArrowRight, Target } from "lucide-react";
import { fmtLongDate, fmtPct } from "../ui";
import type { DashboardData } from "./types";

export function InsightCard({ data }: { data: DashboardData }) {
  const hasSales = data.salesMicro > 0;
  const netPct = hasSales ? (data.netMicro / data.salesMicro) * 100 : null;
  const grossPct = hasSales ? (data.grossMicro / data.salesMicro) * 100 : null;

  const top = data.dayProductSales.length
    ? [...data.dayProductSales].sort((a, b) => b.totalMicro - a.totalMicro)[0]
    : null;
  const topShare = top && data.salesMicro > 0 ? (top.totalMicro / data.salesMicro) * 100 : null;

  let headline: string;
  let detail: React.ReactNode;

  if (!hasSales) {
    headline = "Sin ventas registradas hoy.";
    detail = (
      <>
        Registra tus ventas para ver aquí el margen de utilidad del día y el análisis de tus
        productos.
      </>
    );
  } else if (netPct != null && netPct < 0) {
    headline = "Los costos y gastos superan a tus ventas.";
    detail = (
      <>
        Hoy vas en <strong>{fmtPct(netPct)}</strong> de utilidad sobre los ingresos. Revisa costos y
        gastos para recuperar el margen.
      </>
    );
  } else {
    headline = `Tu negocio muestra un margen de utilidad del ${netPct != null ? fmtPct(netPct) : "—"}.`;
    detail = (
      <>
        Margen bruto {grossPct != null ? fmtPct(grossPct) : "—"} el {fmtLongDate(data.date)}.
        {topShare != null && top && (
          <>
            {" "}
            <strong>{top.name}</strong> aporta el {topShare.toFixed(1)}% de los ingresos de hoy.
          </>
        )}
      </>
    );
  }

  return (
    <section className="card relative overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.07]"
        style={{ background: "var(--ny-brand-accent)" }}
      />
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Target size={16} />
        </span>
        Tu negocio en números
      </h2>

      <p className="text-[13px] leading-relaxed text-slate-600">
        <strong className="text-slate-800">{headline}</strong> {detail}
      </p>

      <div className="mt-4 flex justify-end">
        <Link
          to="/finanzas/rentabilidad"
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800"
        >
          Ver análisis completo <ArrowRight size={15} />
        </Link>
      </div>
    </section>
  );
}
