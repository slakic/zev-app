// Curated activity feed — action catalog (Plans/user-activity-log-plan.md §2, §4, §8 Faza 2).
//
// AuditEvent stays the single write-side source of truth (see src/server/audit.ts) — this
// module is a read-side classification/labelling layer on top of it, following the pattern
// already established by getEVoteConsentHistory (src/server/services/evoteConsent.ts).
import { t, tEnum } from "@/lib/i18n";

export const ACTIVITY_CATEGORIES = ["OWNER", "GOVERNANCE", "FINANCE", "SYSTEM"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

/** Categories shown on /aktivnosti by default (plan §2/§3) — FINANCE/SYSTEM are opt-in via
 *  the `kat` filter. /admin/aktivnosti (§9, Faza 3) defaults to all four instead. */
export const DEFAULT_ACTIVITY_CATEGORIES: ActivityCategory[] = ["OWNER", "GOVERNANCE"];

/**
 * Every `action` code ever passed to audit() must appear here exactly once — enforced by
 * tests/activity-catalog.test.ts, which statically scans src/server and src/app for every
 * `action: "..."` literal (plain and ternary forms) and fails on anything missing here or
 * anything here that no longer exists in source. Add a new action in the same change that
 * introduces it — that is the whole point of the exhaustiveness test (plan §2, "Test
 * iscrpnosti"): a forgotten classification fails loudly instead of the action silently never
 * appearing in the feed.
 *
 * Categorization follows plan §2 exactly, plus a handful of codes added to the app after the
 * plan was written (2026-09-09) — classified by the same reasoning the plan used for their
 * siblings: admin.* (cross-tenant account admin, v2.5.0) alongside admin.tenant.* as SYSTEM;
 * session.switch_zev (tenant switching, v2.4.0) as SYSTEM (platform/session mechanics, not a
 * business action); zev.create/zev.update (ZEV's own legal/registration details) as
 * GOVERNANCE, alongside the other organizational-record actions (office.*, party.create).
 */
export const ACTION_CATEGORY: Record<string, ActivityCategory> = {
  // ---- OWNER — ordinary owner activity (the actual point of this feature) ----
  "issue.report": "OWNER",
  "party.evote_consent.revoke": "OWNER",
  "party.update": "OWNER",
  "proxy.grant": "OWNER",
  "proxy.revoke": "OWNER",
  "document.download": "OWNER",
  "attachment.download": "OWNER",
  "vote.submit": "OWNER",

  // ---- GOVERNANCE — management/assembly actions of legitimate interest to owners ----
  "meeting.create": "GOVERNANCE",
  "meeting.status": "GOVERNANCE",
  "meeting.update": "GOVERNANCE",
  "agenda.add": "GOVERNANCE",
  "proposal.create": "GOVERNANCE",
  "proposal.revise": "GOVERNANCE",
  "proposal.update": "GOVERNANCE",
  "proposal.withdraw": "GOVERNANCE",
  "proposal.delete": "GOVERNANCE",
  "proposal.voting.open": "GOVERNANCE",
  "proposal.voting.close": "GOVERNANCE",
  "proposal.decision.record": "GOVERNANCE",
  "vote.manual_entry": "GOVERNANCE",
  "vote.correct": "GOVERNANCE",
  "attendance.record": "GOVERNANCE",
  "plan.create": "GOVERNANCE",
  "plan.revise": "GOVERNANCE",
  "plan.propose": "GOVERNANCE",
  "plan.approve": "GOVERNANCE",
  "plan.item.add": "GOVERNANCE",
  "issue.transition": "GOVERNANCE",
  "issue.emergency": "GOVERNANCE",
  "issue.emergency.ratify": "GOVERNANCE",
  "issue.offer.add": "GOVERNANCE",
  "issue.offer.select": "GOVERNANCE",
  "work_order.create": "GOVERNANCE",
  "work_order.complete": "GOVERNANCE",
  "document.generate": "GOVERNANCE",
  "document.publish": "GOVERNANCE",
  "attachment.upload": "GOVERNANCE",
  "party.evote_consent.request": "GOVERNANCE",
  "party.evote_consent.sign": "GOVERNANCE",
  "office.board_member.add": "GOVERNANCE",
  "office.board_member.end": "GOVERNANCE",
  "office.term.set": "GOVERNANCE",
  "ownership.stake.add": "GOVERNANCE",
  "ownership.transfer": "GOVERNANCE",
  "occupancy.create": "GOVERNANCE",
  "occupancy.end": "GOVERNANCE",
  "party.create": "GOVERNANCE",
  "zev.create": "GOVERNANCE",
  "zev.update": "GOVERNANCE",

  // ---- FINANCE — bookkeeping (real actor, but "what did this owner do" doesn't ask this) ----
  "account.create": "FINANCE",
  "allocation_group.create": "FINANCE",
  "balance.correction": "FINANCE",
  "charge_item.create": "FINANCE",
  "charge_item.update": "FINANCE",
  "expense.cancel": "FINANCE",
  "expense.create": "FINANCE",
  "expense.pay": "FINANCE",
  "expense.update": "FINANCE",
  "invoice.cancel": "FINANCE",
  "invoice.correct": "FINANCE",
  "invoice.issue": "FINANCE",
  "invoice_batch.create_draft": "FINANCE",
  "invoice_batch.issue": "FINANCE",
  "meter_reading.enter": "FINANCE",
  "payment.allocate": "FINANCE",
  "payment.allocation.reverse": "FINANCE",
  "payment.enter": "FINANCE",
  "payment.import_csv": "FINANCE",
  "payment.import_pdf": "FINANCE",
  "payment.reverse": "FINANCE",
  "project.create": "FINANCE",
  "report.export": "FINANCE",
  "supplier.create": "FINANCE",
  "transaction.cancel": "FINANCE",
  "transaction.enter": "FINANCE",

  // ---- SYSTEM — platform/technical (excluded from /aktivnosti by default; §9/Faza 3 for
  // /admin/aktivnosti, where this is exactly what a super admin wants to see) ----
  "admin.account.create": "SYSTEM",
  "admin.membership.grant": "SYSTEM",
  "admin.membership.grant_self": "SYSTEM",
  "admin.membership.revoke": "SYSTEM",
  "admin.tenant.activate": "SYSTEM",
  "admin.tenant.create": "SYSTEM",
  "admin.tenant.suspend": "SYSTEM",
  "approval_token.issue": "SYSTEM",
  "approval_token.lookup.expired": "SYSTEM",
  "approval_token.lookup.revoked": "SYSTEM",
  "approval_token.lookup.unknown": "SYSTEM",
  "approval_token.lookup.used": "SYSTEM",
  "approval_token.reissue": "SYSTEM",
  "approval_token.revoke": "SYSTEM",
  "approval_token.revoke.auto": "SYSTEM",
  "auth.login": "SYSTEM",
  "auth.login.deactivated": "SYSTEM",
  "auth.login.failed": "SYSTEM",
  "auth.login.rate_limited": "SYSTEM",
  "building.create": "SYSTEM",
  "building.update": "SYSTEM",
  "common_asset.create": "SYSTEM",
  "entrance.create": "SYSTEM",
  "password_reset.completed": "SYSTEM",
  "password_reset.rate_limited": "SYSTEM",
  "password_reset.requested": "SYSTEM",
  "password_reset.requested_unknown": "SYSTEM",
  "session.switch_zev": "SYSTEM",
  "setting.update": "SYSTEM",
  "unit.create": "SYSTEM",
  "unit.update": "SYSTEM",
  "user.activate": "SYSTEM",
  "user.create": "SYSTEM",
  "user.deactivate": "SYSTEM",
  "user.update_roles": "SYSTEM",
  "vote.verify.failed": "SYSTEM",
  "voting_rule.create": "SYSTEM",
};

export function categoryForAction(action: string): ActivityCategory {
  // An unclassified code (should never happen — see the exhaustiveness test) defaults to
  // SYSTEM, the category excluded by default everywhere, rather than risking a genuinely
  // sensitive new action showing up unreviewed under OWNER/GOVERNANCE.
  return ACTION_CATEGORY[action] ?? "SYSTEM";
}

export function actionsForCategories(categories: readonly ActivityCategory[]): string[] {
  const wanted = new Set(categories);
  return Object.entries(ACTION_CATEGORY)
    .filter(([, cat]) => wanted.has(cat))
    .map(([action]) => action);
}

/**
 * "issue.emergency" is both an action of its own (starting the emergency-repair path, no
 * prior approval) and the dot-prefix of "issue.emergency.ratify" (the board's follow-up
 * ratification). The generic tEnum()/t() dot-path lookup below can't hold a string AND a
 * nested object at the same dictionary key, so this one label is hard-coded here instead of
 * living in src/lib/i18n/sr-Latn.ts alongside the rest — "issue.emergency.ratify" has no such
 * collision and is a normal dictionary entry.
 */
const ACTION_LABEL_OVERRIDE: Record<string, string> = {
  "issue.emergency": "Pokrenuta hitna intervencija (bez prethodnog odobrenja)",
};

/**
 * Human label for an action code, with an explicit "did this actually translate" flag —
 * t()/tEnum() silently fall back to returning the lookup key itself when a translation is
 * missing, which for a dotted action code would render as the ugly, untranslated
 * `auditAction.foo.bar` unless the caller catches that case (plan §4, "Fallback ponašanje").
 * The UI (src/app/(app)/aktivnosti/page.tsx) uses `translated` to fall back to the same
 * muted/monospace treatment the old raw audit page already used for unrecognized codes,
 * showing the bare action code — never a blank, never the dotted i18n key.
 */
export function labelForAction(action: string): { label: string; translated: boolean } {
  const override = ACTION_LABEL_OVERRIDE[action];
  if (override) return { label: override, translated: true };
  const fullKey = `auditAction.${action}`;
  const resolved = tEnum("auditAction", action);
  if (resolved === fullKey) return { label: action, translated: false };
  return { label: resolved, translated: true };
}

export function categoryLabel(category: ActivityCategory): string {
  return t(`activityCategory.${category}`);
}

type SummaryEvent = { action: string; before: unknown; after: unknown };

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Optional one-line summary layered on top of the label, e.g. "Prijavio/la kvar" → "Prijavio/la
 * kvar — Curi voda u podrumu". Only a handful of actions have one (plan §4) — everything else
 * shows just the label, never a raw JSON dump of `after` (that's exactly the exposure §1 of
 * the plan documents, e.g. an e-mail address sitting in party.evote_consent.request's payload).
 */
export function summarize(event: SummaryEvent): string | null {
  const before = asRecord(event.before);
  const after = asRecord(event.after);
  switch (event.action) {
    case "issue.report":
    case "document.publish":
      return typeof after.title === "string" ? after.title : null;
    case "issue.transition": {
      const from = typeof before.status === "string" ? tEnum("issueStatus", before.status) : null;
      const to = typeof after.status === "string" ? tEnum("issueStatus", after.status) : null;
      return from && to ? `${from} → ${to}` : null;
    }
    default:
      return null;
  }
}
