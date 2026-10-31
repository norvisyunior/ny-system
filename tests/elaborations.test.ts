import { describe, expect, it } from "vitest";
import { createSupplier, supplierInput } from "../server/services/suppliers";
import { createMaterial, materialInput, listMaterials } from "../server/services/materials";
import {
  createPurchase,
  purchaseInput,
} from "../server/services/purchases";
import {
  annulElaboration,
  confirmElaboration,
  elaborationInput,
  elaborationPreviewInput,
  getElaborationTemplate,
  previewElaboration,
  saveElaborationTemplate,
  templateInput,
} from "../server/services/elaborations";
import { availableStock, estimatedAvgCost } from "../server/domain/fifo";
import { todayISO } from "../server/domain/dates";
import { newDb } from "./helpers";

function setup() {
  const h = newDb();
  const today = todayISO();
  const supplier = createSupplier(h.db, supplierInput.parse({ name: "Proveedor Test" }));
  const bolsa = createMaterial(
    h.db,
    materialInput.parse({ name: "Bolsa plastic 25x45", unitId: "unidad" }),
  );
  const etiqueta = createMaterial(
    h.db,
    materialInput.parse({ name: "Etiqueta", unitId: "unidad" }),
  );
  const nylon = createMaterial(
    h.db,
    materialInput.parse({
      name: "Nylon para empacar",
      unitId: "unidad",
      elaborated: true,
    }),
  );
  createPurchase(
    h.db,
    h.units,
    purchaseInput.parse({
      supplierId: supplier.id,
      purchaseDate: today,
      items: [
        { rawMaterialId: bolsa.id, unitId: "unidad", qty: "10", unitPrice: "2" },
        { rawMaterialId: etiqueta.id, unitId: "unidad", qty: "100", unitPrice: "0.5" },
      ],
    }),
  );
  return { h, today, supplierId: supplier.id, bolsaId: bolsa.id, etiquetaId: etiqueta.id, nylonId: nylon.id };
}

describe("Elaboración de materias primas", () => {
  it("consume insumos por PEPS + mano de obra por unidad; el costo unitario es (materiales + MO total) ÷ salida", () => {
    /*
     * Prueba integral del lote de nylon: PEPS de materiales, MO por unidad
     * (1.50 × 4 = 6.00) y costo unitario real (10.00 ÷ 4 = 2.50).
     */
    const t = setup();
    const res = confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: t.nylonId,
        outputQty: "4",
        laborCost: "1.50",
        items: [
          { rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" },
          { rawMaterialId: t.etiquetaId, unitId: "unidad", qty: "4" },
        ],
        clientToken: "token-elaboracion-0001",
      }),
    );
    expect(res.duplicated).toBe(false);
    expect(res.materialCostMicro).toBe(4_000_000); // $2 + 4×$0.50
    expect(res.laborCostMicro).toBe(6_000_000); // $1.50 × 4 unidades
    expect(res.totalCostMicro).toBe(10_000_000);
    expect(res.unitCostMicro).toBe(2_500_000); // 10.00 ÷ 4
    // stock: bolsa -1, etiqueta -4, nylon +4
    expect(availableStock(t.h.db, "raw", t.bolsaId)).toBe(9_000_000);
    expect(availableStock(t.h.db, "raw", t.etiquetaId)).toBe(96_000_000);
    expect(availableStock(t.h.db, "raw", t.nylonId)).toBe(4_000_000);
    // idempotencia: mismo token devuelve el mismo registro
    const dup = confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: t.nylonId,
        outputQty: "4",
        laborCost: "1.50",
        items: [{ rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" }],
        clientToken: "token-elaboracion-0001",
      }),
    );
    expect(dup.duplicated).toBe(true);
    expect(dup.id).toBe(res.id);
  });

  it("permite cadenas: una materia prima elaborada alimenta otra elaboración con su costo real", () => {
    const t = setup();
    confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: t.nylonId,
        outputQty: "4",
        laborCost: "1.50",
        items: [
          { rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" },
          { rawMaterialId: t.etiquetaId, unitId: "unidad", qty: "4" },
        ],
      }),
    );
    const polvo = createMaterial(
      t.h.db,
      materialInput.parse({ name: "Polvo empanizar", unitId: "kg", elaborated: true }),
    );
    const res2 = confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: polvo.id,
        outputQty: "2",
        laborCost: "0",
        items: [{ rawMaterialId: t.nylonId, unitId: "unidad", qty: "2" }],
      }),
    );
    // 2 nylon × $2.50 = $5.00; ÷ 2 kg = $2.50/kg
    expect(res2.materialCostMicro).toBe(5_000_000);
    expect(res2.unitCostMicro).toBe(2_500_000);
    expect(availableStock(t.h.db, "raw", t.nylonId)).toBe(2_000_000);
    expect(availableStock(t.h.db, "raw", polvo.id)).toBe(2_000_000);
    // no puede ser insumo de su propia elaboración
    expect(() =>
      confirmElaboration(
        t.h.db,
        t.h.units,
        elaborationInput.parse({
          elaborationDate: t.today,
          outputMaterialId: polvo.id,
          outputQty: "1",
          items: [{ rawMaterialId: polvo.id, unitId: "kg", qty: "1" }],
        }),
      ),
    ).toThrow(/propia/);
  });

  it("las elaboradas también pueden comprarse: PEPS mezcla lotes de compra y de elaboración", () => {
    const t = setup();
    // compra directa de 2 nylon a $1/unidad (ej. carne ya despiezada comprada)
    createPurchase(
      t.h.db,
      t.h.units,
      purchaseInput.parse({
        supplierId: t.supplierId,
        purchaseDate: t.today,
        items: [{ rawMaterialId: t.nylonId, unitId: "unidad", qty: "2", unitPrice: "1" }],
      }),
    );
    // lote de elaboración propia: materiales $4 + MO $6 → $10 por 4 = $2.50/und
    confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: t.nylonId,
        outputQty: "4",
        laborCost: "1.50",
        items: [
          { rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" },
          { rawMaterialId: t.etiquetaId, unitId: "unidad", qty: "4" },
        ],
      }),
    );
    expect(availableStock(t.h.db, "raw", t.nylonId)).toBe(6_000_000);
    // consumir 5 nylon en otra elaboración: PEPS saca primero los 2 comprados
    // ($1/und) y luego 3 elaborados ($2.50/und): 2×$1 + 3×$2.50 = $9.50
    const avg = estimatedAvgCost(t.h.db, "raw", t.nylonId);
    // promedio de los lotes pendientes: (2×1 + 4×2.50) / 6 = $2.00/unidad
    expect(avg).toBe(2_000_000);
    const cordel = createMaterial(
      t.h.db,
      materialInput.parse({ name: "Cordel", unitId: "unidad", elaborated: true }),
    );
    const res = confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: cordel.id,
        outputQty: "10",
        laborCost: "0",
        items: [{ rawMaterialId: t.nylonId, unitId: "unidad", qty: "5" }],
      }),
    );
    expect(res.materialCostMicro).toBe(9_500_000); // 2×$1 + 3×$2.50
  });

  it("anula: revierte insumos y cancela el resultado; bloquea si el resultado ya se consumió", () => {
    const t = setup();
    // Elaboración 1 → 4 nylon
    const e1 = confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: t.nylonId,
        outputQty: "4",
        laborCost: "1.50",
        items: [
          { rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" },
          { rawMaterialId: t.etiquetaId, unitId: "unidad", qty: "4" },
        ],
      }),
    );
    // Anulación de la primera: restaura insumos y descuenta el nylon.
    annulElaboration(t.h.db, e1.id, "Registro de prueba");
    expect(availableStock(t.h.db, "raw", t.bolsaId)).toBe(10_000_000);
    expect(availableStock(t.h.db, "raw", t.etiquetaId)).toBe(100_000_000);
    expect(availableStock(t.h.db, "raw", t.nylonId)).toBe(0);
    expect(() => annulElaboration(t.h.db, e1.id, "segunda anulación")).toThrow(/ya fue anulada/);

    // Nueva elaboración + cadena que consume el nylon → anular la primera debe bloquearse.
    const e2 = confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: t.nylonId,
        outputQty: "4",
        laborCost: "1.50",
        items: [
          { rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" },
          { rawMaterialId: t.etiquetaId, unitId: "unidad", qty: "4" },
        ],
      }),
    );
    const cordel = createMaterial(
      t.h.db,
      materialInput.parse({ name: "Cordel", unitId: "unidad", elaborated: true }),
    );
    confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: cordel.id,
        outputQty: "1",
        items: [{ rawMaterialId: t.nylonId, unitId: "unidad", qty: "2" }],
      }),
    );
    expect(() => annulElaboration(t.h.db, e2.id, "intento bloqueado")).toThrow(
      /ya fue consumido/,
    );
  });

  it("preview estima con promedio PEPS, precarga la última mano de obra y lastCost sale en listMaterials", () => {
    const t = setup();
    confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: t.nylonId,
        outputQty: "4",
        laborCost: "1.50",
        items: [
          { rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" },
          { rawMaterialId: t.etiquetaId, unitId: "unidad", qty: "4" },
        ],
      }),
    );
    const pv = previewElaboration(
      t.h.db,
      t.h.units,
      elaborationPreviewInput.parse({
        outputMaterialId: t.nylonId,
        outputQty: "4",
        items: [{ rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" }],
      }),
    );
    // promedio PEPS de la bolsa: 9 unidades a $2 → $2/unidad
    expect(pv.lines[0]?.avgCostMicro).toBe(2_000_000);
    expect(pv.lines[0]?.estimatedCostMicro).toBe(2_000_000);
    // última MO usada, convertida a tarifa por unidad: $6.00 ÷ 4 = $1.50
    expect(pv.lastLaborCostMicro).toBe(1_500_000);
    expect(estimatedAvgCost(t.h.db, "raw", t.nylonId)).toBe(2_500_000);

    const all = listMaterials(t.h.db, {});
    const nylonRow = all.find((m) => m.id === t.nylonId)!;
    expect(nylonRow.elaborated).toBe(true);
    expect(nylonRow.lastCost?.costMicro).toBe(2_500_000);
  });

  it("preview sin material resultante: estima las líneas aunque falte la salida", () => {
    const t = setup();
    const pv = previewElaboration(
      t.h.db,
      t.h.units,
      elaborationPreviewInput.parse({
        items: [{ rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" }],
      }),
    );
    expect(pv.outputMaterialId).toBeNull();
    expect(pv.unitCostMicro).toBeNull();
    expect(pv.materialCostMicro).toBe(2_000_000); // $2/unidad
    expect(pv.totalCostMicro).toBe(2_000_000);
    // con salida elegida pero sin cantidad, tampoco hay costo unitario
    const pv2 = previewElaboration(
      t.h.db,
      t.h.units,
      elaborationPreviewInput.parse({
        outputMaterialId: t.nylonId,
        items: [{ rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" }],
      }),
    );
    expect(pv2.outputMaterialId).toBe(t.nylonId);
    expect(pv2.unitCostMicro).toBeNull();
    expect(pv2.lastLaborCostMicro).toBeNull();
  });

  it("plantilla: guarda ratios únicos por material y normaliza a la unidad base", () => {
    const t = setup();
    expect(getElaborationTemplate(t.h.db, t.nylonId)).toBeNull();
    // 1 bolsa cada 4 nylon (0.25/unidad) + 1 etiqueta por nylon; MO $1.50/lote
    const tpl = saveElaborationTemplate(
      t.h.db,
      t.h.units,
      t.nylonId,
      templateInput.parse({
        laborCost: "1.50",
        lines: [
          { rawMaterialId: t.bolsaId, unitId: "unidad", qtyPerUnit: "0.25" },
          { rawMaterialId: t.etiquetaId, unitId: "unidad", qtyPerUnit: "1" },
        ],
      }),
    );
    expect(tpl.laborCostMicro).toBe(1_500_000);
    expect(tpl.lines.map((l) => [l.rawMaterialId, l.qtyPerUnitMicro])).toEqual([
      [t.bolsaId, 250_000],
      [t.etiquetaId, 1_000_000],
    ]);
    expect(getElaborationTemplate(t.h.db, t.nylonId)!.lines.length).toBe(2);
    // editarla reemplaza (única por material)
    const tpl2 = saveElaborationTemplate(
      t.h.db,
      t.h.units,
      t.nylonId,
      templateInput.parse({
        laborCost: "2",
        lines: [{ rawMaterialId: t.bolsaId, unitId: "unidad", qtyPerUnit: "0.5" }],
      }),
    );
    expect(tpl2.lines.length).toBe(1);
    expect(tpl2.lines[0]?.qtyPerUnitMicro).toBe(500_000);
    expect(tpl2.laborCostMicro).toBe(2_000_000);
    // el material resultante no puede ser insumo de su propia plantilla
    expect(() =>
      saveElaborationTemplate(
        t.h.db,
        t.h.units,
        t.nylonId,
        templateInput.parse({
          lines: [{ rawMaterialId: t.nylonId, unitId: "unidad", qtyPerUnit: "1" }],
        }),
      ),
    ).toThrow(/propia/);
  });

  it("al confirmar una elaboración, la MO de la plantilla se sincroniza con la última usada", () => {
    const t = setup();
    // confirma sin plantilla: la MO del lote inicializa la plantilla
    confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: t.nylonId,
        outputQty: "4",
        laborCost: "1.50",
        items: [{ rawMaterialId: t.bolsaId, unitId: "unidad", qty: "1" }],
      }),
    );
    expect(getElaborationTemplate(t.h.db, t.nylonId)!.laborCostMicro).toBe(1_500_000);
    // siguiente lote con otra MO: la plantilla toma la última usada
    confirmElaboration(
      t.h.db,
      t.h.units,
      elaborationInput.parse({
        elaborationDate: t.today,
        outputMaterialId: t.nylonId,
        outputQty: "8",
        laborCost: "2",
        items: [{ rawMaterialId: t.bolsaId, unitId: "unidad", qty: "2" }],
      }),
    );
    expect(getElaborationTemplate(t.h.db, t.nylonId)!.laborCostMicro).toBe(2_000_000);
  });
});
