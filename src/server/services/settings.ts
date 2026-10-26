// Tenant-scoped legal/financial configuration (Setting model). See
// src/lib/settings-defaults.ts for the 8 known keys and their default values —
// this is the only place that should touch prisma.setting directly; pages go
// through getSettings/setSetting like every other tenant-scoped read/write.
import { prisma } from "@/lib/prisma";
import { requireAnyUser, requireRole, requireZev, type Actor } from "@/server/auth/guards";
import { audit } from "@/server/audit";
import { DEFAULT_SETTINGS, SETTING_DEFINITIONS, isSettingKey, type SettingKey } from "@/lib/settings-defaults";
import { diffSettings, type SettingChange, type SettingIssue } from "@/lib/settings-form";
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
    // Redovi uklonjenih parametara (npr. zatezna kamata) se ignorišu — ostaju u bazi, bez posljedica.
  }
  // Vrijednost ispod novog minimuma (npr. stari rok čuvanja od 30 dana) čita se kao minimum.
  const retention = SETTING_DEFINITIONS.find((d) => d.key === "retention.voteIpDays");
  const n = Number(result["retention.voteIpDays"]);
  if (retention?.min != null && Number.isInteger(n) && n < retention.min) result["retention.voteIpDays"] = String(retention.min);
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

export type SaveSettingsResult = { ok: true; changes: SettingChange[] } | { ok: false; issues: SettingIssue[] };

/**
 * Jedna forma „Parametri”: prima sve vrijednosti, provjerava ih (sve-ili-ništa) i upisuje SAMO one koje se razlikuju
 * od sačuvanih — jedan `setting.update` zapis u revizorskom tragu po stvarnoj izmjeni. Neispravan unos ne upisuje
 * ništa. Pravila parsiranja su u `src/lib/settings-form.ts`.
 */
export async function saveSettings(
  actor: Actor,
  submitted: Partial<Record<SettingKey, string | null | undefined>>,
): Promise<SaveSettingsResult> {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const current = await getSettings(actor);
  const diff = diffSettings(current, submitted);
  if (!diff.ok || diff.changes.length === 0) return diff;
  await prisma.$transaction(
    diff.changes.map((c) =>
      prisma.setting.upsert({
        where: { zevId_key: { zevId, key: c.key } },
        create: { zevId, key: c.key, value: c.after },
        update: { value: c.after },
      }),
    ),
  );
  for (const c of diff.changes) {
    await audit(actor, {
      action: "setting.update",
      targetType: "Setting",
      targetId: c.key,
      before: { value: c.before },
      after: { value: c.after },
    });
  }
  return diff;
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
