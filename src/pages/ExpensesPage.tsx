import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, ErrorAlert, Modal, SearchInput, fmtMoney, todayISO } from "../components/ui";

interface ExpenseRow {
  id: number;
  expenseDate: string;
  category: string;
  description: string;
  amountMicro: number;
  paymentMethod: string;
  responsible: string | null;
  status: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  otro: "Otro",
};

export function ExpensesPage() {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState({
    expenseDate: todayISO(),
    category: "",
    description: "",
    amount: "",
    paymentMethod: "efectivo",
    responsible: "",
    notes: "",
  });
  const [annulTarget, setAnnulTarget] = useState<ExpenseRow | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get<ExpenseRow[]>("/expenses").then(setRows).catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const openForm = () => {
    setForm({
      expenseDate: todayISO(),
      category: "",
      description: "",
      amount: "",
      paymentMethod: "efectivo",
      responsible: "",
      notes: "",
    });
    setError(null);
    setView("form");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post("/expenses", {
        expenseDate: form.expenseDate,
        category: form.category,
        description: form.description,
        amount: form.amount,
        paymentMethod: form.paymentMethod,
        responsible: form.responsible || null,
        notes: form.notes || null,
      });
      setView("list");
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const annul = async () => {
    if (!annulTarget) return;
    try {
      await api.post(`/expenses/${annulTarget.id}/annul`, { reason: annulReason });
      setAnnulTarget(null);
      setAnnulReason("");
      load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const filtered = rows.filter(
    (r) =>
      r.category.toLowerCase().includes(q.toLowerCase()) ||
      r.description.toLowerCase().includes(q.toLowerCase()) ||
      r.expenseDate.includes(q),
  );
  const totalActive = rows
    .filter((r) => r.status === "confirmada")
    .reduce((acc, r) => acc + r.amountMicro, 0);

  const canSave =
    form.category.trim().length >= 2 &&
    form.description.trim().length >= 2 &&
    Number(form.amount) > 0;

  return (
    <div>
      <PageHeader
        title="Gastos"
        subtitle="Gastos operativos del negocio (transporte, servicios, insumos varios)"
        actions={
          view === "list" ? (
            <button className="btn btn-primary" onClick={openForm}>
              + Nuevo gasto
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              ← Volver
            </button>
          )
        }
      />
      <ErrorAlert message={error} />

      {view === "list" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar por categoría, descripción o fecha…" />
            <span className="text-sm text-slate-500">
              {filtered.length} gasto(s) · activos {fmtMoney(totalActive)}
            </span>
          </div>
          <div className="card overflow-hidden">
            <table className="table-ny">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Categoría</th>
                  <th>Descripción</th>
                  <th>Método</th>
                  <th>Responsable</th>
                  <th className="num">Monto</th>
                  <th className="center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Sin gastos registrados.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>{r.expenseDate}</td>
                    <td className="font-semibold">{r.category}</td>
                    <td>{r.description}</td>
                    <td>{PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod}</td>
                    <td className="text-slate-500">{r.responsible ?? "—"}</td>
                    <td className="num font-semibold">{fmtMoney(r.amountMicro)}</td>
                    <td className="center">
                      {r.status === "confirmada" ? (
                        <Badge tone="green">Confirmado</Badge>
                      ) : (
                        <Badge tone="red">Anulado</Badge>
                      )}
                    </td>
                    <td className="text-right">
                      {r.status === "confirmada" && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            setAnnulTarget(r);
                            setAnnulReason("");
                            setError(null);
                          }}
                        >
                          Anular
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "form" && (
        <div className="card p-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="field">
              <label>Fecha *</label>
              <input
                type="date"
                max={todayISO()}
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Categoría *</label>
              <input
                value={form.category}
                placeholder="Transporte, Servicios, Mantenimiento…"
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Monto ($) *</label>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Descripción *</label>
              <input
                value={form.description}
                placeholder="Qué se pagó"
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Método de pago *</label>
              <select
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
              >
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div className="field">
              <label>Responsable</label>
              <input
                value={form.responsible}
                onChange={(e) => setForm({ ...form, responsible: e.target.value })}
              />
            </div>
            <div className="field col-span-3">
              <label>Notas</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !canSave}>
              {saving ? "Guardando..." : "Registrar gasto"}
            </button>
          </div>
        </div>
      )}

      {annulTarget && (
        <Modal title="Anular gasto" onClose={() => setAnnulTarget(null)}>
          <p className="mb-3 text-sm text-slate-600">
            <strong>
              {annulTarget.category} — {annulTarget.description}
            </strong>{" "}
            ({fmtMoney(annulTarget.amountMicro)}). La anulación queda auditada y excluye
            el gasto de los cierres.
          </p>
          <input
            className="mb-3 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Motivo de la anulación *"
            value={annulReason}
            onChange={(e) => setAnnulReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setAnnulTarget(null)}>
              Cancelar
            </button>
            <button className="btn btn-danger" disabled={annulReason.trim().length < 3} onClick={annul}>
              Anular gasto
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
