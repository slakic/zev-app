import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor, isManagement } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { getMeeting, addAgendaItem, createProposal, advanceMeetingStatus, listVotingRules, recordAttendance } from "@/server/services/meetings";
import { generateMeetingInvitationPdf, generateMinutesPdf } from "@/server/services/documents";
import { listParties, partyDisplayName, listOfficeHolders } from "@/server/services/ownership";
import { listBuildings } from "@/server/services/property";
import { queueNotification } from "@/server/notifications/service";
import { prisma } from "@/lib/prisma";
import { parseMoneyInput } from "@/lib/money";
import { formatDateTime, tEnum, t } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, StatusTimeline, Field, inputCls, SubmitBtn, BtnLink, Flash, ToggleBtn, RowLink, ConfirmAction, type ColumnSpec } from "@/components/ui";
import type { MeetingStatus } from "@/generated/prisma/client";

const MEETING_STATUS_ORDER: MeetingStatus[] = [
  "DRAFT", "SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT", "VOTING_OPEN",
  "VOTING_CLOSED", "RESULTS_REVIEW", "DECISION_RECORDED", "MINUTES_FINALIZED", "ARCHIVED",
];

// Plans/live-meeting-mode-plan.md §2.4: not before the session is at least scheduled, and
// no longer once results review has started — the live screen has nothing to do there.
const LIVE_MEETING_STATUSES: MeetingStatus[] = [
  "SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT", "VOTING_OPEN", "VOTING_CLOSED",
];

const proposalsHeaders: ColumnSpec[] = [
  { label: "Šifra" },
  { label: "Naziv" },
  { label: "Verzija", align: "right" },
  { label: "Status" },
];

const attendanceHeaders: ColumnSpec[] = [
  { label: "Lice" },
  { label: "Prisutan" },
  { label: "Putem punomoćnika" },
];

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
  try {
    await createProposal(actor, {
      meetingId,
      agendaItemId: (formData.get("agendaItemId") as string) || null,
      code: String(formData.get("code")),
      title: String(formData.get("title")),
      text: String(formData.get("text")),
      rationale: (formData.get("rationale") as string) || null,
      financialImpact: parseMoneyInput(formData.get("financialImpact") as string | null),
      scopeType: (formData.get("scopeType") as never) ?? "ZEV",
      buildingId: (formData.get("buildingId") as string) || null,
      votingRuleId: String(formData.get("votingRuleId")),
      votingClosesAt: formData.get("votingClosesAt") ? new Date(String(formData.get("votingClosesAt"))) : null,
    });
  } catch (e) {
    redirect(`/skupstina/${meetingId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/${meetingId}`);
}

async function statusAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const zevId = requireZev(actor);
  const meetingId = String(formData.get("meetingId"));
  const to = String(formData.get("to")) as MeetingStatus;
  try {
    await advanceMeetingStatus(actor, meetingId, to, (formData.get("reason") as string) || undefined);
    if (to === "INVITATIONS_PREPARED") {
      await generateMeetingInvitationPdf(actor, meetingId);
    }
    if (to === "INVITATIONS_SENT") {
      // Was previously an unscoped lookup/findMany here — a real cross-tenant leak
      // (would have emailed meeting invitations to owners of every ZEV, not just this
      // one). Fixed while touching this call site for the queueNotification zevId change.
      const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId, zevId } });
      let owners;
      if (meeting.body === "BOARD") {
        const holders = await listOfficeHolders(actor);
        const boardParties = holders.boardMembers.map((m) => m.party);
        if (holders.president) boardParties.push(holders.president.party);
        const seen = new Set<string>();
        owners = boardParties.filter((p) => p.email && !seen.has(p.id) && seen.add(p.id));
      } else {
        owners = await prisma.party.findMany({
          where: { zevId, active: true, email: { not: null }, ownershipStakes: { some: { validTo: null } } },
        });
      }
      for (const o of owners) {
        await queueNotification({
          zevId,
          channel: "EMAIL",
          recipientId: o.id,
          toAddress: o.email!,
          template: "meeting-invitation",
          subject: `Poziv na sjednicu: ${meeting.title}`,
          body: `Poštovani ${partyDisplayName(o)},\n\npozivamo Vas na sjednicu "${meeting.title}" (${formatDateTime(meeting.scheduledAt)}, ${meeting.location ?? "—"}).\nMaterijali i detalji dostupni su u aplikaciji nakon prijave.\n`,
          relatedType: "Meeting",
          relatedId: meetingId,
        });
      }
    }
    if (to === "MINUTES_FINALIZED") {
      await generateMinutesPdf(actor, meetingId, { finalize: true });
    }
  } catch (e) {
    redirect(`/skupstina/${meetingId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/${meetingId}`);
}

async function attendanceAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  await recordAttendance(actor, {
    meetingId,
    partyId: String(formData.get("partyId")),
    present: formData.get("present") === "on",
  });
  revalidatePath(`/skupstina/${meetingId}`);
}

async function draftMinutesAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  await generateMinutesPdf(actor, meetingId, { finalize: false });
  redirect(`/dokumenti`);
}

const NEXT_STATUS: Partial<Record<MeetingStatus, { to: MeetingStatus; label: string }>> = {
  DRAFT: { to: "SCHEDULED", label: "Zakaži sjednicu" },
  SCHEDULED: { to: "INVITATIONS_PREPARED", label: "Pripremi pozive (PDF)" },
  INVITATIONS_PREPARED: { to: "INVITATIONS_SENT", label: "Pošalji pozive (e-mail)" },
  INVITATIONS_SENT: { to: "VOTING_OPEN", label: "Označi glasanje otvorenim" },
  VOTING_OPEN: { to: "VOTING_CLOSED", label: "Označi glasanje zatvorenim" },
  VOTING_CLOSED: { to: "RESULTS_REVIEW", label: "Pređi na provjeru rezultata" },
  RESULTS_REVIEW: { to: "DECISION_RECORDED", label: "Odluke evidentirane" },
  DECISION_RECORDED: { to: "MINUTES_FINALIZED", label: "Finalizuj zapisnik (PDF)" },
  MINUTES_FINALIZED: { to: "ARCHIVED", label: "Arhiviraj" },
};

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const { id } = await params;
  const { err, msg } = await searchParams;
  const actor = await requireActor();
  const isPresident = actor.roles.includes("PRESIDENT");
  const canRunLive = isManagement(actor);
  const meeting = await getMeeting(actor, id);
  const [rules, parties, buildings] = isPresident
    ? await Promise.all([listVotingRules(actor), listParties(actor), listBuildings(actor)])
    : [[], [], []];
  const next = NEXT_STATUS[meeting.status];
  // Closing the session now also closes every proposal still VOTING_OPEN (advanceMeetingStatus,
  // §1.1/§2.6 gap fix) — that's a real, irreversible consequence the plain one-tap status button
  // doesn't carry for any other step, so this one transition alone gets a confirmation that names
  // exactly what will be closed, same as openVoting/closeVoting elsewhere in this feature.
  const proposalsToAutoClose = next?.to === "VOTING_CLOSED" ? meeting.proposals.filter((p) => p.status === "VOTING_OPEN") : [];
  return (
    <div>
      <PageHeader
        title={meeting.title}
        subtitle={`${meeting.body === "BOARD" ? "Upravni odbor" : "Skupština"} · ${tEnum("meetingType", meeting.type)} · ${formatDateTime(meeting.scheduledAt)} · ${meeting.location ?? ""}`}
        actions={
          <>
            {canRunLive && LIVE_MEETING_STATUSES.includes(meeting.status) && (
              <BtnLink href={`/uzivo/${meeting.id}`} variant="secondary">
                {t("live.entryButton")}
              </BtnLink>
            )}
            {isPresident && next && (
              next.to === "VOTING_CLOSED" ? (
                <ConfirmAction
                  trigger={next.label}
                  triggerVariant="primary"
                  title="Zatvaranje glasanja na sjednici je nepovratno"
                  body={
                    proposalsToAutoClose.length > 0 ? (
                      <div className="space-y-1 text-sm text-amber-950">
                        <p>Sljedeći prijedlozi su još uvijek u statusu „Glasanje otvoreno” i biće automatski zatvoreni, sa konačnim rezultatom i istekom svih neiskorišćenih linkova za elektronsko izjašnjavanje:</p>
                        <ul className="list-disc pl-5">
                          {proposalsToAutoClose.map((p) => (
                            <li key={p.id}>
                              {p.code} — {p.title}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-sm text-amber-950">Nema otvorenih glasanja koja bi ovim bila zatvorena.</p>
                    )
                  }
                  confirmLabel="Da, zatvori glasanje na sjednici"
                  action={statusAction}
                  hiddenFields={{ meetingId: meeting.id, to: next.to }}
                />
              ) : (
                <form action={statusAction}>
                  <input type="hidden" name="meetingId" value={meeting.id} />
                  <input type="hidden" name="to" value={next.to} />
                  <SubmitBtn>{next.label}</SubmitBtn>
                </form>
              )
            )}
          </>
        }
      />
      <Flash err={err} msg={msg} />
      <StatusTimeline
        steps={MEETING_STATUS_ORDER.map((s) => ({ key: s, label: tEnum("meetingStatus", s) }))}
        activeKey={meeting.status}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Dnevni red">
          <ol className="list-inside list-decimal space-y-1 text-sm">
            {meeting.agendaItems.map((a) => (
              <li key={a.id}>
                {a.title}
                {a.proposals.length > 0 && (
                  <span className="text-xs text-slate-500"> ({a.proposals.map((p) => p.code).join(", ")})</span>
                )}
              </li>
            ))}
            {meeting.agendaItems.length === 0 && <p className="text-sm text-slate-500">Dnevni red je prazan.</p>}
          </ol>
          {isPresident && !["MINUTES_FINALIZED", "ARCHIVED"].includes(meeting.status) && (
            <form action={addAgendaAction} className="mt-3 flex gap-2">
              <input type="hidden" name="meetingId" value={meeting.id} />
              <input name="title" required placeholder="Nova tačka dnevnog reda" className={inputCls} />
              <SubmitBtn>Dodaj</SubmitBtn>
            </form>
          )}
        </Card>

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
                <Td>v{p.version}</Td>
                <Td><StatusBadge status={p.status} label={tEnum("proposalStatus", p.status)} /></Td>
              </tr>
            ))}
          </Table>
          {isPresident && (
            <details className="group mt-4">
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
                  <select name="agendaItemId" className={inputCls}>
                    <option value="">—</option>
                    {meeting.agendaItems.map((a) => <option key={a.id} value={a.id}>{a.order}. {a.title}</option>)}
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
                <div className="sm:col-span-2"><SubmitBtn>Sačuvaj prijedlog</SubmitBtn></div>
              </form>
            </details>
          )}
        </Card>

        {isPresident && (
          <Card title="Prisustvo (za sjednicu uživo)">
            <Table
              id="attendance-table"
              caption="Prisustvo"
              headers={attendanceHeaders}
              empty={meeting.attendances.length === 0}
              emptyTitle={t("empty.attendance.title")}
              emptyHint={t("empty.attendance.hint")}
            >
              {meeting.attendances.map((a) => (
                <tr key={a.id}>
                  <Td>{partyDisplayName(a.party)}</Td>
                  <Td>{a.present ? "Da" : "Ne"}</Td>
                  <Td>{a.viaProxyId ? "Da" : "—"}</Td>
                </tr>
              ))}
            </Table>
            <form action={attendanceAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="meetingId" value={meeting.id} />
              <Field label="Lice">
                <select name="partyId" className={inputCls}>
                  {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" name="present" defaultChecked /> prisutan</label>
              <SubmitBtn>Evidentiraj</SubmitBtn>
            </form>
          </Card>
        )}

        {isPresident && (
          <Card title="Dokumenti sjednice">
            <form action={draftMinutesAction}>
              <input type="hidden" name="meetingId" value={meeting.id} />
              <SubmitBtn variant="secondary">Generiši nacrt zapisnika (PDF)</SubmitBtn>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              Finalni zapisnik nastaje prelaskom u status „Zapisnik finalizovan” i tada postaje nepromjenjiv (nova verzija umjesto izmjene).
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
