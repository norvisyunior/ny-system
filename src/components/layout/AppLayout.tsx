import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CalendarDays, Clock, LayoutGrid } from "lucide-react";
import { api } from "../../api/client";
import { SelectedDateProvider, useSelectedDate } from "../../app/SelectedDateContext";
import { fmtLongDate, todayISO } from "../ui";
import { Sidebar } from "./Sidebar";

interface AppSettings {
  businessName: string;
  demoMode: boolean;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "¡Buenos días!";
  if (h < 19) return "¡Buenas tardes!";
  return "¡Buenas noches!";
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function Header({ settings }: { settings: AppSettings | null }) {
  const location = useLocation();
  const isDashboard = location.pathname === "/dashboard";
  const { date, setDate, viewMode, setViewMode } = useSelectedDate();
  const now = useNow();
  const today = todayISO();

  const time = now.toLocaleTimeString("es-ES", { hour: "numeric", minute: "2-digit", hour12: true });
  const subtitleDate = isDashboard ? date : today;
  const subtitle =
    isDashboard && viewMode === "totals"
      ? "Resumen histórico de todo el negocio."
      : `Aquí tienes un resumen del estado de tu negocio hoy, ${fmtLongDate(subtitleDate)}.`;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3.5">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-900">{greeting()}</h1>
        <p className="truncate text-sm text-slate-500">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {settings?.demoMode && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
            Modo demo — datos de ejemplo
          </span>
        )}

        {isDashboard && (
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode("day")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === "day"
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title="Ver datos del día seleccionado"
            >
              <CalendarDays size={13} aria-hidden />
              Día
            </button>
            <button
              type="button"
              onClick={() => setViewMode("totals")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === "totals"
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title="Ver acumulado histórico del negocio"
            >
              <LayoutGrid size={13} aria-hidden />
              Totales
            </button>
          </div>
        )}

        {isDashboard && viewMode === "day" && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
            <CalendarDays size={15} className="text-slate-400" aria-hidden />
            <input
              type="date"
              max={today}
              value={date}
              aria-label="Fecha global del dashboard"
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
              className="date-highlight cursor-pointer border-none bg-transparent text-sm font-semibold text-slate-700 focus:outline-none"
            />
            {date === today ? (
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                Hoy
              </span>
            ) : (
              <button
                type="button"
                className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
                onClick={() => setDate(today)}
              >
                Ir a hoy
              </button>
            )}
          </div>
        )}

        <div className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm sm:flex">
          <Clock size={15} className="text-slate-400" aria-hidden />
          {time}
        </div>
      </div>
    </header>
  );
}

function Shell() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    api.get<AppSettings>("/settings").then(setSettings).catch(() => undefined);
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header settings={settings} />
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AppLayout() {
  return (
    <SelectedDateProvider>
      <Shell />
    </SelectedDateProvider>
  );
}
