"use client";
// The voting form of BOTH public links (F4.2): `variant="session"` is the session ballot (v2.44.0, all of a session's
// proposals, one code, one acknowledgement, one send); `variant="single"` is the older link for one proposal. One form,
// one set of rules, so a fix reaches both. Plans/glasacki-listic-po-sjednici-plan.md §4, Plans/f4-vlasnik-glasanje-plan.md.
// The choices, the code and the acknowledgement are controlled state, so a server-side error (wrong code, a proposal
// closed meanwhile) never wipes what the voter already chose (V-R03). The receipt is rendered from the action's result
// and the address becomes `?potvrda={receiptId}` — an id, never the choice (V-Q3).
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Btn, Card, ConfirmPanel, Field, Flash, RowLink, inputCls } from "@/components/ui";
import { t, tf } from "@/lib/i18n";
import type { BallotActionState } from "./actions";
import { VoteReceipt } from "./receipt";

type ProposalView = {
  proposalId: string;
  code: string;
  version: number;
  title: string;
  text: string;
  rationale: string | null;
  contentHash: string | null;
  attachments: { id: string; filename: string; mime: string; size: number; sha256: string | null }[];
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

const KIND_BY_MIME: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WEBP" };

const choiceCardCls =
  "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 transition-colors " +
  "has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-600 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500";
// Same geometry for the acknowledgement; its text runs over several lines, so the box sits at the top.
const ackCardCls = choiceCardCls.replace("items-center", "items-start");

export function BallotForm(props: {
  variant: "session" | "single";
  action: (prev: BallotActionState, formData: FormData) => Promise<BallotActionState>;
  token: string;
  meetingTitle: string;
  recipientName: string;
  untilLabel: string;
  /** ISO deadline, for the receipt ("Rezultat se objavljuje nakon zatvaranja glasanja …"). */
  closesAt: string | null;
  ackText: string;
  /** Weight of the vote when it is not 1 (single link only); null = one vote, nothing to say. */
  weight: string | null;
  who: { body: "ASSEMBLY" | "BOARD"; units: string[] };
  contact: { presidentName: string | null };
  proposals: ProposalView[];
}) {
  const { token, proposals, variant } = props;
  const single = variant === "single";
  const [state, formAction, pending] = useActionState<BallotActionState, FormData>(props.action, null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [ack, setAck] = useState(false);
  // The review panel belongs to one action state: a failed send produces a new state, which closes it again.
  const [review, setReview] = useState<{ at: BallotActionState } | null>(null);
  const [clientErrors, setClientErrors] = useState<string[]>([]);
  const errRef = useRef<HTMLDivElement>(null);
  const codeErrRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  const open = proposals.filter((p) => p.state === "open");
  const selected = open.filter((p) => choices[p.proposalId]).length;
  const reviewing = review !== null && review.at === state;
  const choiceLabel = (v: string) => t(CHOICES.find((c) => c.value === v)?.short ?? "");

  const receiptId = state && "receipt" in state && state.receipt ? state.receipt.receiptId : null;
  const serverError = state && "error" in state && state.error ? state : null;
  const badCode = serverError?.error === "bad_code";

  // After a send the address becomes the receipt's own (`?potvrda=`): a refresh or a bookmark reopens it. Id only.
  useEffect(() => {
    if (receiptId) window.history.replaceState(null, "", `/glasanje/${token}?potvrda=${receiptId}`);
  }, [receiptId, token]);
  // A server error takes focus (and is announced, role="alert"); a wrong code stands right above the code field.
  useEffect(() => {
    if (serverError) (badCode ? codeErrRef : errRef).current?.focus();
  }, [serverError, badCode]);

  if (state && "receipt" in state && state.receipt) {
    const r = state.receipt;
    const p = proposals[0];
    return (
      <VoteReceipt
        receipt={{
          meetingTitle: r.meetingTitle || props.meetingTitle,
          voterName: props.recipientName,
          submittedAt: r.submittedAt,
          closesAt: props.closesAt,
          items: single ? r.items.map((i) => ({ ...i, code: p.code, title: p.title })) : r.items,
          skipped: r.skipped,
        }}
      />
    );
  }

  const serverMessage = serverError
    ? serverError.error === "missing_choices" && serverError.proposals?.length
      ? tf("ballot.page.errMissing", { prijedlozi: serverError.proposals.join(", ") })
      : serverError.error === "invalid_choice" && serverError.proposals?.length
        ? tf("ballot.page.errInvalid", { prijedlozi: serverError.proposals.join(", ") })
        : t(`ballot.errors.${serverError.error}`)
    : null;
  // A wrong code is shown above the code field (with what to do next); every other server error below the acknowledgement.
  const errors = clientErrors.length > 0 ? clientErrors : serverMessage && !badCode ? [serverMessage] : [];
  const revoked = badCode && serverError?.attemptsLeft === 0;
  const contactLine = props.contact.presidentName
    ? tf("ballot.page.contact", { ime: props.contact.presidentName })
    : t("ballot.page.contactNoName");
  const codeError = badCode && clientErrors.length === 0
    ? revoked
      ? `${t("ballot.errors.revokedAfterAttempts")} ${contactLine}`
      : [
          t("ballot.errors.bad_code"),
          t("ballot.page.choicesKept"),
          serverError?.attemptsLeft !== undefined ? tf("ballot.page.attemptsLeft", { broj: serverError.attemptsLeft }) : null,
        ].filter(Boolean).join(" ")
    : null;

  function startReview() {
    const missing = open.filter((p) => !choices[p.proposalId]).map((p) => p.code);
    const errs: string[] = [];
    if (missing.length > 0) errs.push(single ? t("ballot.errors.missing_choices") : tf("ballot.page.errMissing", { prijedlozi: missing.join(", ") }));
    if (!code.trim()) errs.push(t("ballot.page.errCode"));
    if (!ack) errs.push(t("ballot.page.errAck"));
    setClientErrors(errs);
    if (errs.length > 0) {
      requestAnimationFrame(() => {
        errRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        errRef.current?.focus({ preventScroll: true });
      });
      return;
    }
    setReview({ at: state });
    // The panel takes focus, so a screen reader reads its title and the list of choices.
    requestAnimationFrame(() => reviewRef.current?.focus());
  }

  const whoLine = props.who.body === "BOARD"
    ? t("ballot.page.whoBoard")
    : props.who.units.length > 0
      ? tf("ballot.page.whoAssembly", { jedinice: props.who.units.join(", ") })
      : null;

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
        {whoLine && !proposals.some((p) => p.proxyName) && <p className="mt-1 text-[15px] text-slate-700">{whoLine}</p>}
        {single && props.weight && (
          <p className="mt-1 text-[15px] text-slate-700">{tf("ballot.page.weight", { tezina: props.weight })}</p>
        )}
        <p className="mt-1 text-[15px] text-slate-700">{tf("ballot.page.until", { rok: props.untilLabel })}</p>
        <p className="mt-3 max-w-[68ch] text-[15px] text-slate-700">
          {single ? t("ballot.page.introSingle") : tf("ballot.page.intro", { broj: open.length })}
        </p>
        {!single && (
          <p className="mt-3 text-[15px] font-medium text-slate-900" aria-live="polite">
            {tf(selected === open.length ? "ballot.page.counterDone" : "ballot.page.counter", { izabrano: selected, ukupno: open.length })}
          </p>
        )}
      </Card>

      {proposals.map((p) => (
        <Card key={p.proposalId}>
          <h2 className="max-w-[68ch] text-base font-semibold text-slate-900">
            {p.version > 1
              ? tf("ballot.page.proposalTitleVersion", { kod: p.code, verzija: p.version, naslov: p.title })
              : tf("ballot.page.proposalTitle", { kod: p.code, naslov: p.title })}
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
              <ul className="mt-1 space-y-1">
                {p.attachments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-3">
                    <span>
                      {tf("ballot.page.attachmentRow", {
                        naziv: a.filename,
                        vrsta: KIND_BY_MIME[a.mime] ?? a.mime,
                        velicina: Math.max(1, Math.round(a.size / 1024)),
                      })}
                    </span>
                    {/* A new tab: the same tab would lose the choices the voter already made. */}
                    <RowLink href={`/glasanje/${token}/prilog/${a.id}`} newTab>
                      {t("ballot.page.attachmentOpen")}
                      <span className="sr-only"> {a.filename} {t("ballot.page.newTab")}</span>
                    </RowLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-medium text-slate-600">{t("ballot.page.technical")}</summary>
            <div className="mt-1 space-y-1 break-all text-[13px] text-slate-600">
              {p.contentHash && <p>{tf("ballot.page.technicalBody", { otisak: p.contentHash })}</p>}
              <p>{tf("ballot.page.technicalVersion", { verzija: p.version })}</p>
              {p.attachments.map((a) => (
                <p key={a.id}>{tf("ballot.page.technicalAttachment", { naziv: a.filename, otisak: a.sha256 ?? "—" })}</p>
              ))}
            </div>
          </details>

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
        {codeError && (
          <div ref={codeErrRef} tabIndex={-1} className="mb-3 outline-none">
            <Flash err={codeError} inset />
          </div>
        )}
        <Field label={t("ballot.page.codeLabel")} hint={t(single ? "ballot.page.codeHintSingle" : "ballot.page.codeHint")}>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            aria-invalid={badCode || undefined}
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
        <label className={`mt-4 ${ackCardCls}`}>
          <input
            type="checkbox"
            name="ack"
            checked={ack}
            onChange={(e) => {
              setAck(e.target.checked);
              setClientErrors([]);
            }}
            className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600"
          />
          <span className="text-[15px] text-slate-700">
            <b>{t(single ? "ballot.page.ackPrefixSingle" : "ballot.page.ackPrefix")}</b> {props.ackText}
          </span>
        </label>

        {errors.length > 0 && (
          <div ref={errRef} tabIndex={-1} className="mt-4 space-y-2 outline-none">
            {errors.map((e) => (
              <Flash key={e} err={e} inset />
            ))}
          </div>
        )}

        {!single && (
          <p className="mt-4 text-[15px] font-medium text-slate-900" aria-live="polite">
            {tf(selected === open.length ? "ballot.page.counterDone" : "ballot.page.counter", { izabrano: selected, ukupno: open.length })}
          </p>
        )}

        {!reviewing ? (
          <div className="mt-3">
            <Btn type="button" variant="secondary" onClick={startReview}>{t("ballot.page.review")}</Btn>
          </div>
        ) : (
          <div ref={reviewRef} tabIndex={-1} className="mt-3 outline-none">
            {/* D6 (design-system §4.2): the panel has no form of its own; its button submits THIS form. */}
            <ConfirmPanel
              formless
              titleId="vote-review-title"
              title={t("ballot.page.reviewTitle")}
              confirmLabel={pending ? t("ballot.page.sending") : t("ballot.page.send")}
              confirmVariant="primary"
              confirmDisabled={pending}
              body={
                <>
                  <p className="text-[15px] text-amber-900">{t("ballot.page.reviewIntro")}</p>
                  <ul className="space-y-1 text-[15px] text-amber-950">
                    {open.map((p) => (
                      <li key={p.proposalId}>
                        {tf("ballot.page.reviewRow", { kod: p.code, naslov: p.title })}: <b>{choiceLabel(choices[p.proposalId])}</b>
                      </li>
                    ))}
                  </ul>
                </>
              }
              footer={
                <Btn type="button" variant="secondary" onClick={() => setReview(null)} disabled={pending}>
                  {t("ballot.page.back")}
                </Btn>
              }
            />
          </div>
        )}
      </Card>
    </form>
  );
}
