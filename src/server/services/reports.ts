// Operational financial reports with date ranges and CSV export.
import { prisma } from "@/lib/prisma";
import { requireRole, type Actor } from "@/server/auth/guards";
import { dec, ZERO, sumDecimals } from "@/lib/money";
import { partyDisplayName } from "./ownership";
import { accountBalance } from "./finance";

export type DateRange = { from?: Date; to?: Date };

function inRange(range?: DateRange) {
  return { gte: range?.from, lte: range?.to };
}

/** Cash-flow: income vs expenses per account over a period. */
export async function cashFlowReport(actor: Actor, range?: DateRange) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const accounts = await prisma.moneyAccount.findMany({ where: { active: true } });
  const rows = [];
  for (const a of accounts) {
    const txs = await prisma.finTransaction.findMany({
      where: { accountId: a.id, status: "ACTIVE", date: inRange(range) },
    });
    const income = sumDecimals(txs.filter((t) => t.type === "INCOME").map((t) => dec(t.amount.toString())));
    const expense = sumDecimals(txs.filter((t) => t.type === "EXPENSE").map((t) => dec(t.amount.toString())));
    rows.push({
      accountId: a.id,
      accountName: a.name,
      opening: a.openingBalance.toString(),
      income: income.toFixed(2),
      expense: expense.toFixed(2),
      net: income.minus(expense).toFixed(2),
      currentBalance: await accountBalance(actor, a.id, range?.to),
    });
  }
  return rows;
}

/** Income & expense by category. */
export async function incomeExpenseReport(actor: Actor, range?: DateRange) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const txs = await prisma.finTransaction.findMany({
    where: { status: "ACTIVE", date: inRange(range) },
    include: { category: true },
  });
  const byCat = new Map<string, { category: string; kind: string; total: ReturnType<typeof dec> }>();
  for (const t of txs) {
    if (t.type === "TRANSFER") continue;
    const key = `${t.type}:${t.category?.name ?? "Bez kategorije"}`;
    const cur = byCat.get(key) ?? { category: t.category?.name ?? "Bez kategorije", kind: t.type, total: ZERO };
    cur.total = cur.total.plus(dec(t.amount.toString()));
    byCat.set(key, cur);
  }
  return [...byCat.values()].map((r) => ({ ...r, total: r.total.toFixed(2) }));
}

/** Unpaid owner invoices + receivables aging. */
export async function receivablesReport(actor: Actor, asOf: Date = new Date()) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const invoices = await prisma.invoice.findMany({
    where: { status: "ISSUED", issueDate: { lte: asOf } },
    include: { allocations: true, debtor: true, unit: true },
  });
  const rows = invoices
    .map((inv) => {
      const paid = sumDecimals(inv.allocations.map((a) => dec(a.amount.toString())));
      const open = dec(inv.total.toString()).minus(paid);
      const daysOverdue = Math.max(0, Math.floor((asOf.getTime() - inv.dueDate.getTime()) / 86400000));
      return {
        invoiceId: inv.id,
        number: inv.number,
        debtorId: inv.debtorId,
        debtor: partyDisplayName(inv.debtor),
        unit: inv.unit.label,
        dueDate: inv.dueDate,
        total: inv.total.toString(),
        open: open.toFixed(2),
        daysOverdue,
        bucket: daysOverdue === 0 ? "nije dospjelo" : daysOverdue <= 30 ? "0-30" : daysOverdue <= 60 ? "31-60" : daysOverdue <= 90 ? "61-90" : "90+",
      };
    })
    .filter((r) => dec(r.open).greaterThan(0));
  const totalOpen = sumDecimals(rows.map((r) => dec(r.open)));
  const overdue = sumDecimals(rows.filter((r) => r.daysOverdue > 0).map((r) => dec(r.open)));
  return { rows, totalOpen: totalOpen.toFixed(2), totalOverdue: overdue.toFixed(2) };
}

/** Supplier expenses (paid + unpaid). */
export async function supplierReport(actor: Actor, range?: DateRange) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const expenses = await prisma.expense.findMany({
    where: { status: { not: "CANCELLED" }, createdAt: inRange(range) },
    include: { supplier: true },
  });
  const bySupplier = new Map<string, { supplier: string; total: ReturnType<typeof dec>; unpaid: ReturnType<typeof dec>; count: number }>();
  for (const e of expenses) {
    const key = e.supplier?.name ?? "—";
    const cur = bySupplier.get(key) ?? { supplier: key, total: ZERO, unpaid: ZERO, count: 0 };
    cur.total = cur.total.plus(dec(e.amount.toString()));
    cur.unpaid = cur.unpaid.plus(dec(e.amount.toString()).minus(dec(e.paidAmount.toString())));
    cur.count += 1;
    bySupplier.set(key, cur);
  }
  return [...bySupplier.values()].map((r) => ({ supplier: r.supplier, count: r.count, total: r.total.toFixed(2), unpaid: r.unpaid.toFixed(2) }));
}

export async function unpaidSupplierInvoices(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return prisma.expense.findMany({
    where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
    include: { supplier: true },
    orderBy: { dueDate: "asc" },
  });
}

/** Financial summary grouped by building / entrance / project. */
export async function allocationSummary(actor: Actor, groupBy: "building" | "entrance" | "project", range?: DateRange) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const txs = await prisma.finTransaction.findMany({ where: { status: "ACTIVE", date: inRange(range) } });
  const keyOf = (t: (typeof txs)[number]) =>
    groupBy === "building" ? t.buildingId : groupBy === "entrance" ? t.entranceId : t.projectId;
  const names = new Map<string, string>();
  if (groupBy === "building") for (const b of await prisma.building.findMany()) names.set(b.id, b.name);
  if (groupBy === "entrance") for (const e of await prisma.entrance.findMany()) names.set(e.id, e.name);
  if (groupBy === "project") for (const p of await prisma.project.findMany()) names.set(p.id, p.name);
  const grouped = new Map<string, { income: ReturnType<typeof dec>; expense: ReturnType<typeof dec> }>();
  for (const t of txs) {
    const k = keyOf(t) ?? "__none__";
    const cur = grouped.get(k) ?? { income: ZERO, expense: ZERO };
    if (t.type === "INCOME") cur.income = cur.income.plus(dec(t.amount.toString()));
    if (t.type === "EXPENSE") cur.expense = cur.expense.plus(dec(t.amount.toString()));
    grouped.set(k, cur);
  }
  return [...grouped.entries()].map(([k, v]) => ({
    key: k,
    name: k === "__none__" ? "(neraspoređeno)" : names.get(k) ?? k,
    income: v.income.toFixed(2),
    expense: v.expense.toFixed(2),
    net: v.income.minus(v.expense).toFixed(2),
  }));
}

// ---- CSV export ----

export function toCsv(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  if (rows.length === 0) return "";
  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const esc = (v: unknown) => {
    const s = v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map((c) => esc(c.label)).join(";");
  const body = rows.map((r) => cols.map((c) => esc((r as Record<string, unknown>)[c.key])).join(";"));
  // BOM so Excel opens UTF-8 (č, ć, š...) correctly
  return "﻿" + [header, ...body].join("\r\n");
}
