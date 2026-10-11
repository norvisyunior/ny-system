import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  ErrorAlert,
  Modal,
  SearchInput,
  fmtMoney,
  fmtQty,
  stockLevel,
  FlowGuide,
} from "../components/ui";

interface MassRow {
  id: number;
  name: string;
  unitId: string;
  stockMicro: number;
  minStockMicro: number;
  active: boolean;
  stockValueMicro: number;
}

interface MassLot {
  id: number;
  businessDate: string;
  refType: string;
  qtyInitialMicro: number;
  qtyRemainingMicro: number;
  unitCostMicro: number;
}

interface MassMovement {
  id: number;
  businessDate: string;
  movementType: string;
  qtyDeltaMicro: number;
  valueMicro: number;
  notes: string | null;
}

interface MassDetail {
  mass: MassRow;
  lots: MassLot[];
  movements: MassMovement[];
  stockValueMicro: number;
}

interface Unit {
  code: string;
  label: string;
  dimension: string;
}

const EMPTY = { name: "", unitId: "", minStock: "", active: true };

export function MassesPage() {
  const [rows, setRows] = useState<MassRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<MassDetail | null>(null);

  const load = useCallback(() => {
    api.get<MassRow[]>("/masses").then(setRows).catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api.get<Unit[]>("/units").then(setUnits).catch(() => undefined);
  }, []);

  const openNew = () => {
    setForm(EMPTY);
    setEditing("new");
    setError(null);
  };
  const openEdit = (m: MassRow) => {
    setForm({
      name: m.name,
      unitId: m.unitId,
      minStock: fmtQty(m.minStockMicro, null, 3),
      active: m.active,
    });
    setEditing(m.id);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        unitId: form.unitId,
        minStock: form.minStock || undefined,
        active: form.active,
      };
      if (editing !== null && editing !== "new") await api.put(`/masses/${editing}`, body);
      else await api.post("/masses", body);
      setEditing(null);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (id: number) => {
    try {
      setDetail(await api.get<MassDetail>(`/masses/${id}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const filtered = rows.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));

  const detailLevel = detail
    ? stockLevel(detail.mass.stockMicro, detail.mass.minStockMicro)
    : "ok";

  return (
    <div>
      <PageHeader
        title="Masas"
        subtitle="Semielaborados producidos: lotes, costos PEPS y existencias"
        actions={
          <button className="btn btn-primary" onClick={openNew}>
            + Nueva masa
          </button>
        }
      />
      <FlowGuide current="catalogos" />
      <ErrorAlert message={error} />

      <div className="mb-4 flex items-center justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre…" />
        <span className="text-sm text-slate-500">{filtered.length} masa(s)</span>
      </div>

      <div className="card overflow-hidden">
        <table className="table-ny">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Unidad</th>
              <th className="center">Stock</th>
              <th className="center">Mínimo</th>
              <th className="num">Valor FIFO</th>
              <th className="center">Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  Sin masas registradas.
                </td>
              </tr>
            )}
            {filtered.map((m) => {
              const level = stockLevel(m.stockMicro, m.minStockMicro);
              return (
                <tr key={m.id}>
                  <td className="font-medium">{m.name}</td>
                  <td>{m.unitId}</td>
                  <td className="center">
                    <span className={`stock-chip ${level}`}>
                      {fmtQty(m.stockMicro, m.unitId)}
                      {level !== "ok" && <span title="Stock bajo o agotado">⚠</span>}
                    </span>
                  </td>
                  <td className="center">
                    <span className="min-tag">mín {fmtQty(m.minStockMicro, m.unitId)}</span>
                  </td>
                  <td className="num font-semibold">{fmtMoney(m.stockValueMicro)}</td>
                  <td className="center">
                    {m.active ? <Badge tone="green">Activa</Badge> : <Badge tone="red">Inactiva</Badge>}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-secondary mr-2" onClick={() => openDetail(m.id)}>
                      Ver
                    </button>
                    <button className="btn btn-secondary" onClick={() => openEdit(m)}>
                      Editar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <Modal
          title={editing === "new" ? "Nueva masa" : "Editar masa"}
          onClose={() => setEditing(null)}
        >
          <div className="flex flex-col gap-3">
            <ErrorAlert message={error} />
            <div className="field">
              <label>Nombre *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Masa de empanada"
                autoFocus
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                El nombre debe ser único: no puede repetir el de otra masa.
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Unidad *</label>
                <select
                  value={form.unitId}
                  onChange={(e) => setForm({ ...form, unitId: e.target.value })}
                >
                  <option value="">Seleccione…</option>
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.label} ({u.code})
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-slate-500">
                  La masa se <strong>cuenta</strong> (Unidad/Paquete) o se <strong>pesa</strong> (kg).
                </span>
              </div>
              <div className="field">
                <label>Stock mínimo</label>
                <input
                  value={form.minStock}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                />
              </div>
            </div>
            <div className="field w-40">
              <label>Estado</label>
              <select
                value={form.active ? "1" : "0"}
                onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}
              >
                <option value="1">Activa</option>
                <option value="0">Inactiva</option>
              </select>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={save}
                disabled={saving || !form.name.trim() || !form.unitId}
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`Masa — ${detail.mass.name}`} onClose={() => setDetail(null)} wide>
          <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Stock actual</div>
              <div className="mt-1">
                <span className={`stock-chip hero ${detailLevel}`}>
                  {fmtQty(detail.mass.stockMicro, detail.mass.unitId)}
                  {detailLevel !== "ok" && <span title="Stock bajo o agotado">⚠</span>}
                </span>
              </div>
            </div>
            <div>
              <div className="text-slate-500">Valor FIFO</div>
              <div className="font-semibold">{fmtMoney(detail.stockValueMicro)}</div>
            </div>
            <div>
              <div className="text-slate-500">Stock mínimo</div>
              <div className="mt-1">
                <span className="min-tag">mín {fmtQty(detail.mass.minStockMicro, detail.mass.unitId)}</span>
              </div>
            </div>
            <div>
              <div className="text-slate-500">Estado</div>
              {detail.mass.active ? <Badge tone="green">Activa</Badge> : <Badge tone="red">Inactiva</Badge>}
            </div>
          </div>

          <h3 className="mb-2 text-sm font-bold text-slate-700">Lotes (PEPS)</h3>
          <table className="table-ny mb-5">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Origen</th>
                <th className="num">Inicial</th>
                <th className="num">Restante</th>
                <th className="num">Costo unit.</th>
              </tr>
            </thead>
            <tbody>
              {detail.lots.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-400">
                    Sin lotes activos.
                  </td>
                </tr>
              )}
              {detail.lots.map((l) => (
                <tr key={l.id}>
                  <td>{l.businessDate}</td>
                  <td className="capitalize">{l.refType}</td>
                  <td className="num">{fmtQty(l.qtyInitialMicro, detail.mass.unitId)}</td>
                  <td className="num font-semibold">{fmtQty(l.qtyRemainingMicro, detail.mass.unitId)}</td>
                  <td className="num">{fmtMoney(l.unitCostMicro)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="mb-2 text-sm font-bold text-slate-700">Movimientos recientes</h3>
          <table className="table-ny">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th className="num">Cantidad</th>
                <th className="num">Costo</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {detail.movements.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-400">
                    Sin movimientos.
                  </td>
                </tr>
              )}
              {detail.movements.map((mv) => (
                <tr key={mv.id}>
                  <td>{mv.businessDate}</td>
                  <td className="capitalize">{mv.movementType.replace(/_/g, " ")}</td>
                  <td className={`num ${mv.qtyDeltaMicro < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {mv.qtyDeltaMicro < 0 ? "" : "+"}
                    {fmtQty(mv.qtyDeltaMicro, detail.mass.unitId)}
                  </td>
                  <td className="num">{fmtMoney(mv.valueMicro)}</td>
                  <td className="text-xs text-slate-500">{mv.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end">
            <button className="btn btn-secondary" onClick={() => setDetail(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
