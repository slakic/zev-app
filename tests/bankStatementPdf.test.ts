import { describe, it, expect } from "vitest";
import { parseNovaBankaStatement, extractUnitNumberCandidates } from "@/server/services/bankStatementPdf";

// Real text extracted (via pdf-parse) from an actual Nova Banka "IZVOD" PDF statement.
// Columns are concatenated with no separators because the bank places them at fixed
// coordinates rather than emitting real space characters — this fixture locks in that
// real-world shape so the parser is tested against the format it actually has to handle,
// not an idealized one.
const SAMPLE_TEXT = `


IZVOD BR.143
O PROMJENAMA SREDSTAVA NA RAČUNU
27.08.2026
ZAJEDNICA ETAŽNIH VLASNIKA UL. KARAĐORĐEVA BR.79C BANJA LUKA
MBR496007766
555-10000515469-32
40007BAM
(Vlasnik računa)
(Broj računa)
PRETHODNO STANJE
13,971.98
KARAĐORĐEVA BR.79C BANJA LUKA
Datum izvoda
RAČUN PARTNERA
REFERENCA BANKE / SVRHA DOZNAKE
NAZIV PARTNERAZADUŽENJEODOBRENJE
RBR.
398777885  /   Racun za juli, stan 47 Savic Ljubinka
5673215000276394DRAGANA DEJANAC0.0049.47
1
398807762  /  0000000000 ZA STAN  7/2026  STAN 4
5550000000009912AMIRA  HAJDARPASIC0.0025.33
2
Nalog
Racun povjeriocaPovjerilacIznos
NalogRacun povjeriocaPovjerilacIznos
NOVO STANJE
0.0074.80
UKUPAN PROMET
NEIZVRŠENI NALOZI
NALOZI NA ČEKANJU I DOSPJELA POTRAŽIVANJA
14,046.78
0.00
0.00
14,046.78
NEISKORIŠĆEN LIMIT
REZERVISANI IZNOS
RASPOLOŽIVO
DOSPJELA POTRAŽIVANJA
0.00
Poštovani,
Rok za prijem reklamacija na dostavljeni izvod je dva radna dana, nakon cega ce se smatrati da ste saglasni sa predocenim
stanjem i promjenama na racunu. Za sve dodatne informacije na raspolaganju Vam je besplatan info telefon 080050011.
Vaša Nova banka


27.08.2026 20:02:56`;

describe("bank statement PDF parsing", () => {
  it("parses statement date and the ZEV's own account number", () => {
    const parsed = parseNovaBankaStatement(SAMPLE_TEXT);
    expect(parsed.statementDate?.toISOString().slice(0, 10)).toBe("2026-08-27");
    expect(parsed.ownAccountNumber).toBe("555-10000515469-32");
  });

  it("splits concatenated account+name+debit+credit columns correctly", () => {
    const parsed = parseNovaBankaStatement(SAMPLE_TEXT);
    expect(parsed.rows).toHaveLength(2);
    const [r1, r2] = parsed.rows;
    expect(r1.partnerAccount).toBe("5673215000276394");
    expect(r1.partnerName).toBe("DRAGANA DEJANAC");
    expect(r1.debit.toFixed(2)).toBe("0.00");
    expect(r1.credit.toFixed(2)).toBe("49.47");
    expect(r1.bankReference).toBe("398777885");
    expect(r1.purposeRaw).toBe("Racun za juli, stan 47 Savic Ljubinka");
    expect(r1.rbr).toBe(1);

    expect(r2.partnerName).toBe("AMIRA HAJDARPASIC"); // double space collapsed
    expect(r2.credit.toFixed(2)).toBe("25.33");
    expect(r2.rbr).toBe(2);
  });

  it("extracts the unit number from a simple 'stan N' purpose", () => {
    const cands = extractUnitNumberCandidates("Racun za juli, stan 47 Savic Ljubinka");
    expect(cands.keyword).toContain("47");
  });

  it("does not confuse a month/year period (7/2026) with a unit number, but still finds the real one", () => {
    const cands = extractUnitNumberCandidates("0000000000 ZA STAN 7/2026 STAN 4");
    expect(cands.keyword).not.toContain("7");
    expect(cands.keyword).toContain("4");
  });

  it("returns no keyword candidates when the purpose has no stan/br/broj marker", () => {
    const cands = extractUnitNumberCandidates("Uplata za avgust");
    expect(cands.keyword).toHaveLength(0);
  });
});
