// How the owner sees his own voting standing in the app (F4.5): the status chip, the sentences under it and the
// "who do I call" line. Shared by the proposal page and the session page, so both say the same thing. Server-safe.
// The choice is shown only to the voter himself / his proxy (F4-Q1 a) — a community voted through a representative
// never carries one (K-03a): the state has no `choice` there.
import { RowLink, StatusBadge } from "@/components/ui";
import { formatDateTime, t, tf } from "@/lib/i18n";
import type { OwnerVoteState } from "@/server/services/meetings";

export type VotingContactData = { name: string; email: string | null; phone: string | null } | null;

export function ownerStateChip(s: OwnerVoteState): { status: string; label: string } {
  switch (s.kind) {
    case "canVote": return { status: "VOTE_PENDING", label: t("ownerVoting.chip.notVoted") };
    case "voted": return { status: "VOTE_DONE", label: t("ownerVoting.chip.voted") };
    case "viaRepresentative": return { status: "VOTE_REPRESENTATIVE", label: t("ownerVoting.chip.viaRepresentative") };
    case "closedNotVoted": return { status: "VOTE_CLOSED", label: t("ownerVoting.chip.closed") };
    case "boardOnly":
    case "notInBase": return { status: "VOTE_NONE", label: t("ownerVoting.chip.noRight") };
    case "draft": return { status: "VOTE_NONE", label: t("ownerVoting.chip.none") };
  }
}

/** Whether the line "did not get the link? call the president" belongs under this state (V-Q2). */
export function needsContact(s: OwnerVoteState): boolean {
  return s.kind === "canVote";
}

export function OwnerVoteStateBlock({ state: s }: { state: OwnerVoteState }) {
  const chip = ownerStateChip(s);
  const lines: string[] = [];
  const mono: string[] = [];
  switch (s.kind) {
    case "canVote":
      lines.push(s.closesAt ? tf("ownerVoting.canVote", { rok: formatDateTime(s.closesAt) }) : t("ownerVoting.canVoteNoDate"));
      if (s.proxyName) lines.push(tf("ownerVoting.proxy", { ime: s.proxyName }));
      else if (s.forOwnerName) lines.push(tf("ownerVoting.forOwner", { ime: s.forOwnerName }));
      else if (s.link !== "none" && !s.linkActive) lines.push(t("ownerVoting.link.inactive"));
      else lines.push(t(`ownerVoting.link.${s.link}`));
      break;
    case "voted": {
      const params = { vrijeme: formatDateTime(s.at), kanal: t(`ownerVoting.channel.${s.channel}`) };
      lines.push(
        s.viaProxyName
          ? tf("ownerVoting.votedByProxy", { ime: s.viaProxyName, ...params })
          : s.forOwnerName
            ? tf("ownerVoting.votedForOwner", { ime: s.forOwnerName, ...params })
            : tf("ownerVoting.voted", params),
      );
      if (s.choice) {
        lines.push(tf(s.viaProxyName ? "ownerVoting.choiceByProxy" : "ownerVoting.choice", { izbor: t(`ownerVoting.choices.${s.choice}`) }));
      }
      mono.push(tf("ownerVoting.receiptNo", { broj: s.receiptNo }));
      break;
    }
    case "viaRepresentative":
      lines.push(
        tf(s.communityVoted ? "votingSubject.owner.viaRepresentativeVoted" : "votingSubject.owner.viaRepresentative", {
          units: s.units,
          name: s.representativeName,
        }),
      );
      if (s.at) lines.push(tf("ownerVoting.communityVotedAt", { vrijeme: formatDateTime(s.at) }));
      break;
    case "boardOnly": lines.push(t("confirm.participation.board")); break;
    case "draft": lines.push(t("confirm.participation.draft")); break;
    case "notInBase": lines.push(t("confirm.participation.notInBase")); break;
    case "closedNotVoted": lines.push(t("ownerVoting.closedNotVoted")); break;
  }
  return (
    <div className="space-y-1">
      <StatusBadge status={chip.status} label={chip.label} />
      {lines.map((l, i) => (
        <p key={i} className="text-[15px] text-slate-700">{l}</p>
      ))}
      {mono.map((l, i) => (
        <p key={i} className="break-all font-mono text-[13px] text-slate-600">{l}</p>
      ))}
    </div>
  );
}

/** "Niste dobili link? Novi lični link izdaje predsjednik ZEV-a {ime} — {telefon} · {e-adresa}." (F4-Q2 a: the app shows the contact). */
export function VotingContactLine({ contact, noEmail }: { contact: VotingContactData; noEmail?: boolean }) {
  return (
    <div className="space-y-1 text-[15px] text-slate-700">
      {contact ? (
        <p>
          {tf("ownerVoting.contact.lead", { ime: contact.name })}
          {contact.phone || contact.email ? " — " : ". "}
          {contact.phone && <RowLink href={`tel:${contact.phone.replace(/\s+/g, "")}`}>{contact.phone}</RowLink>}
          {contact.phone && contact.email ? " · " : null}
          {contact.email && <RowLink href={`mailto:${contact.email}`}>{contact.email}</RowLink>}
          {contact.phone || contact.email ? ". " : null}
          {t("ownerVoting.contact.tail")}
        </p>
      ) : (
        <p>{t("ownerVoting.contact.leadNoName")}.</p>
      )}
      {noEmail && <p>{t("ownerVoting.contact.noEmail")}</p>}
    </div>
  );
}
