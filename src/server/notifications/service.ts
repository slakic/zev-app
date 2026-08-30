// Outbox-based notification service. Messages are stored first (QUEUED), then
// handed to the provider; provider events are appended to the message record.
// PRIVACY: notification bodies must never contain balances, debts or other
// sensitive personal data — they link to an authenticated page instead.
import { prisma } from "@/lib/prisma";
import { getEmailProvider, getViberProvider, type DeliveryEvent } from "./providers";
import type { NotifChannel, Prisma } from "@/generated/prisma/client";

export async function queueNotification(input: {
  channel: NotifChannel;
  recipientId?: string | null;
  toAddress: string;
  template?: string | null;
  subject?: string | null;
  body: string;
  relatedType?: string | null;
  relatedId?: string | null;
}) {
  const msg = await prisma.notificationMessage.create({
    data: {
      channel: input.channel,
      recipientId: input.recipientId ?? null,
      toAddress: input.toAddress,
      template: input.template ?? null,
      subject: input.subject ?? null,
      body: input.body,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      events: [{ at: new Date().toISOString(), type: "queued" }] as unknown as Prisma.InputJsonValue,
    },
  });
  // MVP: dispatch immediately (mock providers). A real deployment would use a
  // worker with retry/backoff — retry handling is modelled via attempts/events.
  await dispatchNotification(msg.id);
  return prisma.notificationMessage.findUniqueOrThrow({ where: { id: msg.id } });
}

export async function dispatchNotification(id: string) {
  const msg = await prisma.notificationMessage.findUniqueOrThrow({ where: { id } });
  if (msg.status !== "QUEUED" && msg.status !== "FAILED") return msg;
  const prior = (msg.events as unknown as DeliveryEvent[] | null) ?? [];
  try {
    let events: DeliveryEvent[];
    let ok: boolean;
    if (msg.channel === "EMAIL") {
      const res = await getEmailProvider().send({
        to: msg.toAddress,
        subject: msg.subject ?? "",
        body: msg.body,
      });
      events = res.events;
      ok = res.ok;
    } else {
      const res = await getViberProvider().sendDirect({
        subscriberId: msg.toAddress,
        text: msg.body,
      });
      events = res.events;
      ok = res.ok;
    }
    const all = [...prior, ...events];
    const seen = all.some((e) => e.type === "seen");
    const delivered = all.some((e) => e.type === "delivered");
    return prisma.notificationMessage.update({
      where: { id },
      data: {
        status: ok ? (seen ? "SEEN" : delivered ? "DELIVERED" : "SENT") : "FAILED",
        attempts: { increment: 1 },
        sentAt: ok ? new Date() : undefined,
        events: all as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    return prisma.notificationMessage.update({
      where: { id },
      data: {
        status: "FAILED",
        attempts: { increment: 1 },
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

/** Broadcast to all opted-in Viber subscribers (e.g. meeting announcement). */
export async function viberBroadcast(text: string, relatedType?: string, relatedId?: string) {
  const subs = await prisma.viberSubscriber.findMany({ where: { optIn: true } });
  const out = [];
  for (const s of subs) {
    out.push(
      await queueNotification({
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
