import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { maybeActor, requireActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";
import { listMyTenants, switchActiveZev } from "@/server/services/memberships";
import { NavShell } from "@/components/nav-shell";

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

const NAV: { href: string; key: string; roles?: string[] }[] = [
  { href: "/", key: "nav.home" },
  { href: "/zgrade", key: "nav.buildings" },
  { href: "/vlasnici", key: "nav.owners", roles: ["PRESIDENT", "ACCOUNTANT"] },
  { href: "/organi", key: "nav.organs" },
  { href: "/skupstina", key: "nav.assembly" },
  { href: "/fakture", key: "nav.invoices" },
  { href: "/troskovi", key: "nav.expenses", roles: ["PRESIDENT", "ACCOUNTANT"] },
  { href: "/planovi", key: "nav.plans" },
  { href: "/odrzavanje", key: "nav.maintenance" },
  { href: "/dokumenti", key: "nav.documents" },
  { href: "/izvjestaji", key: "nav.reports", roles: ["PRESIDENT", "ACCOUNTANT"] },
  { href: "/podesavanja", key: "nav.settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await maybeActor();
  if (!actor) redirect("/login");
  // A super admin with no Membership has no tenant dashboard to show (every service
  // call below is zevId-scoped) — send them to their own area instead of letting them
  // hit a ForbiddenError deep in a page. A super admin who *also* holds a Membership
  // somewhere falls through normally — they're acting as a member there by choice.
  if (actor.isSuperAdmin && !actor.zevId) redirect("/admin");
  const links = NAV.filter((n) => !n.roles || n.roles.some((r) => actor.roles.includes(r as never))).map((n) => ({
    href: n.href,
    label: t(n.key),
  }));
  // A super admin who also manages their own ZEV (e.g. its president) needs a way back
  // to the platform-level /admin area without typing the URL by hand.
  if (actor.isSuperAdmin) links.push({ href: "/admin", label: "Super admin" });
  const myTenants = await listMyTenants(actor);
  const tenantOptions = myTenants.map((mt) => ({ zevId: mt.zevId, label: mt.shortName ?? mt.legalName }));
  return (
    <NavShell
      appName={t("app.name")}
      displayName={actor.displayName}
      rolesText={actor.roles.map((r) => t(`roles.${r}`)).join(", ")}
      links={links}
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
