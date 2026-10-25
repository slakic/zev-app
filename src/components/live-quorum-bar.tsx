// The sticky bar of the live-meeting screen (F6.3, Plans/live-meeting-mode-plan.md §3.1): who is in the room
// (present / not yet called / marked absent) and whether the room has a quorum. "Not called" is deliberately not
// "absent" — a roll call in progress must not look like an empty room. No card (no nested elevation): a border-bottom
// strip. The quorum line is text with a ✓/⚠ (PreconditionList), never colour alone. Rendered on both tabs.
import { PreconditionList } from "@/components/precondition-list";
import { t, tf } from "@/lib/i18n";
import type { LiveQuorum } from "@/lib/liveQuorum";

function Count({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-2xl font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-[13px] text-slate-600">{label}</span>
    </span>
  );
}

export function LiveQuorumBar({
  presentCount, unmarkedCount, absentCount, quorum,
}: { presentCount: number; unmarkedCount: number; absentCount: number; quorum: LiveQuorum | null }) {
  let line: { ok: boolean; text: string };
  if (!quorum) line = { ok: true, text: t("live.quorum.noProposal") };
  else if (quorum.kind === "NONE") line = { ok: true, text: t("live.quorum.none") };
  else {
    const verdict = quorum.reached ? t("live.quorum.reached") : tf("live.quorum.missing", { broj: quorum.missing });
    const base = tf(quorum.kind === "COUNT" ? "live.quorum.count" : "live.quorum.weight", {
      prisutno: quorum.present, ukupno: quorum.total, potrebno: quorum.required,
    });
    line = { ok: quorum.reached, text: `${base} — ${verdict}` };
  }
  return (
    <div className="sticky top-0 z-10 -mx-3 mb-4 border-b border-slate-200 bg-canvas/95 px-3 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Count value={presentCount} label={t("live.present")} />
        <span className="text-slate-500" aria-hidden="true">·</span>
        <Count value={unmarkedCount} label={t("live.unmarked")} />
        <span className="text-slate-500" aria-hidden="true">·</span>
        <Count value={absentCount} label={t("live.absent")} />
      </div>
      <div className="mt-1.5">
        <PreconditionList items={[line]} />
        {quorum && quorum.kind !== "NONE" && (
          <p className="mt-1 text-[13px] text-slate-600">{tf("live.quorum.forProposal", { sifra: quorum.proposalCode })}</p>
        )}
        {quorum?.acceptsEVotes && <p className="mt-1 text-[13px] text-slate-600">{t("live.quorum.eVotes")}</p>}
      </div>
    </div>
  );
}
