"use client";
// App chrome: a left sidebar carries the app name and the full navigation
// (as a slide-in drawer on narrow screens), and a slim top bar sits above the
// page content with the signed-in user's profile/logout menu in the right
// corner.
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  NAV_ICONS,
  IconDot,
  IconChevronLeft,
  IconBuilding,
  IconShield,
  IconMenu,
  IconClose,
} from "@/components/nav-icons";
import { AccountMenu, tenantTitle, type AccountMenuLink, type TenantOption } from "@/components/account-menu";
import { activeHref } from "@/components/nav-active";
import { t } from "@/lib/i18n";

export type NavLink = { href: string; label: string };
/** Grupa stavki menija (F9, D8): `label` izostavljen = ravna lista bez naslova. */
export type NavGroup = { label?: string; links: NavLink[] };
export type { TenantOption, AccountMenuLink };

const COLLAPSE_STORAGE_KEY = "zev-nav-collapsed";

export function NavShell({
  appName,
  displayName,
  rolesText,
  groups,
  logoutLabel,
  logoutAction,
  accountLinks,
  tenants,
  activeZevId,
  switchZevAction,
  variant = "tenant",
  children,
}: {
  appName: string;
  displayName: string;
  rolesText: string;
  groups: NavGroup[];
  logoutLabel: string;
  logoutAction: () => void | Promise<void>;
  /** Stavke naloga u padajućem meniju, iznad „Korisničkog uputstva” (X-Q6: „Moji podaci”; MCP: „Povezani
   *  asistenti”). Izostavljeno = samo uputstvo i odjava. Redoslijed je redoslijed u meniju. */
  accountLinks?: AccountMenuLink[];
  /** Every ZEV the signed-in user holds a Membership in. The active ZEV's name is always
   * shown under the app name (D9, Plans/design-review-plan.md §5); the switcher (below) and
   * the active-ZEV chip in the top bar only render when there's more than one. */
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
  const navId = useId();
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

  const current = activeHref(pathname, groups.flatMap((g) => g.links.map((n) => n.href)));
  const linkCls = (href: string) =>
    `flex items-center gap-3 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
      collapsed ? "md:mx-auto md:w-11 md:justify-center md:gap-0 md:rounded-xl md:px-0" : ""
    } ${current === href ? accent.activeLink : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`;

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
          <div className={`flex min-w-0 items-center gap-2 ${collapsed ? "md:hidden" : ""}`}>
            <Image
              src="/logo-mark.png"
              alt=""
              width={28}
              height={37}
              className="h-8 w-auto shrink-0"
              priority
            />
            <div className="min-w-0">
              <div className={`text-lg font-bold tracking-tight ${accent.appName}`}>{appName}</div>
              {!platform && activeTenant && (
                <div
                  className="truncate text-[13px] text-slate-500"
                  title={tenantTitle(activeTenant) ?? activeTenant.label}
                >
                  {activeTenant.label}
                </div>
              )}
            </div>
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
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 md:hidden"
          >
            <IconClose />
          </button>
        </div>
        <nav className="px-2 pb-4">
          {groups.map((g, gi) => {
            const headingId = `${navId}-g${gi}`;
            return (
              <div
                key={g.label ?? gi}
                role={g.label ? "group" : undefined}
                aria-labelledby={g.label ? headingId : undefined}
                className="space-y-0.5"
              >
                {g.label && gi > 0 && (
                  // Suženi icon-rail nema mjesta za naslov: zamjenjuje ga tanka linija (D8).
                  <div aria-hidden="true" className={`hidden ${collapsed ? "md:mx-3 md:mt-3 md:mb-2 md:block md:border-t md:border-slate-200" : ""}`} />
                )}
                {g.label && (
                  <div
                    id={headingId}
                    className={`px-3.5 pb-1 text-[13px] font-medium text-slate-500 ${gi > 0 ? "pt-4" : "pt-1"} ${
                      collapsed ? "md:hidden" : ""
                    }`}
                  >
                    {g.label}
                  </div>
                )}
                {g.links.map((n) => {
                  const Icon = NAV_ICONS[n.href] ?? IconDot;
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      title={n.label}
                      aria-current={current === n.href ? "page" : undefined}
                      className={linkCls(n.href)}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className={collapsed ? "md:hidden" : ""}>{n.label}</span>
                    </Link>
                  );
                })}
              </div>
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
            className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 md:hidden"
          >
            <IconMenu />
            {t("nav.menu")}
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
                className="inline-flex max-w-[10rem] items-center gap-1.5 truncate rounded-full bg-blue-50 px-3 py-1 text-[13px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 sm:max-w-[16rem]"
              >
                <IconBuilding className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="truncate">{activeTenant.label}</span>
              </span>
            )
          )}

          <AccountMenu
            displayName={displayName}
            rolesText={rolesText}
            accent={{ avatar: accent.avatar, avatarStatic: accent.avatarStatic, activeLink: accent.activeLink }}
            links={accountLinks}
            logoutLabel={logoutLabel}
            logoutAction={logoutAction}
            tenants={tenants}
            activeZevId={activeZevId}
            switchZevAction={switchZevAction}
          />
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
