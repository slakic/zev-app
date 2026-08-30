// Maintenance issues: full workflow from report to close, contractor offers,
// work orders, emergency path with mandatory justification.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireAnyUser, ForbiddenError, type Actor } from "@/server/auth/guards";
import type { IssueStatus, IssueUrgency } from "@/generated/prisma/client";

const FLOW: IssueStatus[] = [
  "REPORTED", "TRIAGED", "AUTHORIZATION_REQUIRED", "APPROVED", "OFFERS_REQUESTED",
  "CONTRACTOR_SELECTED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "VERIFIED",
  "INVOICED", "PAID", "CLOSED",
];

export async function listIssues(actor: Actor, filter?: { status?: IssueStatus; mineOnly?: boolean }) {
  requireAnyUser(actor);
  const isManagement = actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
  const reporterId = !isManagement || filter?.mineOnly ? actor.partyId ?? "__none__" : undefined;
  return prisma.maintenanceIssue.findMany({
    where: { status: filter?.status, reporterId },
    include: { reporter: true, unit: true, responsible: true, offers: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getIssue(actor: Actor, id: string) {
  requireAnyUser(actor);
  const issue = await prisma.maintenanceIssue.findUniqueOrThrow({
    where: { id },
    include: {
      reporter: true,
      unit: { include: { building: true } },
      responsible: true,
      comments: { orderBy: { createdAt: "asc" } },
      statusEvents: { orderBy: { createdAt: "asc" } },
      offers: { include: { supplier: true } },
      workOrders: { include: { supplier: true } },
      expenses: true,
      attachments: true,
    },
  });
  const isManagement = actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
  if (!isManagement && issue.reporterId !== actor.partyId) {
    throw new ForbiddenError("Možete pratiti samo svoje prijave.");
  }
  return issue;
}

/** Any authenticated owner may report an issue. */
export async function reportIssue(
  actor: Actor,
  data: {
    title: string;
    description: string;
    buildingId?: string | null;
    entranceId?: string | null;
    unitId?: string | null;
    locationNote?: string | null;
    category?: string | null;
    urgency?: IssueUrgency;
    safetyImpact?: boolean;
  }
) {
  requireAnyUser(actor);
  if (!actor.partyId) throw new ForbiddenError("Nalog nije povezan sa licem.");
  const issue = await prisma.maintenanceIssue.create({
    data: {
      ...data,
      urgency: data.urgency ?? "NORMAL",
      safetyImpact: data.safetyImpact ?? false,
      reporterId: actor.partyId,
      statusEvents: { create: [{ to: "REPORTED", actorId: actor.userId }] },
    },
  });
  await audit(actor, { action: "issue.report", targetType: "MaintenanceIssue", targetId: issue.id, after: { title: issue.title, urgency: issue.urgency } });
  return issue;
}

export async function addIssueComment(actor: Actor, issueId: string, text: string) {
  // Reporter or management can comment.
  const issue = await prisma.maintenanceIssue.findUniqueOrThrow({ where: { id: issueId } });
  const isManagement = actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
  if (!isManagement && issue.reporterId !== actor.partyId) throw new ForbiddenError();
  return prisma.issueComment.create({ data: { issueId, authorId: actor.userId, text } });
}

export async function transitionIssue(
  actor: Actor,
  issueId: string,
  to: IssueStatus,
  opts?: { note?: string; responsibleId?: string; estimatedCost?: string; actualCost?: string; approvalProposalId?: string }
) {
  requireRole(actor, "PRESIDENT");
  return prisma.$transaction(async (tx) => {
    const issue = await tx.maintenanceIssue.findUniqueOrThrow({ where: { id: issueId } });
    const fromIdx = FLOW.indexOf(issue.status);
    const toIdx = FLOW.indexOf(to);
    if (to !== "REJECTED" && toIdx < 0) throw new Error("Nepoznat status.");
    if (to !== "REJECTED" && toIdx < fromIdx && !opts?.note) {
      throw new Error("Vraćanje statusa unazad zahtijeva napomenu (evidentira se).");
    }
    const updated = await tx.maintenanceIssue.update({
      where: { id: issueId },
      data: {
        status: to,
        responsibleId: opts?.responsibleId ?? undefined,
        estimatedCost: opts?.estimatedCost ?? undefined,
        actualCost: opts?.actualCost ?? undefined,
        approvalProposalId: opts?.approvalProposalId ?? undefined,
        statusEvents: { create: [{ from: issue.status, to, actorId: actor.userId, note: opts?.note ?? null }] },
      },
    });
    await audit(actor, {
      action: "issue.transition", targetType: "MaintenanceIssue", targetId: issueId,
      before: { status: issue.status }, after: { status: to }, reason: opts?.note ?? null,
    }, tx);
    return updated;
  });
}

/** Emergency path: skips authorization but demands full justification. */
export async function markEmergency(
  actor: Actor,
  issueId: string,
  data: { reason: string; authorizedBy: string; authority: string; estimatedCost?: string }
) {
  requireRole(actor, "PRESIDENT");
  if (!data.reason.trim() || !data.authorizedBy.trim() || !data.authority.trim()) {
    throw new Error("Hitna intervencija zahtijeva razlog, ovlašćeno lice i osnov ovlašćenja.");
  }
  const issue = await prisma.maintenanceIssue.update({
    where: { id: issueId },
    data: {
      isEmergency: true,
      urgency: "EMERGENCY",
      emergencyReason: data.reason,
      emergencyAuthorizedBy: data.authorizedBy,
      emergencyAuthority: data.authority,
      estimatedCost: data.estimatedCost ?? undefined,
      status: "APPROVED",
      statusEvents: { create: [{ to: "APPROVED", actorId: actor.userId, note: `HITNO: ${data.reason}` }] },
    },
  });
  await audit(actor, {
    action: "issue.emergency", targetType: "MaintenanceIssue", targetId: issueId,
    after: { authorizedBy: data.authorizedBy, authority: data.authority },
    reason: data.reason,
  });
  return issue;
}

/** Ratification of an emergency intervention by a later assembly decision. */
export async function ratifyEmergency(actor: Actor, issueId: string, ref: string) {
  requireRole(actor, "PRESIDENT");
  const issue = await prisma.maintenanceIssue.update({
    where: { id: issueId },
    data: { emergencyRatifiedRef: ref },
  });
  await audit(actor, { action: "issue.emergency.ratify", targetType: "MaintenanceIssue", targetId: issueId, after: { ref } });
  return issue;
}

// ---- Offers & work orders ----

export async function addOffer(
  actor: Actor,
  data: { issueId: string; supplierId: string; amount: string; description?: string | null; validUntil?: Date | null }
) {
  requireRole(actor, "PRESIDENT");
  const o = await prisma.contractorOffer.create({ data });
  await audit(actor, { action: "issue.offer.add", targetType: "ContractorOffer", targetId: o.id, after: { supplierId: data.supplierId, amount: data.amount } });
  return o;
}

export async function selectOffer(actor: Actor, offerId: string, note?: string) {
  requireRole(actor, "PRESIDENT");
  return prisma.$transaction(async (tx) => {
    const offer = await tx.contractorOffer.findUniqueOrThrow({ where: { id: offerId } });
    await tx.contractorOffer.updateMany({ where: { issueId: offer.issueId }, data: { selected: false } });
    const sel = await tx.contractorOffer.update({ where: { id: offerId }, data: { selected: true } });
    await tx.maintenanceIssue.update({
      where: { id: offer.issueId },
      data: {
        status: "CONTRACTOR_SELECTED",
        estimatedCost: offer.amount,
        statusEvents: { create: [{ to: "CONTRACTOR_SELECTED", actorId: actor.userId, note: note ?? null }] },
      },
    });
    await audit(actor, {
      action: "issue.offer.select", targetType: "ContractorOffer", targetId: offerId,
      after: { issueId: offer.issueId, supplierId: offer.supplierId, amount: offer.amount.toString() },
      reason: note ?? null,
    }, tx);
    return sel;
  });
}

export async function createWorkOrder(
  actor: Actor,
  data: { issueId: string; supplierId: string; description: string; scheduledFrom?: Date | null; scheduledTo?: Date | null }
) {
  requireRole(actor, "PRESIDENT");
  const count = await prisma.workOrder.count();
  const number = `RN-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
  const wo = await prisma.workOrder.create({ data: { ...data, number } });
  await prisma.maintenanceIssue.update({
    where: { id: data.issueId },
    data: {
      status: "SCHEDULED",
      statusEvents: { create: [{ to: "SCHEDULED", actorId: actor.userId, note: `Radni nalog ${number}` }] },
    },
  });
  await audit(actor, { action: "work_order.create", targetType: "WorkOrder", targetId: wo.id, after: { number, issueId: data.issueId } });
  return wo;
}

export async function completeWorkOrder(actor: Actor, workOrderId: string, completionNote: string) {
  requireRole(actor, "PRESIDENT");
  const wo = await prisma.workOrder.update({
    where: { id: workOrderId },
    data: { status: "COMPLETED", completionNote, completedAt: new Date() },
  });
  await prisma.maintenanceIssue.update({
    where: { id: wo.issueId },
    data: {
      status: "COMPLETED",
      statusEvents: { create: [{ to: "COMPLETED", actorId: actor.userId, note: completionNote }] },
    },
  });
  await audit(actor, { action: "work_order.complete", targetType: "WorkOrder", targetId: workOrderId, after: { completionNote } });
  return wo;
}
