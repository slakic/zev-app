"use client";
// Settings card for the automatic SMS intake (Plans/bank-sms-ingestion-plan.md, O1/O6): shows
// the webhook address, generates/replaces/switches off the access key, and offers a
// "Provjeri poruku" check that runs the parser on a pasted SMS without needing the phone.
// A key is displayed ONCE — right after it is generated, from the server action's return
// value — and is never stored in clear text anywhere; it never goes into a URL either.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  checkBankSmsTextAction,
  issueBankSmsTokenAction,
  revokeBankSmsTokenAction,
  type CheckSmsResult,
} from "@/server/actions/bankSms";
import type { BankSmsStatus } from "@/server/services/bankSms";
import { Card, ConfirmAction, ToggleBtn, inputCls, btnBase, btnVariantCls } from "@/components/ui";
import { formatDateTime } from "@/lib/i18n";

export function BankSmsTokenCard({ status }: { status: BankSmsStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [sample, setSample] = useState("");
  const [checked, setChecked] = useState<CheckSmsResult | null>(null);

  async function issue() {
    setError(null);
    const res = await issueBankSmsTokenAction();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSecret({ token: res.token, url: res.url });
    router.refresh();
  }

  async function revoke() {
    setError(null);
    const res = await revokeBankSmsTokenAction();
    if (!res.ok) setError(res.error ?? "Greška.");
    setSecret(null);
    router.refresh();
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setError("Kopiranje nije uspjelo — označite tekst i kopirajte ga ručno.");
    }
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(status.url);

  return (
    <Card
      title="Automatski prijem SMS obavještenja banke"
      hint="SMS poruke Nova Banke sa vašeg telefona stižu ovdje i čekaju vašu potvrdu — ništa se ne knjiži automatski."
      className="lg:col-span-2"
    >
      <div className="space-y-4 text-sm">
        {error && (
          <div role="alert" className="rounded-xl border-l-4 border-l-red-500 bg-red-50 px-3 py-2.5 text-red-800">{error}</div>
        )}

        <dl className="space-y-1.5">
          <div>
            <dt className="inline font-medium">Adresa: </dt>
            <dd className="inline font-mono text-[13px]">{status.url}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Stanje: </dt>
            <dd className="inline">
              {status.active
                ? `uključeno${status.issuedAt ? ` od ${formatDateTime(new Date(status.issuedAt))}` : ""}`
                : "isključeno — generišite pristupni ključ da biste uključili prijem"}
            </dd>
          </div>
          {status.active && (
            <div>
              <dt className="inline font-medium">Posljednja primljena poruka: </dt>
              <dd className="inline">{status.lastReceivedAt ? formatDateTime(new Date(status.lastReceivedAt)) : "još nijedna"}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">Na čekanju: </dt>
            <dd className="inline">
              <Link href="/fakture/uplate/sms" className="font-medium text-primary-ink underline-offset-2 hover:underline">
                {status.pending} {status.rejected > 0 ? `(neprepoznatih: ${status.rejected})` : ""}
              </Link>
            </dd>
          </div>
        </dl>

        {isLocal && (
          <div className="rounded-xl border-l-4 border-l-amber-500 bg-amber-50 px-3 py-2.5 text-amber-800">
            Adresa pokazuje na lokalni računar (localhost) — iPhone je ne može dosegnuti. Javna adresa aplikacije se postavlja
            promjenljivom okruženja <span className="font-mono">APP_URL</span> (npr. u Vercel podešavanjima).
          </div>
        )}

        {secret && (
          <div className="space-y-2 rounded-xl border-l-4 border-l-emerald-500 bg-emerald-50 px-3 py-3 text-emerald-900">
            <p className="font-semibold">Novi pristupni ključ je generisan. Prikazuje se samo sada — kopirajte ga u automatizaciju.</p>
            <div>
              <div className="text-[13px] font-medium">Adresa (URL)</div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-white px-2 py-1 text-[13px]">{secret.url}</code>
                <button type="button" onClick={() => copy("url", secret.url)} className={`${btnBase} ${btnVariantCls.secondary}`}>
                  {copied === "url" ? "Kopirano" : "Kopiraj"}
                </button>
              </div>
            </div>
            <div>
              <div className="text-[13px] font-medium">Zaglavlje <span className="font-mono">Authorization</span></div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-white px-2 py-1 text-[13px]">Bearer {secret.token}</code>
                <button type="button" onClick={() => copy("token", `Bearer ${secret.token}`)} className={`${btnBase} ${btnVariantCls.secondary}`}>
                  {copied === "token" ? "Kopirano" : "Kopiraj"}
                </button>
              </div>
            </div>
            <p className="text-[13px]">
              Ne šaljite ključ porukom i ne objavljujte screenshot Shortcut-a. Ako ikad procuri, generišite novi — stari odmah
              prestaje da važi.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-start gap-3">
          {!status.active && (
            <button type="button" disabled={pending} onClick={() => startTransition(issue)} className={`${btnBase} ${btnVariantCls.primary}`}>
              {pending ? "Generišem…" : "Generiši pristupni ključ"}
            </button>
          )}
          {status.active && (
            <>
              <div className="min-w-64 max-w-md flex-1">
                <ConfirmAction
                  trigger="Generiši novi ključ"
                  title="Stari ključ odmah prestaje da važi"
                  body={<p className="text-sm text-amber-900">Morate ga zamijeniti u automatizaciji na telefonu, inače poruke neće stizati.</p>}
                  confirmLabel="Da, generiši novi ključ"
                  action={async () => { await issue(); }}
                />
              </div>
              <div className="min-w-64 max-w-md flex-1">
                <ConfirmAction
                  trigger="Isključi prijem"
                  title="Poruke sa telefona više neće stizati"
                  body={<p className="text-sm text-amber-900">Poruke koje već čekaju ostaju sačuvane. Prijem možete ponovo uključiti generisanjem novog ključa.</p>}
                  confirmLabel="Da, isključi prijem"
                  action={async () => { await revoke(); }}
                />
              </div>
            </>
          )}
        </div>

        <div className="border-t border-slate-100 pt-3">
          <p className="mb-2 font-medium text-slate-700">Provjeri poruku</p>
          <p className="mb-2 text-[13px] text-slate-500">
            Nalijepite tekst jedne SMS poruke banke da vidite kako će je aplikacija pročitati. Ništa se ne čuva.
          </p>
          <textarea
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            rows={3}
            className={inputCls}
            aria-label="Tekst SMS poruke"
            placeholder="NOVA BANKA-Priliv na … Iznos … KM, svrha …"
          />
          <div className="mt-2">
            <button
              type="button"
              disabled={pending || !sample.trim()}
              onClick={() => startTransition(async () => setChecked(await checkBankSmsTextAction(sample)))}
              className={`${btnBase} ${btnVariantCls.secondary}`}
            >
              Provjeri
            </button>
          </div>
          {checked && !checked.ok && <p className="mt-2 text-red-800">{checked.error}</p>}
          {checked && checked.ok && (
            <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2.5 text-slate-700">
              {checked.result.error ? (
                <p className="text-amber-800">Neprepoznato: {checked.result.error}</p>
              ) : (
                <ul className="space-y-0.5">
                  <li>Vrsta: <b>{checked.result.kind === "PRILIV" ? "uplata (Priliv)" : "isplata (Odliv)"}</b></li>
                  <li>Iznos: <b>{checked.result.amount} KM</b></li>
                  <li>Svrha: {checked.result.purpose ?? "—"}</li>
                  <li>
                    Druga strana: {checked.result.counterpartyName ?? "—"}
                    {checked.result.counterpartyAccount ? ` (${checked.result.counterpartyAccount})` : ""}
                  </li>
                  <li className={checked.result.accountRecognized ? "" : "text-amber-800"}>
                    {checked.result.accountRecognized
                      ? "Račun iz poruke je upisan u Računima."
                      : "Račun iz poruke nije upisan ni na jednom računu — dopunite broj računa u kartici „Računi (banka i blagajna)“."}
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>

        <details className="group border-t border-slate-100 pt-3">
          <ToggleBtn>Uputstvo za iPhone (Shortcuts)</ToggleBtn>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-slate-700">
            <li>Kliknite <b>Generiši pristupni ključ</b> iznad i ostavite ovaj ekran otvoren — trebaju vam <b>adresa</b> i <b>ključ</b>.</li>
            <li>Na iPhone-u otvorite aplikaciju <b>Shortcuts (Prečice)</b>, pa karticu <b>Automation (Automatizacija)</b> na dnu.</li>
            <li>Dodirnite <b>+</b> (New Automation) i izaberite <b>Message (Poruka)</b>.</li>
            <li>
              U polje <b>Message Contains (Poruka sadrži)</b> upišite <span className="font-mono">NOVA BANKA-</span> (hvata i Priliv i
              Odliv). Polje <b>Sender</b> ostavite prazno — banka nema broj pošiljaoca koji se može izabrati. Poruke koje ne
              sadrže taj tekst nikad ne napuštaju telefon.
            </li>
            <li>Izaberite <b>Run Immediately (Pokreni odmah)</b>, po želji isključite <b>Notify When Run</b>, pa <b>Next</b>.</li>
            <li>Izaberite <b>New Blank Automation</b> i dodajte akciju <b>Get Contents of URL (Preuzmi sadržaj URL-a)</b>.</li>
            <li>U polje URL nalijepite <b>adresu</b> iz ove kartice.</li>
            <li>
              Otvorite opcije akcije (strelica ›) i podesite: <b>Method: POST</b>; u <b>Headers</b> dodajte jedno zaglavlje —
              <b> Key:</b> <span className="font-mono">Authorization</span>, <b>Value:</b> cijeli red koji počinje sa{" "}
              <span className="font-mono">Bearer </span> (iz ove kartice); <b>Request Body: JSON</b> sa jednim poljem tipa Text —
              ključ <span className="font-mono">text</span>, a za vrijednost izaberite promjenljivu <b>Shortcut Input</b> (sadržaj poruke).
            </li>
            <li>Dodirnite <b>Done</b>. Prva stvarna poruka pojavit će se ovdje u „Na čekanju“; do tada provjerite format kroz „Provjeri poruku“.</li>
          </ol>
          <p className="mt-2 text-[13px] text-slate-500">
            Telefon mora imati internet u trenutku kad SMS stigne — poruka koja ne stigne ne šalje se naknadno. Izvod ostaje
            kontrola potpunosti. Ako i predsjednik i računovođa podese istu automatizaciju sa istim ključem, aplikacija
            prepoznaje duplikate.
          </p>
        </details>
      </div>
    </Card>
  );
}
