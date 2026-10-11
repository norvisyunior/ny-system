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
import { microToDecimal } from "@shared/money";

interface ProductRow {
  id: number;
  name: string;
  category: string | null;
  presentation: string | null;
  saleUnitId: string;
  unitsPerPackage: number;
  priceMicro: number;
  stockMicro: number;
  minStockMicro: number;
  active: boolean;
  stockValueMicro: number;
}

interface ProductDetail {
  product: ProductRow;
  lots: {
    id: number;
    businessDate: string;
    refType: string;
    qtyInitialMicro: number;
    qtyRemainingMicro: number;
    unitCostMicro: number;
  }[];
  movements: {
    id: number;
    businessDate: string;
    movementType: string;
    qtyDeltaMicro: number;
    valueMicro: number;
    notes: string | null;
  }[];
  priceHistory: {
    id: number;
    priceMicro: number;
    validFrom: string;
    reason: string | null;
  }[];
  stockValueMicro: number;
}

interface Unit {
  code: string;
  label: string;
  dimension: string;
}

const EMPTY = {
  name: "",
  category: "",
  presentation: "",
  saleUnitId: "",
  unitsPerPackage: "1",
  price: "",
  minStock: "",
  active: true,
};

export function ProductsPage() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<ProductDetail | null>(null);

  const load = useCallback(() => {
    api.get<ProductRow[]>("/products").then(setRows).catch((e: ApiError) => setError(e.message));
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
  const openEdit = (p: ProductRow) => {
    setForm({
      name: p.name,
      category: p.category ?? "",
      presentation: p.presentation ?? "",
      saleUnitId: p.saleUnitId,
      unitsPerPackage: String(p.unitsPerPackage),
      price: microToDecimal(p.priceMicro, 2),
      minStock: fmtQty(p.minStockMicro, null, 3),
      active: p.active,
    });
    setEditing(p.id);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        category: form.category || null,
        presentation: form.presentation || null,
        saleUnitId: form.saleUnitId,
        unitsPerPackage: Number(form.unitsPerPackage) || 1,
        price: form.price,
        minStock: form.minStock || undefined,
        active: form.active,
      };
      if (editing !== null && editing !== "new") await api.put(`/products/${editing}`, body);
      else await api.post("/products", body);
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
      setDetail(await api.get<ProductDetail>(`/products/${id}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const filtered = rows.filter(
    (p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      (p.category ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  const detailLevel = detail
    ? stockLevel(detail.product.stockMicro, detail.product.minStockMicro)
    : "ok";

  const stockMicro = detail?.product.stockMicro ?? 0;
  const costPerUnitMicro =
    detail && stockMicro > 0 ? Math.round((detail.stockValueMicro * 1_000_000) / stockMicro) : null;
  const profitPerUnitMicro =
    detail && costPerUnitMicro !== null ? detail.product.priceMicro - costPerUnitMicro : null;
  const profitStockMicro =
    profitPerUnitMicro !== null && stockMicro > 0
      ? Math.round((profitPerUnitMicro * stockMicro) / 1_000_000)
      : null;

  return (
    <div>
      <PageHeader
        title="Productos terminados"
        subtitle="Presentación, precios de venta y existencias valorizadas PEPS"
        actions={
          <button className="btn btn-primary" onClick={openNew}>
            + Nuevo producto
          </button>
        }
      />
      <FlowGuide current="catalogos" />
      <ErrorAlert message={error} />

      <div className="mb-4 flex items-center justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre o categoría…" />
        <span className="text-sm text-slate-500">{filtered.length} producto(s)</span>
      </div>

      <div className="card overflow-hidden">
        <table className="table-ny">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Presentación</th>
              <th className="num">Precio</th>
              <th className="center">Stock</th>
              <th className="num">Valor FIFO</th>
              <th className="center">Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">
                  Sin productos registrados.
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const level = stockLevel(p.stockMicro, p.minStockMicro);
              return (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.category ?? "—"}</td>
                  <td className="text-xs text-slate-500">{p.presentation ?? "—"}</td>
                  <td className="num font-semibold">{fmtMoney(p.priceMicro)}</td>
                  <td className="center">
                    <span className={`stock-chip ${level}`}>
                      {fmtQty(p.stockMicro, p.saleUnitId)}
                      {level !== "ok" && <span title="Stock bajo o agotado">⚠</span>}
                    </span>
                  </td>
                  <td className="num">{fmtMoney(p.stockValueMicro)}</td>
                  <td className="center">
                    {p.active ? <Badge tone="green">Activo</Badge> : <Badge tone="red">Inactivo</Badge>}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-secondary mr-2" onClick={() => openDetail(p.id)}>
                      Ver
                    </button>
                    <button className="btn btn-secondary" onClick={() => openEdit(p)}>
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
          title={editing === "new" ? "Nuevo producto" : "Editar producto"}
          onClose={() => setEditing(null)}
        >
          <div className="flex flex-col gap-3">
            <ErrorAlert message={error} />
            <div className="field">
              <label>Nombre *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Empanada estándar"
                autoFocus
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                El nombre debe ser único: no puede repetir el de otro producto.
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Unidad de venta *</label>
                <select
                  value={form.saleUnitId}
                  onChange={(e) => setForm({ ...form, saleUnitId: e.target.value })}
                >
                  <option value="">Seleccione…</option>
                  {units.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.label} ({u.code})
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-slate-500">
                  Cómo se vende al cliente: <strong>Paquete</strong>, <strong>Caja</strong> o{" "}
                  <strong>Unidad</strong>.
                </span>
              </div>
              <div className="field">
                <label>Categoría</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>Presentación</label>
              <input
                value={form.presentation}
                onChange={(e) => setForm({ ...form, presentation: e.target.value })}
                placeholder="caja x 12"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="field">
                <label>Precio de venta ($) *</label>
                <input
                  value={form.price}
                  inputMode="decimal"
                  placeholder="0.00"
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Unidades por paquete</label>
                <input
                  value={form.unitsPerPackage}
                  inputMode="numeric"
                  onChange={(e) => setForm({ ...form, unitsPerPackage: e.target.value })}
                />
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
            <div className="field">
              <label>Estado</label>
              <select
                value={form.active ? "1" : "0"}
                onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}
              >
                <option value="1">Activo</option>
                <option value="0">Inactivo</option>
              </select>
            </div>
            <p className="text-xs text-slate-500">
              Los cambios de precio quedan registrados en el historial; las ventas conservan el
              precio al momento de vender.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={save}
                disabled={saving || !form.name.trim() || !form.saleUnitId || !form.price}
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal
          title={`Producto — ${detail.product.name}`}
          onClose={() => setDetail(null)}
          wide
        >
          <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Stock actual</div>
              <div className="mt-1">
                <span className={`stock-chip hero ${detailLevel}`}>
                  {fmtQty(detail.product.stockMicro, detail.product.saleUnitId)}
                  {detailLevel !== "ok" && <span title="Stock bajo o agotado">⚠</span>}
                </span>
              </div>
              <div className="mt-1">
                <span className="min-tag">mín {fmtQty(detail.product.minStockMicro, detail.product.saleUnitId)}</span>
              </div>
            </div>
            <div>
              <div className="text-slate-500">Valor FIFO</div>
              <div className="font-semibold">{fmtMoney(detail.stockValueMicro)}</div>
            </div>
            <div>
              <div className="text-slate-500">Precio actual</div>
              <div className="font-semibold">{fmtMoney(detail.product.priceMicro)}</div>
            </div>
            <div>
              <div className="text-slate-500">Unidades por paquete</div>
              <div className="font-semibold">{detail.product.unitsPerPackage}</div>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-8 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
            <div>
              <div className="text-slate-500">Costo PEPS / paquete</div>
              <div className="font-semibold">{costPerUnitMicro !== null ? fmtMoney(costPerUnitMicro) : "—"}</div>
            </div>
            <div>
              <div className="text-slate-500">Ganancia / paquete</div>
              <div className="font-semibold text-emerald-700">
                {profitPerUnitMicro !== null ? fmtMoney(profitPerUnitMicro) : "—"}
              </div>
            </div>
            <div>
              <div className="text-slate-500">
                Ganancia al vender el stock
                {stockMicro > 0 ? ` (${fmtQty(stockMicro, detail.product.saleUnitId, 0)})` : ""}
              </div>
              <div className="font-semibold text-emerald-700">
                {profitStockMicro !== null ? fmtMoney(profitStockMicro) : "—"}
              </div>
            </div>
          </div>

          <h3 className="mb-2 text-sm font-bold text-slate-700">Historial de precios</h3>
          <table className="table-ny mb-5">
            <thead>
              <tr>
                <th>Desde</th>
                <th className="num">Precio</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {detail.priceHistory.map((ph) => (
                <tr key={ph.id}>
                  <td>{ph.validFrom}</td>
                  <td className="num font-semibold">{fmtMoney(ph.priceMicro)}</td>
                  <td>{ph.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

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
                  <td className="num">{fmtQty(l.qtyInitialMicro, detail.product.saleUnitId)}</td>
                  <td className="num font-semibold">{fmtQty(l.qtyRemainingMicro, detail.product.saleUnitId)}</td>
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
                    {fmtQty(mv.qtyDeltaMicro, detail.product.saleUnitId)}
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
