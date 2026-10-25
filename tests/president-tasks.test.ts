// F6.5 — "Za Vas sada" for the president (src/lib/presidentTasks.ts): rank, determinism, the 90-day window.
import { describe, it, expect } from "vitest";
import { presidentTasks, type PresidentTasksInput } from "@/lib/presidentTasks";

const NOW = new Date("2026-10-25T10:00:00Z");
const at = (iso: string) => new Date(`${iso}T10:00:00Z`);

const input = (over: Partial<PresidentTasksInput> = {}): PresidentTasksInput => ({
  now: NOW, registerStatus: "ESTABLISHED", votings: [], meetings: [], issuesBeforeDecision: [], planItemsPassed: [], reportedIssues: 0, ...over,
});
const voting = (id: string, over: Partial<PresidentTasksInput["votings"][number]> = {}): PresidentTasksInput["votings"][number] => ({
  proposalId: id, code: `P-${id}`, title: `Prijedlog ${id}`, meetingId: "m1", meetingTitle: "Skupština",
  closesAt: at("2026-11-10"), voted: 2, voters: 5, quorumReached: true, quorumNeeded: null, ...over,
});

describe("presidentTasks", () => {
  it("empty input is an empty list", () => {
    const r = presidentTasks(input());
    expect(r.tasks).toEqual([]);
    expect(r.allClear).toBe(true);
  });

  it("rank: register > deadline passed > expiring without quorum > meeting > before decision > passed inspection > new reports", () => {
    const r = presidentTasks(input({
      registerStatus: "REVIEW",
      votings: [
        voting("exp", { closesAt: at("2026-10-27"), quorumReached: false, quorumNeeded: "3" }),
        voting("late", { closesAt: at("2026-10-20") }),
      ],
      meetings: [{ id: "m2", title: "Sjednica", scheduledAt: at("2026-10-29"), nextStepLabel: "Zakaži sjednicu", warnings: [] }],
      issuesBeforeDecision: [{ id: "i1", title: "Lift", status: "APPROVED", proposalCode: "P-9" }],
      planItemsPassed: [{ id: "pi1", planId: "pl1", name: "Pregled kotlarnice", scheduledDate: at("2026-10-15") }],
      reportedIssues: 2,
    }));
    expect(r.tasks.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.tasks.map((t) => t.key)).toEqual(["register", "vote-overdue:late", "vote-expiring:exp", "meeting:m2", "issue-before:i1", "plan-item:pi1", "issues-reported"]);
    expect(r.allClear).toBe(false);
  });

  it("only the most urgent item is primary", () => {
    const r = presidentTasks(input({ votings: [voting("a", { closesAt: at("2026-10-20") }), voting("b", { closesAt: at("2026-10-21") })], reportedIssues: 1 }));
    expect(r.tasks.filter((t) => t.primary)).toHaveLength(1);
    expect(r.tasks[0].primary).toBe(true);
  });

  it("is deterministic: the order does not depend on the input order", () => {
    const a = voting("a", { closesAt: at("2026-10-20") });
    const b = voting("b", { closesAt: at("2026-10-21") });
    const c = voting("c", { closesAt: at("2026-10-20") });
    const one = presidentTasks(input({ votings: [a, b, c] })).tasks.map((t) => t.key);
    const two = presidentTasks(input({ votings: [c, b, a] })).tasks.map((t) => t.key);
    expect(one).toEqual(two);
    expect(one).toEqual(["vote-overdue:a", "vote-overdue:c", "vote-overdue:b"]);
  });

  it("a vote that expires soon WITH quorum, or later than 3 days, is not a task", () => {
    const r = presidentTasks(input({
      votings: [voting("ok", { closesAt: at("2026-10-27"), quorumReached: true }), voting("far", { closesAt: at("2026-11-05"), quorumReached: false })],
    }));
    expect(r.tasks).toEqual([]);
  });

  it("a meeting more than 7 days away is not a task; its warnings become the meta line", () => {
    const r = presidentTasks(input({
      meetings: [
        { id: "far", title: "Daleko", scheduledAt: at("2026-11-10"), nextStepLabel: "x", warnings: [] },
        { id: "near", title: "Blizu", scheduledAt: at("2026-10-28"), nextStepLabel: "Pošalji pozive", warnings: ["Prijedlog UO-2026-01 nije vezan za tačku 1."] },
      ],
    }));
    expect(r.tasks.map((t) => t.key)).toEqual(["meeting:near"]);
    expect(r.tasks[0].sentence).toContain("Pošalji pozive");
    expect(r.tasks[0].meta).toContain("UO-2026-01");
  });

  it("an inspection older than 90 days is not a task; one inside the window is", () => {
    const r = presidentTasks(input({
      planItemsPassed: [
        { id: "old", planId: "pl", name: "Staro", scheduledDate: at("2026-06-01") },
        { id: "new", planId: "pl", name: "Skoro", scheduledDate: at("2026-10-16") },
        { id: "future", planId: "pl", name: "Buduće", scheduledDate: at("2026-11-16") },
      ],
    }));
    expect(r.tasks.map((t) => t.key)).toEqual(["plan-item:new"]);
  });

  it("an established register gives no register item", () => {
    expect(presidentTasks(input({ registerStatus: "ESTABLISHED" })).tasks).toEqual([]);
    expect(presidentTasks(input({ registerStatus: "DRAFT" })).tasks.map((t) => t.key)).toEqual(["register"]);
  });

  it("new reports are one summary item with the right plural form", () => {
    expect(presidentTasks(input({ reportedIssues: 1 })).tasks[0].sentence).toContain("1 nova");
    expect(presidentTasks(input({ reportedIssues: 3 })).tasks[0].sentence).toContain("3 nove");
    expect(presidentTasks(input({ reportedIssues: 7 })).tasks[0].sentence).toContain("7 novih");
  });
});
