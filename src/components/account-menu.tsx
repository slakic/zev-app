"use client";
// Meni naloga u gornjoj traci (avatar + padajuća lista): ime i uloge, prekidač ZEV-ova, stavke naloga
// (`links`), korisničko uputstvo i odjava. Izdvojen iz NavShell-a da ga dijele sve tri školjke
// (aplikacija, platforma i čarobnjak novog ZEV-a) — markup, fokus i tastatura su isti kao prije.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { IconBuilding, IconCheck, IconHelp, IconLogout, IconPlug, IconSliders } from "@/components/nav-icons";
import { activeHref } from "@/components/nav-active";
import { t } from "@/lib/i18n";

export type TenantOption = {
  zevId: string;
  label: string;
  /** Full legal name, shown as a hover tooltip when it differs from the (often
   *  abbreviated) `label` — e.g. label "ZEV VM 10-12", fullLabel "Zajednica etažnih
   *  vlasnika 'Vojvode Mišića 10 i 12'". Omit (or make it equal to `label`) when there's
   *  no separate short name and no tooltip is needed. */
  fullLabel?: string;
};

/** `title` text for a tenant chip/row: the full legal name when there is one and it
 *  actually differs from the short label, otherwise `undefined` (no redundant tooltip
 *  that just repeats what's already on screen). */
export function tenantTitle(tt: TenantOption): string | undefined {
  return tt.fullLabel && tt.fullLabel !== tt.label ? tt.fullLabel : undefined;
}

/** Stavka naloga u meniju. `icon` je ključ (string), jer server komponenta ne može klijentskoj proslijediti
 *  komponentu-ikonu. */
export type AccountMenuLink = { href: string; label: string; icon: "sliders" | "plug" };

const LINK_ICONS = { sliders: IconSliders, plug: IconPlug } as const;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AccountMenu({
  displayName,
  rolesText,
  accent,
  links = [],
  logoutLabel,
  logoutAction,
  tenants,
  activeZevId,
  switchZevAction,
}: {
  displayName: string;
  rolesText: string;
  /** Boje avatara i aktivne stavke po školjci (tenant plava / platforma grafit) — isti oblik kao u NavShell-u. */
  accent: { avatar: string; avatarStatic: string; activeLink: string };
  links?: AccountMenuLink[];
  logoutLabel: string;
  logoutAction: () => void | Promise<void>;
  tenants?: TenantOption[];
  activeZevId?: string | null;
  switchZevAction?: (formData: FormData) => void | Promise<void>;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const showSwitcher = Boolean(tenants && tenants.length > 1 && switchZevAction);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const currentLink = activeHref(pathname, links.map((l) => l.href));

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        avatarRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        ref={avatarRef}
        onClick={() => setMenuOpen((v) => !v)}
        aria-controls={menuOpen ? menuId : undefined}
        aria-expanded={menuOpen}
        aria-label={`Nalog: ${displayName}`}
        className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm transition-shadow hover:shadow ${accent.avatar}`}
      >
        {initials(displayName)}
      </button>
      {menuOpen && (
        <div
          id={menuId}
          className="dropdown-in absolute right-0 z-30 mt-2 w-64 origin-top-right rounded-2xl border border-slate-200/80 bg-white py-1.5 shadow-xl ring-1 ring-slate-900/5"
        >
          <div className="flex items-center gap-3 border-b border-slate-100 px-3.5 py-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${accent.avatarStatic}`}>
              {initials(displayName)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{displayName}</div>
              <div className="truncate text-[13px] text-slate-500">{rolesText}</div>
            </div>
          </div>
          {showSwitcher && (
            <div className="border-b border-slate-100 py-1.5">
              <div className="px-3.5 pb-1 text-[13px] font-medium text-slate-500">
                {t("tenant.switcherHeading")}
              </div>
              <div className="px-1.5">
                {tenants!.map((tt) => {
                  const isActive = tt.zevId === activeZevId;
                  return (
                    <form key={tt.zevId} action={switchZevAction}>
                      <input type="hidden" name="zevId" value={tt.zevId} />
                      <button
                        type="submit"
                        aria-current={isActive ? "true" : undefined}
                        title={tenantTitle(tt)}
                        disabled={isActive}
                        // Deliberately NOT closing the menu synchronously here: this is a
                        // type="submit" button, and unmounting the dropdown (which contains
                        // this very form) inside its own onClick — before the browser gets to
                        // run the click's default action — cancels the form submission
                        // entirely. The click silently "closes the menu" and switchActiveZev
                        // never runs. Deferring to the next tick lets the native submit fire
                        // first; the redirect that follows re-renders NavShell with fresh
                        // props anyway, so the menu ends up reflecting the new active tenant
                        // regardless of whether it stayed open for one extra frame.
                        onClick={() => setTimeout(() => setMenuOpen(false), 0)}
                        className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors last:mb-0 ${
                          isActive
                            ? "cursor-default bg-blue-50 font-medium text-blue-700 ring-1 ring-inset ring-blue-100"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <IconBuilding
                          className={`h-4 w-4 shrink-0 ${isActive ? "text-blue-500" : "text-slate-400"}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{tt.label}</span>
                        {isActive && (
                          <>
                            <IconCheck className="h-4 w-4 shrink-0 text-blue-600" />
                            <span className="sr-only">({t("tenant.active")})</span>
                          </>
                        )}
                      </button>
                    </form>
                  );
                })}
              </div>
            </div>
          )}
          <div className="py-1">
            {links.map((l) => {
              const Icon = LINK_ICONS[l.icon];
              const active = currentLink === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors ${
                    active ? `font-medium ${accent.activeLink}` : "text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "" : "text-slate-400"}`} />
                  {l.label}
                </Link>
              );
            })}
            <a
              href="/korisnicko-uputstvo.html"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
            >
              <IconHelp className="h-4 w-4 shrink-0 text-slate-400" />
              {t("nav.userGuide")}
            </a>
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
              >
                <IconLogout className="h-4 w-4 shrink-0 text-slate-400" />
                {logoutLabel}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
