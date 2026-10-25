// F6.1 — the pure model of the meeting's next step (src/lib/meetingNextStep.ts): label, kind and the ✓/⚠ facts per status.
import { describe, it, expect } from "vitest";
import { meetingNextStep, type MeetingNextStepInput } from "@/lib/meetingNextStep";
import type { MeetingStatus } from "@/generated/prisma/client";

const NOW = new Date("2026-10-25T10:00:00Z");
const day = (iso: string) => new Date(`${iso}T10:00:00Z`);

const base = (status: MeetingStatus, over: Partial<MeetingNextStepInput> = {}): MeetingNextStepInput => ({
  meetingId: "m1",
  status,
  body: "ASSEMBLY",
  scheduledAt: day("2026-11-10"),
  now: NOW,
  agendaItems: [{ id: "a1", order: 1, title: "Tačka 1", proposalCount: 1 }],
  proposals: [],
  ...over,
});

const prop = (over: Partial<MeetingNextStepInput["proposals"][number]> = {}): MeetingNextStepInput["proposals"][number] => ({
  id: "p1", code: "P-1", status: "DRAFT", agendaItemId: "a1", votingClosesAt: day("2026-11-07"),
  voters: 5, voted: 0, quorumReached: null, decisionNumber: null, ...over,
});

describe("meetingNextStep — status, target and kind", () => {
  const table: [MeetingStatus, MeetingStatus, "plain" | "confirm"][] = [
    ["DRAFT", "SCHEDULED", "plain"],
    ["SCHEDULED", "INVITATIONS_PREPARED", "plain"],
    ["INVITATIONS_PREPARED", "INVITATIONS_SENT", "confirm"],
    ["INVITATIONS_SENT", "VOTING_OPEN", "confirm"],
    ["VOTING_OPEN", "VOTING_CLOSED", "confirm"],
    ["VOTING_CLOSED", "RESULTS_REVIEW", "plain"],
    ["RESULTS_REVIEW", "DECISION_RECORDED", "plain"],
    ["DECISION_RECORDED", "MINUTES_FINALIZED", "confirm"],
    ["MINUTES_FINALIZED", "ARCHIVED", "plain"],
  ];
  it.each(table)("%s -> %s (%s)", (from, to, kind) => {
    const s = meetingNextStep(base(from))!;
    expect(s.from).toBe(from);
    expect(s.to).toBe(to);
    expect(s.kind).toBe(kind);
    expect(s.label.length).toBeGreaterThan(0);
    expect(s.consequence.length).toBeGreaterThan(0);
  });

  it("an archived meeting has no next step", () => {
    expect(meetingNextStep(base("ARCHIVED"))).toBeNull();
  });

  it("finalizing the minutes is irreversible: kind confirm", () => {
    expect(meetingNextStep(base("DECISION_RECORDED", { minutesDraftExists: true }))!.kind).toBe("confirm");
  });

  it("labels and sentences come from the dictionary (no raw keys)", () => {
    for (const [from] of table) {
      const s = meetingNextStep(base(from))!;
      expect(s.label).not.toContain("meetingStep.");
      expect(s.consequence).not.toContain("meetingStep.");
    }
  });
});

describe("meetingNextStep — preconditions are facts from the data", () => {
  it("DRAFT: empty agenda and a passed date are warnings; a non-empty agenda and a future date are ticks", () => {
    const bad = meetingNextStep(base("DRAFT", { agendaItems: [], scheduledAt: day("2026-10-01") }))!;
    expect(bad.preconditions.map((p) => p.ok)).toEqual([false, false]);
    const good = meetingNextStep(base("DRAFT"))!;
    expect(good.preconditions.map((p) => p.ok)).toEqual([true, true]);
    // a warning never blocks the button
    expect(bad.kind).toBe("plain");
  });

  it("SCHEDULED: an item without a proposal is announced as discussion; an unlinked proposal is a warning with a link", () => {
    const s = meetingNextStep(base("SCHEDULED", {
      agendaItems: [{ id: "a1", order: 1, title: "A", proposalCount: 1 }, { id: "a2", order: 2, title: "B", proposalCount: 0 }],
      proposals: [prop(), prop({ id: "p2", code: "UO-2026-01", agendaItemId: null })],
    }))!;
    expect(s.preconditions[0]).toMatchObject({ ok: false });
    expect(s.preconditions[0].text).toContain("2");
    const unlinked = s.preconditions.find((p) => p.text.includes("UO-2026-01"))!;
    expect(unlinked.ok).toBe(false);
    expect(unlinked.href).toBe("/skupstina/m1#dnevni-red");
  });

  it("SCHEDULED: everything linked gives a single tick", () => {
    const s = meetingNextStep(base("SCHEDULED", { proposals: [prop()] }))!;
    expect(s.preconditions).toHaveLength(1);
    expect(s.preconditions[0].ok).toBe(true);
  });

  it("INVITATIONS_PREPARED: missing PDF and people without e-mail are warnings", () => {
    const s = meetingNextStep(base("INVITATIONS_PREPARED", { invitations: { withEmail: 3, withoutEmail: 2, pdfExists: false } }))!;
    expect(s.preconditions.map((p) => p.ok)).toEqual([false, false]);
    expect(s.consequence).toContain("3");
    const ok = meetingNextStep(base("INVITATIONS_PREPARED", { invitations: { withEmail: 3, withoutEmail: 0, pdfExists: true } }))!;
    expect(ok.preconditions.map((p) => p.ok)).toEqual([true]);
  });

  it("INVITATIONS_SENT: a session the service would refuse is kind 'blocked' with warnings and links; otherwise confirm", () => {
    const blocked = meetingNextStep(base("INVITATIONS_SENT", {
      sessionOpen: { blocked: true, sessionErrors: ["Različiti rokovi."], proposals: [{ id: "p9", code: "P-9", errors: ["nema roka glasanja"] }] },
    }))!;
    expect(blocked.kind).toBe("blocked");
    expect(blocked.preconditions.map((p) => p.ok)).toEqual([false, false]);
    expect(blocked.preconditions[1].href).toBe("/skupstina/prijedlog/p9");
    const open = meetingNextStep(base("INVITATIONS_SENT", { sessionOpen: { blocked: false, sessionErrors: [], proposals: [{ id: "p1", code: "P-1", errors: [] }] } }))!;
    expect(open.kind).toBe("confirm");
    expect(open.preconditions.every((p) => p.ok)).toBe(true);
  });

  it("VOTING_OPEN: per open proposal 'voted X of Y, deadline'; a running deadline or a missing quorum is a warning", () => {
    const s = meetingNextStep(base("VOTING_OPEN", {
      proposals: [
        prop({ id: "p1", code: "P-1", status: "VOTING_OPEN", voted: 3, voters: 5, votingClosesAt: day("2026-11-07"), quorumReached: true }),
        prop({ id: "p2", code: "P-2", status: "VOTING_OPEN", voted: 1, voters: 5, votingClosesAt: day("2026-10-20"), quorumReached: false }),
      ],
    }))!;
    expect(s.preconditions).toHaveLength(2);
    expect(s.preconditions[0].ok).toBe(false); // deadline 07.11. still runs
    expect(s.preconditions[0].text).toContain("3");
    expect(s.preconditions[0].text).toContain("5");
    expect(s.preconditions[1].ok).toBe(false); // no quorum
    const done = meetingNextStep(base("VOTING_OPEN", {
      proposals: [prop({ status: "VOTING_OPEN", voted: 4, voters: 5, votingClosesAt: day("2026-10-20"), quorumReached: true })],
    }))!;
    expect(done.preconditions[0].ok).toBe(true);
    expect(done.kind).toBe("confirm");
  });

  it("VOTING_CLOSED: all closed -> a tick that counts adopted and rejected", () => {
    const s = meetingNextStep(base("VOTING_CLOSED", { proposals: [prop({ status: "ACCEPTED" }), prop({ id: "p2", status: "REJECTED" }), prop({ id: "p3", status: "WITHDRAWN" })] }))!;
    expect(s.preconditions).toHaveLength(1);
    expect(s.preconditions[0].ok).toBe(true);
  });

  it("RESULTS_REVIEW: an adopted proposal without a decision number is a warning with a link", () => {
    const s = meetingNextStep(base("RESULTS_REVIEW", { proposals: [prop({ status: "ACCEPTED", decisionNumber: null }), prop({ id: "p2", code: "P-2", status: "ACCEPTED", decisionNumber: "12/26" })] }))!;
    expect(s.preconditions).toHaveLength(1);
    expect(s.preconditions[0]).toMatchObject({ ok: false, href: "/skupstina/prijedlog/p1" });
    const ok = meetingNextStep(base("RESULTS_REVIEW", { proposals: [prop({ status: "ACCEPTED", decisionNumber: "12/26" })] }))!;
    expect(ok.preconditions[0].ok).toBe(true);
  });

  it("DECISION_RECORDED: a draft of the minutes is a tick, its absence a warning", () => {
    expect(meetingNextStep(base("DECISION_RECORDED", { minutesDraftExists: true }))!.preconditions[0].ok).toBe(true);
    expect(meetingNextStep(base("DECISION_RECORDED", { minutesDraftExists: false }))!.preconditions[0].ok).toBe(false);
  });

  it("MINUTES_FINALIZED has no preconditions", () => {
    expect(meetingNextStep(base("MINUTES_FINALIZED"))!.preconditions).toEqual([]);
  });
});
