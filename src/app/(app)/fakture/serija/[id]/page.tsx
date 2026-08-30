import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { issueBatch, type UnitCalculation } from "@/server/services/billing";
import { generateInvoicePdf } from "@/server/services/documents";
import { queueNotification } from "@/server/notifications/service";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import { tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, SubmitBtn, Flash } from "@/components/ui";
import { partyDisplayName } from "@/server/services/ownership";

async function issueBatchAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const batchId = String(formData.get("batchId"));
  try {
    const invoices = await issueBatch(actor, batchId);
    // Generate PDFs and queue e-mail delivery for each invoice.
    for (const inv of invoices) {
      await generateInvoicePdf(actor, inv.id);
      const debtor = await prisma.party.findUnique({ where: { id: inv.debtorId } });
      if (debtor?.email) {
        await queueNotification({
          channel: "EMAIL",
          recipientId: debtor.id,
          toAddress: debtor.email,
          template: "invoice-issued",
          subject: `Nova faktura ${inv.number}`,
          body: `Poštovani ${partyDisplayName(debtor)},\n\nizdata je faktura ${inv.number}. Iznos i detalji dostupni su u aplikaciji nakon prijave (PDF u prilogu u produkcijskoj konfiguraciji).\n`,
          relatedType: "Invoice",
          relatedId: inv.id,
        });
        await prisma.invoice.update({ where: { id: inv.id }, data: { deliveryStatus: "SENT" } });
      }
    }
  } catch (e) {
    redirect(`/fakture/serija/${batchId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/fakture?msg=${encodeURIComponent("Serija je izdata, PDF fakture generisane i poslate (mock e-mail).")}`);
}

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const { err } = await searchParams;
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  const batch = await prisma.invoiceBatch.findUniqueOrThrow({ where: { id }, include: { invoices: true } });
  const preview = (batch.previewData as unknown as UnitCalculation[]) ?? [];
  const grandTotal = preview.reduce((a, c) => a + Number(c.total), 0);

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
      <Flash err={err} />
      <div className="mb-4">
        <StatusBadge status={batch.status} label={batch.status === "DRAFT" ? "Nacrt — fakture još nisu izdate" : batch.status === "ISSUED" ? `Izdata (${batch.invoices.length} faktura)` : "Stornirana"} />
      </div>

      <div className="space-y-4">
        {preview.map((calc) => (
          <Card key={calc.unitId} title={`${calc.buildingName} / ${calc.unitLabel} — ${calc.debtorName} — ukupno ${formatMoney(calc.total)}`}>
            <Table headers={["Stavka", "Metoda", "Formula", "Ulazne vrijednosti", "Osnov raspodjele", "Prije zaokruž.", "Iznos"]} empty={calc.lines.length === 0}>
              {calc.lines.map((l, i) => (
                <tr key={i}>
                  <Td>{l.name}</Td>
                  <Td>{tEnum("chargeMethod", l.method)}</Td>
                  <Td className="text-xs">{l.formula}</Td>
                  <Td className="text-xs">
                    {Object.entries(l.inputs).map(([k, v]) => `${k}=${v}`).join(", ")}
                  </Td>
                  <Td className="text-xs">{l.allocationBasis}</Td>
                  <Td right className="text-xs">{l.rawAmount}</Td>
                  <Td right>{formatMoney(l.amount, "")}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}
        {preview.length === 0 && <p className="text-sm text-slate-400">Serija nema obračunatih stavki.</p>}
      </div>
    </div>
  );
}
