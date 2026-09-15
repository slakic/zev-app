// Plans/user-activity-log-plan.md §9, §8 Faza 3, item 19: the three properties that must
// hold for the super-admin cross-tenant activity view — (1) requireSuperAdmin actually
// blocks a non-super-admin actor, (2) the zevId filter narrows to exactly one tenant's
// rows, (3) without it, rows from multiple tenants are visible together, including ones
// with zevId = NULL (e.g. auth.login before a session's active ZEV is resolved).
import { describe, it, expect } from "vitest";
import { listAllActivity, listActivityActorsForZev } from "@/server/services/activity";
import { audit } from "@/server/audit";
import { ForbiddenError } from "@/server/auth/guards";
import { createFixture, createSuperAdminActor, uid } from "./helpers";

describe("listAllActivity / listActivityActorsForZev (super admin, cross-tenant)", () => {
  it("requireSuperAdmin blocks a non-super-admin actor (e.g. a tenant's own president)", async () => {
    const fx = await createFixture("aa-guard");
    await expect(listAllActivity(fx.president, {})).rejects.toThrow(ForbiddenError);
    await expect(listActivityActorsForZev(fx.president, fx.zev.id)).rejects.toThrow(ForbiddenError);
  });

  it("zevId filter narrows to one tenant; without it, rows from multiple tenants incl. zevId=null are visible", async () => {
    const admin = await createSuperAdminActor("aa-cross");
    const fx1 = await createFixture("aa-cross-1");
    const fx2 = await createFixture("aa-cross-2");
    const marker = uid("aa-marker");

    const from = new Date(Date.now() - 1000);
    await audit(fx1.president, {
      action: "issue.report",
      targetType: "Issue",
      targetId: uid("issue"),
      after: { title: "Test A" },
      reason: `${marker}-a`,
    });
    await audit(fx2.president, {
      action: "issue.report",
      targetType: "Issue",
      targetId: uid("issue"),
      after: { title: "Test B" },
      reason: `${marker}-b`,
    });
    // Genuinely anonymous/system event (no Actor, no explicit zevId) — mirrors auth.login
    // before a session's active ZEV is resolved (src/server/audit.ts's own doc comment).
    await audit(null, {
      action: "auth.login",
      targetType: "User",
      targetId: fx1.presidentParty.id,
      reason: `${marker}-sys`,
    });
    const to = new Date(Date.now() + 1000);

    const onlyFx1 = await listAllActivity(admin, { from, to, zevId: fx1.zev.id });
    expect(
      onlyFx1.rows.filter((r) => r.reason?.startsWith(marker)).map((r) => r.reason)
    ).toEqual([`${marker}-a`]);

    const onlyFx2 = await listAllActivity(admin, { from, to, zevId: fx2.zev.id });
    expect(
      onlyFx2.rows.filter((r) => r.reason?.startsWith(marker)).map((r) => r.reason)
    ).toEqual([`${marker}-b`]);

    const all = await listAllActivity(admin, { from, to });
    const allMarked = all.rows.filter((r) => r.reason?.startsWith(marker));
    expect(allMarked.map((r) => r.reason).sort()).toEqual([`${marker}-a`, `${marker}-b`, `${marker}-sys`]);
    const sysRow = allMarked.find((r) => r.reason === `${marker}-sys`);
    expect(sysRow?.zevId).toBeNull();
  });

  it("listActivityActorsForZev scopes members to the given zev, not the caller's own (super admin has none)", async () => {
    const admin = await createSuperAdminActor("aa-actors");
    const fx = await createFixture("aa-actors-fx");
    const actors = await listActivityActorsForZev(admin, fx.zev.id);
    expect(actors.some((a) => a.id === fx.president.userId)).toBe(true);
  });
});
