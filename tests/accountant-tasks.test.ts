// F5a.2 — "Za Vas sada" za računovođu (src/lib/accountantTasks.ts): rang, sažimanje nula, SMS samo uz uključen prijem,
// determinizam, spajanje sa listom predsjednika (F5-Q2 (a)) i predloženi period serije.
import { describe, it, expect } from "vitest";
import { accountantTasks, mergeTasks, type AccountantTasksInput } from "@/lib/accountantTasks";
import { presidentTasks } from "@/lib/presidentTasks";
import { suggestBatchPeriod, currentPeriod, nextPeriod } from "@/lib/batchPeriod";

const NOW = new Date("2026-10-25T10:00:00Z");

const base = (over: Partial<AccountantTasksInput> = {}): AccountantTasksInput => ({
  now: NOW,
  draftBatches: [],
  failedEmailBatches: [],
  toMatchCount: 0,
  advance: { count: 0, total: "0.00" },
  sms: { active: false, pending: 0, duplicates: 0, unconfirmed: 0 },
  expensesDue: { count: 0, overdue: 0 },
  suggestedPeriod: "2026-11",
  hasActiveChargeItems: true,
  ...over,
});

describe("accountantTasks", () => {
  it("empty input is all clear, with no rows", () => {
    const r = accountantTasks(base());
    expect(r.tasks).toEqual([]);
    expect(r.allClear).toBe(true);
    expect(r.restDone).toBe(false);
  });

  it("rank: draft > failed e-mail > to match > SMS pending > duplicates > unconfirmed > expenses > no batch", () => {
    const r = accountantTasks(base({
      draftBatches: [{ id: "b1", period: "2026-10" }],
      failedEmailBatches: [{ batchId: "b0", period: "2026-09", failed: 2 }],
      toMatchCount: 4,
      sms: { active: true, pending: 3, duplicates: 1, unconfirmed: 2 },
      expensesDue: { count: 5, overdue: 1 },
      suggestedPeriod: "2026-10",
      // nacrt za predloženi period već postoji → stavka 8 se ne pojavljuje
      hasActiveChargeItems: true,
    }));
    expect(r.tasks.map((t) => t.key)).toEqual([
      "draft:b1", "email-failed:b0", "payments-to-match", "sms-pending", "sms-duplicates", "sms-unconfirmed", "expenses-due",
    ]);
    expect(r.tasks.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.allClear).toBe(false);
  });

  it("only the first action is primary; the info row has no button", () => {
    const r = accountantTasks(base({ toMatchCount: 2, expensesDue: { count: 1, overdue: 0 }, advance: { count: 1, total: "50.00" } }));
    expect(r.tasks.filter((t) => t.primary)).toHaveLength(1);
    expect(r.tasks[0].primary).toBe(true);
    const info = r.tasks.find((t) => t.key === "advances")!;
    expect(info.actionLabel).toBeUndefined();
    expect(info.primary).toBe(false);
    expect(info.href).toBe("/fakture/uplate?status=AVANS");
  });

  it("advances alone are informational: still all clear", () => {
    const r = accountantTasks(base({ advance: { count: 2, total: "120.50" } }));
    expect(r.allClear).toBe(true);
    expect(r.tasks.map((t) => t.key)).toEqual(["advances"]);
    expect(r.tasks[0].count).toBe(2);
    expect(r.tasks[0].sentence).toContain("120,50");
  });

  it("SMS rows exist only when automatic intake is on (R-N16)", () => {
    const off = accountantTasks(base({ sms: { active: false, pending: 9, duplicates: 9, unconfirmed: 9 } }));
    expect(off.tasks).toEqual([]);
    const on = accountantTasks(base({ sms: { active: true, pending: 1, duplicates: 0, unconfirmed: 0 } }));
    expect(on.tasks.map((t) => t.key)).toEqual(["sms-pending"]);
  });

  it("each count and destination come straight from the input", () => {
    const r = accountantTasks(base({ toMatchCount: 7, expensesDue: { count: 3, overdue: 2 } }));
    const match = r.tasks.find((t) => t.key === "payments-to-match")!;
    expect(match.count).toBe(7);
    expect(match.href).toBe("/fakture/uplate?status=ZA_UPARIVANJE");
    const exp = r.tasks.find((t) => t.key === "expenses-due")!;
    expect(exp.count).toBe(3);
    expect(exp.href).toBe("/troskovi?tab=troskovi&rok=7");
    expect(exp.meta).toContain("2");
  });

  it("one draft links to it, several link to the list; failed e-mails are one row per batch", () => {
    const one = accountantTasks(base({ draftBatches: [{ id: "b1", period: "2026-10" }] }));
    expect(one.tasks[0].href).toBe("/fakture/serija/b1");
    const many = accountantTasks(base({ draftBatches: [{ id: "b1", period: "2026-10" }, { id: "b2", period: "2026-09" }] }));
    expect(many.tasks).toHaveLength(1);
    expect(many.tasks[0].href).toBe("/fakture?tab=naknade");
    expect(many.tasks[0].count).toBe(2);
    const failed = accountantTasks(base({ failedEmailBatches: [
      { batchId: "a", period: "2026-08", failed: 1 }, { batchId: "b", period: "2026-09", failed: 3 }, { batchId: "c", period: "2026-07", failed: 0 },
    ] }));
    expect(failed.tasks.map((t) => [t.key, t.count])).toEqual([["email-failed:b", 3], ["email-failed:a", 1]]);
  });

  it("no-batch row: only when the suggested period is not in the future, there are charge items and no draft for it", () => {
    expect(accountantTasks(base({ suggestedPeriod: "2026-10" })).tasks.map((t) => t.key)).toEqual(["no-batch:2026-10"]);
    expect(accountantTasks(base({ suggestedPeriod: "2026-11" })).tasks).toEqual([]);
    expect(accountantTasks(base({ suggestedPeriod: "2026-10", hasActiveChargeItems: false })).tasks).toEqual([]);
    expect(accountantTasks(base({ suggestedPeriod: "2026-10", draftBatches: [{ id: "b", period: "2026-10" }] })).tasks.map((t) => t.key)).toEqual(["draft:b"]);
  });

  it("restDone: some actions, but not every category is active", () => {
    expect(accountantTasks(base({ toMatchCount: 1 })).restDone).toBe(true);
    expect(accountantTasks(base()).restDone).toBe(false);
    const all = accountantTasks(base({
      draftBatches: [{ id: "b1", period: "2026-10" }], failedEmailBatches: [{ batchId: "x", period: "2026-09", failed: 1 }], toMatchCount: 1,
      sms: { active: true, pending: 1, duplicates: 1, unconfirmed: 1 }, expensesDue: { count: 1, overdue: 0 }, suggestedPeriod: "2026-10", hasActiveChargeItems: true,
    }));
    // nacrt za predloženi period postoji, pa „nema serije” nije aktivna: 7 od 8 kategorija
    expect(all.restDone).toBe(true);
  });

  it("is deterministic: the order does not depend on the input order", () => {
    const a = { batchId: "a", period: "2026-09", failed: 1 };
    const b = { batchId: "b", period: "2026-09", failed: 2 };
    const one = accountantTasks(base({ failedEmailBatches: [a, b] })).tasks.map((t) => t.key);
    const two = accountantTasks(base({ failedEmailBatches: [b, a] })).tasks.map((t) => t.key);
    expect(one).toEqual(two);
  });
});

describe("mergeTasks (president + accountant)", () => {
  const president = presidentTasks({
    now: NOW,
    registerStatus: "REVIEW",
    votings: [{ proposalId: "p1", code: "P-1", title: "T", meetingId: "m", meetingTitle: "S", closesAt: new Date("2026-10-20T10:00:00Z"), voted: 1, voters: 5, quorumReached: false, quorumNeeded: "3" }],
    meetings: [{ id: "m2", title: "Sjednica", scheduledAt: new Date("2026-10-28T10:00:00Z"), nextStepLabel: "Zakaži", warnings: [] }],
    issuesBeforeDecision: [], planItemsPassed: [], reportedIssues: 2,
  });

  it("president ranks 1-3, then the accountant's actions, then the rest, then info; one primary", () => {
    const acc = accountantTasks(base({ toMatchCount: 3, expensesDue: { count: 1, overdue: 0 }, advance: { count: 1, total: "10.00" } }));
    const merged = mergeTasks(president.tasks, acc.tasks);
    expect(merged.map((t) => t.key)).toEqual([
      "register", "vote-overdue:p1", "payments-to-match", "expenses-due", "meeting:m2", "issues-reported", "advances",
    ]);
    expect(merged.filter((t) => t.primary).map((t) => t.key)).toEqual(["register"]);
  });

  it("works when one side is empty, and an info-only accountant list never takes the primary button", () => {
    const acc = accountantTasks(base({ advance: { count: 1, total: "10.00" } }));
    expect(mergeTasks([], acc.tasks).filter((t) => t.primary)).toHaveLength(0);
    expect(mergeTasks(president.tasks, []).map((t) => t.key)).toEqual(president.tasks.map((t) => t.key));
    const onlyAcc = mergeTasks([], accountantTasks(base({ toMatchCount: 1 })).tasks);
    expect(onlyAcc[0].primary).toBe(true);
  });
});

describe("batch period suggestion", () => {
  it("month after the last issued monthly batch, else the current month", () => {
    expect(suggestBatchPeriod(["2026-08", "2026-09"], NOW)).toBe("2026-10");
    expect(suggestBatchPeriod(["2026-12"], NOW)).toBe("2027-01");
    expect(suggestBatchPeriod([], NOW)).toBe("2026-10");
    expect(suggestBatchPeriod(["Jednokratno 2026"], NOW)).toBe("2026-10");
    expect(nextPeriod("2026-12")).toBe("2027-01");
  });

  it("current month is read on the Sarajevo calendar (the 1st at 00:30 local is the new month)", () => {
    expect(currentPeriod(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(currentPeriod(new Date("2026-10-31T22:30:00Z"))).toBe("2026-10");
  });
});
