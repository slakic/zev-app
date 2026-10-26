import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { listPayments, enterPayment, importBankCsv, PAYMENT_FILTER_TO_MATCH, PAYMENT_FILTER_ADVANCE, type PaymentSortKey } from "@/server/services/payments";
import { listAccounts } from "@/server/services/finance";
import { getPaymentsWorkStrip } from "@/server/services/accountantHome";
import { listParties, partyDisplayName } from "@/server/services/ownership";
import { formatMoney, parseMoneyInput, dec, ZERO } from "@/lib/money";
import { formatDate, tEnum, t, tf, toZonedDateIso } from "@/lib/i18n";
import { uiMappingFromForm, uiMappingToService } from "@/lib/csvMapping";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash, RowActionLink, RowLink, FilterBar, Pagination, BtnLink, ToggleBtn, type ColumnSpec } from "@/components/ui";
import { CsvImportForm } from "@/components/csv-import-form";

const paymentHeaders: ColumnSpec[] = [
  { label: "Datum", sortKey: "date" },
  { label: "Platilac", priority: "primary" },
  { label: "Poziv na broj", priority: "detail" },
  { label: "Iznos", align: "right", nowrap: true, sortKey: "amount" },
  { label: "Status" },
  { label: "Radnje", actions: true },
];

// Vlasnik: bez "Platilac" (uvijek on) i "Radnje" (uvijek prazne), a sa "Raspoređeno na" (F3.3).
const ownerPaymentHeaders: ColumnSpec[] = [
  { label: "Datum", priority: "primary", sortKey: "date" },
  { label: "Poziv na broj", priority: "detail" },
  { label: "Iznos", align: "right", nowrap: true, sortKey: "amount" },
  { label: t("ownerInvoices.allocatedTo") },
  { label: "Status", priority: "secondary" },
];

const PAYMENT_SORT_KEYS: PaymentSortKey[] = ["date", "amount"];
/** Izričit izbor „Svi” (bez ovoga bi podrazumijevani filter „Za uparivanje” uvijek pobjeđivao). */
const ALL_PAYMENTS = "SVE";
import { PdfStatementImport } from "@/components/pdf-statement-import";

async function enterPaymentAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  try {
    await enterPayment(actor, {
      accountId: String(formData.get("accountId")),
      date: new Date(String(formData.get("date"))),
      amount: parseMoneyInput(formData.get("amount") as string | null) ?? "",
      payerId: (formData.get("payerId") as string) || null,
      payerNameRaw: (formData.get("payerNameRaw") as string) || null,
      reference: (formData.get("reference") as string) || null,
      // „Način” se izvodi iz tipa računa u servisu (F5b.2) — polje je uklonjeno.
    });
  } catch (e) {
    redirect(`/fakture/uplate?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/fakture/uplate");
}

async function importCsvAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(`/fakture/uplate?err=${encodeURIComponent(t("csvImport.errNoFile"))}`);
  const content = Buffer.from(await file!.arrayBuffer()).toString("utf8");
  try {
    // Forma šalje kolone od 1 ("1. kolona"); servis radi sa indeksima od 0 — pretvara čista funkcija.
    const mapping = uiMappingToService(uiMappingFromForm((n) => formData.get(n)));
    const result = await importBankCsv(actor, {
      accountId: String(formData.get("accountId")),
      filename: file!.name,
      content,
      mapping,
    });
    redirect(`/fakture/uplate?msg=${encodeURIComponent(tf("csvImport.done", { broj: result.imported, greske: result.errors.length }))}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(`/fakture/uplate?err=${encodeURIComponent(e instanceof Error ? e.message : t("csvImport.errImport"))}`);
  }
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; msg?: string; status?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const sp = await searchParams;
  const { err, msg } = sp;

  function uplateHref(overrides: Partial<{ status: string; sort: string; dir: string; page: string }>) {
    const merged = { status: sp.status, sort: sp.sort, dir: sp.dir, page: sp.page, ...overrides };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/fakture/uplate?${params.toString()}`;
  }

  const paymentSortBy = PAYMENT_SORT_KEYS.includes(sp.sort as PaymentSortKey) ? (sp.sort as PaymentSortKey) : undefined;
  const paymentDir = sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined;
  const paymentPage = Math.max(1, Number(sp.page) || 1);
  const canEnter = management && actor.roles.includes("ACCOUNTANT");
  const strip = management ? await getPaymentsWorkStrip(actor) : null;
  // Podrazumijevani filter je „Za uparivanje” kad takvih uplata ima (inače „Svi”); „SVE” je izričit izbor svih uplata.
  const effectiveStatus = !management ? undefined : sp.status === ALL_PAYMENTS ? undefined : sp.status || (strip && strip.toMatch > 0 ? PAYMENT_FILTER_TO_MATCH : undefined);
  const paymentFilter = management ? { status: effectiveStatus } : undefined;
  const paymentResult = await listPayments(actor, paymentFilter, { sortBy: paymentSortBy, sortDir: paymentDir, page: paymentPage });
  const payments = paymentResult.rows;
  const [accounts, parties] = management ? await Promise.all([listAccounts(actor), listParties(actor)]) : [[], []];
  const bankAccounts = accounts.filter((a) => a.type === "BANK").map((a) => ({ id: a.id, name: a.name }));
  const listTitle = !management ? t("paymentsPage.listOwner") : effectiveStatus === PAYMENT_FILTER_TO_MATCH ? t("paymentsPage.listToMatch") : t("paymentsPage.listAll");

  return (
    <div className="space-y-6">
      <PageHeader
        title={management ? "Uplate i uparivanje" : t("paymentsPage.ownerTitle")}
        subtitle={management ? t("paymentsPage.subtitle") : undefined}
        backHref={management ? undefined : "/fakture"}
        backLabel={management ? undefined : t("nav.invoices")}
      />
      <Flash err={err} msg={msg} />

      {strip && (
        <section aria-label={t("paymentsPage.stripLabel")} className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surface p-3 text-sm text-ink-body">
          <span>
            {t("paymentsPage.toMatch")}:{" "}
            {strip.toMatch > 0 ? (
              <RowLink href={`/fakture/uplate?status=${PAYMENT_FILTER_TO_MATCH}`}>{strip.toMatch}</RowLink>
            ) : (
              <b>0</b>
            )}
          </span>
          {strip.sms.active ? (
            <>
              <span>
                {t("paymentsPage.smsPending")}: <b>{strip.sms.pending}</b>
              </span>
              <span>
                {t("paymentsPage.duplicates")}: <b>{strip.duplicates}</b>
              </span>
              {strip.unconfirmed > 0 && (
                <span>
                  {t("paymentsPage.unconfirmed")}: <b>{strip.unconfirmed}</b>
                </span>
              )}
              {strip.sms.rejected > 0 && (
                <span>
                  {t("paymentsPage.rejected")}: <b>{strip.sms.rejected}</b>
                </span>
              )}
            </>
          ) : (
            <span>
              {t("paymentsPage.smsOff")}{" "}
              <RowLink href="/podesavanja">{t("paymentsPage.smsOffLink")}</RowLink>
            </span>
          )}
          <span className="flex flex-wrap gap-2 md:ml-auto">
            <RowActionLink href="/fakture/uplate/sms">{t("paymentsPage.smsLink")}</RowActionLink>
            <RowActionLink href="/fakture/uplate/uskladjivanje">{t("paymentsPage.reconcileLink")}</RowActionLink>
          </span>
        </section>
      )}

      {canEnter && (
        <Card title={t("pdfImport.title")} hint={t("pdfImport.hint")}>
          <PdfStatementImport accounts={bankAccounts} toMatchCount={strip?.toMatch ?? 0} />
        </Card>
      )}

      <div>
        {management && (
          <FilterBar>
            {paymentSortBy && <input type="hidden" name="sort" value={paymentSortBy} />}
            {paymentDir && <input type="hidden" name="dir" value={paymentDir} />}
            <Field label={t("paymentsPage.statusLabel")}>
              <select name="status" defaultValue={sp.status === ALL_PAYMENTS ? ALL_PAYMENTS : effectiveStatus ?? ALL_PAYMENTS} className={inputCls}>
                <option value={ALL_PAYMENTS}>{t("paymentsPage.filterAll")}</option>
                <option value={PAYMENT_FILTER_TO_MATCH}>{t("paymentFilter.toMatch")}</option>
                <option value={PAYMENT_FILTER_ADVANCE}>{t("paymentFilter.advance")}</option>
                <option value="UNAPPLIED">{tEnum("paymentStatus", "UNAPPLIED")}</option>
                <option value="PARTIALLY_APPLIED">{tEnum("paymentStatus", "PARTIALLY_APPLIED")}</option>
                <option value="APPLIED">{tEnum("paymentStatus", "APPLIED")}</option>
                <option value="REVERSED">{tEnum("paymentStatus", "REVERSED")}</option>
              </select>
            </Field>
            {effectiveStatus && <BtnLink href={`/fakture/uplate?status=${ALL_PAYMENTS}`} variant="secondary">{t("paymentsPage.showAll")}</BtnLink>}
          </FilterBar>
        )}
        <Card title={listTitle}>
          <Table
            id="payments-table"
            caption={listTitle}
            headers={management ? paymentHeaders : ownerPaymentHeaders}
            sort={{ active: paymentSortBy, dir: paymentDir, hrefFor: (key, d) => uplateHref({ sort: key, dir: d }) }}
            empty={payments.length === 0}
            emptyTitle={t(payments.length === 0 && effectiveStatus ? "empty.filteredQuery.title" : "empty.payments.title")}
            emptyHint={
              payments.length === 0 && effectiveStatus
                ? t("empty.filteredQuery.hint")
                : canEnter
                  ? t("empty.payments.hint")
                  : undefined
            }
          >
            {payments.map((p) => {
              if (!management) {
                // Neto po fakturi (storno redovi su negativni): prikazuju se samo fakture na kojima uplata stvarno stoji.
                const net = new Map<string, { number: string; amount: ReturnType<typeof dec> }>();
                for (const a of p.allocations) {
                  const cur = net.get(a.invoiceId) ?? { number: a.invoice.number, amount: ZERO };
                  cur.amount = cur.amount.plus(dec(a.amount.toString()));
                  net.set(a.invoiceId, cur);
                }
                const applied = [...net.entries()].filter(([, v]) => v.amount.greaterThan(ZERO));
                return (
                  <tr key={p.id}>
                    <Td>{formatDate(p.date)}</Td>
                    <Td className="font-mono text-[13px]">{p.reference ?? "—"}</Td>
                    <Td>{formatMoney(p.amount.toString())}</Td>
                    <Td>
                      {applied.length === 0 ? "—" : (
                        <span className="flex flex-wrap gap-x-3 gap-y-1">
                          {applied.map(([invoiceId, v]) => (
                            <RowLink key={invoiceId} href={`/fakture/${invoiceId}`}>{v.number}</RowLink>
                          ))}
                        </span>
                      )}
                    </Td>
                    <Td><StatusBadge status={p.status} label={tEnum("paymentStatus", p.status)} /></Td>
                  </tr>
                );
              }
              return (
              <tr key={p.id}>
                <Td>{formatDate(p.date)}</Td>
                <Td>{p.payer ? partyDisplayName(p.payer) : p.payerNameRaw ?? "—"}</Td>
                <Td className="font-mono text-[13px]">{p.reference ?? "—"}</Td>
                <Td>{formatMoney(p.amount.toString())}</Td>
                <Td><StatusBadge status={p.status} label={tEnum("paymentStatus", p.status)} /></Td>
                <Td>
                  <RowActionLink href={`/fakture/uplate/${p.id}`}>
                    {p.status === "UNAPPLIED" || p.status === "PARTIALLY_APPLIED" ? "uparivanje" : "detalji"}
                  </RowActionLink>
                </Td>
              </tr>
              );
            })}
          </Table>
          <Pagination page={paymentResult.page} pageCount={paymentResult.pageCount} hrefFor={(p) => uplateHref({ page: String(p) })} />
        </Card>
      </div>

      {canEnter && (
        <div className="space-y-3">
          <details className="group">
            <ToggleBtn>{t("paymentsPage.manual.toggle")}</ToggleBtn>
            <div className="mt-3">
              <Card>
                <form action={enterPaymentAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t("paymentsPage.manual.account")}>
                    <select name="accountId" className={inputCls}>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("paymentsPage.manual.date")}>
                    <input name="date" type="date" required defaultValue={toZonedDateIso(new Date())} className={inputCls} />
                  </Field>
                  <Field label={t("paymentsPage.manual.amount")}><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
                  <Field label={t("paymentsPage.manual.payer")}>
                    <select name="payerId" className={inputCls}>
                      <option value="">{t("paymentsPage.manual.unknownPayer")}</option>
                      {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                    </select>
                  </Field>
                  <Field label={t("paymentsPage.manual.payerRaw")}><input name="payerNameRaw" className={inputCls} /></Field>
                  <Field label={t("paymentsPage.manual.reference")}><input name="reference" className={inputCls} /></Field>
                  <p className="text-[13px] text-slate-500 sm:col-span-2">{t("paymentsPage.manual.hint")}</p>
                  <div className="sm:col-span-2"><SubmitBtn variant="tonal">{t("paymentsPage.manual.submit")}</SubmitBtn></div>
                </form>
              </Card>
            </div>
          </details>
          <details className="group">
            <ToggleBtn>{t("csvImport.toggle")}</ToggleBtn>
            <div className="mt-3">
              <Card>
                <CsvImportForm accounts={bankAccounts} action={importCsvAction} />
              </Card>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
