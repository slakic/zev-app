// Plans/live-sessions-admin-plan.md, Faza 1 + Faza 2 + Faza 3: listActiveSessions must
// (1) block a non-super-admin actor, (2) only surface sessions that are actually live right
// now (not revoked/expired/deactivated-user), (3) resolve zev/roles/party display name
// correctly for a session's active ZEV, and (4, Faza 2) compute isActiveNow from lastSeenAt
// and honor the activeOnly filter. revokeSession (Faza 3) must refuse to revoke the caller's
// own current session, actually revoke + clear ipAddress on another one, and audit it.
// describeUserAgent and shouldUpdateLastSeen are small pure functions, covered separately.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { listActiveSessions, revokeSession, describeUserAgent } from "@/server/services/sessions";
import { shouldUpdateLastSeen, ACTIVE_SESSION_THRESHOLD_MS } from "@/server/auth/session";
import { ForbiddenError } from "@/server/auth/guards";
import { createFixture, createSuperAdminActor } from "./helpers";

describe("listActiveSessions (super admin, cross-tenant)", () => {
  it("requireSuperAdmin blocks a non-super-admin actor", async () => {
    const fx = await createFixture("as-guard");
    await expect(listActiveSessions(fx.president)).rejects.toThrow(ForbiddenError);
  });

  it("only lists sessions that are live: excludes revoked, expired, and deactivated-user sessions", async () => {
    const admin = await createSuperAdminActor("as-live");
    const fx = await createFixture("as-live-fx");
    const future = new Date(Date.now() + 3600_000);
    const past = new Date(Date.now() - 3600_000);

    const live = await prisma.session.create({
      data: { userId: fx.president.userId, activeZevId: fx.zev.id, expiresAt: future, ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 Chrome/120 Windows" },
    });
    const revoked = await prisma.session.create({
      data: { userId: fx.president.userId, activeZevId: fx.zev.id, expiresAt: future, revokedAt: new Date() },
    });
    const expired = await prisma.session.create({
      data: { userId: fx.president.userId, activeZevId: fx.zev.id, expiresAt: past },
    });
    const deactivatedOwner = await prisma.user.update({ where: { id: fx.actorA.userId }, data: { active: false } });
    const deactivatedSession = await prisma.session.create({
      data: { userId: deactivatedOwner.id, activeZevId: fx.zev.id, expiresAt: future },
    });

    const rows = await listActiveSessions(admin);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(revoked.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).not.toContain(deactivatedSession.id);

    const row = rows.find((r) => r.id === live.id)!;
    expect(row.ipAddress).toBe("203.0.113.7");
    expect(row.zevId).toBe(fx.zev.id);
    expect(row.zevLabel).toBe(fx.zev.legalName);
    expect(row.zevSuspended).toBe(false);
    expect(row.roles).toEqual(expect.arrayContaining(["PRESIDENT", "OWNER"]));
    expect(row.displayName).toContain("Predsjednik");
  });

  it("marks a session whose active ZEV is suspended, without excluding it", async () => {
    const admin = await createSuperAdminActor("as-susp");
    const fx = await createFixture("as-susp-fx");
    await prisma.zev.update({ where: { id: fx.zev.id }, data: { active: false } });
    const session = await prisma.session.create({
      data: { userId: fx.president.userId, activeZevId: fx.zev.id, expiresAt: new Date(Date.now() + 3600_000) },
    });

    const rows = await listActiveSessions(admin);
    const row = rows.find((r) => r.id === session.id);
    expect(row).toBeDefined();
    expect(row?.zevSuspended).toBe(true);
  });

  it("isActiveNow reflects lastSeenAt against the 15-minute threshold; activeOnly filters accordingly", async () => {
    const admin = await createSuperAdminActor("as-seen");
    const fx = await createFixture("as-seen-fx");
    const future = new Date(Date.now() + 3600_000);
    const recentlySeen = new Date(Date.now() - 60_000);
    const longAgoSeen = new Date(Date.now() - ACTIVE_SESSION_THRESHOLD_MS - 60_000);

    const active = await prisma.session.create({
      data: { userId: fx.president.userId, activeZevId: fx.zev.id, expiresAt: future, lastSeenAt: recentlySeen },
    });
    const stale = await prisma.session.create({
      data: { userId: fx.accountant.userId, activeZevId: fx.zev.id, expiresAt: future, lastSeenAt: longAgoSeen },
    });
    const neverSeen = await prisma.session.create({
      data: { userId: fx.actorA.userId, activeZevId: fx.zev.id, expiresAt: future },
    });

    const all = await listActiveSessions(admin);
    expect(all.find((r) => r.id === active.id)?.isActiveNow).toBe(true);
    expect(all.find((r) => r.id === stale.id)?.isActiveNow).toBe(false);
    expect(all.find((r) => r.id === neverSeen.id)?.isActiveNow).toBe(false);
    expect(all.find((r) => r.id === neverSeen.id)?.lastSeenAt).toBeNull();
    // lastSeenAt desc, nulls last.
    const orderedIds = all.map((r) => r.id).filter((id) => [active.id, stale.id, neverSeen.id].includes(id));
    expect(orderedIds).toEqual([active.id, stale.id, neverSeen.id]);

    const activeOnly = await listActiveSessions(admin, { activeOnly: true });
    const activeOnlyIds = activeOnly.map((r) => r.id);
    expect(activeOnlyIds).toContain(active.id);
    expect(activeOnlyIds).not.toContain(stale.id);
    expect(activeOnlyIds).not.toContain(neverSeen.id);
  });
});

describe("revokeSession (Faza 3)", () => {
  it("requireSuperAdmin blocks a non-super-admin actor", async () => {
    const fx = await createFixture("rs-guard");
    const session = await prisma.session.create({
      data: { userId: fx.actorA.userId, expiresAt: new Date(Date.now() + 3600_000) },
    });
    await expect(revokeSession(fx.president, session.id)).rejects.toThrow(ForbiddenError);
  });

  it("refuses to revoke the caller's own current session", async () => {
    const admin = await createSuperAdminActor("rs-self");
    const ownSession = await prisma.session.create({
      data: { userId: admin.userId, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const actorWithSession = { ...admin, sessionId: ownSession.id };
    await expect(revokeSession(actorWithSession, ownSession.id)).rejects.toThrow(/sopstvenu/);
    const after = await prisma.session.findUniqueOrThrow({ where: { id: ownSession.id } });
    expect(after.revokedAt).toBeNull();
  });

  it("revokes another user's session, clears ipAddress, and audits admin.session.revoke", async () => {
    const admin = await createSuperAdminActor("rs-other");
    const fx = await createFixture("rs-other-fx");
    const target = await prisma.session.create({
      data: { userId: fx.actorA.userId, activeZevId: fx.zev.id, expiresAt: new Date(Date.now() + 3600_000), ipAddress: "198.51.100.9" },
    });

    await revokeSession(admin, target.id);

    const after = await prisma.session.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.revokedAt).not.toBeNull();
    expect(after.ipAddress).toBeNull();

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "admin.session.revoke", targetId: target.id },
      orderBy: { createdAt: "desc" },
    });
    expect(event.targetType).toBe("Session");
    expect(event.zevId).toBe(fx.zev.id);
    expect(event.after).toMatchObject({ userId: fx.actorA.userId, sessionId: target.id });
  });

  it("audits under the TARGET session's own tenant, not the acting admin's own active tenant (e.g. a super admin who is also president elsewhere)", async () => {
    const adminHome = await createFixture("rs-admin-home");
    const otherTenant = await createFixture("rs-other-tenant");
    // A super admin who also happens to hold a Membership/active ZEV of their own — the
    // scenario that surfaced this bug live: audit()'s default zevId comes from actor.zevId,
    // which is this admin's own tenant, not the tenant of whichever session they're revoking.
    const adminActor = { ...adminHome.president, isSuperAdmin: true };
    const target = await prisma.session.create({
      data: { userId: otherTenant.actorA.userId, activeZevId: otherTenant.zev.id, expiresAt: new Date(Date.now() + 3600_000) },
    });

    await revokeSession(adminActor, target.id);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "admin.session.revoke", targetId: target.id },
      orderBy: { createdAt: "desc" },
    });
    expect(event.zevId).toBe(otherTenant.zev.id);
    expect(event.zevId).not.toBe(adminHome.zev.id);
  });
});

describe("shouldUpdateLastSeen (Faza 2 write throttle)", () => {
  it("writes when never seen before, skips within the throttle window, writes again once it's passed", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(shouldUpdateLastSeen(null, now)).toBe(true);
    expect(shouldUpdateLastSeen(new Date(now.getTime() - 60_000), now)).toBe(false); // 1 min ago
    expect(shouldUpdateLastSeen(new Date(now.getTime() - 5 * 60_000 - 1), now)).toBe(true); // just over 5 min ago
  });
});

describe("describeUserAgent", () => {
  it("recognizes a common browser + OS pair", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")).toBe("Chrome na Windows");
  });

  it("falls back to a generic label for null/unrecognized input", () => {
    expect(describeUserAgent(null)).toBe("Nepoznat uređaj");
    expect(describeUserAgent("some-custom-client/1.0")).toBe("Nepoznat uređaj");
  });
});
