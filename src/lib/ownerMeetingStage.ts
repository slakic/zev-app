// Sjednica očima vlasnika (F4.5): od 10 koraka uprave (DRAFT … ARCHIVED) vlasnika zanimaju tri — da li je sjednica tek
// zakazana, da li se glasa, da li su odluke donesene. Čista funkcija: bez baze, pa se testira bez nje.
import type { MeetingStatus } from "@/generated/prisma/client";

export type OwnerMeetingStageKey = "SCHEDULED" | "VOTING" | "DECIDED";

export const OWNER_MEETING_STAGES: OwnerMeetingStageKey[] = ["SCHEDULED", "VOTING", "DECIDED"];

export type OwnerMeetingStage = {
  activeKey: OwnerMeetingStageKey;
  /** Ključ rečenice u rječniku (`ownerVoting.stage.*`); `votingOpen` nosi rok glasanja (`{rok}`). */
  sentenceKey: "scheduled" | "votingOpen" | "votingReview" | "decided";
};

export function ownerMeetingStage(status: MeetingStatus): OwnerMeetingStage {
  switch (status) {
    case "VOTING_OPEN":
      return { activeKey: "VOTING", sentenceKey: "votingOpen" };
    case "VOTING_CLOSED":
    case "RESULTS_REVIEW":
      return { activeKey: "VOTING", sentenceKey: "votingReview" };
    case "DECISION_RECORDED":
    case "MINUTES_FINALIZED":
    case "ARCHIVED":
      return { activeKey: "DECIDED", sentenceKey: "decided" };
    default:
      // DRAFT, SCHEDULED, INVITATIONS_PREPARED, INVITATIONS_SENT
      return { activeKey: "SCHEDULED", sentenceKey: "scheduled" };
  }
}
