import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createAreaCharges, type Fixture } from "./helpers";
import { createDraftBatch, issueBatch, cancelInvoice, listInvoices, compareOwnerInvoices } from "@/server/services/billing";
import { enterPayment, allocatePayment } from "@/server/services/payments";
import { getPaymentInstructions, paymentAccountFor } from "@/server/services/paymentInstructions";
import { generateInvoicePdf, ensureInvoiceDocument, readDocumentFile } from "@/server/services/documents";
import { extractPdfText } from "@/server/services/bankStatementPdf";
import { paymentQrPayload, overdueDaysOf, isInvoiceOverdue, invoicePurpose } from "@/lib/paymentInstructions";
import { ForbiddenError } from "@/server/auth/guards";
import type { Invoice } from "@/generated/prisma/client";

describe("uplatni podaci fakture (F3.1)", () => {
  let f: Fixture;
  let invoices: Invoice[];
  const invOf = (unitId: string) => invoices.find((i) => i.unitId === unitId)!;
  const pay = async (invoiceId: string, amount: string, payerId: string) => {
    const p = await enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount, payerId });
    await allocatePayment(f.accountant, { paymentId: p.id, invoiceId, amount });
    return p;
  };

  beforeAll(async () => {
    f = await createFixture("payins");
    await prisma.moneyAccount.update({ where: { id: f.account.id }, data: { iban: "BA391111111111111111", bankName: "Prva banka" } });
    const chargeIds = await createAreaCharges(f, "1.00");
    const { batch } = await createDraftBatch(f.accountant, "2036-01", undefined, chargeIds);
    invoices = await issueBatch(f.accountant, batch.id);
    // u1 (A) 50.00, u2 (B) 70.00, u3 (60.00, B ili C), u4 (A) 20.00
  });

  it("nova faktura: preostalo = ukupno, plaćanje je moguće, svrha i poziv na broj", async () => {
    const inv = invOf(f.u1.id);
    const r = await getPaymentInstructions(f.actorA, inv.id);
    expect(r.total).toBe("50.00");
    expect(r.paid).toBe("0.00");
    expect(r.remaining).toBe("50.00");
    expect(r.payable).toBe(true);
    expect(r.recipient).toBe(f.zev.legalName);
    expect(r.account).toEqual({ iban: "BA391111111111111111", bankName: "Prva banka" });
    expect(r.reference).toBe(inv.paymentReference ?? inv.number);
    expect(r.purpose).toBe(`ZEV 2036-01 — ${inv.number}`);
  });

  it("djelimična uplata: preostali iznos, a QR i PDF nose preostalo, ne ukupno", async () => {
    const inv = invOf(f.u2.id);
    await pay(inv.id, "30.00", f.ownerB.id);
    const r = await getPaymentInstructions(f.actorB, inv.id);
    expect(r.paid).toBe("30.00");
    expect(r.remaining).toBe("40.00");
    expect(r.payable).toBe(true);
    expect(JSON.parse(paymentQrPayload(r))).toEqual({
      racun: "BA391111111111111111", primalac: f.zev.legalName, iznos: "40.00", pozivNaBroj: r.reference, svrha: r.purpose,
    });

    const before = await prisma.document.count({ where: { sourceId: inv.id, type: "INVOICE" } });
    const doc = await generateInvoicePdf(f.accountant, inv.id);
    // Novo generisanje je nova verzija; ranije verzije ostaju (storeDocument nikad ne prepisuje FINAL).
    expect(await prisma.document.count({ where: { sourceId: inv.id, type: "INVOICE" } })).toBe(before + 1);
    const { buffer } = await readDocumentFile(f.actorB, doc.id);
    const text = await extractPdfText(buffer);
    expect(text).toContain("ZA UPLATU");
    expect(text).toContain("40,00 KM");
    expect(text).toContain("Ukupno");
    expect(text).toContain("70,00 KM");
    expect(text).toContain("Plaćeno");
    expect(text).toContain("30,00 KM");
  });

  it("PDF fakture bez uplata nosi ukupan iznos kao ZA UPLATU", async () => {
    const inv = invOf(f.u4.id);
    const doc = await generateInvoicePdf(f.accountant, inv.id);
    const text = await extractPdfText((await readDocumentFile(f.actorA, doc.id)).buffer);
    expect(text).toContain("ZA UPLATU");
    expect(text).toContain("20,00 KM");
    expect(text).not.toContain("Plaćeno:");
    // Bez promjene plaćenog iznosa ponovno preuzimanje vraća istu verziju.
    expect((await ensureInvoiceDocument(f.actorA, inv.id)).id).toBe(doc.id);
    expect((await ensureInvoiceDocument(f.actorA, inv.id)).id).toBe(doc.id);
  });

  it("plaćena faktura nije payable", async () => {
    const inv = invOf(f.u4.id);
    await pay(inv.id, "20.00", f.ownerA.id);
    const r = await getPaymentInstructions(f.actorA, inv.id);
    expect(r.remaining).toBe("0.00");
    expect(r.payable).toBe(false);

    // Uplata poslije posljednje verzije → nova verzija, bez podataka za uplatu i QR koda.
    const before = await prisma.document.findFirstOrThrow({ where: { sourceId: inv.id, type: "INVOICE" }, orderBy: { version: "desc" } });
    const doc = await ensureInvoiceDocument(f.actorA, inv.id);
    expect(doc.id).not.toBe(before.id);
    const text = await extractPdfText((await readDocumentFile(f.actorA, doc.id)).buffer);
    expect(text).toContain("PLAĆENO U CIJELOSTI");
    expect(text).not.toContain("ZA UPLATU");
    expect(text).not.toContain("Uplatu izvršiti");
    expect(text).not.toContain("QR kod");
    expect((await ensureInvoiceDocument(f.actorA, inv.id)).id).toBe(doc.id);
  });

  it("stornirana faktura nije payable", async () => {
    const inv = invOf(f.u3.id);
    await cancelInvoice(f.accountant, inv.id, "test");
    const owner = (await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).debtorId;
    const actor = owner === f.ownerB.id ? f.actorB : f.accountant;
    const r = await getPaymentInstructions(actor, inv.id);
    expect(r.payable).toBe(false);
    expect(r.overdueDays).toBe(0);
  });

  it("najstariji aktivan bankovni račun pobjeđuje, neaktivni i bez broja se preskaču, bez računa je null", async () => {
    const t = await prisma.zev.create({ data: { legalName: "ZEV samo za račune", jib: "4400000000001" } });
    expect(await paymentAccountFor(t.id)).toBeNull();
    const mk = (name: string, over: object, createdAt: string) =>
      prisma.moneyAccount.create({ data: { zevId: t.id, type: "BANK", name, openingDate: new Date("2020-01-01"), createdAt: new Date(createdAt), ...over } });
    await mk("najstariji neaktivan", { iban: "BA00OLD", active: false }, "2020-01-01");
    await mk("stariji bez broja", { iban: null }, "2020-02-01");
    await mk("prvi važeći", { iban: "BA00FIRST", bankName: "Banka A" }, "2020-03-01");
    await mk("noviji", { iban: "BA00NEWER", bankName: "Banka B" }, "2021-01-01");
    await prisma.moneyAccount.create({ data: { zevId: t.id, type: "CASH", name: "Blagajna", iban: "BA00CASH", openingDate: new Date("2019-01-01"), createdAt: new Date("2019-01-01") } });
    expect(await paymentAccountFor(t.id)).toEqual({ iban: "BA00FIRST", bankName: "Banka A" });
  });

  it("ZEV bez računa sa brojem: account je null", async () => {
    await prisma.moneyAccount.update({ where: { id: f.account.id }, data: { active: false } });
    try {
      const r = await getPaymentInstructions(f.actorA, invOf(f.u1.id).id);
      expect(r.account).toBeNull();
      expect(r.payable).toBe(true);
    } finally {
      await prisma.moneyAccount.update({ where: { id: f.account.id }, data: { active: true } });
    }
  });

  it("vlasnik ne može tuđu fakturu, uprava može svaku", async () => {
    await expect(getPaymentInstructions(f.actorA, invOf(f.u2.id).id)).rejects.toThrow(ForbiddenError);
    await expect(getPaymentInstructions(f.actorB, invOf(f.u1.id).id)).rejects.toThrow(ForbiddenError);
    const r = await getPaymentInstructions(f.accountant, invOf(f.u1.id).id);
    expect(r.payable).toBe(true);
  });

  it("overdueDays: po kalendarskom danu Europe/Sarajevo", async () => {
    const inv = invOf(f.u1.id);
    const due = inv.dueDate;
    const dayMs = 24 * 60 * 60 * 1000;
    expect((await getPaymentInstructions(f.actorA, inv.id, new Date(due.getTime() - dayMs))).overdueDays).toBe(0);
    expect((await getPaymentInstructions(f.actorA, inv.id, due)).overdueDays).toBe(0); // na sam dan roka nije dospjela
    expect((await getPaymentInstructions(f.actorA, inv.id, new Date(due.getTime() + 3 * dayMs))).overdueDays).toBe(3);
  });

  it("listInvoices 'owner': neplaćene prve (po roku), zatim ostale po datumu izdavanja opadajuće", async () => {
    const r = await listInvoices(f.actorA, undefined, { sortBy: "owner" });
    const statuses = r.rows.map((x) => x.status);
    const firstNonIssued = statuses.findIndex((s) => s !== "ISSUED");
    if (firstNonIssued >= 0) expect(statuses.slice(firstNonIssued).every((s) => s !== "ISSUED")).toBe(true);
    expect(r.rows[0].status).toBe("ISSUED");
    expect(r.rows[r.rows.length - 1].status).toBe("PAID"); // u4 je plaćena
  });
});

describe("čiste funkcije uplatnih podataka", () => {
  it("overdueDaysOf / isInvoiceOverdue granica je dan roka", () => {
    const due = new Date("2026-09-15T12:00:00Z");
    expect(overdueDaysOf(due, new Date("2026-09-15T21:59:00Z"))).toBe(0);
    // 22:30 UTC = 00:30 sljedećeg dana u Sarajevu (CEST): već je dospjela
    expect(overdueDaysOf(due, new Date("2026-09-15T22:30:00Z"))).toBe(1);
    expect(overdueDaysOf(due, new Date("2026-10-24T08:00:00Z"))).toBe(39);
    expect(isInvoiceOverdue({ status: "ISSUED", dueDate: due }, new Date("2026-09-16T08:00:00Z"))).toBe(true);
    expect(isInvoiceOverdue({ status: "PAID", dueDate: due }, new Date("2026-09-16T08:00:00Z"))).toBe(false);
  });

  it("invoicePurpose", () => {
    expect(invoicePurpose("2026-08", "FAK-1")).toBe("ZEV 2026-08 — FAK-1");
    expect(invoicePurpose(null, "FAK-1")).toBe("ZEV — FAK-1");
  });

  it("compareOwnerInvoices", () => {
    const mk = (status: string, due: string, issue: string, number: string) => ({ status, dueDate: new Date(due), issueDate: new Date(issue), number });
    const list = [
      mk("PAID", "2026-01-15", "2026-01-01", "3"),
      mk("ISSUED", "2026-09-15", "2026-09-01", "2"),
      mk("PAID", "2026-03-15", "2026-03-01", "4"),
      mk("ISSUED", "2026-08-15", "2026-08-01", "1"),
    ].sort(compareOwnerInvoices);
    expect(list.map((x) => x.number)).toEqual(["1", "2", "4", "3"]);
  });
});
