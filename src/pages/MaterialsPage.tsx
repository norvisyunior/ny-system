import { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, SlidersHorizontal } from "lucide-react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { RowAction, RowActions } from "../components/RowActions";
import { StockAdjustModal, type StockAdjustTarget } from "../components/StockAdjustModal";
import { Badge, ErrorAlert, FlowGuide, Modal, SearchInput, fmtMoney, fmtQty, stockLevel } from "../components/ui";
import { usePaged } from "../hooks/usePaged";

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
  elaborated: boolean;
  active: boolean;
  stockValueMicro: number;
  lastCost: {
    costMicro: number;
    date: string;
  } | null;
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
    elaborated: boolean;
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
  stockValueMicro: number;
}

const EMPTY = {
  name: "",
  description: "",
  category: "",
  unitId: "kg",
  minStock: "0",
  elaborated: false,
  active: true,
};

export function MaterialsPage() {
  const list = usePaged<MaterialListItem>(({ page, pageSize, search }) =>
    api.get(
      `/materials?page=${page}&pageSize=${pageSize}` +
        (search ? `&q=${encodeURIComponent(search)}` : ""),
    ),
  );
  const rows = list.rows;
  const [units, setUnits] = useState<Unit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<(typeof EMPTY & { id: number }) | null>(null);
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<StockAdjustTarget | null>(null);

  const openDetail = useCallback((id: number) => {
    setError(null);
    api
      .get<MaterialDetail>(`/materials/${id}`)
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
      elaborated: m.elaborated,
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
        elaborated: form.elaborated,
        active: form.active,
      };
      if (form.id) await api.put(`/materials/${form.id}`, body);
      else await api.post("/materials", body);
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
      <ErrorAlert message={error ?? list.error} />
      <div className="mb-4 flex items-center justify-between">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar por nombre…" />
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
              <th className="num">Último costo</th>
              <th className="num">Valor inventario</th>
              <th className="center">Estado</th>
              <th className="w-28 text-right">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">
                  {list.loading ? "Cargando…" : "Sin materias primas registradas."}
                </td>
              </tr>
            )}
            {rows.map((m) => {
              const level = stockLevel(m.stockMicro, m.minStockMicro);
              return (
                <tr key={m.id}>
                  <td className="font-medium">
                    {m.name}
                    {m.elaborated && (
                      <span className="ml-2">
                        <Badge tone="blue">Elaborada</Badge>
                      </span>
                    )}
                  </td>
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
                  <td className="num">
                    {m.lastCost
                      ? `${fmtMoney(m.lastCost.costMicro)}/${m.unitId} (${m.lastCost.date})`
                      : "—"}
                  </td>
                  <td className="num font-semibold">{fmtMoney(m.stockValueMicro)}</td>
                  <td className="center">
                    {m.active ? <Badge tone="green">Activa</Badge> : <Badge tone="red">Inactiva</Badge>}
                  </td>
                  <td className="text-right">
                    <RowActions>
                      <RowAction icon={Eye} label="Ver detalle" onClick={() => openDetail(m.id)} />
                      <RowAction icon={Pencil} label="Editar" onClick={() => openEdit(m)} />
                      <RowAction
                        icon={SlidersHorizontal}
                        label="Ajustar stock o registrar merma"
                        tone="adjust"
                        onClick={() =>
                          setAdjustTarget({
                            itemType: "raw",
                            itemId: m.id,
                            name: m.name,
                            unitId: m.unitId,
                            stockMicro: m.stockMicro,
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
            label="materias primas"
          />
        </div>
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
            <div className="flex items-end gap-6">
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
              <label className="mb-2 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.elaborated}
                  onChange={(e) => setForm({ ...form, elaborated: e.target.checked })}
                />
                <span>
                  Se elabora internamente (también se puede comprar)
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    Podrá producirse en Elaboraciones consumiendo otras materias primas y también
                    registrarse en Compras. Cada entrada lleva su costo real y PEPS decide qué lote
                    se consume.
                  </span>
                </span>
              </label>
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
                      {l.refType === "purchase"
                        ? `Compra #${String(l.refId).padStart(5, "0")}`
                        : l.refType === "elaboration"
                          ? `Elaboración #${String(l.refId).padStart(5, "0")}`
                          : l.refType}
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
          {detail.lotsTotal > detail.lots.length && (
            <p className="mt-1 text-xs text-slate-500">
              Mostrando los {detail.lots.length} lotes más antiguos de {detail.lotsTotal} pendientes; los
              demás se consumirán después.
            </p>
          )}

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
          {detail.priceHistoryTotal > detail.priceHistory.length && (
            <p className="mt-1 text-xs text-slate-500">
              Mostrando las {detail.priceHistory.length} compras más recientes de {detail.priceHistoryTotal};
              el historial completo está en Compras.
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <button
              className="btn btn-secondary mr-auto"
              onClick={() =>
                setAdjustTarget({
                  itemType: "raw",
                  itemId: detail.material.id,
                  name: detail.material.name,
                  unitId: detail.material.unitId,
                  stockMicro: detail.material.stockMicro,
                })
              }
            >
              Ajustar / Merma
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
            if (detail) openDetail(detail.material.id);
          }}
        />
      )}
    </div>
  );
}
