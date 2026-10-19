import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Boxes, Cookie, PackageCheck, Wheat } from "lucide-react";
import { fmtMoney } from "../ui";
import type { DashboardData, InventoryTypeSummary } from "./types";

function TypeTile({
  icon: Icon,
  iconClass,
  title,
  summary,
  countLabel,
  extra,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  summary: InventoryTypeSummary;
  countLabel: string;
  extra?: string;
}) {
  const issues = summary.outCount + summary.lowCount;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-600">{title}</span>
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800">{summary.activeCount}</div>
        <div className="text-xs text-slate-400">{countLabel}</div>
      </div>
      <div className="text-sm font-semibold tabular-nums text-slate-700">
        {fmtMoney(summary.valueMicro)}
        <div className="text-[11px] font-normal text-slate-400">valor en inventario</div>
      </div>
      {extra && <div className="text-[11px] text-slate-400">{extra}</div>}
      {issues > 0 && (
        <div className="text-[11px] font-semibold text-amber-600">
          {summary.outCount > 0 && `${summary.outCount} agotado(s)`}
          {summary.outCount > 0 && summary.lowCount > 0 && " · "}
          {summary.lowCount > 0 && `${summary.lowCount} bajo(s)`}
        </div>
      )}
    </div>
  );
}

export function InventoryCard({ data }: { data: DashboardData }) {
  const inv = data.inventory;
  return (
    <section className="card flex min-w-0 flex-col p-4 @container">
      <div className="mb-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Boxes size={16} />
          </span>
          Inventario Actual
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Valor PEPS total: <strong className="font-semibold text-slate-600">{fmtMoney(inv.totalValueMicro)}</strong>
        </p>
      </div>

      <div className="grid flex-1 gap-3 grid-cols-3">
        <TypeTile
          icon={Wheat}
          iconClass="bg-emerald-50 text-emerald-600"
          title="Materias primas"
          summary={inv.raw}
          countLabel={inv.raw.activeCount === 1 ? "referencia" : "referencias"}
          extra={`${inv.raw.stockedCount} con existencias`}
        />
        <TypeTile
          icon={Cookie}
          iconClass="bg-sky-50 text-sky-600"
          title="Masas"
          summary={inv.mass}
          countLabel={inv.mass.activeCount === 1 ? "tipo" : "tipos"}
          extra={`${inv.mass.stockedCount} con existencias`}
        />
        <TypeTile
          icon={PackageCheck}
          iconClass="bg-amber-50 text-amber-600"
          title="Productos terminados"
          summary={inv.product}
          countLabel={inv.product.activeCount === 1 ? "producto" : "productos"}
          extra={
            inv.product.stockedCount > 0
              ? `${inv.product.stockedCount} con existencias`
              : "Sin existencias"
          }
        />
      </div>

      <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
        <Link
          to="/inventario/materias-primas"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline"
        >
          Ver inventario completo <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
