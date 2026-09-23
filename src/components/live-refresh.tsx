"use client";
// Faza 3 (Plans/live-meeting-mode-plan.md §2.3, §4): router.refresh() re-runs only server
// components, preserving client state (search text, filter chips, scroll) — see RollCall's
// own comment for why that guarantee is what makes an auto-refreshing screen usable under a
// thumb. No new route, no second serialization of the same numbers (§2.3, option (a)).
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/ui";
import { t } from "@/lib/i18n";

const INTERVAL_S = 10;

export function LiveRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [secondsAgo, setSecondsAgo] = useState(0);
  const lastLanded = useRef(Date.now());
  const wasPending = useRef(false);

  // Reset the counter when a refresh actually lands (isPending true -> false), not when it's
  // merely requested — a stalled connection in the room should make "ažurirano prije Xs" keep
  // climbing past 10s, which is the point of showing it (§2.3: "vidi kad se zaglavilo").
  useEffect(() => {
    if (wasPending.current && !isPending) {
      lastLanded.current = Date.now();
      setSecondsAgo(0);
    }
    wasPending.current = isPending;
  }, [isPending]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastLanded.current) / 1000));
      const due = Date.now() - lastLanded.current >= INTERVAL_S * 1000;
      if (due && !isPending && document.visibilityState === "visible") {
        startTransition(() => router.refresh());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [router, isPending]);

  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-[13px] text-slate-500">
        {t("live.updatedPrefix")} {secondsAgo}s
      </span>
      <Btn type="button" variant="secondary" onClick={() => startTransition(() => router.refresh())}>
        {t("live.refreshNow")}
      </Btn>
    </div>
  );
}
