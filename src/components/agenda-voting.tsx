// "Dnevni red" tab content for /uzivo/[meetingId] (Plans/live-meeting-mode-plan.md §3.4).
// Entirely server-rendered — no client component needed here, unlike roll-call.tsx: rows
// that finish voting simply drop out of "Unos iz sale" on the next server-action-triggered
// refresh, which is exactly what a plain <form action={...}> without JS already does.
import Link from "next/link";
import { Card, ConfirmAction, ToggleBtn, SegmentedAction, StatusBadge } from "@/components/ui";
import { formatWeight } from "@/lib/money";
import { tEnum, t } from "@/lib/i18n";

export type AgendaItemData = {
  id: string;
  order: number;
  title: string;
  note: string | null;
  proposals: { id: string; code: string; title: string; status: string; text: string }[];
};

export type LivePreview = {
  presentCount: number;
  deliverCount: number;
  noChannelCount: number;
  quorumReachable: boolean;
};

export type LiveResult = {
  quorumReached: boolean;
  weightCast: string;
  totalEligibleWeight: string;
  approveWeight: string;
  rejectWeight: string;
  abstainWeight: string;
  accepted: boolean;
};

export type ActiveVoter = {
  eligibleVoterId: string;
  ownerId: string;
  ownerName: string;
  present: boolean;
  voted: boolean;
  channel: string | null;
  deliveredVia: string | null;
};

/** Horizontal picker for which agenda item is "open" on screen — state lives in the URL
 *  (`?t=<agendaItemId>`), not React state, so an auto-refresh (Faza 3) never closes it. */
export function AgendaTabs({
  meetingId, items, activeId,
}: { meetingId: string; items: { id: string; order: number; title: string }[]; activeId: string | null }) {
  return (
    <nav aria-label={t("live.tabAgenda")} className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {items.map((a) => {
        const isActive = a.id === activeId;
        return (
          <Link
            key={a.id}
            href={`/uzivo/${meetingId}?tab=dnevni-red&t=${a.id}`}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
              isActive ? "bg-blue-50 text-blue-700" : "border border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {a.order}. {a.title}
          </Link>
        );
      })}
    </nav>
  );
}

function ResultSummary({ result }: { result: LiveResult }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-xl font-semibold tabular-nums text-emerald-700">{formatWeight(result.approveWeight)}</div>
          <div className="text-[13px] text-slate-500">{t("live.voteFor")}</div>
        </div>
        <div>
          <div className="text-xl font-semibold tabular-nums text-red-700">{formatWeight(result.rejectWeight)}</div>
          <div className="text-[13px] text-slate-500">{t("live.voteAgainst")}</div>
        </div>
        <div>
          <div className="text-xl font-semibold tabular-nums text-slate-700">{formatWeight(result.abstainWeight)}</div>
          <div className="text-[13px] text-slate-500">{t("live.voteAbstain")}</div>
        </div>
      </div>
      <p className="mt-3 border-t border-slate-100 pt-3 text-[13px] text-slate-600">
        {result.quorumReached ? t("live.resultQuorumReached") : t("live.resultQuorumNotReached")} (
        {formatWeight(result.weightCast)} / {formatWeight(result.totalEligibleWeight)})
      </p>
      <p className="text-[13px] font-medium text-slate-700">
        {t("live.resultOutcomeIfClosedNow")}: {result.accepted ? t("live.resultAccepted") : t("live.resultNotAccepted")}
      </p>
    </div>
  );
}

export function AgendaItemPanel({
  meetingId, item, proposal, preview, activeResult, activeVoters,
  openVotingAction, closeVotingAction, manualVoteAction,
}: {
  meetingId: string;
  item: AgendaItemData;
  proposal: AgendaItemData["proposals"][number] | null;
  preview: LivePreview | null;
  activeResult: LiveResult | null;
  activeVoters: ActiveVoter[];
  openVotingAction: (formData: FormData) => void | Promise<void>;
  closeVotingAction: (formData: FormData) => void | Promise<void>;
  manualVoteAction: (formData: FormData) => void | Promise<void>;
}) {
  if (!proposal) {
    return (
      <Card>
        <p className="text-[15px] font-medium text-slate-900">{item.title}</p>
        {item.note && <p className="mt-1 text-[13px] text-slate-500">{item.note}</p>}
        <p className="mt-3 text-[13px] text-slate-500">{t("live.discussionOnly")}</p>
      </Card>
    );
  }

  if (proposal.status === "DRAFT") {
    return (
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[13px] font-medium text-slate-500">{proposal.code}</span>
          <StatusBadge status={proposal.status} label={tEnum("proposalStatus", proposal.status)} />
        </div>
        <p className="text-[15px] font-medium text-slate-900">{proposal.title}</p>
        <details className="group mt-2">
          <ToggleBtn variant="secondary">{t("live.proposalText")}</ToggleBtn>
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{proposal.text}</p>
        </details>

        {preview && (
          <div className="mt-4">
            <ConfirmAction
              trigger={t("live.openVotingTrigger")}
              triggerVariant="primary"
              title={t("live.openVotingTitle")}
              body={
                <div className="space-y-1 text-sm text-amber-950">
                  <p>
                    {t("live.previewInRoom")}: <b>{preview.presentCount}</b> · {t("live.previewEmail")}: <b>{preview.deliverCount}</b> ·{" "}
                    <b>
                      {t("live.previewNoChannel")}: {preview.noChannelCount}
                    </b>{" "}
                    — {t("live.previewNoChannelHint")}.
                  </p>
                  {!preview.quorumReachable && <p className="font-medium">{t("live.quorumUnreachable")}</p>}
                </div>
              }
              confirmLabel={t("live.openVotingConfirm")}
              action={openVotingAction}
              hiddenFields={{ proposalId: proposal.id, meetingId, agendaItemId: item.id }}
            />
          </div>
        )}
      </Card>
    );
  }

  if (proposal.status === "VOTING_OPEN") {
    const notYetVoted = activeVoters.filter((v) => v.present && !v.voted);
    const electronic = activeVoters.filter((v) => v.voted && v.channel === "ELECTRONIC");
    const noChannel = activeVoters.filter((v) => !v.present && !v.voted && !v.deliveredVia);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-slate-500">{proposal.code}</span>
          <StatusBadge status={proposal.status} label={tEnum("proposalStatus", proposal.status)} />
        </div>

        {activeResult && <ResultSummary result={activeResult} />}

        <Card
          title={`${t("live.manualEntryTitle")} — ${t("live.manualEntryRemaining")}: ${notYetVoted.length} / ${activeVoters.filter((v) => v.present).length}`}
        >
          <ul className="space-y-2">
            {notYetVoted.map((v) => (
              <li key={v.eligibleVoterId} className="rounded-lg border border-slate-200/80 p-2.5">
                <p className="mb-2 text-[15px] font-medium text-slate-900">{v.ownerName}</p>
                <form action={manualVoteAction}>
                  <input type="hidden" name="proposalId" value={proposal.id} />
                  <input type="hidden" name="agendaItemId" value={item.id} />
                  <input type="hidden" name="meetingId" value={meetingId} />
                  <input type="hidden" name="eligibleVoterId" value={v.eligibleVoterId} />
                  <input type="hidden" name="channel" value="IN_PERSON" />
                  <SegmentedAction
                    name="choice"
                    options={[
                      { value: "APPROVE", label: t("live.voteFor") },
                      { value: "REJECT", label: t("live.voteAgainst"), activeVariant: "caution" },
                      { value: "ABSTAIN", label: t("live.voteAbstain") },
                    ]}
                  />
                </form>
              </li>
            ))}
            {notYetVoted.length === 0 && <li className="py-4 text-center text-[13px] text-slate-500">—</li>}
          </ul>
        </Card>

        <details className="group">
          <ToggleBtn variant="secondary">
            {t("live.electronicTitle")} ({electronic.length})
          </ToggleBtn>
          <ul className="mt-2 space-y-1.5">
            {electronic.map((v) => (
              <li key={v.eligibleVoterId} className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-[15px] text-slate-700">
                {v.ownerName}
              </li>
            ))}
            {electronic.length === 0 && <li className="text-[13px] text-slate-500">—</li>}
          </ul>
        </details>

        <details className="group">
          <ToggleBtn variant="secondary">
            {t("live.noChannelTitle")} ({noChannel.length})
          </ToggleBtn>
          <ul className="mt-2 space-y-2">
            {noChannel.map((v) => (
              <li key={v.eligibleVoterId} className="rounded-lg border border-slate-200/80 p-2.5">
                <p className="mb-1 text-[15px] font-medium text-slate-900">{v.ownerName}</p>
                <p className="mb-2 text-[13px] text-slate-500">{t("live.paperEntryHint")}</p>
                <form action={manualVoteAction}>
                  <input type="hidden" name="proposalId" value={proposal.id} />
                  <input type="hidden" name="agendaItemId" value={item.id} />
                  <input type="hidden" name="meetingId" value={meetingId} />
                  <input type="hidden" name="eligibleVoterId" value={v.eligibleVoterId} />
                  <input type="hidden" name="channel" value="PAPER" />
                  <SegmentedAction
                    name="choice"
                    options={[
                      { value: "APPROVE", label: t("live.voteFor") },
                      { value: "REJECT", label: t("live.voteAgainst"), activeVariant: "caution" },
                      { value: "ABSTAIN", label: t("live.voteAbstain") },
                    ]}
                  />
                </form>
              </li>
            ))}
            {noChannel.length === 0 && <li className="text-[13px] text-slate-500">—</li>}
          </ul>
        </details>

        <ConfirmAction
          trigger={t("live.closeVotingTrigger")}
          triggerVariant="caution"
          title={t("live.closeVotingTitle")}
          body={
            activeResult ? (
              <div className="space-y-1 text-sm text-amber-950">
                <p>
                  {activeResult.quorumReached ? t("live.resultQuorumReached") : t("live.resultQuorumNotReached")} (
                  {formatWeight(activeResult.weightCast)} / {formatWeight(activeResult.totalEligibleWeight)})
                </p>
                <p>
                  {t("live.voteFor")}: {formatWeight(activeResult.approveWeight)} · {t("live.voteAgainst")}:{" "}
                  {formatWeight(activeResult.rejectWeight)} · {t("live.voteAbstain")}: {formatWeight(activeResult.abstainWeight)}
                </p>
                <p className="font-medium">
                  {t("live.resultOutcomeIfClosedNow")}: {activeResult.accepted ? t("live.resultAccepted") : t("live.resultNotAccepted")}
                </p>
              </div>
            ) : null
          }
          confirmLabel={t("live.closeVotingConfirm")}
          action={closeVotingAction}
          hiddenFields={{ proposalId: proposal.id, meetingId, agendaItemId: item.id }}
        />
      </div>
    );
  }

  // VOTING_CLOSED / ACCEPTED / REJECTED / WITHDRAWN / SUPERSEDED — read-only in this screen;
  // decision recording and minutes live on the desktop pages, out of scope here (§4 Faza 4+).
  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[13px] font-medium text-slate-500">{proposal.code}</span>
        <StatusBadge status={proposal.status} label={tEnum("proposalStatus", proposal.status)} />
      </div>
      <p className="text-[15px] font-medium text-slate-900">{proposal.title}</p>
    </Card>
  );
}
