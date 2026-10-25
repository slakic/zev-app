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

  // F8.5 — jedinice sa zbirom udjela ≠ 100 %.
  const warn = (label: string, kind: "OVER" | "UNDER" | "NONE", sum: string, id = label) => ({ unitId: id, label, kind, sum });

  it("share sum above 100 % is ranked right after the register item; below 100 % / no owner ranks lower", () => {
    const r = presidentTasks(input({
      registerStatus: "REVIEW",
      votings: [voting("late", { closesAt: at("2026-10-20") })],
      reportedIssues: 1,
      unitShareWarnings: [warn("Garaža 2", "UNDER", "50"), warn("Garaža 1", "OVER", "150")],
    }));
    expect(r.tasks.map((t) => t.key)).toEqual(["register", "share-sum-over", "vote-overdue:late", "share-sum-under", "issues-reported"]);
    expect(r.tasks.map((t) => t.rank)).toEqual([1, 1, 2, 7, 7]);
    expect(r.tasks[0].primary).toBe(true);
  });

  it("the over item names the units with their sums and is the first (primary) item when the register is established", () => {
    const r = presidentTasks(input({ unitShareWarnings: [warn("Garaža 1", "OVER", "150.000000")] }));
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].primary).toBe(true);
    expect(r.tasks[0].href).toBe("/vlasnici?tab=vlasnistvo");
    expect(r.tasks[0].sentence).toContain("Garaža 1: 150,00 %");
    expect(r.tasks[0].sentence).toContain("1 jedinica ima");
    expect(r.tasks[0].meta).toContain("glasanje");
  });

  it("under / none units are one summary item with plural forms and a capped list", () => {
    const r = presidentTasks(input({
      unitShareWarnings: [warn("A", "UNDER", "50"), warn("B", "NONE", "0"), warn("C", "UNDER", "80"), warn("D", "NONE", "0"), warn("E", "UNDER", "10")],
    }));
    expect(r.tasks.map((t) => t.key)).toEqual(["share-sum-under"]);
    expect(r.tasks[0].sentence).toContain("5 jedinica ima");
    expect(r.tasks[0].sentence).toContain("B: bez vlasnika");
    expect(r.tasks[0].sentence).toContain("i još 2");
    const two = presidentTasks(input({ unitShareWarnings: [warn("A", "UNDER", "50"), warn("B", "NONE", "0")] }));
    expect(two.tasks[0].sentence).toContain("2 jedinice imaju");
  });

  it("no share item while the register is a draft (the ownership tab is locked) or when every sum is 100 %", () => {
    expect(presidentTasks(input({ registerStatus: "DRAFT", unitShareWarnings: [warn("A", "OVER", "150")] })).tasks.map((t) => t.key)).toEqual(["register"]);
    expect(presidentTasks(input({ unitShareWarnings: [] })).tasks).toEqual([]);
  });

  it("share items are deterministic regardless of the input order", () => {
    const a = presidentTasks(input({ unitShareWarnings: [warn("B", "OVER", "120"), warn("A", "OVER", "130")] })).tasks[0].sentence;
    const b = presidentTasks(input({ unitShareWarnings: [warn("A", "OVER", "130"), warn("B", "OVER", "120")] })).tasks[0].sentence;
    expect(a).toBe(b);
    expect(a.indexOf("A:")).toBeLessThan(a.indexOf("B:"));
  });
});
