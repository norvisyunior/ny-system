/**
 * Manejo monetario — SIN FLOAT.
 * Todo el dinero se guarda en micro-CUP: entero = 1/1,000,000 CUP.
 * $1.50 → 1_500_000.  Los cálculos intermedios usan BigInt.
 * Redondeo: half-away-from-zero (a .5 se redondea alejándose de cero),
 * aplicado de forma consistente en todo el sistema.
 */

export const MICRO = 1_000_000n;

/** Parsea un decimal en string (o number) a micro-CUP entero. Lanza error si no es válido. */
export function parseDecimalToMicro(input: string | number): number {
  const raw = typeof input === "number" ? numberToCleanString(input) : input.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
  if (!match) throw new Error(`Valor decimal inválido: "${raw}"`);
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fracStr = (match[3] ?? "").padEnd(6, "0");
  const frac = BigInt(fracStr);
  const result = sign * (whole * MICRO + frac);
  return assertSafeInt(Number(result));
}

/** Con un number: usa su representación decimal corta (evita 0.1+0.2 en la entrada). */
function numberToCleanString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Valor inválido: ${n}`);
  return String(n);
}

/** micro-CUP → texto decimal con `decimals` decimales (redondeo half-away-from-zero). */
export function microToDecimal(micro: number, decimals = 2): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new Error(`Decimales fuera de rango: ${decimals}`);
  }
  const m = BigInt(Math.trunc(micro));
  const factor = 10n ** BigInt(6 - decimals); // divisor: micro → unidad del último decimal
  const scale = 10n ** BigInt(decimals); // enteros por unidad del último decimal
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const rem = abs % factor;
  let q = abs / factor;
  if (rem * 2n >= factor) q += 1n;
  const whole = q / scale;
  const frac = decimals > 0 ? "." + (q % scale).toString().padStart(decimals, "0") : "";
  return `${neg ? "-" : ""}${whole}${frac}`;
}

/** Cantidad (micro-unidades de su unidad base) → texto decimal. */
export function microQtyToDecimal(qtyMicro: number, decimals = 3): string {
  return microToDecimal(qtyMicro, decimals);
}

/** Como microToDecimal pero sin ceros sobrantes: 215.000 → "215", 1.500 → "1.5".
 *  Uso en textos de cantidad para que no se lean como miles ("215.000" = 215 mil). */
export function microToDecimalTrim(micro: number, decimals = 3): string {
  const s = microToDecimal(micro, decimals);
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Multiplica cantidad × precio y divide por 1e6 con redondeo.
 * qtyMicro: micro-unidades de la unidad base.
 * pricePerFullUnitMicro: micro-CUP por 1 unidad COMPLETA de la unidad base.
 * Resultado: micro-CUP.
 */
export function mulQtyPrice(qtyMicro: number, pricePerFullUnitMicro: number): number {
  const product = BigInt(Math.trunc(qtyMicro)) * BigInt(Math.trunc(pricePerFullUnitMicro));
  return assertSafeInt(Number(divRoundAway(product, MICRO)));
}

/** Redondeo half-away-from-zero de a/b (BigInt). */
export function divRoundAway(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("División por cero");
  const neg = (a < 0n) !== (b < 0n);
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = absA / absB;
  const r = absA % absB;
  const rounded = r * 2n >= absB ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** Suma segura de micro-enteros con verificación de rango. */
export function addMicro(...values: number[]): number {
  let total = 0n;
  for (const v of values) total += BigInt(Math.trunc(v));
  return assertSafeInt(Number(total));
}

export function assertSafeInt(n: number): number {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Número fuera de rango seguro: ${n}`);
  }
  return n;
}

/** Formatea micro-CUP como moneda para mostrar: $ 1,234.56 */
export function formatCUP(micro: number, opts: { symbol?: boolean } = {}): string {
  const symbol = opts.symbol === false ? "" : "$";
  const decimals = microToDecimal(micro, 2);
  const [whole, frac] = decimals.split(".");
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${symbol} ${withSeparators}${frac ? "." + frac : ""}`.trim();
}
