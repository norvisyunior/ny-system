/**
 * Manejo centralizado de errores.
 * El usuario ve `userMessage` (en español, sin detalles técnicos);
 * el log técnico conserva `code`, `details` y el stack original.
 */
export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly status: number;
  readonly details?: unknown;
  readonly cause?: unknown;

  constructor(opts: {
    code: string;
    userMessage: string;
    status?: number;
    details?: unknown;
    cause?: unknown;
  }) {
    super(opts.userMessage);
    this.name = "AppError";
    this.code = opts.code;
    this.userMessage = opts.userMessage;
    this.status = opts.status ?? 400;
    this.details = opts.details;
    this.cause = opts.cause;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError || (e as AppError)?.name === "AppError";
}

/** Error de negocio (validación, stock, permiso de operación). */
export function domainError(userMessage: string, code = "DOMAIN_ERROR", details?: unknown): AppError {
  return new AppError({ code, userMessage, status: 400, details });
}

/** No encontrado. */
export function notFoundError(entity: string): AppError {
  return new AppError({
    code: "NOT_FOUND",
    userMessage: `${entity} no encontrado.`,
    status: 404,
  });
}

/** Conflicto (duplicado, cierre protegido, etc.). */
export function conflictError(userMessage: string, code = "CONFLICT"): AppError {
  return new AppError({ code, userMessage, status: 409 });
}

/** Stock insuficiente con mensaje claro. */
export function insufficientStockError(itemName: string, available: string, required: string): AppError {
  return new AppError({
    code: "INSUFFICIENT_STOCK",
    userMessage: `No se puede completar la operación: el inventario de "${itemName}" es insuficiente (disponible: ${available}, requerido: ${required}).`,
    status: 400,
    details: { itemName, available, required },
  });
}
