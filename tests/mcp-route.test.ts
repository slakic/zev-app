// /api/mcp (Plans/mcp-platforma-plan.md, P-A): ruta iza MCP_ENABLED, token u Authorization zaglavlju, alati po
// opsegu veze. Precedent: tests/health.test.ts (poziva handler direktno). getEnv() kešira, pa se modul
// uvozi svjež poslije postavljanja MCP_ENABLED.
import { CSV_COLUMNS, IMPORT_FORMAT_ID, IMPORT_FORMAT_VERSION, IMPORT_JSON_EXAMPLE, IMPORT_SCHEMA_DESCRIPTION, assistantInstructions } from "@/lib/onboarding/import/importFormat";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/server/auth/guards";
import { createMcpConnection } from "@/server/services/mcpConnections";
import { discardOnboardingDraft, getMyDraft } from "@/server/services/onboarding";
import { grantDraftAdminAccess, revokeDraftAdminAccess } from "@/server/services/mcpDraftAccess";
import { accepted, createSuperAdminActor } from "./helpers";

const savedFlag = process.env.MCP_ENABLED;

async function loadRoute(flag: "true" | "false") {
  process.env.MCP_ENABLED = flag;
  vi.resetModules();
  return import("@/app/api/mcp/route");
}

function rpc(body: unknown, token?: string, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

/** Tijelo odgovora: običan JSON ili jedan SSE događaj (stariji, „legacy" put SDK-a odgovara kao `event: message`). */
async function body(res: Response): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = await res.text();
  const data = text.startsWith("event:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim() : text;
  return JSON.parse(data);
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
};

describe("/api/mcp", () => {
  beforeEach(() => {
    process.env.MCP_ENABLED = "true";
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.MCP_ENABLED;
    else process.env.MCP_ENABLED = savedFlag;
    vi.resetModules();
  });

  it("returns 404 while MCP_ENABLED is off", async () => {
    const { POST } = await loadRoute("false");
    const res = await POST(rpc(INIT, "zev_mcp_" + "A".repeat(43)));
    expect(res.status).toBe(404);
  });

  it("returns 401 with a Bearer challenge (and no resource metadata) for a missing or unknown token", async () => {
    const { POST } = await loadRoute("true");
    for (const token of [undefined, "zev_mcp_" + "B".repeat(43), "nije-token"]) {
      const res = await POST(rpc(INIT, token));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Bearer realm="zev-upravnik"');
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("serves initialize, tools/list (only whoami) and a whoami call that leaks no secrets", async () => {
    const admin = await createSuperAdminActor("mcp-route");
    const { token } = await createMcpConnection(admin, { name: "Rutni test", client: "OTHER", scopeKey: "none", days: 7 });
    const { POST } = await loadRoute("true");

    const init = await POST(rpc(INIT, token));
    expect(init.status).toBe(200);
    expect(JSON.stringify(await body(init))).toContain("zev-upravnik");

    const list = await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, token));
    expect(list.status).toBe(200);
    const listed = await body(list);
    expect(listed.result.tools.map((t: { name: string }) => t.name)).toEqual(["whoami"]);

    const call = await POST(rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } }, token));
    expect(call.status).toBe(200);
    const result = await body(call);
    const raw = JSON.stringify(result);
    const payload = result.result.structuredContent;
    expect(payload).toMatchObject({
      user: { displayName: expect.any(String) },
      connection: { name: "Rutni test", client: "OTHER", expiresAt: expect.any(String) },
      scopes: [],
    });
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(admin.userId);
    expect(raw).not.toMatch(/@platform\.test/);
  });

  it("rate-limits a single connection after 120 calls per minute", async () => {
    const admin = await createSuperAdminActor("mcp-route-rl");
    const { token } = await createMcpConnection(admin, { name: "Limit", client: "OTHER", scopeKey: "none", days: 7 });
    const { POST } = await loadRoute("true");
    const ping = { jsonrpc: "2.0", id: 9, method: "ping" };
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await POST(rpc(ping, token))).status;
    expect(last).toBe(429);
  });
});

// ---- Faza O-A: alati za nacrt ------------------------------------------------------------------

const asActor = (userId: string): Actor => ({ userId, roles: [], partyId: null, zevId: null, label: "Test korisnik" });
const call = (name: string, args: Record<string, unknown> = {}, id = 5) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

async function clientWithDraft(tag: string) {
  const c = await accepted(tag);
  const actor = asActor(c.actor.userId);
  const draft = (await getMyDraft(actor))!;
  return { actor, draftId: draft.id, inviter: c.admin, email: c.email };
}

describe("/api/mcp — alati za nacrt (O-A)", () => {
  beforeEach(() => {
    process.env.MCP_ENABLED = "true";
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.MCP_ENABLED;
    else process.env.MCP_ENABLED = savedFlag;
    vi.resetModules();
  });

  it("lists only whoami without a scope and the draft tools with a draft scope", async () => {
    const c = await clientWithDraft("rt-list");
    const none = await createMcpConnection(c.actor, { name: "Bez opsega", client: "OTHER", scopeKey: "none", days: 7 });
    const withDraft = await createMcpConnection(c.actor, { name: "Sa nacrtom", client: "OTHER", scopeKey: `draft:${c.draftId}`, days: 7 });
    const { POST } = await loadRoute("true");
    const names = async (token: string) => (await body(await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, token)))).result.tools.map((x: { name: string }) => x.name);
    expect(await names(none.token)).toEqual(["whoami"]);
    expect(await names(withDraft.token)).toEqual(["whoami", "get_onboarding_status", "get_draft", "get_import_format"]);
    const tools = (await body(await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, withDraft.token)))).result.tools;
    for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("get_import_format returns the shared import description (same source as the import page) and is read-only", async () => {
    const c = await clientWithDraft("rt-fmt");
    const { token } = await createMcpConnection(c.actor, { name: "Format", client: "OTHER", scopeKey: `draft:${c.draftId}`, days: 7 });
    const { POST } = await loadRoute("true");
    const res = (await body(await POST(rpc(call("get_import_format"), token)))).result;
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({
      format: IMPORT_FORMAT_ID,
      formatVersion: IMPORT_FORMAT_VERSION,
      instructions: assistantInstructions(),
      fields: IMPORT_SCHEMA_DESCRIPTION,
      example: IMPORT_JSON_EXAMPLE,
    });
    expect(res.structuredContent.csvColumns.map((x: { name: string }) => x.name)).toEqual(CSV_COLUMNS.map((x) => x.name));
    // Draft version is a different concept from the file format version.
    expect(res.structuredContent).not.toHaveProperty("version");
  });

  it("owner: status and draft without draft_id, no secrets in the response, no audit rows from reads", async () => {
    const c = await clientWithDraft("rt-owner");
    const draft = (await getMyDraft(c.actor))!;
    // Podaci sa svim osjetljivim poljima + stvarni fajl dokaza u bazi.
    const file = await prisma.onboardingDraftFile.create({ data: { draftId: c.draftId, filename: "list.pdf", mime: "application/pdf", size: 14, bytes: Buffer.from("TAJNI-SADRZAJ-FAJLA") } });
    await prisma.onboardingDraft.update({
      where: { id: c.draftId },
      data: {
        data: {
          ...draft.data,
          zev: { ...draft.data.zev, legalName: "ZEV Rutni" },
          parties: [{ key: "p1", kind: "PERSON", firstName: "Marko", lastName: "Marković", email: "marko@primjer.test", phone: "066" }],
          stakes: [{ key: "s1", unitKey: "u1", partyKey: "p1", sharePercent: "100", validFrom: "2026-01-01", proofFileId: file.id, proofFilename: "list.pdf" }],
          offices: { accountant: { key: "o1", partyKey: "p1", validFrom: "2026-02-01", loginEmail: "r@primjer.test", passwordHash: "$argon2id$TAJNIHASH" }, board: [] },
        } as object,
      },
    });
    const { connection, token } = await createMcpConnection(c.actor, { name: "Vlasnik", client: "OTHER", scopeKey: `draft:${c.draftId}`, days: 7 });
    const { POST } = await loadRoute("true");
    const auditBefore = await prisma.auditEvent.count({ where: { action: { startsWith: "mcp." } } });

    const st = await POST(rpc(call("get_onboarding_status"), token));
    expect(st.status).toBe(200);
    const status = (await body(st)).result;
    expect(status.isError).toBeUndefined();
    expect(status.structuredContent).toMatchObject({
      draft: { id: c.draftId, version: expect.any(Number), tier: "BASIC_FINANCE" },
      access: "OWNER",
      currentStep: { key: expect.any(String), number: expect.any(Number) },
      registerConfirmed: false,
      readyToPublish: false,
    });
    expect(status.structuredContent.steps).toHaveLength(10);
    expect(status.structuredContent.steps[0]).toMatchObject({ key: "account", reachable: true, readOnly: false });

    const dr = await POST(rpc(call("get_draft"), token));
    const raw = await dr.text();
    const parsed = JSON.parse(raw.startsWith("event:") ? raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : raw).result;
    expect(parsed.structuredContent).toMatchObject({ draftId: c.draftId, access: "OWNER", zev: { legalName: "ZEV Rutni" } });
    expect(parsed.structuredContent.stakes[0].proof).toEqual({ filename: "list.pdf", mime: "application/pdf", size: 14 });
    for (const secret of [token, c.email, c.actor.userId, "ownerUserId", "passwordHash", "TAJNIHASH", "TAJNI-SADRZAJ-FAJLA", Buffer.from("TAJNI-SADRZAJ-FAJLA").toString("base64"), file.id, connection.id]) {
      expect(raw).not.toContain(secret);
    }

    // Samo jedan odjeljak.
    const sec = await POST(rpc(call("get_draft", { sections: ["accounts"] }), token));
    expect(Object.keys((await body(sec)).result.structuredContent).sort()).toEqual(["access", "accounts", "draftId", "label", "noAccounts", "tier", "version"]);
    expect(await prisma.auditEvent.count({ where: { action: { startsWith: "mcp." } } })).toBe(auditBefore);
  });

  it("returns tool errors (HTTP 200) for a foreign, unknown or closed draft and leaks nothing", async () => {
    const mine = await clientWithDraft("rt-err-a");
    const other = await clientWithDraft("rt-err-b");
    await prisma.onboardingDraft.update({ where: { id: other.draftId }, data: { data: { zev: { legalName: "TUĐI-NAZIV-ZEV" } } } });
    const { token } = await createMcpConnection(mine.actor, { name: "Moja", client: "OTHER", scopeKey: `draft:${mine.draftId}`, days: 7 });
    const { POST } = await loadRoute("true");

    for (const draft_id of [other.draftId, "ne-postoji"]) {
      const res = await POST(rpc(call("get_draft", { draft_id }), token));
      expect(res.status).toBe(200);
      const text = JSON.stringify(await body(res));
      expect(text).toContain('"isError":true');
      expect(text).not.toContain("TUĐI-NAZIV-ZEV");
    }
    // Nevažeći ulaz je greška protokola/alata, ne pad servera.
    expect((await POST(rpc(call("get_draft", { sections: ["nepoznato"] }), token))).status).toBe(200);

    await discardOnboardingDraft(mine.inviter, mine.draftId, "test");
    const closed = await POST(rpc(call("get_onboarding_status"), token));
    expect(closed.status).toBe(200);
    expect((await body(closed)).result).toMatchObject({ isError: true });
  });

  it("requires draft_id when the connection has more than one draft scope", async () => {
    const c = await clientWithDraft("rt-multi");
    const admin = await createSuperAdminActor("rt-multi-admin");
    const second = await clientWithDraft("rt-multi-2");
    await grantDraftAdminAccess(admin, c.draftId);
    await grantDraftAdminAccess(admin, second.draftId);
    const { token } = await createMcpConnection(admin, { name: "Dva", client: "OTHER", scopeKey: `draft:${c.draftId}`, days: 7 });
    // Veza dobija jedan opseg po izboru; drugi se dodaje direktno u bazu (forma nudi jedan po vezi).
    await prisma.mcpConnection.updateMany({ where: { userId: admin.userId }, data: { scopes: [{ kind: "ONBOARDING_DRAFT", draftId: c.draftId }, { kind: "ONBOARDING_DRAFT", draftId: second.draftId }] } });
    const { POST } = await loadRoute("true");
    const miss = (await body(await POST(rpc(call("get_draft"), token)))).result;
    expect(miss.isError).toBe(true);
    expect(miss.content[0].text).toContain("draft_id");
    const ok = (await body(await POST(rpc(call("get_onboarding_status", { draft_id: second.draftId }), token)))).result;
    expect(ok.isError).toBeUndefined();
    expect(ok.structuredContent.draft.id).toBe(second.draftId);
  });

  it("super admin with access reads the draft as ADMIN; the client revokes and the next call is a tool error", async () => {
    const c = await clientWithDraft("rt-admin");
    const admin = await createSuperAdminActor("rt-admin-admin");
    await expect(createMcpConnection(admin, { name: "Prerano", client: "OTHER", scopeKey: `draft:${c.draftId}`, days: 7 })).rejects.toThrow();
    const { id } = await grantDraftAdminAccess(admin, c.draftId);
    const { token } = await createMcpConnection(admin, { name: "Admin", client: "OTHER", scopeKey: `draft:${c.draftId}`, days: 7 });
    const { POST } = await loadRoute("true");

    const first = (await body(await POST(rpc(call("get_draft"), token)))).result;
    expect(first.isError).toBeUndefined();
    expect(first.structuredContent).toMatchObject({ draftId: c.draftId, access: "ADMIN" });
    const who = (await body(await POST(rpc(call("whoami"), token)))).result.structuredContent;
    expect(who.scopes[0]).toMatchObject({ active: true, via: "ADMIN" });

    await revokeDraftAdminAccess(c.actor, id);
    const after = await POST(rpc(call("get_draft"), token));
    expect(after.status).toBe(200);
    expect((await body(after)).result).toMatchObject({ isError: true });
    expect((await body(await POST(rpc(call("whoami"), token)))).result.structuredContent.scopes[0]).toMatchObject({ active: false, via: null });
  });
});
