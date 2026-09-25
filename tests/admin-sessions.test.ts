// Plans/live-sessions-admin-plan.md, Faza 1: listActiveSessions must (1) block a
// non-super-admin actor, (2) only surface sessions that are actually live right now
// (not revoked/expired/deactivated-user), and (3) resolve zev/roles/party display name
// correctly for a session's active ZEV. describeUserAgent is a small pure function,
// covered separately.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { listActiveSessions, describeUserAgent } from "@/server/services/sessions";
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
