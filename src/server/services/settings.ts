// Tenant-scoped legal/financial configuration (Setting model). See
// src/lib/settings-defaults.ts for the 8 known keys and their default values —
// this is the only place that should touch prisma.setting directly; pages go
// through getSettings/setSetting like every other tenant-scoped read/write.
import { prisma } from "@/lib/prisma";
import { requireAnyUser, requireRole, requireZev, type Actor } from "@/server/auth/guards";
import { audit } from "@/server/audit";
import { DEFAULT_SETTINGS, SETTING_DEFINITIONS, isSettingKey, type SettingKey } from "@/lib/settings-defaults";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Merges the tenant's stored rows over the shared defaults, so a key with no row yet
 * (a brand-new default added later, or a tenant seeded before this migration) never
 * renders as blank — same shape as the old per-page `?? def` fallback, centralized.
 */
export async function getSettings(actor: Actor): Promise<Record<SettingKey, string>> {
  requireAnyUser(actor);
  const zevId = requireZev(actor);
  const rows = await prisma.setting.findMany({ where: { zevId } });
  const result: Record<SettingKey, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (isSettingKey(row.key)) result[row.key] = String(row.value);
  }
  return result;
}

export async function setSetting(actor: Actor, key: string, value: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (!isSettingKey(key)) throw new Error(`Nepoznat parametar "${key}".`);
  const before = await prisma.setting.findUnique({ where: { zevId_key: { zevId, key } } });
  const setting = await prisma.setting.upsert({
    where: { zevId_key: { zevId, key } },
    create: { zevId, key, value },
    update: { value },
  });
  await audit(actor, {
    action: "setting.update",
    targetType: "Setting",
    targetId: key,
    before: { value: before ? String(before.value) : null },
    after: { value },
  });
  return setting;
}

/**
 * Internal helper — no guard, since the tenant comes from the caller (a fresh Zev
 * being created, or the seed script), not from a session actor. Called both inside
 * createTenant()'s transaction and from prisma/seed.ts so both paths seed identically.
 */
export async function seedDefaultSettings(db: Prisma.TransactionClient, zevId: string) {
  await db.setting.createMany({
    data: SETTING_DEFINITIONS.map((d) => ({ zevId, key: d.key, value: d.def })),
  });
}
