// „Evidencije” (Plans/design-review-plan.md F7, X-R13): čitanje revizorskog traga i poslatih poruka za upravu.
// Oba pregleda su zevId-scoped i dostupna PRESIDENT + ACCOUNTANT; pisanje u AuditEvent ostaje samo kroz
// `audit()` (append-only). Straničenje je ovdje, a ne na stranici, da se ograničenje ne može zaobići upitom.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { requireRole, requireZev, type Actor } from "@/server/auth/guards";
import { actionsMatchingQuery } from "@/lib/activity/catalog";
import { listZevMembersWithPartyLabel } from "@/server/services/activity";

/** Red revizorskog traga na telefonu zauzima ~100px (radnja, ko/kada, „Detalji”), pa 20 redova drži stranicu oko
 *  3.000px na 375 (izlazni kriterijum F7); isto straničenje važi i na desktopu radi jednostavnosti. */
export const AUDIT_PAGE_SIZE = 20;
export const MESSAGES_PAGE_SIZE = 25;

export const MESSAGE_STATUSES = ["QUEUED", "SENT", "DELIVERED", "SEEN", "FAILED"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export type ListAuditTrailInput = {
  from?: Date;
  to?: Date; // već pomjeren na kraj dana (endOfDay)
  actorUserId?: string;
  q?: string;
  page?: number;
};

export async function listAuditTrail(actor: Actor, input: ListAuditTrailInput = {}) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  // Događaji bez zevId (platformski / prije prijave) se namjerno ne prikazuju — nisu poslovanje ovog ZEV-a.
  const zevId = requireZev(actor);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const q = input.q?.trim();
  const where: Prisma.AuditEventWhereInput = {
    zevId,
    ...(input.from || input.to
      ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
      : {}),
    ...(input.actorUserId ? { actorId: input.actorUserId } : {}),
    ...(q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" } },
            { targetType: { contains: q, mode: "insensitive" } },
            { action: { in: actionsMatchingQuery(q) } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE }),
    prisma.auditEvent.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}

/** Članovi ovog ZEV-a za filter „Ko” i za ime u redu (uprava, ne samo predsjednik). */
export async function listAuditActors(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return listZevMembersWithPartyLabel(requireZev(actor));
}

export type ListMessagesInput = { q?: string; status?: string; page?: number };

export async function listSentMessages(actor: Actor, input: ListMessagesInput = {}) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  // Poruke bez zevId (npr. reset lozinke) se namjerno ne prikazuju — vidi docs/multitenancy-plan.md.
  const zevId = requireZev(actor);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const q = input.q?.trim();
  const status = (MESSAGE_STATUSES as readonly string[]).includes(input.status ?? "") ? (input.status as MessageStatus) : undefined;
  const where: Prisma.NotificationMessageWhereInput = {
    zevId,
    ...(status ? { status } : {}),
    ...(q ? { toAddress: { contains: q, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.notificationMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * MESSAGES_PAGE_SIZE,
      take: MESSAGES_PAGE_SIZE,
    }),
    prisma.notificationMessage.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / MESSAGES_PAGE_SIZE)) };
}
