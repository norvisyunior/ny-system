interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

interface ModulePageProps {
  title: string;
  subtitle?: string;
  hint: string;
}

/** Vista provisional de módulo aún no implementado; redirige a la pantalla equivalente. */
export function ModulePage({ title, subtitle, hint }: ModulePageProps) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="card flex flex-col items-center justify-center gap-2 p-10 text-center">
        <div className="text-3xl">🚧</div>
        <div className="text-sm font-semibold text-slate-700">Módulo no implementado</div>
        <div className="max-w-md text-sm text-slate-500">
          Esta pantalla no forma parte del alcance actual. Mientras tanto: {hint}
        </div>
      </div>
    </div>
  );
}
