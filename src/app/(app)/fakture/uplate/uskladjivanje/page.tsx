import Link from "next/link";
import { requireActor } from "@/server/actor";
import {
  getChannelReconciliation,
  UNCONFIRMED_AFTER_DAYS,
  type ChannelDuplicate,
  type ChannelRecord,
} from "@/server/services/paymentMatching";
import {
  confirmSmsByStatementAction,
  linkChannelTransactionAction,
  markChannelNotSameAction,
  mergeChannelDuplicateAction,
} from "@/server/actions/paymentMatching";
import { formatDate, formatDateTime } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { PageHeader, Card, Table, Td, StatusBadge, Flash, Tabs, RowAction, ConfirmAction, type ColumnSpec } from "@/components/ui";

const duplicateHeaders: ColumnSpec[] = [
  { label: "Pouzdanost", nowrap: true },
  { label: "Iznos", align: "right", nowrap: true },
  { label: "Iz SMS-a", priority: "primary" },
  { label: "Iz izvoda / ručni unos" },
  { label: "Radnje" },
];

const unconfirmedHeaders: ColumnSpec[] = [
  { label: "Primljeno", nowrap: true },
  { label: "Smjer" },
  { label: "Iznos", align: "right", nowrap: true },
  { label: "Platilac / primalac", priority: "primary" },
  { label: "Radnje" },
];

const sourceLabel: Record<ChannelRecord["source"], string> = {
  SMS: "SMS obavještenje",
  PDF: "PDF izvod",
  CSV: "CSV izvod",
  MANUAL: "ručni unos",
  OTHER: "izvod ili ručni unos",
};

function RecordCell({ r }: { r: ChannelRecord }) {
  const title = r.name || "nepoznat platilac / primalac";
  return (
    <div className="text-sm">
      {r.kind === "PAYMENT" ? (
        <Link href={`/fakture/uplate/${r.id}`} className="font-medium text-slate-900 underline underline-offset-2">
          {title}
        </Link>
      ) : (
        <span className="font-medium text-slate-900">{title}</span>
      )}
      <p className="text-[13px] text-slate-500">
        {formatDate(new Date(`${r.date}T12:00:00Z`))}, {sourceLabel[r.source]}
      </p>
      {r.purpose && <p className="text-[13px] text-slate-500">{r.purpose}</p>}
      {r.kind === "PAYMENT" && (
        <p className="text-[13px] text-slate-700">
          {r.invoices.length > 0 ? `Raspoređeno na: ${r.invoices.join(", ")}` : "Nije raspoređeno na fakturu"}
        </p>
      )}
    </div>
  );
}

/** Mirrors mergeChannelDuplicate()'s choice (decision P1 (c)) so the confirmation says up front
 *  which record stays — the service decides again on its own, from the database. */
function survivorOf(d: ChannelDuplicate): "SMS" | "OTHER" {
  return d.sms.invoices.length > 0 && d.other.invoices.length === 0 ? "SMS" : "OTHER";
}

function DuplicateActions({ d }: { d: ChannelDuplicate }) {
  if (d.linkedButBothActive) {
    return (
      <p className="max-w-64 text-[13px] text-amber-800">
        Označeno kao ista isplata, ali su obje i dalje proknjižene. Isplate se ne spajaju automatski — duplu isplatu ispravite
        ručno.
      </p>
    );
  }
  const notSame = (
    <form action={markChannelNotSameAction}>
      <input type="hidden" name="smsId" value={d.smsId} />
      <input type="hidden" name={d.other.kind === "PAYMENT" ? "otherPaymentId" : "otherTransactionId"} value={d.other.id} />
      <RowAction type="submit">Nisu iste</RowAction>
    </form>
  );
  if (!d.canMerge) {
    return (
      <div className="flex flex-wrap gap-2">
        <form action={linkChannelTransactionAction}>
          <input type="hidden" name="smsId" value={d.smsId} />
          <input type="hidden" name="otherTransactionId" value={d.other.id} />
          <RowAction type="submit" variant="tonal">Ista isplata</RowAction>
        </form>
        {notSame}
      </div>
    );
  }
  const keep = survivorOf(d) === "SMS" ? d.sms : d.other;
  const drop = keep === d.sms ? d.other : d.sms;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ConfirmAction
        trigger="Spoji"
        title="Spajanje iste uplate"
        body={
          <div className="space-y-1 text-sm text-amber-900">
            <p>
              Ostaje uplata iz izvora „{sourceLabel[keep.source]}“. Uplata iz izvora „{sourceLabel[drop.source]}“ se stornira
              ({formatMoney(drop.amount)}), uz razlog da je duplikat.
            </p>
            {drop.invoices.length > 0 && <p>Njeno raspoređivanje ({drop.invoices.join(", ")}) prenosi se na uplatu koja ostaje.</p>}
          </div>
        }
        confirmLabel="Da, spoji uplate"
        action={mergeChannelDuplicateAction}
        hiddenFields={{ smsId: d.smsId, otherPaymentId: d.other.id }}
      />
      {notSame}
    </div>
  );
}

/**
 * SMS ↔ izvod usklađivanje (Plans/sms-statement-payment-matching-plan.md): the same bank
 * transaction booked from an SMS and again from the statement (or by hand), and SMS bookings the
 * statement never confirmed. PRESIDENT and ACCOUNTANT can look; only the ACCOUNTANT decides.
 */
export default async function ChannelReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; err?: string; msg?: string }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const canDecide = actor.roles.includes("ACCOUNTANT");
  const { tab, err, msg } = await searchParams;
  const activeTab = tab === "bez-izvoda" ? "bez-izvoda" : "duplikati";
  const rec = await getChannelReconciliation(actor);

  return (
    <div>
      <PageHeader
        title="Usklađivanje SMS-a i izvoda"
        subtitle="Ista bankovna transakcija evidentirana dva puta, i SMS uplate koje izvod još nije potvrdio"
        backHref="/fakture/uplate/sms"
        backLabel="SMS obavještenja banke"
      />
      <Flash err={err} msg={msg} />
      <Tabs
        tabs={[
          { key: "duplikati", label: "Mogući duplikati", count: rec.duplicates.length },
          { key: "bez-izvoda", label: "Bez potvrde izvodom", count: rec.unconfirmed.length },
        ]}
        active={activeTab}
        hrefFor={(key) => `/fakture/uplate/uskladjivanje?tab=${key}`}
      />

      {activeTab === "duplikati" && (
        <Card hint="Parovi sa istim računom i iznosom, u razmaku do 3 dana. Visoka pouzdanost znači i isto ime platioca i razmak do jednog dana.">
          <Table
            id="channel-duplicates"
            caption="Mogući duplikati SMS-a i izvoda"
            headers={duplicateHeaders}
            empty={rec.duplicates.length === 0}
            emptyTitle="Nema mogućih duplikata."
            emptyHint="Svaka transakcija iz SMS-a evidentirana je samo jednom."
          >
            {rec.duplicates.map((d) => (
              <tr key={`${d.smsId}-${d.other.id}`}>
                <Td>
                  <StatusBadge
                    status={d.confidence === "HIGH" ? "PENDING" : "NONE"}
                    label={d.confidence === "HIGH" ? "visoka" : "moguća"}
                  />
                  <p className="mt-1 text-[13px] text-slate-500">{d.direction === "IN" ? "uplata" : "isplata"}</p>
                </Td>
                <Td>{formatMoney(d.sms.amount)}</Td>
                <Td>
                  <RecordCell r={d.sms} />
                </Td>
                <Td>
                  <RecordCell r={d.other} />
                </Td>
                <Td>{canDecide ? <DuplicateActions d={d} /> : <span className="text-[13px] text-slate-500">odlučuje računovođa</span>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {activeTab === "bez-izvoda" && (
        <Card
          hint={`Proknjižene SMS stavke starije od ${UNCONFIRMED_AFTER_DAYS} dana za koje nijedan uvezeni izvod nema odgovarajuću stavku. SMS nije dokaz da je novac stigao — provjerite ih na izvodu banke. Potvrđeno izvodom: ${rec.confirmedCount}.`}
        >
          <Table
            id="channel-unconfirmed"
            caption="SMS stavke bez potvrde izvodom"
            headers={unconfirmedHeaders}
            empty={rec.unconfirmed.length === 0}
            emptyTitle="Sve SMS stavke su potvrđene izvodom."
          >
            {rec.unconfirmed.map((u) => (
              <tr key={u.smsId}>
                <Td className="text-[13px]">
                  {formatDateTime(new Date(u.smsReceivedAt))}
                  <p className="text-slate-500">prije {u.ageDays} dana</p>
                </Td>
                <Td>
                  <StatusBadge status={u.direction === "IN" ? "PAID" : "UNPAID"} label={u.direction === "IN" ? "uplata" : "isplata"} />
                </Td>
                <Td>{formatMoney(u.record.amount)}</Td>
                <Td>
                  <RecordCell r={u.record} />
                </Td>
                <Td>
                  {canDecide && (
                    <ConfirmAction
                      trigger="Potvrđeno izvodom"
                      title="Potvrda prema izvodu"
                      body={
                        <p className="text-sm text-amber-900">
                          Potvrdite samo ako ste ovu stavku ({formatMoney(u.record.amount)}) vidjeli na izvodu banke. Ako je nema na
                          izvodu, uplatu stornirajte.
                        </p>
                      }
                      confirmLabel="Da, stavka je na izvodu"
                      action={confirmSmsByStatementAction}
                      hiddenFields={{ smsId: u.smsId }}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
