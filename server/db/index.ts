import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { drizzle, type NodeSqliteDatabase } from "./node-sqlite";
import { units } from "../../db/schema";
import { UNITS_SEED, UnitsCatalog } from "../domain/units";

export type DB = NodeSqliteDatabase;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_FOLDER = path.join(ROOT, "drizzle");
export const DEFAULT_DB_PATH = path.join(ROOT, "data", "ny-system.db");

export interface DbHandle {
  db: DB;
  client: DatabaseSync;
  units: UnitsCatalog;
}

/** Abre (creando si no existe) la BD, aplica migraciones y carga semillas base. */
export function createDb(dbPath: string = DEFAULT_DB_PATH): DbHandle {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const client = new DatabaseSync(dbPath);
  client.exec("PRAGMA journal_mode = WAL;");
  client.exec("PRAGMA foreign_keys = ON;");
  client.exec("PRAGMA busy_timeout = 5000;");

  const db = drizzle(client);
  migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });

  ensureUnits(db);
  const unitsCatalog = new UnitsCatalog(db.select().from(units).all());
  return { db, client, units: unitsCatalog };
}

function ensureUnits(db: DB): void {
  const existing = db.select({ code: units.code }).from(units).all();
  if (existing.length === 0) {
    db.insert(units).values(UNITS_SEED).run();
    return;
  }
  // La semilla crece con el sistema: agrega las unidades que falten en la BD
  // (p. ej. m/cm/mm) sin tocar las existentes.
  const known = new Set(existing.map((e) => e.code));
  const missing = UNITS_SEED.filter((u) => !known.has(u.code));
  if (missing.length > 0) db.insert(units).values(missing).run();
}

let singleton: DbHandle | null = null;

export function getDb(): DbHandle {
  if (!singleton) singleton = createDb();
  return singleton;
}

export function closeDb(): void {
  singleton?.client.close();
  singleton = null;
}

/**
 * Cierra el handle (usado antes de restaurar un respaldo) y limpia el
 * singleton si es la misma conexión. El siguiente getDb() crea una BD nueva.
 */
export function releaseHandle(h: DbHandle): void {
  try {
    h.client.close();
  } catch {
    // ya cerrada
  }
  if (singleton && singleton.client === h.client) singleton = null;
}

/** Fija el handle activo (tras restaurar un respaldo u otra reapertura). */
export function setDbHandle(h: DbHandle): void {
  singleton = h;
}

export { eq };
