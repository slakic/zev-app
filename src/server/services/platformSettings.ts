// Platform-wide e-mail settings (PlatformSetting model), edited by a super admin in /admin —
// Plans/email-sender-name-and-test-email-plan.md, odluke P1 i P3:
//   - email.fromName          sender display name ("ZEV upravnik"); empty = MAILJET_FROM_NAME / default
//   - email.appendZevName     add " – {ZEV}" to the name for a ZEV's own messages
//   - email.recipientAllowlist  while non-empty, real (Mailjet) e-mail goes ONLY to these addresses
//                               or "@domain"s — the safe go-live period; empty = everyone
// loadEmailPlatformSettings() has no actor on purpose: the notification service reads it on every
// send, including system flows such as a password reset. Writes always go through the
// super-admin guarded adminUpdateEmailSettings().
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireSuperAdmin, type Actor } from "@/server/auth/guards";
import { describeEmailProvider, type EmailProviderInfo } from "@/server/notifications/providers";
import { sanitizeFromName } from "@/server/notifications/mailjetEmail";
import type { Prisma } from "@/generated/prisma/client";
export { buildFromName } from "@/lib/emailFromName";

const KEYS = {
  fromName: "email.fromName",
  appendZevName: "email.appendZevName",
  recipientAllowlist: "email.recipientAllowlist",
} as const;

export type EmailPlatformSettings = {
  /** null = not set (the provider falls back to MAILJET_FROM_NAME, then "ZEV upravnik"). */
  fromName: string | null;
  appendZevName: boolean;
  /** Lower-case exact addresses and "@domain" entries; empty = no restriction. */
  recipientAllowlist: string[];
};

export async function loadEmailPlatformSettings(): Promise<EmailPlatformSettings> {
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const fromName = get(KEYS.fromName);
  const append = get(KEYS.appendZevName);
  const list = get(KEYS.recipientAllowlist);
  return {
    fromName: typeof fromName === "string" && fromName.trim() ? fromName : null,
    appendZevName: typeof append === "boolean" ? append : true, // odluka P1: on by default
    recipientAllowlist: Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [],
  };
}

const emailSchema = z.email();

/** Parses the allowlist textarea: entries separated by commas, semicolons or whitespace/new
 *  lines; each one an exact address or "@domain.tld". Throws naming the first bad entry. */
export function parseRecipientAllowlist(raw: string): string[] {
  const entries = raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const e of entries) {
    const ok = e.startsWith("@") ? /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e) : emailSchema.safeParse(e).success;
    if (!ok) throw new Error(`Neispravna stavka liste dozvoljenih primalaca: „${e}". Unesite e-mail adresu ili @domen.`);
  }
  return [...new Set(entries)];
}

/** An empty list means no restriction. */
export function isRecipientAllowed(address: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const a = address.trim().toLowerCase();
  return allowlist.some((entry) => (entry.startsWith("@") ? a.endsWith(entry) : a === entry));
}

export type AdminEmailSettings = EmailPlatformSettings & {
  provider: EmailProviderInfo;
  /** The name a ZEV-less message (e.g. password reset) goes out with right now. */
  effectiveFromName: string;
};

export async function adminGetEmailSettings(actor: Actor): Promise<AdminEmailSettings> {
  requireSuperAdmin(actor);
  const settings = await loadEmailPlatformSettings();
  const provider = describeEmailProvider();
  return { ...settings, provider, effectiveFromName: settings.fromName ?? provider.defaultFromName };
}

export async function adminUpdateEmailSettings(
  actor: Actor,
  input: { fromName: string; appendZevName: boolean; recipientAllowlist: string }
) {
  requireSuperAdmin(actor);
  const fromName = sanitizeFromName(input.fromName);
  if (input.fromName.trim() && fromName.length < 2) throw new Error("Ime pošiljaoca je prekratko.");
  if (fromName.length > 60) throw new Error("Ime pošiljaoca može imati najviše 60 znakova.");
  const allowlist = parseRecipientAllowlist(input.recipientAllowlist);

  const before = await loadEmailPlatformSettings();
  const values: Record<string, Prisma.InputJsonValue> = {
    [KEYS.fromName]: fromName,
    [KEYS.appendZevName]: input.appendZevName,
    [KEYS.recipientAllowlist]: allowlist,
  };
  await prisma.$transaction(
    Object.entries(values).map(([key, value]) =>
      prisma.platformSetting.upsert({
        where: { key },
        create: { key, value, updatedById: actor.userId },
        update: { value, updatedById: actor.userId },
      })
    )
  );
  const after = await loadEmailPlatformSettings();
  await audit(actor, {
    action: "platform.email_settings.update",
    targetType: "PlatformSetting",
    targetId: "email",
    before,
    after,
  });
  return after;
}
