"use client";
// App chrome: a left sidebar carries the app name and the full navigation
// (as a slide-in drawer on narrow screens), and a slim top bar sits above the
// page content with the signed-in user's profile/logout menu in the right
// corner.
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV_ICONS, IconDot, IconChevronLeft } from "@/components/nav-icons";

export type NavLink = { href: string; label: string };

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
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Desktop-only "icon rail" collapse. Defaults to expanded (visible) on every
  // fresh load; a remembered preference (if any) is applied after mount so
  // server and first client render always agree on the expanded default.
  const [collapsed, setCollapsed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!drawerOpen) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [drawerOpen]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const linkCls = (href: string) =>
    `flex items-center gap-3 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
      collapsed ? "md:mx-auto md:w-11 md:justify-center md:gap-0 md:rounded-xl md:px-0" : ""
    } ${
      pathname === href
        ? "bg-blue-50 text-blue-700"
        : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
    }`;

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
        className={`fixed inset-y-0 left-0 z-40 w-60 overflow-y-auto bg-white shadow-xl transition-all duration-200 md:static md:z-auto md:translate-x-0 md:border-r md:border-slate-200 md:shadow-none ${
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
            <div className="text-lg font-bold tracking-tight text-blue-700">{appName}</div>
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

      <div className="flex min-w-0 flex-1 flex-col">
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

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Nalog: ${displayName}`}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white shadow-sm transition-shadow hover:bg-blue-700 hover:shadow"
            >
              {initials(displayName)}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
              >
                <div className="border-b border-slate-100 px-3 py-2">
                  <div className="truncate text-sm font-medium text-slate-800">{displayName}</div>
                  <div className="truncate text-xs text-slate-400">{rolesText}</div>
                </div>
                <Link
                  href={settingsHref}
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                >
                  {settingsLabel}
                </Link>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                  >
                    {logoutLabel}
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
