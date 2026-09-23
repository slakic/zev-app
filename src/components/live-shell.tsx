// Minimal chrome for the live-meeting screen (/uzivo/[meetingId], Plans/
// live-meeting-mode-plan.md §2.4) — same reasoning as auth-shell.tsx's separate shell for
// a different context: the president is standing in a room, on a phone, and the standard
// NavShell (sidebar, tenant switcher, account menu) exists to navigate BETWEEN pages, which
// is exactly what this screen should not spend vertical space on. Deliberately no new
// tokens or colors — same palette as everywhere else, just less chrome.
import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

export function LiveShell({
  title, backHref, children,
}: { title: string; backHref: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      {/* Not sticky — only the quorum bar below (RollCall) stays pinned once this scrolls
          past; a back-link + title bar doesn't need to stay on screen the whole time the
          way the live present/absent count does (Plans/live-meeting-mode-plan.md §3.1). */}
      <header className="border-b border-slate-200 bg-white p-3 shadow-sm">
        <Link
          href={backHref}
          className="mb-1 inline-flex items-center gap-1 rounded-full px-2 py-1 -ml-2 text-[13px] font-medium text-blue-700 transition-colors hover:bg-blue-50"
        >
          ‹ {t("live.backToMeeting")}
        </Link>
        <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
      </header>
      <main className="p-3">{children}</main>
    </div>
  );
}
