// OnboardingShell (Plans/design-system.md §4.5, mockup O-M02): školjka čarobnjaka za novi ZEV. ZEV još
// ne postoji, pa nema bočnog menija aplikacije — samo gornja traka; StepNav i sadržaj crta stranica
// koraka (layout ne zna koji je korak otvoren). Pristup: prijavljen korisnik sa nacrtom u toku.
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";
import { getMyDraft, landingPath } from "@/server/services/onboarding";
import { t } from "@/lib/i18n";

async function logoutAction() {
  "use server";
  await destroySession();
  redirect("/login");
}

function SavedIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M7.3 10.2 9.2 12l3.5-3.8" />
    </svg>
  );
}

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const draft = await getMyDraft(actor);
  if (!draft) redirect(await landingPath(actor));
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 shadow-sm md:gap-4 md:px-6 md:py-3">
        <span className="text-base font-bold tracking-tight text-slate-800 md:text-lg">{t("app.name")}</span>
        <span className="hidden text-sm text-slate-500 md:inline">{t("onboarding.shellTitle")}</span>
        <div className="flex-1" />
        <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-600">
          <SavedIcon />
          <span className="hidden md:inline">{t("onboarding.saved")}</span>
          <span className="md:hidden">{t("onboarding.savedShort")}</span>
        </span>
        <span className="hidden text-[13px] text-slate-600 md:inline">{actor.email}</span>
        <form action={logoutAction}>
          <button type="submit" className="inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 md:min-h-0 md:py-1.5">
            {t("nav.logout")}
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
