"use client";
// "Probna e-mail poruka" (Plans/email-sender-name-and-test-email-plan.md, R6): send a fixed test
// message to my own login address, or to an address typed in. Used in Podešavanja → Parametri
// (president/accountant, scope "zev") and in /admin (super admin, scope "admin"). The result,
// including the provider's exact error, comes back from the server action — never via the URL.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  adminSendTestEmailAction,
  sendTestEmailAction,
  type SendTestEmailActionResult,
} from "@/server/actions/notifications";
import type { TestEmailStatus } from "@/server/services/emailTest";
import { Card, Field, ToggleBtn, inputCls, btnBase, btnVariantCls } from "@/components/ui";

const okCls = "rounded-xl border-l-4 border-l-emerald-500 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 shadow-sm";
const errCls = "rounded-xl border-l-4 border-l-red-500 bg-red-50 px-3 py-2.5 text-sm text-red-800 shadow-sm";

function modeLabel(p: TestEmailStatus["provider"]): string {
  if (p.kind === "mock") return "Simulacija — poruke se samo upisuju u „Poslate poruke”, ništa ne izlazi iz aplikacije.";
  if (p.kind === "mailjet") return p.configured ? "Mailjet — stvarno slanje." : "Mailjet — nije potpuno podešen; slanje neće uspjeti.";
  return "Nepoznat način slanja — provjerite podešavanje servera.";
}

export function TestEmailCard({ status, scope }: { status: TestEmailStatus; scope: "zev" | "admin" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [address, setAddress] = useState("");
  const [outcome, setOutcome] = useState<SendTestEmailActionResult | null>(null);

  function send(input: { target: "self" } | { target: "address"; address: string }) {
    setOutcome(null);
    startTransition(async () => {
      const res = scope === "admin" ? await adminSendTestEmailAction(input) : await sendTestEmailAction(input);
      setOutcome(res);
      router.refresh(); // the "used" counter and "Poslate poruke"
    });
  }

  let message: { ok: boolean; text: string } | null = null;
  if (outcome && !outcome.ok) message = { ok: false, text: outcome.error };
  else if (outcome?.ok) {
    const r = outcome.result;
    message = !r.ok
      ? { ok: false, text: `Slanje nije uspjelo: ${r.error ?? "nepoznata greška provajdera."}` }
      : r.simulated
        ? { ok: true, text: `Simulacija: poruka za ${r.toAddress} je upisana u „Poslate poruke”, ali nije stvarno poslata.` }
        : { ok: true, text: `Poruka je predata Mailjet-u za ${r.toAddress}. Provjerite sanduče i folder za neželjenu poštu.` };
  }

  return (
    <Card title="Probna e-mail poruka" hint="Provjera da slanje e-pošte iz aplikacije radi. Tekst poruke je unaprijed zadat.">
      <dl className="mb-4 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-slate-500">Način slanja</dt>
        <dd className="text-slate-800">{modeLabel(status.provider)}</dd>
        {status.provider.kind === "mailjet" && status.provider.fromEmail && (
          <>
            <dt className="text-slate-500">Adresa pošiljaoca</dt>
            <dd className="text-slate-800">{status.provider.fromEmail}</dd>
          </>
        )}
        <dt className="text-slate-500">Iskorišteno</dt>
        <dd className="text-slate-800">
          {status.usedLastHour} od {status.perHourLimit} u posljednjih sat vremena
        </dd>
      </dl>

      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => send({ target: "self" })}
          className={`${btnBase} ${btnVariantCls.tonal}`}
        >
          {pending ? "Šaljem…" : `Pošalji na moju adresu (${status.myEmail})`}
        </button>
      </div>

      <details className="group mt-3">
        <ToggleBtn>Pošalji na drugu adresu</ToggleBtn>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send({ target: "address", address });
          }}
        >
          <div className="min-w-0 flex-1 basis-64">
            <Field label="E-mail adresa">
              <input
                type="email"
                required
                maxLength={254}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={inputCls}
                placeholder="ime@primjer.ba"
              />
            </Field>
          </div>
          <button type="submit" disabled={pending} className={`${btnBase} ${btnVariantCls.secondary}`}>
            Pošalji
          </button>
        </form>
      </details>

      {message && (
        <div role={message.ok ? "status" : "alert"} className={`mt-3 ${message.ok ? okCls : errCls}`}>
          {message.text}
          {scope === "zev" && outcome?.ok && (
            <>
              {" "}
              <Link href="/evidencije?tab=poruke" className="font-medium underline underline-offset-2">
                Poslate poruke
              </Link>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
