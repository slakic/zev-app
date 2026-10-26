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
import { computeVoterWeight, computeVotingResult, presenceQuorum, serializeResult, type RuleSnapshot, type CountedVote } from "@/server/engines/voting";
import { assemblyVotingSubjects, boardVotingBasis, unitOwnershipWarnings, activeProxyFor, activeProxiesFor, partyDisplayName, listOfficeHolders, type VotingSubject } from "./ownership";
import { unitsInScope } from "./property";
import { queueNotification, enqueueNotification } from "@/server/notifications/service";
import { dispatchQueued, requeueFailed, remainingToday, dailyLimit, SENT_STATUSES, type DispatchResult } from "@/server/notifications/dailyBudget";
import { dec, ZERO, formatWeight, type Decimal } from "@/lib/money";
import type { LiveQuorum } from "@/lib/liveQuorum";
import type { MeetingNextStepInput } from "@/lib/meetingNextStep";
import { getEnv } from "@/lib/env";
import { formatDateTime, t, tf } from "@/lib/i18n";
import type { MeetingStatus, MeetingType, MeetingBody, ScopeType, VoteChoice, VoteChannel, Prisma, Party, Proposal, EligibleVoter, ApprovalToken } from "@/generated/prisma/client";

const MEETING_FLOW: MeetingStatus[] = [
  "DRAFT", "SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT",
  "VOTING_OPEN", "VOTING_CLOSED", "RESULTS_REVIEW", "DECISION_RECORDED",
  "MINUTES_FINALIZED", "ARCHIVED",
];

export const ACK_TEXT =
  "Potvrđujem da sam lično izvršio/la ovo izjašnjavanje kao vlasnik ili ovlašćeni punomoćnik, " +
  "da sam pročitao/la prijedlog u cijelosti i da je moj izbor konačan. " +
  "Ovo elektronsko izjašnjavanje se evidentira kao izraz moje volje i koristi za pripremu dokumentacije sjednice; nije kvalifikovani elektronski potpis.";

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
  const zevId = requireZev(actor);
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id, zevId },
    include: {
      agendaItems: { orderBy: { order: "asc" }, include: { proposals: true } },
      proposals: { orderBy: { code: "asc" }, include: { votingRule: true } },
      attendances: { include: { party: true } },
      proxies: { include: { grantor: true, holder: true } },
    },
  });
  // F6.2: "glasalo X od Y" per proposal in two grouped queries (not one per proposal). A vote counts once: a
  // corrected original has `correctedBy` set and is left out, the correction row stands in for it.
  const counts = await proposalVoteCounts(zevId, meeting.proposals.map((p) => p.id));
  return {
    ...meeting,
    proposals: meeting.proposals.map((p) => ({ ...p, votersCount: counts.voters.get(p.id) ?? 0, votedCount: counts.voted.get(p.id) ?? 0 })),
  };
}

/** Voters and effective votes per proposal in two grouped queries (no N+1). */
async function proposalVoteCounts(zevId: string, proposalIds: string[]) {
  const [voterRows, voteRows] = proposalIds.length
    ? await Promise.all([
        prisma.eligibleVoter.groupBy({ by: ["proposalId"], where: { proposalId: { in: proposalIds } }, _count: { _all: true } }),
        prisma.vote.groupBy({
          by: ["proposalId"],
          where: { zevId, proposalId: { in: proposalIds }, invalid: false, correctedBy: null },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  return {
    voters: new Map(voterRows.map((r) => [r.proposalId, r._count._all])),
    voted: new Map(voteRows.map((r) => [r.proposalId, r._count._all])),
  };
}

/**
 * Everything `meetingNextStep` (src/lib/meetingNextStep.ts) needs for one meeting (F6.1/F6.2/F6.5): loaded once,
 * only the pieces the CURRENT status reads. Shared by the meeting page and the president's home so both
 * describe the same next step. PRESIDENT/ACCOUNTANT, zevId-scoped. Returns `{ input, sessionOpenPreview }`.
 */
export async function getMeetingNextStepInput(actor: Actor, meetingId: string, now: Date = new Date()) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId, zevId },
    include: {
      agendaItems: { orderBy: { order: "asc" }, include: { proposals: { select: { id: true, status: true } } } },
      proposals: { select: { id: true, code: true, status: true, agendaItemId: true, votingClosesAt: true, decisionNumber: true } },
    },
  });
  const live = meeting.proposals.filter((p) => p.status !== "WITHDRAWN" && p.status !== "SUPERSEDED");
  const counts = await proposalVoteCounts(zevId, live.map((p) => p.id));
  const quorumById = new Map<string, boolean>();
  if (meeting.status === "VOTING_OPEN") {
    for (const p of live.filter((x) => x.status === "VOTING_OPEN")) {
      quorumById.set(p.id, (await computeProposalResult(zevId, p.id)).quorumReached);
    }
  }
  const sourceWhere = { zevId, sourceType: "Meeting", sourceId: meetingId };
  let invitations: MeetingNextStepInput["invitations"] = null;
  if (meeting.status === "INVITATIONS_PREPARED") {
    const [rec, pdfs] = await Promise.all([
      listInvitationRecipients(actor, meetingId),
      prisma.document.count({ where: { ...sourceWhere, type: "MEETING_INVITATION" } }),
    ]);
    invitations = { withEmail: rec.withEmail.length, withoutEmail: rec.withoutEmailCount, pdfExists: pdfs > 0 };
  }
  const sessionOpen = meeting.status === "INVITATIONS_SENT" ? await previewSessionVotingOpen(actor, meetingId) : null;
  const minutesDraftExists = meeting.status === "DECISION_RECORDED" ? (await prisma.document.count({ where: { ...sourceWhere, type: "MINUTES" } })) > 0 : null;
  let minutesNotes: MeetingNextStepInput["minutesNotes"] = null;
  if (meeting.status === "DECISION_RECORDED") {
    const rows = await prisma.meetingNote.findMany({ where: { zevId, meetingId }, select: { kind: true, agendaItemId: true } });
    minutesNotes = {
      conclusions: rows.filter((n) => n.kind === "CONCLUSION").length,
      notes: rows.filter((n) => n.kind === "NOTE").length,
      conclusionItemIds: [...new Set(rows.filter((n) => n.kind === "CONCLUSION" && n.agendaItemId).map((n) => n.agendaItemId!))],
    };
  }
  const input: MeetingNextStepInput = {
    meetingId,
    status: meeting.status,
    body: meeting.body,
    scheduledAt: meeting.scheduledAt,
    now,
    agendaItems: meeting.agendaItems.map((a) => ({
      id: a.id,
      order: a.order,
      title: a.title,
      proposalCount: a.proposals.filter((p) => p.status !== "WITHDRAWN" && p.status !== "SUPERSEDED").length,
    })),
    proposals: live.map((p) => ({
      id: p.id,
      code: p.code,
      status: p.status,
      agendaItemId: p.agendaItemId,
      votingClosesAt: p.votingClosesAt,
      voters: counts.voters.get(p.id) ?? 0,
      voted: counts.voted.get(p.id) ?? 0,
      quorumReached: quorumById.has(p.id) ? quorumById.get(p.id)! : null,
      decisionNumber: p.decisionNumber,
    })),
    invitations,
    sessionOpen: sessionOpen
      ? { blocked: sessionOpen.blocked, sessionErrors: sessionOpen.sessionErrors, proposals: sessionOpen.proposals.map((p) => ({ id: p.id, code: p.code, errors: p.errors })) }
      : null,
    minutesDraftExists,
    minutesNotes,
  };
  // `sessionOpenPreview`: the full preview the confirmation panel needs (ballots, daily limit), loaded once.
  return { input, sessionOpenPreview: sessionOpen };
}

/**
 * Who gets the "Poziv na sjednicu" e-mail when a meeting moves to INVITATIONS_SENT (F1.5):
 * for a BOARD meeting the president and the board members, for an ASSEMBLY meeting every
 * active party with a current ownership stake. `withEmail` is what the sending loop iterates
 * (each party once); `withoutEmailCount` is shown in the confirmation so the president knows
 * who has to be handed the PDF invitation instead. The page's confirmation and the actual
 * sending both call this, so the number shown is the number sent.
 */
export async function listInvitationRecipients(
  actor: Actor,
  meetingId: string
): Promise<{ withEmail: Party[]; withoutEmailCount: number }> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId, zevId } });
  let candidates: Party[];
  if (meeting.body === "BOARD") {
    const holders = await listOfficeHolders(actor);
    candidates = holders.boardMembers.map((m) => m.party);
    if (holders.president) candidates.push(holders.president.party);
  } else {
    candidates = await prisma.party.findMany({
      where: { zevId, active: true, ownershipStakes: { some: { validTo: null } } },
    });
  }
  const seen = new Set<string>();
  const unique = candidates.filter((p) => !seen.has(p.id) && seen.add(p.id));
  const withEmail = unique.filter((p) => p.email && p.email.trim());
  return { withEmail, withoutEmailCount: unique.length - withEmail.length };
}

/** Queues the "Poziv na sjednicu" e-mail to every `listInvitationRecipients().withEmail` party
 *  (called when the meeting moves to INVITATIONS_SENT). Returns how many were queued and how many
 *  recipients had no address — the same two numbers the confirmation panel showed.
 *  Since v2.44.0 the messages are only written to the outbox and then sent by the shared limited
 *  dispatcher (same daily budget as invoices and ballots); what does not fit stays QUEUED and goes out
 *  with "Pošalji neposlate" on the meeting page (`dispatchMeetingEmails`). */
export async function queueMeetingInvitations(actor: Actor, meetingId: string) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId, zevId } });
  const { withEmail, withoutEmailCount } = await listInvitationRecipients(actor, meetingId);
  for (const o of withEmail) {
    await enqueueNotification({
      zevId,
      channel: "EMAIL",
      recipientId: o.id,
      toAddress: o.email!,
      template: "meeting-invitation",
      subject: `Poziv na sjednicu: ${meeting.title}`,
      body: `Poštovani ${partyDisplayName(o)},\n\npozivamo Vas na sjednicu "${meeting.title}" (${formatDateTime(meeting.scheduledAt)}, ${meeting.location ?? "—"}).\nMaterijali i detalji dostupni su u aplikaciji nakon prijave.\n`,
      relatedType: "Meeting",
      relatedId: meetingId,
    });
  }
  const dispatch = await dispatchQueued(
    { zevId, relatedType: "Meeting", relatedId: meetingId, template: "meeting-invitation" },
    { max: MEETING_EMAIL_DISPATCH_MAX, budgetMs: MEETING_EMAIL_DISPATCH_BUDGET_MS }
  );
  return { queued: withEmail.length, withoutEmailCount, ...dispatch };
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
  const basis = isBoard ? await boardVotingBasis(zevId) : await assemblyVotingSubjects(zevId);
  const ownerIds = [...new Set(basis.map((b) => b.ownerId))];

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

  // One row per voting SUBJECT (K-03/K-03a): a sole owner, or a co-owner community that votes
  // through one representative. A subject counts as present when ANY of its members is marked
  // present (one co-owner in the room is enough); the roll-call action itself records attendance
  // of the representative (ownerId), the person who holds the link.
  const voters = basis.map((b) => {
    const memberAtts = b.actingPartyIds.map((id) => attendanceByOwner.get(id)).filter((a) => a !== undefined);
    const att = attendanceByOwner.get(b.ownerId) ?? memberAtts.find((a) => a.present) ?? memberAtts[0];
    const proxy = proxiesByOwner.get(b.ownerId) ?? null;
    return {
      subjectKey: b.subjectKey,
      ownerId: b.ownerId,
      ownerName: b.ownerName,
      /** True when several co-owners vote together through `ownerId` (the representative). */
      isCommunity: b.memberPartyIds.length > 1,
      representativeName: b.members.find((m) => m.partyId === b.ownerId)?.name ?? b.ownerName,
      representativeConfirmed: b.representativeConfirmed,
      // `marked` distinguishes "explicitly recorded absent" from "not prozivka'd yet" —
      // the roll-call screen's default "Neoznačeni" filter (§3.2) needs this, a plain
      // boolean `present` alone can't tell the two apart.
      marked: memberAtts.length > 0,
      present: memberAtts.some((a) => a.present),
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
  // F6.3: "not yet called" is NOT "absent" — the bar shows the three groups separately.
  const unmarkedCount = voters.filter((v) => !v.marked).length;
  const absentCount = voters.filter((v) => v.marked && !v.present).length;
  const presentPartyIds = new Set(attendances.filter((a) => a.present).map((a) => a.partyId));
  const quorum = await liveQuorum(zevId, meetingId, isBoard, meeting.agendaItems.flatMap((a) => a.proposals), basis, voters, presentPartyIds, opts?.proposalId);

  let activeResult = null;
  // Per-voter breakdown for the active proposal's tally screen (§3.4) — present/unvoted
  // (manual entry), electronic (read-only), no-channel (paper entry). Bounded by that one
  // proposal's own eligible-voter count, not the whole meeting, so this stays cheap even
  // though getLiveMeetingState is polled (Faza 3).
  let activeVoters: {
    eligibleVoterId: string; subjectKey: string; ownerId: string; ownerName: string; isCommunity: boolean; present: boolean;
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
      activeVoters = eligibleVoters.map((ev) => {
        // memberPartyIds is empty only on rows written by pre-FR code (v2.42.0): fall back to the owner.
        const members = actingMembersOf(ev);
        const subjectName = (ev.basis as { subjectName?: string } | null)?.subjectName;
        return {
        eligibleVoterId: ev.id,
        subjectKey: ev.subjectKey,
        ownerId: ev.ownerId,
        ownerName: ev.proxy ? partyDisplayName(ev.proxy) : subjectName ?? partyDisplayName(ev.owner),
        isCommunity: ev.memberPartyIds.length > 1,
        present: members.some((id) => attendanceByOwner.get(id)?.present ?? false),
        voted: ev.votes.length > 0,
        channel: ev.votes[0]?.channel ?? null,
        deliveredVia: ev.tokens[0]?.deliveredVia ?? null,
        notifyStatus:
          ev.tokens[0]?.deliveredVia === "EMAIL" ? notifyStatusByRecipient.get(ev.proxyId ?? ev.ownerId) ?? null : null,
        };
      });
    }
  }

  // F1.7: proposals of this session (draft or open for voting) that are not tied to any agenda
  // item — the live screen offers to link them (linkProposalToAgendaItem) to an item that
  // otherwise shows only "Diskusija", so the vote can be run from that item.
  const unlinkedProposals = await prisma.proposal.findMany({
    where: { zevId, meetingId, status: { in: ["DRAFT", "VOTING_OPEN"] }, agendaItemId: null },
    orderBy: { code: "asc" },
    select: { id: true, code: true, title: true, status: true },
  });

  return {
    meetingId: meeting.id,
    title: meeting.title,
    status: meeting.status,
    body: meeting.body,
    unlinkedProposals,
    agendaItems: meeting.agendaItems.map((a) => ({
      id: a.id,
      order: a.order,
      title: a.title,
      note: a.note,
      proposals: a.proposals.map((p) => ({ id: p.id, code: p.code, title: p.title, status: p.status, text: p.text })),
    })),
    voters,
    presentCount,
    unmarkedCount,
    absentCount,
    totalCount: voters.length,
    quorum,
    activeProposalId: opts?.proposalId ?? null,
    activeVoters,
    activeResult,
  };
}

/**
 * Presence quorum for the live bar (F6.3, F6-Q1 (a)): which rule applies — the active agenda item's proposal if
 * there is one, otherwise the first proposal on the agenda — or, when none is tied to it yet, of the session (open or closed: its frozen `ruleSnapshot`; a draft: its
 * voting rule against the roll-call base). The threshold comes from the SAME `quorumRequirement` the voting result
 * uses; only the thing compared differs (people present in the room, not votes cast). `null` = no proposal.
 */
async function liveQuorum(
  zevId: string,
  meetingId: string,
  isBoard: boolean,
  agendaProposals: { id: string; code: string; status: string; ruleSnapshot: Prisma.JsonValue; votingRuleId: string | null }[],
  basis: VotingSubject[],
  voters: { subjectKey: string; present: boolean }[],
  presentPartyIds: Set<string>,
  activeProposalId: string | undefined
): Promise<LiveQuorum | null> {
  const isLive = (p: { status: string }) => p.status !== "WITHDRAWN" && p.status !== "SUPERSEDED";
  let candidates = agendaProposals.filter(isLive);
  // No proposal tied to the agenda yet (the live screen offers to link them): the session's own first proposal still rules.
  if (candidates.length === 0) {
    candidates = (await prisma.proposal.findMany({ where: { zevId, meetingId }, orderBy: { code: "asc" } })).filter(isLive);
  }
  const proposal = (activeProposalId ? candidates.find((p) => p.id === activeProposalId) : undefined) ?? candidates[0];
  if (!proposal) return null;

  let rule: { quorumType: RuleSnapshot["quorumType"]; quorumPercent: string | null };
  let totals: { totalEligibleWeight: string; totalEligibleOwners: number };
  let present: { count: number; weight: Decimal };
  if (proposal.ruleSnapshot) {
    // Open/closed proposal: the frozen base is the proposal's own EligibleVoter rows (threshold from the snapshot,
    // presence from those rows and their frozen weights) — never today's roll-call list, which may have changed
    // since voting opened. A subject is present when any of its members is (K-03a).
    const snap = proposal.ruleSnapshot as unknown as RuleSnapshot;
    rule = snap;
    totals = { totalEligibleWeight: snap.totalEligibleWeight, totalEligibleOwners: snap.totalEligibleOwners };
    const evs = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id }, select: { ownerId: true, memberPartyIds: true, basis: true, weight: true } });
    const presentEvs = evs.filter((ev) => actingMembersOf(ev).some((id) => presentPartyIds.has(id)));
    present = { count: presentEvs.length, weight: presentEvs.reduce((a, ev) => a.plus(dec(ev.weight.toString())), ZERO) };
  } else {
    const votingRule = proposal.votingRuleId ? await prisma.votingRule.findUnique({ where: { id: proposal.votingRuleId, zevId } }) : null;
    if (!votingRule) return null;
    rule = { quorumType: votingRule.quorumType, quorumPercent: votingRule.quorumPercent?.toString() ?? null };
    // K-03: on the assembly every voting subject weighs 1 whatever the (legacy) rule says; the board keeps its rule's method.
    const weightMethod = isBoard ? votingRule.weightMethod : "PER_OWNER";
    const total = basis.reduce((a, b) => a.plus(computeVoterWeight(weightMethod, b)), ZERO);
    totals = { totalEligibleWeight: total.toString(), totalEligibleOwners: basis.length };
    const presentKeys = new Set(voters.filter((v) => v.present).map((v) => v.subjectKey));
    const presentSubjects = basis.filter((b) => presentKeys.has(b.subjectKey));
    present = { count: presentSubjects.length, weight: presentSubjects.reduce((a, b) => a.plus(computeVoterWeight(weightMethod, b)), ZERO) };
  }

  const presence = presenceQuorum(rule, totals, present);
  // The e-vote note only makes sense while the proposal is open and its voters were actually sent a link.
  const acceptsEVotes =
    proposal.status === "VOTING_OPEN" &&
    (await prisma.approvalToken.count({ where: { eligibleVoter: { proposalId: proposal.id }, deliveredVia: { in: ["EMAIL", "BALLOT"] } } })) > 0;

  const head = { proposalId: proposal.id, proposalCode: proposal.code, acceptsEVotes };
  if (presence.kind === "NONE") return { ...head, kind: "NONE" };
  if (presence.kind === "COUNT") {
    return { ...head, kind: "COUNT", present: presence.present, required: presence.required, total: presence.total, reached: presence.reached, missing: presence.missing };
  }
  return {
    ...head, kind: "WEIGHT",
    present: formatWeight(presence.presentWeight), required: formatWeight(presence.requiredWeight),
    total: formatWeight(presence.totalWeight), reached: presence.reached, missing: formatWeight(presence.missingWeight),
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

/**
 * What moving a session to VOTING_OPEN with `openDraftProposals` would do (v2.43.2): one row per
 * proposal still in DRAFT, with the same delivery preview and preconditions as opening it by
 * hand. `blocked` is true when any proposal cannot be opened — then nothing is opened.
 *
 * v2.44.0 (ballot): opening delivers ONE ballot e-mail per recipient instead of one message per
 * proposal, so the result also carries `ballots` (distinct recipients = messages that will be
 * queued) and the daily-limit state. P-L3: all draft proposals must have the same effective
 * deadline (`votingClosesAt ?? meeting.eVoteClosesAt`) — the ballot is valid until that one date;
 * otherwise `sessionErrors` names the proposals with different deadlines and `blocked` is true.
 */
export async function previewSessionVotingOpen(actor: Actor, meetingId: string) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId, zevId } });
  const drafts = await prisma.proposal.findMany({
    where: { meetingId, status: "DRAFT" },
    orderBy: { code: "asc" },
    select: { id: true, code: true, title: true, votingRuleId: true, votingClosesAt: true },
  });
  const rows = [];
  const ballotRecipients = new Set<string>();
  const sessionErrors: string[] = [];
  const deadlines = new Set(drafts.map((d) => (d.votingClosesAt ?? meeting.eVoteClosesAt)?.getTime()).filter((x): x is number => x !== undefined));
  if (deadlines.size > 1) {
    sessionErrors.push(
      tf("ballot.pre.differentDeadlines", {
        prijedlozi: drafts
          .map((d) => `${d.code} (${formatDateTime(d.votingClosesAt ?? meeting.eVoteClosesAt)})`)
          .join(", "),
      })
    );
  }
  for (const d of drafts) {
    const errors: string[] = [];
    if (!d.votingRuleId) errors.push("nema pravila glasanja");
    if (!(d.votingClosesAt ?? meeting.eVoteClosesAt)) errors.push("nema roka glasanja");
    let preview: { voters: number; byEmail: number; viaProxy: number; withoutEmail: number } | null = null;
    if (errors.length === 0) {
      const p = await previewAllDelivery(actor, d.id);
      errors.push(...p.preconditionErrors);
      preview = { voters: p.voters, byEmail: p.byEmail, viaProxy: p.viaProxy, withoutEmail: p.withoutEmail };
      for (const id of p.recipientPartyIds) ballotRecipients.add(id);
    }
    rows.push({ id: d.id, code: d.code, title: d.title, errors, preview });
  }
  const limit = dailyLimit();
  return {
    proposals: rows,
    sessionErrors,
    blocked: rows.some((r) => r.errors.length > 0) || sessionErrors.length > 0,
    /** Ballot e-mails this step will queue: one per distinct recipient (with an address) over all draft proposals. */
    ballots: ballotRecipients.size,
    /** Remaining room in today's e-mail limit (`Infinity` = no limit in this environment). */
    remainingToday: await remainingToday(),
    dailyLimit: limit,
  };
}

export async function advanceMeetingStatus(
  actor: Actor,
  id: string,
  to: MeetingStatus,
  reason?: string,
  opts?: {
    /** Desktop "Označi glasanje otvorenim" (v2.43.2): also open e-voting (delivery "ALL") on every
     *  DRAFT proposal of the session — symmetric with moving past VOTING_OPEN closing them. The live
     *  screen does NOT pass this: there each proposal is opened per agenda item with delivery "LIVE",
     *  so owners present in the room get no e-mail. */
    openDraftProposals?: boolean;
  }
) {
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

  // Opening the session's voting opens its draft proposals first, and only then moves the session:
  // every proposal is checked up front (nothing is opened if any one cannot be), and if an opening
  // still fails halfway the session stays where it was — repeating the step opens the remaining drafts.
  const autoOpenedProposalIds: string[] = [];
  if (to === "VOTING_OPEN" && toIdx > fromIdx && opts?.openDraftProposals) {
    const pre = await previewSessionVotingOpen(actor, id);
    if (pre.blocked) {
      const why = [...pre.sessionErrors, ...pre.proposals.filter((p) => p.errors.length > 0).map((p) => `${p.code}: ${p.errors.join("; ")}`)];
      throw new Error(`Glasanje nije otvoreno — ${why.join(" · ")}`);
    }
    for (const p of pre.proposals) {
      try {
        // v2.44.0: tokens and the voting base only — NO per-proposal e-mail; one ballot per recipient follows below.
        await openVoting(actor, p.id, { delivery: "BALLOT" });
      } catch (e) {
        const done = autoOpenedProposalIds.length
          ? ` Već otvoreno: ${pre.proposals.filter((x) => autoOpenedProposalIds.includes(x.id)).map((x) => x.code).join(", ")}.`
          : "";
        throw new Error(`Otvaranje glasanja za ${p.code} nije uspjelo: ${e instanceof Error ? e.message : "greška"}.${done} Sjednica nije prešla u „Glasanje otvoreno”; ponovite korak.`);
      }
      autoOpenedProposalIds.push(p.id);
    }
    // One ballot (one link, one code, one e-mail) per recipient over ALL of the session's ballot tokens that do
    // not belong to a ballot yet. Meeting-wide on purpose: if an earlier attempt opened the proposals and then
    // failed here, repeating the step issues the missing ballots and nothing twice (idempotent).
    try {
      await issueMeetingBallots(actor, id);
    } catch (e) {
      throw new Error(`Izdavanje glasačkih listića nije uspjelo: ${e instanceof Error ? e.message : "greška"}. Sjednica nije prešla u „Glasanje otvoreno”; ponovite korak.`);
    }
  }

  const m = await prisma.meeting.update({ where: { id, zevId }, data: { status: to } });

  // Meeting.status was deliberately never a gate for Proposal.status (§1.1) — but that also
  // meant nothing ever closed a proposal's own voting when the session itself moved past
  // VOTING_OPEN, so a proposal could sit "VOTING_OPEN" forever after the meeting was
  // otherwise done. Once the meeting moves forward past VOTING_OPEN, every proposal of this
  // meeting still VOTING_OPEN is closed through the same closeVoting() used everywhere else
  // (§2.5: no new vote-writing/closing code path) — same result computation, same
  // ACCEPTED/REJECTED write, same expiry of unused ApprovalTokens (so outstanding e-vote
  // links stop working, per the same reasoning as closeVoting's own doc comment).
  const votingOpenIdx = MEETING_FLOW.indexOf("VOTING_OPEN");
  const autoClosedProposalIds: string[] = [];
  if (toIdx > fromIdx && toIdx > votingOpenIdx) {
    const openProposals = await prisma.proposal.findMany({
      where: { meetingId: id, status: "VOTING_OPEN" },
      select: { id: true },
    });
    for (const p of openProposals) {
      await closeVoting(actor, p.id);
      autoClosedProposalIds.push(p.id);
    }
  }

  await audit(actor, {
    action: "meeting.status", targetType: "Meeting", targetId: id,
    before: { status: meeting.status }, after: { status: to, autoClosedProposalIds, autoOpenedProposalIds }, reason: reason ?? null,
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
    /** Ignored since FR (K-03): every new rule is stored as PER_OWNER — one etazni vlasnik, one vote. */
    weightMethod?: "PER_OWNER" | "OWNERSHIP_SHARE" | "USABLE_AREA";
    note?: string | null;
  }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  // K-03: weight is always 1 per voting subject, so a "% of total weight" quorum is the same thing as
  // "% of the number of etazni vlasnici"; only the latter is stored for new rules.
  const quorumType = data.quorumType === "PERCENT_OF_TOTAL_WEIGHT" ? "PERCENT_OF_OWNER_COUNT" : data.quorumType;
  const r = await prisma.votingRule.create({ data: { ...data, quorumType, weightMethod: "PER_OWNER", zevId } });
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
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: data.meetingId, zevId } });
  // P-L2 (v2.44.0, user decision 2026-10-25): the ballot is a locked set of proposals — no new proposal once
  // ballots have been issued for the session; a new item goes to a new session. A session whose voting is
  // open without ballots (live mode opens proposals per agenda item) can still get new proposals.
  if ((await prisma.ballot.count({ where: { meetingId: meeting.id } })) > 0) {
    throw new ForbiddenError(t("ballot.err.proposalLocked"));
  }
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

/** Ties a proposal that has no agenda item to one item of its own meeting (F1, K4) — also
 *  while VOTING_OPEN, unlike updateDraftProposal: the agenda item is meeting bookkeeping, not
 *  part of what owners vote on (proposalContentHash covers title, text, version and
 *  attachments only), so linking changes neither the frozen text nor any issued link. Only
 *  an unlinked proposal can be linked — moving it between items stays a draft-only edit. */
export async function linkProposalToAgendaItem(actor: Actor, proposalId: string, agendaItemId: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const before = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId, zevId } });
  if (before.status !== "DRAFT" && before.status !== "VOTING_OPEN") {
    throw new Error("Za tačku dnevnog reda može se vezati samo nacrt ili prijedlog o kojem se glasa.");
  }
  if (before.agendaItemId) throw new Error("Prijedlog je već vezan za tačku dnevnog reda.");
  const item = await prisma.agendaItem.findUniqueOrThrow({ where: { id: agendaItemId, meetingId: before.meetingId } });
  const p = await prisma.proposal.update({ where: { id: proposalId, zevId }, data: { agendaItemId } });
  await audit(actor, {
    action: "proposal.link",
    targetType: "Proposal",
    targetId: proposalId,
    after: { code: p.code, agendaItemId, agendaItemTitle: item.title, status: p.status },
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
  /** All persons of the voting subject (one co-owner in the room is enough — K-03a). */
  memberPartyIds: string[];
  ownerEmail: string | null;
  /** Party.id of the representative's proxy holder, if any — a present holder votes in the room too. */
  proxyHolderId?: string | null;
  proxyEmail: string | null;
  ownerConsentSigned: boolean;
  /** null when this owner has no proxy. */
  proxyConsentSigned: boolean | null;
  presentOwnerIds: Set<string>;
}): { deliver: boolean; suppressReason: DeliverySuppressReason | null } {
  if (
    input.memberPartyIds.some((id) => input.presentOwnerIds.has(id)) ||
    (input.proxyHolderId != null && input.presentOwnerIds.has(input.proxyHolderId))
  ) {
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

/** Persons who can act for a frozen voting subject (presence). K-03b rows carry `basis.actingPartyIds`; older rows
 *  (and pre-FR rows with empty memberPartyIds) fall back to all members / the owner. */
function actingMembersOf(ev: { ownerId: string; memberPartyIds: string[]; basis: unknown }): string[] {
  const acting = (ev.basis as { actingPartyIds?: string[] } | null)?.actingPartyIds;
  if (acting && acting.length > 0) return acting;
  return ev.memberPartyIds.length > 0 ? ev.memberPartyIds : [ev.ownerId];
}

/** The scope + eligible voting base of a proposal — the one place that decides "who is in the
 *  base", shared by `openVoting` and both delivery previews so they can never disagree. */
async function loadVotingBasis(
  zevId: string,
  p: {
    scopeType: ScopeType; buildingId: string | null; entranceId: string | null; allocationGroupId: string | null;
    scopeUnits: { unitId: string }[]; meeting: { body: MeetingBody };
  }
) {
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
  const basis: VotingSubject[] = isBoard ? await boardVotingBasis(zevId) : await assemblyVotingSubjects(zevId, scopedUnits);
  return { isBoard, basis, scopedUnits };
}

/**
 * Preconditions for opening ASSEMBLY voting (FR, K-02 / K-01b) — empty for the board. Shared by `openVoting`
 * (which throws) and both delivery previews (which show them instead of the confirm button), so the panel and
 * the real call can never disagree. Non-blocking observations come back as `warnings`.
 */
async function votingPreconditions(zevId: string, isBoard: boolean, scopedUnits: string[] | undefined, basis: VotingSubject[]) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (isBoard) return { errors, warnings, registerVersion: null as number | null };
  const zev = await prisma.zev.findUniqueOrThrow({ where: { id: zevId }, select: { unitRegisterStatus: true, unitRegisterVersion: true } });
  if (zev.unitRegisterStatus !== "ESTABLISHED") errors.push(tf("votingSubject.pre.registerNotEstablished", {}));
  const warn = await unitOwnershipWarnings(zevId, scopedUnits);
  const none = warn.filter((w) => w.kind === "NONE").map((w) => w.label);
  const over = warn.filter((w) => w.kind === "OVER").map((w) => `${w.label} (${w.sum.toFixed(2).replace(".", ",")} %)`);
  if (none.length > 0) errors.push(tf("votingSubject.pre.unitWithoutOwner", { units: none.join(", ") }));
  if (over.length > 0) errors.push(tf("votingSubject.pre.unitOverShare", { units: over.join(", ") }));
  // K-03b: izricito odredjeni predstavnik zajednice koji vec glasa kao samostalni vlasnik — jedno lice, najvise jedan glas.
  for (const b of basis) {
    if (b.representativeSoleName) {
      errors.push(tf("votingSubject.pre.representativeVotesAsSole", { community: b.ownerName, rep: b.representativeSoleName }));
    }
  }
  const conflicts = basis.filter((b) => b.representativeConflict).map((b) => b.ownerName);
  if (conflicts.length > 0) warnings.push(tf("votingSubject.pre.representativeConflict", { subjects: conflicts.join("; ") }));
  return { errors, warnings, registerVersion: zev.unitRegisterVersion };
}

/** Who actually receives the personal link in "ALL" mode: the proxy's e-mail if the proxy has
 *  one, else the owner's. Used by openVoting's queueing and by previewVotingDelivery("ALL"). */
function approvalLinkAddress(ownerEmail: string | null, proxyEmail: string | null): string | null {
  return proxyEmail ?? ownerEmail;
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
     * ApprovalToken.deliveredVia and whether queueNotification actually runs differ.
     * "BALLOT" (v2.44.0, Plans/glasacki-listic-po-sjednici-plan.md §3.1) is the session-wide mode: the
     * voting base and the tokens are written exactly as in "ALL" (`deliveredVia = "BALLOT"`) but NO message
     * is queued — `issueMeetingBallots` then groups the tokens per recipient into one ballot and one e-mail. */
    delivery?: "ALL" | "LIVE" | "BALLOT";
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

    const { isBoard, basis, scopedUnits } = await loadVotingBasis(zevId, p);
    // K-02 / K-01b: an assembly vote opens only on an established register, with no unit left without
    // an owner and none over 100% (the previous owner would otherwise still get a vote).
    const pre = await votingPreconditions(zevId, isBoard, scopedUnits, basis);
    if (pre.errors.length > 0) throw new Error(pre.errors.join(" "));
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

    // K-03: on the assembly every voting subject weighs exactly 1, whatever the (legacy) rule says.
    // The board keeps the rule's own weight method (its rules are PER_OWNER anyway).
    const weightMethod = isBoard ? p.votingRule.weightMethod : "PER_OWNER";
    let totalWeight = ZERO;
    const voterRows: {
      subjectKey: string; memberPartyIds: string[]; subjectNote: string | null;
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
          memberPartyIds: b.actingPartyIds,
          ownerEmail: b.email,
          proxyHolderId: proxy?.holderId ?? null,
          proxyEmail: proxy?.holder.email ?? null,
          ownerConsentSigned: consentById!.get(b.ownerId) === "SIGNED",
          proxyConsentSigned: proxy ? proxy.holder.eVoteConsentStatus === "SIGNED" : null,
          presentOwnerIds: presentOwnerIds!,
        });
        deliver = cls.deliver;
        suppressReason = cls.suppressReason;
      }

      voterRows.push({
        subjectKey: b.subjectKey,
        memberPartyIds: b.memberPartyIds,
        subjectNote: b.memberPartyIds.length > 1 && !isBoard
          ? tf("votingSubject.mail.community", { units: b.units.map((u) => u.label).join(", "), members: b.ownerName })
          : null,
        ownerId: b.ownerId,
        ownerName: b.members.find((m) => m.partyId === b.ownerId)?.name ?? b.ownerName,
        email: b.email,
        weight: w.toFixed(6),
        proxyId: proxy?.holderId ?? null,
        proxyRecordId: proxy?.id ?? null,
        proxyName: proxy ? partyDisplayName(proxy.holder) : null,
        proxyEmail: proxy?.holder.email ?? null,
        recipientPartyId: proxy?.holderId ?? b.ownerId,
        basis: {
          units: b.units,
          members: b.members,
          subjectName: b.ownerName,
          representativeConfirmed: b.representativeConfirmed,
          // K-03b: clanovi koji mogu djelovati za subjekt (bez onih koji glasaju kao samostalni vlasnici).
          actingPartyIds: b.actingPartyIds,
          ownershipShareSum: b.ownershipShareSum.toFixed(6),
          areaSum: b.areaSum.toFixed(6),
        },
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
      ...(isBoard ? {} : { basisKind: "ASSEMBLY_SUBJECTS" as const, unitRegisterVersion: pre.registerVersion }),
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
      recipientPartyId: string; subjectNote: string | null;
    }[] = [];
    for (const row of voterRows) {
      const ev = await tx.eligibleVoter.create({
        data: {
          proposalId: p.id,
          subjectKey: row.subjectKey,
          memberPartyIds: row.memberPartyIds,
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
          deliveredVia: delivery === "BALLOT" ? "BALLOT" : row.deliver ? "EMAIL" : null,
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
        email: approvalLinkAddress(row.email, row.proxyEmail),
        link: `${appUrl}/glasanje/${token}`,
        verificationCode: code,
        tokenId: t.id,
        eligibleVoterId: ev.id,
        viaProxy: row.proxyName ? row.ownerName : null,
        deliver: row.deliver,
        recipientPartyId: row.recipientPartyId,
        subjectNote: row.subjectNote,
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
        basisKind: ruleSnapshot.basisKind ?? "BOARD_MEMBERS", unitRegisterVersion: ruleSnapshot.unitRegisterVersion ?? null,
        delivery, deliveredCount, suppressedPresent, suppressedNoConsent, suppressedNoEmail,
      },
    }, tx);
    return out;
  }, { timeout: 20000 });

  // Queue deliveries (outside the tx; mock providers in MVP). "BALLOT" queues nothing here.
  for (const d of deliveries) {
    if (delivery !== "BALLOT" && d.email && d.deliver) {
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
          `pozvani ste da se izjasnite o prijedlogu skupštine ZEV.\n` +
          (d.subjectNote ? `${d.subjectNote}\n` : "") + `\n` +
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
  // In "BALLOT" mode nothing is delivered for these tokens and they get attached to a ballot right after
  // (submitVote then answers "use_ballot"), so the returned link/code are never usable on their own.
  return deliveries.map(({ ownerName, email, tokenId, eligibleVoterId, viaProxy, deliver, link, verificationCode, recipientPartyId }) => ({
    ownerName, email, tokenId, eligibleVoterId, viaProxy, deliver, link, verificationCode, recipientPartyId,
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

  const { isBoard, basis, scopedUnits } = await loadVotingBasis(zevId, p);
  const pre = await votingPreconditions(zevId, isBoard, scopedUnits, basis);
  if (basis.length === 0) {
    return {
      presentCount: 0, deliverCount: 0, noChannelCount: 0, totalEligibleWeight: "0", reachableWeight: "0", quorumReachable: false,
      preconditionErrors: pre.errors, preconditionWarnings: pre.warnings,
    };
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

  const weightMethod = isBoard ? p.votingRule.weightMethod : "PER_OWNER"; // K-03: assembly weight is always 1
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
      memberPartyIds: b.actingPartyIds,
      ownerEmail: b.email,
      proxyHolderId: proxy?.holderId ?? null,
      proxyEmail: proxy?.holder.email ?? null,
      ownerConsentSigned: consentById.get(b.ownerId) === "SIGNED",
      proxyConsentSigned: proxy ? proxy.holder.eVoteConsentStatus === "SIGNED" : null,
      presentOwnerIds,
    });
    if (cls.suppressReason === "PRESENT") {
      presentCount++;
      reachableWeight = reachableWeight.plus(w);
      syntheticVotes.push({ eligibleVoterId: b.subjectKey, choice: "APPROVE", weight: w, countsForQuorum: true, invalid: false });
    } else if (cls.deliver) {
      deliverCount++;
      reachableWeight = reachableWeight.plus(w);
      syntheticVotes.push({ eligibleVoterId: b.subjectKey, choice: "APPROVE", weight: w, countsForQuorum: true, invalid: false });
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
    preconditionErrors: pre.errors,
    preconditionWarnings: pre.warnings,
  };
}

/**
 * Read-only preview of the delivery `openVoting(actor, proposalId, { delivery })` is about to do,
 * for the confirmation panel (F1.6). `"LIVE"` is `previewLiveDelivery` unchanged. `"ALL"` counts
 * from the same base (`loadVotingBasis`), the same proxy lookup and the same address rule
 * (`approvalLinkAddress`) that `openVoting` uses, so it equals the number of `ApprovalToken`
 * rows and `approval-link` messages the real call creates. Creates nothing.
 */
export async function previewVotingDelivery(actor: Actor, proposalId: string, delivery: "LIVE"): Promise<Awaited<ReturnType<typeof previewLiveDelivery>>>;
export async function previewVotingDelivery(
  actor: Actor,
  proposalId: string,
  delivery: "ALL"
): Promise<{ voters: number; byEmail: number; viaProxy: number; withoutEmail: number; preconditionErrors: string[]; preconditionWarnings: string[] }>;
export async function previewVotingDelivery(actor: Actor, proposalId: string, delivery: "ALL" | "LIVE") {
  if (delivery === "LIVE") return previewLiveDelivery(actor, proposalId);
  const { recipientPartyIds: _recipients, ...preview } = await previewAllDelivery(actor, proposalId);
  void _recipients;
  return preview;
}

/** The "ALL" preview plus who would be the recipient of each link (for the session-ballot message count). */
async function previewAllDelivery(actor: Actor, proposalId: string) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const p = await prisma.proposal.findUniqueOrThrow({
    where: { id: proposalId, zevId },
    include: { votingRule: true, scopeUnits: true, meeting: true },
  });
  if (p.status !== "DRAFT") throw new Error("Pregled dostave ima smisla samo dok je prijedlog u statusu Nacrt.");
  if (!p.votingRule) throw new Error("Prijedlog nema definisano pravilo glasanja.");
  const { isBoard, basis, scopedUnits } = await loadVotingBasis(zevId, p);
  const pre = await votingPreconditions(zevId, isBoard, scopedUnits, basis);
  let byEmail = 0;
  let viaProxy = 0;
  // Who would get a link (same recipient rule as openVoting's recipientPartyId) — a ballot is one message per entry.
  const recipientPartyIds = new Set<string>();
  for (const b of basis) {
    // Board members vote personally — no proxy lookup (same as openVoting).
    const proxy = isBoard ? null : await activeProxyFor(zevId, b.ownerId, p.meetingId);
    if (approvalLinkAddress(b.email, proxy?.holder.email ?? null)) {
      byEmail++;
      if (proxy) viaProxy++;
      recipientPartyIds.add(proxy?.holderId ?? b.ownerId);
    }
  }
  return {
    voters: basis.length, byEmail, viaProxy, withoutEmail: basis.length - byEmail,
    recipientPartyIds: [...recipientPartyIds],
    preconditionErrors: pre.errors, preconditionWarnings: pre.warnings,
  };
}

// ---- Token lifecycle ----

export async function revokeToken(actor: Actor, tokenId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Opoziv linka zahtijeva razlog.");
  // ApprovalToken has no zevId column of its own — tenant checked indirectly
  // through its eligible voter's proposal.
  const t = await prisma.approvalToken.findUniqueOrThrow({
    where: { id: tokenId },
    include: { eligibleVoter: { include: { proposal: true } } },
  });
  if (t.eligibleVoter.proposal.zevId !== zevId) throw new Error("Token nije pronađen.");
  if (t.ballotId) throw new Error(tf("ballot.err.tokenInBallot", {}));
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
  if (!reason.trim()) throw new Error("Ponovno izdavanje linka zahtijeva razlog.");
  const appUrl = getEnv().APP_URL;
  const result = await prisma.$transaction(async (tx) => {
    const old = await tx.approvalToken.findUniqueOrThrow({
      where: { id: tokenId },
      include: { eligibleVoter: { include: { owner: true, proxy: true, proposal: true } } },
    });
    if (old.eligibleVoter.proposal.zevId !== zevId) throw new Error("Token nije pronađen.");
    if (old.ballotId) throw new Error(tf("ballot.err.tokenInBallot", {}));
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
  if (t.ballotId) return { ok: false as const, error: "use_ballot" as const };
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
      /** Set for a co-owner community ("A i B") — the link holder votes in the name of all of them. */
      subjectName: t.eligibleVoter.memberPartyIds.length > 1
        ? (t.eligibleVoter.basis as { subjectName?: string } | null)?.subjectName ?? null
        : null,
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
      // v2.44.0: a token that belongs to a session ballot can only be used through the ballot.
      if (t.ballotId) throw new VoteError("use_ballot");
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
      return castElectronicVoteTx(tx, t, input.choice, { ipHash: input.ipHash, userAgent: input.userAgent });
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

type CastableToken = ApprovalToken & {
  eligibleVoter: EligibleVoter & { owner: Party; proxy: Party | null; proposal: Proposal };
};

/**
 * The one place an electronic vote row is written (v2.44.0: extracted from `submitVote` unchanged, so a vote
 * cast through a session ballot is the very same evidence as one cast through a single-proposal link).
 * Runs inside the caller's transaction and assumes the caller already verified the token's own status and
 * expiry and the identity code. It re-checks that the proposal is open and that the voter has not voted
 * (the double-vote guard), then writes Vote + marks the token USED + audits `vote.submit`.
 * `meta.auditExtra` adds fields (e.g. the ballot id) to the audit payload; never a choice or a secret.
 */
async function castElectronicVoteTx(
  tx: Prisma.TransactionClient,
  t: CastableToken,
  choice: VoteChoice,
  meta: { ipHash?: string | null; userAgent?: string | null; auditExtra?: Record<string, string> }
) {
  const p = t.eligibleVoter.proposal;
  if (p.status !== "VOTING_OPEN" || (p.votingClosesAt && p.votingClosesAt < new Date())) {
    throw new VoteError("voting_closed");
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
      choice,
      channel: "ELECTRONIC",
      weight: t.eligibleVoter.weight,
      tokenId: t.id,
      proposalHash: p.contentHash ?? "",
      acknowledgementText: ACK_TEXT,
      ipHash: meta.ipHash ?? null,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
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
      ...meta.auditExtra,
    },
    ipHash: meta.ipHash,
  }, tx);
  return vote;
}

class BadCodeSignal extends Error {
  constructor(public tokenId: string, public failedAttempts: number) {
    super("bad_code");
  }
}

export class VoteError extends Error {
  constructor(public code:
    | "not_found" | "revoked" | "used" | "expired" | "voting_closed"
    | "bad_code" | "already_voted" | "use_ballot") {
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

// ---- Session ballots (v2.44.0, Plans/glasacki-listic-po-sjednici-plan.md) ----
//
// A ballot is ONE link + ONE verification code + ONE e-mail per recipient for all proposals a session
// opens at once. The evidence stays per proposal: every proposal keeps its own EligibleVoter, ApprovalToken
// (never delivered, random hash) and, on submit, its own Vote written by the same `castElectronicVoteTx`
// as a single-proposal link. The ballot is only the shared key over those tokens: all or nothing.

export const MEETING_EMAIL_DISPATCH_MAX = 100;
export const MEETING_EMAIL_DISPATCH_BUDGET_MS = 25_000;
const BALLOT_TEMPLATES = ["ballot-link", "ballot-link-reissue"];
const VOTE_CHOICES: VoteChoice[] = ["APPROVE", "REJECT", "ABSTAIN"];

type BallotMailInput = {
  kind: "ISSUE" | "REISSUE";
  recipientName: string;
  meetingTitle: string;
  proposals: { code: string; title: string }[];
  link: string;
  code: string;
  closesAt: Date;
  /** Owners the recipient votes for as a proxy holder (names), and co-owner community notes. */
  proxyFor: string[];
  notes: string[];
};

/** Subject + body of the ballot e-mail. The only place that knows the format `extractApprovalSecrets` parses. */
export function buildBallotMail(m: BallotMailInput): { subject: string; body: string } {
  const rok = formatDateTime(m.closesAt);
  const n = m.proposals.length;
  const subject =
    m.kind === "REISSUE"
      ? tf("ballot.mail.reissueSubject", { sjednica: m.meetingTitle })
      : n === 1
        ? tf("ballot.mail.subjectOne", { sjednica: m.meetingTitle, rok })
        : tf("ballot.mail.subject", { sjednica: m.meetingTitle, broj: n, rok });
  const intro = m.proxyFor.length > 0
    ? tf("ballot.mail.introProxy", { vlasnici: m.proxyFor.join(", "), sjednica: m.meetingTitle })
    : tf("ballot.mail.intro", { sjednica: m.meetingTitle });
  const lines = [
    tf("ballot.mail.greeting", { ime: m.recipientName }),
    "",
    m.kind === "REISSUE" ? tf("ballot.mail.reissueNote", { sjednica: m.meetingTitle }) : intro,
    "",
    ...m.proposals.map((p) => `- ${p.code} — ${p.title}`),
    ...(m.notes.length > 0 ? ["", ...m.notes] : []),
    "",
    tf("ballot.mail.link", { link: m.link }),
    tf("ballot.mail.code", { kod: m.code }),
    "",
    tf("ballot.mail.deadline", { rok }),
    t("ballot.mail.allAtOnce"),
    t("ballot.mail.personal"),
  ];
  return { subject, body: lines.join("\n") + "\n" };
}

/**
 * Groups the session's ballot tokens (`deliveredVia = "BALLOT"`, not on a ballot yet) per recipient and
 * issues ONE ballot (own link + code, hashed) and queues ONE e-mail for each recipient that has an address.
 * Tokens of recipients without an address stay without a ballot (they remain in the voting base and quorum
 * denominator, exactly like today's voters without an e-mail). Idempotent: only tokens without `ballotId` are
 * taken, so a repeated call after a partial failure issues just what is missing. Messages are only written to
 * the outbox — sending is `dispatchMeetingEmails` (limited by the daily budget).
 */
export async function issueMeetingBallots(actor: Actor, meetingId: string, proposalIds?: string[]) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId, zevId } });
  const appUrl = getEnv().APP_URL;
  const tokens = await prisma.approvalToken.findMany({
    where: {
      ballotId: null,
      deliveredVia: "BALLOT",
      status: "ACTIVE",
      eligibleVoter: { proposal: { zevId, meetingId, ...(proposalIds ? { id: { in: proposalIds } } : {}) } },
    },
    include: { eligibleVoter: { include: { owner: true, proxy: true, proposal: { select: { id: true, code: true, title: true } } } } },
    orderBy: { issuedAt: "asc" },
  });

  const byRecipient = new Map<string, typeof tokens>();
  for (const tok of tokens) {
    const rid = tok.eligibleVoter.proxyId ?? tok.eligibleVoter.ownerId;
    byRecipient.set(rid, [...(byRecipient.get(rid) ?? []), tok]);
  }

  const issued: { ballotId: string; recipientPartyId: string; messageId: string }[] = [];
  let withoutEmail = 0;
  for (const [recipientPartyId, group] of byRecipient) {
    const address = group
      .map((g) => approvalLinkAddress(g.eligibleVoter.owner.email?.trim() || null, g.eligibleVoter.proxy?.email?.trim() || null))
      .find((a) => a);
    if (!address) {
      withoutEmail++;
      continue;
    }
    const recipient = group[0].eligibleVoter.proxy ?? group[0].eligibleVoter.owner;
    const linkToken = generateToken();
    const code = generateVerificationCode();
    const expiresAt = new Date(Math.max(...group.map((g) => g.expiresAt.getTime())));
    const proposals = [...new Map(group.map((g) => [g.eligibleVoter.proposal.id, g.eligibleVoter.proposal])).values()].sort((a, b) =>
      a.code.localeCompare(b.code)
    );
    const proxyFor = [...new Set(group.filter((g) => g.eligibleVoter.proxy).map((g) => partyDisplayName(g.eligibleVoter.owner)))];
    const notes = [
      ...new Set(
        group
          .filter((g) => g.eligibleVoter.memberPartyIds.length > 1)
          .map((g) => (g.eligibleVoter.basis as { subjectName?: string } | null)?.subjectName)
          .filter((x): x is string => Boolean(x))
      ),
    ].map((name) => tf("votingSubject.public.community", { name }));
    const mail = buildBallotMail({
      kind: "ISSUE",
      recipientName: partyDisplayName(recipient),
      meetingTitle: meeting.title,
      proposals,
      link: `${appUrl}/glasanje/${linkToken}`,
      code,
      closesAt: expiresAt,
      proxyFor,
      notes,
    });
    const out = await prisma.$transaction(async (tx) => {
      const ballot = await tx.ballot.create({
        data: { zevId, meetingId, recipientPartyId, tokenHash: sha256(linkToken), verificationHash: sha256(code), expiresAt },
      });
      await tx.approvalToken.updateMany({ where: { id: { in: group.map((g) => g.id) }, ballotId: null }, data: { ballotId: ballot.id } });
      await audit(actor, {
        action: "ballot.issue",
        targetType: "Ballot",
        targetId: ballot.id,
        // Never the link or the code — only who/what/until when.
        after: { meetingId, recipientPartyId, proposalIds: proposals.map((p) => p.id), tokenCount: group.length, expiresAt: expiresAt.toISOString() },
      }, tx);
      const msg = await enqueueNotification({
        zevId,
        channel: "EMAIL",
        recipientId: recipientPartyId,
        toAddress: address,
        template: "ballot-link",
        subject: mail.subject,
        body: mail.body,
        relatedType: "Ballot",
        relatedId: ballot.id,
      }, tx);
      return { ballotId: ballot.id, recipientPartyId, messageId: msg.id };
    }, { timeout: 20000 });
    issued.push(out);
  }
  return { ballots: issued.length, queued: issued.length, withoutEmail, issued };
}

/** Message scope of a session's e-mails that share the daily budget: its invitations and its ballots. */
async function meetingEmailWhere(zevId: string, meetingId: string): Promise<Prisma.NotificationMessageWhereInput> {
  const ballotIds = (await prisma.ballot.findMany({ where: { zevId, meetingId }, select: { id: true } })).map((b) => b.id);
  return {
    zevId,
    OR: [
      { relatedType: "Meeting", relatedId: meetingId, template: "meeting-invitation" },
      { relatedType: "Ballot", relatedId: { in: ballotIds }, template: { in: BALLOT_TEMPLATES } },
    ],
  };
}

/**
 * "Pošalji neposlate": sends this session's queued invitations and ballot e-mails within the shared daily
 * limit (invoices, ballots and invitations count against the same Mailjet account). With `retryFailed` it
 * first returns the failed ones (fewer than 5 attempts) to the queue. What does not fit stays QUEUED for the
 * next day or the next click.
 */
export async function dispatchMeetingEmails(
  actor: Actor,
  meetingId: string,
  opts?: { retryFailed?: boolean; max?: number; budgetMs?: number; dailyLimit?: number }
): Promise<DispatchResult & { retried: number }> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId, zevId }, select: { id: true } });
  const where = await meetingEmailWhere(zevId, meetingId);
  const retried = opts?.retryFailed ? await requeueFailed(where) : 0;
  const res = await dispatchQueued(where, {
    max: opts?.max ?? MEETING_EMAIL_DISPATCH_MAX,
    budgetMs: opts?.budgetMs ?? MEETING_EMAIL_DISPATCH_BUDGET_MS,
    dailyLimit: opts?.dailyLimit,
  });
  if (res.attempted > 0 || res.dailyLimitReached || retried > 0) {
    await audit(actor, {
      action: "ballot.dispatch",
      targetType: "Meeting",
      targetId: meetingId,
      after: { attempted: res.attempted, sent: res.sent, failed: res.failed, pending: res.pending, dailyLimitReached: res.dailyLimitReached, retried },
    });
  }
  return { ...res, retried };
}

/** Per-session numbers and rows for the "Glasački listići" card (president/accountant). */
export async function getMeetingBallotSummary(actor: Actor, meetingId: string) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId, zevId }, select: { id: true } });
  const ballots = await prisma.ballot.findMany({
    where: { zevId, meetingId, status: { not: "SUPERSEDED" } },
    include: {
      recipient: true,
      tokens: {
        include: {
          eligibleVoter: {
            include: {
              proposal: { select: { code: true } },
              votes: { where: { invalid: false, correctedBy: null }, select: { id: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const messages = ballots.length
    ? await prisma.notificationMessage.findMany({
        where: { zevId, relatedType: "Ballot", relatedId: { in: ballots.map((b) => b.id) }, template: { in: BALLOT_TEMPLATES } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const latest = new Map<string, (typeof messages)[number]>();
  for (const m of messages) if (m.relatedId && !latest.has(m.relatedId)) latest.set(m.relatedId, m);
  const rows = ballots.map((b) => {
    const m = latest.get(b.id);
    return {
      ballotId: b.id,
      recipientName: partyDisplayName(b.recipient),
      toAddress: m?.toAddress ?? null,
      status: b.status,
      messageStatus: m?.status ?? null,
      lastError: m?.lastError ?? null,
      expiresAt: b.expiresAt,
      proposalsTotal: b.tokens.length,
      proposalsVoted: b.tokens.filter((tk) => tk.eligibleVoter.votes.length > 0).length,
    };
  });
  const invitationsQueued = await prisma.notificationMessage.count({
    where: { zevId, relatedType: "Meeting", relatedId: meetingId, template: "meeting-invitation", status: { in: ["QUEUED", "FAILED"] } },
  });
  return {
    rows,
    total: rows.length,
    sent: rows.filter((r) => r.messageStatus && SENT_STATUSES.includes(r.messageStatus)).length,
    queued: rows.filter((r) => r.messageStatus === "QUEUED").length,
    failed: rows.filter((r) => r.messageStatus === "FAILED").length,
    used: rows.filter((r) => r.status === "USED").length,
    invitationsQueued,
  };
}

/** One token of a ballot as the voter may act on it right now. */
type BallotTokenState = "open" | "closed" | "voted";

function ballotTokenState(
  tok: {
    status: string; expiresAt: Date; vote: unknown | null;
    eligibleVoter: { proposal: { status: string; votingClosesAt: Date | null }; votes: unknown[] };
  },
  now: Date
): BallotTokenState {
  // An earlier valid vote (e.g. entered by the president from paper) settles the proposal for this voter.
  if (tok.vote || tok.status === "USED" || tok.eligibleVoter.votes.length > 0) return "voted";
  const p = tok.eligibleVoter.proposal;
  if (tok.status !== "ACTIVE" || tok.expiresAt < now || p.status !== "VOTING_OPEN" || (p.votingClosesAt && p.votingClosesAt < now)) {
    return "closed";
  }
  return "open";
}

const BALLOT_TOKEN_INCLUDE = {
  vote: true,
  eligibleVoter: {
    include: {
      owner: true,
      proxy: true,
      proposal: { include: { attachments: true } },
      votes: { where: { invalid: false, correctedBy: null }, select: { id: true } },
    },
  },
} as const;

/** Whether a public link token is a session ballot (so the page shows the ballot, not a single proposal). */
export async function isBallotLink(tokenPlain: string): Promise<boolean> {
  return (await prisma.ballot.count({ where: { tokenHash: sha256(tokenPlain) } })) > 0;
}

/** Look up a ballot by its plaintext link token and show what the holder may vote on. Never returns the token. */
export async function inspectBallot(tokenPlain: string, ipHash?: string | null) {
  if (!rateLimitVerify(verifyKey(tokenPlain, ipHash))) {
    return { ok: false as const, error: "rate_limited" as const };
  }
  const b = await prisma.ballot.findUnique({
    where: { tokenHash: sha256(tokenPlain) },
    include: {
      recipient: true,
      meeting: true,
      zev: { select: { legalName: true, shortName: true } },
      tokens: { include: BALLOT_TOKEN_INCLUDE, orderBy: { issuedAt: "asc" } },
    },
  });
  if (!b) return { ok: false as const, error: "not_found" as const };
  if (b.status === "REVOKED" || b.status === "SUPERSEDED") return { ok: false as const, error: "revoked" as const };
  if (b.status === "USED") return { ok: false as const, error: "used" as const };
  const now = new Date();
  if (b.expiresAt < now) return { ok: false as const, error: "expired" as const };

  const proposals = b.tokens
    .map((tok) => {
      const p = tok.eligibleVoter.proposal;
      return {
        tokenId: tok.id,
        proposalId: p.id,
        code: p.code,
        version: p.version,
        title: p.title,
        text: p.text,
        rationale: p.rationale,
        contentHash: p.contentHash,
        votingClosesAt: p.votingClosesAt,
        attachments: p.attachments.map((a) => ({ id: a.id, filename: a.filename, size: a.size, sha256: a.sha256 })),
        state: ballotTokenState(tok, now),
        ownerName: partyDisplayName(tok.eligibleVoter.owner),
        proxyName: tok.eligibleVoter.proxy ? partyDisplayName(tok.eligibleVoter.proxy) : null,
        subjectName:
          tok.eligibleVoter.memberPartyIds.length > 1
            ? (tok.eligibleVoter.basis as { subjectName?: string } | null)?.subjectName ?? null
            : null,
      };
    })
    .sort((x, y) => x.code.localeCompare(y.code));
  if (!proposals.some((p) => p.state === "open")) return { ok: false as const, error: "voting_closed" as const };

  if (!b.openedAt) {
    await prisma.ballot.update({ where: { id: b.id }, data: { openedAt: now } });
    await prisma.approvalToken.updateMany({ where: { ballotId: b.id, openedAt: null }, data: { openedAt: now } });
    await audit(null, {
      action: "ballot.open", targetType: "Ballot", targetId: b.id, zevId: b.zevId, subjectPartyId: b.recipientPartyId, ipHash,
    });
  }
  return {
    ok: true as const,
    ballotId: b.id,
    meetingTitle: b.meeting.title,
    zevName: b.zev.shortName ?? b.zev.legalName,
    recipientName: partyDisplayName(b.recipient),
    expiresAt: b.expiresAt,
    proposals,
    ackText: ACK_TEXT,
  };
}

class BadBallotCodeSignal extends Error {
  constructor(public ballotId: string) {
    super("bad_code");
  }
}

class BallotChoiceError extends Error {
  constructor(public code: "missing_choices" | "invalid_choice", public proposals: { proposalId: string; code: string; title: string }[]) {
    super(code);
  }
}

/**
 * Submit a whole ballot: one identity code, one acknowledgement, a choice for EVERY proposal still open to this
 * voter. All or nothing — the votes are written in one transaction through the same `castElectronicVoteTx` as a
 * single-proposal link (one Vote + one `vote.submit` per proposal), and the ballot is spent in the same step.
 * A proposal the voter already has a vote for (paper entry) or that has meanwhile closed is skipped, not demanded.
 * A choice for a proposal that is not on the ballot or is closed is an error (`invalid_choice`).
 */
export async function submitBallot(input: {
  tokenPlain: string;
  verificationCode: string;
  choices: Record<string, string>;
  ack: boolean;
  ipHash?: string | null;
  userAgent?: string | null;
}) {
  if (!rateLimitVerify(verifyKey(input.tokenPlain, input.ipHash))) return { ok: false as const, error: "rate_limited" as const };
  if (!input.ack) return { ok: false as const, error: "ack_required" as const };
  const tokenHash = sha256(input.tokenPlain);

  try {
    return await prisma.$transaction(async (tx) => {
      const b = await tx.ballot.findUnique({
        where: { tokenHash },
        include: {
          recipient: true,
          meeting: { select: { title: true } },
          tokens: { include: BALLOT_TOKEN_INCLUDE, orderBy: { issuedAt: "asc" } },
        },
      });
      if (!b) throw new VoteError("not_found");
      if (b.status === "REVOKED" || b.status === "SUPERSEDED") throw new VoteError("revoked");
      if (b.status === "USED") throw new VoteError("used");
      const now = new Date();
      if (b.expiresAt < now) throw new VoteError("expired");
      // Identity confirmation: the code delivered with the link. Bookkeeping of a miss survives the rollback.
      if (sha256(input.verificationCode.trim()) !== b.verificationHash) throw new BadBallotCodeSignal(b.id);

      const states = b.tokens.map((tok) => ({ tok, state: ballotTokenState(tok, now) }));
      const open = states.filter((s) => s.state === "open");
      if (open.length === 0) throw new VoteError("voting_closed");
      const pinfo = (s: (typeof states)[number]) => ({ proposalId: s.tok.eligibleVoter.proposal.id, code: s.tok.eligibleVoter.proposal.code, title: s.tok.eligibleVoter.proposal.title });

      // A choice may only name an open proposal of this ballot (one already settled by a paper vote is ignored).
      const byProposal = new Map(states.map((s) => [s.tok.eligibleVoter.proposal.id, s]));
      const invalid = Object.keys(input.choices).filter((pid) => !byProposal.has(pid) || byProposal.get(pid)!.state === "closed");
      if (invalid.length > 0) {
        throw new BallotChoiceError("invalid_choice", invalid.map((pid) => (byProposal.has(pid) ? pinfo(byProposal.get(pid)!) : { proposalId: pid, code: pid, title: "" })));
      }
      const bad = open.filter((s) => {
        const c = input.choices[s.tok.eligibleVoter.proposal.id];
        return c !== undefined && !VOTE_CHOICES.includes(c as VoteChoice);
      });
      if (bad.length > 0) throw new BallotChoiceError("invalid_choice", bad.map(pinfo));
      const missing = open.filter((s) => input.choices[s.tok.eligibleVoter.proposal.id] === undefined);
      if (missing.length > 0) throw new BallotChoiceError("missing_choices", missing.map(pinfo));

      // Spend the ballot first: a concurrent second submit loses this conditional update and sees "used".
      const claimed = await tx.ballot.updateMany({ where: { id: b.id, status: "ACTIVE" }, data: { status: "USED", usedAt: now } });
      if (claimed.count === 0) throw new VoteError("used");

      const items: { proposalId: string; code: string; title: string; voteId: string; choice: VoteChoice }[] = [];
      for (const s of open) {
        const p = s.tok.eligibleVoter.proposal;
        const choice = input.choices[p.id] as VoteChoice;
        const vote = await castElectronicVoteTx(tx, s.tok, choice, { ipHash: input.ipHash, userAgent: input.userAgent, auditExtra: { ballotId: b.id } });
        items.push({ proposalId: p.id, code: p.code, title: p.title, voteId: vote.id, choice });
      }
      await audit(null, {
        action: "ballot.submit",
        targetType: "Ballot",
        targetId: b.id,
        zevId: b.zevId,
        subjectPartyId: b.recipientPartyId,
        // voteIds only — never the choices (same privacy rule as vote.submit) and never a secret.
        after: { meetingId: b.meetingId, voteIds: items.map((i) => i.voteId), proposalIds: items.map((i) => i.proposalId) },
        ipHash: input.ipHash,
      }, tx);
      return {
        ok: true as const,
        receipt: {
          ballotId: b.id,
          meetingTitle: b.meeting.title,
          submittedAt: now,
          items,
          skipped: states.filter((s) => s.state !== "open").map((s) => ({
            code: s.tok.eligibleVoter.proposal.code,
            title: s.tok.eligibleVoter.proposal.title,
            reason: s.state as "closed" | "voted",
          })),
        },
      };
    }, { timeout: 20000 });
  } catch (e) {
    if (e instanceof BadBallotCodeSignal) {
      const updated = await prisma.ballot.update({ where: { id: e.ballotId }, data: { failedAttempts: { increment: 1 } } });
      await audit(null, { action: "vote.verify.failed", targetType: "Ballot", targetId: e.ballotId, ipHash: input.ipHash });
      if (updated.failedAttempts >= 5 && updated.status === "ACTIVE") {
        await prisma.ballot.update({
          where: { id: e.ballotId },
          data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "Previše neuspjelih pokušaja verifikacije" },
        });
        await audit(null, { action: "ballot.revoke.auto", targetType: "Ballot", targetId: e.ballotId, reason: "failed verification attempts" });
      }
      return { ok: false as const, error: "bad_code" as const };
    }
    if (e instanceof BallotChoiceError) return { ok: false as const, error: e.code, proposals: e.proposals };
    if (e instanceof VoteError) return { ok: false as const, error: e.code };
    throw e;
  }
}

/**
 * New link + code for a ballot (PRESIDENT, reason required): the old ballot becomes SUPERSEDED (its link
 * stops working), the still-unused tokens move to the new one, and one e-mail goes out (subject to the daily
 * limit — it stays queued if today's limit is spent). Tokens that already carry a vote stay with the old ballot.
 */
export async function reissueBallot(actor: Actor, ballotId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error(t("ballot.err.reasonReissue"));
  const appUrl = getEnv().APP_URL;
  const out = await prisma.$transaction(async (tx) => {
    const old = await tx.ballot.findUniqueOrThrow({
      where: { id: ballotId, zevId },
      include: {
        recipient: true,
        meeting: true,
        tokens: { include: { eligibleVoter: { include: { owner: true, proxy: true, proposal: { select: { id: true, code: true, title: true } } } } } },
      },
    });
    if (old.status === "USED") throw new ForbiddenError(t("ballot.err.usedReissue"));
    if (old.status === "SUPERSEDED") throw new Error(t("ballot.err.alreadySuperseded"));
    const live = old.tokens.filter((tk) => tk.status === "ACTIVE");
    if (live.length === 0) throw new Error(t("ballot.err.nothingToReissue"));
    const linkToken = generateToken();
    const code = generateVerificationCode();
    const fresh = await tx.ballot.create({
      data: {
        zevId, meetingId: old.meetingId, recipientPartyId: old.recipientPartyId,
        tokenHash: sha256(linkToken), verificationHash: sha256(code), expiresAt: old.expiresAt,
      },
    });
    await tx.ballot.update({ where: { id: old.id }, data: { status: "SUPERSEDED", revokedAt: new Date(), revokedReason: reason, replacedById: fresh.id } });
    await tx.approvalToken.updateMany({ where: { id: { in: live.map((tk) => tk.id) } }, data: { ballotId: fresh.id } });
    await audit(actor, {
      action: "ballot.reissue",
      targetType: "Ballot",
      targetId: fresh.id,
      before: { oldBallotId: old.id },
      after: { meetingId: old.meetingId, recipientPartyId: old.recipientPartyId, tokenCount: live.length },
      reason,
    }, tx);
    const address = live
      .map((g) => approvalLinkAddress(g.eligibleVoter.owner.email?.trim() || null, g.eligibleVoter.proxy?.email?.trim() || null))
      .find((a) => a) ?? old.recipient.email?.trim() ?? null;
    let messageId: string | null = null;
    if (address) {
      const proposals = [...new Map(live.map((g) => [g.eligibleVoter.proposal.id, g.eligibleVoter.proposal])).values()].sort((a, b) =>
        a.code.localeCompare(b.code)
      );
      const mail = buildBallotMail({
        kind: "REISSUE",
        recipientName: partyDisplayName(old.recipient),
        meetingTitle: old.meeting.title,
        proposals,
        link: `${appUrl}/glasanje/${linkToken}`,
        code,
        closesAt: old.expiresAt,
        proxyFor: [],
        notes: [],
      });
      const msg = await enqueueNotification({
        zevId, channel: "EMAIL", recipientId: old.recipientPartyId, toAddress: address,
        template: "ballot-link-reissue", subject: mail.subject, body: mail.body, relatedType: "Ballot", relatedId: fresh.id,
      }, tx);
      messageId = msg.id;
    }
    return { newBallotId: fresh.id, messageId };
  }, { timeout: 20000 });
  let sent = false;
  if (out.messageId) {
    const res = await dispatchQueued({ id: out.messageId }, { max: 1, budgetMs: MEETING_EMAIL_DISPATCH_BUDGET_MS });
    sent = res.sent === 1;
  }
  return { newBallotId: out.newBallotId, emailed: out.messageId !== null, sent };
}

/** Revokes a ballot without issuing a new one (PRESIDENT, reason required). A used ballot cannot be revoked. */
export async function revokeBallot(actor: Actor, ballotId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error(t("ballot.err.reasonRevoke"));
  const b = await prisma.ballot.findUniqueOrThrow({ where: { id: ballotId, zevId } });
  if (b.status === "USED") throw new ForbiddenError(t("ballot.err.usedRevoke"));
  if (b.status !== "ACTIVE") throw new Error(t("ballot.err.notActive"));
  const updated = await prisma.ballot.update({ where: { id: ballotId }, data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason } });
  await audit(actor, { action: "ballot.revoke", targetType: "Ballot", targetId: ballotId, reason });
  return updated;
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
      // memberPartyIds: a co-owner who is not the representative still sees the vote of his community.
      OR: [{ ownerId: partyId }, { proxyId: partyId }, { memberPartyIds: { has: partyId } }],
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
