import { api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { usePaged } from "../hooks/usePaged";
import { Badge, Callout, ErrorAlert, SearchInput, fmtDocNumber, fmtMoney, fmtQty } from "../components/ui";

interface TermRow {
  id: number;
  number: number;
  transformDate: string;
  massName: string;
  massUnit: string;
  massQtyMicro: number;
  realPackagesMicro: number;
  expectedPackagesMicro: number;
  deviationMicro: number;
  productName: string | null;
  recipeName: string | null;
  recipeVersion: number | null;
  totalCostMicro: number;
  status: string;
}

interface ElabRow {
  id: number;
  number: number;
  productionDate: string;
  recipeName: string;
  version: number;
  massName: string;
  expectedYieldMicro: number;
  realYieldMicro: number;
  yieldUnitId: string;
  totalCostMicro: number;
  status: string;
  deviationMicro: number;
  yieldPercent: number;
}

const pct = (real: number, expected: number): number | null =>
  expected > 0 ? Math.round((real / expected) * 10000) / 100 : null;

export function YieldsPage() {
  const terms = usePaged<TermRow>(({ page, pageSize, search }) =>
    api.get(
      `/transformations?page=${page}&pageSize=${pageSize}` +
        (search ? `&q=${encodeURIComponent(search)}` : ""),
    ),
  );
  const elabs = usePaged<ElabRow>(({ page, pageSize, search }) =>
    api.get(
      `/productions/yields?page=${page}&pageSize=${pageSize}` +
        (search ? `&q=${encodeURIComponent(search)}` : ""),
    ),
  );
  const setSearchBoth = (v: string) => {
    terms.setSearch(v);
    elabs.setSearch(v);
  };

  // Rendimiento medio de la página visible: solo filas con receta (esperado > 0).
  const termOk = terms.rows.filter((r) => r.status === "confirmada" && r.expectedPackagesMicro > 0);
  const avgTerm =
    termOk.length > 0
      ? Math.round(
          (termOk.reduce((acc, r) => acc + (pct(r.realPackagesMicro, r.expectedPackagesMicro) ?? 0), 0) /
            termOk.length) *
            100,
        ) / 100
      : null;
  const elabOk = elabs.rows.filter((r) => r.status === "confirmada");
  const avgElab =
    elabOk.length > 0
      ? Math.round((elabOk.reduce((acc, r) => acc + r.yieldPercent, 0) / elabOk.length) * 100) / 100
      : null;

  return (
    <div>
      <PageHeader
        title="Rendimientos"
        subtitle="Desviaciones del proceso: terminación (paquetes reales vs receta) y elaboración (masas reales vs plan)"
      />
      <Callout tone="info" title="Para qué sirve esta pantalla">
        Compara lo esperado contra lo real: en la terminación, los paquetes obtenidos frente a
        los que decía la receta; en la elaboración, las masas hechas frente al plan. Una
        desviación grande suele significar pérdida de materia prima o un error de captura.
      </Callout>
      <ErrorAlert message={terms.error ?? elabs.error} />

      <div className="mb-4 flex items-center justify-between">
        <SearchInput value={terms.search} onChange={setSearchBoth} placeholder="Buscar por receta, producto, masa o número…" />
        <span className="text-sm text-slate-500">
          {terms.total} terminación(es) · {elabs.total} elaboración(es)
          {avgTerm != null && (
            <>
              {" "}· Rendimiento medio de terminación (página): <strong>{avgTerm}%</strong>
            </>
          )}
        </span>
      </div>

      <div className="card mb-5 overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-bold text-slate-700">
            Terminación — paquetes esperados vs reales
          </h3>
          <p className="text-xs text-slate-500">
            Esperado = masas consumidas × rendimiento de la receta. Detecta merma o
            sobre-producto al empaquetar.
          </p>
        </div>
        <table className="table-ny">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Receta</th>
              <th>Producto</th>
              <th className="num">Esperado</th>
              <th className="num">Real</th>
              <th className="num">Desviación</th>
              <th className="num">%</th>
              <th className="center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {terms.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-slate-400">
                  {terms.loading ? "Cargando…" : "Sin terminaciones registradas."}
                </td>
              </tr>
            )}
            {terms.rows.map((r) => {
              const p = pct(r.realPackagesMicro, r.expectedPackagesMicro);
              return (
                <tr key={r.id}>
                  <td className="font-mono font-semibold">{fmtDocNumber(r.number)}</td>
                  <td>{r.transformDate}</td>
                  <td>
                    {r.recipeName ? (
                      <>
                        {r.recipeName} <span className="text-slate-400">v{r.recipeVersion}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td>{r.productName ?? "—"}</td>
                  <td className="num text-slate-500">
                    {r.expectedPackagesMicro > 0 ? fmtQty(r.expectedPackagesMicro, null, 0) : "—"}
                  </td>
                  <td className="num font-semibold">{fmtQty(r.realPackagesMicro, null, 0)}</td>
                  <td
                    className={`num font-semibold ${
                      r.deviationMicro < 0
                        ? "text-red-600"
                        : r.deviationMicro > 0
                          ? "text-emerald-700"
                          : ""
                    }`}
                  >
                    {r.expectedPackagesMicro <= 0 ? (
                      "—"
                    ) : (
                      <>
                        {r.deviationMicro > 0 ? "+" : ""}
                        {fmtQty(r.deviationMicro, null, 0)}
                      </>
                    )}
                  </td>
                  <td className="num">
                    {p == null ? (
                      "—"
                    ) : (
                      <Badge tone={p >= 100 ? "green" : p >= 90 ? "amber" : "red"}>{p}%</Badge>
                    )}
                  </td>
                  <td className="center">
                    {r.status === "confirmada" ? (
                      <Badge tone="green">Confirmada</Badge>
                    ) : (
                      <Badge tone="red">Anulada</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 pb-3">
          <Pager
            page={terms.page}
            pages={terms.pages}
            total={terms.total}
            pageSize={terms.pageSize}
            rowsCount={terms.rows.length}
            onPage={terms.setPage}
            label="terminaciones"
          />
        </div>
      </div>

      <div className="card mb-5 overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-bold text-slate-700">
            Elaboración — masas esperadas vs reales
          </h3>
          <p className="text-xs text-slate-500">
            Con plan, lo esperado es lo planificado; sin plan, lo esperado es igual a lo
            elaborado (100%).
          </p>
        </div>
        <table className="table-ny">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Receta</th>
              <th>Masa</th>
              <th className="num">Esperado</th>
              <th className="num">Real</th>
              <th className="num">Desviación</th>
              <th className="num">%</th>
              <th className="center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {elabs.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-slate-400">
                  {elabs.loading ? "Cargando…" : "Sin elaboraciones registradas."}
                </td>
              </tr>
            )}
            {elabs.rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono font-semibold">{fmtDocNumber(r.number)}</td>
                <td>{r.productionDate}</td>
                <td>
                  {r.recipeName} <span className="text-slate-400">v{r.version}</span>
                </td>
                <td>{r.massName}</td>
                <td className="num text-slate-500">{fmtQty(r.expectedYieldMicro, r.yieldUnitId)}</td>
                <td className="num font-semibold">{fmtQty(r.realYieldMicro, r.yieldUnitId)}</td>
                <td
                  className={`num font-semibold ${
                    r.deviationMicro < 0
                      ? "text-red-600"
                      : r.deviationMicro > 0
                        ? "text-emerald-700"
                        : ""
                  }`}
                >
                  {r.deviationMicro > 0 ? "+" : ""}
                  {fmtQty(r.deviationMicro, r.yieldUnitId)}
                </td>
                <td className="num">
                  <Badge tone={r.yieldPercent >= 100 ? "green" : r.yieldPercent >= 90 ? "amber" : "red"}>
                    {r.yieldPercent}%
                  </Badge>
                </td>
                <td className="center">
                  {r.status === "confirmada" ? (
                    <Badge tone="green">Confirmada</Badge>
                  ) : (
                    <Badge tone="red">Anulada</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 pb-3">
          <Pager
            page={elabs.page}
            pages={elabs.pages}
            total={elabs.total}
            pageSize={elabs.pageSize}
            rowsCount={elabs.rows.length}
            onPage={elabs.setPage}
            label="elaboraciones"
          />
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        La <strong>desviación de terminación</strong> (Real − Esperado en paquetes) refleja
        pérdidas o sobrantes al empaquetar; la de <strong>elaboración</strong> compara las masas
        hechas contra el plan. Costo total de las terminaciones de la página:{" "}
        <strong>{fmtMoney(terms.rows.reduce((acc, r) => acc + r.totalCostMicro, 0))}</strong>
        {avgElab != null && (
          <>
            {" "}· Rendimiento medio de elaboración (página): <strong>{avgElab}%</strong>
          </>
        )}
      </div>
    </div>
  );
}
