// Plans/bank-sms-ingestion-plan.md, Faza 1 — the SMS webhook (receiveBankSms), the review
// queue and the human-confirmed booking (confirmBankSms), against the real test database.
// The central invariant: the webhook NEVER books anything; only confirmBankSms does.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, uid, type Fixture } from "./helpers";
import {
  receiveBankSms,
  issueBankSmsToken,
  revokeBankSmsToken,
  getBankSmsStatus,
  listBankSmsReview,
  listBankSmsOther,
  confirmBankSms,
  dismissBankSms,
  checkBankSmsText,
} from "@/server/services/bankSms";
import { markRowsAlreadyBookedFromSms, nameMatchesText, type PdfPreviewRow } from "@/server/services/payments";
import { ForbiddenError } from "@/server/auth/guards";
import { foldDiacritics } from "@/lib/text";

const OWN_ACCOUNT = "5551000051546932";
const PRILIV =
  "NOVA BANKA-Priliv na 5551000051546932 Iznos 47,87 KM, svrha UPL. ZA 08/26 STAN BR 11, 5550000000009912 ZELJKO GALIC.Raspolozivo 11.175,20 KM";
const ODLIV_FEE =
  "NOVA BANKA-Odliv sa 5551000051546932 Iznos 9,00 KM, svrha Naknada za PAKET START SME za SEPTEMBAR-2026.Raspolozivo 11.102,91 KM";
const ODLIV_SUPPLIER =
  "NOVA BANKA-Odliv sa 5551000051546932 Iznos 163,80 KM, svrha RN VIII/26, 5620078068454526 SINGERICA LIFT DOO PRIJEDOR.Raspolozivo 10.964,99 KM";

/** Each call gets its own "IP" unless one is given, so the in-memory failure limiter never couples tests. */
async function send(token: string, text: string, extra: { test?: boolean; ip?: string } = {}) {
  return receiveBankSms({ authorization: `Bearer ${token}`, text, test: extra.test, ipHash: extra.ip ?? uid("ip") });
}

/** A fresh ZEV with its bank account carrying the SMS' own account number and a live webhook key. */
async function setup(tag: string) {
  const f = await createFixture(tag);
  await prisma.moneyAccount.update({ where: { id: f.account.id }, data: { iban: "555-10000515469-32" } }); // dashed on the account, bare digits in the SMS
  const { token } = await issueBankSmsToken(f.accountant);
  return { f, token };
}

/** Open invoice for a party "Željko Galić" living in "Stan 11" — what the canonical SMS pays. */
async function invoiceForZeljko(f: Fixture, total: string) {
  const party = await prisma.party.create({
    data: { zevId: f.zev.id, kind: "PERSON", firstName: "Željko", lastName: "Galić", email: `${uid("zg")}@example.com` },
  });
  const b = await prisma.building.create({ data: { zevId: f.zev.id, name: `Zgrada-sms-${f.t}`, address: "Test" } });
  const unit = await prisma.unit.create({
    data: { zevId: f.zev.id, buildingId: b.id, type: "APARTMENT", label: "Stan 11", usableArea: "40.00", ownershipShare: "1.00" },
  });
  const inv = await prisma.invoice.create({
    data: { zevId: f.zev.id, number: `FAK-SMS11-${f.t}`, unitId: unit.id, debtorId: party.id, issueDate: new Date(), dueDate: new Date(), total, status: "ISSUED" },
  });
  return { party, unit, inv };
}

describe("webhook key and authentication", () => {
  it("the key is shown once; only its hash is stored; the format is <zevId>.<secret>", async () => {
    const f = await createFixture("sms-key");
    const { token, url } = await issueBankSmsToken(f.accountant);
    const [zevId, secret] = token.split(".");
    expect(zevId).toBe(f.zev.id);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(url).toMatch(/\/api\/uplate\/sms$/);
    const row = await prisma.setting.findUniqueOrThrow({ where: { zevId_key: { zevId: f.zev.id, key: "bankSms.webhook" } } });
    expect(JSON.stringify(row.value)).not.toContain(secret);
    const status = await getBankSmsStatus(f.president);
    expect(status.active).toBe(true);
  });

  it("both PRESIDENT and ACCOUNTANT may manage the key; an OWNER may not", async () => {
    const f = await createFixture("sms-roles");
    await expect(issueBankSmsToken(f.president)).resolves.toBeTruthy();
    await expect(issueBankSmsToken(f.accountant)).resolves.toBeTruthy();
    await expect(issueBankSmsToken(f.actorA)).rejects.toThrow(ForbiddenError);
    await expect(revokeBankSmsToken(f.actorA)).rejects.toThrow(ForbiddenError);
  });

  it("every authentication failure is the same 401 (wrong secret, malformed, other tenant, no header)", async () => {
    const { f, token } = await setup("sms-401");
    const other = await createFixture("sms-401-other");
    const [zevId, secret] = token.split(".");
    const bad = [
      `${zevId}.${"x".repeat(secret.length)}`,
      "garbage",
      `${other.zev.id}.${secret}`, // this tenant's secret presented for another tenant
    ];
    for (const t of bad) {
      const r = await send(t, PRILIV);
      expect(r).toEqual({ httpStatus: 401, body: { error: "unauthorized" } });
    }
    expect((await receiveBankSms({ authorization: null, text: PRILIV, ipHash: uid("ip") })).httpStatus).toBe(401);
    // Nothing was written for any of them.
    expect(await prisma.incomingBankSms.count({ where: { zevId: f.zev.id } })).toBe(0);
    expect(await prisma.incomingBankSms.count({ where: { zevId: other.zev.id } })).toBe(0);
  });

  it("a failed attempt is audited with no tenant (the key was never verified)", async () => {
    const { token } = await setup("sms-audit-fail");
    const [zevId, secret] = token.split(".");
    await send(`${zevId}.${"y".repeat(secret.length)}`, PRILIV);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "bank_sms.auth.failed" }, orderBy: { createdAt: "desc" } });
    expect(ev.zevId).toBeNull();
  });

  it("too many failed attempts from one address -> 429, even before the key is looked at", async () => {
    const { token } = await setup("sms-429-auth");
    const [zevId, secret] = token.split(".");
    const wrong = `${zevId}.${"z".repeat(secret.length)}`;
    const ip = uid("attacker");
    for (let i = 0; i < 10; i++) expect((await send(wrong, PRILIV, { ip })).httpStatus).toBe(401);
    expect((await send(wrong, PRILIV, { ip })).httpStatus).toBe(429);
    expect((await send(token, PRILIV, { ip })).httpStatus).toBe(429); // blocked address, even with the right key
    expect((await send(token, PRILIV)).httpStatus).toBe(200); // another address is unaffected
  });

  it("a verified key is capped at 60 requests an hour (bounds the damage of a leaked key)", async () => {
    const { token } = await setup("sms-429-ok");
    for (let i = 0; i < 60; i++) expect((await send(token, PRILIV)).httpStatus).toBe(200);
    expect((await send(token, PRILIV)).httpStatus).toBe(429);
  });
  it("a new key kills the old one; a revoked key and a suspended ZEV are refused", async () => {
    const { f, token } = await setup("sms-rotate");
    const { token: token2 } = await issueBankSmsToken(f.accountant);
    expect((await send(token, PRILIV)).httpStatus).toBe(401);
    expect((await send(token2, PRILIV)).httpStatus).toBe(200);
    await revokeBankSmsToken(f.accountant);
    expect((await send(token2, ODLIV_FEE)).httpStatus).toBe(401);
    const { token: token3 } = await issueBankSmsToken(f.accountant);
    await prisma.zev.update({ where: { id: f.zev.id }, data: { active: false } });
    expect((await send(token3, ODLIV_FEE)).httpStatus).toBe(401);
  });
});

describe("the webhook only queues — it never books", () => {
  it("a Priliv becomes a PENDING row with the account resolved, and creates no Payment", async () => {
    const { f, token } = await setup("sms-queue");
    const paymentsBefore = await prisma.payment.count({ where: { zevId: f.zev.id } });
    const txBefore = await prisma.finTransaction.count({ where: { zevId: f.zev.id } });
    const r = await send(token, PRILIV);
    expect(r).toEqual({ httpStatus: 200, body: { status: "queued" } });
    const row = await prisma.incomingBankSms.findFirstOrThrow({ where: { zevId: f.zev.id } });
    expect(row.status).toBe("PENDING");
    expect(row.kind).toBe("PRILIV");
    expect(row.accountId).toBe(f.account.id);
    expect(row.amount?.toString()).toBe("47.87");
    expect(row.counterpartyName).toBe("ZELJKO GALIC");
    expect(row.balanceAfter?.toString()).toBe("11175.2");
    expect(await prisma.payment.count({ where: { zevId: f.zev.id } })).toBe(paymentsBefore);
    expect(await prisma.finTransaction.count({ where: { zevId: f.zev.id } })).toBe(txBefore);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "bank_sms.receive", targetId: row.id } });
    expect(ev.zevId).toBe(f.zev.id); // taken from the verified key
    expect(JSON.stringify(ev.after)).not.toContain("ZELJKO"); // no payer name in the append-only trail
  });

  it("the same message twice is one row (duplicateHits counts the repeat); two real payments are two rows", async () => {
    const { f, token } = await setup("sms-dup");
    expect((await send(token, PRILIV)).body).toEqual({ status: "queued" });
    expect((await send(token, PRILIV)).body).toEqual({ status: "duplicate" });
    expect((await send(token, PRILIV.replace("11.175,20", "11.222,87"))).body).toEqual({ status: "queued" });
    const rows = await prisma.incomingBankSms.findMany({ where: { zevId: f.zev.id }, orderBy: { receivedAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].duplicateHits).toBe(1);
  });

  it("an Odliv is queued as an outgoing item; a bank fee without a counterparty is understood", async () => {
    const { f, token } = await setup("sms-odliv");
    await send(token, ODLIV_FEE);
    await send(token, ODLIV_SUPPLIER);
    const rows = await prisma.incomingBankSms.findMany({ where: { zevId: f.zev.id }, orderBy: { amount: "asc" } });
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["ODLIV", "PENDING"], ["ODLIV", "PENDING"]]);
    expect(rows[0].counterpartyName).toBeNull();
    expect(rows[1].counterpartyName).toBe("SINGERICA LIFT DOO PRIJEDOR");
  });

  it("a message not from the bank is rejected and its text is NOT stored; an unknown bank format keeps its text", async () => {
    const { f, token } = await setup("sms-reject");
    expect((await send(token, "Vidimo se u 18h")).body).toEqual({ status: "rejected" });
    expect((await send(token, "NOVA BANKA-Postovani, kredit po povoljnoj kamati do 31.10.")).body).toEqual({ status: "rejected" });
    const rows = await prisma.incomingBankSms.findMany({ where: { zevId: f.zev.id }, orderBy: { receivedAt: "asc" } });
    expect(rows.every((r) => r.status === "REJECTED" && r.kind === "UNKNOWN" && r.parseError)).toBe(true);
    expect(rows.find((r) => r.rawText === null)).toBeTruthy(); // the private message
    expect(rows.find((r) => r.rawText?.startsWith("NOVA BANKA"))).toBeTruthy(); // the unknown bank one
    expect(await prisma.payment.count({ where: { zevId: f.zev.id } })).toBe(0);
    const other = await listBankSmsOther(f.accountant);
    expect(other.rejected).toHaveLength(2);
  });

  it("test mode parses and reports but stores nothing", async () => {
    const { f, token } = await setup("sms-testmode");
    const r = await send(token, PRILIV, { test: true });
    expect(r.httpStatus).toBe(200);
    expect(r.body).toMatchObject({ status: "test_ok", parsed: { kind: "PRILIV", amount: "47.87", accountRecognized: true } });
    expect(await prisma.incomingBankSms.count({ where: { zevId: f.zev.id } })).toBe(0);
  });

  it("an account number that matches none of the ZEV's accounts leaves accountId empty", async () => {
    const { f, token } = await setup("sms-noacct");
    await prisma.moneyAccount.update({ where: { id: f.account.id }, data: { iban: "1111111111111111" } });
    await send(token, PRILIV);
    const row = await prisma.incomingBankSms.findFirstOrThrow({ where: { zevId: f.zev.id } });
    expect(row.accountId).toBeNull();
    expect(row.ownAccount).toBe(OWN_ACCOUNT);
    const review = await listBankSmsReview(f.accountant);
    expect(review.rows[0].include).toBe(false);
    expect(review.rows[0].warnings.join(" ")).toMatch(/nije upisan/);
    await expect(
      confirmBankSms(f.accountant, {
        items: [{ smsId: row.id, accountId: "", date: "2032-05-01", amount: "47.87", payerNameRaw: "X", purposeRaw: "Y" }],
      })
    ).rejects.toThrow(/bankovni račun/);
    expect(await prisma.payment.count({ where: { zevId: f.zev.id } })).toBe(0);
  });
});

describe("review and human-confirmed booking", () => {
  it("suggests the invoice from unit number + payer name (diacritics folded) + exact amount, pre-ticked", async () => {
    const { f, token } = await setup("sms-suggest");
    const { inv } = await invoiceForZeljko(f, "47.87");
    await send(token, PRILIV);
    const review = await listBankSmsReview(f.accountant);
    expect(review.rows).toHaveLength(1);
    const row = review.rows[0];
    expect(row.invoiceId).toBe(inv.id);
    expect(row.matchHint).toMatch(/broj stana u svrsi uplate/);
    expect(row.matchHint).toMatch(/naziv platioca/); // "ZELJKO GALIC" vs "Željko Galić"
    expect(row.include).toBe(true);
    expect(row.accountId).toBe(f.account.id);
    expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("confirming books Payment + allocation through the shared code, marks the SMS CONFIRMED and audits it", async () => {
    const { f, token } = await setup("sms-confirm");
    const { inv } = await invoiceForZeljko(f, "47.87");
    await send(token, PRILIV);
    const review = await listBankSmsReview(f.accountant);
    const r = review.rows[0];
    const res = await confirmBankSms(f.accountant, {
      items: [{ smsId: r.id, accountId: r.accountId, date: r.date, amount: r.amount, payerNameRaw: r.payerNameRaw, purposeRaw: r.purposeRaw, invoiceId: r.invoiceId }],
    });
    expect(res.confirmed).toBe(1);

    const sms = await prisma.incomingBankSms.findUniqueOrThrow({ where: { id: r.id } });
    expect(sms.status).toBe("CONFIRMED");
    expect(sms.paymentId).toBeTruthy();
    expect(sms.reviewedById).toBe(f.accountant.userId);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: sms.paymentId! }, include: { importBatch: true, allocations: true } });
    expect(payment.importBatch?.sourceType).toBe("SMS");
    expect(payment.status).toBe("APPLIED");
    expect(payment.allocations).toHaveLength(1);
    expect(payment.createdById).toBe(f.accountant.userId); // a person booked it
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    expect(await prisma.finTransaction.count({ where: { paymentId: payment.id, type: "INCOME" } })).toBe(1);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "payment.import_sms", zevId: f.zev.id } });
    expect(JSON.stringify(ev.after)).toContain(r.id);
    expect((await listBankSmsReview(f.accountant)).rows).toHaveLength(0);
    expect((await listBankSmsOther(f.accountant)).confirmed).toHaveLength(1);
  });

  it("a second confirmation of the same SMS is refused and books nothing twice", async () => {
    const { f, token } = await setup("sms-double");
    await send(token, PRILIV);
    const r = (await listBankSmsReview(f.accountant)).rows[0];
    const item = { smsId: r.id, accountId: r.accountId, date: r.date, amount: r.amount, payerNameRaw: r.payerNameRaw, purposeRaw: r.purposeRaw };
    await confirmBankSms(f.accountant, { items: [item] });
    await expect(confirmBankSms(f.accountant, { items: [item] })).rejects.toThrow(/više nisu na čekanju/);
    expect(await prisma.payment.count({ where: { zevId: f.zev.id } })).toBe(1);
  });

  it("an Odliv books an expense-side transaction (free-text category), never an owner payment", async () => {
    const { f, token } = await setup("sms-out-fee");
    await send(token, ODLIV_FEE);
    const r = (await listBankSmsReview(f.accountant)).rows[0];
    expect(r.kind).toBe("ODLIV");
    const categoryName = `Bankarske naknade ${f.t}`; // unique: categories are looked up by name per ZEV
    await confirmBankSms(f.accountant, {
      items: [{ smsId: r.id, accountId: r.accountId, date: r.date, amount: r.amount, payerNameRaw: "", purposeRaw: r.purposeRaw, categoryName }],
    });
    const sms = await prisma.incomingBankSms.findUniqueOrThrow({ where: { id: r.id } });
    expect(sms.status).toBe("CONFIRMED");
    expect(sms.paymentId).toBeNull();
    const tx = await prisma.finTransaction.findUniqueOrThrow({ where: { id: sms.transactionId! }, include: { category: true } });
    expect(tx.type).toBe("EXPENSE");
    expect(tx.amount.toString()).toBe("9");
    expect(tx.category?.name).toBe(categoryName);
    expect(await prisma.payment.count({ where: { zevId: f.zev.id } })).toBe(0);
  });

  it("an Odliv can settle a chosen Trošak and refuses to overpay it", async () => {
    const { f, token } = await setup("sms-out-exp");
    const supplier = await prisma.supplier.create({ data: { zevId: f.zev.id, name: "SINGERICA LIFT DOO PRIJEDOR" } });
    const exp = await prisma.expense.create({
      data: { zevId: f.zev.id, supplierId: supplier.id, invoiceNumber: "RN VIII/26", amount: "163.80", createdById: f.accountant.userId },
    });
    await send(token, ODLIV_SUPPLIER);
    const r = (await listBankSmsReview(f.accountant)).rows[0];
    expect(r.expenseId).toBe(exp.id); // supplier name + invoice number + exact amount
    const item = { smsId: r.id, accountId: r.accountId, date: r.date, payerNameRaw: r.payerNameRaw, purposeRaw: r.purposeRaw, expenseId: exp.id };
    await expect(confirmBankSms(f.accountant, { items: [{ ...item, amount: "999.00" }] })).rejects.toThrow(/ima otvoreno/);
    expect((await prisma.incomingBankSms.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
    await confirmBankSms(f.accountant, { items: [{ ...item, amount: r.amount }] });
    const paid = await prisma.expense.findUniqueOrThrow({ where: { id: exp.id } });
    expect(paid.status).toBe("PAID");
  });

  it("dismissing needs a reason, books nothing, and closes the row for good", async () => {
    const { f, token } = await setup("sms-dismiss");
    await send(token, PRILIV);
    const r = (await listBankSmsReview(f.accountant)).rows[0];
    await expect(dismissBankSms(f.accountant, r.id, "  ")).rejects.toThrow(/Razlog/);
    await dismissBankSms(f.accountant, r.id, "uneseno ručno");
    const sms = await prisma.incomingBankSms.findUniqueOrThrow({ where: { id: r.id } });
    expect(sms.status).toBe("DISMISSED");
    expect(sms.dismissReason).toBe("uneseno ručno");
    expect(await prisma.payment.count({ where: { zevId: f.zev.id } })).toBe(0);
    await expect(dismissBankSms(f.accountant, r.id, "opet")).rejects.toThrow(/više nije/);
  });

  it("the president can look but not confirm or dismiss (same as the PDF import)", async () => {
    const { f, token } = await setup("sms-president");
    await send(token, PRILIV);
    const review = await listBankSmsReview(f.president);
    expect(review.rows).toHaveLength(1);
    const r = review.rows[0];
    await expect(
      confirmBankSms(f.president, { items: [{ smsId: r.id, accountId: r.accountId, date: r.date, amount: r.amount, payerNameRaw: "", purposeRaw: "" }] })
    ).rejects.toThrow(ForbiddenError);
    await expect(dismissBankSms(f.president, r.id, "x")).rejects.toThrow(ForbiddenError);
    await expect(listBankSmsReview(f.actorA)).rejects.toThrow(ForbiddenError); // an owner sees nothing
  });

  it("tenant isolation: another ZEV's accountant neither sees nor confirms this ZEV's messages", async () => {
    const { f, token } = await setup("sms-iso-a");
    const other = await createFixture("sms-iso-b");
    await send(token, PRILIV);
    const mine = (await listBankSmsReview(f.accountant)).rows[0];
    expect((await listBankSmsReview(other.accountant)).rows).toHaveLength(0);
    await expect(
      confirmBankSms(other.accountant, {
        items: [{ smsId: mine.id, accountId: other.account.id, date: mine.date, amount: mine.amount, payerNameRaw: "", purposeRaw: "" }],
      })
    ).rejects.toThrow(/više nisu na čekanju/);
    await expect(dismissBankSms(other.accountant, mine.id, "x")).rejects.toThrow(/više nije/);
    expect((await prisma.incomingBankSms.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("PENDING");
  });

  it("flags an SMS whose payment is already booked from a statement/manual entry, un-ticked", async () => {
    const { f, token } = await setup("sms-already");
    await send(token, PRILIV);
    const sms = await prisma.incomingBankSms.findFirstOrThrow({ where: { zevId: f.zev.id } });
    await prisma.payment.create({
      data: { zevId: f.zev.id, accountId: f.account.id, date: sms.receivedAt, amount: "47.87", payerNameRaw: "ZELJKO GALIC", method: "BANK", createdById: f.accountant.userId },
    });
    const row = (await listBankSmsReview(f.accountant)).rows[0];
    expect(row.include).toBe(false);
    expect(row.warnings.join(" ")).toMatch(/već uvezena/);
  });

  it("checkBankSmsText reads a pasted message without storing anything", async () => {
    const { f } = await setup("sms-check");
    const res = await checkBankSmsText(f.president, PRILIV);
    expect(res).toMatchObject({ kind: "PRILIV", amount: "47.87", accountRecognized: true, error: null });
    expect(await prisma.incomingBankSms.count({ where: { zevId: f.zev.id } })).toBe(0);
  });
});

describe("PDF statement preview: rows already booked from a confirmed SMS", () => {
  const baseRow = (over: Partial<PdfPreviewRow>): PdfPreviewRow => ({
    include: true, direction: "IN", date: "2032-05-01", amount: "47.87", payerNameRaw: "ZELJKO GALIC", purposeRaw: "", reference: "",
    invoiceId: null, expenseId: null, categoryName: "", matchHint: null, duplicateOf: null, ...over,
  });

  it("un-ticks the matching row (one SMS per row) and leaves the others alone", async () => {
    const f = await createFixture("sms-pdfdup");
    const day = new Date("2032-05-01T00:00:00Z");
    const sms = await prisma.incomingBankSms.create({
      data: {
        zevId: f.zev.id, rawHash: uid("h"), kind: "PRILIV", status: "CONFIRMED", accountId: f.account.id, amount: "47.87",
        counterpartyAccount: "5550000000009912", receivedAt: new Date(day.getTime() + 10 * 3600000), paymentId: null,
      },
    });
    const rows = [
      baseRow({}), // the same money
      baseRow({}), // a second identical statement row — only ONE sms exists, so this one stays
      baseRow({ amount: "99.00" }), // other amount
      baseRow({ direction: "OUT" }), // other direction
    ];
    const partner = ["5550000000009912", "5550000000009912", "5550000000009912", "5550000000009912"];
    await markRowsAlreadyBookedFromSms(f.zev.id, f.account.id, day, rows, partner);
    expect(rows.map((r) => r.include)).toEqual([false, true, true, true]);
    expect(rows[0].duplicateOf?.smsId).toBe(sms.id);
  });

  it("does not match a different counterparty account or a message far from the statement date", async () => {
    const f = await createFixture("sms-pdfdup2");
    const day = new Date("2032-05-01T00:00:00Z");
    await prisma.incomingBankSms.create({
      data: { zevId: f.zev.id, rawHash: uid("h"), kind: "PRILIV", status: "CONFIRMED", accountId: f.account.id, amount: "47.87", counterpartyAccount: "5550000000009912", receivedAt: new Date(day.getTime() + 20 * 86400000) },
    });
    const rows = [baseRow({})];
    await markRowsAlreadyBookedFromSms(f.zev.id, f.account.id, day, rows, ["5550000000009912"]);
    expect(rows[0].include).toBe(true);

    await prisma.incomingBankSms.create({
      data: { zevId: f.zev.id, rawHash: uid("h"), kind: "PRILIV", status: "CONFIRMED", accountId: f.account.id, amount: "47.87", counterpartyAccount: "1111111111111111", receivedAt: new Date(day.getTime() + 3600000) },
    });
    await markRowsAlreadyBookedFromSms(f.zev.id, f.account.id, day, rows, ["5550000000009912"]);
    expect(rows[0].include).toBe(true);
  });
});

describe("diacritics folding in name matching", () => {
  it("matches names the bank prints without diacritics", () => {
    expect(nameMatchesText("željko galić", "zeljko galic")).toBe(true);
    expect(nameMatchesText("đurić dušanka", "djuric sipka dusanka st")).toBe(true); // Đ printed as DJ
    expect(nameMatchesText("đurić dušanka", "duric dusanka")).toBe(true); // Đ printed as D
    expect(nameMatchesText("džajić jovica", "jovica (ratko) dzajic")).toBe(true);
    expect(nameMatchesText("željko galić", "marko markovic")).toBe(false);
    expect(foldDiacritics("ČĆŠŽĐ", "dj")).toBe("ccszdj");
  });
});
