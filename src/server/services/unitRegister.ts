// Registar posebnih dijelova (FR, K-02): ZEV prvo utvrdi tacan i konacan registar, tek onda se
// upisuju vlasnici i otvara glasanje. Utvrdjen registar se mijenja samo kroz changeUnitRegister
// (razlog + dokument, nova verzija, zabranjeno dok traje glasanje — FR-Q3).
// Plans/fr-registar-i-glasanje-po-etaznim-vlasnicima-plan.md §3.1.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireZev, type Actor } from "@/server/auth/guards";
import { dec } from "@/lib/money";
import { formatDate } from "@/lib/i18n";
import { createLinkedAttachmentTx, type UploadInput } from "@/server/services/attachments";
import { assemblyVotingBasis, unitOwnershipWarnings } from "@/server/services/ownership";
import { registerPreconditions, sharesSum, sumIsHundred } from "@/lib/registerRules";
import type { Prisma, UnitType, UnitRegisterChangeKind, UnitRegisterStatus } from "@/generated/prisma/client";


export type UnitSnapshot = {
  id: string;
  label: string;
  type: UnitType;
  floor: number | null;
  usableArea: string;
  ownershipShare: string;
  buildingId: string;
  entranceId: string | null;
  active: boolean;
};

type UnitRow = {
  id: string; label: string; type: UnitType; floor: number | null;
  usableArea: Prisma.Decimal | string; ownershipShare: Prisma.Decimal | string;
  buildingId: string; entranceId: string | null; active: boolean;
};

export function snapshotUnit(u: UnitRow): UnitSnapshot {
  return {
    id: u.id, label: u.label, type: u.type, floor: u.floor,
    usableArea: u.usableArea.toString(), ownershipShare: u.ownershipShare.toString(),
    buildingId: u.buildingId, entranceId: u.entranceId, active: u.active,
  };
}

export type NewUnitInput = {
  buildingId: string;
  entranceId?: string | null;
  type: UnitType;
  label: string;
  floor?: number | null;
  usableArea: string;
  ownershipShare: string;
  occupantCount?: number;
  typeCoefficient?: string;
};

type ShareAdjustment = { unitId: string; ownershipShare: string };

/** Izmjena utvrdjenog registra (§3.1). `shareAdjustments` omogucava da zbir udjela ostane 100%. */
export type RegisterChangeInput =
  | { kind: "ADD_UNIT"; reason: string; unit: NewUnitInput; shareAdjustments?: ShareAdjustment[] }
  | { kind: "RETIRE_UNIT"; reason: string; unitId: string; shareAdjustments?: ShareAdjustment[] }
  | { kind: "MERGE_SPLIT"; reason: string; retireUnitIds: string[]; addUnits: NewUnitInput[]; shareAdjustments?: ShareAdjustment[] }
  | { kind: "CHANGE_AREA"; reason: string; unitId: string; usableArea: string }
  | { kind: "CHANGE_SHARE"; reason: string; shares: ShareAdjustment[] }
  | { kind: "CHANGE_LABEL"; reason: string; unitId: string; label: string }
  | { kind: "CHANGE_TYPE"; reason: string; unitId: string; type: UnitType };

export type RegisterDocumentInput = Pick<UploadInput, "buffer" | "filename" | "mime">;

// Pravila registra su čiste funkcije u src/lib/registerRules.ts (dijele ih servis i nacrt onboardinga).
export { registerPreconditions, type RegisterPrecondition, type RegisterPreconditionUnit } from "@/lib/registerRules";

/** Stanje, verzija, sazetak, preduslovi, glasacki subjekti, upozorenja o udjelima i istorija registra. */
export async function getUnitRegister(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const [zev, units, history, basis, warnings] = await Promise.all([
    prisma.zev.findUniqueOrThrow({ where: { id: zevId } }),
    prisma.unit.findMany({ where: { zevId }, orderBy: { label: "asc" } }),
    prisma.unitRegisterChange.findMany({ where: { zevId }, orderBy: { version: "desc" } }),
    assemblyVotingBasis(zevId),
    unitOwnershipWarnings(zevId),
  ]);
  const { subjects, absorbed } = basis;
  const active = units.filter((u) => u.active);
  const byType: Record<string, number> = {};
  for (const u of active) byType[u.type] = (byType[u.type] ?? 0) + 1;
  return {
    status: zev.unitRegisterStatus as UnitRegisterStatus,
    version: zev.unitRegisterVersion,
    establishedAt: zev.unitRegisterEstablishedAt,
    summary: {
      unitCount: active.length,
      byType,
      shareSum: sharesSum(active.map((u) => u.ownershipShare)).toFixed(2),
      areaSum: sharesSum(active.map((u) => u.usableArea)).toFixed(2),
      /** Broj glasova = glasackih subjekata (samostalni vlasnici + suvlasnicke zajednice koje nisu K-03b "upijene"). */
      votes: subjects.length,
      /** Broj razlicitih lica u svim subjektima. */
      persons: new Set(subjects.flatMap((s) => s.memberPartyIds)).size,
      unitsWithoutOwner: warnings.filter((w) => w.kind === "NONE").length,
    },
    preconditions: registerPreconditions(units),
    subjects,
    /** K-03b: zajednice ciji svi clanovi vec glasaju kao samostalni vlasnici (bez dodatnog glasa). */
    absorbed,
    warnings,
    history,
  };
}

/** Prijedlog u glasanju koji zabranjuje izmjenu registra (FR-Q3), ili null — za stranicu "Izmjena registra". */
export async function registerChangeBlocker(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  return prisma.proposal.findFirst({
    where: { zevId, status: "VOTING_OPEN" },
    orderBy: { votingClosesAt: "asc" },
    select: { id: true, code: true, votingClosesAt: true },
  });
}

/** Utvrdi registar (iz DRAFT ili REVIEW). Preduslovi: bar jedna jedinica, oznaka/vrsta/povrsina, zbir udjela 100%. */
export async function establishUnitRegister(actor: Actor, input: { reason?: string | null } = {}) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  return prisma.$transaction(async (tx) => {
    const zev = await tx.zev.findUniqueOrThrow({ where: { id: zevId } });
    if (zev.unitRegisterStatus === "ESTABLISHED") throw new Error("Registar posebnih dijelova je već utvrđen.");
    const units = await tx.unit.findMany({ where: { zevId }, orderBy: { label: "asc" } });
    const failed = registerPreconditions(units).filter((p) => !p.ok);
    if (failed.length > 0) throw new Error(`Registar se ne može utvrditi: ${failed.map((p) => p.text).join(" ")}`);

    const version = zev.unitRegisterVersion + 1;
    const snapshot = units.filter((u) => u.active).map(snapshotUnit);
    await tx.unitRegisterChange.create({
      data: {
        zevId, version, kind: "ESTABLISH",
        reason: input.reason?.trim() || "Utvrđivanje registra",
        before: { status: zev.unitRegisterStatus, version: zev.unitRegisterVersion } as unknown as Prisma.InputJsonValue,
        after: snapshot as unknown as Prisma.InputJsonValue,
        actorId: actor.userId,
      },
    });
    const updated = await tx.zev.update({
      where: { id: zevId },
      data: { unitRegisterStatus: "ESTABLISHED", unitRegisterVersion: version, unitRegisterEstablishedAt: new Date() },
    });
    await audit(actor, {
      action: "unit_register.establish", targetType: "Zev", targetId: zevId,
      before: { status: zev.unitRegisterStatus, version: zev.unitRegisterVersion },
      after: { status: "ESTABLISHED", version, unitCount: snapshot.length },
      reason: input.reason?.trim() || null,
    }, tx);
    return updated;
  });
}

/**
 * Izmjena utvrdjenog registra (FR-Q3): samo predsjednik, samo u ESTABLISHED, obavezan razlog i dokument,
 * zabranjena dok je bilo koji prijedlog ZEV-a u glasanju, zbir udjela mora ostati 100%.
 * Nova verzija registra + UnitRegisterChange + Attachment + audit u jednoj transakciji.
 */
export async function changeUnitRegister(actor: Actor, input: RegisterChangeInput, document: RegisterDocumentInput) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const reason = input.reason?.trim();
  if (!reason) throw new Error("Razlog izmjene registra je obavezan.");
  if (!document || !document.buffer || document.buffer.length === 0) {
    throw new Error("Dokument o izmjeni registra je obavezan.");
  }

  return prisma.$transaction(async (tx) => {
    const zev = await tx.zev.findUniqueOrThrow({ where: { id: zevId } });
    if (zev.unitRegisterStatus !== "ESTABLISHED") throw new Error("Registar nije utvrđen — izmjene se rade direktno u tabeli posebnih dijelova.");

    const open = await tx.proposal.findFirst({
      where: { zevId, status: "VOTING_OPEN" },
      orderBy: { votingClosesAt: "asc" },
      select: { code: true, votingClosesAt: true },
    });
    if (open) {
      throw new Error(
        `Izmjena registra nije moguća dok traje glasanje o ${open.code}` +
        (open.votingClosesAt ? ` (do ${formatDate(open.votingClosesAt)}).` : "."),
      );
    }

    const all = await tx.unit.findMany({ where: { zevId } });
    const byId = new Map(all.map((u) => [u.id, u]));
    const activeUnit = (id: string) => {
      const u = byId.get(id);
      if (!u || !u.active) throw new Error("Posebni dio ne postoji ili je već ukinut.");
      return u;
    };

    const before = new Map<string, UnitSnapshot>();
    const after = new Map<string, UnitSnapshot>();
    const touch = (id: string) => { if (!before.has(id)) before.set(id, snapshotUnit(byId.get(id)!)); };
    const applyShares = async (adjustments: ShareAdjustment[] | undefined) => {
      for (const adj of adjustments ?? []) {
        const u = activeUnit(adj.unitId);
        const next = dec(adj.ownershipShare);
        if (next.lessThanOrEqualTo(0) || next.greaterThan(100)) throw new Error("Udio u troškovima mora biti u rasponu (0, 100].");
        touch(u.id);
        const row = await tx.unit.update({ where: { id: u.id, zevId }, data: { ownershipShare: adj.ownershipShare } });
        byId.set(u.id, row);
        after.set(u.id, snapshotUnit(row));
      }
    };
    const addUnit = async (n: NewUnitInput) => {
      await tx.building.findUniqueOrThrow({ where: { id: n.buildingId, zevId } });
      if (n.entranceId) await tx.entrance.findUniqueOrThrow({ where: { id: n.entranceId, zevId } });
      if (!n.label.trim()) throw new Error("Oznaka posebnog dijela je obavezna.");
      if (dec(n.usableArea).lessThanOrEqualTo(0)) throw new Error("Površina mora biti veća od nule.");
      const row = await tx.unit.create({
        data: {
          zevId, buildingId: n.buildingId, entranceId: n.entranceId ?? null, type: n.type, label: n.label.trim(),
          floor: n.floor ?? null, usableArea: n.usableArea, ownershipShare: n.ownershipShare,
          occupantCount: n.occupantCount ?? 0, typeCoefficient: n.typeCoefficient ?? "1",
        },
      });
      byId.set(row.id, row);
      after.set(row.id, snapshotUnit(row));
    };
    const retire = async (id: string) => {
      const u = activeUnit(id);
      const now = new Date();
      const stakes = await tx.ownershipStake.count({
        where: { zevId, unitId: id, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
      });
      if (stakes > 0) throw new Error(`Posebni dio ${u.label} ima aktivan vlasnički udio — prvo zatvorite vlasništvo (Promjena vlasništva).`);
      touch(id);
      const row = await tx.unit.update({ where: { id, zevId }, data: { active: false } });
      byId.set(id, row);
      after.set(id, snapshotUnit(row));
    };

    switch (input.kind) {
      case "ADD_UNIT":
        await addUnit(input.unit);
        await applyShares(input.shareAdjustments);
        break;
      case "RETIRE_UNIT":
        await retire(input.unitId);
        await applyShares(input.shareAdjustments);
        break;
      case "MERGE_SPLIT":
        if (input.retireUnitIds.length === 0 && input.addUnits.length === 0) throw new Error("Nema izmjena za upis.");
        for (const id of input.retireUnitIds) await retire(id);
        for (const n of input.addUnits) await addUnit(n);
        await applyShares(input.shareAdjustments);
        break;
      case "CHANGE_AREA": {
        const u = activeUnit(input.unitId);
        if (dec(input.usableArea).lessThanOrEqualTo(0)) throw new Error("Površina mora biti veća od nule.");
        touch(u.id);
        const row = await tx.unit.update({ where: { id: u.id, zevId }, data: { usableArea: input.usableArea } });
        byId.set(u.id, row);
        after.set(u.id, snapshotUnit(row));
        break;
      }
      case "CHANGE_SHARE":
        if (input.shares.length === 0) throw new Error("Nema izmjena za upis.");
        await applyShares(input.shares);
        break;
      case "CHANGE_LABEL": {
        const u = activeUnit(input.unitId);
        if (!input.label.trim()) throw new Error("Oznaka posebnog dijela je obavezna.");
        touch(u.id);
        const row = await tx.unit.update({ where: { id: u.id, zevId }, data: { label: input.label.trim() } });
        byId.set(u.id, row);
        after.set(u.id, snapshotUnit(row));
        break;
      }
      case "CHANGE_TYPE": {
        const u = activeUnit(input.unitId);
        touch(u.id);
        const row = await tx.unit.update({ where: { id: u.id, zevId }, data: { type: input.type } });
        byId.set(u.id, row);
        after.set(u.id, snapshotUnit(row));
        break;
      }
    }

    const sum = sharesSum([...byId.values()].filter((u) => u.active).map((u) => u.ownershipShare));
    if (!sumIsHundred(sum)) {
      throw new Error(`Zbir udjela u troškovima mora ostati 100,00 % (nakon izmjene je ${sum.toFixed(2).replace(".", ",")} %).`);
    }

    const version = zev.unitRegisterVersion + 1;
    const changeId = randomUUID();
    const attachment = await createLinkedAttachmentTx(tx, actor, {
      ...document,
      category: "UNIT_REGISTER_CHANGE",
      linkedType: "UnitRegisterChange",
      linkedId: changeId,
    });
    const kind: UnitRegisterChangeKind = input.kind;
    const change = await tx.unitRegisterChange.create({
      data: {
        id: changeId, zevId, version, kind, reason, attachmentId: attachment.id,
        before: [...before.values()] as unknown as Prisma.InputJsonValue,
        after: [...after.values()] as unknown as Prisma.InputJsonValue,
        actorId: actor.userId,
      },
    });
    await tx.zev.update({ where: { id: zevId }, data: { unitRegisterVersion: version } });
    await audit(actor, {
      action: "unit_register.change", targetType: "Zev", targetId: zevId,
      before: { version: zev.unitRegisterVersion, units: [...before.values()] },
      after: { version, kind, units: [...after.values()], changeId },
      reason,
    }, tx);
    return change;
  });
}
