// Veze asistenata (MCP), Faza P-A (Plans/mcp-platforma-plan.md): pravljenje, opsezi, provjera tokena, prekid i
// provjera opsega na svakom pozivu. Pravi test baza, kao onboarding.test.ts.
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/server/auth/guards";
import { sha256 } from "@/server/auth/tokens";
import { discardOnboardingDraft, getMyDraft } from "@/server/services/onboarding";
import {
  createMcpConnection,
  listMyMcpConnections,
  listOfferedScopes,
  revokeMcpConnection,
} from "@/server/services/mcpConnections";
import { verifyMcpToken } from "@/server/mcp/auth";
import { describeScopes, resolveMcpAccess } from "@/server/mcp/access";
import { resetMcpRateLimits } from "@/server/mcp/rateLimit";
import { MCP_TOKEN_PREFIX, parseScopes } from "@/lib/mcp/scopes";
import { accepted, createSuperAdminActor } from "./helpers";

function asActor(userId: string): Actor {
  return { userId, roles: [], partyId: null, zevId: null, label: "Test korisnik" };
}

/** Klijent iz poziva koji ima nacrt u toku; vraća Actor, id nacrta i super admina koji ga je pozvao. */
async function clientWithDraft(tag: string) {
  const c = await accepted(tag);
  const actor = asActor(c.actor.userId);
  const draft = await getMyDraft(actor);
  if (!draft) throw new Error("nacrt nedostaje");
  return { actor, draftId: draft.id, admin: c.admin };
}

const base = { name: "Moj Claude", client: "CLAUDE", days: 30 } as const;
const bearer = (token: string) => `Bearer ${token}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => resetMcpRateLimits());

describe("createMcpConnection", () => {
  it("returns a prefixed token, stores only its sha256 and never writes it to the audit trail", async () => {
    const admin = await createSuperAdminActor("mcp-create");
    const { connection, token } = await createMcpConnection(admin, { ...base, scopeKey: "none" });
    expect(token.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
    expect(token).toHaveLength(MCP_TOKEN_PREFIX.length + 43);

    const row = await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(row.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.kind).toBe("TOKEN");
    expect(row.scopes).toEqual([]);
    expect(connection.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400000);

    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "mcp.connection.create", targetId: connection.id } });
    expect(ev.zevId).toBeNull();
    expect(ev.actorId).toBe(admin.userId);
    expect(JSON.stringify(ev)).not.toContain(token);
    expect(JSON.stringify(ev)).not.toContain(row.tokenHash!);
  });

  it("validates the name and the expiry choice", async () => {
    const admin = await createSuperAdminActor("mcp-valid");
    await expect(createMcpConnection(admin, { ...base, name: "   ", scopeKey: "none" })).rejects.toThrow(/naziv/i);
    await expect(createMcpConnection(admin, { ...base, name: "x".repeat(81), scopeKey: "none" })).rejects.toThrow();
    await expect(createMcpConnection(admin, { ...base, days: 365, scopeKey: "none" })).rejects.toThrow(/rok/i);
  });

  it("offers only the caller's own in-progress drafts and rejects a forged draft key", async () => {
    const a = await clientWithDraft("mcp-a");
    const b = await clientWithDraft("mcp-b");

    const offeredA = await listOfferedScopes(a.actor);
    expect(offeredA.map((o) => o.key)).toEqual([`draft:${a.draftId}`]);
    expect(offeredA[0].scope).toEqual({ kind: "ONBOARDING_DRAFT", draftId: a.draftId });

    await expect(createMcpConnection(a.actor, { ...base, scopeKey: `draft:${b.draftId}` })).rejects.toThrow(/nacrt/i);
    await expect(createMcpConnection(a.actor, { ...base, scopeKey: "draft:ne-postoji" })).rejects.toThrow(/nacrt/i);

    const { connection } = await createMcpConnection(a.actor, { ...base, scopeKey: `draft:${a.draftId}` });
    const row = await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(parseScopes(row.scopes)).toEqual([{ kind: "ONBOARDING_DRAFT", draftId: a.draftId }]);
  });

  it("does not offer discarded or published drafts, and lets users without a draft (or a super admin) connect with no scope", async () => {
    const a = await clientWithDraft("mcp-closed");
    await discardOnboardingDraft(a.admin, a.draftId, "test");
    expect(await listOfferedScopes(a.actor)).toEqual([]);
    await expect(createMcpConnection(a.actor, { ...base, scopeKey: `draft:${a.draftId}` })).rejects.toThrow(/nacrt/i);

    const p = await clientWithDraft("mcp-published");
    await prisma.onboardingDraft.update({ where: { id: p.draftId }, data: { status: "PUBLISHED" } });
    expect(await listOfferedScopes(p.actor)).toEqual([]);

    const noDraft = asActor((await createSuperAdminActor("mcp-none")).userId);
    expect(await listOfferedScopes(noDraft)).toEqual([]);
    const { connection } = await createMcpConnection(noDraft, { ...base, scopeKey: "none" });
    expect(connection.id).toBeTruthy();
  });
});

describe("listMyMcpConnections", () => {
  it("lists only the caller's active connections, annotated with scope labels, and never the token hash", async () => {
    const a = await clientWithDraft("mcp-list");
    const other = await createSuperAdminActor("mcp-list-other");
    const { connection: kept } = await createMcpConnection(a.actor, { ...base, name: "Aktivna", scopeKey: `draft:${a.draftId}` });
    const { connection: gone } = await createMcpConnection(a.actor, { ...base, name: "Prekinuta", scopeKey: "none" });
    const { connection: old } = await createMcpConnection(a.actor, { ...base, name: "Istekla", scopeKey: "none" });
    await createMcpConnection(other, { ...base, name: "Tuđa", scopeKey: "none" });
    await revokeMcpConnection(a.actor, gone.id);
    await prisma.mcpConnection.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const rows = await listMyMcpConnections(a.actor);
    expect(rows.map((r) => r.id)).toEqual([kept.id]);
    expect(Object.keys(rows[0])).not.toContain("tokenHash");
    expect(rows[0].scopes).toHaveLength(1);
    expect(rows[0].scopes[0]).toMatchObject({ active: true, scope: { kind: "ONBOARDING_DRAFT", draftId: a.draftId } });
    expect(rows[0].scopes[0].label).toBeTruthy();
  });
});

describe("verifyMcpToken", () => {
  it("accepts a valid token and returns the connection context without secrets", async () => {
    const admin = await createSuperAdminActor("mcp-verify");
    const { connection, token } = await createMcpConnection(admin, { ...base, scopeKey: "none" });
    const ctx = await verifyMcpToken(bearer(token));
    expect(ctx).toMatchObject({ userId: admin.userId, connectionId: connection.id, connectionName: "Moj Claude", client: "CLAUDE", scopes: [] });
    expect(JSON.stringify(ctx)).not.toContain(token);
  });

  it("rejects wrong, malformed, revoked, expired and inactive-user tokens", async () => {
    const admin = await createSuperAdminActor("mcp-reject");
    const { connection, token } = await createMcpConnection(admin, { ...base, scopeKey: "none" });
    expect(await verifyMcpToken(null)).toBeNull();
    expect(await verifyMcpToken(token)).toBeNull(); // bez „Bearer"
    expect(await verifyMcpToken(`Bearer ${token}x`)).toBeNull();
    expect(await verifyMcpToken(bearer(MCP_TOKEN_PREFIX + "A".repeat(43)))).toBeNull();
    expect(await verifyMcpToken(bearer("zev_mcp_kratak"))).toBeNull();
    expect(await verifyMcpToken(bearer(token.replace(MCP_TOKEN_PREFIX, "tuđi_")))).toBeNull();

    await prisma.mcpConnection.update({ where: { id: connection.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifyMcpToken(bearer(token))).toBeNull();
    await prisma.mcpConnection.update({ where: { id: connection.id }, data: { expiresAt: new Date(Date.now() + 86400000) } });
    expect(await verifyMcpToken(bearer(token))).not.toBeNull();

    await prisma.user.update({ where: { id: admin.userId }, data: { active: false } });
    expect(await verifyMcpToken(bearer(token))).toBeNull();
    await prisma.user.update({ where: { id: admin.userId }, data: { active: true } });

    await revokeMcpConnection(admin, connection.id);
    expect(await verifyMcpToken(bearer(token))).toBeNull();
  });

  it("stamps lastUsedAt on first use and does not rewrite it within the throttle window", async () => {
    const admin = await createSuperAdminActor("mcp-lastused");
    const { connection, token } = await createMcpConnection(admin, { ...base, scopeKey: "none" });
    expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } })).lastUsedAt).toBeNull();

    await verifyMcpToken(bearer(token));
    let first: Date | null = null;
    for (let i = 0; i < 20 && !first; i++) {
      await sleep(50);
      first = (await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } })).lastUsedAt;
    }
    expect(first).not.toBeNull();

    await sleep(30);
    await verifyMcpToken(bearer(token));
    await sleep(150);
    const second = (await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } })).lastUsedAt;
    expect(second!.getTime()).toBe(first!.getTime());
  });
});

describe("revokeMcpConnection", () => {
  it("revokes only the caller's own connection and audits it without a ZEV", async () => {
    const owner = await createSuperAdminActor("mcp-rev-owner");
    const stranger = await createSuperAdminActor("mcp-rev-stranger");
    const { connection } = await createMcpConnection(owner, { ...base, scopeKey: "none" });

    await expect(revokeMcpConnection(stranger, connection.id)).rejects.toThrow(/nije pronađena/i);
    expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } })).revokedAt).toBeNull();

    const res = await revokeMcpConnection(owner, connection.id);
    expect(res.name).toBe("Moj Claude");
    const row = await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedById).toBe(owner.userId);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "mcp.connection.revoke", targetId: connection.id } });
    expect(ev.zevId).toBeNull();

    await expect(revokeMcpConnection(owner, connection.id)).rejects.toThrow(/nije pronađena/i);
    await expect(revokeMcpConnection(owner, "ne-postoji")).rejects.toThrow(/nije pronađena/i);
  });
});

describe("scope re-check on every call", () => {
  it("reports a closed draft as inactive / refused without mutating any row", async () => {
    const a = await clientWithDraft("mcp-recheck");
    const scope = { kind: "ONBOARDING_DRAFT" as const, draftId: a.draftId };
    const { connection } = await createMcpConnection(a.actor, { ...base, scopeKey: `draft:${a.draftId}` });
    const before = await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } });

    expect(await resolveMcpAccess({ userId: a.actor.userId, isSuperAdmin: false, scopes: [scope] }, scope)).toEqual({ ok: true, draftId: a.draftId, via: "MCP_OWNER" });
    expect((await describeScopes({ userId: a.actor.userId, isSuperAdmin: false }, [scope]))[0].active).toBe(true);

    // Veza bez ovog opsega ne smije ni vlasnik nacrta.
    expect(await resolveMcpAccess({ userId: a.actor.userId, isSuperAdmin: false, scopes: [] }, scope)).toMatchObject({ ok: false });
    // Tuđi nacrt: opseg postoji u vezi, ali pozivalac nije vlasnik.
    const stranger = await createSuperAdminActor("mcp-recheck-stranger");
    expect(await resolveMcpAccess({ userId: stranger.userId, isSuperAdmin: false, scopes: [scope] }, scope)).toMatchObject({ ok: false });
    expect((await describeScopes({ userId: stranger.userId, isSuperAdmin: false }, [scope]))[0].active).toBe(false);

    await discardOnboardingDraft(a.admin, a.draftId, "test");
    expect(await resolveMcpAccess({ userId: a.actor.userId, isSuperAdmin: false, scopes: [scope] }, scope)).toMatchObject({ ok: false });
    expect((await describeScopes({ userId: a.actor.userId, isSuperAdmin: false }, [scope]))[0].active).toBe(false);

    await prisma.onboardingDraft.update({ where: { id: a.draftId }, data: { status: "PUBLISHED" } });
    expect(await resolveMcpAccess({ userId: a.actor.userId, isSuperAdmin: false, scopes: [scope] }, scope)).toMatchObject({ ok: false });
    expect((await describeScopes({ userId: a.actor.userId, isSuperAdmin: false }, [scope]))[0].active).toBe(false);

    const after = await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(after.revokedAt).toBeNull();
    expect(after.scopes).toEqual(before.scopes);
  });
});
