import { dailyClosings } from "../../db/schema";
import { eq, max } from "drizzle-orm";
import { conflictError, domainError } from "./errors";
import type { DBOrTx } from "./types";

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Desplaza una fecha ISO (YYYY-MM-DD) ±N días en la zona local del sistema. */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Periodo 'YYYY-MM' al que pertenece una fecha ISO. */
export function monthOfISO(iso: string): string {
  return iso.slice(0, 7);
}

/** Último día del mes 'YYYY-MM' como fecha ISO. */
export function lastDayOfMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Avanza (o retrocede) un periodo 'YYYY-MM' N meses. */
export function addMonthsToPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function nowISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(
      d.getMilliseconds(),
    ).padStart(3, "0")}`
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Último día con cierre confirmado (null si no hay cierres). */
export function lastClosedDate(db: DBOrTx): string | null {
  const row = db
    .select({ maxDate: max(dailyClosings.businessDate) })
    .from(dailyClosings)
    .where(eq(dailyClosings.status, "cerrado"))
    .get();
  return row?.maxDate ?? null;
}

/**
 * Valida la fecha de operación de un documento:
 * - formato YYYY-MM-DD y fecha real;
 * - no puede ser futura;
 * - no puede ser anterior ni igual al último día cerrado (protección del cierre).
 * Si `requireToday` (ventas), además debe ser = hoy.
 */
export function assertValidBusinessDate(
  db: DBOrTx,
  date: string,
  opts: { requireToday?: boolean; label?: string } = {},
): void {
  const label = opts.label ?? "La fecha";
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw domainError(`${label} "${date}" no es una fecha válida (YYYY-MM-DD).`);
  }
  const today = todayISO();
  if (date > today) {
    throw domainError(`${label} no puede ser futura (${date}).`);
  }
  if (opts.requireToday && date !== today) {
    throw domainError(
      `Solo se permiten operaciones del día en curso (${today}). Los días cerrados no aceptan movimientos nuevos.`,
    );
  }
  const closed = lastClosedDate(db);
  if (closed && date <= closed) {
    throw conflictError(
      `El día ${closed} y anteriores están cerrados. La operación con fecha ${date} no está permitida; si es imprescindible, reabra el día desde Cierre diario.`,
      "DAY_CLOSED",
    );
  }
}
