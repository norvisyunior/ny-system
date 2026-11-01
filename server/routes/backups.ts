import { Router, raw } from "express";
import { z } from "zod";
import {
  auditKeepDaysSchema,
  auditPurgePreview,
  backupAudit,
  backupPath,
  createBackup,
  getAuditRetentionDays,
  importBackup,
  listBackups,
  purgeAudit,
  restoreBackup,
  validateBackup,
} from "../services/backup";
import { logAudit } from "../domain/audit";
import { domainError, notFoundError } from "../domain/errors";
import { handle } from "./helpers";
import { pageParams, slicePage } from "./paging";

export const backupsRouter = Router();

const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.db$/;

backupsRouter.get("/", (req, res) => {
  const rows = listBackups();
  const pp = pageParams(req);
  if (pp) {
    res.json({ ok: true, data: slicePage(rows, pp) });
    return;
  }
  res.json({ ok: true, data: rows });
});

backupsRouter.post("/", (req, res) => {
  const h = handle(req);
  const info = createBackup(h, "manual");
  backupAudit(h, "backup.create", `Respaldo manual creado: ${info.file}`, {
    bytes: info.bytes,
  });
  res.json({ ok: true, data: info });
});

// Importación de ficheros externos: cuerpo binario del .db (sin multipart).
backupsRouter.post(
  "/import",
  raw({ type: "application/octet-stream", limit: "500mb" }),
  (req, res) => {
    const h = handle(req);
    const buf: unknown = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      throw domainError(
        "Envíe el fichero .db en el cuerpo de la petición (application/octet-stream).",
      );
    }
    const info = importBackup(buf);
    backupAudit(h, "backup.import", `Fichero de base de datos importado: ${info.file}`, {
      bytes: info.bytes,
    });
    res.json({ ok: true, data: info });
  },
);

const keepDaysParam = z.coerce.number().pipe(auditKeepDaysSchema);

backupsRouter.get("/maintenance/audit", (req, res) => {
  const h = handle(req);
  const query = z.object({ keepDays: keepDaysParam.optional() }).parse(req.query);
  const keepDays = query.keepDays ?? getAuditRetentionDays(h);
  res.json({ ok: true, data: auditPurgePreview(h, keepDays) });
});

const purgeAuditBody = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: "Debe confirmar la limpieza de auditoría (confirm: true)." }),
  }),
  keepDays: keepDaysParam,
});

backupsRouter.post("/maintenance/audit/purge", (req, res) => {
  const h = handle(req);
  const body = purgeAuditBody.parse(req.body);
  res.json({ ok: true, data: purgeAudit(h, body.keepDays) });
});

backupsRouter.get("/:file/download", (req, res) => {
  const file = String(req.params.file);
  if (!FILE_RE.test(file) || !listBackups().some((b) => b.file === file)) {
    throw notFoundError(`Respaldo "${file}"`);
  }
  res.download(backupPath(file));
});

backupsRouter.get("/:file/validate", (req, res) => {
  res.json({ ok: true, data: validateBackup(String(req.params.file)) });
});

const restoreBody = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: "Debe confirmar la restauración (confirm: true)." }),
  }),
});

backupsRouter.post("/:file/restore", (req, res) => {
  const h = handle(req);
  const file = String(req.params.file);
  restoreBody.parse(req.body);
  const result = restoreBackup(h, file);
  const { newHandle, ...info } = result;
  req.app.set("handle", newHandle);
  logAudit(newHandle.db, {
    action: "backup.restore",
    entityType: "backup",
    entityId: null,
    summary: `Respaldo restaurado desde ${file} (copia de seguridad: ${info.safetyCopy})`,
    details: info,
  });
  res.json({ ok: true, data: info });
});

backupsRouter.all("*", () => {
  throw domainError("Ruta de respaldo no válida.");
});
