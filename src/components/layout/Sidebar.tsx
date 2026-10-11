import { NavLink } from "react-router-dom";
import { NAV } from "../../app/nav";

export function Sidebar() {
  return (
    <aside
      className="flex w-60 shrink-0 flex-col text-slate-300"
      style={{ background: "var(--ny-sidebar)" }}
    >
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
          NY
        </div>
        <div>
          <div className="text-sm font-bold tracking-wide text-white">NY SYSTEM</div>
          <div className="text-[11px] text-slate-400">Gestión integral</div>
        </div>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto pb-6">
        {NAV.map((group) => (
          <div key={group.label || "main"} className="mt-3">
            {group.label && (
              <div className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {group.label}
              </div>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  [
                    "mx-2 flex items-center rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-blue-600 font-semibold text-white"
                      : "hover:bg-[var(--ny-sidebar-hover)] hover:text-white",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800 px-5 py-3 text-[11px] text-slate-500">
        Modo offline · v0.1.0
      </div>
    </aside>
  );
}
