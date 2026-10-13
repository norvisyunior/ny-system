import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, ErrorAlert, Kpi, fmtMoney, fmtQty, todayISO } from "../components/ui";

interface ReportResult {
  name: string;
  title: string;
  from: string | null;
  to: string | null;
  rows: Record<string, unknown>[];
}

interface PurchaseRow {
  fecha: string;
  numero: number;
  doc: string;
  proveedor: string;
  material: string;
  cantidad: number;
  precioUnit: number;
  total: number;
  estado: string;
}

interface ProductionRow {
  numero: number;
  fecha: string;
  receta: string;
  version: number;
  masa: string;
  esperado: number;
  real: number;
  costoTotal: number;
  costoUnitario: number;
  estado: string;
}

interface SaleRow {
  costo: number;
  estado: string;
}

interface ProductCostRow {
  producto: string;
  categoria: string;
  unidad: string;
  cantidad: number;
  ventas: number;
  costo: number;
  margen: number;
  margenPct: number;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Costos del negocio: costo de ventas PEPS, compras de materia prima y costo de producción. */
export function CostosPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayISO());
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [productions, setProductions] = useState<ProductionRow[]>([]);
  const [productCosts, setProductCosts] = useState<ProductCostRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const [rv, rc, rp, rprod] = await Promise.all([
        api.get<ReportResult>(`/reports/ventas?from=${f}&to=${t}`),
        api.get<ReportResult>(`/reports/compras?from=${f}&to=${t}`),
        api.get<ReportResult>(`/reports/produccion?from=${f}&to=${t}`),
        api.get<ReportResult>(`/reports/rentabilidad-productos?from=${f}&to=${t}`),
      ]);
      setSales(rv.rows as unknown as SaleRow[]);
      setPurchases(rc.rows as unknown as PurchaseRow[]);
      setProductions(rp.rows as unknown as ProductionRow[]);
      setProductCosts(rprod.rows as unknown as ProductCostRow[]);
    } catch (e) {
      setSales([]);
      setPurchases([]);
      setProductions([]);
      setProductCosts([]);
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(from, to);
  }, [from, to, load]);

  const salesConf = sales.filter((r) => r.estado === "confirmada");
  const cogs = salesConf.reduce((a, r) => a + r.costo, 0);
  const purchasesConf = purchases.filter((r) => r.estado === "confirmada");
  const purchasesTotal = purchasesConf.reduce((a, r) => a + r.total, 0);
  const productionsConf = productions.filter((r) => r.estado === "confirmada");
  const productionCost = productionsConf.reduce((a, r) => a + r.costoTotal, 0);

  const bySupplier = new Map<string, { total: number; count: number }>();
  for (const p of purchasesConf) {
    const cur = bySupplier.get(p.proveedor) ?? { total: 0, count: 0 };
    bySupplier.set(p.proveedor, { total: cur.total + p.total, count: cur.count + 1 });
  }
  const suppliers = [...bySupplier.entries()].sort((a, b) => b[1].total - a[1].total);
  const maxSupplier = Math.max(1, ...suppliers.map(([, v]) => v.total));

  const byRecipe = new Map<string, { costo: number; count: number }>();
  for (const p of productionsConf) {
    const cur = byRecipe.get(p.receta) ?? { costo: 0, count: 0 };
    byRecipe.set(p.receta, { costo: cur.costo + p.costoTotal, count: cur.count + 1 });
  }
  const recipes = [...byRecipe.entries()].sort((a, b) => b[1].costo - a[1].costo);

  return (
    <div>
      <PageHeader
        title="Costos"
        subtitle="Costo de ventas (PEPS), compras de materia prima y costo de producción"
        actions={
          <div className="flex gap-2">
            <a className="btn btn-secondary" href={`/api/reports/compras/csv?from=${from}&to=${to}`} download>
              CSV compras
            </a>
            <a className="btn btn-secondary" href={`/api/reports/produccion/csv?from=${from}&to=${to}`} download>
              CSV producción
            </a>
          </div>
        }
      />
      <ErrorAlert message={error} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="field">
          <label>Desde</label>
          <input type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input type="date" max={todayISO()} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn btn-secondary" onClick={() => load(from, to)}>
          {loading ? "Calculando…" : "Actualizar"}
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Costo de ventas" value={fmtMoney(cogs)} sub="COGS PEPS" big />
        <Kpi label="Compras del período" value={fmtMoney(purchasesTotal)} sub={`${purchasesConf.length} compra(s)`} muted />
        <Kpi label="Costo de producción" value={fmtMoney(productionCost)} sub={`${productionsConf.length} lote(s)`} muted />
        <Kpi
          label="Materiales distintos"
          value={String(new Set(purchasesConf.map((p) => p.material)).size)}
          sub="comprados en el período"
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-700">Compras por proveedor</h3>
          {suppliers.length === 0 && <p className="text-sm text-slate-400">Sin compras en el período.</p>}
          <ul className="space-y-2 text-sm">
            {suppliers.map(([name, v]) => (
              <li key={name}>
                <div className="flex justify-between">
                  <span>
                    {name} <span className="text-slate-400">({v.count})</span>
                  </span>
                  <span className="font-semibold">{fmtMoney(v.total)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-slate-100">
                  <div
                    className="h-1.5 rounded bg-blue-500"
                    style={{ width: `${Math.round((v.total / maxSupplier) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-700">Costo de producción por receta</h3>
          {recipes.length === 0 && <p className="text-sm text-slate-400">Sin producción en el período.</p>}
          <ul className="space-y-2 text-sm">
            {recipes.map(([name, v]) => (
              <li key={name} className="flex justify-between">
                <span>
                  {name} <span className="text-slate-400">({v.count} lote/s)</span>
                </span>
                <span className="font-semibold">{fmtMoney(v.costo)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card mb-5 overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          Costo de ventas por producto
        </div>
        <table className="table-ny">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th className="num">Vendido</th>
              <th className="num">Ingresos</th>
              <th className="num">Costo</th>
              <th className="num">Margen</th>
              <th className="num">Margen %</th>
            </tr>
          </thead>
          <tbody>
            {productCosts.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  Sin ventas confirmadas en el período.
                </td>
              </tr>
            )}
            {productCosts.map((p) => (
              <tr key={p.producto}>
                <td className="font-semibold">{p.producto}</td>
                <td>{p.categoria}</td>
                <td className="num">{fmtQty(p.cantidad, p.unidad)}</td>
                <td className="num font-mono">{fmtMoney(p.ventas)}</td>
                <td className="num font-mono text-slate-500">{fmtMoney(p.costo)}</td>
                <td className={`num font-semibold font-mono ${p.margen < 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {fmtMoney(p.margen)}
                </td>
                <td className={`num font-semibold ${p.margenPct < 0 ? "text-red-600" : "text-slate-700"}`}>
                  {p.margenPct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-5 card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          Compras de materias primas
        </div>
        <div className="max-h-[45vh] overflow-auto">
          <table className="table-ny">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Material</th>
                <th className="num">Cantidad</th>
                <th className="num">Precio unit.</th>
                <th className="num">Total</th>
                <th className="center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-400">
                    Sin compras en el período.
                  </td>
                </tr>
              )}
              {purchases.map((p, i) => (
                <tr key={`${p.numero}-${i}`} className={p.estado === "anulada" ? "opacity-60" : undefined}>
                  <td>{String(p.numero).padStart(5, "0")}</td>
                  <td>{p.fecha}</td>
                  <td>{p.proveedor}</td>
                  <td>{p.material}</td>
                  <td className="num">{fmtQty(p.cantidad)}</td>
                  <td className="num font-mono">{fmtMoney(p.precioUnit)}</td>
                  <td className="num font-semibold font-mono">{fmtMoney(p.total)}</td>
                  <td className="center">
                    {p.estado === "confirmada" ? (
                      <Badge tone="green">Confirmada</Badge>
                    ) : (
                      <Badge tone="red">Anulada</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          Producción de masas
        </div>
        <div className="max-h-[45vh] overflow-auto">
          <table className="table-ny">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Fecha</th>
                <th>Receta</th>
                <th>Masa</th>
                <th className="num">Esperado</th>
                <th className="num">Real</th>
                <th className="num">Costo total</th>
                <th className="num">Costo unit.</th>
                <th className="center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {productions.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-slate-400">
                    Sin producción en el período.
                  </td>
                </tr>
              )}
              {productions.map((p, i) => (
                <tr key={`${p.numero}-${i}`} className={p.estado === "anulada" ? "opacity-60" : undefined}>
                  <td>{String(p.numero).padStart(5, "0")}</td>
                  <td>{p.fecha}</td>
                  <td>
                    {p.receta} <span className="text-slate-400">v{p.version}</span>
                  </td>
                  <td>{p.masa}</td>
                  <td className="num">{fmtQty(p.esperado)}</td>
                  <td className="num">{fmtQty(p.real)}</td>
                  <td className="num font-semibold font-mono">{fmtMoney(p.costoTotal)}</td>
                  <td className="num font-mono">{fmtMoney(p.costoUnitario)}</td>
                  <td className="center">
                    {p.estado === "confirmada" ? (
                      <Badge tone="green">Confirmada</Badge>
                    ) : (
                      <Badge tone="red">Anulada</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
