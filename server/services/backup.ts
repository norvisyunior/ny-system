import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { count, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { auditLogs } from "../../db/schema";
import { conflictError, domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { DEFAULT_DB_PATH, createDb, releaseHandle, setDbHandle, type DbHandle } from "../db";
import { getSetting, setSetting } from "./settings";
import { addDaysISO, todayISO } from "../domain/dates";

// Carpeta de respaldos: configurable por entorno (Electron la fija en el perfil
// de usuario); por defecto data/backups del proyecto (desarrollo).
export const BACKUP_DIR =
  process.env.NY_SYSTEM_BACKUP_DIR ?? path.join(process.cwd(), "data", "backups");
const MAX_BACKUPS = 36;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.db$/;

export const DEFAULT_AUDIT_RETENTION_DAYS = 180;
export const auditKeepDaysSchema = z
  .number()
  .int("Los días deben ser un número entero.")
  .min(7, "Conserve al menos 7 días de auditoría.")
  .max(3650, "El máximo de retención es 3650 días (10 años).");

export interface BackupInfo {
  file: string;
  bytes: number;
  createdAt: string;
  kind: "manual" | "auto" | "safety" | "imported";
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
  if (file.includes("-imported-")) return "imported";
  return "manual";
}

function backupStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `-${String(now.getMilliseconds()).padStart(3, "0")}`
  );
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
  const createdAt = new Date().toISOString();
  const file = `ny-system-${kind}-${backupStamp()}.db`;
  const abs = path.join(BACKUP_DIR, file);
  handle.client.exec(`VACUUM INTO '${abs.replace(/'/g, "''")}'`);
  prune();
  return { file, bytes: statSync(abs).size, createdAt, kind };
}

/**
 * Importa un fichero .db externo (de otra PC, USB, etc.): lo copia a
 * data/backups con nombre normalizado, tras validar integridad y esquema.
 * Si no es válido se descarta y no queda pegado en el directorio.
 */
export function importBackup(buffer: Buffer): BackupInfo {
  ensureDir();
  const file = `ny-system-imported-${backupStamp()}.db`;
  const abs = path.join(BACKUP_DIR, file);
  writeFileSync(abs, buffer);
  try {
    let validation: BackupValidation;
    try {
      validation = validateDbFile(abs, file);
    } catch {
      throw conflictError(
        "El fichero importado no es una base de datos SQLite legible.",
        "INVALID_BACKUP",
      );
    }
    if (!validation.ok) {
      throw conflictError(
        `El fichero importado no es una base de datos válida del sistema (integridad: ${validation.integrity}, tablas: ${validation.tables}).`,
        "INVALID_BACKUP",
      );
    }
  } catch (err) {
    rmSync(abs, { force: true });
    throw err;
  }
  prune();
  return { file, bytes: statSync(abs).size, createdAt: new Date().toISOString(), kind: "imported" };
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

/** Valida integridad y esquema mínimo de un fichero .db ya localizado en disco. */
function validateDbFile(abs: string, label: string): BackupValidation {
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
      units = Number((check.prepare("SELECT COUNT(*) AS n FROM units").get() as { n: number }).n);
    } catch {
      units = 0;
    }
    const ok = integrity === "ok" && tables >= 20 && units > 0;
    return { ok, file: label, integrity, tables, units, sizeBytes: statSync(abs).size };
  } finally {
    check.close();
  }
}

/** Valida integridad y esquema mínimo de un respaldo del listado. */
export function validateBackup(file: string): BackupValidation {
  const abs = backupPath(file);
  if (!existsSync(abs)) throw notFoundError(`Respaldo "${file}"`);
  return validateDbFile(abs, file);
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

/**
 * Backup automático mensual: una copia al mes calendario. Se comprueba al
 * arrancar y periódicamente (por si la aplicación queda abierta cambia el mes).
 * Los respaldos manuales siguen siendo bajo demanda.
 */
export function runAutoBackup(handle: DbHandle): void {
  try {
    const month = todayISO().slice(0, 7);
    const last = getSetting(handle.db, "lastAutoBackupMonth");
    if (last === month) return;
    createBackup(handle, "auto");
    setSetting(handle.db, "lastAutoBackupMonth", month);
  } catch (err) {
    console.warn("[ny-system] Backup automático omitido:", (err as Error).message);
  }
}

function countAudit(handle: DbHandle, where?: SQL): number {
  const q = handle.db.select({ n: count() }).from(auditLogs);
  const row = where ? q.where(where).get() : q.get();
  return Number(row?.n ?? 0);
}

export function getAuditRetentionDays(handle: DbHandle): number {
  const saved = Number(getSetting(handle.db, "auditRetentionDays"));
  const parsed = auditKeepDaysSchema.safeParse(saved);
  return parsed.success ? parsed.data : DEFAULT_AUDIT_RETENTION_DAYS;
}

export interface AuditPurgePreview {
  keepDays: number;
  /** Se conserva desde este día (inclusive); lo anterior se elimina. */
  cutoff: string;
  candidates: number;
  remaining: number;
  oldest: string | null;
}

export function auditPurgePreview(handle: DbHandle, keepDays: number): AuditPurgePreview {
  const days = auditKeepDaysSchema.parse(keepDays);
  const cutoff = addDaysISO(todayISO(), -days);
  const candidates = countAudit(handle, lt(auditLogs.createdAt, cutoff));
  const oldest =
    handle.db
      .select({ createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .orderBy(auditLogs.createdAt)
      .limit(1)
      .get()?.createdAt ?? null;
  return {
    keepDays: days,
    cutoff,
    candidates,
    remaining: countAudit(handle) - candidates,
    oldest,
  };
}

export interface AuditPurgeResult {
  deleted: number;
  remaining: number;
  vacuumed: boolean;
  cutoff: string;
}

/**
 * Elimina la auditoría anterior al corte y compacta el archivo. La numeración
 * de documentos vive en `doc_counters`, así que la purga no la afecta.
 */
export function purgeAudit(handle: DbHandle, keepDays: number): AuditPurgeResult {
  const preview = auditPurgePreview(handle, keepDays);
  let deleted = 0;
  if (preview.candidates > 0) {
    deleted = Number(
      handle.db
        .transaction((tx) =>
          tx.delete(auditLogs).where(lt(auditLogs.createdAt, preview.cutoff)).run(),
        )
        .changes,
    );
  }
  let vacuumed = false;
  if (deleted > 0) {
    try {
      handle.client.exec("VACUUM");
      vacuumed = true;
    } catch (err) {
      console.warn("[ny-system] VACUUM omitido:", (err as Error).message);
    }
  }
  setSetting(handle.db, "auditRetentionDays", String(preview.keepDays));
  logAudit(handle.db, {
    action: "audit.purge",
    entityType: "audit_log",
    entityId: null,
    summary:
      deleted > 0
        ? `Auditoría depurada: ${deleted} evento(s) anterior(es) a ${preview.cutoff}`
        : `Auditoría revisada: no había eventos anteriores a ${preview.cutoff}`,
    details: { keepDays: preview.keepDays, cutoff: preview.cutoff, deleted, vacuumed },
  });
  return {
    deleted,
    remaining: countAudit(handle),
    vacuumed,
    cutoff: preview.cutoff,
  };
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
