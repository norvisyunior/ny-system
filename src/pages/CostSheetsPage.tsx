import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { microToDecimalTrim } from "@shared/money";
import {
  Boxes,
  CalendarDays,
  ChevronsUpDown,
  Cookie,
  Factory,
  Info,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { api, ApiError } from "../api/client";
import { ErrorAlert, Modal, Badge } from "../components/ui";
import { divRoundAway } from "@shared/money";

// ---------------------------------------------------------------------------
// Tipos (espejo de la respuesta del backend)
// ---------------------------------------------------------------------------
type PriceBasis = "promedio" | "ultimo" | "ninguno" | "manual";
type RateBasis = "configurada" | "simulada" | "sin_configurar";

interface CostItemLine {
  recipeItemId: number;
  rawMaterialId: number;
  originalMaterialId: number;
  originalName: string;
  substituted: boolean;
  name: string;
  category: string | null;
  phase: "masa" | "paquete";
  unitId: string;
  unitLabel: string;
  baseUnitId: string;
  baseUnitLabel: string;
  qtyPerMicro: number;
  qtyPerOriginalMicro: number;
  qtyEdited: boolean;
  totalItemUnitMicro: number;
  totalBaseMicro: number;
  pricePerBaseMicro: number | null;
  pricePerItemUnitMicro: number | null;
  priceBasis: PriceBasis;
  priceUnitId: string | null;
  priceDate: string | null;
  priceSupplier: string | null;
  costMicro: number;
  warnings: string[];
}

interface QtyTotal {
  unitId: string;
  label: string;
  dimension: string;
  qtyMicro: number;
}

interface CostSheet {
  recipeVersionId: number;
  recipeId: number;
  recipeName: string;
  version: number;
  productId: number;
  productName: string;
  productPresentation: string | null;
  saleUnitId: string;
  officialSalePriceMicro: number;
  officialUnitsPerPackage: number;
  massId: number;
  massName: string;
  massUnitId: string;
  expectedYieldMicro: number;
  yieldUnitId: string;
  consultationDate: string;
  sim: {
    massesMicro: number;
    packagesMicro: number;
    expectedPackagesMicro: number;
    unitsPerPackage: number;
    unitsTotalMicro: number;
    salePriceMicro: number;
    marginTargetPctMicro: number | null;
  };
  ingredients: CostItemLine[];
  packaging: CostItemLine[];
  qtyTotals: QtyTotal[];
  laborElab: {
    massId: number;
    massName: string;
    massesMicro: number;
    rateMicro: number | null;
    rateBasis: RateBasis;
    costMicro: number;
  };
  laborTerm: {
    productId: number;
    productName: string;
    packagesMicro: number;
    unitsPerPackage: number;
    unitsTotalMicro: number;
    rateMicro: number | null;
    rateBasis: RateBasis;
    costMicro: number;
  };
  costs: {
    ingredientsMicro: number;
    laborElabMicro: number;
    laborTermMicro: number;
    packagingMicro: number;
    totalMicro: number;
  };
  hasMissingPrice: boolean;
  costPerPackageMicro: number | null;
  economics: {
    salePriceMicro: number;
    costPerPackageMicro: number | null;
    grossProfitMicro: number | null;
    marginPctMicro: number | null;
    marginTargetFractionMicro: number | null;
    recommendedPriceMicro: number | null;
  };
  warnings: string[];
}

interface RecipeOption {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  productId: number | null;
  productName: string | null;
  versionId: number | null;
  version: number | null;
  massName: string | null;
  expectedYieldMicro: number | null;
  yieldUnitId: string | null;
}

interface MaterialOption {
  id: number;
  name: string;
  unitLabel: string;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Tokens del mock (fichadecosto.png)
// ---------------------------------------------------------------------------
const CARD =
  "min-w-0 rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05)]";
const CARD_TITLE = "text-[15px] font-bold text-slate-800";
const INPUT =
  "h-9 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";
const INPUT_OV =
  "h-9 rounded-md border border-amber-300 bg-amber-50 px-2.5 text-[13px] text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";
const INPUT_OV_Q =
  "border border-amber-300 bg-amber-50 text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";
const INPUT_OV_P = INPUT_OV_Q;
const BTN_SOFT =
  "inline-flex h-9 items-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-4 text-[13px] font-semibold text-[#1355d9] transition hover:bg-sky-100";
const GREEN_BG = "#e9f7f0";
const GREEN_TEXT = "#1d995f";
const BLUE_SOFT = "bg-[#e9f1fd] text-[#2159c6]";

const MICRO = 1_000_000;

// ---------------------------------------------------------------------------
// Formato numérico estilo es-CU (millares con punto, decimales con coma)
// ---------------------------------------------------------------------------
function groupEs(intPart: string): string {
  let out = "";
  for (let i = 0; i < intPart.length; i++) {
    const posFromRight = intPart.length - i;
    out += intPart[i];
    if (posFromRight > 1 && (posFromRight - 1) % 3 === 0) out += ".";
  }
  return out;
}

function fmtDec(micro: number, decimals: number): string {
  const neg = micro < 0;
  const a = Math.abs(Math.round(micro));
  const scale = Math.pow(10, decimals);
  const w = String(Math.trunc(a / MICRO));
  const f = a % MICRO;
  let fs = String(Math.round((f * scale) / MICRO)).padStart(decimals, "0");
  if (fs.length > decimals) {
    fs = fs.slice(1);
    return `${neg ? "-" : ""}${groupEs(String(Number(w) + 1))},${fs}`;
  }
  return `${neg ? "-" : ""}${groupEs(w)},${fs}`;
}

const fmtCup = (micro: number | null | undefined): string =>
  micro == null || micro === undefined ? "—" : `${fmtDec(micro, 2)} CUP`;

/** Divide micro-CUP por unidades individuales (misma escala, sin re-multiplicar). */
const cupPerUnit = (micro: number | null | undefined, upp: number): string =>
  micro == null || micro === undefined || upp <= 0
    ? "—"
    : fmtCup(Number(divRoundAway(BigInt(Math.trunc(micro)), BigInt(Math.trunc(upp)))));

/** Cantidades: hasta 3 decimales, sin ceros de sobra y sin decimales si es entera. */
const fmtQtyEs = (micro: number): string => {
  const [w, f] = fmtDec(micro, 3).split(",");
  let fs = f;
  if (fs.endsWith("0")) fs = fs.slice(0, 2);
  if (fs === "00") fs = "";
  return fs ? `${w},${fs}` : groupEs(w);
};

/** Valor de input para cantidades: texto del usuario si edita, si no coma con 3 dec. */
const qtyInputVal = (micro: number, override: string | undefined): string =>
  override !== undefined ? override : fmtQtyEs(micro);

/** Valor de input para precios: texto del usuario si edita, si no coma con 2 dec. */
const priceInputVal = (micro: number | null, override: string | undefined): string =>
  override !== undefined ? override : micro == null ? "" : fmtDec(micro, 2);

const fmtPctEs = (percentMicro: number): string => `${fmtDec(percentMicro, 2)} %`;

const fmtWhole = (micro: number): string => {
  const w = String(Math.trunc(Math.abs(micro) / MICRO));
  const frac = micro % MICRO;
  const fracText = frac === 0 ? "" : `.${fmtDec(frac, 3).split(",")[1]}`;
  return `${micro < 0 ? "-" : ""}${groupEs(w)}${fracText}`;
};

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtDateEs(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_ES[m - 1]}. ${y}`;
}

function microStr(micro: number): string {
  const neg = micro < 0;
  const a = Math.abs(Math.round(micro));
  const w = Math.trunc(a / MICRO);
  const f = a % MICRO;
  let fs = String(f).padStart(6, "0");
  while (fs.length > 1 && fs.endsWith("0")) fs = fs.slice(0, -1);
  const s = f === 0 ? String(w) : `${w}.${fs}`;
  return neg ? `-${s}` : s;
}

const decOrNull = (s: string): number | null => {
  const t = s.trim().replace(/\s+/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// Overrides de la simulación
// ---------------------------------------------------------------------------
interface Overrides {
  masses: string;
  packages: string;
  yield: string;
  unitsPerPackage: string;
  salePrice: string;
  marginTargetPct: string;
  elabRate: string;
  termRate: string;
  itemQty: Record<number, string>;
  itemSub: Record<number, string>;
  itemPrice: Record<number, string>;
}

const emptyOv = (): Overrides => ({
  masses: "",
  packages: "",
  yield: "",
  unitsPerPackage: "",
  salePrice: "",
  marginTargetPct: "30",
  elabRate: "",
  termRate: "",
  itemQty: {},
  itemSub: {},
  itemPrice: {},
});

/** Líneas agregadas en la simulación. El backend les asigna un id temporal
 *  negativo (-1, -2, …) según el orden del arreglo, así que la posición en
 *  `added` determina el id y los selects excluyen materiales repetidos. */
interface AddedLine {
  key: number; // clave local estable (refs entre render y recálculo)
  materialId: number;
  phase: "masa" | "paquete";
  qty: string; // en la unidad del material (base); vacío → 1 unidad base
  price: string; // precio manual por unidad base; vacío → precio del sistema
}

function buildPayload(
  versionId: string,
  ov: Overrides,
  lines: { removed: number[]; added: AddedLine[] },
): Record<string, unknown> {
  const input: Record<string, unknown> = { recipeVersionId: Number(versionId) };
  const setDec = (key: string, s: string) => {
    const v = decOrNull(s);
    if (v != null) input[key] = v;
  };
  setDec("masses", ov.masses);
  setDec("packages", ov.packages);
  // Rendimiento simulado (paquetes por masa); vacío → el de la receta.
  setDec("yield", ov.yield);
  const upp = decOrNull(ov.unitsPerPackage);
  if (upp != null && Number.isInteger(upp) && upp >= 1) input.unitsPerPackage = upp;
  setDec("salePrice", ov.salePrice);
  setDec("marginTargetPct", ov.marginTargetPct);
  setDec("elabRate", ov.elabRate);
  setDec("termRate", ov.termRate);
  const items: { id: number; qty?: number; materialId?: number; unitPrice?: number }[] = [];
  for (const [k, v] of Object.entries(ov.itemQty)) {
    const q = decOrNull(v);
    if (q != null) items.push({ id: Number(k), qty: q });
  }
  for (const [k, v] of Object.entries(ov.itemSub)) {
    const id = Number(k);
    const m = Number(v);
    if (v.trim() !== "" && Number.isInteger(m) && m > 0) {
      const found = items.find((i) => i.id === id);
      if (found) found.materialId = m;
      else items.push({ id, materialId: m });
    }
  }
  for (const [k, v] of Object.entries(ov.itemPrice)) {
    const p = decOrNull(v);
    const id = Number(k);
    const found = items.find((i) => i.id === id);
    if (p != null) {
      if (found) found.unitPrice = p;
      else items.push({ id, unitPrice: p });
    }
  }
  // Precio manual de las líneas agregadas (id temporal negativo por orden).
  for (let i = 0; i < lines.added.length; i++) {
    const p = decOrNull(lines.added[i].price);
    if (p != null) items.push({ id: -(i + 1), unitPrice: p });
  }
  if (items.length > 0) input.items = items;
  if (lines.added.length > 0) {
    input.addItems = lines.added.map((a) => {
      const it: { materialId: number; phase: "masa" | "paquete"; qty?: number } = {
        materialId: a.materialId,
        phase: a.phase,
      };
      const q = decOrNull(a.qty);
      if (q != null && q > 0) it.qty = q;
      return it;
    });
  }
  if (lines.removed.length > 0) input.removedIds = lines.removed;
  return input;
}

const hasOv = (ov: Overrides): boolean =>
  ov.masses !== "" ||
  ov.packages !== "" ||
  ov.yield !== "" ||
  ov.unitsPerPackage !== "" ||
  ov.salePrice !== "" ||
  (decOrNull(ov.marginTargetPct) ?? 30) !== 30 ||
  ov.elabRate !== "" ||
  ov.termRate !== "" ||
  Object.keys(ov.itemQty).length > 0 ||
  Object.keys(ov.itemSub).length > 0 ||
  Object.keys(ov.itemPrice).length > 0;

const PRICE_LABEL: Record<PriceBasis, string> = {
  promedio: "Promedio inventario",
  ultimo: "Última compra",
  manual: "Precio manual",
  ninguno: "Sin precio",
};

function EstadoBadge({ line, ov }: { line: CostItemLine; ov: Overrides }) {
  const priceOv = ov.itemPrice[line.recipeItemId] !== undefined;
  const qtyOv = ov.itemQty[line.recipeItemId] !== undefined;
  if (line.recipeItemId < 0) return <Badge tone="blue">Agregado</Badge>;
  if (line.substituted) return <Badge tone="blue">Sustituido</Badge>;
  if (priceOv || qtyOv) return <Badge tone="amber">Editado</Badge>;
  if (line.priceBasis === "ninguno") return <Badge tone="red">Sin precio</Badge>;
  return (
    <span className="rounded-full bg-[#e9f7f0] px-2 py-0.5 text-[11px] font-semibold text-[#1d995f]">
      Original
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de ingredientes (tabla con filas expandibles)
// ---------------------------------------------------------------------------
function IngredientesCard({
  sheet,
  ov,
  materials,
  addedLines,
  onQty,
  onSub,
  onPrice,
  onAddedLine,
  onAddMaterial,
  onRemove,
}: {
  sheet: CostSheet;
  ov: Overrides;
  materials: MaterialOption[];
  addedLines: AddedLine[];
  onQty: (itemId: number, v: string) => void;
  onSub: (itemId: number, v: string) => void;
  onPrice: (itemId: number, v: string) => void;
  onAddedLine: (key: number, patch: Partial<AddedLine>) => void;
  onAddMaterial: (materialId: number) => void;
  onRemove: (line: CostItemLine) => void;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const mMicro = sheet.sim.massesMicro;
  const massesLabel =
    mMicro % MICRO === 0
      ? `${groupEs(String(Math.trunc(mMicro / MICRO)))} ${Math.trunc(mMicro / MICRO) === 1 ? "masa" : "masas"}`
      : `${fmtDec(mMicro, 1)} masas`;
  const pesoTotal = sheet.qtyTotals[0];
  const ingredientesCost = sheet.costs.ingredientsMicro;
  // Un material no puede repetirse en la ficha (la receta lo impide al guardar).
  const excluded = new Set<number>([
    ...addedLines.map((a) => a.materialId),
    ...sheet.ingredients.map((l) => l.rawMaterialId),
    ...sheet.packaging.map((l) => l.rawMaterialId),
  ]);
  const available = materials.filter((m) => !excluded.has(m.id));

  return (
    <section className={`${CARD} p-5`}>
      <h2 className={CARD_TITLE}>Ingredientes</h2>
      <div className="overflow-x-auto">
        <table className="mt-3 w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-center text-[12px] font-semibold text-slate-500">
              <th className="w-6 pb-2"></th>
              <th className="pb-2">Ingrediente</th>
              <th className="pb-2">Cant./masa</th>
              <th className="pb-2">Cant. total <span className="font-normal text-slate-400">({massesLabel})</span></th>
              <th className="pb-2">Precio U.</th>
              <th className="pb-2">Costo</th>
              <th className="pb-2">Estado</th>
              <th className="w-8 pb-2"></th>
            </tr>
          </thead>
        <tbody>
          {sheet.ingredients.map((l) => {
            const isAdded = l.recipeItemId < 0;
            const added = isAdded ? addedLines[-l.recipeItemId - 1] : undefined;
            const sub = isAdded ? "" : (ov.itemSub[l.recipeItemId] ?? "");
            const qtyOv = isAdded ? undefined : ov.itemQty[l.recipeItemId];
            const qty = isAdded
              ? (added?.qty !== "" && added ? added.qty : fmtQtyEs(l.qtyPerMicro))
              : qtyInputVal(l.qtyPerMicro, qtyOv);
            const priceOv = isAdded ? undefined : ov.itemPrice[l.recipeItemId];
            const price = isAdded
              ? (added?.price !== "" && added ? added.price : priceInputVal(l.pricePerBaseMicro, undefined))
              : priceInputVal(l.pricePerBaseMicro, priceOv);
            const isOpen = !isAdded && open.has(l.recipeItemId);
            return (
              <Fragment key={l.recipeItemId}>
                <tr className="border-b border-slate-200 text-center">
                  <td className="w-7 py-1.5">
                    {!isAdded && (
                      <button
                        className={`inline-flex items-center justify-center text-slate-400 transition-transform hover:text-slate-600 ${isOpen ? "rotate-90" : ""}`}
                        onClick={() => toggle(l.recipeItemId)}
                        aria-label="Ver fuente del precio"
                      >
                        ›
                      </button>
                    )}
                  </td>
                  <td className="max-w-[180px] py-1.5 text-left">
                    <select
                      className={`h-7 max-w-[180px] truncate rounded-md border px-1 text-[12px] ${l.substituted ? "border-amber-300 bg-amber-50" : "border-transparent bg-transparent hover:border-slate-200"}`}
                      value={sub}
                      disabled={isAdded}
                      title={isAdded ? "Línea agregada en la simulación" : undefined}
                      onChange={(e) => onSub(l.recipeItemId, e.target.value)}
                    >
                      <option value="">{l.originalName}{isAdded ? "" : " · original"}</option>
                      {!isAdded &&
                        materials
                          .filter((m) => m.id !== l.originalMaterialId)
                          .map((m) => (
                            <option key={m.id} value={String(m.id)}>
                              {m.name}
                            </option>
                          ))}
                    </select>
                  </td>
                  <td className="py-1.5">
                    <input
                      className={`mx-auto h-7 w-14 rounded-md px-1 text-center text-[12px] ${isAdded ? "border border-sky-200 bg-sky-50 text-[#2159c6]" : qtyOv !== undefined ? INPUT_OV_Q : "border border-transparent bg-transparent hover:border-slate-200"}`}
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) =>
                        isAdded && added
                          ? onAddedLine(added.key, { qty: e.target.value })
                          : onQty(l.recipeItemId, e.target.value)
                      }
                    />
                  </td>
                  <td className="py-1.5 whitespace-nowrap text-slate-700">
                    {fmtQtyEs(l.totalItemUnitMicro)}{" "}
                    <span className="text-slate-500">{l.unitId}</span>
                  </td>
                  <td className="py-1.5">
                    {l.priceBasis === "ninguno" ? (
                      "—"
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <input
                          className={`h-7 w-[76px] rounded-md px-1 text-center text-[13px] ${isAdded ? "border border-sky-200 bg-sky-50 text-[#2159c6]" : priceOv !== undefined ? INPUT_OV_P : "border border-slate-200"}`}
                          inputMode="decimal"
                          value={price}
                          onChange={(e) =>
                            isAdded && added
                              ? onAddedLine(added.key, { price: e.target.value })
                              : onPrice(l.recipeItemId, e.target.value)
                          }
                        />
                        {!isAdded && (
                          <ChevronsUpDown
                            size={13}
                            className="cursor-pointer text-slate-300 hover:text-slate-500"
                            onClick={() => onPrice(l.recipeItemId, "")}
                          />
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 whitespace-nowrap font-semibold text-slate-700">
                    {fmtDec(l.costMicro, 2)}
                  </td>
                  <td className="py-1.5">
                    <EstadoBadge line={l} ov={ov} />
                  </td>
                  <td className="py-1.5">
                    <button
                      className="mx-auto block text-slate-300 transition hover:text-red-500"
                      title="Quitar de la ficha"
                      onClick={() => onRemove(l)}
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-[12px]">
                    <td></td>
                    <td colSpan={7} className="py-2 text-slate-600">
                      <span className="mr-4">
                        <span className="font-semibold text-slate-700">Fuente: </span>
                        {PRICE_LABEL[l.priceBasis]}
                      </span>
                      {l.priceDate && <span className="mr-4">Fecha: {l.priceDate}</span>}
                      {l.priceSupplier && <span className="mr-4">Proveedor: {l.priceSupplier}</span>}
                      <span>
                        Equivalente base: {fmtQtyEs(l.totalBaseMicro)} {l.baseUnitLabel} ·
                        Precio por {l.baseUnitLabel}: {fmtCup(l.pricePerBaseMicro)}
                      </span>
                      {l.warnings.length > 0 && (
                        <div className="mt-1 text-[#b45309]">{l.warnings.join(" ")}</div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          <tr className="border-t border-slate-200 bg-slate-50/70 text-[13px]">
            <td colSpan={8} className="border-t-0 bg-white py-2">
              {available.length > 0 ? (
                <div className="flex justify-center">
                  <select
                    className="h-8 w-56 rounded-md border border-dashed border-slate-300 px-2 text-[12px] text-slate-500 transition hover:border-sky-300 focus:border-sky-400"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) onAddMaterial(Number(e.target.value));
                    }}
                  >
                    <option value="">＋ Agregar ingrediente…</option>
                    {available.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} <>({m.unitLabel})</>
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="text-center text-[11px] font-medium text-slate-400">
                  Todos los materiales activos ya están en la ficha.
                </div>
              )}
            </td>
          </tr>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-[13px]">
            <td className="py-2.5"></td>
            <td className="py-2.5 font-bold text-slate-700">Totales</td>
            <td colSpan={2}></td>
            <td className="py-2.5 text-center">
              <div className="text-[11px] text-slate-400">Peso total de ingredientes</div>
              <div className="mx-auto inline-block rounded-md bg-white px-2 py-1 text-[12px] font-semibold text-slate-700">
                {pesoTotal ? `${fmtQtyEs(pesoTotal.qtyMicro)} ${pesoTotal.unitId}` : "—"}
              </div>
            </td>
            <td className="py-2.5 text-center">
              <div className="text-[11px] text-slate-400">Costo total de ingredientes</div>
              <div className="whitespace-nowrap text-[15px] font-bold text-slate-800">
                {fmtDec(ingredientesCost, 2)}
              </div>
            </td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tarjetas de mano de obra
// ---------------------------------------------------------------------------
function LaborElabCard({
  sheet,
  ov,
  onRate,
  onConfigure,
}: {
  sheet: CostSheet;
  ov: Overrides;
  onRate: (v: string) => void;
  onConfigure: () => void;
}) {
  const d = sheet.laborElab;
  const missing = d.rateBasis === "sin_configurar";
  return (
    <section className={`${CARD} p-4`}>
      <div className="flex items-center gap-2">
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            missing ? "bg-rose-400" : d.rateBasis === "simulada" ? "bg-amber-400" : "bg-emerald-500"
          }`}
        />
        <h2 className="text-[13px] font-bold text-slate-700">MO · Elaboración de masas</h2>
        <span className="ml-auto text-[9px] font-medium text-slate-400">
          {missing ? "sin tarifa" : d.rateBasis === "simulada" ? "tarifa simulada" : "tarifa fija"}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-end gap-x-5 gap-y-2">
        <div className="min-w-[110px]">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Masa
          </div>
          <div className="text-[13px] font-semibold tracking-tight text-slate-800">
            {d.massName}
          </div>
          <button
            className={`mt-0.5 text-[10px] font-semibold underline decoration-slate-300 underline-offset-2 transition hover:text-[#1355d9] ${
              missing ? "text-amber-600" : "text-slate-400"
            }`}
            onClick={onConfigure}
          >
            {missing ? "Configurar tarifa (falta)" : "Configurar tarifa"}
          </button>
        </div>
        <div className="min-w-[130px] flex-1">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Tarifa por masa
          </div>
          <div
            className={`mt-0.5 flex h-8 items-center rounded-md border px-2 ${
              ov.elabRate !== ""
                ? "border-amber-300 bg-amber-50 focus-within:border-amber-400"
                : "border-slate-200 bg-white focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100"
            }`}
          >
            <input
              className="h-full w-full min-w-0 bg-transparent text-[12px] text-slate-700 outline-none"
              inputMode="decimal"
              placeholder={d.rateMicro != null ? fmtDec(d.rateMicro, 2) : "—"}
              value={ov.elabRate}
              onChange={(e) => onRate(e.target.value)}
            />
            <span className="ml-1 text-[10px] font-medium text-slate-400">CUP</span>
          </div>
        </div>
        <div className="min-w-[90px] text-right">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Costo total
          </div>
          <div className="text-[17px] font-extrabold tabular-nums tracking-tight text-slate-800">
            {fmtCup(d.costMicro)}
          </div>
          <div className="text-[9px] text-slate-400">por {fmtWhole(sheet.sim.massesMicro)} masa(s)</div>
        </div>
      </div>
      {ov.elabRate !== "" && (
        <div className="mt-1 text-[9px] text-amber-600">Tarifa simulada (no se guarda)</div>
      )}
    </section>
  );
}

function LaborTermCard({
  sheet,
  ov,
  onRate,
  onConfigure,
}: {
  sheet: CostSheet;
  ov: Overrides;
  onRate: (v: string) => void;
  onConfigure: () => void;
}) {
  const d = sheet.laborTerm;
  const missing = d.rateBasis === "sin_configurar";
  return (
    <section className={`${CARD} p-4`}>
      <div className="flex items-center gap-2">
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            missing ? "bg-rose-400" : d.rateBasis === "simulada" ? "bg-amber-400" : "bg-emerald-500"
          }`}
        />
        <h2 className="text-[13px] font-bold text-slate-700">MO · Terminación y empaquetado</h2>
        <span className="ml-auto text-[9px] font-medium text-slate-400">
          {missing ? "sin tarifa" : d.rateBasis === "simulada" ? "tarifa simulada" : "tarifa fija"}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-end gap-x-5 gap-y-2">
        <div className="min-w-[110px]">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Producto
          </div>
          <div className="text-[13px] font-semibold tracking-tight text-slate-800">
            {d.productName}
          </div>
          <button
            className={`mt-0.5 text-[10px] font-semibold underline decoration-slate-300 underline-offset-2 transition hover:text-[#1355d9] ${
              missing ? "text-amber-600" : "text-slate-400"
            }`}
            onClick={onConfigure}
          >
            {missing ? "Configurar tarifa (falta)" : "Configurar tarifa"}
          </button>
        </div>
        <div className="min-w-[130px] flex-1">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Tarifa por unidad ind.
          </div>
          <div
            className={`mt-0.5 flex h-8 items-center rounded-md border px-2 ${
              ov.termRate !== ""
                ? "border-amber-300 bg-amber-50 focus-within:border-amber-400"
                : "border-slate-200 bg-white focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100"
            }`}
          >
            <input
              className="h-full w-full min-w-0 bg-transparent text-[12px] text-slate-700 outline-none"
              inputMode="decimal"
              placeholder={d.rateMicro != null ? fmtDec(d.rateMicro, 2) : "—"}
              value={ov.termRate}
              onChange={(e) => onRate(e.target.value)}
            />
            <span className="ml-1 text-[10px] font-medium text-slate-400">CUP</span>
          </div>
        </div>
        <div className="min-w-[110px] text-right">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Costo total
          </div>
          <div className="text-[17px] font-extrabold tabular-nums tracking-tight text-slate-800">
            {fmtCup(d.costMicro)}
          </div>
          <div className="text-[9px] text-slate-400">{fmtWhole(d.unitsTotalMicro)} unidades ind.</div>
        </div>
      </div>
      {ov.termRate !== "" && (
        <div className="mt-1 text-[9px] text-amber-600">Tarifa simulada (no se guarda)</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empaquetado
// ---------------------------------------------------------------------------
function EmpaquetadoCard({
  sheet,
  ov,
  materials,
  addedLines,
  onQty,
  onAddedLine,
  onAddMaterial,
  onRemove,
}: {
  sheet: CostSheet;
  ov: Overrides;
  materials: MaterialOption[];
  addedLines: AddedLine[];
  onQty: (itemId: number, v: string) => void;
  onAddedLine: (key: number, patch: Partial<AddedLine>) => void;
  onAddMaterial: (materialId: number) => void;
  onRemove: (line: CostItemLine) => void;
}) {
  const total = sheet.costs.packagingMicro;
  const excluded = new Set<number>([
    ...addedLines.map((a) => a.materialId),
    ...sheet.ingredients.map((l) => l.rawMaterialId),
    ...sheet.packaging.map((l) => l.rawMaterialId),
  ]);
  const available = materials.filter((m) => !excluded.has(m.id));
  const addSelect = (label: string) => (
    <div className="flex w-full">
      <select
        className="h-8 w-full min-w-0 max-w-[240px] rounded-md border border-dashed border-slate-300 px-2 text-[12px] text-slate-500 transition hover:border-sky-300 focus:border-sky-400"
        value=""
        onChange={(e) => {
          if (e.target.value) onAddMaterial(Number(e.target.value));
        }}
      >
        <option value="">{label}</option>
        {available.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} <>({m.unitLabel})</>
          </option>
        ))}
      </select>
    </div>
  );
  const emptyInfo = (
    <div className="text-center text-[11px] font-medium text-slate-400">
      Todos los materiales activos ya están en la ficha.
    </div>
  );

  return (
    <section className={`${CARD} p-5`}>
      <h2 className={CARD_TITLE}>Materiales de empaquetado</h2>
      {sheet.packaging.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="mt-3 w-full table-fixed text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-center text-[12px] font-semibold text-slate-500">
                <th className="pb-2 text-left">Material</th>
                <th className="pb-2">Cant.</th>
                <th className="pb-2">Costo</th>
                <th className="w-7 pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {sheet.packaging.map((l) => {
                const isAdded = l.recipeItemId < 0;
                const added = isAdded ? addedLines[-l.recipeItemId - 1] : undefined;
                const qtyOv = ov.itemQty[l.recipeItemId];
                const qty = isAdded
                  ? (added?.qty !== "" && added ? added.qty : fmtQtyEs(l.qtyPerMicro))
                  : qtyInputVal(l.qtyPerMicro, qtyOv);
                return (
                  <tr key={l.recipeItemId} className="border-b border-slate-100 text-center">
                    <td className="min-w-0 truncate py-1.5 text-left text-slate-700" title={l.name}>
                      {l.name}
                      {isAdded && (
                        <span className="ml-2 inline-block w-max overflow-visible whitespace-nowrap rounded-full bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700">
                          Agregado
                        </span>
                      )}
                    </td>
                    <td className="w-24 py-1.5">
                      <input
                        className={`h-7 w-full rounded-md px-1 text-center text-[12px] ${isAdded ? "border border-sky-200 bg-sky-50 text-[#2159c6]" : qtyOv !== undefined ? INPUT_OV_Q : "border border-slate-200"}`}
                        inputMode="decimal"
                        value={qty}
                        onChange={(e) =>
                          isAdded && added
                            ? onAddedLine(added.key, { qty: e.target.value })
                            : onQty(l.recipeItemId, e.target.value)
                        }
                      />
                      <div className="text-[10px] text-slate-400">{l.unitId}/paquete</div>
                    </td>
                    <td className="w-20 py-1.5 text-right font-semibold text-slate-700">
                      {fmtDec(l.costMicro, 2)}
                    </td>
                    <td className="w-7 py-1.5">
                      <button
                        className="mx-auto block text-slate-300 transition hover:text-red-500"
                        title="Quitar de la ficha"
                        onClick={() => onRemove(l)}
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-b border-slate-200">
                <td colSpan={4} className="py-2">
                  {available.length > 0 ? addSelect("＋ Agregar empaque…") : emptyInfo}
                </td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="py-1.5 font-bold text-slate-700">Total empaquetado</td>
                <td></td>
                <td className="py-1.5 text-right text-[15px] font-bold text-slate-800">
                  {fmtDec(total, 2)}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[13px] text-slate-400">Sin materiales de empaquetado en la ficha.</p>
          <div className="mt-3">{available.length > 0 ? addSelect("＋ Agregar empaque…") : emptyInfo}</div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export function CostSheetsPage() {
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [version, setVersion] = useState("");
  const [sheet, setSheet] = useState<CostSheet | null>(null);
  const [ov, setOv] = useState<Overrides>(emptyOv);
  // Líneas eliminadas y agregadas de la simulación (editar la ficha).
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [addedLines, setAddedLines] = useState<AddedLine[]>([]);
  const addKey = useRef(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateModal, setRateModal] = useState<
    { kind: "masa" | "terminacion"; id: number; name: string } | null
  >(null);
  const [rateVal, setRateVal] = useState("");
  // Guardar la simulación en la receta (Actualizar receta).
  const [updateModal, setUpdateModal] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  // Lanzar a producción/terminación con la simulación.
  const [launchModal, setLaunchModal] = useState<"produccion" | "terminacion" | null>(null);
  const pendingNav = useRef<"produccion" | "terminacion" | null>(null);
  const nav = useNavigate();
  const seq = useRef(0);

  useEffect(() => {
    api
      .get<RecipeOption[]>("/recipes")
      .then((rs) =>
        setRecipes(rs.filter((r) => r.active && r.versionId != null && r.productId != null)),
      )
      .catch((e: ApiError) => setError(e.message));
    api
      .get<MaterialOption[]>("/materials")
      .then((ms) => setMaterials(ms.filter((m) => m.active)))
      .catch(() => undefined);
  }, []);

  const recalc = (
    v: string,
    o: Overrides,
    lines: { removed: number[]; added: AddedLine[] },
    apply: (x: CostSheet) => void,
  ) => {
    if (!v) return;
    const s = ++seq.current;
    setBusy(true);
    api
      .post<CostSheet>("/cost-sheets/preview", buildPayload(v, o, lines))
      .then((x) => {
        if (seq.current === s) {
          apply(x);
          setError(null);
          setBusy(false);
        }
      })
      .catch((e: ApiError) => {
        if (seq.current === s) {
          setError(e.message);
          setBusy(false);
        }
      });
  };

  // Al cambiar la receta: limpiar overrides y cargar la ficha base.
  useEffect(() => {
    setError(null);
    if (!version) {
      setSheet(null);
      return;
    }
    const s = ++seq.current;
    setBusy(true);
    api
      .get<CostSheet>(`/cost-sheets/${version}`)
      .then((b) => {
        if (seq.current !== s) return;
        setSheet(b);
        setBusy(false);
      })
      .catch((e: ApiError) => {
        if (seq.current !== s) {
          setError(e.message);
          setBusy(false);
        }
      });
  }, [version]);

  // Cambiar de receta o volver a elegir: la ficha nueva arranca limpia.
  const selectVersion = (v: string) => {
    setVersion(v);
    setOv(emptyOv());
    setRemovedIds([]);
    setAddedLines([]);
  };

  // Recalculo automático con los overrides (debounce tipo hoja de cálculo).
  useEffect(() => {
    if (!version) return;
    const lines = { removed: removedIds, added: addedLines };
    const t = setTimeout(() => recalc(version, ov, lines, setSheet), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, JSON.stringify(ov), JSON.stringify(removedIds), JSON.stringify(addedLines)]);

  const setField = (f: keyof Omit<Overrides, "itemQty" | "itemSub" | "itemPrice">, v: string) =>
    setOv((o) => ({ ...o, [f]: v }));

  // Triángulo masas × rendimiento = paquetes (gana el último editado; el
  // backend deriva la cantidad ausente del rendimiento vigente en la sim).
  const setMassesOv = (v: string) =>
    setOv((o) => ({ ...o, masses: v, packages: v !== "" ? "" : o.packages }));
  const setPackagesOv = (v: string) =>
    setOv((o) => ({ ...o, packages: v, masses: v !== "" ? "" : o.masses }));
  // Editar rendimiento no rompe masas/paquetes: el no editado se rederiva… pero
  // si hay paquetes fijados de una edición previa, esos mandan (server rederiva
  // las masas). setField("yield") cubre el caso sin mutex de paquetes.

  const setQty = (itemId: number, v: string) =>
    setOv((o) => {
      const itemQty = { ...o.itemQty };
      if (v === "") delete itemQty[itemId];
      else itemQty[itemId] = v;
      return { ...o, itemQty };
    });

  const setSub = (itemId: number, v: string) =>
    setOv((o) => {
      const itemSub = { ...o.itemSub };
      if (v === "") delete itemSub[itemId];
      else itemSub[itemId] = v;
      return { ...o, itemSub };
    });

  const setPrice = (itemId: number, v: string) =>
    setOv((o) => {
      const itemPrice = { ...o.itemPrice };
      if (v === "") delete itemPrice[itemId];
      else itemPrice[itemId] = v;
      return { ...o, itemPrice };
    });

  const resetSheet = () => {
    // Restablece al instante: devuelve receta base y limpia la simulación.
    setOv(emptyOv());
    setRemovedIds([]);
    setAddedLines([]);
    setError(null);
  };

  const saveRate = async () => {
    if (!rateModal) return;
    const body =
      rateModal.kind === "masa"
        ? { kind: "masa", massId: rateModal.id, rate: rateVal }
        : { kind: "terminacion", productId: rateModal.id, rate: rateVal };
    try {
      await api.put("/labor-rates", body);
      setOv((o) => ({ ...o, [rateModal.kind === "masa" ? "elabRate" : "termRate"]: "" }));
      setRateModal(null);
      setRateVal("");
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  // -----------------------------------------------------------------------
  // Edición de líneas de la ficha (agregar / quitar)
  // -----------------------------------------------------------------------
  const addLine = (phase: "masa" | "paquete") => (materialId: number) =>
    setAddedLines((a) => [
      ...a,
      { key: addKey.current++, materialId, phase, qty: "", price: "" },
    ]);

  const onAddedLine = (key: number, patch: Partial<AddedLine>) =>
    setAddedLines((a) => a.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const removeLine = (l: CostItemLine) => {
    if (l.recipeItemId < 0) {
      // El id temporal depende del orden del arreglo, y el orden cambia al
      // quitar: se identifica por material+phase (los selects no admiten
      // materiales repetidos, así que es único).
      setAddedLines((a) =>
        a.filter((x) => !(x.materialId === l.rawMaterialId && x.phase === l.phase)),
      );
    } else {
      setRemovedIds((r) => (r.includes(l.recipeItemId) ? r : [...r, l.recipeItemId]));
    }
  };

  const dirty =
    hasOv(ov) || removedIds.length > 0 || addedLines.length > 0;

  // -----------------------------------------------------------------------
  // Actualizar la receta con la simulación (sobrescribe la versión vigente)
  // -----------------------------------------------------------------------
  interface RecipeVersionInfo {
    instructions: string | null;
    notes: string | null;
    validFrom: string;
  }

  /** Enteros sin float: micro_a × 1e6 ÷ micro_den (truncado). */
  const divMicro = (num: number, den: number): number =>
    Number(
      (BigInt(Math.abs(Math.round(num))) * BigInt(MICRO)) /
        BigInt(Math.max(1, Math.round(den))),
    );

  const doUpdateRecipe = async (): Promise<boolean> => {
    if (!sheet || savingRecipe) return false;
    const massesMicro = sheet.sim.massesMicro;
    const pkgsMicro = sheet.sim.packagesMicro;
    const yieldMicro = divMicro(pkgsMicro, massesMicro);
    if (yieldMicro <= 0) {
      setError(
        "La ficha no tiene paquetes previstos (> 0). Ajuste los paquetes antes de actualizar la receta.",
      );
      return false;
    }
    // Cantidades por masa / por paquete desde la ficha simulada. Las líneas
    // sustituidas se guardan en la unidad base del material sustituto.
    const items: { name: string; rawMaterialId: number; unitId: string; qty: string; phase: "masa" | "paquete" }[] = [];
    const collect = (lines: CostItemLine[], factorMicro: number): string | null => {
      for (const l of lines) {
        let unitId = l.unitId;
        let qty = l.qtyPerMicro;
        if (l.substituted) {
          unitId = l.baseUnitId;
          qty = divMicro(l.totalBaseMicro, factorMicro);
        }
        if (qty <= 0) {
          return `La línea "${l.name}" queda con cantidad 0 por la unidad "${l.unitId}". Corrija la sustitución en la ficha antes de actualizar la receta.`;
        }
        // Decimal exacto (micro = 6 decimales): el server lo convierte a micro.
        items.push({
          name: l.name,
          rawMaterialId: l.rawMaterialId,
          unitId,
          qty: microToDecimalTrim(qty, 6),
          phase: l.phase,
        });
      }
      return null;
    };
    const errIngr = collect(sheet.ingredients, massesMicro);
    if (errIngr) {
      setError(errIngr);
      return false;
    }
    const errPack = collect(sheet.packaging, pkgsMicro);
    if (errPack) {
      setError(errPack);
      return false;
    }
    const seen = new Map<number, string>();
    for (const it of items) {
      if (seen.has(it.rawMaterialId)) {
        setError(
          `El material "${it.name}" quedaría repetido en la receta (ya está como "${seen.get(it.rawMaterialId)}"). Revise sustituciones y líneas agregadas.`,
        );
        return false;
      }
      seen.set(it.rawMaterialId, it.name);
    }
    setSavingRecipe(true);
    try {
      const vinfo = await api.get<RecipeVersionInfo>(`/recipe-versions/${sheet.recipeVersionId}`);
      await api.put(`/recipes/${sheet.recipeId}`, {
        name: currentRecipe?.name ?? sheet.recipeName,
        description: currentRecipe?.description ?? null,
        version: {
          massId: sheet.massId,
          expectedYield: microToDecimalTrim(yieldMicro, 6),
          yieldUnitId: sheet.saleUnitId,
          instructions: vinfo.instructions,
          validFrom: vinfo.validFrom,
          notes: vinfo.notes,
          items: items.map(({ name, ...rest }) => rest),
        },
      });
      setUpdateModal(false);
      setLaunchModal(null);
      setOv(emptyOv());
      setRemovedIds([]);
      setAddedLines([]);
      const target = pendingNav.current;
      pendingNav.current = null;
      if (target) navigateTo(target);
      // La receta cambió (rendimiento/nombre): refrescar la lista.
      api
        .get<RecipeOption[]>("/recipes")
        .then((rs) =>
          setRecipes(rs.filter((r) => r.active && r.versionId != null && r.productId != null)),
        )
        .catch(() => undefined);
      return true;
    } catch (e) {
      setError((e as ApiError).message);
      return false;
    } finally {
      setSavingRecipe(false);
    }
  };

  // -----------------------------------------------------------------------
  // Lanzar la simulación a producción / terminación
  // -----------------------------------------------------------------------
  const navigateTo = (target: "produccion" | "terminacion"): void => {
    if (!sheet) return;
    const massesQty = microToDecimalTrim(sheet.sim.massesMicro, 3);
    if (target === "produccion") {
      nav(
        `/produccion/producciones?recipeVersionId=${sheet.recipeVersionId}&masses=${massesQty}`,
      );
    } else {
      nav(
        `/operaciones/transformacion?recipeVersionId=${sheet.recipeVersionId}&massQty=${massesQty}&outputQty=${microToDecimalTrim(sheet.sim.packagesMicro, 3)}`,
      );
    }
  };

  const startLaunch = (target: "produccion" | "terminacion") => {
    if (!sheet) return;
    if (!dirty) {
      navigateTo(target);
      return;
    }
    pendingNav.current = target;
    setLaunchModal(target);
  };

  // Selección actual (receta + producto + masa) desde el select principal.
  const currentRecipe = useMemo(
    () => recipes.find((r) => String(r.versionId) === version) ?? null,
    [recipes, version],
  );

  const productName = sheet?.productName ?? currentRecipe?.productName ?? "";
  const sim = sheet?.sim;
  const econ = sheet?.economics;

  return (
    <div className="min-h-screen bg-[#f2f5fb] p-4 lg:p-6">

      {/* Breadcrumb + título + fecha de consulta */}
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <nav className="flex items-center gap-1.5 text-[12px] text-slate-400">
            <span>Inicio</span>
            <span>›</span>
            <span>Fichas de costo</span>
            {productName && (
              <>
                <span>›</span>
                <span className="text-slate-500">{productName}</span>
              </>
            )}
          </nav>
          <h1 className="mt-1 text-[22px] font-bold text-slate-900">
            Ficha de costo {productName && `- ${productName}`}
          </h1>
          <div className="mt-0.5 text-[12px] text-slate-500">
            Receta: <strong className="text-slate-700">{sheet?.recipeName ?? "—"}</strong>
            <span className="mx-2 text-slate-300">|</span>
            Tipo de masa: <strong className="text-slate-700">{sheet?.massName ?? "—"}</strong>
            {busy && <span className="ml-3 font-semibold text-[#1355d9]">Calculando…</span>}
          </div>
        </div>
        {sheet && (
          <div className={`${CARD} flex items-center gap-2.5 px-3.5 py-2`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-[#1355d9]">
              <CalendarDays size={16} />
            </span>
            <div>
              <div className="text-[11px] text-slate-400">Fecha de consulta</div>
              <div className="text-[13px] font-bold text-slate-700">
                {fmtDateEs(sheet.consultationDate)}
              </div>
            </div>
          </div>
        )}
      </div>

      <ErrorAlert message={error} />

      {!version ? (
        <div className={`${CARD} mt-4 p-8 text-center`}>
          <p className="text-[13px] text-slate-500">
            Seleccione una receta para generar su ficha de costo.
          </p>
          <select value="" onChange={(e) => selectVersion(e.target.value)} className={`${INPUT} mx-auto mt-4 w-72`}>
            <option value="">Producto / receta (versión vigente)</option>
            {recipes.map((r) => (
              <option key={r.id} value={String(r.versionId)}>
                {r.productName ?? r.name} (v{r.version})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          {/* Barra de producto y parámetros */}
          <div className={`${CARD} mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 p-3.5`}>
            <div className="flex min-w-[210px] items-center gap-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-sky-50 text-sky-200">
                <Cookie size={30} />
              </span>
              <div>
                <div className="text-[15px] font-bold text-slate-800">{productName}</div>
                <div className="text-[12px] text-slate-400">
                  {sheet?.productPresentation ?? currentRecipe?.productName ?? "Producto"}
                </div>
              </div>
            </div>

            <div className="h-10 w-px bg-slate-100" />

            <div className="min-w-[190px]">
              <div className="mb-1.5 text-center text-[12px] font-medium text-slate-600">
                Producto / receta
              </div>
              <div className="flex justify-center">
                <select
                  className={`${INPUT} max-w-[200px]`}
                  value={version}
                  onChange={(e) => selectVersion(e.target.value)}
                >
                {recipes.map((r) => (
                  <option key={r.id} value={String(r.versionId)}>
                    {r.productName ?? r.name} (v{r.version})
                  </option>
                 ))}
                </select>
              </div>
            </div>

            <div className="h-10 w-px bg-slate-100" />

            <div>
              <div className="mb-1.5 text-center text-[12px] font-medium text-slate-600">
                Cantidad de masas
              </div>
              <div className="flex items-center justify-center gap-1.5">
                <input
                  className={`w-16 text-center ${ov.masses !== "" ? INPUT_OV : INPUT}`}
                  inputMode="decimal"
                  placeholder={sim ? microStr(sim.massesMicro) : ""}
                  value={ov.masses}
                  onChange={(e) => setMassesOv(e.target.value)}
                />
                <span className="text-[12px] text-slate-400">masas</span>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-center text-[12px] font-medium text-slate-600">
                Rendimiento por masa
              </div>
              <div className="flex justify-center">
                <input
                  className={`w-16 text-center ${ov.yield !== "" ? INPUT_OV : INPUT}`}
                  inputMode="decimal"
                  placeholder={sheet ? microStr(sheet.expectedYieldMicro) : ""}
                  title="Paquetes esperados por masa (editable)"
                  value={ov.yield}
                  onChange={(e) => setField("yield", e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-center text-[12px] font-medium text-slate-600">
                Paquetes previstos
              </div>
              <div className="flex items-center justify-center gap-1.5">
                <input
                  className={`w-20 text-center ${ov.packages !== "" ? INPUT_OV : INPUT}`}
                  inputMode="decimal"
                  placeholder={sim ? microStr(sim.packagesMicro) : ""}
                  title="Total de paquetes a producir (editable)"
                  value={ov.packages}
                  onChange={(e) => setPackagesOv(e.target.value)}
                />
                <span className="text-[12px] text-slate-400">paquetes</span>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-center text-[12px] font-medium text-slate-600">
                Unidad por paquete
              </div>
              <div className="flex items-center justify-center gap-1">
                <input
                  className={`w-16 text-center ${ov.unitsPerPackage !== "" ? INPUT_OV : INPUT}`}
                  inputMode="numeric"
                  placeholder={sim ? String(sim.unitsPerPackage) : ""}
                  value={ov.unitsPerPackage}
                  onChange={(e) => setField("unitsPerPackage", e.target.value)}
                />
                <span className="text-[12px] text-slate-400">unidades</span>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                className={BTN_SOFT}
                disabled={!sheet || sheet.sim.packagesMicro <= 0}
                title={
                  sheet && sheet.sim.packagesMicro <= 0
                    ? "La ficha no tiene paquetes previstos (> 0)"
                    : "Guardar esta ficha en la receta vigente"
                }
                onClick={() => setUpdateModal(true)}
              >
                <Save size={14} /> Actualizar receta
              </button>
              <button className={BTN_SOFT} onClick={resetSheet}>
                <RotateCcw size={14} /> Restablecer ficha
              </button>
            </div>
          </div>

          {/* Contenido: ficha + panel de vista previa */}
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              {sheet ? (
                <IngredientesCard
                  sheet={sheet}
                  ov={ov}
                  materials={materials}
                  addedLines={addedLines}
                  onQty={setQty}
                  onSub={setSub}
                  onPrice={setPrice}
                  onAddedLine={onAddedLine}
                  onAddMaterial={addLine("masa")}
                  onRemove={removeLine}
                />
              ) : (
                <div className={`${CARD} p-8 text-center text-[13px] text-slate-400`}>
                  Cargando ficha…
                </div>
              )}

              <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
                {sheet && (
                  <>
                    <LaborElabCard
                      sheet={sheet}
                      ov={ov}
                      onRate={(v) => setField("elabRate", v)}
                      onConfigure={() =>
                        setRateModal({ kind: "masa", id: sheet.massId, name: sheet.massName })
                      }
                    />
                    <LaborTermCard
                      sheet={sheet}
                      ov={ov}
                      onRate={(v) => setField("termRate", v)}
                      onConfigure={() =>
                        setRateModal({
                          kind: "terminacion",
                          id: sheet.productId,
                          name: sheet.productName,
                        })
                      }
                    />
                    <EmpaquetadoCard
                      sheet={sheet}
                      ov={ov}
                      materials={materials}
                      addedLines={addedLines}
                      onQty={setQty}
                      onAddedLine={onAddedLine}
                      onAddMaterial={addLine("paquete")}
                      onRemove={removeLine}
                    />
                  </>
                )}

                {sheet && (
                  <section className={`${CARD} p-5`}>
                    <h2 className={CARD_TITLE}>Resumen de costos</h2>
                    <div className="mt-3">
                      {[
                        ["Materias primas", sheet.costs.ingredientsMicro],
                        ["Mano de obra (elaboración)", sheet.costs.laborElabMicro],
                        ["Mano de obra (terminación)", sheet.costs.laborTermMicro],
                        ["Empaquetado", sheet.costs.packagingMicro],
                        ["Otros costos directos", 0],
                      ].map(([label, value]) => (
                        <div
                          key={String(label)}
                          className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1.5 text-[13px]"
                        >
                          <span className="min-w-0 truncate text-slate-600">{label}</span>
                          <span
                            className={`whitespace-nowrap ${Number(value) < 0 ? "font-semibold text-red-500" : "text-slate-700"}`}
                          >
                            {fmtDec(Number(value), 2)}
                          </span>
                        </div>
                      ))}
                      <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-[#e9f1fd] px-3 py-2 text-[13px] font-bold text-[#1355d9]">
                        <span className="min-w-0 truncate">Costo total estimado</span>
                        <span className="whitespace-nowrap">{fmtDec(sheet.costs.totalMicro, 2)}</span>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1.5 text-[13px]">
                        <span className="min-w-0 truncate text-slate-600">
                          Cantidad prevista de paquetes
                        </span>
                        <span className="whitespace-nowrap font-semibold text-slate-700">
                          {fmtWhole(sheet.sim.packagesMicro)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 py-1.5 text-[13px]">
                        <span className="min-w-0 truncate text-slate-600">Costo por paquete</span>
                        <span className="whitespace-nowrap text-[15px] font-bold text-slate-800">
                          {fmtCup(sheet.costPerPackageMicro)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1.5 text-[13px]">
                        <span className="min-w-0 truncate text-slate-500">
                          → Costo por unidad ind. ({sheet.sim.unitsPerPackage} por paquete)
                        </span>
                        <span className="whitespace-nowrap font-semibold text-slate-700">
                          {cupPerUnit(sheet.costPerPackageMicro, sheet.sim.unitsPerPackage)}
                        </span>
                      </div>
                    </div>
                  </section>
                )}

                {sheet && econ && (
                  <section className={`${CARD} p-5`}>
                    <h2 className={CARD_TITLE}>Resultados económicos</h2>
                    <div className="mt-3 flex flex-wrap gap-5">
                      <div className="min-w-[190px] flex-1">
                        <div className="mb-1.5 text-[12px] font-medium text-slate-600">
                          Precio de venta (por paquete)
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            className={`min-w-0 flex-1 text-right ${ov.salePrice !== "" ? INPUT_OV : INPUT}`}
                            inputMode="decimal"
                            placeholder={fmtDec(sheet.sim.salePriceMicro, 2)}
                            value={ov.salePrice}
                            onChange={(e) => setField("salePrice", e.target.value)}
                          />
                          <span className="text-[12px] font-medium text-slate-400">CUP</span>
                        </div>
                        <div className="mt-2 space-y-1">
                          {[
                            [
                              "Costo por paquete",
                              sheet.costPerPackageMicro == null
                                ? "—"
                                : fmtCup(sheet.costPerPackageMicro),
                              "font-semibold text-slate-800",
                            ],
                            [
                              "Ganancia bruta por paquete",
                              econ.grossProfitMicro == null ? "—" : fmtCup(econ.grossProfitMicro),
                              econ.grossProfitMicro != null && econ.grossProfitMicro < 0
                                ? "font-semibold text-red-500"
                                : "font-semibold text-slate-800",
                            ],
                            [
                              "Costo por unidad ind.",
                              cupPerUnit(sheet.costPerPackageMicro, sheet.sim.unitsPerPackage),
                              "text-slate-600",
                            ],
                            [
                              "Venta por unidad ind.",
                              cupPerUnit(econ.salePriceMicro, sheet.sim.unitsPerPackage),
                              "text-slate-600",
                            ],
                            [
                              "Ganancia por unidad ind.",
                              cupPerUnit(econ.grossProfitMicro, sheet.sim.unitsPerPackage),
                              econ.grossProfitMicro != null && econ.grossProfitMicro < 0
                                ? "font-semibold text-red-500"
                                : "text-slate-600",
                            ],
                            [
                              "Margen bruto",
                              econ.marginPctMicro == null ? "—" : fmtPctEs(econ.marginPctMicro),
                              econ.marginPctMicro != null && econ.marginPctMicro < 0
                                ? "font-bold text-red-500"
                                : "font-bold text-[#1355d9]",
                            ],
                            [
                              "Ganancia por peso",
                              econ.marginPctMicro == null
                                ? "—"
                                : fmtDec(Math.round(econ.marginPctMicro / 100), 2),
                              "font-semibold text-slate-800",
                            ],
                          ].map(([k, v, cls]) => (
                            <div
                              key={String(k)}
                              className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1 text-[12px]"
                            >
                              <span className="min-w-0 truncate text-slate-500">{k}</span>
                              <span className={`${String(cls)} whitespace-nowrap text-[13px]`}>
                                {v}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="min-w-[190px] flex-1">
                        <div className="mb-1.5 text-[12px] font-medium text-slate-600">
                          Margen objetivo (%)
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            className={`${INPUT} w-full min-w-0 text-right`}
                            inputMode="decimal"
                            value={ov.marginTargetPct}
                            onChange={(e) => {
                              setField("marginTargetPct", e.target.value);
                            }}
                          />
                          <span className="text-[12px] font-medium text-slate-400">%</span>
                        </div>
                        <div
                          className="mt-3 rounded-lg border border-[#d3ecd9] p-3"
                          style={{ background: GREEN_BG }}
                        >
                          <div className="text-[12px] font-semibold text-[#1d7a46]">
                            {sheet.sim.marginTargetPctMicro != null
                              ? `Precio recomendado (${fmtPctEs(sheet.sim.marginTargetPctMicro)} margen)`
                              : "Precio recomendado"}
                            <span
                              className="ml-1 cursor-help"
                              title="Precio al que la ganancia es el margen objetivo sobre el costo"
                            >
                              <Info size={11} className="inline" />
                            </span>
                          </div>
                          <div className="text-[17px] font-bold text-[#1d995f]">
                            {econ.recommendedPriceMicro != null
                              ? fmtCup(econ.recommendedPriceMicro)
                              : sheet.sim.marginTargetPctMicro == null
                                ? "Indique el margen objetivo (%)"
                                : "—"}
                          </div>
                          <div className="text-[10px] text-[#4f9d70]">
                            Precio matemático, no aplica redondeo comercial.
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </div>

            {/* Vista previa de resultados (sticky) */}
            <aside className="xl:sticky xl:top-4">
              <div className={`${CARD} p-4`}>
                <h2 className={CARD_TITLE}>Vista previa de resultados</h2>
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60">
                  <div
                    className="flex items-center justify-between border-b border-[#dcefe2] rounded-t-lg px-3 py-2.5"
                    style={{ background: GREEN_BG }}
                  >
                    <span className="text-[12px] font-semibold text-[#1d7a46]">
                      Costo por paquete
                    </span>
                    <span className="text-[15px] font-bold" style={{ color: GREEN_TEXT }}>
                      {sheet ? fmtCup(sheet.costPerPackageMicro) : "—"}
                    </span>
                  </div>
                  {[
                    ["Precio de venta", sim ? sim.salePriceMicro : 0],
                    ["Ganancia por paquete", econ?.grossProfitMicro],
                  ].map(([k, v]) => (
                    <div
                      key={String(k)}
                      className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5 last:border-b-0"
                    >
                      <span className="min-w-0 truncate text-[12px] font-semibold text-slate-600">
                        {k}
                      </span>
                      <span
                        className={`whitespace-nowrap text-[14px] font-bold ${Number(v) < 0 ? "text-red-500" : "text-slate-800"}`}
                      >
                        {v == null ? "—" : fmtCup(Number(v))}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[12px] font-semibold text-slate-600">Margen bruto</span>
                    <span
                      className={`text-[15px] font-bold ${econ?.marginPctMicro != null && econ.marginPctMicro < 0 ? "text-red-500" : "text-[#1355d9]"}`}
                    >
                      {econ?.marginPctMicro != null ? fmtPctEs(econ.marginPctMicro) : "—"}
                    </span>
                  </div>
                </div>

                <div className={`mt-4 rounded-lg p-3.5 text-[12px] ${BLUE_SOFT}`}>
                  <div className="flex items-center gap-1.5 font-bold">
                    Valores de la simulación
                    <Info size={13} />
                  </div>
                  <p className="mt-1 leading-relaxed opacity-90">
                    Los cambios realizados afectan solo esta simulación. No modifican la receta
                    oficial ni el inventario.
                  </p>
                </div>

                {sheet && (
                  <div className="mt-4">
                    <button
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-4 text-[13px] font-semibold text-[#1355d9] transition hover:bg-sky-100"
                      onClick={() => startLaunch("produccion")}
                    >
                      <Factory size={14} /> Lanzar a producción (masas)
                    </button>
                    <button
                      className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-4 text-[13px] font-semibold text-[#1355d9] transition hover:bg-sky-100"
                      onClick={() => startLaunch("terminacion")}
                    >
                      <Boxes size={14} /> Lanzar a terminación
                    </button>
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                      Se abrirá el formulario con los valores simulados ({fmtQtyEs(sheet.sim.massesMicro)} masas →{" "}
                      {fmtWhole(sheet.sim.packagesMicro)} paquetes). Puede ajustar las cantidades reales antes de confirmar.
                    </p>
                  </div>
                )}
              </div>
            </aside>
          </div>

          {/* Aviso inferior */}
          <div className={`mt-4 flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] ${BLUE_SOFT}`}>
            <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-white/70">
              <Info size={12} />
            </span>
            <p>
              Esta es una simulación. Los costos y cantidades pueden cambiar según la producción
              real. No se descuentan los ingredientes del inventario ni se registran movimientos.
            </p>
          </div>
        </>
      )}

      {/* Modal Restablecer ficha */}
      {updateModal && sheet && (
        <Modal
          title={`Actualizar receta — ${sheet.recipeName} v${sheet.version}`}
          onClose={() => {
            if (!savingRecipe) setUpdateModal(false);
          }}
        >
          <p className="text-sm text-slate-600">
            Se guardará el estado actual de la ficha en la versión vigente de la receta
            <strong> {sheet.recipeName} v{sheet.version}</strong>:
          </p>
          <ul className="mt-2 list-inside list-disc py-1 text-sm text-slate-600">
            <li>
              Ingredientes de masa: {sheet.ingredients.length} en la ficha
              {addedLines.filter((a) => a.phase === "masa").length > 0
                ? ` (${addedLines.filter((a) => a.phase === "masa").length} agregados)`
                : ""}
              .
            </li>
            <li>
              Empaquetado: {sheet.packaging.length} en la ficha
              {addedLines.filter((a) => a.phase === "paquete").length > 0
                ? ` (${addedLines.filter((a) => a.phase === "paquete").length} agregados)`
                : ""}
              .
            </li>
            {removedIds.length > 0 && <li>Eliminados de la receta: {removedIds.length} línea(s).</li>}
          </ul>
          <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Rendimiento por masa:{" "}
            <strong>
              {fmtQtyEs(divMicro(sheet.sim.packagesMicro, sheet.sim.massesMicro))} {sheet.saleUnitId}
            </strong>{" "}
            (paquetes previstos ÷ masas). Los <strong>precios NO se guardan</strong>: al producir se
            toman del inventario (PEPS). Las sustituciones se guardan como el material efectivo, en
            su unidad base.
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              className="btn btn-secondary"
              disabled={savingRecipe}
              onClick={() => setUpdateModal(false)}
            >
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              disabled={savingRecipe}
              onClick={doUpdateRecipe}
            >
              {savingRecipe ? "Guardando..." : "Guardar cambios en la receta"}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal Lanzar la simulación (con cambios sin guardar) */}
      {launchModal && sheet && (
        <Modal
          title="Cambios sin guardar"
          onClose={() => {
            pendingNav.current = null;
            setLaunchModal(null);
          }}
        >
          <p className="text-sm text-slate-600">
            Esta simulación tiene cambios sin guardar en la receta{" "}
            <strong>{sheet.recipeName} v{sheet.version}</strong>. ¿Aplicarlos a la receta antes de
            continuar?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              className="btn btn-secondary"
              onClick={() => {
                pendingNav.current = null;
                setLaunchModal(null);
              }}
            >
              Cancelar
            </button>
            <button
              className="btn btn-secondary"
              disabled={savingRecipe}
              onClick={() => {
                const target = launchModal;
                pendingNav.current = null;
                setLaunchModal(null);
                navigateTo(target);
              }}
            >
              Continuar sin guardar
            </button>
            <button
              className="btn btn-primary"
              disabled={savingRecipe}
              onClick={doUpdateRecipe}
            >
              {savingRecipe ? "Guardando..." : "Aplicar a la receta y continuar"}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal de tarifa de mano de obra */}
      {rateModal && (
        <Modal
          title={`Tarifa de ${rateModal.kind === "masa" ? "elaboración" : "terminación"} — ${rateModal.name}`}
          onClose={() => setRateModal(null)}
        >
          <div className="field">
            <label>
              Costo en CUP {rateModal.kind === "masa" ? "por masa" : "por unidad individual"}
            </label>
            <input
              inputMode="decimal"
              value={rateVal}
              autoFocus
              onChange={(e) => setRateVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && decOrNull(rateVal) != null) saveRate();
              }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Queda configurada por defecto para las fichas de esta{" "}
            {rateModal.kind === "masa" ? "masa" : "producto"}; en la simulación puede seguir usando
            valores hipotéticos.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setRateModal(null)}>
              Cancelar
            </button>
            <button className="btn btn-primary" disabled={decOrNull(rateVal) == null} onClick={saveRate}>
              Guardar tarifa
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
