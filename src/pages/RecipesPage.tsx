import { useCallback, useEffect, useState } from "react";
import { microToDecimalTrim } from "@shared/money";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, ErrorAlert, FlowGuide, Modal, SearchInput, fmtQty, todayISO } from "../components/ui";

type Phase = "masa" | "paquete";

const PHASE_LABEL: Record<Phase, string> = {
  masa: "Masa (al elaborar)",
  paquete: "Paquete (al terminar)",
};

interface RecipeRow {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  productId: number | null;
  productName: string | null;
  versionId: number | null;
  version: number | null;
  massId: number | null;
  massName: string | null;
  expectedYieldMicro: number | null;
  yieldUnitId: string | null;
  validFrom: string | null;
  itemsCount: number;
}

interface Mass {
  id: number;
  name: string;
  unitId: string;
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
interface Product {
  id: number;
  name: string;
  saleUnitId: string;
  active: boolean;
}

interface RecipeDetail {
  id: number;
  recipeName: string;
  productId: number | null;
  productName: string | null;
  productSaleUnit: string | null;
  massId: number | null;
  massName: string | null;
  expectedYieldMicro: number;
  yieldUnitId: string;
  instructions: string | null;
  validFrom: string;
  notes: string | null;
  items: {
    id: number;
    rawMaterialId: number;
    materialName: string;
    unitId: string;
    qtyMicro: number;
    phase: string;
  }[];
}

interface RecipeForm {
  massId: string;
  expectedYield: string;
  validFrom: string;
  items: { rawMaterialId: string; unitId: string; qty: string; phase: Phase }[];
}

const EMPTY_FORM = (): RecipeForm => ({
  massId: "",
  expectedYield: "",
  validFrom: todayISO(),
  items: [{ rawMaterialId: "", unitId: "", qty: "", phase: "masa" }],
});

const EMPTY_HEADER = { name: "", description: "", productId: "" };

export function RecipesPage() {
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [masses, setMasses] = useState<Mass[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RecipeRow | null>(null);
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [form, setForm] = useState<RecipeForm>(EMPTY_FORM());
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get<RecipeRow[]>("/recipes").then(setRows).catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    Promise.all([
      api.get<Mass[]>("/masses"),
      api.get<Material[]>("/materials"),
      api.get<Unit[]>("/units"),
      api.get<Product[]>("/products"),
    ])
      .then(([m, mat, u, p]) => {
        setMasses(m);
        setMaterials(mat);
        setUnits(u);
        setProducts(p);
      })
      .catch(() => undefined);
  }, []);

  // Producto de la receta en edición: en la creación sale del select; al editar, de la receta.
  const activeProduct = createOpen
    ? products.find((p) => String(p.id) === header.productId)
    : editing
      ? products.find((p) => p.id === editing.productId)
      : undefined;

  const unitDimension = (code: string) => units.find((u) => u.code === code)?.dimension;
  // Receta por producto: la masa se cuenta (dimensión conteo), no se pesa.
  const visibleMasses = masses.filter(
    (m) => m.active && (!activeProduct || unitDimension(m.unitId) === "conteo"),
  );
  const selectedMass = masses.find((m) => String(m.id) === form.massId);
  const usedProductIds = new Set(rows.map((r) => r.productId).filter((x): x is number => x != null));

  const setItem = (idx: number, patch: Partial<RecipeForm["items"][number]>) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  };

  const onMaterialChange = (idx: number, materialId: string) => {
    const mat = materials.find((m) => String(m.id) === materialId);
    setItem(idx, { rawMaterialId: materialId, unitId: mat ? mat.unitId : "" });
  };

  const unitOptions = (it: RecipeForm["items"][number]): Unit[] => {
    const mat = materials.find((m) => String(m.id) === it.rawMaterialId);
    if (!mat) return units;
    if (mat.dimension === "conteo") return units.filter((u) => u.code === mat.unitId);
    return units.filter((u) => u.dimension === mat.dimension);
  };

  const materialOptions = (it: RecipeForm["items"][number]): Material[] =>
    materials.filter((m) => m.active || String(m.id) === it.rawMaterialId);

  const bodyPayload = () => ({
    massId: Number(form.massId),
    expectedYield: form.expectedYield,
    yieldUnitId: activeProduct ? activeProduct.saleUnitId : (selectedMass?.unitId ?? ""),
    instructions: null,
    validFrom: form.validFrom,
    notes: null,
    items: form.items
      .filter((it) => it.rawMaterialId && it.qty)
      .map((it) => ({
        rawMaterialId: Number(it.rawMaterialId),
        unitId: it.unitId,
        qty: it.qty,
        phase: it.phase,
      })),
  });

  const openCreate = () => {
    setHeader(EMPTY_HEADER);
    setForm(EMPTY_FORM());
    setError(null);
    setCreateOpen(true);
  };

  const closeModals = () => {
    setCreateOpen(false);
    setEditing(null);
    setError(null);
  };

  const saveNew = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post("/recipes", {
        ...header,
        productId: Number(header.productId),
        version: bodyPayload(),
      });
      setCreateOpen(false);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  /** Carga los datos actuales en el formulario y abre el modal de edición. */
  const openEdit = async (r: RecipeRow) => {
    if (r.versionId == null) {
      setError(`La receta "${r.name}" no tiene datos cargados.`);
      return;
    }
    setError(null);
    try {
      const d = await api.get<RecipeDetail>(`/recipe-versions/${r.versionId}`);
      setHeader({
        name: r.name,
        description: r.description ?? "",
        productId: r.productId != null ? String(r.productId) : "",
      });
      setForm({
        massId: d.massId != null ? String(d.massId) : "",
        expectedYield: microToDecimalTrim(d.expectedYieldMicro, 6),
        validFrom: d.validFrom,
        items: d.items.map((it) => ({
          rawMaterialId: String(it.rawMaterialId),
          unitId: it.unitId,
          qty: microToDecimalTrim(it.qtyMicro, 6),
          phase: it.phase === "paquete" ? "paquete" : "masa",
        })),
      });
      setEditing(r);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/recipes/${editing.id}`, {
        name: header.name,
        description: header.description || null,
        version: bodyPayload(),
      });
      setEditing(null);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      (r.productName ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  const addItem = (phase: Phase) =>
    setForm((f) => ({
      ...f,
      items: [...f.items, { rawMaterialId: "", unitId: "", qty: "", phase }],
    }));

  // Índices originales por fase (para editar/borrar sobre form.items).
  const rowsByPhase = (phase: Phase) =>
    form.items
      .map((it, i) => ({ it, i }))
      .filter((x) => x.it.phase === phase);

  const itemsRow = (it: RecipeForm["items"][number], i: number) => (
    <tr key={i}>
      <td>
        <select
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          value={it.rawMaterialId}
          onChange={(e) => onMaterialChange(i, e.target.value)}
        >
          <option value="">Seleccione…</option>
          {materialOptions(it).map((m) => (
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
          onChange={(e) => setItem(i, { qty: e.target.value })}
        />
      </td>
      <td>
        <select
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          value={it.unitId}
          onChange={(e) => setItem(i, { unitId: e.target.value })}
        >
          <option value="">—</option>
          {unitOptions(it).map((u) => (
            <option key={u.code} value={u.code}>
              {u.code}
            </option>
          ))}
        </select>
      </td>
      <td className="text-center">
        <button
          className="text-slate-400 hover:text-red-600"
          title="Quitar línea"
          onClick={() =>
            setForm((f) => ({ ...f, items: f.items.filter((_, k) => k !== i) }))
          }
        >
          ✕
        </button>
      </td>
    </tr>
  );

  const itemsTable = (rows: { it: RecipeForm["items"][number]; i: number }[]) => (
    <div className="overflow-x-auto">
      <table className="table-ny min-w-[420px]">
        <thead>
          <tr>
            <th style={{ width: "44%" }}>Materia prima</th>
            <th style={{ width: "20%" }}>Cantidad</th>
            <th style={{ width: "20%" }}>Unidad</th>
            <th></th>
          </tr>
        </thead>
        <tbody>{rows.map((r) => itemsRow(r.it, r.i))}</tbody>
      </table>
    </div>
  );

  const phaseBlock = (phase: Phase, emptyText: string) => {
    const rows = rowsByPhase(phase);
    return (
      <div className="mb-1">
        <div className="mb-1 flex items-baseline gap-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">
            {PHASE_LABEL[phase]}
          </h4>
          <span className="text-[11px] text-slate-400">
            {phase === "masa" ? "cantidad por masa" : "cantidad por paquete"}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
            {emptyText}
          </p>
        ) : (
          itemsTable(rows)
        )}
      </div>
    );
  };

  const recipeFields = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="field">
          <label>Masa destino *</label>
          <select value={form.massId} onChange={(e) => setForm({ ...form, massId: e.target.value })}>
            <option value="">Seleccione…</option>
            {visibleMasses.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {activeProduct && (
            <span className="mt-1 block text-xs text-slate-500">
              La masa se cuenta en unidades completas.
            </span>
          )}
        </div>
        <div className="field">
          <label>
            Rendimiento esperado *{activeProduct ? " (paquetes por masa)" : ""}
          </label>
          <input
            value={form.expectedYield}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => setForm({ ...form, expectedYield: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Unidad de rendimiento</label>
          <input
            value={activeProduct ? activeProduct.saleUnitId : (selectedMass?.unitId ?? "—")}
            disabled
          />
        </div>
      </div>
      <div className="field">
        <label>Vigente desde *</label>
        <input
          type="date"
          max={todayISO()}
          value={form.validFrom}
          onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
        />
      </div>

      <div className="mt-1 mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-700">Ingredientes y empaques</h3>
          <p className="text-xs text-slate-500">
            Los ingredientes se consumen <strong>al elaborar</strong> la masa; los empaques se
            consumen <strong>al terminar</strong>, por cada paquete real empaquetado.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn btn-secondary" onClick={() => addItem("masa")}>
            + Agregar ingrediente
          </button>
          <button className="btn btn-secondary" onClick={() => addItem("paquete")}>
            + Agregar empaque
          </button>
        </div>
      </div>

      {phaseBlock(
        "masa",
        'Sin ingredientes de masa. Use "+ Agregar ingrediente" (harina, carne…).',
      )}
      {phaseBlock(
        "paquete",
        'Sin empaques. Use "+ Agregar empaque" (nylon, bolsas, cajas…): se consumen al empaquetar.',
      )}
    </div>
  );

  const canSave =
    Boolean(form.massId) &&
    Boolean(form.expectedYield) &&
    form.items.some((it) => it.rawMaterialId && it.qty);

  const activeProducts = products.filter((p) => p.active);

  return (
    <div>
      <PageHeader
        title="Recetas"
        subtitle="Una receta por producto y sin versiones: edítala directamente; los ingredientes se consumen al elaborar y los empaques al empaquetar"
        actions={
          <button className="btn btn-primary" onClick={openCreate}>
            + Nueva receta
          </button>
        }
      />
      <FlowGuide current="recetas" />
      <ErrorAlert message={error} />

      <div className="mb-4 flex items-center justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre o producto…" />
        <span className="text-sm text-slate-500">{filtered.length} receta(s)</span>
      </div>

      <div className="card overflow-hidden">
        <table className="table-ny">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Producto</th>
              <th>Masa</th>
              <th className="num">Rendimiento</th>
              <th className="num">Ítems</th>
              <th className="center">Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  Sin recetas registradas.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}</td>
                <td>{r.productName ?? <span className="text-slate-400">Legado</span>}</td>
                <td>{r.massName ?? "—"}</td>
                <td className="num">
                  {r.expectedYieldMicro != null
                    ? fmtQty(r.expectedYieldMicro, r.yieldUnitId)
                    : "—"}
                </td>
                <td className="num">{r.itemsCount}</td>
                <td className="center">
                  {r.active ? <Badge tone="green">Activa</Badge> : <Badge tone="red">Inactiva</Badge>}
                </td>
                <td className="text-right">
                  <button className="btn btn-secondary" onClick={() => openEdit(r)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <Modal title="Nueva receta" onClose={closeModals} wide>
          <div className="flex flex-col gap-3">
            <ErrorAlert message={error} />
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Nombre *</label>
                <input
                  value={header.name}
                  onChange={(e) => setHeader({ ...header, name: e.target.value })}
                  placeholder="Empanada estándar"
                  autoFocus
                />
                <span className="mt-1 block text-[11px] text-slate-500">
                  El nombre debe ser único: no puede repetir el de otra receta.
                </span>
              </div>
              <div className="field">
                <label>Descripción</label>
                <input
                  value={header.description}
                  onChange={(e) => setHeader({ ...header, description: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>Producto terminado * (una receta por producto)</label>
              <select
                value={header.productId}
                onChange={(e) => setHeader({ ...header, productId: e.target.value })}
              >
                <option value="">Seleccione…</option>
                {activeProducts
                  .filter((p) => !usedProductIds.has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (se vende en {p.saleUnitId})
                    </option>
                  ))}
              </select>
              {activeProducts.filter((p) => !usedProductIds.has(p.id)).length === 0 && (
                <span className="mt-1 block text-xs text-amber-600">
                  Todos los productos activos ya tienen una receta.
                </span>
              )}
            </div>
            {recipeFields}
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={closeModals}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={saveNew}
                disabled={saving || !header.name.trim() || !header.productId || !canSave}
              >
                {saving ? "Guardando..." : "Crear receta"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={`Editar receta — ${editing.name}`} onClose={closeModals} wide>
          <div className="flex flex-col gap-3">
            <ErrorAlert message={error} />
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Nombre *</label>
                <input
                  value={header.name}
                  onChange={(e) => setHeader({ ...header, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Descripción</label>
                <input
                  value={header.description}
                  onChange={(e) => setHeader({ ...header, description: e.target.value })}
                />
              </div>
            </div>
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Producto: <strong>{editing.productName ?? "—"}</strong>
              {activeProduct ? ` (se vende en ${activeProduct.saleUnitId})` : ""} — la receta se
              guarda sobre la misma ficha, sin crear versiones.
            </div>
            {recipeFields}
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={closeModals}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={saveEdit}
                disabled={saving || !header.name.trim() || !canSave}
              >
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
