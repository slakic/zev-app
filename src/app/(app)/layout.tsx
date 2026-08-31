import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { maybeActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";
import { NavShell } from "@/components/nav-shell";

async function logoutAction() {
  "use server";
  await destroySession();
  redirect("/login");
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
  { href: "/podesavanja", key: "nav.settings", roles: ["PRESIDENT", "ACCOUNTANT"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await maybeActor();
  if (!actor) redirect("/login");
  const links = NAV.filter((n) => !n.roles || n.roles.some((r) => actor.roles.includes(r as never))).map((n) => ({
    href: n.href,
    label: t(n.key),
  }));
  return (
    <NavShell
      appName={t("app.name")}
      displayName={actor.displayName}
      rolesText={actor.roles.map((r) => t(`roles.${r}`)).join(", ")}
      links={links}
      logoutLabel={t("nav.logout")}
      logoutAction={logoutAction}
    >
      {children}
    </NavShell>
  );
}
