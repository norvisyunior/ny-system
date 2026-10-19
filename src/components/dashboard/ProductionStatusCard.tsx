import { Link } from "react-router-dom";
import { ArrowRight, ClipboardList, Factory, Layers, Package } from "lucide-react";
import { fmtQty } from "../ui";
import type { DashboardData } from "./types";

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Layers;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-xl border p-3 ${
        accent ? "border-emerald-100 bg-emerald-50/50" : "border-slate-100 bg-slate-50/60"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={13} className={accent ? "text-emerald-600" : "text-slate-400"} aria-hidden />
        <span className="truncate text-[11px] font-medium text-slate-500">{label}</span>
      </div>
      <span
        className={`truncate text-xl font-bold tabular-nums ${
          accent ? "text-emerald-700" : "text-slate-800"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function ProductionStatusCard({ data }: { data: DashboardData }) {
  const plan = data.plan;
  const isTotals = data.mode === "totals";
  const pt = data.productionTotals;
  const packagesToday = isTotals
    ? (pt?.packagesMicro ?? 0)
    : data.dayOutputs.reduce((acc, r) => acc + r.qtyMicro, 0);
  const massesToday = isTotals
    ? (pt?.massesMicro ?? 0)
    : data.dayProductions.reduce((acc, r) => acc + r.realYieldMicro, 0);
  const elaborationsCount = isTotals
    ? (pt?.elaborationsCount ?? 0)
    : data.dayProductions.length;
  const outputsCount = isTotals ? (pt?.outputsCount ?? 0) : data.dayOutputs.length;
  const hasDayProduction =
    isTotals || data.dayProductions.length > 0 || data.dayOutputs.length > 0;

  return (
    <section className="card flex min-w-0 flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <Factory size={16} />
          </span>
          {isTotals ? "Producción total" : "Producción de hoy"}
        </h2>
      </div>

      {!hasDayProduction ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
          <p className="text-sm text-slate-500">Sin producciones registradas hoy.</p>
          <Link
            to="/produccion/planes"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800"
          >
            Planificar producción <ArrowRight size={15} />
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              icon={Layers}
              label="Masas elaboradas"
              value={fmtQty(massesToday, null, 0)}
              accent
            />
            <StatTile
              icon={Package}
              label="Paquetes producidos"
              value={fmtQty(packagesToday, null, 0)}
              accent
            />
            <StatTile
              icon={ClipboardList}
              label="Elaboraciones"
              value={String(elaborationsCount)}
            />
            <StatTile
              icon={ClipboardList}
              label="Terminaciones"
              value={String(outputsCount)}
            />
          </div>

          {plan?.status === "bloqueado" && plan.missingMaterials.length > 0 && (
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
