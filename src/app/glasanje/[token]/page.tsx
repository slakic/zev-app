// Public (token-authenticated) electronic approval page.
// The link is personal; identity is confirmed with a separately delivered
// one-time verification code before the vote can be submitted.
//
// Context that shapes every decision on this page (Plans/ui-ux-redesign-plan.md §6.1):
// the person here is an owner who got an e-mail, clicks the link once in their life, has
// no prior experience with the app, and the action is legally relevant, irreversible and
// one-time. Since F4 both links (session ballot, single proposal) open the SAME form
// (`BallotForm`), and a cast vote can be looked at again through `?potvrda={receiptId}`
// (the id of the receipt — never the choice — is what the address carries).
import { headers } from "next/headers";
import { getVoteReceipt, inspectApprovalToken, inspectBallot, isBallotLink } from "@/server/services/meetings";
import { sha256 } from "@/server/auth/tokens";
import { formatDateTime, t, tf } from "@/lib/i18n";
import { formatWeight } from "@/lib/money";
import { Flash } from "@/components/ui";
import { Shell } from "./shell";
import { BallotForm } from "./ballot-form";
import { VoteReceipt } from "./receipt";
import { submitBallotAction, submitSingleVoteAction } from "./actions";

/** Errors after which "who do I ask for a new link" is the voter's next step. */
const WITH_CONTACT = new Set(["not_found", "revoked", "expired"]);

export default async function VotePage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ potvrda?: string; receipt?: string }>;
}) {
  const { token } = await params;
  const { potvrda, receipt } = await searchParams;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ipHash = ip ? sha256(ip) : null;

  // `?receipt=` is the pre-2.55.0 address of a single-link receipt: kept as an alias, it now opens the full receipt too.
  const receiptId = potvrda ?? receipt;
  if (receiptId) {
    const res = await getVoteReceipt({ tokenPlain: token, receiptId, ipHash });
    if (res.ok) {
      const r = res.receipt;
      return (
        <Shell>
          <VoteReceipt
            receipt={{
              meetingTitle: r.meetingTitle,
              voterName: r.voterName,
              submittedAt: r.submittedAt.toISOString(),
              closesAt: r.closesAt ? r.closesAt.toISOString() : null,
              items: r.items,
              skipped: r.skipped,
            }}
          />
        </Shell>
      );
    }
    // Wrong or unknown receipt id: fall through to what the link itself says (usually "already used").
  }

  const failure = (error: string, presidentName: string | null) => (
    <Shell presidentName={presidentName}>
      <Flash
        err={[
          t(`ballot.errors.${error}`),
          WITH_CONTACT.has(error) ? (presidentName ? tf("ballot.page.contact", { ime: presidentName }) : t("ballot.page.contactNoName")) : null,
        ].filter(Boolean).join(" ")}
      />
    </Shell>
  );

  // v2.44.0: a link from a session e-mail opens the ballot with ALL the session's proposals.
  if (await isBallotLink(token)) {
    const ballot = await inspectBallot(token, ipHash);
    if (!ballot.ok) return failure(ballot.error, ballot.presidentName);
    return (
      <Shell zevName={ballot.zevName} presidentName={ballot.presidentName}>
        <BallotForm
          variant="session"
          action={submitBallotAction}
          token={token}
          meetingTitle={ballot.meetingTitle}
          recipientName={ballot.recipientName}
          untilLabel={formatDateTime(ballot.expiresAt)}
          closesAt={ballot.expiresAt.toISOString()}
          ackText={ballot.ackText}
          weight={null}
          who={{ body: ballot.body, units: ballot.units }}
          contact={{ presidentName: ballot.presidentName }}
          proposals={ballot.proposals.map((p) => ({
            proposalId: p.proposalId,
            code: p.code,
            version: p.version,
            title: p.title,
            text: p.text,
            rationale: p.rationale,
            contentHash: p.contentHash,
            attachments: p.attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, sha256: a.sha256 })),
            state: p.state,
            ownerName: p.ownerName,
            proxyName: p.proxyName,
            subjectName: p.subjectName,
          }))}
        />
      </Shell>
    );
  }

  const info = await inspectApprovalToken(token, ipHash);
  if (!info.ok) return failure(info.error === "voting_closed" ? "voting_closed_single" : info.error, info.presidentName);

  const weight = formatWeight(info.voter.weight);
  return (
    <Shell zevName={info.proposal.zevName} presidentName={info.presidentName}>
      <BallotForm
        variant="single"
        action={submitSingleVoteAction}
        token={token}
        meetingTitle={info.proposal.meetingTitle}
        recipientName={info.voter.proxyName ?? info.voter.ownerName}
        untilLabel={formatDateTime(info.proposal.votingClosesAt)}
        closesAt={info.proposal.votingClosesAt ? info.proposal.votingClosesAt.toISOString() : null}
        ackText={info.ackText}
        weight={weight === "1" ? null : weight}
        who={{ body: info.proposal.body, units: info.voter.proxyName ? [] : info.voter.units }}
        contact={{ presidentName: info.presidentName }}
        proposals={[
          {
            proposalId: info.proposal.id,
            code: info.proposal.code,
            version: info.proposal.version,
            title: info.proposal.title,
            text: info.proposal.text,
            rationale: info.proposal.rationale,
            contentHash: info.proposal.contentHash,
            attachments: info.proposal.attachments,
            state: "open",
            ownerName: info.voter.ownerName,
            proxyName: info.voter.proxyName,
            subjectName: info.voter.subjectName,
          },
        ]}
      />
    </Shell>
  );
}
