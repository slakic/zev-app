// Meetings, agendas, proposals and the secure electronic-approval workflow.
//
// Security model (see spec §8):
//  * one token per eligible voter per proposal version, stored only as SHA-256 hash
//  * identity confirmation via a separate one-time verification code (also hashed)
//  * tokens expire, can be revoked and reissued (reissue invalidates the old one)
//  * votes are immutable rows (DB trigger); corrections are separate rows
//  * every lifecycle event is audited
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireAnyUser, requireZev, ForbiddenError, type Actor } from "@/server/auth/guards";
import { generateToken, generateVerificationCode, sha256 } from "@/server/auth/tokens";
import { computeVoterWeight, computeVotingResult, serializeResult, type RuleSnapshot, type CountedVote } from "@/server/engines/voting";
import { ownersVotingBasis, boardVotingBasis, activeProxyFor, activeProxiesFor, partyDisplayName } from "./ownership";
import { unitsInScope } from "./property";
import { queueNotification } from "@/server/notifications/service";
import { dec, ZERO } from "@/lib/money";
import { getEnv } from "@/lib/env";
import type { MeetingStatus, MeetingType, MeetingBody, ScopeType, VoteChoice, VoteChannel, Prisma } from "@/generated/prisma/client";

const MEETING_FLOW: MeetingStatus[] = [
  "DRAFT", "SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT",
  "VOTING_OPEN", "VOTING_CLOSED", "RESULTS_REVIEW", "DECISION_RECORDED",
  "MINUTES_FINALIZED", "ARCHIVED",
];

export const ACK_TEXT =
  "Potvrđujem da sam lično izvršio/la ovo izjašnjavanje kao vlasnik ili ovlašćeni punomoćnik, " +
  "da sam pročitao/la prijedlog u cijelosti i da je moj izbor konačan. " +
  "Ovo elektronsko odobravanje evidentira se kao dokaz izjašnjavanja i nije kvalifikovani elektronski potpis.";

// ---- Meetings ----

export async function listMeetings(actor: Actor, body?: MeetingBody) {
  requireAnyUser(actor);
  return prisma.meeting.findMany({
    where: { zevId: requireZev(actor), body },
    include: { _count: { select: { proposals: true, agendaItems: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getMeeting(actor: Actor, id: string) {
  requireAnyUser(actor);
  return prisma.meeting.findUniqueOrThrow({
    where: { id, zevId: requireZev(actor) },
    include: {
      agendaItems: { orderBy: { order: "asc" }, include: { proposals: true } },
      proposals: { orderBy: { code: "asc" }, include: { votingRule: true } },
      attendances: { include: { party: true } },
      proxies: { include: { grantor: true, holder: true } },
    },
  });
}

/**
 * Single-query summary for the live-meeting screen (Plans/live-meeting-mode-plan.md §2.3,
 * §3) — deliberately narrow and cheap: `LiveRefresh` (Faza 3) polls this every ~10s, so it
 * must never grow with the number of proposals in the meeting. A voting result is computed
 * only for `opts.proposalId` (the one open agenda item), never for every proposal in the
 * meeting — that's the whole reason this exists instead of reusing `getMeeting` +
 * `computeProposalResult` in a loop.
 */
export async function getLiveMeetingState(actor: Actor, meetingId: string, opts?: { proposalId?: string }) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId, zevId },
    include: {
      agendaItems: { orderBy: { order: "asc" }, include: { proposals: { orderBy: { code: "asc" } } } },
    },
  });

  // Same source as openVoting's own eligible-voter basis (§3.2: "lista je lista glasača, ne
  // lista lica") — the roll-call and the voting base can never disagree about who counts.
  const isBoard = meeting.body === "BOARD";
  const basis = isBoard ? await boardVotingBasis(zevId) : await ownersVotingBasis(zevId);
  const ownerIds = basis.map((b) => b.ownerId);

  const [attendances, parties, proxiesByOwner] = await Promise.all([
    prisma.attendance.findMany({
      where: { meetingId },
      select: { partyId: true, present: true, viaProxyId: true },
    }),
    prisma.party.findMany({
      where: { zevId, id: { in: ownerIds } },
      select: { id: true, eVoteConsentStatus: true },
    }),
    // Batched, not per-owner (Faza 4, §3.2 "punomoćnik, inline") — this whole function is
    // polled every ~10s (Faza 3), so an N+1 here would defeat the point of getLiveMeetingState.
    // Board members don't hold proxies (openVoting skips proxy lookup for isBoard too).
    isBoard ? Promise.resolve(new Map<string, { id: string; holderId: string; holderName: string }>()) : activeProxiesFor(zevId, ownerIds, meetingId),
  ]);
  const attendanceByOwner = new Map(attendances.map((a) => [a.partyId, a]));
  const consentByOwner = new Map(parties.map((p) => [p.id, p.eVoteConsentStatus]));

  const voters = basis.map((b) => {
    const att = attendanceByOwner.get(b.ownerId);
    const proxy = proxiesByOwner.get(b.ownerId) ?? null;
    return {
      ownerId: b.ownerId,
      ownerName: b.ownerName,
      // `marked` distinguishes "explicitly recorded absent" from "not prozivka'd yet" —
      // the roll-call screen's default "Neoznačeni" filter (§3.2) needs this, a plain
      // boolean `present` alone can't tell the two apart.
      marked: att !== undefined,
      present: att?.present ?? false,
      viaProxyId: att?.viaProxyId ?? null,
      eVoteConsentSigned: consentByOwner.get(b.ownerId) === "SIGNED",
      unitLabels: b.units.map((u) => u.label),
      // Already-granted proxy for this meeting, if any — shown inline as a third roll-call
      // option ("prisutan preko punomoćnika"); creating a new proxy from the phone stays out
      // of scope (P9).
      proxy: proxy ? { id: proxy.id, name: proxy.holderName } : null,
    };
  });
  const presentCount = voters.filter((v) => v.present).length;

  let activeResult = null;
  // Per-voter breakdown for the active proposal's tally screen (§3.4) — present/unvoted
  // (manual entry), electronic (read-only), no-channel (paper entry). Bounded by that one
  // proposal's own eligible-voter count, not the whole meeting, so this stays cheap even
  // though getLiveMeetingState is polled (Faza 3).
  let activeVoters: {
    eligibleVoterId: string; ownerId: string; ownerName: string; present: boolean;
    voted: boolean; channel: VoteChannel | null; deliveredVia: string | null;
    notifyStatus: string | null;
  }[] = [];
  if (opts?.proposalId) {
    const proposal = await prisma.proposal.findUniqueOrThrow({ where: { id: opts.proposalId, zevId } });
    if (proposal.status === "VOTING_OPEN" && proposal.ruleSnapshot) {
      activeResult = serializeResult(await computeProposalResult(zevId, opts.proposalId));
      const eligibleVoters = await prisma.eligibleVoter.findMany({
        where: { proposalId: opts.proposalId },
        include: {
          owner: true,
          proxy: true,
          tokens: { select: { deliveredVia: true }, take: 1 },
          // "Effective" vote only (§2.5 pattern, same as effectiveVotes()): a corrected-away
          // row has correctedBy set on itself and is excluded, leaving 0 or 1 current row.
          votes: { where: { invalid: false, correctedBy: null }, select: { channel: true }, take: 1 },
        },
      });
      // Delivery status per voter (Faza 4, §5 risk 3: "e-mail ne ode, a niko ne primijeti")
      // — one batched query keyed by the recipientId openVoting now stamps on each
      // NotificationMessage it queues, not a per-voter lookup (same "jedan set upita" rule
      // as the rest of this polled function).
      const recipientIds = eligibleVoters
        .filter((ev) => ev.tokens[0]?.deliveredVia === "EMAIL")
        .map((ev) => ev.proxyId ?? ev.ownerId);
      const notifyStatusByRecipient = recipientIds.length
        ? new Map(
            (
              await prisma.notificationMessage.findMany({
                where: { zevId, relatedType: "Proposal", relatedId: opts.proposalId, recipientId: { in: recipientIds } },
                select: { recipientId: true, status: true },
              })
            ).map((n) => [n.recipientId as string, n.status as string])
          )
        : new Map<string, string>();
      activeVoters = eligibleVoters.map((ev) => ({
        eligibleVoterId: ev.id,
        ownerId: ev.ownerId,
        ownerName: ev.proxy ? partyDisplayName(ev.proxy) : partyDisplayName(ev.owner),
        present: attendanceByOwner.get(ev.ownerId)?.present ?? false,
        voted: ev.votes.length > 0,
        channel: ev.votes[0]?.channel ?? null,
        deliveredVia: ev.tokens[0]?.deliveredVia ?? null,
        notifyStatus:
          ev.tokens[0]?.deliveredVia === "EMAIL" ? notifyStatusByRecipient.get(ev.proxyId ?? ev.ownerId) ?? null : null,
      }));
    }
  }

  return {
    meetingId: meeting.id,
    title: meeting.title,
    status: meeting.status,
    body: meeting.body,
    agendaItems: meeting.agendaItems.map((a) => ({
      id: a.id,
      order: a.order,
      title: a.title,
      note: a.note,
      proposals: a.proposals.map((p) => ({ id: p.id, code: p.code, title: p.title, status: p.status, text: p.text })),
    })),
    voters,
    presentCount,
    absentCount: voters.length - presentCount,
    totalCount: voters.length,
    activeProposalId: opts?.proposalId ?? null,
    activeVoters,
    activeResult,
  };
}

export async function createMeeting(
  actor: Actor,
  data: { title: string; type: MeetingType; body?: MeetingBody; location?: string | null; scheduledAt?: Date | null; eVoteOpensAt?: Date | null; eVoteClosesAt?: Date | null }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const m = await prisma.meeting.create({ data: { ...data, zevId, body: data.body ?? "ASSEMBLY" } });
  await audit(actor, { action: "meeting.create", targetType: "Meeting", targetId: m.id, after: { title: m.title, type: m.type, body: m.body } });
  return m;
}

export async function updateMeeting(actor: Actor, id: string, data: Prisma.MeetingUpdateInput) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const before = await prisma.meeting.findUniqueOrThrow({ where: { id, zevId } });
  if (["MINUTES_FINALIZED", "ARCHIVED"].includes(before.status) && data.status === undefined) {
    throw new ForbiddenError("Finalizovana sjednica se ne može mijenjati.");
  }
  const m = await prisma.meeting.update({ where: { id, zevId }, data });
  await audit(actor, { action: "meeting.update", targetType: "Meeting", targetId: id, before: { title: before.title, scheduledAt: before.scheduledAt }, after: { title: m.title, scheduledAt: m.scheduledAt } });
  return m;
}

export async function advanceMeetingStatus(actor: Actor, id: string, to: MeetingStatus, reason?: string) {
  // PRESIDENT + ACCOUNTANT (Plans/live-meeting-mode-plan.md §2.7, P7) — widened so the
  // live-meeting screen can advance a session to VOTING_OPEN without a desktop trip;
  // applies here too, not only from /uzivo, since this is the one shared function.
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id, zevId } });
  const fromIdx = MEETING_FLOW.indexOf(meeting.status);
  const toIdx = MEETING_FLOW.indexOf(to);
  if (toIdx < 0) throw new Error("Nepoznat status.");
  if (toIdx < fromIdx && !reason) {
    throw new Error("Vraćanje statusa unazad zahtijeva razlog (evidentira se u auditu).");
  }
  const m = await prisma.meeting.update({ where: { id, zevId }, data: { status: to } });
  await audit(actor, {
    action: "meeting.status", targetType: "Meeting", targetId: id,
    before: { status: meeting.status }, after: { status: to }, reason: reason ?? null,
  });
  return m;
}

export async function addAgendaItem(actor: Actor, data: { meetingId: string; title: string; note?: string | null }) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  // AgendaItem has no zevId column of its own (see prisma/schema.prisma) — tenant
  // is checked via its required parent Meeting before the write.
  await prisma.meeting.findUniqueOrThrow({ where: { id: data.meetingId, zevId } });
  const max = await prisma.agendaItem.aggregate({ where: { meetingId: data.meetingId }, _max: { order: true } });
  const item = await prisma.agendaItem.create({
    data: { meetingId: data.meetingId, title: data.title, note: data.note ?? null, order: (max._max.order ?? 0) + 1 },
  });
  await audit(actor, { action: "agenda.add", targetType: "AgendaItem", targetId: item.id, after: { title: item.title } });
  return item;
}

export async function recordAttendance(actor: Actor, data: { meetingId: string; partyId: string; present: boolean; viaProxyId?: string | null }) {
  // PRESIDENT + ACCOUNTANT — see advanceMeetingStatus above for rationale (§2.7, P7).
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  // Attendance has no zevId column of its own — tenant checked via its two
  // required parents (Meeting, Party) before the write.
  await prisma.meeting.findUniqueOrThrow({ where: { id: data.meetingId, zevId } });
  await prisma.party.findUniqueOrThrow({ where: { id: data.partyId, zevId } });
  const a = await prisma.attendance.upsert({
    where: { meetingId_partyId: { meetingId: data.meetingId, partyId: data.partyId } },
    create: data,
    update: { present: data.present, viaProxyId: data.viaProxyId ?? null },
  });
  await audit(actor, { action: "attendance.record", targetType: "Attendance", targetId: a.id, after: { partyId: data.partyId, present: data.present } });
  return a;
}

/**
 * Roll-call in bulk, for the live-meeting screen (Plans/live-meeting-mode-plan.md §3.2) —
 * same upsert semantics and same audit shape as recordAttendance above, one row and one
 * audit entry per person, all in a single transaction so a phone marking 20 owners at once
 * doesn't leave a partial roll-call behind if the connection drops mid-way.
 */
export async function recordAttendanceBulk(
  actor: Actor,
  data: { meetingId: string; entries: { partyId: string; present: boolean; viaProxyId?: string | null }[] }
) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  await prisma.meeting.findUniqueOrThrow({ where: { id: data.meetingId, zevId } });
  return prisma.$transaction(async (tx) => {
    const results = [];
    for (const entry of data.entries) {
      await tx.party.findUniqueOrThrow({ where: { id: entry.partyId, zevId } });
      const a = await tx.attendance.upsert({
        where: { meetingId_partyId: { meetingId: data.meetingId, partyId: entry.partyId } },
        create: { meetingId: data.meetingId, partyId: entry.partyId, present: entry.present, viaProxyId: entry.viaProxyId ?? null },
        update: { present: entry.present, viaProxyId: entry.viaProxyId ?? null },
      });
      await audit(actor, { action: "attendance.record", targetType: "Attendance", targetId: a.id, after: { partyId: entry.partyId, present: entry.present } }, tx);
      results.push(a);
    }
    return results;
  });
}

// ---- Voting rules ----

export async function listVotingRules(actor: Actor) {
  requireAnyUser(actor);
  return prisma.votingRule.findMany({ where: { zevId: requireZev(actor) }, orderBy: { name: "asc" } });
}

export async function createVotingRule(
  actor: Actor,
  data: {
    name: string;
    quorumType: "NONE" | "PERCENT_OF_TOTAL_WEIGHT" | "PERCENT_OF_OWNER_COUNT";
    quorumPercent?: string | null;
    majorityType: "SIMPLE_OF_VOTES_CAST" | "PERCENT_OF_VOTES_CAST" | "PERCENT_OF_ELIGIBLE_WEIGHT";
    majorityPercent?: string | null;
    weightMethod: "PER_OWNER" | "OWNERSHIP_SHARE" | "USABLE_AREA";
    note?: string | null;
  }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const r = await prisma.votingRule.create({ data: { ...data, zevId } });
  await audit(actor, { action: "voting_rule.create", targetType: "VotingRule", targetId: r.id, after: { name: r.name } });
  return r;
}

// ---- Proposals ----

export async function getProposal(actor: Actor, id: string) {
  requireAnyUser(actor);
  return prisma.proposal.findUniqueOrThrow({
    where: { id, zevId: requireZev(actor) },
    include: {
      meeting: true,
      votingRule: true,
      scopeUnits: { include: { unit: true } },
      attachments: true,
      eligibleVoters: { include: { owner: true, proxy: true, tokens: true, votes: true } },
      votes: { include: { voter: true, represented: true } },
    },
  });
}

/** Shared referential validation for a proposal's optional cross-references — extracted
 *  so createProposal and updateDraftProposal (which can edit these same fields before
 *  voting opens, Plans/skupstina-draft-management-and-test-outbox-plan.md §A.2) can't
 *  silently drift apart. `meetingId` is passed separately since an update never changes
 *  which meeting a proposal belongs to. */
async function assertProposalRefs(
  zevId: string,
  meetingId: string,
  data: { agendaItemId?: string | null; buildingId?: string | null; entranceId?: string | null; allocationGroupId?: string | null; unitIds?: string[] }
) {
  if (data.agendaItemId) {
    await prisma.agendaItem.findUniqueOrThrow({ where: { id: data.agendaItemId, meetingId } });
  }
  if (data.buildingId) await prisma.building.findUniqueOrThrow({ where: { id: data.buildingId, zevId } });
  if (data.entranceId) await prisma.entrance.findUniqueOrThrow({ where: { id: data.entranceId, zevId } });
  if (data.allocationGroupId) await prisma.allocationGroup.findUniqueOrThrow({ where: { id: data.allocationGroupId, zevId } });
  if (data.unitIds?.length) {
    const count = await prisma.unit.count({ where: { zevId, id: { in: data.unitIds } } });
    if (count !== new Set(data.unitIds).size) throw new Error("Jedna ili više jedinica ne pripadaju ovom ZEV-u.");
  }
}

export async function createProposal(
  actor: Actor,
  data: {
    meetingId: string;
    agendaItemId?: string | null;
    code: string;
    title: string;
    text: string;
    rationale?: string | null;
    financialImpact?: string | null;
    scopeType: ScopeType;
    buildingId?: string | null;
    entranceId?: string | null;
    allocationGroupId?: string | null;
    unitIds?: string[];
    votingRuleId: string;
    votingOpensAt?: Date | null;
    votingClosesAt?: Date | null;
  }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  await prisma.meeting.findUniqueOrThrow({ where: { id: data.meetingId, zevId } });
  await assertProposalRefs(zevId, data.meetingId, data);
  await prisma.votingRule.findUniqueOrThrow({ where: { id: data.votingRuleId, zevId } });
  const p = await prisma.proposal.create({
    data: {
      zevId,
      meetingId: data.meetingId,
      agendaItemId: data.agendaItemId ?? null,
      code: data.code,
      title: data.title,
      text: data.text,
      rationale: data.rationale ?? null,
      financialImpact: data.financialImpact ?? null,
      scopeType: data.scopeType,
      buildingId: data.buildingId ?? null,
      entranceId: data.entranceId ?? null,
      allocationGroupId: data.allocationGroupId ?? null,
      votingRuleId: data.votingRuleId,
      votingOpensAt: data.votingOpensAt ?? null,
      votingClosesAt: data.votingClosesAt ?? null,
      scopeUnits: data.unitIds?.length
        ? { create: data.unitIds.map((unitId) => ({ unitId })) }
        : undefined,
    },
  });
  await audit(actor, { action: "proposal.create", targetType: "Proposal", targetId: p.id, after: { code: p.code, title: p.title, version: p.version } });
  return p;
}

/** A nacrt (DRAFT) proposal has no content-hash, rule snapshot, eligible voters, tokens
 *  or votes yet (Plans/skupstina-draft-management-and-test-outbox-plan.md §A.1.4) — none
 *  of it has produced any legal effect, so every field createProposal accepts (short of
 *  the versioning/proof machinery: version, supersedesId, status, contentHash,
 *  ruleSnapshot, frozenAt, resultSummary, decisionNumber) is safe to edit here, including
 *  scope and code. Once VOTING_OPEN, editing goes through createProposalRevision instead
 *  (a new version, not an in-place edit) — the guard below is what enforces that split. */
export async function updateDraftProposal(
  actor: Actor,
  id: string,
  data: {
    code?: string;
    title?: string;
    text?: string;
    rationale?: string | null;
    financialImpact?: string | null;
    agendaItemId?: string | null;
    scopeType?: ScopeType;
    buildingId?: string | null;
    entranceId?: string | null;
    allocationGroupId?: string | null;
    unitIds?: string[];
    votingRuleId?: string;
    votingOpensAt?: Date | null;
    votingClosesAt?: Date | null;
  }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const before = await prisma.proposal.findUniqueOrThrow({ where: { id, zevId } });
  if (before.status !== "DRAFT") {
    throw new ForbiddenError(
      "Prijedlog je zamrznut — sadržaj se ne može mijenjati nakon otvaranja glasanja. Kreirajte novu verziju."
    );
  }
  await assertProposalRefs(zevId, before.meetingId, data);
  if (data.votingRuleId) await prisma.votingRule.findUniqueOrThrow({ where: { id: data.votingRuleId, zevId } });
  const { unitIds, ...rest } = data;
  const p = await prisma.$transaction(async (tx) => {
    const updated = await tx.proposal.update({ where: { id, zevId }, data: rest });
    // undefined = "not touched" (field omitted by the caller); a present array (even
    // empty) means "replace the scope with exactly this set" — distinguishing the two is
    // why this isn't just `data.unitIds ?? []`.
    if (unitIds !== undefined) {
      await tx.proposalUnit.deleteMany({ where: { proposalId: id } });
      const distinct = [...new Set(unitIds)];
      if (distinct.length) {
        await tx.proposalUnit.createMany({ data: distinct.map((unitId) => ({ proposalId: id, unitId })) });
      }
    }
    return updated;
  });
  await audit(actor, {
    action: "proposal.update",
    targetType: "Proposal",
    targetId: id,
    before: { code: before.code, title: before.title, scopeType: before.scopeType },
    after: { code: p.code, title: p.title, scopeType: p.scopeType },
  });
  return p;
}

/** Withdraws a DRAFT proposal (sets ProposalStatus.WITHDRAWN) — for a proposal the
 *  president no longer wants to pursue but that shouldn't vanish without a trace, e.g.
 *  because it's already visible to owners in the meeting's proposal list (getMeeting
 *  includes every proposal regardless of status, not just management-visible ones).
 *  Deliberately limited to DRAFT in this phase — withdrawing an already-VOTING_OPEN
 *  proposal is a harder decision (what happens to issued tokens and already-cast votes)
 *  and is out of scope here (Plans/skupstina-draft-management-and-test-outbox-plan.md
 *  §A.4.1, §A.9 risk 2). For "this was a mistake, make it disappear entirely" instead,
 *  see deleteDraftProposal below. */
export async function withdrawProposal(actor: Actor, id: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Povlačenje prijedloga zahtijeva razlog.");
  const before = await prisma.proposal.findUniqueOrThrow({ where: { id, zevId } });
  if (before.status !== "DRAFT") {
    throw new ForbiddenError("Samo nacrt prijedloga se može povući ovom radnjom.");
  }
  const p = await prisma.proposal.update({ where: { id, zevId }, data: { status: "WITHDRAWN" } });
  await audit(actor, {
    action: "proposal.withdraw",
    targetType: "Proposal",
    targetId: id,
    before: { status: before.status },
    after: { status: "WITHDRAWN" },
    reason,
  });
  return p;
}

/**
 * Permanently deletes a DRAFT proposal — referentially safe only while still a draft
 * (no EligibleVoter/ApprovalToken/Vote rows exist yet; those are created exclusively by
 * openVoting) and only while the meeting hasn't yet told owners anything about it.
 * `INVITATIONS_SENT` is the first point in MEETING_FLOW where the app itself notifies
 * owners about the meeting (skupstina/[id]/page.tsx's statusAction) — before that, the
 * agenda is internal preparation; after it, deleting a proposal silently would be
 * confusing for anyone who's already seen it. Past that point, withdrawProposal is the
 * only option. The audit write happens BEFORE the delete, in the same transaction, so
 * the append-only audit trail (DB trigger forbids UPDATE/DELETE on it) keeps a permanent
 * record of exactly what was deleted even though the Proposal row itself is gone —
 * that's what makes a hard delete acceptable in an otherwise append-only project (see
 * Plans/skupstina-draft-management-and-test-outbox-plan.md §A.3).
 */

/** Whether a DRAFT proposal on a meeting in `meetingStatus` is still eligible for a hard
 *  delete — exported so the UI can decide whether to show the "obriši" control at all
 *  instead of showing it and letting deleteDraftProposal reject it server-side. Kept as a
 *  pure function of the meeting's status (not the proposal's) so it can't drift from the
 *  guard actually enforced below. */
export function canDeleteDraftProposal(meetingStatus: MeetingStatus): boolean {
  return MEETING_FLOW.indexOf(meetingStatus) < MEETING_FLOW.indexOf("INVITATIONS_SENT");
}

export async function deleteDraftProposal(actor: Actor, id: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Brisanje prijedloga zahtijeva razlog.");
  const p = await prisma.proposal.findUniqueOrThrow({
    where: { id, zevId },
    include: { meeting: true, _count: { select: { eligibleVoters: true, votes: true } } },
  });
  if (p.status !== "DRAFT") {
    throw new ForbiddenError("Samo nacrt prijedloga se može trajno obrisati.");
  }
  if (!canDeleteDraftProposal(p.meeting.status)) {
    throw new ForbiddenError(
      "Sjednica je već saopštena vlasnicima — prijedlog se ne može obrisati, ali može biti povučen."
    );
  }
  // Structurally always true for a DRAFT proposal — belt and suspenders, not trusting
  // status alone for a permanent, irreversible write.
  if (p._count.eligibleVoters > 0 || p._count.votes > 0) {
    throw new ForbiddenError("Prijedlog ima evidentirane glasače ili glasove i ne može se obrisati.");
  }
  await prisma.$transaction(async (tx) => {
    await audit(actor, {
      action: "proposal.delete",
      targetType: "Proposal",
      targetId: id,
      before: {
        code: p.code,
        version: p.version,
        title: p.title,
        text: p.text,
        rationale: p.rationale,
        financialImpact: p.financialImpact?.toString() ?? null,
        scopeType: p.scopeType,
        status: p.status,
        meetingId: p.meetingId,
      },
      reason,
    }, tx);
    await tx.proposal.delete({ where: { id, zevId } });
  });
}

/**
 * Material change after voting opened: create a NEW proposal version and
 * invalidate every approval link of the old version.
 */
export async function createProposalRevision(
  actor: Actor,
  proposalId: string,
  changes: { title?: string; text?: string; rationale?: string | null },
  reason: string
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  return prisma.$transaction(async (tx) => {
    const old = await tx.proposal.findUniqueOrThrow({ where: { id: proposalId, zevId }, include: { scopeUnits: true } });
    if (old.status === "SUPERSEDED") throw new Error("Prijedlog je već zamijenjen novom verzijom.");
    // Invalidate all outstanding tokens of the old version.
    const voters = await tx.eligibleVoter.findMany({ where: { proposalId }, select: { id: true } });
    await tx.approvalToken.updateMany({
      where: { eligibleVoterId: { in: voters.map((v) => v.id) }, status: "ACTIVE" },
      data: { status: "SUPERSEDED", revokedAt: new Date(), revokedReason: `Nova verzija prijedloga: ${reason}` },
    });
    const superseded = await tx.proposal.update({ where: { id: proposalId, zevId }, data: { status: "SUPERSEDED" } });
    const next = await tx.proposal.create({
      data: {
        zevId,
        meetingId: old.meetingId,
        agendaItemId: old.agendaItemId,
        code: old.code,
        version: old.version + 1,
        supersedesId: old.id,
        title: changes.title ?? old.title,
        text: changes.text ?? old.text,
        rationale: changes.rationale === undefined ? old.rationale : changes.rationale,
        financialImpact: old.financialImpact,
        scopeType: old.scopeType,
        buildingId: old.buildingId,
        entranceId: old.entranceId,
        allocationGroupId: old.allocationGroupId,
        votingRuleId: old.votingRuleId,
        votingOpensAt: old.votingOpensAt,
        votingClosesAt: old.votingClosesAt,
        scopeUnits: old.scopeUnits.length
          ? { create: old.scopeUnits.map((su) => ({ unitId: su.unitId })) }
          : undefined,
      },
    });
    await audit(actor, {
      action: "proposal.revise",
      targetType: "Proposal",
      targetId: next.id,
      before: { proposalId: old.id, version: old.version, status: superseded.status },
      after: { version: next.version },
      reason,
    }, tx);
    return next;
  });
}

// ---- Opening voting: freeze + eligible base + tokens ----

function proposalContentHash(p: { text: string; title: string; version: number }, attachmentHashes: string[]): string {
  return sha256(JSON.stringify({ title: p.title, text: p.text, version: p.version, attachments: attachmentHashes.sort() }));
}

type DeliverySuppressReason = "PRESENT" | "NO_CONSENT" | "NO_EMAIL";

/**
 * Pure classification rule for live-meeting delivery (Plans/live-meeting-mode-plan.md
 * §2.1-§2.2) — shared between openVoting's "LIVE" branch (which writes tokens/suppresses
 * e-mail accordingly) and previewLiveDelivery below (read-only, shows the same three
 * numbers in the confirmation panel before the president commits). Kept as one function
 * specifically so the preview can never show a different answer than what actually happens
 * once voting opens — the whole point of previewing it at all.
 */
function classifyLiveDelivery(input: {
  ownerId: string;
  ownerEmail: string | null;
  proxyEmail: string | null;
  ownerConsentSigned: boolean;
  /** null when this owner has no proxy. */
  proxyConsentSigned: boolean | null;
  presentOwnerIds: Set<string>;
}): { deliver: boolean; suppressReason: DeliverySuppressReason | null } {
  if (input.presentOwnerIds.has(input.ownerId)) {
    // Korpa A — in the room, votes IN_PERSON via recordManualVote instead.
    return { deliver: false, suppressReason: "PRESENT" };
  }
  const recipientEmail = input.proxyEmail ?? input.ownerEmail;
  // P1: when a proxy represents the owner, BOTH must have signed e-vote consent — the
  // declaration is personal, not transferable.
  const consentOk =
    input.proxyConsentSigned !== null ? input.ownerConsentSigned && input.proxyConsentSigned : input.ownerConsentSigned;
  if (!recipientEmail) {
    // Korpa C — stays in the eligible base and in the quorum denominator; never silently
    // dropped just because there's no channel to reach them.
    return { deliver: false, suppressReason: "NO_EMAIL" };
  }
  if (!consentOk) return { deliver: false, suppressReason: "NO_CONSENT" };
  // Korpa B — absent, registered, has an e-mail — delivers as normal.
  return { deliver: true, suppressReason: null };
}

/**
 * Freeze the proposal and open electronic voting:
 *  1. snapshot the voting rule + eligible voting base
 *  2. hash the proposal content
 *  3. issue one hashed token + verification code per eligible voter
 * Returns delivery payloads (plaintext links + codes) exactly once, for delivery.
 */
export async function openVoting(
  actor: Actor,
  proposalId: string,
  opts?: {
    expiresAt?: Date;
    /** "ALL" (default) is today's behavior, bit for bit — every eligible owner gets an
     * e-mail. "LIVE" (Plans/live-meeting-mode-plan.md §2.1-§2.2) is the live-meeting
     * screen's mode: owners marked present in Attendance vote in the room instead, so
     * their e-mail is suppressed; everyone still gets an EligibleVoter + ApprovalToken
     * row either way (needed for reissueToken and for a uniform closeVoting), only
     * ApprovalToken.deliveredVia and whether queueNotification actually runs differ. */
    delivery?: "ALL" | "LIVE";
  }
) {
  // PRESIDENT + ACCOUNTANT — see advanceMeetingStatus above for rationale (§2.7, P7).
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const appUrl = getEnv().APP_URL;
  const delivery = opts?.delivery ?? "ALL";

  // Explicit timeout: this loops 3-4 sequential queries per eligible voter (proxy lookup,
  // EligibleVoter + ApprovalToken + audit writes) inside one interactive transaction.
  // Locally that's instant, but against a remote DB (e.g. Vercel -> Neon) each round-trip
  // carries real network latency, and Prisma's default 5s transaction timeout was hit with
  // a modest voter count during the first live trial deployment
  // (Plans/deployment-portability-plan.md §12 Faza 5) — not a local-only edge case.
  const deliveries = await prisma.$transaction(async (tx) => {
    const p = await tx.proposal.findUniqueOrThrow({
      where: { id: proposalId, zevId },
      include: { votingRule: true, scopeUnits: true, attachments: true, meeting: true },
    });
    if (p.status !== "DRAFT") throw new Error("Glasanje se može otvoriti samo iz statusa Nacrt.");
    if (!p.votingRule) throw new Error("Prijedlog nema definisano pravilo glasanja.");

    const closesAt = p.votingClosesAt ?? p.meeting.eVoteClosesAt;
    if (!closesAt) throw new Error("Vrijeme zatvaranja glasanja nije definisano.");
    const expiresAt = opts?.expiresAt ?? closesAt;

    // Board proposals vote by upravni odbor membership, not ownership; the
    // proposal's scopeType is not meaningful there, so skip unit scoping.
    const isBoard = p.meeting.body === "BOARD";
    const scopedUnits =
      isBoard || p.scopeType === "ZEV"
        ? undefined
        : (
            await unitsInScope(zevId, {
              scopeType: p.scopeType,
              buildingId: p.buildingId,
              entranceId: p.entranceId,
              allocationGroupId: p.allocationGroupId,
              unitIds: p.scopeUnits.map((s) => s.unitId),
            })
          ).map((u) => u.id);
    const basis = isBoard ? await boardVotingBasis(zevId) : await ownersVotingBasis(zevId, scopedUnits);
    if (basis.length === 0) {
      throw new Error(isBoard ? "Upravni odbor trenutno nema evidentiranih članova." : "Nema nijednog vlasnika u obuhvatu prijedloga.");
    }

    // Live-meeting suppression inputs (Plans/live-meeting-mode-plan.md §2.1-§2.2) — computed
    // once for the whole batch, not per voter. Untouched (both stay null) in "ALL" mode, so
    // the loop below falls through to today's behavior exactly.
    const presentOwnerIds =
      delivery === "LIVE"
        ? new Set(
            (
              await tx.attendance.findMany({
                where: { meetingId: p.meetingId, present: true },
                select: { partyId: true },
              })
            ).map((a) => a.partyId)
          )
        : null;
    const consentById =
      delivery === "LIVE"
        ? new Map(
            (
              await tx.party.findMany({
                where: { zevId, id: { in: [...new Set(basis.map((b) => b.ownerId))] } },
                select: { id: true, eVoteConsentStatus: true },
              })
            ).map((pt) => [pt.id, pt.eVoteConsentStatus])
          )
        : null;

    const weightMethod = p.votingRule.weightMethod;
    let totalWeight = ZERO;
    const voterRows: {
      ownerId: string; ownerName: string; email: string | null; weight: string;
      proxyId: string | null; proxyRecordId: string | null; proxyName: string | null; proxyEmail: string | null;
      /** Who the e-mail is actually addressed to (proxy if any, else the owner) — stamped
       *  onto NotificationMessage.recipientId below so Faza 4's per-voter delivery status
       *  (§5 risk 3) can look it up without guessing from a shared toAddress. */
      recipientPartyId: string;
      basis: unknown;
      /** Whether this voter's e-mail actually goes out. Always true in "ALL" mode. */
      deliver: boolean;
      /** Why delivery was suppressed, only set in "LIVE" mode. */
      suppressReason: DeliverySuppressReason | null;
    }[] = [];
    for (const b of basis) {
      const w = computeVoterWeight(weightMethod, b);
      totalWeight = totalWeight.plus(w);
      // Board members vote personally — no proxy voting in upravni odbor (assumption, see docs).
      const proxy = isBoard ? null : await activeProxyFor(zevId, b.ownerId, p.meetingId);

      let deliver = true;
      let suppressReason: DeliverySuppressReason | null = null;
      if (delivery === "LIVE") {
        const cls = classifyLiveDelivery({
          ownerId: b.ownerId,
          ownerEmail: b.email,
          proxyEmail: proxy?.holder.email ?? null,
          ownerConsentSigned: consentById!.get(b.ownerId) === "SIGNED",
          proxyConsentSigned: proxy ? proxy.holder.eVoteConsentStatus === "SIGNED" : null,
          presentOwnerIds: presentOwnerIds!,
        });
        deliver = cls.deliver;
        suppressReason = cls.suppressReason;
      }

      voterRows.push({
        ownerId: b.ownerId,
        ownerName: b.ownerName,
        email: b.email,
        weight: w.toFixed(6),
        proxyId: proxy?.holderId ?? null,
        proxyRecordId: proxy?.id ?? null,
        proxyName: proxy ? partyDisplayName(proxy.holder) : null,
        proxyEmail: proxy?.holder.email ?? null,
        recipientPartyId: proxy?.holderId ?? b.ownerId,
        basis: { units: b.units, ownershipShareSum: b.ownershipShareSum.toFixed(6), areaSum: b.areaSum.toFixed(6) },
        deliver,
        suppressReason,
      });
    }

    const ruleSnapshot: RuleSnapshot = {
      ruleName: p.votingRule.name,
      quorumType: p.votingRule.quorumType,
      quorumPercent: p.votingRule.quorumPercent?.toString() ?? null,
      majorityType: p.votingRule.majorityType,
      majorityPercent: p.votingRule.majorityPercent?.toString() ?? null,
      weightMethod,
      totalEligibleWeight: totalWeight.toFixed(6),
      totalEligibleOwners: basis.length,
    };
    const contentHash = proposalContentHash(p, p.attachments.map((a) => a.sha256 ?? ""));

    await tx.proposal.update({
      where: { id: p.id },
      data: {
        status: "VOTING_OPEN",
        frozenAt: new Date(),
        contentHash,
        ruleSnapshot: ruleSnapshot as unknown as Prisma.InputJsonValue,
        votingOpensAt: p.votingOpensAt ?? new Date(),
        votingClosesAt: closesAt,
      },
    });

    const out: {
      ownerName: string; email: string | null; link: string; verificationCode: string;
      tokenId: string; eligibleVoterId: string; viaProxy: string | null; deliver: boolean;
      recipientPartyId: string;
    }[] = [];
    for (const row of voterRows) {
      const ev = await tx.eligibleVoter.create({
        data: {
          proposalId: p.id,
          ownerId: row.ownerId,
          proxyId: row.proxyId,
          proxyRecordId: row.proxyRecordId,
          weight: row.weight,
          basis: row.basis as Prisma.InputJsonValue,
        },
      });
      const token = generateToken();
      const code = generateVerificationCode();
      const t = await tx.approvalToken.create({
        data: {
          eligibleVoterId: ev.id,
          tokenHash: sha256(token),
          verificationHash: sha256(code),
          expiresAt,
          // null (not "EMAIL") for a suppressed live-meeting recipient — nothing was
          // actually delivered to them (§2.2). The field is already nullable and this is
          // its only other value today, so no migration is needed.
          deliveredVia: row.deliver ? "EMAIL" : null,
        },
      });
      await audit(actor, {
        action: "approval_token.issue",
        targetType: "ApprovalToken",
        targetId: t.id,
        after: { eligibleVoterId: ev.id, proposalId: p.id, expiresAt: expiresAt.toISOString() },
      }, tx);
      out.push({
        ownerName: row.proxyName ?? row.ownerName,
        email: row.proxyEmail ?? row.email,
        link: `${appUrl}/glasanje/${token}`,
        verificationCode: code,
        tokenId: t.id,
        eligibleVoterId: ev.id,
        viaProxy: row.proxyName ? row.ownerName : null,
        deliver: row.deliver,
        recipientPartyId: row.recipientPartyId,
      });
    }

    // Suppression counts (§2.2) — captured in the audit trail so "why didn't this owner
    // get an e-mail" is answerable permanently, not just from the current Attendance state
    // (which can change after the fact).
    const deliveredCount = voterRows.filter((r) => r.deliver).length;
    const suppressedPresent = voterRows.filter((r) => r.suppressReason === "PRESENT").length;
    const suppressedNoConsent = voterRows.filter((r) => r.suppressReason === "NO_CONSENT").length;
    const suppressedNoEmail = voterRows.filter((r) => r.suppressReason === "NO_EMAIL").length;

    await audit(actor, {
      action: "proposal.voting.open",
      targetType: "Proposal",
      targetId: p.id,
      after: {
        contentHash, totalEligibleWeight: ruleSnapshot.totalEligibleWeight, voters: out.length,
        delivery, deliveredCount, suppressedPresent, suppressedNoConsent, suppressedNoEmail,
      },
    }, tx);
    return out;
  }, { timeout: 20000 });

  // Queue deliveries (outside the tx; mock providers in MVP).
  for (const d of deliveries) {
    if (d.email && d.deliver) {
      await queueNotification({
        zevId,
        // Faza 4 (§5 risk 3): recipientId lets getLiveMeetingState look up this message's
        // delivery status per voter, instead of guessing from a possibly-shared toAddress.
        recipientId: d.recipientPartyId,
        channel: "EMAIL",
        toAddress: d.email,
        template: "approval-link",
        subject: "Poziv na elektronsko izjašnjavanje",
        body:
          `Poštovani ${d.ownerName},\n\n` +
          (d.viaProxy ? `kao punomoćnik vlasnika ${d.viaProxy}, ` : "") +
          `pozvani ste da se izjasnite o prijedlogu skupštine ZEV.\n\n` +
          `Vaš lični link za izjašnjavanje: ${d.link}\n` +
          `Vaš verifikacioni kod: ${d.verificationCode}\n\n` +
          `Link je ličan i ne smije se prosljeđivati. Za potvrdu identiteta biće potreban verifikacioni kod.\n`,
        relatedType: "Proposal",
        relatedId: proposalId,
      });
    }
  }
  // link/verificationCode/deliver included from here on (Plans/live-meeting-mode-plan.md
  // §2.2): no existing caller captures this return value at all (checked — the desktop
  // action discards it), and a suppressed live-meeting recipient's link/code are otherwise
  // unrecoverable — they're never queued into a NotificationMessage, so the caller (the
  // live-meeting flow, later phases) needs them straight from here.
  return deliveries.map(({ ownerName, email, tokenId, eligibleVoterId, viaProxy, deliver, link, verificationCode }) => ({
    ownerName, email, tokenId, eligibleVoterId, viaProxy, deliver, link, verificationCode,
  }));
}

/**
 * Read-only preview of what `openVoting(actor, proposalId, { delivery: "LIVE" })` would do
 * — the three numbers shown in the `ConfirmAction` panel before that irreversible call
 * (Plans/live-meeting-mode-plan.md §2.1, §3.4): the single most valuable safety check in
 * the whole live-meeting feature, so it reuses `classifyLiveDelivery` above rather than
 * risking a second, possibly-diverging count. Creates nothing — the proposal stays DRAFT.
 * `quorumReachable` answers "if everyone in korpa A+B votes, is quorum even reachable" by
 * feeding synthetic full-weight votes through the same `computeVotingResult` a real, closed
 * vote uses — only its `quorumReached` flag is meaningful here, not the vote counts.
 */
export async function previewLiveDelivery(actor: Actor, proposalId: string) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const p = await prisma.proposal.findUniqueOrThrow({
    where: { id: proposalId, zevId },
    include: { votingRule: true, scopeUnits: true, meeting: true },
  });
  if (p.status !== "DRAFT") throw new Error("Pregled dostave ima smisla samo dok je prijedlog u statusu Nacrt.");
  if (!p.votingRule) throw new Error("Prijedlog nema definisano pravilo glasanja.");

  const isBoard = p.meeting.body === "BOARD";
  const scopedUnits =
    isBoard || p.scopeType === "ZEV"
      ? undefined
      : (
          await unitsInScope(zevId, {
            scopeType: p.scopeType,
            buildingId: p.buildingId,
            entranceId: p.entranceId,
            allocationGroupId: p.allocationGroupId,
            unitIds: p.scopeUnits.map((s) => s.unitId),
          })
        ).map((u) => u.id);
  const basis = isBoard ? await boardVotingBasis(zevId) : await ownersVotingBasis(zevId, scopedUnits);
  if (basis.length === 0) {
    return { presentCount: 0, deliverCount: 0, noChannelCount: 0, totalEligibleWeight: "0", reachableWeight: "0", quorumReachable: false };
  }

  const presentOwnerIds = new Set(
    (await prisma.attendance.findMany({ where: { meetingId: p.meetingId, present: true }, select: { partyId: true } })).map(
      (a) => a.partyId
    )
  );
  const consentById = new Map(
    (
      await prisma.party.findMany({
        where: { zevId, id: { in: [...new Set(basis.map((b) => b.ownerId))] } },
        select: { id: true, eVoteConsentStatus: true },
      })
    ).map((pt) => [pt.id, pt.eVoteConsentStatus])
  );

  const weightMethod = p.votingRule.weightMethod;
  let totalWeight = ZERO;
  let reachableWeight = ZERO;
  let presentCount = 0;
  let deliverCount = 0;
  let noChannelCount = 0;
  const syntheticVotes: CountedVote[] = [];
  for (const b of basis) {
    const w = computeVoterWeight(weightMethod, b);
    totalWeight = totalWeight.plus(w);
    const proxy = isBoard ? null : await activeProxyFor(zevId, b.ownerId, p.meetingId);
    const cls = classifyLiveDelivery({
      ownerId: b.ownerId,
      ownerEmail: b.email,
      proxyEmail: proxy?.holder.email ?? null,
      ownerConsentSigned: consentById.get(b.ownerId) === "SIGNED",
      proxyConsentSigned: proxy ? proxy.holder.eVoteConsentStatus === "SIGNED" : null,
      presentOwnerIds,
    });
    if (cls.suppressReason === "PRESENT") {
      presentCount++;
      reachableWeight = reachableWeight.plus(w);
      syntheticVotes.push({ eligibleVoterId: b.ownerId, choice: "APPROVE", weight: w, countsForQuorum: true, invalid: false });
    } else if (cls.deliver) {
      deliverCount++;
      reachableWeight = reachableWeight.plus(w);
      syntheticVotes.push({ eligibleVoterId: b.ownerId, choice: "APPROVE", weight: w, countsForQuorum: true, invalid: false });
    } else {
      noChannelCount++;
    }
  }

  const ruleSnapshot: RuleSnapshot = {
    ruleName: p.votingRule.name,
    quorumType: p.votingRule.quorumType,
    quorumPercent: p.votingRule.quorumPercent?.toString() ?? null,
    majorityType: p.votingRule.majorityType,
    majorityPercent: p.votingRule.majorityPercent?.toString() ?? null,
    weightMethod,
    totalEligibleWeight: totalWeight.toFixed(6),
    totalEligibleOwners: basis.length,
  };
  const quorumReachable = computeVotingResult(ruleSnapshot, syntheticVotes).quorumReached;

  return {
    presentCount, deliverCount, noChannelCount,
    totalEligibleWeight: totalWeight.toFixed(6),
    reachableWeight: reachableWeight.toFixed(6),
    quorumReachable,
  };
}

// ---- Token lifecycle ----

export async function revokeToken(actor: Actor, tokenId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  // ApprovalToken has no zevId column of its own — tenant checked indirectly
  // through its eligible voter's proposal.
  const t = await prisma.approvalToken.findUniqueOrThrow({
    where: { id: tokenId },
    include: { eligibleVoter: { include: { proposal: true } } },
  });
  if (t.eligibleVoter.proposal.zevId !== zevId) throw new Error("Token nije pronađen.");
  if (t.status === "USED") throw new ForbiddenError("Iskorišten token se ne može opozvati.");
  const updated = await prisma.approvalToken.update({
    where: { id: tokenId },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason },
  });
  await audit(actor, { action: "approval_token.revoke", targetType: "ApprovalToken", targetId: tokenId, reason });
  return updated;
}

/** Reissue: revokes the old token and issues a new one for the same eligible voter. */
export async function reissueToken(actor: Actor, tokenId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const appUrl = getEnv().APP_URL;
  const result = await prisma.$transaction(async (tx) => {
    const old = await tx.approvalToken.findUniqueOrThrow({
      where: { id: tokenId },
      include: { eligibleVoter: { include: { owner: true, proxy: true, proposal: true } } },
    });
    if (old.eligibleVoter.proposal.zevId !== zevId) throw new Error("Token nije pronađen.");
    if (old.status === "USED") throw new ForbiddenError("Iskorišten token se ne može ponovo izdati.");
    await tx.approvalToken.update({
      where: { id: tokenId },
      data: { status: "SUPERSEDED", revokedAt: new Date(), revokedReason: reason },
    });
    const token = generateToken();
    const code = generateVerificationCode();
    const t = await tx.approvalToken.create({
      data: {
        eligibleVoterId: old.eligibleVoterId,
        tokenHash: sha256(token),
        verificationHash: sha256(code),
        expiresAt: old.expiresAt,
        deliveredVia: old.deliveredVia,
        replacedById: undefined,
      },
    });
    await tx.approvalToken.update({ where: { id: tokenId }, data: { replacedById: t.id } });
    await audit(actor, {
      action: "approval_token.reissue",
      targetType: "ApprovalToken",
      targetId: t.id,
      before: { oldTokenId: tokenId },
      reason,
    }, tx);
    const recipient = old.eligibleVoter.proxy ?? old.eligibleVoter.owner;
    return { link: `${appUrl}/glasanje/${token}`, code, email: recipient.email, name: partyDisplayName(recipient), newTokenId: t.id };
  });
  if (result.email) {
    await queueNotification({
      zevId,
      channel: "EMAIL",
      toAddress: result.email,
      template: "approval-link-reissue",
      subject: "Novi link za elektronsko izjašnjavanje",
      body: `Poštovani ${result.name},\n\nizdat je novi lični link: ${result.link}\nNovi verifikacioni kod: ${result.code}\nPrethodni link je poništen.\n`,
      relatedType: "ApprovalToken",
      relatedId: result.newTokenId,
    });
  }
  return { newTokenId: result.newTokenId };
}

// ---- Public voting flow (token bearer) ----

const verifyAttempts = new Map<string, { count: number; first: number }>();
function rateLimitVerify(key: string): boolean {
  const now = Date.now();
  const e = verifyAttempts.get(key);
  if (!e || now - e.first > 15 * 60 * 1000) {
    verifyAttempts.set(key, { count: 1, first: now });
    return true;
  }
  e.count += 1;
  return e.count <= 20;
}

/** Rate-limit key: per source IP when known, otherwise per token value. */
function verifyKey(tokenPlain: string, ipHash?: string | null): string {
  return ipHash ?? `tok:${sha256(tokenPlain).slice(0, 16)}`;
}

/** Look up a token by plaintext value. Never returns the token itself. */
export async function inspectApprovalToken(tokenPlain: string, ipHash?: string | null) {
  if (!rateLimitVerify(verifyKey(tokenPlain, ipHash))) {
    return { ok: false as const, error: "rate_limited" as const };
  }
  const tokenHash = sha256(tokenPlain);
  const t = await prisma.approvalToken.findUnique({
    where: { tokenHash },
    include: {
      eligibleVoter: {
        include: {
          owner: true,
          proxy: true,
          proposal: { include: { meeting: true, attachments: true, zev: { select: { legalName: true, shortName: true } } } },
        },
      },
      vote: true,
    },
  });
  if (!t) {
    await audit(null, { action: "approval_token.lookup.unknown", targetType: "ApprovalToken", ipHash });
    return { ok: false as const, error: "not_found" as const };
  }
  if (t.status === "REVOKED" || t.status === "SUPERSEDED") {
    await audit(null, { action: "approval_token.lookup.revoked", targetType: "ApprovalToken", targetId: t.id, ipHash });
    return { ok: false as const, error: "revoked" as const };
  }
  if (t.status === "USED" || t.vote) {
    await audit(null, { action: "approval_token.lookup.used", targetType: "ApprovalToken", targetId: t.id, ipHash });
    return { ok: false as const, error: "used" as const };
  }
  if (t.expiresAt < new Date()) {
    if (t.status !== "EXPIRED") {
      await prisma.approvalToken.update({ where: { id: t.id }, data: { status: "EXPIRED" } });
    }
    await audit(null, { action: "approval_token.lookup.expired", targetType: "ApprovalToken", targetId: t.id, ipHash });
    return { ok: false as const, error: "expired" as const };
  }
  const p = t.eligibleVoter.proposal;
  if (p.status !== "VOTING_OPEN") {
    return { ok: false as const, error: "voting_closed" as const };
  }
  if (p.votingClosesAt && p.votingClosesAt < new Date()) {
    return { ok: false as const, error: "voting_closed" as const };
  }
  if (!t.openedAt) {
    await prisma.approvalToken.update({ where: { id: t.id }, data: { openedAt: new Date() } });
  }
  return {
    ok: true as const,
    tokenId: t.id,
    proposal: {
      id: p.id,
      code: p.code,
      version: p.version,
      title: p.title,
      text: p.text,
      rationale: p.rationale,
      contentHash: p.contentHash,
      votingClosesAt: p.votingClosesAt,
      meetingTitle: p.meeting.title,
      zevName: p.zev.shortName ?? p.zev.legalName,
    },
    voter: {
      ownerName: partyDisplayName(t.eligibleVoter.owner),
      proxyName: t.eligibleVoter.proxy ? partyDisplayName(t.eligibleVoter.proxy) : null,
      weight: t.eligibleVoter.weight.toString(),
    },
    ackText: ACK_TEXT,
  };
}

/**
 * Submit a vote using an approval token + verification code.
 * Fully transactional: token consumption and vote creation are atomic;
 * a concurrent duplicate submission fails on the unique tokenId constraint.
 */
export async function submitVote(input: {
  tokenPlain: string;
  verificationCode: string;
  choice: VoteChoice;
  ipHash?: string | null;
  userAgent?: string | null;
}) {
  const rlKey = verifyKey(input.tokenPlain, input.ipHash);
  if (!rateLimitVerify(rlKey)) return { ok: false as const, error: "rate_limited" as const };
  const tokenHash = sha256(input.tokenPlain);

  try {
    const vote = await prisma.$transaction(async (tx) => {
      const t = await tx.approvalToken.findUnique({
        where: { tokenHash },
        include: {
          eligibleVoter: { include: { owner: true, proxy: true, proposal: true } },
          vote: true,
        },
      });
      if (!t) throw new VoteError("not_found");
      if (t.status === "REVOKED" || t.status === "SUPERSEDED") throw new VoteError("revoked");
      if (t.status === "USED" || t.vote) throw new VoteError("used");
      if (t.expiresAt < new Date()) throw new VoteError("expired");
      const p = t.eligibleVoter.proposal;
      if (p.status !== "VOTING_OPEN" || (p.votingClosesAt && p.votingClosesAt < new Date())) {
        throw new VoteError("voting_closed");
      }
      // Identity confirmation: verification code delivered separately from the link.
      if (sha256(input.verificationCode.trim()) !== t.verificationHash) {
        // Bookkeeping must survive the rollback of this transaction —
        // handled outside via BadCodeSignal.
        throw new BadCodeSignal(t.id, t.failedAttempts);
      }
      // Double-vote guard per authority: any prior valid vote for this eligible voter?
      const existing = await tx.vote.findFirst({
        where: { eligibleVoterId: t.eligibleVoterId, invalid: false, correctedBy: null },
      });
      if (existing) throw new VoteError("already_voted");

      const voterParty = t.eligibleVoter.proxy ?? t.eligibleVoter.owner;
      const vote = await tx.vote.create({
        data: {
          // No actor here (public token flow) — derive the tenant from the
          // proposal itself, never trust caller input.
          zevId: p.zevId,
          proposalId: p.id,
          proposalVersion: p.version,
          eligibleVoterId: t.eligibleVoterId,
          voterId: voterParty.id,
          representedId: t.eligibleVoter.proxy ? t.eligibleVoter.ownerId : null,
          proxyRecordId: t.eligibleVoter.proxyRecordId,
          choice: input.choice,
          channel: "ELECTRONIC",
          weight: t.eligibleVoter.weight,
          tokenId: t.id,
          proposalHash: p.contentHash ?? "",
          acknowledgementText: ACK_TEXT,
          ipHash: input.ipHash ?? null,
          userAgent: input.userAgent?.slice(0, 255) ?? null,
          issuedAt: t.issuedAt,
          openedAt: t.openedAt,
          confirmedAt: new Date(),
          deliveryChannel: t.deliveredVia,
        },
      });
      await tx.approvalToken.update({
        where: { id: t.id },
        data: { status: "USED", usedAt: new Date() },
      });
      await audit(null, {
        action: "vote.submit",
        targetType: "Vote",
        targetId: vote.id,
        // No Actor here (public token flow) — zevId/subjectPartyId are passed explicitly
        // instead, both already validated above (p.zevId from the resolved Proposal,
        // voterParty.id from the resolved EligibleVoter), never from caller input
        // (Plans/user-activity-log-plan.md §7.1).
        zevId: p.zevId,
        subjectPartyId: voterParty.id,
        after: {
          proposalId: p.id,
          proposalVersion: p.version,
          eligibleVoterId: t.eligibleVoterId,
          // choice is deliberately NOT recorded here (user decision P2, plan §6a/§7.1) —
          // a feed browsable by person is a different privacy exposure than the formal
          // vote list tied to a meeting record. The actual choice remains correctly
          // stored on Vote itself, above, for counting and the official result.
          weight: t.eligibleVoter.weight.toString(),
          tokenId: t.id, // token ID only — never the token value
          channel: "ELECTRONIC",
        },
        ipHash: input.ipHash,
      }, tx);
      return vote;
    });
    return {
      ok: true as const,
      receipt: {
        voteId: vote.id,
        submittedAt: vote.submittedAt,
        choice: vote.choice,
      },
    };
  } catch (e) {
    if (e instanceof BadCodeSignal) {
      // Persist the failed attempt (outside the rolled-back transaction).
      const updated = await prisma.approvalToken.update({
        where: { id: e.tokenId },
        data: { failedAttempts: { increment: 1 } },
      });
      await audit(null, {
        action: "vote.verify.failed", targetType: "ApprovalToken", targetId: e.tokenId, ipHash: input.ipHash,
      });
      if (updated.failedAttempts >= 5 && updated.status === "ACTIVE") {
        await prisma.approvalToken.update({
          where: { id: e.tokenId },
          data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "Previše neuspjelih pokušaja verifikacije" },
        });
        await audit(null, { action: "approval_token.revoke.auto", targetType: "ApprovalToken", targetId: e.tokenId, reason: "failed verification attempts" });
      }
      return { ok: false as const, error: "bad_code" as const };
    }
    if (e instanceof VoteError) return { ok: false as const, error: e.code };
    throw e;
  }
}

class BadCodeSignal extends Error {
  constructor(public tokenId: string, public failedAttempts: number) {
    super("bad_code");
  }
}

export class VoteError extends Error {
  constructor(public code:
    | "not_found" | "revoked" | "used" | "expired" | "voting_closed"
    | "bad_code" | "already_voted") {
    super(code);
  }
}

/** President records a paper/in-person vote received outside the electronic flow. */
export async function recordManualVote(
  actor: Actor,
  data: { eligibleVoterId: string; choice: VoteChoice; channel: Exclude<VoteChannel, "ELECTRONIC">; note?: string }
) {
  // PRESIDENT + ACCOUNTANT — see advanceMeetingStatus above for rationale (§2.7, P7).
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  return prisma.$transaction(async (tx) => {
    const ev = await tx.eligibleVoter.findUniqueOrThrow({
      where: { id: data.eligibleVoterId },
      include: { proposal: true, owner: true, proxy: true },
    });
    // EligibleVoter has no zevId column of its own — tenant checked indirectly
    // through its proposal.
    if (ev.proposal.zevId !== zevId) throw new Error("Birač nije pronađen.");
    if (ev.proposal.status !== "VOTING_OPEN") throw new Error("Glasanje nije otvoreno.");
    const existing = await tx.vote.findFirst({
      where: { eligibleVoterId: ev.id, invalid: false, correctedBy: null },
    });
    if (existing) throw new Error("Ovaj vlasnik se već izjasnio.");
    const voterParty = ev.proxy ?? ev.owner;
    const vote = await tx.vote.create({
      data: {
        zevId,
        proposalId: ev.proposalId,
        proposalVersion: ev.proposal.version,
        eligibleVoterId: ev.id,
        voterId: voterParty.id,
        representedId: ev.proxy ? ev.ownerId : null,
        proxyRecordId: ev.proxyRecordId,
        choice: data.choice,
        channel: data.channel,
        weight: ev.weight,
        proposalHash: ev.proposal.contentHash ?? "",
        acknowledgementText: `Glas evidentiran ručno (${data.channel}). ${data.note ?? ""}`.trim(),
        confirmedAt: new Date(),
      },
    });
    await audit(actor, {
      action: "vote.manual_entry",
      targetType: "Vote",
      targetId: vote.id,
      after: { eligibleVoterId: ev.id, choice: data.choice, channel: data.channel },
      reason: data.note ?? null,
    }, tx);
    return vote;
  });
}

/**
 * Bulk hand-raise entry, for the live-meeting "Svi preostali prisutni: Za" action
 * (Plans/live-meeting-mode-plan.md §3.4, Faza 4). Deliberately NOT one wrapping
 * transaction: it calls `recordManualVote` once per person — the only function that ever
 * writes a `Vote` row (§2.5, "nijedan glas se ne kreira novim kodom") — so the input stays
 * bulk while the evidence stays one row per person, exactly as the plan requires. A single
 * shared transaction would also mean one already-voted person (e.g. a race with an
 * electronic vote arriving between page load and this submit) aborts everyone else's vote
 * too; recording best-effort and reporting failures instead means the other 17 in the room
 * aren't held hostage by the 18th.
 */
export async function recordManualVoteBulk(
  actor: Actor,
  data: { eligibleVoterIds: string[]; choice: VoteChoice; channel: Exclude<VoteChannel, "ELECTRONIC">; note?: string }
) {
  const results: { eligibleVoterId: string; ok: boolean; error?: string }[] = [];
  for (const eligibleVoterId of data.eligibleVoterIds) {
    try {
      await recordManualVote(actor, { eligibleVoterId, choice: data.choice, channel: data.channel, note: data.note });
      results.push({ eligibleVoterId, ok: true });
    } catch (e) {
      results.push({ eligibleVoterId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/**
 * Correction of a submitted vote: append-only. The original row is untouched;
 * a new row references it with reason + authority; result computation uses the
 * correction instead of the original.
 */
export async function correctVote(
  actor: Actor,
  data: { voteId: string; choice: VoteChoice; reason: string; authority: string }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (!data.reason.trim() || !data.authority.trim()) {
    throw new Error("Ispravka glasa zahtijeva razlog i osnov (npr. odluku skupštine).");
  }
  return prisma.$transaction(async (tx) => {
    const original = await tx.vote.findUniqueOrThrow({ where: { id: data.voteId, zevId }, include: { correctedBy: true } });
    if (original.correctedBy) throw new Error("Glas je već ispravljen.");
    const correction = await tx.vote.create({
      data: {
        zevId,
        proposalId: original.proposalId,
        proposalVersion: original.proposalVersion,
        eligibleVoterId: original.eligibleVoterId,
        voterId: original.voterId,
        representedId: original.representedId,
        proxyRecordId: original.proxyRecordId,
        choice: data.choice,
        channel: original.channel,
        weight: original.weight,
        proposalHash: original.proposalHash,
        acknowledgementText: `ISPRAVKA glasa ${original.id}. Razlog: ${data.reason}. Osnov: ${data.authority}.`,
        confirmedAt: new Date(),
        correctionOfId: original.id,
        correctionReason: data.reason,
        correctionAuthority: data.authority,
      },
    });
    await audit(actor, {
      action: "vote.correct",
      targetType: "Vote",
      targetId: correction.id,
      before: { originalVoteId: original.id, choice: original.choice },
      after: { choice: data.choice },
      reason: data.reason,
    }, tx);
    return correction;
  });
}

// ---- Closing + results ----

export async function effectiveVotes(zevId: string, proposalId: string) {
  const votes = await prisma.vote.findMany({
    where: { zevId, proposalId },
    include: { correctedBy: true },
  });
  // A corrected vote is superseded by its correction row.
  return votes.filter((v) => !v.correctedBy);
}

export async function computeProposalResult(zevId: string, proposalId: string) {
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId, zevId } });
  if (!p.ruleSnapshot) throw new Error("Prijedlog nema snimak pravila (glasanje nije otvarano).");
  const rule = p.ruleSnapshot as unknown as RuleSnapshot;
  const votes = await effectiveVotes(zevId, proposalId);
  const counted = votes.map((v) => ({
    eligibleVoterId: v.eligibleVoterId,
    choice: v.choice,
    weight: dec(v.weight.toString()),
    countsForQuorum: v.countsForQuorum,
    invalid: v.invalid,
  }));
  return computeVotingResult(rule, counted);
}

export async function closeVoting(actor: Actor, proposalId: string) {
  // PRESIDENT + ACCOUNTANT — see advanceMeetingStatus above for rationale (§2.7, P7).
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const result = await computeProposalResult(zevId, proposalId);
  const serialized = serializeResult(result);
  const p = await prisma.$transaction(async (tx) => {
    const prop = await tx.proposal.findUniqueOrThrow({ where: { id: proposalId, zevId } });
    if (prop.status !== "VOTING_OPEN") throw new Error("Glasanje nije otvoreno.");
    // Expire unused tokens.
    const voters = await tx.eligibleVoter.findMany({ where: { proposalId }, select: { id: true } });
    await tx.approvalToken.updateMany({
      where: { eligibleVoterId: { in: voters.map((v) => v.id) }, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    const updated = await tx.proposal.update({
      where: { id: proposalId, zevId },
      data: {
        status: result.accepted ? "ACCEPTED" : "REJECTED",
        resultSummary: serialized as unknown as Prisma.InputJsonValue,
      },
    });
    await audit(actor, {
      action: "proposal.voting.close",
      targetType: "Proposal",
      targetId: proposalId,
      after: serialized,
    }, tx);
    return updated;
  });
  return { proposal: p, result: serialized };
}

export async function recordDecision(actor: Actor, proposalId: string, decisionNumber: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId, zevId } });
  if (p.status !== "ACCEPTED" && p.status !== "REJECTED") {
    throw new Error("Odluka se evidentira nakon zatvaranja glasanja.");
  }
  const updated = await prisma.proposal.update({ where: { id: proposalId, zevId }, data: { decisionNumber } });
  await audit(actor, {
    action: "proposal.decision.record", targetType: "Proposal", targetId: proposalId,
    after: { decisionNumber },
  });
  return updated;
}

// ---- Owner-facing queries ----

/** Proposals a given owner party may currently vote on (open + has unused token). */
export async function openProposalsForOwner(actor: Actor, partyId: string) {
  requireAnyUser(actor);
  const zevId = requireZev(actor);
  if (actor.partyId !== partyId && !actor.roles.some((r) => r === "PRESIDENT")) {
    throw new ForbiddenError();
  }
  return prisma.eligibleVoter.findMany({
    where: {
      OR: [{ ownerId: partyId }, { proxyId: partyId }],
      proposal: { zevId, status: "VOTING_OPEN" },
    },
    include: {
      proposal: { include: { meeting: true } },
      votes: { where: { invalid: false } },
      owner: true,
    },
  });
}

/** An owner's own voting history (their evidence only). */
export async function ownVotes(actor: Actor, partyId: string) {
  requireAnyUser(actor);
  const zevId = requireZev(actor);
  if (actor.partyId !== partyId) throw new ForbiddenError();
  return prisma.vote.findMany({
    where: { zevId, OR: [{ voterId: partyId }, { representedId: partyId }] },
    include: { proposal: true },
    orderBy: { submittedAt: "desc" },
  });
}
