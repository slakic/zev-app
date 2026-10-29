import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { maybeActor, requireActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";
import { listMyTenants, switchActiveZev } from "@/server/services/memberships";
import { landingPath } from "@/server/services/onboarding";
import { NavShell } from "@/components/nav-shell";
import { buildTenantNav, settingsInAccountMenu, type NavRole } from "@/lib/nav-structure";

async function logoutAction() {
  "use server";
  await destroySession();
  redirect("/login");
}

async function switchZevAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  const zevId = String(formData.get("zevId") ?? "");
  try {
    await switchActiveZev(actor, zevId);
  } catch (e) {
    redirect(`/?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect("/");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await maybeActor();
  if (!actor) redirect("/login");
  // A super admin with no Membership has no tenant dashboard to show (every service
  // call below is zevId-scoped) — send them to their own area instead of letting them
  // hit a ForbiddenError deep in a page. A super admin who *also* holds a Membership
  // somewhere falls through normally — they're acting as a member there by choice.
  // Isto za pozvanog klijenta koji još popunjava nacrt novog ZEV-a (nema članstvo dok ga ne objavi).
  if (!actor.zevId) {
    const path = await landingPath(actor);
    if (path !== "/") redirect(path);
  }
  // Redoslijed i grupe po ulozi (F9, D8) su čista funkcija u `nav-structure.ts`; meni je samo
  // prikaz — svaka stranica i servis i dalje sami provjeravaju ulogu i zevId.
  const navRoles = actor.roles as NavRole[];
  const groups = buildTenantNav(navRoles, { isSuperAdmin: actor.isSuperAdmin }).map((g) => ({
    label: g.labelKey ? t(g.labelKey) : undefined,
    links: g.items.map((i) => ({ href: i.href, label: t(i.labelKey) })),
  }));
  const myTenants = await listMyTenants(actor);
  const tenantOptions = myTenants.map((mt) => ({
    zevId: mt.zevId,
    label: mt.shortName ?? mt.legalName,
    // Shown as a hover tooltip in NavShell when it differs from the (often shortened)
    // label above — lets you see the full legal name without opening /admin.
    fullLabel: mt.legalName,
  }));
  return (
    <NavShell
      appName={t("app.name")}
      displayName={actor.displayName}
      rolesText={actor.roles.map((r) => t(`roles.${r}`)).join(", ")}
      groups={groups}
      accountLink={settingsInAccountMenu(navRoles) ? { href: "/podesavanja", label: t("nav.myData") } : undefined}
      logoutLabel={t("nav.logout")}
      logoutAction={logoutAction}
      tenants={tenantOptions}
      activeZevId={actor.zevId}
      switchZevAction={switchZevAction}
    >
      {children}
    </NavShell>
  );
}
