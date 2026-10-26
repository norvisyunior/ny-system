import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { microToDecimalTrim } from "@shared/money";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  DayFilter,
  ScopeToggle,
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

interface ProductionRow {
  id: number;
  number: number;
  productionDate: string;
  recipeName: string;
  version: number;
  massName: string;
  expectedYieldMicro: number;
  realYieldMicro: number;
  yieldUnitId: string;
  totalCostMicro: number;
  unitCostMicro: number;
  status: string;
}

interface ProductionDetail {
  id: number;
  number: number;
  productionDate: string;
  recipeName: string;
  version: number;
  massName: string;
  massUnit: string;
  expectedYieldMicro: number;
  realYieldMicro: number;
  yieldUnitId: string;
  totalCostMicro: number;
  unitCostMicro: number;
  laborCostMicro: number;
  status: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  consumptions: {
    id: number;
    materialName: string;
    materialUnit: string;
    qtyMicro: number;
    unitCostMicro: number;
    lineCostMicro: number;
  }[];
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

interface LaborRateRow {
  id: number;
  kind: "masa" | "terminacion";
  massId: number | null;
  productId: number | null;
  itemLabel: string | null;
  rateMicro: number;
  unitLabel: string;
  updatedAt: string | null;
}

interface RecipeVersionDetail {
  id: number;
  status: string;
  expectedYieldMicro: number;
  yieldUnitId: string;
  massName: string | null;
  massUnit: string | null;
}

interface PlanOption {
  id: number;
  number: number;
  planDate: string;
  status: string;
  recipeName: string | null;
  version: number | null;
  productName: string | null;
  targetPackagesMicro: number;
  plannedMassesMicro: number;
  elaboratedMassesMicro: number;
}

interface ConfirmResult {
  id: number;
  number: number;
  duplicated: boolean;
  expectedYieldMicro: number;
  realYieldMicro: number;
  deviationMicro: number;
}

const isPositiveInt = (v: string) => /^\d+$/.test(v) && Number(v) > 0;

/** Monto de mano de obra válido: vacío (usa la tarifa) o número ≥ 0. */
const laborValidText = (v: string): boolean => {
  const t = v.trim().replace(",", ".");
  if (t === "") return true;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0;
};

export function ProductionsPage() {
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [rates, setRates] = useState<LaborRateRow[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState({
    productionDate: todayISO(),
    recipeVersionId: "",
    massesCount: "",
    planId: "",
    responsible: "",
    notes: "",
    laborCost: "",
  });
  // Mano de obra precargada desde la tarifa (editable; vacío = usar la tarifa).
  const [laborDirty, setLaborDirty] = useState(false);
  const [clientToken, setClientToken] = useState(newClientToken);
  const [preview, setPreview] = useState<RecipeVersionDetail | null>(null);
  const [detail, setDetail] = useState<ProductionDetail | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryHandled = useRef(false);

  // Día visible: por defecto hoy; se cambia con el filtro de fecha.
  const [date, setDate] = useState(todayISO());
  // Alcance: "day" = solo el día elegido; "all" = todos los registros.
  const [scope, setScope] = useState<"day" | "all">("day");

  const load = useCallback(() => {
    const params = scope === "day" ? `?from=${date}&to=${date}` : "";
    api
      .get<ProductionRow[]>(`/productions${params}`)
      .then(setRows)
      .catch((e: ApiError) => setError(e.message));
  }, [date, scope]);
  useEffect(load, [load]);
  useEffect(() => {
    Promise.all([
      api.get<RecipeOption[]>("/recipes"),
      api.get<PlanOption[]>("/plans"),
      api.get<LaborRateRow[]>("/labor-rates"),
    ])
      .then(([rs, ps, lr]) => {
        setRecipes(rs.filter((r) => r.active && r.versionId != null));
        setPlans(ps);
        setRates(lr);
      })
      .catch(() => undefined);
  }, []);

  const selectedRecipe = recipes.find((r) => String(r.versionId) === form.recipeVersionId);
  const plansForRecipe = plans.filter(
    (p) =>
      p.status === "planificada" &&
      selectedRecipe != null &&
      p.recipeName === selectedRecipe.name &&
      p.version === selectedRecipe.version,
  );
  const selectedPlan = plansForRecipe.find((p) => String(p.id) === form.planId);

  // Default de mano de obra: tarifa de la masa × masas a elaborar, hasta que
  // el usuario edite el campo (o lo deje vacío para volver a la tarifa).
  useEffect(() => {
    if (laborDirty) return;
    const recipe = recipes.find((r) => String(r.versionId) === form.recipeVersionId);
    if (!recipe || recipe.massId == null) return;
    const n = isPositiveInt(form.massesCount) ? Number(form.massesCount) : null;
    if (n == null) return;
    const rate = rates.find((r) => r.kind === "masa" && r.massId === recipe.massId);
    if (rate) setForm((f) => ({ ...f, laborCost: microToDecimalTrim(rate.rateMicro * n, 2) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laborDirty, rates, recipes, form.recipeVersionId, form.massesCount]);

  const onRecipeChange = (versionId: string) => {
    setForm((f) => ({ ...f, recipeVersionId: versionId, massesCount: "", planId: "" }));
    setLaborDirty(false);
    setPreview(null);
    if (!versionId) return;
    api
      .get<RecipeVersionDetail>(`/recipe-versions/${versionId}`)
      .then(setPreview)
      .catch((e: ApiError) => setError(e.message));
  };

  const openForm = () => {
    setForm({
      productionDate: todayISO(),
      recipeVersionId: "",
      massesCount: "",
      planId: "",
      responsible: "",
      notes: "",
      laborCost: "",
    });
    setLaborDirty(false);
    setClientToken(newClientToken());
    setPreview(null);
    setError(null);
    setView("form");
  };

  // Lanzado desde la ficha de costo: masa/simulación pobran el formulario.
  useEffect(() => {
    const rv = searchParams.get("recipeVersionId");
    if (!rv || queryHandled.current) return;
    queryHandled.current = true;
    setSearchParams({}, { replace: true });
    setView("form");
    setForm({
      productionDate: todayISO(),
      recipeVersionId: rv,
      massesCount: searchParams.get("masses") ?? "",
      planId: "",
      responsible: "",
      notes: "",
      laborCost: "",
    });
    setLaborDirty(false);
    setClientToken(newClientToken());
    setPreview(null);
    setError(null);
    api
      .get<RecipeVersionDetail>(`/recipe-versions/${rv}`)
      .then(setPreview)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Confirmación idempotente por clientToken: un reenvío devuelve el mismo registro.
      await api.post<ConfirmResult>("/productions", {
        productionDate: form.productionDate,
        recipeVersionId: Number(form.recipeVersionId),
        massesCount: form.massesCount,
        laborCost: form.laborCost.trim() === "" ? null : form.laborCost.trim().replace(",", "."),
        planId: form.planId ? Number(form.planId) : null,
        responsible: form.responsible.trim() || null,
        notes: form.notes || null,
        clientToken,
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
      setDetail(await api.get<ProductionDetail>(`/productions/${id}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const annul = async () => {
    if (!detail) return;
    if (
      !window.confirm(
        `¿Anular la producción #${fmtDocNumber(detail.number)}? Esta acción revierte el inventario y queda auditada.`,
      )
    )
      return;
    try {
      await api.post(`/productions/${detail.id}/annul`, { reason: annulReason });
      setDetail(null);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const filtered = rows.filter(
    (r) =>
      r.recipeName.toLowerCase().includes(q.toLowerCase()) ||
      r.massName.toLowerCase().includes(q.toLowerCase()) ||
      String(r.number).includes(q),
  );

  const massesInt = isPositiveInt(form.massesCount);
  const laborValid = laborValidText(form.laborCost);
  const expectedMasses = selectedPlan
    ? selectedPlan.plannedMassesMicro
    : massesInt
      ? Number(form.massesCount) * 1_000_000
      : null;
  const deviationMicro =
    expectedMasses != null && massesInt
      ? Number(form.massesCount) * 1_000_000 - expectedMasses
      : null;

  return (
    <div>
      <PageHeader
        title="Producciones"
        subtitle="Elaboración de masas completas: consumo PEPS de la fase masa, costo real y rendimiento"
        actions={
          view === "list" ? (
            <button className="btn btn-primary" onClick={openForm}>
              + Nueva producción
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              ← Volver
            </button>
          )
        }
      />
      <FlowGuide current="elaboracion" />
      <ErrorAlert message={error} />

      {view === "list" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar por receta, masa o número…" />
            <div className="flex flex-wrap items-center gap-3">
              <ScopeToggle scope={scope} onChange={setScope} />
              {scope === "day" && <DayFilter date={date} onChange={setDate} />}
              <span className="text-sm text-slate-500">{filtered.length} producción(es)</span>
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            {scope === "day"
              ? "Mostrando las elaboraciones del día seleccionado. Para ver otro día, cámbielo en el filtro de la derecha."
              : "Mostrando todas las elaboraciones registradas."}
          </p>
          <div className="card overflow-hidden">
            <table className="table-ny">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fecha</th>
                  <th>Receta</th>
                  <th>Masa</th>
                  <th className="num">Masas esperadas</th>
                  <th className="num">Masas reales</th>
                  <th className="num">Costo total</th>
                  <th className="num">Costo por masa</th>
                  <th className="center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      Sin producciones registradas.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono font-semibold">{fmtDocNumber(r.number)}</td>
                    <td>{r.productionDate}</td>
                    <td>
                      {r.recipeName} <span className="text-slate-400">v{r.version}</span>
                    </td>
                    <td>{r.massName}</td>
                    <td className="num text-slate-500">{fmtQty(r.expectedYieldMicro, r.yieldUnitId)}</td>
                    <td className="num font-semibold">{fmtQty(r.realYieldMicro, r.yieldUnitId)}</td>
                    <td className="num">{fmtMoney(r.totalCostMicro)}</td>
                    <td className="num">{fmtMoney(r.unitCostMicro)}</td>
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
                value={form.productionDate}
                onChange={(e) => setForm({ ...form, productionDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Receta (versión activa) *</label>
              <select
                value={form.recipeVersionId}
                onChange={(e) => onRecipeChange(e.target.value)}
              >
                <option value="">Seleccione…</option>
                {recipes.map((r) => (
                  <option key={r.id} value={String(r.versionId)}>
                    {r.name} (v{r.version} → {r.massName})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Masas a elaborar * (enteras)</label>
              <input
                value={form.massesCount}
                inputMode="numeric"
                placeholder="0"
                onChange={(e) => setForm({ ...form, massesCount: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Responsable</label>
              <input
                value={form.responsible}
                placeholder="Nombre"
                onChange={(e) => setForm({ ...form, responsible: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="field">
              <label>Plan (opcional)</label>
              <select
                value={form.planId}
                onChange={(e) => setForm({ ...form, planId: e.target.value })}
                disabled={!selectedRecipe}
              >
                <option value="">Sin plan</option>
                {plansForRecipe.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    #{String(p.number).padStart(5, "0")} — {p.planDate}:{" "}
                    {fmtQty(p.targetPackagesMicro, null, 0)} paq →{" "}
                    {fmtQty(p.plannedMassesMicro, null, 0)} masas
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Mano de obra de elaboración ($)</label>
              <input
                value={form.laborCost}
                inputMode="decimal"
                placeholder="Tarifa configurada"
                onChange={(e) => {
                  setForm({ ...form, laborCost: e.target.value });
                  setLaborDirty(e.target.value.trim() !== "");
                }}
              />
              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                Se precarga como tarifa × masas a elaborar. Vacío = usa la tarifa configurada; 0 = sin costo.
              </p>
            </div>
            <div className="field">
              <label>Notas</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          {preview && (
            <div className="mt-4 grid grid-cols-4 gap-4 rounded-md bg-slate-50 p-4 text-sm">
              <div>
                <div className="text-slate-500">Masa destino</div>
                <div className="font-semibold">{preview.massName}</div>
              </div>
              <div>
                <div className="text-slate-500">Rendimiento de la receta</div>
                <div className="font-semibold">
                  {fmtQty(preview.expectedYieldMicro, preview.yieldUnitId)} por masa
                </div>
              </div>
              <div>
                <div className="text-slate-500">Masas esperadas</div>
                <div className="font-semibold">
                  {expectedMasses != null
                    ? fmtQty(expectedMasses, preview.massUnit)
                    : "—"}
                  {selectedPlan
                    ? " (según plan)"
                    : !selectedPlan && massesInt
                      ? " (sin plan: igual a las elaboradas)"
                      : ""}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Desviación</div>
                <div className="font-semibold">
                  {deviationMicro != null
                    ? `${deviationMicro > 0 ? "+" : ""}${fmtQty(deviationMicro, preview.massUnit)}`
                    : "—"}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
            Al confirmar se consumen los ingredientes de fase <strong>masa</strong> por PEPS al
            precio real de cada lote, se suma la mano de obra indicada al costo total y se crea el
            lote de masa con su costo unitario real (costo total ÷ masas). Los materiales de fase{" "}
            <strong>paquete</strong> se descuentan al terminar (transformación). El reenvío
            accidental no duplica la operación.
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !form.recipeVersionId || !massesInt || !laborValid}
            >
              {saving ? "Confirmando..." : "Confirmar producción"}
            </button>
          </div>
        </div>
      )}

      {detail && (
        <Modal title={`Producción #${fmtDocNumber(detail.number)}`} onClose={() => setDetail(null)} wide>
          <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Fecha</div>
              <div className="font-semibold">{detail.productionDate}</div>
            </div>
            <div>
              <div className="text-slate-500">Receta</div>
              <div className="font-semibold">
                {detail.recipeName} v{detail.version}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Masa</div>
              <div className="font-semibold">{detail.massName}</div>
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
              <div className="text-slate-500">Masas esperadas</div>
              <div className="font-semibold">{fmtQty(detail.expectedYieldMicro, detail.yieldUnitId)}</div>
            </div>
            <div>
              <div className="text-slate-500">Masas reales</div>
              <div className="font-semibold">{fmtQty(detail.realYieldMicro, detail.yieldUnitId)}</div>
            </div>
            <div>
              <div className="text-slate-500">Costo total</div>
              <div className="font-semibold">{fmtMoney(detail.totalCostMicro)}</div>
            </div>
            <div>
              <div className="text-slate-500">Costo por masa</div>
              <div className="font-semibold">{fmtMoney(detail.unitCostMicro)}</div>
            </div>
          </div>

          <h3 className="mb-2 text-sm font-bold text-slate-700">
            Consumo de materias primas (fase masa)
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
              {detail.consumptions.map((c) => (
                <tr key={c.id}>
                  <td>{c.materialName}</td>
                  <td className="num">{fmtQty(c.qtyMicro, c.materialUnit)}</td>
                  <td className="num">{fmtMoney(c.unitCostMicro)}/{c.materialUnit}</td>
                  <td className="num font-semibold">{fmtMoney(c.lineCostMicro)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {detail.laborCostMicro > 0 && (
                <tr>
                  <td colSpan={3} className="text-right text-sm text-slate-500">
                    Mano de obra (elaboración)
                  </td>
                  <td className="num text-slate-500">{fmtMoney(detail.laborCostMicro)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} className="text-right text-sm font-bold">
                  TOTAL
                </td>
                <td className="num font-bold">{fmtMoney(detail.totalCostMicro)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mb-4 text-xs text-slate-500">
            El costo total incluye la mano de obra de elaboración. Los materiales de fase paquete
            (empaques, etiquetas, etc.) se consumen al terminar la producción, en la transformación.
          </p>

          {detail.status === "confirmada" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-bold text-amber-800">Anular producción</div>
              <p className="mb-2 text-xs text-amber-700">
                Solo es posible si la masa producida aún no fue consumida. La anulación revierte
                los consumos y queda auditada.
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
