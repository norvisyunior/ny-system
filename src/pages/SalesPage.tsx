import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  Callout,
  ErrorAlert,
  Modal,
  SearchInput,
  fmtDocNumber,
  fmtMoney,
  fmtQty,
  todayISO,
  FlowGuide,
} from "../components/ui";
import { microToDecimal } from "@shared/money";

interface SaleRow {
  id: number;
  number: number;
  saleDate: string;
  paymentMethod: string;
  subtotalMicro: number;
  discountMicro: number;
  totalMicro: number;
  totalCostMicro: number;
  status: string;
  itemsCount: number;
}

interface SaleDetail {
  id: number;
  number: number;
  saleDate: string;
  paymentMethod: string;
  subtotalMicro: number;
  discountMicro: number;
  totalMicro: number;
  totalCostMicro: number;
  status: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: {
    id: number;
    productName: string;
    saleUnitId: string;
    qtyMicro: number;
    unitPriceMicro: number;
    unitCostMicro: number;
    lineTotalMicro: number;
    lineCostMicro: number;
  }[];
}

interface Product {
  id: number;
  name: string;
  saleUnitId: string;
  priceMicro: number;
  stockMicro: number;
  active: boolean;
}

interface ItemRow {
  productId: string;
  qty: string;
  price: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  otro: "Otro",
};

export function SalesPage() {
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState({
    saleDate: todayISO(),
    paymentMethod: "efectivo",
    discount: "",
    notes: "",
    items: [{ productId: "", qty: "", price: "" }] as ItemRow[],
  });
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get<SaleRow[]>("/sales").then(setRows).catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api
      .get<Product[]>("/products")
      .then((ps) => setProducts(ps.filter((p) => p.active)))
      .catch(() => undefined);
  }, []);

  const openForm = () => {
    setForm({
      saleDate: todayISO(),
      paymentMethod: "efectivo",
      discount: "",
      notes: "",
      items: [{ productId: "", qty: "", price: "" }],
    });
    setError(null);
    setView("form");
  };

  const setItem = (idx: number, patch: Partial<ItemRow>) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  };

  const onProductChange = (idx: number, productId: string) => {
    const prod = products.find((p) => String(p.id) === productId);
    setItem(idx, {
      productId,
      price: prod ? microToDecimal(prod.priceMicro, 2) : "",
      qty: "",
    });
  };

  const lineTotal = (it: ItemRow): number => {
    try {
      const qty = Math.round(Number(it.qty) * 1_000_000);
      const price = Math.round(Number(it.price) * 1_000_000);
      if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price < 0) return 0;
      return Math.round((qty * price) / 1_000_000);
    } catch {
      return 0;
    }
  };

  const subtotal = form.items.reduce((acc, it) => acc + lineTotal(it), 0);
  const discount = (() => {
    try {
      const d = Math.round(Number(form.discount || "0") * 1_000_000);
      return Number.isFinite(d) && d > 0 ? d : 0;
    } catch {
      return 0;
    }
  })();
  const total = Math.max(subtotal - discount, 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const items = form.items
        .filter((it) => it.productId && it.qty)
        .map((it) => ({
          productId: Number(it.productId),
          qty: it.qty,
          unitPrice: it.price || "0",
        }));
      if (items.length === 0) throw new ApiError("Agregue al menos un producto a la venta.", 400);
      await api.post("/sales", {
        saleDate: form.saleDate,
        paymentMethod: form.paymentMethod,
        discount: form.discount || undefined,
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
      setDetail(await api.get<SaleDetail>(`/sales/${id}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const annul = async () => {
    if (!detail) return;
    if (
      !window.confirm(
        `¿Anular la venta #${fmtDocNumber(detail.number)}? Esta acción repone el inventario y queda auditada.`,
      )
    )
      return;
    try {
      await api.post(`/sales/${detail.id}/annul`, { reason: annulReason });
      setDetail(null);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const filtered = rows.filter(
    (r) =>
      String(r.number).includes(q) ||
      r.paymentMethod.toLowerCase().includes(q.toLowerCase()) ||
      r.saleDate.includes(q),
  );

  const canSave = form.items.some((it) => it.productId && it.qty && it.price);

  return (
    <div>
      <PageHeader
        title="Ventas"
        subtitle="Ventas de mostrador con precio y costo congelados al momento de vender"
        actions={
          view === "list" ? (
            <button className="btn btn-primary" onClick={openForm}>
              + Nueva venta
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              ← Volver
            </button>
          )
        }
      />
      <FlowGuide current="ventas" />
      <Callout tone="info" title="Precio y costo se congelan al vender">
        El precio capturado queda guardado en la venta, aunque después cambies el precio del
        producto. El costo de ventas sale del inventario PEPS, y el descuento nunca puede superar
        el subtotal.
      </Callout>
      <Callout tone="tip" title="Sin stock no hay venta">
        Si el producto no alcanza, verás un aviso de stock insuficiente. Revisa el inventario de
        productos o produce más antes de volver a intentar.
      </Callout>
      <ErrorAlert message={error} />

      {view === "list" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar por número, fecha o método…" />
            <span className="text-sm text-slate-500">{filtered.length} venta(s)</span>
          </div>
          <div className="card overflow-hidden">
            <table className="table-ny">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fecha</th>
                  <th>Método</th>
                  <th className="num">Ítems</th>
                  <th className="num">Total</th>
                  <th className="num">Costo de ventas</th>
                  <th className="num">Margen</th>
                  <th className="center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      Sin ventas registradas.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => {
                  const margin = r.totalMicro - r.totalCostMicro;
                  return (
                    <tr key={r.id}>
                      <td className="font-mono font-semibold">{fmtDocNumber(r.number)}</td>
                      <td>{r.saleDate}</td>
                      <td>{PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod}</td>
                      <td className="num">{r.itemsCount}</td>
                      <td className="num font-semibold">{fmtMoney(r.totalMicro)}</td>
                      <td className="num text-slate-500">{fmtMoney(r.totalCostMicro)}</td>
                      <td className={`num font-semibold ${margin < 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {fmtMoney(margin)}
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "form" && (
        <div className="card p-5">
          <div className="grid grid-cols-4 gap-3">
            <div className="field">
              <label>Fecha (día en curso) *</label>
              <input type="date" value={form.saleDate} max={todayISO()} disabled />
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
              <label>Descuento ($)</label>
              <input
                value={form.discount}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
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
            <h3 className="text-sm font-bold text-slate-700">Productos</h3>
            <button
              className="btn btn-secondary"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  items: [...f.items, { productId: "", qty: "", price: "" }],
                }))
              }
            >
              + Agregar línea
            </button>
          </div>

          <table className="table-ny">
            <thead>
              <tr>
                <th style={{ width: "34%" }}>Producto</th>
                <th style={{ width: "14%" }}>Cantidad</th>
                <th style={{ width: "16%" }}>Precio unit.</th>
                <th style={{ width: "12%" }}>Stock</th>
                <th className="num">Importe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => {
                const prod = products.find((p) => String(p.id) === it.productId);
                return (
                  <tr key={idx}>
                    <td>
                      <select
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        value={it.productId}
                        onChange={(e) => onProductChange(idx, e.target.value)}
                      >
                        <option value="">Seleccione…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
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
                      <input
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-right text-sm"
                        value={it.price}
                        inputMode="decimal"
                        placeholder="0.00"
                        onChange={(e) => setItem(idx, { price: e.target.value })}
                      />
                    </td>
                    <td className="num text-xs text-slate-500">
                      {prod ? fmtQty(prod.stockMicro, prod.saleUnitId) : "—"}
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
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right text-sm font-bold">
                  SUBTOTAL
                </td>
                <td className="num font-semibold">{fmtMoney(subtotal)}</td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={4} className="text-right text-sm font-bold">
                  DESCUENTO
                </td>
                <td className="num text-red-600">−{fmtMoney(discount)}</td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={4} className="text-right text-base font-bold">
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
            <button className="btn btn-primary" onClick={save} disabled={saving || !canSave}>
              {saving ? "Confirmando..." : "Confirmar venta"}
            </button>
          </div>
        </div>
      )}

      {detail && (
        <Modal title={`Venta #${fmtDocNumber(detail.number)}`} onClose={() => setDetail(null)} wide>
          <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Fecha</div>
              <div className="font-semibold">{detail.saleDate}</div>
            </div>
            <div>
              <div className="text-slate-500">Método de pago</div>
              <div className="font-semibold">{PAYMENT_LABELS[detail.paymentMethod] ?? detail.paymentMethod}</div>
            </div>
            <div>
              <div className="text-slate-500">Estado</div>
              {detail.status === "confirmada" ? (
                <Badge tone="green">Confirmada</Badge>
              ) : (
                <Badge tone="red">Anulada</Badge>
              )}
            </div>
            <div>
              <div className="text-slate-500">Margen bruto</div>
              <div
                className={`font-semibold ${
                  detail.totalMicro - detail.totalCostMicro < 0 ? "text-red-600" : "text-emerald-700"
                }`}
              >
                {fmtMoney(detail.totalMicro - detail.totalCostMicro)}
              </div>
            </div>
          </div>

          <table className="table-ny">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Cantidad</th>
                <th className="num">Precio unit.</th>
                <th className="num">Importe</th>
                <th className="num">Costo</th>
                <th className="num">Margen</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.productName}</td>
                  <td className="num">{fmtQty(it.qtyMicro, it.saleUnitId)}</td>
                  <td className="num">{fmtMoney(it.unitPriceMicro)}</td>
                  <td className="num font-semibold">{fmtMoney(it.lineTotalMicro)}</td>
                  <td className="num text-slate-500">{fmtMoney(it.lineCostMicro)}</td>
                  <td className="num">{fmtMoney(it.lineTotalMicro - it.lineCostMicro)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="text-right text-sm font-bold">
                  SUBTOTAL
                </td>
                <td className="num font-semibold">{fmtMoney(detail.subtotalMicro)}</td>
                <td colSpan={2}></td>
              </tr>
              <tr>
                <td colSpan={3} className="text-right text-sm font-bold">
                  DESCUENTO
                </td>
                <td className="num text-red-600">−{fmtMoney(detail.discountMicro)}</td>
                <td colSpan={2}></td>
              </tr>
              <tr>
                <td colSpan={3} className="text-right text-base font-bold">
                  TOTAL
                </td>
                <td className="num text-base font-bold">{fmtMoney(detail.totalMicro)}</td>
                <td className="num font-bold">{fmtMoney(detail.totalCostMicro)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          {detail.status === "confirmada" && (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-bold text-amber-800">Anular venta</div>
              <p className="mb-2 text-xs text-amber-700">
                Repone exactamente los lotes consumidos y queda auditada. Solo es posible mientras
                el día no esté cerrado.
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
