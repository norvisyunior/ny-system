import {
  auditLogs,
  dailyClosings,
  expenses,
  finishedProducts,
  masses,
  productionBatches,
  purchaseItems,
  purchases,
  rawMaterials,
  recipes,
  recipeVersions,
  saleItems,
  sales,
  suppliers,
  stockLots,
  transformationOutputs,
  transformations,
} from "../../db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { todayISO } from "../domain/dates";
import { microToDecimal, microToDecimalTrim } from "../../shared/money";
import type { DBOrTx } from "../domain/types";

/** Cantidad micro → texto sin ceros sobrantes (igual que fmtQty de la UI). */
function qtyText(micro: number): string {
  return microToDecimalTrim(micro, 3);
}

export type ReportName =
  | "inventario"
  | "productos"
  | "compras"
  | "produccion"
  | "ventas"
  | "rentabilidad"
  | "rentabilidad-productos"
  | "auditoria";

export const REPORT_NAMES: ReportName[] = [
  "inventario",
  "productos",
  "compras",
  "produccion",
  "ventas",
  "rentabilidad",
  "rentabilidad-productos",
  "auditoria",
];

export interface ReportColumn {
  key: string;
  label: string;
  fmt?: "money" | "qty" | "none";
  align?: "num";
}

export interface ReportResult {
  name: ReportName;
  title: string;
  from: string | null;
  to: string | null;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  generatedAt: string;
}

const num = (v: unknown): number => Math.trunc(Number(v ?? 0));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportRange {
  from?: string;
  to?: string;
}

function defaultRange(opts: ReportRange): { from: string; to: string } {
  const to = opts.to && DATE_RE.test(opts.to) ? opts.to : todayISO();
  let from = opts.from && DATE_RE.test(opts.from) ? opts.from : "";
  if (!from) {
    const d = new Date(`${to}T12:00:00`);
    d.setDate(d.getDate() - 29);
    from = d.toISOString().slice(0, 10);
  }
  return { from, to };
}

function inventarioReport(db: DBOrTx): ReportResult {
  const rows: Record<string, unknown>[] = [];
  const lots = db
    .select({
      itemType: stockLots.itemType,
      itemId: stockLots.itemId,
      qty: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro}), 0)`,
      value: sql<number>`COALESCE(SUM(${stockLots.qtyRemainingMicro} * ${stockLots.unitCostMicro}), 0)`,
      lastCost: sql<number>`COALESCE(MAX(${stockLots.unitCostMicro}), 0)`,
    })
    .from(stockLots)
    .where(isNull(stockLots.cancelledAt))
    .groupBy(stockLots.itemType, stockLots.itemId)
    .all();
  const byKey = new Map(lots.map((l) => [`${l.itemType}:${l.itemId}`, l]));

  const push = (
    itemType: string,
    item: { id: number; name: string; unitId: string; minStockMicro: number },
  ) => {
    const lot = byKey.get(`${itemType}:${item.id}`);
    const stock = num(lot?.qty);
    const rawValue = num(lot?.value);
    const value = Math.trunc(rawValue / 1_000_000);
    const min = item.minStockMicro;
    const estado = stock <= 0 && min > 0 ? "Agotado" : min > 0 && stock <= min ? "Bajo" : "OK";
    rows.push({
      tipo: itemType === "raw" ? "Materia prima" : itemType === "mass" ? "Masa" : "Producto",
      nombre: item.name,
      unidad: item.unitId,
      stock: stock,
      minimo: min,
      valor: value,
      costoPromedio: stock > 0 ? Math.trunc(rawValue / stock) : num(lot?.lastCost),
      estado,
    });
  };

  for (const it of db.select().from(rawMaterials).where(eq(rawMaterials.active, true)).all()) {
    push("raw", it);
  }
  for (const it of db.select().from(masses).where(eq(masses.active, true)).all()) {
    push("mass", it);
  }
  for (const it of db.select().from(finishedProducts).where(eq(finishedProducts.active, true)).all()) {
    push("product", {
      id: it.id,
      name: it.name,
      unitId: it.saleUnitId,
      minStockMicro: it.minStockMicro,
    });
  }

  return {
    name: "inventario",
    title: "Inventario valorizado (PEPS)",
    from: null,
    to: null,
    columns: [
      { key: "tipo", label: "Tipo" },
      { key: "nombre", label: "Nombre" },
      { key: "unidad", label: "Unidad" },
      { key: "stock", label: "Stock", fmt: "qty", align: "num" },
      { key: "minimo", label: "Mínimo", fmt: "qty", align: "num" },
      { key: "valor", label: "Valor ($)", fmt: "money", align: "num" },
      { key: "costoPromedio", label: "Costo unit. ($)", fmt: "money", align: "num" },
      { key: "estado", label: "Estado" },
    ],
    rows,
    generatedAt: new Date().toISOString(),
  };
}

function productosReport(db: DBOrTx, range: { from: string; to: string }): ReportResult {
  const rows = db
    .select({
      fecha: transformations.transformDate,
      numero: transformations.number,
      receta: recipes.name,
      producto: finishedProducts.name,
      categoria: finishedProducts.category,
      unidad: finishedProducts.saleUnitId,
      cantidad: transformationOutputs.qtyMicro,
      costo: transformationOutputs.costAllocatedMicro,
      costoUnit: transformationOutputs.unitCostMicro,
      estado: transformations.status,
    })
    .from(transformationOutputs)
    .innerJoin(transformations, eq(transformationOutputs.transformationId, transformations.id))
    .innerJoin(finishedProducts, eq(transformationOutputs.productId, finishedProducts.id))
    .leftJoin(recipeVersions, eq(transformations.recipeVersionId, recipeVersions.id))
    .leftJoin(recipes, eq(recipeVersions.recipeId, recipes.id))
    .where(
      and(
        sql`${transformations.transformDate} >= ${range.from}`,
        sql`${transformations.transformDate} <= ${range.to}`,
      ),
    )
    .orderBy(asc(transformations.transformDate), asc(transformations.number))
    .all();

  return {
    name: "productos",
    title: "Productos terminados (salidas del período)",
    from: range.from,
    to: range.to,
    columns: [
      { key: "fecha", label: "Fecha" },
      { key: "numero", label: "Nº" },
      { key: "receta", label: "Receta" },
      { key: "producto", label: "Producto" },
      { key: "categoria", label: "Categoría" },
      { key: "unidad", label: "Unidad de venta" },
      { key: "cantidad", label: "Cantidad", fmt: "qty", align: "num" },
      { key: "costo", label: "Costo ($)", fmt: "money", align: "num" },
      { key: "costoUnit", label: "Costo unit. ($)", fmt: "money", align: "num" },
      { key: "estado", label: "Estado" },
    ],
    rows: rows.map((r) => ({
      fecha: r.fecha,
      numero: num(r.numero),
      receta: r.receta ?? "—",
      producto: r.producto,
      categoria: r.categoria ?? "—",
      unidad: r.unidad,
      cantidad: num(r.cantidad),
      costo: num(r.costo),
      costoUnit: num(r.costoUnit),
      estado: r.estado,
    })),
    generatedAt: new Date().toISOString(),
  };
}

function comprasReport(db: DBOrTx, range: { from: string; to: string }): ReportResult {
  const rows = db
    .select({
      fecha: purchases.purchaseDate,
      numero: purchases.number,
      doc: purchases.docNumber,
      proveedor: suppliers.name,
      material: rawMaterials.name,
      cantidad: purchaseItems.qtyBaseMicro,
      precioUnit: purchaseItems.unitPriceMicro,
      total: purchaseItems.lineTotalMicro,
      estado: purchases.status,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .innerJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .innerJoin(rawMaterials, eq(purchaseItems.rawMaterialId, rawMaterials.id))
    .where(and(sql`${purchases.purchaseDate} >= ${range.from}`, sql`${purchases.purchaseDate} <= ${range.to}`))
    .orderBy(asc(purchases.purchaseDate), asc(purchases.number))
    .all();

  return {
    name: "compras",
    title: "Compras de materias primas",
    from: range.from,
    to: range.to,
    columns: [
      { key: "fecha", label: "Fecha" },
      { key: "numero", label: "Nº" },
      { key: "doc", label: "Doc." },
      { key: "proveedor", label: "Proveedor" },
      { key: "material", label: "Materia prima" },
      { key: "cantidad", label: "Cantidad", fmt: "qty", align: "num" },
      { key: "precioUnit", label: "Precio unit. ($)", fmt: "money", align: "num" },
      { key: "total", label: "Total ($)", fmt: "money", align: "num" },
      { key: "estado", label: "Estado" },
    ],
    rows: rows.map((r) => ({ ...r, numero: num(r.numero), cantidad: num(r.cantidad), precioUnit: num(r.precioUnit), total: num(r.total) })),
    generatedAt: new Date().toISOString(),
  };
}

function produccionReport(db: DBOrTx, range: { from: string; to: string }): ReportResult {
  const rows = db
    .select({
      numero: productionBatches.number,
      fecha: productionBatches.productionDate,
      receta: sql<string>`(SELECT name FROM recipes WHERE id = (SELECT recipe_id FROM recipe_versions WHERE id = ${productionBatches.recipeVersionId}))`,
      version: sql<number>`(SELECT version FROM recipe_versions WHERE id = ${productionBatches.recipeVersionId})`,
      masa: masses.name,
      esperado: productionBatches.expectedYieldMicro,
      real: productionBatches.realYieldMicro,
      costoTotal: productionBatches.totalCostMicro,
      costoUnitario: productionBatches.unitCostMicro,
      estado: productionBatches.status,
    })
    .from(productionBatches)
    .innerJoin(recipeVersions, eq(productionBatches.recipeVersionId, recipeVersions.id))
    .innerJoin(masses, eq(recipeVersions.massId, masses.id))
    .where(
      and(
        sql`${productionBatches.productionDate} >= ${range.from}`,
        sql`${productionBatches.productionDate} <= ${range.to}`,
      ),
    )
    .orderBy(asc(productionBatches.productionDate), asc(productionBatches.number))
    .all();

  return {
    name: "produccion",
    title: "Producción de masas",
    from: range.from,
    to: range.to,
    columns: [
      { key: "numero", label: "Nº" },
      { key: "fecha", label: "Fecha" },
      { key: "receta", label: "Receta" },
      { key: "version", label: "Ver." },
      { key: "masa", label: "Masa" },
      { key: "esperado", label: "Esperado", fmt: "qty", align: "num" },
      { key: "real", label: "Real", fmt: "qty", align: "num" },
      { key: "costoTotal", label: "Costo total ($)", fmt: "money", align: "num" },
      { key: "costoUnitario", label: "Costo unit. ($)", fmt: "money", align: "num" },
      { key: "estado", label: "Estado" },
    ],
    rows: rows.map((r) => ({
      ...r,
      numero: num(r.numero),
      version: num(r.version),
      esperado: num(r.esperado),
      real: num(r.real),
      costoTotal: num(r.costoTotal),
      costoUnitario: num(r.costoUnitario),
    })),
    generatedAt: new Date().toISOString(),
  };
}

function ventasReport(db: DBOrTx, range: { from: string; to: string }): ReportResult {
  const rows = db
    .select({
      id: sales.id,
      numero: sales.number,
      fecha: sales.saleDate,
      metodo: sales.paymentMethod,
      subtotal: sales.subtotalMicro,
      descuento: sales.discountMicro,
      total: sales.totalMicro,
      costo: sales.totalCostMicro,
      margen: sql<number>`${sales.totalMicro} - ${sales.totalCostMicro}`,
      estado: sales.status,
    })
    .from(sales)
    .where(and(sql`${sales.saleDate} >= ${range.from}`, sql`${sales.saleDate} <= ${range.to}`))
    .orderBy(asc(sales.saleDate), asc(sales.number))
    .all();

  // Detalle de productos por venta: "Croquetas 10 paquete"
  const items = db
    .select({
      saleId: saleItems.saleId,
      qty: saleItems.qtyMicro,
      unitId: finishedProducts.saleUnitId,
      productName: finishedProducts.name,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(finishedProducts, eq(saleItems.productId, finishedProducts.id))
    .where(
      and(sql`${sales.saleDate} >= ${range.from}`, sql`${sales.saleDate} <= ${range.to}`),
    )
    .orderBy(asc(sales.saleDate), asc(sales.number), asc(saleItems.id))
    .all();
  const bySale = new Map<number, string[]>();
  for (const it of items) {
    const line = `${it.productName} ${qtyText(it.qty)} ${it.unitId}`;
    const list = bySale.get(it.saleId);
    if (list) list.push(line);
    else bySale.set(it.saleId, [line]);
  }

  return {
    name: "ventas",
    title: "Ventas",
    from: range.from,
    to: range.to,
    columns: [
      { key: "numero", label: "Nº" },
      { key: "fecha", label: "Fecha" },
      { key: "metodo", label: "Método" },
      { key: "productos", label: "Productos" },
      { key: "subtotal", label: "Subtotal ($)", fmt: "money", align: "num" },
      { key: "descuento", label: "Descuento ($)", fmt: "money", align: "num" },
      { key: "total", label: "Total ($)", fmt: "money", align: "num" },
      { key: "costo", label: "Costo de ventas ($)", fmt: "money", align: "num" },
      { key: "margen", label: "Margen ($)", fmt: "money", align: "num" },
      { key: "estado", label: "Estado" },
    ],
    rows: rows.map((r) => ({
      ...r,
      productos: (bySale.get(r.id) ?? []).join(", ") || "—",
      numero: num(r.numero),
      subtotal: num(r.subtotal),
      descuento: num(r.descuento),
      total: num(r.total),
      costo: num(r.costo),
      margen: num(r.margen),
    })),
    generatedAt: new Date().toISOString(),
  };
}

function rentabilidadReport(db: DBOrTx, range: { from: string; to: string }): ReportResult {
  const salesRows = db
    .select({
      fecha: sales.saleDate,
      total: sql<number>`COALESCE(SUM(${sales.totalMicro}), 0)`,
      cogs: sql<number>`COALESCE(SUM(${sales.totalCostMicro}), 0)`,
    })
    .from(sales)
    .where(and(eq(sales.status, "confirmada"), sql`${sales.saleDate} >= ${range.from}`, sql`${sales.saleDate} <= ${range.to}`))
    .groupBy(sales.saleDate)
    .all();
  const expRows = db
    .select({
      fecha: expenses.expenseDate,
      total: sql<number>`COALESCE(SUM(${expenses.amountMicro}), 0)`,
    })
    .from(expenses)
    .where(and(eq(expenses.status, "confirmada"), sql`${expenses.expenseDate} >= ${range.from}`, sql`${expenses.expenseDate} <= ${range.to}`))
    .groupBy(expenses.expenseDate)
    .all();
  const closings = db
    .select()
    .from(dailyClosings)
    .where(and(sql`${dailyClosings.businessDate} >= ${range.from}`, sql`${dailyClosings.businessDate} <= ${range.to}`))
    .all();

  const byDate = new Map<string, Record<string, unknown>>();
  const ensure = (fecha: string) => {
    let row = byDate.get(fecha);
    if (!row) {
      row = { fecha, ventas: 0, cogs: 0, bruto: 0, gastos: 0, neto: 0, cerrado: "No" };
      byDate.set(fecha, row);
    }
    return row;
  };
  for (const s of salesRows) {
    const row = ensure(s.fecha);
    row.ventas = num(s.total);
    row.cogs = num(s.cogs);
    row.bruto = num(s.total) - num(s.cogs);
  }
  for (const e of expRows) {
    const row = ensure(e.fecha);
    row.gastos = num(e.total);
  }
  for (const row of byDate.values()) {
    row.neto = Number(row.bruto) - Number(row.gastos);
  }
  for (const c of closings) {
    const row = ensure(c.businessDate);
    row.cerrado = c.status === "cerrado" ? "Sí" : "Reabierto";
    if (c.status === "cerrado") {
      row.ventas = c.salesTotalMicro;
      row.cogs = c.cogsMicro;
      row.gastos = c.expensesMicro;
      row.bruto = c.grossProfitMicro;
      row.neto = c.netResultMicro;
    }
  }

  return {
    name: "rentabilidad",
    title: "Rentabilidad por día",
    from: range.from,
    to: range.to,
    columns: [
      { key: "fecha", label: "Fecha" },
      { key: "ventas", label: "Ventas ($)", fmt: "money", align: "num" },
          { key: "cogs", label: "Costo de ventas ($)", fmt: "money", align: "num" },
      { key: "bruto", label: "Bruto ($)", fmt: "money", align: "num" },
      { key: "gastos", label: "Gastos ($)", fmt: "money", align: "num" },
      { key: "neto", label: "Neto ($)", fmt: "money", align: "num" },
      { key: "cerrado", label: "Cerrado" },
    ],
    rows: [...byDate.values()].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
    generatedAt: new Date().toISOString(),
  };
}

function rentabilidadProductosReport(db: DBOrTx, range: { from: string; to: string }): ReportResult {
  const rows = db
    .select({
      producto: finishedProducts.name,
      categoria: finishedProducts.category,
      unidad: finishedProducts.saleUnitId,
      cantidad: sql<number>`COALESCE(SUM(${saleItems.qtyMicro}), 0)`,
      ventas: sql<number>`COALESCE(SUM(${saleItems.lineTotalMicro}), 0)`,
      costo: sql<number>`COALESCE(SUM(${saleItems.lineCostMicro}), 0)`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(finishedProducts, eq(saleItems.productId, finishedProducts.id))
    .where(
      and(
        eq(sales.status, "confirmada"),
        sql`${sales.saleDate} >= ${range.from}`,
        sql`${sales.saleDate} <= ${range.to}`,
      ),
    )
    .groupBy(finishedProducts.id, finishedProducts.name, finishedProducts.category, finishedProducts.saleUnitId)
    .orderBy(sql`SUM(${saleItems.lineTotalMicro}) DESC`)
    .all();

  const pct = (part: number, whole: number): number =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

  return {
    name: "rentabilidad-productos",
    title: "Rentabilidad por producto (ventas confirmadas)",
    from: range.from,
    to: range.to,
    columns: [
      { key: "producto", label: "Producto" },
      { key: "categoria", label: "Categoría" },
      { key: "unidad", label: "Unidad" },
      { key: "cantidad", label: "Vendido", fmt: "qty", align: "num" },
      { key: "ventas", label: "Ingresos ($)", fmt: "money", align: "num" },
      { key: "costo", label: "Costo ($)", fmt: "money", align: "num" },
      { key: "margen", label: "Margen ($)", fmt: "money", align: "num" },
      { key: "margenPct", label: "Margen (%)", align: "num" },
    ],
    rows: rows.map((r) => {
      const ventas = num(r.ventas);
      const costo = num(r.costo);
      const margen = ventas - costo;
      return {
        producto: r.producto,
        categoria: r.categoria ?? "—",
        unidad: r.unidad,
        cantidad: num(r.cantidad),
        ventas,
        costo,
        margen,
        margenPct: pct(margen, ventas),
      };
    }),
    generatedAt: new Date().toISOString(),
  };
}

function auditoriaReport(db: DBOrTx, range: { from: string; to: string }): ReportResult {
  const rows = db
    .select({
      fecha: auditLogs.createdAt,
      accion: auditLogs.action,
      entidad: auditLogs.entityType,
      resumen: auditLogs.summary,
    })
    .from(auditLogs)
    .where(
      and(
        sql`substr(${auditLogs.createdAt}, 1, 10) >= ${range.from}`,
        sql`substr(${auditLogs.createdAt}, 1, 10) <= ${range.to}`,
      ),
    )
    .orderBy(desc(auditLogs.id))
    .limit(2000)
    .all();

  return {
    name: "auditoria",
    title: "Auditoría (últimos 2000 eventos)",
    from: range.from,
    to: range.to,
    columns: [
      { key: "fecha", label: "Fecha/hora" },
      { key: "accion", label: "Acción" },
      { key: "entidad", label: "Entidad" },
      { key: "resumen", label: "Resumen" },
    ],
    rows: rows.map((r) => ({ ...r })),
    generatedAt: new Date().toISOString(),
  };
}

export function buildReport(db: DBOrTx, name: string, opts: ReportRange = {}): ReportResult {
  switch (name) {
    case "inventario":
      return inventarioReport(db);
    case "productos":
      return productosReport(db, defaultRange(opts));
    case "compras":
      return comprasReport(db, defaultRange(opts));
    case "produccion":
      return produccionReport(db, defaultRange(opts));
    case "ventas":
      return ventasReport(db, defaultRange(opts));
    case "rentabilidad":
      return rentabilidadReport(db, defaultRange(opts));
    case "rentabilidad-productos":
      return rentabilidadProductosReport(db, defaultRange(opts));
    case "auditoria":
      return auditoriaReport(db, defaultRange(opts));
    default:
      throw new Error(`Reporte desconocido: ${name}`);
  }
}

/** CSV con BOM UTF-8 (Excel lo abre con acentos correctos). */
export function toCsv(report: ReportResult): string {
  const esc = (v: string): string =>
    /[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const format = (col: ReportColumn, value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (col.fmt === "money") return microToDecimal(num(value), 2);
    if (col.fmt === "qty") return qtyText(num(value));
    return String(value);
  };
  const header = report.columns.map((c) => esc(c.label)).join(",");
  const lines = report.rows.map((row) =>
    report.columns.map((c) => esc(format(c, row[c.key]))).join(","),
  );
  return `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
}
