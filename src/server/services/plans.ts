// Annual maintenance & financial plans with versioning, assembly approval link
// and planned-vs-actual comparison.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireAnyUser, type Actor } from "@/server/auth/guards";
import { dec, sumDecimals } from "@/lib/money";
import type { PlanKind, PlanItemType, ScopeType } from "@/generated/prisma/client";

export async function listPlans(actor: Actor) {
  requireAnyUser(actor);
  return prisma.annualPlan.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: [{ year: "desc" }, { kind: "asc" }, { version: "desc" }],
  });
}

export async function getPlan(actor: Actor, id: string) {
  requireAnyUser(actor);
  return prisma.annualPlan.findUniqueOrThrow({
    where: { id },
    include: { items: { include: { scopeUnits: { include: { unit: true } } }, orderBy: { name: "asc" } } },
  });
}

export async function createPlan(
  actor: Actor,
  data: { year: number; kind: PlanKind; title: string; note?: string | null }
) {
  requireRole(actor, "PRESIDENT");
  const latest = await prisma.annualPlan.findFirst({
    where: { year: data.year, kind: data.kind },
    orderBy: { version: "desc" },
  });
  const plan = await prisma.annualPlan.create({
    data: { ...data, version: (latest?.version ?? 0) + 1 },
  });
  await audit(actor, { action: "plan.create", targetType: "AnnualPlan", targetId: plan.id, after: { year: plan.year, kind: plan.kind, version: plan.version } });
  return plan;
}

/** New version of an existing plan (copies items; old version stays intact). */
export async function createPlanRevision(actor: Actor, planId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  return prisma.$transaction(async (tx) => {
    const old = await tx.annualPlan.findUniqueOrThrow({ where: { id: planId }, include: { items: { include: { scopeUnits: true } } } });
    const next = await tx.annualPlan.create({
      data: {
        year: old.year,
        kind: old.kind,
        version: old.version + 1,
        title: old.title,
        note: old.note,
        items: {
          create: old.items.map((i) => ({
            type: i.type,
            name: i.name,
            description: i.description,
            plannedAmount: i.plannedAmount,
            month: i.month,
            scopeType: i.scopeType,
            buildingId: i.buildingId,
            entranceId: i.entranceId,
            projectId: i.projectId,
            categoryName: i.categoryName,
            scheduledDate: i.scheduledDate,
            scopeUnits: i.scopeUnits.length ? { create: i.scopeUnits.map((su) => ({ unitId: su.unitId })) } : undefined,
          })),
        },
      },
    });
    if (old.status === "DRAFT" || old.status === "PROPOSED") {
      await tx.annualPlan.update({ where: { id: planId }, data: { status: "ARCHIVED" } });
    }
    await audit(actor, {
      action: "plan.revise", targetType: "AnnualPlan", targetId: next.id,
      before: { planId: old.id, version: old.version }, after: { version: next.version }, reason,
    }, tx);
    return next;
  });
}

export async function addPlanItem(
  actor: Actor,
  data: {
    planId: string;
    type: PlanItemType;
    name: string;
    description?: string | null;
    plannedAmount: string;
    month?: number | null;
    scopeType?: ScopeType;
    buildingId?: string | null;
    entranceId?: string | null;
    projectId?: string | null;
    categoryName?: string | null;
    scheduledDate?: Date | null;
    unitIds?: string[];
  }
) {
  requireRole(actor, "PRESIDENT");
  const plan = await prisma.annualPlan.findUniqueOrThrow({ where: { id: data.planId } });
  if (plan.status === "APPROVED" || plan.status === "ARCHIVED") {
    throw new Error("Usvojeni/arhivirani plan se mijenja samo kroz novu verziju.");
  }
  const { unitIds, ...rest } = data;
  const item = await prisma.planItem.create({
    data: {
      ...rest,
      scopeType: data.scopeType ?? "ZEV",
      scopeUnits: unitIds?.length ? { create: unitIds.map((unitId) => ({ unitId })) } : undefined,
    },
  });
  await audit(actor, { action: "plan.item.add", targetType: "PlanItem", targetId: item.id, after: { name: item.name, plannedAmount: item.plannedAmount.toString() } });
  return item;
}

export async function proposePlan(actor: Actor, planId: string) {
  requireRole(actor, "PRESIDENT");
  const p = await prisma.annualPlan.update({ where: { id: planId }, data: { status: "PROPOSED" } });
  await audit(actor, { action: "plan.propose", targetType: "AnnualPlan", targetId: planId });
  return p;
}

/** Approve a plan by linking the assembly decision (accepted proposal). */
export async function approvePlan(actor: Actor, planId: string, proposalId: string) {
  requireRole(actor, "PRESIDENT");
  const proposal = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
  if (proposal.status !== "ACCEPTED") {
    throw new Error("Plan se može usvojiti samo na osnovu USVOJENOG prijedloga skupštine.");
  }
  const p = await prisma.annualPlan.update({
    where: { id: planId },
    data: { status: "APPROVED", approvedByProposalId: proposalId, approvedAt: new Date() },
  });
  await audit(actor, {
    action: "plan.approve", targetType: "AnnualPlan", targetId: planId,
    after: { proposalId, decisionNumber: proposal.decisionNumber },
  });
  return p;
}

// ---- Planned vs actual ----

export type PlanVsActualRow = {
  planItemId: string;
  name: string;
  type: PlanItemType;
  planned: string;
  actual: string;
  difference: string;
};

/**
 * Actual spending per plan item = active expense transactions (and expenses)
 * linked via planItemId.
 */
export async function planVsActual(actor: Actor, planId: string): Promise<{ rows: PlanVsActualRow[]; totalPlanned: string; totalActual: string }> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const plan = await prisma.annualPlan.findUniqueOrThrow({ where: { id: planId }, include: { items: true } });
  const rows: PlanVsActualRow[] = [];
  for (const item of plan.items) {
    const txs = await prisma.finTransaction.findMany({
      where: { planItemId: item.id, status: "ACTIVE", type: "EXPENSE" },
    });
    let actual = sumDecimals(txs.map((t) => dec(t.amount.toString())));
    // Also count unpaid expenses committed against the item (obligations).
    const unpaidExpenses = await prisma.expense.findMany({
      where: { planItemId: item.id, status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
    });
    for (const e of unpaidExpenses) {
      actual = actual.plus(dec(e.amount.toString()).minus(dec(e.paidAmount.toString())));
    }
    const planned = dec(item.plannedAmount.toString());
    rows.push({
      planItemId: item.id,
      name: item.name,
      type: item.type,
      planned: planned.toFixed(2),
      actual: actual.toFixed(2),
      difference: planned.minus(actual).toFixed(2),
    });
  }
  const totalPlanned = sumDecimals(rows.map((r) => dec(r.planned)));
  const totalActual = sumDecimals(rows.map((r) => dec(r.actual)));
  return { rows, totalPlanned: totalPlanned.toFixed(2), totalActual: totalActual.toFixed(2) };
}

// ---- Projects ----

export async function listProjects(actor: Actor) {
  requireAnyUser(actor);
  return prisma.project.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createProject(actor: Actor, data: { name: string; description?: string | null; estimatedCost?: string | null }) {
  requireRole(actor, "PRESIDENT");
  const p = await prisma.project.create({ data });
  await audit(actor, { action: "project.create", targetType: "Project", targetId: p.id, after: { name: p.name } });
  return p;
}
