import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="row-actions">{children}</div>;
}

interface RowActionProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: "default" | "adjust" | "danger";
}

export function RowAction({ icon: Icon, label, onClick, tone = "default" }: RowActionProps) {
  return (
    <button
      type="button"
      className={
        tone === "adjust" ? "row-action row-action-adjust" : tone === "danger" ? "row-action row-action-danger" : "row-action"
      }
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}
