import { requireActor } from "@/server/actor";
import { hasCapability } from "@/lib/accountingCapabilities";
import { getEntry } from "@/server/services/journal";
import { openingStatus, reconcileOpening } from "@/server/services/openingBalance";
import { listFiscalYears } from "@/server/services/chartOfAccounts";
import { partyDisplayName } from "@/server/services/ownership";
import { dec, formatMoney } from "@/lib/money";
import { ledgerMessage } from "@/lib/ledgerMessages";
import { formatDate, t, tf } from "@/lib/i18n";
import { BtnLink, Card, ConfirmAction, Field, Flash, inputCls, PageHeader, StatusBadge, SubmitBtn, Table, Td, type ColumnSpec } from "@/components/ui";
import { JournalEditor } from "@/components/journal-editor";
import { deleteJournalDraftAction, postOpeningAction, prepareOpeningAction, saveOpeningLinesAction } from "@/server/actions/journal";
import { editorLabels, editorOptionsFor } from "../nalozi/editor-props";

const O = (k: string) => t(`ledger.journal.opening.${k}`);

const generatedHeaders: ColumnSpec[] = [
  { label: O("colAccount"), priority: "primary" },
  { label: O("colSource"), priority: "secondary" },
  { label: O("colDebit"), align: "right" },
  { label: O("colCredit"), align: "right" },
];
const reconHeaders: ColumnSpec[] = [
  { label: O("colControl"), priority: "primary" },
  { label: O("colLedger"), align: "right" },
  { label: O("colAnalytics"), align: "right" },
  { label: O("colOperational"), align: "right" },
  { label: O("colState") },
];

const cents = (v: { toString(): string }) => Math.round(Number(v.toString()) * 100);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Nalog početnog stanja (B1b, Plans/kontni-plan-b1-nalozi-plan.md §4): prijedlog iz evidencije na dan, ručne stavke
 * koje evidencija ne zna, usklađivanje po kontrolnom kontu i knjiženje tek kad se sve slaže.
 */
export default async function OpeningBalancePage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const canPrepare = hasCapability(actor.roles, "journal.prepare");
  const canPost = hasCapability(actor.roles, "journal.post");
  const status = await openingStatus(actor);
  const draft = status.draft ? await getEntry(actor, status.draft.id) : null;
  const recon = draft ? await reconcileOpening(actor, draft.id) : null;
  const options = draft && canPrepare ? await editorOptionsFor(actor) : null;
  const years = await listFiscalYears(actor);
  const openYears = years.filter((y) => y.status === "OPEN").sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  const defaultStart = draft ? iso(draft.postingDate) : openYears[0] ? iso(openYears[0].startDate) : "";

  const generated = draft?.lines.filter((l) => l.openingSourceType) ?? [];
  const manual = draft?.lines.filter((l) => !l.openingSourceType) ?? [];
  const base = {
    debit: generated.reduce((s, l) => s + cents(l.debit), 0),
    credit: generated.reduce((s, l) => s + cents(l.credit), 0),
  };
  const analytics = (l: NonNullable<typeof draft>["lines"][number]) =>
    [l.description, l.party ? partyDisplayName(l.party) : null, l.supplier?.name, l.purpose ? `${l.purpose.code} ${l.purpose.name}` : null]
      .filter(Boolean).join(" · ");

  return (
    <div>
      <PageHeader title={O("title")} subtitle={O("subtitle")} backHref="/knjigovodstvo?tab=nalozi" backLabel={O("back")} />
      <Flash msg={ledgerMessage(sp.msg)} err={sp.err} />
      <div className="space-y-6">
        <p className="max-w-[68ch] text-sm text-slate-600">{O("intro")}</p>

        {status.posted && (
          <Card title={O("postedTitle")}>
            <div className="space-y-3">
              <p className="text-sm">{tf("ledger.journal.opening.postedBody", { broj: status.posted.number ?? "" })}</p>
              <BtnLink href={`/knjigovodstvo/nalozi/${status.posted.id}`} variant="tonal">{O("openEntry")}</BtnLink>
            </div>
          </Card>
        )}

        {!status.posted && canPrepare && (
          <Card title={O("prepareTitle")}>
            {draft ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">{recon && tf("ledger.journal.opening.asOf", { datum: formatDate(`${recon.asOfIso}T12:00:00Z`) })}</p>
                <ConfirmAction
                  trigger={O("prepareAgain")}
                  title={O("prepareAgainTitle")}
                  body={<p className="text-sm text-amber-900">{O("prepareAgainBody")}</p>}
                  confirmLabel={O("prepareAgainConfirm")}
                  action={prepareOpeningAction}
                  hiddenFields={{ startDate: defaultStart }}
                />
              </div>
            ) : (
              <form action={prepareOpeningAction} className="flex flex-wrap items-end gap-3">
                <Field label={O("startDate")} hint={O("startHint")}>
                  <input type="date" name="startDate" required defaultValue={defaultStart} className={inputCls} />
                </Field>
                <SubmitBtn variant="primary">{O("prepare")}</SubmitBtn>
              </form>
            )}
          </Card>
        )}

        {draft && recon && (
          <>
            <Card title={O("generatedTitle")}>
              <Table id="opening-generated" caption={O("generatedTitle")} headers={generatedHeaders} empty={generated.length === 0} emptyTitle={O("generatedEmpty")}>
                {generated.map((l) => (
                  <tr key={l.id}>
                    <Td><span className="tabular-nums">{l.account.code}</span> {l.account.name}</Td>
                    <Td>{analytics(l)}</Td>
                    <Td><span className="whitespace-nowrap tabular-nums">{dec(l.debit.toString()).gt(0) ? formatMoney(l.debit.toString()) : ""}</span></Td>
                    <Td><span className="whitespace-nowrap tabular-nums">{dec(l.credit.toString()).gt(0) ? formatMoney(l.credit.toString()) : ""}</span></Td>
                  </tr>
                ))}
              </Table>
            </Card>

            {options && (
              <Card title={O("manualTitle")} hint={O("manualHint")}>
                <JournalEditor
                  action={saveOpeningLinesAction}
                  entryId={draft.id}
                  options={options}
                  labels={{ ...editorLabels, total: O("totalWithGenerated") }}
                  fixedDates
                  base={base}
                  initial={{
                    documentDate: iso(draft.documentDate), postingDate: iso(draft.postingDate), description: draft.description,
                    lines: manual.map((l) => ({
                      accountId: l.accountId, debit: dec(l.debit.toString()).gt(0) ? l.debit.toFixed(2) : "", credit: dec(l.credit.toString()).gt(0) ? l.credit.toFixed(2) : "",
                      partyId: l.partyId ?? "", unitId: l.unitId ?? "", supplierId: l.supplierId ?? "", projectId: l.projectId ?? "", purposeId: l.purposeId ?? "", description: l.description ?? "",
                    })),
                  }}
                />
              </Card>
            )}

            <Card title={O("reconTitle")} hint={O("reconHint")}>
              <div className="space-y-4">
                <Table id="opening-recon" caption={O("reconTitle")} headers={reconHeaders} empty={recon.rows.length === 0} emptyTitle={O("reconEmpty")}>
                  {recon.rows.map((r) => (
                    <tr key={r.accountId}>
                      <Td><span className="tabular-nums">{r.code}</span> {r.name} <span className="text-hint text-slate-500">({r.roleLabel})</span></Td>
                      <Td><span className="whitespace-nowrap tabular-nums">{formatMoney(r.ledger)}</span></Td>
                      <Td><span className="whitespace-nowrap tabular-nums">{formatMoney(r.analytics)}</span></Td>
                      <Td><span className="whitespace-nowrap tabular-nums">{formatMoney(r.operational)}</span></Td>
                      <Td><StatusBadge status={r.ok ? "COVER_OK" : "COVER_MISSING"} label={r.ok ? O("ok") : O("diff")} /></Td>
                    </tr>
                  ))}
                </Table>
                <p className="text-sm tabular-nums">{tf("ledger.journal.opening.totals", { duguje: formatMoney(recon.debit, "").trim(), potrazuje: formatMoney(recon.credit, "").trim() })}</p>
                {!recon.ready && (
                  <Flash inset warn={<><strong>{O("blocked")}</strong><ul className="mt-1 list-disc pl-5">{recon.problems.map((p) => <li key={p}>{p}</li>)}</ul></>} />
                )}
                <div className="flex flex-wrap items-start gap-3">
                  {canPost && recon.ready && (
                    <ConfirmAction
                      trigger={O("post")}
                      title={O("postTitle")}
                      body={<p className="text-sm text-amber-900">{O("postBody")}</p>}
                      confirmLabel={O("postConfirm")}
                      confirmVariant="primary"
                      action={postOpeningAction}
                      hiddenFields={{ id: draft.id }}
                    />
                  )}
                  {canPrepare && (
                    <ConfirmAction
                      trigger={O("delete")}
                      title={O("deleteTitle")}
                      body={<p className="text-sm text-amber-900">{O("deleteBody")}</p>}
                      confirmLabel={O("deleteConfirm")}
                      action={deleteJournalDraftAction}
                      hiddenFields={{ id: draft.id }}
                    />
                  )}
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
