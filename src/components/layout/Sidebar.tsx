import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NAV } from "../../app/nav";

const COLLAPSED_KEY = "ny.sidebar.collapsed";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* almacenamiento no disponible */
    }
  }, [collapsed]);

  const width = collapsed ? "w-[76px]" : "w-60";

  return (
    <aside
      className={`flex shrink-0 flex-col text-slate-300 transition-[width] duration-200 ${width}`}
      style={{ background: "var(--ny-sidebar)" }}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-400/40 text-sm font-bold tracking-tight text-emerald-300"
            style={{ background: "var(--ny-sidebar-hover)" }}
            aria-hidden
          >
            NY
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold tracking-wide text-white">NY SYSTEM</div>
              <div className="truncate text-[11px] text-emerald-200/60">Gestión integral</div>
            </div>
          )}
        </div>
        <button
          type="button"
          title={collapsed ? "Expandir menú" : "Contraer menú"}
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          className="rounded-md p-1 text-emerald-200/60 transition-colors hover:bg-white/10 hover:text-white"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((group) => (
          <div key={group.label || "main"} className="mt-2">
            {group.label && !collapsed && (
              <div className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-wider text-emerald-200/50">
                {group.label}
              </div>
            )}
            {group.label && collapsed && <div className="mx-3 my-2 border-t border-white/10" />}
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  [
                    "group flex items-center rounded-lg px-3 py-2 text-sm transition-colors",
                    collapsed ? "justify-center gap-0" : "gap-3",
                    isActive
                      ? "bg-emerald-600/90 font-semibold text-white shadow-sm"
                      : "hover:bg-white/5 hover:text-white",
                  ].join(" ")
                }
              >
                <item.icon
                  size={17}
                  className={
                    collapsed
                      ? "shrink-0"
                      : "shrink-0 text-emerald-200/70 transition-colors group-hover:text-emerald-200"
                  }
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div
        className={`border-t border-white/10 px-4 py-3 text-[11px] leading-tight ${
          collapsed ? "px-2 text-center" : ""
        }`}
        style={{ color: "rgba(167, 243, 208, 0.45)" }}
      >
        {collapsed ? (
          <span className="font-semibold">v0.1.0</span>
        ) : (
          <>
            NY SYSTEM v0.1.0
            <br />© Norvis Yunior
          </>
        )}
      </div>
    </aside>
  );
}
