import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { todayISO } from "../components/ui";

interface SelectedDateValue {
  date: string;
  setDate: (date: string) => void;
  notificationCount: number;
  setNotificationCount: (n: number) => void;
}

const SelectedDateContext = createContext<SelectedDateValue | null>(null);

/**
 * Fecha global seleccionada en el header (visible solo en /dashboard).
 * El DashboardPage la consume para pedir sus datos y publica aquí
 * el conteo de alertas para la campana del header.
 */
export function SelectedDateProvider({ children }: { children: ReactNode }) {
  const [date, setDate] = useState(todayISO);
  const [notificationCount, setNotificationCount] = useState(0);

  const value = useMemo(
    () => ({ date, setDate, notificationCount, setNotificationCount }),
    [date, notificationCount],
  );

  return <SelectedDateContext.Provider value={value}>{children}</SelectedDateContext.Provider>;
}

export function useSelectedDate(): SelectedDateValue {
  const ctx = useContext(SelectedDateContext);
  if (!ctx) throw new Error("useSelectedDate debe usarse dentro de SelectedDateProvider");
  return ctx;
}
