import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, ErrorAlert, FlowGuide, Modal, fmtMoney, todayISO } from "../components/ui";
import { microToDecimalTrim } from "@shared/money";

type ItemType = "raw" | "mass" | "product";

interface PreviewItem {
  itemType: ItemType;
  itemId: number;
  name: string;
  unitId: string;
  expectedMicro: number;
  avgCostMicro: number;
}

interface Preview {
  businessDate: string;
  salesTotalMicro: number;
  cogsMicro: number;
  grossProfitMicro: number;
  expensesMicro: number;
  netResultMicro: number;
  pendingSalesCount: number;
  items: PreviewItem[];
  existingCounts: number;
  closingStatus: string | null;
}

interface ClosingListRow {
  businessDate: string;
  salesTotalMicro: number;
  cogsMicro: number;
  expensesMicro: number;
  grossProfitMicro: number;
  netResultMicro: number;
  status: string;
  closedAt: string | null;
}

interface CountLine {
  id: number;
  itemType: ItemType;
  itemId: number;
  expectedMicro: number;
  countedMicro: number;
  diffMicro: number;
  unitCostMicro: number;
  diffValueMicro: number;
  reason: string | null;
}

interface ClosingDetail extends ClosingListRow {
  reopenedAt: string | null;
  reopenReason: string | null;
  notes: string | null;
  counts: CountLine[];
}

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  raw: "Materia prima",
  mass: "Masa",
  product: "Producto",
};

const key = (it: PreviewItem) => `${it.itemType}:${it.itemId}`;

function parseMicro(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  return Math.round(Number(t) * 1_000_000);
}

export function ClosingsPage() {
  const [date, setDate] = useState(todayISO());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [list, setList] = useState<ClosingListRow[]>([]);
  const [detail, setDetail] = useState<ClosingDetail | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const loadList = useCallback(() => {
    api.get<ClosingListRow[]>("/closings").then(setList).catch(() => undefined);
  }, []);

  const loadDate = useCallback(
    async (d: string) => {
      setError(null);
      setDetail(null);
      setNotes("");
      setReasons({});
      try {
        const pv = await api.get<Preview>(`/closings/preview?date=${d}`);
        setPreview(pv);
        const pre: Record<string, string> = {};
        for (const it of pv.items) pre[key(it)] = microToDecimalTrim(it.expectedMicro, 6);
        setCounted(pre);
        if (pv.closingStatus === "cerrado") {
          setDetail(await api.get<ClosingDetail>(`/closings/${d}`));
        }
      } catch (e) {
        setPreview(null);
        setError((e as ApiError).message);
      }
    },
    [],
  );

  useEffect(() => {
    loadDate(date);
    loadList();
  }, [date, loadDate, loadList]);

  const diffOf = (it: PreviewItem): number | null => {
    const micro = parseMicro(counted[key(it)] ?? "");
    if (micro === null) return null;
    return micro - it.expectedMicro;
  };

  const hasInvalid = preview
    ? preview.items.some((it) => parseMicro(counted[key(it)] ?? "") === null)
    : false;
  const missingReasons = preview
    ? preview.items.filter((it) => {
        const d = diffOf(it);
        return d !== null && d !== 0;
      })
    : [];

  const close = async () => {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const counts = preview.items.map((it) => ({
        itemType: it.itemType,
        itemId: it.itemId,
        counted: counted[key(it)] ?? "",
        reason: reasons[key(it)] ?? "",
      }));
      await api.post("/closings", {
        businessDate: date,
        counts,
        notes: notes || null,
      });
      await loadDate(date);
      loadList();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const reopen = async () => {
    try {
      await api.post(`/closings/${date}/reopen`, { reason: reopenReason });
      setReopenOpen(false);
      setReopenReason("");
      await loadDate(date);
      loadList();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const closed = preview?.closingStatus === "cerrado";

  return (
    <div>
      <PageHeader
        title="Cierre diario"
        subtitle="Conteo físico, resultados del día y reapertura auditada"
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              max={todayISO()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        }
      />
      <FlowGuide current="cierre" />
      <ErrorAlert message={error} />

      {preview && (
        <>
          <div className="mb-5 grid grid-cols-5 gap-3">
            <StatCard label="Ventas" value={preview.salesTotalMicro} sub={`${preview.pendingSalesCount} venta(s)`} />
            <StatCard label="Costo de ventas" value={preview.cogsMicro} muted />
            <StatCard
              label="Utilidad bruta"
              value={preview.grossProfitMicro}
              tone={preview.grossProfitMicro < 0 ? "red" : "green"}
            />
            <StatCard label="Gastos" value={preview.expensesMicro} muted />
            <StatCard
              label="Resultado neto"
              value={preview.netResultMicro}
              tone={preview.netResultMicro < 0 ? "red" : "green"}
              big
            />
          </div>

          {closed && detail ? (
            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-bold text-slate-700">Día cerrado</h3>
                  <Badge tone="green">Cerrado {detail.closedAt?.slice(0, 16).replace("T", " ")}</Badge>
                  {detail.reopenedAt && <Badge tone="amber">Reabierto</Badge>}
                </div>
                <button className="btn btn-secondary" onClick={() => setReopenOpen(true)}>
                  Reabrir día
                </button>
              </div>
              {detail.notes && <p className="mb-3 text-sm text-slate-600">{detail.notes}</p>}
              <table className="table-ny">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Ítem</th>
                    <th className="num">Esperado</th>
                    <th className="num">Contado</th>
                    <th className="num">Diferencia</th>
                    <th className="num">Valor</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.counts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-400">
                        Sin diferencias registradas en este cierre.
                      </td>
                    </tr>
                  )}
                  {detail.counts.map((c) => (
                    <tr key={c.id}>
                      <td>{ITEM_TYPE_LABELS[c.itemType]}</td>
                      <td className="font-mono">#{c.itemId}</td>
                      <td className="num">{microToDecimalTrim(c.expectedMicro, 6)}</td>
                      <td className="num">{microToDecimalTrim(c.countedMicro, 6)}</td>
                      <td className={`num font-semibold ${c.diffMicro !== 0 ? "text-red-600" : ""}`}>
                        {c.diffMicro > 0 ? "+" : ""}
                        {microToDecimalTrim(c.diffMicro, 6)}
                      </td>
                      <td className={`num ${c.diffValueMicro !== 0 ? "text-red-600" : ""}`}>
                        {fmtMoney(c.diffValueMicro)}
                      </td>
                      <td className="text-sm text-slate-600">{c.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">
                  Hoja de conteo ({preview.items.length} ítems)
                </h3>
                <span className="text-xs text-slate-500">
                  Diferencias ≠ 0 requieren motivo. El cierre congela el día.
                </span>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="table-ny">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Ítem</th>
                      <th className="num">Esperado</th>
                      <th className="num">Contado</th>
                      <th className="num">Diferencia</th>
                      <th>Motivo de la diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((it) => {
                      const d = diffOf(it);
                      const invalid = d === null;
                      const hasDiff = d !== null && d !== 0;
                      const k = key(it);
                      return (
                        <tr key={k} className={hasDiff ? "bg-amber-50" : undefined}>
                          <td className="text-xs">{ITEM_TYPE_LABELS[it.itemType]}</td>
                          <td>{it.name}</td>
                          <td className="num text-slate-500">{microToDecimalTrim(it.expectedMicro, 6)}</td>
                          <td className="num">
                            <input
                              className={`w-28 rounded border px-2 py-1 text-right text-sm ${
                                invalid
                                  ? "border-red-400"
                                  : hasDiff
                                    ? "border-amber-400"
                                    : "border-slate-300"
                              }`}
                              value={counted[k] ?? ""}
                              inputMode="decimal"
                              onChange={(e) => setCounted((c) => ({ ...c, [k]: e.target.value }))}
                            />
                          </td>
                          <td className={`num font-semibold ${hasDiff ? "text-red-600" : "text-slate-400"}`}>
                            {d === null ? "—" : d === 0 ? "0" : `${d > 0 ? "+" : ""}${microToDecimalTrim(d, 6)}`}
                          </td>
                          <td>
                            {hasDiff && (
                              <input
                                className="w-full rounded border border-amber-400 px-2 py-1 text-sm"
                                placeholder="Motivo *"
                                value={reasons[k] ?? ""}
                                onChange={(e) => setReasons((r) => ({ ...r, [k]: e.target.value }))}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-end justify-between gap-3">
                <div className="field flex-1">
                  <label>Notas del cierre</label>
                  <input
                    value={notes}
                    placeholder="Observaciones del día…"
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-secondary" onClick={() => loadDate(date)}>
                    Recalcular
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={
                      saving ||
                      hasInvalid ||
                      missingReasons.some((it) => (reasons[key(it)] ?? "").trim().length < 3)
                    }
                    onClick={close}
                  >
                    {saving ? "Cerrando..." : `Cerrar día ${date}`}
                  </button>
                </div>
              </div>
              {missingReasons.length > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  {missingReasons.length} diferencia(s) pendiente(s) de motivo (mínimo 3 caracteres).
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-bold text-slate-700">Cierres anteriores</h3>
        <div className="card overflow-hidden">
          <table className="table-ny">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="num">Ventas</th>
                <th className="num">Costo de ventas</th>
                <th className="num">Gastos</th>
                <th className="num">Neto</th>
                <th className="center">Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">
                    Aún no hay días cerrados.
                  </td>
                </tr>
              )}
              {list.map((r) => (
                <tr key={r.businessDate}>
                  <td className="font-semibold">{r.businessDate}</td>
                  <td className="num">{fmtMoney(r.salesTotalMicro)}</td>
                  <td className="num text-slate-500">{fmtMoney(r.cogsMicro)}</td>
                  <td className="num text-slate-500">{fmtMoney(r.expensesMicro)}</td>
                  <td className={`num font-semibold ${r.netResultMicro < 0 ? "text-red-600" : ""}`}>
                    {fmtMoney(r.netResultMicro)}
                  </td>
                  <td className="center">
                    {r.status === "cerrado" ? <Badge tone="green">Cerrado</Badge> : <Badge tone="amber">Reabierto</Badge>}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-secondary" onClick={() => setDate(r.businessDate)}>
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {reopenOpen && (
        <Modal title={`Reabrir día ${date}`} onClose={() => setReopenOpen(false)}>
          <p className="mb-3 text-sm text-slate-600">
            Reabrir permite operar de nuevo sobre esta fecha. Queda auditado con su motivo y es el
            único cierre que puede reabrirse.
          </p>
          <input
            className="mb-3 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Motivo de la reapertura *"
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setReopenOpen(false)}>
              Cancelar
            </button>
            <button className="btn btn-danger" disabled={reopenReason.trim().length < 3} onClick={reopen}>
              Reabrir
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  muted,
  tone,
  big,
}: {
  label: string;
  value: number;
  sub?: string;
  muted?: boolean;
  tone?: "green" | "red";
  big?: boolean;
}) {
  const color =
    tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-700" : muted ? "text-slate-500" : "text-slate-900";
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`${big ? "text-2xl" : "text-xl"} font-bold ${color}`}>{fmtMoney(value)}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
