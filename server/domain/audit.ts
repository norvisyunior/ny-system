import { auditLogs } from "../../db/schema";
import type { DBOrTx } from "./types";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: number | null;
  summary: string;
  details?: unknown;
}

/**
 * Registra una entrada de auditoría. Debe ejecutarse dentro de la misma
 * transacción de la operación que se audita. Usuario fijo: 'admin' (sistema
 * de un solo usuario).
 */
export function logAudit(db: DBOrTx, input: AuditInput): void {
  db.insert(auditLogs)
    .values({
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      detailsJson: input.details !== undefined ? JSON.stringify(input.details) : null,
    })
    .run();
}
