"use server";
// Public server actions of the voting link (session ballot v2.44.0, single-proposal link F4.2). They return state
// instead of redirecting, so the voter's choices stay on the screen when something is wrong (a wrong code, a missing
// choice) and the receipt is shown right after sending without the choice ever travelling in a URL. The receipt can be
// reopened later from `?potvrda={receiptId}` (`getVoteReceipt`) — the id, never the choice, is what the address carries.
import { headers } from "next/headers";
import { submitBallot, submitVote } from "@/server/services/meetings";
import { sha256 } from "@/server/auth/tokens";

export type BallotActionState =
  | null
  | { error: string; proposals?: string[]; attemptsLeft?: number }
  | {
      error?: undefined;
      receipt: {
        /** `Ballot.id` (session ballot) or `Vote.id` (single link) — what `?potvrda=` carries. */
        receiptId: string;
        meetingTitle: string;
        submittedAt: string;
        items: { code: string; title: string; voteId: string; choice: string }[];
        skipped: { code: string; title: string; reason: "closed" | "voted" }[];
      };
    };

async function clientIp(): Promise<{ ipHash: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return { ipHash: ip ? sha256(ip) : null, userAgent: h.get("user-agent") };
}

export async function submitBallotAction(_prev: BallotActionState, formData: FormData): Promise<BallotActionState> {
  const token = String(formData.get("token") ?? "");
  const { ipHash, userAgent } = await clientIp();
  const choices: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("choice:")) choices[key.slice("choice:".length)] = String(value);
  }
  const res = await submitBallot({
    tokenPlain: token,
    verificationCode: String(formData.get("code") ?? ""),
    choices,
    ack: formData.get("ack") === "on",
    ipHash,
    userAgent,
  });
  if (!res.ok) {
    return {
      error: res.error,
      proposals: "proposals" in res ? res.proposals?.map((p) => p.code) : undefined,
      attemptsLeft: "attemptsLeft" in res ? res.attemptsLeft : undefined,
    };
  }
  return {
    receipt: {
      receiptId: res.receipt.ballotId,
      meetingTitle: res.receipt.meetingTitle,
      submittedAt: res.receipt.submittedAt.toISOString(),
      items: res.receipt.items.map((i) => ({ code: i.code, title: i.title, voteId: i.voteId, choice: i.choice })),
      skipped: res.receipt.skipped,
    },
  };
}

/** Single-proposal link: the same form as the ballot, one `choice:{proposalId}`, then the unchanged `submitVote`. */
export async function submitSingleVoteAction(_prev: BallotActionState, formData: FormData): Promise<BallotActionState> {
  const token = String(formData.get("token") ?? "");
  const { ipHash, userAgent } = await clientIp();
  const choiceEntry = [...formData.entries()].find(([key]) => key.startsWith("choice:"));
  const choice = choiceEntry ? String(choiceEntry[1]) : "";
  if (!choice) return { error: "missing_choices" };
  if (!["APPROVE", "REJECT", "ABSTAIN"].includes(choice)) return { error: "invalid_choice" };
  // Checked here, before the service, so a forgotten acknowledgement never spends a verification attempt.
  if (formData.get("ack") !== "on") return { error: "ack_required" };
  const res = await submitVote({
    tokenPlain: token,
    verificationCode: String(formData.get("code") ?? ""),
    choice: choice as "APPROVE" | "REJECT" | "ABSTAIN",
    ipHash,
    userAgent,
  });
  if (!res.ok) return { error: res.error, attemptsLeft: "attemptsLeft" in res ? res.attemptsLeft : undefined };
  return {
    receipt: {
      receiptId: res.receipt.voteId,
      meetingTitle: "",
      submittedAt: res.receipt.submittedAt.toISOString(),
      items: [{ code: "", title: "", voteId: res.receipt.voteId, choice: res.receipt.choice }],
      skipped: [],
    },
  };
}
