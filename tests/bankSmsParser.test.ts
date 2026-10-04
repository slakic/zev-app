// Plans/bank-sms-ingestion-plan.md, O2 — pure parser tests against REAL Nova Banka SMS texts
// (supplied by the user on 2026-10-04, account/payer data as received). No database involved.
import { describe, it, expect } from "vitest";
import { parseNovaBankaSms, looksLikeBankSms, normalizeSmsText } from "@/server/services/bankSmsParser";

const OWN = "5551000051546932";

describe("parseNovaBankaSms — Priliv (incoming)", () => {
  it("parses the canonical example (unit number + payer name + thousands in balance)", () => {
    const r = parseNovaBankaSms(
      "NOVA BANKA-Priliv na 5551000051546932 Iznos 47,87 KM, svrha UPL. ZA 08/26 STAN BR 11, 5550000000009912 ZELJKO GALIC.Raspolozivo 11.175,20 KM"
    );
    expect(r.kind).toBe("PRILIV");
    expect(r.error).toBeNull();
    expect(r.ownAccount).toBe(OWN);
    expect(r.amount?.toFixed(2)).toBe("47.87");
    expect(r.purposeRaw).toBe("UPL. ZA 08/26 STAN BR 11");
    expect(r.counterpartyAccount).toBe("5550000000009912");
    expect(r.counterpartyName).toBe("ZELJKO GALIC");
    expect(r.balanceAfter?.toFixed(2)).toBe("11175.20");
  });

  it("keeps a truncated payer name exactly as printed", () => {
    const r = parseNovaBankaSms(
      "NOVA BANKA-Priliv na 5551000051546932 Iznos 24,42 KM, svrha STAN 36, 5550000000009912 SIMIC DUSAN I LENA B L.Raspolozivo 11.175,20 KM"
    );
    expect(r.kind).toBe("PRILIV");
    expect(r.purposeRaw).toBe("STAN 36");
    expect(r.counterpartyName).toBe("SIMIC DUSAN I LENA B L");
    expect(r.amount?.toFixed(2)).toBe("24.42");
  });

  it("handles parentheses in the payer name and a 'ST.56' unit hint", () => {
    const r = parseNovaBankaSms(
      "NOVA BANKA-Priliv na 5551000051546932 Iznos 29,65 KM, svrha ST.56 OBAVEZE ZA 8/2026, 5620998137576486 JOVICA (RATKO) DZAJIC.Raspolozivo 10.704,25 KM"
    );
    expect(r.kind).toBe("PRILIV");
    expect(r.purposeRaw).toBe("ST.56 OBAVEZE ZA 8/2026");
    expect(r.counterpartyName).toBe("JOVICA (RATKO) DZAJIC");
  });

  it("parses a purpose with no unit number and a name ending in a period-like abbreviation", () => {
    const r = parseNovaBankaSms(
      "NOVA BANKA-Priliv na 5551000051546932 Iznos 30,00 KM, svrha UPLATA RACUNA ZA 08/2026, 5550000000009912 DJURIC SIPKA DUSANKA ST.Raspolozivo 11.900,98 KM"
    );
    expect(r.kind).toBe("PRILIV");
    expect(r.purposeRaw).toBe("UPLATA RACUNA ZA 08/2026");
    expect(r.counterpartyName).toBe("DJURIC SIPKA DUSANKA ST");
    expect(r.balanceAfter?.toFixed(2)).toBe("11900.98");
  });

  it("does not split a purpose that itself contains a comma", () => {
    const r = parseNovaBankaSms(
      "NOVA BANKA-Priliv na 5551000051546932 Iznos 15,00 KM, svrha Racun za juli, stan 47, 5550000000009912 MARKO MARKOVIC.Raspolozivo 100,00 KM"
    );
    expect(r.kind).toBe("PRILIV");
    expect(r.purposeRaw).toBe("Racun za juli, stan 47");
    expect(r.counterpartyName).toBe("MARKO MARKOVIC");
  });

  it("tolerates line breaks inserted by the phone", () => {
    const r = parseNovaBankaSms(
      "NOVA BANKA-Priliv na 5551000051546932\nIznos 47,87 KM, svrha STAN BR 11,\n5550000000009912 ZELJKO GALIC.Raspolozivo 11.175,20 KM"
    );
    expect(r.kind).toBe("PRILIV");
    expect(r.counterpartyName).toBe("ZELJKO GALIC");
  });
});

describe("parseNovaBankaSms — Odliv (outgoing)", () => {
  it("parses a bank fee that has NO counterparty at all", () => {
    const r = parseNovaBankaSms(
      "NOVA BANKA-Odliv sa 5551000051546932 Iznos 9,00 KM, svrha Naknada za PAKET START SME za SEPTEMBAR-2026.Raspolozivo 11.102,91 KM"
    );
    expect(r.kind).toBe("ODLIV");
    expect(r.error).toBeNull();
    expect(r.amount?.toFixed(2)).toBe("9.00");
    expect(r.purposeRaw).toBe("Naknada za PAKET START SME za SEPTEMBAR-2026");
    expect(r.counterpartyAccount).toBeNull();
    expect(r.counterpartyName).toBeNull();
    expect(r.balanceAfter?.toFixed(2)).toBe("11102.91");
  });

  it("parses payments to a person, the state and utilities (names with dots/dashes)", () => {
    const person = parseNovaBankaSms(
      "NOVA BANKA-Odliv sa 5551000051546932 Iznos 209,50 KM, svrha NAKNADA IX/26, 1613000079045743 STANKOVIC DRAGAN.Raspolozivo 10.714,64 KM"
    );
    expect(person.kind).toBe("ODLIV");
    expect(person.counterpartyName).toBe("STANKOVIC DRAGAN");
    expect(person.counterpartyAccount).toBe("1613000079045743");

    const state = parseNovaBankaSms(
      "NOVA BANKA-Odliv sa 5551000051546932 Iznos 31,30 KM, svrha POREZ PRED UO IX/26, 5550000805368417 MINISTARSTVO FINANSIJA REPUBL.Raspolozivo 10.639,46 KM"
    );
    expect(state.purposeRaw).toBe("POREZ PRED UO IX/26");
    expect(state.counterpartyName).toBe("MINISTARSTVO FINANSIJA REPUBL");

    const utility = parseNovaBankaSms(
      "NOVA BANKA-Odliv sa 5551000051546932 Iznos 51,85 KM, svrha RN 7517352, 5551000051839872 MH ERS MP A.D. TREBINJE- JAVNO SNABDJE.Raspolozivo 10.850,86 KM"
    );
    expect(utility.purposeRaw).toBe("RN 7517352");
    expect(utility.counterpartyName).toBe("MH ERS MP A.D. TREBINJE- JAVNO SNABDJE");

    const lift = parseNovaBankaSms(
      "NOVA BANKA-Odliv sa 5551000051546932 Iznos 163,80 KM, svrha RN VIII/26, 5620078068454526 SINGERICA LIFT DOO PRIJEDOR.Raspolozivo 10.964,99 KM"
    );
    expect(lift.kind).toBe("ODLIV");
    expect(lift.amount?.toFixed(2)).toBe("163.80");
    expect(lift.counterpartyName).toBe("SINGERICA LIFT DOO PRIJEDOR");
  });
});

describe("parseNovaBankaSms — rejection (never misread, never silently dropped)", () => {
  it("rejects a message that is not from the bank, and says so", () => {
    const r = parseNovaBankaSms("Vidimo se u 18h kod restorana");
    expect(r.kind).toBe("UNKNOWN");
    expect(r.error).toMatch(/nije od Nova Banke/);
    expect(looksLikeBankSms("Vidimo se u 18h")).toBe(false);
  });

  it("rejects a bank message in an unknown format (marketing, changed wording)", () => {
    const r = parseNovaBankaSms("NOVA BANKA-Postovani, iskoristite kredit po povoljnoj kamati do 31.10.");
    expect(r.kind).toBe("UNKNOWN");
    expect(looksLikeBankSms("NOVA BANKA-Postovani")).toBe(true);
    expect(r.amount).toBeNull();
  });

  it("rejects a currency other than KM", () => {
    const r = parseNovaBankaSms(
      "NOVA BANKA-Priliv na 5551000051546932 Iznos 10,00 EUR, svrha TEST, 5550000000009912 NEKO.Raspolozivo 1,00 KM"
    );
    expect(r.kind).toBe("UNKNOWN");
    expect(r.error).toMatch(/KM/);
  });

  it("rejects several messages pasted into one request", () => {
    const r = parseNovaBankaSms(
      "NOVA BANKA-Odliv sa 5551000051546932 Iznos 31,30 KM, svrha POREZ, 5550000805368417 MINISTARSTVO.Raspolozivo 10.639,46 KM " +
        "NOVA BANKA-Priliv na 5551000051546932 Iznos 29,65 KM, svrha ST.56, 5620998137576486 JOVICA DZAJIC.Raspolozivo 10.704,25 KM"
    );
    expect(r.kind).toBe("UNKNOWN");
    expect(r.error).toMatch(/više od jedne/);
  });

  it("rejects a zero amount and an empty message", () => {
    expect(
      parseNovaBankaSms("NOVA BANKA-Priliv na 5551000051546932 Iznos 0,00 KM, svrha X, 5550000000009912 NEKO.Raspolozivo 1,00 KM").kind
    ).toBe("UNKNOWN");
    expect(parseNovaBankaSms("   ").kind).toBe("UNKNOWN");
  });

  it("normalizeSmsText collapses whitespace so equal messages hash equal", () => {
    expect(normalizeSmsText("  a \n b\t c ")).toBe("a b c");
  });
});
