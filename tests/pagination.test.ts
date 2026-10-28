import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { isPageResult } from "../server/domain/paging";
import { pageParams, slicePage } from "../server/routes/paging";
import { listMaterials } from "../server/services/materials";
import { listMasses } from "../server/services/masses";
import { createProduct, listProducts, productInput } from "../server/services/products";
import { listProductions, listYields } from "../server/services/productions";
import { listPurchases } from "../server/services/purchases";
import { listRecipes } from "../server/services/recipes";
import { getSalesSummary, listSales } from "../server/services/sales";
import { produce, sell, setupFlow, transform } from "./helpers";
import type { Flow } from "./helpers";

function fakeReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

/** Prepara 3 ventas de 1 unidad cada una (10 unidades producidas). */
function withSales(): Flow {
  const flow = setupFlow();
  produce(flow, "1");
  transform(flow);
  for (let i = 0; i < 3; i++) {
    sell(flow, [{ productId: flow.productId, qty: "1", unitPrice: "0.60" }]);
  }
  return flow;
}

describe("Paginación de listados", () => {
  it("pageParams interpreta, normaliza y limita los parámetros HTTP", () => {
    expect(pageParams(fakeReq({}))).toBeUndefined();
    expect(pageParams(fakeReq({ page: "" }))).toBeUndefined();
    expect(pageParams(fakeReq({ page: "2", pageSize: "5" }))).toEqual({
      page: 2,
      pageSize: 5,
      limit: 5,
      offset: 5,
    });
    expect(pageParams(fakeReq({ page: "0", pageSize: "0" }))).toEqual({
      page: 1,
      pageSize: 10,
      limit: 10,
      offset: 0,
    });
    expect(pageParams(fakeReq({ page: "3", pageSize: "9999" }))?.pageSize).toBe(200);
    expect(pageParams(fakeReq({ page: "x", pageSize: "y" }))).toEqual({
      page: 1,
      pageSize: 10,
      limit: 10,
      offset: 0,
    });
  });

  it("slicePage recorta y conserva el total (listados en memoria)", () => {
    const rows = Array.from({ length: 25 }, (_, i) => i + 1);
    const page = slicePage(rows, { page: 2, pageSize: 10, limit: 10, offset: 10 });
    expect(page.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page.total).toBe(25);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(10);
  });

  it("sin paging los servicios siguen devolviendo arrays", () => {
    const flow = setupFlow();
    expect(Array.isArray(listSales(flow.h.db))).toBe(true);
    expect(Array.isArray(listPurchases(flow.h.db))).toBe(true);
    expect(Array.isArray(listMaterials(flow.h.db))).toBe(true);
    expect(Array.isArray(listMasses(flow.h.db))).toBe(true);
    expect(Array.isArray(listRecipes(flow.h.db))).toBe(true);
    expect(Array.isArray(listProductions(flow.h.db))).toBe(true);
  });

  it("con paging devuelve items, total y respeta limit/offset", () => {
    const flow = withSales();
    const first = listSales(flow.h.db, {}, { limit: 2, offset: 0 });
    expect(isPageResult(first)).toBe(true);
    if (Array.isArray(first)) throw new Error("se esperaba resultado paginado");
    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(first.items[0].itemsCount).toBe(1);

    const second = listSales(flow.h.db, {}, { limit: 2, offset: 2 });
    if (Array.isArray(second)) throw new Error("se esperaba resultado paginado");
    expect(second.total).toBe(3);
    expect(second.items).toHaveLength(1);

    const byProduct = listSales(flow.h.db, { q: "Producto Test" }, { limit: 10, offset: 0 });
    if (Array.isArray(byProduct)) throw new Error("se esperaba resultado paginado");
    expect(byProduct.total).toBe(3);
    expect(byProduct.items[0].itemsCount).toBe(1);
  });

  it("el total refleja el filtro q, no solo la página", () => {
    const flow = setupFlow();
    const all = listMaterials(flow.h.db, {}, { limit: 1, offset: 0 });
    if (Array.isArray(all)) throw new Error("se esperaba resultado paginado");
    expect(all.total).toBe(2);

    const filtered = listMaterials(flow.h.db, { q: "Harina" }, { limit: 10, offset: 0 });
    if (Array.isArray(filtered)) throw new Error("se esperaba resultado paginado");
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].name).toBe("Harina");

    const suppliers = listPurchases(flow.h.db, { q: "Proveedor Test" }, { limit: 10, offset: 0 });
    if (Array.isArray(suppliers)) throw new Error("se esperaba resultado paginado");
    expect(suppliers.total).toBe(1);
    expect(suppliers.items[0].supplierName).toBe("Proveedor Test");

    const none = listPurchases(flow.h.db, { q: "no-existe" }, { limit: 10, offset: 0 });
    if (Array.isArray(none)) throw new Error("se esperaba resultado paginado");
    expect(none.total).toBe(0);
    expect(none.items).toHaveLength(0);
  });

  it("la búsqueda de productos incluye la categoría", () => {
    const flow = setupFlow();
    createProduct(
      flow.h.db,
      productInput.parse({
        name: "Croquetas de queso",
        category: "Croquetas",
        saleUnitId: "paquete",
        price: "380",
      }),
    );

    const byCategory = listProducts(flow.h.db, { q: "Croquetas" }, { limit: 10, offset: 0 });
    if (Array.isArray(byCategory)) throw new Error("se esperaba resultado paginado");
    expect(byCategory.total).toBe(1);
    expect(byCategory.items[0].name).toBe("Croquetas de queso");

    const byName = listProducts(flow.h.db, { q: "Producto Test" }, { limit: 10, offset: 0 });
    if (Array.isArray(byName)) throw new Error("se esperaba resultado paginado");
    expect(byName.total).toBe(1);
  });

  it("la búsqueda de recetas por producto se pagina en SQL", () => {
    const flow = setupFlow();
    const page = listRecipes(flow.h.db, { q: "Producto Test" }, { limit: 10, offset: 0 });
    if (Array.isArray(page)) throw new Error("se esperaba resultado paginado");
    expect(page.total).toBe(1);
    expect(page.items[0].versionId).toBe(flow.recipeVersionId);
  });

  it("los rendimientos decoran la página sin perder total", () => {
    const flow = setupFlow();
    produce(flow, "1");
    const page = listYields(flow.h.db, {}, { limit: 5, offset: 0 });
    if (Array.isArray(page)) throw new Error("se esperaba resultado paginado");
    expect(page.total).toBe(1);
    expect(page.items[0].yieldPercent).toBe(100);
    expect(page.items[0].deviationMicro).toBe(0);
  });

  it("el resumen de ventas suma todo el filtro aunque la tabla esté paginada", () => {
    const flow = withSales();
    const page = listSales(flow.h.db, {}, { limit: 1, offset: 0 });
    if (Array.isArray(page)) throw new Error("se esperaba resultado paginado");
    expect(page.items).toHaveLength(1);

    const summary = getSalesSummary(flow.h.db, {});
    expect(summary.count).toBe(3);
    expect(summary.totalMicro).toBe(1_800_000);
    expect(summary.costMicro).toBe(1_050_000);
  });
});
