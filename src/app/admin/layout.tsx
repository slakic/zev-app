import { redirect } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";
import { t } from "@/lib/i18n";
import { NavShell } from "@/components/nav-shell";
import { buildPlatformNav } from "@/lib/nav-structure";

// Not nested under (app): a super admin acts at the platform level, outside any single
// ZEV, so the tenant NAVIGATION (zevId-scoped pages) doesn't apply here — see
// docs/multitenancy-plan.md §4.3/§8. But the visual SHELL is the same NavShell as the
// tenant area, just variant="platform" (Plans/design-system.md §7) — the two areas used
// to look like different products even though the same person moves between them
// constantly ("Super admin" link in (app)/layout.tsx:55, "Moj ZEV" below).
async function logoutAction() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireSuperAdminActor();
  const groups = buildPlatformNav({ hasZev: Boolean(actor.zevId) }).map((g) => ({
    label: g.labelKey ? t(g.labelKey) : undefined,
    links: g.items.map((i) => ({ href: i.href, label: t(i.labelKey) })),
  }));
  return (
    <NavShell
      variant="platform"
      appName={t("app.name")}
      displayName={actor.displayName}
      rolesText={t("tenant.platformAdmin")}
      groups={groups}
      logoutLabel={t("nav.logout")}
      logoutAction={logoutAction}
    >
      {children}
    </NavShell>
  );
}
