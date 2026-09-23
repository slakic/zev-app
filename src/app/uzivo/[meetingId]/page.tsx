import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import {
  getLiveMeetingState, recordAttendance, recordAttendanceBulk, openVoting, closeVoting,
  recordManualVote, recordManualVoteBulk, previewLiveDelivery, advanceMeetingStatus,
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
          bulkAbsentAction={bulkAbsentAction}
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
              bulkApproveAction={bulkApproveAction}
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
