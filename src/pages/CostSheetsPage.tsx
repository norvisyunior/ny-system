import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronsUpDown, Cookie, Info, RotateCcw, Table2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { ErrorAlert, Modal, Badge } from "../components/ui";

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
  "rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05)]";
const CARD_TITLE = "text-[15px] font-bold text-slate-800";
const INPUT =
  "h-9 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";
const INPUT_OV =
  "h-9 rounded-md border border-amber-300 bg-amber-50 px-2.5 text-[13px] text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";
const INPUT_OV_Q =
  "border border-amber-300 bg-amber-50 text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";
const INPUT_OV_P = INPUT_OV_Q;
const BTN_PRIMARY =
  "inline-flex h-9 items-center gap-2 rounded-md bg-[#1355d9] px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#1149ba] disabled:opacity-60";
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
  micro == null ? "—" : `${fmtDec(micro, 2)} CUP`;

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
  unitsPerPackage: "",
  salePrice: "",
  marginTargetPct: "30",
  elabRate: "",
  termRate: "",
  itemQty: {},
  itemSub: {},
  itemPrice: {},
});

function buildPayload(versionId: string, ov: Overrides): Record<string, unknown> {
  const input: Record<string, unknown> = { recipeVersionId: Number(versionId) };
  const setDec = (key: string, s: string) => {
    const v = decOrNull(s);
    if (v != null) input[key] = v;
  };
  setDec("masses", ov.masses);
  setDec("packages", ov.packages);
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
  if (items.length > 0) input.items = items;
  return input;
}

const hasOv = (ov: Overrides): boolean =>
  ov.masses !== "" ||
  ov.packages !== "" ||
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
  onQty,
  onSub,
  onPrice,
}: {
  sheet: CostSheet;
  ov: Overrides;
  materials: MaterialOption[];
  onQty: (itemId: number, v: string) => void;
  onSub: (itemId: number, v: string) => void;
  onPrice: (itemId: number, v: string) => void;
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
            </tr>
          </thead>
        <tbody>
          {sheet.ingredients.map((l) => {
            const sub = ov.itemSub[l.recipeItemId] ?? "";
            const qtyOv = ov.itemQty[l.recipeItemId];
            const qty = qtyInputVal(l.qtyPerMicro, qtyOv);
            const priceOv = ov.itemPrice[l.recipeItemId];
            const price = priceInputVal(l.pricePerBaseMicro, priceOv);
            const isOpen = open.has(l.recipeItemId);
            return (
              <Fragment key={l.recipeItemId}>
                <tr className="border-b border-slate-200 text-center">
                  <td className="w-7 py-1.5">
                    <button
                      className={`inline-flex items-center justify-center text-slate-400 transition-transform hover:text-slate-600 ${isOpen ? "rotate-90" : ""}`}
                      onClick={() => toggle(l.recipeItemId)}
                      aria-label="Ver fuente del precio"
                    >
                      ›
                    </button>
                  </td>
                  <td className="max-w-[180px] py-1.5 text-left">
                    <select
                      className={`h-7 max-w-[180px] truncate rounded-md border px-1 text-[12px] ${l.substituted ? "border-amber-300 bg-amber-50" : "border-transparent bg-transparent hover:border-slate-200"}`}
                      value={sub}
                      onChange={(e) => onSub(l.recipeItemId, e.target.value)}
                    >
                      <option value="">{l.originalName} · original</option>
                      {materials
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
                      className={`mx-auto h-7 w-14 rounded-md px-1 text-center text-[12px] ${qtyOv !== undefined ? INPUT_OV_Q : "border border-transparent bg-transparent hover:border-slate-200"}`}
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) => onQty(l.recipeItemId, e.target.value)}
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
                          className={`h-7 w-[76px] rounded-md px-1 text-center text-[13px] ${priceOv !== undefined ? INPUT_OV_P : "border border-slate-200"}`}
                          inputMode="decimal"
                          value={price}
                          onChange={(e) => onPrice(l.recipeItemId, e.target.value)}
                        />
                        <ChevronsUpDown
                          size={13}
                          className="cursor-pointer text-slate-300 hover:text-slate-500"
                          onClick={() => onPrice(l.recipeItemId, "")}
                        />
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 whitespace-nowrap font-semibold text-slate-700">
                    {fmtDec(l.costMicro, 2)}
                  </td>
                  <td className="py-1.5">
                    <EstadoBadge line={l} ov={ov} />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-[12px]">
                    <td></td>
                    <td colSpan={6} className="py-2 text-slate-600">
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
    <section className={`${CARD} p-5`}>
      <h2 className={CARD_TITLE}>Mano de obra - Elaboración de masas</h2>
      <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-[150px] flex-1">
          <div className="mb-1.5 text-[12px] font-medium text-slate-600">Tipo de masa</div>
          <select className={`${INPUT} w-full min-w-0`} value={d.massName} disabled>
            <option>{d.massName}</option>
          </select>
          {missing && (
            <button
              className="mt-2 text-[11px] font-semibold text-[#b45309] underline"
              onClick={onConfigure}
            >
              Configurar tarifa
            </button>
          )}
        </div>
        <div className="min-w-[140px] flex-1">
          <div className="mb-1.5 text-[12px] font-medium text-slate-600">Tarifa por masa</div>
          <div className="flex items-center gap-1.5">
            <input
              className={`min-w-0 flex-1 ${ov.elabRate !== "" ? INPUT_OV : INPUT}`}
              inputMode="decimal"
              placeholder={d.rateMicro != null ? fmtDec(d.rateMicro, 2) : "—"}
              value={ov.elabRate}
              onChange={(e) => onRate(e.target.value)}
            />
            <span className="text-[12px] font-medium text-slate-400">CUP</span>
          </div>
        </div>
        <div className="min-w-[110px]">
          <div className="text-[12px] font-medium text-slate-600">Costo total</div>
          <div className="text-[18px] font-bold text-slate-800">{fmtCup(d.costMicro)}</div>
        </div>
      </div>
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
    <section className={`${CARD} p-5`}>
      <h2 className={CARD_TITLE}>Mano de obra - Terminación y empaquetado</h2>
      <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-[150px] flex-1">
          <div className="mb-1.5 text-[12px] font-medium text-slate-600">Producto</div>
          <select className={`${INPUT} w-full min-w-0`} value={d.productName} disabled>
            <option>{d.productName}</option>
          </select>
          {missing && (
            <button
              className="mt-2 text-[11px] font-semibold text-[#b45309] underline"
              onClick={onConfigure}
            >
              Configurar tarifa
            </button>
          )}
        </div>
        <div className="min-w-[140px] flex-1">
          <div className="mb-1.5 text-[12px] font-medium text-slate-600">
            Tarifa por unidad ind.
          </div>
          <div className="flex items-center gap-1.5">
            <input
              className={`min-w-0 flex-1 ${ov.termRate !== "" ? INPUT_OV : INPUT}`}
              inputMode="decimal"
              placeholder={d.rateMicro != null ? fmtDec(d.rateMicro, 2) : "—"}
              value={ov.termRate}
              onChange={(e) => onRate(e.target.value)}
            />
            <span className="text-[12px] font-medium text-slate-400">CUP</span>
          </div>
        </div>
        <div className="min-w-[110px]">
          <div className="text-[12px] font-medium text-slate-600">Costo total</div>
          <div className="text-[18px] font-bold text-slate-800">{fmtCup(d.costMicro)}</div>
          <div className="text-[11px] text-slate-400">
            {fmtWhole(d.unitsTotalMicro)} unidades ind.
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empaquetado
// ---------------------------------------------------------------------------
function EmpaquetadoCard({ sheet }: { sheet: CostSheet }) {
  const total = sheet.costs.packagingMicro;
  return (
    <section className={`${CARD} p-5`}>
      <h2 className={CARD_TITLE}>Materiales de empaquetado</h2>
      {sheet.packaging.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[280px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[12px] font-semibold text-slate-500">
                <th className="pb-2">Material</th>
                <th className="w-28 pb-2 text-right">Costo</th>
              </tr>
            </thead>
            <tbody>
              {sheet.packaging.map((l) => {
                return (
                  <tr key={l.recipeItemId} className="border-b border-slate-100">
                    <td className="max-w-[150px] truncate py-2 text-slate-700">{l.name}</td>
                    <td className="py-2 text-right font-semibold text-slate-700">
                      {fmtDec(l.costMicro, 2)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-slate-200">
                <td className="py-2 font-bold text-slate-700">Total empaquetado</td>
                <td className="py-2 text-right text-[15px] font-bold text-slate-800">
                  {fmtDec(total, 2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-slate-400">Sin materiales de empaquetado en la receta.</p>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState(false);
  const [rateModal, setRateModal] = useState<
    { kind: "masa" | "terminacion"; id: number; name: string } | null
  >(null);
  const [rateVal, setRateVal] = useState("");
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
    apply: (x: CostSheet) => void,
  ) => {
    if (!v) return;
    const s = ++seq.current;
    setBusy(true);
    api
      .post<CostSheet>("/cost-sheets/preview", buildPayload(v, o))
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

  // Recalculo automático con los overrides (debounce tipo hoja de cálculo).
  useEffect(() => {
    if (!version) return;
    const t = setTimeout(() => recalc(version, ov, setSheet), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, JSON.stringify(ov)]);

  const setField = (f: keyof Omit<Overrides, "itemQty" | "itemSub" | "itemPrice">, v: string) =>
    setOv((o) => ({ ...o, [f]: v }));

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
    if (!hasOv(ov) || !version) {
      setOv(emptyOv());
      return;
    }
    setConfirmModal(true);
  };

  const doReset = () => {
    setConfirmModal(false);
    setOv(emptyOv());
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
          <select value="" onChange={(e) => setVersion(e.target.value)} className={`${INPUT} mx-auto mt-4 w-72`}>
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
                  onChange={(e) => setVersion(e.target.value)}
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
                  onChange={(e) => setField("masses", e.target.value)}
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
                  className={`${INPUT} w-28 text-center`}
                  readOnly
                  value={sheet ? `${fmtQtyEs(sheet.expectedYieldMicro)}` : ""}
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-center text-[12px] font-medium text-slate-600">
                Paquetes previstos
              </div>
              <div className="flex items-center justify-center gap-1.5">
                <input
                  className={`${INPUT} w-20 cursor-default bg-slate-50 text-center`}
                  readOnly
                  value={sheet ? fmtWhole(sheet.sim.packagesMicro) : ""}
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
              <button className={BTN_SOFT} onClick={resetSheet}>
                <RotateCcw size={14} /> Restablecer ficha
              </button>
              <button className={BTN_PRIMARY} onClick={() => recalc(version, ov, setSheet)}>
                <Table2 size={14} /> Simular cambios
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
                  onQty={setQty}
                  onSub={setSub}
                  onPrice={setPrice}
                />
              ) : (
                <div className={`${CARD} p-8 text-center text-[13px] text-slate-400`}>
                  Cargando ficha…
                </div>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
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
                    <EmpaquetadoCard sheet={sheet} />
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
                    <button
                      className={`${BTN_PRIMARY} mt-4 w-full justify-center py-2.5 text-[14px]`}
                      onClick={() => recalc(version, ov, setSheet)}
                    >
                      <Table2 size={15} /> Simular cambios
                    </button>
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
      {confirmModal && (
        <Modal title="Restablecer ficha" onClose={() => setConfirmModal(false)}>
          <p className="text-sm text-slate-600">
            ¿Restablecer la ficha a los valores originales? Se perderán las ediciones y sustituciones
            de esta simulación.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setConfirmModal(false)}>
              Cancelar
            </button>
            <button className="btn btn-danger" onClick={doReset}>
              Restablecer
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
