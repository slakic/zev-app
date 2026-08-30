import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { maybeActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";

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
  const links = NAV.filter((n) => !n.roles || n.roles.some((r) => actor.roles.includes(r as never)));
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:min-h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between p-4 md:block">
          <div>
            <div className="text-lg font-bold text-blue-700">{t("app.name")}</div>
            <div className="text-xs text-slate-500">{actor.displayName}</div>
            <div className="text-xs text-slate-400">
              {actor.roles.map((r) => t(`roles.${r}`)).join(", ")}
            </div>
          </div>
        </div>
        <nav className="flex flex-wrap gap-1 px-2 pb-3 md:block md:space-y-0.5">
          {links.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700"
            >
              {t(n.key)}
            </Link>
          ))}
          <form action={logoutAction} className="mt-2 px-3 md:px-0">
            <button className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-100">
              {t("nav.logout")}
            </button>
          </form>
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
