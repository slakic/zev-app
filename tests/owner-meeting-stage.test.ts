// F4.5 — tri koraka sjednice za vlasnika umjesto deset (čista funkcija).
import { describe, it, expect } from "vitest";
import { ownerMeetingStage } from "@/lib/ownerMeetingStage";
import type { MeetingStatus } from "@/generated/prisma/client";

const CASES: [MeetingStatus, "SCHEDULED" | "VOTING" | "DECIDED", string][] = [
  ["DRAFT", "SCHEDULED", "scheduled"],
  ["SCHEDULED", "SCHEDULED", "scheduled"],
  ["INVITATIONS_PREPARED", "SCHEDULED", "scheduled"],
  ["INVITATIONS_SENT", "SCHEDULED", "scheduled"],
  ["VOTING_OPEN", "VOTING", "votingOpen"],
  ["VOTING_CLOSED", "VOTING", "votingReview"],
  ["RESULTS_REVIEW", "VOTING", "votingReview"],
  ["DECISION_RECORDED", "DECIDED", "decided"],
  ["MINUTES_FINALIZED", "DECIDED", "decided"],
  ["ARCHIVED", "DECIDED", "decided"],
];

describe("ownerMeetingStage", () => {
  it.each(CASES)("%s -> %s / %s", (status, activeKey, sentenceKey) => {
    expect(ownerMeetingStage(status)).toEqual({ activeKey, sentenceKey });
  });
});
