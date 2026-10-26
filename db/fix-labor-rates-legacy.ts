/**
 * One-off: resuelve el choque de la tabla `labor_rates` con la versión anterior
 * de la Fase 1 (esquema legacy: product_id + stage elaboracion|terminacion +
 * amount_micro). La tabla nueva de las fichas usa kind masa|terminacion +
 * mass_id/product_id + rate_micro (ver drizzle/0004_swift_post.sql).
 *
 *   Fase A: si existe `labor_rates` con columna `stage` → renombra a
 *           `labor_rates_legacy` (conserva TODAS las filas) y deja registro
 *           en audit_logs.
 *   Fase B: si `labor_rates` (nueva) existe vacía y `labor_rates_legacy`
 *           existe → copia las tarifas legacy de stage='terminacion'
 *           (kind='terminacion'; la elaboración por producto no tiene
 *           equivalente por masa, esos registros quedan solo en el legacy).
 *
 * Idempotente: se puede ejecutar varias veces sin efecto adicional.
 * Uso: npx tsx db/fix-labor-rates-legacy.ts
 */
import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/ny-system.db";
const db = new DatabaseSync(DB_PATH);

function pragmaColumns(table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

function tableExists(table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { name: string } | undefined;
  return row != null;
}

function audit(action: string, summary: string, details: unknown): void {
  db.prepare(
    `INSERT INTO audit_logs (created_at, action, entity_type, entity_id, summary, details_json)
     VALUES (datetime('now','localtime'), ?, ?, NULL, ?, ?)`,
  ).run(action, "database", summary, JSON.stringify(details));
}

let changed = false;

// --- Fase A: renombrar la tabla legacy ---
if (tableExists("labor_rates") && pragmaColumns("labor_rates").includes("stage")) {
  if (tableExists("labor_rates_legacy")) {
    throw new Error("Ambas tablas existen; resuelva manualmente antes de continuar.");
  }
  const rows = db.prepare("SELECT COUNT(*) AS n FROM labor_rates").get() as { n: number };
  db.exec("ALTER TABLE labor_rates RENAME TO labor_rates_legacy");
  audit(
    "labor_rates.legacy_renamed",
    `Tabla legacy renombrada a labor_rates_legacy (${rows.n} filas conservadas).`,
    { originalColumns: "product_id, stage, amount_micro", rowCount: rows.n },
  );
  console.log(`Fase A: labor_rates → labor_rates_legacy (${rows.n} filas conservadas).`);
  changed = true;
}

// --- Fase B: sembrar terminaciones desde el legacy ---
if (
  tableExists("labor_rates") &&
  pragmaColumns("labor_rates").includes("kind") &&
  tableExists("labor_rates_legacy") &&
  pragmaColumns("labor_rates_legacy").includes("stage")
) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM labor_rates").get() as { n: number };
  if (count.n === 0) {
    const res = db
      .prepare(
        `INSERT INTO labor_rates (kind, product_id, rate_micro, created_at, updated_at)
         SELECT 'terminacion', product_id, amount_micro, created_at, updated_at
         FROM labor_rates_legacy WHERE stage = 'terminacion'`,
      )
      .run();
    const copied = Number(res.changes);
    if (copied > 0) {
      const skipped = db
        .prepare("SELECT COUNT(*) AS n FROM labor_rates_legacy WHERE stage = 'elaboracion'")
        .get() as { n: number };
      audit(
        "labor_rates.legacy_imported",
        `Importadas ${copied} tarifas de terminación del legacy; ${skipped.n} de elaboración por producto quedaron solo en labor_rates_legacy (sin equivalente por masa).`,
        { imported: copied, skippedElaboracion: skipped.n },
      );
      console.log(
        `Fase B: ${copied} tarifas de terminación importadas; elaboración por producto (${skipped.n}) queda en labor_rates_legacy.`,
      );
      changed = true;
    }
  }
}

if (!changed) console.log("Nada por hacer (ya en el estado esperado).");
