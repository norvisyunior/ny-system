import { Link } from "react-router-dom";
import { ArrowRight, Factory } from "lucide-react";
import { fmtQty } from "../ui";
import type { DashboardData, ProductionPlanState } from "./types";

const STATE_META: Record<ProductionPlanState, { label: string; className: string; color: string }> = {
  pendiente: { label: "Pendiente", className: "bg-slate-100 text-slate-600", color: "#64748b" },
  en_proceso: { label: "En proceso", className: "bg-emerald-50 text-emerald-700", color: "#059669" },
  completado: { label: "Completado", className: "bg-emerald-600 text-white", color: "#047857" },
  con_desviaciones: { label: "Con desviaciones", className: "bg-amber-50 text-amber-700", color: "#EAB308" },
  bloqueado: { label: "Bloqueado", className: "bg-red-50 text-red-700", color: "#dc2626" },
};

function ProgressRing({ pct, color }: { pct: number; color: string }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <div className="relative h-28 w-28 shrink-0 @md:h-36 @md:w-36">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="64" cy="64" r={r} fill="none" stroke="#e2e8f0" strokeWidth="11" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums text-slate-800">{pct}%</span>
        <span className="text-[11px] text-slate-400">Avance</span>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] text-slate-500">{label}</span>
      <span className="text-sm font-bold tabular-nums text-slate-800">{value}</span>
    </div>
  );
}

export function ProductionStatusCard({ data }: { data: DashboardData }) {
  const plan = data.plan;

  return (
    <section className="card flex min-w-0 flex-col p-4 @container">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <Factory size={16} />
          </span>
          Estado de la Producción
        </h2>
        {plan && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATE_META[plan.status].className}`}>
            {STATE_META[plan.status].label}
          </span>
        )}
      </div>

      {!plan ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
          <p className="text-sm text-slate-500">No hay planes de producción registrados.</p>
          <Link
            to="/produccion/planes"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800"
          >
            Planificar producción <ArrowRight size={15} />
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-4 @md:flex-row">
            <ProgressRing pct={Math.round(plan.progressPct)} color={STATE_META[plan.status].color} />
            <div className="w-full min-w-0 flex-1 divide-y divide-slate-100">
              <StatRow label="Paquetes objetivo" value={fmtQty(plan.targetPackagesMicro, null, 0)} />
              <StatRow label="Paquetes producidos" value={fmtQty(plan.producedPackagesMicro, null, 0)} />
              <StatRow label="Paquetes restantes" value={fmtQty(plan.pendingPackagesMicro, null, 0)} />
              <StatRow
                label="Masas elaboradas"
                value={`${fmtQty(plan.elaboratedMassesMicro, null, 0)} / ${fmtQty(plan.plannedMassesMicro, null, 0)}`}
              />
            </div>
          </div>

          <div className="mt-2 text-xs text-slate-400">
            Plan #${String(plan.number).padStart(5, "0")} · {plan.recipeName} ·{" "}
            {fmtQty(plan.plannedMassesMicro, null, 0)} masas de {plan.massName}
          </div>

          {plan.status === "bloqueado" && plan.missingMaterials.length > 0 && (
            <ul className="mt-2 space-y-1 rounded-lg border border-red-100 bg-red-50/70 px-3 py-2 text-xs text-red-700">
              {plan.missingMaterials.slice(0, 3).map((m) => (
                <li key={m.name}>
                  Falta {fmtQty(m.missingMicro, m.unitId)} de {m.name} (disponible:{" "}
                  {fmtQty(m.availableMicro, m.unitId)})
                </li>
              ))}
            </ul>
          )}

          <div className="mt-auto flex justify-end pt-3">
            <Link
              to="/produccion/planes"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-emerald-300 hover:text-emerald-700"
            >
              Ver detalle de producción <ArrowRight size={14} />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
