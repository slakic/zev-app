// "Probna e-mail poruka" — Plans/email-sender-name-and-test-email-plan.md (R4, R5).
// A president/accountant (for their ZEV) or the super admin (platform level) sends a fixed,
// plain-text test message either to their own login address or to an address they type in.
// It goes through the normal outbox (queueNotification), so it shows in "Poslate poruke", obeys
// the go-live allowlist, and its provider error is returned to the UI verbatim.
// Abuse protection for the free-text address: the text cannot be changed, one recipient only,
// and a limit counted FROM THE DATABASE (in-memory limiters do not survive Vercel instances).
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireSuperAdmin, requireZev, type Actor } from "@/server/auth/guards";
import { getEnv } from "@/lib/env";
import { emailAddressSchema } from "@/lib/emailAddress";
import { formatDateTime, tEnum } from "@/lib/i18n";
import { queueNotification } from "@/server/notifications/service";
import { describeEmailProvider, type EmailProviderInfo, type EmailProviderKind } from "@/server/notifications/providers";
import { partyDisplayName } from "@/server/services/ownership";
import type { NotifStatus } from "@/generated/prisma/client";

export const TEST_EMAIL_TEMPLATE = "test-email";
export const TEST_EMAIL_PER_USER_HOUR = 5;
export const TEST_EMAIL_PER_ZEV_DAY = 20;
const HOUR = 3600_000;

export type TestEmailInput = { target: "self" } | { target: "address"; address: string };

export type TestEmailResult = {
  ok: boolean;
  provider: EmailProviderKind;
  /** Mock provider: written to the outbox, nothing actually left the app. */
  simulated: boolean;
  toAddress: string;
  status: NotifStatus;
  error: string | null;
  messageId: string;
};

export type TestEmailStatus = {
  provider: EmailProviderInfo;
  myEmail: string;
  usedLastHour: number;
  perHourLimit: number;
};

// ---- ZEV (president / accountant) ----

export async function getTestEmailStatus(actor: Actor): Promise<TestEmailStatus> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  requireZev(actor);
  return statusFor(actor);
}

export async function sendTestEmail(actor: Actor, input: TestEmailInput): Promise<TestEmailResult> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  return sendCore(actor, zevId, input);
}

// ---- Platform (super admin, no ZEV) ----

export async function adminGetTestEmailStatus(actor: Actor): Promise<TestEmailStatus> {
  requireSuperAdmin(actor);
  return statusFor(actor);
}

export async function adminSendTestEmail(actor: Actor, input: TestEmailInput): Promise<TestEmailResult> {
  requireSuperAdmin(actor);
  return sendCore(actor, null, input);
}

// ---- shared ----

async function statusFor(actor: Actor): Promise<TestEmailStatus> {
  const [user, usedLastHour] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } }),
    countSince({ relatedId: actor.userId }, HOUR),
  ]);
  return { provider: describeEmailProvider(), myEmail: user.email, usedLastHour, perHourLimit: TEST_EMAIL_PER_USER_HOUR };
}

function countSince(where: { relatedId?: string; zevId?: string }, ms: number) {
  return prisma.notificationMessage.count({
    where: { template: TEST_EMAIL_TEMPLATE, relatedType: "User", ...where, createdAt: { gt: new Date(Date.now() - ms) } },
  });
}

async function sendCore(actor: Actor, zevId: string | null, input: TestEmailInput): Promise<TestEmailResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } });
  let toAddress: string;
  if (input.target === "self") {
    toAddress = user.email; // from the database, never from the client (odluka P5)
  } else {
    const parsed = emailAddressSchema.safeParse(input.address ?? "");
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Unesite ispravnu e-mail adresu.");
    toAddress = parsed.data;
  }

  const [userCount, zevCount] = await Promise.all([
    countSince({ relatedId: actor.userId }, HOUR),
    zevId ? countSince({ zevId }, 24 * HOUR) : Promise.resolve(0),
  ]);
  if (userCount >= TEST_EMAIL_PER_USER_HOUR || zevCount >= TEST_EMAIL_PER_ZEV_DAY) {
    await audit(actor, {
      action: "notification.test_email.rate_limited",
      targetType: "User",
      targetId: actor.userId,
      after: { userCount, zevCount },
    });
    throw new Error(
      userCount >= TEST_EMAIL_PER_USER_HOUR
        ? `Dostignut je limit probnih poruka (${TEST_EMAIL_PER_USER_HOUR} na sat). Pokušajte ponovo kasnije.`
        : `Dostignut je dnevni limit probnih poruka za ovaj ZEV (${TEST_EMAIL_PER_ZEV_DAY}). Pokušajte sutra.`
    );
  }

  const { subject, body } = await buildTestEmail(actor, zevId);
  const provider = describeEmailProvider();
  const msg = await queueNotification({
    zevId: zevId ?? undefined,
    channel: "EMAIL",
    recipientId: input.target === "self" ? actor.partyId : null,
    toAddress,
    template: TEST_EMAIL_TEMPLATE,
    subject,
    body,
    relatedType: "User",
    relatedId: actor.userId,
  });
  const ok = msg.status !== "FAILED";
  await audit(actor, {
    action: "notification.test_email.send",
    targetType: "NotificationMessage",
    targetId: msg.id,
    after: { to: toAddress, target: input.target, provider: provider.kind, status: msg.status, error: msg.lastError },
  });
  return {
    ok,
    provider: provider.kind,
    simulated: provider.kind === "mock",
    toAddress,
    status: msg.status,
    error: ok ? null : msg.lastError,
    messageId: msg.id,
  };
}

/** R5: fixed plain-text body. No sender e-mail address and nothing financial in it — it may go to
 *  an address the sender typed in (and see the PRIVACY note in notifications/service.ts). */
export async function buildTestEmail(actor: Actor, zevId: string | null): Promise<{ subject: string; body: string }> {
  const [zev, party, user] = await Promise.all([
    zevId ? prisma.zev.findUnique({ where: { id: zevId }, select: { shortName: true, legalName: true } }) : null,
    actor.partyId ? prisma.party.findUnique({ where: { id: actor.partyId } }) : null,
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } }),
  ]);
  const who = party ? partyDisplayName(party) : user.email.split("@")[0];
  const role = zevId
    ? tEnum("roles", actor.roles.includes("PRESIDENT") ? "PRESIDENT" : "ACCOUNTANT")
    : "administrator platforme";
  const lines = [
    "Poštovani,",
    "",
    "ovo je probna poruka iz aplikacije ZEV upravnik. Poslata je da bi se provjerilo da slanje e-pošte radi ispravno.",
    "",
    ...(zev ? [`ZEV: ${zev.shortName?.trim() || zev.legalName}`] : []),
    `Poslao/la: ${who} (${role})`,
    `Vrijeme slanja: ${formatDateTime(new Date())}`,
    `Adresa aplikacije: ${getEnv().APP_URL}`,
    "",
    "Ako ste primili ovu poruku, slanje e-pošte radi. Nije potrebna nikakva radnja.",
    "Ako niste očekivali ovu poruku, slobodno je zanemarite.",
    "",
    "Ovo je automatska poruka. Molimo da na nju ne odgovarate.",
  ];
  return { subject: "Probna poruka — ZEV upravnik", body: lines.join("\n") };
}
