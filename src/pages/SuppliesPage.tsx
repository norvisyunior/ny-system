import { useCallback, useEffect, useState } from "react";
import { ArrowDownCircle, Eye, Pencil, SlidersHorizontal } from "lucide-react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { RowAction, RowActions } from "../components/RowActions";
import { StockAdjustModal, type StockAdjustTarget } from "../components/StockAdjustModal";
import {
  Badge,
  ErrorAlert,
  FlowGuide,
  Modal,
  SearchInput,
  fmtMoney,
  fmtQty,
  stockLevel,
  todayISO,
} from "../components/ui";
import { usePaged } from "../hooks/usePaged";

interface Unit {
  code: string;
  label: string;
  dimension: string;
  isBase: number | boolean;
}

interface SupplyListItem {
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

interface SupplyDetail {
  supply: {
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
  lotsTotal: number;
  priceHistory: {
    date: string;
    purchaseNumber: number;
    supplier: string;
    qtyMicro: number;
    unitId: string;
    priceMicro: number;
    lineTotalMicro: number;
  }[];
  priceHistoryTotal: number;
  movements: {
    id: number;
    businessDate: string;
    movementType: string;
    qtyDeltaMicro: number;
    valueMicro: number;
    notes: string | null;
  }[];
  movementsTotal: number;
  stockValueMicro: number;
}

interface ConsumeTarget {
  id: number;
  name: string;
  unitId: string;
  stockMicro: number;
}

const EMPTY = {
  name: "",
  description: "",
  category: "",
  unitId: "unidad",
  minStock: "0",
  active: true,
};

const MOVEMENT_LABELS: Record<string, string> = {
  purchase: "Compra",
  waste: "Merma",
  consumo: "Consumo",
  adjustment_in: "Ajuste (+)",
  adjustment_out: "Ajuste (−)",
  cancel_purchase: "Anulación compra",
};

function movementLabel(type: string): string {
  return MOVEMENT_LABELS[type] ?? type.replace(/_/g, " ");
}

export function SuppliesPage() {
  const list = usePaged<SupplyListItem>(({ page, pageSize, search }) =>
    api.get(
      `/supplies?page=${page}&pageSize=${pageSize}` +
        (search ? `&q=${encodeURIComponent(search)}` : ""),
    ),
  );
  const rows = list.rows;
  const [units, setUnits] = useState<Unit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<(typeof EMPTY & { id: number }) | null>(null);
  const [detail, setDetail] = useState<SupplyDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<StockAdjustTarget | null>(null);
  const [consumeTarget, setConsumeTarget] = useState<ConsumeTarget | null>(null);

  const openDetail = useCallback((id: number) => {
    setError(null);
    api
      .get<SupplyDetail>(`/supplies/${id}`)
      .then(setDetail)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    api.get<Unit[]>("/units").then(setUnits).catch(() => undefined);
  }, []);

  const openNew = () => {
    setForm({ ...EMPTY, id: 0 });
    setError(null);
  };

  const openEdit = async (s: SupplyListItem) => {
    setError(null);
    let description = "";
    try {
      const d = await api.get<SupplyDetail>(`/supplies/${s.id}`);
      description = d.supply.description ?? "";
    } catch (e) {
      setError((e as ApiError).message);
      return;
    }
    setForm({
      id: s.id,
      name: s.name,
      description,
      category: s.category ?? "",
      unitId: s.unitId,
      minStock: fmtQty(s.minStockMicro, null, 3),
      active: s.active,
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
      if (form.id) await api.put(`/supplies/${form.id}`, body);
      else await api.post("/supplies", body);
      setForm(null);
      list.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const DIMENSION_LABEL: Record<string, string> = {
    masa: "Masa (kg, g, lb)",
    volumen: "Volumen (l, ml)",
    longitud: "Longitud (m, cm, mm)",
    conteo: "Conteo (unidad, paquete, caja)",
  };
  const unitGroups = (["conteo", "volumen", "masa", "longitud"] as const)
    .map((dim) => ({ dim, units: units.filter((u) => u.dimension === dim) }))
    .filter((g) => g.units.length > 0);

  const detailLevel = detail
    ? stockLevel(detail.supply.stockMicro, detail.supply.minStockMicro)
    : "ok";

  return (
    <div>
      <PageHeader
        title="Otros insumos"
        subtitle="Consumibles no productivos (limpieza, ferretería, eléctricos…) con stock PEPS"
        actions={
          <button className="btn btn-primary" onClick={openNew}>
            + Nuevo insumo
          </button>
        }
      />
      <FlowGuide current="catalogos" />
      <ErrorAlert message={error ?? list.error} />
      <div className="mb-4 flex items-center justify-between">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar por nombre o categoría…" />
        <span className="text-sm text-slate-500">{list.total} registro(s)</span>
      </div>

      <div className="card overflow-hidden">
        <table className="table-ny inventory-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Categoría</th>
              <th className="center">Stock</th>
              <th className="center">Mínimo</th>
              <th className="num">Última compra</th>
              <th className="num">Valor inventario</th>
              <th className="center">Estado</th>
              <th className="w-32 text-right">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">
                  {list.loading ? "Cargando…" : "Sin insumos registrados."}
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const level = stockLevel(s.stockMicro, s.minStockMicro);
              return (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td>{s.category ?? "—"}</td>
                  <td className="center">
                    <span className={`stock-chip ${level}`}>
                      {fmtQty(s.stockMicro, s.unitId)}
                      {level !== "ok" && <span title="Stock bajo o agotado">⚠</span>}
                    </span>
                  </td>
                  <td className="center">
                    <span className="min-tag">mín {fmtQty(s.minStockMicro, s.unitId)}</span>
                  </td>
                  <td className="num">
                    {s.lastPrice
                      ? `${fmtMoney(s.lastPrice.priceMicro)}/${s.lastPrice.unitId} (${s.lastPrice.date})`
                      : "—"}
                  </td>
                  <td className="num font-semibold">{fmtMoney(s.stockValueMicro)}</td>
                  <td className="center">
                    {s.active ? <Badge tone="green">Activo</Badge> : <Badge tone="red">Inactivo</Badge>}
                  </td>
                  <td className="text-right">
                    <RowActions>
                      <RowAction icon={Eye} label="Ver detalle" onClick={() => openDetail(s.id)} />
                      <RowAction icon={Pencil} label="Editar" onClick={() => openEdit(s)} />
                      <RowAction
                        icon={SlidersHorizontal}
                        label="Ajustar stock o registrar merma"
                        tone="adjust"
                        onClick={() =>
                          setAdjustTarget({
                            itemType: "supply",
                            itemId: s.id,
                            name: s.name,
                            unitId: s.unitId,
                            stockMicro: s.stockMicro,
                          })
                        }
                      />
                      <RowAction
                        icon={ArrowDownCircle}
                        label="Registrar consumo"
                        onClick={() =>
                          setConsumeTarget({
                            id: s.id,
                            name: s.name,
                            unitId: s.unitId,
                            stockMicro: s.stockMicro,
                          })
                        }
                      />
                    </RowActions>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 pb-3">
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            pageSize={list.pageSize}
            rowsCount={rows.length}
            onPage={list.setPage}
            label="insumos"
          />
        </div>
      </div>

      {form && (
        <Modal title={form.id ? "Editar insumo" : "Nuevo insumo"} onClose={() => setForm(null)} wide>
          <div className="flex flex-col gap-3">
            <ErrorAlert message={error} />
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Nombre *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="EJ: Detergente"
                  autoFocus
                />
                <span className="mt-1 block text-[11px] text-slate-500">
                  El nombre debe ser único entre los insumos.
                </span>
              </div>
              <div className="field">
                <label>Categoría</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="EJ: Limpieza"
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
              </div>
              <div className="field">
                <label>Stock mínimo</label>
                <input
                  value={form.minStock}
                  onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                  inputMode="decimal"
                />
                <span className="mt-1 block text-[11px] text-slate-500">
                  Referencia para detectar existencia baja.
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
                <option value="1">Activo</option>
                <option value="0">Inactivo</option>
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
        <Modal title={`Detalle — ${detail.supply.name}`} onClose={() => setDetail(null)} wide>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Stock actual</div>
              <div className="mt-1">
                <span className={`stock-chip hero ${detailLevel}`}>
                  {fmtQty(detail.supply.stockMicro, detail.supply.unitId)}
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
                <span className="min-tag">
                  mín {fmtQty(detail.supply.minStockMicro, detail.supply.unitId)}
                </span>
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
                </tr>
              </thead>
              <tbody>
                {detail.lots.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-400">
                      Sin existencias.
                    </td>
                  </tr>
                )}
                {detail.lots.map((l) => (
                  <tr key={l.id}>
                    <td>{l.businessDate}</td>
                    <td className="capitalize">{l.refType}</td>
                    <td className="num">{fmtQty(l.qtyInitialMicro, detail.supply.unitId)}</td>
                    <td className="num font-semibold">
                      {fmtQty(l.qtyRemainingMicro, detail.supply.unitId)}
                    </td>
                    <td className="num">{fmtMoney(l.unitCostMicro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.lotsTotal > detail.lots.length && (
            <p className="mt-1 text-xs text-slate-500">
              Mostrando los {detail.lots.length} lotes más antiguos de {detail.lotsTotal} pendientes;
              los demás se consumirán después.
            </p>
          )}

          <h3 className="mb-2 mt-5 text-sm font-bold text-slate-700">
            Historial de precios de compra
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
                    <td className="num">
                      {fmtMoney(p.priceMicro)}/{p.unitId}
                    </td>
                    <td className="num">{fmtMoney(p.lineTotalMicro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.priceHistoryTotal > detail.priceHistory.length && (
            <p className="mt-1 text-xs text-slate-500">
              Mostrando las {detail.priceHistory.length} compras más recientes de{" "}
              {detail.priceHistoryTotal}; el historial completo está en Compras.
            </p>
          )}

          <h3 className="mb-2 mt-5 text-sm font-bold text-slate-700">Movimientos recientes</h3>
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
                  <td>{movementLabel(mv.movementType)}</td>
                  <td className={`num ${mv.qtyDeltaMicro < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {mv.qtyDeltaMicro < 0 ? "" : "+"}
                    {fmtQty(mv.qtyDeltaMicro, detail.supply.unitId)}
                  </td>
                  <td className="num">{fmtMoney(mv.valueMicro)}</td>
                  <td className="text-xs text-slate-500">{mv.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.movementsTotal > detail.movements.length && (
            <p className="mt-1 text-xs text-slate-500">
              Mostrando los últimos {detail.movements.length} movimientos de {detail.movementsTotal};
              el historial completo está en Reportes → Auditoría.
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              className="btn btn-secondary mr-auto"
              onClick={() =>
                setAdjustTarget({
                  itemType: "supply",
                  itemId: detail.supply.id,
                  name: detail.supply.name,
                  unitId: detail.supply.unitId,
                  stockMicro: detail.supply.stockMicro,
                })
              }
            >
              Ajustar / Merma
            </button>
            <button
              className="btn btn-primary"
              onClick={() =>
                setConsumeTarget({
                  id: detail.supply.id,
                  name: detail.supply.name,
                  unitId: detail.supply.unitId,
                  stockMicro: detail.supply.stockMicro,
                })
              }
            >
              Registrar consumo
            </button>
            <button className="btn btn-secondary" onClick={() => setDetail(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}

      {adjustTarget && (
        <StockAdjustModal
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onDone={() => {
            list.reload();
            if (detail) openDetail(detail.supply.id);
          }}
        />
      )}

      {consumeTarget && (
        <ConsumeModal
          target={consumeTarget}
          onClose={() => setConsumeTarget(null)}
          onDone={() => {
            list.reload();
            if (detail) openDetail(detail.supply.id);
          }}
        />
      )}
    </div>
  );
}

function ConsumeModal({
  target,
  onClose,
  onDone,
}: {
  target: ConsumeTarget;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setQty("");
    setDate(todayISO());
    setNotes("");
    setError(null);
  }, [target.id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/supplies/${target.id}/consume`, {
        qty: qty.trim(),
        businessDate: date === todayISO() ? undefined : date,
        notes: notes.trim() || null,
      });
      onDone?.();
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Consumo de insumo — ${target.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Stock actual</span>
          <span className="ml-2 font-semibold text-slate-800">
            {fmtQty(target.stockMicro, target.unitId)}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Descuenta del inventario PEPS. No genera gasto: el costo del insumo ya se registró al
          momento de la compra. El consumo queda en el historial de movimientos del insumo.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label>Fecha *</label>
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Cantidad consumida *</label>
            <input
              value={qty}
              inputMode="decimal"
              placeholder="0"
              onChange={(e) => setQty(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="field">
          <label>Notas</label>
          <textarea
            rows={2}
            value={notes}
            placeholder="Ej: limpieza del local, cambio de bombillo…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <ErrorAlert message={error} />
        <div className="mt-2 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || !(Number(qty.trim().replace(",", ".")) > 0)}
          >
            {saving ? "Registrando…" : "Registrar consumo"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
