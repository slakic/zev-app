// Several PDF statements at once (v2.39.0): importPdfPreviews / commitPdfImports. The PDF text
// layer is mocked (extractPdfText returns the buffer as text) so the tests can use statement
// text in the real Nova Banka shape (see tests/bankStatementPdf.test.ts) without PDF fixtures.
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, uid } from "./helpers";
import { importPdfPreviews, commitPdfImports, type PdfStatementPreview } from "@/server/services/payments";
import { ForbiddenError } from "@/server/auth/guards";

vi.mock("@/server/services/bankStatementPdf", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/server/services/bankStatementPdf")>();
  return { ...orig, extractPdfText: async (buffer: Buffer) => buffer.toString("utf8") };
});

/** Statement text in the bank's real shape; `rows` are inflows (credit) with a unique reference. */
function statement(no: number, date: string, rows: { ref: string; purpose: string; account: string; name: string; amount: string }[]) {
  const body = rows
    .map((r, i) => `${r.ref}  /   ${r.purpose}\n${r.account}${r.name}0.00${r.amount}\n${i + 1}`)
    .join("\n");
  return Buffer.from(`

IZVOD BR.${no}
O PROMJENAMA SREDSTAVA NA RAČUNU
${date}
ZAJEDNICA ETAŽNIH VLASNIKA
MBR496007766
555-10000515469-32
40007BAM
(Vlasnik računa)
(Broj računa)
PRETHODNO STANJE
1,000.00
Datum izvoda
RAČUN PARTNERA
REFERENCA BANKE / SVRHA DOZNAKE
NAZIV PARTNERAZADUŽENJEODOBRENJE
RBR.
${body}
Nalog
NOVO STANJE
UKUPAN PROMET
Vaša Nova banka
`);
}

const row = (amount: string, name = "MARKO MARKOVIC") => ({
  ref: String(398000000 + Math.floor(Math.random() * 999999)),
  purpose: "UPLATA ZA STAN",
  account: "5550000000001111",
  name,
  amount,
});

async function setup(tag: string) {
  const f = await createFixture(tag);
  await prisma.moneyAccount.update({ where: { id: f.account.id }, data: { iban: "555-10000515469-32" } });
  return f;
}

const toCommit = (previews: PdfStatementPreview[]) =>
  previews.map((p) => ({
    filename: p.filename,
    rawText: p.rawText,
    rows: p.rows.filter((r) => r.include).map((r) => ({ ...r, invoiceId: null, expenseId: null })),
    skippedSmsIds: p.rows.flatMap((r) => (!r.include && r.duplicateOf ? [r.duplicateOf.smsId] : [])),
  }));

describe("importPdfPreviews", () => {
  it("reads several statements sorted by date; a repeated or unreadable file is reported, the rest go on", async () => {
    const f = await setup("pdfm-read");
    const later = statement(168, "07.10.2026", [row("10.00"), row("20.00")]);
    const earlier = statement(167, "06.10.2026", [row("35.71")]);
    const res = await importPdfPreviews(f.accountant, {
      accountId: f.account.id,
      files: [
        { filename: "168.pdf", buffer: later },
        { filename: "167.pdf", buffer: earlier },
        { filename: "167-kopija.pdf", buffer: earlier },
        { filename: "racun.pdf", buffer: Buffer.from("Ovo nije izvod banke.") },
      ],
    });
    expect(res.previews.map((p) => p.filename)).toEqual(["167.pdf", "168.pdf"]);
    expect(res.previews.map((p) => p.rows.length)).toEqual([1, 2]);
    expect(res.previews.every((p) => !p.accountMismatch && p.alreadyImportedAt === null)).toBe(true);
    expect(res.failures).toEqual([
      { filename: "167-kopija.pdf", error: "Isti fajl je izabran više puta." },
      { filename: "racun.pdf", error: expect.stringMatching(/Nije prepoznata/) },
    ]);
  });

  it("only the accountant may preview; no files or too many files are refused", async () => {
    const f = await setup("pdfm-guard");
    const one = [{ filename: "a.pdf", buffer: statement(1, "01.10.2026", [row("1.00")]) }];
    await expect(importPdfPreviews(f.president, { accountId: f.account.id, files: one })).rejects.toThrow(ForbiddenError);
    await expect(importPdfPreviews(f.accountant, { accountId: f.account.id, files: [] })).rejects.toThrow(/bar jedan/);
    const many = Array.from({ length: 32 }, (_, i) => ({ filename: `${i}.pdf`, buffer: Buffer.from(String(i)) }));
    await expect(importPdfPreviews(f.accountant, { accountId: f.account.id, files: many })).rejects.toThrow(/Najviše 31/);
  });

  it("one confirmed SMS matches a row in only ONE of the statements", async () => {
    const f = await setup("pdfm-sms");
    await prisma.incomingBankSms.create({
      data: {
        zevId: f.zev.id, rawHash: uid("h"), kind: "PRILIV", status: "CONFIRMED", accountId: f.account.id,
        amount: "47.87", receivedAt: new Date("2026-10-06T10:00:00Z"),
      },
    });
    const res = await importPdfPreviews(f.accountant, {
      accountId: f.account.id,
      files: [
        { filename: "a.pdf", buffer: statement(1, "06.10.2026", [row("47.87")]) },
        { filename: "b.pdf", buffer: statement(2, "07.10.2026", [row("47.87", "ANA ANIC")]) },
      ],
    });
    const rows = res.previews.flatMap((p) => p.rows);
    expect(rows.filter((r) => r.duplicateOf)).toHaveLength(1);
    expect(rows.filter((r) => r.include)).toHaveLength(1);
  });
});

describe("commitPdfImports", () => {
  it("books each statement as its own batch; importing the same statement again is flagged and un-ticked", async () => {
    const f = await setup("pdfm-commit");
    const files = [
      { filename: "a.pdf", buffer: statement(11, "01.10.2026", [row("10.00"), row("15.00")]) },
      { filename: "b.pdf", buffer: statement(12, "02.10.2026", [row("20.00")]) },
    ];
    const first = await importPdfPreviews(f.accountant, { accountId: f.account.id, files });
    const res = await commitPdfImports(f.accountant, { accountId: f.account.id, statements: toCommit(first.previews) });
    expect(res).toMatchObject({ imported: 3, statements: 2 });
    const batches = await prisma.bankImportBatch.findMany({ where: { zevId: f.zev.id, sourceType: "PDF" }, include: { payments: true } });
    expect(batches.map((b) => [b.filename, b.payments.length]).sort()).toEqual([["a.pdf", 2], ["b.pdf", 1]]);

    const again = await importPdfPreviews(f.accountant, { accountId: f.account.id, files });
    expect(again.previews.every((p) => p.alreadyImportedAt !== null)).toBe(true);
    expect(again.previews.flatMap((p) => p.rows).every((r) => !r.include)).toBe(true);
    await expect(commitPdfImports(f.accountant, { accountId: f.account.id, statements: toCommit(again.previews) })).rejects.toThrow(/Nema stavki/);
  });

  it("is all-or-nothing: an invalid row in one statement books nothing from any of them", async () => {
    const f = await setup("pdfm-atomic");
    const prev = await importPdfPreviews(f.accountant, {
      accountId: f.account.id,
      files: [
        { filename: "a.pdf", buffer: statement(21, "03.10.2026", [row("10.00")]) },
        { filename: "b.pdf", buffer: statement(22, "04.10.2026", [row("20.00")]) },
      ],
    });
    const statements = toCommit(prev.previews);
    statements[1].rows[0].amount = "nije-iznos";
    await expect(commitPdfImports(f.accountant, { accountId: f.account.id, statements })).rejects.toThrow();
    expect(await prisma.payment.count({ where: { zevId: f.zev.id } })).toBe(0);
    expect(await prisma.bankImportBatch.count({ where: { zevId: f.zev.id } })).toBe(0);
  });
});
