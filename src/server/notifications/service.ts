// Outbox-based notification service. Messages are stored first (QUEUED), then
// handed to the provider; provider events are appended to the message record.
// PRIVACY: notification bodies must never contain balances, debts or other sensitive personal
// data — they link to an authenticated page instead. ONE deliberate exception
// (Plans/invoice-email-delivery-plan.md): "invoice-delivery*" messages attach the invoice PDF
// (attachmentDocumentId), and only for a Party that opted in (Party.invoiceEmailDelivery), sent
// to that Party's own Party.email, for an invoice where it is the debtor. Their body still
// carries no amounts or balances.
import { prisma } from "@/lib/prisma";
import { currentEmailProviderKind, describeEmailProvider, getEmailProvider, getViberProvider, type DeliveryEvent, type EmailAttachment } from "./providers";
import { buildFromName, isRecipientAllowed, loadEmailPlatformSettings } from "@/server/services/platformSettings";

/** Stored as lastError when the go-live allowlist (platform e-mail settings) blocks a recipient. */
export const ALLOWLIST_BLOCKED_ERROR = "Slanje na ovu adresu je privremeno isključeno (probni period pokretanja e-pošte).";
import type { NotifChannel, Prisma } from "@/generated/prisma/client";

/** Mailjet accepts up to 15 MB per message; an invoice PDF is tens of KB, so this is only a sanity cap. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type EnqueueInput = {
  channel: NotifChannel;
  /**
   * The tenant this notification belongs to. Pass it whenever the caller has one
   * (almost every caller does — see docs/multitenancy-plan.md §6.4 Modul 6). Left
   * optional only for account-level flows with no single tenant to attribute to —
   * e.g. a password-reset e-mail, where the target user may hold memberships in
   * several ZEVs or none. `NotificationMessage.zevId` is a genuinely nullable
   * column (confirmed with the user, §6.4 end-of-Korak-5 addendum) for exactly
   * this case — omitting it here stores a real `NULL`, not a fallback tenant.
   */
  zevId?: string;
  recipientId?: string | null;
  toAddress: string;
  template?: string | null;
  subject?: string | null;
  body: string;
  relatedType?: string | null;
  relatedId?: string | null;
  /** Document.id whose PDF is attached at send time (EMAIL only). See the PRIVACY note above. */
  attachmentDocumentId?: string | null;
};

/** Stores the message in the outbox (QUEUED) WITHOUT sending it — the caller dispatches later.
 *  `db` lets the caller write it inside its own transaction (e.g. a ballot and its message together). */
export async function enqueueNotification(input: EnqueueInput, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.notificationMessage.create({
    data: {
      zevId: input.zevId ?? null,
      channel: input.channel,
      recipientId: input.recipientId ?? null,
      toAddress: input.toAddress,
      template: input.template ?? null,
      subject: input.subject ?? null,
      body: input.body,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      attachmentDocumentId: input.attachmentDocumentId ?? null,
      events: [{ at: new Date().toISOString(), type: "queued" }] as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function queueNotification(input: EnqueueInput) {
  const msg = await enqueueNotification(input);
  // MVP: dispatch immediately (mock providers). A real deployment would use a
  // worker with retry/backoff — retry handling is modelled via attempts/events.
  await dispatchNotification(msg.id);
  return prisma.notificationMessage.findUniqueOrThrow({ where: { id: msg.id } });
}

/** How long a dispatch may hold a message before another call may take it over (a crashed send). */
const DISPATCH_LEASE_MS = 2 * 60 * 1000;

export async function dispatchNotification(id: string) {
  const msg = await prisma.notificationMessage.findUniqueOrThrow({ where: { id } });
  if (msg.status !== "QUEUED" && msg.status !== "FAILED") return msg;
  // Atomic claim with a lease: only the call that takes `dispatchingAt` (free, or a lease older
  // than DISPATCH_LEASE_MS left by a crashed send) proceeds. Checking `attempts` alone was not
  // enough: a second call arriving after the first had claimed but before it finished still saw
  // QUEUED and sent the same message again (e.g. a double click on "Pošalji neposlate").
  // One attempt = +1, counted here instead of in the outcome updates below, which release the lease.
  const now = new Date();
  const claim = await prisma.notificationMessage.updateMany({
    where: {
      id,
      status: { in: ["QUEUED", "FAILED"] },
      OR: [{ dispatchingAt: null }, { dispatchingAt: { lt: new Date(now.getTime() - DISPATCH_LEASE_MS) } }],
    },
    data: { attempts: { increment: 1 }, dispatchingAt: now },
  });
  if (claim.count === 0) return prisma.notificationMessage.findUniqueOrThrow({ where: { id } });
  const prior = (msg.events as unknown as DeliveryEvent[] | null) ?? [];
  try {
    let events: DeliveryEvent[];
    let ok: boolean;
    let error: string | undefined;
    if (msg.channel === "EMAIL") {
      const settings = await loadEmailPlatformSettings();
      // Go-live safety (Plans/email-sender-name-and-test-email-plan.md, P3): while the super
      // admin's allowlist is non-empty, real e-mail reaches only those addresses. The mock
      // provider sends nothing anyway, so it is not restricted.
      if (currentEmailProviderKind() === "mailjet" && !isRecipientAllowed(msg.toAddress, settings.recipientAllowlist)) {
        return prisma.notificationMessage.update({
          where: { id },
          data: {
            status: "FAILED",
            dispatchingAt: null,
            lastError: ALLOWLIST_BLOCKED_ERROR,
            events: [...prior, { at: new Date().toISOString(), type: "failed", detail: "allowlist" }] as unknown as Prisma.InputJsonValue,
          },
        });
      }
      const base = settings.fromName ?? describeEmailProvider().defaultFromName;
      const zev = settings.appendZevName && msg.zevId
        ? await prisma.zev.findUnique({ where: { id: msg.zevId }, select: { shortName: true, legalName: true } })
        : null;
      let attachments: EmailAttachment[] | undefined;
      if (msg.attachmentDocumentId) {
        // The attachment must belong to the same tenant as the message (never trust the id alone).
        const doc = await prisma.document.findUnique({ where: { id: msg.attachmentDocumentId }, select: { zevId: true, number: true } });
        if (!doc || doc.zevId !== msg.zevId) throw new Error("Prilog poruke nije pronađen.");
        const blob = await prisma.documentBlob.findUnique({ where: { documentId: msg.attachmentDocumentId } });
        if (!blob) throw new Error("PDF fakture nije pronađen.");
        if (blob.data.length > MAX_ATTACHMENT_BYTES) throw new Error("Prilog je prevelik za slanje e-poštom.");
        attachments = [{ filename: `${doc.number}.pdf`, contentType: "application/pdf", content: Buffer.from(blob.data) }];
      }
      const res = await getEmailProvider().send({
        to: msg.toAddress,
        subject: msg.subject ?? "",
        body: msg.body,
        fromName: buildFromName(base, zev),
        attachments,
      });
      events = res.events;
      ok = res.ok;
      error = res.error;
    } else {
      const res = await getViberProvider().sendDirect({
        subscriberId: msg.toAddress,
        text: msg.body,
      });
      events = res.events;
      ok = res.ok;
      error = res.error;
    }
    const all = [...prior, ...events];
    const seen = all.some((e) => e.type === "seen");
    const delivered = all.some((e) => e.type === "delivered");
    return prisma.notificationMessage.update({
      where: { id },
      data: {
        status: ok ? (seen ? "SEEN" : delivered ? "DELIVERED" : "SENT") : "FAILED",
        dispatchingAt: null,
        sentAt: ok ? new Date() : undefined,
        // A provider that reports failure (rather than throwing) used to leave lastError empty,
        // so e.g. Mailjet's "sender not validated" was lost.
        lastError: ok ? null : (error ?? "Nepoznata greška provajdera."),
        events: all as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    return prisma.notificationMessage.update({
      where: { id },
      data: {
        status: "FAILED",
        dispatchingAt: null,
        lastError: e instanceof Error ? e.message : String(e),
        events: [...prior, { at: new Date().toISOString(), type: "failed", detail: String(e) }] as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export async function retryFailed() {
  const failed = await prisma.notificationMessage.findMany({ where: { status: "FAILED", attempts: { lt: 5 } } });
  for (const f of failed) {
    await prisma.notificationMessage.update({
      where: { id: f.id },
      data: {
        status: "QUEUED",
        events: [
          ...(((f.events as unknown as DeliveryEvent[]) ?? [])),
          { at: new Date().toISOString(), type: "retry" },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    await dispatchNotification(f.id);
  }
}

// ---- Viber subscriber management (opt-in boundary) ----

export async function setViberOptIn(partyId: string, viberId: string, optIn: boolean) {
  return prisma.viberSubscriber.upsert({
    where: { partyId },
    create: { partyId, viberId, optIn, optInAt: optIn ? new Date() : null, optOutAt: optIn ? null : new Date() },
    update: optIn
      ? { viberId, optIn: true, optInAt: new Date(), optOutAt: null }
      : { optIn: false, optOutAt: new Date() },
  });
}

/**
 * Broadcast to all opted-in Viber subscribers of one ZEV (e.g. meeting announcement).
 * ViberSubscriber has no zevId column of its own — scoped indirectly through its Party.
 * No caller exists yet (fixed for correctness/forward-compatibility, same as other
 * not-yet-wired functions touched elsewhere in Korak 5) — a real caller must pass the
 * zevId of the ZEV doing the broadcasting, never let it be inferred from subscriber data.
 */
export async function viberBroadcast(zevId: string, text: string, relatedType?: string, relatedId?: string) {
  const subs = await prisma.viberSubscriber.findMany({ where: { optIn: true, party: { zevId } } });
  const out = [];
  for (const s of subs) {
    out.push(
      await queueNotification({
        zevId,
        channel: "VIBER",
        recipientId: s.partyId,
        toAddress: s.viberId,
        body: text,
        relatedType,
        relatedId,
      })
    );
  }
  return out;
}
