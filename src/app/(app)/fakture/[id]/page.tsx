import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { getInvoice, cancelInvoice, correctInvoice, invoicePaidAmount } from "@/server/services/billing";
import { generateInvoicePdf } from "@/server/services/documents";
import { partyDisplayName } from "@/server/services/ownership";
import { formatMoney, dec, parseMoneyInput } from "@/lib/money";
import { formatDate, formatDateTime, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";

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
    redirect(`/fakture/${corrective.id}?msg=${encodeURIComponent("Korektivna faktura kreirana; original ostaje vidljiv.")}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(`/fakture/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
}

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const { id } = await params;
  const { err, msg } = await searchParams;
  const actor = await requireActor();
  const inv = await getInvoice(actor, id);
  const management = isManagement(actor);
  const paid = invoicePaidAmount(inv);
  const open = dec(inv.total.toString()).minus(paid);

  return (
    <div>
      <PageHeader
        title={`Faktura ${inv.number}`}
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
          </dl>
        </Card>
        <div className="lg:col-span-2">
          <Card title="Stavke sa obračunom">
            <Table headers={["Stavka", "Formula", "Ulazi", "Iznos"]} empty={inv.lines.length === 0}>
              {inv.lines.map((l) => {
                const snap = l.calcSnapshot as { formula?: string; inputs?: Record<string, unknown> } | null;
                return (
                  <tr key={l.id}>
                    <Td>{l.description}</Td>
                    <Td className="text-xs">{snap?.formula ?? ""}</Td>
                    <Td className="text-xs">{snap?.inputs ? Object.entries(snap.inputs).map(([k, v]) => `${k}=${v}`).join(", ") : ""}</Td>
                    <Td right>{formatMoney(l.amount.toString(), "")}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Card title="Uplate po ovoj fakturi">
          <Table headers={["Datum evidencije", "Uplata", "Iznos", "Napomena"]} empty={inv.allocations.length === 0}>
            {inv.allocations.map((a) => (
              <tr key={a.id} className={Number(a.amount) < 0 ? "text-red-700" : ""}>
                <Td>{formatDateTime(a.createdAt)}</Td>
                <Td>{a.payment.payerNameRaw ?? a.payment.reference ?? a.paymentId.slice(-8)}</Td>
                <Td right>{formatMoney(a.amount.toString())}</Td>
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
              <div className="sm:col-span-2"><SubmitBtn variant="danger">Kreiraj korektivnu fakturu</SubmitBtn></div>
            </form>
          </Card>
          <Card title="Storniranje">
            <p className="mb-2 text-xs text-slate-500">Moguće samo dok nema raspoređenih uplata. Faktura ostaje u evidenciji sa statusom „stornirana”.</p>
            <form action={cancelAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="invoiceId" value={inv.id} />
              <Field label="Razlog storniranja"><input name="reason" required className={inputCls} /></Field>
              <SubmitBtn variant="danger">Storniraj</SubmitBtn>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
