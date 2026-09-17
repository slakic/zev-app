// Public (token-authenticated) electronic approval page.
// The link is personal; identity is confirmed with a separately delivered
// one-time verification code before the vote can be submitted.
//
// Context that shapes every decision on this page (Plans/ui-ux-redesign-plan.md §6.1):
// the person here is an owner who got an e-mail, clicks the link once in their life, has
// no prior experience with the app, and the action is legally relevant, irreversible and
// one-time (`used` branch below: "Ponovno glasanje nije moguće"). Restructured into three
// numbered steps on one page (no multi-page form — that adds state and a way to lose
// progress): who you are, what you're voting on, and your choice + a real confirm step.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { inspectApprovalToken, submitVote } from "@/server/services/meetings";
import { sha256 } from "@/server/auth/tokens";
import { formatDateTime } from "@/lib/i18n";
import { formatWeight } from "@/lib/money";
import { Card, Field, inputCls, SubmitBtn, ToggleBtn } from "@/components/ui";
import { AuthBrandHeader } from "@/components/auth-shell";

const ERR_TEXT: Record<string, string> = {
  not_found: "Link nije prepoznat. Provjerite da li ste otvorili kompletan link iz poruke.",
  revoked: "Ovaj link je opozvan ili zamijenjen novim. Koristite najnoviji link koji ste dobili.",
  used: "Po ovom linku je izjašnjavanje već izvršeno. Ponovno glasanje nije moguće.",
  expired: "Link je istekao.",
  voting_closed: "Glasanje po ovom prijedlogu je zatvoreno.",
  rate_limited: "Previše pokušaja. Pokušajte ponovo za 15 minuta.",
  bad_code: "Verifikacioni kod nije ispravan. Provjerite kod iz poruke.",
  already_voted: "Za ovog vlasnika je izjašnjavanje već evidentirano.",
};

async function voteAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token"));
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (formData.get("ack") !== "on") {
    redirect(`/glasanje/${token}?err=ack`);
  }
  const result = await submitVote({
    tokenPlain: token,
    verificationCode: String(formData.get("code") ?? ""),
    choice: formData.get("choice") as never,
    ipHash: ip ? sha256(ip) : null,
    userAgent: h.get("user-agent"),
  });
  if (!result.ok) {
    redirect(`/glasanje/${token}?err=${result.error}`);
  }
  redirect(`/glasanje/${token}?receipt=${result.receipt.voteId}`);
}

export default async function VotePage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ err?: string; receipt?: string }>;
}) {
  const { token } = await params;
  const { err, receipt } = await searchParams;

  if (receipt) {
    return (
      <Shell>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-lg font-semibold text-emerald-800">Izjašnjavanje je evidentirano</h2>
          <p className="mt-1 text-sm text-emerald-700">
            Potvrda (bez povjerljivih podataka): <span className="font-mono">{receipt}</span>
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Vaš glas je zabilježen kao nepromjenjiv zapis. Detalje svojih izjašnjavanja možete vidjeti
            u aplikaciji nakon prijave. Ovu stranicu možete zatvoriti.
          </p>
        </div>
      </Shell>
    );
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const info = await inspectApprovalToken(token, ip ? sha256(ip) : null);

  if (!info.ok) {
    return (
      <Shell>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {ERR_TEXT[info.error] ?? "Link nije važeći."}
        </div>
      </Shell>
    );
  }

  const errMsg = err === "ack" ? "Morate potvrditi izjavu prije slanja." : err ? (ERR_TEXT[err] ?? "Greška.") : undefined;

  return (
    <Shell zevName={info.proposal.zevName}>
      <div className="space-y-4">
        <Card title="1. Ko ste vi">
          <p className="text-[15px] text-slate-900">
            {info.voter.proxyName
              ? <>{info.voter.proxyName} — kao punomoćnik vlasnika <b>{info.voter.ownerName}</b></>
              : <b>{info.voter.ownerName}</b>}
          </p>
          <p className="mt-1 text-sm text-slate-500">Vaša glasačka težina: {formatWeight(info.voter.weight)}</p>
        </Card>

        <Card title="2. O čemu se izjašnjavate">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{info.proposal.meetingTitle}</div>
          <h2 className="mt-1 max-w-[68ch] font-semibold text-slate-900">
            {info.proposal.code} (verzija {info.proposal.version}) — {info.proposal.title}
          </h2>
          <p className="mt-3 max-w-[68ch] whitespace-pre-wrap text-[16px] leading-relaxed text-slate-900">
            {info.proposal.text}
          </p>
          {info.proposal.rationale && (
            <p className="mt-3 max-w-[68ch] whitespace-pre-wrap text-sm text-slate-600">
              <b>Obrazloženje:</b> {info.proposal.rationale}
            </p>
          )}
          <p className="mt-3 text-sm text-slate-500">Glasanje otvoreno do {formatDateTime(info.proposal.votingClosesAt)}</p>
          <p className="mt-3 text-xs text-slate-400">
            Tehnički otisak teksta (SHA-256): {info.proposal.contentHash?.slice(0, 20)}… — garantuje da tekst
            prijedloga nije mijenjan nakon što vam je poslat.
          </p>
        </Card>

        <Card title="3. Vaše izjašnjenje">
          {errMsg && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errMsg}</div>
          )}
          <form action={voteAction} className="space-y-5">
            <input type="hidden" name="token" value={token} />
            <fieldset className="group/vote">
              <legend className="mb-2 text-sm font-medium text-slate-700">Vaš izbor</legend>
              <div className="space-y-2">
                <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 transition-colors has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-600 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500">
                  <input type="radio" name="choice" value="APPROVE" required className="h-5 w-5 shrink-0 accent-blue-600" />
                  <span className="text-base font-medium text-slate-900">Za (odobravam)</span>
                </label>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 transition-colors has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-600 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500">
                  <input type="radio" name="choice" value="REJECT" className="h-5 w-5 shrink-0 accent-blue-600" />
                  <span className="text-base font-medium text-slate-900">Protiv (odbijam)</span>
                </label>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 transition-colors has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-600 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500">
                  <input type="radio" name="choice" value="ABSTAIN" className="h-5 w-5 shrink-0 accent-blue-600" />
                  <span className="text-base font-medium text-slate-900">Uzdržan/a</span>
                </label>
              </div>

              <div className="mt-5">
                <Field label="Verifikacioni kod (dobili ste ga uz link)" hint="Potvrda identiteta — sam link nije dovoljan dokaz.">
                  <input name="code" required inputMode="numeric" autoComplete="one-time-code" className={inputCls} />
                </Field>
              </div>

              <label className="mt-4 flex items-start gap-2 text-[15px] text-slate-700">
                <input type="checkbox" name="ack" required className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
                <span>{info.ackText}</span>
              </label>

              <details className="group/confirm mt-5">
                <ToggleBtn variant="primary">Potvrdi i pošalji izjašnjenje</ToggleBtn>
                <div className="mt-3 space-y-3 rounded-lg border border-amber-600/40 bg-amber-50/70 p-3">
                  <p className="text-sm font-semibold text-amber-900">Slanje izjašnjenja je konačno</p>
                  <div className="text-sm text-amber-900">
                    <p className="hidden group-has-[input[value=APPROVE]:checked]/vote:block">
                      Izjašnjavate se <b>ZA</b> prijedlog {info.proposal.code}. Ovo je konačno i ne može se promijeniti.
                    </p>
                    <p className="hidden group-has-[input[value=REJECT]:checked]/vote:block">
                      Izjašnjavate se <b>PROTIV</b> prijedloga {info.proposal.code}. Ovo je konačno i ne može se promijeniti.
                    </p>
                    <p className="hidden group-has-[input[value=ABSTAIN]:checked]/vote:block">
                      Izjašnjavate se kao <b>UZDRŽAN/A</b> po prijedlogu {info.proposal.code}. Ovo je konačno i ne može se promijeniti.
                    </p>
                    <p className="group-has-[input[name=choice]:checked]/vote:hidden text-red-700">
                      Izaberite jednu od tri opcije iznad prije potvrde.
                    </p>
                  </div>
                  <SubmitBtn>Da, pošalji izjašnjenje</SubmitBtn>
                </div>
              </details>
            </fieldset>
          </form>
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ zevName, children }: { zevName?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl p-4 md:py-10">
      <div className="mb-6 flex justify-center md:justify-start">
        <AuthBrandHeader />
      </div>
      {children}
      <div className="mt-6 space-y-2 text-center text-xs text-slate-500 md:text-left">
        <p>
          Ovaj postupak predstavlja evidentirano elektronsko odobravanje, a ne kvalifikovani
          elektronski potpis.
        </p>
        <p>
          {zevName ? `Ovo izjašnjavanje je za ${zevName}. ` : ""}
          Ako vaš kod ne radi, link je istekao, ili imate bilo koje pitanje, obratite se
          predsjedniku vaše zajednice etažnih vlasnika.
        </p>
      </div>
    </main>
  );
}
