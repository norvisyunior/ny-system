import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { todayISO } from "../components/ui";

export type DashboardViewMode = "day" | "totals";

interface SelectedDateValue {
  date: string;
  setDate: (date: string) => void;
  viewMode: DashboardViewMode;
  setViewMode: (mode: DashboardViewMode) => void;
  notificationCount: number;
  setNotificationCount: (n: number) => void;
}

const SelectedDateContext = createContext<SelectedDateValue | null>(null);

/**
 * Fecha global y modo de vista del dashboard (visible solo en /dashboard).
 * - day: KPIs del día seleccionado en el calendario del header.
 * - totals: acumulado histórico de todo el negocio.
 * El DashboardPage consume la fecha/modo y publica el conteo de alertas.
 */
export function SelectedDateProvider({ children }: { children: ReactNode }) {
  const [date, setDate] = useState(todayISO);
  const [viewMode, setViewMode] = useState<DashboardViewMode>("day");
  const [notificationCount, setNotificationCount] = useState(0);

  const value = useMemo(
    () => ({ date, setDate, viewMode, setViewMode, notificationCount, setNotificationCount }),
    [date, viewMode, notificationCount],
  );

  return <SelectedDateContext.Provider value={value}>{children}</SelectedDateContext.Provider>;
}

export function useSelectedDate(): SelectedDateValue {
  const ctx = useContext(SelectedDateContext);
  if (!ctx) throw new Error("useSelectedDate debe usarse dentro de SelectedDateProvider");
  return ctx;
}
