import { requireActor } from "@/server/actor";
import { defaultDryRunDate, runDryRun } from "@/server/services/ledgerDryRun";
import { ledgerStart } from "@/server/services/ledgerEvents";
import { prisma } from "@/lib/prisma";
import { requireZev } from "@/server/auth/guards";
import { formatDate, formatDateTime, t, tEnum, tf } from "@/lib/i18n";
import { Card, Field, FilterBar, Flash, inputCls, PageHeader, RowLink, StatusBadge, Table, Td, type ColumnSpec } from "@/components/ui";
import { amt, km } from "../izvjestaji/shared";

const D = (k: string) => t(`ledger.dryRun.${k}`);
const LEVEL_STATUS = { ok: "COVER_OK", warn: "COVER_MISSING", fail: "FAILED" } as const;

const reconOpeningHeaders: ColumnSpec[] = [
  { label: t("ledger.journal.opening.colControl"), priority: "primary" },
  { label: t("ledger.journal.opening.colLedger"), align: "right" },
  { label: t("ledger.journal.opening.colOperational"), align: "right" },
  { label: t("ledger.journal.opening.colState") },
];
const kindHeaders: ColumnSpec[] = [
  { label: D("col.kind"), priority: "primary" },
  { label: D("col.posted"), align: "right" },
  { label: D("col.waiting"), align: "right" },
];
const waitingHeaders: ColumnSpec[] = [
  { label: D("col.reason"), priority: "primary" },
  { label: D("col.count"), align: "right" },
  { label: D("col.amount"), align: "right" },
  { label: D("col.examples"), priority: "secondary" },
];
const trialHeaders: ColumnSpec[] = [
  { label: t("ledger.reports.col.account"), priority: "primary" },
  { label: t("ledger.reports.col.closingDebit"), align: "right" },
  { label: t("ledger.reports.col.closingCredit"), align: "right" },
];
const reconHeaders: ColumnSpec[] = [
  { label: t("ledger.reports.recon.col.control"), priority: "primary" },
  { label: t("ledger.reports.recon.col.difference"), align: "right" },
  { label: t("ledger.reports.recon.col.waiting"), align: "right" },
  { label: t("ledger.reports.recon.col.unexplained"), align: "right" },
];

/**
 * Probno knjiženje (B4, Plans/kontni-plan-b4-proba-i-aktivacija-plan.md §2): pokreće se tek na „Pokreni probu”
 * (`pokreni=1` iz forme — ne pri običnom otvaranju, da prefetch ne pokreće probu), radi sve u transakciji koja se
 * poništava i prikazuje spremnost, početno stanje, događaje, bruto bilans i usklađivanje.
 */
export default async function DryRunPage({ searchParams }: { searchParams: Promise<{ datum?: string; pokreni?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const start = await ledgerStart(prisma, requireZev(actor));
  const date = sp.datum && /^\d{4}-\d{2}-\d{2}$/.test(sp.datum) ? sp.datum : await defaultDryRunDate(actor);
  let error: string | null = null;
  const r = !start && sp.pokreni === "1"
    ? await runDryRun(actor, { startDate: date }).catch((e: unknown) => { error = e instanceof Error ? e.message : String(e); return null; })
    : null;

  return (
    <div>
      <PageHeader title={D("title")} subtitle={D("subtitle")} backHref="/knjigovodstvo?tab=nalozi" backLabel={D("back")} />
      {start ? (
        <Flash msg={<>{tf("ledger.dryRun.active", { datum: formatDate(start) })} <RowLink href="/knjigovodstvo/izvjestaji/uskladjivanje">{D("openRecon")}</RowLink></>} />
      ) : (
        <>
          <Flash err={error ?? undefined} />
          <p className="mb-4 max-w-[68ch] text-sm text-slate-600">{D("intro")}</p>
          <FilterBar submitLabel={D("run")}>
            <input type="hidden" name="pokreni" value="1" />
            <Field label={D("startDate")}>
              <input type="date" name="datum" defaultValue={date} required className={inputCls} />
            </Field>
          </FilterBar>
          {!r ? (
            !error && <p className="max-w-[68ch] text-sm text-slate-600">{D("notRun")}</p>
          ) : (
            <div className="space-y-6">
              <p className="text-hint text-slate-500">{tf("ledger.dryRun.ranAt", { vrijeme: formatDateTime(r.ranAt), datum: formatDate(r.startDate), dan: formatDate(r.asOf) })}</p>

              <Card title={D("checksTitle")} hint={D("checksHint")}>
                <ul className="space-y-2">
                  {r.checks.map((c) => (
                    <li key={c.key} className="flex flex-wrap items-start gap-2 text-sm">
                      <StatusBadge status={LEVEL_STATUS[c.level]} label={D(`level.${c.level}`)} />
                      <span className="max-w-[68ch] text-slate-700">{c.text}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title={D("openingTitle")}>
                {r.opening.error ? (
                  <p className="max-w-[68ch] text-sm font-medium text-red-700">{tf("ledger.dryRun.openingError", { greska: r.opening.error })}</p>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-slate-700">{tf("ledger.dryRun.openingSummary", { stavke: r.opening.lines, duguje: km(r.opening.debit), potrazuje: km(r.opening.credit) })}</p>
                    {r.opening.empty && <p className="max-w-[68ch] text-sm text-amber-900">{D("empty")}</p>}
                    {r.opening.balancing && (
                      <p className="max-w-[68ch] text-sm text-amber-900">
                        {tf("ledger.dryRun.balancing", {
                          iznos: km(r.opening.balancing.amount), konto: `${r.opening.balancing.code} ${r.opening.balancing.name}`,
                          strana: D(r.opening.balancing.side === "D" ? "sideD" : "sideP"),
                        })}
                      </p>
                    )}
                    <Table id="dry-opening" caption={D("openingTitle")} headers={reconOpeningHeaders} empty={r.opening.rows.length === 0} emptyTitle={t("ledger.journal.opening.reconEmpty")}>
                      {r.opening.rows.map((x) => (
                        <tr key={x.accountId}>
                          <Td><span className="tabular-nums">{x.code}</span> {x.name} <span className="text-hint text-slate-500">({x.roleLabel})</span></Td>
                          <Td><span className="whitespace-nowrap tabular-nums">{km(x.ledger)}</span></Td>
                          <Td><span className="whitespace-nowrap tabular-nums">{km(x.operational)}</span></Td>
                          <Td><StatusBadge status={x.ok ? "COVER_OK" : "COVER_MISSING"} label={t(x.ok ? "ledger.journal.opening.ok" : "ledger.journal.opening.diff")} /></Td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                )}
              </Card>

              {r.events && (
                <Card title={tf("ledger.dryRun.eventsTitle", { od: formatDate(r.startDate), do: formatDate(r.asOf) })}>
                  {r.events.total === 0 ? (
                    <p className="text-sm text-slate-600">{D("eventsNone")}</p>
                  ) : (
                    <div className="space-y-6">
                      <p className="text-sm text-slate-700">{tf("ledger.dryRun.eventsSummary", { proknjizeno: r.events.posted, ceka: r.events.waiting, ukupno: r.events.total })}</p>
                      <Table id="dry-kinds" caption={D("col.kind")} headers={kindHeaders}>
                        {r.events.byKind.map((k) => (
                          <tr key={k.kind}>
                            <Td>{tEnum("eventKind", k.kind)}</Td>
                            <Td><span className="tabular-nums">{k.posted}</span></Td>
                            <Td><span className="tabular-nums">{k.waiting || ""}</span></Td>
                          </tr>
                        ))}
                      </Table>
                      {r.events.groups.length > 0 && (
                        <div>
                          <h3 className="mb-2 text-sm font-semibold text-slate-700">{D("waitingTitle")}</h3>
                          <Table id="dry-waiting" caption={D("waitingTitle")} headers={waitingHeaders}>
                            {r.events.groups.map((g) => (
                              <tr key={`${g.status}|${g.kind}|${g.detail}`}>
                                <Td>
                                  <StatusBadge status={g.status} label={tEnum("eventStatus", g.status)} />
                                  <span className="mt-1 block max-w-[48ch] text-hint text-slate-600">{g.status === "WAITING_PREDECESSOR" ? tEnum("eventKind", g.kind) : g.detail}</span>
                                </Td>
                                <Td><span className="tabular-nums">{g.count}</span></Td>
                                <Td><span className="whitespace-nowrap tabular-nums">{km(g.amount)}</span></Td>
                                <Td>
                                  {g.examples.map((e, i) => (
                                    <span key={i} className="block">{e.href ? <RowLink href={e.href}>{e.label}</RowLink> : e.label}</span>
                                  ))}
                                </Td>
                              </tr>
                            ))}
                          </Table>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

              {r.trial && (
                <Card title={tf("ledger.dryRun.trialTitle", { dan: formatDate(r.asOf) })}>
                  <Table id="dry-trial" caption={tf("ledger.dryRun.trialTitle", { dan: formatDate(r.asOf) })} headers={trialHeaders} empty={r.trial.rows.length === 0} emptyTitle={t("ledger.reports.empty")}>
                    {r.trial.rows.map((x) => (
                      <tr key={x.accountId}>
                        <Td><span className="tabular-nums">{x.code}</span> {x.name}</Td>
                        <Td><span className="whitespace-nowrap tabular-nums">{amt(x.closingDebit)}</span></Td>
                        <Td><span className="whitespace-nowrap tabular-nums">{amt(x.closingCredit)}</span></Td>
                      </tr>
                    ))}
                    {r.trial.rows.length > 0 && (
                      <tr>
                        <Td><span className="font-semibold">{t("ledger.reports.total")}</span></Td>
                        <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(r.trial.totals.closingDebit)}</span></Td>
                        <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(r.trial.totals.closingCredit)}</span></Td>
                      </tr>
                    )}
                  </Table>
                </Card>
              )}

              {r.recon && (
                <Card title={tf("ledger.dryRun.reconTitle", { dan: formatDate(r.asOf) })}>
                  <div className="space-y-4">
                    <p className={`max-w-[68ch] text-sm ${r.recon.ok ? "text-slate-700" : "font-medium text-red-700"}`}>{D(r.recon.ok ? "reconOk" : "reconDiff")}</p>
                    <Table id="dry-recon" caption={tf("ledger.dryRun.reconTitle", { dan: formatDate(r.asOf) })} headers={reconHeaders}>
                      {r.recon.rows.map((x) => (
                        <tr key={x.key}>
                          <Td><span className="block first-letter:uppercase">{x.moneyAccount ? `${x.roleLabel}: ${x.moneyAccount}` : x.roleLabel}</span></Td>
                          <Td><span className="whitespace-nowrap tabular-nums">{km(x.difference)}</span></Td>
                          <Td><span className="whitespace-nowrap tabular-nums">{km(x.waiting)}</span></Td>
                          <Td><span className={`whitespace-nowrap tabular-nums ${x.unexplained !== "0.00" ? "font-semibold text-red-700" : ""}`}>{km(x.unexplained)}</span></Td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
