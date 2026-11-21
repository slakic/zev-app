# Faza B1 — nalozi za knjiženje, kontrole, storno, periodi i početno stanje

**Status: ODOBRENO 2026-11-21 (korisnik prihvatio preporuke B1-Q1–B1-Q7: (a), (a), (c), (a), (a), (a), (b)). B1a isporučen u v3.6.0 (nalozi, kontrole, storno, periodi). B1b implementiran: početno stanje sa usklađivanjem (`openingBalance.ts`, `/knjigovodstvo/pocetno-stanje`), bez nove migracije. Dopune: storno početnog stanja smije na njegov datum i kad je u budućnosti; otvorena faktura se po namjeni dijeli srazmjerno stavkama fakture.** Napisan 2026-11-21 čitanjem koda v3.5.0. Nijedan red koda još nije
napisan. Nastavlja `Plans/kontni-plan-i-knjizenje-plan.md` (§4, §6, §11); ovdje je samo ono što B1 isporučuje.

**Cilj:** temelj knjiženja — nalog sa stavkama duguje/potražuje i svim kontrolama, ručni nalog, storno, zatvaranje i
ponovno otvaranje perioda i **nalog početnog stanja** sa usklađivanjem, da ZEV može početi knjiženje 1. januara 2027.

**Granice B1:**
- **Bez automatskog knjiženja** faktura, uplata i troškova — to je B2 (outbox `AccountingEvent` i pravila iz A2).
  Postojeći tokovi se u B1 ne diraju.
- **Bez izvještaja** osim liste naloga i detalja naloga — dnevnik, glavna knjiga, bruto bilans i kartice su B3.
- Kapije K-6 ostaju kakve jesu; B1 ne knjiži priznavanje prihoda ni trošenje rezerve automatski.

---

## 1. Zatečeno stanje (v3.5.0)

| Šta | Stanje | Gdje |
|---|---|---|
| Poslovne godine i periodi | postoje, samo OPEN; nema zatvaranja | `FiscalYear`, `FiscalPeriod`, `openFiscalYear` |
| Kontni plan | aktivan plan po ZEV-u, konta sa `postable`/`active`/`requiredDimensions` | `ZevChart`, `ZevAccount` |
| Kontrolna konta i pravila | postoje (A2), append-only / nepromjenjiva | `ZevControlAccount`, `PostingRule` |
| Stanje računa na dan | `accountBalance(actor, id, asOf)` — početno stanje računa + `FinTransaction` do datuma | `finance.ts:55` |
| Saldo vlasnika na dan | `ownerBalance(actor, partyId, asOf)` — fakture − alokacije + korekcije | `payments.ts:1159` |
| Avans vlasnika | `ownerAdvance` — **bez datuma** (trenutno stanje) | `payments.ts:1239` |
| Neplaćeni računi dobavljača | `unpaidSupplierInvoices` — **bez datuma** (`Expense.paidAmount`) | `reports.ts:107` |
| Rezerva | `reserveFundBalance` — gotovinski (FinTransaction `isReserveFund`), bez datuma | `finance.ts:166` |
| Brojevi dokumenata | `nextDocNumber` broji redove — nije bezbjedno za istovremene zahtjeve | `documents.ts` |

Posljedica: za početno stanje „na dan 1.1.2027.” trebaju nove funkcije *na dan* za avanse, neidentifikovane uplate i
obaveze prema dobavljačima (iz `Payment`/`PaymentAllocation` i `FinTransaction` sa `expenseId`, po datumu).

---

## 2. Model (migracija B1)

```prisma
enum JournalStatus { DRAFT  POSTED }
enum JournalKind   { MANUAL  OPENING  REVERSAL  AUTO }   // AUTO = B2

model JournalEntry {
  id             String        @id @default(cuid())
  zevId          String        // + FK
  yearId         String        // FiscalYear
  periodId       String        // FiscalPeriod (iz datuma knjiženja)
  kind           JournalKind
  number         String?       // dodjeljuje se pri knjiženju: "NK-2027-0001", početno stanje "PS-2027-0001"
  documentDate   DateTime
  postingDate    DateTime
  description    String
  status         JournalStatus @default(DRAFT)
  reversalOfId   String?       @unique   // storno nalog → original
  reversalReason String?
  sourceType     String?       // B2: izvorni dokument
  sourceId       String?
  createdById    String
  postedById     String?
  postedAt       DateTime?
  lines          JournalLine[]
  @@unique([zevId, number])
}

model JournalLine {
  id          String   @id @default(cuid())
  entryId     String
  zevId       String
  order       Int
  accountId   String   // ZevAccount
  debit       Decimal  @default(0) @db.Decimal(14, 2)
  credit      Decimal  @default(0) @db.Decimal(14, 2)
  partyId     String?  // dimenzije, sve sa FK
  unitId      String?
  supplierId  String?
  projectId   String?
  purposeId   String?
  description String?
  /// Samo nalog početnog stanja: odakle je stavka (otvorena faktura, račun dobavljača, račun novca…) ili "MANUAL".
  openingSourceType String?
  openingSourceId   String?
}

/// Brojač naloga po ZEV-u, godini i seriji — red se zaključava (FOR UPDATE), pa dva istovremena knjiženja
/// nikad ne dobiju isti broj (nextDocNumber broji redove i nije bezbjedan za ovo).
model JournalCounter { zevId String; yearId String; series String; next Int; @@id([zevId, yearId, series]) }

/// Ponovno otvaranje perioda uz dvostruko odobrenje (§11 R-9): jedno lice traži uz razlog, drugo (druga uloga) odobrava.
model PeriodReopenRequest {
  id String @id @default(cuid()); zevId String; periodId String; reason String
  requestedById String; requestedRole Role; requestedAt DateTime @default(now())
  decidedById String?; decision String? /* APPROVED | REJECTED */; decidedAt DateTime?
}
```

`FiscalPeriod` već ima `status`, `closedAt`, `closedById`; dodaje se `reopenedAt`/`reopenedById` za trag (ili samo audit).

**Kontrole u bazi (druga linija odbrane iza servisa):**
- `CHECK` na stavci: `(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)`.
- Okidač `journal_posted_immutable`: UPDATE/DELETE proknjiženog naloga i njegovih stavki odbijen (izuzetak: ništa).
- **Deferred constraint trigger** na `JournalEntry` pri prelasku u POSTED: zbir duguje = zbir potražuje, najmanje dvije
  stavke.
- `@@unique([zevId, number])`, `reversalOfId @unique` (jedan original — najviše jedan storno).

---

## 3. Servis `journal.ts` — pravila

**Nacrt:** računovođa pravi i mijenja nacrt (zaglavlje + stavke), briše ga dok nije proknjižen. Nacrt nema broj.

**Knjiženje (`postEntry`) u jednoj transakciji:**
1. zaključa period (`SELECT … FOR UPDATE`) — period mora postojati za datum knjiženja i biti **OPEN**;
2. provjeri stavke: najmanje dvije, svaka pozitivna samo na jednoj strani, zbirovi jednaki (`Decimal`);
3. konta: u aktivnom planu ZEV-a, `postable`, `active`;
4. dimenzije: sve pripadaju istom ZEV-u; obavezne dimenzije konta (`requiredDimensions`) popunjene; **kontrolna konta
   traže dimenziju svoje uloge** (potraživanja i avansi → vlasnik; dobavljači → dobavljač; potraživanja → namjena);
5. **ručni nalog ne smije koristiti kontrolna konta** (B1-Q5) — oni se mijenjaju samo kroz događaje (B2), storno i
   početno stanje, da analitika i glavna knjiga ostanu usklađene;
6. dodijeli broj iz `JournalCounter` (serija NK ili PS), postavi POSTED, `postedById/At`; audit.

**Storno (`reverseEntry`):** samo proknjiženog naloga koji nije već storniran; obavezan razlog; novi nalog vrste
REVERSAL sa istim stavkama i zamijenjenim stranama, `reversalOfId`, datum knjiženja koji korisnik bira (podrazumijevano
danas) u **otvorenom** periodu (R-9: zatvoren period se ne mijenja; storno ide u tekući). Knjiži se odmah.

**Periodi:** `closePeriod` (računovođa) — nema nacrta naloga u tom periodu (B1-Q6 (a): zabranjeno dok u periodu postoje nacrti);
`requestReopen` (predsjednik ili računovođa, uz razlog) → `approveReopen` od **drugog lica sa drugom ulogom**
(B1-Q2); svaka promjena u audit sa razlogom. Zatvaranje cijele godine (rezultat, R-12) nije u B1.

**Prava (nove mogućnosti):** `journal.prepare`, `journal.post`, `journal.reverse`, `period.close` → računovođa;
`period.reopen` → predsjednik i računovođa (dvostruko). Predsjednik vidi naloge (`ledger.view`).

---

## 4. Nalog početnog stanja (§4.4 glavnog plana, §11 R-11)

Jedan po ZEV-u i godini početka; **datum početka primjene** (prijedlog R-11: 1. januar 2027.) bira računovođa.
Nalog početnog stanja se knjiži sa datumom **početka**, a stanja se računaju **na kraj prethodnog dana** (31.12.2026.).

1. **„Pripremi prijedlog”** napravi nacrt (kind OPENING) iz operativne evidencije *na dan*:

   | Kontrolno konto | Stavke (OPEN_ITEMS = pojedinačno, po R-11) | Izvor |
   |---|---|---|
   | račun novca (24101, 24601…) | jedna po računu, D | `accountBalance(asOf)` |
   | potraživanja (20101/20102) | po otvorenoj fakturi i vlasniku, D; namjena iz linija fakture | fakture − alokacije do datuma; linije bez vrste → B1-Q3 |
   | korekcije salda | po vlasniku, D/P | `BalanceCorrection` do datuma, namjena → B1-Q3 |
   | avansi (43001) | po vlasniku, P | uplate − alokacije do datuma (**nova funkcija na dan**) |
   | neidentifikovane (43002) | po uplati, P | uplate bez platioca, nealocirano do datuma |
   | dobavljači (43201) | po neplaćenom računu, P | `Expense` − plaćanja do datuma (**nova funkcija na dan**) |

2. Stavke koje aplikacija **ne zna** računovođa dodaje ručno u nacrtu: razgraničena sredstva **49901/49902** (R-3, R-6),
   rezultat ranijih godina (34001/35001), ostalo iz starih knjiga. Prijedlog za 49902 može biti
   `reserveFundBalance` (gotovinski), jasno označen kao prijedlog.
3. **Protivstavka razlike:** dok nalog nije uravnotežen, prikazuje se razlika; računovođa je zatvara stavkom na
   kontu koje sam izabere (B1-Q4) — aplikacija ne bira konto razlike.
4. **Usklađivanje prije knjiženja** — tabela po kontrolnom kontu: glavna knjiga (zbir stavki) · analitika (zbir po
   vlasniku/dobavljaču/namjeni) · operativna evidencija (izvor). Dugme **Proknjiži** je onemogućeno dok ijedan red
   ima razliku, uz ⚠ razlog iznad dugmeta (obrazac „Sljedeći korak”).
5. Isti dokument ne može ući dvaput (`openingSourceId` jedinstven u nalogu); druga priprema zamjenjuje nacrt;
   proknjižen početni nalog ne može postojati dvaput za istu godinu.

Ako početno stanje treba ispraviti poslije knjiženja: storno + novi nalog početnog stanja, samo dok u godini nema
drugih proknjiženih naloga.

---

## 5. UI

| Ekran | Sadržaj |
|---|---|
| **Knjigovodstvo → Nalozi** (tab postaje aktivan) | lista naloga (broj, datum, opis, vrsta, status, iznos), filter perioda i statusa; „Novi nalog”; kartica „Početno stanje” sa statusom i vezom |
| **Novi / izmjena naloga** `/knjigovodstvo/nalozi/[id]` | zaglavlje (datum dokumenta, datum knjiženja, opis) + **uređivač stavki** (B1-Q1): konto, duguje, potražuje, vlasnik, dio, dobavljač, projekat, namjena, opis; zbirovi i razlika uživo |
| **Detalj naloga** | stavke, zbirovi, veza na storno/original; radnje: **Proknjiži** (caution → primary potvrda: broj stavki i iznos), **Obriši nacrt** (caution/caution), **Storniraj** (caution/caution, razlog i datum) — bez novog `danger` |
| **Početno stanje** `/knjigovodstvo/pocetno-stanje` | datum početka, „Pripremi prijedlog”, stavke po kontrolnom kontu, tabela usklađivanja, Proknjiži |
| **Poslovne godine** | po periodu: **Zatvori** (caution), **Zatraži ponovno otvaranje** (razlog), **Odobri / Odbij** zahtjev (drugo lice) |

Izvještaji ostaju „Nije još dostupno” (B3).

---

## 6. Testovi

Ravnoteža (servis i deferred okidač); stavka na obje strane / nula odbijena; zbirno, neaktivno i tuđe konto odbijeni;
dimenzija iz drugog ZEV-a odbijena; obavezna dimenzija kontrolnog konta; ručni nalog na kontrolno konto odbijen;
zatvoren period odbija knjiženje i storno; dvostruko i **istovremeno** knjiženje istog nacrta → jedan broj, jedan
POSTED; brojevi bez rupa i duplikata pod istovremenim knjiženjem; storno čuva vezu i ne može dvaput; proknjižen nalog
nepromjenjiv (okidač); ponovno otvaranje traži drugo lice drugačije uloge; početno stanje: prijedlog na dan (fakture i
uplate poslije datuma se ne broje), isti dokument ne dvaput, neusklađeno se ne knjiži, druga priprema ne duplira;
razdvajanje ZEV-ova za sve gore.

---

## 7. Isporuka

| Korak | Sadržaj |
|---|---|
| **B1a** | model + migracija, `journal.ts` (nacrt, knjiženje, storno, brojač), zatvaranje i ponovno otvaranje perioda, tab Nalozi, uređivač naloga, detalj; testovi; uputstvo |
| **B1b** | funkcije „na dan”, nalog početnog stanja, usklađivanje; testovi; uputstvo |

Svaka sa svojom verzijom (pitam pri isporuci), migracijom na Neon i commitom.

---

## 8. Odluke korisnika (sve preporuke prihvaćene 2026-11-21)

**B1-Q1 — Uređivač stavki naloga (dopuna dizajn sistema).** Sistem nema obrazac za unos promjenljivog broja redova.
(a) client komponenta: `Table` sa poljima `inputCls` po redu, „Dodaj stavku” / ukloni red, zbirovi i razlika uživo
(isti stil kao `ReviewTable`, na telefonu red = kartica); (b) server forma sa fiksnih 10 praznih redova, bez JS-a;
(c) stavka po stavka (forma „Dodaj stavku”, svaka snima nacrt). **Preporuka: (a)** — nalog se piše kao cjelina, a
razlika uživo je glavna pomoć korisniku; DS dobija jedan red.

**B1-Q2 — Dvostruko odobrenje ponovnog otvaranja perioda.** (a) zahtjev i odobrenje moraju dati **dva različita lica**,
jedno predsjednik, drugo računovođa; (b) dovoljno je da jedno lice ima obje uloge. **Preporuka: (a)** — inače
dvostruko odobrenje ne znači ništa u ZEV-u gdje je predsjednik ujedno i računovođa (takvom ZEV-u treba druga
osoba, npr. član odbora sa ulogom računovođe).

**B1-Q3 — Potraživanja bez namjene u početnom stanju.** Linije faktura izdatih prije A2 (79 na produkciji) i korekcije
salda nemaju vrstu zaduženja ni namjenu. (a) prijedlog ih stavlja na „Redovno održavanje” (20101), označeno, a
računovođa mijenja gdje treba; (b) aplikacija traži od računovođe da za svaku izabere namjenu prije knjiženja;
(c) namjena iz stavke naknade na liniji (ako linija ima stavku), ostalo kao (a). **Preporuka: (c)** — većina linija
iz serije ima stavku naknade koja sada ima vrstu.

**B1-Q4 — Konto razlike u početnom stanju.** (a) računovođa sam dodaje stavku razlike na konto koje izabere;
(b) aplikacija predlaže 34001 „Višak prihoda ranijih godina” / 35001 „Manjak…”. **Preporuka: (a)** — po R-11
protivkonto određuje računovođa nakon usaglašavanja; aplikacija samo pokazuje razliku.

**B1-Q5 — Ručni nalog i kontrolna konta.** (a) zabranjeno (ispravke samo stornom, događajem ili početnim stanjem);
(b) dozvoljeno uz obavezne dimenzije i razlog. **Preporuka: (a)** za B1; ako se pokaže potreba (npr. otpis
potraživanja R-10, prenos duga), dodaje se kao poseban, kontrolisan tok, ne kao slobodan ručni nalog.

**B1-Q6 — Zatvaranje perioda sa nacrtima.** (a) zabranjeno dok u periodu postoje nacrti; (b) dozvoljeno, nacrti
ostaju i moraju se premjestiti u otvoren period. **Preporuka: (a)** — jasnije i bez zaboravljenih nacrta.

**B1-Q7 — Datum knjiženja u budućnosti.** (a) dozvoljen u bilo koji otvoren period; (b) najviše do danas.
**Preporuka: (b)** za ručne naloge (osim početnog stanja, koje ide na datum početka i može biti u budućnosti
dok se priprema).
