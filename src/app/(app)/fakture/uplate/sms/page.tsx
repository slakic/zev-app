import { requireActor } from "@/server/actor";
import { listBankSmsOther, listBankSmsReview } from "@/server/services/bankSms";
import { dismissBankSmsAction } from "@/server/actions/bankSms";
import { formatDateTime } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { BankSmsReviewTable } from "@/components/bank-sms-review";
import {
  PageHeader, Card, Table, Td, StatusBadge, Flash, Tabs, RowActionLink, ConfirmAction, Field, inputCls, type ColumnSpec,
} from "@/components/ui";

const confirmedHeaders: ColumnSpec[] = [
  { label: "Primljeno", nowrap: true },
  { label: "Smjer" },
  { label: "Iznos", align: "right", nowrap: true },
  { label: "Platilac / primalac", priority: "primary" },
  { label: "Svrha", priority: "detail" },
  { label: "Knjiženje" },
];

const rejectedHeaders: ColumnSpec[] = [
  { label: "Primljeno", nowrap: true },
  { label: "Razlog", priority: "primary" },
  { label: "Tekst poruke", priority: "detail" },
  { label: "Radnje" },
];

/**
 * Queue of bank SMS notifications forwarded from the phone (Plans/bank-sms-ingestion-plan.md).
 * PRESIDENT and ACCOUNTANT can look; only the ACCOUNTANT can confirm/dismiss (same as the PDF
 * statement import this mirrors). The "cekanje" tab keys the editable table by its row ids, so
 * after a confirmation or dismissal the table remounts with fresh state.
 */
export default async function BankSmsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; err?: string; msg?: string }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const canConfirm = actor.roles.includes("ACCOUNTANT");
  const { tab, err, msg } = await searchParams;
  const activeTab = tab === "potvrdjene" || tab === "neprepoznate" ? tab : "cekanje";

  const [review, other] = await Promise.all([listBankSmsReview(actor), listBankSmsOther(actor)]);

  return (
    <div>
      <PageHeader
        title="SMS obavještenja banke"
        subtitle="Poruke koje stižu sa telefona čekaju vašu potvrdu — ništa se ne knjiži automatski"
        backHref="/fakture/uplate"
        backLabel="Uplate i uparivanje"
      />
      <Flash err={err} msg={msg} />
      <Tabs
        tabs={[
          { key: "cekanje", label: "Na čekanju", count: review.rows.length },
          { key: "potvrdjene", label: "Potvrđene" },
          { key: "neprepoznate", label: "Neprepoznate", count: other.rejected.length },
        ]}
        active={activeTab}
        hrefFor={(key) => `/fakture/uplate/sms?tab=${key}`}
      />

      {activeTab === "cekanje" && (
        <Card>
          <BankSmsReviewTable key={review.rows.map((r) => r.id).join(",")} review={review} canConfirm={canConfirm} />
        </Card>
      )}

      {activeTab === "potvrdjene" && (
        <Card>
          <Table
            id="bank-sms-confirmed"
            caption="Potvrđene SMS poruke"
            headers={confirmedHeaders}
            empty={other.confirmed.length === 0}
            emptyTitle="Još nema potvrđenih SMS poruka."
          >
            {other.confirmed.map((s) => (
              <tr key={s.id}>
                <Td className="text-[13px]">{formatDateTime(new Date(s.receivedAt))}</Td>
                <Td>
                  <StatusBadge status={s.kind === "PRILIV" ? "PAID" : "UNPAID"} label={s.kind === "PRILIV" ? "uplata" : "isplata"} />
                </Td>
                <Td>{s.amount ? formatMoney(s.amount) : "—"}</Td>
                <Td>{s.counterpartyName ?? "—"}</Td>
                <Td className="text-[13px]">{s.purposeRaw ?? "—"}</Td>
                <Td>
                  {s.paymentId ? (
                    <RowActionLink href={`/fakture/uplate/${s.paymentId}`}>uplata</RowActionLink>
                  ) : (
                    <span className="text-[13px] text-slate-500">isplata evidentirana</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {activeTab === "neprepoznate" && (
        <Card>
          <p className="mb-3 text-[13px] text-slate-500">
            Poruke koje aplikacija nije mogla pročitati kao uplatu ili isplatu. Ako ovdje stalno stižu poruke banke, format se
            možda promijenio — evidentirajte ih ručno i javite. Poruke koje nisu od Nova Banke čuvaju se bez teksta (lična
            prepiska se ne smije zadržavati) — to znači da je filter u automatizaciji na telefonu preširok.
          </p>
          <Table
            id="bank-sms-rejected"
            caption="Neprepoznate SMS poruke"
            headers={rejectedHeaders}
            empty={other.rejected.length === 0}
            emptyTitle="Nema neprepoznatih poruka."
          >
            {other.rejected.map((s) => (
              <tr key={s.id}>
                <Td className="text-[13px]">{formatDateTime(new Date(s.receivedAt))}</Td>
                <Td className="text-[13px]">{s.parseError ?? "—"}</Td>
                <Td className="text-[13px] font-mono">{s.rawText ?? "— (nije od banke, tekst nije sačuvan)"}</Td>
                <Td>
                  {canConfirm && (
                    <ConfirmAction
                      trigger="Zatvori"
                      title="Zatvaranje poruke"
                      body={<p className="text-sm text-amber-900">Ništa se ne knjiži. Ako je poruka stvarna uplata, prvo je unesite ručno.</p>}
                      confirmLabel="Da, zatvori poruku"
                      action={dismissBankSmsAction}
                      hiddenFields={{ smsId: s.id }}
                    >
                      <Field label="Razlog">
                        <input name="reason" required className={inputCls} />
                      </Field>
                    </ConfirmAction>
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
