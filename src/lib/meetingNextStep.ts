// "Sljedeći korak" sjednice (F6.1, odluka D2 A): jedan izvor istine za panel na detalju sjednice i za stavku
// "Sjednica za N dana — sljedeći korak" na početnoj predsjednika. Čista funkcija: ulaz je običan objekat sa
// podacima koje stranica ionako učitava, pa se testira bez baze. Preduslovi su isključivo činjenice iz podataka;
// ⚠ NE blokira dugme, osim kad servis zaista odbija korak (`kind: "blocked"`, samo iz `previewSessionVotingOpen`).
import { calendarDaysBetween } from "@/lib/paymentInstructions";
import { formatDate, t, tEnum, tf } from "@/lib/i18n";
import type { MeetingStatus } from "@/generated/prisma/client";

export type NextStepKind = "plain" | "confirm" | "blocked";

export type NextStepPrecondition = { ok: boolean; text: string; href?: string };

export type MeetingNextStep = {
  from: MeetingStatus;
  to: MeetingStatus;
  label: string;
  consequence: string;
  kind: NextStepKind;
  preconditions: NextStepPrecondition[];
};

export type MeetingNextStepInput = {
  meetingId: string;
  status: MeetingStatus;
  body: "ASSEMBLY" | "BOARD";
  scheduledAt: Date | null;
  now: Date;
  /** `proposalCount`: prijedlozi vezani za tačku, bez povučenih i zamijenjenih verzija. */
  agendaItems: { id: string; order: number; title: string; proposalCount: number }[];
  proposals: {
    id: string;
    code: string;
    status: string;
    agendaItemId: string | null;
    votingClosesAt: Date | null;
    /** Broj birača i broj važećih (efektivnih) glasova; 0 dok glasanje nije otvarano. */
    voters: number;
    voted: number;
    /** Samo za otvorene prijedloge; `null` kad nije izračunato. */
    quorumReached: boolean | null;
    decisionNumber: string | null;
  }[];
  /** Samo za status "Pozivi pripremljeni". */
  invitations?: { withEmail: number; withoutEmail: number; pdfExists: boolean } | null;
  /** Samo za status "Pozivi poslati": rezultat `previewSessionVotingOpen`. */
  sessionOpen?: {
    blocked: boolean;
    sessionErrors: string[];
    proposals: { id: string; code: string; errors: string[] }[];
  } | null;
  /** Samo za status "Odluke evidentirane": postoji li nacrt zapisnika. */
  minutesDraftExists?: boolean | null;
};

const NEXT_TO: Partial<Record<MeetingStatus, MeetingStatus>> = {
  DRAFT: "SCHEDULED",
  SCHEDULED: "INVITATIONS_PREPARED",
  INVITATIONS_PREPARED: "INVITATIONS_SENT",
  INVITATIONS_SENT: "VOTING_OPEN",
  VOTING_OPEN: "VOTING_CLOSED",
  VOTING_CLOSED: "RESULTS_REVIEW",
  RESULTS_REVIEW: "DECISION_RECORDED",
  DECISION_RECORDED: "MINUTES_FINALIZED",
  MINUTES_FINALIZED: "ARCHIVED",
};

/** Koraci koji šalju poruke ili su nepovratni: dugme je okidač potvrde (`caution` + `ConfirmAction`). */
const CONFIRM_TARGETS: MeetingStatus[] = ["INVITATIONS_SENT", "VOTING_OPEN", "VOTING_CLOSED", "MINUTES_FINALIZED"];

const proposalHref = (id: string) => `/skupstina/prijedlog/${id}`;
const isLive = (status: string) => status !== "WITHDRAWN" && status !== "SUPERSEDED";

/** Sljedeći korak sjednice, ili `null` za arhiviranu sjednicu. */
export function meetingNextStep(input: MeetingNextStepInput): MeetingNextStep | null {
  const to = NEXT_TO[input.status];
  if (!to) return null;
  const pre: NextStepPrecondition[] = [];
  let kind: NextStepKind = CONFIRM_TARGETS.includes(to) ? "confirm" : "plain";
  const agendaHref = `/skupstina/${input.meetingId}#dnevni-red`;

  switch (to) {
    case "SCHEDULED": {
      if (input.agendaItems.length === 0) pre.push({ ok: false, text: t("meetingStep.pre.agendaEmpty"), href: agendaHref });
      else pre.push({ ok: true, text: tf("meetingStep.pre.agendaCount", { broj: input.agendaItems.length }) });
      if (!input.scheduledAt) pre.push({ ok: false, text: t("meetingStep.pre.dateMissing") });
      else if (calendarDaysBetween(input.scheduledAt, input.now) > 0) {
        pre.push({ ok: false, text: tf("meetingStep.pre.datePassed", { datum: formatDate(input.scheduledAt) }) });
      } else pre.push({ ok: true, text: tf("meetingStep.pre.dateOk", { datum: formatDate(input.scheduledAt) }) });
      break;
    }
    case "INVITATIONS_PREPARED": {
      const discussion = input.agendaItems.filter((a) => a.proposalCount === 0);
      if (discussion.length > 0) {
        pre.push({ ok: false, text: tf("meetingStep.pre.discussionItems", { tacke: discussion.map((a) => a.order).join(", ") }), href: agendaHref });
      } else if (input.agendaItems.length > 0) {
        pre.push({ ok: true, text: t("meetingStep.pre.allItemsHaveProposal") });
      }
      for (const p of input.proposals.filter((x) => !x.agendaItemId && (x.status === "DRAFT" || x.status === "VOTING_OPEN"))) {
        pre.push({ ok: false, text: tf("meetingStep.pre.unlinkedProposal", { kod: p.code }), href: agendaHref });
      }
      break;
    }
    case "INVITATIONS_SENT": {
      if (input.invitations) {
        pre.push(
          input.invitations.pdfExists
            ? { ok: true, text: t("meetingStep.pre.invitationPdfOk") }
            : { ok: false, text: t("meetingStep.pre.invitationPdfMissing"), href: "/dokumenti" }
        );
        if (input.invitations.withoutEmail > 0) {
          pre.push({ ok: false, text: tf("meetingStep.pre.noEmail", { broj: input.invitations.withoutEmail }) });
        }
      }
      break;
    }
    case "VOTING_OPEN": {
      const so = input.sessionOpen;
      if (so) {
        for (const e of so.sessionErrors) pre.push({ ok: false, text: e });
        for (const p of so.proposals.filter((x) => x.errors.length > 0)) {
          pre.push({ ok: false, text: tf("meetingStep.pre.proposalError", { kod: p.code, razlog: p.errors.join("; ") }), href: proposalHref(p.id) });
        }
        if (so.blocked) kind = "blocked";
        else if (so.proposals.length > 0) pre.push({ ok: true, text: tf("meetingStep.pre.openDrafts", { broj: so.proposals.length }) });
        else pre.push({ ok: true, text: t("meetingStep.pre.noDrafts") });
      }
      break;
    }
    case "VOTING_CLOSED": {
      const open = input.proposals.filter((p) => p.status === "VOTING_OPEN");
      if (open.length === 0) pre.push({ ok: true, text: t("meetingStep.pre.noOpenVotes") });
      for (const p of open) {
        const running = Boolean(p.votingClosesAt && p.votingClosesAt.getTime() > input.now.getTime());
        const noQuorum = p.quorumReached === false;
        let text = tf("meetingStep.pre.closeRow", {
          kod: p.code, glasalo: p.voted, ukupno: p.voters, rok: p.votingClosesAt ? formatDate(p.votingClosesAt) : "—",
        });
        if (running) text += ` ${t("meetingStep.pre.closeRunning")}`;
        if (noQuorum) text += ` ${t("meetingStep.pre.closeNoQuorum")}`;
        pre.push({ ok: !running && !noQuorum, text, href: proposalHref(p.id) });
      }
      break;
    }
    case "RESULTS_REVIEW": {
      const live = input.proposals.filter((p) => isLive(p.status));
      const stillOpen = live.filter((p) => p.status === "VOTING_OPEN");
      if (stillOpen.length > 0) {
        pre.push({ ok: false, text: tf("meetingStep.pre.stillOpen", { broj: stillOpen.length }) });
      } else {
        const accepted = live.filter((p) => p.status === "ACCEPTED").length;
        const rejected = live.filter((p) => p.status === "REJECTED").length;
        pre.push({ ok: true, text: tf("meetingStep.pre.allClosed", { usvojeno: accepted, odbijeno: rejected }) });
      }
      break;
    }
    case "DECISION_RECORDED": {
      const accepted = input.proposals.filter((p) => p.status === "ACCEPTED");
      const missing = accepted.filter((p) => !p.decisionNumber);
      if (accepted.length === 0) pre.push({ ok: true, text: t("meetingStep.pre.noAccepted") });
      else if (missing.length === 0) pre.push({ ok: true, text: t("meetingStep.pre.decisionsOk") });
      for (const p of missing) pre.push({ ok: false, text: tf("meetingStep.pre.decisionMissing", { kod: p.code }), href: proposalHref(p.id) });
      break;
    }
    case "MINUTES_FINALIZED": {
      if (input.minutesDraftExists === true) pre.push({ ok: true, text: t("meetingStep.pre.minutesDraftOk") });
      else if (input.minutesDraftExists === false) pre.push({ ok: false, text: t("meetingStep.pre.minutesDraftMissing"), href: `/skupstina/${input.meetingId}#dokumenti` });
      break;
    }
    case "ARCHIVED":
      break;
    default:
      break;
  }

  let consequence = tEnum("meetingStep.consequence", to);
  if (to === "INVITATIONS_SENT" && input.invitations) {
    consequence = tf("meetingStep.consequence.INVITATIONS_SENT_N", { broj: input.invitations.withEmail });
  }
  if (kind === "blocked") consequence = t("confirm.sessionOpen.blockedTitle");

  return { from: input.status, to, label: tEnum("meetingStep.label", to), consequence, kind, preconditions: pre };
}
