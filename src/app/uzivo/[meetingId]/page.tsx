import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import {
  getLiveMeetingState, recordAttendance, recordAttendanceBulk, openVoting, closeVoting,
  recordManualVote, recordManualVoteBulk, previewLiveDelivery, advanceMeetingStatus, linkProposalToAgendaItem,
} from "@/server/services/meetings";
import { LiveShell } from "@/components/live-shell";
import { LiveRefresh } from "@/components/live-refresh";
import { RollCall } from "@/components/roll-call";
import { LiveQuorumBar } from "@/components/live-quorum-bar";
import { AgendaTabs, AgendaItemPanel } from "@/components/agenda-voting";
import { Tabs, Flash, SubmitBtn, BtnLink, Card } from "@/components/ui";
import { NotesBlock, OffAgendaNotes, type NoteView } from "@/components/meeting-notes";
import { MinutesOverview } from "@/components/minutes-overview";
import { getMinutesContent, type MeetingNoteRow } from "@/server/services/meetingNotes";
import { draftMinutesPdfAction } from "@/app/meeting-notes-actions";
import { OFF_AGENDA_ID } from "@/lib/meetingNotes";
import { t, tf } from "@/lib/i18n";
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
  // "present" carries a third sentinel value, "proxy" (Faza 4, §3.2 "punomoćnik, inline"):
  // present via the owner's already-granted proxy, not in person.
  const presentRaw = String(formData.get("present"));
  await recordAttendance(actor, {
    meetingId,
    partyId: String(formData.get("partyId")),
    present: presentRaw !== "false",
    viaProxyId: presentRaw === "proxy" ? String(formData.get("proxyId")) : null,
  });
  revalidatePath(`/uzivo/${meetingId}`);
}

/** "Označi sve neoznačene kao odsutne" (Faza 4, §3.2) — the rest of the roll call after the
 *  unmarked list is empty, by definition. Reuses recordAttendanceBulk from Faza 0 unchanged;
 *  this is just a new caller. */
async function bulkAbsentAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  const partyIds = formData.getAll("partyId").map(String);
  await recordAttendanceBulk(actor, { meetingId, entries: partyIds.map((partyId) => ({ partyId, present: false })) });
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

/** "Svi preostali prisutni: Za" (Faza 4, §3.4 dizanje ruku) — bulk trigger, one Vote row
 *  per person via recordManualVoteBulk -> recordManualVote (§2.5: no new vote-writing code
 *  path). Best-effort: a person who somehow already voted between page load and this submit
 *  (e.g. an electronic vote landing seconds earlier) is skipped, not fatal to the rest. */
async function bulkApproveAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  const agendaItemId = String(formData.get("agendaItemId"));
  const eligibleVoterIds = formData.getAll("eligibleVoterId").map(String);
  const results = await recordManualVoteBulk(actor, { eligibleVoterIds, choice: "APPROVE", channel: "IN_PERSON" });
  revalidatePath(`/uzivo/${meetingId}`);
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    redirect(
      `/uzivo/${meetingId}?tab=dnevni-red&t=${agendaItemId}&err=${encodeURIComponent(
        `${failed} od ${results.length} glasova nije evidentirano (već su se izjasnili u međuvremenu).`
      )}`
    );
  }
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

/** F1.7: ties an unlinked proposal (draft or already open for voting) to the agenda item the
 *  president is looking at, then returns to that item. PRESIDENT-only, like the service. */
async function linkProposalAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  const agendaItemId = String(formData.get("agendaItemId"));
  try {
    await linkProposalToAgendaItem(actor, String(formData.get("proposalId")), agendaItemId);
  } catch (e) {
    errRedirect(meetingId, agendaItemId, e);
  }
  revalidatePath(`/uzivo/${meetingId}`);
  redirect(`/uzivo/${meetingId}?tab=dnevni-red&t=${agendaItemId}`);
}

const noteView = (n: MeetingNoteRow): NoteView => ({ id: n.id, kind: n.kind, text: n.text, version: n.version, position: n.position });

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
  const tab = sp.tab === "dnevni-red" ? "dnevni-red" : sp.tab === "zapisnik" ? "zapisnik" : "prozivka";

  const base = await getLiveMeetingState(actor, meetingId);

  const activeAgendaItemId = tab === "dnevni-red" ? (sp.t ?? base.agendaItems[0]?.id ?? null) : null;
  const offAgenda = activeAgendaItemId === OFF_AGENDA_ID;
  const activeItem = base.agendaItems.find((a) => a.id === activeAgendaItemId) ?? null;
  // Bilješke i zaključci (v2.54.0): isti sadržaj kao zapisnik, učitan samo na tabovima koji ga prikazuju.
  const minutes = tab === "prozivka" ? null : await getMinutesContent(actor, meetingId);
  const canWrite = minutes?.state === "writable";
  const isPresident = actor.roles.includes("PRESIDENT");
  // An agenda item's linked proposal: prefer one that's still the live version (not
  // withdrawn/replaced) — an agenda item can carry old versions too (§3.4).
  const activeProposal =
    activeItem?.proposals.find((p) => p.status !== "WITHDRAWN" && p.status !== "SUPERSEDED") ?? activeItem?.proposals[0] ?? null;

  let preview = null;
  let liveState = base;
  if (tab === "dnevni-red" && activeProposal) {
    if (activeProposal.status === "DRAFT") {
      preview = await previewLiveDelivery(actor, activeProposal.id);
    }
    // The state is re-read with the active proposal: its result/voters when it is open, and always the quorum bar's
    // rule (the active item's proposal, F6.3) — a draft too.
    liveState = await getLiveMeetingState(actor, meetingId, { proposalId: activeProposal.id });
  }

  return (
    <LiveShell title={base.title} backHref={`/skupstina/${meetingId}`}>
      <Tabs
        tabs={[
          { key: "prozivka", label: t("live.tabRollCall") },
          { key: "dnevni-red", label: t("live.tabAgenda") },
          { key: "zapisnik", label: t("live.tabMinutes") },
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
          unmarkedCount={base.unmarkedCount}
          absentCount={base.absentCount}
          quorum={base.quorum}
          action={markAttendanceAction}
          bulkAbsentAction={bulkAbsentAction}
        />
      ) : tab === "zapisnik" && minutes ? (
        <Card title={t("live.tabMinutes")} hint={t("live.minutes.intro")}>
          <div className="mb-4 space-y-3 border-b border-slate-100 pb-4">
            <p className="text-[13px] text-slate-600">
              {minutes.meeting.minutesTaker ? tf("live.minutes.takerLine", { ime: minutes.meeting.minutesTaker.name }) : t("live.minutes.takerNone")}
              {" · "}
              {tf("meetingNotes.countsLine", { zakljucaka: minutes.counts.conclusions, biljeski: minutes.counts.notes })}
            </p>
            {isPresident ? (
              <form action={draftMinutesPdfAction}>
                <input type="hidden" name="meetingId" value={meetingId} />
                <SubmitBtn variant="secondary">{t("live.minutes.draftPdf")}</SubmitBtn>
              </form>
            ) : (
              <p className="text-[13px] text-slate-500">{t("live.minutes.draftPdfHint")}</p>
            )}
          </div>
          <MinutesOverview
            content={minutes}
            editable={false}
            returnTo={`/uzivo/${meetingId}?tab=zapisnik`}
            itemHref={(id) => `/uzivo/${meetingId}?tab=dnevni-red&t=${id}`}
          />
        </Card>
      ) : (
        <>
          <LiveQuorumBar
            presentCount={liveState.presentCount}
            unmarkedCount={liveState.unmarkedCount}
            absentCount={liveState.absentCount}
            quorum={liveState.quorum}
          />
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
          {offAgenda && minutes ? (
            <Card title={`${t("live.offAgenda")} — ${t("meetingNotes.title")}`} hint={t("live.offAgendaNote")}>
              <OffAgendaNotes
                meetingId={meetingId}
                topics={minutes.topics.map((tp) => ({ topic: tp.topic, conclusions: tp.conclusions.map(noteView), notes: tp.notes.map(noteView) }))}
                writable={canWrite}
                returnTo={`/uzivo/${meetingId}?tab=dnevni-red&t=${OFF_AGENDA_ID}`}
              />
              {!canWrite && <p className="mt-3 text-[13px] text-slate-500">{t("live.notesLocked")}</p>}
            </Card>
          ) : activeItem ? (
            <div className="space-y-4">
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
              bulkApproveAction={bulkApproveAction}
              unlinkedProposals={base.unlinkedProposals}
              canLink={actor.roles.includes("PRESIDENT")}
              linkProposalAction={linkProposalAction}
            />
            {minutes && (
              <Card title={t("meetingNotes.title")}>
                <NotesBlock
                  meetingId={meetingId}
                  agendaItemId={activeItem.id}
                  conclusions={(minutes.items.find((i) => i.id === activeItem.id)?.conclusions ?? []).map(noteView)}
                  notes={(minutes.items.find((i) => i.id === activeItem.id)?.notes ?? []).map(noteView)}
                  writable={canWrite}
                  returnTo={`/uzivo/${meetingId}?tab=dnevni-red&t=${activeItem.id}`}
                  scope={activeItem.id}
                />
                {!canWrite && <p className="mt-3 text-[13px] text-slate-500">{t("live.notesLocked")}</p>}
              </Card>
            )}
            </div>
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
