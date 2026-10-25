"use client";
// Session ballot (v2.44.0): all of a session's proposals on one page, one code, one acknowledgement, one send.
// Plans/glasacki-listic-po-sjednici-plan.md §4. The choices, the code and the acknowledgement are controlled state,
// so a server-side error (wrong code, a proposal closed meanwhile) never wipes what the voter already chose (V-R03).
// The receipt is rendered from the action's result and never put in a URL (V-Q3).
import { startTransition, useActionState, useRef, useState } from "react";
import { Btn, Card, Field, inputCls } from "@/components/ui";
import { formatDateTime, t, tf } from "@/lib/i18n";
import { submitBallotAction, type BallotActionState } from "./actions";

type ProposalView = {
  proposalId: string;
  code: string;
  version: number;
  title: string;
  text: string;
  rationale: string | null;
  contentHash: string | null;
  attachments: { id: string; filename: string; size: number; sha256: string | null }[];
  state: "open" | "closed" | "voted";
  ownerName: string;
  proxyName: string | null;
  subjectName: string | null;
};

const CHOICES = [
  { value: "APPROVE", label: "ballot.page.choiceFor", short: "ballot.page.reviewFor" },
  { value: "REJECT", label: "ballot.page.choiceAgainst", short: "ballot.page.reviewAgainst" },
  { value: "ABSTAIN", label: "ballot.page.choiceAbstain", short: "ballot.page.reviewAbstain" },
] as const;

const choiceCardCls =
  "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 transition-colors " +
  "has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-600 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500";

export function BallotForm(props: {
  token: string;
  meetingTitle: string;
  recipientName: string;
  untilLabel: string;
  ackText: string;
  proposals: ProposalView[];
}) {
  const { token, proposals } = props;
  const [state, formAction, pending] = useActionState<BallotActionState, FormData>(submitBallotAction, null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [ack, setAck] = useState(false);
  // The review panel belongs to one action state: a failed send produces a new state, which closes it again.
  const [review, setReview] = useState<{ at: BallotActionState } | null>(null);
  const [clientErrors, setClientErrors] = useState<string[]>([]);
  const errRef = useRef<HTMLDivElement>(null);

  const open = proposals.filter((p) => p.state === "open");
  const selected = open.filter((p) => choices[p.proposalId]).length;
  const reviewing = review !== null && review.at === state;
  const choiceLabel = (v: string) => t(CHOICES.find((c) => c.value === v)?.short ?? "");

  if (state && "receipt" in state && state.receipt) {
    const r = state.receipt;
    const when = formatDateTime(r.submittedAt);
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5" role="status">
          <h1 className="text-lg font-semibold text-emerald-800">{t("ballot.page.receiptTitle")}</h1>
          <p className="mt-1 text-[15px] text-emerald-800">
            {tf("ballot.page.receiptIntro", { vrijeme: when, sjednica: r.meetingTitle })}
          </p>
        </div>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <caption className="sr-only">{t("ballot.page.receiptTitle")}</caption>
              <thead>
                <tr className="border-b border-slate-200 text-[13px] text-slate-500">
                  <th scope="col" className="py-2 pr-3 font-medium">{t("ballot.page.receiptCols.proposal")}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t("ballot.page.receiptCols.choice")}</th>
                  <th scope="col" className="py-2 font-medium">{t("ballot.page.receiptCols.number")}</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.voteId} className="border-b border-slate-100 align-top last:border-0">
                    <td className="py-2 pr-3 text-slate-900">{i.code} — {i.title}</td>
                    <td className="py-2 pr-3 font-medium text-slate-900">{choiceLabel(i.choice)}</td>
                    <td className="py-2 font-mono text-[13px] text-slate-700 break-all">{i.voteId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.skipped.length > 0 && (
            <div className="mt-3 text-[13px] text-slate-600">
              <p className="font-medium">{t("ballot.page.receiptSkipped")}</p>
              <ul className="list-disc pl-5">
                {r.skipped.map((s) => (
                  <li key={s.code}>
                    {tf(s.reason === "voted" ? "ballot.page.receiptSkippedVoted" : "ballot.page.receiptSkippedClosed", { kod: s.code, naslov: s.title })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-[15px] text-slate-600">{t("ballot.page.receiptKeep")}</p>
          <div className="mt-3 print:hidden">
            <Btn type="button" variant="secondary" onClick={() => window.print()}>{t("ballot.page.print")}</Btn>
          </div>
        </Card>
      </div>
    );
  }

  const serverError = state && "error" in state && state.error ? state : null;
  const serverMessage = serverError
    ? serverError.error === "missing_choices" && serverError.proposals?.length
      ? tf("ballot.page.errMissing", { prijedlozi: serverError.proposals.join(", ") })
      : serverError.error === "invalid_choice" && serverError.proposals?.length
        ? tf("ballot.page.errInvalid", { prijedlozi: serverError.proposals.join(", ") })
        : t(`ballot.errors.${serverError.error}`)
    : null;
  const errors = clientErrors.length > 0 ? clientErrors : serverMessage ? [serverMessage] : [];

  function startReview() {
    const missing = open.filter((p) => !choices[p.proposalId]).map((p) => p.code);
    const errs: string[] = [];
    if (missing.length > 0) errs.push(tf("ballot.page.errMissing", { prijedlozi: missing.join(", ") }));
    if (!code.trim()) errs.push(t("ballot.page.errCode"));
    if (!ack) errs.push(t("ballot.page.errAck"));
    setClientErrors(errs);
    if (errs.length > 0) {
      requestAnimationFrame(() => errRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    setReview({ at: state });
  }

  return (
    <form
      className="space-y-4"
      noValidate
      // Submitted by hand from React state (not via the form `action`): React 19 resets a form after its action, which
      // would un-check the radios and the acknowledgement on a server error. Enter in the code field must not skip the review.
      onSubmit={(e) => {
        e.preventDefault();
        if (!reviewing) return;
        const fd = new FormData();
        fd.set("token", token);
        fd.set("code", code);
        if (ack) fd.set("ack", "on");
        for (const p of open) fd.set(`choice:${p.proposalId}`, choices[p.proposalId]);
        startTransition(() => formAction(fd));
      }}
    >
      <input type="hidden" name="token" value={token} />

      <Card>
        <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("ballot.page.title")}</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{props.meetingTitle}</h1>
        <p className="mt-2 text-[15px] text-slate-700">
          {tf("ballot.page.who", {})}: <b>{props.recipientName}</b>
        </p>
        <p className="mt-1 text-[15px] text-slate-700">{tf("ballot.page.until", { rok: props.untilLabel })}</p>
        <p className="mt-3 max-w-[68ch] text-[15px] text-slate-700">{tf("ballot.page.intro", { broj: open.length })}</p>
        <p className="mt-3 text-[15px] font-medium text-slate-900" aria-live="polite">
          {tf(selected === open.length ? "ballot.page.counterDone" : "ballot.page.counter", { izabrano: selected, ukupno: open.length })}
        </p>
      </Card>

      {proposals.map((p) => (
        <Card key={p.proposalId}>
          <h2 className="max-w-[68ch] text-base font-semibold text-slate-900">
            {tf("ballot.page.proposalTitle", { kod: p.code, verzija: p.version, naslov: p.title })}
          </h2>
          {(p.proxyName || p.subjectName) && (
            <p className="mt-1 text-[15px] text-slate-700">
              {p.proxyName ? tf("ballot.page.asProxy", { punomocnik: p.proxyName, vlasnik: p.ownerName }) : null}
              {p.proxyName && p.subjectName ? " " : null}
              {p.subjectName ? tf("votingSubject.public.community", { name: p.subjectName }) : null}
            </p>
          )}
          <p className="mt-3 max-w-[68ch] whitespace-pre-wrap text-[16px] leading-relaxed text-slate-900">{p.text}</p>
          {p.rationale && (
            <p className="mt-3 max-w-[68ch] whitespace-pre-wrap text-[15px] text-slate-600">
              <b>{t("ballot.page.rationale")}</b> {p.rationale}
            </p>
          )}
          {p.attachments.length > 0 && (
            <div className="mt-3 text-[15px] text-slate-700">
              <p className="font-medium">{t("ballot.page.attachments")}</p>
              <ul className="mt-1 list-disc pl-5">
                {p.attachments.map((a) => (
                  <li key={a.id}>
                    {a.filename}
                    <span className="text-[13px] text-slate-500">
                      {" "}
                      ({tf("ballot.page.attachmentMeta", { velicina: Math.max(1, Math.round(a.size / 1024)), otisak: a.sha256 ? `${a.sha256.slice(0, 12)}…` : "—" })})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.contentHash && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] font-medium text-slate-600">{t("ballot.page.technical")}</summary>
              <p className="mt-1 break-all text-[13px] text-slate-600">{tf("ballot.page.technicalBody", { otisak: p.contentHash })}</p>
            </details>
          )}

          {p.state === "open" ? (
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-medium text-slate-700">{tf("ballot.page.choiceLegend", { kod: p.code })}</legend>
              <div className="space-y-2">
                {CHOICES.map((c) => (
                  <label key={c.value} className={choiceCardCls}>
                    <input
                      type="radio"
                      name={`choice:${p.proposalId}`}
                      value={c.value}
                      checked={choices[p.proposalId] === c.value}
                      onChange={() => {
                        setChoices((prev) => ({ ...prev, [p.proposalId]: c.value }));
                        setClientErrors([]);
                      }}
                      className="h-5 w-5 shrink-0 accent-blue-600"
                    />
                    <span className="text-base font-medium text-slate-900">{t(c.label)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[15px] text-slate-700">
              {t(p.state === "voted" ? "ballot.page.stateVoted" : "ballot.page.stateClosed")}
            </p>
          )}
        </Card>
      ))}

      <Card title={t("ballot.page.identityTitle")}>
        <Field label={t("ballot.page.codeLabel")} hint={t("ballot.page.codeHint")}>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setClientErrors([]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!reviewing) startReview();
              }
            }}
            className={inputCls}
          />
        </Field>
        <label className="mt-4 flex items-start gap-2 text-[15px] text-slate-700">
          <input
            type="checkbox"
            name="ack"
            checked={ack}
            onChange={(e) => {
              setAck(e.target.checked);
              setClientErrors([]);
            }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
          />
          <span>
            <b>{t("ballot.page.ackPrefix")}</b> {props.ackText}
          </span>
        </label>

        {errors.length > 0 && (
          <div ref={errRef} role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[15px] text-red-800">
            {errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        )}

        <p className="mt-4 text-[15px] font-medium text-slate-900" aria-live="polite">
          {tf(selected === open.length ? "ballot.page.counterDone" : "ballot.page.counter", { izabrano: selected, ukupno: open.length })}
        </p>

        {!reviewing ? (
          <div className="mt-3">
            <Btn type="button" variant="secondary" onClick={startReview}>{t("ballot.page.review")}</Btn>
          </div>
        ) : (
          <div className="mt-3 space-y-3 rounded-lg border border-amber-600/40 bg-amber-50/70 p-3">
            <p className="text-sm font-semibold text-amber-900">{t("ballot.page.reviewTitle")}</p>
            <p className="text-[15px] text-amber-900">{t("ballot.page.reviewIntro")}</p>
            <ul className="space-y-1 text-[15px] text-amber-950">
              {open.map((p) => (
                <li key={p.proposalId}>
                  {tf("ballot.page.reviewRow", { kod: p.code, naslov: p.title })}: <b>{choiceLabel(choices[p.proposalId])}</b>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Btn type="submit" variant="primary" disabled={pending}>
                {pending ? t("ballot.page.sending") : t("ballot.page.send")}
              </Btn>
              <Btn type="button" variant="secondary" onClick={() => setReview(null)} disabled={pending}>
                {t("ballot.page.back")}
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </form>
  );
}
