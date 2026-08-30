// Money accounts, operational transactions, account balances.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, type Actor } from "@/server/auth/guards";
import { dec, ZERO, sumDecimals } from "@/lib/money";
import type { AccountType, TxType } from "@/generated/prisma/client";

export async function listAccounts(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return prisma.moneyAccount.findMany({ orderBy: { name: "asc" } });
}

export async function createAccount(
  actor: Actor,
  data: { zevId: string; type: AccountType; name: string; bankName?: string | null; iban?: string | null; openingBalance: string; openingDate: Date }
) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const a = await prisma.moneyAccount.create({ data });
  await audit(actor, { action: "account.create", targetType: "MoneyAccount", targetId: a.id, after: { name: a.name, type: a.type } });
  return a;
}

export async function accountBalance(actor: Actor, accountId: string, asOf?: Date): Promise<string> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const account = await prisma.moneyAccount.findUniqueOrThrow({ where: { id: accountId } });
  const txs = await prisma.finTransaction.findMany({
    where: { accountId, status: "ACTIVE", date: asOf ? { lte: asOf } : undefined },
  });
  let bal = dec(account.openingBalance.toString());
  for (const t of txs) {
    const amt = dec(t.amount.toString());
    if (t.type === "INCOME") bal = bal.plus(amt);
    else if (t.type === "EXPENSE") bal = bal.minus(amt);
    // TRANSFER handled as paired INCOME/EXPENSE rows in MVP
  }
  return bal.toFixed(2);
}

export async function totalCash(actor: Actor, asOf?: Date): Promise<string> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const accounts = await prisma.moneyAccount.findMany({ where: { active: true } });
  let total = ZERO;
  for (const a of accounts) {
    total = total.plus(dec(await accountBalance(actor, a.id, asOf)));
  }
  return total.toFixed(2);
}

export async function enterTransaction(
  actor: Actor,
  data: {
    accountId: string;
    date: Date;
    type: TxType;
    amount: string;
    counterpartyName?: string | null;
    categoryId?: string | null;
    paymentMethod?: string | null;
    docRef?: string | null;
    description?: string | null;
    buildingId?: string | null;
    entranceId?: string | null;
    projectId?: string | null;
    planItemId?: string | null;
    expenseId?: string | null;
    isReserveFund?: boolean;
  }
) {
  requireRole(actor, "ACCOUNTANT");
  if (dec(data.amount).lessThanOrEqualTo(0)) throw new Error("Iznos mora biti pozitivan.");
  const t = await prisma.finTransaction.create({
    data: { ...data, createdById: actor.userId },
  });
  await audit(actor, {
    action: "transaction.enter", targetType: "FinTransaction", targetId: t.id,
    after: { type: t.type, amount: t.amount.toString(), accountId: t.accountId },
  });
  return t;
}

/** Cancel (storno) a transaction — original remains visible. */
export async function cancelTransaction(actor: Actor, id: string, reason: string) {
  requireRole(actor, "ACCOUNTANT");
  if (!reason.trim()) throw new Error("Storno zahtijeva razlog.");
  const before = await prisma.finTransaction.findUniqueOrThrow({ where: { id } });
  if (before.status === "CANCELLED") throw new Error("Transakcija je već stornirana.");
  const t = await prisma.finTransaction.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
  });
  await audit(actor, {
    action: "transaction.cancel", targetType: "FinTransaction", targetId: id,
    before: { status: before.status }, after: { status: "CANCELLED" }, reason,
  });
  return t;
}

export async function listTransactions(
  actor: Actor,
  filter?: { accountId?: string; type?: TxType; from?: Date; to?: Date; buildingId?: string; projectId?: string }
) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return prisma.finTransaction.findMany({
    where: {
      accountId: filter?.accountId,
      type: filter?.type,
      buildingId: filter?.buildingId,
      projectId: filter?.projectId,
      date: { gte: filter?.from, lte: filter?.to },
    },
    include: { account: true, category: true },
    orderBy: { date: "desc" },
  });
}

export async function listCategories() {
  return prisma.transactionCategory.findMany({ orderBy: { name: "asc" } });
}

export async function ensureCategory(name: string, kind: "INCOME" | "EXPENSE") {
  return prisma.transactionCategory.upsert({
    where: { name },
    create: { name, kind },
    update: {},
  });
}

/** Maintenance-fund running balance (flagged charge income minus flagged spending). */
export async function reserveFundBalance(actor: Actor): Promise<{ income: string; spent: string; balance: string }> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const txs = await prisma.finTransaction.findMany({ where: { isReserveFund: true, status: "ACTIVE" } });
  const income = sumDecimals(txs.filter((t) => t.type === "INCOME").map((t) => dec(t.amount.toString())));
  const spent = sumDecimals(txs.filter((t) => t.type === "EXPENSE").map((t) => dec(t.amount.toString())));
  return { income: income.toFixed(2), spent: spent.toFixed(2), balance: income.minus(spent).toFixed(2) };
}
