import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { getZev, upsertZev } from "@/server/services/property";
import { listAccounts, createAccount } from "@/server/services/finance";
import { prisma } from "@/lib/prisma";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { PageHeader, Card, Table, Td, Field, inputCls, SubmitBtn, BtnLink } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";

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
  const zev = await getZev();
  if (!zev) return;
  await createAccount(actor, {
    zevId: zev.id,
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
  await requireActor("PRESIDENT");
  const key = String(formData.get("key"));
  const value = String(formData.get("value"));
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: value as unknown as Prisma.InputJsonValue },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
  revalidatePath("/podesavanja");
}

const LEGAL_SETTINGS: { key: string; label: string; def: string }[] = [
  { key: "retention.financialYears", label: "Čuvanje finansijskih dokumenata (godina)", def: "11" },
  { key: "retention.voteIpDays", label: "Čuvanje IP metapodataka glasanja (dana)", def: "30" },
  { key: "emergency.costThreshold", label: "Prag za hitne radove bez skupštine (KM)", def: "500" },
  { key: "interest.enabled", label: "Zatezna kamata (isključena dok pravnik ne potvrdi)", def: "false" },
  { key: "invoice.dueDay", label: "Podrazumijevani dan dospijeća fakture", def: "15" },
  { key: "board.size", label: "Preporučen broj članova upravnog odbora (uključujući predsjednika)", def: "3" },
  { key: "board.termYears", label: "Trajanje mandata organa ZEV (godina)", def: "4" },
  { key: "board.presidentIsBoardPresident", label: "Predsjednik ZEV je ujedno predsjednik upravnog odbora (pretpostavka — vidi LEGAL_AND_FINANCIAL_ASSUMPTIONS.md)", def: "true" },
];

export default async function SettingsPage() {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const isPresident = actor.roles.includes("PRESIDENT");
  const [zev, accounts, settings] = await Promise.all([
    getZev(),
    listAccounts(actor),
    prisma.setting.findMany(),
  ]);
  const settingsMap = new Map(settings.map((s) => [s.key, String(s.value)]));
  return (
    <div>
      <PageHeader
        title="Podešavanja"
        subtitle="Matični podaci ZEV, računi, pravni parametri, poruke i revizorski trag"
        actions={
          <div className="flex gap-2">
            <BtnLink href="/podesavanja/poruke" variant="secondary">Poslate poruke</BtnLink>
            <BtnLink href="/podesavanja/audit" variant="secondary">Revizorski trag</BtnLink>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

        <Card title="Konfigurabilni pravni i finansijski parametri">
          <p className="mb-3 text-xs text-slate-500">
            Vrijednosti označene u LEGAL_AND_FINANCIAL_ASSUMPTIONS.md — pravna/računovodstvena provjera obavezna prije produkcijske upotrebe.
          </p>
          <div className="space-y-3">
            {LEGAL_SETTINGS.map((s) => (
              <form key={s.key} action={saveSettingAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="key" value={s.key} />
                <div className="min-w-[220px] flex-1">
                  <Field label={s.label}>
                    <input name="value" defaultValue={settingsMap.get(s.key) ?? s.def} className={inputCls} disabled={!isPresident} />
                  </Field>
                </div>
                {isPresident && <SubmitBtn variant="secondary">Sačuvaj</SubmitBtn>}
              </form>
            ))}
          </div>
        </Card>

        <Card title="Napomena o integracijama">
          <p className="text-sm text-slate-600">
            E-mail i Viber rade preko <b>mock</b> provajdera: poruke se evidentiraju u
            „Poslate poruke” sa simuliranim statusima isporuke. Konfiguracija stvarnih
            provajdera opisana je u <code className="rounded bg-slate-100 px-1">.env.example</code> i README.
            Viber bot može slati poruke korisnicima koji su se pretplatili na bota —
            automatsko objavljivanje u proizvoljne privatne grupe nije podržano zvaničnim API-jem.
          </p>
        </Card>
      </div>
    </div>
  );
}
