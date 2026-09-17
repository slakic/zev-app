import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { getZev, upsertZev } from "@/server/services/property";
import { listAccounts, createAccount } from "@/server/services/finance";
import { getParty, updateParty, requireOwnerParty } from "@/server/services/ownership";
import { revokeEVoteConsent, getEVoteConsentHistory } from "@/server/services/evoteConsent";
import { getSettings, setSetting } from "@/server/services/settings";
import { SETTING_DEFINITIONS, DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDateTime, t, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, Field, inputCls, SubmitBtn, BtnLink, StatusBadge, ConfirmAction, Flash } from "@/components/ui";

async function saveZevAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await upsertZev(actor, {
    legalName: String(formData.get("legalName")),
    shortName: (formData.get("shortName") as string) || null,
    registrationNumber: (formData.get("registrationNumber") as string) || null,
    jib: (formData.get("jib") as string) || null,
    registeredAddress: (formData.get("registeredAddress") as string) || null,
    city: (formData.get("city") as string) || null,
    municipality: (formData.get("municipality") as string) || null,
  });
  revalidatePath("/podesavanja");
}

async function addAccountAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  await createAccount(actor, {
    type: formData.get("type") as never,
    name: String(formData.get("name")),
    bankName: (formData.get("bankName") as string) || null,
    iban: (formData.get("iban") as string) || null,
    openingBalance: parseMoneyInput(formData.get("openingBalance") as string | null) ?? "0",
    openingDate: new Date(String(formData.get("openingDate"))),
  });
  revalidatePath("/podesavanja");
}

async function saveSettingAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const key = String(formData.get("key"));
  const value = String(formData.get("value"));
  try {
    await setSetting(actor, key, value);
  } catch (e) {
    redirect(`/podesavanja?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/podesavanja");
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
    redirect(`/podesavanja?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/podesavanja");
  redirect("/podesavanja?msg=saved");
}

async function revokeMyConsentAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  const reason = (formData.get("reason") as string) || null;
  try {
    const partyId = await requireOwnerParty(actor);
    await revokeEVoteConsent(actor, partyId, reason);
  } catch (e) {
    redirect(`/podesavanja?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect("/podesavanja?msg=saved");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; msg?: string }>;
}) {
  const actor = await requireActor();
  const { err, msg } = await searchParams;
  const okMsg = msg === "saved" ? "Sačuvano." : undefined;
  const isPresident = actor.roles.includes("PRESIDENT");
  const isManagement = isPresident || actor.roles.includes("ACCOUNTANT");

  const [zev, accounts, settings, myParty, myConsent] = await Promise.all([
    isManagement ? getZev(actor) : null,
    isManagement ? listAccounts(actor) : Promise.resolve([]),
    isManagement ? getSettings(actor) : null,
    actor.partyId ? getParty(actor, actor.partyId) : null,
    actor.partyId ? getEVoteConsentHistory(actor, actor.partyId) : null,
  ]);

  return (
    <div>
      <PageHeader
        title={t("nav.settings")}
        subtitle={
          isManagement
            ? "Moji podaci, matični podaci ZEV, računi, pravni parametri, poruke i revizorski trag"
            : "Moji lični podaci i elektronsko glasanje"
        }
        actions={
          isManagement ? (
            <div className="flex gap-2">
              <BtnLink href="/podesavanja/poruke" variant="secondary">Poslate poruke</BtnLink>
              {/* PRESIDENT-only (Plans/user-activity-log-plan.md §6, odluka P4) — uže od
                  "Revizorski trag" ispod, koji ostaje PRESIDENT+ACCOUNTANT bez izmjene. */}
              {isPresident && <BtnLink href="/aktivnosti" variant="secondary">Aktivnosti</BtnLink>}
              <BtnLink href="/podesavanja/audit" variant="secondary">Revizorski trag</BtnLink>
            </div>
          ) : undefined
        }
      />
      <Flash err={err} msg={okMsg} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {myParty && (
          <Card title="Moji podaci">
            <form action={updateMyContactAction} className="space-y-3">
              <Field label="E-mail"><input name="email" type="email" defaultValue={myParty.email ?? ""} className={inputCls} /></Field>
              <Field label="Telefon"><input name="phone" defaultValue={myParty.phone ?? ""} className={inputCls} /></Field>
              <Field label="Adresa za prepisku (ako je različita)">
                <input name="correspondenceAddress" defaultValue={myParty.correspondenceAddress ?? ""} className={inputCls} />
              </Field>
              <p className="text-xs text-slate-500">
                Ime, prezime i adresu nekretnine mijenja predsjednik — vidi vaš profil u „Vlasnici i korisnici”.
              </p>
              <SubmitBtn>Sačuvaj</SubmitBtn>
            </form>
          </Card>
        )}

        {myParty && myConsent && (
          <Card title="Elektronsko glasanje">
            <div className="space-y-3 text-sm">
              <StatusBadge status={myParty.eVoteConsentStatus} label={tEnum("eVoteConsentStatus", myParty.eVoteConsentStatus)} />
              <p className="text-slate-600">
                Da biste se elektronskim putem izjašnjavali na sjednicama skupštine i upravnog odbora, kao i u
                drugim postupcima izjašnjavanja koje ZEV objavi, potrebno je da preuzmete izjavu o saglasnosti,
                odštampate je, potpišete i donesete predsjedniku ZEV-a. Predsjednik potom, po prijemu potpisane
                izjave, omogućava vam elektronsko izjašnjavanje.
              </p>
              <dl className="space-y-1">
                <div><dt className="inline font-medium">E-mail na izjavi: </dt><dd className="inline">{myParty.eVoteConsentEmail ?? "—"}</dd></div>
                {myConsent.signedAt && (
                  <div><dt className="inline font-medium">Potpisana: </dt><dd className="inline">{formatDateTime(myConsent.signedAt)}</dd></div>
                )}
                {myConsent.revokedAt && (
                  <div>
                    <dt className="inline font-medium">Povučena: </dt>
                    <dd className="inline">
                      {formatDateTime(myConsent.revokedAt)}
                      {myConsent.revokeReason ? ` — ${myConsent.revokeReason}` : ""}
                    </dd>
                  </div>
                )}
              </dl>
              <p>
                <BtnLink href={`/api/dokumenti/saglasnost/${myParty.id}`} variant="secondary">
                  Preuzmi izjavu (PDF)
                </BtnLink>
              </p>
              {myParty.eVoteConsentStatus !== "NONE" && myParty.eVoteConsentStatus !== "REVOKED" && (
                <div className="border-t border-slate-100 pt-3">
                  <ConfirmAction
                    trigger="Povuci saglasnost za elektronsko glasanje"
                    title="Nakon opoziva više nećete moći da glasate elektronski"
                    body={<p className="text-sm text-amber-900">Saglasnost možete ponovo dati istim postupkom (izjava predsjedniku) u bilo kom trenutku.</p>}
                    confirmLabel="Da, povuci saglasnost"
                    action={revokeMyConsentAction}
                  >
                    <Field label="Razlog opoziva (opciono)">
                      <input name="reason" className={inputCls} />
                    </Field>
                  </ConfirmAction>
                </div>
              )}
            </div>
          </Card>
        )}

        {isManagement && (
          <Card title="Matični podaci ZEV">
            <form action={saveZevAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Field label="Puni naziv"><input name="legalName" required defaultValue={zev?.legalName} className={inputCls} disabled={!isPresident} /></Field>
              </div>
              <Field label="Skraćeni naziv"><input name="shortName" defaultValue={zev?.shortName ?? ""} className={inputCls} disabled={!isPresident} /></Field>
              <Field label="JIB"><input name="jib" defaultValue={zev?.jib ?? ""} className={inputCls} disabled={!isPresident} /></Field>
              <Field label="Registarski broj"><input name="registrationNumber" defaultValue={zev?.registrationNumber ?? ""} className={inputCls} disabled={!isPresident} /></Field>
              <Field label="Sjedište (adresa)"><input name="registeredAddress" defaultValue={zev?.registeredAddress ?? ""} className={inputCls} disabled={!isPresident} /></Field>
              <Field label="Grad"><input name="city" defaultValue={zev?.city ?? ""} className={inputCls} disabled={!isPresident} /></Field>
              <Field label="Opština"><input name="municipality" defaultValue={zev?.municipality ?? ""} className={inputCls} disabled={!isPresident} /></Field>
              {isPresident && <div className="sm:col-span-2"><SubmitBtn>Sačuvaj</SubmitBtn></div>}
            </form>
          </Card>
        )}

        {isManagement && (
          <Card title="Računi (banka i blagajna)">
            <Table headers={["Naziv", "Vrsta", "Broj računa", "Početno stanje"]} empty={accounts.length === 0}>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <Td>{a.name}</Td>
                  <Td>{a.type === "BANK" ? "Banka" : "Blagajna"}</Td>
                  <Td className="font-mono text-xs">{a.iban ?? "—"}</Td>
                  <Td right>{formatMoney(a.openingBalance.toString())}</Td>
                </tr>
              ))}
            </Table>
            <form action={addAccountAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Naziv"><input name="name" required className={inputCls} /></Field>
              <Field label="Vrsta">
                <select name="type" className={inputCls}>
                  <option value="BANK">Bankovni račun</option>
                  <option value="CASH">Blagajna</option>
                </select>
              </Field>
              <Field label="Broj računa"><input name="iban" className={inputCls} /></Field>
              <Field label="Banka"><input name="bankName" className={inputCls} /></Field>
              <Field label="Početno stanje (KM)"><input name="openingBalance" defaultValue="0" className={inputCls} /></Field>
              <Field label="Datum početnog stanja"><input name="openingDate" type="date" required className={inputCls} /></Field>
              <div className="sm:col-span-2"><SubmitBtn>Dodaj račun</SubmitBtn></div>
            </form>
          </Card>
        )}

        {isManagement && (
          <Card title="Konfigurabilni pravni i finansijski parametri">
            <p className="mb-3 text-[13px] text-slate-500">
              Ove vrijednosti utiču na obračun i na pravila glasanja. Prije izmjene se posavjetujte sa računovođom.
            </p>
            <div className="space-y-3">
              {SETTING_DEFINITIONS.map((s) => (
                <form key={s.key} action={saveSettingAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="key" value={s.key} />
                  <div className="min-w-[220px] flex-1">
                    <Field label={s.label}>
                      <input name="value" defaultValue={(settings ?? DEFAULT_SETTINGS)[s.key]} className={inputCls} disabled={!isPresident} />
                    </Field>
                  </div>
                  {isPresident && <SubmitBtn variant="secondary">Sačuvaj</SubmitBtn>}
                </form>
              ))}
            </div>
          </Card>
        )}

        {isManagement && (
          <Card title="Napomena o integracijama">
            <p className="text-sm text-slate-600">
              {process.env.EMAIL_PROVIDER === "mailjet" ? (
                <>E-mail se šalje preko <b>Mailjet</b>-a; Viber trenutno radi preko <b>mock</b> provajdera.</>
              ) : (
                <>E-mail i Viber trenutno rade preko <b>mock</b> provajdera.</>
              )}{" "}
              Poruke se evidentiraju u „Poslate poruke” sa (simuliranim, za mock provajder)
              statusima isporuke. Stvarne provajdere podešava osoba koja je postavila sistem.
              Viber bot može slati poruke korisnicima koji su se pretplatili na bota —
              automatsko objavljivanje u proizvoljne privatne grupe nije podržano zvaničnim API-jem.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
