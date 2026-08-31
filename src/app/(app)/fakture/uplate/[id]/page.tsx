import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { suggestMatches, allocatePayment, reverseAllocation, reversePayment } from "@/server/services/payments";
import { prisma } from "@/lib/prisma";
import { partyDisplayName } from "@/server/services/ownership";
import { formatMoney, dec, sumDecimals, parseMoneyInput } from "@/lib/money";
import { formatDate, formatDateTime, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";

async function allocateAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const paymentId = String(formData.get("paymentId"));
  try {
    await allocatePayment(actor, {
      paymentId,
      invoiceId: String(formData.get("invoiceId")),
      amount: parseMoneyInput(formData.get("amount") as string | null) ?? "",
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
    await reverseAllocation(actor, String(formData.get("allocationId")), String(formData.get("reason") || "Storno"));
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
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id },
    include: { payer: true, account: true, allocations: { include: { invoice: true }, orderBy: { createdAt: "asc" } } },
  });
  const allocated = sumDecimals(payment.allocations.map((a) => dec(a.amount.toString())));
  const free = dec(payment.amount.toString()).minus(allocated);
  const suggestions = payment.status !== "REVERSED" && free.greaterThan(0) ? await suggestMatches(actor, id) : [];
  const openInvoices = await prisma.invoice.findMany({
    where: { status: "ISSUED" },
    include: { allocations: true, debtor: true, unit: true },
    orderBy: { number: "asc" },
  });

  return (
    <div>
      <PageHeader
        title={`Uplata — ${formatMoney(payment.amount.toString())}`}
        subtitle={`${formatDate(payment.date)} · ${payment.payer ? partyDisplayName(payment.payer) : payment.payerNameRaw ?? "nepoznat platilac"} · ${payment.account.name}`}
      />
      <Flash err={err} />
      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={payment.status} label={tEnum("paymentStatus", payment.status)} />
        <span className="text-sm text-slate-600">Raspoređeno: {formatMoney(allocated.toFixed(2))} · Slobodno (avans): {formatMoney(free.toFixed(2))}</span>
        {payment.reference && <span className="font-mono text-xs text-slate-500">poziv: {payment.reference}</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Prijedlozi uparivanja">
          <Table headers={["Faktura", "Jedinica", "Otvoreno", "Osnov prijedloga", ""]} empty={suggestions.length === 0}>
            {suggestions.map((s) => (
              <tr key={s.invoiceId}>
                <Td>{s.number}</Td>
                <Td>{s.unitLabel}</Td>
                <Td right>{formatMoney(s.open)}</Td>
                <Td className="text-xs">{s.reasons.join(", ")}</Td>
                <Td>
                  <form action={allocateAction}>
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <input type="hidden" name="invoiceId" value={s.invoiceId} />
                    <input type="hidden" name="amount" value={dec(s.open).lessThan(free) ? s.open : free.toFixed(2)} />
                    <button className="text-sm text-blue-700 hover:underline">upari</button>
                  </form>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Ručno raspoređivanje">
          {payment.status === "REVERSED" ? (
            <p className="text-sm text-red-700">Uplata je stornirana ({payment.reversalReason}).</p>
          ) : (
            <form action={allocateAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" name="paymentId" value={payment.id} />
              <div className="sm:col-span-2">
                <Field label="Faktura">
                  <select name="invoiceId" className={inputCls}>
                    {openInvoices.map((inv) => {
                      const paid = inv.allocations.reduce((a, x) => a + Number(x.amount), 0);
                      const open = Number(inv.total) - paid;
                      if (open <= 0) return null;
                      return (
                        <option key={inv.id} value={inv.id}>
                          {inv.number} — {partyDisplayName(inv.debtor)} ({inv.unit.label}) — otvoreno {open.toFixed(2)} KM
                        </option>
                      );
                    })}
                  </select>
                </Field>
              </div>
              <Field label="Iznos (KM)"><input name="amount" required defaultValue={free.toFixed(2)} className={inputCls} /></Field>
              <div className="flex items-end"><SubmitBtn>Rasporedi</SubmitBtn></div>
            </form>
          )}
          {payment.status !== "REVERSED" && (
            <form action={reversePaymentAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="paymentId" value={payment.id} />
              <Field label="Storniraj cijelu uplatu — razlog"><input name="reason" required className={inputCls} /></Field>
              <SubmitBtn variant="danger">Storniraj uplatu</SubmitBtn>
            </form>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Alokacije (zapisi se ne brišu — storno je novi zapis)">
          <Table headers={["Vrijeme", "Faktura", "Iznos", "Napomena", ""]} empty={payment.allocations.length === 0}>
            {payment.allocations.map((a) => (
              <tr key={a.id} className={Number(a.amount) < 0 ? "text-red-700" : ""}>
                <Td>{formatDateTime(a.createdAt)}</Td>
                <Td>{a.invoice.number}</Td>
                <Td right>{formatMoney(a.amount.toString())}</Td>
                <Td>{a.reason ?? "—"}</Td>
                <Td>
                  {Number(a.amount) > 0 && !a.reversalOfId && payment.status !== "REVERSED" && (
                    <form action={reverseAllocAction} className="flex gap-1">
                      <input type="hidden" name="paymentId" value={payment.id} />
                      <input type="hidden" name="allocationId" value={a.id} />
                      <input name="reason" placeholder="razlog" className="w-28 rounded border border-slate-300 px-1 text-xs" />
                      <button className="text-xs text-red-700 hover:underline">storno</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
