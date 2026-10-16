import type { LucideIcon } from "lucide-react";
import { ChartColumn, CircleDollarSign, Factory, Percent, Wallet } from "lucide-react";
import { fmtMoney, fmtPct } from "../ui";
import type { DashboardData } from "./types";

function Row({
  icon: Icon,
  iconClass,
  label,
  value,
  valueClass = "text-slate-800",
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-600">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

export function FinancialSummaryCard({ data }: { data: DashboardData }) {
  const netPct = data.salesMicro > 0 ? (data.netMicro / data.salesMicro) * 100 : null;

  return (
    <section className="card overflow-hidden">
      <div className="px-4 pb-1 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <CircleDollarSign size={16} />
          </span>
          Resumen Financiero{" "}
          <span className="font-normal text-slate-400">(hoy)</span>
        </h2>
      </div>

      <div className="divide-y divide-slate-100 px-4">
        <Row
          icon={Wallet}
          iconClass="bg-emerald-50 text-emerald-600"
          label="Ingresos"
          value={fmtMoney(data.salesMicro)}
          valueClass="text-emerald-700"
        />
        <Row
          icon={Factory}
          iconClass="bg-blue-50 text-blue-600"
          label="Costos de producción"
          value={fmtMoney(data.cogsMicro)}
          valueClass="text-blue-700"
        />
        <Row
          icon={Percent}
          iconClass="bg-orange-50 text-orange-600"
          label="Gastos operativos"
          value={fmtMoney(data.expensesMicro)}
          valueClass="text-orange-600"
        />
      </div>

      <div className="m-3 mt-2 rounded-xl bg-emerald-50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <ChartColumn size={14} />
            </span>
            Utilidad neta
          </span>
          <span
            className={`text-lg font-bold tabular-nums ${
              data.netMicro < 0 ? "text-red-600" : "text-emerald-800"
            }`}
          >
            {fmtMoney(data.netMicro)}
          </span>
        </div>
        <div className="mt-1 text-right text-xs text-emerald-700">
          {netPct == null ? "Sin ventas este día" : `Margen ${fmtPct(netPct)}`}
        </div>
      </div>
    </section>
  );
}
