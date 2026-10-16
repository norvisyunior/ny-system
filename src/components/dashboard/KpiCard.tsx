import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export type KpiTone = "sales" | "costs" | "gross" | "expenses" | "net";

const TONES: Record<KpiTone, { iconBg: string; iconColor: string; valueColor: string }> = {
  sales: { iconBg: "#ecfdf5", iconColor: "#059669", valueColor: "#047857" },
  costs: { iconBg: "#eff6ff", iconColor: "#2563EB", valueColor: "#1d4ed8" },
  gross: { iconBg: "#f5f3ff", iconColor: "#7C3AED", valueColor: "#6d28d9" },
  expenses: { iconBg: "#fff7ed", iconColor: "#EA580C", valueColor: "#c2410c" },
  net: { iconBg: "#ecfdf5", iconColor: "#0f766e", valueColor: "#065f46" },
};

export interface KpiDelta {
  pct: number;
  /** true si el movimiento es favorable para el negocio. */
  good: boolean;
  /** Valor del mismo indicador ayer, solo para etiqueta alternativa. */
  label: string;
}

export function KpiCard({
  label,
  value,
  sub,
  delta,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: KpiDelta | null;
  icon: LucideIcon;
  tone: KpiTone;
}) {
  const t = TONES[tone];
  return (
    <div className="card flex min-w-0 flex-col gap-2 p-4">
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: t.iconBg, color: t.iconColor }}
          aria-hidden
        >
          <Icon size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-600">{label}</div>
          <div className="truncate text-xl font-bold tabular-nums 2xl:text-2xl" style={{ color: t.valueColor }}>
            {value}
          </div>
        </div>
      </div>
      <div className="flex min-h-[2.4rem] flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-slate-100 pt-2">
        <span className="text-xs text-slate-400">{sub}</span>
        {delta && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
              delta.good ? "text-emerald-600" : "text-red-500"
            }`}
            title={`Comparado con ${delta.label}`}
          >
            {delta.pct >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {`${Math.abs(delta.pct).toFixed(1)}%`}
            <span className="font-normal text-slate-400">{delta.label}</span>
          </span>
        )}
      </div>
    </div>
  );
}
