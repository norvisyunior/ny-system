/**
 * Corrección puntual de datos de recetas:
 *
 *  PASO 1 — materiales de empaque (categoría "Empaque") en fase "masa":
 *     phase: 'masa' → 'paquete' (se consumen al terminar/empaquetar)
 *     qty:   pasaba de "por masa" a "por paquete" dividiéndola entre el
 *            rendimiento de la versión (paquetes por masa).
 *
 *  PASO 2 — ya están en fase "paquete" pero la cantidad sigue guardada
 *     "por masa" (qty >= rendimiento): también se divide entre el
 *     rendimiento. Ej.: San Jacobo v2 tenía 50 nylon/masa con rendimiento 50
 *     → 1 nylon por paquete.
 *
 * Uso:
 *   npx tsx db/fix-packaging-phase.ts --dry   (solo muestra, no escribe)
 *   npx tsx db/fix-packaging-phase.ts         (aplica)
 */
import { createDb } from "../server/db";

const dry = process.argv.includes("--dry");

interface Row {
  itemId: number;
  recipeName: string;
  version: number;
  materialName: string;
  category: string | null;
  phase: string;
  qtyMicro: number;
  unitId: string;
  yieldUnitId: string;
  expectedYieldMicro: number;
}

const h = createDb();

const rows = h.client
  .prepare(
    `SELECT ri.id            AS itemId,
            r.name           AS recipeName,
            rv.version       AS version,
            rm.name          AS materialName,
            rm.category      AS category,
            ri.phase         AS phase,
            ri.qty_micro     AS qtyMicro,
            ri.unit_id       AS unitId,
            rv.yield_unit_id AS yieldUnitId,
            rv.expected_yield_micro AS expectedYieldMicro
       FROM recipe_items ri
       JOIN recipe_versions rv ON rv.id = ri.recipe_version_id
       JOIN recipes r          ON r.id  = rv.recipe_id
       JOIN raw_materials rm   ON rm.id = ri.raw_material_id
      WHERE rm.category = 'Empaque'
        AND (ri.phase = 'masa'
             OR (ri.phase = 'paquete' AND rv.yield_unit_id = 'paquete'
                 AND ri.qty_micro >= rv.expected_yield_micro))
      ORDER BY r.name, rv.version, ri.id`,
  )
  .all() as unknown as Row[];

if (rows.length === 0) {
  console.log("Nada que corregir: los empaques ya están en fase 'paquete' con cantidad por paquete.");
  process.exit(0);
}

const fmt = (micro: number) => {
  const n = micro / 1_000_000;
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
};

let applied = 0;
for (const r of rows) {
  const origen = r.phase === "masa" ? "fase 'masa'" : "fase 'paquete' con cant. por masa";
  const actual = fmt(r.qtyMicro);

  if (r.yieldUnitId !== "paquete" || r.expectedYieldMicro <= 0) {
    console.log(
      `SKIP  ${r.recipeName} v${r.version} · ${r.materialName}: ` +
        `la versión no rinde en paquetes (rendimiento ${fmt(r.expectedYieldMicro)} ${r.yieldUnitId}).`,
    );
    continue;
  }

  // por_paquete = por_masa × 1e6 / rendimiento (paquetes por masa)
  const perPaqueteMicro = Math.round((r.qtyMicro * 1_000_000) / r.expectedYieldMicro);
  const rendimiento = fmt(r.expectedYieldMicro);

  console.log(
    `${dry ? "DRY " : "OK  "} ${r.recipeName} v${r.version} · ${r.materialName} [${origen}]: ` +
      `${actual} ${r.unitId}/masa → ${fmt(perPaqueteMicro)} ${r.unitId}/paquete ` +
      `(rendimiento ${rendimiento} paq/masa)`,
  );

  if (!dry) {
    h.client
      .prepare(
        `UPDATE recipe_items
            SET phase = 'paquete', qty_micro = ?
          WHERE id = ?`,
      )
      .run(perPaqueteMicro, r.itemId);
    applied += 1;
  }
}

if (!dry) {
  console.log(`\n${applied} ítem(s) corregido(s): fase 'paquete' con cantidad por paquete.`);
} else {
  console.log(`\nDry-run: ${rows.length} ítem(s) sin modificar (ejecute sin --dry para aplicar).`);
}
h.client.close();
