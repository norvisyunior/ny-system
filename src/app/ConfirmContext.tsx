import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle } from "lucide-react";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<{
  confirm: (options: ConfirmOptions) => Promise<boolean>;
} | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  );

  const settle = useCallback((value: boolean) => {
    if (pending) {
      pending.resolve(value);
      setPending(null);
    }
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKey);
    if (danger) cancelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, settle]);

  const open = pending !== null;
  const danger = pending?.options.danger ?? false;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settle(false);
          }}
        >
          <div
            className="card w-full max-w-md shadow-xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <div className="px-5 py-4">
              <h2
                id="confirm-title"
                className="text-sm font-bold text-slate-800"
              >
                {pending.options.title}
              </h2>
              {pending.options.description && (
                <div className="mt-2 text-sm text-slate-500">
                  {pending.options.description}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
              {danger && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                  <AlertTriangle size={14} aria-hidden />
                  Esta acción quedará auditada
                </span>
              )}
              <div className="flex items-center gap-2">
                <button
                  ref={cancelRef}
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                  onClick={() => settle(false)}
                >
                  {pending.options.cancelLabel ?? "Cancelar"}
                </button>
                <button
                  type="button"
                  autoFocus={!danger}
                  className={`rounded-md px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors ${
                    danger
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-emerald-700 hover:bg-emerald-800"
                  }`}
                  onClick={() => settle(true)}
                >
                  {pending.options.confirmLabel ?? "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de ConfirmProvider");
  return ctx.confirm;
}
