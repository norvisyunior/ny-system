import { describe, expect, it } from "vitest";
import { getDashboard } from "../server/services/dashboard";
import { createExpense, expenseInput } from "../server/services/expenses";
import { createPlan } from "../server/services/planning";
import { confirmProduction, productionInput } from "../server/services/productions";
import { confirmTransformation, transformationInput } from "../server/services/transformations";
import { produce, setupFlow, sell, shiftIso, transform } from "./helpers";

describe("dashboard", () => {
  it("resume el día (ventas, gastos, elaboraciones, terminaciones, compras) y sus períodos", () => {
    const flow = setupFlow();
    produce(flow, "2");
    transform(flow, "1");
    sell(flow, [{ productId: flow.productId, qty: "10", unitPrice: "0.60" }]);
    createExpense(
      flow.h.db,
      expenseInput.parse({
        expenseDate: flow.today,
        category: "Servicios",
        description: "Luz",
        amount: "2.00",
        paymentMethod: "efectivo",
      }),
    );

    const d = getDashboard(flow.h.db, flow.today);

    // Resultado del día: 6.00 − 3.50 = 2.50 margen; − 2.00 gastos = 0.50 utilidad
    expect(d.date).toBe(flow.today);
    expect(d.salesMicro).toBe(6_000_000);
    expect(d.cogsMicro).toBe(3_500_000);
    expect(d.grossMicro).toBe(2_500_000);
    expect(d.expensesMicro).toBe(2_000_000);
    expect(d.netMicro).toBe(500_000);
    expect(d.salesCount).toBe(1);

    // Ventas del día con ítems y margen
    expect(d.daySales).toHaveLength(1);
    expect(d.daySales[0].totalMicro).toBe(6_000_000);
    expect(d.daySales[0].costMicro).toBe(3_500_000);
    expect(d.daySales[0].marginMicro).toBe(2_500_000);
    expect(d.daySales[0].paymentMethod).toBe("efectivo");
    expect(d.daySales[0].items).toHaveLength(1);
    expect(d.daySales[0].items[0].name).toBe("Producto Test");
    expect(d.daySales[0].items[0].qtyMicro).toBe(10_000_000);

    // Gastos del día
    expect(d.dayExpenses).toHaveLength(1);
    expect(d.dayExpenses[0]).toEqual({
      category: "Servicios",
      description: "Luz",
      amountMicro: 2_000_000,
    });

    // Elaboraciones del día: 2 masas de la receta
    expect(d.dayProductions).toHaveLength(1);
    expect(d.dayProductions[0].massName).toBe("Masa");
    expect(d.dayProductions[0].realYieldMicro).toBe(2_000_000);
    expect(d.dayProductions[0].totalCostMicro).toBe(6_000_000);

    // Terminaciones del día: 10 paquetes con costo de masa + empaques
    expect(d.dayOutputs).toHaveLength(1);
    expect(d.dayOutputs[0].productName).toBe("Producto Test");
    expect(d.dayOutputs[0].qtyMicro).toBe(10_000_000);
    expect(d.dayOutputs[0].costMicro).toBe(3_500_000);

    // Compras del día (500 kg harina + 5000 bolsas = 500.00)
    expect(d.dayPurchases).toHaveLength(1);
    expect(d.dayPurchases[0].supplierName).toBe("Proveedor Test");
    expect(d.dayPurchases[0].totalMicro).toBe(500_000_000);

    // Semana: últimos 7 días hasta la fecha visible
    expect(d.week.from).toBe(shiftIso(flow.today, -6));
    expect(d.week.to).toBe(flow.today);
    expect(d.week.salesMicro).toBe(6_000_000);
    expect(d.week.netMicro).toBe(500_000);
    expect(d.week.salesCount).toBe(1);
    expect(d.week.productionCount).toBe(1);
    expect(d.week.transformationCount).toBe(1);
    expect(d.week.purchaseCount).toBe(1);
    expect(d.week.purchaseTotalMicro).toBe(500_000_000);

    // Mes en curso: desde el día 1 del mes de la fecha visible
    expect(d.month.from).toBe(`${flow.today.slice(0, 8)}01`);
    expect(d.month.to).toBe(flow.today);
    expect(d.month.salesMicro).toBe(6_000_000);
    expect(d.month.expensesMicro).toBe(2_000_000);
    expect(d.month.grossMicro).toBe(2_500_000);

    // Productos de los últimos 30 días
    expect(d.topProducts).toHaveLength(1);
    expect(d.topProducts[0].name).toBe("Producto Test");
    expect(d.topProducts[0].unitId).toBe("unidad");
    expect(d.topProducts[0].qtyMicro).toBe(10_000_000);
    expect(d.topProducts[0].totalMicro).toBe(6_000_000);
    expect(d.topProducts[0].costMicro).toBe(3_500_000);
    expect(d.topProducts[0].marginMicro).toBe(2_500_000);

    // Serie diaria: 15 días terminando hoy, con el día completo al final
    expect(d.daily).toHaveLength(15);
    expect(d.daily[14].date).toBe(flow.today);
    expect(d.daily[14].salesMicro).toBe(6_000_000);
    expect(d.daily[14].cogsMicro).toBe(3_500_000);
    expect(d.daily[14].grossMicro).toBe(2_500_000);
    expect(d.daily[14].expensesMicro).toBe(2_000_000);
    expect(d.daily[14].netMicro).toBe(500_000);
    expect(d.daily[14].salesCount).toBe(1);
    expect(d.daily.slice(0, 14).every((p) => p.salesMicro === 0)).toBe(true);

    // Distribución de ventas del día por producto (dona)
    expect(d.dayProductSales).toHaveLength(1);
    expect(d.dayProductSales[0].productId).toBe(flow.productId);
    expect(d.dayProductSales[0].qtyMicro).toBe(10_000_000);
    expect(d.dayProductSales[0].totalMicro).toBe(6_000_000);
    expect(d.dayProductSales[0].costMicro).toBe(3_500_000);
    expect(d.dayProductSales[0].marginMicro).toBe(2_500_000);

    // Inventario por tipo: MP (488 kg harina = 244.00 + 4990 bolsas = 249.50),
    // 1 masa restante (3.00), PT agotado tras vender los 10
    expect(d.inventory.raw.activeCount).toBe(2);
    expect(d.inventory.raw.stockedCount).toBe(2);
    expect(d.inventory.raw.valueMicro).toBe(493_500_000);
    expect(d.inventory.mass.activeCount).toBe(1);
    expect(d.inventory.mass.stockedCount).toBe(1);
    expect(d.inventory.mass.valueMicro).toBe(3_000_000);
    expect(d.inventory.mass.lowCount).toBe(1); // 1 ≤ minStock 5
    expect(d.inventory.product.activeCount).toBe(1);
    expect(d.inventory.product.stockedCount).toBe(0);
    expect(d.inventory.product.outCount).toBe(1); // minStock 5 y stock 0
    expect(d.inventory.totalValueMicro).toBe(496_500_000);

    // Sin plan de producción en este flujo
    expect(d.plan).toBeNull();

    // Producciones recientes: elaboración + terminación del día
    expect(d.recentProductions).toHaveLength(2);
    const elaboracion = d.recentProductions.find((r) => r.kind === "elaboracion");
    expect(elaboracion?.title).toBe("Masa");
    expect(elaboracion?.expectedMicro).toBe(2_000_000);
    expect(elaboracion?.actualMicro).toBe(2_000_000);
    expect(elaboracion?.yieldPct).toBe(100);
    expect(elaboracion?.costMicro).toBe(6_000_000);
    const terminacion = d.recentProductions.find((r) => r.kind === "terminacion");
    expect(terminacion?.title).toBe("Producto Test");
    expect(terminacion?.detail).toBe("Masa");
    expect(terminacion?.expectedMicro).toBe(10_000_000);
    expect(terminacion?.actualMicro).toBe(10_000_000);
    expect(terminacion?.yieldPct).toBe(100);
    expect(terminacion?.unitId).toBe("unidad");
    expect(terminacion?.costMicro).toBe(3_500_000);

    // Sin desviaciones de rendimiento en los últimos 7 días
    expect(d.lowYields).toHaveLength(0);
  });

  it("devuelve estructura vacía para un día sin movimiento", () => {
    const flow = setupFlow();
    const other = getDashboard(flow.h.db, "2020-01-01");

    expect(other.salesMicro).toBe(0);
    expect(other.netMicro).toBe(0);
    expect(other.daySales).toHaveLength(0);
    expect(other.dayExpenses).toHaveLength(0);
    expect(other.dayProductions).toHaveLength(0);
    expect(other.dayOutputs).toHaveLength(0);
    expect(other.dayPurchases).toHaveLength(0);
    expect(other.topProducts).toHaveLength(0);
    expect(other.week.salesMicro).toBe(0);
    expect(other.month.salesMicro).toBe(0);
    // La compra de arranque de setupFlow es de hoy, no del 2020
    expect(other.week.purchaseCount).toBe(0);

    // Nuevos agregados sin datos: serie en cero, sin plan ni operaciones recientes
    expect(other.daily).toHaveLength(15);
    expect(other.daily[14].date).toBe("2020-01-01");
    expect(other.daily.every((p) => p.salesMicro === 0 && p.expensesMicro === 0)).toBe(true);
    expect(other.dayProductSales).toHaveLength(0);
    expect(other.plan).toBeNull();
    expect(other.recentProductions).toHaveLength(0);
    expect(other.lowYields).toHaveLength(0);
    // El inventario actual existe aunque el día esté vacío (MP comprada hoy)
    expect(other.inventory.raw.activeCount).toBe(2);
    expect(other.inventory.raw.valueMicro).toBe(500_000_000);
    expect(other.inventory.mass.outCount).toBe(1);
    expect(other.inventory.product.outCount).toBe(1);
  });

  it("progreso del plan: en proceso al 50% con ejecución parcial ligada al plan", () => {
    const flow = setupFlow();
    const plan = createPlan(flow.h.db, flow.h.units, {
      planDate: flow.today,
      recipeVersionId: flow.recipeVersionId,
      targetPackages: 20_000_000, // 20 paquetes → 2 masas
      clientToken: "plan-dash-0001",
    });

    confirmProduction(
      flow.h.db,
      flow.h.units,
      productionInput.parse({
        productionDate: flow.today,
        recipeVersionId: flow.recipeVersionId,
        massesCount: "2",
        planId: plan.id,
      }),
    );
    confirmTransformation(
      flow.h.db,
      flow.h.units,
      transformationInput.parse({
        transformDate: flow.today,
        massId: flow.masaId,
        massQty: "1",
        outputs: [{ productId: flow.productId, qty: "10" }],
        planId: plan.id,
      }),
    );

    const d = getDashboard(flow.h.db, flow.today);
    expect(d.plan).not.toBeNull();
    expect(d.plan?.number).toBe(plan.number);
    expect(d.plan?.recipeName).toBe("Receta Producto Test");
    expect(d.plan?.productName).toBe("Producto Test");
    expect(d.plan?.massName).toBe("Masa");
    expect(d.plan?.targetPackagesMicro).toBe(20_000_000);
    expect(d.plan?.plannedMassesMicro).toBe(2_000_000);
    expect(d.plan?.elaboratedMassesMicro).toBe(2_000_000);
    expect(d.plan?.producedPackagesMicro).toBe(10_000_000);
    expect(d.plan?.pendingPackagesMicro).toBe(10_000_000);
    expect(d.plan?.progressPct).toBe(50);
    expect(d.plan?.status).toBe("en_proceso");
    expect(d.plan?.missingMaterials).toHaveLength(0);
  });

  it("plan bloqueado por falta de materiales cuando no alcanza el stock", () => {
    const flow = setupFlow();
    // 100.000 paquetes → 10.000 masas → 60.000 kg harina (solo hay 500)
    createPlan(flow.h.db, flow.h.units, {
      planDate: flow.today,
      recipeVersionId: flow.recipeVersionId,
      targetPackages: 100_000_000_000,
      clientToken: "plan-dash-blocked",
    });

    const d = getDashboard(flow.h.db, flow.today);
    expect(d.plan?.status).toBe("bloqueado");
    expect(d.plan?.progressPct).toBe(0);
    expect(d.plan?.producedPackagesMicro).toBe(0);
    expect(d.plan?.missingMaterials.length).toBeGreaterThan(0);
    const harina = d.plan?.missingMaterials.find((m) => m.name === "Harina");
    expect(harina).toBeDefined();
    expect(harina?.unitId).toBe("kg");
    expect(harina!.missingMicro).toBeGreaterThan(0);
    expect(harina!.availableMicro).toBe(500_000_000);
  });

  it("marca rendimientos por debajo de lo esperado en los últimos 7 días", () => {
    const flow = setupFlow();
    produce(flow, "2");
    // Terminación real 7 paquetes vs 10 esperados → desviación −30%
    transform(flow, "1", [{ productId: flow.productId, qty: "7" }]);

    const d = getDashboard(flow.h.db, flow.today);
    expect(d.lowYields).toHaveLength(1);
    expect(d.lowYields[0].kind).toBe("terminacion");
    expect(d.lowYields[0].title).toBe("Producto Test");
    expect(d.lowYields[0].expectedMicro).toBe(10_000_000);
    expect(d.lowYields[0].actualMicro).toBe(7_000_000);
    expect(d.lowYields[0].unitId).toBe("unidad");
    expect(d.lowYields[0].gapPct).toBe(-30);

    // La producción reciente refleja el 70% de rendimiento
    const terminacion = d.recentProductions.find((r) => r.kind === "terminacion");
    expect(terminacion?.yieldPct).toBe(70);
  });
});
