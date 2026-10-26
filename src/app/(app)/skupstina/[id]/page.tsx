import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor, isManagement } from "@/server/actor";
import { getMeeting, addAgendaItem, createProposal, advanceMeetingStatus, listVotingRules, queueMeetingInvitations, linkProposalToAgendaItem, getMeetingBallotSummary, dispatchMeetingEmails, reissueBallot, revokeBallot, getMeetingNextStepInput, getLiveMeetingState } from "@/server/services/meetings";
import { generateMeetingInvitationPdf, generateMinutesPdf, listMeetingDocuments } from "@/server/services/documents";
import { partyDisplayName } from "@/server/services/ownership";
import { listBuildings } from "@/server/services/property";
import { parseMoneyInput } from "@/lib/money";
import { formatDateTime, parseZonedDateTime, tEnum, t, tf } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, BtnLink, Flash, ToggleBtn, RowLink, RowAction, RowActionLink, ConfirmAction, type ColumnSpec } from "@/components/ui";
import { MinutesOverview } from "@/components/minutes-overview";
import { getMinutesContent, listMinutesTakerCandidates } from "@/server/services/meetingNotes";
import { setMinutesTakerAction } from "@/app/meeting-notes-actions";
import { MeetingNextStepPanel, MeetingTimeline } from "@/components/meeting-next-step-panel";
import { meetingNextStep } from "@/lib/meetingNextStep";
import type { DispatchResult } from "@/server/notifications/dailyBudget";
import type { MeetingStatus } from "@/generated/prisma/client";

// Plans/live-meeting-mode-plan.md §2.4: not before the session is at least scheduled, and
// no longer once results review has started — the live screen has nothing to do there.
const LIVE_MEETING_STATUSES: MeetingStatus[] = [
  "SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT", "VOTING_OPEN", "VOTING_CLOSED",
];

const proposalsHeaders: ColumnSpec[] = [
  { label: "Šifra", priority: "primary" },
  { label: "Naziv", priority: "primary" },
  { label: t("meetingPage.cols.deadline"), priority: "secondary" },
  { label: t("meetingPage.cols.voted"), priority: "secondary" },
  { label: "Status", priority: "primary" },
  { label: "Verzija", align: "right", priority: "detail" },
];

const ballotHeaders: ColumnSpec[] = [
  { label: t("ballot.card.cols.recipient"), priority: "primary" },
  { label: t("ballot.card.cols.email"), priority: "detail" },
  { label: t("ballot.card.cols.mail") },
  { label: t("ballot.card.cols.ballot") },
  { label: t("ballot.card.cols.voted") },
  { label: t("ballot.card.cols.actions"), actions: true },
];

/** F8.6: dokumenti sjednice (poziv, zapisnik, odluke) sa statusom objave vlasnicima. */
const meetingDocumentHeaders = (): ColumnSpec[] => [
  { label: t("docsPage.meeting.title"), priority: "primary" },
  { label: t("docsPage.meeting.type") },
  { label: t("docsPage.meeting.status") },
  { label: t("docsPage.meeting.published") },
  { label: t("docsPage.meeting.actions"), actions: true },
];

/** "Poslato 3, u redu 2, neuspješno 0." (+ the daily-limit note) — what the president needs after a send. */
function dispatchSummary(r: Pick<DispatchResult, "sent" | "pending" | "failed" | "dailyLimitReached">): string {
  const base = tf("ballot.card.dispatchResult", { sent: r.sent, pending: r.pending, failed: r.failed });
  return r.dailyLimitReached ? `${base} ${t("ballot.card.dispatchLimit")}` : base;
}

const attendanceHeaders: ColumnSpec[] = [
  { label: "Lice" },
  { label: "Prisutan" },
  { label: "Putem punomoćnika" },
];

/** Ties an unlinked proposal (draft or open for voting) to an agenda item of this meeting (K4). */
async function linkProposalAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  try {
    await linkProposalToAgendaItem(actor, String(formData.get("proposalId")), String(formData.get("agendaItemId")));
  } catch (e) {
    redirect(`/skupstina/${meetingId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/${meetingId}`);
}

async function addAgendaAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  await addAgendaItem(actor, { meetingId, title: String(formData.get("title")) });
  revalidatePath(`/skupstina/${meetingId}`);
}

async function addProposalAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  // The agenda item is a required choice: a concrete item, or "none" for a deliberately
  // unattached proposal (createProposal itself still allows null).
  const agendaChoice = String(formData.get("agendaItemId") ?? "");
  if (!agendaChoice) {
    redirect(`/skupstina/${meetingId}?err=${encodeURIComponent(t("confirm.proposalAgenda.required"))}`);
  }
  try {
    await createProposal(actor, {
      meetingId,
      agendaItemId: agendaChoice === "none" ? null : agendaChoice,
      code: String(formData.get("code")),
      title: String(formData.get("title")),
      text: String(formData.get("text")),
      rationale: (formData.get("rationale") as string) || null,
      financialImpact: parseMoneyInput(formData.get("financialImpact") as string | null),
      scopeType: (formData.get("scopeType") as never) ?? "ZEV",
      buildingId: (formData.get("buildingId") as string) || null,
      votingRuleId: String(formData.get("votingRuleId")),
      votingClosesAt: parseZonedDateTime(formData.get("votingClosesAt") as string | null),
    });
  } catch (e) {
    redirect(`/skupstina/${meetingId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/${meetingId}`);
}

async function statusAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  const to = String(formData.get("to")) as MeetingStatus;
  let note: string | null = null;
  try {
    // v2.43.2: opening the session's voting also opens e-voting on its draft proposals (symmetric with closing).
    // v2.44.0: that produces one ballot (one e-mail) per recipient; they are sent right after, within the daily limit.
    await advanceMeetingStatus(actor, meetingId, to, (formData.get("reason") as string) || undefined, { openDraftProposals: to === "VOTING_OPEN" });
    if (to === "VOTING_OPEN") {
      const d = await dispatchMeetingEmails(actor, meetingId);
      if (d.attempted > 0 || d.pending > 0) note = dispatchSummary(d);
    }
    if (to === "INVITATIONS_PREPARED") {
      await generateMeetingInvitationPdf(actor, meetingId);
    }
    if (to === "INVITATIONS_SENT") {
      // Recipients come from the service (F1.5), the same list the confirmation panel counted.
      const q = await queueMeetingInvitations(actor, meetingId);
      if (q.pending > 0 || q.failed > 0) note = dispatchSummary(q);
    }
    if (to === "MINUTES_FINALIZED") {
      await generateMinutesPdf(actor, meetingId, { finalize: true });
    }
  } catch (e) {
    redirect(`/skupstina/${meetingId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  if (note) redirect(`/skupstina/${meetingId}?msg=${encodeURIComponent(note)}`);
  revalidatePath(`/skupstina/${meetingId}`);
}

/** "Pošalji neposlate": returns failed messages to the queue and sends what the daily limit allows. */
async function dispatchEmailsAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  let note: string;
  try {
    note = dispatchSummary(await dispatchMeetingEmails(actor, meetingId, { retryFailed: true }));
  } catch (e) {
    redirect(`/skupstina/${meetingId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/skupstina/${meetingId}?msg=${encodeURIComponent(note)}`);
}

async function ballotAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  const ballotId = String(formData.get("ballotId"));
  const reason = String(formData.get("reason") ?? "");
  let note: string;
  try {
    if (formData.get("op") === "revoke") {
      await revokeBallot(actor, ballotId, reason);
      note = t("ballot.card.revoked");
    } else {
      const r = await reissueBallot(actor, ballotId, reason);
      note = t(!r.emailed ? "ballot.card.reissuedNoMail" : r.sent ? "ballot.card.reissuedSent" : "ballot.card.reissuedQueued");
    }
  } catch (e) {
    redirect(`/skupstina/${meetingId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}#listici`);
  }
  redirect(`/skupstina/${meetingId}?msg=${encodeURIComponent(note)}#listici`);
}

async function draftMinutesAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  await generateMinutesPdf(actor, meetingId, { finalize: false });
  redirect(`/dokumenti`);
}

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; msg?: string; tacka?: string }> }) {
  const { id } = await params;
  const { err, msg, tacka } = await searchParams;
  const actor = await requireActor();
  const isPresident = actor.roles.includes("PRESIDENT");
  const canRunLive = isManagement(actor);
  const meeting = await getMeeting(actor, id);
  const [rules, buildings] = isPresident
    ? await Promise.all([listVotingRules(actor), listBuildings(actor)])
    : [[], []];
  const ballotSummary = isPresident ? await getMeetingBallotSummary(actor, id) : null;
  const meetingDocs = isPresident ? await listMeetingDocuments(actor, id) : [];
  // P-L2: the ballot is a locked set of proposals — once voting is open (or ballots exist) a new item goes to a new session.
  const proposalsLocked =
    (ballotSummary?.total ?? 0) > 0; // P-L2: only once ballots were issued (live mode without ballots may still add)
  // Bilješke i zaključci (v2.54.0): uprava vidi i ispravlja ih do finalizacije zapisnika.
  const minutes = canRunLive ? await getMinutesContent(actor, id) : null;
  const takerCandidates = minutes?.state === "writable" ? await listMinutesTakerCandidates(actor) : [];
  // F6.1/F6.2: the next step, its consequence and its preconditions — one model (src/lib/meetingNextStep.ts) for the
  // panel below and for the president's home. Only the president acts, so only he loads it.
  const nextStepData = isPresident ? await getMeetingNextStepInput(actor, id) : null;
  const step = nextStepData ? meetingNextStep(nextStepData.input) : null;
  // The roll call is recorded in live mode only (P-Q3): this card just summarises it.
  const liveAvailable = canRunLive && LIVE_MEETING_STATUSES.includes(meeting.status);
  const roll = isPresident ? await getLiveMeetingState(actor, id) : null;
  // Proposals without an agenda item that can still be tied to one (linkProposalToAgendaItem).
  const unlinkedProposals = meeting.proposals.filter((p) => !p.agendaItemId && (p.status === "DRAFT" || p.status === "VOTING_OPEN"));
  const preselectedAgendaItem = meeting.agendaItems.some((a) => a.id === tacka) ? tacka : undefined;
  const proposalsToAutoClose = step?.to === "VOTING_CLOSED" ? meeting.proposals.filter((p) => p.status === "VOTING_OPEN") : [];
  return (
    <div>
      <PageHeader
        title={meeting.title}
        backHref={`/skupstina?tab=${meeting.body === "BOARD" ? "BOARD" : "ASSEMBLY"}`}
        backLabel={meeting.body === "BOARD" ? t("nav.back.board") : t("nav.assembly")}
        subtitle={`${meeting.body === "BOARD" ? "Upravni odbor" : "Skupština"} · ${tEnum("meetingType", meeting.type)} · ${formatDateTime(meeting.scheduledAt)} · ${meeting.location ?? ""}`}
        actions={
          liveAvailable ? (
            <BtnLink href={`/uzivo/${meeting.id}`} variant="secondary">
              {t("live.entryButton")}
            </BtnLink>
          ) : undefined
        }
      />
      <Flash err={err} msg={msg} />
      {nextStepData ? (
        <MeetingNextStepPanel
          meeting={meeting}
          step={step}
          input={nextStepData.input}
          statusAction={statusAction}
          sessionOpen={nextStepData.sessionOpenPreview}
          proposalsToAutoClose={proposalsToAutoClose}
        />
      ) : (
        <MeetingTimeline status={meeting.status} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div id="dnevni-red" className="scroll-mt-20">
        <Card title="Dnevni red">
          <ol className="list-inside list-decimal space-y-1 text-sm">
            {meeting.agendaItems.map((a) => (
              <li key={a.id}>
                {a.title}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-[13px] text-slate-600">
                  {a.proposals.length > 0 ? (
                    <>
                      <span>{t("confirm.agenda.proposal")}</span>
                      {a.proposals.map((p) => (
                        <RowLink key={p.id} href={`/skupstina/prijedlog/${p.id}`}>{p.code}</RowLink>
                      ))}
                    </>
                  ) : (
                    <>
                      <span>{t("confirm.agenda.discussion")}</span>
                      {isPresident && !["MINUTES_FINALIZED", "ARCHIVED"].includes(meeting.status) && (
                        <>
                          {unlinkedProposals.map((p) => (
                            <form key={p.id} action={linkProposalAction}>
                              <input type="hidden" name="meetingId" value={meeting.id} />
                              <input type="hidden" name="agendaItemId" value={a.id} />
                              <input type="hidden" name="proposalId" value={p.id} />
                              <RowAction variant="tonal">{tf("confirm.liveLink.link", { kod: p.code })}</RowAction>
                            </form>
                          ))}
                          {!proposalsLocked && (
                            <RowActionLink href={`/skupstina/${meeting.id}?tacka=${a.id}#novi-prijedlog`} variant="secondary">
                              {t("confirm.agenda.addProposal")}
                            </RowActionLink>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
            {meeting.agendaItems.length === 0 && <p className="text-sm text-slate-500">Dnevni red je prazan.</p>}
          </ol>
          {isPresident && !["MINUTES_FINALIZED", "ARCHIVED"].includes(meeting.status) && (
            <details className="group mt-3" open={meeting.agendaItems.length === 0}>
              <ToggleBtn>{t("meetingPage.addAgendaItem")}</ToggleBtn>
              <form action={addAgendaAction} className="mt-3 flex gap-2">
                <input type="hidden" name="meetingId" value={meeting.id} />
                <input name="title" required placeholder="Nova tačka dnevnog reda" aria-label={t("meetingPage.addAgendaItem")} className={inputCls} />
                <SubmitBtn variant="tonal">Dodaj</SubmitBtn>
              </form>
            </details>
          )}
        </Card>
        </div>

        <Card title="Prijedlozi">
          <Table
            id="proposals-table"
            caption="Prijedlozi"
            headers={proposalsHeaders}
            empty={meeting.proposals.length === 0}
            emptyTitle={t("empty.proposals.title")}
            emptyHint={isPresident ? t("empty.proposals.hint") : undefined}
          >
            {meeting.proposals.map((p) => (
              <tr key={p.id}>
                <Td><RowLink href={`/skupstina/prijedlog/${p.id}`}>{p.code}</RowLink></Td>
                <Td>{p.title}</Td>
                <Td>{p.votingClosesAt ? formatDateTime(p.votingClosesAt) : "—"}</Td>
                <Td>
                  {["VOTING_OPEN", "VOTING_CLOSED", "ACCEPTED", "REJECTED"].includes(p.status)
                    ? tf("meetingPage.votedOf", { glasalo: p.votedCount, ukupno: p.votersCount })
                    : "—"}
                </Td>
                <Td><StatusBadge status={p.status} label={tEnum("proposalStatus", p.status)} /></Td>
                <Td>v{p.version}</Td>
              </tr>
            ))}
          </Table>
          {isPresident && proposalsLocked && (
            <p className="mt-4 text-[15px] text-slate-600">{t("ballot.err.proposalLocked")}</p>
          )}
          {isPresident && !proposalsLocked && (
            <details id="novi-prijedlog" open={Boolean(preselectedAgendaItem)} className="group mt-4">
              <ToggleBtn>Novi prijedlog</ToggleBtn>
              <form action={addProposalAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="hidden" name="meetingId" value={meeting.id} />
                <Field label="Šifra"><input name="code" required className={inputCls} placeholder="P-2026-01" /></Field>
                <Field label="Naslov"><input name="title" required className={inputCls} /></Field>
                <div className="sm:col-span-2">
                  <Field label="Tačan tekst prijedloga"><textarea name="text" required rows={3} className={inputCls} /></Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Obrazloženje"><textarea name="rationale" rows={2} className={inputCls} /></Field>
                </div>
                <Field label="Procjena finansijskog uticaja (KM)"><input name="financialImpact" className={inputCls} placeholder="0.00" /></Field>
                <Field label="Tačka dnevnog reda">
                  <select name="agendaItemId" required defaultValue={preselectedAgendaItem ?? ""} className={inputCls}>
                    <option value="">{t("confirm.proposalAgenda.choose")}</option>
                    {meeting.agendaItems.map((a) => <option key={a.id} value={a.id}>{a.order}. {a.title}</option>)}
                    <option value="none">{t("confirm.proposalAgenda.none")}</option>
                  </select>
                </Field>
                <Field label="Obuhvat">
                  <select name="scopeType" className={inputCls}>
                    <option value="ZEV">Cijela ZEV</option>
                    <option value="BUILDING">Jedna zgrada</option>
                  </select>
                </Field>
                <Field label="Zgrada (ako je obuhvat zgrada)">
                  <select name="buildingId" className={inputCls}>
                    <option value="">—</option>
                    {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
                <Field label="Pravilo glasanja">
                  <select name="votingRuleId" required className={inputCls}>
                    {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
                <Field label="Glasanje otvoreno do"><input name="votingClosesAt" type="datetime-local" className={inputCls} /></Field>
                <div className="sm:col-span-2"><SubmitBtn variant="tonal">Sačuvaj prijedlog</SubmitBtn></div>
              </form>
            </details>
          )}
        </Card>

        {minutes && (
          <div id="biljeske" className="scroll-mt-20 lg:col-span-2">
            <Card title={t("meetingNotes.title")}>
              {minutes.state === "locked" && <p className="mb-4 text-[15px] text-slate-700">{t("meetingNotes.locked")}</p>}
              {minutes.state === "early" && <p className="mb-4 text-[15px] text-slate-700">{t("meetingNotes.early")}</p>}
              {minutes.state === "writable" ? (
                <form action={setMinutesTakerAction} className="mb-4 flex flex-wrap items-end gap-3 border-b border-slate-100 pb-4">
                  <input type="hidden" name="meetingId" value={meeting.id} />
                  <input type="hidden" name="returnTo" value={`/skupstina/${meeting.id}#biljeske`} />
                  <div className="min-w-[14rem] flex-1">
                    <Field label={t("meetingNotes.minutesTaker.label")} hint={t("meetingNotes.minutesTaker.hint")}>
                      <select name="partyId" defaultValue={minutes.meeting.minutesTaker?.id ?? ""} className={inputCls}>
                        <option value="">{t("meetingNotes.minutesTaker.none")}</option>
                        {takerCandidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <SubmitBtn variant="tonal">{t("meetingNotes.minutesTaker.save")}</SubmitBtn>
                </form>
              ) : (
                <p className="mb-4 text-[15px] text-slate-700">
                  {t("meetingNotes.minutesTaker.label")}: {minutes.meeting.minutesTaker?.name ?? t("meetingNotes.minutesTaker.none")}
                </p>
              )}
              <MinutesOverview content={minutes} editable={minutes.state === "writable"} returnTo={`/skupstina/${meeting.id}#biljeske`} />
            </Card>
          </div>
        )}

        {isPresident && ballotSummary && (ballotSummary.total > 0 || ballotSummary.invitationsQueued > 0) && (
          <div id="listici" className="scroll-mt-20 lg:col-span-2">
            <Card title={t("ballot.card.title")} hint={t("ballot.card.hint")}>
              <p className="text-[15px] text-slate-700">
                {t("ballot.card.total")}: <b>{ballotSummary.total}</b> · {t("ballot.card.sent")}: <b>{ballotSummary.sent}</b> ·{" "}
                {t("ballot.card.queued")}: <b>{ballotSummary.queued}</b> · {t("ballot.card.failed")}: <b>{ballotSummary.failed}</b> ·{" "}
                {t("ballot.card.used")}: <b>{ballotSummary.used}</b>
              </p>
              {ballotSummary.invitationsQueued > 0 && (
                <p className="mt-1 text-[15px] text-slate-700">{tf("ballot.card.invitationsQueued", { broj: ballotSummary.invitationsQueued })}</p>
              )}
              {(ballotSummary.queued > 0 || ballotSummary.failed > 0 || ballotSummary.invitationsQueued > 0) && (
                <form action={dispatchEmailsAction} className="mt-3">
                  <input type="hidden" name="meetingId" value={meeting.id} />
                  <SubmitBtn variant="secondary">{t("ballot.card.dispatch")}</SubmitBtn>
                </form>
              )}
              <div className="mt-3">
                <Table
                  id="ballots-table"
                  caption={t("ballot.card.title")}
                  headers={ballotHeaders}
                  empty={ballotSummary.rows.length === 0}
                  emptyTitle={t("ballot.card.none")}
                >
                  {ballotSummary.rows.map((r) => (
                    <tr key={r.ballotId}>
                      <Td>{r.recipientName}</Td>
                      <Td>{r.toAddress ?? "—"}</Td>
                      <Td>
                        {r.messageStatus ? (
                          <>
                            <StatusBadge status={r.messageStatus} label={t(`ballot.card.msgStatus.${r.messageStatus}`)} />
                            {r.messageStatus === "FAILED" && r.lastError && (
                              <span className="mt-1 block max-w-[28ch] text-[13px] text-red-700">{r.lastError}</span>
                            )}
                          </>
                        ) : (
                          t("ballot.card.noMessage")
                        )}
                      </Td>
                      <Td><StatusBadge status={r.status} label={tEnum("tokenStatus", r.status)} /></Td>
                      <Td>{tf("ballot.card.voted", { glasano: r.proposalsVoted, ukupno: r.proposalsTotal })}</Td>
                      <Td>
                        {(r.status === "ACTIVE" || r.status === "REVOKED") && (
                          <div className="flex flex-wrap gap-1.5">
                            <div className="min-w-0 max-w-full">
                              <ConfirmAction
                                trigger={t("ballot.card.reissueTrigger")}
                                triggerVariant="caution"
                                title={t("ballot.card.reissueTitle")}
                                body={<p className="text-sm text-amber-950">{tf("ballot.card.reissueBody", { ime: r.recipientName })}</p>}
                                confirmLabel={t("ballot.card.reissueConfirm")}
                                confirmVariant="caution"
                                action={ballotAction}
                                hiddenFields={{ meetingId: meeting.id, ballotId: r.ballotId, op: "reissue" }}
                              >
                                <Field label={t("ballot.card.reasonLabel")}><input name="reason" required className={inputCls} /></Field>
                              </ConfirmAction>
                            </div>
                            {r.status === "ACTIVE" && (
                              <div className="min-w-0 max-w-full">
                                <ConfirmAction
                                  trigger={t("ballot.card.revokeTrigger")}
                                  triggerVariant="caution"
                                  title={t("ballot.card.revokeTitle")}
                                  body={<p className="text-sm text-amber-950">{tf("ballot.card.revokeBody", { ime: r.recipientName })}</p>}
                                  confirmLabel={t("ballot.card.revokeConfirm")}
                                  confirmVariant="caution"
                                  action={ballotAction}
                                  hiddenFields={{ meetingId: meeting.id, ballotId: r.ballotId, op: "revoke" }}
                                >
                                  <Field label={t("ballot.card.reasonLabel")}><input name="reason" required className={inputCls} /></Field>
                                </ConfirmAction>
                              </div>
                            )}
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            </Card>
          </div>
        )}

        {isPresident && (
          <Card title={t("meetingPage.attendance.title")}>
            {roll && (
              <p className="text-sm text-slate-700">
                {tf("meetingPage.attendance.summary", { prisutno: roll.presentCount, ukupno: roll.totalCount })}
              </p>
            )}
            <div className="mt-3">
              {liveAvailable ? (
                <BtnLink href={`/uzivo/${meeting.id}`} variant="secondary">{t("meetingPage.attendance.open")}</BtnLink>
              ) : (
                <p className="text-[13px] text-slate-600">{t("meetingPage.attendance.unavailable")}</p>
              )}
            </div>
            {meeting.attendances.length > 0 && (
              <div className="mt-3">
                <Table id="attendance-table" caption="Prisustvo" headers={attendanceHeaders} empty={false}>
                  {meeting.attendances.map((a) => (
                    <tr key={a.id}>
                      <Td>{partyDisplayName(a.party)}</Td>
                      <Td>{a.present ? "Da" : "Ne"}</Td>
                      <Td>{a.viaProxyId ? "Da" : "—"}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </Card>
        )}

        {isPresident && (
          <div id="dokumenti" className="scroll-mt-20">
          <Card title="Dokumenti sjednice">
            <form action={draftMinutesAction}>
              <input type="hidden" name="meetingId" value={meeting.id} />
              <SubmitBtn variant="secondary">Generiši nacrt zapisnika (PDF)</SubmitBtn>
            </form>
            <p className="mt-2 text-[13px] text-slate-600">{t("meetingPage.documentsNote")}</p>
            <div className="mt-4">
              <Table
                id="meeting-documents-table"
                caption={t("meetingPage.documentsTitle")}
                headers={meetingDocumentHeaders()}
                empty={meetingDocs.length === 0}
                emptyTitle={t("docsPage.meeting.empty")}
              >
                {meetingDocs.map((d) => (
                  <tr key={d.id}>
                    <Td>{d.title}</Td>
                    <Td>{tEnum("docType", d.type)}</Td>
                    <Td><StatusBadge status={d.status} label={tEnum("docStatus", d.status)} /></Td>
                    <Td>{d.publishedToOwners ? t("docsPage.meeting.publishedYes") : t("docsPage.meeting.publishedNo")}</Td>
                    <Td><RowActionLink href={`/api/dokumenti/${d.id}`}>PDF</RowActionLink></Td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>
          </div>
        )}
      </div>
    </div>
  );
}
