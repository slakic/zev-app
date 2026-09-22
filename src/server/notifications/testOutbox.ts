// Test-only access to the plaintext voting links/codes that exist ONLY inside the
// notification outbox (NotificationMessage.body) — see
// Plans/skupstina-draft-management-and-test-outbox-plan.md, Dio B.
//
// SECURITY: NotificationMessage.body carries the exact bearer token + verification code
// a real voter would use to cast a binding vote (meetings.ts openVoting/reissueToken) —
// see the PRIVACY note at the top of ./service.ts. Reading it out loud is equivalent to
// reading someone else's login credentials. isTestOutboxEnabled() is a conjunction of two
// independent conditions, each of which defaults to CLOSED when unset or misconfigured.
// See the plan's §B.3 options table before changing this function.
//
// Deliberately does NOT check NODE_ENV, even though that looks like an obvious third
// layer of defense in depth. Verified fact (Dockerfile:27): this project's own Docker
// image — the one this test tooling is meant to run in — hard-codes NODE_ENV=production,
// identical to how Vercel also sets it for `next build`/`next start` in real production.
// The two environments this gate must tell apart are indistinguishable by NODE_ENV here;
// requiring NODE_ENV !== "production" would permanently disable this feature in the one
// place it's meant to work, while adding no real protection (real production is
// NODE_ENV=production too, so the check can never catch a genuine misconfiguration).
//
// listApprovalLinks()/extractApprovalSecrets() do NOT check the gate themselves — a
// script or Vitest/Playwright test calling this directly (out of band, never rendered to
// a browser) is fine without it, same as tests/helpers.ts already does today with its own
// copy of this regex. Anything that RENDERS this data to a human (a page, a log a person
// reads) MUST call isTestOutboxEnabled() first and refuse if it's false.
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/server/auth/tokens";
import type { TokenStatus } from "@/generated/prisma/client";

const APPROVAL_TEMPLATES = ["approval-link", "approval-link-reissue"];

/**
 * True only when BOTH of:
 *  - SHOW_TEST_LINKS is exactly "1" (strict equality — "true"/"yes"/"0" don't count)
 *  - EMAIL_PROVIDER is exactly "mock" (an allow-list, not a deny-list of "mailjet" —
 *    a future third real provider stays closed by default instead of accidentally open)
 */
export function isTestOutboxEnabled(): boolean {
  return (
    process.env.SHOW_TEST_LINKS === "1" &&
    (process.env.EMAIL_PROVIDER ?? "mock") === "mock"
  );
}

export type ApprovalSecrets = { token: string | null; link: string | null; code: string | null };

/** Pulls the plaintext token/link/verification code out of a queued notification body —
 *  the exact text meetings.ts's openVoting/reissueToken already write. Never re-derive or
 *  guess this format independently elsewhere; this is the one place that knows it. */
export function extractApprovalSecrets(body: string): ApprovalSecrets {
  const linkMatch = body.match(/(\S+\/glasanje\/(\S+))/);
  const codeMatch = body.match(/verifikacioni kod: (\d{6})/i);
  return {
    link: linkMatch?.[1] ?? null,
    token: linkMatch?.[2] ?? null,
    code: codeMatch?.[1] ?? null,
  };
}

export type ApprovalLinkRow = {
  id: string;
  toAddress: string;
  subject: string | null;
  template: string | null;
  status: string;
  createdAt: Date;
  /** Live ApprovalToken.status looked up by hashing the extracted plaintext token — the
   *  notification's own delivery status (sent/delivered) says nothing about whether the
   *  token itself has since been used, revoked or superseded by a reissue. null when no
   *  token could be extracted from the body at all. */
  tokenStatus: TokenStatus | null;
} & ApprovalSecrets;

/** Newest-first list of every approval-link outbox message (optionally scoped to one ZEV
 *  or one proposal), with the plaintext token/link/code already extracted and the
 *  token's current live status attached. */
export async function listApprovalLinks(opts?: { zevId?: string; proposalId?: string; limit?: number }): Promise<ApprovalLinkRow[]> {
  const messages = await prisma.notificationMessage.findMany({
    where: {
      template: { in: APPROVAL_TEMPLATES },
      zevId: opts?.zevId,
      relatedId: opts?.proposalId,
    },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 50,
  });
  const secrets = messages.map((m) => extractApprovalSecrets(m.body));
  const hashes = secrets.map((s) => (s.token ? sha256(s.token) : null)).filter((h): h is string => h !== null);
  const tokens = hashes.length
    ? await prisma.approvalToken.findMany({ where: { tokenHash: { in: hashes } }, select: { tokenHash: true, status: true } })
    : [];
  const statusByHash = new Map(tokens.map((t) => [t.tokenHash, t.status]));
  return messages.map((m, i) => ({
    id: m.id,
    toAddress: m.toAddress,
    subject: m.subject,
    template: m.template,
    status: m.status,
    createdAt: m.createdAt,
    tokenStatus: secrets[i].token ? (statusByHash.get(sha256(secrets[i].token!)) ?? null) : null,
    ...secrets[i],
  }));
}
