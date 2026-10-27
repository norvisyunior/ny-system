import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, ErrorAlert, FlowGuide, Modal, SearchInput, fmtMoney, fmtQty, stockLevel } from "../components/ui";

interface Unit {
  code: string;
  label: string;
  dimension: string;
  isBase: number | boolean;
}

interface MaterialListItem {
  id: number;
  name: string;
  category: string | null;
  unitId: string;
  unitLabel: string;
  dimension: string;
  stockMicro: number;
  minStockMicro: number;
  active: boolean;
  stockValueMicro: number;
  lastPrice: {
    priceMicro: number;
    unitId: string;
    unitLabel: string;
    date: string;
    supplier: string;
  } | null;
}

interface MaterialDetail {
  material: {
    id: number;
    name: string;
    description: string | null;
    category: string | null;
    unitId: string;
    stockMicro: number;
    minStockMicro: number;
    active: boolean;
    updatedAt: string | null;
  };
  lots: {
    id: number;
    businessDate: string;
    qtyRemainingMicro: number;
    qtyInitialMicro: number;
    unitCostMicro: number;
    refType: string;
    refId: number;
  }[];
  priceHistory: {
    date: string;
    purchaseNumber: number;
    supplier: string;
    qtyMicro: number;
    unitId: string;
    priceMicro: number;
    lineTotalMicro: number;
  }[];
  stockValueMicro: number;
}

const EMPTY = {
  name: "",
  description: "",
  category: "",
  unitId: "kg",
  minStock: "0",
  active: true,
};

export function MaterialsPage() {
  const [rows, setRows] = useState<MaterialListItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<(typeof EMPTY & { id: number }) | null>(null);
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api
      .get<MaterialListItem[]>("/materials")
      .then(setRows)
      .catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api.get<Unit[]>("/units").then(setUnits).catch(() => undefined);
  }, []);

  const openNew = () => {
    setForm({ ...EMPTY, id: 0 });
    setError(null);
  };
  const openEdit = async (m: MaterialListItem) => {
    setError(null);
    // La lista no incluye la descripción: cargarla antes de abrir el formulario
    // para no pisarla con un vacío al guardar.
    let description = "";
    try {
      const d = await api.get<MaterialDetail>(`/materials/${m.id}`);
      description = d.material.description ?? "";
    } catch (e) {
      setError((e as ApiError).message);
      return; // sin detalle no se edita (evita borrar la descripción)
    }
    setForm({
      id: m.id,
      name: m.name,
      description,
      category: m.category ?? "",
      unitId: m.unitId,
      minStock: fmtQty(m.minStockMicro, null, 3),
      active: m.active,
    });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        description: form.description || null,
        category: form.category || null,
        unitId: form.unitId,
        minStock: form.minStock || "0",
        active: form.active,
      };
      if (form.id) await api.put(`/materials/${form.id}`, body);
      else await api.post("/materials", body);
      setForm(null);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (id: number) => {
    setError(null);
    try {
      const res = await api.get<MaterialDetail>(`/materials/${id}`);
      setDetail(res);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const filtered = rows.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));

  const DIMENSION_LABEL: Record<string, string> = {
    masa: "Masa (kg, g, lb)",
    volumen: "Volumen (l, ml)",
    longitud: "Longitud (m, cm, mm)",
    conteo: "Conteo (unidad, paquete, caja)",
  };
  const unitGroups = (["masa", "volumen", "longitud", "conteo"] as const)
    .map((dim) => ({ dim, units: units.filter((u) => u.dimension === dim) }))
    .filter((g) => g.units.length > 0);

  const detailLevel = detail
    ? stockLevel(detail.material.stockMicro, detail.material.minStockMicro)
    : "ok";

  return (
    <div>
      <PageHeader
        title="Materias primas"
        subtitle="Ingredientes, empaques, existencias y valorización PEPS"
        actions={
          <button className="btn btn-primary" onClick={openNew}>
            + Nueva materia prima
          </button>
        }
      />
      <FlowGuide current="catalogos" />
      <ErrorAlert message={error} />
      <div className="mb-4 flex items-center justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre…" />
        <span className="text-sm text-slate-500">{filtered.length} registro(s)</span>
      </div>

      <div className="card overflow-hidden">
        <table className="table-ny">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Categoría</th>
              <th className="center">Stock</th>
              <th className="center">Mínimo</th>
              <th className="num">Última compra</th>
              <th className="num">Valor inventario</th>
              <th className="center">Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">
                  Sin materias primas registradas.
                </td>
              </tr>
            )}
            {filtered.map((m) => {
              const level = stockLevel(m.stockMicro, m.minStockMicro);
              return (
                <tr key={m.id}>
                  <td className="font-medium">{m.name}</td>
                  <td>{m.category ?? "—"}</td>
                  <td className="center">
                    <span className={`stock-chip ${level}`}>
                      {fmtQty(m.stockMicro, m.unitId)}
                      {level !== "ok" && <span title="Stock bajo o agotado">⚠</span>}
                    </span>
                  </td>
                  <td className="center">
                    <span className="min-tag">mín {fmtQty(m.minStockMicro, m.unitId)}</span>
                  </td>
                  <td className="num">
                    {m.lastPrice
                      ? `${fmtMoney(m.lastPrice.priceMicro)}/${m.lastPrice.unitId} (${m.lastPrice.date})`
                      : "—"}
                  </td>
                  <td className="num font-semibold">{fmtMoney(m.stockValueMicro)}</td>
                  <td className="center">
                    {m.active ? <Badge tone="green">Activa</Badge> : <Badge tone="red">Inactiva</Badge>}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button className="btn btn-secondary" onClick={() => openDetail(m.id)}>
                        Detalle
                      </button>
                      <button className="btn btn-secondary" onClick={() => openEdit(m)}>
                        Editar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title={form.id ? "Editar materia prima" : "Nueva materia prima"} onClose={() => setForm(null)} wide>
          <div className="flex flex-col gap-3">
            <ErrorAlert message={error} />
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Nombre *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="EJ: Harina de trigo"
                  autoFocus
                />
                <span className="mt-1 block text-[11px] text-slate-500">
                  El nombre debe ser único: no puede repetir el de otra materia prima.
                </span>
              </div>
              <div className="field">
                <label>Categoría</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="EJ: Carne"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Unidad base *</label>
                <select
                  value={form.unitId}
                  onChange={(e) => setForm({ ...form, unitId: e.target.value })}
                >
                  {unitGroups.map((g) => (
                    <optgroup key={g.dim} label={DIMENSION_LABEL[g.dim]}>
                      {g.units.map((u) => (
                        <option key={u.code} value={u.code}>
                          {u.label} ({u.code})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-slate-500">
                  Lo que se compra por piezas (nylon, cajas, etiquetas): elija{" "}
                  <strong>Unidad</strong> o <strong>Paquete</strong>.
                </span>
              </div>
              <div className="field">
                <label>Stock mínimo</label>
                <input
                  value={form.minStock}
                  onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                  inputMode="decimal"
                />
                <span className="mt-1 block text-[11px] text-slate-500">
                  Al llegar a este nivel el Dashboard marcará “Stock bajo”.
                </span>
              </div>
            </div>
            <div className="field">
              <label>Descripción</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
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
              <button className="btn btn-secondary" onClick={() => setForm(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={save}
                disabled={saving || !form.name.trim()}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`Detalle — ${detail.material.name}`} onClose={() => setDetail(null)} wide>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Stock actual</div>
              <div className="mt-1">
                <span className={`stock-chip hero ${detailLevel}`}>
                  {fmtQty(detail.material.stockMicro, detail.material.unitId)}
                  {detailLevel !== "ok" && <span title="Stock bajo o agotado">⚠</span>}
                </span>
              </div>
            </div>
            <div>
              <div className="text-slate-500">Valor FIFO</div>
              <div className="text-lg font-bold">{fmtMoney(detail.stockValueMicro)}</div>
            </div>
            <div>
              <div className="text-slate-500">Stock mínimo</div>
              <div className="mt-1">
                <span className="min-tag">mín {fmtQty(detail.material.minStockMicro, detail.material.unitId)}</span>
              </div>
            </div>
          </div>

          <h3 className="mb-2 mt-5 text-sm font-bold text-slate-700">
            Lotes existentes (PEPS — primero sale el más antiguo)
          </h3>
          <div className="max-h-48 overflow-y-auto rounded border border-slate-200">
            <table className="table-ny">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Origen</th>
                  <th className="num">Inicial</th>
                  <th className="num">Restante</th>
                  <th className="num">Costo unit.</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {detail.lots.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-400">
                      Sin existencias.
                    </td>
                  </tr>
                )}
                {detail.lots.map((l) => (
                  <tr key={l.id}>
                    <td>{l.businessDate}</td>
                    <td className="text-xs text-slate-500">
                      {l.refType === "purchase" ? `Compra #${String(l.refId).padStart(5, "0")}` : l.refType}
                    </td>
                    <td className="num">{fmtQty(l.qtyInitialMicro, detail.material.unitId)}</td>
                    <td className="num font-semibold">{fmtQty(l.qtyRemainingMicro, detail.material.unitId)}</td>
                    <td className="num">{fmtMoney(l.unitCostMicro)}</td>
                    <td className="num">{fmtMoney(Math.round((l.qtyRemainingMicro * l.unitCostMicro) / 1e6))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mb-2 mt-5 text-sm font-bold text-slate-700">
            Historial de precios de compra (precio real pagado)
          </h3>
          <div className="max-h-48 overflow-y-auto rounded border border-slate-200">
            <table className="table-ny">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Compra</th>
                  <th>Proveedor</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Precio unit.</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {detail.priceHistory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-400">
                      Sin compras registradas.
                    </td>
                  </tr>
                )}
                {detail.priceHistory.map((p, i) => (
                  <tr key={i}>
                    <td>{p.date}</td>
                    <td>#{String(p.purchaseNumber).padStart(5, "0")}</td>
                    <td>{p.supplier}</td>
                    <td className="num">{fmtQty(p.qtyMicro, p.unitId)}</td>
                    <td className="num">{fmtMoney(p.priceMicro)}/{p.unitId}</td>
                    <td className="num">{fmtMoney(p.lineTotalMicro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
