"use client";
// App chrome: desktop sidebar (unchanged behavior) + a hamburger-triggered
// drawer for small screens, so the full nav list doesn't get dumped inline
// above every page's content on a phone.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavLink = { href: string; label: string };

export function NavShell({
  appName,
  displayName,
  rolesText,
  links,
  logoutLabel,
  logoutAction,
  children,
}: {
  appName: string;
  displayName: string;
  rolesText: string;
  links: NavLink[];
  logoutLabel: string;
  logoutAction: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const linkCls = (href: string) =>
    `block rounded-md px-3 py-2 text-sm font-medium md:py-1.5 ${
      pathname === href ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-blue-50 hover:text-blue-700"
    }`;

  return (
    <div className="min-h-screen md:flex">
      {/* Mobile top bar: app name + hamburger toggle. Hidden on md+ where the sidebar is always visible. */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white p-4 md:hidden">
        <div>
          <div className="text-lg font-bold text-blue-700">{appName}</div>
          <div className="text-xs text-slate-500">{displayName}</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Zatvori meni" : "Otvori meni"}
          aria-expanded={open}
          className="rounded-md border border-slate-300 px-3 py-2 text-lg leading-none text-slate-700"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile drawer: only rendered while open, closes itself on link tap. */}
      {open && (
        <nav className="space-y-0.5 border-b border-slate-200 bg-white px-2 pb-3 md:hidden">
          <div className="px-3 pb-2 text-xs text-slate-400">{rolesText}</div>
          {links.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={linkCls(n.href)}>
              {n.label}
            </Link>
          ))}
          <form action={logoutAction} className="pt-2">
            <button
              type="submit"
              onClick={() => setOpen(false)}
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100"
            >
              {logoutLabel}
            </button>
          </form>
        </nav>
      )}

      {/* Desktop sidebar — same layout as before. */}
      <aside className="hidden border-slate-200 bg-white md:block md:min-h-screen md:w-60 md:border-r">
        <div className="p-4">
          <div className="text-lg font-bold text-blue-700">{appName}</div>
          <div className="text-xs text-slate-500">{displayName}</div>
          <div className="text-xs text-slate-400">{rolesText}</div>
        </div>
        <nav className="space-y-0.5 px-2 pb-3">
          {links.map((n) => (
            <Link key={n.href} href={n.href} className={linkCls(n.href)}>
              {n.label}
            </Link>
          ))}
          <form action={logoutAction} className="mt-2">
            <button type="submit" className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-100">
              {logoutLabel}
            </button>
          </form>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
