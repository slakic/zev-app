// Onboarding Faza C (Plans/zev-onboarding-wizard-plan.md §4 koraci 8–10, §5.2): vlasnici sa dokazom
// po udjelu, organi i nalozi, objava ZEV-a u jednoj transakciji i odbacivanje nacrta.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/server/auth/password";
import { snapshotUnit } from "@/server/services/unitRegister";
import { unitOwnershipWarnings } from "@/server/services/ownership";
import { registerPreconditions } from "@/lib/registerRules";
import * as ob from "@/server/services/onboarding";
import { createSuperAdminActor, uid } from "./helpers";

const PDF = (name = "dokaz.pdf") => ({ buffer: Buffer.from(`%PDF-1.4 ${name}`), filename: name, mime: "application/pdf" });
const ZEV = {
  legalName: "ZEV Kralja Petra I 45", shortName: "KP45", registrationNumber: "1-2345/26", jib: "4404567890002",
  registeredAddress: "Kralja Petra I 45", city: "Banja Luka", municipality: "Banja Luka", foundingDate: "2026-01-15", registrationDate: "",
};
const person = (firstName: string, lastName: string) => ({ partyKey: "new", newParty: { kind: "PERSON", firstName, lastName } });

/** Klijent sa potvrđenim registrom: 1 zgrada, ulaz A, Stan 1 (60 %), Stan 2 (30 %), Garaža 1 (10 %). */
async function throughRegister(tag: string) {
  const admin = await createSuperAdminActor(`pub-${tag}`);
  const email = `${uid(tag)}@klijent.test`;
  const { token } = await ob.createOnboardingInvite(admin, { workingName: `ZEV ${tag}`, tier: "BASIC_FINANCE", email });
  const r = await ob.acceptOnboardingInvite(token, { mode: "new", firstName: "Dragana", lastName: "Savić", password: "Lozinka123", confirm: "Lozinka123" });
  if (!r.ok) throw new Error(r.error);
  const a = { userId: r.userId };
  let v = (await ob.saveZevStep(a, (await ob.getMyDraft(a))!.version, ZEV)).version;
  v = await ob.addDraftAccount(a, v, { type: "BANK", name: "Glavni", bankName: "NLB", number: "0060000123456758", openingBalance: "2.450,00", openingDate: "2026-01-01" });
  v = await ob.addDraftBuilding(a, v, { name: "Kralja Petra I 45", address: "Kralja Petra I 45, Banja Luka", yearBuilt: "1978" });
  const b = (await ob.getMyDraft(a))!.data.buildings[0];
  v = await ob.addDraftEntrance(a, v, b.key, "A");
  const e = (await ob.getMyDraft(a))!.data.buildings[0].entrances[0];
  for (const [label, type, share] of [["Stan 1", "APARTMENT", "60"], ["Stan 2", "APARTMENT", "30"], ["Garaža 1", "GARAGE", "10"]] as const) {
    v = await ob.addDraftUnit(a, v, { buildingKey: b.key, entranceKey: type === "GARAGE" ? null : e.key, type, label, floor: "1", usableArea: "50,00", ownershipShare: share });
  }
  v = await ob.addDraftCommonAsset(a, v, { buildingKey: b.key, kind: "AREA", name: "Stubište" });
  v = await ob.confirmDraftRegister(a, v);
  const units = (await ob.getMyDraft(a))!.data.units;
  const unit = (label: string) => units.find((u) => u.label === label)!.key;
  return { admin, email, a, v, unit };
}

describe("owners (step 8)", () => {
  it("every stake needs a proof; shares follow the app rule; each unit needs exactly 100 % or a dispute", async () => {
    const { a, unit } = await throughRegister("owners");
    let v = (await ob.getMyDraft(a))!.version;
    await expect(ob.addDraftStake(a, v, { ...person("Ana", "Marković"), unitKey: unit("Stan 1"), sharePercent: "100", validFrom: "2019-03-15" }, null)).rejects.toThrow(/Dokaz/);
    await expect(ob.addDraftStake(a, v, { ...person("Ana", "Marković"), unitKey: unit("Stan 1"), sharePercent: "100", validFrom: "2019-03-15" }, { ...PDF(), mime: "text/plain" })).rejects.toThrow(/PDF, JPG/);
    await expect(ob.addDraftStake(a, v, { ...person("Ana", "Marković"), unitKey: unit("Stan 1"), sharePercent: "0", validFrom: "2019-03-15" }, PDF())).rejects.toThrow(/rasponu/);
    await expect(ob.addDraftStake(a, v, { partyKey: "new", newParty: { kind: "PERSON", firstName: "Ana" }, unitKey: unit("Stan 1"), sharePercent: "50", validFrom: "2019-03-15" }, PDF())).rejects.toThrow(/ime i prezime/);
    // Odbijen udio ne ostavlja fajl u nacrtu.
    expect(await prisma.onboardingDraftFile.count({ where: { draft: { ownerUserId: a.userId } } })).toBe(0);

    v = await ob.addDraftStake(a, v, { ...person("Nikola", "Ilić"), unitKey: unit("Stan 1"), sharePercent: "50", validFrom: "2019-03-15" }, PDF("n.pdf"));
    let d = (await ob.getMyDraft(a))!;
    expect(d.progress.currentStep).toBe("owners");
    expect(d.progress.steps[7].issues.map((i) => i.text).join(" ")).toMatch(/Stan 1: upisano 50,00 %/);
    const nikola = d.data.parties[0].key;
    await expect(ob.addDraftStake(a, v, { partyKey: nikola, unitKey: unit("Stan 1"), sharePercent: "50", validFrom: "2019-03-15" }, PDF())).rejects.toThrow(/već upisano/);
    v = await ob.addDraftStake(a, v, { ...person("Sara", "Ilić"), unitKey: unit("Stan 1"), sharePercent: "50", validFrom: "2019-03-15" }, PDF("s.pdf"));
    // Predsjednik je i vlasnik (isto lice, ne drugo).
    v = await ob.addDraftStake(a, v, { partyKey: "president", unitKey: unit("Stan 2"), sharePercent: "100", validFrom: "2020-01-01" }, PDF("p.pdf"));
    v = await ob.setUnitDisputed(a, v, unit("Garaža 1"), true);
    d = (await ob.getMyDraft(a))!;
    expect(d.progress.currentStep).toBe("offices");
    expect(await prisma.onboardingDraftFile.count({ where: { draftId: d.id } })).toBe(3);

    // Uklanjanje udjela briše i njegov fajl.
    const saraStake = d.data.stakes.find((s) => s.sharePercent === "50" && s.partyKey !== nikola)!;
    v = await ob.removeDraftStake(a, v, saraStake.key);
    expect(await prisma.onboardingDraftFile.count({ where: { draftId: d.id } })).toBe(2);
    expect((await ob.getMyDraft(a))!.progress.currentStep).toBe("owners");
  });
});

describe("offices (step 9)", () => {
  it("accountant is required or explicitly 'later'; a login needs a free e-mail and a strong password", async () => {
    const { a, unit } = await throughRegister("offices");
    let v = (await ob.getMyDraft(a))!.version;
    v = await ob.addDraftStake(a, v, { partyKey: "president", unitKey: unit("Stan 1"), sharePercent: "100", validFrom: "2020-01-01" }, PDF());
    v = await ob.addDraftStake(a, v, { partyKey: "president", unitKey: unit("Stan 2"), sharePercent: "100", validFrom: "2020-01-01" }, PDF());
    v = await ob.setUnitDisputed(a, v, unit("Garaža 1"), true);
    expect((await ob.getMyDraft(a))!.progress.currentStep).toBe("offices");

    const taken = `${uid("taken")}@zev.test`;
    await prisma.user.create({ data: { email: taken, passwordHash: await hashPassword("Postoji123"), roles: [] } });
    await expect(ob.setDraftAccountant(a, v, { ...person("Jelena", "Kovač"), validFrom: "2026-01-01", loginEmail: taken, password: "Lozinka123" })).rejects.toThrow(/već postoji/);
    await expect(ob.setDraftAccountant(a, v, { ...person("Jelena", "Kovač"), validFrom: "2026-01-01", loginEmail: `${uid("j")}@zev.test`, password: "kratka" })).rejects.toThrow(/8 znakova/);
    v = await ob.setAccountantLater(a, v, true);
    expect((await ob.getMyDraft(a))!.progress.currentStep).toBe("review");
    v = await ob.setAccountantLater(a, v, false);
    expect((await ob.getMyDraft(a))!.progress.currentStep).toBe("offices");
    v = await ob.addDraftBoardMember(a, v, { partyKey: "president", validFrom: "2026-01-01" });
    await expect(ob.addDraftBoardMember(a, v, { partyKey: "president", validFrom: "2026-01-01" })).rejects.toThrow(/već član/);
  });
});

describe("publishOnboardingDraft", () => {
  it("creates the whole ZEV in one go: register v1, owners with proofs, offices, logins; the draft is closed", async () => {
    const { a, unit, email } = await throughRegister("publish");
    let v = (await ob.getMyDraft(a))!.version;
    await expect(ob.publishOnboardingDraft(a, v)).rejects.toThrow(/Prvo završite korak/);
    v = await ob.addDraftStake(a, v, { ...person("Nikola", "Ilić"), unitKey: unit("Stan 1"), sharePercent: "50", validFrom: "2019-03-15" }, PDF("n.pdf"));
    v = await ob.addDraftStake(a, v, { ...person("Sara", "Ilić"), unitKey: unit("Stan 1"), sharePercent: "50", validFrom: "2019-03-15" }, PDF("s.pdf"));
    v = await ob.addDraftStake(a, v, { partyKey: "president", unitKey: unit("Stan 2"), sharePercent: "100", validFrom: "2020-01-01" }, PDF("p.pdf"));
    v = await ob.setUnitDisputed(a, v, unit("Garaža 1"), true);
    const accEmail = `${uid("racunovodja")}@zev.test`;
    v = await ob.setDraftAccountant(a, v, { ...person("Jelena", "Kovač"), validFrom: "2026-01-01", loginEmail: accEmail, password: "Racunovodja1" });
    const nikolaKey = (await ob.getMyDraft(a))!.data.parties.find((p) => p.firstName === "Nikola")!.key;
    v = await ob.addDraftBoardMember(a, v, { partyKey: nikolaKey, validFrom: "2026-01-01" });
    const draft = (await ob.getMyDraft(a))!;
    expect(draft.progress.currentStep).toBe("review");
    await expect(ob.publishOnboardingDraft(a, v - 1)).rejects.toThrow(ob.StaleDraftError);

    const { zevId } = await ob.publishOnboardingDraft(a, v);
    const zev = await prisma.zev.findUniqueOrThrow({ where: { id: zevId } });
    expect(zev).toMatchObject({ legalName: ZEV.legalName, jib: ZEV.jib, tier: "BASIC_FINANCE", unitRegisterStatus: "ESTABLISHED", unitRegisterVersion: 1 });
    expect(await prisma.setting.count({ where: { zevId } })).toBeGreaterThan(0);
    expect(await prisma.moneyAccount.findFirstOrThrow({ where: { zevId } })).toMatchObject({ iban: "0060000123456758" });
    expect((await prisma.moneyAccount.findFirstOrThrow({ where: { zevId } })).openingBalance.toString()).toBe("2450");

    // Registar: isti preduslovi i isti snimak kao utvrđivanje u aplikaciji.
    const units = await prisma.unit.findMany({ where: { zevId }, orderBy: { label: "asc" } });
    expect(units).toHaveLength(3);
    expect(registerPreconditions(units).every((p) => p.ok)).toBe(true);
    const change = await prisma.unitRegisterChange.findFirstOrThrow({ where: { zevId } });
    expect(change).toMatchObject({ version: 1, kind: "ESTABLISH" });
    expect([...(change.after as unknown as { id: string }[])].sort((x, y) => x.id.localeCompare(y.id)))
      .toEqual(units.map(snapshotUnit).sort((x, y) => x.id.localeCompare(y.id)));

    // Vlasnici: svaki udio sa dokazom (Attachment OWNERSHIP_PROOF + blob); sporna garaža je „bez vlasnika”.
    const stakes = await prisma.ownershipStake.findMany({ where: { zevId } });
    expect(stakes).toHaveLength(3);
    const proofs = await prisma.attachment.findMany({ where: { zevId, category: "OWNERSHIP_PROOF" } });
    expect(proofs.map((p) => p.linkedId).sort()).toEqual(stakes.map((s) => s.id).sort());
    expect(await prisma.attachmentBlob.count({ where: { attachmentId: { in: proofs.map((p) => p.id) } } })).toBe(3);
    const warnings = await unitOwnershipWarnings(zevId);
    expect(warnings.map((w) => [w.label, w.kind])).toEqual([["Garaža 1", "NONE"]]);

    // Predsjednik: jedno lice (i vlasnik Stana 2), članstvo, mandat; računovođa sa nalogom; odbor.
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    const presidentParty = await prisma.party.findFirstOrThrow({ where: { zevId, userId: owner.id } });
    expect(presidentParty).toMatchObject({ firstName: "Dragana", lastName: "Savić", email });
    expect(stakes.some((s) => s.ownerId === presidentParty.id)).toBe(true);
    expect(await prisma.membership.findMany({ where: { zevId }, select: { role: true } })).toEqual(expect.arrayContaining([{ role: "PRESIDENT" }, { role: "ACCOUNTANT" }]));
    const accUser = await prisma.user.findUniqueOrThrow({ where: { email: accEmail } });
    expect(await prisma.membership.count({ where: { userId: accUser.id, zevId, role: "ACCOUNTANT" } })).toBe(1);
    const terms = await prisma.officeTerm.findMany({ where: { zevId }, select: { role: true } });
    expect(terms.map((x) => x.role).sort()).toEqual(["ACCOUNTANT", "BOARD_MEMBER", "PRESIDENT"]);
    // Lica: predsjednik, Nikola, Sara, Jelena (4), bez dvostrukog lica za predsjednika.
    expect(await prisma.party.count({ where: { zevId } })).toBe(4);

    // Nacrt je zatvoren, fajlovi obrisani, audit postoji; korisnik sad ima ZEV.
    const closed = await prisma.onboardingDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(closed).toMatchObject({ status: "PUBLISHED", publishedZevId: zevId });
    expect(await prisma.onboardingDraftFile.count({ where: { draftId: draft.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { zevId, action: "onboarding.publish" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { zevId, action: "unit_register.establish" } })).toBe(1);
    expect(await ob.getMyDraft(a)).toBeNull();
    await expect(ob.publishOnboardingDraft(a, v + 1)).rejects.toThrow(/Nemate nacrt/);
  });

  it("refuses when the accountant's e-mail got taken in the meantime, and leaves nothing behind", async () => {
    const { a, unit } = await throughRegister("pub-race");
    let v = (await ob.getMyDraft(a))!.version;
    for (const l of ["Stan 1", "Stan 2", "Garaža 1"]) {
      v = await ob.addDraftStake(a, v, { partyKey: "president", unitKey: unit(l), sharePercent: "100", validFrom: "2020-01-01" }, PDF());
    }
    const accEmail = `${uid("kasnije")}@zev.test`;
    v = await ob.setDraftAccountant(a, v, { ...person("Jelena", "Kovač"), validFrom: "2026-01-01", loginEmail: accEmail, password: "Racunovodja1" });
    await prisma.user.create({ data: { email: accEmail, passwordHash: await hashPassword("Neko12345"), roles: [] } });
    const zevsBefore = await prisma.zev.count();
    await expect(ob.publishOnboardingDraft(a, v)).rejects.toThrow(/u međuvremenu otvoren/);
    expect(await prisma.zev.count()).toBe(zevsBefore);
    expect((await ob.getMyDraft(a))!.progress.currentStep).toBe("review");
  });
});

describe("discardOnboardingDraft", () => {
  it("super admin discards a draft with a reason; files go, the login stays and lands on the notice", async () => {
    const { admin, a, unit } = await throughRegister("discard");
    const v = (await ob.getMyDraft(a))!.version;
    await ob.addDraftStake(a, v, { partyKey: "president", unitKey: unit("Stan 1"), sharePercent: "100", validFrom: "2020-01-01" }, PDF());
    const draftId = (await ob.getMyDraft(a))!.id;
    await expect(ob.discardOnboardingDraft(admin, draftId, " ")).rejects.toThrow(/Razlog/);
    await ob.discardOnboardingDraft(admin, draftId, "Klijent odustao");
    expect(await prisma.onboardingDraftFile.count({ where: { draftId } })).toBe(0);
    expect(await ob.getMyDraft(a)).toBeNull();
    expect(await ob.landingPath({ userId: a.userId, zevId: null, isSuperAdmin: false })).toBe("/onboarding/odbacen");
    await expect(ob.discardOnboardingDraft(admin, draftId, "Opet")).rejects.toThrow(/u toku/);
    const view = await ob.getDraftForAdmin(admin, draftId);
    expect(view.status).toBe("DISCARDED");
  });
});
