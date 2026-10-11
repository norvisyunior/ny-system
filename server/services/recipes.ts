import {
  recipes,
  recipeVersions,
  recipeItems,
  masses,
  rawMaterials,
  units,
  finishedProducts,
} from "../../db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { domainError, notFoundError } from "../domain/errors";
import { logAudit } from "../domain/audit";
import { decMicro } from "../domain/zod-helpers";
import type { DBOrTx } from "../domain/types";
import type { UnitsCatalog } from "../domain/units";

export const RECIPE_PHASES = ["masa", "paquete"] as const;
export type RecipePhase = (typeof RECIPE_PHASES)[number];

const recipeItemInput = z.object({
  rawMaterialId: z.number().int().positive("Material requerido."),
  unitId: z.string().min(1, "Unidad requerida."),
  qty: decMicro({ minExclusive: true }),
  // 'masa' = cantidad por masa (se consume al elaborar);
  // 'paquete' = cantidad por paquete (se consume al terminar/empaquetar).
  phase: z.enum(["masa", "paquete"]).default("masa"),
});

export const versionInput = z.object({
  massId: z.number().int().positive("Masa requerida."),
  expectedYield: decMicro({ minExclusive: true }),
  yieldUnitId: z.string().min(1, "Unidad de rendimiento requerida."),
  instructions: z.string().trim().max(2000).optional().nullable(),
  validFrom: z.string().min(1, "Fecha de vigencia requerida."),
  notes: z.string().trim().max(500).optional().nullable(),
  items: z.array(recipeItemInput).min(1, "Agregue al menos un ingrediente."),
});
export type VersionInput = z.infer<typeof versionInput>;

export const recipeCreateInput = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(120),
  description: z.string().trim().max(500).optional().nullable(),
  // Una única receta por producto.
  productId: z.number().int().positive("Seleccione el producto terminado."),
  version: versionInput,
});
export type RecipeCreateInput = z.infer<typeof recipeCreateInput>;

export const recipeUpdateInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
});

function validateVersionItems(
  catalog: UnitsCatalog,
  tx: DBOrTx,
  version: VersionInput,
  recipe: { id: number; productId: number | null },
): void {
  const mass = tx.select().from(masses).where(eq(masses.id, version.massId)).get();
  if (!mass) throw notFoundError("Masa");
  if (!mass.active) throw domainError(`La masa "${mass.name}" está inactiva.`);

  if (recipe.productId != null) {
    // Receta por producto: la masa se cuenta (no se pesa) y el rendimiento se
    // expresa en la unidad de venta del producto (paquetes).
    const product = tx
      .select()
      .from(finishedProducts)
      .where(eq(finishedProducts.id, recipe.productId))
      .get();
    if (!product) throw notFoundError("Producto");
    if (!product.active) throw domainError(`El producto "${product.name}" está inactivo.`);
    if (catalog.get(mass.unitId).dimension !== "conteo") {
      throw domainError(
        `La masa "${mass.name}" debe contarse en unidades completas (dimensión conteo), no pesarse.`,
      );
    }
    if (version.yieldUnitId !== product.saleUnitId) {
      throw domainError(
        `El rendimiento debe expresarse en la unidad de venta del producto (${product.saleUnitId}).`,
      );
    }
    if (catalog.get(version.yieldUnitId).dimension !== "conteo") {
      throw domainError(
        `El rendimiento esperado debe expresarse en paquetes (dimensión conteo); use "${product.saleUnitId}".`,
      );
    }
  } else {
    // Receta legada sin producto: el rendimiento se mide en la unidad de la masa.
    catalog.assertCompatible(version.yieldUnitId, mass.unitId);
    if (version.yieldUnitId !== mass.unitId) {
      throw domainError(
        `El rendimiento debe medirse en la unidad de la masa (${mass.unitId}).`,
      );
    }
  }

  const seen = new Set<number>();
  for (const item of version.items) {
    const mat = tx.select().from(rawMaterials).where(eq(rawMaterials.id, item.rawMaterialId)).get();
    if (!mat) throw notFoundError("Materia prima");
    if (seen.has(item.rawMaterialId)) {
      throw domainError(`El material "${mat.name}" está repetido en la receta.`);
    }
    seen.add(item.rawMaterialId);
    catalog.assertCompatible(item.unitId, mat.unitId);
    if (catalog.get(mat.unitId).dimension === "conteo" && item.unitId !== mat.unitId) {
      throw domainError(
        `El material "${mat.name}" se cuenta en "${mat.unitId}"; use esa misma unidad en la receta.`,
      );
    }
  }
}

function insertVersionWithItems(
  tx: DBOrTx,
  recipeId: number,
  versionNumber: number,
  input: VersionInput,
): number {
  const [v] = tx
    .insert(recipeVersions)
    .values({
      recipeId,
      version: versionNumber,
      status: "activa",
      massId: input.massId,
      expectedYieldMicro: input.expectedYield,
      yieldUnitId: input.yieldUnitId,
      instructions: input.instructions ?? null,
      validFrom: input.validFrom,
      notes: input.notes ?? null,
    })
    .returning()
    .all();
  for (const item of input.items) {
    tx.insert(recipeItems)
      .values({
        recipeVersionId: v.id,
        rawMaterialId: item.rawMaterialId,
        unitId: item.unitId,
        qtyMicro: item.qty,
        phase: item.phase,
      })
      .run();
  }
  return v.id;
}

/** Crea la receta (una por producto) con su primera versión. */
export function createRecipe(db: DBOrTx, catalog: UnitsCatalog, input: RecipeCreateInput) {
  return db.transaction((tx) => {
    const dup = tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(sql`upper(${recipes.name}) = upper(${input.name})`)
      .get();
    if (dup) throw domainError(`Ya existe una receta con el nombre "${input.name}".`);
    const dupProduct = tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.productId, input.productId))
      .get();
    if (dupProduct) {
      throw domainError("Ya existe una receta para el producto seleccionado.");
    }
    const recipeRow = {
      name: input.name,
      description: input.description ?? null,
      productId: input.productId,
    };
    validateVersionItems(catalog, tx, input.version, { id: 0, productId: input.productId });

    const [recipe] = tx.insert(recipes).values(recipeRow).returning().all();
    const versionId = insertVersionWithItems(tx, recipe.id, 1, input.version);

    logAudit(tx, {
      action: "recipe.create",
      entityType: "recipe",
      entityId: recipe.id,
      summary: `Receta "${recipe.name}" v1 creada`,
    });
    return { ...recipe, versionId, version: 1 };
  });
}

/** Nueva versión de una receta existente; la anterior versión activa queda archivada. */
export function createRecipeVersion(
  db: DBOrTx,
  catalog: UnitsCatalog,
  recipeId: number,
  input: VersionInput,
) {
  return db.transaction((tx) => {
    const recipe = tx.select().from(recipes).where(eq(recipes.id, recipeId)).get();
    if (!recipe) throw notFoundError("Receta");
    validateVersionItems(catalog, tx, input, recipe);

    const maxV = tx
      .select({ maxV: sql<number>`COALESCE(MAX(${recipeVersions.version}), 0)` })
      .from(recipeVersions)
      .where(eq(recipeVersions.recipeId, recipeId))
      .get();
    const newVersion = (maxV?.maxV ?? 0) + 1;

    tx.update(recipeVersions)
      .set({ status: "archivada" })
      .where(and(eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.status, "activa")))
      .run();

    const versionId = insertVersionWithItems(tx, recipeId, newVersion, input);
    tx.update(recipes).set({ updatedAt: new Date().toISOString() }).where(eq(recipes.id, recipeId)).run();

    logAudit(tx, {
      action: "recipe.version",
      entityType: "recipe",
      entityId: recipeId,
      summary: `Receta "${recipe.name}" v${newVersion} creada (anterior archivada)`,
      details: { versionId, expectedYield: input.expectedYield },
    });
    return { recipeId, versionId, version: newVersion };
  });
}

export function updateRecipe(db: DBOrTx, id: number, input: z.infer<typeof recipeUpdateInput>) {
  return db.transaction((tx) => {
    const existing = tx.select().from(recipes).where(eq(recipes.id, id)).get();
    if (!existing) throw notFoundError("Receta");
    const dup = tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(sql`upper(${recipes.name}) = upper(${input.name}) AND ${recipes.id} <> ${id}`)
      .get();
    if (dup) throw domainError(`Ya existe otra receta con el nombre "${input.name}".`);
    const [row] = tx
      .update(recipes)
      .set({
        name: input.name,
        description: input.description ?? null,
        active: input.active ?? existing.active,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(recipes.id, id))
      .returning()
      .all();
    logAudit(tx, {
      action: "update",
      entityType: "recipe",
      entityId: id,
      summary: `Receta actualizada: ${row.name}`,
    });
    return row;
  });
}

export interface RecipeListRow {
  id: number;
  name: string;
  active: boolean;
  productId: number | null;
  productName: string | null;
  versionId: number | null;
  version: number | null;
  massId: number | null;
  massName: string | null;
  expectedYieldMicro: number | null;
  yieldUnitId: string | null;
  validFrom: string | null;
  itemsCount: number;
}

export function listRecipes(db: DBOrTx): RecipeListRow[] {
  const rows = db
    .select({
      id: recipes.id,
      name: recipes.name,
      active: recipes.active,
      productId: recipes.productId,
      productName: finishedProducts.name,
      versionId: recipeVersions.id,
      version: recipeVersions.version,
      massId: recipeVersions.massId,
      massName: masses.name,
      expectedYieldMicro: recipeVersions.expectedYieldMicro,
      yieldUnitId: recipeVersions.yieldUnitId,
      validFrom: recipeVersions.validFrom,
      itemsCount: sql<number>`(SELECT COUNT(*) FROM recipe_items ri WHERE ri.recipe_version_id = ${recipeVersions.id})`,
      rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${recipes.id} ORDER BY ${recipeVersions.version} DESC)`,
    })
    .from(recipes)
    .leftJoin(recipeVersions, eq(recipeVersions.recipeId, recipes.id))
    .leftJoin(masses, eq(masses.id, recipeVersions.massId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
    .all()
    .filter((r) => r.rn === 1);
  return rows;
}

export function getRecipeVersions(db: DBOrTx, recipeId: number) {
  const recipe = db.select().from(recipes).where(eq(recipes.id, recipeId)).get();
  if (!recipe) throw notFoundError("Receta");
  const product = recipe.productId
    ? db.select().from(finishedProducts).where(eq(finishedProducts.id, recipe.productId)).get()
    : undefined;
  const versions = db
    .select({
      id: recipeVersions.id,
      version: recipeVersions.version,
      status: recipeVersions.status,
      massId: recipeVersions.massId,
      massName: masses.name,
      expectedYieldMicro: recipeVersions.expectedYieldMicro,
      yieldUnitId: recipeVersions.yieldUnitId,
      instructions: recipeVersions.instructions,
      validFrom: recipeVersions.validFrom,
      notes: recipeVersions.notes,
      createdAt: recipeVersions.createdAt,
    })
    .from(recipeVersions)
    .leftJoin(masses, eq(masses.id, recipeVersions.massId))
    .where(eq(recipeVersions.recipeId, recipeId))
    .orderBy(desc(recipeVersions.version))
    .all();
  return { recipe, product, versions };
}

export function getRecipeVersionDetail(db: DBOrTx, versionId: number) {
  const version = db
    .select({
      id: recipeVersions.id,
      recipeId: recipeVersions.recipeId,
      recipeName: recipes.name,
      productId: recipes.productId,
      productName: finishedProducts.name,
      productSaleUnit: finishedProducts.saleUnitId,
      version: recipeVersions.version,
      status: recipeVersions.status,
      massId: recipeVersions.massId,
      massName: masses.name,
      massUnit: masses.unitId,
      expectedYieldMicro: recipeVersions.expectedYieldMicro,
      yieldUnitId: recipeVersions.yieldUnitId,
      instructions: recipeVersions.instructions,
      validFrom: recipeVersions.validFrom,
      notes: recipeVersions.notes,
    })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .leftJoin(masses, eq(masses.id, recipeVersions.massId))
    .leftJoin(finishedProducts, eq(finishedProducts.id, recipes.productId))
    .where(eq(recipeVersions.id, versionId))
    .get();
  if (!version) throw notFoundError("Versión de receta");
  const items = db
    .select({
      id: recipeItems.id,
      rawMaterialId: recipeItems.rawMaterialId,
      materialName: rawMaterials.name,
      materialUnit: rawMaterials.unitId,
      unitId: recipeItems.unitId,
      unitLabel: units.label,
      qtyMicro: recipeItems.qtyMicro,
      phase: recipeItems.phase,
    })
    .from(recipeItems)
    .innerJoin(rawMaterials, eq(rawMaterials.id, recipeItems.rawMaterialId))
    .innerJoin(units, eq(units.code, recipeItems.unitId))
    .where(eq(recipeItems.recipeVersionId, versionId))
    .orderBy(asc(recipeItems.id))
    .all();
  return { ...version, items };
}
