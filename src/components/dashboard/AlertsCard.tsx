import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { fmtQty } from "../ui";
import type { DashboardData } from "./types";

type Tone = "critico" | "advertencia" | "info";

export interface AlertItem {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  to: string;
}

const TONE_STYLE: Record<Tone, { wrap: string; icon: ReactNode }> = {
  critico: {
    wrap: "border-red-100 bg-red-50/70",
    icon: <TriangleAlert size={16} className="text-red-500" />,
  },
  advertencia: {
    wrap: "border-amber-100 bg-amber-50/70",
    icon: <CircleAlert size={16} className="text-amber-500" />,
  },
  info: {
    wrap: "border-blue-100 bg-blue-50/70",
    icon: <Info size={16} className="text-blue-500" />,
  },
};

const ITEM_TYPE_PATH: Record<string, string> = {
  raw: "/inventario/materias-primas",
  mass: "/inventario/masas",
  product: "/inventario/productos",
};

/** Ítems de alerta combinados (stock, plan, rendimientos, cierres). */
export function buildAlertItems(data: DashboardData): AlertItem[] {
  const items: AlertItem[] = [];

  for (const a of data.alerts) {
    items.push({
      id: `stock:${a.itemType}:${a.itemId}`,
      tone: a.level === "agotado" ? "critico" : "advertencia",
      title: `${a.level === "agotado" ? "Stock agotado" : "Stock bajo"}: ${a.name}`,
      detail: `Quedan ${fmtQty(a.stockMicro, a.unitId)} (mínimo: ${fmtQty(a.minStockMicro, a.unitId)})`,
      to: ITEM_TYPE_PATH[a.itemType] ?? "/inventario/materias-primas",
    });
  }

  if (data.plan && data.plan.status === "bloqueado" && data.plan.missingMaterials.length > 0) {
    const first = data.plan.missingMaterials[0];
    items.push({
      id: `plan:${data.plan.id}`,
      tone: "critico",
      title: `Plan #${String(data.plan.number).padStart(5, "0")} bloqueado por falta de materiales`,
      detail: `Falta ${fmtQty(first.missingMicro, first.unitId)} de ${first.name}${
        data.plan.missingMaterials.length > 1
          ? ` y ${data.plan.missingMaterials.length - 1} material(es) más`
          : ""
      }`,
      to: "/produccion/planes",
    });
  }

  for (const y of data.lowYields) {
    items.push({
      id: `yield:${y.kind}:${y.number}`,
      tone: "advertencia",
      title: "Producción por debajo de lo esperado",
      detail: `${y.title}: ${fmtQty(y.actualMicro, y.unitId)} de ${fmtQty(y.expectedMicro, y.unitId)} (${y.gapPct.toFixed(1)}%)`,
      to: y.kind === "terminacion" ? "/operaciones/transformacion" : "/produccion/rendimientos",
    });
  }

  if (data.pendingClosings.length > 0) {
    items.push({
      id: "closings:pending",
      tone: "info",
      title: `${data.pendingClosings.length} día(s) sin cierre diario`,
      detail: `Pendientes: ${data.pendingClosings.slice(0, 4).join(", ")}${
        data.pendingClosings.length > 4 ? "…" : ""
      }`,
      to: "/operaciones/cierre",
    });
  }

  if (data.closingDiffCount > 0) {
    items.push({
      id: "closings:diff",
      tone: "info",
      title: `${data.closingDiffCount} diferencia(s) de inventario en cierres`,
      detail: "Revisa las diferencias registradas al cerrar días.",
      to: "/operaciones/cierre",
    });
  }

  const order: Record<Tone, number> = { critico: 0, advertencia: 1, info: 2 };
  return items.sort((a, b) => order[a.tone] - order[b.tone]);
}

export function AlertsCard({ data }: { data: DashboardData }) {
  const items = buildAlertItems(data);

  return (
    <section className="card flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Bell size={16} />
          </span>
          Alertas y Notificaciones
        </h2>
        <span
          className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${
            items.length > 0 ? "bg-red-500 text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Todo en orden: sin alertas de stock, producción ni cierres.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 6).map((a) => (
            <li key={a.id} className={`rounded-lg border px-3 py-2.5 ${TONE_STYLE[a.tone].wrap}`}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0" aria-hidden>
                  {TONE_STYLE[a.tone].icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-slate-800">{a.title}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{a.detail}</div>
                </div>
                <Link
                  to={a.to}
                  className="shrink-0 self-center rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
                  title="Ir al detalle"
                >
                  →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length > 6 && (
        <div className="mt-2 text-center text-xs text-slate-400">
          +{items.length - 6} alerta(s) más en sus secciones.
        </div>
      )}
    </section>
  );
}
