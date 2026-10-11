import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { api } from "../../api/client";
import { Sidebar } from "./Sidebar";

interface AppSettings {
  businessName: string;
  demoMode: boolean;
}

export function AppLayout() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    api.get<AppSettings>("/settings").then(setSettings).catch(() => undefined);
  }, []);

  const today = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-500 capitalize">{today}</div>
            {settings?.demoMode && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                Modo demo — datos de ejemplo
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">
              {settings?.businessName ?? ""}
            </span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              ● Operando offline
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
              A
            </span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
