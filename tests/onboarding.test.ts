// Onboarding novog ZEV-a, Faza A (Plans/zev-onboarding-wizard-plan.md): poziv, nalog pozvanog i nacrt.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/server/auth/password";
import { ForbiddenError } from "@/server/auth/guards";
import {
  acceptOnboardingInvite,
  addDraftAccount,
  addDraftBuilding,
  addDraftEntrance,
  createOnboardingInvite,
  getMyDraft,
  inspectOnboardingInvite,
  landingPath,
  listOnboardingInvites,
  reissueOnboardingInvite,
  removeDraftBuilding,
  revokeOnboardingInvite,
  saveAccountStep,
  saveZevStep,
  setNoAccounts,
  StaleDraftError,
} from "@/server/services/onboarding";
import { createFixture, createSuperAdminActor, uid } from "./helpers";

const ZEV = {
  legalName: "ZEV Kralja Petra I 45", shortName: "", registrationNumber: "1-2345/26", jib: "4404567890002",
  registeredAddress: "Kralja Petra I 45", city: "Banja Luka", municipality: "Banja Luka", foundingDate: "", registrationDate: "",
};

async function invite(tag: string, tier: "BASIC" | "BASIC_FINANCE" | "FULL" = "BASIC_FINANCE") {
  const admin = await createSuperAdminActor(`ob-${tag}`);
  const email = `${uid(tag)}@klijent.test`;
  const res = await createOnboardingInvite(admin, { workingName: `ZEV ${tag}`, tier, email });
  return { admin, email, ...res };
}

async function accepted(tag: string, tier?: "BASIC" | "BASIC_FINANCE" | "FULL") {
  const inv = await invite(tag, tier);
  const r = await acceptOnboardingInvite(inv.token, { mode: "new", firstName: "Dragana", lastName: "Savić", password: "Lozinka123", confirm: "Lozinka123" });
  if (!r.ok) throw new Error(`accept failed: ${r.error}`);
  return { ...inv, actor: { userId: r.userId } };
}

describe("createOnboardingInvite", () => {
  it("is super-admin only, stores only the token hash, and audits without a ZEV", async () => {
    const f = await createFixture("ob-guard");
    await expect(createOnboardingInvite(f.president, { workingName: "X", tier: "FULL", email: "x@klijent.test" })).rejects.toThrow(ForbiddenError);
    const { inviteId, token, expiresAt } = await invite("create");
    const row = await prisma.onboardingInvite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(row.tokenHash).not.toContain(token);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(13 * 86400000);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "onboarding.invite.create", targetId: inviteId } });
    expect(ev.zevId).toBeNull();
    expect(JSON.stringify(ev.after)).not.toContain(token);
  });

  it("refuses a second active invite for the same e-mail and an invalid address", async () => {
    const { admin, email } = await invite("dup");
    await expect(createOnboardingInvite(admin, { workingName: "Drugi", tier: "FULL", email: email.toUpperCase() })).rejects.toThrow(/aktivan poziv/);
    await expect(createOnboardingInvite(admin, { workingName: "X", tier: "FULL", email: "nije-adresa" })).rejects.toThrow(/ispravnu e-mail/);
  });
});

describe("inspect / accept", () => {
  it("a valid link creates a login WITHOUT any membership plus a draft, and cannot be used twice", async () => {
    const inv = await invite("accept");
    const info = await inspectOnboardingInvite(inv.token);
    expect(info).toMatchObject({ ok: true, workingName: "ZEV accept", existingUser: false });
    expect((await prisma.onboardingInvite.findUniqueOrThrow({ where: { id: inv.inviteId } })).openedAt).not.toBeNull();

    const r = await acceptOnboardingInvite(inv.token, { mode: "new", firstName: " Dragana ", lastName: "Savić", password: "Lozinka123", confirm: "Lozinka123" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await prisma.membership.count({ where: { userId: r.userId } })).toBe(0);
    const draft = await getMyDraft({ userId: r.userId });
    expect(draft?.data.president).toMatchObject({ firstName: "Dragana", lastName: "Savić" });
    expect(draft?.data.zev.legalName).toBe("ZEV accept");
    expect(draft?.progress.currentStep).toBe("zev");

    expect(await inspectOnboardingInvite(inv.token)).toEqual({ ok: false, error: "used" });
    expect((await acceptOnboardingInvite(inv.token, { mode: "new", firstName: "X", lastName: "Y", password: "Lozinka123", confirm: "Lozinka123" })).ok).toBe(false);
    expect(await landingPath({ userId: r.userId, zevId: null, isSuperAdmin: false })).toBe("/onboarding");
  });

  it("reports unknown, expired and revoked links, a password mismatch and a weak password", async () => {
    expect(await inspectOnboardingInvite("nepostojeci-token")).toEqual({ ok: false, error: "invalid" });
    const inv = await invite("bad");
    expect(await acceptOnboardingInvite(inv.token, { mode: "new", firstName: "A", lastName: "B", password: "Lozinka123", confirm: "Drugacija1" })).toMatchObject({ ok: false, error: "mismatch" });
    expect(await acceptOnboardingInvite(inv.token, { mode: "new", firstName: "A", lastName: "B", password: "kratka", confirm: "kratka" })).toMatchObject({ ok: false, error: "credentials" });
    await prisma.onboardingInvite.update({ where: { id: inv.inviteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await inspectOnboardingInvite(inv.token)).toEqual({ ok: false, error: "expired" });

    const inv2 = await invite("revoke");
    await expect(revokeOnboardingInvite(inv2.admin, inv2.inviteId, "  ")).rejects.toThrow(/Razlog/);
    await revokeOnboardingInvite(inv2.admin, inv2.inviteId, "Klijent odustao");
    expect(await inspectOnboardingInvite(inv2.token)).toEqual({ ok: false, error: "revoked" });
  });

  it("an existing account signs in with its own password instead of creating a second login", async () => {
    const admin = await createSuperAdminActor("ob-existing");
    const email = `${uid("existing")}@klijent.test`;
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword("Postojeca1"), roles: [] } });
    const { token } = await createOnboardingInvite(admin, { workingName: "Drugi ZEV", tier: "FULL", email });
    expect(await inspectOnboardingInvite(token)).toMatchObject({ ok: true, existingUser: true });
    expect(await acceptOnboardingInvite(token, { mode: "existing", password: "Pogresna1" })).toMatchObject({ ok: false, error: "credentials" });
    const r = await acceptOnboardingInvite(token, { mode: "existing", password: "Postojeca1" });
    expect(r).toEqual({ ok: true, userId: user.id });
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it("two simultaneous accepts: exactly one wins", async () => {
    const inv = await invite("race");
    const input = { mode: "new" as const, firstName: "A", lastName: "B", password: "Lozinka123", confirm: "Lozinka123" };
    const results = await Promise.allSettled([acceptOnboardingInvite(inv.token, input), acceptOnboardingInvite(inv.token, input)]);
    const ok = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    expect(ok).toBe(1);
    expect(await prisma.onboardingDraft.count({ where: { inviteId: inv.inviteId } })).toBe(1);
  });
});

describe("reissue", () => {
  it("a new link invalidates the old one; not allowed once the client accepted", async () => {
    const inv = await invite("reissue");
    const { token: fresh } = await reissueOnboardingInvite(inv.admin, inv.inviteId);
    expect(await inspectOnboardingInvite(inv.token)).toEqual({ ok: false, error: "invalid" });
    expect(await inspectOnboardingInvite(fresh)).toMatchObject({ ok: true });
    await acceptOnboardingInvite(fresh, { mode: "new", firstName: "A", lastName: "B", password: "Lozinka123", confirm: "Lozinka123" });
    await expect(reissueOnboardingInvite(inv.admin, inv.inviteId)).rejects.toThrow(/još nije prihvatio/);
  });
});

describe("draft steps", () => {
  it("applies the same JIB and account-number rules as the app (D5)", async () => {
    const { actor } = await accepted("rules");
    let v = (await getMyDraft(actor))!.version;
    // Neispravan JIB se čuva (forma ne gubi ostale podatke), ali korak ostaje nekompletan.
    const bad = await saveZevStep(actor, v, { ...ZEV, jib: "123" });
    expect(bad.jibValid).toBe(false);
    let d0 = (await getMyDraft(actor))!;
    expect(d0.data.zev.city).toBe("Banja Luka");
    expect(d0.progress.currentStep).toBe("zev");
    expect(d0.progress.steps[1].issues.map((i) => i.key)).toEqual(["zev.jib"]);
    v = (await saveZevStep(actor, bad.version, ZEV)).version;
    d0 = (await getMyDraft(actor))!;
    expect(d0.progress.currentStep).toBe("accounts");
    await expect(addDraftAccount(actor, v, { type: "BANK", name: "Glavni", number: "1111111111111111", openingBalance: "0", openingDate: "2026-01-01" })).rejects.toThrow(/kontrolnim brojem/);
    await expect(addDraftAccount(actor, v, { type: "BANK", name: "Glavni", number: "", openingBalance: "0", openingDate: "2026-01-01" })).rejects.toThrow(/broj računa/);
    v = await addDraftAccount(actor, v, { type: "BANK", name: "Glavni", number: "006-000-01234567-58", openingBalance: "2.450,00", openingDate: "2026-01-01" });
    const d = (await getMyDraft(actor))!;
    expect(d.data.accounts[0]).toMatchObject({ number: "006-000-01234567-58", openingBalance: "2450.00" });
    expect(d.progress.currentStep).toBe("buildings");
  });

  it("refuses a step after the current one and a stale version", async () => {
    const { actor } = await accepted("guard");
    const v = (await getMyDraft(actor))!.version;
    await expect(addDraftBuilding(actor, v, { name: "Zgrada", address: "Adresa 1" })).rejects.toThrow(/Prvo završite korak/);
    const v2 = await saveAccountStep(actor, v, { firstName: "Dragana", lastName: "Savić" });
    expect(v2).toBe(v + 1);
    await expect(saveAccountStep(actor, v, { firstName: "X", lastName: "Y" })).rejects.toThrow(StaleDraftError);
    // Bez nacrta (drugi korisnik) nema šta da se mijenja.
    await expect(saveAccountStep({ userId: "nepostojeci" }, 0, { firstName: "X", lastName: "Y" })).rejects.toThrow(/Nemate nacrt/);
  });

  it("buildings and entrances: unique names, removal; BASIC may continue without an account", async () => {
    const { actor } = await accepted("buildings", "BASIC");
    let v = (await saveZevStep(actor, (await getMyDraft(actor))!.version, ZEV)).version;
    await expect(setNoAccounts({ userId: actor.userId }, v, true)).resolves.toBe(v + 1);
    v = v + 1;
    v = await addDraftBuilding(actor, v, { name: "Kralja Petra I 45", address: "Kralja Petra I 45", yearBuilt: "1978" });
    await expect(addDraftBuilding(actor, v, { name: "kralja petra i 45", address: "X" })).rejects.toThrow(/već postoji/);
    await expect(addDraftBuilding(actor, v, { name: "Druga", address: "X", floorsCount: "pet" })).rejects.toThrow(/cijeli broj/);
    const b = (await getMyDraft(actor))!.data.buildings[0];
    expect(b.yearBuilt).toBe(1978);
    v = await addDraftEntrance(actor, v, b.key, "A");
    await expect(addDraftEntrance(actor, v, b.key, "a")).rejects.toThrow(/već postoji/);
    let d = (await getMyDraft(actor))!;
    expect(d.progress.currentStep).toBe("units");
    v = await removeDraftBuilding(actor, v, b.key);
    d = (await getMyDraft(actor))!;
    expect(d.data.buildings).toEqual([]);
    expect(d.progress.currentStep).toBe("buildings");
  });

  it("FULL tier cannot skip the bank account", async () => {
    const { actor } = await accepted("full", "FULL");
    const v = (await saveZevStep(actor, (await getMyDraft(actor))!.version, ZEV)).version;
    await expect(setNoAccounts(actor, v, true)).rejects.toThrow(/obavezan/);
  });
});

describe("listOnboardingInvites", () => {
  it("shows waiting, expired, revoked and in-progress invites with the client's current step", async () => {
    const waiting = await invite("list-wait");
    const expired = await invite("list-exp");
    await prisma.onboardingInvite.update({ where: { id: expired.inviteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const revoked = await invite("list-rev");
    await revokeOnboardingInvite(revoked.admin, revoked.inviteId, "Test");
    const progressing = await accepted("list-prog");
    const rows = await listOnboardingInvites(waiting.admin);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(waiting.inviteId).state).toBe("ACTIVE");
    expect(by(expired.inviteId).state).toBe("EXPIRED");
    expect(by(revoked.inviteId).state).toBe("REVOKED");
    expect(by(progressing.inviteId)).toMatchObject({ state: "IN_PROGRESS", currentStep: { number: 2 } });
    const f = await createFixture("ob-list-guard");
    await expect(listOnboardingInvites(f.president)).rejects.toThrow(ForbiddenError);
  });
});
