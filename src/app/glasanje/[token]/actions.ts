"use server";
// Public server action of the session ballot (v2.44.0). Returns state instead of redirecting, so the voter's
// choices stay on the screen when something is wrong (a wrong code, a missing choice) and the receipt can be
// shown once, right after sending, without the choice ever travelling in a URL.
import { headers } from "next/headers";
import { submitBallot } from "@/server/services/meetings";
import { sha256 } from "@/server/auth/tokens";

export type BallotActionState =
  | null
  | { error: string; proposals?: string[] }
  | {
      error?: undefined;
      receipt: {
        meetingTitle: string;
        submittedAt: string;
        items: { code: string; title: string; voteId: string; choice: string }[];
        skipped: { code: string; title: string; reason: "closed" | "voted" }[];
      };
    };

export async function submitBallotAction(_prev: BallotActionState, formData: FormData): Promise<BallotActionState> {
  const token = String(formData.get("token") ?? "");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const choices: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("choice:")) choices[key.slice("choice:".length)] = String(value);
  }
  const res = await submitBallot({
    tokenPlain: token,
    verificationCode: String(formData.get("code") ?? ""),
    choices,
    ack: formData.get("ack") === "on",
    ipHash: ip ? sha256(ip) : null,
    userAgent: h.get("user-agent"),
  });
  if (!res.ok) return { error: res.error, proposals: "proposals" in res ? res.proposals?.map((p) => p.code) : undefined };
  return {
    receipt: {
      meetingTitle: res.receipt.meetingTitle,
      submittedAt: res.receipt.submittedAt.toISOString(),
      items: res.receipt.items.map((i) => ({ code: i.code, title: i.title, voteId: i.voteId, choice: i.choice })),
      skipped: res.receipt.skipped,
    },
  };
}
