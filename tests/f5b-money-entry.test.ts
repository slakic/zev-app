// F5b — unos novca: CSV kolone od 1 u UI-ju → od 0 u servisu (čista funkcija) i pamćenje mapiranja,
// sažetak pregleda uvoza, „Način” uplate iz tipa računa, traka posla (isti brojevi kao početna), te tok upozorenja
// o duplikatu troška (servisni dio `useActionState` forme).
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, type Fixture } from "./helpers";
import {
  DEFAULT_CSV_UI_MAPPING, uiColumnToIndex, indexToUiColumn, uiMappingToService, uiMappingFromForm,
  readSavedCsvMapping, saveCsvMapping, CSV_MAPPING_STORAGE_PREFIX,
} from "@/lib/csvMapping";
import { reviewSummary, pluralForm, parseCents, formatKm } from "@/lib/reviewSummary";
import { expenseValuesFromForm } from "@/lib/expenseFormState";
import { enterPayment, importBankCsv, paymentMethodForAccountType, countPaymentsToMatch, listPayments, PAYMENT_FILTER_TO_MATCH } from "@/server/services/payments";
import { getPaymentsWorkStrip } from "@/server/services/accountantHome";
import { createSupplier, createExpense, DuplicateExpenseWarning } from "@/server/services/expenses";
import { createAccount } from "@/server/services/finance";
import { ForbiddenError } from "@/server/auth/guards";

describe("CSV: kolone od 1 u UI-ju, od 0 u servisu", () => {
  it("pretvara broj kolone i vraća ga nazad", () => {
    expect(uiColumnToIndex("1")).toBe(0);
    expect(uiColumnToIndex(4)).toBe(3);
    expect(indexToUiColumn(0)).toBe(1);
    expect(indexToUiColumn(uiColumnToIndex("7")!)).toBe(7);
  });

  it("prazno, nula, negativno i tekst nisu kolona", () => {
    for (const bad of ["", "  ", "0", "-1", "a", "1.5", null, undefined]) expect(uiColumnToIndex(bad)).toBeNull();
  });

  it("podrazumijevano mapiranje ide u iste indekse kao raniji servisni podrazumijevani (0,1,2,3, bez svrhe)", () => {
    expect(uiMappingToService(DEFAULT_CSV_UI_MAPPING)).toEqual({
      dateCol: 0, amountCol: 1, payerCol: 2, referenceCol: 3, purposeCol: -1,
      delimiter: ";", skipRows: 1, decimalComma: true, dateFormat: "DD.MM.YYYY",
    });
  });

  it("izabrana svrha i druge kolone se pomjeraju za jedan; obavezna kolona bez vrijednosti baca grešku", () => {
    const m = uiMappingToService({ ...DEFAULT_CSV_UI_MAPPING, dateCol: "3", amountCol: "5", purposeCol: "6", skipRows: "0", decimalComma: false });
    expect(m).toMatchObject({ dateCol: 2, amountCol: 4, purposeCol: 5, skipRows: 0, decimalComma: false });
    expect(() => uiMappingToService({ ...DEFAULT_CSV_UI_MAPPING, amountCol: "" })).toThrow(/Iznos/);
    expect(() => uiMappingToService({ ...DEFAULT_CSV_UI_MAPPING, payerCol: "0" })).toThrow(/Platilac/);
  });

  it("čita mapiranje iz forme; checkbox bez 'on' znači decimalnu tačku", () => {
    const fd = new FormData();
    fd.set("dateCol", "2");
    fd.set("purposeCol", "");
    fd.set("delimiter", ",");
    const ui = uiMappingFromForm((n) => fd.get(n));
    expect(ui).toMatchObject({ dateCol: "2", purposeCol: "", delimiter: ",", amountCol: "2", decimalComma: false });
  });

  it("uvoz sa mapiranjem iz UI-ja (kolone od 1) stvarno čita tražene kolone", async () => {
    const f = await createFixture("csv1");
    const csv = ["Datum;Napomena;Iznos;Platilac;Poziv", "01.03.2034;x;123,45;Ana A;99-1"].join("\n");
    const mapping = uiMappingToService({
      ...DEFAULT_CSV_UI_MAPPING, dateCol: "1", amountCol: "3", payerCol: "4", referenceCol: "5",
    });
    const res = await importBankCsv(f.accountant, { accountId: f.account.id, filename: "t.csv", content: csv, mapping });
    expect(res.imported).toBe(1);
    const p = await prisma.payment.findFirstOrThrow({ where: { zevId: f.zev.id } });
    expect(p.amount.toString()).toBe("123.45");
    expect(p.reference).toBe("99-1");
  });
});

describe("CSV: pamćenje mapiranja po računu (localStorage)", () => {
  const mem = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  };

  it("snimi i pročita mapiranje po računu; drugi račun ga nema", () => {
    const st = mem();
    const m = { ...DEFAULT_CSV_UI_MAPPING, dateCol: "2", purposeCol: "5" };
    expect(saveCsvMapping("acc-1", m, st)).toBe(true);
    expect(readSavedCsvMapping("acc-1", st)).toEqual(m);
    expect(readSavedCsvMapping("acc-2", st)).toBeNull();
  });

  it("bez skladišta, sa skladištem koje baca i sa pokvarenim sadržajem stranica i dalje radi", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(readSavedCsvMapping("a", null)).toBeNull();
    expect(saveCsvMapping("a", DEFAULT_CSV_UI_MAPPING, null)).toBe(false);
    expect(readSavedCsvMapping("a", throwing)).toBeNull();
    expect(saveCsvMapping("a", DEFAULT_CSV_UI_MAPPING, throwing)).toBe(false);
    const st = mem();
    st.data.set(CSV_MAPPING_STORAGE_PREFIX + "a", "{ not json");
    expect(readSavedCsvMapping("a", st)).toBeNull();
    st.data.set(CSV_MAPPING_STORAGE_PREFIX + "a", JSON.stringify({ dateCol: 1 }));
    expect(readSavedCsvMapping("a", st)).toBeNull();
  });
});

describe("pregled uvoza: sažetak i množina", () => {
  it("broji označeno i sabira uplate i isplate Decimal-om (zarez, tačka, neispravan iznos)", () => {
    const s = reviewSummary([
      { include: true, direction: "IN", amount: "0.10" },
      { include: true, direction: "IN", amount: "0.20" },
      { include: true, direction: "IN", amount: "1.234,50" },
      { include: true, direction: "OUT", amount: "10,25" },
      { include: false, direction: "OUT", amount: "999.00" },
      { include: true, direction: "IN", amount: "abc" },
    ]);
    expect(s).toEqual({ selected: 5, total: 6, inTotal: "1234.80", outTotal: "10.25", inCount: 4, outCount: 1 });
  });

  it("feninzi i prikaz: zaokruživanje half-up, hiljade tačkom, decimale zarezom", () => {
    expect(parseCents("12,345")).toBe(1235);
    expect(parseCents("0.004")).toBe(0);
    expect(parseCents("1.5.5")).toBeNull();
    expect(formatKm("1234.5")).toBe("1.234,50 KM");
    expect(formatKm("200")).toBe("200,00 KM");
    expect(formatKm("1234567.89")).toBe("1.234.567,89 KM");
    expect(formatKm("x")).toBe("0,00 KM");
  });

  it("množina: 1 uplata, 2-4 uplate, 5+, 11-14 i 21", () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 0].map(pluralForm)).toEqual(["one", "few", "few", "many", "many", "many", "many", "one", "few", "many", "many"]);
  });
});

describe("ručni unos: način iz tipa računa", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await createFixture("pm");
  });

  it("BANK → BANK, CASH → CASH", () => {
    expect(paymentMethodForAccountType("BANK")).toBe("BANK");
    expect(paymentMethodForAccountType("CASH")).toBe("CASH");
  });

  it("enterPayment bez 'method' izvodi način iz računa (uplata i knjiženje)", async () => {
    const cash = await createAccount(f.accountant, { type: "CASH", name: `Blagajna-${f.t}`, openingBalance: "0", openingDate: new Date("2020-01-01") });
    const pBank = await enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "10.00", payerNameRaw: "X" });
    const pCash = await enterPayment(f.accountant, { accountId: cash.id, date: new Date(), amount: "11.00", payerNameRaw: "Y" });
    expect(pBank.method).toBe("BANK");
    expect(pCash.method).toBe("CASH");
    const tx = await prisma.finTransaction.findFirstOrThrow({ where: { paymentId: pCash.id } });
    expect(tx.paymentMethod).toBe("CASH");
  });
});

describe("traka posla na stranici uplata", () => {
  let f: Fixture;
  let other: Fixture;
  beforeAll(async () => {
    f = await createFixture("strip");
    other = await createFixture("strip2");
    await enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "5.00", payerNameRaw: "Nepoznat" });
    await enterPayment(other.accountant, { accountId: other.account.id, date: new Date(), amount: "6.00", payerNameRaw: "Nepoznat" });
    await enterPayment(other.accountant, { accountId: other.account.id, date: new Date(), amount: "7.00", payerNameRaw: "Nepoznat" });
  });

  it("broj 'za uparivanje' je isti kao filter i kao broj na početnoj, samo za vlastiti ZEV", async () => {
    const strip = await getPaymentsWorkStrip(f.accountant);
    expect(strip.toMatch).toBe(await countPaymentsToMatch(f.zev.id));
    expect(strip.toMatch).toBe((await listPayments(f.accountant, { status: PAYMENT_FILTER_TO_MATCH }, { page: 1 })).rows.length);
    expect(strip.toMatch).toBe(1);
    expect((await getPaymentsWorkStrip(other.accountant)).toMatch).toBe(2);
  });

  it("prijem SMS-a nije uključen: nema brojeva SMS-a, a predsjednik smije da vidi traku; vlasnik ne", async () => {
    const strip = await getPaymentsWorkStrip(f.president);
    expect(strip.sms.active).toBe(false);
    expect(strip.duplicates).toBe(0);
    await expect(getPaymentsWorkStrip(f.actorA)).rejects.toThrow(ForbiddenError);
  });
});

describe("trošak: upozorenje o duplikatu nosi podatke za formu", () => {
  let f: Fixture;
  let supplierId: string;
  beforeAll(async () => {
    f = await createFixture("dup");
    supplierId = (await createSupplier(f.accountant, { name: `Dobavljac-${f.t}` })).id;
    await createExpense(f.accountant, { supplierId, invoiceNumber: "F-1", invoiceDate: new Date("2034-05-01"), amount: "200.00" });
  });

  it("DuplicateExpenseWarning nosi broj, dobavljača, iznos, datum i vezu; drugi poziv sa allowDuplicate uspijeva", async () => {
    const attempt = { supplierId, invoiceNumber: "F-1", amount: "999.00" };
    const err = await createExpense(f.accountant, attempt).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateExpenseWarning);
    const d = (err as DuplicateExpenseWarning).duplicates[0];
    expect(d).toMatchObject({ invoiceNumber: "F-1", amount: "200", supplierId, supplierName: `Dobavljac-${f.t}`, invoiceDate: "2034-05-01" });
    const forced = await createExpense(f.accountant, { ...attempt, allowDuplicate: true });
    expect(forced.id).toBeTruthy();
  });

  it("forma vraća sve unesene vrijednosti (osim allowDuplicate)", () => {
    const fd = new FormData();
    fd.set("supplierId", "s1");
    fd.set("amount", "12,50");
    fd.set("recurring", "on");
    fd.set("allowDuplicate", "on");
    const v = expenseValuesFromForm((n) => fd.get(n));
    expect(v).toMatchObject({ supplierId: "s1", amount: "12,50", recurring: "on", invoiceNumber: "", description: "" });
    expect(Object.keys(v)).not.toContain("allowDuplicate");
    expect(Object.keys(v)).toHaveLength(11);
  });
});
