import { describe, it, expect } from "vitest";
import { ownerTasks, type OwnerTaskInvoice, type OwnerTaskVoting, type OwnerTasksInput } from "@/lib/ownerTasks";

const NOW = new Date("2026-09-20T10:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const inv = (id: string, due: string, remaining = "50.00"): OwnerTaskInvoice => ({ id, number: `FAK-${id}`, unitLabel: "Stan 3", dueDate: day(due), remaining });
const vote = (id: string, over: Partial<OwnerTaskVoting> = {}): OwnerTaskVoting => ({
  proposalId: id, code: `P-${id}`, title: `Prijedlog ${id}`, closesAt: day("2026-09-30"),
  canVote: true, voted: false, representative: null, linkSent: true, ...over,
});
const input = (over: Partial<OwnerTasksInput> = {}): OwnerTasksInput => ({
  now: NOW, invoices: [], votings: [], eVoteConsentStatus: "SIGNED", ...over,
});

describe("ownerTasks — rang i primary", () => {
  it("redoslijed: dospjela -> glasanje -> e-glasanje -> uskoro dospijeva", () => {
    const r = ownerTasks(input({
      invoices: [inv("soon", "2026-09-25"), inv("late", "2026-09-10")],
      votings: [vote("1")],
      eVoteConsentStatus: "NONE",
    }));
    expect(r.tasks.map((t) => t.kind)).toEqual(["overdue", "voting", "evoteConsent", "dueSoon"]);
    expect(r.allClear).toBe(false);
  });

  it("samo jedna stavka ima primary, i to najhitnija", () => {
    const r = ownerTasks(input({
      invoices: [inv("a", "2026-09-10"), inv("b", "2026-09-12"), inv("c", "2026-09-25")],
      votings: [vote("1"), vote("2")],
      eVoteConsentStatus: "NONE",
    }));
    expect(r.tasks.filter((t) => t.primary)).toHaveLength(1);
    expect(r.tasks[0].primary).toBe(true);
    expect(r.tasks[0].kind).toBe("overdue");
  });

  it("dospjele: najstarija prva; granica je dan roka (na sam dan roka još nije dospjela)", () => {
    const r = ownerTasks(input({ invoices: [inv("b", "2026-09-12"), inv("a", "2026-09-10"), inv("today", "2026-09-20")] }));
    expect(r.tasks.map((t) => t.key)).toEqual(["inv:a", "inv:b", "inv:today"]);
    expect(r.tasks.map((t) => t.kind)).toEqual(["overdue", "overdue", "dueSoon"]);
    const first = r.tasks[0];
    expect(first.kind === "overdue" && first.overdueDays).toBe(10);
  });

  it("prozor 'uskoro' je 14 dana", () => {
    const r = ownerTasks(input({ invoices: [inv("in14", "2026-10-04"), inv("in15", "2026-10-05")] }));
    expect(r.tasks.map((t) => t.key)).toEqual(["inv:in14"]);
    expect(r.unpaidLater).toBe(false);
    const later = ownerTasks(input({ invoices: [inv("in15", "2026-10-05")] }));
    expect(later.tasks).toEqual([]);
    expect(later.allClear).toBe(true);
    expect(later.unpaidLater).toBe(true);
  });

  it("glasanja: najbliži rok prvi, bez roka na kraju", () => {
    const r = ownerTasks(input({
      votings: [vote("late", { closesAt: day("2026-10-20") }), vote("none", { closesAt: null }), vote("soon", { closesAt: day("2026-09-22") })],
    }));
    expect(r.tasks.map((t) => t.key)).toEqual(["vote:soon", "vote:late", "vote:none"]);
  });

  it("glasano glasanje se ne pojavljuje, a bez glasanja nema ni poziva na e-glasanje", () => {
    const r = ownerTasks(input({ votings: [vote("1", { voted: true })], eVoteConsentStatus: "NONE" }));
    // e-glasanje se nudi samo dok postoji otvoreno glasanje u kojem vlasnik lično učestvuje; ovdje postoji, ali je izjašnjen
    expect(r.tasks.map((t) => t.kind)).toEqual(["evoteConsent"]);
    expect(r.tasks.some((t) => t.kind === "voting")).toBe(false);
    const none = ownerTasks(input({ eVoteConsentStatus: "NONE" }));
    expect(none.tasks).toEqual([]);
  });

  it("saglasnost je tonalna: nikad primary", () => {
    const r = ownerTasks(input({ votings: [vote("1", { voted: true })], eVoteConsentStatus: "PENDING" }));
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].primary).toBe(false);
  });

  it("potpisana saglasnost ne daje red", () => {
    const r = ownerTasks(input({ votings: [vote("1")], eVoteConsentStatus: "SIGNED" }));
    expect(r.tasks.map((t) => t.kind)).toEqual(["voting"]);
  });

  it("suvlasnik koji nije predstavnik dobija informativni red bez primary; zajednica koja je glasala ga nema", () => {
    const rep = { name: "Cvijeta Cvijić", units: "Stan 3" };
    const r = ownerTasks(input({ votings: [vote("1", { canVote: false, representative: rep })] }));
    expect(r.tasks.map((t) => t.kind)).toEqual(["viaRepresentative"]);
    expect(r.tasks[0].primary).toBe(false);
    expect(r.allClear).toBe(true);
    const voted = ownerTasks(input({ votings: [vote("1", { canVote: false, voted: true, representative: rep })] }));
    expect(voted.tasks).toEqual([]);
  });

  it("jedan prijedlog sa dva subjekta daje jedno glasanje", () => {
    const r = ownerTasks(input({ votings: [vote("1"), vote("1")] }));
    expect(r.tasks.filter((t) => t.kind === "voting")).toHaveLength(1);
  });

  it("bez ičega -> prazno stanje", () => {
    const r = ownerTasks(input());
    expect(r).toEqual({ tasks: [], allClear: true, unpaidLater: false });
  });

  it("deterministično: isti ulaz u drugom redoslijedu daje isti izlaz", () => {
    const a = ownerTasks(input({ invoices: [inv("a", "2026-09-10"), inv("b", "2026-09-10")], votings: [vote("1"), vote("2")] }));
    const b = ownerTasks(input({ invoices: [inv("b", "2026-09-10"), inv("a", "2026-09-10")], votings: [vote("2"), vote("1")] }));
    expect(a.tasks.map((t) => t.key)).toEqual(b.tasks.map((t) => t.key));
  });
});
