import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  DayFilter,
  ErrorAlert,
  Modal,
  SearchInput,
  fmtDocNumber,
  fmtMoney,
  fmtQty,
  newClientToken,
  todayISO,
  FlowGuide,
} from "../components/ui";

interface TransformationRow {
  id: number;
  number: number;
  transformDate: string;
  massName: string;
  massUnit: string;
  massQtyMicro: number;
  outputsCount: number;
  realPackagesMicro: number;
  expectedPackagesMicro: number;
  deviationMicro: number;
  productName: string | null;
  recipeName: string | null;
  recipeVersion: number | null;
  planId: number | null;
  totalCostMicro: number;
  status: string;
}

interface TransformationDetail {
  id: number;
  number: number;
  transformDate: string;
  massName: string;
  massUnit: string;
  massQtyMicro: number;
  recipeVersionId: number | null;
  recipeName: string | null;
  recipeVersion: number | null;
  productName: string | null;
  planId: number | null;
  expectedPackagesMicro: number;
  deviationMicro: number;
  totalCostMicro: number;
  status: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  consumptions: {
    id: number;
    lotDate: string;
    qtyMicro: number;
    unitCostMicro: number;
    lineCostMicro: number;
  }[];
  materials: {
    id: number;
    rawMaterialId: number;
    materialName: string;
    unitId: string;
    qtyMicro: number;
    unitCostMicro: number;
    lineCostMicro: number;
  }[];
  outputs: {
    id: number;
    productId: number;
    productName: string;
    saleUnitId: string;
    qtyMicro: number;
    costAllocatedMicro: number;
    unitCostMicro: number;
  }[];
}

interface Mass {
  id: number;
  name: string;
  unitId: string;
  stockMicro: number;
  active: boolean;
}
interface Product {
  id: number;
  name: string;
  saleUnitId: string;
  active: boolean;
}
interface RecipeOption {
  id: number;
  name: string;
  active: boolean;
  productId: number | null;
  productName: string | null;
  versionId: number | null;
  version: number | null;
  massId: number | null;
  massName: string | null;
  expectedYieldMicro: number | null;
  yieldUnitId: string | null;
}

interface OutputRow {
  productId: string;
  qty: string;
}

interface ConfirmResult {
  id: number;
  number: number;
  expectedPackagesMicro: number;
  deviationMicro: number;
  duplicated: boolean;
}

interface PackagingLine {
  rawMaterialId: number;
  name: string;
  unitId: string;
  itemUnitId: string;
  qtyPerPackageMicro: number;
  neededMicro: number;
  availableMicro: number;
  missingMicro: number;
  avgCostMicro: number;
  estimatedCostMicro: number;
}

interface PackagingPreview {
  recipeName: string;
  version: number;
  realPackagesMicro: number;
  packaging: PackagingLine[];
}

const toMicro = (v: string) => Math.round(Number(v) * 1_000_000);

export function TransformationsPage() {
  const [rows, setRows] = useState<TransformationRow[]>([]);
  const [masses, setMasses] = useState<Mass[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState({
    transformDate: todayISO(),
    massId: "",
    massQty: "",
    recipeVersionId: "",
    notes: "",
    outputs: [{ productId: "", qty: "" }] as OutputRow[],
  });
  const [clientToken, setClientToken] = useState(newClientToken);
  const [detail, setDetail] = useState<TransformationDetail | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [packPreview, setPackPreview] = useState<PackagingPreview | null>(null);

  // Día visible: por defecto hoy; se cambia con el filtro de fecha.
  const [date, setDate] = useState(todayISO());

  const load = useCallback(() => {
    api
      .get<TransformationRow[]>(`/transformations?from=${date}&to=${date}`)
      .then(setRows)
      .catch((e: ApiError) => setError(e.message));
  }, [date]);
  useEffect(load, [load]);
  useEffect(() => {
    Promise.all([
      api.get<Mass[]>("/masses"),
      api.get<Product[]>("/products"),
      api.get<RecipeOption[]>("/recipes"),
    ])
      .then(([m, p, r]) => {
        setMasses(m.filter((x) => x.active));
        setProducts(p.filter((x) => x.active));
        setRecipes(r.filter((x) => x.active && x.versionId != null && x.productId != null));
      })
      .catch(() => undefined);
  }, []);

  const selectedRecipe = recipes.find((r) => String(r.versionId) === form.recipeVersionId);
  const recipeLocked = Boolean(selectedRecipe);
  const selectedMass = masses.find((m) => String(m.id) === form.massId);

  // Paquetes esperados = masas consumidas × rendimiento esperado (divRoundAway).
  const expectedMicro =
    recipeLocked && selectedRecipe?.expectedYieldMicro && form.massQty && Number(form.massQty) > 0
      ? Math.floor(
          (toMicro(form.massQty) * selectedRecipe.expectedYieldMicro) / 1_000_000 + 0.5,
        )
      : null;
  const realMicro = form.outputs.reduce(
    (acc, o) => acc + (o.qty && Number(o.qty) > 0 ? toMicro(o.qty) : 0),
    0,
  );
  const deviationMicro = expectedMicro != null ? realMicro - expectedMicro : null;

  // Empaques de fase paquete que se consumirán según los paquetes reales (solo cálculo).
  useEffect(() => {
    if (!form.recipeVersionId || realMicro <= 0) {
      setPackPreview(null);
      return;
    }
    let cancelled = false;
    api
      .post<PackagingPreview>("/transformations/preview", {
        recipeVersionId: Number(form.recipeVersionId),
        realPackages: realMicro / 1_000_000,
      })
      .then((p) => {
        if (!cancelled) setPackPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPackPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [form.recipeVersionId, realMicro]);

  const openForm = () => {
    setForm({
      transformDate: todayISO(),
      massId: "",
      massQty: "",
      recipeVersionId: "",
      notes: "",
      outputs: [{ productId: "", qty: "" }],
    });
    setClientToken(newClientToken());
    setError(null);
    setPackPreview(null);
    setView("form");
  };

  const setOutput = (idx: number, patch: Partial<OutputRow>) => {
    setForm((f) => ({
      ...f,
      outputs: f.outputs.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
    }));
  };

  const onRecipeChange = (versionId: string) => {
    setForm((f) => {
      const recipe = recipes.find((r) => String(r.versionId) === versionId);
      if (!recipe) return { ...f, recipeVersionId: "", outputs: [{ productId: "", qty: "" }] };
      return {
        ...f,
        recipeVersionId: versionId,
        massId: recipe.massId != null ? String(recipe.massId) : f.massId,
        outputs: [{ productId: recipe.productId != null ? String(recipe.productId) : "", qty: "" }],
      };
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Confirmación idempotente por clientToken: un reenvío devuelve el mismo registro.
      await api.post<ConfirmResult>("/transformations", {
        transformDate: form.transformDate,
        massId: Number(form.massId),
        massQty: form.massQty,
        recipeVersionId: form.recipeVersionId ? Number(form.recipeVersionId) : null,
        notes: form.notes || null,
        clientToken,
        outputs: form.outputs
          .filter((o) => o.productId && o.qty)
          .map((o) => ({ productId: Number(o.productId), qty: o.qty })),
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
      setDetail(await api.get<TransformationDetail>(`/transformations/${id}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const annul = async () => {
    if (!detail) return;
    if (
      !window.confirm(
        `¿Anular la transformación #${fmtDocNumber(detail.number)}? Esta acción revierte el inventario y queda auditada.`,
      )
    )
      return;
    try {
      await api.post(`/transformations/${detail.id}/annul`, { reason: annulReason });
      setDetail(null);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const filtered = rows.filter(
    (r) =>
      r.massName.toLowerCase().includes(q.toLowerCase()) ||
      (r.recipeName ?? "").toLowerCase().includes(q.toLowerCase()) ||
      String(r.number).includes(q),
  );

  const canSave =
    Boolean(form.massId) &&
    Boolean(form.massQty) &&
    form.outputs.some((o) => o.productId && o.qty);

  return (
    <div>
      <PageHeader
        title="Transformación"
        subtitle="Terminación masa → productos: consumo PEPS, materiales de empaque y desviación real vs esperada"
        actions={
          view === "list" ? (
            <button className="btn btn-primary" onClick={openForm}>
              + Nueva transformación
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              ← Volver
            </button>
          )
        }
      />
      <FlowGuide current="terminacion" />
      <ErrorAlert message={error} />

      {view === "list" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar por masa, receta o número…" />
            <div className="flex items-center gap-3">
              <DayFilter date={date} onChange={setDate} />
              <span className="text-sm text-slate-500">{filtered.length} transformación(es)</span>
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Mostrando las terminaciones del día seleccionado. Para ver otro día, cámbielo en el
            filtro de la derecha.
          </p>
          <div className="card overflow-hidden">
            <table className="table-ny">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fecha</th>
                  <th>Masa consumida</th>
                  <th>Receta</th>
                  <th className="num">Esperado</th>
                  <th className="num">Real</th>
                  <th className="num">Desviación</th>
                  <th className="num">Costo total</th>
                  <th className="center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      Sin transformaciones registradas.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono font-semibold">{fmtDocNumber(r.number)}</td>
                    <td>{r.transformDate}</td>
                    <td>{fmtQty(r.massQtyMicro, r.massUnit)} de {r.massName}</td>
                    <td>
                      {r.recipeName ? (
                        <>
                          {r.recipeName} <span className="text-slate-400">v{r.recipeVersion}</span>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="num text-slate-500">
                      {r.recipeName && r.expectedPackagesMicro > 0
                        ? fmtQty(r.expectedPackagesMicro, null, 0)
                        : "—"}
                    </td>
                    <td className="num font-semibold">
                      {fmtQty(r.realPackagesMicro, null, 0)}
                    </td>
                    <td className="num">
                      {!r.recipeName || r.expectedPackagesMicro <= 0 ? (
                        "—"
                      ) : r.deviationMicro === 0 ? (
                        <span className="text-slate-500">0</span>
                      ) : r.deviationMicro > 0 ? (
                        <Badge tone="green">+{fmtQty(r.deviationMicro, null, 0)}</Badge>
                      ) : (
                        <Badge tone="red">{fmtQty(r.deviationMicro, null, 0)}</Badge>
                      )}
                    </td>
                    <td className="num font-semibold">{fmtMoney(r.totalCostMicro)}</td>
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
              <label>Fecha *</label>
              <input
                type="date"
                max={todayISO()}
                value={form.transformDate}
                onChange={(e) => setForm({ ...form, transformDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Receta (opcional)</label>
              <select
                value={form.recipeVersionId}
                onChange={(e) => onRecipeChange(e.target.value)}
              >
                <option value="">Sin receta (automático)</option>
                {recipes.map((r) => (
                  <option key={r.id} value={String(r.versionId)}>
                    {r.productName ?? r.name} (v{r.version})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Masa *</label>
              <select
                value={form.massId}
                onChange={(e) => setForm({ ...form, massId: e.target.value, massQty: "" })}
                disabled={recipeLocked}
              >
                <option value="">Seleccione…</option>
                {masses.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (stock: {fmtQty(m.stockMicro, m.unitId)})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Cantidad de masas a consumir * {selectedMass ? `(${selectedMass.unitId})` : ""}</label>
              <input
                value={form.massQty}
                inputMode="decimal"
                placeholder="0"
                onChange={(e) => setForm({ ...form, massQty: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-5 mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-700">Productos de salida</h3>
              {recipeLocked && (
                <p className="text-xs text-slate-500">
                  La receta define un único producto de salida: {selectedRecipe?.productName}.
                </p>
              )}
            </div>
            {!recipeLocked && (
              <button
                className="btn btn-secondary"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    outputs: [...f.outputs, { productId: "", qty: "" }],
                  }))
                }
              >
                + Agregar producto
              </button>
            )}
          </div>

          <table className="table-ny">
            <thead>
              <tr>
                <th style={{ width: "60%" }}>Producto</th>
                <th>Paquetes reales obtenidos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {form.outputs.map((o, idx) => {
                const prod = products.find((p) => String(p.id) === o.productId);
                const lockedRow = recipeLocked && idx === 0;
                return (
                  <tr key={idx}>
                    <td>
                      <select
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        value={o.productId}
                        disabled={lockedRow}
                        onChange={(e) => setOutput(idx, { productId: e.target.value })}
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
                        value={o.qty}
                        inputMode="decimal"
                        placeholder={prod ? `0 ${prod.saleUnitId}` : "0"}
                        onChange={(e) => setOutput(idx, { qty: e.target.value })}
                      />
                    </td>
                    <td className="text-center">
                      {lockedRow ? (
                        <span className="text-xs text-slate-400">Según receta</span>
                      ) : (
                        <button
                          className="text-slate-400 hover:text-red-600"
                          title="Quitar línea"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              outputs: f.outputs.filter((_, i) => i !== idx),
                            }))
                          }
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {expectedMicro != null && (
            <div className="mt-4 grid grid-cols-3 gap-4 rounded-md bg-slate-50 p-4 text-sm">
              <div>
                <div className="text-slate-500">Paquetes esperados (receta)</div>
                <div className="font-semibold">{fmtQty(expectedMicro, null, 0)}</div>
              </div>
              <div>
                <div className="text-slate-500">Paquetes reales (salidas)</div>
                <div className="font-semibold">{fmtQty(realMicro, null, 0)}</div>
              </div>
              <div>
                <div className="text-slate-500">Desviación</div>
                <div className="font-semibold">
                  {deviationMicro != null
                    ? `${deviationMicro > 0 ? "+" : ""}${fmtQty(deviationMicro, null, 0)}`
                    : "—"}
                </div>
              </div>
            </div>
          )}

          {packPreview && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-bold text-slate-700">
                Empaques que se consumirán (según paquetes reales)
              </h3>
              {packPreview.packaging.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
                  La receta {packPreview.recipeName} v{packPreview.version} no tiene empaques
                  definidos en su bloque "Paquete (al terminar)".
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-slate-500">
                    Se descuentan de la materia prima al confirmar, por cada paquete realmente
                    empaquetado ({fmtQty(packPreview.realPackagesMicro, null, 0)} paq.).
                  </p>
                  <table className="table-ny">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th className="num">Por paquete</th>
                        <th className="num">Necesario</th>
                        <th className="num">Disponible</th>
                        <th className="num">Faltante</th>
                        <th className="num">Costo est.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packPreview.packaging.map((l) => (
                        <tr key={l.rawMaterialId}>
                          <td>{l.name}</td>
                          <td className="num text-slate-500">
                            {fmtQty(l.qtyPerPackageMicro, l.itemUnitId)}
                          </td>
                          <td className="num font-semibold">
                            {fmtQty(l.neededMicro, l.unitId)}
                          </td>
                          <td className="num">{fmtQty(l.availableMicro, l.unitId)}</td>
                          <td className="num">
                            {l.missingMicro > 0 ? (
                              <span className="font-semibold text-red-600">
                                {fmtQty(l.missingMicro, l.unitId)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="num">{fmtMoney(l.estimatedCostMicro)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="field">
              <label>Notas</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
            El costo de la masa consumida (PEPS) y, si hay receta, los materiales de fase
            <strong> paquete</strong> (calculados sobre los paquetes REALES) se reparten
            proporcionalmente entre los productos de salida. Los paquetes esperados y la
            desviación quedan guardados en el histórico. El reenvío accidental no duplica la
            operación.
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !canSave}>
              {saving ? "Confirmando..." : "Confirmar transformación"}
            </button>
          </div>
        </div>
      )}

      {detail && (
        <Modal
          title={`Transformación #${fmtDocNumber(detail.number)}`}
          onClose={() => setDetail(null)}
          wide
        >
          <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Fecha</div>
              <div className="font-semibold">{detail.transformDate}</div>
            </div>
            <div>
              <div className="text-slate-500">Masa consumida</div>
              <div className="font-semibold">
                {fmtQty(detail.massQtyMicro, detail.massUnit)} de {detail.massName}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Receta</div>
              <div className="font-semibold">
                {detail.recipeName ? (
                  <>
                    {detail.recipeName} <span className="text-slate-400">v{detail.recipeVersion}</span>
                  </>
                ) : (
                  "—"
                )}
              </div>
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

          <div className="mb-4 grid grid-cols-4 gap-4 rounded-md bg-slate-50 p-4 text-sm">
            <div>
              <div className="text-slate-500">Paquetes esperados</div>
              <div className="font-semibold">
                {detail.recipeName && detail.expectedPackagesMicro > 0
                  ? fmtQty(detail.expectedPackagesMicro, null, 0)
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Paquetes reales</div>
              <div className="font-semibold">
                {fmtQty(
                  detail.outputs.reduce((acc, o) => acc + o.qtyMicro, 0),
                  null,
                  0,
                )}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Desviación</div>
              <div className="font-semibold">
                {!detail.recipeName || detail.expectedPackagesMicro <= 0
                  ? "—"
                  : `${detail.deviationMicro > 0 ? "+" : ""}${fmtQty(detail.deviationMicro, null, 0)}`}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Costo total</div>
              <div className="font-semibold">{fmtMoney(detail.totalCostMicro)}</div>
            </div>
          </div>

          <h3 className="mb-2 text-sm font-bold text-slate-700">Productos generados</h3>
          <table className="table-ny mb-4">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Cantidad</th>
                <th className="num">Costo asignado</th>
                <th className="num">Costo unit.</th>
              </tr>
            </thead>
            <tbody>
              {detail.outputs.map((o) => (
                <tr key={o.id}>
                  <td>{o.productName}</td>
                  <td className="num">{fmtQty(o.qtyMicro, o.saleUnitId)}</td>
                  <td className="num">{fmtMoney(o.costAllocatedMicro)}</td>
                  <td className="num font-semibold">{fmtMoney(o.unitCostMicro)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="text-right text-sm font-bold">
                  TOTAL
                </td>
                <td className="num font-bold">{fmtMoney(detail.totalCostMicro)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          {detail.materials.length > 0 && (
            <>
              <h3 className="mb-2 text-sm font-bold text-slate-700">
                Materiales de empaque consumidos (fase paquete)
              </h3>
              <table className="table-ny mb-4">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Costo unit.</th>
                    <th className="num">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.materials.map((m) => (
                    <tr key={m.id}>
                      <td>{m.materialName}</td>
                      <td className="num">{fmtQty(m.qtyMicro, m.unitId)}</td>
                      <td className="num">{fmtMoney(m.unitCostMicro)}</td>
                      <td className="num font-semibold">{fmtMoney(m.lineCostMicro)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3 className="mb-2 text-sm font-bold text-slate-700">Lotes de masa consumidos</h3>
          <table className="table-ny mb-4">
            <thead>
              <tr>
                <th>Fecha del lote</th>
                <th className="num">Cantidad</th>
                <th className="num">Costo unit.</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {detail.consumptions.map((c) => (
                <tr key={c.id}>
                  <td>{c.lotDate}</td>
                  <td className="num">{fmtQty(c.qtyMicro, detail.massUnit)}</td>
                  <td className="num">{fmtMoney(c.unitCostMicro)}</td>
                  <td className="num font-semibold">{fmtMoney(c.lineCostMicro)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {detail.status === "confirmada" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-bold text-amber-800">Anular transformación</div>
              <p className="mb-2 text-xs text-amber-700">
                Solo es posible si los productos generados aún no fueron vendidos. La anulación
                revierte el inventario (incluidos los materiales de empaque) y queda auditada.
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
