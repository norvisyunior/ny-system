import { useCallback, useEffect, useState } from "react";
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

interface VersionListItem {
  id: number;
  version: number;
  status: string;
  massName: string | null;
  expectedYieldMicro: number;
  yieldUnitId: string;
  validFrom: string;
  createdAt: string;
}

interface VersionDetail {
  id: number;
  recipeName: string;
  productId: number | null;
  productName: string | null;
  productSaleUnit: string | null;
  version: number;
  status: string;
  massName: string | null;
  massUnit: string | null;
  expectedYieldMicro: number;
  yieldUnitId: string;
  instructions: string | null;
  validFrom: string;
  notes: string | null;
  items: {
    id: number;
    materialName: string;
    materialUnit: string;
    unitId: string;
    unitLabel: string;
    qtyMicro: number;
    phase: string;
  }[];
}

interface VersionForm {
  massId: string;
  expectedYield: string;
  instructions: string;
  validFrom: string;
  notes: string;
  items: { rawMaterialId: string; unitId: string; qty: string; phase: Phase }[];
}

const EMPTY_VERSION = (): VersionForm => ({
  massId: "",
  expectedYield: "",
  instructions: "",
  validFrom: todayISO(),
  notes: "",
  items: [{ rawMaterialId: "", unitId: "", qty: "", phase: "masa" }],
});

export function RecipesPage() {
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [masses, setMasses] = useState<Mass[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [header, setHeader] = useState({ name: "", description: "", productId: "" });
  const [version, setVersion] = useState<VersionForm>(EMPTY_VERSION());

  const [versionFor, setVersionFor] = useState<RecipeRow | null>(null);
  const [newVersionFor, setNewVersionFor] = useState<RecipeRow | null>(null);
  const [versionsList, setVersionsList] = useState<VersionListItem[] | null>(null);
  const [versionDetail, setVersionDetail] = useState<VersionDetail | null>(null);
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
        setMasses(m.filter((x) => x.active));
        setMaterials(mat.filter((x) => x.active));
        setUnits(u);
        setProducts(p.filter((x) => x.active));
      })
      .catch(() => undefined);
  }, []);

  // Producto de la receta en edición: en el modal de creación sale del header;
  // en una nueva versión, de la receta existente.
  const activeProduct = createOpen
    ? products.find((p) => String(p.id) === header.productId)
    : newVersionFor
      ? products.find((p) => p.id === newVersionFor.productId)
      : undefined;

  const unitDimension = (code: string) => units.find((u) => u.code === code)?.dimension;
  // Receta por producto: la masa se cuenta (dimensión conteo), no se pesa.
  const visibleMasses = activeProduct
    ? masses.filter((m) => unitDimension(m.unitId) === "conteo")
    : masses;
  const selectedMass = masses.find((m) => String(m.id) === version.massId);
  const usedProductIds = new Set(rows.map((r) => r.productId).filter((x): x is number => x != null));

  const setItem = (idx: number, patch: Partial<VersionForm["items"][number]>) => {
    setVersion((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  };

  const onMaterialChange = (idx: number, materialId: string) => {
    const mat = materials.find((m) => String(m.id) === materialId);
    setItem(idx, { rawMaterialId: materialId, unitId: mat ? mat.unitId : "" });
  };

  const unitOptions = (it: VersionForm["items"][number]): Unit[] => {
    const mat = materials.find((m) => String(m.id) === it.rawMaterialId);
    if (!mat) return units;
    if (mat.dimension === "conteo") return units.filter((u) => u.code === mat.unitId);
    return units.filter((u) => u.dimension === mat.dimension);
  };

  const versionBody = () => ({
    massId: Number(version.massId),
    expectedYield: version.expectedYield,
    yieldUnitId: activeProduct ? activeProduct.saleUnitId : (selectedMass?.unitId ?? ""),
    instructions: version.instructions || null,
    validFrom: version.validFrom,
    notes: version.notes || null,
    items: version.items
      .filter((it) => it.rawMaterialId && it.qty)
      .map((it) => ({
        rawMaterialId: Number(it.rawMaterialId),
        unitId: it.unitId,
        qty: it.qty,
        phase: it.phase,
      })),
  });

  const openCreate = () => {
    setHeader({ name: "", description: "", productId: "" });
    setVersion(EMPTY_VERSION());
    setError(null);
    setCreateOpen(true);
  };

  const openNewVersion = (r: RecipeRow) => {
    setVersionFor(null);
    setVersion(EMPTY_VERSION());
    setError(null);
    setNewVersionFor(r);
  };

  const saveNew = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post("/recipes", {
        ...header,
        productId: Number(header.productId),
        version: versionBody(),
      });
      setCreateOpen(false);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const saveNewVersion = async () => {
    if (!newVersionFor) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/recipes/${newVersionFor.id}/versions`, versionBody());
      setNewVersionFor(null);
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const openVersions = async (r: RecipeRow) => {
    setError(null);
    try {
      const res = await api.get<{ versions: VersionListItem[] }>(`/recipes/${r.id}/versions`);
      setVersionsList(res.versions);
      setVersionFor(r);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const openVersionDetail = async (versionId: number) => {
    try {
      setVersionDetail(await api.get<VersionDetail>(`/recipe-versions/${versionId}`));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      (r.productName ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  const versionFormFields = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="field">
          <label>Masa destino *</label>
          <select
            value={version.massId}
            onChange={(e) => setVersion({ ...version, massId: e.target.value })}
          >
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
            value={version.expectedYield}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => setVersion({ ...version, expectedYield: e.target.value })}
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
      <div className="grid grid-cols-2 gap-3">
        <div className="field">
          <label>Vigente desde *</label>
          <input
            type="date"
            max={todayISO()}
            value={version.validFrom}
            onChange={(e) => setVersion({ ...version, validFrom: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Notas</label>
          <input
            value={version.notes}
            onChange={(e) => setVersion({ ...version, notes: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label>Instrucciones</label>
        <textarea
          rows={2}
          value={version.instructions}
          onChange={(e) => setVersion({ ...version, instructions: e.target.value })}
        />
      </div>

      <div className="mt-1 mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-700">Ingredientes</h3>
          <p className="text-xs text-slate-500">
            Fase <strong>masa</strong>: se consume al elaborar. Fase <strong>paquete</strong>: se
            consume al terminar, por cada paquete real obtenido.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            setVersion((f) => ({
              ...f,
              items: [...f.items, { rawMaterialId: "", unitId: "", qty: "", phase: "masa" }],
            }))
          }
        >
          + Agregar ingrediente
        </button>
      </div>
      <table className="table-ny">
        <thead>
          <tr>
            <th style={{ width: "36%" }}>Materia prima</th>
            <th style={{ width: "24%" }}>Fase</th>
            <th style={{ width: "16%" }}>Cantidad</th>
            <th style={{ width: "16%" }}>Unidad</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {version.items.map((it, idx) => (
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
                <select
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={it.phase}
                  onChange={(e) => setItem(idx, { phase: e.target.value as Phase })}
                >
                  <option value="masa">{PHASE_LABEL.masa}</option>
                  <option value="paquete">{PHASE_LABEL.paquete}</option>
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
              <td className="text-center">
                <button
                  className="text-slate-400 hover:text-red-600"
                  title="Quitar línea"
                  onClick={() =>
                    setVersion((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
                  }
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const canSaveVersion =
    Boolean(version.massId) &&
    Boolean(version.expectedYield) &&
    version.items.some((it) => it.rawMaterialId && it.qty);

  return (
    <div>
      <PageHeader
        title="Recetas"
        subtitle="Una receta por producto, con fases masa/paquete y rendimiento en paquetes; la producción usa siempre la versión activa"
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
              <th className="num">Versión</th>
              <th className="num">Rendimiento esp.</th>
              <th className="num">Ingredientes</th>
              <th className="center">Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">
                  Sin recetas registradas.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}</td>
                <td>{r.productName ?? <span className="text-slate-400">Legado</span>}</td>
                <td>{r.massName ?? "—"}</td>
                <td className="num">v{r.version ?? "—"}</td>
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
                  <button className="btn btn-secondary mr-2" onClick={() => openVersions(r)}>
                    Versiones
                  </button>
                  <button className="btn btn-secondary" onClick={() => openNewVersion(r)}>
                    + Versión
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <Modal title="Nueva receta" onClose={() => setCreateOpen(false)} wide>
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
                onChange={(e) =>
                  setHeader({ ...header, productId: e.target.value })
                }
              >
                <option value="">Seleccione…</option>
                {products
                  .filter((p) => !usedProductIds.has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (se vende en {p.saleUnitId})
                    </option>
                  ))}
              </select>
              {products.filter((p) => !usedProductIds.has(p.id)).length === 0 && (
                <span className="mt-1 block text-xs text-amber-600">
                  Todos los productos activos ya tienen una receta.
                </span>
              )}
            </div>
            <h3 className="mt-2 text-sm font-bold text-slate-700">Versión 1 (activa)</h3>
            {versionFormFields}
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={saveNew}
                disabled={
                  saving ||
                  !header.name.trim() ||
                  !header.productId ||
                  !canSaveVersion
                }
              >
                {saving ? "Guardando..." : "Crear receta"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {newVersionFor && (
        <Modal
          title={`Nueva versión — ${newVersionFor.name}`}
          onClose={() => setNewVersionFor(null)}
          wide
        >
          <div className="flex flex-col gap-3">
            <ErrorAlert message={error} />
            <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
              La versión actual v{newVersionFor.version} quedará archivada; solo las producciones
              futuras usarán esta nueva versión.
            </div>
            {versionFormFields}
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setNewVersionFor(null)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={saveNewVersion} disabled={saving || !canSaveVersion}>
                {saving ? "Guardando..." : "Crear versión"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {versionFor && versionsList && (
        <Modal
          title={`Versiones — ${versionFor.name}`}
          onClose={() => setVersionFor(null)}
        >
          <table className="table-ny">
            <thead>
              <tr>
                <th className="num">Versión</th>
                <th className="center">Estado</th>
                <th>Masa</th>
                <th className="num">Rendimiento</th>
                <th>Vigente desde</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {versionsList.map((v) => (
                <tr key={v.id}>
                  <td className="num font-semibold">v{v.version}</td>
                  <td className="center">
                    {v.status === "activa" ? <Badge tone="green">Activa</Badge> : <Badge tone="slate">Archivada</Badge>}
                  </td>
                  <td>{v.massName ?? "—"}</td>
                  <td className="num">{fmtQty(v.expectedYieldMicro, v.yieldUnitId)}</td>
                  <td>{v.validFrom}</td>
                  <td className="text-right">
                    <button className="btn btn-secondary" onClick={() => openVersionDetail(v.id)}>
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-end">
            <button className="btn btn-secondary" onClick={() => setVersionFor(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}

      {versionDetail && (
        <Modal
          title={`${versionDetail.recipeName} v${versionDetail.version} — ${versionDetail.status}`}
          onClose={() => setVersionDetail(null)}
          wide
        >
          <div className="mb-4 grid grid-cols-5 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Producto</div>
              <div className="font-semibold">{versionDetail.productName ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-500">Masa destino</div>
              <div className="font-semibold">{versionDetail.massName ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-500">Rendimiento esperado</div>
              <div className="font-semibold">
                {fmtQty(versionDetail.expectedYieldMicro, versionDetail.yieldUnitId)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Vigente desde</div>
              <div className="font-semibold">{versionDetail.validFrom}</div>
            </div>
            <div>
              <div className="text-slate-500">Estado</div>
              {versionDetail.status === "activa" ? (
                <Badge tone="green">Activa</Badge>
              ) : (
                <Badge tone="slate">Archivada</Badge>
              )}
            </div>
          </div>
          {versionDetail.instructions && (
            <div className="mb-4 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <div className="mb-1 text-xs font-bold text-slate-500">INSTRUCCIONES</div>
              {versionDetail.instructions}
            </div>
          )}
          <table className="table-ny">
            <thead>
              <tr>
                <th>Ingrediente</th>
                <th>Fase</th>
                <th className="num">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {versionDetail.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.materialName}</td>
                  <td>
                    {it.phase === "paquete" ? (
                      <Badge tone="blue">Paquete</Badge>
                    ) : (
                      <Badge tone="slate">Masa</Badge>
                    )}
                  </td>
                  <td className="num font-semibold">{fmtQty(it.qtyMicro, it.unitLabel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-end">
            <button className="btn btn-secondary" onClick={() => setVersionDetail(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
