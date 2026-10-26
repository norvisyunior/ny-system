import { z } from "zod";
import {
  parseDecimalToMicro,
  mulQtyPrice,
  divRoundAway,
  microQtyToDecimal,
  microToDecimalTrim,
} from "../../shared/money";

/** Decimal (string o número) → micro-enteros. `minExclusive` marca > 0. */
export function decMicro(
  opts: { minExclusive?: boolean; max?: number; maxLabel?: string } = {},
) {
  return z.union([z.string(), z.number()]).transform((v, ctx) => {
    let micro: number;
    try {
      micro = parseDecimalToMicro(v);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor decimal inválido." });
      return z.NEVER;
    }
    if (opts.minExclusive ? micro <= 0 : micro < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: opts.minExclusive ? "Debe ser mayor que cero." : "No puede ser negativo.",
      });
      return z.NEVER;
    }
    if (opts.max != null && micro > opts.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `No puede exceder ${microToDecimalTrim(opts.max, 3)}${
          opts.maxLabel ? ` ${opts.maxLabel}` : ""
        }. Si el valor es tan grande, probablemente se cargó en unidades equivocadas.`,
      });
      return z.NEVER;
    }
    return micro;
  });
}

export { mulQtyPrice, divRoundAway, microQtyToDecimal, parseDecimalToMicro };
