// Append-only audit trail. The AuditEvent table is protected by a DB trigger
// that rejects UPDATE and DELETE, so events cannot be tampered with.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "./auth/guards";

type Tx = Prisma.TransactionClient;

export type AuditInput = {
  action: string; // e.g. "vote.submit", "invoice.issue"
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipHash?: string | null;
  /**
   * Explicit tenant for anonymous-but-tenant-known flows (Plans/user-activity-log-plan.md
   * §7.1) — e.g. the public vote-submission token flow, which has no Actor at all but does
   * know the tenant from an already-validated row (the Proposal/EligibleVoter the token
   * resolved to). Only ever pass a zevId the caller independently verified this way — never
   * one taken from unvalidated caller input. Ignored when `actor` already carries a zevId.
   */
  zevId?: string | null;
  /**
   * Party.id this anonymous-actor event is actually about (e.g. who voted), for flows with
   * no User/Actor to derive an actorId from (Plans/user-activity-log-plan.md §7.1/§3).
   * AuditEvent has no dedicated column for this yet (see the plan's §8 Faza 4 — a real
   * `subjectPartyId` column is an optional later addition once query patterns justify the
   * migration); until then it is folded into the stored `after` payload as a reserved
   * `subjectPartyId` key, so it is still queryable and promotable without touching call
   * sites again later.
   */
  subjectPartyId?: string | null;
};

/**
 * SECURITY: never pass plaintext tokens, passwords or bank credentials in before/after.
 *
 * BUG FIXED HERE (found while removing the temporary default_zev_id() DB default at the
 * end of Korak 5): this function never set zevId on AuditEvent.create() at all, for any
 * call, anywhere — every audit event ever written since that column got its NOT NULL +
 * default (step 3) has silently fallen back to the DB default (whichever ZEV was
 * created first, platform-wide), regardless of which tenant's actor actually triggered
 * the event. That's not a "some rows are unscoped" gap — in a multi-tenant deployment
 * it would misattribute EVERY audit row that isn't tenant #1's to the wrong tenant, and
 * it silently undermined any zevId-filtered read of AuditEvent (e.g. evoteConsent.ts's
 * getEVoteConsentHistory) even for tenant #1's own events, since those rows were never
 * actually stamped on purpose — they just happened to match.
 *
 * Fixed by deriving zevId from the actor whenever the actor shape carries one (the
 * `Actor` branch below) — this fixes essentially every call site in the codebase for
 * free, since they already pass a full Actor. The `{userId, label}` shape (used at the
 * few moments — login, password-reset request/completion — where we know the user but
 * not yet a resolved "active ZEV for this session/request") and `null` (genuinely
 * anonymous/system events: rate-limiting an email that may not even exist, revoked/
 * expired/unknown token lookups) produce an explicit `zevId: null` here — confirmed
 * with the user (docs/multitenancy-plan.md §6.4, end-of-Korak-5 addendum) that
 * `AuditEvent.zevId` should be genuinely nullable for these, rather than leaning on any
 * fallback tenant.
 */
export async function audit(
  actor: Actor | { userId?: string; label?: string } | null,
  input: AuditInput,
  tx?: Tx
): Promise<void> {
  const db = tx ?? prisma;
  const actorId = actor && "userId" in actor ? actor.userId ?? null : null;
  const actorLabel =
    actor && "label" in actor && actor.label ? actor.label : actorId ? null : "system";
  // actor.zevId wins when present (the normal, actor-driven case); input.zevId is the
  // escape hatch for the handful of anonymous-but-tenant-known flows that have no Actor
  // at all (see AuditInput.zevId doc comment above).
  const zevId =
    actor && "zevId" in actor && actor.zevId != null
      ? actor.zevId
      : input.zevId !== undefined
        ? input.zevId
        : null;
  const after =
    input.subjectPartyId != null
      ? { ...(input.after as Record<string, unknown> | undefined), subjectPartyId: input.subjectPartyId }
      : input.after;
  await db.auditEvent.create({
    data: {
      zevId,
      actorId,
      actorLabel,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
      after: after === undefined ? undefined : (after as Prisma.InputJsonValue),
      reason: input.reason ?? null,
      ipHash: input.ipHash ?? null,
    },
  });
}
