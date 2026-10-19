import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NAV } from "../../app/nav";
import { BrandLogo } from "../brand/BrandLogo";

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
        {collapsed ? (
          <div className="mx-auto">
            <BrandLogo variant="symbol" size="md" theme="dark" />
          </div>
        ) : (
          <BrandLogo variant="horizontal" size="sm" theme="dark" showSubtitle />
        )}
        <button
          type="button"
          title={collapsed ? "Expandir menú" : "Contraer menú"}
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          className="rounded-md p-1 text-[#CBD5D7]/60 transition-colors hover:bg-white/10 hover:text-white"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((group) => (
          <div key={group.label || "main"} className="mt-2">
            {group.label && !collapsed && (
              <div
                className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "rgb(216 181 109 / 0.55)" }}
              >
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
                      ? "bg-[var(--ny-sidebar-active)] font-semibold text-white shadow-sm"
                      : "hover:bg-white/5 hover:text-white",
                  ].join(" ")
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      size={17}
                      className={
                        collapsed
                          ? "shrink-0"
                          : isActive
                            ? "shrink-0 text-[#F2D89A]"
                            : "shrink-0 text-[#CBD5D7]/70 transition-colors group-hover:text-[#F2D89A]"
                      }
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div
        className={`border-t border-white/10 px-4 py-3 text-[11px] leading-tight ${
          collapsed ? "px-2 text-center" : ""
        }`}
        style={{ color: "rgb(203 213 215 / 0.45)" }}
      >
        {collapsed ? (
          <span className="font-semibold">v0.1.0</span>
        ) : (
          <>
            NYORA v0.1.0
            <br />© Norvis Yunior
          </>
        )}
      </div>
    </aside>
  );
}
