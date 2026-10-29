// FR (K-02, FR-Q3, FR-Q4): registar posebnih dijelova — utvrdjivanje, kapije i izmjena registra.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, openVotingWithLinks } from "./helpers";
import * as property from "@/server/services/property";
import * as ownership from "@/server/services/ownership";
import { establishUnitRegister, changeUnitRegister, getUnitRegister, registerPreconditions } from "@/server/services/unitRegister";
import { closeVoting } from "@/server/services/meetings";
import { ForbiddenError } from "@/server/auth/guards";

const DOC = { buffer: Buffer.from("odluka o izmjeni"), filename: "izmjena.pdf", mime: "application/pdf" };
const PROOF = { buffer: Buffer.from("test proof"), filename: "dokaz.pdf", mime: "application/pdf" };

describe("registerPreconditions on plain (draft-shaped) units", () => {
  // Nacrt onboardinga nema Prisma redove — samo polja iz RegisterPreconditionUnit, sa stringovima umjesto Decimal.
  const unit = (over: Partial<{ label: string; usableArea: string; ownershipShare: string; active: boolean }> = {}) => ({
    label: "Stan 1", type: "APARTMENT" as const, usableArea: "50.00", ownershipShare: "50.00", active: true, ...over,
  });
  const failed = (units: ReturnType<typeof unit>[]) => registerPreconditions(units).filter((p) => !p.ok).map((p) => p.key);

  it("passes for complete units that sum to 100%", () => {
    expect(failed([unit(), unit({ label: "Stan 2" })])).toEqual([]);
  });
  it("reports missing units, missing fields and a wrong sum", () => {
    expect(failed([])).toEqual(["UNITS", "FIELDS", "SHARE_SUM"]);
    expect(failed([unit(), unit({ label: " ", usableArea: "0" })])).toEqual(["FIELDS"]);
    expect(failed([unit(), unit({ label: "Stan 2", ownershipShare: "49.00" })])).toEqual(["SHARE_SUM"]);
  });
  it("ignores inactive units", () => {
    expect(failed([unit({ ownershipShare: "100.00" }), unit({ label: "Stara", active: false, usableArea: "0" })])).toEqual([]);
  });
});

describe("establishUnitRegister", () => {
  it("refuses without units, without area, and with a share sum different from 100%", async () => {
    const f = await createFixture("reg-pre", { registerStatus: "DRAFT" });

    // share sum != 100
    await prisma.unit.update({ where: { id: f.u1.id }, data: { ownershipShare: "20.00" } });
    await expect(establishUnitRegister(f.president)).rejects.toThrow(/100/);
    await prisma.unit.update({ where: { id: f.u1.id }, data: { ownershipShare: "25.00" } });

    // missing area
    await prisma.unit.update({ where: { id: f.u2.id }, data: { usableArea: "0" } });
    await expect(establishUnitRegister(f.president)).rejects.toThrow(/površin/);
    await prisma.unit.update({ where: { id: f.u2.id }, data: { usableArea: "70.00" } });

    // no active units at all
    await prisma.unit.updateMany({ where: { zevId: f.zev.id }, data: { active: false } });
    await expect(establishUnitRegister(f.president)).rejects.toThrow(/nijednog posebnog dijela/);
    await prisma.unit.updateMany({ where: { zevId: f.zev.id }, data: { active: true } });

    const state = await getUnitRegister(f.president);
    expect(state.status).toBe("DRAFT");
    expect(state.preconditions.every((p) => p.ok)).toBe(true);
  });

  it("establishes version 1 from DRAFT, writes history and audit, and refuses a second call", async () => {
    const f = await createFixture("reg-ok", { registerStatus: "DRAFT" });
    await establishUnitRegister(f.president, { reason: "Prvo utvrđivanje" });

    const zev = await prisma.zev.findUniqueOrThrow({ where: { id: f.zev.id } });
    expect(zev.unitRegisterStatus).toBe("ESTABLISHED");
    expect(zev.unitRegisterVersion).toBe(1);
    expect(zev.unitRegisterEstablishedAt).not.toBeNull();

    const state = await getUnitRegister(f.accountant);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].kind).toBe("ESTABLISH");
    expect(state.history[0].version).toBe(1);
    expect(state.summary.unitCount).toBe(4);
    expect(state.summary.shareSum).toBe("100.00");
    expect(await prisma.auditEvent.findFirst({ where: { action: "unit_register.establish", targetId: f.zev.id } })).toBeTruthy();

    await expect(establishUnitRegister(f.president)).rejects.toThrow(/već utvrđen/);
  });

  it("establishes from REVIEW (existing ZEV, FR-Q4) as the next version", async () => {
    const f = await createFixture("reg-review", { registerStatus: "REVIEW" });
    // fixture established v1 and was then flipped to REVIEW: re-establishing creates v2
    await establishUnitRegister(f.president);
    const zev = await prisma.zev.findUniqueOrThrow({ where: { id: f.zev.id } });
    expect(zev.unitRegisterStatus).toBe("ESTABLISHED");
    expect(zev.unitRegisterVersion).toBe(2);
  });

  it("only the president may establish", async () => {
    const f = await createFixture("reg-role", { registerStatus: "DRAFT" });
    await expect(establishUnitRegister(f.accountant)).rejects.toThrow(ForbiddenError);
    await expect(establishUnitRegister(f.actorA)).rejects.toThrow(ForbiddenError);
  });
});

describe("unit gates by register status", () => {
  const unitData = (f: { b1: { id: string }; t: string }) => ({
    buildingId: f.b1.id, type: "GARAGE_SPACE" as const, label: `GM-${f.t}`, usableArea: "12.00", ownershipShare: "1.00",
  });

  it("createUnit and register-field edits are closed in ESTABLISHED", async () => {
    const f = await createFixture("gate-est");
    await expect(property.createUnit(f.president, unitData(f))).rejects.toThrow(/Izmjenu registra/);
    await expect(property.updateUnit(f.president, f.u1.id, { label: "X" })).rejects.toThrow(/Izmjenu registra/);
    await expect(property.updateUnit(f.president, f.u1.id, { usableArea: "99.00" })).rejects.toThrow(/Izmjenu registra/);
    await expect(property.updateUnit(f.president, f.u1.id, { ownershipShare: "26.00" })).rejects.toThrow(/Izmjenu registra/);
    await expect(property.updateUnit(f.president, f.u1.id, { type: "BUSINESS" })).rejects.toThrow(/Izmjenu registra/);
  });

  it("billing inputs stay editable in ESTABLISHED, also when the edit form resends unchanged register fields", async () => {
    const f = await createFixture("gate-est-billing");
    const u1 = await prisma.unit.findUniqueOrThrow({ where: { id: f.u1.id } });
    const updated = await property.updateUnit(f.president, f.u1.id, {
      // what the locked edit form posts: the register fields unchanged, billing fields new
      buildingId: u1.buildingId, type: u1.type, label: u1.label,
      usableArea: u1.usableArea.toString(), ownershipShare: u1.ownershipShare.toFixed(2),
      occupantCount: 4, typeCoefficient: "1.20", floor: 3,
    });
    expect(updated.occupantCount).toBe(4);
    expect(Number(updated.typeCoefficient)).toBe(1.2);
    expect(updated.floor).toBe(3);
    expect(updated.label).toBe(u1.label);
  });

  it("createUnit / updateUnit work in DRAFT (incl. the garage-space type) and the audit records share and type", async () => {
    const f = await createFixture("gate-draft", { registerStatus: "DRAFT" });
    const gm = await property.createUnit(f.president, unitData(f));
    expect(gm.type).toBe("GARAGE_SPACE");
    await property.updateUnit(f.president, f.u1.id, { ownershipShare: "26.00", type: "BUSINESS" });
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "unit.update", targetId: f.u1.id } });
    expect((ev.before as { ownershipShare: string }).ownershipShare).toBe("25");
    expect((ev.after as { ownershipShare: string; type: string }).ownershipShare).toBe("26");
    expect((ev.after as { type: string }).type).toBe("BUSINESS");
  });

  it("createUnit / updateUnit work in REVIEW", async () => {
    const f = await createFixture("gate-review", { registerStatus: "REVIEW" });
    await expect(property.createUnit(f.president, unitData(f))).resolves.toBeTruthy();
    await expect(property.updateUnit(f.president, f.u1.id, { label: "Novi naziv" })).resolves.toBeTruthy();
  });

  it("addOwnershipStake is refused while the register is a DRAFT, allowed in REVIEW", async () => {
    const draft = await createFixture("own-draft", { registerStatus: "DRAFT" });
    await expect(
      ownership.addOwnershipStake(draft.president, { unitId: draft.u1.id, ownerId: draft.ownerA.id, sharePercent: "100", validFrom: new Date("2020-01-01") }, PROOF)
    ).rejects.toThrow(/Prvo utvrdite registar/);

    const review = await createFixture("own-review", { registerStatus: "REVIEW" });
    const fresh = await prisma.unit.create({
      data: { zevId: review.zev.id, buildingId: review.b1.id, type: "APARTMENT", label: `N-${review.t}`, usableArea: "10", ownershipShare: "1" },
    });
    await expect(
      ownership.addOwnershipStake(review.president, { unitId: fresh.id, ownerId: review.ownerA.id, sharePercent: "100", validFrom: new Date("2020-01-01") }, PROOF)
    ).resolves.toBeTruthy();
  });
});

describe("changeUnitRegister", () => {
  it("is refused unless the register is ESTABLISHED", async () => {
    const f = await createFixture("chg-draft", { registerStatus: "DRAFT" });
    await expect(
      changeUnitRegister(f.president, { kind: "CHANGE_LABEL", reason: "x", unitId: f.u1.id, label: "Y" }, DOC)
    ).rejects.toThrow(/nije utvrđen/);
  });

  it("requires a reason and a document", async () => {
    const f = await createFixture("chg-req");
    await expect(
      changeUnitRegister(f.president, { kind: "CHANGE_LABEL", reason: "  ", unitId: f.u1.id, label: "Y" }, DOC)
    ).rejects.toThrow(/Razlog/);
    await expect(
      // @ts-expect-error — deliberately omitting the required document
      changeUnitRegister(f.president, { kind: "CHANGE_LABEL", reason: "ispravka", unitId: f.u1.id, label: "Y" })
    ).rejects.toThrow(/Dokument/);
    await expect(
      changeUnitRegister(f.president, { kind: "CHANGE_LABEL", reason: "ispravka", unitId: f.u1.id, label: "Y" }, { ...DOC, buffer: Buffer.alloc(0) })
    ).rejects.toThrow(/Dokument/);
    await expect(
      changeUnitRegister(f.accountant, { kind: "CHANGE_LABEL", reason: "ispravka", unitId: f.u1.id, label: "Y" }, DOC)
    ).rejects.toThrow(ForbiddenError);
  });

  it("the share sum must stay 100%", async () => {
    const f = await createFixture("chg-sum");
    await expect(
      changeUnitRegister(f.president, { kind: "CHANGE_SHARE", reason: "ispravka", shares: [{ unitId: f.u1.id, ownershipShare: "30.00" }] }, DOC)
    ).rejects.toThrow(/100,00/);
    // a balanced change passes: u1 25 -> 30 and u3 30 -> 25
    await changeUnitRegister(f.president, {
      kind: "CHANGE_SHARE", reason: "ispravka",
      shares: [{ unitId: f.u1.id, ownershipShare: "30.00" }, { unitId: f.u3.id, ownershipShare: "25.00" }],
    }, DOC);
    expect(Number((await prisma.unit.findUniqueOrThrow({ where: { id: f.u1.id } })).ownershipShare)).toBe(30);
  });

  it("is refused while any proposal of the ZEV is VOTING_OPEN, and works again after it closes", async () => {
    const f = await createFixture("chg-vote");
    const { proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    await expect(
      changeUnitRegister(f.president, { kind: "CHANGE_LABEL", reason: "ispravka", unitId: f.u1.id, label: "Y" }, DOC)
    ).rejects.toThrow(new RegExp(`dok traje glasanje o ${proposal.code}`));

    await closeVoting(f.president, proposal.id);
    await expect(
      changeUnitRegister(f.president, { kind: "CHANGE_LABEL", reason: "ispravka", unitId: f.u1.id, label: "Y" }, DOC)
    ).resolves.toBeTruthy();
  });

  it("RETIRE_UNIT refuses a unit with an active stake; once the ownership is closed it retires (never deletes)", async () => {
    const f = await createFixture("chg-retire");
    await expect(
      changeUnitRegister(f.president, {
        kind: "RETIRE_UNIT", reason: "spajanje", unitId: f.u4.id,
        shareAdjustments: [{ unitId: f.u1.id, ownershipShare: "35.00" }],
      }, DOC)
    ).rejects.toThrow(/aktivan vlasnički udio/);

    await prisma.ownershipStake.updateMany({ where: { unitId: f.u4.id, validTo: null }, data: { validTo: new Date("2021-01-01") } });
    await changeUnitRegister(f.president, {
      kind: "RETIRE_UNIT", reason: "spajanje", unitId: f.u4.id,
      shareAdjustments: [{ unitId: f.u1.id, ownershipShare: "35.00" }],
    }, DOC);
    const u4 = await prisma.unit.findUniqueOrThrow({ where: { id: f.u4.id } });
    expect(u4.active).toBe(false);
  });

  it("each change is a new version with history, a linked document and an audit event", async () => {
    const f = await createFixture("chg-hist");
    const c1 = await changeUnitRegister(f.president, { kind: "CHANGE_AREA", reason: "novo mjerenje", unitId: f.u1.id, usableArea: "51.20" }, DOC);
    const c2 = await changeUnitRegister(f.president, {
      kind: "ADD_UNIT", reason: "nova etaža",
      unit: { buildingId: f.b1.id, type: "GARAGE_SPACE", label: `GM-${f.t}`, usableArea: "12.00", ownershipShare: "5.00" },
      shareAdjustments: [{ unitId: f.u2.id, ownershipShare: "30.00" }],
    }, DOC);
    expect(c1.version).toBe(2); // fixture established v1
    expect(c2.version).toBe(3);

    const state = await getUnitRegister(f.president);
    expect(state.version).toBe(3);
    expect(state.history.map((h) => h.kind)).toEqual(["ADD_UNIT", "CHANGE_AREA", "ESTABLISH"]);
    expect(state.summary.unitCount).toBe(5);

    const att = await prisma.attachment.findFirstOrThrow({ where: { id: c1.attachmentId! } });
    expect(att.category).toBe("UNIT_REGISTER_CHANGE");
    expect(att.linkedType).toBe("UnitRegisterChange");
    expect(att.linkedId).toBe(c1.id);
    const audits = await prisma.auditEvent.findMany({ where: { action: "unit_register.change", targetId: f.zev.id } });
    expect(audits).toHaveLength(2);
    const before = (c1.before as { usableArea: string }[])[0];
    const after = (c1.after as { usableArea: string }[])[0];
    expect(Number(before.usableArea)).toBe(50);
    expect(Number(after.usableArea)).toBe(51.2);
  });

  it("UnitRegisterChange is append-only at the database level", async () => {
    const f = await createFixture("chg-append");
    const row = await prisma.unitRegisterChange.findFirstOrThrow({ where: { zevId: f.zev.id } });
    await expect(prisma.unitRegisterChange.update({ where: { id: row.id }, data: { reason: "prepravljeno" } })).rejects.toThrow();
    await expect(prisma.unitRegisterChange.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

describe("upsertZev JIB format (Plans/zev-onboarding-wizard-plan.md D5)", () => {
  it("refuses a new invalid JIB but keeps an unchanged older one editable", async () => {
    const f = await createFixture("zev-jib");
    const base = { legalName: f.zev.legalName };
    await expect(property.upsertZev(f.president, { ...base, jib: "12345" })).rejects.toThrow(/13 cifara/);
    await expect(property.upsertZev(f.president, { ...base, jib: "4400 0000 00009" })).resolves.toMatchObject({ jib: "4400 0000 00009" });

    await prisma.zev.update({ where: { id: f.zev.id }, data: { jib: "123" } });
    await expect(property.upsertZev(f.president, { ...base, jib: "123", city: "Banja Luka" })).resolves.toMatchObject({ city: "Banja Luka" });
  });
});
