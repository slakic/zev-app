// Alati za upis u nacrt kroz /api/mcp (Plans/mcp-onboarding-asistent-plan.md, Faze O-B i O-C): granice alata, paritet sa
// čarobnjakom, brava, grupni upis, guard koraka, oznaka izvora, audit bez sadržaja i dokaz o vlasništvu. Pravi test baza;
// ruta se poziva direktno (isti obrazac kao tests/mcp-route.test.ts).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/server/auth/guards";
import { createMcpConnection } from "@/server/services/mcpConnections";
import { grantDraftAdminAccess } from "@/server/services/mcpDraftAccess";
import { resetMcpRateLimits } from "@/server/mcp/rateLimit";
import * as ob from "@/server/services/onboarding";
import { accepted, createSuperAdminActor } from "./helpers";

const savedFlag = process.env.MCP_ENABLED;
const asActor = (userId: string): Actor => ({ userId, roles: [], partyId: null, zevId: null, label: "Test korisnik" });

const ZEV = {
  legal_name: "ZEV Asistent", short_name: "AS", registration_number: "1-2345/26", jib: "4404567890002",
  registered_address: "Ulica 1", city: "Banja Luka", municipality: "Banja Luka", founding_date: "2026-01-15",
};
const PDF_B64 = Buffer.from("%PDF-1.4 dokaz").toString("base64");

function rpc(payload: unknown, token: string) {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

async function body(res: Response): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = await res.text();
  const data = text.startsWith("event:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim() : text;
  return JSON.parse(data);
}

async function setup(tag: string, opts: { admin?: boolean } = {}) {
  const c = await accepted(tag);
  const actor = asActor(c.actor.userId);
  const draftId = (await ob.getMyDraft(actor))!.id;
  let who: Actor = actor;
  if (opts.admin) {
    who = await createSuperAdminActor(`${tag}-admin`);
    await grantDraftAdminAccess(who, draftId);
  }
  const { token, connection } = await createMcpConnection(who, { name: "Asistent", client: "OTHER", scopeKey: `draft:${draftId}`, days: 7 });
  process.env.MCP_ENABLED = "true";
  vi.resetModules();
  const { POST } = await import("@/app/api/mcp/route");
  let id = 10;
  /** Poziv alata; vraća `result` (structuredContent ili greška alata). */
  const tool = async (name: string, args: Record<string, unknown> = {}) =>
    (await body(await POST(rpc({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } }, token)))).result;
  const version = async () => (await prisma.onboardingDraft.findUniqueOrThrow({ where: { id: draftId } })).version;
  const data = async () => (await ob.getMyDraft(actor))!.data;
  return { c, actor, draftId, tool, version, data, token, connectionId: connection.id, POST };
}

/** Koraci 2–4 kroz alate: ZEV, bankovni račun, zgrada sa ulazom. Vraća ključeve. */
async function fillToUnits(s: Awaited<ReturnType<typeof setup>>) {
  await s.tool("save_zev_details", { expected_version: await s.version(), ...ZEV });
  await s.tool("add_bank_account", { expected_version: await s.version(), type: "BANK", name: "Glavni", number: "0060000123456758", opening_balance: "0", opening_date: "2026-01-01" });
  const b = await s.tool("add_building", { expected_version: await s.version(), name: "Zgrada A", address: "Ulica 1" });
  const buildingKey = b.structuredContent.created[0].key as string;
  const e = await s.tool("add_entrance", { expected_version: await s.version(), building_key: buildingKey, name: "Ulaz 1" });
  return { buildingKey, entranceKey: e.structuredContent.created[0].key as string };
}

const unit = (buildingKey: string, label: string, share: string) => ({ building_key: buildingKey, type: "APARTMENT", label, usable_area: "50", ownership_share: share });

beforeEach(() => resetMcpRateLimits());
afterEach(() => {
  if (savedFlag === undefined) delete process.env.MCP_ENABLED;
  else process.env.MCP_ENABLED = savedFlag;
  vi.resetModules();
});

describe("MCP alati za upis — granice", () => {
  it("lists the write tools with honest annotations, and nothing that publishes, confirms the register or opens accounts", async () => {
    const s = await setup("w-list");
    const tools = (await body(await s.POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, s.token)))).result.tools as {
      name: string; annotations: Record<string, boolean>;
    }[];
    const names = tools.map((x) => x.name);
    for (const n of ["save_zev_details", "add_bank_account", "add_units", "update_unit", "add_common_assets", "set_accountant", "add_board_member", "add_owner_stake", "remove_owner_stake", "set_unit_disputed", "add_stake_proposals"]) {
      expect(names).toContain(n);
    }
    for (const n of names) expect(n).not.toMatch(/publish|confirm|unlock|password|login|discard|invite/);
    const ann = Object.fromEntries(tools.map((x) => [x.name, x.annotations]));
    expect(ann.add_units).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(ann.remove_unit).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(ann.remove_owner_stake).toMatchObject({ destructiveHint: true });
  });
});

describe("MCP alati za upis — koraci 2–6 (O-B)", () => {
  it("fills the draft like the wizard, marks items as written by the assistant and audits without content", async () => {
    const s = await setup("w-fill");
    const { buildingKey, entranceKey } = await fillToUnits(s);
    const v = await s.version();
    const res = await s.tool("add_units", { expected_version: v, units: [{ ...unit(buildingKey, "Stan 1", "60"), entrance_key: entranceKey, floor: 1 }, unit(buildingKey, "Stan 2", "40")] });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({ ok: true, version: v + 1 });
    expect(res.structuredContent.created.map((x: { label: string }) => x.label)).toEqual(["Stan 1", "Stan 2"]);
    await s.tool("add_common_assets", { expected_version: await s.version(), assets: [{ building_key: buildingKey, kind: "AREA", name: "Stepenište" }] });

    const d = await s.data();
    expect(d.zev).toMatchObject({ legalName: "ZEV Asistent", jib: "4404567890002" });
    expect(d.units.map((u) => [u.label, u.usableArea, u.ownershipShare, u.floor, u.entranceKey, u.source])).toEqual([
      ["Stan 1", "50", "60", 1, entranceKey, "MCP_OWNER"],
      ["Stan 2", "50", "40", null, null, "MCP_OWNER"],
    ]);
    for (const item of [d.accounts[0], d.buildings[0], d.buildings[0].entrances[0], d.commonAssets[0]]) expect(item.source).toBe("MCP_OWNER");
    const p = (await ob.getMyDraft(s.actor))!.progress;
    for (const k of ["zev", "accounts", "buildings", "units", "commonAssets"]) expect(p.steps.find((x) => x.key === k)!.complete).toBe(true);
    expect(p.currentStep).toBe("register");

    // Audit: jedan `mcp.call` po upisu, bez sadržaja (nema naziva ni brojeva iz nacrta).
    const events = await prisma.auditEvent.findMany({ where: { action: "mcp.call", targetId: s.draftId }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => (e.after as { tool: string }).tool)).toEqual(["save_zev_details", "add_bank_account", "add_building", "add_entrance", "add_units", "add_common_assets"]);
    expect(events[4].after).toEqual({ tool: "add_units", items: 2, connectionId: s.connectionId, scope: `ONBOARDING_DRAFT:${s.draftId}`, via: "MCP_OWNER" });
    expect(events.every((e) => e.zevId === null && e.actorId === s.actor.userId)).toBe(true);
    const all = JSON.stringify(events);
    for (const secret of ["ZEV Asistent", "Stan 1", "0060000123456758", "Stepenište", s.token]) expect(all).not.toContain(secret);

    // get_draft pokazuje izvor.
    const read = await s.tool("get_draft", { sections: ["units"] });
    expect(read.structuredContent.units[0].source).toBe("MCP_OWNER");
  });

  it("gives the same draft as the wizard functions (parity), apart from keys and the source label", async () => {
    const viaTool = await setup("w-par-a");
    const { buildingKey } = await fillToUnits(viaTool);
    await viaTool.tool("add_units", { expected_version: await viaTool.version(), units: [unit(buildingKey, "S1", "62,40"), unit(buildingKey, "S2", "37.6")] });

    const c = await accepted("w-par-b");
    const a = asActor(c.actor.userId);
    let v = (await ob.getMyDraft(a))!.version;
    v = (await ob.saveZevStep(a, v, { legalName: ZEV.legal_name, shortName: ZEV.short_name, registrationNumber: ZEV.registration_number, jib: ZEV.jib, registeredAddress: ZEV.registered_address, city: ZEV.city, municipality: ZEV.municipality, foundingDate: ZEV.founding_date, registrationDate: "" })).version;
    v = await ob.addDraftAccount(a, v, { type: "BANK", name: "Glavni", number: "0060000123456758", openingBalance: "0", openingDate: "2026-01-01" });
    v = await ob.addDraftBuilding(a, v, { name: "Zgrada A", address: "Ulica 1" });
    const bk = (await ob.getMyDraft(a))!.data.buildings[0].key;
    v = await ob.addDraftEntrance(a, v, bk, "Ulaz 1");
    for (const [label, share] of [["S1", "62,40"], ["S2", "37.6"]]) {
      v = await ob.addDraftUnit(a, v, { buildingKey: bk, type: "APARTMENT", label, usableArea: "50", ownershipShare: share });
    }
    const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, val) => (k === "key" || k.endsWith("Key") || k === "source" ? undefined : val)));
    const [dt, dw] = [await viaTool.data(), (await ob.getMyDraft(a))!.data];
    expect(strip(dt.units)).toEqual(strip(dw.units));
    expect(strip(dt.zev)).toEqual(strip(dw.zev));
    expect(strip(dt.accounts)).toEqual(strip(dw.accounts));
    expect(dw.units.every((u) => u.source === undefined)).toBe(true);
  });

  it("refuses a stale expected_version with the current version and leaves the draft unchanged", async () => {
    const s = await setup("w-stale");
    await s.tool("save_zev_details", { expected_version: await s.version(), ...ZEV });
    const v = await s.version();
    const res = await s.tool("save_zev_details", { expected_version: v - 1, legal_name: "PREGAŽENO" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(`verzija je ${v}`);
    expect(await s.version()).toBe(v);
    expect((await s.data()).zev.legalName).toBe("ZEV Asistent");
    expect(await prisma.auditEvent.count({ where: { action: "mcp.call", targetId: s.draftId } })).toBe(1);
  });

  it("batch: one bad item out of 60 writes nothing and names the item; duplicates inside the batch are caught; 200 make one version", async () => {
    const s = await setup("w-batch");
    const { buildingKey } = await fillToUnits(s);
    const v = await s.version();
    const sixty = Array.from({ length: 60 }, (_, i) => unit(buildingKey, `S${i + 1}`, "1"));
    sixty[41] = { ...sixty[41], usable_area: "0" };
    const bad = await s.tool("add_units", { expected_version: v, units: sixty });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent.issues).toEqual([{ index: 42, message: expect.stringContaining("veći od nule") }]);
    expect(await s.version()).toBe(v);
    expect((await s.data()).units).toHaveLength(0);

    const dup = await s.tool("add_units", { expected_version: v, units: [unit(buildingKey, "D", "50"), unit(buildingKey, "d", "50")] });
    expect(dup.structuredContent.issues.map((x: { index: number }) => x.index)).toEqual([2]);

    const many = Array.from({ length: 200 }, (_, i) => unit(buildingKey, `M${i + 1}`, "0.5"));
    const ok = await s.tool("add_units", { expected_version: v, units: many });
    expect(ok.structuredContent.version).toBe(v + 1);
    expect((await s.data()).units).toHaveLength(200);
    // 201 je iznad granice (šema alata) — nijedan upis.
    const over = await s.tool("add_units", { expected_version: v + 1, units: [...many, unit(buildingKey, "X", "1")] });
    expect(over.isError).toBe(true);
    expect(await s.version()).toBe(v + 1);
  });

  it("keeps the wizard's step guard: no writing ahead of the current step or into steps 4–6 after the register is confirmed", async () => {
    const s = await setup("w-guard");
    const ahead = await s.tool("add_building", { expected_version: await s.version(), name: "Prerano", address: "X" });
    expect(ahead.isError).toBe(true);
    expect(ahead.content[0].text).toMatch(/Prvo završite korak/);

    const { buildingKey } = await fillToUnits(s);
    await s.tool("add_units", { expected_version: await s.version(), units: [unit(buildingKey, "S1", "100")] });
    await s.tool("add_common_assets", { expected_version: await s.version(), assets: [{ building_key: buildingKey, kind: "AREA", name: "Krov" }] });
    await ob.confirmDraftRegister(s.actor, await s.version());
    const locked = await s.tool("add_units", { expected_version: await s.version(), units: [unit(buildingKey, "S2", "1")] });
    expect(locked.isError).toBe(true);
    expect((await s.data()).units).toHaveLength(1);
  });

  it("a manual edit in the wizard clears the assistant label; an admin's assistant gets its own label", async () => {
    const s = await setup("w-src");
    const { buildingKey } = await fillToUnits(s);
    await s.tool("add_units", { expected_version: await s.version(), units: [unit(buildingKey, "S1", "100")] });
    const u = (await s.data()).units[0];
    await ob.updateDraftUnit(s.actor, await s.version(), u.key, { buildingKey, type: "APARTMENT", label: "S1", usableArea: "55", ownershipShare: "100" });
    expect((await s.data()).units[0].source).toBeUndefined();

    const adm = await setup("w-src-adm", { admin: true });
    await adm.tool("save_zev_details", { expected_version: await adm.version(), ...ZEV });
    const acc = await adm.tool("add_bank_account", { expected_version: await adm.version(), type: "BANK", name: "G", number: "0060000123456758", opening_balance: "0", opening_date: "2026-01-01" });
    expect(acc.isError).toBeUndefined();
    expect((await adm.data()).accounts[0].source).toBe("MCP_ADMIN");
    const ev = await prisma.auditEvent.findFirst({ where: { action: "mcp.call", targetId: adm.draftId, after: { path: ["tool"], equals: "add_bank_account" } } });
    expect(ev!.after).toMatchObject({ via: "MCP_ADMIN" });
  });

  it("step 9: accountant and board without accounts; refuses to replace an accountant whose login the client opened", async () => {
    const s = await setup("w-off");
    // Korak 9 je dostupan tek posle koraka 8; za ovaj test se nacrt postavlja direktno (organi ne zavise od ostalog).
    const { buildingKey } = await fillToUnits(s);
    await s.tool("add_units", { expected_version: await s.version(), units: [unit(buildingKey, "S1", "100")] });
    await s.tool("add_common_assets", { expected_version: await s.version(), assets: [{ building_key: buildingKey, kind: "AREA", name: "Krov" }] });
    await ob.confirmDraftRegister(s.actor, await s.version());
    const unitKey = (await s.data()).units[0].key;
    await s.tool("set_unit_disputed", { expected_version: await s.version(), unit_key: unitKey, disputed: true });

    const both = await s.tool("set_accountant", { expected_version: await s.version(), valid_from: "2026-01-01", party_key: "president", new_party: { kind: "PERSON", first_name: "A", last_name: "B" } });
    expect(both.isError).toBe(true);
    const acc = await s.tool("set_accountant", { expected_version: await s.version(), valid_from: "2026-01-01", new_party: { kind: "PERSON", first_name: "Rada", last_name: "Knjiga", email: "rada@primjer.test" } });
    expect(acc.isError).toBeUndefined();
    const board = await s.tool("add_board_member", { expected_version: await s.version(), valid_from: "2026-01-01", party_key: "president" });
    expect(board.structuredContent.created).toHaveLength(1);
    const d = await s.data();
    expect(d.offices.accountant).toMatchObject({ loginEmail: null, passwordHash: null, source: "MCP_OWNER" });
    expect(d.parties.find((p) => p.firstName === "Rada")!.source).toBe("MCP_OWNER");
    expect(d.offices.board[0]).toMatchObject({ partyKey: "president", source: "MCP_OWNER" });

    // Klijent otvara nalog računovođi; asistent ga više ne mijenja.
    await ob.setDraftAccountant(s.actor, await s.version(), { partyKey: d.parties[0].key, validFrom: "2026-01-01", loginEmail: "w-off-rac@primjer.test", password: "Lozinka123" });
    const refused = await s.tool("set_accountant_later", { expected_version: await s.version(), later: true });
    expect(refused.isError).toBe(true);
    expect((await s.data()).offices.accountant).toMatchObject({ loginEmail: "w-off-rac@primjer.test" });
  });
});

describe("MCP alati za vlasnike (O-C)", () => {
  async function atOwners(tag: string) {
    const s = await setup(tag);
    const { buildingKey } = await fillToUnits(s);
    await s.tool("add_units", { expected_version: await s.version(), units: [unit(buildingKey, "S1", "60"), unit(buildingKey, "S2", "40")] });
    await s.tool("add_common_assets", { expected_version: await s.version(), assets: [{ building_key: buildingKey, kind: "AREA", name: "Krov" }] });
    await ob.confirmDraftRegister(s.actor, await s.version());
    const [u1, u2] = (await s.data()).units.map((u) => u.key);
    return { ...s, u1, u2 };
  }
  const files = (draftId: string) => prisma.onboardingDraftFile.count({ where: { draftId } });

  it("adds an owner with a base64 proof, removes it together with the file, and rejects bad proofs without a leftover file", async () => {
    const s = await atOwners("w-own");
    const proof = { filename: "izvod.pdf", mime: "application/pdf", content_base64: PDF_B64 };
    const res = await s.tool("add_owner_stake", {
      expected_version: await s.version(), unit_key: s.u1, share_percent: "100", valid_from: "2026-01-01",
      new_party: { kind: "PERSON", first_name: "Marko", last_name: "Marković" }, proof,
    });
    expect(res.isError).toBeUndefined();
    const d = await s.data();
    expect(d.stakes[0]).toMatchObject({ unitKey: s.u1, sharePercent: "100", proofFilename: "izvod.pdf", source: "MCP_OWNER" });
    const file = await prisma.onboardingDraftFile.findUniqueOrThrow({ where: { id: d.stakes[0].proofFileId } });
    expect(Buffer.from(file.bytes).toString()).toBe("%PDF-1.4 dokaz");
    // Odgovor ne vraća sadržaj ni id fajla.
    expect(JSON.stringify(res)).not.toContain(file.id);
    expect(JSON.stringify(res)).not.toContain(PDF_B64);

    const before = await files(s.draftId);
    const v = await s.version();
    const base = { expected_version: v, unit_key: s.u2, share_percent: "100", valid_from: "2026-01-01", party_key: "president" };
    expect((await s.tool("add_owner_stake", { ...base, proof: { ...proof, content_base64: "nije base64!!" } })).isError).toBe(true);
    const tooBig = Buffer.alloc(4 * 1024 * 1024 + 1, 1).toString("base64");
    const big = await s.tool("add_owner_stake", { ...base, proof: { ...proof, content_base64: tooBig } });
    expect(big.isError).toBe(true);
    expect(big.content[0].text).toMatch(/prevelik/);
    expect((await s.tool("add_owner_stake", { ...base, proof: { ...proof, mime: "text/html" } })).isError).toBe(true);
    expect((await s.tool("add_owner_stake", { ...base, share_percent: "0", proof })).isError).toBe(true);
    expect(await files(s.draftId)).toBe(before);
    expect(await s.version()).toBe(v);

    const rm = await s.tool("remove_owner_stake", { expected_version: v, key: d.stakes[0].key });
    expect(rm.isError).toBeUndefined();
    expect(await files(s.draftId)).toBe(before - 1);
  });

  it("stake proposals: owners without proof, all or nothing, not counted as stakes", async () => {
    const s = await atOwners("w-prop");
    const v = await s.version();
    const bad = await s.tool("add_stake_proposals", {
      expected_version: v,
      proposals: [
        { unit_key: s.u1, share_percent: "50", valid_from: "2026-01-01", new_party: { kind: "PERSON", first_name: "Ana", last_name: "A" } },
        { unit_key: "nema", share_percent: "50", valid_from: "2026-01-01", party_key: "president" },
      ],
    });
    expect(bad.structuredContent.issues).toEqual([{ index: 2, message: expect.stringContaining("nije pronađen") }]);
    expect((await s.data()).parties).toHaveLength(0);

    const ok = await s.tool("add_stake_proposals", {
      expected_version: v,
      proposals: [
        { unit_key: s.u1, share_percent: "50", valid_from: "2026-01-01", new_party: { kind: "PERSON", first_name: "Ana", last_name: "A" } },
        { unit_key: s.u1, share_percent: "50", valid_from: "2026-01-01", party_key: "president" },
      ],
    });
    expect(ok.structuredContent.created).toHaveLength(2);
    const d = await s.data();
    expect(d.stakes).toHaveLength(0);
    expect(d.stakeProposals.map((p) => p.source)).toEqual(["MCP_OWNER", "MCP_OWNER"]);
    expect((await ob.getMyDraft(s.actor))!.progress.steps.find((x) => x.key === "owners")!.complete).toBe(false);
  });

  it("after the draft is discarded, the next write is a tool error", async () => {
    const s = await atOwners("w-end");
    await ob.discardOnboardingDraft(s.c.admin, s.draftId, "test");
    const res = await s.tool("set_unit_disputed", { expected_version: 0, unit_key: s.u1, disputed: true });
    expect(res.isError).toBe(true);
  });
});
