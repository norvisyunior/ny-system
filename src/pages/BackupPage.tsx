import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { usePaged } from "../hooks/usePaged";
import { Badge, Callout, ErrorAlert, Modal } from "../components/ui";

interface AppSettings {
  businessName: string;
  currency: string;
  demoMode: boolean;
}

interface BackupRow {
  file: string;
  bytes: number;
  createdAt: string;
  kind: "manual" | "auto" | "safety";
}

interface AuditPreview {
  keepDays: number;
  cutoff: string;
  candidates: number;
  remaining: number;
  oldest: string | null;
}

const KIND_LABEL: Record<string, string> = {
  manual: "Manual",
  auto: "Automático",
  safety: "Pre-restauración",
};

export function BackupPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [auditDays, setAuditDays] = useState("180");
  const [auditPreview, setAuditPreview] = useState<AuditPreview | null>(null);
  const [auditTarget, setAuditTarget] = useState<AuditPreview | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const backups = usePaged<BackupRow>(({ page, pageSize }) =>
    api.get(`/backups?page=${page}&pageSize=${pageSize}`),
  );

  const loadSettings = useCallback(() => {
    api
      .get<AppSettings>("/settings")
      .then((s) => {
        setSettings(s);
        setName(s.businessName);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(loadSettings, [loadSettings]);

  const loadAuditPreview = useCallback(() => {
    api
      .get<AuditPreview>("/backups/maintenance/audit")
      .then((p) => {
        setAuditPreview(p);
        setAuditDays(String(p.keepDays));
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(loadAuditPreview, [loadAuditPreview]);

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const s = await api.put<AppSettings>("/settings", { businessName: name });
      setSettings(s);
      toast.success("Configuración guardada");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const createBackup = async () => {
    setError(null);
    try {
      const info = await api.post<BackupRow>("/backups");
      toast.success(`Respaldo creado: ${info.file}`);
      backups.reload();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  };

  const restore = async () => {
    if (!restoreTarget) return;
    setError(null);
    try {
      const r = await api.post<{ restored: string; safetyCopy: string }>(
        `/backups/${restoreTarget.file}/restore`,
        { confirm: true },
      );
      setRestoreTarget(null);
      toast.success(
        `Base de datos restaurada desde ${r.restored}. Copia de seguridad previa: ${r.safetyCopy}.`,
        { duration: 8000 },
      );
      loadSettings();
      backups.reload();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  };

  const reviewAudit = async () => {
    const days = Number(auditDays);
    if (!Number.isInteger(days) || days < 7 || days > 3650) {
      setError("Indique entre 7 y 3650 días de auditoría a conservar.");
      return;
    }
    setError(null);
    setMsg(null);
    try {
      const p = await api.get<AuditPreview>(`/backups/maintenance/audit?keepDays=${days}`);
      setAuditPreview(p);
      if (p.candidates === 0) {
        setMsg(`No hay eventos de auditoría anteriores a ${p.cutoff}.`);
        return;
      }
      setAuditTarget(p);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const purgeAuditLogs = async () => {
    if (!auditTarget) return;
    setAuditBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ deleted: number; remaining: number; vacuumed: boolean; cutoff: string }>(
        "/backups/maintenance/audit/purge",
        { confirm: true, keepDays: auditTarget.keepDays },
      );
      setAuditTarget(null);
      toast.success(
        `Auditoría depurada: ${r.deleted} evento(s) eliminado(s) anteriores a ${r.cutoff}. Quedan ${r.remaining}.` +
          (r.vacuumed ? " El archivo se compactó." : ""),
        { duration: 8000 },
      );
      loadAuditPreview();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setAuditBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Configuración y respaldos"
        subtitle="Copias de seguridad consistentes (VACUUM INTO), restauración validada y datos del negocio"
      />
      <Callout tone="warn" title="Respalda antes de restaurar">
        Restaurar reemplaza por completo el contenido de la base de datos. Genera primero un
        respaldo manual: la restauración crea además una copia de seguridad previa para poder
        volver atrás.
      </Callout>
      <ErrorAlert message={error ?? backups.error} />
      {msg && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {msg}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-bold text-slate-700">Datos del negocio</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label>Nombre del negocio</label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div className="field">
              <label>Moneda</label>
              <input value={settings?.currency ?? "CUP"} disabled />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {settings?.demoMode ? "Modo DEMO activo (datos de ejemplo)." : "Base de datos de trabajo."}
            </span>
            <button
              className="btn btn-primary"
              disabled={saving || name.trim().length < 2 || name === settings?.businessName}
              onClick={saveSettings}
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-sm font-bold text-slate-700">Respaldo ahora</h3>
          <p className="mb-3 text-sm text-slate-600">
            Se crea una copia consistente de la base completa en <code>data/backups/</code>. Los
            respaldos son manuales; además se crea uno automático al mes (al iniciar la app o al
            cambiar el mes). Se conservan hasta 36 respaldos.
          </p>
          <button className="btn btn-primary" onClick={createBackup}>
            + Crear respaldo manual
          </button>
        </div>
      </div>

      <div className="card mb-6 p-5">
        <h3 className="mb-2 text-sm font-bold text-slate-700">Mantenimiento de la auditoría</h3>
        <p className="mb-3 text-sm text-slate-600">
          La auditoría registra cada acción del sistema y es lo que más crece con los años. Puede
          eliminar los eventos antiguos para mantener la base ligera: la numeración de documentos y
          el inventario no se afectan. Los respaldos conservan la historia anterior.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="field w-64">
            <label>Conservar los últimos (días)</label>
            <input
              value={auditDays}
              onChange={(e) => setAuditDays(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <button className="btn btn-secondary" onClick={reviewAudit} disabled={auditBusy}>
            Revisar eventos antiguos
          </button>
          {auditPreview && (
            <span className="pb-2 text-xs text-slate-500">
              {auditPreview.candidates > 0
                ? `${auditPreview.candidates} evento(s) anteriores a ${auditPreview.cutoff}`
                : `Sin eventos anteriores a ${auditPreview.cutoff}`}
              {auditPreview.oldest ? ` · el más antiguo: ${auditPreview.oldest.slice(0, 10)}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="card overflow-hidden overflow-x-auto">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          Respaldos disponibles ({backups.total})
        </div>
        <table className="table-ny">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Tipo</th>
              <th>Fecha</th>
              <th className="num">Tamaño</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {backups.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">
                  {backups.loading
                    ? "Cargando…"
                    : "Aún no hay respaldos. Cree el primero con el botón superior."}
                </td>
              </tr>
            )}
            {backups.rows.map((b) => (
              <tr key={b.file}>
                <td className="font-mono text-xs">{b.file}</td>
                <td>
                  <Badge tone={b.kind === "auto" ? "amber" : "slate"}>{KIND_LABEL[b.kind]}</Badge>
                </td>
                <td>{new Date(b.createdAt).toLocaleString("es-ES")}</td>
                <td className="num">{(b.bytes / 1024).toFixed(1)} KB</td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <a className="btn btn-secondary" href={`/api/backups/${b.file}/download`}>
                      Descargar
                    </a>
                    <button
                      className="btn btn-danger"
                      onClick={() => {
                        setRestoreTarget(b);
                        setError(null);
                      }}
                    >
                      Restaurar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 pb-3">
          <Pager
            page={backups.page}
            pages={backups.pages}
            total={backups.total}
            pageSize={backups.pageSize}
            rowsCount={backups.rows.length}
            onPage={backups.setPage}
            label="respaldos"
          />
        </div>
      </div>

      <div className="mt-4 rounded-md bg-slate-50 p-4 text-xs text-slate-500">
        <strong>Restauración:</strong> se valida la integridad del archivo, se guarda una copia de
        seguridad del estado actual (prefijo <code>-safety-</code>) y luego se reemplaza la base
        completa. Los datos posteriores al respaldo seleccionado se pierden. Los respaldos con
        prefijo <code>-auto-</code> se generan solos una vez al mes; los manuales, cuando usted los
        crea.
      </div>

      {restoreTarget && (
        <Modal title="Restaurar respaldo" onClose={() => setRestoreTarget(null)}>
          <p className="mb-3 text-sm text-slate-600">
            Va a restaurar <strong className="font-mono">{restoreTarget.file}</strong>{" "}
            ({(restoreTarget.bytes / 1024).toFixed(1)} KB, {new Date(restoreTarget.createdAt).toLocaleString("es-ES")}).
            Todo dato ingresado después de este respaldo se perderá. Se creará primero una copia de
            seguridad del estado actual.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setRestoreTarget(null)}>
              Cancelar
            </button>
            <button className="btn btn-danger" onClick={restore}>
              Sí, restaurar
            </button>
          </div>
        </Modal>
      )}

      {auditTarget && (
        <Modal title="Limpiar auditoría" onClose={() => setAuditTarget(null)}>
          <p className="mb-3 text-sm text-slate-600">
            Se eliminarán <strong>{auditTarget.candidates}</strong> evento(s) de auditoría
            anteriores a <strong className="font-mono">{auditTarget.cutoff}</strong>. Quedarán{" "}
            {auditTarget.remaining}. Esta acción no se puede deshacer; los respaldos existentes
            conservan la historia anterior.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setAuditTarget(null)}>
              Cancelar
            </button>
            <button className="btn btn-danger" onClick={purgeAuditLogs} disabled={auditBusy}>
              {auditBusy ? "Limpiando…" : "Sí, limpiar auditoría"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
