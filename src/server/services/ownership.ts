// Parties, effective-dated ownership stakes, occupancies, proxies, office terms.
// History is never rewritten: an ownership change closes the old stake
// (validTo) and opens a new one (validFrom).
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { emailAddressSchema } from "@/lib/emailAddress";
import { requireRole, requireSelfOrRole, requireAnyUser, requireZev, ForbiddenError, type Actor } from "@/server/auth/guards";
import { dec, ZERO, type Decimal } from "@/lib/money";
import { createLinkedAttachmentTx, type UploadInput } from "@/server/services/attachments";
import { unitsInScope } from "@/server/services/property";
import type { PartyKind, OccupancyType, ProxyScope, Prisma } from "@/generated/prisma/client";

/** The proof-of-ownership document a president must attach whenever a new stake is opened. */
export type OwnershipProofInput = Pick<UploadInput, "buffer" | "filename" | "mime">;

export function partyDisplayName(p: { kind: PartyKind; firstName: string | null; lastName: string | null; orgName: string | null }): string {
  return p.kind === "PERSON"
    ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()
    : p.orgName ?? "";
}

// ---- Parties ----

export async function listParties(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return prisma.party.findMany({
    where: { zevId: requireZev(actor), active: true },
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
    where: { id: partyId, zevId: requireZev(actor) },
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
  const zevId = requireZev(actor);
  const p = await prisma.party.create({ data: { ...data, zevId } });
  await audit(actor, { action: "party.create", targetType: "Party", targetId: p.id, after: { name: partyDisplayName(p), kind: p.kind } });
  return p;
}

export async function updateParty(actor: Actor, id: string, data: Prisma.PartyUpdateInput) {
  requireSelfOrRole(actor, id, "PRESIDENT");
  const zevId = requireZev(actor);
  const before = await prisma.party.findUniqueOrThrow({ where: { id, zevId } });
  // Owners may update their own contact data only.
  if (actor.partyId === id && !actor.roles.includes("PRESIDENT")) {
    const allowed = new Set(["email", "phone", "correspondenceAddress"]);
    for (const k of Object.keys(data)) {
      if (!allowed.has(k)) throw new ForbiddenError("Možete mijenjati samo svoje kontakt podatke.");
    }
  }
  // While invoice e-mail delivery is on, Party.email is where the invoice PDFs go, so it may not be
  // blanked or broken (Plans/invoice-email-delivery-plan.md R1). Changing it to another valid
  // address is fine and keeps the option on; the change is in the party.update audit below.
  if (before.invoiceEmailDelivery && data.email !== undefined && data.email !== before.email) {
    const next = typeof data.email === "string" ? data.email.trim() : "";
    if (!next) throw new Error("Dok je uključena dostava računa e-poštom, e-mail adresa ne može biti prazna. Prvo isključite dostavu računa.");
    if (!emailAddressSchema.safeParse(next).success) throw new Error("Unesite ispravnu e-mail adresu.");
  }
  const p = await prisma.party.update({ where: { id, zevId }, data });
  await audit(actor, {
    action: "party.update", targetType: "Party", targetId: id,
    before: { email: before.email, phone: before.phone, address: before.address },
    after: { email: p.email, phone: p.phone, address: p.address },
  });
  return p;
}

// ---- Ownership stakes (effective-dated) ----

export async function currentStakesForUnit(zevId: string, unitId: string, asOf: Date = new Date()) {
  return prisma.ownershipStake.findMany({
    where: {
      zevId,
      unitId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    include: { owner: true },
  });
}

/** K-02: vlasnici se upisuju tek kad je registar posebnih dijelova utvrdjen (ili "Za provjeru" — FR-Q4). */
async function assertRegisterOpenForOwners(zevId: string) {
  const zev = await prisma.zev.findUniqueOrThrow({ where: { id: zevId }, select: { unitRegisterStatus: true } });
  if (zev.unitRegisterStatus === "DRAFT") throw new Error("Prvo utvrdite registar posebnih dijelova.");
}

/**
 * Adding a stake without proof of ownership (a sale contract, a land-registry excerpt...) is
 * refused outright — proof is not optional metadata, it's the evidence the stake itself rests
 * on. The stake and its proof Attachment are created in one transaction: either both exist or
 * neither does.
 */
export async function addOwnershipStake(
  actor: Actor,
  data: { unitId: string; ownerId: string; sharePercent: string; validFrom: Date; acquisitionNote?: string | null },
  proof: OwnershipProofInput
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (!proof || !proof.buffer || proof.buffer.length === 0) {
    throw new Error("Dokaz o vlasništvu (dokument) je obavezan za dodavanje vlasničkog udjela.");
  }
  await assertRegisterOpenForOwners(zevId);
  await prisma.unit.findUniqueOrThrow({ where: { id: data.unitId, zevId } });
  await prisma.party.findUniqueOrThrow({ where: { id: data.ownerId, zevId } });
  const share = dec(data.sharePercent);
  if (share.lessThanOrEqualTo(0) || share.greaterThan(100)) {
    throw new Error("Udio mora biti u rasponu (0, 100].");
  }
  // K-01a: zbir udjela na jedinici (ispod ili iznad 100%) ne blokira upis — vraca se kao upozorenje
  // (unitShareSum), a iznad 100% blokira tek otvaranje glasanja (K-01b).
  const existing = await currentStakesForUnit(zevId, data.unitId, data.validFrom);
  const unitShareSum = existing.reduce((a, s) => a.plus(dec(s.sharePercent.toString())), share);
  const stake = await prisma.$transaction(async (tx) => {
    const s = await tx.ownershipStake.create({ data: { ...data, zevId } });
    await createLinkedAttachmentTx(tx, actor, {
      ...proof,
      category: "OWNERSHIP_PROOF",
      linkedType: "OwnershipStake",
      linkedId: s.id,
    });
    await audit(actor, {
      action: "ownership.stake.add", targetType: "OwnershipStake", targetId: s.id,
      after: { unitId: data.unitId, ownerId: data.ownerId, sharePercent: data.sharePercent, validFrom: data.validFrom.toISOString() },
    }, tx);
    return s;
  });
  return { stake, unitShareSum };
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
  },
  proof: OwnershipProofInput
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (!proof || !proof.buffer || proof.buffer.length === 0) {
    throw new Error("Dokaz o vlasništvu (dokument) je obavezan za promjenu vlasništva.");
  }
  await assertRegisterOpenForOwners(zevId);
  await prisma.party.findUniqueOrThrow({ where: { id: data.toOwnerId, zevId } });
  return prisma.$transaction(async (tx) => {
    const stake = await tx.ownershipStake.findFirst({
      where: { zevId, unitId: data.unitId, ownerId: data.fromOwnerId, validTo: null },
    });
    if (!stake) throw new Error("Prodavac nema aktivan udio na ovoj jedinici.");
    await tx.ownershipStake.update({
      where: { id: stake.id, zevId },
      data: { validTo: data.effectiveDate },
    });
    const newStake = await tx.ownershipStake.create({
      data: {
        zevId,
        unitId: data.unitId,
        ownerId: data.toOwnerId,
        sharePercent: stake.sharePercent,
        validFrom: data.effectiveDate,
        acquisitionNote: data.note ?? null,
      },
    });
    await createLinkedAttachmentTx(tx, actor, {
      ...proof,
      category: "OWNERSHIP_PROOF",
      linkedType: "OwnershipStake",
      linkedId: newStake.id,
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
  const zevId = requireZev(actor);
  await prisma.unit.findUniqueOrThrow({ where: { id: data.unitId, zevId } });
  await prisma.party.findUniqueOrThrow({ where: { id: data.partyId, zevId } });
  const o = await prisma.occupancy.create({ data: { ...data, zevId } });
  await audit(actor, { action: "occupancy.create", targetType: "Occupancy", targetId: o.id, after: { unitId: data.unitId, partyId: data.partyId, type: data.type } });
  return o;
}

export async function endOccupancy(actor: Actor, id: string, validTo: Date) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const o = await prisma.occupancy.update({ where: { id, zevId }, data: { validTo } });
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
  const zevId = requireZev(actor);
  // The president records proxies; an owner may record a proxy they grant themselves.
  if (!actor.roles.includes("PRESIDENT") && actor.partyId !== data.grantorId) {
    throw new ForbiddenError("Punomoć može evidentirati predsjednik ili sam davalac punomoći.");
  }
  if (data.grantorId === data.holderId) throw new Error("Davalac i primalac punomoći ne mogu biti ista osoba.");
  await prisma.party.findUniqueOrThrow({ where: { id: data.grantorId, zevId } });
  await prisma.party.findUniqueOrThrow({ where: { id: data.holderId, zevId } });
  if (data.meetingId) await prisma.meeting.findUniqueOrThrow({ where: { id: data.meetingId, zevId } });
  const p = await prisma.proxy.create({ data: { ...data, zevId } });
  await audit(actor, {
    action: "proxy.grant", targetType: "Proxy", targetId: p.id,
    after: { grantorId: data.grantorId, holderId: data.holderId, scope: data.scope, meetingId: data.meetingId ?? null },
  });
  return p;
}

export async function revokeProxy(actor: Actor, proxyId: string, reason: string) {
  const zevId = requireZev(actor);
  const proxy = await prisma.proxy.findUniqueOrThrow({ where: { id: proxyId, zevId } });
  if (!actor.roles.includes("PRESIDENT") && actor.partyId !== proxy.grantorId) {
    throw new ForbiddenError();
  }
  const p = await prisma.proxy.update({
    where: { id: proxyId, zevId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await audit(actor, { action: "proxy.revoke", targetType: "Proxy", targetId: proxyId, reason });
  return p;
}

/** Active proxy for an owner in the context of a meeting/proposal, if any. */
export async function activeProxyFor(zevId: string, ownerId: string, meetingId: string | null, asOf: Date = new Date()) {
  return prisma.proxy.findFirst({
    where: {
      zevId,
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

/** Bulk variant of activeProxyFor for a batch of owners in one query
 *  (Plans/live-meeting-mode-plan.md §3.2 "punomoćnik, inline", Faza 4) — the roll-call
 *  screen is re-fetched every ~10s (Faza 3's LiveRefresh), so a per-owner N+1 here would
 *  break the "jedan set upita" rule getLiveMeetingState already follows for the same
 *  reason. Same filter as activeProxyFor, applied once for the whole batch; if an owner
 *  somehow matches more than one proxy, the first one found wins — same "arbitrary but
 *  consistent" behavior as activeProxyFor's own findFirst. */
export async function activeProxiesFor(
  zevId: string, ownerIds: string[], meetingId: string | null, asOf: Date = new Date()
): Promise<Map<string, { id: string; holderId: string; holderName: string }>> {
  const byOwner = new Map<string, { id: string; holderId: string; holderName: string }>();
  if (ownerIds.length === 0) return byOwner;
  const proxies = await prisma.proxy.findMany({
    where: {
      zevId,
      grantorId: { in: ownerIds },
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
  for (const p of proxies) {
    if (!byOwner.has(p.grantorId)) {
      byOwner.set(p.grantorId, { id: p.id, holderId: p.holderId, holderName: partyDisplayName(p.holder) });
    }
  }
  return byOwner;
}

// ---- Office terms ----

export async function setOfficeTerm(
  actor: Actor,
  data: { role: "PRESIDENT" | "ACCOUNTANT"; partyId: string; validFrom: Date; validTo?: Date | null; decisionRef?: string | null }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  await prisma.party.findUniqueOrThrow({ where: { id: data.partyId, zevId } });
  const current = await prisma.officeTerm.findFirst({ where: { zevId, role: data.role, validTo: null } });
  if (current) {
    await prisma.officeTerm.update({ where: { id: current.id, zevId }, data: { validTo: data.validFrom } });
  }
  const term = await prisma.officeTerm.create({ data: { ...data, zevId } });
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
    where: { zevId: requireZev(actor), validFrom: { lte: asOf }, OR: [{ validTo: null }, { validTo: { gt: asOf } }] },
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
  return prisma.officeTerm.findMany({
    where: { zevId: requireZev(actor) },
    include: { party: true },
    orderBy: { validFrom: "desc" },
  });
}

export async function addBoardMember(
  actor: Actor,
  data: { partyId: string; validFrom: Date; decisionRef?: string | null }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  await prisma.party.findUniqueOrThrow({ where: { id: data.partyId, zevId } });
  const already = await prisma.officeTerm.findFirst({
    where: { zevId, role: "BOARD_MEMBER", partyId: data.partyId, validTo: null },
  });
  if (already) throw new Error("Ovo lice je već aktivan član upravnog odbora.");
  const term = await prisma.officeTerm.create({
    data: { zevId, role: "BOARD_MEMBER", partyId: data.partyId, validFrom: data.validFrom, decisionRef: data.decisionRef ?? null },
  });
  await audit(actor, {
    action: "office.board_member.add", targetType: "OfficeTerm", targetId: term.id,
    after: { partyId: data.partyId, validFrom: data.validFrom.toISOString() },
  });
  return term;
}

export async function endBoardMembership(actor: Actor, termId: string, validTo: Date, reason?: string | null) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const before = await prisma.officeTerm.findUniqueOrThrow({ where: { id: termId, zevId } });
  if (before.role !== "BOARD_MEMBER") throw new Error("Ovo nije mandat člana upravnog odbora.");
  if (before.validTo) throw new Error("Mandat je već okončan.");
  const term = await prisma.officeTerm.update({ where: { id: termId, zevId }, data: { validTo } });
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
export async function boardVotingBasis(zevId: string, asOf: Date = new Date()): Promise<VotingSubject[]> {
  const terms = await prisma.officeTerm.findMany({
    where: {
      zevId,
      role: { in: ["PRESIDENT", "BOARD_MEMBER"] },
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    include: { party: true },
  });
  const seen = new Map<string, VotingSubject>();
  for (const t of terms) {
    if (seen.has(t.partyId)) continue; // predsjednik + board term for same party counts once
    seen.set(t.partyId, {
      subjectKey: `B:${t.partyId}`,
      ownerId: t.partyId,
      ownerName: partyDisplayName(t.party),
      email: t.party.email,
      memberPartyIds: [t.partyId],
      members: [{ partyId: t.partyId, name: partyDisplayName(t.party) }],
      ownershipShareSum: ZERO,
      areaSum: ZERO,
      units: [],
      representativeConfirmed: true,
      representativeConflict: false,
    });
  }
  return [...seen.values()];
}

// ---- Aggregates used by voting ----

/** Jedan glasacki subjekt (K-03/K-03a): samostalni vlasnik, suvlasnicka zajednica ili clan odbora. */
export type VotingSubject = {
  /** "P:<partyId>" | "G:<sortirani partyId-jevi>" | "B:<partyId>" — vidi subjectKeyFor. */
  subjectKey: string;
  /** Lice koje glasa: samostalni vlasnik ili zajednicki predstavnik. */
  ownerId: string;
  /** "Ana Savic" ili "Nikola Ilic i Sara Ilic". */
  ownerName: string;
  /** E-mail lica koje glasa. */
  email: string | null;
  memberPartyIds: string[];
  members: { partyId: string; name: string }[];
  units: { unitId: string; label: string; stakePercent: string }[];
  /** Ostaju radi kompatibilnosti (zapis u EligibleVoter.basis); od K-03 se ne koriste za tezinu. */
  ownershipShareSum: Decimal;
  areaSum: Decimal;
  /** Predstavnik je izricito odredjen (inace je podrazumijevani — "nije potvrdjen"). Za samostalnog: true. */
  representativeConfirmed: boolean;
  /** Jedinice istog skupa vlasnika imaju razlicite predstavnike (preduslov: upozorenje). */
  representativeConflict: boolean;
};

/**
 * K-03b: JEDINO mjesto koje odlucuje u koji glasacki subjekt spada skup vlasnika jedne jedinice.
 * Jedan vlasnik jedinice = samostalni subjekt "P:<id>" (sve takve jedinice istog lica su jedan subjekt);
 * vise vlasnika = zajednica "G:<sortirani ids>" (jedinice sa istim skupom su jedan subjekt).
 * Isto lice moze biti i u "P:" i u "G:" subjektu (dva glasa) — preporuka pregleda; ako pravnik
 * odgovori "jedan glas po licu", mijenja se samo ova funkcija.
 */
export function subjectKeyFor(ownerIds: string[]): string {
  const ids = [...new Set(ownerIds)].sort();
  return ids.length === 1 ? `P:${ids[0]}` : `G:${ids.join(",")}`;
}

type StakeWithRefs = Prisma.OwnershipStakeGetPayload<{ include: { unit: true; owner: true } }>;

/** Podrazumijevani predstavnik: najveci udio, pa raniji validFrom, pa raniji createdAt (pa id). */
function defaultRepresentative(stakes: StakeWithRefs[]): StakeWithRefs {
  return [...stakes].sort((a, b) => {
    const byShare = dec(b.sharePercent.toString()).comparedTo(dec(a.sharePercent.toString()));
    if (byShare !== 0) return byShare;
    const byFrom = a.validFrom.getTime() - b.validFrom.getTime();
    if (byFrom !== 0) return byFrom;
    const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
    if (byCreated !== 0) return byCreated;
    return a.ownerId.localeCompare(b.ownerId);
  })[0];
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} i ${names[names.length - 1]}`;
}

/**
 * Glasacki subjekti skupstine (K-03, K-03a): jedan etazni vlasnik = jedan glas, bez obzira na broj
 * posebnih dijelova; suvlasnici istog posebnog dijela glasaju zajedno preko predstavnika.
 * Jedino mjesto koje odlucuje "ko je u bazi" za prozivku, pregled dostave i otvaranje glasanja.
 */
export async function assemblyVotingSubjects(zevId: string, unitIds?: string[], asOf: Date = new Date()): Promise<VotingSubject[]> {
  const stakes = await prisma.ownershipStake.findMany({
    where: {
      zevId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
      unitId: unitIds ? { in: unitIds } : undefined,
      unit: { active: true },
    },
    include: { unit: true, owner: true },
  });
  const byUnit = new Map<string, StakeWithRefs[]>();
  for (const s of stakes) byUnit.set(s.unitId, [...(byUnit.get(s.unitId) ?? []), s]);

  type Acc = { key: string; unitStakes: StakeWithRefs[][] };
  const subjects = new Map<string, Acc>();
  for (const unitStakes of byUnit.values()) {
    const key = subjectKeyFor(unitStakes.map((s) => s.ownerId));
    const acc = subjects.get(key) ?? { key, unitStakes: [] };
    acc.unitStakes.push(unitStakes);
    subjects.set(key, acc);
  }

  const out: VotingSubject[] = [];
  for (const { key, unitStakes } of subjects.values()) {
    const sortedUnits = [...unitStakes].sort((a, b) => a[0].unit.label.localeCompare(b[0].unit.label, "sr"));
    const memberIds = key.slice(2).split(",");
    const partyById = new Map<string, StakeWithRefs["owner"]>();
    for (const us of sortedUnits) for (const s of us) partyById.set(s.ownerId, s.owner);
    const members = memberIds
      .map((id) => ({ partyId: id, name: partyDisplayName(partyById.get(id)!) }))
      .sort((a, b) => a.name.localeCompare(b.name, "sr"));

    let repId: string;
    let confirmed: boolean;
    let conflict = false;
    if (key.startsWith("P:")) {
      repId = memberIds[0];
      confirmed = true;
    } else {
      // Predstavnik zajednice sa vise posebnih dijelova: uzima se jedinica sa najmanjom oznakom; ako se
      // predstavnici jedinica razlikuju, to je upozorenje u preduslovima (§3.3).
      const perUnit = sortedUnits.map((us) => {
        const explicit = us[0].unit.votingRepresentativeId;
        const valid = explicit && us.some((s) => s.ownerId === explicit) ? explicit : null;
        return { repId: valid ?? defaultRepresentative(us).ownerId, explicit: valid !== null };
      });
      repId = perUnit[0].repId;
      confirmed = perUnit.every((p) => p.explicit) && perUnit.every((p) => p.repId === repId);
      conflict = perUnit.some((p) => p.repId !== repId);
    }
    const rep = partyById.get(repId)!;

    let shareSum = ZERO;
    let areaSum = ZERO;
    const units: VotingSubject["units"] = [];
    for (const us of sortedUnits) {
      for (const s of us) {
        const fraction = dec(s.sharePercent.toString()).div(100);
        shareSum = shareSum.plus(dec(s.unit.ownershipShare.toString()).mul(fraction));
        areaSum = areaSum.plus(dec(s.unit.usableArea.toString()).mul(fraction));
      }
      const repStake = us.find((s) => s.ownerId === repId) ?? us[0];
      units.push({ unitId: us[0].unitId, label: us[0].unit.label, stakePercent: repStake.sharePercent.toString() });
    }

    out.push({
      subjectKey: key,
      ownerId: repId,
      ownerName: joinNames(members.map((m) => m.name)),
      email: rep.email,
      memberPartyIds: key.startsWith("P:") ? [repId] : [...memberIds].sort(),
      members,
      units,
      ownershipShareSum: shareSum,
      areaSum,
      representativeConfirmed: confirmed,
      representativeConflict: conflict,
    });
  }
  return out.sort((a, b) => a.ownerName.localeCompare(b.ownerName, "sr") || a.subjectKey.localeCompare(b.subjectKey));
}

export type UnitOwnershipWarning = {
  unitId: string;
  label: string;
  /** NONE = nema nijednog aktivnog udjela; UNDER/OVER = zbir udjela ispod/iznad 100%. */
  kind: "NONE" | "UNDER" | "OVER";
  /** Zbir udjela (%) aktivnih vlasnika jedinice. */
  sum: Decimal;
};

/**
 * Jedinice sa zbirom vlasnickih udjela razlicitim od 100% i jedinice bez ijednog aktivnog udjela
 * (K-01a: samo upozorenje; K-01b: OVER blokira otvaranje glasanja). Koristi ga registar, tab
 * "Vlasnistvo" i preduslovi glasanja.
 */
export async function unitOwnershipWarnings(zevId: string, unitIds?: string[], asOf: Date = new Date()): Promise<UnitOwnershipWarning[]> {
  const units = await prisma.unit.findMany({
    where: { zevId, active: true, id: unitIds ? { in: unitIds } : undefined },
    orderBy: { label: "asc" },
  });
  const stakes = await prisma.ownershipStake.findMany({
    where: {
      zevId,
      unitId: { in: units.map((u) => u.id) },
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    select: { unitId: true, sharePercent: true },
  });
  const sums = new Map<string, Decimal>();
  const counts = new Map<string, number>();
  for (const s of stakes) {
    sums.set(s.unitId, (sums.get(s.unitId) ?? ZERO).plus(dec(s.sharePercent.toString())));
    counts.set(s.unitId, (counts.get(s.unitId) ?? 0) + 1);
  }
  const out: UnitOwnershipWarning[] = [];
  for (const u of units) {
    const sum = sums.get(u.id) ?? ZERO;
    if (!counts.get(u.id)) out.push({ unitId: u.id, label: u.label, kind: "NONE", sum });
    else if (sum.greaterThan(dec(100).plus("0.0001"))) out.push({ unitId: u.id, label: u.label, kind: "OVER", sum });
    else if (sum.lessThan(dec(100).minus("0.0001"))) out.push({ unitId: u.id, label: u.label, kind: "UNDER", sum });
  }
  return out;
}

/**
 * Zajednicki predstavnik suvlasnika za glasanje (K-03a). Postavlja se na SVIM aktivnim jedinicama sa istim
 * skupom trenutnih vlasnika, da zajednica sa vise posebnih dijelova ima jednog predstavnika.
 * Zabranjeno dok traje glasanje o prijedlogu ciji obuhvat ukljucuje te jedinice.
 */
export async function setVotingRepresentative(
  actor: Actor,
  unitId: string,
  partyId: string,
  opts: { note?: string | null } = {},
  document?: OwnershipProofInput
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  await prisma.unit.findUniqueOrThrow({ where: { id: unitId, zevId } });
  const stakes = await prisma.ownershipStake.findMany({
    where: { zevId, validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }], unit: { active: true } },
    include: { unit: true },
  });
  const byUnit = new Map<string, string[]>();
  for (const s of stakes) byUnit.set(s.unitId, [...(byUnit.get(s.unitId) ?? []), s.ownerId]);
  const owners = byUnit.get(unitId) ?? [];
  if (new Set(owners).size < 2) throw new Error("Zajednički predstavnik se određuje samo za posebni dio sa više suvlasnika.");
  if (!owners.includes(partyId)) throw new Error("Predstavnik mora biti suvlasnik ovog posebnog dijela (imati aktivan udio).");
  const key = subjectKeyFor(owners);
  const sameSetUnitIds = [...byUnit.entries()].filter(([, o]) => subjectKeyFor(o) === key).map(([id]) => id);

  // Zabrana tokom glasanja: obuhvat bilo kog otvorenog prijedloga skupstine dodiruje te jedinice.
  const open = await prisma.proposal.findMany({
    where: { zevId, status: "VOTING_OPEN", meeting: { body: "ASSEMBLY" } },
    include: { scopeUnits: true },
  });
  for (const p of open) {
    const inScope = p.scopeType === "ZEV"
      ? sameSetUnitIds
      : (await unitsInScope(zevId, {
          scopeType: p.scopeType, buildingId: p.buildingId, entranceId: p.entranceId,
          allocationGroupId: p.allocationGroupId, unitIds: p.scopeUnits.map((x) => x.unitId),
        })).map((u) => u.id).filter((id) => sameSetUnitIds.includes(id));
    if (inScope.length > 0) {
      throw new Error(`Predstavnik se ne može mijenjati dok traje glasanje o ${p.code} — zamrznuta osnova se ne mijenja.`);
    }
  }

  const before = await prisma.unit.findMany({ where: { id: { in: sameSetUnitIds }, zevId }, select: { id: true, label: true, votingRepresentativeId: true } });
  return prisma.$transaction(async (tx) => {
    await tx.unit.updateMany({ where: { id: { in: sameSetUnitIds }, zevId }, data: { votingRepresentativeId: partyId } });
    if (document) {
      await createLinkedAttachmentTx(tx, actor, { ...document, category: "OTHER", linkedType: "Unit", linkedId: unitId });
    }
    await audit(actor, {
      action: "unit.voting_representative.set", targetType: "Unit", targetId: unitId,
      before: { units: before.map((u) => ({ unitId: u.id, label: u.label, representativeId: u.votingRepresentativeId })) },
      after: { units: before.map((u) => ({ unitId: u.id, label: u.label, representativeId: partyId })) },
      reason: opts.note ?? null,
    }, tx);
    return { unitIds: sameSetUnitIds, representativeId: partyId };
  });
}

/**
 * Kako party glasa za svaku svoju jedinicu (K-03a), za detalj vlasnika: samostalni vlasnik ili suvlasnik
 * ("glasa {predstavnik}"). Mapa: unitId -> opis.
 */
export async function votingRoleByUnit(actor: Actor, partyId: string) {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const subjects = await assemblyVotingSubjects(zevId);
  const out = new Map<string, { sole: boolean; representativeName: string | null; isRepresentative: boolean; confirmed: boolean }>();
  for (const sub of subjects) {
    if (!sub.memberPartyIds.includes(partyId)) continue;
    const sole = sub.memberPartyIds.length === 1;
    for (const u of sub.units) {
      out.set(u.unitId, {
        sole,
        representativeName: sole ? null : sub.members.find((m) => m.partyId === sub.ownerId)?.name ?? null,
        isRepresentative: sub.ownerId === partyId,
        confirmed: sub.representativeConfirmed,
      });
    }
  }
  return out;
}

export async function requireOwnerParty(actor: Actor) {
  requireAnyUser(actor);
  if (!actor.partyId) throw new ForbiddenError("Nalog nije povezan sa licem.");
  return actor.partyId;
}
