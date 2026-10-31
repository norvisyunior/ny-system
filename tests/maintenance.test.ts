import { describe, expect, it } from "vitest";
import { auditLogs } from "../db/schema";
import { todayISO } from "../server/domain/dates";
import {
  auditKeepDaysSchema,
  auditPurgePreview,
  getAuditRetentionDays,
  purgeAudit,
} from "../server/services/backup";
import { buildReport } from "../server/services/reports";
import { newDb, shiftIso } from "./helpers";

function insertAudit(
  h: ReturnType<typeof newDb>,
  createdAt: string,
  action = "test.event",
): void {
  h.db
    .insert(auditLogs)
    .values({ action, entityType: "test", summary: action, createdAt })
    .run();
}

describe("Mantenimiento de auditoría", () => {
  it("la vista previa cuenta solo los eventos anteriores al corte", () => {
    const h = newDb();
    const today = todayISO();
    const cutoff = shiftIso(today, -30);
    insertAudit(h, `${shiftIso(today, -60)} 10:00:00`);
    insertAudit(h, `${cutoff} 00:00:00`);
    insertAudit(h, `${today} 09:00:00`);

    const preview = auditPurgePreview(h, 30);

    expect(preview.cutoff).toBe(cutoff);
    expect(preview.candidates).toBe(1);
    expect(preview.remaining).toBe(2);
    expect(preview.oldest).toContain(shiftIso(today, -60));
  });

  it("la purga borra lo antiguo, conserva el día del corte y deja registro", () => {
    const h = newDb();
    const today = todayISO();
    insertAudit(h, `${shiftIso(today, -60)} 10:00:00`);
    insertAudit(h, `${shiftIso(today, -30)} 00:00:00`);
    insertAudit(h, `${today} 09:00:00`);

    const result = purgeAudit(h, 30);

    expect(result.deleted).toBe(1);
    expect(result.remaining).toBe(3);
    const rows = h.db.select().from(auditLogs).all();
    expect(rows.filter((r) => r.action === "test.event")).toHaveLength(2);
    expect(rows.some((r) => r.action === "audit.purge")).toBe(true);
    expect(getAuditRetentionDays(h)).toBe(30);
  });

  it("valida el rango de días de retención", () => {
    expect(() => auditKeepDaysSchema.parse(6)).toThrow();
    expect(auditKeepDaysSchema.parse(180)).toBe(180);
    expect(() => auditKeepDaysSchema.parse(3651)).toThrow();
  });

  it("el reporte de auditoría incluye el día completo 'hasta'", () => {
    const h = newDb();
    insertAudit(h, "2026-10-27 23:59:59");
    insertAudit(h, "2026-10-28 23:59:59");
    insertAudit(h, "2026-10-29 00:00:00");

    const report = buildReport(h.db, "auditoria", { from: "2026-10-27", to: "2026-10-28" });

    expect(report.rows).toHaveLength(2);
    expect(report.rows[0].fecha).toBe("2026-10-28 23:59:59");
  });
});
