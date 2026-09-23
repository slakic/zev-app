"use client";
// The prozivka (roll-call) screen for /uzivo/[meetingId] (Plans/live-meeting-mode-plan.md
// §3.2). Search and the filter chips are local client state, deliberately not URL/server
// state, so a later auto-refresh (Faza 3) can re-render this list with fresh data without
// losing what the president is mid-typing or which filter chip they picked — the whole
// reason recordAttendance-triggered refreshes stay cheap for the user is that this
// component's own useState survives them; only its props (the voter list) change.
import { useMemo, useState } from "react";
import { SegmentedAction, inputCls } from "@/components/ui";
import { t } from "@/lib/i18n";

export type RollCallVoter = {
  ownerId: string;
  ownerName: string;
  marked: boolean;
  present: boolean;
  eVoteConsentSigned: boolean;
  unitLabels: string[];
};

type Filter = "all" | "unmarked" | "present" | "absent";

const FILTERS: { value: Filter; key: string }[] = [
  { value: "unmarked", key: "live.filterUnmarked" },
  { value: "present", key: "live.filterPresent" },
  { value: "absent", key: "live.filterAbsent" },
  { value: "all", key: "live.filterAll" },
];

export function RollCall({
  meetingId, voters, presentCount, absentCount, action,
}: {
  meetingId: string;
  voters: RollCallVoter[];
  presentCount: number;
  absentCount: number;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  // Default view during an in-progress roll call: "who haven't I called yet" (§3.2).
  const [filter, setFilter] = useState<Filter>("unmarked");

  // Sort is fixed (alphabetical by display name) and never re-derived from marking state —
  // a list that reorders itself under the president's thumb is how a roll call gets lost.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return voters
      .filter((v) => {
        if (q && !v.ownerName.toLowerCase().includes(q)) return false;
        if (filter === "unmarked") return !v.marked;
        if (filter === "present") return v.present;
        if (filter === "absent") return v.marked && !v.present;
        return true;
      })
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName, "sr-Latn"));
  }, [voters, search, filter]);

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-3 mb-4 border-b border-slate-200 bg-canvas/95 px-3 py-2.5 backdrop-blur">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="text-lg font-semibold tabular-nums text-ink">{presentCount}</span>
          <span className="text-slate-500">{t("live.present")}</span>
          <span className="text-slate-300">·</span>
          <span className="text-lg font-semibold tabular-nums text-ink">{absentCount}</span>
          <span className="text-slate-500">{t("live.absent")}</span>
        </div>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("live.searchPlaceholder")}
        className={`${inputCls} mb-3`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={isActive}
              className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                isActive ? "bg-blue-50 text-blue-700" : "border border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t(f.key)}
            </button>
          );
        })}
      </div>

      <ul className="space-y-2">
        {filtered.map((v) => (
          <li key={v.ownerId} className="rounded-xl border border-slate-200/80 bg-white p-3">
            <div className="mb-2">
              <div className="text-[15px] font-medium text-slate-900">{v.ownerName}</div>
              <div className="text-[13px] text-slate-500">
                {v.unitLabels.length > 0 ? v.unitLabels.join(", ") : "—"}
                {" · "}
                {v.eVoteConsentSigned ? (
                  t("live.eVoteYes")
                ) : (
                  <span className="text-amber-700">⚠ {t("live.eVoteNo")}</span>
                )}
              </div>
            </div>
            <form action={action}>
              <input type="hidden" name="meetingId" value={meetingId} />
              <input type="hidden" name="partyId" value={v.ownerId} />
              <SegmentedAction
                name="present"
                active={v.marked ? String(v.present) : undefined}
                options={[
                  { value: "true", label: t("live.markPresent") },
                  { value: "false", label: t("live.markAbsent") },
                ]}
              />
            </form>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="py-10 text-center text-[15px] text-slate-500">{t("live.empty")}</li>
        )}
      </ul>
    </div>
  );
}
