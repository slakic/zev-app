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
  addCommonAssetAction,
  addEntranceAction,
  addUnitAction,
  confirmRegisterAction,
  removeCommonAssetAction,
  removeUnitAction,
  unlockRegisterAction,
  updateUnitAction,
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
import { PageHeader, Card, Field, Flash, Table, Td, RowAction, RowActionLink, SubmitBtn, BtnLink, Btn, ConfirmAction, StatusBadge, inputCls, type ColumnSpec } from "@/components/ui";
import { dec, formatMoney } from "@/lib/money";
import { sharesSum, sumIsHundred } from "@/lib/registerRules";
import type { DraftUnit } from "@/lib/onboarding/draft";
import { formatDate, t, tEnum, tf } from "@/lib/i18n";

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

function LockedNote() {
  return <Flash warn={t("onboarding.units.locked")} />;
}

function BuildingsStep({ draft }: { draft: MyDraft }) {
  const buildings = draft.data.buildings;
  const entrances = buildings.flatMap((b) => b.entrances.map((e) => ({ ...e, building: b })));
  const locked = Boolean(draft.data.registerConfirmedAt);
  return (
    <>
      {locked && <LockedNote />}
      {!locked && <Card title={t("onboarding.buildings.addTitle")}>
        <form action={addBuildingAction} className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-3">
          <Version draft={draft} />
          <Field label={t("onboarding.buildings.name")}><input name="name" required placeholder={t("onboarding.buildings.namePlaceholder")} className={inputCls} /></Field>
          <div className="md:col-span-2"><Field label={t("onboarding.buildings.address")}><input name="address" required className={inputCls} /></Field></div>
          <Field label={t("onboarding.buildings.cadastralRef")}><input name="cadastralRef" className={inputCls} /></Field>
          <Field label={t("onboarding.buildings.yearBuilt")}><input name="yearBuilt" inputMode="numeric" className={inputCls} /></Field>
          <Field label={t("onboarding.buildings.floorsCount")}><input name="floorsCount" inputMode="numeric" className={inputCls} /></Field>
          <div className="md:col-span-3"><SubmitBtn variant="tonal">{t("onboarding.buildings.add")}</SubmitBtn></div>
        </form>
      </Card>}
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
                {!locked && (
                  <form action={removeBuildingAction}>
                    <Version draft={draft} />
                    <input type="hidden" name="key" value={b.key} />
                    <RowAction type="submit" variant="caution">{t("onboarding.buildings.remove")}</RowAction>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {buildings.length > 0 && (
        <Card title={t("onboarding.buildings.entrances")}>
          {!locked && <form action={addEntranceAction} className="mb-4 grid grid-cols-1 items-end gap-x-4 gap-y-3 md:grid-cols-[1fr_1fr_auto]">
            <Version draft={draft} />
            <Field label={t("onboarding.buildings.building")}>
              <select name="buildingKey" className={inputCls}>
                {buildings.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={t("onboarding.buildings.entranceName")}><input name="name" required placeholder="A" className={inputCls} /></Field>
            <SubmitBtn variant="tonal">{t("onboarding.buildings.addEntrance")}</SubmitBtn>
          </form>}
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
                  {!locked && (
                    <form action={removeEntranceAction}>
                      <Version draft={draft} />
                      <input type="hidden" name="buildingKey" value={e.building.key} />
                      <input type="hidden" name="entranceKey" value={e.key} />
                      <RowAction type="submit" variant="caution">{t("onboarding.buildings.removeEntrance")}</RowAction>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

const UNIT_TYPE_OPTIONS = ["APARTMENT", "BUSINESS", "GARAGE", "GARAGE_SPACE", "OTHER"] as const;
const fmtDec = (v: string) => dec(v).toFixed(2).replace(".", ",");

function placeOf(draft: MyDraft, u: { buildingKey: string; entranceKey: string | null }): string {
  const b = draft.data.buildings.find((x) => x.key === u.buildingKey);
  const e = b?.entrances.find((x) => x.key === u.entranceKey);
  return `${b?.name ?? "?"} · ${e ? `${t("onboarding.units.entrance")} ${e.name}` : t("onboarding.units.noEntrance")}`;
}

function placeOptions(draft: MyDraft) {
  return draft.data.buildings.flatMap((b) => [
    { value: b.key, label: placeOf(draft, { buildingKey: b.key, entranceKey: null }) },
    ...b.entrances.map((e) => ({ value: `${b.key}|${e.key}`, label: placeOf(draft, { buildingKey: b.key, entranceKey: e.key }) })),
  ]);
}

/** Zbir udjela uživo (mockup O-M02 ④): isti prag kao utvrđivanje registra (sumIsHundred). */
function ShareSum({ units }: { units: DraftUnit[] }) {
  const sum = sharesSum(units.map((u) => u.ownershipShare));
  const ok = units.length > 0 && sumIsHundred(sum);
  const diff = dec(100).minus(sum);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm text-slate-700">
      <span className="font-medium">{t("onboarding.units.sum")}</span>
      <StatusBadge status={ok ? "OWNER_SUM_OK" : "OWNER_SUM_WARN"} label={`${fmtDec(sum.toString())} %`} />
      {!ok && units.length > 0 && (
        <span className="text-[13px] text-slate-600">
          {diff.greaterThan(0)
            ? tf("onboarding.units.sumMissing", { razlika: fmtDec(diff.toString()) })
            : tf("onboarding.units.sumOver", { razlika: fmtDec(diff.abs().toString()) })}
        </span>
      )}
    </div>
  );
}

const unitHeaders: ColumnSpec[] = [
  { label: t("onboarding.units.label"), priority: "primary" },
  { label: t("onboarding.units.type") },
  { label: t("onboarding.units.building"), priority: "detail" },
  { label: t("onboarding.units.floor"), align: "right", priority: "detail" },
  { label: t("onboarding.units.usableArea"), align: "right" },
  { label: t("onboarding.units.ownershipShare"), align: "right" },
  { label: "", actions: true },
];

function UnitForm({ draft, editing, keepPlace, keepType }: { draft: MyDraft; editing: DraftUnit | null; keepPlace?: string; keepType?: string }) {
  const place = editing ? (editing.entranceKey ? `${editing.buildingKey}|${editing.entranceKey}` : editing.buildingKey) : keepPlace;
  return (
    <Card
      title={editing ? tf("onboarding.units.editTitle", { oznaka: editing.label }) : t("onboarding.units.addTitle")}
      hint={t("onboarding.units.addHint")}
    >
      <form action={editing ? updateUnitAction : addUnitAction} className="grid grid-cols-2 items-start gap-x-4 gap-y-3 md:grid-cols-8">
        <Version draft={draft} />
        {editing && <input type="hidden" name="key" value={editing.key} />}
        <div className="col-span-2">
          <Field label={t("onboarding.units.building")}>
            <select name="place" defaultValue={place} className={inputCls}>
              {placeOptions(draft).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t("onboarding.units.type")}>
          <select name="type" defaultValue={editing?.type ?? keepType ?? "APARTMENT"} className={inputCls}>
            {UNIT_TYPE_OPTIONS.map((v) => <option key={v} value={v}>{tEnum("unitType", v)}</option>)}
          </select>
        </Field>
        <Field label={t("onboarding.units.label")}>
          <input name="label" required autoFocus={!editing && Boolean(keepPlace)} defaultValue={editing?.label} placeholder={t("onboarding.units.labelPlaceholder")} className={inputCls} />
        </Field>
        <Field label={t("onboarding.units.floor")}>
          <input name="floor" inputMode="numeric" defaultValue={editing?.floor ?? ""} className={inputCls} />
        </Field>
        <Field label={t("onboarding.units.usableArea")}>
          <input name="usableArea" required inputMode="decimal" defaultValue={editing ? fmtDec(editing.usableArea) : ""} className={`${inputCls} text-right tabular-nums`} />
        </Field>
        <Field label={t("onboarding.units.ownershipShare")}>
          <input name="ownershipShare" required inputMode="decimal" defaultValue={editing ? editing.ownershipShare.replace(".", ",") : ""} className={`${inputCls} text-right tabular-nums`} />
        </Field>
        <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:pt-6">
          <SubmitBtn variant="tonal">{editing ? t("onboarding.units.save") : t("onboarding.units.add")}</SubmitBtn>
          {editing && <BtnLink href="/onboarding/posebni-dijelovi">{t("onboarding.units.cancel")}</BtnLink>}
        </div>
      </form>
    </Card>
  );
}

function UnitsTable({ draft, editable }: { draft: MyDraft; editable: boolean }) {
  const units = draft.data.units;
  return (
    <Card title={tf("onboarding.units.listTitle", { broj: units.length })}>
      <Table
        id="onboarding-units"
        caption={tf("onboarding.units.listTitle", { broj: units.length })}
        headers={editable ? unitHeaders : unitHeaders.slice(0, -1)}
        empty={units.length === 0}
        emptyTitle={t("onboarding.units.empty")}
        emptyHint={t("onboarding.units.emptyHint")}
      >
        {units.map((u) => (
          <tr key={u.key}>
            <Td>{u.label}</Td>
            <Td>{tEnum("unitType", u.type)}</Td>
            <Td>{placeOf(draft, u)}</Td>
            <Td>{u.floor ?? "—"}</Td>
            <Td><span className="tabular-nums">{fmtDec(u.usableArea)} m²</span></Td>
            <Td><span className="tabular-nums">{u.ownershipShare.replace(".", ",")} %</span></Td>
            {editable && (
              <Td>
                <div className="flex flex-wrap gap-1.5">
                  <RowActionLink href={`/onboarding/posebni-dijelovi?uredi=${u.key}`}>{t("onboarding.units.edit")}</RowActionLink>
                  <form action={removeUnitAction}>
                    <Version draft={draft} />
                    <input type="hidden" name="key" value={u.key} />
                    <RowAction type="submit" variant="caution">{t("onboarding.units.remove")}</RowAction>
                  </form>
                </div>
              </Td>
            )}
          </tr>
        ))}
      </Table>
      <ShareSum units={units} />
    </Card>
  );
}

function UnitsStep({ draft, editKey, keepPlace, keepType }: { draft: MyDraft; editKey?: string; keepPlace?: string; keepType?: string }) {
  const locked = Boolean(draft.data.registerConfirmedAt);
  const editing = editKey ? draft.data.units.find((u) => u.key === editKey) ?? null : null;
  return (
    <>
      {locked && <LockedNote />}
      {!locked && <UnitForm draft={draft} editing={editing} keepPlace={keepPlace} keepType={keepType} />}
      <UnitsTable draft={draft} editable={!locked && !editing} />
    </>
  );
}

const assetHeaders: ColumnSpec[] = [
  { label: t("onboarding.commonAssets.name"), priority: "primary" },
  { label: t("onboarding.commonAssets.kind") },
  { label: t("onboarding.commonAssets.building") },
  { label: t("onboarding.commonAssets.description"), priority: "detail" },
  { label: "", actions: true },
];

function CommonAssetsStep({ draft }: { draft: MyDraft }) {
  const locked = Boolean(draft.data.registerConfirmedAt);
  const assets = draft.data.commonAssets;
  const buildingName = (k: string) => draft.data.buildings.find((b) => b.key === k)?.name ?? "?";
  return (
    <>
      {locked && <LockedNote />}
      {!locked && (
        <Card title={t("onboarding.commonAssets.addTitle")}>
          <form action={addCommonAssetAction} className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-4">
            <Version draft={draft} />
            <Field label={t("onboarding.commonAssets.building")}>
              <select name="buildingKey" className={inputCls}>
                {draft.data.buildings.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={t("onboarding.commonAssets.kind")}>
              <select name="kind" defaultValue="AREA" className={inputCls}>
                {(["AREA", "SYSTEM", "EQUIPMENT"] as const).map((k) => <option key={k} value={k}>{t(`onboarding.commonAssets.kind${k}`)}</option>)}
              </select>
            </Field>
            <div className="md:col-span-2">
              <Field label={t("onboarding.commonAssets.name")}><input name="name" required placeholder={t("onboarding.commonAssets.namePlaceholder")} className={inputCls} /></Field>
            </div>
            <div className="md:col-span-4">
              <Field label={t("onboarding.commonAssets.description")}><input name="description" className={inputCls} /></Field>
            </div>
            <div className="md:col-span-4"><SubmitBtn variant="tonal">{t("onboarding.commonAssets.add")}</SubmitBtn></div>
          </form>
        </Card>
      )}
      <Card title={t("onboarding.commonAssets.listTitle")}>
        <Table
          id="onboarding-common-assets"
          caption={t("onboarding.commonAssets.listTitle")}
          headers={locked ? assetHeaders.slice(0, -1) : assetHeaders}
          empty={assets.length === 0}
          emptyTitle={t("onboarding.commonAssets.empty")}
          emptyHint={t("onboarding.commonAssets.emptyHint")}
        >
          {assets.map((a) => (
            <tr key={a.key}>
              <Td>{a.name}</Td>
              <Td>{t(`onboarding.commonAssets.kind${a.kind}`)}</Td>
              <Td>{buildingName(a.buildingKey)}</Td>
              <Td>{a.description ?? "—"}</Td>
              {!locked && (
                <Td>
                  <form action={removeCommonAssetAction}>
                    <Version draft={draft} />
                    <input type="hidden" name="key" value={a.key} />
                    <RowAction type="submit" variant="caution">{t("onboarding.commonAssets.remove")}</RowAction>
                  </form>
                </Td>
              )}
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

/** Korak 7 (mockup O-M04 obrazac potvrde): pregled registra + caution okidač i primary potvrda (§4.2 DS). */
function RegisterStep({ draft }: { draft: MyDraft }) {
  const confirmedAt = draft.data.registerConfirmedAt;
  return (
    <>
      <UnitsTable draft={draft} editable={false} />
      <Card title={t("onboarding.register.summaryTitle")}>
        {confirmedAt ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">{tf("onboarding.register.confirmed", { datum: formatDate(confirmedAt) })}</p>
            <ConfirmAction
              trigger={t("onboarding.register.unlock")}
              title={t("onboarding.register.unlockTitle")}
              body={<p className="text-sm text-amber-900">{t("onboarding.register.unlockBody")}</p>}
              confirmLabel={t("onboarding.register.unlockLabel")}
              action={unlockRegisterAction}
              hiddenFields={{ version: String(draft.version) }}
            />
          </div>
        ) : (
          <ConfirmAction
            trigger={t("onboarding.register.confirm")}
            title={t("onboarding.register.confirmTitle")}
            body={<p className="text-sm text-amber-900">{tf("onboarding.register.confirmBody", { broj: draft.data.units.length })}</p>}
            confirmLabel={t("onboarding.register.confirmLabel")}
            confirmVariant="primary"
            action={confirmRegisterAction}
            hiddenFields={{ version: String(draft.version) }}
          />
        )}
      </Card>
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
    case "units": return t("onboarding.intro.units");
    case "commonAssets": return t("onboarding.intro.commonAssets");
    case "register": return t("onboarding.intro.register");
    case "review": return t("onboarding.intro.review");
    default: return t("onboarding.intro.soon");
  }
}

export default async function OnboardingStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ step: string }>;
  searchParams: Promise<{ err?: string; msg?: string; uredi?: string; mjesto?: string; vrsta?: string }>;
}) {
  const actor = await requireActor();
  const draft = await getMyDraft(actor);
  if (!draft) redirect(await landingPath(actor));
  const { step: slug } = await params;
  const meta = stepBySlug(slug);
  if (!meta) notFound();
  const key = reachableStepOrCurrent(draft, meta.key);
  if (key !== meta.key) redirect(`/onboarding/${stepSlug(key)}`);
  const { err, msg, uredi, mjesto, vrsta } = await searchParams;
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
            {key === "units" && <UnitsStep draft={draft} editKey={uredi} keepPlace={mjesto} keepType={vrsta} />}
            {key === "commonAssets" && <CommonAssetsStep draft={draft} />}
            {key === "register" && <RegisterStep draft={draft} />}
            {key === "review" && <ReviewStep draft={draft} />}
            <NextStepCard draft={draft} stepKey={key} />
          </div>
        </div>
      </main>
    </div>
  );
}
