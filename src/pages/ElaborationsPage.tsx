import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useConfirm } from "../app/ConfirmContext";
import { parseDecimalToMicro, divRoundAway, microToDecimalTrim } from "@shared/money";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { usePaged } from "../hooks/usePaged";
import {
  Badge,
  DayFilter,
  ScopeToggle,
  ErrorAlert,
  FlowGuide,
  Modal,
  SearchInput,
  fmtDocNumber,
  fmtMoney,
  fmtQty,
  newClientToken,
  todayISO,
} from "../components/ui";

/** Decimal positivo (string) → micro; null si está vacío o inválido. */
function parseQty(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  try {
    const micro = parseDecimalToMicro(t);
    return micro > 0 ? micro : null;
  } catch {
    return null;
  }
}

interface ElaborationRow {
  id: number;
  number: number;
  elaborationDate: string;
  outputMaterialId: number;
  outputMaterialName: string;
  outputUnitId: string;
  outputQtyMicro: number;
  laborCostMicro: number;
  totalCostMicro: number;
  unitCostMicro: number;
  status: string;
  notes: string | null;
}

interface ElaborationDetail {
  id: number;
  number: number;
  elaborationDate: string;
  outputMaterialId: number;
  outputMaterialName: string;
  outputUnitId: string;
  outputQtyMicro: number;
  laborCostMicro: number;
  totalCostMicro: number;
  unitCostMicro: number;
  status: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: {
    id: number;
    rawMaterialId: number;
    materialName: string;
    materialUnit: string;
    lotId: number;
    qtyMicro: number;
    unitCostMicro: number;
    lineCostMicro: number;
  }[];
}

interface MaterialOption {
  id: number;
  name: string;
  unitId: string;
  unitLabel: string;
  dimension: string;
  stockMicro: number;
  elaborated: boolean;
  active: boolean;
}

interface Unit {
  code: string;
  label: string;
  dimension: string;
  isBase: number | boolean;
}

interface PreviewLine {
  rawMaterialId: number;
  materialName: string;
  unitId: string;
  qtyMicro: number;
  qtyBaseMicro: number;
  availableMicro: number;
  avgCostMicro: number;
  estimatedCostMicro: number;
  insufficient: boolean;
}

interface Preview {
  outputMaterialId: number | null;
  outputMaterialName: string | null;
  outputUnitId: string | null;
  outputQtyMicro: number | null;
  outputStockMicro: number | null;
  laborCostMicro: number;
  materialCostMicro: number;
  totalCostMicro: number;
  unitCostMicro: number | null;
  lastLaborCostMicro: number | null;
  lines: PreviewLine[];
  hasInsufficient: boolean;
}

interface PreviewLine {
  rawMaterialId: number;
  materialName: string;
  unitId: string;
  qtyMicro: number;
  qtyBaseMicro: number;
  availableMicro: number;
  avgCostMicro: number;
  estimatedCostMicro: number;
  insufficient: boolean;
}

interface TemplateLineInfo {
  rawMaterialId: number;
  materialName: string;
  unitId: string;
  qtyPerUnitMicro: number;
}

interface TemplateInfo {
  outputMaterialId: number;
  laborCostMicro: number;
  lines: TemplateLineInfo[];
}

interface LineRow {
  key: string;
  rawMaterialId: string;
  unitId: string;
  qty: string;
  /** Ratio de plantilla: cantidad (unidad base del insumo) por 1 unidad del
   *  material resultante. null = línea manual (sin autoscale). */
  ratioMicro: number | null;
  /** true = el usuario la editó a mano: la plantilla no la pisa. */
  dirty: boolean;
}

const newLine = (): LineRow => ({
  key: newClientToken(),
  rawMaterialId: "",
  unitId: "",
  qty: "",
  ratioMicro: null,
  dirty: false,
});

/** Cantidad total (micro, base del insumo) ÷ unidades producidas (micro). */
function ratioFrom(qtyMicro: number, outputQtyMicro: number): string {
  const ratio = Number(
    divRoundAway(BigInt(qtyMicro) * BigInt(1_000_000), BigInt(outputQtyMicro)),
  );
  return microToDecimalTrim(ratio, 6);
}

export function ElaborationsPage() {
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState({
    elaborationDate: todayISO(),
    outputMaterialId: "",
    outputQty: "",
    laborCost: "",
    notes: "",
  });
  const [lines, setLines] = useState<LineRow[]>([newLine()]);
  // Mano de obra precargada (última de ese material); el usuario puede editarla.
  const laborDirtyRef = useRef(false);
  const [clientToken, setClientToken] = useState(newClientToken);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [detail, setDetail] = useState<ElaborationDetail | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Plantilla del material resultante (una por material): precarga y autoscale.
  const templateRef = useRef<TemplateInfo | null>(null);
  const outputIdRef = useRef("");
  const [hasTemplate, setHasTemplate] = useState(false);

  const [date, setDate] = useState(todayISO());
  const [scope, setScope] = useState<"day" | "all">("day");
  const list = usePaged<ElaborationRow>(
    ({ page, pageSize, search }) => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (scope === "day") {
        params.set("from", date);
        params.set("to", date);
      }
      if (search) params.set("q", search);
      return api.get(`/elaborations?${params.toString()}`);
    },
    [date, scope],
  );
  const rows = list.rows;

  useEffect(() => {
    Promise.all([api.get<MaterialOption[]>("/materials"), api.get<Unit[]>("/units")])
      .then(([ms, us]) => {
        setMaterials(ms.filter((m) => m.active));
        setUnits(us);
      })
      .catch(() => undefined);
  }, []);

  const materialById = new Map(materials.map((m) => [m.id, m]));
  const outputMaterial = form.outputMaterialId
    ? materialById.get(Number(form.outputMaterialId)) ?? null
    : null;

  const unitOptions = (baseUnitId: string | null): Unit[] => {
    if (!baseUnitId) return [];
    const base = units.find((u) => u.code === baseUnitId);
    if (!base) return [];
    if (base.dimension === "conteo") return [base];
    return units.filter((u) => u.dimension === base.dimension);
  };

  const linesKey = JSON.stringify(lines);

  // Preview en vivo (debounce): envía los insumos al server. El estimado por
  // línea no exige haber elegido el material resultante ni la cantidad.
  useEffect(() => {
    const items = lines
      .filter((l) => l.rawMaterialId !== "" && l.unitId !== "" && parseQty(l.qty) != null)
      .map((l) => ({
        rawMaterialId: Number(l.rawMaterialId),
        unitId: l.unitId,
        qty: l.qty.trim().replace(",", "."),
      }));
    const labor = form.laborCost.trim() === "" ? null : form.laborCost.trim().replace(",", ".");
    if (items.length === 0) {
      setPreview(null);
      return undefined;
    }
    const outputId = form.outputMaterialId ? Number(form.outputMaterialId) : null;
    const body: Record<string, unknown> = { laborCost: labor, items };
    if (outputId) body.outputMaterialId = outputId;
    if (parseQty(form.outputQty) != null) {
      body.outputQty = form.outputQty.trim().replace(",", ".");
    }
    const t = setTimeout(() => {
      api
        .post<Preview>("/elaborations/preview", body)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.outputMaterialId, form.outputQty, form.laborCost, linesKey]);

  const onOutputChange = (id: string) => {
    laborDirtyRef.current = false;
    // Último material pedido (ref, no closure): descarta respuestas fuera de tiempo.
    outputIdRef.current = id;
    setForm((f) => ({ ...f, outputMaterialId: id, outputQty: "", laborCost: "" }));
    setLines([newLine()]);
    setPreview(null);
    templateRef.current = null;
    setHasTemplate(false);
    if (!id) return;
    // Plantilla del material: precarga insumos + MO por lote ("última usada").
    api
      .get<TemplateInfo | null>(`/elaborations/templates/${id}`)
      .then((tpl) => {
        if (outputIdRef.current !== id) return;
        if (tpl) {
          templateRef.current = tpl;
          setHasTemplate(true);
          setLines(
            tpl.lines.length > 0
              ? tpl.lines.map((tl) => ({
                  key: newClientToken(),
                  rawMaterialId: String(tl.rawMaterialId),
                  unitId: tl.unitId,
                  qty: "",
                  ratioMicro: tl.qtyPerUnitMicro,
                  dirty: false,
                }))
              : [newLine()],
          );
          if (tpl.laborCostMicro > 0) {
            setForm((f) =>
              f.outputMaterialId === id
                ? { ...f, laborCost: microToDecimalTrim(tpl.laborCostMicro, 2) }
                : f,
            );
            return;
          }
        }
        // Respaldo: la última MO realmente usada en una elaboración confirmada.
        return api
          .get<{ laborCostMicro: number | null }>(`/elaborations/last-labor/${id}`)
          .then((r) => {
            if (laborDirtyRef.current) return;
            if (r.laborCostMicro != null && r.laborCostMicro > 0) {
              setForm((f) =>
                f.outputMaterialId === id
                  ? { ...f, laborCost: microToDecimalTrim(r.laborCostMicro!, 2) }
                  : f,
              );
            }
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
  };

  const setLine = (key: string, patch: Partial<LineRow>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const onLineMaterial = (key: string, id: string) => {
    const mat = id ? materialById.get(Number(id)) : null;
    // Cambiar el material invalida el ratio de plantilla (línea pasa a manual).
    setLine(key, { rawMaterialId: id, unitId: mat ? mat.unitId : "", ratioMicro: null });
  };
  const onLineQty = (key: string, v: string) => {
    setLines((ls) =>
      ls.map((l) =>
        l.key === key ? { ...l, qty: v, dirty: l.ratioMicro != null ? true : l.dirty } : l,
      ),
    );
  };

  // Autoscale de la plantilla: las líneas con ratio NO editadas se recalculan
  // con la cantidad a elaborar (ratio × cantidad). Las editadas quedan intactas.
  useEffect(() => {
    const outMicro = parseQty(form.outputQty);
    if (outMicro == null) return;
    setLines((ls) => {
      let changed = false;
      const next = ls.map((l) => {
        if (l.ratioMicro == null || l.dirty) return l;
        const total = Number(
          divRoundAway(BigInt(l.ratioMicro) * BigInt(outMicro), BigInt(1_000_000)),
        );
        const text = microToDecimalTrim(total, 3);
        if (l.qty !== text) {
          changed = true;
          return { ...l, qty: text };
        }
        return l;
      });
      return changed ? next : ls;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.outputQty]);

  const openForm = () => {
    setForm({
      elaborationDate: todayISO(),
      outputMaterialId: "",
      outputQty: "",
      laborCost: "",
      notes: "",
    });
    setLines([newLine()]);
    laborDirtyRef.current = false;
    setClientToken(newClientToken());
    setPreview(null);
    setError(null);
    templateRef.current = null;
    setHasTemplate(false);
    setView("form");
  };

  const laborValid =
    form.laborCost.trim() === "" || /^-?\d*\.?\d*$/.test(form.laborCost.trim().replace(",", "."));
  const outputQtyOk = parseQty(form.outputQty) != null;
  const completeLines = lines.filter(
    (l) => l.rawMaterialId !== "" && l.unitId !== "" && parseQty(l.qty) != null,
  );
  const canSave =
    !!form.outputMaterialId && outputQtyOk && completeLines.length > 0 && laborValid && !saving;

  /** Cuerpo PUT de la plantilla con las líneas y MO actuales del formulario. */
  const templateBodyFromForm = () => ({
    laborCost: form.laborCost.trim() === "" ? null : form.laborCost.trim().replace(",", "."),
    lines: completeLines.map((l) => ({
      rawMaterialId: Number(l.rawMaterialId),
      unitId: l.unitId,
      // por 1 unidad completa del material resultante
      qtyPerUnit: ratioFrom(parseQty(l.qty)!, parseQty(form.outputQty)!),
    })),
  });

  /** Guarda la plantilla única del material resultante y limpia flags "dirty". */
  const saveTemplate = async (): Promise<boolean> => {
    const id = form.outputMaterialId;
    if (!id || completeLines.length === 0) return false;
    try {
      const tpl = await api.put<TemplateInfo>(
        `/elaborations/templates/${id}`,
        templateBodyFromForm(),
      );
      templateRef.current = tpl;
      setHasTemplate(true);
      toast.success("Plantilla de elaboración guardada");
      // Actualiza ratios y marca las líneas como limpias (de la plantilla).
      const ratioById = new Map(tpl.lines.map((tl) => [tl.rawMaterialId, tl.qtyPerUnitMicro]));
      setLines((ls) =>
        ls.map((l) => {
          if (l.rawMaterialId === "") return l;
          const r = ratioById.get(Number(l.rawMaterialId));
          if (r == null) return { ...l, ratioMicro: null, dirty: false };
          return { ...l, ratioMicro: r, dirty: false };
        }),
      );
      return true;
    } catch (e) {
      toast.error((e as ApiError).message);
      return false;
    }
  };

  /** Restaura todas las líneas desde la plantilla (escala la cantidad actual). */
  const restoreTemplate = () => {
    const tpl = templateRef.current;
    if (!tpl) return;
    setLines(
      tpl.lines.length > 0
        ? tpl.lines.map((tl) => ({
            key: newClientToken(),
            rawMaterialId: String(tl.rawMaterialId),
            unitId: tl.unitId,
            qty: "",
            ratioMicro: tl.qtyPerUnitMicro,
            dirty: false,
          }))
        : [newLine()],
    );
  };

  const confirmDialog = useConfirm();

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/elaborations", {
        elaborationDate: form.elaborationDate,
        outputMaterialId: Number(form.outputMaterialId),
        outputQty: form.outputQty.trim().replace(",", "."),
        laborCost: form.laborCost.trim() === "" ? null : form.laborCost.trim().replace(",", "."),
        notes: form.notes || null,
        clientToken,
        items: completeLines.map((l) => ({
          rawMaterialId: Number(l.rawMaterialId),
          unitId: l.unitId,
          qty: l.qty.trim().replace(",", "."),
        })),
      });
      // Sin plantilla: ofrece guardar lo consumido como receta de este material.
      if (!templateRef.current && completeLines.length > 0) {
        const saveTpl = await confirmDialog({
          title: "¿Guardar plantilla de elaboración?",
          description:
            "Puede guardar estas cantidades como plantilla de elaboración para este material, para reutilizarlas en próximas elaboraciones.",
          confirmLabel: "Guardar plantilla",
        });
        if (saveTpl) {
          setSaving(true);
          await saveTemplate();
        }
      }
      toast.success("Elaboración registrada: inventario actualizado");
      setView("list");
      list.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (id: number) => {
    setAnnulReason("");
    try {
      setDetail(await api.get<ElaborationDetail>(`/elaborations/${id}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const annul = async () => {
    if (!detail) return;
    const ok = await confirmDialog({
      title: `¿Anular la elaboración #${fmtDocNumber(detail.number)}?`,
      description:
        "La elaboración quedará anulada con trazabilidad, revirtiendo el inventario por lotes. La acción no podrá deshacerse.",
      confirmLabel: "Anular elaboración",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/elaborations/${detail.id}/annul`, { reason: annulReason });
      toast.success(`Elaboración #${fmtDocNumber(detail.number)} anulada`);
      setDetail(null);
      list.reload();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  };

  const outputIdNum = form.outputMaterialId ? Number(form.outputMaterialId) : 0;

  return (
    <div>
      <PageHeader
        title="Elaboraciones de materias primas"
        subtitle="Materias primas derivadas: consumen otras materias primas + mano de obra, con costo real PEPS"
        actions={
          view === "list" ? (
            <button className="btn btn-primary" onClick={openForm}>
              + Nueva elaboración
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              ← Volver
            </button>
          )
        }
      />
      <FlowGuide current="catalogos" />
      <ErrorAlert message={error} />

      {view === "list" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchInput
              value={list.search}
              onChange={list.setSearch}
              placeholder="Buscar por material o número…"
            />
            <div className="flex flex-wrap items-center gap-3">
              <ScopeToggle scope={scope} onChange={setScope} />
              {scope === "day" && <DayFilter date={date} onChange={setDate} />}
              <span className="text-sm text-slate-500">{list.total} elaboración(es)</span>
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
                  <th>Material resultado</th>
                  <th className="num">Cantidad producida</th>
                  <th className="num">Materiales</th>
                  <th className="num">Mano de obra</th>
                  <th className="num">Costo total</th>
                  <th className="num">Costo unitario</th>
                  <th className="center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      {list.loading ? "Cargando…" : "Sin elaboraciones registradas."}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono font-semibold">{fmtDocNumber(r.number)}</td>
                    <td>{r.elaborationDate}</td>
                    <td className="font-medium">{r.outputMaterialName}</td>
                    <td className="num font-semibold">
                      {fmtQty(r.outputQtyMicro, r.outputUnitId)}
                    </td>
                    <td className="num">{fmtMoney(r.totalCostMicro - r.laborCostMicro)}</td>
                    <td className="num">
                      {r.laborCostMicro > 0 ? fmtMoney(r.laborCostMicro) : "—"}
                    </td>
                    <td className="num">{fmtMoney(r.totalCostMicro)}</td>
                    <td className="num">
                      {fmtMoney(r.unitCostMicro)}/{r.outputUnitId}
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
                ))}
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
                label="elaboraciones"
              />
            </div>
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
                value={form.elaborationDate}
                onChange={(e) => setForm({ ...form, elaborationDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Material resultante *</label>
              <select
                value={form.outputMaterialId}
                onChange={(e) => onOutputChange(e.target.value)}
              >
                <option value="">Seleccione…</option>
                {materials
                  .filter((m) => m.elaborated)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.unitId})
                    </option>
                  ))}
              </select>
              <span className="mt-1 block text-[11px] text-slate-500">
                Solo materias primas marcadas como “Se elabora internamente”.
              </span>
            </div>
            <div className="field">
              <label>Cantidad a elaborar *</label>
              <input
                value={form.outputQty}
                inputMode="decimal"
                placeholder="0"
                disabled={!outputMaterial}
                onChange={(e) => setForm({ ...form, outputQty: e.target.value })}
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                En la unidad del material{outputMaterial ? `: ${outputMaterial.unitId}` : ""}. Las
                líneas con plantilla se recalculan automáticamente al cambiarla.
              </span>
            </div>
            <div className="field">
              <label>Mano de obra ($ por unidad)</label>
              <input
                value={form.laborCost}
                inputMode="decimal"
                placeholder="0"
                onChange={(e) => {
                  laborDirtyRef.current = true;
                  setForm({ ...form, laborCost: e.target.value });
                }}
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Por unidad producida: el lote paga tarifa × cantidad. Precargada de la plantilla
                (última usada; editable).
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-end gap-3">
            <div className="field flex-1">
              <label>Notas</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-5 mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-700">
                Materias primas a consumir
              </h3>
              {hasTemplate && <Badge tone="blue">Con plantilla</Badge>}
            </div>
            {outputMaterial && (
              <div className="flex gap-2">
                {hasTemplate && (
                  <button className="btn btn-secondary" onClick={restoreTemplate}>
                    <RotateCcw size={13} className="mr-1" /> Restaurar plantilla
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={saveTemplate}
                  disabled={outputQtyOk === false || completeLines.length === 0}
                >
                  {hasTemplate ? "Actualizar plantilla" : "Guardar como plantilla"}
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="table-ny">
              <thead>
                <tr>
                  <th>Materia prima</th>
                  <th className="num" style={{ width: 130 }}>Cantidad</th>
                  <th style={{ width: 150 }}>Unidad</th>
                  <th className="num" style={{ width: 170 }}>Disponible</th>
                  <th className="num" style={{ width: 170 }}>Costo estimado</th>
                  <th style={{ width: 44 }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const mat = l.rawMaterialId ? materialById.get(Number(l.rawMaterialId)) : null;
                  const pl = preview?.lines.find(
                    (p) => String(p.rawMaterialId) === l.rawMaterialId,
                  );
                  // Desplegable sin duplicados: excluye el resultado y los elegidos en OTRAS filas.
                  const taken = new Set(
                    lines
                      .filter((x) => x.key !== l.key && x.rawMaterialId !== "")
                      .map((x) => Number(x.rawMaterialId)),
                  );
                  return (
                    <tr key={l.key}>
                      <td>
                        <select
                          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          value={l.rawMaterialId}
                          onChange={(e) => onLineMaterial(l.key, e.target.value)}
                        >
                          <option value="">Seleccione…</option>
                          {materials
                            .filter(
                              (m) =>
                                m.id !== outputIdNum &&
                                (String(m.id) === l.rawMaterialId || !taken.has(m.id)),
                            )
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                                {m.elaborated ? " (elaborada)" : ""}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="num">
                        <input
                          className="w-full rounded border border-slate-300 px-2 py-1.5 text-right text-sm"
                          value={l.qty}
                          inputMode="decimal"
                          placeholder="0"
                          disabled={!l.rawMaterialId}
                          onChange={(e) => onLineQty(l.key, e.target.value)}
                        />
                        {l.ratioMicro != null && l.dirty && (
                          <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-amber-600">
                            editada
                            <button
                              type="button"
                              className="underline hover:text-amber-800"
                              title="Volver a la cantidad de la plantilla"
                              onClick={() => {
                                const out = parseQty(form.outputQty);
                                if (out == null) return;
                                const total = Number(
                                  divRoundAway(
                                    BigInt(l.ratioMicro!) * BigInt(out),
                                    BigInt(1_000_000),
                                  ),
                                );
                                setLine(l.key, {
                                  qty: microToDecimalTrim(total, 3),
                                  dirty: false,
                                });
                              }}
                            >
                              plantilla
                            </button>
                          </span>
                        )}
                      </td>
                      <td>
                        <select
                          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          value={l.unitId}
                          disabled={!l.rawMaterialId}
                          onChange={(e) => setLine(l.key, { unitId: e.target.value })}
                        >
                          <option value="">—</option>
                          {unitOptions(mat?.unitId ?? null).map((u) => (
                            <option key={u.code} value={u.code}>
                              {u.label} ({u.code})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num text-slate-500">
                        {l.rawMaterialId
                          ? pl
                            ? fmtQty(pl.availableMicro, mat?.unitId)
                            : fmtQty(mat?.stockMicro ?? 0, mat?.unitId)
                          : "—"}
                      </td>
                      <td className="num">
                        {pl ? fmtMoney(pl.estimatedCostMicro) : "—"}
                      </td>
                      <td className="text-right">
                        <button
                          className="text-slate-400 transition hover:text-red-600"
                          title="Quitar"
                          onClick={() =>
                            setLines((ls) =>
                              ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()],
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            className="btn btn-secondary mt-2"
            onClick={() => setLines((ls) => [...ls, newLine()])}
          >
            <Plus size={14} className="mr-1" /> Agregar insumo
          </button>

          {preview && (
            <div className="mt-4 grid grid-cols-4 gap-4 rounded-md bg-slate-50 p-4 text-sm">
              <div>
                <div className="text-slate-500">Materiales (estimado)</div>
                <div className="font-semibold">{fmtMoney(preview.materialCostMicro)}</div>
              </div>
              <div>
                <div className="text-slate-500">Mano de obra</div>
                <div className="font-semibold">{fmtMoney(preview.laborCostMicro)}</div>
              </div>
              <div>
                <div className="text-slate-500">Costo total (estimado)</div>
                <div className="font-semibold">{fmtMoney(preview.totalCostMicro)}</div>
              </div>
              <div>
                <div className="text-slate-500">Costo unitario esperado</div>
                <div className="font-semibold">
                  {preview.outputQtyMicro != null && preview.outputUnitId && preview.unitCostMicro != null
                    ? `${fmtMoney(preview.unitCostMicro)}/${preview.outputUnitId}`
                    : "elija el material resultante y la cantidad"}
                </div>
              </div>
            </div>
          )}
          {preview?.hasInsufficient && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Hay insumos con stock insuficiente: revise la columna Disponible. La confirmación
              fallará hasta que ajuste el inventario.
            </div>
          )}

          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
            Al confirmar se consumen los insumos por PEPS al precio real de cada lote, se suma la
            mano de obra (tarifa por unidad × cantidad) al costo total y se crea el lote del
            material resultante con su costo unitario real (costo total ÷ cantidad). Ese material
            queda disponible como cualquier materia prima. El reenvío accidental no duplica la
            operación.
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setView("list")}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!canSave}>
              {saving ? "Confirmando..." : "Confirmar elaboración"}
            </button>
          </div>
        </div>
      )}

      {detail && (
        <Modal
          title={`Elaboración #${fmtDocNumber(detail.number)}`}
          onClose={() => setDetail(null)}
          wide
        >
          <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Fecha</div>
              <div className="font-semibold">{detail.elaborationDate}</div>
            </div>
            <div>
              <div className="text-slate-500">Material resultante</div>
              <div className="font-semibold">{detail.outputMaterialName}</div>
            </div>
            <div>
              <div className="text-slate-500">Cantidad producida</div>
              <div className="font-semibold">
                {fmtQty(detail.outputQtyMicro, detail.outputUnitId)}
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

          <h3 className="mb-2 text-sm font-bold text-slate-700">
            Consumo de materias primas (PEPS)
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
              {detail.lines.map((c) => (
                <tr key={c.id}>
                  <td>{c.materialName}</td>
                  <td className="num">{fmtQty(c.qtyMicro, c.materialUnit)}</td>
                  <td className="num">
                    {fmtMoney(c.unitCostMicro)}/{c.materialUnit}
                  </td>
                  <td className="num font-semibold">{fmtMoney(c.lineCostMicro)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {detail.laborCostMicro > 0 && (
                <tr>
                  <td colSpan={3} className="text-right text-sm text-slate-500">
                    Mano de obra
                    {detail.outputQtyMicro > 0 && (
                      <span className="ml-1 text-[11px]">
                        ({microToDecimalTrim(Number(divRoundAway(BigInt(detail.laborCostMicro) * 1_000_000n, BigInt(detail.outputQtyMicro))), 2)}/{detail.outputUnitId})
                      </span>
                    )}
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
              <tr>
                <td colSpan={3} className="text-right text-sm text-slate-500">
                  Costo unitario real
                </td>
                <td className="num text-slate-500">
                  {fmtMoney(detail.unitCostMicro)}/{detail.outputUnitId}
                </td>
              </tr>
            </tfoot>
          </table>
          {detail.notes && (
            <p className="mb-4 text-xs text-slate-500">Notas: {detail.notes}</p>
          )}

          {detail.status === "confirmada" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-bold text-amber-800">Anular elaboración</div>
              <p className="mb-2 text-xs text-amber-700">
                Solo es posible si el material producido aún no fue consumido. La anulación revierte
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
