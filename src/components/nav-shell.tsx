"use client";
// App chrome: a left sidebar carries the app name and the full navigation
// (as a slide-in drawer on narrow screens), and a slim top bar sits above the
// page content with the signed-in user's profile/logout menu in the right
// corner.
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  NAV_ICONS,
  IconDot,
  IconChevronLeft,
  IconBuilding,
  IconCheck,
  IconLogout,
  IconSliders,
  IconShield,
} from "@/components/nav-icons";
import { t } from "@/lib/i18n";

export type NavLink = { href: string; label: string };
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
function tenantTitle(tt: TenantOption): string | undefined {
  return tt.fullLabel && tt.fullLabel !== tt.label ? tt.fullLabel : undefined;
}

const COLLAPSE_STORAGE_KEY = "zev-nav-collapsed";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function NavShell({
  appName,
  displayName,
  rolesText,
  links,
  logoutLabel,
  logoutAction,
  settingsHref = "/podesavanja",
  settingsLabel = "Podešavanja",
  tenants,
  activeZevId,
  switchZevAction,
  variant = "tenant",
  children,
}: {
  appName: string;
  displayName: string;
  rolesText: string;
  links: NavLink[];
  logoutLabel: string;
  logoutAction: () => void | Promise<void>;
  settingsHref?: string;
  settingsLabel?: string;
  /** Every ZEV the signed-in user holds a Membership in. The switcher (below) and the
   * active-ZEV chip only render when there's more than one — a single-membership user
   * (practically everyone today) sees no change at all. */
  tenants?: TenantOption[];
  activeZevId?: string | null;
  switchZevAction?: (formData: FormData) => void | Promise<void>;
  /** "platform" is the admin/[super admin] shell (Plans/design-system.md §7) — same
   * component, same primitives and icons, but a graphite accent instead of blue and a
   * permanent "Super admin" badge in place of the tenant chip. Invariant: a "platform"
   * caller never passes `tenants`/`switchZevAction` — a super admin has no "own" tenant
   * to switch into from here. */
  variant?: "tenant" | "platform";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const showSwitcher = Boolean(tenants && tenants.length > 1 && switchZevAction);
  const activeTenant = tenants?.find((tt) => tt.zevId === activeZevId);
  const platform = variant === "platform";
  // Same values used across the shell for a given variant — kept in one place instead of
  // scattering the ternary at every call site (Plans/design-system.md §7). Deliberately
  // raw Tailwind shades, not the --color-platform tokens: the avatar/active-link/badge
  // are each a different shade on purpose (see design-system.md §7's comparison table),
  // matching how the tenant variant already mixes bg-blue-600 (avatar) with bg-blue-50
  // (active link) rather than one flat color.
  const accent = platform
    ? {
        activeLink: "bg-slate-800 text-white",
        appName: "text-slate-800",
        avatar: "bg-slate-700 hover:bg-slate-800",
        avatarStatic: "bg-slate-700",
      }
    : {
        activeLink: "bg-blue-50 text-blue-700",
        appName: "text-blue-700",
        avatar: "bg-blue-600 hover:bg-blue-700",
        avatarStatic: "bg-blue-600",
      };
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Desktop-only "icon rail" collapse. Defaults to expanded (visible) on every
  // fresh load; a remembered preference (if any) is applied after mount so
  // server and first client render always agree on the expanded default.
  const [collapsed, setCollapsed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      // localStorage unavailable (private browsing, etc.) — keep the default.
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // best-effort only
      }
      return next;
    });
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  // A9 (Plans/ui-ux-redesign-plan.md) — the mobile drawer is a modal overlay (it sits
  // above a backdrop and blocks the page behind it), so it needs the same keyboard
  // contract as any dialog: focus moves in when it opens, Tab/Shift+Tab can't escape it
  // while it's open, and focus returns to whatever opened it on close.
  useEffect(() => {
    if (!drawerOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = drawerRef.current;
    container?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // `active === container` covers the instant after opening, before the user has
      // tabbed anywhere: focus starts on the drawer itself (see `container?.focus()`
      // above), not on `first` — without this branch, a Shift+Tab as the very first
      // keystroke would fall through to native behavior and escape onto whatever sits
      // right before the drawer in the DOM, defeating the trap before it does anything.
      if (e.shiftKey && (active === first || active === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [drawerOpen]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const linkCls = (href: string) =>
    `flex items-center gap-3 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
      collapsed ? "md:mx-auto md:w-11 md:justify-center md:gap-0 md:rounded-xl md:px-0" : ""
    } ${pathname === href ? accent.activeLink : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`;

  return (
    <div className="min-h-screen md:flex">
      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        ref={drawerRef}
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label={drawerOpen ? "Meni navigacije" : undefined}
        tabIndex={-1}
        className={`fixed inset-y-0 left-0 z-40 w-60 overflow-y-auto bg-white shadow-xl transition-all duration-200 focus:outline-none md:static md:z-auto md:translate-x-0 md:border-r md:border-slate-200 md:shadow-none ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:w-[76px]" : "md:w-60"}`}
      >
        <div
          className={`flex items-center justify-between p-4 ${
            collapsed ? "md:flex-col md:justify-center md:gap-3" : ""
          }`}
        >
          <div className={`flex items-center gap-2 ${collapsed ? "md:hidden" : ""}`}>
            <Image
              src="/logo-mark.png"
              alt=""
              width={28}
              height={37}
              className="h-8 w-auto shrink-0"
              priority
            />
            <div className={`text-lg font-bold tracking-tight ${accent.appName}`}>{appName}</div>
          </div>
          <div className={`hidden shrink-0 items-center justify-center ${collapsed ? "md:flex" : ""}`}>
            <Image
              src="/logo-mark.png"
              alt={appName}
              width={28}
              height={37}
              className="h-9 w-auto"
              priority
            />
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Proširi meni" : "Suzi meni"}
            className="hidden rounded-full p-1.5 text-slate-500 hover:bg-slate-100 md:inline-flex"
          >
            <IconChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Zatvori meni"
            className="rounded-full p-1 text-slate-500 hover:bg-slate-100 md:hidden"
          >
            ✕
          </button>
        </div>
        <nav className="space-y-0.5 px-2 pb-4">
          {links.map((n) => {
            const Icon = NAV_ICONS[n.href] ?? IconDot;
            return (
              <Link key={n.href} href={n.href} title={n.label} className={linkCls(n.href)}>
                <Icon className="h-5 w-5 shrink-0" />
                <span className={collapsed ? "md:hidden" : ""}>{n.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col" aria-hidden={drawerOpen ? true : undefined}>
        <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Otvori meni"
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
          >
            ☰
          </button>
          <div className="flex-1" />

          {platform ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1 text-[13px] font-semibold text-white ring-1 ring-inset ring-slate-900/10">
              <IconShield className="h-3.5 w-3.5 shrink-0" />
              {t("admin.badge")}
            </span>
          ) : (
            showSwitcher &&
            activeTenant && (
              <span
                title={tenantTitle(activeTenant) ?? activeTenant.label}
                className="hidden max-w-[16rem] items-center gap-1.5 truncate rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 sm:inline-flex"
              >
                <IconBuilding className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="truncate">{activeTenant.label}</span>
              </span>
            )
          )}

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Nalog: ${displayName}`}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm transition-shadow hover:shadow ${accent.avatar}`}
            >
              {initials(displayName)}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="dropdown-in absolute right-0 z-30 mt-2 w-64 origin-top-right rounded-2xl border border-slate-200/80 bg-white py-1.5 shadow-xl ring-1 ring-slate-900/5"
              >
                <div className="flex items-center gap-3 border-b border-slate-100 px-3.5 py-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${accent.avatarStatic}`}>
                    {initials(displayName)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{displayName}</div>
                    <div className="truncate text-xs text-slate-500">{rolesText}</div>
                  </div>
                </div>
                {showSwitcher && (
                  <div className="border-b border-slate-100 py-1.5">
                    <div className="px-3.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
                              role="menuitem"
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
                  {!platform && (
                    <Link
                      href={settingsHref}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                    >
                      <IconSliders className="h-4 w-4 shrink-0 text-slate-400" />
                      {settingsLabel}
                    </Link>
                  )}
                  <form action={logoutAction}>
                    <button
                      type="submit"
                      role="menuitem"
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
        </header>

        {/* Capped width so paragraphs/cards don't stretch to unreadable line lengths on
            wide monitors (Plans/ui-ux-redesign-plan.md §3.4, §2.8) — mx-auto centers the
            capped column inside the flex-1 area rather than pinning it left. */}
        <main className="min-w-0 flex-1 p-4 md:p-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
