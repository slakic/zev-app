// Plans/live-sessions-admin-plan.md, Faza 1 + Faza 2: listActiveSessions must (1) block a
// non-super-admin actor, (2) only surface sessions that are actually live right now
// (not revoked/expired/deactivated-user), (3) resolve zev/roles/party display name
// correctly for a session's active ZEV, and (4, Faza 2) compute isActiveNow from
// lastSeenAt and honor the activeOnly filter. describeUserAgent and
// shouldUpdateLastSeen are small pure functions, covered separately.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { listActiveSessions, describeUserAgent } from "@/server/services/sessions";
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
