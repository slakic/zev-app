import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { getInvoice, cancelInvoice, correctInvoice, invoicePaidAmount } from "@/server/services/billing";
import { generateInvoicePdf } from "@/server/services/documents";
import {
  dispatchInvoiceEmails,
  getInvoiceEmailStatus,
  retryInvoiceEmails,
  sendInvoiceEmailNow,
} from "@/server/services/invoiceEmail";
import { partyDisplayName } from "@/server/services/ownership";
import { formatMoney, dec, parseMoneyInput } from "@/lib/money";
import { formatDate, formatDateTime, tEnum, t, tf } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, ConfirmAction, RowLink, Flash, type ColumnSpec } from "@/components/ui";

// Slanje e-pošte može potrajati (PDF + Mailjet), pa isti budžet kao na stranici serije.
export const maxDuration = 60;

const invoiceLineHeaders: ColumnSpec[] = [
  { label: "Stavka" },
  { label: "Formula" },
  { label: "Ulazi" },
  { label: "Iznos", align: "right" },
];

const invoiceAllocationHeaders: ColumnSpec[] = [
  { label: "Datum evidencije" },
  { label: "Uplata" },
  { label: "Iznos", align: "right" },
  { label: "Napomena" },
];

async function pdfAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  const id = String(formData.get("invoiceId"));
  const doc = await generateInvoicePdf(actor, id);
  redirect(`/api/dokumenti/${doc.id}`);
}

async function cancelAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const id = String(formData.get("invoiceId"));
  try {
    await cancelInvoice(actor, id, String(formData.get("reason") ?? ""));
    // Kratko obavještenje dužniku koji je izabrao dostavu računa (bez priloga).
    await dispatchInvoiceEmails(actor, { invoiceIds: [id] });
  } catch (e) {
    redirect(`/fakture/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/fakture/${id}`);
}

async function correctAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const id = String(formData.get("invoiceId"));
  try {
    const corrective = await correctInvoice(actor, id, {
      newTotal: parseMoneyInput(formData.get("newTotal") as string | null) ?? "",
      description: String(formData.get("description")),
      reason: String(formData.get("reason")),
    });
    await dispatchInvoiceEmails(actor, { invoiceIds: [corrective.id] });
    redirect(`/fakture/${corrective.id}?msg=${encodeURIComponent("Korektivna faktura kreirana; original ostaje vidljiv.")}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(`/fakture/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
}

async function retryInvoiceEmailAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const id = String(formData.get("invoiceId"));
  let msg: string;
  try {
    const r = await retryInvoiceEmails(actor, { invoiceIds: [id] });
    msg = emailResultMessage(r);
  } catch (e) {
    redirect(`/fakture/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/fakture/${id}`);
  redirect(`/fakture/${id}?msg=${encodeURIComponent(msg)}`);
}

async function sendInvoiceEmailNowAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const id = String(formData.get("invoiceId"));
  let msg: string;
  try {
    const r = await sendInvoiceEmailNow(actor, id);
    msg = emailResultMessage(r);
  } catch (e) {
    redirect(`/fakture/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/fakture/${id}`);
  redirect(`/fakture/${id}?msg=${encodeURIComponent(msg)}`);
}

function emailResultMessage(r: { sent: number; failed: number; pending: number; dailyLimitReached: boolean }): string {
  if (r.dailyLimitReached) return "Dnevni limit slanja e-pošte je dostignut. Poruka čeka i može se poslati sutra.";
  if (r.sent > 0) return "Faktura je poslata e-poštom.";
  if (r.failed > 0) return "Slanje nije uspjelo. Razlog je naveden u redu „Dostava e-poštom”.";
  return "Nema poruke za slanje.";
}

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const { id } = await params;
  const { err, msg } = await searchParams;
  const actor = await requireActor();
  const inv = await getInvoice(actor, id);
  const management = isManagement(actor);
  const paid = invoicePaidAmount(inv);
  const open = dec(inv.total.toString()).minus(paid);
  const emailStatus = await getInvoiceEmailStatus(actor, id);
  const isAccountant = actor.roles.includes("ACCOUNTANT");
  // Payments that still hold money on this invoice (net of storno rows) — the ones to reverse first.
  const livePayments = new Map<string, { label: string; net: ReturnType<typeof dec> }>();
  for (const a of inv.allocations) {
    const cur = livePayments.get(a.paymentId) ?? { label: `Uplata ${formatDate(a.payment.date)} · ${formatMoney(a.payment.amount.toString())}`, net: dec(0) };
    cur.net = cur.net.plus(dec(a.amount.toString()));
    livePayments.set(a.paymentId, cur);
  }
  const holdingPayments = [...livePayments.entries()].filter(([, v]) => !v.net.isZero());
  const debtorName = partyDisplayName(inv.debtor);
  const emailsDebtor = inv.debtor.invoiceEmailDelivery && Boolean(inv.debtor.email?.trim());

  return (
    <div>
      <PageHeader
        title={`Faktura ${inv.number}`}
        backHref="/fakture?tab=fakture"
        backLabel={t("nav.invoices")}
        subtitle={`${inv.unit.building.name} / ${inv.unit.label} · ${partyDisplayName(inv.debtor)}`}
        actions={
          <form action={pdfAction}>
            <input type="hidden" name="invoiceId" value={inv.id} />
            <SubmitBtn variant="secondary">Preuzmi PDF</SubmitBtn>
          </form>
        }
      />
      <Flash err={err} msg={msg} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={inv.status} label={tEnum("invoiceStatus", inv.status)} />
        {inv.status === "ISSUED" && inv.dueDate < new Date() && <StatusBadge status="UNPAID" label={tEnum("invoiceStatus", "OVERDUE")} />}
        {inv.correctionOf && <span className="text-sm text-slate-500">Korekcija fakture {inv.correctionOf.number}</span>}
        {inv.correctedBy && <span className="text-sm text-slate-500">Korigovana fakturom {inv.correctedBy.number}</span>}
        {inv.cancelReason && <span className="text-sm text-red-600">Storno: {inv.cancelReason}</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Iznosi">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>Ukupno:</dt><dd className="tabular-nums font-semibold">{formatMoney(inv.total.toString())}</dd></div>
            <div className="flex justify-between"><dt>Plaćeno:</dt><dd className="tabular-nums">{formatMoney(paid.toFixed(2))}</dd></div>
            <div className="flex justify-between"><dt>Otvoreno:</dt><dd className="tabular-nums font-semibold">{formatMoney(open.toFixed(2))}</dd></div>
            <div className="flex justify-between"><dt>Izdata:</dt><dd>{formatDate(inv.issueDate)}</dd></div>
            <div className="flex justify-between"><dt>Dospijeće:</dt><dd>{formatDate(inv.dueDate)}</dd></div>
            <div className="flex justify-between"><dt>Poziv na broj:</dt><dd className="font-mono text-xs">{inv.paymentReference ?? "—"}</dd></div>
            <div className="flex justify-between gap-3">
              <dt>Dostava e-poštom:</dt>
              <dd className="text-right">
                {!emailStatus && "—"}
                {emailStatus && ["SENT", "DELIVERED", "SEEN"].includes(emailStatus.status) &&
                  `Poslato ${formatDateTime(emailStatus.sentAt)} na ${emailStatus.toAddress}`}
                {emailStatus?.status === "QUEUED" && "Čeka slanje"}
                {emailStatus?.status === "FAILED" && (
                  <>
                    Neuspješno
                    {emailStatus.lastError && <span className="block text-[13px] text-slate-500">{emailStatus.lastError}</span>}
                  </>
                )}
              </dd>
            </div>
          </dl>
          {isAccountant && emailStatus && (emailStatus.status === "FAILED" || emailStatus.status === "QUEUED") && (
            <form action={retryInvoiceEmailAction} className="mt-3">
              <input type="hidden" name="invoiceId" value={inv.id} />
              <SubmitBtn variant="secondary">Pošalji ponovo</SubmitBtn>
            </form>
          )}
          {isAccountant && !emailStatus && inv.status === "ISSUED" && inv.debtor.invoiceEmailDelivery && (
            <form action={sendInvoiceEmailNowAction} className="mt-3">
              <input type="hidden" name="invoiceId" value={inv.id} />
              <SubmitBtn variant="secondary">Pošalji e-poštom</SubmitBtn>
            </form>
          )}
        </Card>
        <div className="lg:col-span-2">
          <Card title="Stavke sa obračunom">
            <Table
              id="invoice-lines-table"
              caption="Stavke sa obračunom"
              headers={invoiceLineHeaders}
              empty={inv.lines.length === 0}
              emptyTitle={t("empty.invoiceLines.title")}
            >
              {inv.lines.map((l) => {
                const snap = l.calcSnapshot as { formula?: string; inputs?: Record<string, unknown> } | null;
                return (
                  <tr key={l.id}>
                    <Td>{l.description}</Td>
                    <Td className="text-xs">{snap?.formula ?? ""}</Td>
                    <Td className="text-xs">{snap?.inputs ? Object.entries(snap.inputs).map(([k, v]) => `${k}=${v}`).join(", ") : ""}</Td>
                    <Td>{formatMoney(l.amount.toString(), "")}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Card title="Uplate po ovoj fakturi">
          <Table
            id="invoice-allocations-table"
            caption="Uplate po ovoj fakturi"
            headers={invoiceAllocationHeaders}
            empty={inv.allocations.length === 0}
            emptyTitle={t("empty.invoiceAllocations.title")}
          >
            {inv.allocations.map((a) => (
              <tr key={a.id} className={Number(a.amount) < 0 ? "text-red-700" : ""}>
                <Td>{formatDateTime(a.createdAt)}</Td>
                <Td>{a.payment.payerNameRaw ?? a.payment.reference ?? a.paymentId.slice(-8)}</Td>
                <Td>{formatMoney(a.amount.toString())}</Td>
                <Td>{a.reason ?? (Number(a.amount) < 0 ? "storno alokacije" : "—")}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      {management && actor.roles.includes("ACCOUNTANT") && inv.status === "ISSUED" && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Korekcija fakture (original ostaje vidljiv)">
            <form action={correctAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="invoiceId" value={inv.id} />
              <Field label="Novi ukupan iznos (KM)"><input name="newTotal" required className={inputCls} /></Field>
              <Field label="Opis korekcije"><input name="description" required className={inputCls} /></Field>
              <div className="sm:col-span-2">
                <Field label="Razlog"><input name="reason" required className={inputCls} /></Field>
              </div>
              <div className="sm:col-span-2"><SubmitBtn variant="tonal">Kreiraj korektivnu fakturu</SubmitBtn></div>
            </form>
          </Card>
          <Card title="Storniranje">
            {!paid.isZero() ? (
              <div className="space-y-2">
                <p className="text-[13px] text-slate-600">
                  {tf("confirm.invoiceCancel.hasPayments", { iznos: formatMoney(paid.toFixed(2)) })}
                </p>
                <ul className="space-y-1 text-sm">
                  {holdingPayments.map(([paymentId, v]) => (
                    <li key={paymentId}>
                      <RowLink href={`/fakture/uplate/${paymentId}`}>{v.label}</RowLink>
                      <span className="ml-2 tabular-nums text-slate-600">{formatMoney(v.net.toFixed(2))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <p className="mb-2 text-[13px] text-slate-500">{t("confirm.invoiceCancel.hint")}</p>
                <ConfirmAction
                  trigger="Storniraj"
                  title={t("confirm.invoiceCancel.title")}
                  body={
                    <div className="space-y-1 text-sm text-amber-900">
                      <p>
                        {tf("confirm.invoiceCancel.body", { broj: inv.number, dluznik: debtorName, iznos: formatMoney(inv.total.toString()) })}
                      </p>
                      {emailsDebtor && <p>{tf("confirm.invoiceCancel.emailNotice", { dluznik: debtorName })}</p>}
                    </div>
                  }
                  confirmLabel={t("confirm.invoiceCancel.confirm")}
                  confirmVariant="danger"
                  action={cancelAction}
                  hiddenFields={{ invoiceId: inv.id }}
                >
                  <Field label="Razlog storniranja"><input name="reason" required className={inputCls} /></Field>
                </ConfirmAction>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
