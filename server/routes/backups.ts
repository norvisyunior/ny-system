import { Router } from "express";
import { z } from "zod";
import {
  backupAudit,
  backupPath,
  createBackup,
  listBackups,
  restoreBackup,
  validateBackup,
} from "../services/backup";
import { logAudit } from "../domain/audit";
import { domainError, notFoundError } from "../domain/errors";
import { handle } from "./helpers";

export const backupsRouter = Router();

const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.db$/;

backupsRouter.get("/", (_req, res) => {
  res.json({ ok: true, data: listBackups() });
});

backupsRouter.post("/", (req, res) => {
  const h = handle(req);
  const info = createBackup(h, "manual");
  backupAudit(h, "backup.create", `Respaldo manual creado: ${info.file}`, {
    bytes: info.bytes,
  });
  res.json({ ok: true, data: info });
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
