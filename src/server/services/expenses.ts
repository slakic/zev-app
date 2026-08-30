// Suppliers and expenses, duplicate-invoice warning, payment of expenses.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, type Actor } from "@/server/auth/guards";
import { dec } from "@/lib/money";
import type { Prisma } from "@/generated/prisma/client";

// ---- Suppliers ----

export async function listSuppliers(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } });
}

export async function createSupplier(
  actor: Actor,
  data: { name: string; jib?: string | null; address?: string | null; iban?: string | null; contactName?: string | null; email?: string | null; phone?: string | null; note?: string | null }
) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const s = await prisma.supplier.create({ data });
  await audit(actor, { action: "supplier.create", targetType: "Supplier", targetId: s.id, after: { name: s.name, jib: s.jib } });
  return s;
}

// ---- Expenses ----

/** Warn about a possible duplicate before saving (same supplier + number/date/amount). */
export async function findDuplicateExpenses(
  actor: Actor,
  data: { supplierId?: string | null; invoiceNumber?: string | null; invoiceDate?: Date | null; amount: string }
) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  if (!data.supplierId) return [];
  const candidates = await prisma.expense.findMany({
    where: {
      supplierId: data.supplierId,
      status: { not: "CANCELLED" },
      OR: [
        data.invoiceNumber ? { invoiceNumber: data.invoiceNumber } : undefined,
        data.invoiceDate ? { invoiceDate: data.invoiceDate, amount: data.amount } : undefined,
      ].filter(Boolean) as Prisma.ExpenseWhereInput[],
    },
    include: { supplier: true },
  });
  return candidates;
}

export async function createExpense(
  actor: Actor,
  data: {
    supplierId?: string | null;
    invoiceNumber?: string | null;
    invoiceDate?: Date | null;
    categoryId?: string | null;
    amount: string;
    dueDate?: Date | null;
    buildingId?: string | null;
    entranceId?: string | null;
    projectId?: string | null;
    planItemId?: string | null;
    maintenanceIssueId?: string | null;
    workOrderId?: string | null;
    description?: string | null;
    recurring?: boolean;
    recurrenceRule?: string | null;
    allowDuplicate?: boolean;
  }
) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  if (dec(data.amount).lessThanOrEqualTo(0)) throw new Error("Iznos mora biti pozitivan.");
  if (!data.allowDuplicate) {
    const dups = await findDuplicateExpenses(actor, data);
    if (dups.length > 0) {
      throw new DuplicateExpenseWarning(dups.map((d) => ({ id: d.id, invoiceNumber: d.invoiceNumber, amount: d.amount.toString() })));
    }
  }
  const { allowDuplicate, ...rest } = data;
  void allowDuplicate;
  const e = await prisma.expense.create({ data: { ...rest, createdById: actor.userId } });
  await audit(actor, {
    action: "expense.create", targetType: "Expense", targetId: e.id,
    after: { supplierId: e.supplierId, invoiceNumber: e.invoiceNumber, amount: e.amount.toString() },
  });
  return e;
}

export class DuplicateExpenseWarning extends Error {
  constructor(public duplicates: { id: string; invoiceNumber: string | null; amount: string }[]) {
    super("Mogući duplikat fakture dobavljača.");
    this.name = "DuplicateExpenseWarning";
  }
}

export async function updateExpense(actor: Actor, id: string, data: Prisma.ExpenseUncheckedUpdateInput, reason?: string) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const before = await prisma.expense.findUniqueOrThrow({ where: { id } });
  if (before.status === "PAID" && !reason) {
    throw new Error("Izmjena plaćenog troška zahtijeva razlog.");
  }
  const e = await prisma.expense.update({ where: { id }, data });
  await audit(actor, {
    action: "expense.update", targetType: "Expense", targetId: id,
    before: { amount: before.amount.toString(), status: before.status },
    after: { amount: e.amount.toString(), status: e.status },
    reason: reason ?? null,
  });
  return e;
}

/** Pay an expense from an account (creates the outgoing transaction atomically). */
export async function payExpense(
  actor: Actor,
  data: { expenseId: string; accountId: string; date: Date; amount?: string }
) {
  requireRole(actor, "ACCOUNTANT");
  return prisma.$transaction(async (tx) => {
    const exp = await tx.expense.findUniqueOrThrow({ where: { id: data.expenseId }, include: { supplier: true } });
    if (exp.status === "CANCELLED") throw new Error("Storniran trošak se ne može platiti.");
    const amount = dec(data.amount ?? dec(exp.amount.toString()).minus(dec(exp.paidAmount.toString())).toFixed(2));
    if (amount.lessThanOrEqualTo(0)) throw new Error("Iznos plaćanja mora biti pozitivan.");
    const newPaid = dec(exp.paidAmount.toString()).plus(amount);
    if (newPaid.greaterThan(dec(exp.amount.toString()))) throw new Error("Plaćanje prelazi iznos troška.");
    const t = await tx.finTransaction.create({
      data: {
        accountId: data.accountId,
        date: data.date,
        type: "EXPENSE",
        amount: amount.toFixed(2),
        counterpartyName: exp.supplier?.name ?? null,
        categoryId: exp.categoryId,
        paymentMethod: "BANK",
        docRef: exp.invoiceNumber,
        description: exp.description ?? `Plaćanje troška ${exp.invoiceNumber ?? ""}`,
        buildingId: exp.buildingId,
        entranceId: exp.entranceId,
        projectId: exp.projectId,
        planItemId: exp.planItemId,
        expenseId: exp.id,
        createdById: actor.userId,
      },
    });
    const updated = await tx.expense.update({
      where: { id: exp.id },
      data: {
        paidAmount: newPaid.toFixed(2),
        status: newPaid.greaterThanOrEqualTo(dec(exp.amount.toString())) ? "PAID" : "PARTIALLY_PAID",
        paidDate: data.date,
      },
    });
    await audit(actor, {
      action: "expense.pay", targetType: "Expense", targetId: exp.id,
      after: { amount: amount.toFixed(2), transactionId: t.id, status: updated.status },
    }, tx);
    return updated;
  });
}

export async function cancelExpense(actor: Actor, id: string, reason: string) {
  requireRole(actor, "ACCOUNTANT");
  if (!reason.trim()) throw new Error("Storno zahtijeva razlog.");
  const before = await prisma.expense.findUniqueOrThrow({ where: { id } });
  if (!dec(before.paidAmount.toString()).isZero()) {
    throw new Error("Trošak sa evidentiranim plaćanjem ne može se stornirati — prvo stornirajte transakciju.");
  }
  const e = await prisma.expense.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
  });
  await audit(actor, { action: "expense.cancel", targetType: "Expense", targetId: id, before: { status: before.status }, reason });
  return e;
}

export async function listExpenses(actor: Actor, filter?: { status?: string; supplierId?: string; buildingId?: string; projectId?: string }) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return prisma.expense.findMany({
    where: {
      status: filter?.status as never,
      supplierId: filter?.supplierId,
      buildingId: filter?.buildingId,
      projectId: filter?.projectId,
    },
    include: { supplier: true, category: true, maintenanceIssue: true },
    orderBy: { createdAt: "desc" },
  });
}
