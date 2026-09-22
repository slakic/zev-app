import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import {
  getProposal, openVoting, closeVoting, recordManualVote, correctVote, recordDecision,
  reissueToken, revokeToken, computeProposalResult, createProposalRevision,
  updateDraftProposal, withdrawProposal, deleteDraftProposal, canDeleteDraftProposal,
  listVotingRules, getMeeting,
} from "@/server/services/meetings";
import { generateDecisionPdf, generateVotingListPdf } from "@/server/services/documents";
import { serializeResult } from "@/server/engines/voting";
import { partyDisplayName } from "@/server/services/ownership";
import { listBuildings } from "@/server/services/property";
import { formatWeight, parseMoneyInput } from "@/lib/money";
import { formatDateTime, tEnum, t } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, ConfirmAction, Flash, ToggleBtn, type ColumnSpec } from "@/components/ui";

/** `<input type="datetime-local">` pre-fill for a stored Date — the inverse of how the
 *  proposal-creation form's own `votingClosesAt` already gets parsed on submit
 *  (`new Date(String(formData.get("votingClosesAt")))`, which reads a timezone-less
 *  string as local time). Using the same local getters here keeps editing-without-
 *  touching-the-field a no-op round trip, whatever the server's local timezone is. */
function toDatetimeLocal(d: Date | null | undefined): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const voterHeaders: ColumnSpec[] = [
  { label: "Vlasnik", priority: "primary" },
  { label: "Punomoćnik", priority: "detail" },
  { label: "Težina", align: "right", priority: "detail" },
  { label: "Token status" },
  { label: "Izjašnjenje" },
  { label: "Radnje" },
];

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
    if (op === "reissue") await reissueToken(actor, String(formData.get("tokenId")), String(formData.get("reason") || "Ponovno izdavanje"));
    else await revokeToken(actor, String(formData.get("tokenId")), String(formData.get("reason") || "Opoziv"));
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
  try {
    await updateDraftProposal(actor, id, {
      code: String(formData.get("code")),
      title: String(formData.get("title")),
      text: String(formData.get("text")),
      rationale: (formData.get("rationale") as string) || null,
      financialImpact: parseMoneyInput(formData.get("financialImpact") as string | null),
      agendaItemId: (formData.get("agendaItemId") as string) || null,
      scopeType: (formData.get("scopeType") as never) ?? "ZEV",
      buildingId: (formData.get("buildingId") as string) || null,
      votingRuleId: String(formData.get("votingRuleId")),
      votingClosesAt: formData.get("votingClosesAt") ? new Date(String(formData.get("votingClosesAt"))) : null,
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

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const { id } = await params;
  const { err, msg } = await searchParams;
  const actor = await requireActor();
  const isPresident = actor.roles.includes("PRESIDENT");
  const p = await getProposal(actor, id);

  // Owners see only their own participation, not others' voting evidence.
  if (!isPresident && !actor.roles.includes("ACCOUNTANT")) {
    const mine = p.eligibleVoters.some((ev) => ev.ownerId === actor.partyId || ev.proxyId === actor.partyId);
    return (
      <div>
        <PageHeader title={`${p.code} — ${p.title}`} subtitle={`Verzija ${p.version} · ${p.meeting.title}`} />
        <div className="mb-4"><StatusBadge status={p.status} label={tEnum("proposalStatus", p.status)} /></div>
        <Card title="Tekst prijedloga"><p className="whitespace-pre-wrap text-sm">{p.text}</p></Card>
        {p.rationale && <div className="mt-4"><Card title="Obrazloženje"><p className="whitespace-pre-wrap text-sm">{p.rationale}</p></Card></div>}
        <div className="mt-4">
          <Card title="Vaše učešće">
            <p className="text-sm text-slate-600">
              {mine
                ? "Imate pravo glasa o ovom prijedlogu. Lični link i verifikacioni kod dobili ste e-poštom — glasa se isključivo putem ličnog linka."
                : "Niste u glasačkoj bazi ovog prijedloga."}
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const result = p.ruleSnapshot ? serializeResult(await computeProposalResult(p.zevId, p.id)) : null;
  const rule = p.ruleSnapshot as { ruleName?: string; quorumType?: string; quorumPercent?: string; majorityType?: string; majorityPercent?: string; weightMethod?: string } | null;

  const [votingRules, buildings, meetingWithAgenda] =
    isPresident && p.status === "DRAFT"
      ? await Promise.all([listVotingRules(actor), listBuildings(actor), getMeeting(actor, p.meetingId)])
      : [[], [], null];
  const agendaItems = meetingWithAgenda?.agendaItems ?? [];
  const canDelete = canDeleteDraftProposal(p.meeting.status);

  return (
    <div>
      <PageHeader
        title={`${p.code} — ${p.title}`}
        subtitle={`Verzija ${p.version} · ${p.meeting.title} · glasanje do ${formatDateTime(p.votingClosesAt)}`}
        actions={
          isPresident ? (
            p.status === "DRAFT" ? (
              <form action={openVotingAction}>
                <input type="hidden" name="proposalId" value={p.id} />
                <SubmitBtn>Otvori glasanje i pošalji linkove</SubmitBtn>
              </form>
            ) : p.status === "VOTING_OPEN" ? (
              <ConfirmAction
                trigger="Zatvori glasanje i utvrdi rezultat"
                title="Zatvaranje glasanja je nepovratno"
                body={
                  result ? (
                    <div className="rounded-md bg-white/70 p-2 text-sm text-amber-950">
                      <p><b>Kvorum:</b> {result.quorumReached ? "postignut" : "NIJE postignut"} (učestvovalo {formatWeight(result.weightCast)} od {formatWeight(result.totalEligibleWeight)})</p>
                      <p><b>Za:</b> {formatWeight(result.approveWeight)} · <b>Protiv:</b> {formatWeight(result.rejectWeight)} · <b>Uzdržani:</b> {formatWeight(result.abstainWeight)}</p>
                      <p><b>Ishod ako se sada zatvori:</b> {result.accepted ? "USVOJENO" : "NIJE USVOJENO"}</p>
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
              <div><dt className="inline font-medium">Težina glasa: </dt><dd className="inline">{tEnum("weight", rule.weightMethod)}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              Pravilo: {p.votingRule?.name ?? "—"} (snimak nastaje pri otvaranju glasanja)
            </p>
          )}
          {result && (
            <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
              <p><b>Kvorum:</b> {result.quorumReached ? "postignut" : "NIJE postignut"} (učestvovalo {formatWeight(result.weightCast)} od {formatWeight(result.totalEligibleWeight)})</p>
              <p><b>Za:</b> {formatWeight(result.approveWeight)} · <b>Protiv:</b> {formatWeight(result.rejectWeight)} · <b>Uzdržani:</b> {formatWeight(result.abstainWeight)}</p>
              <p><b>Prag većine:</b> {formatWeight(result.majorityThreshold)} · <b>Ishod:</b> {result.accepted ? "USVOJENO" : "NIJE USVOJENO"}</p>
              <p className="text-xs text-slate-500">Nevažećih: {result.invalidCount} · Glasalo: {result.votesCast}/{result.totalEligibleOwners} vlasnika</p>
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
              headers={voterHeaders}
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
                    <Td>{partyDisplayName(ev.owner)}</Td>
                    <Td>{ev.proxy ? partyDisplayName(ev.proxy) : "—"}</Td>
                    <Td>{formatWeight(ev.weight)}</Td>
                    <Td>{lastToken ? <StatusBadge status={lastToken.status} label={tEnum("tokenStatus", lastToken.status)} /> : "—"}</Td>
                    <Td>{vote ? `${tEnum("vote", vote.choice)} (${tEnum("vote", vote.channel)})` : "—"}</Td>
                    <Td>
                      {isPresident && lastToken && lastToken.status === "ACTIVE" && (
                        <div className="flex flex-wrap gap-1.5">
                          <form action={tokenAction}>
                            <input type="hidden" name="proposalId" value={p.id} />
                            <input type="hidden" name="tokenId" value={lastToken.id} />
                            <input type="hidden" name="op" value="reissue" />
                            <SubmitBtn variant="secondary">ponovo izdaj</SubmitBtn>
                          </form>
                          <form action={tokenAction}>
                            <input type="hidden" name="proposalId" value={p.id} />
                            <input type="hidden" name="tokenId" value={lastToken.id} />
                            <input type="hidden" name="op" value="revoke" />
                            <SubmitBtn variant="secondary">opozovi</SubmitBtn>
                          </form>
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
                  <select name="agendaItemId" defaultValue={p.agendaItemId ?? ""} className={inputCls}>
                    <option value="">—</option>
                    {agendaItems.map((a) => <option key={a.id} value={a.id}>{a.order}. {a.title}</option>)}
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
                  <input name="votingClosesAt" type="datetime-local" defaultValue={toDatetimeLocal(p.votingClosesAt)} className={inputCls} />
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
                    <option key={ev.id} value={ev.id}>{partyDisplayName(ev.owner)}</option>
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
            <p className="mb-2 text-xs text-slate-500">
              Kreira NOVU verziju prijedloga i poništava sve izdate linkove. Postojeći glasovi ostaju evidentirani uz staru verziju.
            </p>
            <form action={reviseAction} className="space-y-3">
              <input type="hidden" name="proposalId" value={p.id} />
              <Field label="Novi tekst prijedloga"><textarea name="text" rows={3} defaultValue={p.text} className={inputCls} /></Field>
              <Field label="Razlog izmjene"><input name="reason" required className={inputCls} /></Field>
              <SubmitBtn variant="caution">Kreiraj novu verziju</SubmitBtn>
            </form>
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
