import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorAlert, Modal, todayISO } from "./ui";
import { microToDecimalTrim } from "@shared/money";

/**
 * Ajuste de stock (a cantidad exacta) o registro de merma para cualquier ítem
 * del inventario (materia prima, masa, producto terminado u otro insumo).
 * Escribe por lotes PEPS en el server: POST /inventory/adjustments.
 */
export interface StockAdjustTarget {
  itemType: "raw" | "mass" | "product" | "supply";
  itemId: number;
  name: string;
  unitId: string;
  stockMicro: number;
}

type Mode = "ajuste" | "merma";

export function StockAdjustModal({
  target,
  onClose,
  onDone,
}: {
  target: StockAdjustTarget;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("merma");
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDate(todayISO());
    setMode("merma");
    setQty("");
    setReason("");
    setError(null);
  }, [target.itemId, target.itemType]);

  const current = microToDecimalTrim(target.stockMicro, 3);
  const nombreTipo =
    target.itemType === "raw"
      ? "Materia prima"
      : target.itemType === "mass"
        ? "Masa"
        : target.itemType === "supply"
          ? "Otro insumo"
          : "Producto terminado";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body =
        mode === "merma"
          ? {
              kind: "merma",
              itemType: target.itemType,
              itemId: target.itemId,
              businessDate: date === todayISO() ? undefined : date,
              qty: qty.trim(),
              reason: reason.trim(),
            }
          : {
              kind: "ajuste",
              itemType: target.itemType,
              itemId: target.itemId,
              businessDate: date === todayISO() ? undefined : date,
              newTotal: qty.trim(),
              reason: reason.trim(),
            };
      await api.post("/inventory/adjustments", body);
      onDone?.();
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const ok =
    reason.trim().length >= 3 &&
    qty.trim() !== "" &&
    (mode === "ajuste" || Number(qty.trim().replace(",", ".")) > 0);

  return (
    <Modal title={`Ajuste de inventario — ${target.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">{nombreTipo}</span>
          <span className="ml-2 font-semibold text-slate-800">
            Stock actual: {current} {target.unitId}
          </span>
        </div>

        <div className="field">
          <label>Operación *</label>
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {(["merma", "ajuste"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setQty("");
                }}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === m ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {m === "merma" ? "Registrar merma" : "Ajustar a cantidad"}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-[11px] text-slate-500">
            {mode === "merma"
              ? "Descuenta del inventario PEPS la cantidad perdida y crea un gasto automático (categoría «Merma») por su valor; aparecerá en Gastos y afectará el cierre del día."
              : "Fija el stock total exacto: si sube, crea un lote con costo 0; si baja, consume lotes y la pérdida queda trazada (no genera gasto)."}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label>Fecha *</label>
            <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>{mode === "merma" ? "Cantidad perdida *" : `Stock final total * (${target.unitId})`}</label>
            <input
              value={qty}
              inputMode="decimal"
              placeholder={mode === "merma" ? "0" : current}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="field">
          <label>Motivo *</label>
          <textarea
            rows={2}
            value={reason}
            placeholder={
              mode === "merma"
                ? "Ej: vencimiento, ruptura de empaque, prueba cataada…"
                : "Ej: recuento físico, corrección por error de registro…"
            }
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <ErrorAlert message={error} />

        <div className="mt-2 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !ok}>
            {saving ? "Guardando..." : mode === "merma" ? "Registrar merma" : "Ajustar stock"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
