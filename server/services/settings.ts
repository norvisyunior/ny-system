import { appSettings } from "../../db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { logAudit } from "../domain/audit";
import type { DBOrTx } from "../domain/types";

export interface AppSettings {
  businessName: string;
  currency: string;
  demoMode: boolean;
}

const DEFAULTS: AppSettings = {
  businessName: "NYORA",
  currency: "CUP",
  demoMode: false,
};

function readMap(db: DBOrTx): Map<string, string> {
  const rows = db.select().from(appSettings).all();
  return new Map(rows.map((r) => [r.key, r.value]));
}

export function getSettings(db: DBOrTx): AppSettings {
  const map = readMap(db);
  return {
    businessName: map.get("businessName") || DEFAULTS.businessName,
    currency: map.get("currency") || DEFAULTS.currency,
    demoMode: map.get("demoMode") === "1",
  };
}

export const settingsInput = z.object({
  businessName: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres.").max(80).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
});
export type SettingsInput = z.infer<typeof settingsInput>;

function put(db: DBOrTx, key: string, value: string): void {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

export function updateSettings(db: DBOrTx, input: SettingsInput): AppSettings {
  return db.transaction((tx) => {
    if (input.businessName !== undefined) put(tx, "businessName", input.businessName);
    if (input.currency !== undefined) put(tx, "currency", input.currency);
    const next = getSettings(tx);
    logAudit(tx, {
      action: "settings.update",
      entityType: "app_settings",
      entityId: null,
      summary: `Configuración actualizada: ${next.businessName} (${next.currency})`,
      details: { input },
    });
    return next;
  });
}

export function setDemoFlag(db: DBOrTx, demo: boolean): void {
  put(db, "demoMode", demo ? "1" : "0");
}

export function getSetting(db: DBOrTx, key: string): string | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(db: DBOrTx, key: string, value: string): void {
  put(db, key, value);
}
