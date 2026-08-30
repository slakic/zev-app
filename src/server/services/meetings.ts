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
import { requireRole, requireAnyUser, ForbiddenError, type Actor } from "@/server/auth/guards";
import { generateToken, generateVerificationCode, sha256 } from "@/server/auth/tokens";
import { computeVoterWeight, computeVotingResult, serializeResult, type RuleSnapshot } from "@/server/engines/voting";
import { ownersVotingBasis, boardVotingBasis, activeProxyFor, partyDisplayName } from "./ownership";
import { unitsInScope } from "./property";
import { queueNotification } from "@/server/notifications/service";
import { dec, ZERO } from "@/lib/money";
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
    where: body ? { body } : undefined,
    include: { _count: { select: { proposals: true, agendaItems: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getMeeting(actor: Actor, id: string) {
  requireAnyUser(actor);
  return prisma.meeting.findUniqueOrThrow({
    where: { id },
    include: {
      agendaItems: { orderBy: { order: "asc" }, include: { proposals: true } },
      proposals: { orderBy: { code: "asc" }, include: { votingRule: true } },
      attendances: { include: { party: true } },
      proxies: { include: { grantor: true, holder: true } },
    },
  });
}

export async function createMeeting(
  actor: Actor,
  data: { title: string; type: MeetingType; body?: MeetingBody; location?: string | null; scheduledAt?: Date | null; eVoteOpensAt?: Date | null; eVoteClosesAt?: Date | null }
) {
  requireRole(actor, "PRESIDENT");
  const m = await prisma.meeting.create({ data: { ...data, body: data.body ?? "ASSEMBLY" } });
  await audit(actor, { action: "meeting.create", targetType: "Meeting", targetId: m.id, after: { title: m.title, type: m.type, body: m.body } });
  return m;
}

export async function updateMeeting(actor: Actor, id: string, data: Prisma.MeetingUpdateInput) {
  requireRole(actor, "PRESIDENT");
  const before = await prisma.meeting.findUniqueOrThrow({ where: { id } });
  if (["MINUTES_FINALIZED", "ARCHIVED"].includes(before.status) && data.status === undefined) {
    throw new ForbiddenError("Finalizovana sjednica se ne može mijenjati.");
  }
  const m = await prisma.meeting.update({ where: { id }, data });
  await audit(actor, { action: "meeting.update", targetType: "Meeting", targetId: id, before: { title: before.title, scheduledAt: before.scheduledAt }, after: { title: m.title, scheduledAt: m.scheduledAt } });
  return m;
}

export async function advanceMeetingStatus(actor: Actor, id: string, to: MeetingStatus, reason?: string) {
  requireRole(actor, "PRESIDENT");
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id } });
  const fromIdx = MEETING_FLOW.indexOf(meeting.status);
  const toIdx = MEETING_FLOW.indexOf(to);
  if (toIdx < 0) throw new Error("Nepoznat status.");
  if (toIdx < fromIdx && !reason) {
    throw new Error("Vraćanje statusa unazad zahtijeva razlog (evidentira se u auditu).");
  }
  const m = await prisma.meeting.update({ where: { id }, data: { status: to } });
  await audit(actor, {
    action: "meeting.status", targetType: "Meeting", targetId: id,
    before: { status: meeting.status }, after: { status: to }, reason: reason ?? null,
  });
  return m;
}

export async function addAgendaItem(actor: Actor, data: { meetingId: string; title: string; note?: string | null }) {
  requireRole(actor, "PRESIDENT");
  const max = await prisma.agendaItem.aggregate({ where: { meetingId: data.meetingId }, _max: { order: true } });
  const item = await prisma.agendaItem.create({
    data: { meetingId: data.meetingId, title: data.title, note: data.note ?? null, order: (max._max.order ?? 0) + 1 },
  });
  await audit(actor, { action: "agenda.add", targetType: "AgendaItem", targetId: item.id, after: { title: item.title } });
  return item;
}

export async function recordAttendance(actor: Actor, data: { meetingId: string; partyId: string; present: boolean; viaProxyId?: string | null }) {
  requireRole(actor, "PRESIDENT");
  const a = await prisma.attendance.upsert({
    where: { meetingId_partyId: { meetingId: data.meetingId, partyId: data.partyId } },
    create: data,
    update: { present: data.present, viaProxyId: data.viaProxyId ?? null },
  });
  await audit(actor, { action: "attendance.record", targetType: "Attendance", targetId: a.id, after: { partyId: data.partyId, present: data.present } });
  return a;
}

// ---- Voting rules ----

export async function listVotingRules(actor: Actor) {
  requireAnyUser(actor);
  return prisma.votingRule.findMany({ orderBy: { name: "asc" } });
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
  const r = await prisma.votingRule.create({ data });
  await audit(actor, { action: "voting_rule.create", targetType: "VotingRule", targetId: r.id, after: { name: r.name } });
  return r;
}

// ---- Proposals ----

export async function getProposal(actor: Actor, id: string) {
  requireAnyUser(actor);
  return prisma.proposal.findUniqueOrThrow({
    where: { id },
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
  const p = await prisma.proposal.create({
    data: {
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

export async function updateDraftProposal(actor: Actor, id: string, data: { title?: string; text?: string; rationale?: string | null; financialImpact?: string | null; votingRuleId?: string; votingOpensAt?: Date | null; votingClosesAt?: Date | null }) {
  requireRole(actor, "PRESIDENT");
  const before = await prisma.proposal.findUniqueOrThrow({ where: { id } });
  if (before.status !== "DRAFT") {
    throw new ForbiddenError(
      "Prijedlog je zamrznut — sadržaj se ne može mijenjati nakon otvaranja glasanja. Kreirajte novu verziju."
    );
  }
  const p = await prisma.proposal.update({ where: { id }, data });
  await audit(actor, { action: "proposal.update", targetType: "Proposal", targetId: id, before: { title: before.title }, after: { title: p.title } });
  return p;
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
  return prisma.$transaction(async (tx) => {
    const old = await tx.proposal.findUniqueOrThrow({ where: { id: proposalId }, include: { scopeUnits: true } });
    if (old.status === "SUPERSEDED") throw new Error("Prijedlog je već zamijenjen novom verzijom.");
    // Invalidate all outstanding tokens of the old version.
    const voters = await tx.eligibleVoter.findMany({ where: { proposalId }, select: { id: true } });
    await tx.approvalToken.updateMany({
      where: { eligibleVoterId: { in: voters.map((v) => v.id) }, status: "ACTIVE" },
      data: { status: "SUPERSEDED", revokedAt: new Date(), revokedReason: `Nova verzija prijedloga: ${reason}` },
    });
    const superseded = await tx.proposal.update({ where: { id: proposalId }, data: { status: "SUPERSEDED" } });
    const next = await tx.proposal.create({
      data: {
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

/**
 * Freeze the proposal and open electronic voting:
 *  1. snapshot the voting rule + eligible voting base
 *  2. hash the proposal content
 *  3. issue one hashed token + verification code per eligible voter
 * Returns delivery payloads (plaintext links + codes) exactly once, for delivery.
 */
export async function openVoting(actor: Actor, proposalId: string, opts?: { expiresAt?: Date }) {
  requireRole(actor, "PRESIDENT");
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const deliveries = await prisma.$transaction(async (tx) => {
    const p = await tx.proposal.findUniqueOrThrow({
      where: { id: proposalId },
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
            await unitsInScope({
              scopeType: p.scopeType,
              buildingId: p.buildingId,
              entranceId: p.entranceId,
              allocationGroupId: p.allocationGroupId,
              unitIds: p.scopeUnits.map((s) => s.unitId),
            })
          ).map((u) => u.id);
    const basis = isBoard ? await boardVotingBasis() : await ownersVotingBasis(scopedUnits);
    if (basis.length === 0) {
      throw new Error(isBoard ? "Upravni odbor trenutno nema evidentiranih članova." : "Nema nijednog vlasnika u obuhvatu prijedloga.");
    }

    const weightMethod = p.votingRule.weightMethod;
    let totalWeight = ZERO;
    const voterRows: {
      ownerId: string; ownerName: string; email: string | null; weight: string;
      proxyId: string | null; proxyRecordId: string | null; proxyName: string | null; proxyEmail: string | null;
      basis: unknown;
    }[] = [];
    for (const b of basis) {
      const w = computeVoterWeight(weightMethod, b);
      totalWeight = totalWeight.plus(w);
      // Board members vote personally — no proxy voting in upravni odbor (assumption, see docs).
      const proxy = isBoard ? null : await activeProxyFor(b.ownerId, p.meetingId);
      voterRows.push({
        ownerId: b.ownerId,
        ownerName: b.ownerName,
        email: b.email,
        weight: w.toFixed(6),
        proxyId: proxy?.holderId ?? null,
        proxyRecordId: proxy?.id ?? null,
        proxyName: proxy ? partyDisplayName(proxy.holder) : null,
        proxyEmail: proxy?.holder.email ?? null,
        basis: { units: b.units, ownershipShareSum: b.ownershipShareSum.toFixed(6), areaSum: b.areaSum.toFixed(6) },
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
      tokenId: string; eligibleVoterId: string; viaProxy: string | null;
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
          deliveredVia: "EMAIL",
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
      });
    }

    await audit(actor, {
      action: "proposal.voting.open",
      targetType: "Proposal",
      targetId: p.id,
      after: { contentHash, totalEligibleWeight: ruleSnapshot.totalEligibleWeight, voters: out.length },
    }, tx);
    return out;
  });

  // Queue deliveries (outside the tx; mock providers in MVP).
  for (const d of deliveries) {
    if (d.email) {
      await queueNotification({
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
  return deliveries.map(({ ownerName, email, tokenId, eligibleVoterId, viaProxy }) => ({
    ownerName, email, tokenId, eligibleVoterId, viaProxy,
  }));
}

// ---- Token lifecycle ----

export async function revokeToken(actor: Actor, tokenId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const t = await prisma.approvalToken.findUniqueOrThrow({ where: { id: tokenId } });
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
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const result = await prisma.$transaction(async (tx) => {
    const old = await tx.approvalToken.findUniqueOrThrow({
      where: { id: tokenId },
      include: { eligibleVoter: { include: { owner: true, proxy: true, proposal: true } } },
    });
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
          proposal: { include: { meeting: true, attachments: true } },
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
        after: {
          proposalId: p.id,
          proposalVersion: p.version,
          eligibleVoterId: t.eligibleVoterId,
          choice: input.choice,
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
  requireRole(actor, "PRESIDENT");
  return prisma.$transaction(async (tx) => {
    const ev = await tx.eligibleVoter.findUniqueOrThrow({
      where: { id: data.eligibleVoterId },
      include: { proposal: true, owner: true, proxy: true },
    });
    if (ev.proposal.status !== "VOTING_OPEN") throw new Error("Glasanje nije otvoreno.");
    const existing = await tx.vote.findFirst({
      where: { eligibleVoterId: ev.id, invalid: false, correctedBy: null },
    });
    if (existing) throw new Error("Ovaj vlasnik se već izjasnio.");
    const voterParty = ev.proxy ?? ev.owner;
    const vote = await tx.vote.create({
      data: {
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
 * Correction of a submitted vote: append-only. The original row is untouched;
 * a new row references it with reason + authority; result computation uses the
 * correction instead of the original.
 */
export async function correctVote(
  actor: Actor,
  data: { voteId: string; choice: VoteChoice; reason: string; authority: string }
) {
  requireRole(actor, "PRESIDENT");
  if (!data.reason.trim() || !data.authority.trim()) {
    throw new Error("Ispravka glasa zahtijeva razlog i osnov (npr. odluku skupštine).");
  }
  return prisma.$transaction(async (tx) => {
    const original = await tx.vote.findUniqueOrThrow({ where: { id: data.voteId }, include: { correctedBy: true } });
    if (original.correctedBy) throw new Error("Glas je već ispravljen.");
    const correction = await tx.vote.create({
      data: {
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

export async function effectiveVotes(proposalId: string) {
  const votes = await prisma.vote.findMany({
    where: { proposalId },
    include: { correctedBy: true },
  });
  // A corrected vote is superseded by its correction row.
  return votes.filter((v) => !v.correctedBy);
}

export async function computeProposalResult(proposalId: string) {
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
  if (!p.ruleSnapshot) throw new Error("Prijedlog nema snimak pravila (glasanje nije otvarano).");
  const rule = p.ruleSnapshot as unknown as RuleSnapshot;
  const votes = await effectiveVotes(proposalId);
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
  requireRole(actor, "PRESIDENT");
  const result = await computeProposalResult(proposalId);
  const serialized = serializeResult(result);
  const p = await prisma.$transaction(async (tx) => {
    const prop = await tx.proposal.findUniqueOrThrow({ where: { id: proposalId } });
    if (prop.status !== "VOTING_OPEN") throw new Error("Glasanje nije otvoreno.");
    // Expire unused tokens.
    const voters = await tx.eligibleVoter.findMany({ where: { proposalId }, select: { id: true } });
    await tx.approvalToken.updateMany({
      where: { eligibleVoterId: { in: voters.map((v) => v.id) }, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    const updated = await tx.proposal.update({
      where: { id: proposalId },
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
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
  if (p.status !== "ACCEPTED" && p.status !== "REJECTED") {
    throw new Error("Odluka se evidentira nakon zatvaranja glasanja.");
  }
  const updated = await prisma.proposal.update({ where: { id: proposalId }, data: { decisionNumber } });
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
  if (actor.partyId !== partyId && !actor.roles.some((r) => r === "PRESIDENT")) {
    throw new ForbiddenError();
  }
  return prisma.eligibleVoter.findMany({
    where: {
      OR: [{ ownerId: partyId }, { proxyId: partyId }],
      proposal: { status: "VOTING_OPEN" },
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
  if (actor.partyId !== partyId) throw new ForbiddenError();
  return prisma.vote.findMany({
    where: { OR: [{ voterId: partyId }, { representedId: partyId }] },
    include: { proposal: true },
    orderBy: { submittedAt: "desc" },
  });
}
