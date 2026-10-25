// Uplatni podaci fakture na jednom mjestu (F3.1): koristi ih detalj fakture ("Kako da platim") i PDF
// fakture, pa račun, preostali iznos i svrha uplate nikad ne mogu da se razilaze između ekrana i PDF-a.
import { prisma } from "@/lib/prisma";
import { requireSelfOrRole, requireAnyUser, requireZev, type Actor } from "@/server/auth/guards";
import { dec, ZERO, sumDecimals } from "@/lib/money";
import { overdueDaysOf, invoicePurpose, type PaymentInstructions } from "@/lib/paymentInstructions";

/**
 * Račun za uplate vlasnika (F3-Q1): najstariji aktivan bankovni račun ZEV-a sa upisanim brojem računa.
 * `id` kao drugi ključ da izbor bude određen i kad dva računa imaju isti `createdAt`.
 */
export async function paymentAccountFor(zevId: string): Promise<{ iban: string; bankName: string | null } | null> {
  const acc = await prisma.moneyAccount.findFirst({
    where: { zevId, type: "BANK", active: true, iban: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { iban: true, bankName: true },
  });
  const iban = acc?.iban?.trim();
  return acc && iban ? { iban, bankName: acc.bankName } : null;
}

/** Vlasnik samo svoju fakturu, uprava svaku (isti guard kao `getInvoice`). */
export async function getPaymentInstructions(actor: Actor, invoiceId: string, now: Date = new Date()): Promise<PaymentInstructions> {
  requireAnyUser(actor);
  const zevId = requireZev(actor);
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId, zevId },
    include: { allocations: { select: { amount: true } }, zev: { select: { legalName: true } } },
  });
  requireSelfOrRole(actor, inv.debtorId, "PRESIDENT", "ACCOUNTANT");

  const total = dec(inv.total.toString());
  const paid = sumDecimals(inv.allocations.map((a) => dec(a.amount.toString())));
  const remaining = total.minus(paid).lessThan(ZERO) ? ZERO : total.minus(paid);
  const account = await paymentAccountFor(zevId);
  const payable = inv.status === "ISSUED" && remaining.greaterThan(ZERO);

  return {
    recipient: inv.zev.legalName,
    account,
    total: total.toFixed(2),
    paid: paid.toFixed(2),
    remaining: remaining.toFixed(2),
    reference: inv.paymentReference ?? inv.number,
    purpose: invoicePurpose(inv.periodLabel, inv.number),
    dueDate: inv.dueDate,
    overdueDays: payable ? overdueDaysOf(inv.dueDate, now) : 0,
    payable,
  };
}
