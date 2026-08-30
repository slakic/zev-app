import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, openVotingWithLinks, type Fixture } from "./helpers";
import { createSupplier, createExpense, payExpense, DuplicateExpenseWarning } from "@/server/services/expenses";
import { createPlan, addPlanItem, planVsActual, createPlanRevision, proposePlan, approvePlan, createProject } from "@/server/services/plans";
import { allocationSummary } from "@/server/services/reports";
import { ensureCategory } from "@/server/services/finance";
import { recordManualVote, closeVoting } from "@/server/services/meetings";

describe("expenses, suppliers and annual planning", () => {
  let f: Fixture;
  let supplierId: string;

  beforeAll(async () => {
    f = await createFixture("exp");
    supplierId = (await createSupplier(f.accountant, { name: `Izvodjac-${f.t}`, jib: "4409999990001" })).id;
  });

  it("duplicate supplier invoices are detected (supplier + number, or date + amount)", async () => {
    await createExpense(f.accountant, {
      supplierId, invoiceNumber: "R-100", invoiceDate: new Date("2032-05-01"), amount: "200.00",
    });
    await expect(
      createExpense(f.accountant, { supplierId, invoiceNumber: "R-100", amount: "999.00" })
    ).rejects.toThrow(DuplicateExpenseWarning);
    await expect(
      createExpense(f.accountant, { supplierId, invoiceNumber: "R-101", invoiceDate: new Date("2032-05-01"), amount: "200.00" })
    ).rejects.toThrow(DuplicateExpenseWarning);
    // explicit override records it anyway
    const forced = await createExpense(f.accountant, {
      supplierId, invoiceNumber: "R-100", amount: "999.00", allowDuplicate: true,
    });
    expect(forced.id).toBeTruthy();
  });

  it("expense allocation by building and project shows up in the allocation summary", async () => {
    const project = await createProject(f.president, { name: `Projekat-${f.t}` });
    const catId = (await ensureCategory(`Kat-${f.t}`, "EXPENSE")).id;
    const e1 = await createExpense(f.accountant, {
      supplierId, invoiceNumber: "R-200", amount: "150.00", buildingId: f.b1.id, categoryId: catId,
    });
    const e2 = await createExpense(f.accountant, {
      supplierId, invoiceNumber: "R-201", amount: "250.00", projectId: project.id, categoryId: catId,
    });
    await payExpense(f.accountant, { expenseId: e1.id, accountId: f.account.id, date: new Date() });
    await payExpense(f.accountant, { expenseId: e2.id, accountId: f.account.id, date: new Date() });

    const byBuilding = await allocationSummary(f.accountant, "building");
    expect(byBuilding.find((r) => r.key === f.b1.id)?.expense).toBe("150.00");
    const byProject = await allocationSummary(f.accountant, "project");
    expect(byProject.find((r) => r.key === project.id)?.expense).toBe("250.00");
  });

  it("planned-vs-actual counts paid transactions and open obligations per plan item", async () => {
    const plan = await createPlan(f.president, { year: 2032, kind: "MAINTENANCE", title: `Plan-${f.t}` });
    const item = await addPlanItem(f.president, {
      planId: plan.id, type: "MAINTENANCE_EXPENSE", name: "Krečenje ulaza", plannedAmount: "1000.00",
    });
    const paid = await createExpense(f.accountant, {
      supplierId, invoiceNumber: "R-300", amount: "400.00", planItemId: item.id,
    });
    await payExpense(f.accountant, { expenseId: paid.id, accountId: f.account.id, date: new Date() });
    await createExpense(f.accountant, {
      supplierId, invoiceNumber: "R-301", amount: "150.00", planItemId: item.id,
    }); // unpaid obligation
    const pva = await planVsActual(f.accountant, plan.id);
    const row = pva.rows.find((r) => r.planItemId === item.id)!;
    expect(row.planned).toBe("1000.00");
    expect(row.actual).toBe("550.00");
    expect(row.difference).toBe("450.00");
  });

  it("plan versioning: a revision copies items, archives the old version, keeps both", async () => {
    const plan = await createPlan(f.president, { year: 2033, kind: "BUDGET", title: `Budzet-${f.t}` });
    await addPlanItem(f.president, { planId: plan.id, type: "INCOME", name: "Naknade", plannedAmount: "5000.00" });
    const v2 = await createPlanRevision(f.president, plan.id, "korekcija prihoda");
    expect(v2.version).toBe(2);
    const old = await prisma.annualPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { items: true } });
    const next = await prisma.annualPlan.findUniqueOrThrow({ where: { id: v2.id }, include: { items: true } });
    expect(old.status).toBe("ARCHIVED");
    expect(old.items).toHaveLength(1);
    expect(next.items).toHaveLength(1);
  });

  it("a plan can be approved only through an ACCEPTED assembly proposal", async () => {
    const plan = await createPlan(f.president, { year: 2034, kind: "MAINTENANCE", title: `Plan34-${f.t}` });
    await proposePlan(f.president, plan.id);
    const { proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    // not accepted yet
    await expect(approvePlan(f.president, plan.id, proposal.id)).rejects.toThrow(/USVOJENOG/);
    // vote it through (A 35 + B 50 approve => quorum 85, accepted)
    const evs = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id } });
    for (const ev of evs) {
      await recordManualVote(f.president, { eligibleVoterId: ev.id, choice: "APPROVE", channel: "PAPER" });
    }
    await closeVoting(f.president, proposal.id);
    const approved = await approvePlan(f.president, plan.id, proposal.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedByProposalId).toBe(proposal.id);
  });
});
