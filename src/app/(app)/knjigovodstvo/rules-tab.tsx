// Tab „Pravila knjiženja” (kontni plan A2, Plans/kontni-plan-i-knjizenje-plan.md §3.6, §11): pokrivenost, namjene i
// vrste zaduženja, stavke naknade, kontrolna konta, pravila, šeme pod kapijom i pravilo raspodjele djelimične uplate.
// Ništa ne knjiži. Prava provjerava servis (ledgerConfig.ts); `canEdit` samo sakriva obrasce predsjedniku.
import { hasCapability } from "@/lib/accountingCapabilities";
import { getChartUpdate, getZevChart } from "@/server/services/chartOfAccounts";
import { getCoverage, listChargeTypes, listRules, suggestControlAccounts, ALLOCATION_RULES, RULE_KINDS } from "@/server/services/ledgerConfig";
import { formatDate, t, tEnum, tf, toZonedDateIso } from "@/lib/i18n";
import {
  Card, Flash, Table, Td, Field, inputCls, SubmitBtn, ToggleBtn, ConfirmAction, StatusBadge, RowAction, type ColumnSpec,
} from "@/components/ui";
import {
  applySuggestedControlsAction, confirmRuleAction, createChargeTypeAction, createPurposeAction, createRuleDraftAction,
  recordSchemaApprovalAction, revokeSchemaApprovalAction, setAllocationRuleAction, setChargeItemTypeAction,
  setControlAccountAction, starterSetupAction, withdrawRuleAction,
} from "@/server/actions/ledgerConfig";
import type { requireActor } from "@/server/actor";

type Actor = Awaited<ReturnType<typeof requireActor>>;

const coverageHeaders: ColumnSpec[] = [
  // Bez prioriteta (uvijek vidljivo): ista kategorija se pojavljuje i kao račun dobavljača i kao ručni rashod.
  { label: t("ledger.rules.coverage.colEvent") },
  { label: t("ledger.rules.coverage.colFor"), priority: "primary" },
  { label: t("ledger.rules.coverage.colRule"), priority: "detail" },
  { label: t("ledger.rules.coverage.colStatus") },
];
const purposeHeaders: ColumnSpec[] = [
  { label: t("ledger.rules.types.colCode") },
  { label: t("ledger.rules.types.colName"), priority: "primary" },
  { label: t("ledger.rules.types.colReserve") },
];
const typeHeaders: ColumnSpec[] = [
  { label: t("ledger.rules.types.colCode") },
  { label: t("ledger.rules.types.colName"), priority: "primary" },
  { label: t("ledger.rules.types.colPurpose"), priority: "secondary" },
  { label: t("ledger.rules.types.colItems"), priority: "detail" },
];
const itemHeaders: ColumnSpec[] = [
  { label: t("ledger.rules.items.colItem"), priority: "primary" },
  { label: t("ledger.rules.items.colType"), actions: true },
];
const controlHeaders: ColumnSpec[] = [
  { label: t("ledger.rules.controls.colRole"), priority: "primary" },
  { label: t("ledger.rules.controls.colFor") },
  { label: t("ledger.rules.controls.colAccount") },
  { label: t("ledger.rules.controls.colFrom") },
];
const ruleHeaders: ColumnSpec[] = [
  { label: t("ledger.rules.list.colEvent"), priority: "secondary" },
  { label: t("ledger.rules.list.colFor"), priority: "primary" },
  { label: t("ledger.rules.list.colAccount") },
  { label: t("ledger.rules.list.colPurpose"), priority: "detail" },
  { label: t("ledger.rules.list.colFrom") },
  { label: t("ledger.rules.list.colStatus") },
  { label: t("ledger.rules.list.colActions"), actions: true },
];

const COVER_TONE = { OK: "COVER_OK", MISSING: "COVER_MISSING", DRAFT: "COVER_DRAFT", GATED: "COVER_GATED" } as const;

export async function RulesTab({ actor }: { actor: Actor }) {
  const canEdit = hasCapability(actor.roles, "rules.edit");
  const canTypes = hasCapability(actor.roles, "chargeTypes.edit");
  const canConfirm = hasCapability(actor.roles, "rules.confirm");
  const canGate = hasCapability(actor.roles, "schema.approve");
  const [cov, chart, chargeTypes, rules, suggestions, chartUpdate] = await Promise.all([
    getCoverage(actor), getZevChart(actor), listChargeTypes(actor), listRules(actor), suggestControlAccounts(actor), getChartUpdate(actor),
  ]);
  const chargeItems = chargeTypes.flatMap((ct) => ct.chargeItems.map((i) => ({ ...i, chargeTypeId: ct.id })));
  const allItems = [...chargeItems, ...cov.unassignedItems.map((i) => ({ ...i, active: true, chargeTypeId: null as string | null }))]
    .sort((a, b) => a.name.localeCompare(b.name, "sr-Latn"));
  const postable = (chart?.accounts ?? []).filter((a) => a.postable && a.active);
  const isActive = cov.chartStatus === "ACTIVE";
  const today = toZonedDateIso(new Date());

  return (
    <div className="space-y-6">
      <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.rules.intro")}</p>
      {!isActive && <Flash warn={t("ledger.rules.needsActive")} />}
      {chartUpdate && <Flash warn={tf("ledger.sync.available", { verzija: chartUpdate.target.version, naziv: chartUpdate.target.name })} />}

      <Card title={t("ledger.rules.coverage.title")} hint={t("ledger.rules.coverage.hint")}>
        <div className="space-y-3">
          {cov.unassignedItems.length > 0 && <Flash inset warn={tf("ledger.rules.coverage.unassigned", { broj: cov.unassignedItems.length })} />}
          <Table
            id="rules-coverage" caption={t("ledger.rules.coverage.title")} headers={coverageHeaders} empty={cov.ruleRows.length === 0}
            emptyTitle={t("ledger.rules.coverage.empty")} emptyHint={t("ledger.rules.coverage.emptyHint")}
          >
            {cov.ruleRows.map((r) => (
              <tr key={`${r.kind}:${r.keyId}`}>
                <Td>{tEnum("eventKind", r.kind)}</Td>
                <Td>{r.keyLabel}</Td>
                <Td>{r.confirmed ? `${r.confirmed.counterAccount.code} ${r.confirmed.counterAccount.name} · ${formatDate(r.confirmed.validFrom)}` : "—"}</Td>
                <Td><StatusBadge status={COVER_TONE[r.status]} label={tEnum("coverageStatus", r.status)} /></Td>
              </tr>
            ))}
          </Table>
          <p className="max-w-[68ch] text-hint text-slate-500">{t("ledger.rules.coverage.revenue")}</p>
          {cov.linesWithoutType > 0 && (
            <p className="max-w-[68ch] text-hint text-slate-500">{tf("ledger.rules.coverage.manualLines", { broj: cov.linesWithoutType })}</p>
          )}
        </div>
      </Card>

      <section id="vrste">
        <Card title={t("ledger.rules.types.title")} hint={t("ledger.rules.types.hint")}>
          <div className="space-y-6">
            {canTypes && cov.purposes.length === 0 && chargeTypes.length === 0 && (
              <div className="space-y-2">
                <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.rules.types.starterHint")}</p>
                <form action={starterSetupAction}><SubmitBtn variant="tonal">{t("ledger.rules.types.starter")}</SubmitBtn></form>
              </div>
            )}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">{t("ledger.rules.types.purposes")}</h3>
              <Table id="rules-purposes" caption={t("ledger.rules.types.purposes")} headers={purposeHeaders} empty={cov.purposes.length === 0} emptyTitle={t("ledger.rules.types.purposesEmpty")}>
                {cov.purposes.map((p) => (
                  <tr key={p.id}>
                    <Td><span className="tabular-nums">{p.code}</span></Td>
                    <Td>{p.name}</Td>
                    <Td>{p.isCommonReserve ? t("ledger.rules.types.yes") : t("ledger.rules.types.no")}</Td>
                  </tr>
                ))}
              </Table>
              {canTypes && (
                <details className="group">
                  <ToggleBtn variant="tonal">{t("ledger.rules.types.addPurpose")}</ToggleBtn>
                  <form action={createPurposeAction} className="mt-3 flex flex-wrap items-end gap-3">
                    <Field label={t("ledger.rules.types.code")}><input name="code" required className={inputCls} /></Field>
                    <Field label={t("ledger.rules.types.name")}><input name="name" required className={inputCls} /></Field>
                    <Field label={t("ledger.rules.types.decisionRef")}><input name="decisionRef" className={inputCls} /></Field>
                    <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="isCommonReserve" value="1" className="h-4 w-4" />{t("ledger.rules.types.isReserve")}
                    </label>
                    <SubmitBtn variant="tonal">{t("ledger.rules.types.save")}</SubmitBtn>
                  </form>
                </details>
              )}
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">{t("ledger.rules.types.chargeTypes")}</h3>
              <Table id="rules-types" caption={t("ledger.rules.types.chargeTypes")} headers={typeHeaders} empty={chargeTypes.length === 0} emptyTitle={t("ledger.rules.types.typesEmpty")}>
                {chargeTypes.map((ct) => (
                  <tr key={ct.id}>
                    <Td><span className="tabular-nums">{ct.code}</span></Td>
                    <Td>{ct.name}</Td>
                    <Td>{ct.defaultPurpose ? `${ct.defaultPurpose.code} ${ct.defaultPurpose.name}` : "—"}</Td>
                    <Td>{ct.chargeItems.length ? ct.chargeItems.map((i) => i.name).join(", ") : "—"}</Td>
                  </tr>
                ))}
              </Table>
              {canTypes && (
                <details className="group">
                  <ToggleBtn variant="tonal">{t("ledger.rules.types.addType")}</ToggleBtn>
                  <form action={createChargeTypeAction} className="mt-3 flex flex-wrap items-end gap-3">
                    <Field label={t("ledger.rules.types.code")}><input name="code" required className={inputCls} /></Field>
                    <Field label={t("ledger.rules.types.name")}><input name="name" required className={inputCls} /></Field>
                    <Field label={t("ledger.rules.types.defaultPurpose")}>
                      <select name="defaultPurposeId" className={inputCls}>
                        <option value="">{t("ledger.rules.types.noPurpose")}</option>
                        {cov.purposes.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
                      </select>
                    </Field>
                    <SubmitBtn variant="tonal">{t("ledger.rules.types.save")}</SubmitBtn>
                  </form>
                </details>
              )}
            </div>
          </div>
        </Card>
      </section>

      <section id="stavke">
        <Card title={t("ledger.rules.items.title")} hint={t("ledger.rules.items.hint")}>
          <Table id="rules-items" caption={t("ledger.rules.items.title")} headers={itemHeaders} empty={allItems.length === 0} emptyTitle={t("ledger.rules.items.empty")}>
            {allItems.map((i) => (
              <tr key={i.id}>
                <Td>{i.name}</Td>
                <Td>
                  {canTypes ? (
                    <form action={setChargeItemTypeAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="chargeItemId" value={i.id} />
                      {/* key: poslije server akcije Next zadržava DOM, pa bi nekontrolisani select zadržao staru vrijednost. */}
                      <select key={`${i.chargeTypeId ?? ""}:${chargeTypes.length}`} name="chargeTypeId" defaultValue={i.chargeTypeId ?? ""} aria-label={i.name} className={`${inputCls} w-auto`}>
                        <option value="">{t("ledger.rules.items.none")}</option>
                        {chargeTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.code} {ct.name}</option>)}
                      </select>
                      <RowAction>{t("ledger.rules.items.save")}</RowAction>
                    </form>
                  ) : (
                    chargeTypes.find((ct) => ct.id === i.chargeTypeId)?.name ?? t("ledger.rules.items.none")
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </section>

      <section id="kontrolna">
        <Card title={t("ledger.rules.controls.title")} hint={t("ledger.rules.controls.hint")}>
          <div className="space-y-3">
            <Table id="rules-controls" caption={t("ledger.rules.controls.title")} headers={controlHeaders}>
              {cov.controlRows.map((c) => (
                <tr key={`${c.role}:${c.moneyAccountId}:${c.purposeId}`}>
                  <Td>{tEnum("controlRole", c.role)}</Td>
                  <Td>{c.forLabel || "—"}</Td>
                  <Td>
                    {c.current
                      ? <><span className="tabular-nums">{c.current.account.code}</span> {c.current.account.name}</>
                      : <StatusBadge status="NOT_SET" label={t("ledger.rules.controls.notSet")} />}
                  </Td>
                  <Td>{c.current ? formatDate(c.current.validFrom) : "—"}</Td>
                </tr>
              ))}
            </Table>
            {canEdit && isActive && suggestions.length > 0 && (
              <div className="space-y-2">
                <p className="max-w-[68ch] text-sm text-slate-600">
                  {tf("ledger.rules.controls.suggestion", {
                    lista: suggestions.map((s) => `${tEnum("controlRole", s.role)}${s.forLabel ? ` (${s.forLabel})` : ""} → ${s.accountCode}`).join(", "),
                  })}
                </p>
                <form action={applySuggestedControlsAction} className="flex flex-wrap items-end gap-3">
                  <Field label={t("ledger.rules.controls.validFrom")}><input type="date" name="validFrom" required defaultValue={today} className={inputCls} /></Field>
                  <SubmitBtn variant="tonal">{t("ledger.rules.controls.applySuggestion")}</SubmitBtn>
                </form>
              </div>
            )}
            {canEdit && isActive && (
              <details className="group">
                <ToggleBtn variant="tonal">{t("ledger.rules.controls.set")}</ToggleBtn>
                <form action={setControlAccountAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={t("ledger.rules.controls.role")}>
                    <select name="role" required className={inputCls}>
                      {(["MONEY_ACCOUNT", "OWNER_RECEIVABLE", "OWNER_ADVANCE", "UNIDENTIFIED_RECEIPTS", "SUPPLIER_PAYABLE"] as const).map((r) => (
                        <option key={r} value={r}>{tEnum("controlRole", r)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("ledger.rules.controls.moneyAccount")}>
                    <select name="moneyAccountId" className={inputCls}>
                      <option value="">{t("ledger.rules.controls.none")}</option>
                      {cov.moneyAccounts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.rules.controls.purpose")}>
                    <select name="purposeId" className={inputCls}>
                      <option value="">{t("ledger.rules.controls.none")}</option>
                      {cov.purposes.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.rules.controls.account")}>
                    <select name="accountId" required className={inputCls}>
                      {postable.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.rules.controls.validFrom")}><input type="date" name="validFrom" required defaultValue={today} className={inputCls} /></Field>
                  <Field label={t("ledger.rules.controls.reason")}><input name="reason" className={inputCls} /></Field>
                  <div className="sm:col-span-2 lg:col-span-3"><SubmitBtn variant="tonal">{t("ledger.rules.controls.submit")}</SubmitBtn></div>
                </form>
              </details>
            )}
          </div>
        </Card>
      </section>

      <section id="pravila">
        <Card title={t("ledger.rules.list.title")} hint={t("ledger.rules.list.hint")}>
          <div className="space-y-3">
            <Table
              id="rules-list" caption={t("ledger.rules.list.title")} headers={ruleHeaders} empty={rules.length === 0}
              emptyTitle={t("ledger.rules.list.empty")} emptyHint={canEdit ? t("ledger.rules.list.emptyHint") : undefined}
            >
              {rules.map((r) => (
                <tr key={r.id}>
                  <Td>{tEnum("eventKind", r.kind)}</Td>
                  <Td>{r.chargeType ? `${r.chargeType.code} ${r.chargeType.name}` : r.category?.name ?? "—"}</Td>
                  <Td><span className="tabular-nums">{r.counterAccount.code}</span> {r.counterAccount.name}</Td>
                  <Td>{r.purpose ? r.purpose.name : "—"}</Td>
                  <Td>{formatDate(r.validFrom)}</Td>
                  <Td>
                    <StatusBadge status={r.status} label={tEnum("postingRuleStatus", r.status)} />
                    {r.status === "CONFIRMED" && r.expertRef && <span className="mt-1 block text-hint text-slate-500">{tf("ledger.rules.list.confirmedBy", { ko: r.expertRef })}</span>}
                  </Td>
                  <Td>
                    {r.status === "DRAFT" && (
                      <div className="flex flex-wrap items-start gap-2">
                        {canConfirm && (
                          <ConfirmAction
                            trigger={t("ledger.rules.list.confirm")}
                            title={t("ledger.rules.list.confirmTitle")}
                            body={<p className="text-sm text-amber-900">{t("ledger.rules.list.confirmBody")}</p>}
                            confirmLabel={t("ledger.rules.list.confirmButton")}
                            confirmVariant="primary"
                            action={confirmRuleAction}
                            hiddenFields={{ id: r.id }}
                          >
                            <Field label={t("ledger.rules.list.confirmExpert")}>
                              <input name="expertRef" required defaultValue={r.expertRef ?? ""} className={inputCls} />
                            </Field>
                          </ConfirmAction>
                        )}
                        {canEdit && (
                          <ConfirmAction
                            trigger={t("ledger.rules.list.withdraw")}
                            title={t("ledger.rules.list.withdrawTitle")}
                            body={<p className="text-sm text-amber-900">{t("ledger.rules.list.withdrawBody")}</p>}
                            confirmLabel={t("ledger.rules.list.withdrawButton")}
                            action={withdrawRuleAction}
                            hiddenFields={{ id: r.id }}
                          >
                            <Field label={t("ledger.rules.list.withdrawReason")}><input name="reason" required className={inputCls} /></Field>
                          </ConfirmAction>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {canEdit && isActive && (
              <details className="group">
                <ToggleBtn variant="tonal">{t("ledger.rules.list.add")}</ToggleBtn>
                <form action={createRuleDraftAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={t("ledger.rules.list.kind")}>
                    <select name="kind" required className={inputCls}>
                      {Object.keys(RULE_KINDS).map((k) => <option key={k} value={k}>{tEnum("eventKind", k)}</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.rules.list.chargeType")}>
                    <select name="chargeTypeId" className={inputCls}>
                      <option value="">{t("ledger.rules.controls.none")}</option>
                      {chargeTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.code} {ct.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.rules.list.category")}>
                    <select name="categoryId" className={inputCls}>
                      <option value="">{t("ledger.rules.controls.none")}</option>
                      {cov.categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind === "INCOME" ? "prihod" : "rashod"})</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.rules.list.counterAccount")}>
                    <select name="counterAccountId" required className={inputCls}>
                      {postable.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.rules.list.purpose")}>
                    <select name="purposeId" className={inputCls}>
                      <option value="">{t("ledger.rules.list.purposeDefault")}</option>
                      {cov.purposes.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.rules.list.validFrom")}><input type="date" name="validFrom" required defaultValue={today} className={inputCls} /></Field>
                  <Field label={t("ledger.rules.list.reason")}><input name="reason" required className={inputCls} /></Field>
                  <Field label={t("ledger.rules.list.expertRef")}><input name="expertRef" className={inputCls} /></Field>
                  <div className="sm:col-span-2 lg:col-span-3"><SubmitBtn variant="tonal">{t("ledger.rules.list.submit")}</SubmitBtn></div>
                </form>
              </details>
            )}
          </div>
        </Card>
      </section>

      <section id="kapije">
        <Card title={t("ledger.rules.gates.title")} hint={t("ledger.rules.gates.hint")}>
          <ul className="divide-y divide-slate-100">
            {cov.gates.map((g) => (
              <li key={g.schema} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{tEnum("gatedSchema", g.schema)}</span>
                  <StatusBadge status={g.active ? "GATE_OPEN" : "GATE_CLOSED"} label={g.active ? t("ledger.rules.gates.open") : t("ledger.rules.gates.closed")} />
                </div>
                {g.active && (
                  <>
                    <p className="text-hint text-slate-500">{tf("ledger.rules.gates.approvedBy", { ko: g.active.expertName, datum: formatDate(g.active.approvedAt) })}</p>
                    <p className="max-w-[68ch] text-sm text-slate-700">{g.active.description}</p>
                  </>
                )}
                {g.schema === "REVENUE_RECOGNITION" && <p className="max-w-[68ch] text-hint text-slate-500">{t("ledger.rules.gates.revenueNote")}</p>}
                {canGate && !g.active && (
                  <ConfirmAction
                    trigger={t("ledger.rules.gates.record")}
                    title={t("ledger.rules.gates.recordTitle")}
                    body={<p className="text-sm text-amber-900">{t("ledger.rules.gates.recordBody")}</p>}
                    confirmLabel={t("ledger.rules.gates.recordButton")}
                    confirmVariant="primary"
                    action={recordSchemaApprovalAction}
                    hiddenFields={{ schema: g.schema }}
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Field label={t("ledger.rules.gates.description")}><textarea name="description" required rows={3} className={inputCls} /></Field>
                      </div>
                      <Field label={t("ledger.rules.gates.expertName")}><input name="expertName" required className={inputCls} /></Field>
                      <Field label={t("ledger.rules.gates.approvedAt")}><input type="date" name="approvedAt" required defaultValue={today} className={inputCls} /></Field>
                    </div>
                  </ConfirmAction>
                )}
                {canGate && g.active && (
                  <ConfirmAction
                    trigger={t("ledger.rules.gates.revoke")}
                    title={t("ledger.rules.gates.revokeTitle")}
                    body={<p className="text-sm text-amber-900">{t("ledger.rules.gates.revokeBody")}</p>}
                    confirmLabel={t("ledger.rules.gates.revokeButton")}
                    action={revokeSchemaApprovalAction}
                    hiddenFields={{ schema: g.schema }}
                  >
                    <Field label={t("ledger.rules.gates.revokeReason")}><input name="reason" required className={inputCls} /></Field>
                  </ConfirmAction>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section id="raspodjela">
        <Card title={t("ledger.rules.allocation.title")} hint={t("ledger.rules.allocation.hint")}>
          {canEdit ? (
            <form action={setAllocationRuleAction} className="flex flex-wrap items-end gap-3">
              <Field label={t("ledger.rules.allocation.label")}>
                <select key={cov.allocationRule} name="value" defaultValue={cov.allocationRule} className={inputCls}>
                  {ALLOCATION_RULES.map((v) => <option key={v} value={v}>{tEnum("allocationRule", v)}</option>)}
                </select>
              </Field>
              <SubmitBtn variant="tonal">{t("ledger.rules.allocation.save")}</SubmitBtn>
            </form>
          ) : (
            <StatusBadge status={cov.allocationRule === "NOT_SET" ? "NOT_SET" : "CONFIRMED"} label={tEnum("allocationRule", cov.allocationRule)} />
          )}
        </Card>
      </section>
    </div>
  );
}
