// Public (token-authenticated) electronic approval page.
// The link is personal; identity is confirmed with a separately delivered
// one-time verification code before the vote can be submitted.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { inspectApprovalToken, submitVote } from "@/server/services/meetings";
import { sha256 } from "@/server/auth/tokens";
import { formatDateTime } from "@/lib/i18n";
import { formatWeight } from "@/lib/money";
import { Field, inputCls, SubmitBtn } from "@/components/ui";

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
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
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
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {ERR_TEXT[info.error] ?? "Link nije važeći."}
        </div>
      </Shell>
    );
  }

  const errMsg = err === "ack" ? "Morate potvrditi izjavu prije slanja." : err ? ERR_TEXT[err] : undefined;

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Elektronsko izjašnjavanje</h1>
      <p className="mt-1 text-sm text-slate-500">
        {info.voter.proxyName
          ? `${info.voter.proxyName} — kao punomoćnik vlasnika ${info.voter.ownerName}`
          : info.voter.ownerName}
        {" · "}glasačka težina: {formatWeight(info.voter.weight)}
      </p>

      <div className="mt-4 rounded-md border border-slate-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">{info.proposal.meetingTitle}</div>
        <h2 className="mt-1 font-semibold">{info.proposal.code} (verzija {info.proposal.version}) — {info.proposal.title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{info.proposal.text}</p>
        {info.proposal.rationale && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600"><b>Obrazloženje:</b> {info.proposal.rationale}</p>
        )}
        <p className="mt-2 text-xs text-slate-400">
          Glasanje otvoreno do {formatDateTime(info.proposal.votingClosesAt)} · otisak sadržaja (SHA-256): {info.proposal.contentHash?.slice(0, 20)}…
        </p>
      </div>

      {errMsg && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errMsg}</div>}

      <form action={voteAction} className="mt-4 space-y-4 rounded-md border border-slate-200 bg-white p-4">
        <input type="hidden" name="token" value={token} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">Vaše izjašnjenje</legend>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="choice" value="APPROVE" required /> Za (odobravam)</label>
            <label className="flex items-center gap-2"><input type="radio" name="choice" value="REJECT" /> Protiv (odbijam)</label>
            <label className="flex items-center gap-2"><input type="radio" name="choice" value="ABSTAIN" /> Uzdržan/a</label>
          </div>
        </fieldset>
        <Field label="Verifikacioni kod (dobili ste ga uz link)" hint="Potvrda identiteta — sam link nije dovoljan dokaz.">
          <input name="code" required inputMode="numeric" autoComplete="one-time-code" className={inputCls} />
        </Field>
        <label className="flex items-start gap-2 text-xs text-slate-600">
          <input type="checkbox" name="ack" className="mt-0.5" />
          <span>{info.ackText}</span>
        </label>
        <SubmitBtn>Potvrdi i pošalji izjašnjenje</SubmitBtn>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl p-4 md:py-10">
      <div className="mb-4 text-sm font-bold text-blue-700">ZEV upravnik — elektronsko odobravanje</div>
      {children}
      <p className="mt-6 text-xs text-slate-400">
        Ovaj postupak predstavlja evidentirano elektronsko odobravanje, a ne kvalifikovani elektronski potpis.
      </p>
    </main>
  );
}
