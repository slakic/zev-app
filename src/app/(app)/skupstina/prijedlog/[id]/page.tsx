import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import {
  getProposal, openVoting, closeVoting, recordManualVote, correctVote, recordDecision,
  reissueToken, revokeToken, computeProposalResult, createProposalRevision,
  updateDraftProposal, withdrawProposal, deleteDraftProposal, canDeleteDraftProposal,
  listVotingRules, getMeeting, previewVotingDelivery,
} from "@/server/services/meetings";
import { generateDecisionPdf, generateVotingListPdf } from "@/server/services/documents";
import { serializeResult } from "@/server/engines/voting";
import { partyDisplayName } from "@/server/services/ownership";
import { listBuildings } from "@/server/services/property";
import { formatWeight, parseMoneyInput } from "@/lib/money";
import { formatDateTime, formatDateTimeLocalInput, parseZonedDateTime, tEnum, t, tf } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, ConfirmAction, Flash, ToggleBtn, BtnLink, RowLink, type ColumnSpec } from "@/components/ui";
import { PreconditionList } from "@/components/precondition-list";

// One row per voting SUBJECT (FR, K-03a). The weight column exists only for pre-FR snapshots and the board.
const voterHeaders = (showWeight: boolean): ColumnSpec[] => [
  { label: t("votingSubject.col.owner"), priority: "primary" },
  { label: t("votingSubject.col.units"), priority: "detail" },
  { label: "Punomoćnik", priority: "detail" },
  ...(showWeight ? [{ label: "Težina", align: "right", priority: "detail" } as ColumnSpec] : []),
  { label: "Token status" },
  { label: "Izjašnjenje" },
  { label: "Radnje" },
];

type EvBasis = { subjectName?: string; units?: { label: string }[]; members?: { partyId: string; name: string }[] } | null;

/** "Nikola Ilić i Sara Ilić (predstavnik: Nikola Ilić)" for a community, the plain name otherwise. */
function subjectLabel(ev: { owner: Parameters<typeof partyDisplayName>[0]; memberPartyIds: string[]; basis: unknown }): string {
  const b = ev.basis as EvBasis;
  return ev.memberPartyIds.length > 1 && b?.subjectName
    ? tf("votingSubject.communityLabel", { name: b.subjectName, rep: partyDisplayName(ev.owner) })
    : partyDisplayName(ev.owner);
}

async function openVotingAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  try {
    await openVoting(actor, id);
  } catch (e) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/skupstina/prijedlog/${id}?msg=${encodeURIComponent("Glasanje je otvoreno. Lični linkovi i kodovi poslati su e-poštom (mock).")}`);
}

async function closeVotingAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  try {
    await closeVoting(actor, id);
  } catch (e) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/prijedlog/${id}`);
}

async function manualVoteAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  try {
    await recordManualVote(actor, {
      eligibleVoterId: String(formData.get("eligibleVoterId")),
      choice: formData.get("choice") as never,
      channel: formData.get("channel") as never,
      note: (formData.get("note") as string) || undefined,
    });
  } catch (e) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/prijedlog/${id}`);
}

async function correctVoteAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  try {
    await correctVote(actor, {
      voteId: String(formData.get("voteId")),
      choice: formData.get("choice") as never,
      reason: String(formData.get("reason") ?? ""),
      authority: String(formData.get("authority") ?? ""),
    });
  } catch (e) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/prijedlog/${id}`);
}

async function decisionAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  try {
    await recordDecision(actor, id, String(formData.get("decisionNumber")));
    await generateDecisionPdf(actor, id);
  } catch (e) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/prijedlog/${id}`);
}

async function votingListAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await generateVotingListPdf(actor, String(formData.get("proposalId")));
  redirect("/dokumenti");
}

async function tokenAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  const op = String(formData.get("op"));
  try {
    if (op === "reissue") await reissueToken(actor, String(formData.get("tokenId")), String(formData.get("reason") ?? ""));
    else await revokeToken(actor, String(formData.get("tokenId")), String(formData.get("reason") ?? ""));
  } catch (e) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/prijedlog/${id}`);
}

async function reviseAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  try {
    const next = await createProposalRevision(actor, id, {
      text: String(formData.get("text")),
    }, String(formData.get("reason") ?? "Izmjena prijedloga"));
    redirect(`/skupstina/prijedlog/${next.id}?msg=${encodeURIComponent("Kreirana nova verzija; stari linkovi su poništeni.")}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
}

async function updateDraftAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  if (!String(formData.get("agendaItemId") ?? "")) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(t("confirm.proposalAgenda.required"))}`);
  }
  try {
    await updateDraftProposal(actor, id, {
      code: String(formData.get("code")),
      title: String(formData.get("title")),
      text: String(formData.get("text")),
      rationale: (formData.get("rationale") as string) || null,
      financialImpact: parseMoneyInput(formData.get("financialImpact") as string | null),
      // Required choice in the form: an item, or "none" for a deliberately unattached proposal.
      agendaItemId: ["", "none"].includes(String(formData.get("agendaItemId") ?? "")) ? null : String(formData.get("agendaItemId")),
      scopeType: (formData.get("scopeType") as never) ?? "ZEV",
      buildingId: (formData.get("buildingId") as string) || null,
      votingRuleId: String(formData.get("votingRuleId")),
      votingClosesAt: parseZonedDateTime(formData.get("votingClosesAt") as string | null),
    });
  } catch (e) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/prijedlog/${id}`);
}

async function withdrawDraftAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  try {
    await withdrawProposal(actor, id, String(formData.get("reason") ?? ""));
  } catch (e) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/skupstina/prijedlog/${id}`);
}

async function deleteDraftAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("proposalId"));
  const meetingId = String(formData.get("meetingId"));
  try {
    await deleteDraftProposal(actor, id, String(formData.get("reason") ?? ""));
  } catch (e) {
    redirect(`/skupstina/prijedlog/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/skupstina/${meetingId}?msg=${encodeURIComponent("Nacrt prijedloga je obrisan.")}`);
}

/** Session title shortened for the "‹ Nazad" label (full title stays in the subtitle). */
function shortTitle(title: string, max = 40): string {
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const { id } = await params;
  const { err, msg } = await searchParams;
  const actor = await requireActor();
  const isPresident = actor.roles.includes("PRESIDENT");
  const p = await getProposal(actor, id);

  // Owners see only their own participation, not others' voting evidence.
  if (!isPresident && !actor.roles.includes("ACCOUNTANT")) {
    const myPartyId = actor.partyId ?? "";
    const mine = p.eligibleVoters.some((ev) => ev.ownerId === myPartyId || ev.proxyId === myPartyId || ev.memberPartyIds.includes(myPartyId));
    // A co-owner who is not the representative holds no link: the community votes through the representative (K-03a).
    const viaRepresentative = p.eligibleVoters.find(
      (ev) => ev.ownerId !== myPartyId && ev.proxyId !== myPartyId && ev.memberPartyIds.includes(myPartyId),
    );
    const ownEv = p.eligibleVoters.find((ev) => ev.ownerId === myPartyId || ev.proxyId === myPartyId);
    return (
      <div>
        <PageHeader
          title={`${p.code} — ${p.title}`}
          subtitle={`Verzija ${p.version} · ${p.meeting.title}`}
          backHref={`/skupstina/${p.meetingId}`}
          backLabel={shortTitle(p.meeting.title)}
        />
        <div className="mb-4"><StatusBadge status={p.status} label={tEnum("proposalStatus", p.status)} /></div>
        <Card title="Tekst prijedloga"><p className="whitespace-pre-wrap text-sm">{p.text}</p></Card>
        {p.rationale && <div className="mt-4"><Card title="Obrazloženje"><p className="whitespace-pre-wrap text-sm">{p.rationale}</p></Card></div>}
        <div className="mt-4">
          <Card title="Vaše učešće">
            <p className="text-sm text-slate-600">
              {ownEv
                ? ownEv.tokens.some((tk) => tk.ballotId)
                  ? `Imate pravo glasa o ovom prijedlogu. ${t("ballot.owner.oneEmail")}`
                  : "Imate pravo glasa o ovom prijedlogu. Lični link i verifikacioni kod dobili ste e-poštom — glasa se isključivo putem ličnog linka."
                : viaRepresentative
                  ? tf(
                      viaRepresentative.votes.some((v) => !v.invalid) ? "votingSubject.owner.viaRepresentativeVoted" : "votingSubject.owner.viaRepresentative",
                      {
                        units: ((viaRepresentative.basis as EvBasis)?.units ?? []).map((u) => u.label).join(", "),
                        name: partyDisplayName(viaRepresentative.owner),
                      },
                    )
                  : mine
                    ? "Imate pravo glasa o ovom prijedlogu."
                    : p.meeting.body === "BOARD"
                      ? t("confirm.participation.board")
                      : p.status === "DRAFT"
                        ? t("confirm.participation.draft")
                        : t("confirm.participation.notInBase")}
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const result = p.ruleSnapshot ? serializeResult(await computeProposalResult(p.zevId, p.id)) : null;
  const rule = p.ruleSnapshot as {
    ruleName?: string; quorumType?: string; quorumPercent?: string; majorityType?: string; majorityPercent?: string;
    weightMethod?: string; basisKind?: string; unitRegisterVersion?: number | null;
  } | null;
  // K-03: on the assembly every voting subject is exactly one vote, so numbers read as whole votes, not "weight".
  const byVotes = rule?.basisKind === "ASSEMBLY_SUBJECTS";
  const baseUnits = new Set(p.eligibleVoters.flatMap((ev) => ((ev.basis as EvBasis)?.units ?? []).map((u) => u.label)));
  const basePersons = new Set(p.eligibleVoters.flatMap((ev) => (ev.memberPartyIds.length > 0 ? ev.memberPartyIds : [ev.ownerId])));
  const quorumNeeded = (r: { quorumRequiredOwners: number | null; quorumRequiredWeight: string | null }) =>
    r.quorumRequiredOwners ?? (r.quorumRequiredWeight ? Math.ceil(Number(r.quorumRequiredWeight) - 1e-9) : null);
  const turnoutText = (r: { votesCast: number; totalEligibleOwners: number; quorumRequiredOwners: number | null; quorumRequiredWeight: string | null }) => {
    const need = quorumNeeded(r);
    return need === null
      ? tf("votingSubject.result.turnout", { cast: r.votesCast, total: r.totalEligibleOwners })
      : tf("votingSubject.result.turnoutQuorum", { cast: r.votesCast, total: r.totalEligibleOwners, need, missing: Math.max(0, need - r.votesCast) });
  };

  const [votingRules, buildings, meetingWithAgenda] =
    isPresident && p.status === "DRAFT"
      ? await Promise.all([listVotingRules(actor), listBuildings(actor), getMeeting(actor, p.meetingId)])
      : [[], [], null];
  const agendaItems = meetingWithAgenda?.agendaItems ?? [];
  const canDelete = canDeleteDraftProposal(p.meeting.status);

  // F1.6: what the confirmation panels must name before an irreversible step.
  const openPreview =
    isPresident && p.status === "DRAFT"
      ? await previewVotingDelivery(actor, p.id, "ALL").catch(() => null)
      : null;
  // FR (K-02, K-01b): reasons the vote cannot be opened yet replace the confirm button with the list below.
  const preconditionErrors = openPreview?.preconditionErrors ?? [];
  const closesAt = p.votingClosesAt ?? p.meeting.eVoteClosesAt;
  const votingOpen = p.status === "VOTING_OPEN";
  const activeLinks = p.eligibleVoters.filter((ev) => ev.tokens.some((tk) => tk.status === "ACTIVE")).length;
  const castVotes = p.eligibleVoters.filter((ev) => ev.votes.some((v) => !v.invalid)).length;
  const quorumText = (r: { quorumReached: boolean }) =>
    votingOpen
      ? t(r.quorumReached ? "confirm.result.quorumSoFarReached" : "confirm.result.quorumSoFarNotReached")
      : t(r.quorumReached ? "confirm.result.quorumReached" : "confirm.result.quorumNotReached");
  const outcomeText = (r: { accepted: boolean }) => t(r.accepted ? "confirm.result.accepted" : "confirm.result.notAccepted");

  return (
    <div>
      <PageHeader
        title={`${p.code} — ${p.title}`}
        backHref={`/skupstina/${p.meetingId}`}
        backLabel={shortTitle(p.meeting.title)}
        subtitle={`Verzija ${p.version} · ${p.meeting.title} · glasanje do ${formatDateTime(p.votingClosesAt)}`}
        actions={
          isPresident ? (
            p.status === "DRAFT" && preconditionErrors.length > 0 ? undefined : p.status === "DRAFT" ? (
              <ConfirmAction
                trigger={t("confirm.openVoting.trigger")}
                triggerVariant="caution"
                title={t("confirm.openVoting.title")}
                body={
                  <div className="space-y-1 text-sm text-amber-950">
                    {openPreview && (
                      <p>
                        {tf("confirm.openVoting.base", {
                          voters: openPreview.voters, byEmail: openPreview.byEmail,
                          viaProxy: openPreview.viaProxy, withoutEmail: openPreview.withoutEmail,
                        })}
                      </p>
                    )}
                    <p>{tf("confirm.openVoting.lock", { verzija: p.version })}</p>
                    <p>
                      {closesAt
                        ? tf("confirm.openVoting.until", { datum: formatDateTime(closesAt) })
                        : t("confirm.openVoting.noDeadline")}
                    </p>
                  </div>
                }
                confirmLabel={t("confirm.openVoting.confirm")}
                confirmVariant="primary"
                action={openVotingAction}
                hiddenFields={{ proposalId: p.id }}
              />
            ) : p.status === "VOTING_OPEN" ? (
              <ConfirmAction
                trigger="Zatvori glasanje i utvrdi rezultat"
                title="Zatvaranje glasanja je nepovratno"
                body={
                  result ? (
                    <div className="rounded-md bg-white/70 p-2 text-sm text-amber-950">
                      <p>{quorumText(result)} ({byVotes ? turnoutText(result) : `učestvovalo ${formatWeight(result.weightCast)} od ${formatWeight(result.totalEligibleWeight)}`})</p>
                      <p><b>Za:</b> {formatWeight(result.approveWeight)} · <b>Protiv:</b> {formatWeight(result.rejectWeight)} · <b>Uzdržani:</b> {formatWeight(result.abstainWeight)}</p>
                      <p>{t("live.resultOutcomeIfClosedNow")}: {outcomeText(result)}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-900">Rezultat još nije dostupan.</p>
                  )
                }
                confirmLabel="Da, zatvori glasanje"
                action={closeVotingAction}
                hiddenFields={{ proposalId: p.id }}
              />
            ) : undefined
          ) : undefined
        }
      />
      <Flash err={err} msg={msg} />
      {preconditionErrors.length > 0 && (
        <div className="mb-4">
          <Card title={t("votingSubject.pre.cardTitle")} hint={t("votingSubject.pre.cardHint")}>
            <PreconditionList items={preconditionErrors.map((text) => ({ ok: false, text }))} />
            <div className="mt-4 flex flex-wrap gap-2">
              <BtnLink href="/zgrade?tab=posebni" variant="secondary">{t("votingSubject.pre.linkRegister")}</BtnLink>
              <BtnLink href="/vlasnici?tab=vlasnistvo" variant="secondary">{t("votingSubject.pre.linkOwnership")}</BtnLink>
            </div>
          </Card>
        </div>
      )}
      <div className="mb-4 flex items-center gap-2">
        <StatusBadge status={p.status} label={tEnum("proposalStatus", p.status)} />
        {p.decisionNumber && <span className="text-sm text-slate-500">Odluka br. {p.decisionNumber}</span>}
        {p.contentHash && <span className="text-xs text-slate-500">hash: {p.contentHash.slice(0, 16)}…</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Tekst prijedloga (zamrznut nakon otvaranja glasanja)">
          <p className="whitespace-pre-wrap text-sm">{p.text}</p>
          {p.rationale && (<><h3 className="mt-3 text-xs font-semibold uppercase text-slate-500">Obrazloženje</h3><p className="whitespace-pre-wrap text-sm">{p.rationale}</p></>)}
          {p.financialImpact && <p className="mt-2 text-sm"><b>Procjena finansijskog uticaja:</b> {p.financialImpact.toString()} KM</p>}
          <p className="mt-2 text-xs text-slate-500">Obuhvat: {tEnum("scope", p.scopeType)}</p>
        </Card>

        <Card title="Pravilo glasanja (snimak)">
          {rule ? (
            <dl className="space-y-1 text-sm">
              <div><dt className="inline font-medium">Pravilo: </dt><dd className="inline">{rule.ruleName}</dd></div>
              <div><dt className="inline font-medium">Kvorum: </dt><dd className="inline">{tEnum("quorum", rule.quorumType)} {rule.quorumPercent ? `(${rule.quorumPercent}%)` : ""}</dd></div>
              <div><dt className="inline font-medium">Većina: </dt><dd className="inline">{tEnum("majority", rule.majorityType)} {rule.majorityPercent ? `(${rule.majorityPercent}%)` : ""}</dd></div>
              {byVotes ? (
                <div>
                  <dt className="inline font-medium">{t("votingSubject.baseLabel")}: </dt>
                  <dd className="inline">
                    {tf("votingSubject.base", {
                      version: rule.unitRegisterVersion ?? "—",
                      votes: p.eligibleVoters.length,
                      persons: basePersons.size,
                      units: baseUnits.size,
                    })}
                  </dd>
                </div>
              ) : (
                <div><dt className="inline font-medium">Težina glasa: </dt><dd className="inline">{tEnum("weight", rule.weightMethod)}</dd></div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              Pravilo: {p.votingRule?.name ?? "—"} (snimak nastaje pri otvaranju glasanja)
            </p>
          )}
          {result && (
            <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
              <p className="mb-1 font-semibold text-slate-700">
                {votingOpen
                  ? tf("confirm.result.openTitle", { datum: closesAt ? formatDateTime(closesAt) : "—" })
                  : t("confirm.result.finalTitle")}
              </p>
              <p>{quorumText(result)} ({byVotes ? turnoutText(result) : `učestvovalo ${formatWeight(result.weightCast)} od ${formatWeight(result.totalEligibleWeight)}`})</p>
              <p><b>Za:</b> {formatWeight(result.approveWeight)} · <b>Protiv:</b> {formatWeight(result.rejectWeight)} · <b>Uzdržani:</b> {formatWeight(result.abstainWeight)}</p>
              <p>
                <b>Prag većine:</b> {formatWeight(result.majorityThreshold)} ·{" "}
                {votingOpen ? `${t("live.resultOutcomeIfClosedNow")}: ` : `${t("confirm.result.outcome")}: `}
                {outcomeText(result)}
              </p>
              <p className="text-[13px] text-slate-500">Nevažećih: {result.invalidCount} · Glasalo: {result.votesCast}/{result.totalEligibleOwners} {byVotes ? t("votingSubject.result.votesUnit") : "vlasnika"}</p>
            </div>
          )}
        </Card>
      </div>

      {isPresident && (
        <div className="mt-4">
          <Card title="Glasačka baza i lični linkovi" hint="Tokeni se čuvaju samo kao hash — sami linkovi se ne mogu ponovo prikazati.">
            <Table
              id="voters-table"
              caption="Glasačka baza i lični linkovi"
              headers={voterHeaders(!byVotes)}
              empty={p.eligibleVoters.length === 0}
              emptyTitle={t("empty.voters.title")}
              emptyHint={t("empty.voters.hint")}
            >
              {p.eligibleVoters.map((ev) => {
                const activeToken = ev.tokens.find((t) => t.status === "ACTIVE");
                const lastToken = activeToken ?? ev.tokens[ev.tokens.length - 1];
                const vote = ev.votes.filter((v) => !v.invalid).at(-1);
                return (
                  <tr key={ev.id}>
                    <Td>{subjectLabel(ev)}</Td>
                    <Td>{((ev.basis as EvBasis)?.units ?? []).map((u) => u.label).join(", ") || "—"}</Td>
                    <Td>{ev.proxy ? partyDisplayName(ev.proxy) : "—"}</Td>
                    {!byVotes && <Td>{formatWeight(ev.weight)}</Td>}
                    <Td>{lastToken ? <StatusBadge status={lastToken.status} label={tEnum("tokenStatus", lastToken.status)} /> : "—"}</Td>
                    <Td>{vote ? `${tEnum("vote", vote.choice)} (${tEnum("vote", vote.channel)})` : "—"}</Td>
                    <Td>
                      {lastToken?.ballotId ? (
                        // v2.44.0: the link belongs to the session ballot — reissue/revoke are done there, not per token.
                        <RowLink href={`/skupstina/${p.meetingId}#listici`}>{t("ballot.proposal.viaBallot")}</RowLink>
                      ) : isPresident && lastToken && lastToken.status === "ACTIVE" && (
                        <div className="flex flex-wrap gap-1.5">
                          <div className="min-w-0 max-w-full">
                          <ConfirmAction
                            trigger="Ponovo izdaj"
                            triggerVariant="caution"
                            title={t("confirm.token.reissueTitle")}
                            body={
                              <p className="text-sm text-amber-950">
                                {tf("confirm.token.reissueBody", {
                                  ime: partyDisplayName(ev.owner),
                                  adresa: (ev.proxy ?? ev.owner).email ?? t("confirm.token.noAddress"),
                                })}
                              </p>
                            }
                            confirmLabel={t("confirm.token.reissueConfirm")}
                            confirmVariant="caution"
                            action={tokenAction}
                            hiddenFields={{ proposalId: p.id, tokenId: lastToken.id, op: "reissue" }}
                          >
                            <Field label="Razlog"><input name="reason" required className={inputCls} /></Field>
                          </ConfirmAction>
                          </div>
                          <div className="min-w-0 max-w-full">
                          <ConfirmAction
                            trigger="Opozovi"
                            triggerVariant="caution"
                            title={t("confirm.token.revokeTitle")}
                            body={<p className="text-sm text-amber-950">{tf("confirm.token.revokeBody", { ime: partyDisplayName(ev.owner) })}</p>}
                            confirmLabel={t("confirm.token.revokeConfirm")}
                            confirmVariant="caution"
                            action={tokenAction}
                            hiddenFields={{ proposalId: p.id, tokenId: lastToken.id, op: "revoke" }}
                          >
                            <Field label="Razlog"><input name="reason" required className={inputCls} /></Field>
                          </ConfirmAction>
                          </div>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
            <div className="mt-3 flex flex-wrap gap-3">
              <form action={votingListAction}>
                <input type="hidden" name="proposalId" value={p.id} />
                <SubmitBtn variant="secondary">Glasačka lista (PDF)</SubmitBtn>
              </form>
            </div>
          </Card>
        </div>
      )}

      {isPresident && p.status === "DRAFT" && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Izmjena nacrta prijedloga" hint="Nacrt se može slobodno mijenjati dok glasanje nije otvoreno.">
            <details className="group">
              <ToggleBtn>Izmijeni nacrt</ToggleBtn>
              <form action={updateDraftAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="hidden" name="proposalId" value={p.id} />
                <Field label="Šifra"><input name="code" required defaultValue={p.code} className={inputCls} /></Field>
                <Field label="Naslov"><input name="title" required defaultValue={p.title} className={inputCls} /></Field>
                <div className="sm:col-span-2">
                  <Field label="Tačan tekst prijedloga"><textarea name="text" required rows={3} defaultValue={p.text} className={inputCls} /></Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Obrazloženje"><textarea name="rationale" rows={2} defaultValue={p.rationale ?? ""} className={inputCls} /></Field>
                </div>
                <Field label="Procjena finansijskog uticaja (KM)">
                  <input name="financialImpact" defaultValue={p.financialImpact?.toString() ?? ""} className={inputCls} placeholder="0.00" />
                </Field>
                <Field label="Tačka dnevnog reda">
                  <select name="agendaItemId" required defaultValue={p.agendaItemId ?? ""} className={inputCls}>
                    <option value="">{t("confirm.proposalAgenda.choose")}</option>
                    {agendaItems.map((a) => <option key={a.id} value={a.id}>{a.order}. {a.title}</option>)}
                    <option value="none">{t("confirm.proposalAgenda.none")}</option>
                  </select>
                </Field>
                <Field label="Obuhvat">
                  <select name="scopeType" defaultValue={p.scopeType} className={inputCls}>
                    <option value="ZEV">Cijela ZEV</option>
                    <option value="BUILDING">Jedna zgrada</option>
                  </select>
                </Field>
                <Field label="Zgrada (ako je obuhvat zgrada)">
                  <select name="buildingId" defaultValue={p.buildingId ?? ""} className={inputCls}>
                    <option value="">—</option>
                    {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
                <Field label="Pravilo glasanja">
                  <select name="votingRuleId" required defaultValue={p.votingRuleId ?? ""} className={inputCls}>
                    {votingRules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
                <Field label="Glasanje otvoreno do">
                  <input name="votingClosesAt" type="datetime-local" defaultValue={formatDateTimeLocalInput(p.votingClosesAt)} className={inputCls} />
                </Field>
                <div className="sm:col-span-2"><SubmitBtn>Sačuvaj izmjene</SubmitBtn></div>
              </form>
            </details>
          </Card>
          <Card title="Uklanjanje nacrta">
            <div className="space-y-3">
              <ConfirmAction
                trigger="Povuci prijedlog"
                triggerVariant="caution"
                title="Povlačenje prijedloga"
                confirmLabel="Da, povuci prijedlog"
                confirmVariant="caution"
                action={withdrawDraftAction}
                hiddenFields={{ proposalId: p.id }}
              >
                <Field label="Razlog povlačenja"><input name="reason" required className={inputCls} /></Field>
              </ConfirmAction>
              {canDelete ? (
                <ConfirmAction
                  trigger="Obriši nacrt (trajno)"
                  triggerVariant="danger"
                  title="Brisanje nacrta je nepovratno"
                  body={
                    <p className="text-sm text-red-950">
                      Prijedlog <b>{p.code}</b> se briše iz evidencije sjednice. Zapis o njegovom nastanku i brisanju
                      ostaje u revizorskom tragu i ne može se ukloniti.
                    </p>
                  }
                  confirmLabel="Da, obriši nacrt"
                  confirmVariant="danger"
                  action={deleteDraftAction}
                  hiddenFields={{ proposalId: p.id, meetingId: p.meetingId }}
                >
                  <Field label="Razlog brisanja"><input name="reason" required className={inputCls} /></Field>
                </ConfirmAction>
              ) : (
                <p className="text-sm text-slate-500">
                  Sjednica je već saopštena vlasnicima (pozivi poslati) — prijedlog se više ne može trajno obrisati,
                  samo povući.
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      {isPresident && p.status === "VOTING_OPEN" && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Unos papirnog / ličnog glasa">
            <form action={manualVoteAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="proposalId" value={p.id} />
              <Field label="Vlasnik">
                <select name="eligibleVoterId" className={inputCls}>
                  {p.eligibleVoters.map((ev) => (
                    <option key={ev.id} value={ev.id}>{subjectLabel(ev)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Izjašnjenje">
                <select name="choice" className={inputCls}>
                  <option value="APPROVE">Za</option>
                  <option value="REJECT">Protiv</option>
                  <option value="ABSTAIN">Uzdržan</option>
                </select>
              </Field>
              <Field label="Kanal">
                <select name="channel" className={inputCls}>
                  <option value="PAPER">Papirni glas</option>
                  <option value="IN_PERSON">Lično na sjednici</option>
                </select>
              </Field>
              <Field label="Napomena"><input name="note" className={inputCls} /></Field>
              <div className="sm:col-span-2"><SubmitBtn>Evidentiraj glas</SubmitBtn></div>
            </form>
          </Card>
          <Card title="Izmjena prijedloga (materijalna promjena)">
            <p className="mb-2 text-[13px] text-slate-500">
              Kreira NOVU verziju prijedloga i poništava sve izdate linkove. Postojeći glasovi ostaju evidentirani uz staru verziju.
            </p>
            <ConfirmAction
              trigger={t("confirm.revision.trigger")}
              triggerVariant="caution"
              title={t("confirm.revision.title")}
              body={
                <p className="text-sm text-amber-950">
                  {tf("confirm.revision.body", { aktivnih: activeLinks, glasova: castVotes, verzija: p.version })}
                </p>
              }
              confirmLabel={t("confirm.revision.confirm")}
              confirmVariant="caution"
              action={reviseAction}
              hiddenFields={{ proposalId: p.id }}
            >
              <Field label="Novi tekst prijedloga"><textarea name="text" rows={3} defaultValue={p.text} className={inputCls} /></Field>
              <Field label="Razlog izmjene"><input name="reason" required className={inputCls} /></Field>
            </ConfirmAction>
          </Card>
        </div>
      )}

      {isPresident && (p.status === "ACCEPTED" || p.status === "REJECTED") && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Evidentiraj odluku">
            <form action={decisionAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="proposalId" value={p.id} />
              <Field label="Broj odluke"><input name="decisionNumber" required className={inputCls} placeholder="OD-2026-01" defaultValue={p.decisionNumber ?? ""} /></Field>
              <SubmitBtn>Evidentiraj i generiši PDF odluke</SubmitBtn>
            </form>
          </Card>
          <Card title="Ispravka glasa" hint="Moguće samo uz razlog i osnov — prethodni glas ostaje u evidenciji, ispravka je novi zapis.">
            <form action={correctVoteAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="proposalId" value={p.id} />
              <Field label="Glas">
                <select name="voteId" className={inputCls}>
                  {p.votes.filter((v) => !v.correctionOfId).map((v) => (
                    <option key={v.id} value={v.id}>
                      {partyDisplayName(v.voter)} — {tEnum("vote", v.choice)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Novo izjašnjenje">
                <select name="choice" className={inputCls}>
                  <option value="APPROVE">Za</option>
                  <option value="REJECT">Protiv</option>
                  <option value="ABSTAIN">Uzdržan</option>
                </select>
              </Field>
              <Field label="Razlog"><input name="reason" required className={inputCls} /></Field>
              <Field label="Osnov / ovlašćenje"><input name="authority" required className={inputCls} /></Field>
              <div className="sm:col-span-2"><SubmitBtn variant="tonal">Evidentiraj ispravku</SubmitBtn></div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
