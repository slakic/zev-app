import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { suggestMatches, allocatePayment, reverseAllocation, reversePayment } from "@/server/services/payments";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { getPaymentChannelInfo } from "@/server/services/paymentMatching";
import { partyDisplayName } from "@/server/services/ownership";
import { formatMoney, dec, sumDecimals, parseMoneyInput } from "@/lib/money";
import { formatDate, formatDateTime, tEnum, t, tf } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, ConfirmAction, RowAction, RowLink, Flash, type ColumnSpec } from "@/components/ui";

const suggestionHeaders: ColumnSpec[] = [
  { label: "Faktura" },
  { label: "Jedinica" },
  { label: "Otvoreno", align: "right" },
  { label: "Osnov prijedloga" },
  { label: "Radnje" },
];

const allocationHeaders: ColumnSpec[] = [
  { label: "Vrijeme" },
  { label: "Faktura" },
  { label: "Iznos", align: "right" },
  { label: "Napomena" },
  { label: "Radnje" },
];

async function allocateAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const paymentId = String(formData.get("paymentId"));
  try {
    await allocatePayment(actor, {
      paymentId,
      invoiceId: String(formData.get("invoiceId")),
      // Empty amount = "as much as possible" (the service resolves min(free, open)).
      amount: parseMoneyInput(formData.get("amount") as string | null) ?? undefined,
    });
  } catch (e) {
    redirect(`/fakture/uplate/${paymentId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/fakture/uplate/${paymentId}`);
}

async function reverseAllocAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const paymentId = String(formData.get("paymentId"));
  try {
    await reverseAllocation(actor, String(formData.get("allocationId")), String(formData.get("reason") ?? ""));
  } catch (e) {
    redirect(`/fakture/uplate/${paymentId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/fakture/uplate/${paymentId}`);
}

async function reversePaymentAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const paymentId = String(formData.get("paymentId"));
  try {
    await reversePayment(actor, paymentId, String(formData.get("reason") ?? ""));
  } catch (e) {
    redirect(`/fakture/uplate/${paymentId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/fakture/uplate/${paymentId}`);
}

export default async function PaymentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const { err } = await searchParams;
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  const zevId = requireZev(actor);
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id, zevId },
    include: { payer: true, account: true, allocations: { include: { invoice: { include: { debtor: true } } }, orderBy: { createdAt: "asc" } } },
  });
  const allocated = sumDecimals(payment.allocations.map((a) => dec(a.amount.toString())));
  const free = dec(payment.amount.toString()).minus(allocated);
  const channel = await getPaymentChannelInfo(actor, id);
  const suggestions = payment.status !== "REVERSED" && free.greaterThan(0) ? await suggestMatches(actor, id) : [];
  const isAccountant = actor.roles.includes("ACCOUNTANT");
  // An allocation that already has a storno row cannot be reversed again (reverseAllocation refuses it).
  const reversedAllocationIds = new Set(payment.allocations.map((a) => a.reversalOfId).filter((x): x is string => Boolean(x)));
  const openInvoices = (
    await prisma.invoice.findMany({
      where: { zevId, status: "ISSUED" },
      include: { allocations: true, debtor: true, unit: true },
      orderBy: { number: "asc" },
    })
  )
    .map((inv) => ({ inv, open: dec(inv.total.toString()).minus(sumDecimals(inv.allocations.map((a) => dec(a.amount.toString())))) }))
    .filter((x) => x.open.greaterThan(0));
  const payerInvoices = openInvoices.filter((x) => payment.payerId && x.inv.debtorId === payment.payerId);
  const otherInvoices = openInvoices.filter((x) => !(payment.payerId && x.inv.debtorId === payment.payerId));
  const invoiceOption = ({ inv, open }: (typeof openInvoices)[number]) => (
    <option key={inv.id} value={inv.id}>
      {inv.number} — {partyDisplayName(inv.debtor)} ({inv.unit.label}) — otvoreno {formatMoney(open.toFixed(2))}
    </option>
  );
  const visibleSuggestionHeaders = isAccountant ? suggestionHeaders : suggestionHeaders.filter((h) => h.label !== "Radnje");
  const visibleAllocationHeaders = isAccountant ? allocationHeaders : allocationHeaders.filter((h) => h.label !== "Radnje");

  return (
    <div>
      <PageHeader
        title={`Uplata — ${formatMoney(payment.amount.toString())}`}
        subtitle={`${formatDate(payment.date)} · ${payment.payer ? partyDisplayName(payment.payer) : payment.payerNameRaw ?? "nepoznat platilac"} · ${payment.account.name}`}
        backHref="/fakture/uplate"
        backLabel="Nazad na sve uplate"
      />
      <Flash err={err} />
      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={payment.status} label={tEnum("paymentStatus", payment.status)} />
        <span className="text-sm text-slate-600">Raspoređeno: {formatMoney(allocated.toFixed(2))} · Slobodno (avans): {formatMoney(free.toFixed(2))}</span>
        {payment.status === "REVERSED" && (
          <span className="text-sm text-red-700">Uplata je stornirana ({payment.reversalReason}).</span>
        )}
        {payment.reference && <span className="font-mono text-xs text-slate-500">poziv: {payment.reference}</span>}
        {channel.fromSms && (
          <StatusBadge
            status={channel.statementConfirmed ? "APPROVED" : "PENDING"}
            label={channel.statementConfirmed ? "SMS, potvrđeno izvodom" : "SMS, čeka izvod"}
          />
        )}
        {channel.merge && (
          <span className="text-sm text-slate-600">
            {channel.merge.role === "SURVIVOR" ? "Duplikat ove uplate je storniran: " : "Storniran duplikat, zadržana je uplata "}
            <Link href={`/fakture/uplate/${channel.merge.otherPaymentId}`} className="font-medium text-blue-700 underline underline-offset-2">
              pogledaj
            </Link>
          </span>
        )}
      </div>

      {free.greaterThan(0) && payment.status !== "REVERSED" && (
        <p className="-mt-2 mb-4 text-[13px] text-slate-600">
          {tf("confirm.allocation.advance", { iznos: formatMoney(free.toFixed(2)) })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Prijedlozi uparivanja">
          <Table
            id="suggestions-table"
            caption="Prijedlozi uparivanja"
            headers={visibleSuggestionHeaders}
            empty={suggestions.length === 0}
            emptyTitle={t("empty.suggestions.title")}
          >
            {suggestions.map((s) => (
              <tr key={s.invoiceId}>
                <Td>{s.number}</Td>
                <Td>{s.unitLabel}</Td>
                <Td>{formatMoney(s.open)}</Td>
                <Td className="text-xs">{s.reasons.join(", ")}</Td>
                {isAccountant && (
                  <Td>
                    <form action={allocateAction}>
                      <input type="hidden" name="paymentId" value={payment.id} />
                      <input type="hidden" name="invoiceId" value={s.invoiceId} />
                      <input type="hidden" name="amount" value={dec(s.open).lessThan(free) ? s.open : free.toFixed(2)} />
                      <RowAction variant="tonal">upari</RowAction>
                    </form>
                  </Td>
                )}
              </tr>
            ))}
          </Table>
        </Card>

        {isAccountant && payment.status !== "REVERSED" && (
          <Card title="Ručno raspoređivanje">
            <form action={allocateAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="paymentId" value={payment.id} />
              <div className="sm:col-span-2">
                <Field label="Faktura">
                  <select name="invoiceId" required defaultValue="" className={inputCls}>
                    <option value="">{t("confirm.allocation.chooseInvoice")}</option>
                    {payment.payer ? (
                      <>
                        {payerInvoices.length > 0 && (
                          <optgroup label={tf("confirm.allocation.payerGroup", { ime: partyDisplayName(payment.payer) })}>
                            {payerInvoices.map(invoiceOption)}
                          </optgroup>
                        )}
                        {otherInvoices.length > 0 && (
                          <optgroup label={t("confirm.allocation.otherGroup")}>{otherInvoices.map(invoiceOption)}</optgroup>
                        )}
                      </>
                    ) : (
                      <optgroup label={t("confirm.allocation.openGroup")}>{openInvoices.map(invoiceOption)}</optgroup>
                    )}
                  </select>
                </Field>
              </div>
              <Field label="Iznos (KM)" hint={tf("confirm.allocation.amountHint", { slobodno: formatMoney(free.toFixed(2)) })}>
                <input name="amount" inputMode="decimal" className={inputCls} />
              </Field>
              <div className="flex items-end"><SubmitBtn>Rasporedi</SubmitBtn></div>
            </form>
          </Card>
        )}
      </div>

      <div className="mt-4">
        <Card title="Alokacije" hint={isAccountant ? "Zapisi se ne brišu — storno je novi zapis." : t("confirm.allocation.accountantOnly")}>
          <Table
            id="allocations-table"
            caption="Alokacije"
            headers={visibleAllocationHeaders}
            empty={payment.allocations.length === 0}
            emptyTitle={t("empty.allocations.title")}
            emptyHint={t("empty.allocations.hint")}
          >
            {payment.allocations.map((a) => (
              <tr key={a.id} className={Number(a.amount) < 0 ? "text-red-700" : ""}>
                <Td>{formatDateTime(a.createdAt)}</Td>
                <Td><RowLink href={`/fakture/${a.invoiceId}`}>{a.invoice.number}</RowLink></Td>
                <Td>{formatMoney(a.amount.toString())}</Td>
                <Td>{a.reason ?? "—"}</Td>
                {isAccountant && (
                  <Td>
                    {Number(a.amount) > 0 && !a.reversalOfId && !reversedAllocationIds.has(a.id) && payment.status !== "REVERSED" && (
                      <ConfirmAction
                        trigger="Storniraj"
                        triggerVariant="caution"
                        title={t("confirm.allocation.reverseTitle")}
                        body={
                          <p className="text-sm text-amber-900">
                            {tf("confirm.allocation.reverseBody", {
                              iznos: formatMoney(a.amount.toString()),
                              broj: a.invoice.number,
                              dluznik: partyDisplayName(a.invoice.debtor),
                            })}
                          </p>
                        }
                        confirmLabel={t("confirm.allocation.reverseConfirm")}
                        confirmVariant="caution"
                        action={reverseAllocAction}
                        hiddenFields={{ paymentId: payment.id, allocationId: a.id }}
                      >
                        <Field label="Razlog storniranja"><input name="reason" required className={inputCls} /></Field>
                      </ConfirmAction>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      {isAccountant && payment.status !== "REVERSED" && (
        <div className="mt-4">
          <Card title="Poništavanje">
            <ConfirmAction
              trigger="Storniraj uplatu"
              title={t("confirm.paymentReverse.title")}
              body={<p className="text-sm text-amber-900">{tf("confirm.paymentReverse.body", { iznos: formatMoney(payment.amount.toString()) })}</p>}
              confirmLabel={t("confirm.paymentReverse.confirm")}
              confirmVariant="danger"
              action={reversePaymentAction}
              hiddenFields={{ paymentId: payment.id }}
            >
              <Field label="Razlog storniranja"><input name="reason" required className={inputCls} /></Field>
            </ConfirmAction>
          </Card>
        </div>
      )}
    </div>
  );
}
