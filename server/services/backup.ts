import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { conflictError, domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { DEFAULT_DB_PATH, createDb, releaseHandle, setDbHandle, type DbHandle } from "../db";
import { getSetting, setSetting } from "./settings";
import { todayISO } from "../domain/dates";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BACKUP_DIR = path.join(ROOT, "data", "backups");
const MAX_BACKUPS = 20;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.db$/;

export interface BackupInfo {
  file: string;
  bytes: number;
  createdAt: string;
  kind: "manual" | "auto" | "safety";
}

function ensureDir(): void {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

export function backupPath(file: string): string {
  if (!FILE_RE.test(file)) {
    throw domainError(`Nombre de respaldo inválido: "${file}".`);
  }
  const abs = path.resolve(BACKUP_DIR, file);
  if (!abs.startsWith(BACKUP_DIR + path.sep)) {
    throw domainError("Ruta de respaldo fuera del directorio permitido.");
  }
  return abs;
}

function kindOf(file: string): BackupInfo["kind"] {
  if (file.includes("-auto-")) return "auto";
  if (file.includes("-safety-")) return "safety";
  return "manual";
}

function prune(): void {
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .map((f) => ({ f, m: statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const extra of files.slice(MAX_BACKUPS)) {
    rmSync(path.join(BACKUP_DIR, extra.f), { force: true });
  }
}

/** Copia consistente con VACUUM INTO (nunca se lee sobre el archivo vivo). */
export function createBackup(handle: DbHandle, kind: "manual" | "auto" | "safety"): BackupInfo {
  ensureDir();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `-${String(now.getMilliseconds()).padStart(3, "0")}`;
  const file = `ny-system-${kind}-${stamp}.db`;
  const abs = path.join(BACKUP_DIR, file);
  handle.client.exec(`VACUUM INTO '${abs.replace(/'/g, "''")}'`);
  prune();
  return { file, bytes: statSync(abs).size, createdAt: now.toISOString(), kind };
}

export function listBackups(): BackupInfo[] {
  ensureDir();
  return readdirSync(BACKUP_DIR)
    .filter((f) => FILE_RE.test(f))
    .map((f) => {
      const st = statSync(path.join(BACKUP_DIR, f));
      return {
        file: f,
        bytes: st.size,
        createdAt: st.mtime.toISOString(),
        kind: kindOf(f),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface BackupValidation {
  ok: boolean;
  file: string;
  integrity: string;
  tables: number;
  units: number;
  sizeBytes: number;
}

/** Valida integridad y que contenga el esquema mínimo antes de restaurar. */
export function validateBackup(file: string): BackupValidation {
  const abs = backupPath(file);
  if (!existsSync(abs)) throw notFoundError(`Respaldo "${file}"`);
  const check = new DatabaseSync(abs);
  try {
    const integrity = String(
      (check.prepare("PRAGMA integrity_check").get() as Record<string, unknown>)?.integrity_check ??
        "unknown",
    );
    const tables = Number(
      (check
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
        .get() as { n: number }).n,
    );
    let units = 0;
    try {
      units = Number(
        (check.prepare("SELECT COUNT(*) AS n FROM units").get() as { n: number }).n,
      );
    } catch {
      units = 0;
    }
    const ok = integrity === "ok" && tables >= 20 && units > 0;
    return { ok, file, integrity, tables, units, sizeBytes: statSync(abs).size };
  } finally {
    check.close();
  }
}

export interface RestoreResult {
  restored: string;
  safetyCopy: string;
  tables: number;
  newHandle: DbHandle;
}

/**
 * Restaura un respaldo: valida → copia de seguridad del actual → cierra la
 * conexión → reemplaza el archivo → reabre con migraciones. Auditado por el llamador.
 */
export function restoreBackup(handle: DbHandle, file: string): RestoreResult {
  const validation = validateBackup(file);
  if (!validation.ok) {
    throw conflictError(
      `El respaldo "${file}" no es válido (integridad: ${validation.integrity}, tablas: ${validation.tables}).`,
      "INVALID_BACKUP",
    );
  }
  const safety = createBackup(handle, "safety");
  releaseHandle(handle);
  const abs = backupPath(file);
  copyFileSync(abs, DEFAULT_DB_PATH);
  for (const suffix of ["-wal", "-shm"]) {
    rmSync(`${DEFAULT_DB_PATH}${suffix}`, { force: true });
  }
  const fresh = createDb(DEFAULT_DB_PATH);
  setDbHandle(fresh);
  const row = fresh.client
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
    .get() as { n: number };
  return {
    restored: file,
    safetyCopy: safety.file,
    tables: Number(row.n),
    newHandle: fresh,
  };
}

/** Backup automático diario al arrancar (retención manejada en createBackup). */
export function runAutoBackup(handle: DbHandle): void {
  try {
    const today = todayISO();
    const last = getSetting(handle.db, "lastAutoBackup");
    if (last === today) return;
    createBackup(handle, "auto");
    setSetting(handle.db, "lastAutoBackup", today);
  } catch (err) {
    console.warn("[ny-system] Backup automático omitido:", (err as Error).message);
  }
}

export function backupAudit(handle: DbHandle, action: string, summary: string, details?: unknown): void {
  logAudit(handle.db, {
    action,
    entityType: "backup",
    entityId: null,
    summary,
    details,
  });
}
