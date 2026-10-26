import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { getZev, upsertZev } from "@/server/services/property";
import { listAccounts, createAccount, updateAccount } from "@/server/services/finance";
import { AccountRow } from "@/components/account-row";
import { getParty, updateParty, requireOwnerParty } from "@/server/services/ownership";
import { setInvoiceEmailDelivery } from "@/server/services/invoiceEmail";
import { revokeEVoteConsent, getEVoteConsentHistory } from "@/server/services/evoteConsent";
import { getSettings, saveSettings } from "@/server/services/settings";
import { getBankSmsStatus } from "@/server/services/bankSms";
import { getTestEmailStatus } from "@/server/services/emailTest";
import { TestEmailCard } from "@/components/test-email-card";
import { BankSmsTokenCard } from "@/components/bank-sms-token-card";
import { SETTING_DEFINITIONS, DEFAULT_SETTINGS, type SettingDefinition } from "@/lib/settings-defaults";
import {
  decodeSettingChanges,
  describeSettingChanges,
  describeSettingIssues,
  encodeSettingChanges,
  formatSettingValue,
  settingFieldLabel,
} from "@/lib/settings-display";
import { Decimal, formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDate, formatDateTime, t, tf, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Field, inputCls, SubmitBtn, BtnLink, RowLink, StatusBadge, ConfirmAction, Flash, ToggleBtn, Tabs, type ColumnSpec } from "@/components/ui";

const accountHeaders: ColumnSpec[] = [
  { label: t("settingsPage.accounts.name") },
  { label: t("settingsPage.accounts.type") },
  { label: t("settingsPage.accounts.number") },
  { label: t("settingsPage.accounts.opening"), align: "right" },
  { label: t("settingsPage.accounts.actions"), actions: true },
];

function errText(e: unknown): string {
  return e instanceof Error ? e.message : t("settingsPage.flash.error");
}

async function saveZevAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  try {
    await upsertZev(actor, {
      legalName: String(formData.get("legalName")),
      shortName: (formData.get("shortName") as string) || null,
      registrationNumber: (formData.get("registrationNumber") as string) || null,
      jib: (formData.get("jib") as string) || null,
      registeredAddress: (formData.get("registeredAddress") as string) || null,
      city: (formData.get("city") as string) || null,
      municipality: (formData.get("municipality") as string) || null,
    });
  } catch (e) {
    redirect(`/podesavanja?tab=zev&err=${encodeURIComponent(errText(e))}`);
  }
  revalidatePath("/podesavanja");
  redirect("/podesavanja?tab=zev&msg=zev");
}

async function updateAccountAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  try {
    await updateAccount(actor, String(formData.get("id")), {
      name: String(formData.get("name") ?? ""),
      bankName: (formData.get("bankName") as string) || null,
      iban: (formData.get("iban") as string) || null,
    });
  } catch (e) {
    redirect(`/podesavanja?tab=zev&err=${encodeURIComponent(errText(e))}`);
  }
  revalidatePath("/podesavanja");
  redirect("/podesavanja?tab=zev&msg=accountSaved");
}

async function addAccountAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  try {
    await createAccount(actor, {
      type: formData.get("type") as never,
      name: String(formData.get("name")),
      bankName: (formData.get("bankName") as string) || null,
      iban: (formData.get("iban") as string) || null,
      openingBalance: parseMoneyInput(formData.get("openingBalance") as string | null) ?? "0",
      openingDate: new Date(String(formData.get("openingDate"))),
    });
  } catch (e) {
    redirect(`/podesavanja?tab=zev&err=${encodeURIComponent(errText(e))}`);
  }
  revalidatePath("/podesavanja");
  redirect("/podesavanja?tab=zev&msg=accountAdded");
}

/** Jedna forma, jedno „Sačuvaj parametre”: server upisuje samo promijenjene vrijednosti (revizorski trag), a nijednu
 *  ako je ijedna neispravna. Poruka o uspjehu navodi šta se promijenilo (`ch=` u adresi, vidi settings-display.ts). */
async function saveParamsAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const submitted = Object.fromEntries(SETTING_DEFINITIONS.map((d) => [d.key, formData.get(`p_${d.key}`) as string | null]));
  let result;
  try {
    result = await saveSettings(actor, submitted);
  } catch (e) {
    redirect(`/podesavanja?tab=parametri&err=${encodeURIComponent(errText(e))}`);
  }
  if (!result.ok) {
    const issues = tf("settingsPage.flash.paramsInvalid", { issues: describeSettingIssues(result.issues) });
    redirect(`/podesavanja?tab=parametri&err=${encodeURIComponent(issues)}`);
  }
  revalidatePath("/podesavanja");
  if (result.changes.length === 0) redirect("/podesavanja?tab=parametri&msg=paramsNone");
  const qs = new URLSearchParams({ tab: "parametri", msg: "paramsSaved" });
  for (const c of encodeSettingChanges(result.changes)) qs.append("ch", c);
  redirect(`/podesavanja?${qs.toString()}`);
}

async function updateMyContactAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  try {
    const partyId = await requireOwnerParty(actor);
    await updateParty(actor, partyId, {
      email: (formData.get("email") as string) || null,
      phone: (formData.get("phone") as string) || null,
      correspondenceAddress: (formData.get("correspondenceAddress") as string) || null,
    });
  } catch (e) {
    redirect(`/podesavanja?tab=moji&err=${encodeURIComponent(errText(e))}`);
  }
  revalidatePath("/podesavanja");
  redirect("/podesavanja?tab=moji&msg=contact");
}

async function setMyInvoiceEmailAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  const on = formData.get("invoiceEmail") === "on";
  try {
    const partyId = await requireOwnerParty(actor);
    await setInvoiceEmailDelivery(actor, partyId, on);
  } catch (e) {
    redirect(`/podesavanja?tab=moji&err=${encodeURIComponent(errText(e))}`);
  }
  revalidatePath("/podesavanja");
  redirect(`/podesavanja?tab=moji&msg=${on ? "invoiceEmailOn" : "invoiceEmailOff"}`);
}

async function revokeMyConsentAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  const reason = (formData.get("reason") as string) || null;
  try {
    const partyId = await requireOwnerParty(actor);
    await revokeEVoteConsent(actor, partyId, reason);
  } catch (e) {
    redirect(`/podesavanja?tab=moji&err=${encodeURIComponent(errText(e))}`);
  }
  revalidatePath("/podesavanja");
  redirect("/podesavanja?tab=moji&msg=consentRevoked");
}

const FLASH_KEYS = ["saved", "contact", "zev", "accountSaved", "accountAdded", "invoiceEmailOn", "invoiceEmailOff", "consentRevoked", "paramsNone"] as const;

/** Vrijednost za polje: novac sa zarezom i dvije decimale ("500,00"), ostalo kako je sačuvano. */
function fieldValue(def: SettingDefinition, value: string): string {
  if (def.type !== "money") return value;
  try {
    return new Decimal(value).toFixed(2).replace(".", ",");
  } catch {
    return value; // naslijeđen neispravan zapis: prikaži ga kakav jeste, da ga predsjednik ispravi
  }
}

function ParamField({ def, value }: { def: SettingDefinition; value: string }) {
  const name = `p_${def.key}`;
  const label = settingFieldLabel(def);
  const hint = t(`settingsPage.param.${def.key}.hint`);
  if (def.type === "boolean") {
    const kind = def.boolLabels ?? "onOff";
    return (
      <Field label={label} hint={hint}>
        <select name={name} defaultValue={value === "true" ? "true" : "false"} className={inputCls}>
          <option value="true">{t(`settingsPage.bool.${kind}.on`)}</option>
          <option value="false">{t(`settingsPage.bool.${kind}.off`)}</option>
        </select>
      </Field>
    );
  }
  if (def.type === "integer") {
    return (
      <Field label={label} hint={hint}>
        <input name={name} type="number" inputMode="numeric" step={1} min={def.min} max={def.max} required defaultValue={value} className={inputCls} />
      </Field>
    );
  }
  // Iznos je tekst (ne type="number") da radi decimalni zarez; validira ga server (settings-form.ts).
  return (
    <Field label={label} hint={hint}>
      <input name={name} type="text" inputMode="decimal" required defaultValue={fieldValue(def, value)} className={inputCls} />
    </Field>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; err?: string; msg?: string; ch?: string | string[] }>;
}) {
  const actor = await requireActor();
  const { tab, err, msg, ch } = await searchParams;
  const isPresident = actor.roles.includes("PRESIDENT");
  const isManagement = isPresident || actor.roles.includes("ACCOUNTANT");
  const activeTab = tab === "zev" || tab === "parametri" ? tab : "moji";
  const showMoji = !isManagement || activeTab === "moji";
  const showZev = isManagement && activeTab === "zev";
  const showParametri = isManagement && activeTab === "parametri";

  let okMsg: string | undefined;
  if (msg === "paramsSaved") {
    const changes = describeSettingChanges(decodeSettingChanges(ch));
    okMsg = changes ? tf("settingsPage.flash.paramsSaved", { changes }) : t("settingsPage.flash.saved");
  } else if (msg && (FLASH_KEYS as readonly string[]).includes(msg)) {
    okMsg = t(`settingsPage.flash.${msg}`);
  }

  const [zev, accounts, bankSmsStatus, settings, testEmailStatus, myParty, myConsent] = await Promise.all([
    showZev ? getZev(actor) : null,
    showZev ? listAccounts(actor) : Promise.resolve([]),
    showZev ? getBankSmsStatus(actor) : null,
    showParametri ? getSettings(actor) : null,
    showParametri ? getTestEmailStatus(actor) : null,
    actor.partyId && showMoji ? getParty(actor, actor.partyId) : null,
    actor.partyId && showMoji ? getEVoteConsentHistory(actor, actor.partyId) : null,
  ]);

  const values = settings ?? DEFAULT_SETTINGS;
  const consentActive = myParty?.eVoteConsentStatus === "SIGNED";

  const contactCard = myParty && (
    <Card key="contact" title={t("settingsPage.mine.contactTitle")}>
      <form action={updateMyContactAction} className="space-y-3">
        <Field label={t("settingsPage.mine.email")}><input name="email" type="email" defaultValue={myParty.email ?? ""} className={inputCls} /></Field>
        <Field label={t("settingsPage.mine.phone")}><input name="phone" defaultValue={myParty.phone ?? ""} className={inputCls} /></Field>
        <Field label={t("settingsPage.mine.correspondence")}>
          <input name="correspondenceAddress" defaultValue={myParty.correspondenceAddress ?? ""} className={inputCls} />
        </Field>
        {/* Uloga odlučuje šta se tvrdi: samo predsjednik ima stranicu na kojoj se ime i adresa mijenjaju. */}
        <p className="text-[13px] text-slate-500">
          {isPresident ? (
            <>
              {t("settingsPage.mine.hintPresidentBefore")}
              <RowLink href={`/vlasnici/${myParty.id}`}>{t("settingsPage.mine.hintPresidentLink")}</RowLink>
              {t("settingsPage.mine.hintPresidentAfter")}
            </>
          ) : (
            t("settingsPage.mine.hintOwner")
          )}
        </p>
        <SubmitBtn>{t("settingsPage.mine.save")}</SubmitBtn>
      </form>
    </Card>
  );

  const deliveryCard = myParty && (
    <Card key="delivery" title={t("settingsPage.invoiceDelivery.title")}>
      <form action={setMyInvoiceEmailAction} className="space-y-3 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="invoiceEmail" defaultChecked={myParty.invoiceEmailDelivery} disabled={!myParty.email} className="mt-1" />
          <span>{t("settingsPage.invoiceDelivery.checkbox")}</span>
        </label>
        {myParty.email ? (
          <p className="text-slate-600">
            {t("settingsPage.invoiceDelivery.withEmailBefore")}<strong>{myParty.email}</strong>{t("settingsPage.invoiceDelivery.withEmailAfter")}
          </p>
        ) : (
          <p className="text-slate-600">{t("settingsPage.invoiceDelivery.withoutEmail")}</p>
        )}
        {myParty.invoiceEmailDelivery && myParty.invoiceEmailDeliveryAt && (
          <p className="text-[13px] text-slate-500">{tf("settingsPage.invoiceDelivery.since", { date: formatDate(myParty.invoiceEmailDeliveryAt) })}</p>
        )}
        {myParty.email && <SubmitBtn variant="tonal">{t("settingsPage.invoiceDelivery.save")}</SubmitBtn>}
      </form>
    </Card>
  );

  // Kad saglasnost nije aktivna (V-R08), ovo je najvažnija kartica na stranici vlasnika: ide prva, sa tri koraka.
  const evoteCard = myParty && myConsent && (
    <Card key="evote" title={t("settingsPage.evote.title")}>
      <div className="space-y-3 text-sm">
        <StatusBadge status={myParty.eVoteConsentStatus} label={tEnum("eVoteConsentStatus", myParty.eVoteConsentStatus)} />
        <p className="text-slate-600">{t("settingsPage.evote.purpose")}</p>
        {consentActive ? (
          <p className="text-slate-600">{t("settingsPage.evote.active")}</p>
        ) : (
          <>
            <p className="text-slate-600">{t("settingsPage.evote.intro")}</p>
            <ol className="list-decimal space-y-1 pl-5 text-slate-700">
              <li>{t("settingsPage.evote.step1")}</li>
              <li>{t("settingsPage.evote.step2")}</li>
              <li>{t("settingsPage.evote.step3")}</li>
            </ol>
            <p className="text-slate-600">{t("settingsPage.evote.afterSubmit")}</p>
            {myParty.eVoteConsentStatus === "REVOKED" && <p className="text-slate-600">{t("settingsPage.evote.revokedNote")}</p>}
          </>
        )}
        <dl className="space-y-1">
          <div><dt className="inline font-medium">{t("settingsPage.evote.emailOnForm")}: </dt><dd className="inline">{myParty.eVoteConsentEmail ?? "—"}</dd></div>
          {myConsent.signedAt && (
            <div><dt className="inline font-medium">{t("settingsPage.evote.signedAt")}: </dt><dd className="inline">{formatDateTime(myConsent.signedAt)}</dd></div>
          )}
          {myConsent.revokedAt && (
            <div>
              <dt className="inline font-medium">{t("settingsPage.evote.revokedAt")}: </dt>
              <dd className="inline">
                {formatDateTime(myConsent.revokedAt)}
                {myConsent.revokeReason ? ` — ${myConsent.revokeReason}` : ""}
              </dd>
            </div>
          )}
        </dl>
        <p>
          <BtnLink href={`/api/dokumenti/saglasnost/${myParty.id}`} variant="secondary">
            {t("settingsPage.evote.download")}
          </BtnLink>
        </p>
        {consentActive && (
          <div className="border-t border-slate-100 pt-3">
            <ConfirmAction
              trigger={t("settingsPage.evote.revokeTrigger")}
              title={t("settingsPage.evote.revokeTitle")}
              body={<p className="text-sm text-amber-900">{t("settingsPage.evote.revokeBody")}</p>}
              confirmLabel={t("settingsPage.evote.revokeConfirm")}
              action={revokeMyConsentAction}
            >
              <Field label={t("settingsPage.evote.revokeReason")}>
                <input name="reason" className={inputCls} />
              </Field>
            </ConfirmAction>
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div>
      <PageHeader
        title={t("nav.settings")}
        subtitle={isManagement ? t("settingsPage.subtitleManagement") : t("settingsPage.subtitleOwner")}
      />
      <Flash err={err} msg={okMsg} />
      {isManagement && (
        <Tabs
          tabs={[
            { key: "moji", label: t("settingsPage.tabs.mine") },
            { key: "zev", label: t("settingsPage.tabs.zev") },
            { key: "parametri", label: t("settingsPage.tabs.params") },
          ]}
          active={activeTab}
          hrefFor={(key) => `/podesavanja?tab=${key}`}
        />
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {showMoji && !myParty && (
          <Card>
            <p className="text-sm text-slate-600">{t("settingsPage.mine.noParty")}</p>
          </Card>
        )}
        {showMoji && (consentActive ? [contactCard, deliveryCard, evoteCard] : [evoteCard, contactCard, deliveryCard])}

        {showZev && (
          <Card title={t("settingsPage.zev.title")} hint={isPresident ? undefined : t("settingsPage.zev.readOnlyHint")}>
            {isPresident ? (
              <form action={saveZevAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Field label={t("settingsPage.zev.legalName")}><input name="legalName" required defaultValue={zev?.legalName} className={inputCls} /></Field>
                </div>
                <Field label={t("settingsPage.zev.shortName")}><input name="shortName" defaultValue={zev?.shortName ?? ""} className={inputCls} /></Field>
                <Field label={t("settingsPage.zev.jib")}><input name="jib" defaultValue={zev?.jib ?? ""} className={inputCls} /></Field>
                <Field label={t("settingsPage.zev.registrationNumber")}><input name="registrationNumber" defaultValue={zev?.registrationNumber ?? ""} className={inputCls} /></Field>
                <Field label={t("settingsPage.zev.registeredAddress")}><input name="registeredAddress" defaultValue={zev?.registeredAddress ?? ""} className={inputCls} /></Field>
                <Field label={t("settingsPage.zev.city")}><input name="city" defaultValue={zev?.city ?? ""} className={inputCls} /></Field>
                <Field label={t("settingsPage.zev.municipality")}><input name="municipality" defaultValue={zev?.municipality ?? ""} className={inputCls} /></Field>
                <div className="sm:col-span-2"><SubmitBtn>{t("settingsPage.zev.save")}</SubmitBtn></div>
              </form>
            ) : (
              <dl className="space-y-2 text-sm">
                {(
                  [
                    ["legalName", zev?.legalName],
                    ["shortName", zev?.shortName],
                    ["jib", zev?.jib],
                    ["registrationNumber", zev?.registrationNumber],
                    ["registeredAddress", zev?.registeredAddress],
                    ["city", zev?.city],
                    ["municipality", zev?.municipality],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <dt className="text-slate-500">{t(`settingsPage.zev.${key}`)}</dt>
                    <dd className="text-right">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        )}

        {showZev && (
          <Card title={t("settingsPage.accounts.title")}>
            <Table
              id="accounts-table"
              caption={t("settingsPage.accounts.title")}
              headers={accountHeaders}
              empty={accounts.length === 0}
              emptyTitle={t("empty.accounts.title")}
              emptyHint={t("empty.accounts.hint")}
            >
              {accounts.map((a) => (
                <AccountRow
                  key={a.id}
                  account={{
                    id: a.id,
                    name: a.name,
                    type: a.type,
                    bankName: a.bankName,
                    iban: a.iban,
                    openingBalanceLabel: formatMoney(a.openingBalance.toString()),
                  }}
                  action={updateAccountAction}
                />
              ))}
            </Table>
            <details className="group mt-3">
              <ToggleBtn>{t("settingsPage.accounts.add")}</ToggleBtn>
              <form action={addAccountAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("settingsPage.accounts.name")}><input name="name" required className={inputCls} /></Field>
                <Field label={t("settingsPage.accounts.type")}>
                  <select name="type" className={inputCls}>
                    <option value="BANK">{t("settingsPage.accounts.typeBank")}</option>
                    <option value="CASH">{t("settingsPage.accounts.typeCash")}</option>
                  </select>
                </Field>
                <Field label={t("settingsPage.accounts.number")}><input name="iban" className={inputCls} /></Field>
                <Field label={t("settingsPage.accounts.bank")}><input name="bankName" className={inputCls} /></Field>
                <Field label={t("settingsPage.accounts.openingKm")}><input name="openingBalance" defaultValue="0" className={inputCls} /></Field>
                <Field label={t("settingsPage.accounts.openingDate")}><input name="openingDate" type="date" required className={inputCls} /></Field>
                <div className="sm:col-span-2"><SubmitBtn>{t("settingsPage.accounts.add")}</SubmitBtn></div>
              </form>
            </details>
          </Card>
        )}

        {showZev && bankSmsStatus && <BankSmsTokenCard status={bankSmsStatus} />}

        {showParametri && (
          <Card
            title={t("settingsPage.params.title")}
            hint={isPresident ? t("settingsPage.params.hint") : t("settingsPage.params.hintReadOnly")}
          >
            {isPresident ? (
              <form action={saveParamsAction} className="space-y-4">
                {SETTING_DEFINITIONS.map((d) => (
                  <ParamField key={d.key} def={d} value={values[d.key]} />
                ))}
                <SubmitBtn variant="tonal">{t("settingsPage.params.save")}</SubmitBtn>
              </form>
            ) : (
              <dl className="space-y-2 text-sm">
                {SETTING_DEFINITIONS.map((d) => (
                  <div key={d.key} className="flex justify-between gap-4">
                    <dt className="text-slate-500">{t(`settingsPage.param.${d.key}.name`)}</dt>
                    <dd className="text-right">{formatSettingValue(d, values[d.key])}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        )}

        {showParametri && testEmailStatus && <TestEmailCard status={testEmailStatus} scope="zev" />}

        {showParametri && (
          <Card title={t("settingsPage.messagesCard.title")}>
            <p className="text-sm text-slate-600">
              {t("settingsPage.messagesCard.before")}
              <RowLink href="/evidencije?tab=poruke">{t("settingsPage.messagesCard.link")}</RowLink>
              {t("settingsPage.messagesCard.after")}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
