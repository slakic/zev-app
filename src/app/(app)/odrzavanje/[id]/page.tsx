import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { getIssue, transitionIssue, markEmergency, addOffer, selectOffer, createWorkOrder, completeWorkOrder, addIssueComment, ratifyEmergency } from "@/server/services/maintenance";
import { generateWorkOrderPdf } from "@/server/services/documents";
import { listSuppliers } from "@/server/services/expenses";
import { partyDisplayName } from "@/server/services/ownership";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDate, formatDateTime, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";
import type { IssueStatus } from "@/generated/prisma/client";

async function transitionAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("issueId"));
  try {
    await transitionIssue(actor, id, String(formData.get("to")) as IssueStatus, {
      note: (formData.get("note") as string) || undefined,
      responsibleId: (formData.get("responsibleId") as string) || undefined,
      estimatedCost: parseMoneyInput(formData.get("estimatedCost") as string | null) ?? undefined,
      actualCost: parseMoneyInput(formData.get("actualCost") as string | null) ?? undefined,
      approvalProposalId: (formData.get("approvalProposalId") as string) || undefined,
    });
  } catch (e) {
    redirect(`/odrzavanje/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/odrzavanje/${id}`);
}

async function emergencyAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("issueId"));
  try {
    await markEmergency(actor, id, {
      reason: String(formData.get("reason") ?? ""),
      authorizedBy: String(formData.get("authorizedBy") ?? ""),
      authority: String(formData.get("authority") ?? ""),
      estimatedCost: parseMoneyInput(formData.get("estimatedCost") as string | null) ?? undefined,
    });
  } catch (e) {
    redirect(`/odrzavanje/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/odrzavanje/${id}`);
}

async function ratifyAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("issueId"));
  await ratifyEmergency(actor, id, String(formData.get("ref")));
  revalidatePath(`/odrzavanje/${id}`);
}

async function offerAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("issueId"));
  try {
    await addOffer(actor, {
      issueId: id,
      supplierId: String(formData.get("supplierId")),
      amount: parseMoneyInput(formData.get("amount") as string | null) ?? "",
      description: (formData.get("description") as string) || null,
    });
  } catch (e) {
    redirect(`/odrzavanje/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/odrzavanje/${id}`);
}

async function selectOfferAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("issueId"));
  await selectOffer(actor, String(formData.get("offerId")));
  revalidatePath(`/odrzavanje/${id}`);
}

async function workOrderAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("issueId"));
  try {
    const wo = await createWorkOrder(actor, {
      issueId: id,
      supplierId: String(formData.get("supplierId")),
      description: String(formData.get("description")),
      scheduledFrom: formData.get("scheduledFrom") ? new Date(String(formData.get("scheduledFrom"))) : null,
      scheduledTo: formData.get("scheduledTo") ? new Date(String(formData.get("scheduledTo"))) : null,
    });
    await generateWorkOrderPdf(actor, wo.id);
  } catch (e) {
    redirect(`/odrzavanje/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/odrzavanje/${id}`);
}

async function completeWoAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("issueId"));
  await completeWorkOrder(actor, String(formData.get("workOrderId")), String(formData.get("note") || "Radovi završeni"));
  revalidatePath(`/odrzavanje/${id}`);
}

async function commentAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  const id = String(formData.get("issueId"));
  await addIssueComment(actor, id, String(formData.get("text")));
  revalidatePath(`/odrzavanje/${id}`);
}

const NEXT: Partial<Record<IssueStatus, { to: IssueStatus; label: string }[]>> = {
  REPORTED: [{ to: "TRIAGED", label: "Trijaža obavljena" }, { to: "REJECTED", label: "Odbij prijavu" }],
  TRIAGED: [{ to: "AUTHORIZATION_REQUIRED", label: "Traži odobrenje" }, { to: "APPROVED", label: "Odobri (u okviru ovlašćenja)" }],
  AUTHORIZATION_REQUIRED: [{ to: "APPROVED", label: "Odobreno (odluka/ovlašćenje)" }],
  APPROVED: [{ to: "OFFERS_REQUESTED", label: "Zatraži ponude" }],
  OFFERS_REQUESTED: [],
  CONTRACTOR_SELECTED: [],
  SCHEDULED: [{ to: "IN_PROGRESS", label: "Radovi počeli" }],
  IN_PROGRESS: [],
  COMPLETED: [{ to: "VERIFIED", label: "Provjereno / primopredaja" }],
  VERIFIED: [{ to: "INVOICED", label: "Faktura primljena" }],
  INVOICED: [{ to: "PAID", label: "Plaćeno" }],
  PAID: [{ to: "CLOSED", label: "Zatvori" }],
};

export default async function IssuePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const { err } = await searchParams;
  const actor = await requireActor();
  const management = isManagement(actor);
  const isPresident = actor.roles.includes("PRESIDENT");
  const issue = await getIssue(actor, id);
  const suppliers = management ? await listSuppliers(actor) : [];
  const nextSteps = NEXT[issue.status] ?? [];

  return (
    <div>
      <PageHeader
        title={issue.title}
        subtitle={`Prijavio: ${partyDisplayName(issue.reporter)} · ${formatDate(issue.createdAt)} · ${issue.unit ? `${issue.unit.building.name} / ${issue.unit.label}` : issue.locationNote ?? ""}`}
      />
      <Flash err={err} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={issue.status} label={tEnum("issueStatus", issue.status)} />
        <span className="text-sm text-slate-500">Hitnost: {tEnum("urgency", issue.urgency)}</span>
        {issue.safetyImpact && <StatusBadge status="UNPAID" label="Bezbjednosni rizik" />}
        {issue.isEmergency && <StatusBadge status="REVOKED" label="Hitna intervencija" />}
        {issue.estimatedCost && <span className="text-sm">Procjena: {formatMoney(issue.estimatedCost.toString())}</span>}
        {issue.actualCost && <span className="text-sm">Stvarni trošak: {formatMoney(issue.actualCost.toString())}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Opis">
          <p className="whitespace-pre-wrap text-sm">{issue.description}</p>
          {issue.isEmergency && (
            <div className="mt-3 rounded-md bg-red-50 p-3 text-sm">
              <p><b>Razlog hitnosti:</b> {issue.emergencyReason}</p>
              <p><b>Odobrio:</b> {issue.emergencyAuthorizedBy} ({issue.emergencyAuthority})</p>
              <p><b>Naknadna ratifikacija:</b> {issue.emergencyRatifiedRef ?? "još nije evidentirana"}</p>
              {isPresident && !issue.emergencyRatifiedRef && (
                <form action={ratifyAction} className="mt-2 flex items-end gap-2">
                  <input type="hidden" name="issueId" value={issue.id} />
                  <Field label="Broj odluke / zapisnika o ratifikaciji"><input name="ref" required className={inputCls} /></Field>
                  <SubmitBtn variant="secondary">Evidentiraj</SubmitBtn>
                </form>
              )}
            </div>
          )}
        </Card>

        <Card title="Tok statusa">
          <ol className="space-y-1 text-sm">
            {issue.statusEvents.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span>{tEnum("issueStatus", e.to)}{e.note ? ` — ${e.note}` : ""}</span>
                <span className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ol>
          {isPresident && nextSteps.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {nextSteps.map((s) => (
                <form key={s.to} action={transitionAction}>
                  <input type="hidden" name="issueId" value={issue.id} />
                  <input type="hidden" name="to" value={s.to} />
                  {s.to === "INVOICED" && <input type="hidden" name="actualCost" value={issue.offers.find((o) => o.selected)?.amount.toString() ?? ""} />}
                  <SubmitBtn variant={s.to === "REJECTED" ? "danger" : "secondary"}>{s.label}</SubmitBtn>
                </form>
              ))}
            </div>
          )}
          {isPresident && !issue.isEmergency && ["REPORTED", "TRIAGED", "AUTHORIZATION_REQUIRED"].includes(issue.status) && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-red-700">Hitna intervencija (preskače odobrenje)</summary>
              <form action={emergencyAction} className="mt-2 grid grid-cols-2 gap-2">
                <input type="hidden" name="issueId" value={issue.id} />
                <Field label="Razlog"><input name="reason" required className={inputCls} /></Field>
                <Field label="Odobrio (ime)"><input name="authorizedBy" required className={inputCls} /></Field>
                <Field label="Osnov ovlašćenja"><input name="authority" required className={inputCls} placeholder="čl. ugovora/odluke..." /></Field>
                <Field label="Procjena troška (KM)"><input name="estimatedCost" className={inputCls} /></Field>
                <div className="col-span-2"><SubmitBtn variant="danger">Označi kao hitno i odobri</SubmitBtn></div>
              </form>
            </details>
          )}
        </Card>

        {management && (
          <Card title="Ponude izvođača">
            <Table headers={["Izvođač", "Iznos", "Opis", "Izabrana", ""]} empty={issue.offers.length === 0}>
              {issue.offers.map((o) => (
                <tr key={o.id}>
                  <Td>{o.supplier.name}</Td>
                  <Td right>{formatMoney(o.amount.toString())}</Td>
                  <Td>{o.description ?? "—"}</Td>
                  <Td>{o.selected ? "DA" : "—"}</Td>
                  <Td>
                    {isPresident && !o.selected && ["OFFERS_REQUESTED", "APPROVED"].includes(issue.status) && (
                      <form action={selectOfferAction}>
                        <input type="hidden" name="issueId" value={issue.id} />
                        <input type="hidden" name="offerId" value={o.id} />
                        <button className="text-sm text-blue-700 hover:underline">izaberi</button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {isPresident && (
              <form action={offerAction} className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <input type="hidden" name="issueId" value={issue.id} />
                <Field label="Izvođač">
                  <select name="supplierId" className={inputCls}>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Iznos (KM)"><input name="amount" required className={inputCls} /></Field>
                <Field label="Opis"><input name="description" className={inputCls} /></Field>
                <div className="flex items-end"><SubmitBtn>Dodaj ponudu</SubmitBtn></div>
              </form>
            )}
          </Card>
        )}

        {management && (
          <Card title="Radni nalozi">
            <Table headers={["Broj", "Izvođač", "Termin", "Status", ""]} empty={issue.workOrders.length === 0}>
              {issue.workOrders.map((wo) => (
                <tr key={wo.id}>
                  <Td>{wo.number}</Td>
                  <Td>{wo.supplier.name}</Td>
                  <Td>{formatDate(wo.scheduledFrom)} — {formatDate(wo.scheduledTo)}</Td>
                  <Td>{wo.status === "COMPLETED" ? "Završen" : wo.status === "OPEN" ? "Otvoren" : wo.status}</Td>
                  <Td>
                    {isPresident && wo.status !== "COMPLETED" && (
                      <form action={completeWoAction} className="flex items-center gap-1">
                        <input type="hidden" name="issueId" value={issue.id} />
                        <input type="hidden" name="workOrderId" value={wo.id} />
                        <input name="note" placeholder="dokaz o završetku" className="w-32 rounded border border-slate-300 px-1 py-0.5 text-xs" />
                        <button className="text-xs text-blue-700 hover:underline">završi</button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {isPresident && issue.status === "CONTRACTOR_SELECTED" && (
              <form action={workOrderAction} className="mt-3 grid grid-cols-2 gap-2">
                <input type="hidden" name="issueId" value={issue.id} />
                <Field label="Izvođač">
                  <select name="supplierId" className={inputCls} defaultValue={issue.offers.find((o) => o.selected)?.supplierId}>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Opis radova"><input name="description" required className={inputCls} /></Field>
                <Field label="Od"><input name="scheduledFrom" type="date" className={inputCls} /></Field>
                <Field label="Do"><input name="scheduledTo" type="date" className={inputCls} /></Field>
                <div className="col-span-2"><SubmitBtn>Kreiraj radni nalog (PDF)</SubmitBtn></div>
              </form>
            )}
          </Card>
        )}

        <Card title="Komentari">
          <ul className="space-y-2 text-sm">
            {issue.comments.map((c) => (
              <li key={c.id} className="rounded bg-slate-50 p-2">
                <span className="text-xs text-slate-400">{formatDateTime(c.createdAt)}:</span> {c.text}
              </li>
            ))}
            {issue.comments.length === 0 && <li className="text-slate-400">Nema komentara.</li>}
          </ul>
          <form action={commentAction} className="mt-3 flex gap-2">
            <input type="hidden" name="issueId" value={issue.id} />
            <input name="text" required placeholder="Novi komentar" className={inputCls} />
            <SubmitBtn variant="secondary">Dodaj</SubmitBtn>
          </form>
        </Card>

        {management && issue.expenses.length > 0 && (
          <Card title="Povezani troškovi">
            <Table headers={["Br. fakture", "Iznos", "Status"]} empty={false}>
              {issue.expenses.map((e) => (
                <tr key={e.id}>
                  <Td>{e.invoiceNumber ?? e.id.slice(-8)}</Td>
                  <Td right>{formatMoney(e.amount.toString())}</Td>
                  <Td><StatusBadge status={e.status} label={tEnum("expenseStatus", e.status)} /></Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
