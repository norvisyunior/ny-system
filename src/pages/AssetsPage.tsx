import { useCallback, useEffect, useState } from "react";
import { Archive, Eye, Pencil } from "lucide-react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { RowAction, RowActions } from "../components/RowActions";
import {
  Badge,
  ErrorAlert,
  Modal,
  SearchInput,
  fmtMoney,
  todayISO,
} from "../components/ui";
import { usePaged } from "../hooks/usePaged";

interface AssetRow {
  id: number;
  code: string;
  name: string;
  category: string | null;
  acquiredAt: string;
  costMicro: number;
  residualMicro: number;
  usefulLifeMonths: number;
  method: string;
  supplierId: number | null;
  supplierName: string | null;
  location: string | null;
  status: string;
  disposedAt: string | null;
  disposeType: string | null;
  recoveryValueMicro: number;
  monthlyMicro: number;
  depreciatedMicro: number;
  bookValueMicro: number;
}

interface AssetDetail {
  asset: AssetRow & { notes: string | null; createdAt: string; updatedAt: string | null };
  depreciations: {
    id: number;
    period: string;
    amountMicro: number;
    expenseId: number | null;
    expenseStatus: string | null;
    createdAt: string;
  }[];
  monthlyMicro: number;
  depreciatedMicro: number;
  bookValueMicro: number;
  depreciableMicro: number;
}

interface Supplier {
  id: number;
  name: string;
  active: boolean;
}

const EMPTY = {
  name: "",
  category: "",
  acquiredAt: todayISO(),
  cost: "",
  residual: "0",
  usefulLifeMonths: "60",
  supplierId: "",
  location: "",
  notes: "",
};

const DISPOSE_TYPES = [
  { value: "venta", label: "Venta" },
  { value: "danado", label: "Dañado" },
  { value: "obsoleto", label: "Obsoleto" },
  { value: "otro", label: "Otro" },
] as const;

function currentPeriod(): string {
  return todayISO().slice(0, 7);
}

function statusBadge(status: string) {
  return status === "en_uso" ? <Badge tone="green">En uso</Badge> : <Badge tone="red">Baja</Badge>;
}

export function AssetsPage() {
  const [status, setStatus] = useState("all");
  const list = usePaged<AssetRow>(({ page, pageSize, search }) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (search) params.set("q", search);
    if (status !== "all") params.set("status", status);
    return api.get(`/assets?${params.toString()}`);
  }, [status]);
  const rows = list.rows;
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState<(typeof EMPTY & { id: number; lockFinancial: boolean }) | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [showDepreciate, setShowDepreciate] = useState(false);
  const [disposeTarget, setDisposeTarget] = useState<AssetRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<Supplier[]>("/suppliers")
      .then((s) => setSuppliers(s.filter((x) => x.active)))
      .catch(() => undefined);
  }, []);

  const openDetail = useCallback((id: number) => {
    setError(null);
    api
      .get<AssetDetail>(`/assets/${id}`)
      .then(setDetail)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  const openNew = () => {
    setForm({ ...EMPTY, acquiredAt: todayISO(), id: 0, lockFinancial: false });
    setError(null);
  };

  const openEdit = async (row: AssetRow) => {
    setError(null);
    try {
      const d = await api.get<AssetDetail>(`/assets/${row.id}`);
      const a = d.asset;
      setForm({
        id: a.id,
        name: a.name,
        category: a.category ?? "",
        acquiredAt: a.acquiredAt,
        cost: String(a.costMicro / 1_000_000),
        residual: String(a.residualMicro / 1_000_000),
        usefulLifeMonths: String(a.usefulLifeMonths),
        supplierId: a.supplierId ? String(a.supplierId) : "",
        location: a.location ?? "",
        notes: a.notes ?? "",
        lockFinancial: d.depreciations.length > 0,
      });
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        category: form.category || null,
        acquiredAt: form.acquiredAt,
        cost: form.cost,
        residual: form.residual || "0",
        usefulLifeMonths: Number(form.usefulLifeMonths),
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        location: form.location || null,
        notes: form.notes || null,
      };
      if (form.id) await api.put(`/assets/${form.id}`, body);
      else await api.post("/assets", body);
      setForm(null);
      list.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Activos fijos tangibles"
        subtitle="Bienes duraderos con depreciación lineal mensual y valor en libros"
        actions={
          <div className="flex gap-2">
            <a className="btn btn-secondary" href="/api/assets/csv" download>
              Exportar CSV
            </a>
            <button className="btn btn-secondary" onClick={() => setShowDepreciate(true)}>
              Depreciar hasta mes…
            </button>
            <button className="btn btn-primary" onClick={openNew}>
              + Nuevo activo
            </button>
          </div>
        }
      />
      <ErrorAlert message={error ?? list.error} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Buscar por código, nombre o categoría…"
        />
        <div className="flex items-center gap-3">
          <select
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              list.setPage(1);
            }}
          >
            <option value="all">Todos los estados</option>
            <option value="en_uso">En uso</option>
            <option value="baja">Dados de baja</option>
          </select>
          <span className="text-sm text-slate-500">{list.total} activo(s)</span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="table-ny">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Adquisición</th>
              <th className="num">Costo</th>
              <th className="num">Cuota mensual</th>
              <th className="num">Deprec. acumulada</th>
              <th className="num">Valor en libros</th>
              <th className="center">Estado</th>
              <th className="w-24 text-right">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-400">
                  {list.loading ? "Cargando…" : "Sin activos fijos registrados."}
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="font-mono font-semibold">{a.code}</td>
                <td className="font-medium">{a.name}</td>
                <td>{a.category ?? "—"}</td>
                <td>{a.acquiredAt}</td>
                <td className="num">{fmtMoney(a.costMicro)}</td>
                <td className="num">{fmtMoney(a.monthlyMicro)}</td>
                <td className="num">{fmtMoney(a.depreciatedMicro)}</td>
                <td className="num font-semibold">{fmtMoney(a.bookValueMicro)}</td>
                <td className="center">{statusBadge(a.status)}</td>
                <td className="text-right">
                  <RowActions>
                    <RowAction icon={Eye} label="Ver ficha" onClick={() => openDetail(a.id)} />
                    {a.status === "en_uso" && (
                      <>
                        <RowAction icon={Pencil} label="Editar" onClick={() => openEdit(a)} />
                        <RowAction
                          icon={Archive}
                          label="Dar de baja"
                          tone="danger"
                          onClick={() => setDisposeTarget(a)}
                        />
                      </>
                    )}
                  </RowActions>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 pb-3">
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            pageSize={list.pageSize}
            rowsCount={rows.length}
            onPage={list.setPage}
            label="activos"
          />
        </div>
      </div>

      {form && (
        <Modal
          title={form.id ? `Editar activo — ${form.name}` : "Nuevo activo fijo"}
          onClose={() => setForm(null)}
          wide
        >
          <div className="flex flex-col gap-3">
            <ErrorAlert message={error} />
            {form.lockFinancial && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Este activo ya tiene depreciaciones asentadas: los campos financieros
                (fecha de adquisición, costo, residual y vida útil) están bloqueados.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Nombre *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="EJ: Laptop Lenovo ThinkPad"
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Categoría</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="EJ: Equipos de cómputo"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="field">
                <label>Fecha de adquisición *</label>
                <input
                  type="date"
                  value={form.acquiredAt}
                  max={todayISO()}
                  disabled={form.lockFinancial}
                  onChange={(e) => e.target.value && setForm({ ...form, acquiredAt: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Costo de adquisición *</label>
                <input
                  value={form.cost}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={form.lockFinancial}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Valor residual</label>
                <input
                  value={form.residual}
                  inputMode="decimal"
                  disabled={form.lockFinancial}
                  onChange={(e) => setForm({ ...form, residual: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="field">
                <label>Vida útil (meses) *</label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={form.usefulLifeMonths}
                  disabled={form.lockFinancial}
                  onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Proveedor</label>
                <select
                  value={form.supplierId}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                >
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Ubicación</label>
                <input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="EJ: Oficina"
                />
              </div>
            </div>
            <div className="field">
              <label>Notas</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setForm(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={save}
                disabled={
                  saving ||
                  !form.name.trim() ||
                  !form.cost.trim() ||
                  !(Number(form.usefulLifeMonths) >= 1)
                }
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`Ficha — ${detail.asset.code} ${detail.asset.name}`} onClose={() => setDetail(null)} wide>
          <div className="mb-4 grid grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-slate-500">Categoría</div>
              <div className="font-semibold">{detail.asset.category ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-500">Adquisición</div>
              <div className="font-semibold">{detail.asset.acquiredAt}</div>
            </div>
            <div>
              <div className="text-slate-500">Proveedor</div>
              <div className="font-semibold">{detail.asset.supplierName ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-500">Ubicación</div>
              <div className="font-semibold">{detail.asset.location ?? "—"}</div>
            </div>
            <div>
              <div className="text-slate-500">Vida útil</div>
              <div className="font-semibold">{detail.asset.usefulLifeMonths} meses</div>
            </div>
            <div>
              <div className="text-slate-500">Método</div>
              <div className="font-semibold capitalize">{detail.asset.method}</div>
            </div>
            <div>
              <div className="text-slate-500">Estado</div>
              {statusBadge(detail.asset.status)}
            </div>
            <div>
              <div className="text-slate-500">Baja</div>
              <div className="font-semibold">
                {detail.asset.disposedAt
                  ? `${detail.asset.disposedAt} (${detail.asset.disposeType ?? "—"})`
                  : "—"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">Costo</div>
              <div className="font-bold">{fmtMoney(detail.asset.costMicro)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Residual</div>
              <div className="font-bold">{fmtMoney(detail.asset.residualMicro)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Cuota mensual</div>
              <div className="font-bold">{fmtMoney(detail.monthlyMicro)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Deprec. acumulada</div>
              <div className="font-bold">{fmtMoney(detail.depreciatedMicro)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Valor en libros</div>
              <div className="font-bold text-emerald-700">{fmtMoney(detail.bookValueMicro)}</div>
            </div>
          </div>

          {detail.asset.notes && (
            <p className="mt-3 whitespace-pre-wrap text-xs text-slate-500">{detail.asset.notes}</p>
          )}

          <h3 className="mb-2 mt-5 text-sm font-bold text-slate-700">Depreciaciones asentadas</h3>
          <table className="table-ny">
            <thead>
              <tr>
                <th>Periodo</th>
                <th className="num">Importe</th>
                <th>Gasto</th>
                <th className="center">Estado gasto</th>
                <th>Registrado</th>
              </tr>
            </thead>
            <tbody>
              {detail.depreciations.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-400">
                    Sin depreciaciones. Use «Depreciar hasta mes…» para asentarlas.
                  </td>
                </tr>
              )}
              {detail.depreciations.map((d) => (
                <tr key={d.id}>
                  <td className="font-mono">{d.period}</td>
                  <td className="num font-semibold">{fmtMoney(d.amountMicro)}</td>
                  <td>{d.expenseId ? `#${d.expenseId}` : "—"}</td>
                  <td className="center">
                    {d.expenseStatus === "anulado" ? (
                      <Badge tone="red">Anulado</Badge>
                    ) : (
                      <Badge tone="green">Vigente</Badge>
                    )}
                  </td>
                  <td>{d.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end gap-2">
            {detail.asset.status === "en_uso" && (
              <>
                <button className="btn btn-secondary mr-auto" onClick={() => openEdit(detail.asset)}>
                  Editar
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    setDisposeTarget(detail.asset);
                    setDetail(null);
                  }}
                >
                  Dar de baja
                </button>
              </>
            )}
            <button className="btn btn-secondary" onClick={() => setDetail(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}

      {showDepreciate && (
        <DepreciateModal
          onClose={() => setShowDepreciate(false)}
          onDone={() => {
            list.reload();
            if (detail) openDetail(detail.asset.id);
          }}
        />
      )}

      {disposeTarget && (
        <DisposeModal
          target={disposeTarget}
          onClose={() => setDisposeTarget(null)}
          onDone={() => {
            list.reload();
            if (detail) openDetail(detail.asset.id);
          }}
        />
      )}
    </div>
  );
}

function DepreciateModal({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    untilPeriod: string;
    assetsProcessed: number;
    created: number;
    skipped: number;
    totalMicro: number;
  } | null>(null);

  const run = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await api.post<{
        untilPeriod: string;
        assetsProcessed: number;
        created: number;
        skipped: number;
        totalMicro: number;
      }>("/assets/depreciate", { untilPeriod: period });
      setResult(r);
      onDone?.();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Depreciación mensual" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">
          Asienta la depreciación lineal de todos los activos «en uso» desde su adquisición hasta el
          mes elegido. Es idempotente: los meses ya asentados se omiten, y cada cuota crea un gasto
          «Depreciación de activos».
        </p>
        <div className="field">
          <label>Depreciar hasta el mes *</label>
          <input
            type="month"
            value={period}
            max={currentPeriod()}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
          />
        </div>
        <ErrorAlert message={error} />
        {result && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Periodo {result.untilPeriod}: {result.created} cuota(s) asentada(s) por{" "}
            {fmtMoney(result.totalMicro)} en {result.assetsProcessed} activo(s).
            {result.skipped > 0 && ` ${result.skipped} mes(es) ya existían y se omitieron.`}
          </div>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>
            {result ? "Cerrar" : "Cancelar"}
          </button>
          <button className="btn btn-primary" onClick={run} disabled={saving || !period}>
            {saving ? "Asentando…" : "Asentar depreciación"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DisposeModal({
  target,
  onClose,
  onDone,
}: {
  target: AssetRow;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [disposeDate, setDisposeDate] = useState(todayISO());
  const [disposeType, setDisposeType] = useState<string>("venta");
  const [recoveryValue, setRecoveryValue] = useState("0");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    bookValueMicro: number;
    lossMicro: number;
    gainMicro: number;
    expenseId: number | null;
  } | null>(null);

  const run = async () => {
    if (
      !window.confirm(
        `¿Dar de baja el activo ${target.code} — ${target.name}? Se asentará la depreciación hasta el mes de la baja y no podrá revertirse.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.post<{
        bookValueMicro: number;
        lossMicro: number;
        gainMicro: number;
        expenseId: number | null;
      }>(`/assets/${target.id}/baja`, {
        disposeDate,
        disposeType,
        recoveryValue: recoveryValue || "0",
        reason: reason.trim() || null,
      });
      setResult(r);
      onDone?.();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Baja de activo — ${target.code}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <div className="font-semibold text-slate-800">{target.name}</div>
          <div className="text-xs text-slate-500">
            Costo {fmtMoney(target.costMicro)} · Valor en libros hoy{" "}
            {fmtMoney(target.bookValueMicro)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label>Fecha de baja *</label>
            <input
              type="date"
              value={disposeDate}
              max={todayISO()}
              onChange={(e) => e.target.value && setDisposeDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Tipo de baja *</label>
            <select value={disposeType} onChange={(e) => setDisposeType(e.target.value)}>
              {DISPOSE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Valor recuperado</label>
          <input
            value={recoveryValue}
            inputMode="decimal"
            onChange={(e) => setRecoveryValue(e.target.value)}
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Importe obtenido (venta o chatarra). Si es menor que el valor en libros, la diferencia se
            registra como gasto «Pérdida por baja de activo».
          </span>
        </div>
        <div className="field">
          <label>Motivo</label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="EJ: equipo obsoleto, daño irreparable…"
          />
        </div>
        <ErrorAlert message={error} />
        {result && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Baja registrada. Valor en libros {fmtMoney(result.bookValueMicro)}.
            {result.lossMicro > 0 &&
              ` Pérdida ${fmtMoney(result.lossMicro)} registrada como gasto #${result.expenseId}.`}
            {result.gainMicro > 0 && ` Ganancia informativa: ${fmtMoney(result.gainMicro)}.`}
          </div>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>
            {result ? "Cerrar" : "Cancelar"}
          </button>
          {!result && (
            <button className="btn btn-danger" onClick={run} disabled={saving || !disposeDate}>
              {saving ? "Procesando…" : "Dar de baja"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
