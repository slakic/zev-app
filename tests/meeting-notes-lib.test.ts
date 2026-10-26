// Čista logika bilješki (src/lib/meetingNotes.ts) i preduslov „Sljedećeg koraka” bez baze.
import { describe, it, expect } from "vitest";
import { notesOfItem, offAgendaTopics, noteCounts, moveNeighbor, type NoteLike } from "@/lib/meetingNotes";
import { meetingNextStep, type MeetingNextStepInput } from "@/lib/meetingNextStep";
import { t, tf } from "@/lib/i18n";

const n = (id: string, over: Partial<NoteLike> = {}): NoteLike => ({ id, agendaItemId: "a1", topic: null, kind: "NOTE", position: 1, ...over });

describe("meetingNotes lib", () => {
  it("groups an item's conclusions first, each by position", () => {
    const g = notesOfItem([n("n2", { position: 3 }), n("c1", { kind: "CONCLUSION", position: 2 }), n("n1", { position: 1 }), n("x", { agendaItemId: "a2" })], "a1");
    expect(g.conclusions.map((x) => x.id)).toEqual(["c1"]);
    expect(g.notes.map((x) => x.id)).toEqual(["n1", "n2"]);
  });

  it("orders off-agenda topics by their first note", () => {
    const topics = offAgendaTopics([
      n("b1", { agendaItemId: null, topic: "Buka", position: 2 }),
      n("a1", { agendaItemId: null, topic: "Parking", position: 1 }),
      n("b2", { agendaItemId: null, topic: "Buka", position: 3, kind: "CONCLUSION" }),
      n("item"),
    ]);
    expect(topics.map((x) => x.topic)).toEqual(["Parking", "Buka"]);
    expect(topics[1].conclusions.map((x) => x.id)).toEqual(["b2"]);
    expect(noteCounts([n("1"), n("2", { kind: "CONCLUSION" })])).toEqual({ conclusions: 1, notes: 1 });
  });

  it("finds the same-kind neighbour within the same topic only", () => {
    const all = [
      n("p1", { agendaItemId: null, topic: "Parking", position: 1 }),
      n("b1", { agendaItemId: null, topic: "Buka", position: 2 }),
      n("p2", { agendaItemId: null, topic: "parking", position: 3 }),
    ];
    expect(moveNeighbor(all, all[2], "up")?.id).toBe("p1");
    expect(moveNeighbor(all, all[0], "up")).toBeNull();
    expect(moveNeighbor(all, all[1], "down")).toBeNull();
  });
});

describe("meetingNextStep — notes precondition", () => {
  const input = (over: Partial<MeetingNextStepInput> = {}): MeetingNextStepInput => ({
    meetingId: "m1", status: "DECISION_RECORDED", body: "ASSEMBLY", scheduledAt: new Date("2026-11-10T10:00:00Z"), now: new Date("2026-11-11T10:00:00Z"),
    agendaItems: [
      { id: "a1", order: 1, title: "Budžet", proposalCount: 1 },
      { id: "a2", order: 2, title: "Razno", proposalCount: 0 },
      { id: "a3", order: 3, title: "Pitanja", proposalCount: 0 },
    ],
    proposals: [], minutesDraftExists: true, ...over,
  });

  it("totals plus a warning per item without proposal and conclusion", () => {
    const pre = meetingNextStep(input({ minutesNotes: { conclusions: 2, notes: 3, conclusionItemIds: ["a3"] } }))!.preconditions;
    expect(pre.find((p) => p.text === "Zaključaka: 2, bilješki: 3.")?.ok).toBe(true);
    const warn = pre.filter((p) => !p.ok);
    expect(warn).toHaveLength(1);
    expect(warn[0].text).toContain("Tačka 2");
  });

  it("no notes input, no precondition (other statuses and old callers)", () => {
    expect(meetingNextStep(input())!.preconditions.some((p) => p.text.includes("Zaključaka"))).toBe(false);
  });
});

describe("dictionary", () => {
  it("resolves nested notes/minutes keys in sr-Latn and en", () => {
    for (const locale of ["sr-Latn", "en"] as const) {
      expect(t("meetingNotes.kind.CONCLUSION", locale)).not.toContain("meetingNotes.");
      expect(t("minutes.title.BOARD", locale)).not.toContain("minutes.");
      expect(t("live.minutes.draftPdf", locale)).not.toContain("live.minutes");
      expect(t("meetingStep.pre.itemNoConclusion", locale)).not.toContain("meetingStep.");
    }
    expect(tf("meetingNotes.err.stale", { ime: "Ana" })).toContain("Ana");
    expect(t("auditAction.meeting.note.create")).not.toContain("auditAction.");
  });
});
