import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import {
  getLiveMeetingState, recordAttendance, openVoting, closeVoting, recordManualVote,
  previewLiveDelivery, advanceMeetingStatus,
} from "@/server/services/meetings";
import { LiveShell } from "@/components/live-shell";
import { LiveRefresh } from "@/components/live-refresh";
import { RollCall } from "@/components/roll-call";
import { AgendaTabs, AgendaItemPanel } from "@/components/agenda-voting";
import { Tabs, Flash, SubmitBtn, BtnLink } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { MeetingStatus } from "@/generated/prisma/client";

// Outside (app): no NavShell, no maybeActor() from that layout — every entry point here
// (this page and every server action below) must independently call requireActor
// (Plans/live-meeting-mode-plan.md §2.4, risk 8). "PRESIDENT" and "ACCOUNTANT" match the
// widened service-layer guard from Faza 0 (§2.7, P7) — this route must never be narrower
// than the services it calls.

async function markAttendanceAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  await recordAttendance(actor, {
    meetingId,
    partyId: String(formData.get("partyId")),
    present: formData.get("present") === "true",
  });
  revalidatePath(`/uzivo/${meetingId}`);
}

function errRedirect(meetingId: string, agendaItemId: string, e: unknown): never {
  const msg = e instanceof Error ? e.message : "Greška";
  redirect(`/uzivo/${meetingId}?tab=dnevni-red&t=${agendaItemId}&err=${encodeURIComponent(msg)}`);
}

async function openVotingAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  const agendaItemId = String(formData.get("agendaItemId"));
  try {
    await openVoting(actor, String(formData.get("proposalId")), { delivery: "LIVE" });
  } catch (e) {
    errRedirect(meetingId, agendaItemId, e);
  }
  revalidatePath(`/uzivo/${meetingId}`);
}

async function closeVotingAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  const agendaItemId = String(formData.get("agendaItemId"));
  try {
    await closeVoting(actor, String(formData.get("proposalId")));
  } catch (e) {
    errRedirect(meetingId, agendaItemId, e);
  }
  revalidatePath(`/uzivo/${meetingId}`);
}

async function manualVoteAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  const agendaItemId = String(formData.get("agendaItemId"));
  try {
    await recordManualVote(actor, {
      eligibleVoterId: String(formData.get("eligibleVoterId")),
      choice: formData.get("choice") as never,
      channel: formData.get("channel") as never,
    });
  } catch (e) {
    errRedirect(meetingId, agendaItemId, e);
  }
  revalidatePath(`/uzivo/${meetingId}`);
}

async function advanceMeetingAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  const agendaItemId = String(formData.get("agendaItemId") ?? "");
  try {
    await advanceMeetingStatus(actor, meetingId, "VOTING_OPEN");
  } catch (e) {
    errRedirect(meetingId, agendaItemId, e);
  }
  revalidatePath(`/uzivo/${meetingId}`);
}

const PRE_VOTING_STATUSES: MeetingStatus[] = ["SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT"];

export default async function LiveMeetingPage({
  params, searchParams,
}: {
  params: Promise<{ meetingId: string }>;
  searchParams: Promise<{ tab?: string; t?: string; err?: string }>;
}) {
  const { meetingId } = await params;
  const sp = await searchParams;
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const tab = sp.tab === "dnevni-red" ? "dnevni-red" : "prozivka";

  const base = await getLiveMeetingState(actor, meetingId);

  const activeAgendaItemId = tab === "dnevni-red" ? (sp.t ?? base.agendaItems[0]?.id ?? null) : null;
  const activeItem = base.agendaItems.find((a) => a.id === activeAgendaItemId) ?? null;
  // An agenda item's linked proposal: prefer one that's still the live version (not
  // withdrawn/replaced) — an agenda item can carry old versions too (§3.4).
  const activeProposal =
    activeItem?.proposals.find((p) => p.status !== "WITHDRAWN" && p.status !== "SUPERSEDED") ?? activeItem?.proposals[0] ?? null;

  let preview = null;
  let liveState = base;
  if (tab === "dnevni-red" && activeProposal) {
    if (activeProposal.status === "DRAFT") {
      preview = await previewLiveDelivery(actor, activeProposal.id);
    } else if (activeProposal.status === "VOTING_OPEN") {
      liveState = await getLiveMeetingState(actor, meetingId, { proposalId: activeProposal.id });
    }
  }

  return (
    <LiveShell title={base.title} backHref={`/skupstina/${meetingId}`}>
      <Tabs
        tabs={[
          { key: "prozivka", label: t("live.tabRollCall") },
          { key: "dnevni-red", label: t("live.tabAgenda") },
        ]}
        active={tab}
        hrefFor={(key) => `/uzivo/${meetingId}?tab=${key}`}
      />
      <LiveRefresh />
      <Flash err={sp.err} />

      {tab === "prozivka" ? (
        <RollCall
          meetingId={meetingId}
          voters={base.voters}
          presentCount={base.presentCount}
          absentCount={base.absentCount}
          action={markAttendanceAction}
        />
      ) : (
        <>
          {PRE_VOTING_STATUSES.includes(base.status) && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[13px] text-slate-600">{t("live.advanceMeetingBanner")}</p>
              <form action={advanceMeetingAction}>
                <input type="hidden" name="meetingId" value={meetingId} />
                {activeAgendaItemId && <input type="hidden" name="agendaItemId" value={activeAgendaItemId} />}
                <SubmitBtn variant="secondary">{t("live.advanceMeetingTrigger")}</SubmitBtn>
              </form>
            </div>
          )}
          <AgendaTabs meetingId={meetingId} items={base.agendaItems} activeId={activeAgendaItemId} />
          {activeItem ? (
            <AgendaItemPanel
              meetingId={meetingId}
              item={activeItem}
              proposal={activeProposal}
              preview={preview}
              activeResult={liveState.activeResult}
              activeVoters={liveState.activeVoters}
              openVotingAction={openVotingAction}
              closeVotingAction={closeVotingAction}
              manualVoteAction={manualVoteAction}
            />
          ) : (
            <p className="py-8 text-center text-[15px] text-slate-500">
              <BtnLink href={`/skupstina/${meetingId}`} variant="secondary">
                {t("live.backToMeeting")}
              </BtnLink>
            </p>
          )}
        </>
      )}
    </LiveShell>
  );
}
