import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { CalendarDays, LayoutGrid } from "lucide-react";
import { formatCUP, microToDecimalTrim } from "@shared/money";

export function fmtMoney(micro: number): string {
  return formatCUP(micro);
}

export function fmtQty(micro: number, unit?: string | null, decimals = 3): string {
  const n = microToDecimalTrim(micro, decimals);
  return unit ? `${n} ${unit}` : n;
}

export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "2026-10-13" → "13 de octubre de 2026" */
export function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

export function fmtDocNumber(n: number): string {
  return String(n).padStart(5, "0");
}

/** Token de idempotencia por sesión de formulario (doble clic / reenvío). */
export function newClientToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function stockLevel(stockMicro: number, minStockMicro: number): "ok" | "low" | "out" {
  if (stockMicro <= 0) return "out";
  if (minStockMicro > 0 && stockMicro <= minStockMicro) return "low";
  return "ok";
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`card my-8 w-full ${wide ? "max-w-4xl" : "max-w-lg"} shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          <button
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            title="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Tarjeta de indicador (KPI) con valor grande y estado opcional. */
export function Kpi({
  label,
  value,
  sub,
  muted,
  tone,
  big,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
  tone?: "green" | "red";
  big?: boolean;
}) {
  const color =
    tone === "red"
      ? "text-red-600"
      : tone === "green"
        ? "text-emerald-700"
        : muted
          ? "text-slate-500"
          : "text-slate-900";
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`${big ? "text-2xl" : "text-xl"} font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

/** Porcentaje con 1 decimal (ej. 23.5%). */
export function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

export function Badge({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "green" | "red" | "amber" | "blue";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Barra de "día visible": indica qué día se está mostrando y permite cambiarlo.
 * Todas las operaciones de una sección se listan por la fecha elegida.
 */
export function DayFilter({
  date,
  onChange,
  className = "",
}: {
  date: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const today = todayISO();
  const isToday = date === today;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Día visible
        </span>
        <span className="text-sm font-semibold text-slate-800">{fmtLongDate(date)}</span>
        {isToday ? (
          <Badge tone="blue">Hoy</Badge>
        ) : (
          <button
            type="button"
            className="text-xs font-semibold text-blue-700 hover:underline"
            onClick={() => onChange(today)}
          >
            Ir a hoy
          </button>
        )}
      </div>
      <input
        type="date"
        max={today}
        value={date}
        aria-label="Cambiar el día visible"
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}

export type DayScope = "day" | "all";

/**
 * Conmutador Día | Todos (mismo estilo del dashboard).
 * "day" = solo el día elegido en DayFilter; "all" = todos los registros sin filtro de fecha.
 */
export function ScopeToggle({
  scope,
  onChange,
}: {
  scope: DayScope;
  onChange: (v: DayScope) => void;
}) {
  const cls = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
      active ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
    }`;
  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      <button
        type="button"
        onClick={() => onChange("day")}
        className={cls(scope === "day")}
        title="Ver solo los datos del día seleccionado"
      >
        <CalendarDays size={13} aria-hidden />
        Día
      </button>
      <button
        type="button"
        onClick={() => onChange("all")}
        className={cls(scope === "all")}
        title="Ver todos los datos registrados"
      >
        <LayoutGrid size={13} aria-hidden />
        Todos
      </button>
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

type CalloutTone = "info" | "tip" | "warn" | "neutral";

const CALLOUT_TONES: Record<CalloutTone, string> = {
  info: "border-blue-100 border-l-blue-500 bg-blue-50 text-blue-950",
  tip: "border-emerald-100 border-l-emerald-500 bg-emerald-50 text-emerald-950",
  warn: "border-amber-100 border-l-amber-500 bg-amber-50 text-amber-950",
  neutral: "border-slate-200 border-l-slate-400 bg-slate-50 text-slate-700",
};

/** Nota explicativa destacada para guiar al usuario dentro de una pantalla. */
export function Callout({
  tone = "info",
  title,
  children,
  className = "",
}: {
  tone?: CalloutTone;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-4 rounded-r-md border border-l-4 px-4 py-3 text-sm leading-relaxed ${CALLOUT_TONES[tone]} ${className}`}
    >
      {title && <div className="mb-1 text-[13px] font-bold">{title}</div>}
      <div>{children}</div>
    </div>
  );
}

export type FlowStepId =
  | "catalogos"
  | "compras"
  | "recetas"
  | "planes"
  | "elaboracion"
  | "terminacion"
  | "ventas"
  | "cierre"
  | "reportes";

const FLOW_STEPS: { id: FlowStepId; label: string; to: string }[] = [
  { id: "catalogos", label: "Catálogos", to: "/inventario/materias-primas" },
  { id: "compras", label: "Compras", to: "/operaciones/compras" },
  { id: "recetas", label: "Recetas", to: "/produccion/recetas" },
  { id: "planes", label: "Planes", to: "/produccion/planes" },
  { id: "elaboracion", label: "Elaboración", to: "/produccion/producciones" },
  { id: "terminacion", label: "Terminación", to: "/operaciones/transformacion" },
  { id: "ventas", label: "Ventas", to: "/operaciones/ventas" },
  { id: "cierre", label: "Cierre", to: "/operaciones/cierre" },
  { id: "reportes", label: "Reportes", to: "/reportes" },
];

/** Tira numerada con el orden del proceso del negocio; cada etapa es un enlace
 *  a su sección y resalta la etapa actual. */
export function FlowGuide({
  current,
  className = "",
}: {
  current?: FlowStepId;
  className?: string;
}) {
  return (
    <nav
      aria-label="Flujo del negocio"
      className={`mb-4 rounded-md border border-slate-200 bg-white px-4 py-3 ${className}`}
    >
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Flujo del negocio
      </div>
      <ol className="flex flex-wrap items-center gap-y-2">
        {FLOW_STEPS.map((step, i) => {
          const active = step.id === current;
          return (
            <li key={step.id} className="flex items-center">
              <NavLink
                to={step.to}
                title={`Ir a ${step.label}`}
                className={`group flex items-center rounded-md px-1.5 py-1 transition-colors ${
                  active ? "" : "hover:bg-slate-100"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                    active
                      ? "bg-blue-600 text-white"
                      : "bg-slate-200 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-700"
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  className={`ml-1.5 text-xs ${
                    active
                      ? "font-semibold text-blue-700"
                      : "text-slate-500 group-hover:text-blue-700"
                  }`}
                >
                  {step.label}
                </span>
              </NavLink>
              {i < FLOW_STEPS.length - 1 && (
                <span className="px-1.5 text-xs text-slate-300">→</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
