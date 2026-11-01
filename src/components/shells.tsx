// Školjke prijavljenog dijela aplikacije kao server komponente, izvučene iz layout-a da ih koristi i
// /nalog (stranice na nivou naloga, izvan ZEV-a): TenantShell (ZEV), PlatformShell (super admin) i
// OnboardingShell (čarobnjak novog ZEV-a). Layout-i ostaju tanki: pristup i preusmjeravanja su njihovi.
import type { ReactNode } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Actor } from "@/server/auth/guards";
import { listMyTenants } from "@/server/services/memberships";
import { logoutAction, switchZevAction } from "@/server/actions/shell";
import { accountLinksFor } from "@/server/shell";
import { NavShell } from "@/components/nav-shell";
import { AccountMenu } from "@/components/account-menu";
import { BtnLink, Flash } from "@/components/ui";
import { buildPlatformNav, buildTenantNav, settingsInAccountMenu, type NavRole } from "@/lib/nav-structure";

type ShellActor = Actor & { displayName: string };

/** Školjka ZEV-a: bočni meni po ulozi, prekidač ZEV-ova i meni naloga. */
export async function TenantShell({ actor, children }: { actor: ShellActor; children: ReactNode }) {
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
      accountLinks={accountLinksFor({ includeMyData: settingsInAccountMenu(navRoles) })}
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

/** Platformska školjka super admina (Plans/design-system.md §7): isti NavShell, grafitni akcenat. */
export function PlatformShell({ actor, children }: { actor: ShellActor; children: ReactNode }) {
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
      accountLinks={accountLinksFor({ includeMyData: false })}
      logoutLabel={t("nav.logout")}
      logoutAction={logoutAction}
    >
      {children}
    </NavShell>
  );
}

function SavedIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M7.3 10.2 9.2 12l3.5-3.8" />
    </svg>
  );
}

/**
 * OnboardingShell (Plans/design-system.md §4.5, mockup O-M02): školjka čarobnjaka za novi ZEV. ZEV još
 * ne postoji, pa nema bočnog menija aplikacije — samo gornja traka sa menijem naloga; StepNav i sadržaj
 * crta stranica. `showSaved` je oznaka „Sve izmjene su sačuvane” (samo u čarobnjaku, ne na /nalog).
 */
export function OnboardingShell({
  actor, showSaved, assistantHref, importHref, adminAccessNotice, children,
}: {
  actor: ShellActor & { email: string };
  showSaved: boolean;
  /** Veza na „Povezani asistenti" sa unaprijed izabranim nacrtom; samo kad su asistenti uključeni (MCP_ENABLED). */
  assistantHref?: string;
  /** Uvoz nacrta iz JSON/CSV fajla (/onboarding/uvoz); samo u čarobnjaku. */
  importHref?: string;
  /** Administrator platforme ima aktivan pristup nacrtu kroz asistenta: klijent to mora vidjeti. */
  adminAccessNotice?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 shadow-sm md:gap-4 md:px-6 md:py-3">
        <span className="text-base font-bold tracking-tight text-slate-800 md:text-lg">{t("app.name")}</span>
        <span className="hidden text-sm text-slate-500 md:inline">{t("onboarding.shellTitle")}</span>
        <div className="flex-1" />
        {showSaved && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-600">
            <SavedIcon />
            <span className="hidden md:inline">{t("onboarding.saved")}</span>
            <span className="md:hidden">{t("onboarding.savedShort")}</span>
          </span>
        )}
        {importHref && <BtnLink href={importHref} variant="ghost">{t("onboarding.import.link")}</BtnLink>}
        {assistantHref && <BtnLink href={assistantHref} variant="ghost">{t("onboarding.assistantLink")}</BtnLink>}
        <span className="hidden text-[13px] text-slate-600 md:inline">{actor.email}</span>
        <AccountMenu
          displayName={actor.displayName}
          rolesText={actor.email}
          accent={{ avatar: "bg-blue-600 hover:bg-blue-700", avatarStatic: "bg-blue-600", activeLink: "bg-blue-50 text-blue-700" }}
          links={accountLinksFor({ includeMyData: false })}
          logoutLabel={t("nav.logout")}
          logoutAction={logoutAction}
        />
      </header>
      {adminAccessNotice && (
        <div className="mx-auto w-full max-w-[1440px] px-4 pt-4 md:px-8 md:pt-6">
          <Flash
            warn={
              <>
                {t("onboarding.adminAccessNotice")}{" "}
                <Link href="/nalog/asistenti" className="font-medium underline underline-offset-2">{t("onboarding.adminAccessNoticeLink")}</Link>
              </>
            }
          />
        </div>
      )}
      {children}
    </div>
  );
}
