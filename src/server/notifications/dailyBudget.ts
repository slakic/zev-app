// Zajednički dnevni limit slanja e-pošte i ograničeni dispečer (v2.44.0, Plans/glasacki-listic-po-sjednici-plan.md §3.5).
// Izdvojeno iz invoiceEmail.ts: fakture, glasački listići i pozivi na sjednicu troše ISTI dnevni limit
// (cijela platforma dijeli jedan Mailjet nalog), pa se broji sve poslato u zadnja 24 sata.
// `queueNotification` šalje odmah; poruke koje ovdje prolaze se samo UPISUJU u red (`enqueueNotification`),
// a slanje radi `dispatchQueued` — ograničeno brojem poruka, vremenom i dnevnim limitom.
import { prisma } from "@/lib/prisma";
import { currentEmailProviderKind, type DeliveryEvent } from "./providers";
import { dispatchNotification } from "./service";
import type { NotifStatus, Prisma } from "@/generated/prisma/client";

/** Meki dnevni limit (Mailjet besplatni plan = 200/dan za cijelu platformu); ostavlja rezervu za reset lozinke. */
export const EMAIL_DAILY_SOFT_LIMIT_DEFAULT = 180;
export const SENT_STATUSES: NotifStatus[] = ["SENT", "DELIVERED", "SEEN"];
/** Poslije toliko neuspjelih pokušaja poruka se više ne vraća u red ručno. */
export const MAX_ATTEMPTS = 5;

/**
 * Dnevni limit. Mailjet: `EMAIL_DAILY_SOFT_LIMIT` ili podrazumijevano 180. Probni (mock) provajder nema
 * limit, osim kad je `EMAIL_DAILY_SOFT_LIMIT` izričito postavljen (da se ponašanje može probati lokalno).
 * `override` (testovi) pobjeđuje sve.
 */
export function dailyLimit(override?: number): number {
  if (override !== undefined) return override;
  const explicit = Number(process.env.EMAIL_DAILY_SOFT_LIMIT) || 0;
  if (currentEmailProviderKind() === "mailjet") return explicit || EMAIL_DAILY_SOFT_LIMIT_DEFAULT;
  return explicit > 0 ? explicit : Infinity;
}

/** Koliko je e-poruka cijela platforma poslala u zadnja 24 sata. */
export async function sentInLast24h(): Promise<number> {
  return prisma.notificationMessage.count({
    where: { channel: "EMAIL", status: { in: SENT_STATUSES }, sentAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
}

/** Koliko poruka još stane u dnevni limit (`Infinity` kad limita nema). */
export async function remainingToday(override?: number): Promise<number> {
  const limit = dailyLimit(override);
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - (await sentInLast24h()));
}

export type DispatchResult = { attempted: number; sent: number; failed: number; pending: number; dailyLimitReached: boolean };

/**
 * Šalje poruke iz reda (`status = QUEUED`) koje zadovoljavaju `where`, najstarije prvo, do `max` poruka,
 * `budgetMs` milisekundi i dnevnog limita. `prepare` (opciono) se zove prije slanja svake poruke i može je
 * proglasiti neuspjelom (npr. PDF fakture nije generisan) tako da ne troši pokušaj slanja.
 */
export async function dispatchQueued(
  where: Prisma.NotificationMessageWhereInput,
  opts: {
    max: number;
    budgetMs: number;
    dailyLimit?: number;
    prepare?: (m: Prisma.NotificationMessageGetPayload<object>) => Promise<{ error: string } | void>;
  }
): Promise<DispatchResult> {
  const limit = dailyLimit(opts.dailyLimit);
  const queue = await prisma.notificationMessage.findMany({ where: { ...where, status: "QUEUED" }, orderBy: { createdAt: "asc" } });
  let sentToday = limit === Infinity ? 0 : await sentInLast24h();

  const started = Date.now();
  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let dailyLimitReached = false;
  for (const m of queue) {
    if (attempted >= opts.max || Date.now() - started >= opts.budgetMs) break;
    if (sentToday >= limit) {
      dailyLimitReached = true;
      break;
    }
    attempted++;
    if (opts.prepare) {
      const prep = await opts.prepare(m);
      if (prep && "error" in prep) {
        failed++;
        await prisma.notificationMessage.update({
          where: { id: m.id },
          data: {
            status: "FAILED",
            attempts: { increment: 1 },
            lastError: prep.error,
            events: [...(((m.events as unknown as DeliveryEvent[]) ?? [])), { at: new Date().toISOString(), type: "failed", detail: prep.error }] as unknown as Prisma.InputJsonValue,
          },
        });
        continue;
      }
    }
    const res = await dispatchNotification(m.id);
    if (SENT_STATUSES.includes(res.status)) {
      sent++;
      sentToday++;
    } else if (res.status === "FAILED") {
      failed++;
    }
  }
  const pending = await prisma.notificationMessage.count({ where: { ...where, status: "QUEUED" } });
  return { attempted, sent, failed, pending, dailyLimitReached };
}

/** Vraća neuspjele poruke (do `MAX_ATTEMPTS` pokušaja) iz opsega u red; ne šalje ih. Vraća koliko ih je vraćeno. */
export async function requeueFailed(where: Prisma.NotificationMessageWhereInput): Promise<number> {
  const failedMsgs = await prisma.notificationMessage.findMany({ where: { ...where, status: "FAILED", attempts: { lt: MAX_ATTEMPTS } } });
  for (const f of failedMsgs) {
    await prisma.notificationMessage.update({
      where: { id: f.id },
      data: {
        status: "QUEUED",
        events: [...(((f.events as unknown as DeliveryEvent[]) ?? [])), { at: new Date().toISOString(), type: "retry" }] as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return failedMsgs.length;
}
