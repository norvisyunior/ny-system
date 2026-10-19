import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
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

interface PlanRow {
  id: number;
  number: number;
  planDate: string;
  status: string;
  recipeName: string | null;
  version: number | null;
  productName: string | null;
  massName: string | null;
  targetPackagesMicro: number;
  expectedYieldMicro: number;
  plannedMassesMicro: number;
  elaboratedMassesMicro: number;
  notes: string | null;
  createdAt: string;
}

interface PlanMaterialLine {
  rawMaterialId: number;
  name: string;
  unitId: string;
  itemUnitId?: string;
  phase: "masa" | "paquete";
  perMasaMicro: number | null;
  perPaqueteMicro: number | null;
  qtyNeededMicro: number;
  availableMicro: number;
  missingMicro: number;
  avgCostMicro: number;
  estimatedCostMicro: number;
}

interface PlanPreview {
  recipeId: number;
  recipeVersionId: number;
  recipeName: string;
  version: number;
  productId: number;
  productName: string;
  productSaleUnit: string;
  massId: number;
  massName: string;
  massUnit: string;
  targetPackagesMicro: number;
  expectedYieldMicro: number;
  plannedMassesMicro: number;
  ingredients: PlanMaterialLine[];
  packaging: PlanMaterialLine[];
  estimatedTotalCostMicro: number;
  estimatedCostPerPackageMicro: number;
  warnings: string[];
}

interface PlanDetail {
  id: number;
  number: number;
  planDate: string;
  recipeVersionId: number;
  targetPackagesMicro: number;
  expectedYieldMicro: number;
  plannedMassesMicro: number;
  status: string;
  notes: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  preview: PlanPreview | null;
  productions: {
    id: number;
    number: number;
    productionDate: string;
    realYieldMicro: number;
    yieldUnitId: string;
    totalCostMicro: number;
    status: string;
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
  massName: string | null;
  expectedYieldMicro: number | null;
  yieldUnitId: string | null;
}

const isPositiveInt = (v: string) => /^\d+$/.test(v) && Number(v) > 0;

function MaterialTable({
  title,
  perLabel,
  lines,
}: {
  title: string;
  perLabel: string;
  lines: PlanMaterialLine[];
}) {
  if (lines.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-bold text-slate-700">{title}</h3>
      <table className="table-ny">
        <thead>
          <tr>
            <th>Material</th>
            <th className="num">{perLabel}</th>
            <th className="num">Necesario</th>
            <th className="num">Disponible</th>
            <th className="num">Faltante</th>
            <th className="num">Costo est.</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const per = l.perMasaMicro ?? l.perPaqueteMicro;
            return (
              <tr key={l.rawMaterialId}>
                <td>{l.name}</td>
                <td className="num text-slate-500">
                  {per != null ? fmtQty(per, l.itemUnitId ?? l.unitId) : "—"}
                </td>
                <td className="num">{fmtQty(l.qtyNeededMicro, l.unitId)}</td>
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
                <td className="num font-semibold">{fmtMoney(l.estimatedCostMicro)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WarningsBox({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
      <div className="mb-1 font-bold">AVISOS DE DISPONIBILIDAD</div>
      <ul className="list-disc pl-5">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

export function PlanningPage() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState({
    planDate: todayISO(),
    recipeVersionId: "",
    targetPackages: "",
    notes: "",
  });
  const [clientToken, setClientToken] = useState(newClientToken);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; number: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Día visible: por defecto hoy; se cambia con el filtro de fecha.
  const [date, setDate] = useState(todayISO());
  // Alcance: "day" = solo el día elegido; "all" = todos los registros.
  const [scope, setScope] = useState<"day" | "all">("day");

  const load = useCallback(() => {
    const params = scope === "day" ? `?from=${date}&to=${date}` : "";
    api
      .get<PlanRow[]>(`/plans${params}`)
      .then(setRows)
      .catch((e: ApiError) => setError(e.message));
  }, [date, scope]);
  useEffect(load, [load]);
  useEffect(() => {
    api
      .get<RecipeOption[]>("/recipes")
      .then((rs) =>
        setRecipes(
          rs.filter((r) => r.active && r.versionId != null && r.productId != null),
        ),
      )
      .catch(() => undefined);
  }, []);

  // Vista previa automática (solo cálculo; nunca descuenta inventario).
  useEffect(() => {
    if (!form.recipeVersionId || !isPositiveInt(form.targetPackages)) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    api
      .post<PlanPreview>("/plans/preview", {
        recipeVersionId: Number(form.recipeVersionId),
        targetPackages: form.targetPackages,
      })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [form.recipeVersionId, form.targetPackages]);

  const openForm = () => {
    setForm({ planDate: todayISO(), recipeVersionId: "", targetPackages: "", notes: "" });
    setClientToken(newClientToken());
    setPreview(null);
    setError(null);
    setView("form");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post("/plans", {
        planDate: form.planDate,
        recipeVersionId: Number(form.recipeVersionId),
        targetPackages: form.targetPackages,
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
      setDetail(await api.get<PlanDetail>(`/plans/${id}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const annul = async () => {
    if (!detail) return;
    if (
      !window.confirm(
        `¿Anular el plan #${fmtDocNumber(detail.number)}? Queda auditado; no se borra ningún registro.`,
      )
    )
      return;
    try {
      await api.post(`/plans/${detail.id}/annul`, { reason: annulReason });
      setDetail(null);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const askDelete = (target: { id: number; number: number }) => {
    setDeleteError(null);
    setDeleteTarget(target);
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/plans/${deleteTarget.id}`);
      if (detail?.id === deleteTarget.id) setDetail(null);
      setDeleteTarget(null);
      load();
    } catch (e) {
      setDeleteError((e as ApiError).message);
    }
  };

  const filtered = rows.filter(
    (r) =>
      (r.productName ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (r.recipeName ?? "").toLowerCase().includes(q.toLowerCase()) ||
      String(r.number).includes(q),
  );

  const canSave =
    Boolean(form.recipeVersionId) && isPositiveInt(form.targetPackages) && Boolean(form.planDate);

  return (
    <div>
      <PageHeader
        title="Planes de producción"
        subtitle="Planificación inversa: de los paquetes deseados a las masas y materiales necesarios (sin descontar inventario)"
        actions={
          view === "list" ? (
            <button className="btn btn-primary" onClick={openForm}>
              + Nuevo plan
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              ← Volver
            </button>
          )
        }
      />
      <FlowGuide current="planes" />
      <ErrorAlert message={error} />

      {view === "list" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar por producto, receta o número…" />
            <div className="flex flex-wrap items-center gap-3">
              <ScopeToggle scope={scope} onChange={setScope} />
              {scope === "day" && <DayFilter date={date} onChange={setDate} />}
              <span className="text-sm text-slate-500">{filtered.length} plan(es)</span>
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            {scope === "day"
              ? "Mostrando los planes del día seleccionado. Para ver otro día, cámbielo en el filtro de la derecha."
              : "Mostrando todos los planes registrados."}
          </p>
          <div className="card overflow-hidden">
            <table className="table-ny">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Receta</th>
                  <th className="num">Meta (paq.)</th>
                  <th className="num">Masas plan</th>
                  <th className="num">Elaboradas</th>
                  <th className="center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      Sin planes registrados.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono font-semibold">{fmtDocNumber(r.number)}</td>
                    <td>{r.planDate}</td>
                    <td>{r.productName ?? "—"}</td>
                    <td>
                      {r.recipeName ? (
                        <>
                          {r.recipeName} <span className="text-slate-400">v{r.version}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">{fmtQty(r.targetPackagesMicro, null, 0)}</td>
                    <td className="num">{fmtQty(r.plannedMassesMicro, null, 0)}</td>
                    <td className="num font-semibold">
                      {fmtQty(r.elaboratedMassesMicro, null, 0)}
                    </td>
                    <td className="center">
                      {r.status === "planificada" ? (
                        <Badge tone="blue">Planificada</Badge>
                      ) : (
                        <Badge tone="red">Anulada</Badge>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <button className="btn btn-secondary" onClick={() => openDetail(r.id)}>
                          Ver
                        </button>
                        <button className="btn btn-danger" onClick={() => askDelete(r)}>
                          Eliminar
                        </button>
                      </div>
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
              <label>Fecha del plan *</label>
              <input
                type="date"
                max={todayISO()}
                value={form.planDate}
                onChange={(e) => setForm({ ...form, planDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Receta (versión activa) *</label>
              <select
                value={form.recipeVersionId}
                onChange={(e) => setForm({ ...form, recipeVersionId: e.target.value })}
              >
                <option value="">Seleccione…</option>
                {recipes.map((r) => (
                  <option key={r.id} value={String(r.versionId)}>
                    {r.productName ?? r.name} (v{r.version})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Paquetes deseados * (enteros)</label>
              <input
                value={form.targetPackages}
                inputMode="numeric"
                placeholder="0"
                onChange={(e) => setForm({ ...form, targetPackages: e.target.value })}
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

          {preview && (
            <>
              <div className="mt-4 grid grid-cols-5 gap-4 rounded-md bg-slate-50 p-4 text-sm">
                <div>
                  <div className="text-slate-500">Producto</div>
                  <div className="font-semibold">{preview.productName}</div>
                </div>
                <div>
                  <div className="text-slate-500">Masa destino</div>
                  <div className="font-semibold">{preview.massName}</div>
                </div>
                <div>
                  <div className="text-slate-500">Rendimiento</div>
                  <div className="font-semibold">
                    {fmtQty(preview.expectedYieldMicro, preview.productSaleUnit)} por masa
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Masas necesarias (techo)</div>
                  <div className="font-semibold">
                    {fmtQty(preview.plannedMassesMicro, preview.massUnit)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Costo estimado / paquete</div>
                  <div className="font-semibold">
                    {fmtMoney(preview.estimatedCostPerPackageMicro)}
                  </div>
                </div>
              </div>

              <WarningsBox warnings={preview.warnings} />

              <MaterialTable
                title="Ingredientes (fase masa — se consumen al elaborar)"
                perLabel="Por masa"
                lines={preview.ingredients}
              />
              <MaterialTable
                title="Empaques (fase paquete — se consumen por paquete)"
                perLabel="Por paquete"
                lines={preview.packaging}
              />

              <div className="rounded-md bg-slate-50 px-4 py-3 text-sm">
                <span className="text-slate-500">Costo total estimado: </span>
                <span className="font-semibold">{fmtMoney(preview.estimatedTotalCostMicro)}</span>
              </div>
            </>
          )}

          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
            El plan solo calcula y registra la intención: <strong>no descuenta inventario</strong>.
            Las masas necesarias se obtienen con techo (ceil) sobre el rendimiento esperado. Al
            elaborar, vincule la producción al plan para comparar planificado vs real.
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !canSave}>
              {saving ? "Guardando..." : "Crear plan"}
            </button>
          </div>
        </div>
      )}

      {detail && (
        <Modal title={`Plan #${fmtDocNumber(detail.number)}`} onClose={() => setDetail(null)} wide>
          <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Fecha</div>
              <div className="font-semibold">{detail.planDate}</div>
            </div>
            <div>
              <div className="text-slate-500">Producto</div>
              <div className="font-semibold">{detail.preview?.productName ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-500">Receta</div>
              <div className="font-semibold">
                {detail.preview
                  ? `${detail.preview.recipeName} v${detail.preview.version}`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Estado</div>
              {detail.status === "planificada" ? (
                <Badge tone="blue">Planificada</Badge>
              ) : (
                <Badge tone="red">Anulada</Badge>
              )}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-4 gap-4 rounded-md bg-slate-50 p-4 text-sm">
            <div>
              <div className="text-slate-500">Meta de paquetes</div>
              <div className="font-semibold">{fmtQty(detail.targetPackagesMicro, null, 0)}</div>
            </div>
            <div>
              <div className="text-slate-500">Masas planificadas</div>
              <div className="font-semibold">{fmtQty(detail.plannedMassesMicro, null, 0)}</div>
            </div>
            <div>
              <div className="text-slate-500">Rendimiento esperado</div>
              <div className="font-semibold">
                {fmtQty(detail.expectedYieldMicro, detail.preview?.productSaleUnit ?? null)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Costo estimado</div>
              <div className="font-semibold">
                {detail.preview ? fmtMoney(detail.preview.estimatedTotalCostMicro) : "—"}
              </div>
            </div>
          </div>

          {detail.preview && <WarningsBox warnings={detail.preview.warnings} />}

          {detail.preview && (
            <>
              <MaterialTable
                title="Ingredientes (fase masa)"
                perLabel="Por masa"
                lines={detail.preview.ingredients}
              />
              <MaterialTable
                title="Empaques (fase paquete)"
                perLabel="Por paquete"
                lines={detail.preview.packaging}
              />
            </>
          )}

          <h3 className="mb-2 text-sm font-bold text-slate-700">Producciones vinculadas</h3>
          <table className="table-ny mb-4">
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th className="num">Masas reales</th>
                <th className="num">Costo total</th>
                <th className="center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {detail.productions.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-400">
                    Aún no hay producciones vinculadas a este plan.
                  </td>
                </tr>
              )}
              {detail.productions.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono font-semibold">{fmtDocNumber(p.number)}</td>
                  <td>{p.productionDate}</td>
                  <td className="num font-semibold">{fmtQty(p.realYieldMicro, p.yieldUnitId)}</td>
                  <td className="num">{fmtMoney(p.totalCostMicro)}</td>
                  <td className="center">
                    {p.status === "confirmada" ? (
                      <Badge tone="green">Confirmada</Badge>
                    ) : (
                      <Badge tone="red">Anulada</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {detail.status === "planificada" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-bold text-amber-800">Anular plan</div>
              <p className="mb-2 text-xs text-amber-700">
                El plan queda anulado con su motivo; no se borra ningún registro (auditoría
                conservada).
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

          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
            <div className="text-sm font-bold text-red-800">Eliminar plan</div>
            <p className="mb-2 text-xs text-red-700">
              Borra el plan definitivamente; las producciones y terminaciones que estaban
              vinculadas quedan desvinculadas (la eliminación queda en la auditoría).
            </p>
            <button
              className="btn btn-danger"
              onClick={() => {
                const target = { id: detail.id, number: detail.number };
                setDetail(null);
                askDelete(target);
              }}
            >
              Eliminar plan
            </button>
          </div>

          <div className="mt-4 flex justify-end">
            <button className="btn btn-secondary" onClick={() => setDetail(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Eliminar plan" onClose={() => setDeleteTarget(null)}>
          <p className="mb-3 text-sm text-slate-600">
            ¿Eliminar el plan <strong>#{fmtDocNumber(deleteTarget.number)}</strong>? Esta acción lo
            borra definitivamente y no se puede deshacer.
          </p>
          {deleteError && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {deleteError}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </button>
            <button className="btn btn-danger" onClick={remove}>
              Eliminar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
