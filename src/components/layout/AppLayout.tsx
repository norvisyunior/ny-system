import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CalendarDays, Clock } from "lucide-react";
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
  const { date, setDate } = useSelectedDate();
  const now = useNow();
  const today = todayISO();

  const time = now.toLocaleTimeString("es-ES", { hour: "numeric", minute: "2-digit", hour12: true });
  const subtitleDate = isDashboard ? date : today;
  const initial = (settings?.businessName ?? "N").trim().charAt(0).toUpperCase();

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3.5">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-900">{greeting()}</h1>
        <p className="truncate text-sm text-slate-500">
          Aquí tienes un resumen del estado de tu negocio hoy, {fmtLongDate(subtitleDate)}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {settings?.demoMode && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
            Modo demo — datos de ejemplo
          </span>
        )}

        {isDashboard && (
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

        <span className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1.5 pl-1.5 pr-3 shadow-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
            {initial}
          </span>
          <span className="max-w-[10rem] truncate text-sm font-semibold text-slate-700">
            {settings?.businessName || "Administrador"}
          </span>
        </span>
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
