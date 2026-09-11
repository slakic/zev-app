import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSuperAdminActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";
import { t } from "@/lib/i18n";

// Deliberately NOT nested under (app) and not using NavShell: a super admin acts at
// the platform level, outside any single ZEV, so the tenant sidebar/nav (which is
// built around zevId-scoped pages) does not apply here. See
// docs/multitenancy-plan.md §4.3/§8 — this is a separate, minimal top-level area.
async function logoutAction() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireSuperAdminActor();
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-3 shadow-sm md:px-8">
        <div className="text-lg font-bold tracking-tight text-blue-700">{t("app.name")}</div>
        <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
          Super admin
        </span>
        <div className="flex-1" />
        {actor.zevId && (
          <Link
            href="/"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50"
          >
            Moj ZEV
          </Link>
        )}
        <span className="truncate text-sm text-slate-500">{actor.displayName}</span>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            {t("nav.logout")}
          </button>
        </form>
      </header>
      <main className="p-4 md:p-8">{children}</main>
    </div>
  );
}
