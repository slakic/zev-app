import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { issueBatch, defaultBatchDueDate, type UnitCalculation } from "@/server/services/billing";
import { ensureInvoiceDocument } from "@/server/services/documents";
import {
  countOptedInDebtors,
  dispatchInvoiceEmails,
  getBatchEmailSummary,
  retryInvoiceEmails,
  type InvoiceEmailDispatchResult,
} from "@/server/services/invoiceEmail";
import { prisma } from "@/lib/prisma";
import { formatMoney, dec, sumDecimals } from "@/lib/money";
import { formatDate, formatDateTime, t, tf, toZonedDateIso } from "@/lib/i18n";
import { describeChargeLine } from "@/lib/chargeLine";
import { batchWarnings, type WarningEntry } from "@/lib/batchWarnings";
import { PageHeader, Card, Stat, Table, Td, StatusBadge, SubmitBtn, ConfirmAction, Flash, type ColumnSpec } from "@/components/ui";

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

const unitHeaders: ColumnSpec[] = [
  { label: t("batchPage.headers.unit"), priority: "primary" },
  { label: t("batchPage.headers.building"), priority: "secondary" },
  { label: t("batchPage.headers.debtor") },
  { label: t("batchPage.headers.amount"), align: "right", nowrap: true },
  { label: t("batchPage.headers.warning") },
  { label: t("batchPage.headers.calc") },
];

const MAX_WARNING_ENTRIES = 10;

/** Jedna grupa upozorenja: naslovna rečenica i (do 10) stavki „Zgrada / jedinica — detalj”. */
function WarningGroup({ text, entries }: { text: string; entries: WarningEntry[] }) {
  const shown = entries.slice(0, MAX_WARNING_ENTRIES);
  return (
    <li>
      {text}
      <ul className="mt-1 list-none space-y-0.5 pl-3 text-[13px]">
        {shown.map((e, i) => (
          <li key={`${e.unitId}:${i}`}>{e.unit}{e.detail ? ` — ${e.detail}` : ""}</li>
        ))}
        {entries.length > shown.length && <li>{tf("batchWarnings.more", { broj: entries.length - shown.length })}</li>}
      </ul>
    </li>
  );
}

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
  const grandTotal = sumDecimals(preview.map((c) => dec(c.total)));
  const dueDate = defaultBatchDueDate(batch.period);
  // Compared as calendar days (Europe/Sarajevo): on the due day itself the term has not passed yet.
  const dueInPast = toZonedDateIso(dueDate) < toZonedDateIso(new Date());
  const isAccountant = actor.roles.includes("ACCOUNTANT");
  // Nacrt: koliko dužnika će dobiti račun e-poštom. Izdata: status dostave po fakturi.
  const debtorIds = [...new Set(preview.map((c) => c.debtorId).filter((d): d is string => Boolean(d)))];
  const draftOptedIn = batch.status === "DRAFT" ? await countOptedInDebtors(actor, debtorIds) : 0;
  const emailSummary = batch.status === "ISSUED" ? await getBatchEmailSummary(actor, id) : null;
  const warnings = batch.status === "DRAFT" ? batchWarnings(preview, dueDate, new Date()) : null;
  const flagged = new Set(warnings?.flaggedUnitIds ?? []);

  return (
    <div>
      <PageHeader
        title={`Serija faktura — ${batch.period}`}
        backHref="/fakture?tab=naknade"
        backLabel={t("nav.back.batches")}
        subtitle="Pregled obračuna za svaku jedinicu prije izdavanja"
        actions={
          // issueBatch rejects a unit without a recipient (the draft's frozen preview): no "Izdaj" that is bound to fail —
          // the warning list below says what to do (record the owner, then make a new draft for this period).
          batch.status === "DRAFT" && actor.roles.includes("ACCOUNTANT") && !(warnings && warnings.noDebtor.length > 0) ? (
            <ConfirmAction
              trigger={t("confirm.batchIssue.trigger")}
              triggerVariant="caution"
              title={t("confirm.batchIssue.title")}
              body={
                <div className="space-y-2 text-sm text-amber-900">
                  <ul className="space-y-0.5">
                    <li>{tf("confirm.batchIssue.count", { broj: preview.length })}</li>
                    <li>{tf("confirm.batchIssue.total", { iznos: formatMoney(grandTotal.toFixed(2)) })}</li>
                    <li>{tf("confirm.batchIssue.due", { datum: formatDate(dueDate) })}</li>
                    <li>{tf("confirm.batchIssue.email", { broj: draftOptedIn })}</li>
                  </ul>
                  {dueInPast && <p className="font-medium">{tf("confirm.batchIssue.duePast", { datum: formatDate(dueDate) })}</p>}
                  <p>{t("confirm.batchIssue.irreversible")}</p>
                </div>
              }
              confirmLabel={tf("confirm.batchIssue.confirm", { broj: preview.length })}
              confirmVariant="primary"
              action={issueBatchAction}
              hiddenFields={{ batchId: batch.id }}
            />
          ) : undefined
        }
      />
      <Flash err={err} msg={msg} />
      <div className="mb-4">
        <StatusBadge status={batch.status} label={batch.status === "DRAFT" ? "Nacrt — fakture još nisu izdate" : batch.status === "ISSUED" ? `Izdata (${batch.invoices.length} faktura)` : "Stornirana"} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("batchPage.statInvoices")} value={String(batch.status === "DRAFT" ? preview.length : batch.invoices.length)} tone="neutral" />
        <Stat label={t("batchPage.statTotal")} value={formatMoney(grandTotal.toFixed(2))} tone="neutral" />
        {batch.status === "DRAFT" ? (
          <Stat label={t("batchPage.statEmailDraft")} value={tf("batchPage.ofDebtors", { broj: draftOptedIn, ukupno: debtorIds.length })} tone="neutral" />
        ) : emailSummary ? (
          <Stat label={t("batchPage.statEmailIssued")} value={tf("batchPage.sentOf", { poslato: emailSummary.sent, ukupno: emailSummary.optedIn })} tone={emailSummary.failed > 0 ? "bad" : "neutral"} />
        ) : null}
        <Stat label={t("batchPage.statDue")} value={formatDate(dueDate)} tone={batch.status === "DRAFT" && dueInPast ? "warn" : "neutral"} />
      </div>

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

      <Card title={t("batchPage.unitsTitle")}>
        {warnings && warnings.count > 0 && (
          <div className="mb-3">
            <Flash
              inset
              warn={
                <div>
                  <p className="font-semibold">{t("batchWarnings.title")}</p>
                  <p className="mt-0.5 text-[13px]">{t("batchWarnings.intro")}</p>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5">
                    {warnings.duePast && <li>{tf("batchWarnings.duePast", { datum: formatDate(dueDate) })}</li>}
                    {warnings.noDebtor.length > 0 && <WarningGroup text={tf("batchWarnings.noDebtor", { broj: warnings.noDebtor.length })} entries={warnings.noDebtor} />}
                    {warnings.zeroLines.length > 0 && <WarningGroup text={tf("batchWarnings.zeroLines", { broj: warnings.zeroLines.length })} entries={warnings.zeroLines} />}
                    {warnings.zeroUnits.length > 0 && <WarningGroup text={tf("batchWarnings.zeroUnits", { broj: warnings.zeroUnits.length })} entries={warnings.zeroUnits} />}
                  </ul>
                </div>
              }
            />
          </div>
        )}
        <Table
          id="batch-units-table"
          caption={t("batchPage.unitsTitle")}
          headers={unitHeaders}
          empty={preview.length === 0}
          emptyTitle="Serija nema obračunatih stavki."
        >
          {preview.map((calc) => (
            <tr key={calc.unitId}>
              <Td>{calc.unitLabel}</Td>
              <Td>{calc.buildingName}</Td>
              <Td>{calc.debtorId ? calc.debtorName : t("batchPage.noDebtor")}</Td>
              <Td>{formatMoney(calc.total)}</Td>
              <Td>{flagged.has(calc.unitId) ? <StatusBadge status="PENDING" label={t("batchWarnings.chip")} /> : "—"}</Td>
              <Td>
                {calc.lines.length === 0 ? "—" : (
                  <details>
                    <summary className="cursor-pointer text-[13px] font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
                      {t("batchPage.showCalc")}
                    </summary>
                    <ul className="mt-2 space-y-1 text-[13px] text-slate-700">
                      {calc.lines.map((l, i) => (
                        <li key={i}>
                          {l.name} — {describeChargeLine({ method: l.method, allocationBasis: l.allocationBasis, inputs: l.inputs })} = {formatMoney(l.amount)}
                        </li>
                      ))}
                      <li className="font-semibold">{tf("batchPage.lineTotal", { iznos: formatMoney(calc.total) })}</li>
                    </ul>
                  </details>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        {preview.length > 0 && (
          <p className="mt-3 text-sm font-semibold tabular-nums text-slate-700">
            {tf("batchPage.totalLine", { broj: preview.length, iznos: formatMoney(grandTotal.toFixed(2)) })}
          </p>
        )}
      </Card>
    </div>
  );
}
