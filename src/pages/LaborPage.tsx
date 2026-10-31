import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { ErrorAlert, Kpi, Modal, fmtMoney } from "../components/ui";

type LaborKind = "produccion" | "elaboracion" | "terminacion";

interface LaborOpRow {
  id: number;
  kind: LaborKind;
  number: number;
  date: string;
  name: string;
  detail: string;
  responsible: string | null;
  laborCostMicro: number;
}

interface LaborDayRow {
  date: string;
  opsCount: number;
  totalMicro: number;
  ops: LaborOpRow[];
}

interface LaborWeekRow {
  weekStart: string;
  weekEnd: string;
  opsCount: number;
  totalMicro: number;
  days: LaborDayRow[];
}

interface LaborSummary {
  from: string;
  to: string;
  days: LaborDayRow[];
  weeks: LaborWeekRow[];
  totals: {
    opsCount: number;
    totalMicro: number;
    byKind: Record<LaborKind, number>;
  };
}

const KIND_LABEL: Record<LaborKind, string> = {
  produccion: "Producción",
  elaboracion: "Elaboración",
  terminacion: "Terminación",
};

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
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

function dayName(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return DAY_NAMES[d.getDay()];
}

function dayShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1].slice(0, 3)}.`;
}

function fmtFullDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTHS[(m ?? 1) - 1]} de ${iso.slice(0, 4)}`;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mondayOfToday(): string {
  const d = new Date();
  const back = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - back);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function docCode(kind: LaborKind, n: number): string {
  const prefix = kind === "produccion" ? "PRD" : kind === "elaboracion" ? "ELB" : "TRM";
  return `${prefix}${String(n).padStart(5, "0")}`;
}

function kindBadgeClass(kind: LaborKind): string {
  return kind === "produccion"
    ? "bg-blue-50 text-blue-700"
    : kind === "elaboracion"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-amber-50 text-amber-700";
}

function OpsTable({ ops }: { ops: LaborOpRow[] }) {
  return (
    <table className="table-ny">
      <thead>
        <tr>
          <th>Nº</th>
          <th>Proceso</th>
          <th>Descripción</th>
          <th>Detalle</th>
          <th>Responsable</th>
          <th className="num">Mano de obra</th>
        </tr>
      </thead>
      <tbody>
        {ops.length === 0 && (
          <tr>
            <td colSpan={6} className="py-8 text-center text-slate-400">
              Sin operaciones en este período.
            </td>
          </tr>
        )}
        {ops.map((o) => (
          <tr key={`${o.kind}-${o.id}`}>
            <td className="font-mono text-xs">{docCode(o.kind, o.number)}</td>
            <td>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${kindBadgeClass(o.kind)}`}
              >
                {KIND_LABEL[o.kind]}
              </span>
            </td>
            <td className="font-semibold">{o.name}</td>
            <td className="text-slate-500">{o.detail}</td>
            <td className="text-slate-500">{o.responsible ?? "—"}</td>
            <td
              className={`num ${o.laborCostMicro > 0 ? "font-semibold" : "text-slate-400"}`}
            >
              {fmtMoney(o.laborCostMicro)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Modal: registra como gasto el pago a los trabajadores, con monto editable. */
function PayModal({
  suggested,
  byKind,
  onClose,
}: {
  suggested: number;
  byKind: Record<LaborKind, number>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState(
    suggested > 0 ? String(Number(suggested) / 1_000_000) : "",
  );
  const [method, setMethod] = useState("efectivo");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const parts: string[] = [];
      if (byKind.produccion > 0) parts.push(`producción ${fmtMoney(byKind.produccion)}`);
      if (byKind.elaboracion > 0) parts.push(`elaboración ${fmtMoney(byKind.elaboracion)}`);
      if (byKind.terminacion > 0) parts.push(`terminación ${fmtMoney(byKind.terminacion)}`);
      const desc = parts.length
        ? `Pago mano de obra (${parts.join(", ")})`
        : "Pago de mano de obra";
      await api.post("/expenses", {
        expenseDate: date,
        category: "Mano de obra",
        description: desc,
        amount: amount.trim(),
        paymentMethod: method,
        responsible: "Trabajadores",
        notes: notes.trim() || null,
      });
      toast.success(`Pago registrado en Gastos: ${desc}`);
      onClose();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const valid = amount.trim() !== "" && Number(amount) > 0;

  return (
    <Modal title="Registrar pago de mano de obra" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">
          El pago se asienta como gasto de la fecha elegida (que puede ser posterior a los
          días trabajados). El monto está prefijado con el total de la vista actual, pero
          puede pagar más o menos: solo se aplica lo que consigne aquí.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label>Fecha del gasto *</label>
            <input
              type="date"
              max={todayIso()}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Monto a pagar ($) *</label>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            {suggested > 0 && (
              <p className="mt-1 text-xs text-slate-400">
                Sugerido según la vista: {fmtMoney(suggested)}
              </p>
            )}
          </div>
        </div>
        <div className="field">
          <label>Método de pago *</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="transferencia">Transferencia</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div className="field">
          <label>Nota</label>
          <input
            placeholder="Observaciones del pago (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={saving || !valid}
          >
            {saving ? "Registrando…" : "Registrar pago"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function LaborPage() {
  const [from, setFrom] = useState(mondayOfToday());
  const [to, setTo] = useState(todayIso());
  const [view, setView] = useState<"diario" | "semanal">("diario");
  const [summary, setSummary] = useState<LaborSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.get<LaborSummary>(`/labor/summary?from=${f}&to=${t}`));
    } catch (e) {
      setSummary(null);
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(from, to);
  }, [from, to, load]);

  const applyRange = (r: "semana" | "mes" | "todo") => {
    const today = todayIso();
    if (r === "semana") {
      setFrom(mondayOfToday());
      setTo(today);
    } else if (r === "mes") {
      setFrom(`${today.slice(0, 7)}-01`);
      setTo(today);
    } else {
      const d = new Date(`${today}T12:00:00`);
      d.setDate(d.getDate() - 29);
      setFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      setTo(today);
    }
  };

  const activeRange = (r: "semana" | "mes" | "todo"): boolean => {
    const today = todayIso();
    if (r === "semana") return from === mondayOfToday() && to === today;
    if (r === "mes") return from === `${to.slice(0, 7)}-01`;
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - 29);
    return (
      from ===
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  };

  const suggested = summary?.totals.totalMicro ?? 0;
  const payByKind =
    summary?.totals.byKind ?? { produccion: 0, elaboracion: 0, terminacion: 0 };

  return (
    <div>
      <PageHeader
        title="Mano de obra"
        subtitle="Lo que se debe pagar a los trabajadores: producciones, elaboraciones y empaquetado del período"
        actions={
          <div className="flex gap-2">
            <a
              className="btn btn-secondary"
              href={`/api/reports/labor/csv?from=${from}&to=${to}`}
              download
            >
              Exportar CSV
            </a>
            <button
              className="btn btn-primary"
              onClick={() => {
                setPayOpen(true);
              }}
            >
              Registrar pago
            </button>
          </div>
        }
      />
      <ErrorAlert message={error} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="field">
          <label>Desde</label>
          <input
            type="date"
            max={to}
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input
            type="date"
            max={todayIso()}
            value={to}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {(["semana", "mes", "todo"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => applyRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                activeRange(r) ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {r === "semana" ? "Esta semana" : r === "mes" ? "Este mes" : "30 días"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {(["diario", "semanal"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                view === v ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {v === "diario" ? "Resumen diario" : "Resumen semanal"}
            </button>
          ))}
        </div>
        <button className="btn btn-secondary" onClick={() => load(from, to)}>
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {summary && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Total a pagar"
            value={fmtMoney(summary.totals.totalMicro)}
            sub={`${summary.totals.opsCount} operación(es)`}
            tone={summary.totals.totalMicro > 0 ? "green" : undefined}
            big
          />
          <Kpi
            label="Producción de masas"
            value={fmtMoney(summary.totals.byKind.produccion)}
            sub="Elaboración de masas completas"
            muted
          />
          <Kpi
            label="Elaboración de materias primas"
            value={fmtMoney(summary.totals.byKind.elaboracion)}
            muted
          />
          <Kpi
            label="Terminación / empaquetado"
            value={fmtMoney(summary.totals.byKind.terminacion)}
            muted
          />
        </div>
      )}

      {summary && (
        <div>
          {view === "diario" ? (
            <div className="flex flex-col gap-5">
              {summary.days.length === 0 && (
                <div className="card p-6 text-sm text-slate-500">
                  No hay operaciones en el período seleccionado.
                </div>
              )}
              {summary.days.map((d) => (
                <div key={d.date} className="card overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                    <div className="font-bold text-slate-800">
                      {dayName(d.date)} {fmtFullDate(d.date)}
                    </div>
                    <div className="text-sm text-slate-500">
                      {d.opsCount} operación(es) · Total del día{" "}
                      <span className="font-bold text-slate-800">{fmtMoney(d.totalMicro)}</span>
                    </div>
                  </div>
                  <OpsTable ops={d.ops} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {summary.weeks.length === 0 && (
                <div className="card p-6 text-sm text-slate-500">
                  No hay operaciones en el período seleccionado.
                </div>
              )}
              {summary.weeks.map((w) => (
                <div key={w.weekStart} className="card overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                    <div className="font-bold text-slate-800">
                      Semana del {dayShort(w.weekStart)} al {dayShort(w.weekEnd)}
                    </div>
                    <div className="text-sm text-slate-500">
                      {w.opsCount} operación(es) · Total de la semana{" "}
                      <span className="font-bold text-slate-800">{fmtMoney(w.totalMicro)}</span>
                    </div>
                  </div>
                  {w.days.map((d) => (
                    <div key={d.date}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          {dayName(d.date)} · {fmtFullDate(d.date)}
                        </div>
                        <div className="text-xs text-slate-500">
                          Total día{" "}
                          <span className="font-bold text-slate-700">{fmtMoney(d.totalMicro)}</span>
                        </div>
                      </div>
                      <OpsTable ops={d.ops} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {payOpen && (
        <PayModal
          suggested={suggested}
          byKind={payByKind}
          onClose={() => setPayOpen(false)}
        />
      )}
    </div>
  );
}
