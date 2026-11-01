export class ApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readEnvelope<T>(res: Response, payload: unknown): T {
  if (!res.ok) {
    const err = payload as { error?: string; code?: string; details?: unknown } | null;
    throw new ApiError(
      err?.error ?? "Ocurrió un error inesperado.",
      res.status,
      err?.code,
      err?.details,
    );
  }
  const env = payload as { ok?: boolean; data?: unknown } | null;
  if (env && typeof env === "object" && env.ok === true && "data" in env) {
    return env.data as T;
  }
  return payload as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      "No se pudo conectar con el servicio local. Verifique que la aplicación esté en ejecución.",
      0,
      "NETWORK_ERROR",
    );
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // respuesta sin cuerpo
  }
  return readEnvelope<T>(res, payload);
}

/** POST con cuerpo binario (p. ej. importar un fichero .db de respaldo). */
async function requestRaw<T>(path: string, body: Blob): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
  } catch {
    throw new ApiError(
      "No se pudo conectar con el servicio local. Verifique que la aplicación esté en ejecución.",
      0,
      "NETWORK_ERROR",
    );
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // respuesta sin cuerpo
  }
  return readEnvelope<T>(res, payload);
}

/** Envoltura de listado paginado (?page en la URL). */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Un endpoint devuelve Paged cuando se le pidió ?page, o array completo si no. */
export function isPaged<T>(value: unknown): value is Paged<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { total?: unknown }).total === "number"
  );
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  postRaw: <T>(path: string, body: Blob) => requestRaw<T>(path, body),
};
