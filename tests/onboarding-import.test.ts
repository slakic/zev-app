// Uvoz nacrta iz fajla kroz servis (pravi test baza): pregled bez upisa, potvrda sa jednom novom verzijom, atomičnost, brave
// (verzija i hash), audit bez ličnih podataka, prijedlozi udjela kroz ostatak čarobnjaka i pristup super admina.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import * as ob from "@/server/services/onboarding";
import { DraftAccessError, draftAccessForAdminWeb, draftAccessForOwner } from "@/server/services/draftAccess";
import { commitDraftImport, detectImportKind, draftExportDoc, ImportInvalidError, previewDraftImport } from "@/server/services/onboardingImport";
import { grantDraftAdminAccess, revokeDraftAdminAccess } from "@/server/services/mcpDraftAccess";
import { IMPORT_FORMAT_ID } from "@/lib/onboarding/import/importFormat";
import { createSuperAdminActor, uid } from "./helpers";

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = (name = "dokaz.pdf") => ({ buffer: Buffer.from(`%PDF-1.4 ${name}`), filename: name, mime: "application/pdf" });
const ZEV = {
  legalName: "ZEV Uvoz", shortName: "UV", registrationNumber: "1-2345/26", jib: "4404567890002",
  registeredAddress: "Ulica 1", city: "Banja Luka", municipality: "Banja Luka", foundingDate: "2026-01-15", registrationDate: "",
};

async function client(tag: string) {
  const admin = await createSuperAdminActor(`imp-${tag}`);
  const email = `${uid(tag)}@klijent.test`;
  const { token } = await ob.createOnboardingInvite(admin, { workingName: `ZEV ${tag}`, tier: "BASIC_FINANCE", email });
  const r = await ob.acceptOnboardingInvite(token, { mode: "new", firstName: "Dragana", lastName: "Savić", password: "Lozinka123", confirm: "Lozinka123" });
  if (!r.ok) throw new Error(r.error);
  const a = { userId: r.userId };
  const draft = (await ob.getMyDraft(a))!;
  return { admin, email, a, draftId: draft.id, access: await draftAccessForOwner(a, draft.id) };
}

const json = (o: Record<string, unknown>) => enc(JSON.stringify({ format: IMPORT_FORMAT_ID, formatVersion: 1, ...o }));
const FILE = json({
  buildings: [{ key: "z1", name: "Zgrada Š", address: "Ulica Đ 1", entrances: [{ key: "e1", name: "A" }] }],
  units: [
    { key: "s1", buildingKey: "z1", entranceKey: "e1", type: "stan", label: "Stan 1", usableArea: "62,40", ownershipShare: "50" },
    { key: "s2", buildingKey: "z1", entranceKey: "e1", type: "stan", label: "Stan 2", usableArea: "48", ownershipShare: "50" },
  ],
  parties: [{ key: "p1", kind: "PERSON", firstName: "Šćepan", lastName: "Tajnić", email: "tajni.vlasnik@primjer.test" }],
  stakes: [{ unitKey: "s1", partyKey: "p1", sharePercent: "100", validFrom: "01.01.2020." }],
});

describe("detectImportKind", () => {
  it("decides by content, never by name: { means JSON, anything else CSV (also with BOM and leading whitespace)", () => {
    expect(detectImportKind(enc('  \n{"a":1}'))).toBe("json");
    expect(detectImportKind(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("{}")]))).toBe("json");
    expect(detectImportKind(enc("zgrada;oznaka"))).toBe("csv");
    expect(detectImportKind(enc("<script>alert(1)</script>"))).toBe("csv");
  });
});

describe("previewDraftImport / commitDraftImport (owner)", () => {
  it("preview writes nothing: same version, same data, no audit", async () => {
    const c = await client("prev");
    const before = await ob.getMyDraft(c.a);
    const auditBefore = await prisma.auditEvent.count({ where: { action: "onboarding.draft.import" } });
    const p = await previewDraftImport(c.access, { filename: "a.json", bytes: FILE });
    expect(p).toMatchObject({ kind: "json", version: before!.version, errorCount: 0, added: 6, proposals: 1 });
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    const after = await ob.getMyDraft(c.a);
    expect(after!.version).toBe(before!.version);
    expect(after!.data).toEqual(before!.data);
    expect(await prisma.auditEvent.count({ where: { action: "onboarding.draft.import" } })).toBe(auditBefore);
  });

  it("commit writes exactly one new version, marks items as imported and audits counts without names or e-mails", async () => {
    const c = await client("commit");
    const p = await previewDraftImport(c.access, { filename: "a.json", bytes: FILE });
    const res = await commitDraftImport(c.access, { filename: "a.json", bytes: FILE, version: p.version, sha256: p.sha256 });
    expect(res.version).toBe(p.version + 1);
    const d = (await ob.getMyDraft(c.a))!;
    expect(d.version).toBe(p.version + 1);
    expect(d.data.units).toHaveLength(2);
    expect(d.data.units[0]).toMatchObject({ label: "Stan 1", usableArea: "62.40", source: "IMPORT" });
    expect(d.data.stakeProposals).toHaveLength(1);
    expect(d.data.stakes).toHaveLength(0);
    expect(d.data.parties[0]).toMatchObject({ firstName: "Šćepan", source: "IMPORT" });

    const ev = await prisma.auditEvent.findMany({ where: { action: "onboarding.draft.import", targetId: c.draftId } });
    expect(ev).toHaveLength(1);
    expect(ev[0].zevId).toBeNull();
    expect(ev[0].actorId).toBe(c.a.userId);
    expect(ev[0].after).toMatchObject({ kind: "json", formatVersion: 1, via: "WIZARD", proposals: 1, added: 6 });
    const raw = JSON.stringify(ev[0]);
    for (const secret of ["Tajnić", "Šćepan", "tajni.vlasnik", "Zgrada Š", "Stan 1"]) expect(raw).not.toContain(secret);

    // Isti fajl ponovo: nema promjena, pa ni upisa.
    const p2 = await previewDraftImport(c.access, { filename: "a.json", bytes: FILE });
    expect(p2.added + p2.updated).toBe(0);
    await expect(commitDraftImport(c.access, { filename: "a.json", bytes: FILE, version: p2.version, sha256: p2.sha256 })).rejects.toThrow(/ne donosi promjene/);
    expect((await ob.getMyDraft(c.a))!.version).toBe(p.version + 1);
  });

  it("a file with an error imports nothing (atomic) and reports the error with section and row", async () => {
    const c = await client("atomic");
    const bad = json({
      buildings: [{ key: "z1", name: "Zgrada", address: "Ulica 1" }],
      units: [
        { buildingKey: "z1", type: "stan", label: "Dobar", usableArea: "50", ownershipShare: "10" },
        { buildingKey: "z1", type: "stan", label: "Loš", usableArea: "-5", ownershipShare: "10" },
      ],
    });
    const p = await previewDraftImport(c.access, { filename: "b.json", bytes: bad });
    expect(p.errorCount).toBe(1);
    expect(p.errors[0]).toMatchObject({ section: "units", row: 2 });
    await expect(commitDraftImport(c.access, { filename: "b.json", bytes: bad, version: p.version, sha256: p.sha256 })).rejects.toBeInstanceOf(ImportInvalidError);
    const d = (await ob.getMyDraft(c.a))!;
    expect(d.version).toBe(p.version);
    expect(d.data.buildings).toHaveLength(0);
    expect(d.data.units).toHaveLength(0);
  });

  it("rejects a stale version and a file that differs from the previewed one", async () => {
    const c = await client("lock");
    const p = await previewDraftImport(c.access, { filename: "a.json", bytes: FILE });
    await expect(commitDraftImport(c.access, { filename: "a.json", bytes: json({ ...JSON.parse(new TextDecoder().decode(FILE)), zev: { city: "Drugi" } }), version: p.version, sha256: p.sha256 })).rejects.toThrow(/razlikuje/);
    await ob.saveAccountStep(c.a, p.version, { firstName: "Nova", lastName: "Osoba" }); // draft changes in the meantime
    await expect(commitDraftImport(c.access, { filename: "a.json", bytes: FILE, version: p.version, sha256: p.sha256 })).rejects.toBeInstanceOf(ob.StaleDraftError);
    expect((await ob.getMyDraft(c.a))!.data.units).toHaveLength(0);
  });

  it("a manual edit of an imported unit removes the 'Uvezeno' mark", async () => {
    const c = await throughRegister("manual");
    await ob.unlockDraftRegister(c.a, c.v);
    const p = await previewDraftImport(c.access, { filename: "u.json", bytes: json({ units: [{ buildingKey: "Zgrada", type: "stan", label: "Stan 3", usableArea: "10", ownershipShare: "1" }] }) });
    await commitDraftImport(c.access, { filename: "u.json", bytes: json({ units: [{ buildingKey: "Zgrada", type: "stan", label: "Stan 3", usableArea: "10", ownershipShare: "1" }] }), version: p.version, sha256: p.sha256 });
    const d = (await ob.getMyDraft(c.a))!;
    const u = d.data.units.find((x) => x.label === "Stan 3")!;
    expect(u.source).toBe("IMPORT");
    await ob.updateDraftUnit(c.a, d.version, u.key, { buildingKey: u.buildingKey, type: u.type, label: "Stan 3", floor: "", usableArea: "11", ownershipShare: "1" });
    expect((await ob.getMyDraft(c.a))!.data.units.find((x) => x.label === "Stan 3")!.source).toBeUndefined();
  });

  it("rejects an empty file and a file over 1 MB before parsing", async () => {
    const c = await client("size");
    await expect(previewDraftImport(c.access, { filename: "x", bytes: new Uint8Array(0) })).rejects.toThrow(/prazan/);
    const big = new Uint8Array(1024 * 1024 + 1).fill(0x7b); // '{' — would be JSON if it were parsed
    await expect(previewDraftImport(c.access, { filename: "x", bytes: big })).rejects.toThrow(/1 MB/);
    await expect(commitDraftImport(c.access, { filename: "x", bytes: big, version: 1, sha256: "x" })).rejects.toThrow(/1 MB/);
  });

  it("owner access is only to one's own in-progress draft", async () => {
    const mine = await client("own-a");
    const other = await client("own-b");
    await expect(draftAccessForOwner(mine.a, other.draftId)).rejects.toBeInstanceOf(DraftAccessError);
    await ob.discardOnboardingDraft(mine.admin, mine.draftId, "test");
    await expect(previewDraftImport(mine.access, { filename: "a.json", bytes: FILE })).rejects.toBeInstanceOf(DraftAccessError);
  });

  it("imports a CSV (Windows-1250 bytes, diacritics) and reports the export round trip as no changes", async () => {
    const c = await client("csv");
    const csv = "zgrada;adresa_zgrade;oznaka;vrsta;povrsina_m2;udio_u_troskovima\nZgrada Š;Ulica Đ 1;Stan Č;stan;62,40;100\n";
    const bytes = new Uint8Array([...csv].map((ch) => ({ Š: 0x8a, Đ: 0xd0, Č: 0xc8 } as Record<string, number>)[ch] ?? ch.charCodeAt(0)));
    const p = await previewDraftImport(c.access, { filename: "t.csv", bytes });
    expect(p.kind).toBe("csv");
    expect(p.warnings.some((w) => /Windows-1250/.test(w.message))).toBe(true);
    await commitDraftImport(c.access, { filename: "t.csv", bytes, version: p.version, sha256: p.sha256 });
    expect((await ob.getMyDraft(c.a))!.data.units[0].label).toBe("Stan Č");

    const exported = enc(JSON.stringify(await draftExportDoc(c.access)));
    const again = await previewDraftImport(c.access, { filename: "nacrt.json", bytes: exported });
    expect(again.errorCount).toBe(0);
    expect(again.added + again.updated).toBe(0);
  });
});

/** Klijent sa potvrđenim registrom: Stan 1 (60 %), Stan 2 (40 %). */
async function throughRegister(tag: string) {
  const c = await client(tag);
  const a = c.a;
  let v = (await ob.saveZevStep(a, (await ob.getMyDraft(a))!.version, ZEV)).version;
  v = await ob.addDraftAccount(a, v, { type: "BANK", name: "Glavni", number: "0060000123456758", openingBalance: "0", openingDate: "2026-01-01" });
  v = await ob.addDraftBuilding(a, v, { name: "Zgrada", address: "Ulica 1" });
  const b = (await ob.getMyDraft(a))!.data.buildings[0];
  for (const [label, share] of [["Stan 1", "60"], ["Stan 2", "40"]] as const) {
    v = await ob.addDraftUnit(a, v, { buildingKey: b.key, type: "APARTMENT", label, usableArea: "50", ownershipShare: share });
  }
  v = await ob.addDraftCommonAsset(a, v, { buildingKey: b.key, kind: "AREA", name: "Stubište" });
  v = await ob.confirmDraftRegister(a, v);
  return { ...c, v };
}

describe("proposals through the rest of the wizard", () => {
  it("existing proofs and stakes survive an import; addDraftStake and removing a unit drop the matching proposals; publish ignores proposals", async () => {
    const c = await throughRegister("props");
    const a = c.a;
    const unit = (label: string) => (c.v, ob.getMyDraft(a).then((d) => d!.data.units.find((u) => u.label === label)!.key));
    const u1 = await unit("Stan 1");
    let v = await ob.addDraftStake(a, c.v, { partyKey: "new", newParty: { kind: "PERSON", firstName: "Ana", lastName: "Anić" }, unitKey: u1, sharePercent: "60", validFrom: "2020-01-01" }, PDF("a.pdf"));
    const stakeBefore = (await ob.getMyDraft(a))!.data.stakes[0];
    const filesBefore = await prisma.onboardingDraftFile.count({ where: { draftId: c.draftId } });

    // Uvoz (zaključan registar): lica i prijedlozi prolaze, postojeći udio sa dokazom ostaje.
    const file = json({
      parties: [{ key: "n", kind: "PERSON", firstName: "Novi", lastName: "Vlasnik", email: "novi@primjer.test" }, { key: "m", kind: "PERSON", firstName: "Mara", lastName: "Marić", email: "mara@primjer.test" }],
      stakes: [
        { unitKey: "Zgrada/Stan 1", partyKey: "n", sharePercent: "40", validFrom: "2021-01-01" },
        { unitKey: "Zgrada/Stan 2", partyKey: "m", sharePercent: "100", validFrom: "2021-01-01" },
      ],
      offices: { accountant: "LATER" },
    });
    const p = await previewDraftImport(c.access, { filename: "v.json", bytes: file });
    expect(p.errorCount).toBe(0);
    await commitDraftImport(c.access, { filename: "v.json", bytes: file, version: p.version, sha256: p.sha256 });
    let d = (await ob.getMyDraft(a))!;
    expect(d.data.stakes[0]).toEqual(stakeBefore);
    expect(await prisma.onboardingDraftFile.count({ where: { draftId: c.draftId } })).toBe(filesBefore);
    expect(d.data.stakeProposals).toHaveLength(2);
    // Prijedlozi se ne računaju u zbir: Stan 2 i dalje nema vlasnika, Stan 1 ima 60 %.
    expect(d.progress.steps[7].complete).toBe(false);

    const novi = d.data.parties.find((p) => p.firstName === "Novi")!.key;
    const mara = d.data.parties.find((p) => p.firstName === "Mara")!.key;
    // Upis sa dokazom ispunjava prijedlog (isto lice, isti dio) i uklanja ga.
    v = await ob.addDraftStake(a, d.version, { partyKey: novi, unitKey: u1, sharePercent: "40", validFrom: "2021-01-01" }, PDF("n.pdf"));
    d = (await ob.getMyDraft(a))!;
    expect(d.data.stakeProposals.map((x) => x.partyKey)).toEqual([mara]);
    expect(d.data.stakes).toHaveLength(2);

    // Uklanjanje prijedloga i uklanjanje posebnog dijela (registar mora biti otključan).
    v = await ob.removeDraftStakeProposal(a, v, d.data.stakeProposals[0].key);
    expect((await ob.getMyDraft(a))!.data.stakeProposals).toHaveLength(0);
    const u2 = await unit("Stan 2");
    await ob.addDraftStake(a, v, { partyKey: mara, unitKey: u2, sharePercent: "100", validFrom: "2021-01-01" }, PDF("m.pdf"));
    expect((await ob.getMyDraft(a))!.progress.steps[7].complete).toBe(true);
  });

  it("publish does not create a party that only has a proposal; removing a unit removes its proposals", async () => {
    const c = await throughRegister("pub");
    const a = c.a;
    const d0 = (await ob.getMyDraft(a))!;
    const [u1, u2] = d0.data.units.map((u) => u.key);
    const file = json({
      parties: [{ key: "x", kind: "PERSON", firstName: "Samo", lastName: "Prijedlog", email: "samo@primjer.test" }],
      stakes: [{ unitKey: u2, partyKey: "x", sharePercent: "10", validFrom: "2021-01-01" }],
    });
    const p = await previewDraftImport(c.access, { filename: "v.json", bytes: file });
    await commitDraftImport(c.access, { filename: "v.json", bytes: file, version: p.version, sha256: p.sha256 });
    let v = (await ob.getMyDraft(a))!.version;
    v = await ob.addDraftStake(a, v, { partyKey: "new", newParty: { kind: "PERSON", firstName: "Prvi", lastName: "Vlasnik" }, unitKey: u1, sharePercent: "100", validFrom: "2020-01-01" }, PDF("1.pdf"));
    v = await ob.addDraftStake(a, v, { partyKey: "new", newParty: { kind: "PERSON", firstName: "Drugi", lastName: "Vlasnik" }, unitKey: u2, sharePercent: "100", validFrom: "2020-01-01" }, PDF("2.pdf"));
    v = await ob.setAccountantLater(a, v, true);
    const { zevId } = await ob.publishOnboardingDraft(a, v);
    const names = (await prisma.party.findMany({ where: { zevId } })).map((x) => x.lastName ?? "");
    expect(names).not.toContain("Prijedlog");
    expect(names.filter((n) => n === "Vlasnik")).toHaveLength(2);
    expect(await prisma.ownershipStake.count({ where: { zevId } })).toBe(2);
  });

  it("removing a unit (register open) removes the proposals that point to it", async () => {
    const c = await client("rmunit");
    const file = json({
      buildings: [{ key: "z", name: "Zgrada", address: "Ulica 1" }],
      units: [{ key: "s", buildingKey: "z", type: "stan", label: "Stan 1", usableArea: "50", ownershipShare: "100" }],
      parties: [{ key: "p", kind: "PERSON", firstName: "A", lastName: "B" }],
      stakes: [{ unitKey: "s", partyKey: "p", sharePercent: "100", validFrom: "2020-01-01" }],
    });
    const p = await previewDraftImport(c.access, { filename: "v.json", bytes: file });
    await commitDraftImport(c.access, { filename: "v.json", bytes: file, version: p.version, sha256: p.sha256 });
    const d = (await ob.getMyDraft(c.a))!;
    expect(d.data.stakeProposals).toHaveLength(1);
    // Koraci prije „posebnih dijelova” moraju biti kompletni da bi se korak otvorio; uklanjanje se zato radi kroz bazu stanja.
    await prisma.onboardingDraft.update({ where: { id: c.draftId }, data: { data: { ...d.data, zev: ZEV, accounts: [{ key: "a", type: "BANK", name: "G", bankName: null, number: "0060000123456758", openingBalance: "0", openingDate: "2026-01-01" }] } as object } });
    const cur = (await ob.getMyDraft(c.a))!;
    await ob.removeDraftUnit(c.a, cur.version, d.data.units[0].key);
    expect((await ob.getMyDraft(c.a))!.data.stakeProposals).toHaveLength(0);
  });
});

describe("super admin import (ADMIN_WEB)", () => {
  it("needs an ACTIVE access row: without it, after revoking and for a non-admin the access is refused", async () => {
    const c = await client("adm");
    const admin = await createSuperAdminActor("imp-adm-admin");
    await expect(draftAccessForAdminWeb(admin, c.draftId)).rejects.toBeInstanceOf(DraftAccessError);
    await expect(draftAccessForAdminWeb({ userId: c.a.userId, isSuperAdmin: false }, c.draftId)).rejects.toBeInstanceOf(DraftAccessError);

    const { id } = await grantDraftAdminAccess(admin, c.draftId);
    const access = await draftAccessForAdminWeb(admin, c.draftId);
    expect(access.via).toBe("ADMIN_WEB");
    const p = await previewDraftImport(access, { filename: "a.json", bytes: FILE });
    await commitDraftImport(access, { filename: "a.json", bytes: FILE, version: p.version, sha256: p.sha256 });
    expect((await ob.getMyDraft(c.a))!.data.units).toHaveLength(2);
    const ev = await prisma.auditEvent.findFirst({ where: { action: "onboarding.draft.import", targetId: c.draftId } });
    expect(ev!.actorId).toBe(admin.userId);
    expect(ev!.after).toMatchObject({ via: "ADMIN_WEB" });
    expect(await draftExportDoc(access)).toMatchObject({ format: IMPORT_FORMAT_ID });

    // Klijent (ili admin) uklanja pristup: odmah prestaje da važi, i za ranije izdat DraftAccess pri sljedećem pozivu stranice.
    await revokeDraftAdminAccess(c.a as never, id);
    await expect(draftAccessForAdminWeb(admin, c.draftId)).rejects.toBeInstanceOf(DraftAccessError);
  });

  it("is refused for a draft that is no longer in progress", async () => {
    const c = await client("adm-closed");
    const admin = await createSuperAdminActor("imp-adm-closed");
    await grantDraftAdminAccess(admin, c.draftId);
    await ob.discardOnboardingDraft(c.admin, c.draftId, "test");
    await expect(draftAccessForAdminWeb(admin, c.draftId)).rejects.toBeInstanceOf(DraftAccessError);
  });
});
