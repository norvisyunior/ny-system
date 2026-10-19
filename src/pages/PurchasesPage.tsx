import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  DayFilter,
  ErrorAlert,
  Modal,
  SearchInput,
  ScopeToggle,
  fmtDocNumber,
  fmtMoney,
  fmtQty,
  todayISO,
  FlowGuide,
} from "../components/ui";
import { addMicro, mulQtyPrice, parseDecimalToMicro } from "@shared/money";

interface PurchaseRow {
  id: number;
  number: number;
  purchaseDate: string;
  docNumber: string | null;
  supplierName: string;
  totalMicro: number;
  status: string;
  itemsCount: number;
}

interface PurchaseDetail {
  id: number;
  number: number;
  purchaseDate: string;
  docNumber: string | null;
  notes: string | null;
  totalMicro: number;
  status: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  supplierName: string;
  createdAt: string;
  items: {
    id: number;
    materialName: string;
    materialUnit: string;
    unitId: string;
    unitLabel: string;
    qtyMicro: number;
    qtyBaseMicro: number;
    unitPriceMicro: number;
    lineTotalMicro: number;
  }[];
}

interface Supplier {
  id: number;
  name: string;
  active: boolean;
}
interface Material {
  id: number;
  name: string;
  unitId: string;
  dimension: string;
  active: boolean;
}
interface Unit {
  code: string;
  label: string;
  dimension: string;
}

interface ItemRow {
  rawMaterialId: string;
  unitId: string;
  qty: string;
  price: string;
}

const EMPTY_FORM = () => ({
  supplierId: "",
  purchaseDate: todayISO(),
  docNumber: "",
  notes: "",
  items: [{ rawMaterialId: "", unitId: "", qty: "", price: "" }] as ItemRow[],
});

export function PurchasesPage() {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState(EMPTY_FORM());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: "", phone: "", address: "" });
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  // Día visible: por defecto hoy; se cambia con el filtro de fecha.
  const [date, setDate] = useState(todayISO());
  // Alcance: "day" = solo el día elegido (como el dashboard); "all" = todas las compras.
  const [scope, setScope] = useState<"day" | "all">("day");

  const load = useCallback(() => {
    const params = scope === "day" ? `?from=${date}&to=${date}` : "";
    api
      .get<PurchaseRow[]>(`/purchases${params}`)
      .then(setRows)
      .catch((e: ApiError) => setError(e.message));
  }, [date, scope]);
  useEffect(load, [load]);

  const loadFormDeps = async () => {
    try {
      const [s, m, u] = await Promise.all([
        api.get<Supplier[]>("/suppliers"),
        api.get<Material[]>("/materials?active=1"),
        api.get<Unit[]>("/units"),
      ]);
      setSuppliers(s.filter((x) => x.active));
      setMaterials(m.filter((x) => x.active));
      setUnits(u);
      setSuppliersLoaded(true);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const openForm = () => {
    setForm(EMPTY_FORM());
    setError(null);
    setShowNewSupplier(false);
    setSuppliersLoaded(false);
    setView("form");
    void loadFormDeps();
  };

  const setItem = (idx: number, patch: Partial<ItemRow>) => {
    setForm((f) => {
      const items = f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      return { ...f, items };
    });
  };

  const onMaterialChange = (idx: number, materialId: string) => {
    const mat = materials.find((m) => String(m.id) === materialId);
    setItem(idx, {
      rawMaterialId: materialId,
      unitId: mat ? mat.unitId : "",
    });
  };

  const unitOptions = (it: ItemRow): Unit[] => {
    const mat = materials.find((m) => String(m.id) === it.rawMaterialId);
    if (!mat) return [];
    if (mat.dimension === "conteo") return units.filter((u) => u.code === mat.unitId);
    return units.filter((u) => u.dimension === mat.dimension);
  };

  const lineTotal = (it: ItemRow): number => {
    try {
      const qty = parseDecimalToMicro(it.qty);
      const price = parseDecimalToMicro(it.price);
      if (qty <= 0 || price < 0) return 0;
      return mulQtyPrice(qty, price);
    } catch {
      return 0;
    }
  };

  const total = form.items.reduce((acc, it) => addMicro(acc, lineTotal(it)), 0);

  const createSupplierAndUse = async () => {
    setCreatingSupplier(true);
    setError(null);
    try {
      const s = await api.post<Supplier>("/suppliers", {
        name: newSupplier.name.trim(),
        phone: newSupplier.phone.trim() || null,
        address: newSupplier.address.trim() || null,
      });
      setSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, supplierId: String(s.id) }));
      setNewSupplier({ name: "", phone: "", address: "" });
      setShowNewSupplier(false);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setCreatingSupplier(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const items = form.items
        .filter((it) => it.rawMaterialId && it.qty)
        .map((it) => ({
          rawMaterialId: Number(it.rawMaterialId),
          unitId: it.unitId,
          qty: it.qty,
          unitPrice: it.price || "0",
        }));
      if (items.length === 0) throw new ApiError("Agregue al menos un material a la compra.", 400);
      await api.post("/purchases", {
        supplierId: Number(form.supplierId),
        purchaseDate: form.purchaseDate,
        docNumber: form.docNumber || null,
        notes: form.notes || null,
        items,
      });
      setView("list");
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (id: number) => {
    setAnnulReason("");
    try {
      setDetail(await api.get<PurchaseDetail>(`/purchases/${id}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const annul = async () => {
    if (!detail) return;
    if (!window.confirm(`¿Anular la compra #${fmtDocNumber(detail.number)}? Esta acción revierte el inventario y queda auditada.`)) return;
    try {
      await api.post(`/purchases/${detail.id}/annul`, { reason: annulReason });
      setDetail(null);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const filtered = rows.filter(
    (r) =>
      r.supplierName.toLowerCase().includes(q.toLowerCase()) ||
      String(r.number).includes(q) ||
      (r.docNumber ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle="Recepción de materias primas con precio real congelado (PEPS)"
        actions={
          view === "list" ? (
            <button className="btn btn-primary" onClick={openForm}>
              + Nueva compra
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              ← Volver
            </button>
          )
        }
      />
      <FlowGuide current="compras" />
      <ErrorAlert message={error} />

      {view === "list" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar por proveedor o número…" />
            <div className="flex flex-wrap items-center gap-3">
              <ScopeToggle scope={scope} onChange={setScope} />
              {scope === "day" && <DayFilter date={date} onChange={setDate} />}
              <span className="text-sm text-slate-500">{filtered.length} compra(s)</span>
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            {scope === "day"
              ? "Mostrando las compras del día seleccionado. Para ver otro día, cámbielo en el filtro de la derecha."
              : "Mostrando todas las compras registradas."}
          </p>
          <div className="card overflow-hidden">
            <table className="table-ny">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>Documento</th>
                  <th className="num">Ítems</th>
                  <th className="num">Total</th>
                  <th className="center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Sin compras registradas.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono font-semibold">{fmtDocNumber(r.number)}</td>
                    <td>{r.purchaseDate}</td>
                    <td>{r.supplierName}</td>
                    <td>{r.docNumber ?? "—"}</td>
                    <td className="num">{r.itemsCount}</td>
                    <td className="num font-semibold">{fmtMoney(r.totalMicro)}</td>
                    <td className="center">
                      {r.status === "confirmada" ? (
                        <Badge tone="green">Confirmada</Badge>
                      ) : (
                        <Badge tone="red">Anulada</Badge>
                      )}
                    </td>
                    <td className="text-right">
                      <button className="btn btn-secondary" onClick={() => openDetail(r.id)}>
                        Ver
                      </button>
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
          <div className="grid grid-cols-4 gap-3">
            <div className="field">
              <label>Proveedor *</label>
              <select
                value={form.supplierId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setForm({ ...form, supplierId: "" });
                    setShowNewSupplier(true);
                  } else {
                    setForm({ ...form, supplierId: e.target.value });
                    setShowNewSupplier(false);
                  }
                }}
              >
                <option value="">
                  {suppliers.length === 0 ? "Sin proveedores…" : "Seleccione…"}
                </option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="__new__">＋ Nuevo proveedor…</option>
              </select>
            </div>
            <div className="field">
              <label>Fecha *</label>
              <input
                type="date"
                value={form.purchaseDate}
                max={todayISO()}
                onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Nº documento</label>
              <input
                value={form.docNumber}
                onChange={(e) => setForm({ ...form, docNumber: e.target.value })}
                placeholder="Factura, remito…"
              />
            </div>
            <div className="field">
              <label>Notas</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-5 mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">Materiales</h3>
            <button
              className="btn btn-secondary"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  items: [...f.items, { rawMaterialId: "", unitId: "", qty: "", price: "" }],
                }))
              }
            >
              + Agregar línea
            </button>
          </div>

          {(showNewSupplier || (suppliersLoaded && suppliers.length === 0)) && (
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-bold text-blue-800">＋ Nuevo proveedor</div>
                <span className="text-xs text-blue-600">
                  Solo el nombre es obligatorio — se guardará para futuras compras
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="field">
                  <label>Nombre *</label>
                  <input
                    value={newSupplier.name}
                    onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                    placeholder="EJ: Distribuidora X"
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>Teléfono</label>
                  <input
                    value={newSupplier.phone}
                    onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                    placeholder="Opcional"
                  />
                </div>
                <div className="field">
                  <label>Dirección</label>
                  <input
                    value={newSupplier.address}
                    onChange={(e) => setNewSupplier({ ...newSupplier, address: e.target.value })}
                    placeholder="Opcional"
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                {suppliers.length > 0 && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowNewSupplier(false);
                      setNewSupplier({ name: "", phone: "", address: "" });
                    }}
                  >
                    Cancelar
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  disabled={creatingSupplier || newSupplier.name.trim().length < 2}
                  onClick={createSupplierAndUse}
                >
                  {creatingSupplier ? "Guardando…" : "Crear y usar"}
                </button>
              </div>
            </div>
          )}

          <table className="table-ny">
            <thead>
              <tr>
                <th style={{ width: "32%" }}>Materia prima</th>
                <th style={{ width: "14%" }}>Cantidad</th>
                <th style={{ width: "14%" }}>Unidad</th>
                <th style={{ width: "18%" }}>Precio unitario</th>
                <th className="num">Importe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => (
                <tr key={idx}>
                  <td>
                    <select
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                      value={it.rawMaterialId}
                      onChange={(e) => onMaterialChange(idx, e.target.value)}
                    >
                      <option value="">Seleccione…</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-right text-sm"
                      value={it.qty}
                      inputMode="decimal"
                      placeholder="0"
                      onChange={(e) => setItem(idx, { qty: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                      value={it.unitId}
                      onChange={(e) => setItem(idx, { unitId: e.target.value })}
                    >
                      <option value="">—</option>
                      {unitOptions(it).map((u) => (
                        <option key={u.code} value={u.code}>
                          {u.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-right text-sm"
                      value={it.price}
                      inputMode="decimal"
                      placeholder="0.00"
                      onChange={(e) => setItem(idx, { price: e.target.value })}
                    />
                  </td>
                  <td className="num font-semibold">{fmtMoney(lineTotal(it))}</td>
                  <td className="text-center">
                    <button
                      className="text-slate-400 hover:text-red-600"
                      title="Quitar línea"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          items: f.items.filter((_, i) => i !== idx),
                        }))
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right text-sm font-bold">
                  TOTAL
                </td>
                <td className="num text-base font-bold">{fmtMoney(total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !form.supplierId || form.items.length === 0}
            >
              {saving ? "Confirmando…" : "Confirmar compra"}
            </button>
          </div>
        </div>
      )}

      {detail && (
        <Modal title={`Compra #${fmtDocNumber(detail.number)}`} onClose={() => setDetail(null)} wide>
          <ErrorAlert message={error} />
          <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Proveedor</div>
              <div className="font-semibold">{detail.supplierName}</div>
            </div>
            <div>
              <div className="text-slate-500">Fecha</div>
              <div className="font-semibold">{detail.purchaseDate}</div>
            </div>
            <div>
              <div className="text-slate-500">Documento</div>
              <div className="font-semibold">{detail.docNumber ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-500">Estado</div>
              {detail.status === "confirmada" ? (
                <Badge tone="green">Confirmada</Badge>
              ) : (
                <Badge tone="red">Anulada</Badge>
              )}
            </div>
          </div>

          <table className="table-ny">
            <thead>
              <tr>
                <th>Material</th>
                <th className="num">Cantidad</th>
                <th className="num">Precio unit.</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.materialName}</td>
                  <td className="num">{fmtQty(it.qtyMicro, it.unitId)}</td>
                  <td className="num">
                    {fmtMoney(it.unitPriceMicro)}/{it.unitId}
                  </td>
                  <td className="num font-semibold">{fmtMoney(it.lineTotalMicro)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="text-right text-sm font-bold">
                  TOTAL
                </td>
                <td className="num font-bold">{fmtMoney(detail.totalMicro)}</td>
              </tr>
            </tfoot>
          </table>

          {detail.status === "confirmada" && (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-bold text-amber-800">Anular compra</div>
              <p className="mb-2 text-xs text-amber-700">
                Solo es posible si los materiales aún no fueron consumidos. La anulación
                revierte el inventario y queda registrada en auditoría.
              </p>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border border-amber-300 px-3 py-2 text-sm"
                  placeholder="Motivo de la anulación *"
                  value={annulReason}
                  onChange={(e) => setAnnulReason(e.target.value)}
                />
                <button
                  className="btn btn-danger"
                  disabled={annulReason.trim().length < 3}
                  onClick={annul}
                >
                  Anular
                </button>
              </div>
            </div>
          )}

          {detail.status === "anulada" && detail.cancelReason && (
            <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
              <strong>Anulada:</strong> {detail.cancelReason} ({detail.cancelledAt})
            </div>
          )}

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
