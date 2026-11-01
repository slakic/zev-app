// Pristup super admina tuđem nacrtu kroz asistenta (Faza O-A, Plans/mcp-onboarding-asistent-plan.md): dodavanje i
// uklanjanje, ponuđeni opsezi, provjera opsega na svakom pozivu i konstruktori DraftAccess. Pravi test baza.
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/server/auth/guards";
import { ForbiddenError } from "@/server/auth/guards";
import { discardOnboardingDraft, getDraftByAccess, getMyDraft } from "@/server/services/onboarding";
import { createMcpConnection, listMyMcpConnections, listOfferedScopes } from "@/server/services/mcpConnections";
import {
  countActiveAdminAccess,
  grantDraftAdminAccess,
  listAdminAccessToMyDrafts,
  listDraftAdminAccess,
  revokeDraftAdminAccess,
} from "@/server/services/mcpDraftAccess";
import { DraftAccessError, draftAccessForOwner, draftAccessFromMcp } from "@/server/services/draftAccess";
import { describeScopes, resolveMcpAccess } from "@/server/mcp/access";
import { resetMcpRateLimits } from "@/server/mcp/rateLimit";
import { accepted, createSuperAdminActor } from "./helpers";

const asActor = (userId: string): Actor => ({ userId, roles: [], partyId: null, zevId: null, label: "Test korisnik" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function clientWithDraft(tag: string) {
  const c = await accepted(tag);
  const actor = asActor(c.actor.userId);
  const draft = await getMyDraft(actor);
  if (!draft) throw new Error("nacrt nedostaje");
  return { actor, draftId: draft.id, inviter: c.admin };
}

const scopeOf = (draftId: string) => ({ kind: "ONBOARDING_DRAFT" as const, draftId });
const ctxOf = (a: Actor, draftId: string) => ({ userId: a.userId, isSuperAdmin: Boolean(a.isSuperAdmin), scopes: [scopeOf(draftId)] });

beforeEach(() => resetMcpRateLimits());

describe("grantDraftAdminAccess", () => {
  it("is allowed only to a super admin, for an in-progress draft that is not their own", async () => {
    const c = await clientWithDraft("da-grant");
    await expect(grantDraftAdminAccess(c.actor, c.draftId)).rejects.toBeInstanceOf(ForbiddenError);

    const admin = await createSuperAdminActor("da-grant-admin");
    const own = await clientWithDraft("da-grant-own");
    await expect(grantDraftAdminAccess({ ...admin, userId: own.actor.userId }, own.draftId)).rejects.toThrow(/Vaš nacrt/);
    await expect(grantDraftAdminAccess(admin, "ne-postoji")).rejects.toThrow(/u toku/);

    await discardOnboardingDraft(c.inviter, c.draftId, "test");
    await expect(grantDraftAdminAccess(admin, c.draftId)).rejects.toThrow(/u toku/);

    const p = await clientWithDraft("da-grant-pub");
    await prisma.onboardingDraft.update({ where: { id: p.draftId }, data: { status: "PUBLISHED" } });
    await expect(grantDraftAdminAccess(admin, p.draftId)).rejects.toThrow(/u toku/);
  });

  it("is idempotent: a double grant leaves one active row and one audit event (no zevId)", async () => {
    const c = await clientWithDraft("da-idem");
    const admin = await createSuperAdminActor("da-idem-admin");
    const first = await grantDraftAdminAccess(admin, c.draftId);
    const second = await grantDraftAdminAccess(admin, c.draftId);
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await prisma.onboardingDraftAdminAccess.count({ where: { draftId: c.draftId, revokedAt: null } })).toBe(1);

    const events = await prisma.auditEvent.findMany({ where: { action: "mcp.draft_access.grant", targetId: c.draftId } });
    expect(events).toHaveLength(1);
    expect(events[0].zevId).toBeNull();
    expect(events[0].actorId).toBe(admin.userId);
    expect(await countActiveAdminAccess(c.draftId)).toBe(1);
  });

  it("the partial unique index rejects a second active row but allows a new one after revoke", async () => {
    const c = await clientWithDraft("da-idx");
    const admin = await createSuperAdminActor("da-idx-admin");
    const { id } = await grantDraftAdminAccess(admin, c.draftId);
    await expect(prisma.onboardingDraftAdminAccess.create({ data: { draftId: c.draftId, adminUserId: admin.userId } })).rejects.toMatchObject({ code: "P2002" });
    await revokeDraftAdminAccess(admin, id);
    const again = await grantDraftAdminAccess(admin, c.draftId);
    expect(again.created).toBe(true);
    expect(again.id).not.toBe(id);
  });
});

describe("revokeDraftAdminAccess", () => {
  it("lets the draft owner or any super admin remove access, not a third party, and not twice", async () => {
    const c = await clientWithDraft("da-rev");
    const admin = await createSuperAdminActor("da-rev-admin");
    const other = await createSuperAdminActor("da-rev-other");
    const third = await clientWithDraft("da-rev-third");

    const a1 = await grantDraftAdminAccess(admin, c.draftId);
    await expect(revokeDraftAdminAccess(third.actor, a1.id)).rejects.toThrow(/nije pronađena/);
    expect(await revokeDraftAdminAccess(c.actor, a1.id)).toEqual({ draftId: c.draftId, by: "OWNER" });
    await expect(revokeDraftAdminAccess(c.actor, a1.id)).rejects.toThrow(/nije pronađena/);

    const a2 = await grantDraftAdminAccess(admin, c.draftId);
    expect(await revokeDraftAdminAccess(other, a2.id)).toEqual({ draftId: c.draftId, by: "ADMIN" });

    const row = await prisma.onboardingDraftAdminAccess.findUniqueOrThrow({ where: { id: a2.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedById).toBe(other.userId);
    const events = await prisma.auditEvent.findMany({ where: { action: "mcp.draft_access.revoke", targetId: c.draftId }, orderBy: { createdAt: "asc" } });
    expect(events).toHaveLength(2);
    expect(events[0].zevId).toBeNull();
    expect(events[0].after).toEqual({ by: "OWNER" });
    expect(events[1].after).toEqual({ by: "ADMIN" });
  });

  it("lists access for the owner and for super admins (with isMine), only while active", async () => {
    const c = await clientWithDraft("da-list");
    const admin = await createSuperAdminActor("da-list-admin");
    const other = await createSuperAdminActor("da-list-other");
    const a1 = await grantDraftAdminAccess(admin, c.draftId);
    await grantDraftAdminAccess(other, c.draftId);

    const mineRows = await listAdminAccessToMyDrafts(c.actor);
    expect(mineRows).toHaveLength(2);
    expect(mineRows[0]).toMatchObject({ draftId: c.draftId, lastUsedAt: null });
    expect(Object.keys(mineRows[0]).sort()).toEqual(["adminName", "draftId", "draftLabel", "grantedAt", "id", "lastUsedAt"]);

    await expect(listDraftAdminAccess(c.actor, c.draftId)).rejects.toBeInstanceOf(ForbiddenError);
    const forAdmin = await listDraftAdminAccess(admin, c.draftId);
    expect(forAdmin.map((r) => r.isMine).sort()).toEqual([false, true]);

    await revokeDraftAdminAccess(c.actor, a1.id);
    expect(await listAdminAccessToMyDrafts(c.actor)).toHaveLength(1);
    await discardOnboardingDraft(c.inviter, c.draftId, "test");
    expect(await listAdminAccessToMyDrafts(c.actor)).toHaveLength(0);
  });
});

describe("listOfferedScopes with admin access", () => {
  it("offers a super admin only drafts with an active access row, marked ADMIN; clients still only their own", async () => {
    const c = await clientWithDraft("da-off");
    const admin = await createSuperAdminActor("da-off-admin");
    expect(await listOfferedScopes(admin)).toEqual([]);

    const { id } = await grantDraftAdminAccess(admin, c.draftId);
    const offered = await listOfferedScopes(admin);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ key: `draft:${c.draftId}`, via: "ADMIN", scope: scopeOf(c.draftId) });

    // Klijent vidi samo svoj nacrt (OWNER), i admin pristup mu ne mijenja ponudu.
    expect((await listOfferedScopes(c.actor)).map((o) => [o.key, o.via])).toEqual([[`draft:${c.draftId}`, "OWNER"]]);

    await revokeDraftAdminAccess(c.actor, id);
    expect(await listOfferedScopes(admin)).toEqual([]);
    await expect(createMcpConnection(admin, { name: "x", client: "OTHER", scopeKey: `draft:${c.draftId}`, days: 7 })).rejects.toThrow(/nacrt/i);
  });

  it("does not offer a super admin's access if the user is no longer a super admin", async () => {
    const c = await clientWithDraft("da-off-demote");
    const admin = await createSuperAdminActor("da-off-demote-admin");
    await grantDraftAdminAccess(admin, c.draftId);
    expect(await listOfferedScopes({ ...admin, isSuperAdmin: false })).toEqual([]);
  });
});

describe("resolveMcpAccess / describeScopes / DraftAccess", () => {
  it("resolves MCP_ADMIN with an active row and re-checks it on every call", async () => {
    const c = await clientWithDraft("da-res");
    const admin = await createSuperAdminActor("da-res-admin");
    const scope = scopeOf(c.draftId);

    // Bez pristupa: opseg u vezi ne pomaže.
    expect(await resolveMcpAccess(ctxOf(admin, c.draftId), scope)).toMatchObject({ ok: false });

    const { id } = await grantDraftAdminAccess(admin, c.draftId);
    expect(await resolveMcpAccess(ctxOf(admin, c.draftId), scope)).toEqual({ ok: true, draftId: c.draftId, via: "MCP_ADMIN" });
    // Vlasnik ima prednost.
    expect(await resolveMcpAccess(ctxOf(c.actor, c.draftId), scope)).toMatchObject({ ok: true, via: "MCP_OWNER" });

    // Oduzet status super admina gasi pristup.
    expect(await resolveMcpAccess({ ...ctxOf(admin, c.draftId), isSuperAdmin: false }, scope)).toMatchObject({ ok: false });

    await revokeDraftAdminAccess(c.actor, id);
    expect(await resolveMcpAccess(ctxOf(admin, c.draftId), scope)).toMatchObject({ ok: false });

    // Ponovno dodavanje oživljava postojeće veze sa tim opsegom (Q8).
    await grantDraftAdminAccess(admin, c.draftId);
    expect(await resolveMcpAccess(ctxOf(admin, c.draftId), scope)).toMatchObject({ ok: true, via: "MCP_ADMIN" });

    await discardOnboardingDraft(c.inviter, c.draftId, "test");
    const closed = await resolveMcpAccess(ctxOf(admin, c.draftId), scope);
    expect(closed).toMatchObject({ ok: false, message: expect.stringMatching(/više nije u toku/) });
  });

  it("touches lastUsedAt of the access row (throttled to once per window)", async () => {
    const c = await clientWithDraft("da-touch");
    const admin = await createSuperAdminActor("da-touch-admin");
    const { id } = await grantDraftAdminAccess(admin, c.draftId);
    expect((await prisma.onboardingDraftAdminAccess.findUniqueOrThrow({ where: { id } })).lastUsedAt).toBeNull();

    await resolveMcpAccess(ctxOf(admin, c.draftId), scopeOf(c.draftId));
    await sleep(150);
    const first = (await prisma.onboardingDraftAdminAccess.findUniqueOrThrow({ where: { id } })).lastUsedAt;
    expect(first).not.toBeNull();

    await resolveMcpAccess(ctxOf(admin, c.draftId), scopeOf(c.draftId));
    await sleep(150);
    expect((await prisma.onboardingDraftAdminAccess.findUniqueOrThrow({ where: { id } })).lastUsedAt).toEqual(first);
  });

  it("describes scopes with via OWNER / ADMIN / null", async () => {
    const c = await clientWithDraft("da-desc");
    const admin = await createSuperAdminActor("da-desc-admin");
    const scope = scopeOf(c.draftId);
    expect(await describeScopes(c.actor as { userId: string; isSuperAdmin: boolean }, [scope])).toMatchObject([{ active: true, via: "OWNER" }]);
    expect(await describeScopes({ userId: admin.userId, isSuperAdmin: true }, [scope])).toMatchObject([{ active: false, via: null }]);
    await grantDraftAdminAccess(admin, c.draftId);
    expect(await describeScopes({ userId: admin.userId, isSuperAdmin: true }, [scope])).toMatchObject([{ active: true, via: "ADMIN" }]);
    expect(await describeScopes({ userId: admin.userId, isSuperAdmin: false }, [scope])).toMatchObject([{ active: false, via: null }]);

    // Isto vidi i lista veza.
    const { connection } = await createMcpConnection(admin, { name: "Admin veza", client: "OTHER", scopeKey: `draft:${c.draftId}`, days: 7 });
    const listed = (await listMyMcpConnections(admin)).find((r) => r.id === connection.id)!;
    expect(listed.scopes[0]).toMatchObject({ active: true, via: "ADMIN" });
  });

  it("DraftAccess constructors: owner (WIZARD), foreign owner refused, MCP admin and refusal", async () => {
    const c = await clientWithDraft("da-ctor");
    const stranger = await clientWithDraft("da-ctor-stranger");
    const admin = await createSuperAdminActor("da-ctor-admin");

    expect(await draftAccessForOwner(c.actor, c.draftId)).toMatchObject({ draftId: c.draftId, userId: c.actor.userId, via: "WIZARD" });
    await expect(draftAccessForOwner(stranger.actor, c.draftId)).rejects.toBeInstanceOf(DraftAccessError);

    await expect(draftAccessFromMcp(ctxOf(admin, c.draftId), scopeOf(c.draftId))).rejects.toBeInstanceOf(DraftAccessError);
    await grantDraftAdminAccess(admin, c.draftId);
    const access = await draftAccessFromMcp(ctxOf(admin, c.draftId), scopeOf(c.draftId));
    expect(access).toMatchObject({ draftId: c.draftId, via: "MCP_ADMIN" });
    const draft = await getDraftByAccess(access);
    expect(draft).toMatchObject({ id: c.draftId, version: expect.any(Number), label: expect.any(String) });
    expect(draft.progress.steps.length).toBeGreaterThan(5);

    await discardOnboardingDraft(c.inviter, c.draftId, "test");
    await expect(getDraftByAccess(access)).rejects.toBeInstanceOf(DraftAccessError);
  });
});
