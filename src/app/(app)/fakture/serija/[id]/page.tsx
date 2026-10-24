import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { issueBatch, type UnitCalculation } from "@/server/services/billing";
import { ensureInvoiceDocument } from "@/server/services/documents";
import {
  countOptedInDebtors,
  dispatchInvoiceEmails,
  getBatchEmailSummary,
  retryInvoiceEmails,
  type InvoiceEmailDispatchResult,
} from "@/server/services/invoiceEmail";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import { formatDateTime, tEnum, t } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, SubmitBtn, Flash, type ColumnSpec } from "@/components/ui";

// Izdavanje generiše PDF svake fakture i šalje do 25 e-mailova; Vercel default bi to presjekao.
export const maxDuration = 60;

const NOTIF_LABEL: Record<string, string> = {
  QUEUED: "U redu čekanja",
  SENT: "Poslato",
  DELIVERED: "Isporučeno",
  SEEN: "Pročitano",
  FAILED: "Neuspješno",
};

const emailHeaders: ColumnSpec[] = [
  { label: "Faktura", priority: "primary" },
  { label: "Dužnik" },
  { label: "Adresa", priority: "detail" },
  { label: "Status" },
];

const calcLineHeaders: ColumnSpec[] = [
  { label: "Stavka", priority: "primary" },
  { label: "Metoda" },
  { label: "Formula", priority: "detail" },
  { label: "Ulazne vrijednosti", priority: "detail" },
  { label: "Osnov raspodjele", priority: "detail" },
  { label: "Prije zaokruž.", align: "right", priority: "detail" },
  { label: "Iznos", align: "right" },
];

function emailSummaryText(r: InvoiceEmailDispatchResult, withSent = true): string {
  const parts = [`${withSent ? "E-poštom poslato" : "Poslato"}: ${r.sent}, čeka slanje: ${r.pending}, neuspješno: ${r.failed}.`];
  if (r.dailyLimitReached) parts.push("Dnevni limit slanja e-pošte je dostignut, ostatak se šalje sutra.");
  else if (r.pending > 0) parts.push("Preostale pošaljite dugmetom „Pošalji neposlate”.");
  return parts.join(" ");
}

async function issueBatchAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const batchId = String(formData.get("batchId"));
  let msg: string;
  try {
    const invoices = await issueBatch(actor, batchId);
    // PDF svake fakture ostaje u Dokumentima; issueBatch je već upisao poruke u outbox za dužnike
    // koji su izabrali dostavu računa, a ovdje se šalje ograničen broj (Plans/invoice-email-delivery-plan.md R3).
    for (const inv of invoices) await ensureInvoiceDocument(actor, inv.id);
    const r = await dispatchInvoiceEmails(actor, { batchId });
    const total = r.sent + r.pending + r.failed;
    msg = `Serija je izdata (${invoices.length} faktura).${total > 0 ? ` ${emailSummaryText(r)}` : ""}`;
  } catch (e) {
    redirect(`/fakture/serija/${batchId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/fakture/serija/${batchId}?msg=${encodeURIComponent(msg)}`);
}

async function retryBatchEmailsAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const batchId = String(formData.get("batchId"));
  let msg: string;
  try {
    msg = emailSummaryText(await retryInvoiceEmails(actor, { batchId }), false);
  } catch (e) {
    redirect(`/fakture/serija/${batchId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/fakture/serija/${batchId}`);
  redirect(`/fakture/serija/${batchId}?msg=${encodeURIComponent(msg)}`);
}

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const { id } = await params;
  const { err, msg } = await searchParams;
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  const zevId = requireZev(actor);
  const batch = await prisma.invoiceBatch.findUniqueOrThrow({ where: { id, zevId }, include: { invoices: true } });
  const preview = (batch.previewData as unknown as UnitCalculation[]) ?? [];
  const grandTotal = preview.reduce((a, c) => a + Number(c.total), 0);
  const isAccountant = actor.roles.includes("ACCOUNTANT");
  // Nacrt: koliko dužnika će dobiti račun e-poštom. Izdata: status dostave po fakturi.
  const debtorIds = [...new Set(preview.map((c) => c.debtorId).filter((d): d is string => Boolean(d)))];
  const draftOptedIn = batch.status === "DRAFT" ? await countOptedInDebtors(actor, debtorIds) : 0;
  const emailSummary = batch.status === "ISSUED" ? await getBatchEmailSummary(actor, id) : null;

  return (
    <div>
      <PageHeader
        title={`Serija faktura — ${batch.period}`}
        subtitle="Pregled obračuna za svaku jedinicu prije izdavanja"
        actions={
          batch.status === "DRAFT" && actor.roles.includes("ACCOUNTANT") ? (
            <form action={issueBatchAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <SubmitBtn>Izdaj {preview.length} faktura ({formatMoney(grandTotal.toFixed(2))})</SubmitBtn>
            </form>
          ) : undefined
        }
      />
      <Flash err={err} msg={msg} />
      <div className="mb-4">
        <StatusBadge status={batch.status} label={batch.status === "DRAFT" ? "Nacrt — fakture još nisu izdate" : batch.status === "ISSUED" ? `Izdata (${batch.invoices.length} faktura)` : "Stornirana"} />
      </div>

      {batch.status === "DRAFT" && (
        <p className="-mt-2 mb-4 text-[13px] text-slate-600">
          Račun e-poštom (PDF) dobiće {draftOptedIn} od {debtorIds.length} dužnika.
        </p>
      )}

      {emailSummary && (emailSummary.optedIn > 0 || emailSummary.rows.length > 0) && (
        <div className="mb-4">
          <Card title="Dostava e-poštom">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt>Faktura za dostavu:</dt><dd className="tabular-nums">{emailSummary.optedIn}</dd></div>
              <div className="flex justify-between"><dt>Poslato:</dt><dd className="tabular-nums">{emailSummary.sent}</dd></div>
              <div className="flex justify-between"><dt>Čeka slanje:</dt><dd className="tabular-nums">{emailSummary.queued}</dd></div>
              <div className="flex justify-between"><dt>Neuspješno:</dt><dd className="tabular-nums">{emailSummary.failed}</dd></div>
            </dl>
            <div className="mt-3">
              <Table
                id="batch-email-table"
                caption="Dostava e-poštom po fakturi"
                headers={emailHeaders}
                empty={emailSummary.rows.length === 0}
                emptyTitle="Nijedna faktura iz ove serije nema poruku za slanje."
              >
                {emailSummary.rows.map((r) => (
                  <tr key={r.invoiceId}>
                    <Td>{r.number}</Td>
                    <Td>{r.debtorName}</Td>
                    <Td>{r.toAddress}</Td>
                    <Td>
                      <StatusBadge status={r.status} label={NOTIF_LABEL[r.status] ?? r.status} />
                      <span className="ml-2 text-[13px] text-slate-500">{formatDateTime(r.sentAt ?? r.createdAt)}</span>
                      {r.lastError && <div className="mt-1 text-[13px] text-red-700">{r.lastError}</div>}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
            {isAccountant && emailSummary.queued + emailSummary.failed > 0 && (
              <form action={retryBatchEmailsAction} className="mt-3">
                <input type="hidden" name="batchId" value={batch.id} />
                <SubmitBtn variant="secondary">Pošalji neposlate ({emailSummary.queued + emailSummary.failed})</SubmitBtn>
              </form>
            )}
          </Card>
        </div>
      )}

      <div className="space-y-4">
        {preview.map((calc) => (
          <Card key={calc.unitId} title={`${calc.buildingName} / ${calc.unitLabel} — ${calc.debtorName} — ukupno ${formatMoney(calc.total)}`}>
            <Table
              id={`calc-lines-${calc.unitId}`}
              caption={`Obračun — ${calc.buildingName} / ${calc.unitLabel}`}
              headers={calcLineHeaders}
              empty={calc.lines.length === 0}
              emptyTitle={t("empty.calcLines.title")}
            >
              {calc.lines.map((l, i) => (
                <tr key={i}>
                  <Td>{l.name}</Td>
                  <Td>{tEnum("chargeMethod", l.method)}</Td>
                  <Td className="text-xs">{l.formula}</Td>
                  <Td className="text-xs">
                    {Object.entries(l.inputs).map(([k, v]) => `${k}=${v}`).join(", ")}
                  </Td>
                  <Td className="text-xs">{l.allocationBasis}</Td>
                  <Td className="text-xs">{l.rawAmount}</Td>
                  <Td>{formatMoney(l.amount, "")}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}
        {preview.length === 0 && <p className="text-sm text-slate-500">Serija nema obračunatih stavki.</p>}
      </div>
    </div>
  );
}
