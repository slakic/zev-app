// Korak čarobnjaka za novi ZEV (Plans/zev-onboarding-wizard-plan.md §4, mockupi O-M02–O-M04).
// Korak iza trenutnog (prvog nekompletnog) se ne otvara — preusmjerava se na trenutni; isto pravilo
// server provjerava i u svakoj akciji (updateDraft). Faza A: koraci 1–4 i pregled; koraci 5–9 su
// vidljivi u StepNav-u, ali još nemaju ekran (zaustavljaju čarobnjak, onboardingProgress).
import { notFound, redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { getMyDraft, landingPath, reachableStepOrCurrent, stepSlug, type MyDraft } from "@/server/services/onboarding";
import {
  addAccountAction,
  addBuildingAction,
  addEntranceAction,
  removeAccountAction,
  removeBuildingAction,
  removeEntranceAction,
  saveAccountStepAction,
  saveZevStepAction,
  setNoAccountsAction,
} from "@/server/actions/onboardingWizard";
import { ONBOARDING_STEPS, stepBySlug, isStepReachable, type OnboardingStepKey } from "@/lib/onboarding/progress";
import { StepNav, type StepNavItem } from "@/components/step-nav";
import { PreconditionList } from "@/components/precondition-list";
import { PageHeader, Card, Field, Flash, Table, Td, RowAction, SubmitBtn, BtnLink, Btn, inputCls, type ColumnSpec } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatDate, t, tf } from "@/lib/i18n";

function Version({ draft }: { draft: MyDraft }) {
  return <input type="hidden" name="version" value={draft.version} />;
}

function navItems(draft: MyDraft, viewing: OnboardingStepKey): StepNavItem[] {
  return draft.progress.steps.map((s) => ({
    number: s.number,
    label: s.label,
    href: !isStepReachable(draft.progress, s.key) || s.key === viewing ? null : `/onboarding/${s.slug}`,
    complete: s.complete,
    viewing: s.key === viewing,
    optional: s.optional,
    readOnly: Boolean(draft.data.registerConfirmedAt) && ["buildings", "units", "commonAssets"].includes(s.key),
  }));
}

/** Obrazac „Sljedeći korak” (design-system §4.1): ✓/⚠ iz onboardingProgress + Nazad + jedno primary. */
function NextStepCard({ draft, stepKey }: { draft: MyDraft; stepKey: OnboardingStepKey }) {
  const idx = ONBOARDING_STEPS.findIndex((s) => s.key === stepKey);
  const step = draft.progress.steps[idx];
  const prev = draft.progress.steps[idx - 1];
  const next = draft.progress.steps[idx + 1];
  return (
    <Card title={t("onboarding.beforeNext")}>
      {step.checks.length > 0 && <PreconditionList items={step.checks} />}
      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 md:flex-row md:items-center md:justify-between">
        {prev ? <BtnLink href={`/onboarding/${prev.slug}`}>{tf("onboarding.back", { korak: prev.label })}</BtnLink> : <span />}
        {next &&
          (step.complete ? (
            <BtnLink href={`/onboarding/${next.slug}`} variant="primary">{tf("onboarding.next", { korak: next.label })}</BtnLink>
          ) : (
            <Btn type="button" variant="primary" disabled>{tf("onboarding.next", { korak: next.label })}</Btn>
          ))}
      </div>
    </Card>
  );
}

function AccountStep({ draft }: { draft: MyDraft }) {
  const p = draft.data.president;
  return (
    <Card>
      <form action={saveAccountStepAction} className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-3">
        <Version draft={draft} />
        <Field label={t("onboarding.account.firstName")}><input name="firstName" defaultValue={p.firstName} required className={inputCls} /></Field>
        <Field label={t("onboarding.account.lastName")}><input name="lastName" defaultValue={p.lastName} required className={inputCls} /></Field>
        <Field label={t("onboarding.account.phone")}><input name="phone" defaultValue={p.phone} className={inputCls} /></Field>
        <div className="md:col-span-3"><SubmitBtn variant="tonal">{t("onboarding.account.save")}</SubmitBtn></div>
      </form>
    </Card>
  );
}

function ZevStep({ draft }: { draft: MyDraft }) {
  const z = draft.data.zev;
  const f = (name: keyof typeof z, opts: { required?: boolean; type?: string; hint?: string } = {}) => (
    <Field label={t(`onboarding.zev.${name}`)} hint={opts.hint}>
      <input name={name} type={opts.type ?? "text"} defaultValue={z[name]} required={opts.required} className={inputCls} />
    </Field>
  );
  return (
    <Card>
      <form action={saveZevStepAction} className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        <Version draft={draft} />
        <div className="md:col-span-2">{f("legalName", { required: true })}</div>
        {f("shortName")}
        {f("registrationNumber", { required: true })}
        {f("jib", { required: true, hint: t("onboarding.zev.jibHint") })}
        {f("registeredAddress", { required: true })}
        {f("city", { required: true })}
        {f("municipality", { required: true })}
        {f("foundingDate", { type: "date" })}
        {f("registrationDate", { type: "date" })}
        <div className="md:col-span-2"><SubmitBtn variant="tonal">{t("onboarding.zev.save")}</SubmitBtn></div>
      </form>
    </Card>
  );
}

const accountHeaders: ColumnSpec[] = [
  { label: t("onboarding.accounts.name"), priority: "primary" },
  { label: t("onboarding.accounts.type") },
  { label: t("onboarding.accounts.bankName"), priority: "detail" },
  { label: t("onboarding.accounts.number") },
  { label: t("onboarding.accounts.openingBalance"), align: "right" },
  { label: t("onboarding.accounts.openingDate"), priority: "detail" },
  { label: "", actions: true },
];

function AccountsStep({ draft }: { draft: MyDraft }) {
  const isBasic = draft.tier === "BASIC";
  return (
    <>
      <Card title={t("onboarding.accounts.addTitle")}>
        <form action={addAccountAction} className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-3">
          <Version draft={draft} />
          <Field label={t("onboarding.accounts.type")}>
            <select name="type" className={inputCls} defaultValue="BANK">
              <option value="BANK">{t("onboarding.accounts.typeBank")}</option>
              <option value="CASH">{t("onboarding.accounts.typeCash")}</option>
            </select>
          </Field>
          <Field label={t("onboarding.accounts.name")}><input name="name" required placeholder={t("onboarding.accounts.namePlaceholder")} className={inputCls} /></Field>
          <Field label={t("onboarding.accounts.bankName")}><input name="bankName" className={inputCls} /></Field>
          <Field label={t("onboarding.accounts.number")} hint={t("onboarding.accounts.numberHint")}><input name="number" inputMode="numeric" className={inputCls} /></Field>
          <Field label={t("onboarding.accounts.openingBalance")}><input name="openingBalance" inputMode="decimal" defaultValue="0,00" className={`${inputCls} text-right tabular-nums`} /></Field>
          <Field label={t("onboarding.accounts.openingDate")}><input name="openingDate" type="date" required className={inputCls} /></Field>
          <div className="md:col-span-3"><SubmitBtn variant="tonal">{t("onboarding.accounts.add")}</SubmitBtn></div>
        </form>
      </Card>
      <Card title={t("onboarding.accounts.listTitle")}>
        <Table
          id="onboarding-accounts"
          caption={t("onboarding.accounts.listTitle")}
          headers={accountHeaders}
          empty={draft.data.accounts.length === 0}
          emptyTitle={t("onboarding.accounts.empty")}
          emptyHint={t("onboarding.accounts.emptyHint")}
        >
          {draft.data.accounts.map((a) => (
            <tr key={a.key}>
              <Td>{a.name}</Td>
              <Td>{a.type === "BANK" ? t("onboarding.accounts.typeBank") : t("onboarding.accounts.typeCash")}</Td>
              <Td>{a.bankName ?? "—"}</Td>
              <Td><span className="tabular-nums">{a.number ?? "—"}</span></Td>
              <Td><span className="tabular-nums">{formatMoney(a.openingBalance)}</span></Td>
              <Td>{formatDate(a.openingDate)}</Td>
              <Td>
                <form action={removeAccountAction}>
                  <Version draft={draft} />
                  <input type="hidden" name="key" value={a.key} />
                  <RowAction type="submit" variant="caution">{t("onboarding.accounts.remove")}</RowAction>
                </form>
              </Td>
            </tr>
          ))}
        </Table>
        {isBasic && draft.data.accounts.length === 0 && (
          <form action={setNoAccountsAction} className="mt-4 border-t border-slate-100 pt-4">
            <Version draft={draft} />
            <input type="hidden" name="value" value={draft.data.acks.noAccounts ? "false" : "true"} />
            <SubmitBtn variant="secondary">
              {draft.data.acks.noAccounts ? t("onboarding.accounts.noAccountsUndo") : t("onboarding.accounts.noAccounts")}
            </SubmitBtn>
          </form>
        )}
      </Card>
    </>
  );
}

const buildingHeaders: ColumnSpec[] = [
  { label: t("onboarding.buildings.name"), priority: "primary" },
  { label: t("onboarding.buildings.address") },
  { label: t("onboarding.buildings.cadastralRef"), priority: "detail" },
  { label: t("onboarding.buildings.yearBuilt"), align: "right", priority: "detail" },
  { label: t("onboarding.buildings.floorsCount"), align: "right", priority: "detail" },
  { label: "", actions: true },
];

const entranceHeaders: ColumnSpec[] = [
  { label: t("onboarding.buildings.entranceName"), priority: "primary" },
  { label: t("onboarding.buildings.building") },
  { label: "", actions: true },
];

function BuildingsStep({ draft }: { draft: MyDraft }) {
  const buildings = draft.data.buildings;
  const entrances = buildings.flatMap((b) => b.entrances.map((e) => ({ ...e, building: b })));
  return (
    <>
      <Card title={t("onboarding.buildings.addTitle")}>
        <form action={addBuildingAction} className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-3">
          <Version draft={draft} />
          <Field label={t("onboarding.buildings.name")}><input name="name" required placeholder={t("onboarding.buildings.namePlaceholder")} className={inputCls} /></Field>
          <div className="md:col-span-2"><Field label={t("onboarding.buildings.address")}><input name="address" required className={inputCls} /></Field></div>
          <Field label={t("onboarding.buildings.cadastralRef")}><input name="cadastralRef" className={inputCls} /></Field>
          <Field label={t("onboarding.buildings.yearBuilt")}><input name="yearBuilt" inputMode="numeric" className={inputCls} /></Field>
          <Field label={t("onboarding.buildings.floorsCount")}><input name="floorsCount" inputMode="numeric" className={inputCls} /></Field>
          <div className="md:col-span-3"><SubmitBtn variant="tonal">{t("onboarding.buildings.add")}</SubmitBtn></div>
        </form>
      </Card>
      <Card title={t("onboarding.steps.buildings")}>
        <Table
          id="onboarding-buildings"
          caption={t("onboarding.steps.buildings")}
          headers={buildingHeaders}
          empty={buildings.length === 0}
          emptyTitle={t("onboarding.buildings.empty")}
          emptyHint={t("onboarding.buildings.emptyHint")}
        >
          {buildings.map((b) => (
            <tr key={b.key}>
              <Td>{b.name}</Td>
              <Td>{b.address}</Td>
              <Td>{b.cadastralRef ?? "—"}</Td>
              <Td>{b.yearBuilt ?? "—"}</Td>
              <Td>{b.floorsCount ?? "—"}</Td>
              <Td>
                <form action={removeBuildingAction}>
                  <Version draft={draft} />
                  <input type="hidden" name="key" value={b.key} />
                  <RowAction type="submit" variant="caution">{t("onboarding.buildings.remove")}</RowAction>
                </form>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {buildings.length > 0 && (
        <Card title={t("onboarding.buildings.entrances")}>
          <form action={addEntranceAction} className="mb-4 grid grid-cols-1 items-end gap-x-4 gap-y-3 md:grid-cols-[1fr_1fr_auto]">
            <Version draft={draft} />
            <Field label={t("onboarding.buildings.building")}>
              <select name="buildingKey" className={inputCls}>
                {buildings.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={t("onboarding.buildings.entranceName")}><input name="name" required placeholder="A" className={inputCls} /></Field>
            <SubmitBtn variant="tonal">{t("onboarding.buildings.addEntrance")}</SubmitBtn>
          </form>
          <Table
            id="onboarding-entrances"
            caption={t("onboarding.buildings.entrances")}
            headers={entranceHeaders}
            empty={entrances.length === 0}
            emptyTitle={t("onboarding.buildings.noEntrances")}
          >
            {entrances.map((e) => (
              <tr key={e.key}>
                <Td>{e.name}</Td>
                <Td>{e.building.name}</Td>
                <Td>
                  <form action={removeEntranceAction}>
                    <Version draft={draft} />
                    <input type="hidden" name="buildingKey" value={e.building.key} />
                    <input type="hidden" name="entranceKey" value={e.key} />
                    <RowAction type="submit" variant="caution">{t("onboarding.buildings.removeEntrance")}</RowAction>
                  </form>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

function ReviewStep({ draft }: { draft: MyDraft }) {
  const items = draft.progress.steps.filter((s) => s.key !== "review").map((s) => ({ ok: s.complete, text: s.label }));
  return (
    <Card>
      <PreconditionList items={items} />
    </Card>
  );
}

function introFor(draft: MyDraft, key: OnboardingStepKey): string {
  switch (key) {
    case "account": return tf("onboarding.intro.account", { email: draft.email });
    case "zev": return t("onboarding.intro.zev");
    case "accounts": return draft.tier === "BASIC" ? t("onboarding.intro.accountsBasic") : t("onboarding.intro.accounts");
    case "buildings": return t("onboarding.intro.buildings");
    case "review": return t("onboarding.intro.review");
    default: return t("onboarding.intro.soon");
  }
}

export default async function OnboardingStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ step: string }>;
  searchParams: Promise<{ err?: string; msg?: string }>;
}) {
  const actor = await requireActor();
  const draft = await getMyDraft(actor);
  if (!draft) redirect(await landingPath(actor));
  const { step: slug } = await params;
  const meta = stepBySlug(slug);
  if (!meta) notFound();
  const key = reachableStepOrCurrent(draft, meta.key);
  if (key !== meta.key) redirect(`/onboarding/${stepSlug(key)}`);
  const { err, msg } = await searchParams;
  const step = draft.progress.steps.find((s) => s.key === key)!;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col md:flex-row">
      <div className="px-4 pt-4 md:min-h-[calc(100vh-57px)] md:w-64 md:shrink-0 md:border-r md:border-slate-200 md:bg-white md:px-3 md:py-5">
        <StepNav title={draft.data.zev.legalName || t("onboarding.shellTitle")} items={navItems(draft, key)} />
      </div>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="max-w-5xl">
          <PageHeader title={step.label} subtitle={introFor(draft, key)} />
          <Flash err={err} msg={msg === "saved" ? t("onboarding.saved") : undefined} />
          <div className="space-y-6">
            {key === "account" && <AccountStep draft={draft} />}
            {key === "zev" && <ZevStep draft={draft} />}
            {key === "accounts" && <AccountsStep draft={draft} />}
            {key === "buildings" && <BuildingsStep draft={draft} />}
            {key === "review" && <ReviewStep draft={draft} />}
            <NextStepCard draft={draft} stepKey={key} />
          </div>
        </div>
      </main>
    </div>
  );
}
