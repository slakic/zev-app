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
};

/** SECURITY: never pass plaintext tokens, passwords or bank credentials in before/after. */
export async function audit(
  actor: Actor | { userId?: string; label?: string } | null,
  input: AuditInput,
  tx?: Tx
): Promise<void> {
  const db = tx ?? prisma;
  const actorId = actor && "userId" in actor ? actor.userId ?? null : null;
  const actorLabel =
    actor && "label" in actor && actor.label ? actor.label : actorId ? null : "system";
  await db.auditEvent.create({
    data: {
      actorId,
      actorLabel,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
      after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
      reason: input.reason ?? null,
      ipHash: input.ipHash ?? null,
    },
  });
}
