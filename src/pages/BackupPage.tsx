import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
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

const KIND_LABEL: Record<string, string> = {
  manual: "Manual",
  auto: "Automático",
  safety: "Pre-restauración",
};

export function BackupPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [name, setName] = useState("");
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);

  const load = useCallback(() => {
    api
      .get<AppSettings>("/settings")
      .then((s) => {
        setSettings(s);
        setName(s.businessName);
      })
      .catch((e: ApiError) => setError(e.message));
    api.get<BackupRow[]>("/backups").then(setBackups).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const s = await api.put<AppSettings>("/settings", { businessName: name });
      setSettings(s);
      setMsg("Configuración guardada.");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const createBackup = async () => {
    setError(null);
    setMsg(null);
    try {
      const info = await api.post<BackupRow>("/backups");
      setMsg(`Respaldo creado: ${info.file}`);
      setBackups(await api.get<BackupRow[]>("/backups"));
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const restore = async () => {
    if (!restoreTarget) return;
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ restored: string; safetyCopy: string }>(
        `/backups/${restoreTarget.file}/restore`,
        { confirm: true },
      );
      setRestoreTarget(null);
      setMsg(`Restaurado desde ${r.restored}. Copia de seguridad previa: ${r.safetyCopy}.`);
      load();
    } catch (e) {
      setError((e as ApiError).message);
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
      <ErrorAlert message={error} />
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
            Se crea una copia consistente de la base completa en <code>data/backups/</code>.
            Se conservan los últimos 20 respaldos y uno automático diario al iniciar.
          </p>
          <button className="btn btn-primary" onClick={createBackup}>
            + Crear respaldo manual
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          Respaldos disponibles ({backups.length})
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
            {backups.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">
                  Aún no hay respaldos. Cree el primero con el botón superior.
                </td>
              </tr>
            )}
            {backups.map((b) => (
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
      </div>

      <div className="mt-4 rounded-md bg-slate-50 p-4 text-xs text-slate-500">
        <strong>Restauración:</strong> se valida la integridad del archivo, se guarda una copia de
        seguridad del estado actual (prefijo <code>-safety-</code>) y luego se reemplaza la base
        completa. Los datos posteriores al respaldo seleccionado se pierden. Los respaldos con
        prefijo <code>-auto-</code> se generan solos al iniciar la aplicación.
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
    </div>
  );
}
