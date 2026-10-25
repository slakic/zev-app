// Početna računovođe (F5a.2): prikuplja brojeve za „Za Vas sada” i predaje ih čistoj funkciji `accountantTasks`.
// Samo `count`/`groupBy` upiti, bez učitavanja redova (osim avansa i serija koje su male). Svaki upit je ograničen sa
// zevId aktera; brojači koriste ISTE uslove kao filteri odredišta (`paymentWhereForFilter`, `expensesDueWhere`).
import { prisma } from "@/lib/prisma";
import { requireRole, requireZev, type Actor } from "@/server/auth/guards";
import { accountantTasks, EXPENSE_DUE_DAYS, type AccountantTasksResult } from "@/lib/accountantTasks";
import { suggestBatchPeriod } from "@/lib/batchPeriod";
import { advanceSummary, countPaymentsToMatch } from "@/server/services/payments";
import { expensesDueWhere } from "@/server/services/expenses";
import { failedInvoiceEmailsByBatch } from "@/server/services/invoiceEmail";
import { getBankSmsStatus } from "@/server/services/bankSms";
import { getChannelReconciliation } from "@/server/services/paymentMatching";

export async function getAccountantTasks(actor: Actor, now: Date = new Date()): Promise<AccountantTasksResult> {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);

  const [drafts, issued, chargeItems, failedEmailBatches, toMatchCount, advance, smsStatus, dueCount, overdueCount] = await Promise.all([
    prisma.invoiceBatch.findMany({ where: { zevId, status: "DRAFT" }, select: { id: true, period: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }),
    prisma.invoiceBatch.findMany({ where: { zevId, status: "ISSUED" }, select: { period: true }, orderBy: { createdAt: "desc" }, take: 36 }),
    prisma.chargeItem.count({ where: { zevId, active: true } }),
    failedInvoiceEmailsByBatch(zevId),
    countPaymentsToMatch(zevId),
    advanceSummary(zevId),
    getBankSmsStatus(actor),
    prisma.expense.count({ where: expensesDueWhere(zevId, now, EXPENSE_DUE_DAYS) }),
    prisma.expense.count({ where: expensesDueWhere(zevId, now, -1) }),
  ]);

  // Usklađivanje (do 500 SMS redova) se računa samo kad je prijem uključen — inače stavki nema (R-N16).
  const channel = smsStatus.active ? await getChannelReconciliation(actor) : null;

  return accountantTasks({
    now,
    draftBatches: drafts,
    failedEmailBatches,
    toMatchCount,
    advance,
    sms: {
      active: smsStatus.active,
      pending: smsStatus.pending,
      duplicates: channel?.duplicates.length ?? 0,
      unconfirmed: channel?.unconfirmed.length ?? 0,
    },
    expensesDue: { count: dueCount, overdue: overdueCount },
    suggestedPeriod: suggestBatchPeriod(issued.map((b) => b.period), now),
    hasActiveChargeItems: chargeItems > 0,
  });
}

/** Predloženi period nove serije za stranicu naknada (isti izvor kao stavka „serija nije napravljena”). */
export async function suggestedBatchPeriod(actor: Actor, now: Date = new Date()): Promise<string> {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const zevId = requireZev(actor);
  const issued = await prisma.invoiceBatch.findMany({ where: { zevId, status: "ISSUED" }, select: { period: true }, orderBy: { createdAt: "desc" }, take: 36 });
  return suggestBatchPeriod(issued.map((b) => b.period), now);
}
