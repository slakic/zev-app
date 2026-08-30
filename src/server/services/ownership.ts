// Parties, effective-dated ownership stakes, occupancies, proxies, office terms.
// History is never rewritten: an ownership change closes the old stake
// (validTo) and opens a new one (validFrom).
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireSelfOrRole, requireAnyUser, ForbiddenError, type Actor } from "@/server/auth/guards";
import { dec, ZERO, type Decimal } from "@/lib/money";
import type { PartyKind, OccupancyType, ProxyScope, Prisma } from "@/generated/prisma/client";

export function partyDisplayName(p: { kind: PartyKind; firstName: string | null; lastName: string | null; orgName: string | null }): string {
  return p.kind === "PERSON"
    ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()
    : p.orgName ?? "";
}

// ---- Parties ----

export async function listParties(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return prisma.party.findMany({
    where: { active: true },
    include: {
      ownershipStakes: { where: { validTo: null }, include: { unit: true } },
      user: { select: { id: true, email: true, roles: true, active: true } },
    },
    orderBy: [{ lastName: "asc" }, { orgName: "asc" }],
  });
}

export async function getParty(actor: Actor, partyId: string) {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  return prisma.party.findUniqueOrThrow({
    where: { id: partyId },
    include: {
      ownershipStakes: { include: { unit: { include: { building: true } } }, orderBy: { validFrom: "desc" } },
      occupancies: { include: { unit: true } },
      proxiesGiven: { include: { holder: true } },
      proxiesHeld: { include: { grantor: true } },
      user: { select: { id: true, email: true, roles: true, active: true } },
    },
  });
}

export async function createParty(
  actor: Actor,
  data: {
    kind: PartyKind;
    firstName?: string | null;
    lastName?: string | null;
    orgName?: string | null;
    orgIdNumber?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    correspondenceAddress?: string | null;
    note?: string | null;
  }
) {
  requireRole(actor, "PRESIDENT");
  const p = await prisma.party.create({ data });
  await audit(actor, { action: "party.create", targetType: "Party", targetId: p.id, after: { name: partyDisplayName(p), kind: p.kind } });
  return p;
}

export async function updateParty(actor: Actor, id: string, data: Prisma.PartyUpdateInput) {
  requireSelfOrRole(actor, id, "PRESIDENT");
  const before = await prisma.party.findUniqueOrThrow({ where: { id } });
  // Owners may update their own contact data only.
  if (actor.partyId === id && !actor.roles.includes("PRESIDENT")) {
    const allowed = new Set(["email", "phone", "correspondenceAddress"]);
    for (const k of Object.keys(data)) {
      if (!allowed.has(k)) throw new ForbiddenError("Možete mijenjati samo svoje kontakt podatke.");
    }
  }
  const p = await prisma.party.update({ where: { id }, data });
  await audit(actor, {
    action: "party.update", targetType: "Party", targetId: id,
    before: { email: before.email, phone: before.phone, address: before.address },
    after: { email: p.email, phone: p.phone, address: p.address },
  });
  return p;
}

// ---- Ownership stakes (effective-dated) ----

export async function currentStakesForUnit(unitId: string, asOf: Date = new Date()) {
  return prisma.ownershipStake.findMany({
    where: {
      unitId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    include: { owner: true },
  });
}

export async function addOwnershipStake(
  actor: Actor,
  data: { unitId: string; ownerId: string; sharePercent: string; validFrom: Date; acquisitionNote?: string | null }
) {
  requireRole(actor, "PRESIDENT");
  const share = dec(data.sharePercent);
  if (share.lessThanOrEqualTo(0) || share.greaterThan(100)) {
    throw new Error("Udio mora biti u rasponu (0, 100].");
  }
  const existing = await currentStakesForUnit(data.unitId, data.validFrom);
  const sum = existing.reduce((a, s) => a.plus(dec(s.sharePercent.toString())), share);
  if (sum.greaterThan(dec(100).plus(dec("0.0001")))) {
    throw new Error(`Zbir udjela za jedinicu prelazi 100% (${sum.toFixed(4)}%).`);
  }
  const stake = await prisma.ownershipStake.create({ data });
  await audit(actor, {
    action: "ownership.stake.add", targetType: "OwnershipStake", targetId: stake.id,
    after: { unitId: data.unitId, ownerId: data.ownerId, sharePercent: data.sharePercent, validFrom: data.validFrom.toISOString() },
  });
  return stake;
}

/**
 * Transfer ownership of a unit with an effective date. Historical stakes are
 * closed, never deleted; issued invoices and debts stay with the old owner
 * (see LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §5.4).
 */
export async function transferOwnership(
  actor: Actor,
  data: {
    unitId: string;
    fromOwnerId: string;
    toOwnerId: string;
    effectiveDate: Date;
    note?: string | null;
  }
) {
  requireRole(actor, "PRESIDENT");
  return prisma.$transaction(async (tx) => {
    const stake = await tx.ownershipStake.findFirst({
      where: { unitId: data.unitId, ownerId: data.fromOwnerId, validTo: null },
    });
    if (!stake) throw new Error("Prodavac nema aktivan udio na ovoj jedinici.");
    await tx.ownershipStake.update({
      where: { id: stake.id },
      data: { validTo: data.effectiveDate },
    });
    const newStake = await tx.ownershipStake.create({
      data: {
        unitId: data.unitId,
        ownerId: data.toOwnerId,
        sharePercent: stake.sharePercent,
        validFrom: data.effectiveDate,
        acquisitionNote: data.note ?? null,
      },
    });
    await audit(actor, {
      action: "ownership.transfer",
      targetType: "Unit",
      targetId: data.unitId,
      before: { ownerId: data.fromOwnerId, stakeId: stake.id },
      after: { ownerId: data.toOwnerId, stakeId: newStake.id, effectiveDate: data.effectiveDate.toISOString() },
      reason: data.note ?? undefined,
    }, tx);
    return newStake;
  });
}

// ---- Occupancies ----

export async function setOccupancy(
  actor: Actor,
  data: { unitId: string; partyId: string; type: OccupancyType; headcount: number; validFrom: Date; note?: string | null }
) {
  requireRole(actor, "PRESIDENT");
  const o = await prisma.occupancy.create({ data });
  await audit(actor, { action: "occupancy.create", targetType: "Occupancy", targetId: o.id, after: { unitId: data.unitId, partyId: data.partyId, type: data.type } });
  return o;
}

export async function endOccupancy(actor: Actor, id: string, validTo: Date) {
  requireRole(actor, "PRESIDENT");
  const o = await prisma.occupancy.update({ where: { id }, data: { validTo } });
  await audit(actor, { action: "occupancy.end", targetType: "Occupancy", targetId: id, after: { validTo: validTo.toISOString() } });
  return o;
}

// ---- Proxies ----

export async function grantProxy(
  actor: Actor,
  data: {
    grantorId: string;
    holderId: string;
    scope: ProxyScope;
    meetingId?: string | null;
    proposalId?: string | null;
    documentRef?: string | null;
    validFrom: Date;
    validTo?: Date | null;
  }
) {
  // The president records proxies; an owner may record a proxy they grant themselves.
  if (!actor.roles.includes("PRESIDENT") && actor.partyId !== data.grantorId) {
    throw new ForbiddenError("Punomoć može evidentirati predsjednik ili sam davalac punomoći.");
  }
  if (data.grantorId === data.holderId) throw new Error("Davalac i primalac punomoći ne mogu biti ista osoba.");
  const p = await prisma.proxy.create({ data });
  await audit(actor, {
    action: "proxy.grant", targetType: "Proxy", targetId: p.id,
    after: { grantorId: data.grantorId, holderId: data.holderId, scope: data.scope, meetingId: data.meetingId ?? null },
  });
  return p;
}

export async function revokeProxy(actor: Actor, proxyId: string, reason: string) {
  const proxy = await prisma.proxy.findUniqueOrThrow({ where: { id: proxyId } });
  if (!actor.roles.includes("PRESIDENT") && actor.partyId !== proxy.grantorId) {
    throw new ForbiddenError();
  }
  const p = await prisma.proxy.update({
    where: { id: proxyId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await audit(actor, { action: "proxy.revoke", targetType: "Proxy", targetId: proxyId, reason });
  return p;
}

/** Active proxy for an owner in the context of a meeting/proposal, if any. */
export async function activeProxyFor(ownerId: string, meetingId: string | null, asOf: Date = new Date()) {
  return prisma.proxy.findFirst({
    where: {
      grantorId: ownerId,
      revokedAt: null,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
      AND: [
        {
          OR: [
            { scope: "ALL" },
            ...(meetingId ? [{ scope: "MEETING" as const, meetingId }] : []),
          ],
        },
      ],
    },
    include: { holder: true },
  });
}

// ---- Office terms ----

export async function setOfficeTerm(
  actor: Actor,
  data: { role: "PRESIDENT" | "ACCOUNTANT"; partyId: string; validFrom: Date; validTo?: Date | null; decisionRef?: string | null }
) {
  requireRole(actor, "PRESIDENT");
  const current = await prisma.officeTerm.findFirst({ where: { role: data.role, validTo: null } });
  if (current) {
    await prisma.officeTerm.update({ where: { id: current.id }, data: { validTo: data.validFrom } });
  }
  const term = await prisma.officeTerm.create({ data });
  await audit(actor, {
    action: "office.term.set", targetType: "OfficeTerm", targetId: term.id,
    before: current ? { partyId: current.partyId } : undefined,
    after: { role: data.role, partyId: data.partyId, validFrom: data.validFrom.toISOString() },
  });
  return term;
}

// ---- Organi ZEV: upravni odbor (board) membership ----
//
// PRESIDENT and ACCOUNTANT are single-holder offices (setOfficeTerm above
// closes the previous term). BOARD_MEMBER is multi-holder: several people
// sit on the upravni odbor at once, so adding one must NOT close the others.
// See LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §Organi ZEV for what the law
// establishes here vs. what this app assumes and flags for legal review
// (board size, mandate length, and whether the ZEV "predsjednik" tracked
// above is also predsjednik upravnog odbora).

/** Everyone currently holding a ZEV office: predsjednik, računovođa, upravni odbor. */
export async function listOfficeHolders(actor: Actor, asOf: Date = new Date()) {
  requireAnyUser(actor);
  const terms = await prisma.officeTerm.findMany({
    where: { validFrom: { lte: asOf }, OR: [{ validTo: null }, { validTo: { gt: asOf } }] },
    include: { party: true },
    orderBy: { validFrom: "asc" },
  });
  return {
    president: terms.find((t) => t.role === "PRESIDENT") ?? null,
    accountant: terms.find((t) => t.role === "ACCOUNTANT") ?? null,
    boardMembers: terms.filter((t) => t.role === "BOARD_MEMBER"),
  };
}

/** Full history of office terms (past and present), most recent first. */
export async function listOfficeHistory(actor: Actor) {
  requireAnyUser(actor);
  return prisma.officeTerm.findMany({ include: { party: true }, orderBy: { validFrom: "desc" } });
}

export async function addBoardMember(
  actor: Actor,
  data: { partyId: string; validFrom: Date; decisionRef?: string | null }
) {
  requireRole(actor, "PRESIDENT");
  const already = await prisma.officeTerm.findFirst({
    where: { role: "BOARD_MEMBER", partyId: data.partyId, validTo: null },
  });
  if (already) throw new Error("Ovo lice je već aktivan član upravnog odbora.");
  const term = await prisma.officeTerm.create({
    data: { role: "BOARD_MEMBER", partyId: data.partyId, validFrom: data.validFrom, decisionRef: data.decisionRef ?? null },
  });
  await audit(actor, {
    action: "office.board_member.add", targetType: "OfficeTerm", targetId: term.id,
    after: { partyId: data.partyId, validFrom: data.validFrom.toISOString() },
  });
  return term;
}

export async function endBoardMembership(actor: Actor, termId: string, validTo: Date, reason?: string | null) {
  requireRole(actor, "PRESIDENT");
  const before = await prisma.officeTerm.findUniqueOrThrow({ where: { id: termId } });
  if (before.role !== "BOARD_MEMBER") throw new Error("Ovo nije mandat člana upravnog odbora.");
  if (before.validTo) throw new Error("Mandat je već okončan.");
  const term = await prisma.officeTerm.update({ where: { id: termId }, data: { validTo } });
  await audit(actor, {
    action: "office.board_member.end", targetType: "OfficeTerm", targetId: termId,
    before: { partyId: before.partyId }, reason: reason ?? null,
  });
  return term;
}

/**
 * Voting basis for a sjednica upravnog odbora: current board members
 * (predsjednik + članovi upravnog odbora — računovođa nije glasač po
 * pretpostavci u LEGAL_AND_FINANCIAL_ASSUMPTIONS.md), one head one vote.
 * Shaped like ownersVotingBasis() so it plugs into the same voting engine
 * (use a VotingRule with weightMethod PER_OWNER for board proposals).
 */
export async function boardVotingBasis(asOf: Date = new Date()) {
  const terms = await prisma.officeTerm.findMany({
    where: {
      role: { in: ["PRESIDENT", "BOARD_MEMBER"] },
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    include: { party: true },
  });
  const seen = new Map<string, { ownerId: string; ownerName: string; email: string | null; ownershipShareSum: Decimal; areaSum: Decimal; units: { unitId: string; label: string; stakePercent: string }[] }>();
  for (const t of terms) {
    if (seen.has(t.partyId)) continue; // predsjednik + board term for same party counts once
    seen.set(t.partyId, {
      ownerId: t.partyId,
      ownerName: partyDisplayName(t.party),
      email: t.party.email,
      ownershipShareSum: ZERO,
      areaSum: ZERO,
      units: [],
    });
  }
  return [...seen.values()];
}

// ---- Aggregates used by voting ----

/**
 * Current voting base: for each owner party, the sum of ownership-share
 * percentages (unit share × unit ownershipShare in ZEV) and areas they hold.
 */
export async function ownersVotingBasis(unitIds?: string[], asOf: Date = new Date()) {
  const stakes = await prisma.ownershipStake.findMany({
    where: {
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
      unitId: unitIds ? { in: unitIds } : undefined,
      unit: { active: true },
    },
    include: { unit: true, owner: true },
  });
  const byOwner = new Map<
    string,
    { ownerId: string; ownerName: string; email: string | null; ownershipShareSum: Decimal; areaSum: Decimal; units: { unitId: string; label: string; stakePercent: string }[] }
  >();
  for (const s of stakes) {
    const stakeFraction = dec(s.sharePercent.toString()).div(100);
    const shareContribution = dec(s.unit.ownershipShare.toString()).mul(stakeFraction);
    const areaContribution = dec(s.unit.usableArea.toString()).mul(stakeFraction);
    const cur = byOwner.get(s.ownerId) ?? {
      ownerId: s.ownerId,
      ownerName: partyDisplayName(s.owner),
      email: s.owner.email,
      ownershipShareSum: ZERO,
      areaSum: ZERO,
      units: [],
    };
    cur.ownershipShareSum = cur.ownershipShareSum.plus(shareContribution);
    cur.areaSum = cur.areaSum.plus(areaContribution);
    cur.units.push({ unitId: s.unitId, label: s.unit.label, stakePercent: s.sharePercent.toString() });
    byOwner.set(s.ownerId, cur);
  }
  return [...byOwner.values()];
}

export async function requireOwnerParty(actor: Actor) {
  requireAnyUser(actor);
  if (!actor.partyId) throw new ForbiddenError("Nalog nije povezan sa licem.");
  return actor.partyId;
}
