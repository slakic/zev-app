# Vanredno prikupljanje sredstava od vlasnika (jednokratni projekti, rate, blagajna) — plan za pregled

**Status: PLAN NA ČEKANJU ODGOVORA KORISNIKA.** Implementacija nije počela i **ne treba da počne** prije odgovora na pitanja P1–P12 (§10) — najmanje četiri od njih (P1, P3, P4, P8) mijenjaju oblik šeme, ne samo UI.

Nastalo na zahtjev korisnika (2026-09-14):

> *"Moze da se ukaze potreba za neko ulaganje gdje je potrebno skupiti odredjena sredstva od stranara mimo standardnih fondova za ulaganje i odrzavanje. Ovo bi trebalo da bude podrzano u aplikaciji tako da jedna osoba (racunovodja) vodi blagajnu i evidentira uplate (gotovina ili putem racuna). Ova funkcionalnost treba da bude podrska za jednokratne finansijske projekte ili izdatke, koji treba da budu podijeljeni na sve ili pojedine vlasnike, te da mogu da budu podijeljeni na rate (mjesecne ili druge)"*

Izrađeno plansko-analitičkim prolazom (Opus, plan-only, bez pisanja koda), zasnovano na čitanju stvarnog koda projekta, ne na pretpostavkama.

## Odluke korisnika

**N/A — još nema odluka.** Ova sekcija se popunjava nakon odgovora na §10, po uzoru na `Plans/user-activity-log-plan.md` (gdje je ekvivalentna sekcija dodata tek nakon odgovora P1–P4).

---

## 0. Rezime — pročitati prije ostatka

Sedam nalaza iz koda oblikuje cijeli plan. Redom po važnosti:

> **(1) „Blagajna" nije nova — već postoji, samo nema svoj prikaz.**

`AccountType` enum ima `CASH` još od početne migracije (`prisma/schema.prisma:766-769`), seed kreira račun tipa `CASH` sa imenom „Blagajna" (`prisma/seed.ts:185`), ekran za kreiranje računa nudi `<option value="CASH">Blagajna</option>` (`src/app/(app)/podesavanja/page.tsx:220`), ručni unos uplate nudi način plaćanja „Blagajna" (`src/app/(app)/fakture/uplate/page.tsx:96`), a početna stranica već sabira „Stanje računa i blagajne" preko `totalCash()` (`src/app/(app)/page.tsx:62`, `finance.ts:41-50`).

**Dakle zahtjev „računovođa vodi blagajnu" je 80% već isporučen.** Nedostaje: (a) odvojen prikaz stanja i prometa blagajne, (b) veza uplate sa konkretnim vanrednim projektom, (c) eventualna priznanica. Nema potrebe za novim `AccountType`-om, novim modelom „blagajna", ni novom putanjom za gotovinu.

> **(2) `Project` model postoji, ali je prazna ljuska sa rashodne strane — nema nijednu vezu ka naplati.**

`model Project` (`prisma/schema.prisma:1235-1244`) ima tačno pet polja: `name`, `description`, `status` (običan `String`, ne enum), `estimatedCost`, `createdAt`. `createProject` je PRESIDENT-only (`plans.ts:212-218`). Koristi se **isključivo kao oznaka na rashodima**: `Expense.projectId`, `FinTransaction.projectId`, `PlanItem.projectId`, i jedan izvještaj `allocationSummary(groupBy: "project")` (`reports.ts:117-142`).

**Prihodna strana ne postoji nigdje.** Ne postoji način da se za projekat kaže „ovo plaćaju vlasnici, ovoliko svako, u toliko rata". To je tačno praznina koju ovaj zahtjev traži. Odnos prema tom modelu je pitanje P7.

> **(3) Sve što vlasnik duguje mora biti `Invoice` — inače ne postoji u aplikaciji.**

`ownerBalance` (`payments.ts:797-819`) računa saldo kao *izdate fakture − alocirane uplate ± korekcije*, i ne gleda nijednu drugu tabelu. Isto važi za `ownerBalanceBreakdown` (`payments.ts:832-874`), `receivablesReport` (`reports.ts:58-86`), `ownerDebtReport` (`reports.ts:153-187`), karticu vlasnika (`documents.ts:274`) i opomenu (`documents.ts:687`).

**Posljedica je odlučujuća:** ako se rata vanrednog projekta modeluje kao bilo šta drugo osim `Invoice`, ona **neće postojati** u saldu vlasnika, u dugovanjima, u kartici, u opomeni, u PDF fakturi, ni u prikazu „Moje fakture" koji vlasnik već ima (`billing.ts:387-402` sam sužava listu na `debtorId = actor.partyId` za vlasnika). Sve to bi se moralo napisati iznova, u paraleli. To je ista klasa greške koju `Plans/user-activity-log-plan.md` §1 odbija za `AuditEvent` (opcija B, „dva izvora istine koja će se vremenom razići").

> **(4) Tri polja koja izgledaju kao da problem već rješavaju — a ne rade ništa.**

- `ChargeItem.frequency` sa vrijednošću `ONE_TIME` (`schema.prisma:860-864, 886`) — **`isItemActiveInPeriod` je nikad ne čita** (`billing.ts:146-154`: provjerava samo `active`, `effectiveFrom`, `effectiveTo`). Jednokratna stavka bi se fakturisala **svakog mjeseca** dok joj ne istekne `effectiveTo`.
- `ChargeItem.dueDayOfMonth` (`schema.prisma:887`) — `issueBatch` hardkodira 15. u mjesecu (`billing.ts:304`: `new Date(Date.UTC(y, m-1, 15))`).
- `Invoice.debtorShare` (`schema.prisma:970`, komentar „co-ownership split of this invoice") — grep kroz `src/` i `prisma/` daje **nula pogodaka** van same deklaracije. Mrtva kolona.

Ovo je bitno jer je prvi instinkt („samo dodaj `ONE_TIME` stavku naknade") upravo taj put — a on danas ne radi, i njegovo popravljanje mijenja ponašanje redovnog mjesečnog fakturisanja za sve postojeće ZEV-ove.

> **(5) DB ograničenje koje diktira oblik rata: jedna izdata serija po periodu.**

`@@unique([zevId, period, status], name: "one_issued_batch_per_period")` (`schema.prisma:948`), plus eksplicitna provjera u `issueBatch` (`billing.ts:294-297`: *„Za period ${batch.period} već postoji izdata serija faktura."*). Ako bi se rata za novembar izdala kao serija sa `period = "2026-11"`, sudarila bi se sa redovnom mjesečnom serijom. **Rate moraju nositi vlastiti prostor imena perioda** (npr. `VS-2026-001-R3`) — vidi §3.

> **(6) Serija faktura iz UI-ja uvijek hvata sve aktivne stavke.**

`createDraftBatch(actor, period, description?, chargeItemIds?)` prima podskup stavki (`billing.ts:256-271`), ali jedini pozivalac u aplikaciji ne prosljeđuje taj argument (`src/app/(app)/fakture/page.tsx:58`: `createDraftBatch(actor, period)`). Znači: postojeći mehanizam **već ima** tehničku mogućnost „serija samo od odabranih stavki", ali ona nikad nije uključena u UI. To je korisno za §3.

> **(7) Postojeći „fond" mehanizam je polu-spojen — ne kopirati ga.**

`reserveFundBalance` (`finance.ts:135-141`) sabira isključivo `FinTransaction` sa `isReserveFund = true`. Ali `enterPayment` kreira prihodnu transakciju **bez** tog flaga (`payments.ts:46-59`), i nijedno mjesto ne prenosi `ChargeItem.isReserveFund` na transakciju koja nastane iz uplate po toj stavci. Praktično: prihod fonda održavanja se puni samo ručnim transakcijama preko `enterTransaction` (`finance.ts:52-84`), gdje računovođa sam čekira polje.

Ako se nov fond radi „preko flaga na transakciji", naslijedio bi tačno taj propust. Ovo je i argument protiv opcije A u §1.

### Preporuka u jednoj rečenici

**Novi, tanki domenski sloj (`FundProject` + `FundProjectShare` + `FundProjectInstallment`) koji ne uvodi novu putanju novca, nego generiše obične `Invoice` redove kroz postojeći tok naplate; blagajna se ne izmišlja nego dobija prikaz nad postojećim `MoneyAccount(type = CASH)`; uplate, alokacije, storno, saldo, kartica, opomena i PDF ostaju netaknuti.**

---

## 1. Nov fond ili prošireni `ChargeItem`?

### Razmotrene opcije

| Opcija | Ocjena |
|---|---|
| **A. Nova stavka naknade (`ChargeItem`) sa `frequency = ONE_TIME` + novi flag `isSpecialFund`** | **Odbačeno.** `frequency` se nikad ne čita (§0.4) — stavka bi se fakturisala svakog mjeseca. Popravka `isItemActiveInPeriod` mijenja ponašanje redovnog fakturisanja za sve. Nema mjesta za rate, za ukupan cilj prikupljanja, ni za status projekta. Flag za fond bi naslijedio propust iz §0.7. |
| **B. Sve preko postojećeg `Project` modela, prošireno poljima za naplatu** | **Djelimično.** Ime je pravo, ali `Project` je danas oznaka na rashodima (`Expense.projectId`, `FinTransaction.projectId`) — dodavanje kompletne naplatne mašinerije na njega miješa dva različita životna ciklusa (rashod traje dok se ne plati izvođač; naplata traje dok posljednja rata ne bude uplaćena). Ipak: veza između to dvoje **jeste** potrebna — vidi preporuku i P7. |
| **C. Nov entitet „vanredno prikupljanje" koji generiše `Invoice`** ✅ | **Preporučeno.** Jedan novi životni ciklus, nula novih putanja novca. Sve što je već napisano za fakture (saldo, dugovanja, kartica, opomena, PDF, prikaz vlasniku, storno, korekcija) radi bez ijedne izmjene. |
| **D. Potpuno odvojen „ledger" (sopstvena zaduženja i uplate mimo `Invoice`/`Payment`)** | **Odbačeno.** Duplira `Payment`, `PaymentAllocation`, saldo, storno — i to na append-only dijelu sistema koji je namjerno zaštićen DB trigerima (`prisma/migrations/20260823180200_append_only_guards/migration.sql`). Dva salda za istog vlasnika je najgori mogući ishod. |

### Preporuka: opcija C, sa izričitim „ovo nije novi fond u knjigovodstvenom smislu"

Model se zove **`FundProject`** (u UI: „Vanredno prikupljanje" / „Vanredni projekat"), i on je **definicija kampanje naplate**, ne konto. Njegov odnos prema postojećim fondovima:

- **Prema fondu održavanja** (`ChargeItem.isReserveFund` / `FinTransaction.isReserveFund`, `finance.ts:135-141`): potpuno odvojen. Vanredni projekat **nikad** ne postavlja `isReserveFund` — tako i treba, jer korisnik izričito kaže „mimo standardnih fondova". Ovo znači i da se `reserveFundBalance` ne mijenja ni za cifru, što je poželjno (izvještaj fonda ostaje uporediv kroz vrijeme).
- **Prema izvještajnom sloju:** prihod od rata ulazi u `cashFlowReport` i `incomeExpenseReport` kao i svaka druga uplata (jer je `Payment` → `FinTransaction`), a otvorena potraživanja u `receivablesReport` (jer su `Invoice`). **Bez ijedne izmjene tih funkcija.** Jedino što treba dodati je *izdvojen* prikaz po projektu (§7) — a taj obrazac već postoji na rashodnoj strani (`allocationSummary(groupBy: "project")`, `reports.ts:117-142`).
- **Prema `Project` modelu:** `FundProject.projectId String?` — opciona veza na postojeći `Project`, tako da se na jednom mjestu vidi „prikupljeno od vlasnika X KM, potrošeno na izvođače Y KM". Rashodna strana ostaje gdje jeste. Ovo je predmet P7.

### Posljedica po izvještaje — provjereno, ne pretpostavljeno

| Izvještaj / prikaz | Radi bez izmjene? | Zašto |
|---|---|---|
| `ownerBalance` / kartica vlasnika (`payments.ts:797`, `documents.ts:274`) | ✅ da | rata je `Invoice` sa `status = ISSUED` |
| `receivablesReport` + starosna struktura (`reports.ts:58-86`) | ✅ da | isto |
| `ownerDebtReport` „Dugovanja po vlasnicima" (`reports.ts:153-187`) | ✅ da | isto |
| Opomena PDF (`documents.ts:687`) | ✅ da | isto |
| Faktura PDF (`documents.ts:202`) | ✅ da | `InvoiceLine.chargeItemId` je već opciono (`schema.prisma:999-1000`) i `issueSingleInvoice` već kreira liniju bez njega (`billing.ts:371-378`) |
| Prikaz „Moje fakture" vlasniku (`billing.ts:387-402`) | ✅ da | filter po `debtorId` |
| `cashFlowReport` / `incomeExpenseReport` (`reports.ts:15, 40`) | ✅ da | preko `Payment` → `FinTransaction` |
| `reserveFundBalance` (`finance.ts:135`) | ✅ nepromijenjen | namjerno — vanredna sredstva nisu fond održavanja |
| Status naplate po projektu (ko je platio, koliko rata) | ❌ **novo** | §7 |
| Stanje i promet blagajne kao poseban prikaz | ❌ **novo** (tanko) | §4 |

---

## 2. Raspodjela na „sve ili pojedine vlasnike"

### Šta u kodu već postoji za sužavanje kruga obveznika

Tri odvojena mehanizma, svaki sa svojim ograničenjem:

1. **`ScopeType`** (`schema.prisma:471-477`: `ZEV | BUILDING | ENTRANCE | UNITS | GROUP`) + `unitsInScope()` (`property.ts:224-251`). Već ga dijele `ChargeItem`, `Proposal`, `PlanItem`. Pokriva „cijeli ZEV", „jedna zgrada", „jedan ulaz", „imenovan skup jedinica", „grupa".
2. **`AllocationGroup` / `AllocationGroupMember`** (`schema.prisma:423-444`) — imenovana, **višekratna** grupa jedinica sa ponderom po jedinici. Kreira se preko `createAllocationGroup` (`property.ts:174-196`).
3. **`ChargeUnitOverride`** (`schema.prisma:902-913`) — po jedinici: `exempt`, `customWeight`, `manualAmount`.

Jedan kvirk koji treba znati: kad je `scopeType = UNITS`, `previewBatch` izvlači listu jedinica **iz tabele izuzetaka**, ne iz zasebne scope tabele (`billing.ts:179`: `unitIds: item.scopeType === "UNITS" ? item.unitOverrides.map(o => o.unitId) : undefined`). `ChargeUnitOverride` tu duplo služi kao „lista obuhvaćenih" i kao „lista izuzetaka" — radi, ali nije obrazac koji vrijedi kopirati u nov model.

### Razmotrene opcije

| Opcija | Ocjena |
|---|---|
| **A. Samo `ScopeType` + `AllocationGroup`, bez nove tabele** | Nedovoljno. Pokriva „ko je obuhvaćen", ali ne pamti **koliko je kome obračunato** u trenutku pokretanja projekta. Kad se za šest mjeseci promijeni vlasnik jedinice ili pondera u grupi, iznos rate više nije rekonstruktivan. Grupa je k tome višekratna — mijenjanje grupe zbog projekta B tiho bi promijenilo projekat A. |
| **B. Reuse `ChargeUnitOverride` obrasca (jedna tabela za scope i izuzetke)** | Odbačeno. Nasljeđuje dvojnu ulogu iz `billing.ts:179`, i vezan je za `ChargeItem` (`onDelete: Cascade`), koji ovdje ne postoji. |
| **C. Nov `FundProjectShare` — zamrznut snapshot po obvezniku** ✅ | **Preporučeno.** `ScopeType` + metoda raspodjele služe kao *ulaz* za izračun; rezultat se materijalizuje u redove `FundProjectShare` u trenutku aktivacije projekta. |

### Preporuka: `FundProjectShare` kao zamrznut snapshot — presedan postoji u kodu

Ovo nije nov obrazac u ovoj bazi koda, nego treći put da se isti primjenjuje:

- `Proposal.ruleSnapshot` — *„Frozen snapshot of quorum/majority/weight rules + eligible base, taken when voting opens"* (`schema.prisma:629-630`);
- `EligibleVoter` — *„Snapshot of who may vote on a proposal, with what weight, frozen at voting open"* (`schema.prisma:656-673`), sa `weight Decimal` i `basis Json`;
- `InvoiceLine.calcSnapshot` — *„method, formula, inputs, allocation basis, rounding"* (`schema.prisma:1002`), koji `previewBatch`/`calculateCharge` popunjavaju (`engines/billing.ts:155-169`).

`FundProjectShare` je za novac ono što je `EligibleVoter` za glasanje. Pseudo-šema:

```prisma
model FundProjectShare {
  id            String      @id @default(cuid())
  zev           Zev         @relation(fields: [zevId], references: [id])
  zevId         String
  project       FundProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId     String
  unit          Unit        @relation(fields: [unitId], references: [id])
  unitId        String
  /// Obveznik na dan aktivacije — snapshot, kao Invoice.debtorId ("legally responsible
  /// owner at issue time", schema.prisma:968-969). Naknadna promjena vlasnika ne mijenja
  /// ovaj red (LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §5.4).
  debtor        Party       @relation(fields: [debtorId], references: [id])
  debtorId      String
  weight        Decimal     @db.Decimal(12, 6)   // ponder po izabranoj metodi
  amount        Decimal     @db.Decimal(14, 2)   // ukupan teret ovog obveznika za cijeli projekat
  calcSnapshot  Json        // metoda, formula, ulazi, osnovica, zaokruživanje — isto kao InvoiceLine
  manualAmount  Decimal?    @db.Decimal(14, 2)   // ručna korekcija (P3)
  exemptReason  String?
  createdAt     DateTime    @default(now())

  @@unique([projectId, unitId, debtorId])
  @@index([debtorId])
}
```

Metoda raspodjele: **ponovo iskoristiti postojeći `ChargeMethod` enum** (`schema.prisma:848-858`) i **postojeći `calculateCharge` engine** (`engines/billing.ts:50-179`), ne pisati drugi izračun. Devet metoda pokriva sve što je traženo:

| Zahtjev korisnika | Postojeća metoda |
|---|---|
| „podijeljeno na sve vlasnike jednako" | `EQUAL_SPLIT` (`engines/billing.ts:102-110`) |
| „po vlasničkom udjelu" | `PER_OWNERSHIP_SHARE` (88-94) |
| „po kvadraturi" | `PER_AREA` (81-87) |
| „fiksan iznos po jedinici" | `FIXED_PER_UNIT` (75-80) |
| „neko plaća duplo (inicijator)" | `CUSTOM_WEIGHTS` (131-140) ili `MANUAL` (141-147) |

Jedina stvarna nova logika je **usklađivanje ostatka pri zaokruživanju** (§3, P8) — postojeći engine to izričito ne radi (`engines/billing.ts:172-174`: *„Distribution methods can differ from the nominal total by rounding cents"*).

Za „pojedine vlasnike": `FundProject.scopeType` + `unitsInScope()` daju ulazni skup; UI za `scopeType = UNITS` treba **pravu listu izabranih jedinica**, ne `ChargeUnitOverride` trik iz `billing.ts:179` — u ovom modelu to su prosto redovi `FundProjectShare` koji nastanu.

---

## 3. Rate (mjesečne ili druge)

### Razmotrene opcije

| Opcija | Ocjena |
|---|---|
| **A. Jedna faktura za cijeli iznos, „rate" samo kao rok plaćanja u napomeni** | Odbačeno. Djelimična uplata bi ostavljala fakturu u statusu `ISSUED` do kraja (`refreshInvoiceStatus`, `payments.ts:632-638` prebacuje u `PAID` tek kad je alocirano ≥ ukupno), pa bi vlasnik koji uredno plaća rate mjesecima figurirao kao dužnik u `receivablesReport` sa punim iznosom i danima kašnjenja od prvog dana. Aktivno štetno. |
| **B. Nov `FundInstallment` model kao *zaduženje* mimo `Invoice`** | Odbačeno — vidi §0.3. Rata koja nije `Invoice` ne postoji u saldu, kartici, opomeni, PDF-u i prikazu vlasniku. |
| **C. Svaka rata = `InvoiceBatch` + po jedna `Invoice` po obvezniku** ✅ | **Preporučeno.** Uz jedan tanki model `FundProjectInstallment` koji čuva *raspored* (ordinal, dospijeće, status), a stvarni novac generiše kroz postojeći `issueBatch` obrazac. |
| **D. Rata = jedna `Invoice` po obvezniku bez serije (`issueSingleInvoice`, `billing.ts:350`)** | Radi tehnički, ali gubi grupno izdavanje, grupni storno i „pregled prije izdavanja" koji serija ima (`previewData Json`, `schema.prisma:942`). Serija je bolja jer je rata po prirodi grupni čin. |

### Preporuka: `FundProjectInstallment` kao raspored, `InvoiceBatch` kao izdavanje

```prisma
model FundProjectInstallment {
  id           String      @id @default(cuid())
  zev          Zev         @relation(fields: [zevId], references: [id])
  zevId        String
  project      FundProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId    String
  ordinal      Int                     // 1..N
  label        String                  // "Rata 3/6" (prikaz) — vidi periodLabel ispod
  dueDate      DateTime
  /// Udio ove rate u ukupnom teretu obveznika. Suma svih rata projekta = 1.000000
  /// (validirano pri kreiranju rasporeda). Omogućava i neravnomjerne rate
  /// (npr. 50% avans + 5×10%) bez posebnog modela.
  fraction     Decimal     @db.Decimal(9, 6)
  status       String      @default("PLANNED")   // PLANNED | ISSUED | CANCELLED
  issuedAt     DateTime?
  batchId      String?     @unique                // InvoiceBatch izdat za ovu ratu
  createdAt    DateTime    @default(now())

  @@unique([projectId, ordinal])
}
```

**Ključni detalj — prostor imena perioda.** Zbog `@@unique([zevId, period, status])` na `InvoiceBatch` (`schema.prisma:948`) i provjere u `issueBatch` (`billing.ts:294-297`), serija rate **ne smije** koristiti `period = "2026-11"`. Predlog konvencije:

```
InvoiceBatch.period      = `${project.code}-R${ordinal}`      npr. "VS-2026-001-R3"
Invoice.periodLabel      = `${project.name} — rata ${ordinal}/${n}`
Invoice.paymentReference = `${project.code}-R${ordinal}-${unitId.slice(-6).toUpperCase()}`
```
Posljednji red prati obrazac koji `issueBatch` već koristi (`billing.ts:323`) — bitno je da ostane **jedinstven po rati i jedinici**, jer `scoreInvoiceMatch` daje 100 poena za pogodak poziva na broj (`payments.ts:548-550`); time se automatsko uparivanje uplata za rate dobija besplatno.

**Kako se rata izdaje.** Nova servisna funkcija `issueInstallment(actor, installmentId, opts)` radi isto što i `issueBatch` (`billing.ts:288-347`), ali umjesto `previewData` iz stavki naknade koristi `FundProjectShare × installment.fraction`:

```
za svaki share:
  iznos_rate = round(share.amount × installment.fraction, project.rounding)
  → Invoice { unitId: share.unitId, debtorId: share.debtorId, total: iznos_rate,
              dueDate: installment.dueDate, periodLabel, paymentReference,
              lines: [ { chargeItemId: null, description, calcSnapshot, amount } ] }
```

`InvoiceLine.chargeItemId` je opciono i `issueSingleInvoice` već kreira takvu liniju sa ručno sastavljenim `calcSnapshot`-om (`billing.ts:371-378`) — presedan postoji, ne izmišlja se ništa.

**„Mjesečne ili druge".** `dueDate` po rati je slobodan datum, pa raspored ne mora biti mjesečni; UI nudi pomoćnik („N rata, počev od datuma, na svakih M mjeseci") koji samo predpopuni datume. Ne treba `recurrenceRule` string (postoji na `Expense`, `schema.prisma:1147`, i nikad se ne parsira nigdje).

### Zaokruživanje i ostatak — mora biti izričita odluka (P8)

`clampMoney`/`roundMoney` se primjenjuju po redu (`engines/billing.ts:150-151`), a `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §5.5` izričito kaže: *„zbir fakture = zbir zaokruženih stavki (bez naknadnog poravnanja razlike)"*. Za redovnu mjesečnu naknadu to je bezopasno. Za vanredno prikupljanje **nije**: ako se prikuplja tačno 12.000,00 KM za fasadu, a zbir zaokruženih udjela da 11.999,94 KM, projekat po definiciji ne može biti zatvoren kao naplaćen.

Dvije razine ostatka, obje moraju biti riješene:
1. **Ostatak raspodjele** (zbir `share.amount` ≠ `targetAmount`);
2. **Ostatak rata** (zbir rata jednog obveznika ≠ njegov `share.amount`, npr. 100,00 / 3).

Preporuka: metoda **najvećih ostataka** (largest remainder) na oba nivoa — razlika u centima se dodjeljuje redom obveznicima/ratama sa najvećim odbačenim ostatkom, i to se **zapisuje u `calcSnapshot`** (`{ adjustment: "+0.01", reason: "poravnanje ostatka" }`) da bude vidljivo na fakturi. Ovo je **odstupanje od §5.5** i zato traži izričitu potvrdu — P8.

---

## 4. Gotovina i blagajna

### Šta postoji danas — provjereno

- `AccountType { BANK, CASH }` (`schema.prisma:766-769`), `MoneyAccount.type` (`schema.prisma:774`).
- `Payment.method` — običan `String?` sa komentarom `// BANK | CASH` (`schema.prisma:1041`); `enterPayment` ga postavlja iz forme sa fallbackom `"BANK"` (`payments.ts:41`).
- `FinTransaction.paymentMethod` — isti string, drugi red (`schema.prisma:824`).
- `accountBalance(actor, accountId, asOf?)` (`finance.ts:24-39`) i `totalCash` (`finance.ts:41-50`) rade nad bilo kojim tipom računa.
- `cashFlowReport` (`reports.ts:15-37`) već daje red po računu — dakle blagajna **već ima** svoj red u izvještaju toka gotovine.

### Nalazi i preporuke

**(a) Nema potrebe za novim `AccountType`-om.** `CASH` postoji i koristi se. Preporuka: **nijedna izmjena enuma**.

**(b) Postoji nedosljednost koju treba svjesno ostaviti ili počistiti.** Danas su `MoneyAccount.type` (`BANK`/`CASH`), `Payment.method` (`"BANK"`/`"CASH"`, slobodan string) i `FinTransaction.paymentMethod` (isto) tri odvojena polja koja mogu protivrječiti: ništa ne sprječava uplatu sa `method = "CASH"` na račun tipa `BANK`. Preporuka: **jedna validacija u `enterPayment`** (ako `account.type === "CASH"`, `method` mora biti `CASH`, i obrnuto) — dvije linije, bez migracije. Uvođenje enuma umjesto stringa bi bila migracija sa backfill-om za marginalnu korist.

**(c) Blagajna zaslužuje prikaz, ne model.** Novi ekran (§7) koji za svaki `MoneyAccount(type = CASH)` prikazuje: početno stanje, promet u periodu, trenutno stanje (`accountBalance`), i listu transakcija (`listTransactions(actor, { accountId, from, to })`, `finance.ts:104-121`). **Sve tri funkcije već postoje** i već su gated na `PRESIDENT, ACCOUNTANT`. Kome je vidljiv — P5.

**(d) Gotovinska uplata za ratu ne traži ništa novo.** Računovođa unese uplatu preko postojećeg „Ručni unos uplate" (`fakture/uplate/page.tsx:75-99`), izabere račun „Blagajna", način „Blagajna", i uparuje na fakturu rate preko `allocatePayment` (`payments.ts:645-687`) — uz automatski prijedlog iz `suggestMatches` (`payments.ts:597-611`) koji će zbog poziva na broj (§3) pogoditi u prvom pokušaju. **Nijedna izmjena `payments.ts` nije potrebna za osnovni tok.**

**(e) Šta *jeste* korisno dodati:** filter „prikaži samo otvorene rate projekta X" na ekranu uparivanja i dugme „evidentiraj uplatu za ovu ratu" sa detaljne stranice projekta — čista UI olakšica koja zove postojeće funkcije.

**(f) Priznanica za gotovinu (P6).** `DocumentType` enum (`schema.prisma:1372-1393`) **nema** tip za priznanicu/uplatnicu. Ako se traži, treba: novu vrijednost enuma (`CASH_RECEIPT`) + prefiks u `nextDocNumber` (`documents.ts:78-86`, npr. `"PRIZ"`) + `generateCashReceiptPdf` po uzoru na `generateInvoicePdf` (`documents.ts:202-273`) + `storeDocument` (`documents.ts:93-148`) koji već radi verzionisanje i sha256. Migracija je potrebna samo zbog enuma.

---

## 5. Revizorski trag — novi kodovi akcija i njihova klasifikacija

Sistem klasifikacije iz `Plans/user-activity-log-plan.md` (isporučeno kroz v2.6.0–v2.7.0) zahtijeva da **svaki** `action: "..."` literal bude klasifikovan u `ACTION_CATEGORY` (`src/lib/activity/catalog.ts:31-151`), inače pada `tests/activity-catalog.test.ts` (statički skener izvora). Nova akcija se dodaje **u istoj izmjeni** koja je uvodi.

### Predloženi kodovi

| Kod | Kategorija | Obrazloženje po postojećem obrascu |
|---|---|---|
| `fund_project.create` | **GOVERNANCE** | Odluka o vanrednom teretu za vlasnike je upravljački čin od legitimnog interesa vlasnicima — isti razlog zbog kojeg su `plan.create`/`plan.propose`/`plan.approve` GOVERNANCE (`catalog.ts:56-59`), a ne FINANCE. |
| `fund_project.update` | GOVERNANCE | isto |
| `fund_project.activate` | GOVERNANCE | zamrzavanje raspodjele = tačka bez povratka, analogno `plan.approve` |
| `fund_project.cancel` | GOVERNANCE | isto |
| `fund_project.close` | GOVERNANCE | isto |
| `fund_project.share.override` | **FINANCE** | pojedinačna korekcija iznosa, analogno `charge_item.update` (`catalog.ts:87`) |
| `fund_project.installment.plan` | FINANCE | raspored rata, analogno `invoice_batch.create_draft` (`catalog.ts:97`) |
| `fund_project.installment.issue` | FINANCE | analogno `invoice_batch.issue` (`catalog.ts:98`) |
| `fund_project.installment.cancel` | FINANCE | analogno `invoice.cancel` (`catalog.ts:94`) |

**Namjerno se NE uvode novi kodovi za uplate.** Evidentiranje uplate ostaje `payment.enter` / `payment.allocate` / `payment.allocation.reverse` / `payment.reverse` (`catalog.ts:100-105`), jer je to bukvalno ista funkcija. Uvođenje `fund_project.contribution.enter` bi značilo drugu putanju upisa za istu stvar — tačno ono što §0.3 i opcija D u §1 odbijaju.

### i18n

Nova ugniježđena grana u `src/lib/i18n/sr-Latn.ts` (i `en.ts`), po obrascu iz `Plans/user-activity-log-plan.md` §4 (**ravan ključ sa tačkama se nikad ne razriješi** — `tEnum` hoda kroz ugniježđeni objekat):

```
auditAction: {
  fund_project: {
    create: "Kreirano vanredno prikupljanje sredstava",
    activate: "Pokrenuto prikupljanje (raspodjela zamrznuta)",
    cancel: "Otkazano prikupljanje",
    close: "Zatvoreno prikupljanje",
    share: { override: "Ručno korigovan udio vlasnika" },
    installment: { plan: "Definisan raspored rata", issue: "Izdata rata", cancel: "Stornirana rata" },
  },
}
```
Plus `fundProjectStatus` grupa za `tEnum` (kao postojeće `planStatus`, `invoiceStatus`).

Opciono: `summarize()` (`catalog.ts:213-227`) za `fund_project.installment.issue` → *„Rata 3/6 — 27 faktura, 4.500,00 KM"*. Nikad `JSON.stringify(after)` (`Plans/user-activity-log-plan.md` §6c).

---

## 6. Append-only invarijante

### Šta je danas zaštićeno DB trigerom

`prisma/migrations/20260823180200_append_only_guards/migration.sql` postavlja `forbid_update_delete()` na tačno tri tabele: `AuditEvent`, `Vote`, `PaymentAllocation`. `PERMISSION_MATRIX.md` (posljednji pasus) to navodi kao globalnu zabranu bez obzira na ulogu.

### Preporuka: **ne dodavati nov triger** — i to je namjerna odluka, ne propust

Razlog: nova tri modela nisu ledger. **Stvarni ledger vanrednog prikupljanja je `PaymentAllocation`, koji je već zaštićen.** `FundProject`/`FundProjectShare`/`FundProjectInstallment` su *definicija i raspored* — ekvivalent `AnnualPlan`/`PlanItem` (koji nemaju triger) i `ChargeItem` (koji ga takođe nema), ne ekvivalent `Payment`/`Vote`.

Umjesto trigera, isti stepen zaštite se postiže **postojećim obrascima ovog projekta**:

| Invarijanta | Mehanizam | Presedan u kodu |
|---|---|---|
| Raspodjela se ne mijenja tiho nakon pokretanja | `status = ACTIVE` zaključava `FundProjectShare`; izmjena traži izričitu, auditovanu korekciju sa razlogom | `addPlanItem` odbija izmjenu APPROVED plana (`plans.ts:108-110`); `updateExpense` traži razlog za plaćen trošak (`expenses.ts:111-113`) |
| Izdata rata se ne briše | storno rate = storno svake njene fakture kroz postojeći `cancelInvoice` (`billing.ts:426-445`), original ostaje vidljiv | `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §5.6` |
| Rata sa uplatama se ne može stornirati | već je nemoguće: `cancelInvoice` odbija fakturu sa alociranim uplatama (`billing.ts:434`) | isto |
| Ispravka iznosa nakon izdavanja | `correctInvoice` (`billing.ts:451-500`) — korektivna faktura vezana na original | isto |
| Trag svake promjene | `audit()` sa `before`/`after` i obaveznim `reason` na destruktivnim radnjama | cijeli servisni sloj |

**Jedna stvar koju triger *ne bi* riješio, a mora se riješiti kodom:** raspodjela mora biti zamrznuta u trenutku aktivacije, a ne računata iznova pri svakom izdavanju rate. Ako bi se `share.amount` računao „na zahtjev", promjena vlasničkog udjela ili kvadrature u martu bi retroaktivno promijenila iznos februarske rate. Zato `FundProjectShare` postoji kao materijalizovan red sa `calcSnapshot`-om (§2), a ne kao izračun.

**Bezbjedna migracija:** dodavanje novih tabela i nullable kolona ne dira postojeće trigere (`Plans/user-activity-log-plan.md` §3: *„append-only triger se aktivira samo na `UPDATE`/`DELETE`, ne na `ALTER TABLE ADD COLUMN`"*).

---

## 7. Izvještavanje i transparentnost

### Šta treba, a ne postoji

Jedan prikaz: **status naplate po projektu** — ukupno planirano, ukupno zaduženo (izdate rate), ukupno naplaćeno, otvoreno, po obvezniku: koliko rata izdato / plaćeno / u kašnjenju.

Najbliži uzor u kodu je `receivablesReport` (`reports.ts:58-86`): uzme fakture, sabere alokacije, izračuna otvoreno i dane kašnjenja, svrsta u starosne korpe. **Za projekat je to isti upit sa jednim dodatnim filterom** — pod uslovom da postoji način da se faktura veže na projekat.

**Otvoreno pitanje veze faktura → projekat.** Dvije mogućnosti:
- (i) `Invoice.fundProjectInstallmentId String?` — nova nullable kolona, direktna i indeksirana;
- (ii) preko `Invoice.batchId → FundProjectInstallment.batchId`.

**Preporuka: (i).** Razlog: `Invoice.batchId` je opciono (`schema.prisma:964`), a rata izdata pojedinačno (npr. dodatna faktura za jednog obveznika koji se naknadno pridružio) ne bi imala seriju. Nullable kolona sa indeksom je jeftinija od dvostrukog join-a u svakom izvještaju, i bezbjedna za migraciju.

### Predloženi ekrani

| Ekran | Ruta | Guard | Napomena |
|---|---|---|---|
| Lista vanrednih prikupljanja | `/fakture/projekti` | `requireAnyUser` (sadržaj zavisi od P2) | Podruta `/fakture`, ne nov stavka u meniju — `NAV` u `src/app/(app)/layout.tsx:26-38` već ima 12 stavki |
| Detalj projekta | `/fakture/projekti/[id]` | isto | raspodjela, raspored rata, status naplate po obvezniku, veza na `Project` |
| Blagajna | `/fakture/blagajna` | `PRESIDENT, ACCOUNTANT` (P5) | stanje + promet CASH računa; koristi `accountBalance`/`listTransactions` |
| Vlasnikov pogled | **nijedan nov** | — | rate se već pojavljuju na `/fakture` (`listInvoices` sam sužava na `debtorId`, `billing.ts:387-402`) i u kartici vlasnika |

Za PDF: `generateFundProjectReportPdf` po uzoru na `generateOwnerDebtReportPdf` (`documents.ts:940`), koristeći postojeće `pdfSection`/`pdfTable` pomoćnike (`documents.ts:756-800`). CSV: `toCsv` (`reports.ts:191-202`) + ruta po uzoru na `src/app/api/izvjestaji/csv/route.ts`.

---

## 8. Pristup i guard-ovi

### Ko šta smije — preporuka

Zahtjev korisnika izričito razdvaja dvije uloge: *„jedna osoba (računovođa) vodi blagajnu i evidentira uplate"*. Postojeća matrica (`PERMISSION_MATRIX.md`) taj rez već pravi: izdavanje faktura i uplate su ACCOUNTANT-only, dok su planovi i odluke PRESIDENT-only.

| Radnja | P | R | V | Guard | Uzor u kodu |
|---|---|---|---|---|---|
| Kreiranje/izmjena vanrednog prikupljanja (nacrt) | ✔ | – | – | `requireRole(actor, "PRESIDENT")` | `createPlan` (`plans.ts:30`), `createProject` (`plans.ts:213`) |
| Pregled obračuna raspodjele prije aktivacije | ✔ | ✔ | – | `requireRole(actor, "PRESIDENT", "ACCOUNTANT")` | `previewBatch` (`billing.ts:161`) |
| Aktivacija (zamrzavanje raspodjele) | ✔ | – | – | `requireRole(actor, "PRESIDENT")` | `approvePlan` (`plans.ts:141`) |
| Definisanje/izmjena rasporeda rata | ✔ | ✔ | – | `requireRole(actor, "PRESIDENT", "ACCOUNTANT")` | `createChargeItem` (`billing.ts:47`) |
| **Izdavanje rate (fakture)** | – | ✔ | – | `requireRole(actor, "ACCOUNTANT")` | `issueBatch` (`billing.ts:289`) — **isti rez kao redovno fakturisanje** |
| **Evidentiranje uplate (gotovina/račun), uparivanje, storno** | – | ✔ | – | `requireRole(actor, "ACCOUNTANT")` | `enterPayment` (`payments.ts:26`), `allocatePayment` (`payments.ts:649`) |
| Ručna korekcija udjela vlasnika | ✔ | ✔ | – | `requireRole(actor, "PRESIDENT", "ACCOUNTANT")` | `addBalanceCorrection` (`payments.ts:897`) — uz obavezan razlog |
| Storno rate | – | ✔ | – | `requireRole(actor, "ACCOUNTANT")` | `cancelInvoice` (`billing.ts:427`) |
| Pregled statusa naplate po projektu | ✔ | ✔ | ? (P2) | vidi P2 | — |
| Pregled blagajne (stanje + promet) | ✔ | ✔ | ✘ | `requireRole(actor, "PRESIDENT", "ACCOUNTANT")` | `accountBalance` (`finance.ts:26`) — P5 |
| Vlasnik vidi svoje rate | ✔ | ✔ | ✔ (svoje) | `requireSelfOrRole` | `getInvoice` (`billing.ts:417`) |

Svaka funkcija poziva `requireZev(actor)` i filtrira/štampa `zevId` — bez izuzetka (`docs/multitenancy-plan.md` §4.4, `guards.ts:79-83`). Svaki strani ključ koji dolazi iz ulaza (`unitId`, `partyId`, `projectId`, `accountId`) mora se provjeriti sa `findUniqueOrThrow({ where: { id, zevId } })` prije upisa — obrazac koji `createExpense` sprovodi na sedam FK-ova (`expenses.ts:82-89`).

`PERMISSION_MATRIX.md` dobija novu sekciju **„Vanredna sredstva"** sa gornjim redovima.

---

## 9. Šta ovaj plan namjerno NE radi

1. **Ne uvodi pozadinske poslove.** `Plans/gmail-bank-statement-ingestion-plan.md` §0(5) je provjerio i utvrdio: grep za `setInterval`, `cron`, `bullmq`, `instrumentation` u `src/` daje **nula pogodaka**. Podsjetnik za neplaćenu ratu je zato **dugme**, ne tajmer (P9).
2. **Ne računa zateznu kamatu.** `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §3.5` — nije implementirano nigdje i ostaje tako.
3. **Ne obračunava PDV** (§5.8 istog dokumenta).
4. **Ne uvodi dvojno knjigovodstvo** (§5.2).
5. **Ne dira `reserveFundBalance`** ni tumačenje fonda održavanja (§5.7).
6. **Ne popravlja `ChargeItem.frequency`/`dueDayOfMonth`** (§0.4) — to su odvojeni bagovi redovnog fakturisanja; treba ih prijaviti zasebno, ne miješati u ovaj poduhvat.
7. **Ne oživljava `Invoice.debtorShare`** (§0.4) — suvlasništvo na jednoj rati rješava se isto kao danas na redovnoj fakturi (jedan obveznik po jedinici, `billing.ts:242-249`).

### Preklapanje sa postojećim planovima — provjereno

| Plan | Preklapanje |
|---|---|
| `Plans/gmail-bank-statement-ingestion-plan.md` | **Nema sukoba, ima koristi.** Uplata za ratu koja stigne preko izvoda uparuje se istim `scoreInvoiceMatch`-om (`payments.ts:541-572`); jasan poziv na broj po rati (§3) direktno poboljšava taj plan. Tvrdo pravilo tog plana („nikad automatski upis uplate") ovdje se ne dira. |
| `Plans/owner-cross-tenant-party-user-plan.md` | **Nema sukoba.** `FundProjectShare.debtorId` pokazuje na `Party` (tenant-scoped), ne na `User`. Okretanje veze `User`↔`Party` ne mijenja ništa ovdje. |
| `Plans/tenant-switching-admin-accounts-plan.md` | Nema preklapanja. |
| `Plans/user-activity-log-plan.md` | **Direktna obaveza:** novi kodovi akcija moraju u `catalog.ts` u istoj izmjeni (§5), inače pada `tests/activity-catalog.test.ts`. |
| `docs/multitenancy-plan.md` | Obaveza: `zevId` + `@relation` na sva tri nova modela, `requireZev` na svakoj funkciji, i novi redovi u `tests/tenant-isolation.test.ts` (`import * as fundProjects` u listu servisa na vrhu tog fajla). |

Napomena o paketima: `ZevTier.BASIC_FINANCE` postoji (`schema.prisma:126-130`), ali grep pokazuje da **ništa u aplikaciji ne gejtuje funkcionalnost po tieru** — tier se samo prikazuje na `/admin`. Dakle nema posla oko gejtovanja; ako se ikad uvede, ova funkcionalnost pripada `BASIC_FINANCE`.

---

## 10. Pitanja za korisnika prije implementacije

- **P1. Poznat iznos unaprijed ili akumulacija troškova?** Da li se projekat kreira sa unaprijed poznatim ukupnim iznosom koji se dijeli (npr. „prikupljamo 12.000 KM za fasadu"), ili se troškovi akumuliraju kroz `Expense` pa se naknadno raspodjeljuju? Utiče na to da li je `targetAmount` obavezan i da li je potreban tok „preračunaj raspodjelu na osnovu stvarnih troškova" (koji bi tražio korektivne fakture za već izdate rate). Moguć i treći odgovor: **oba** — plaća se po procjeni, a na kraju se radi konačni obračun i razlika vraća/dodatno naplaćuje (vidi P11).
- **P2. Vidljivost vlasniku koji NIJE obuhvaćen.** Da li vlasnik izvan obuhvata treba uopšte da vidi da projekat postoji (transparentnost), ili je projekat vidljiv samo obuhvaćenima + upravi (privatnost)? Utiče na guard liste `/fakture/projekti`. Podsjećanje: vlasnik ionako vidi samo svoje fakture (`billing.ts:387-402`), pa se pitanje odnosi isključivo na listu i status naplate.
- **P3. Osnovica raspodjele i ručne korekcije.** (a) Raspodjela ide po jedinici (`Unit`) ili po vlasničkom udjelu (`OwnershipStake.sharePercent`)? (b) Treba li podržati ručnu korekciju iznosa za pojedinca („inicijator plaća duplo", „ovaj je izuzet")? (c) Ako jedinicu drži više suvlasnika, ide li cijela rata na glavnog vlasnika kao danas (`billing.ts:242-249`), ili se dijeli po udjelu (traži oživljavanje mrtvog `Invoice.debtorShare`, §0.4)?
- **P4. Izmjena rasporeda/raspodjele nakon pokretanja.** Treba li podržati promjenu broja rata ili iznosa nakon što je projekat aktivan? Ako da: šta se dešava sa **već izdatim i plaćenim** ratama — (i) ostaju netaknute i mijenjaju se samo buduće, (ii) radi se korektivna faktura (`correctInvoice`, `billing.ts:451`), ili (iii) projekat se zatvara i otvara nov? Preporuka plana je (i) sa (ii) kao izuzetkom uz obavezan razlog.
- **P5. Prikaz blagajne — obim i pristup.** Treba li blagajna svoj odvojen prikaz stanja/prometa (preporuka: da, tanko), i ko mu pristupa: samo računovođa, ili i predsjednik (preporuka: oba, kao svi ostali finansijski prikazi)? Da li vlasnici treba da vide agregatno stanje blagajne?
- **P6. Priznanica za gotovinsku uplatu.** Treba li PDF priznanica po uplati u gotovini? Ako da — traži novu vrijednost u `DocumentType` enumu i migraciju (§4f). Da li se izdaje automatski pri unosu ili na zahtjev?
- **P7. Odnos prema postojećem `Project` modelu.** U aplikaciji već postoji `Project` (`schema.prisma:1235`, `plans.ts:207-218`), ali samo kao oznaka na rashodima. Da li: (a) novo vanredno prikupljanje se **veže** na postojeći `Project` opcionom vezom (preporuka), (b) `Project` se **proširuje** i postaje jedno te isto, ili (c) potpuno su nezavisni? Napomena: (b) traži i promjenu `Project.status` iz slobodnog stringa u enum i migraciju postojećih podataka.
- **P8. Zaokruživanje i ostatak.** `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §5.5` danas kaže: bez naknadnog poravnanja razlike. Za prikupljanje tačnog iznosa to znači da se cilj nikad ne dostigne tačno. Prihvata li se **poravnanje ostatka** (metoda najvećih ostataka, §3), i unosi li se ta iznimka u pravni dokument?
- **P9. Podsjetnici za kašnjenje.** Treba li podsjetnik na neplaćenu ratu preko postojećeg e-mail/Viber outbox-a (`notifications/service.ts:9`)? Napomena: aplikacija **nema pozadinske poslove**, pa bi to bilo dugme „pošalji podsjetnike za dospjele rate", ne automatika. Postojeći `generatePaymentReminderPdf` (`documents.ts:687`) već pravi opomenu za ukupan dug — je li dovoljno, ili treba opomena specifična za projekat?
- **P10. Životni ciklus i veza sa odlukom skupštine.** (a) Potvrđuješ li statuse `DRAFT | PROPOSED | ACTIVE | COMPLETED | CANCELLED`? (b) Treba li aktivacija zahtijevati **usvojen prijedlog skupštine**, kao što `approvePlan` to tvrdo traži (`plans.ts:144-146`: *„Plan se može usvojiti samo na osnovu USVOJENOG prijedloga skupštine"*)? Vanredni teret za vlasnike je po prirodi odluka skupštine, ali tvrdo pravilo bi blokiralo hitne slučajeve — preporuka je **opciona veza** `approvedByProposalId` sa upozorenjem u UI kad je prazna.
- **P11. Zatvaranje projekta — višak, manjak, i promjena vlasnika.** (a) Šta se radi sa viškom prikupljenih sredstava po završetku: vraća se vlasnicima, prenosi u fond održavanja, ostaje kao pretplata na kartici? (b) Šta ako je prikupljeno manje nego što je potrošeno — dodatna rata? (c) Ako vlasnik proda jedinicu usred projekta, ostaju li neplaćene rate na njemu (po `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §5.4` — da) ili prelaze na kupca (traži `addBalanceCorrection`, `payments.ts:893`)?
- **P12. Prijevremena otplata.** Može li vlasnik platiti cijeli iznos odjednom umjesto po ratama? Tehnički: uplata veća od otvorene rate ostaje kao nealociran avans (`allocatePayment` odbija prekoračenje, `payments.ts:666-668`) i može se alocirati tek kad se sljedeća rata izda. Ako se traži pravo „plati sve odmah", treba mogućnost da se za jednog obveznika izdaju sve rate odjednom ili jedna zbirna faktura.

---

## 11. Fazni plan implementacije (za pregled — nije kod)

Po ustaljenom pravilu projekta (`CHANGELOG.md`, sekcija „Verzionisanje"): svaka faza nosi CHANGELOG unos i **potvrđen** version bump sa korisnikom — patch dok se faza dorađuje, minor po završenoj fazi. Trenutna verzija: `2.7.0`.

### Faza 1 — temelji: šema i raspodjela (bez UI-ja)
1. `prisma/schema.prisma` — `enum FundProjectStatus`; modeli `FundProject`, `FundProjectShare`, `FundProjectInstallment` (svi sa obaveznim `zevId` + `@relation`, back-relacije na `Zev`); `Invoice.fundProjectInstallmentId String?` + `@@index`.
2. Nova migracija — `CREATE TABLE` ×3, `ALTER TABLE "Invoice" ADD COLUMN` + indeks. Nijedan postojeći triger se ne dira.
3. `src/server/services/fundProjects.ts` (novo) — `listFundProjects`, `getFundProject`, `createFundProject`, `updateFundProject`, `previewAllocation` (poziva `unitsInScope` + `calculateCharge`, ne duplira izračun), `activateFundProject` (materijalizuje `FundProjectShare` sa `calcSnapshot`-om + poravnanje ostatka), `overrideShare` (uz obavezan razlog), `cancelFundProject`.
4. `src/lib/activity/catalog.ts` + `src/lib/i18n/sr-Latn.ts`/`en.ts` — kodovi i labele iz §5 (obavezno u ovoj fazi, inače pada `tests/activity-catalog.test.ts`).
5. `tests/fund-projects.test.ts` (novo) — raspodjela po svih pet relevantnih metoda, zbir udjela = `targetAmount` do centa, zamrzavanje pri aktivaciji (promjena vlasnika poslije ne mijenja `share`), odbijanje izmjene aktivnog projekta.
6. `tests/tenant-isolation.test.ts` — dodati `import * as fundProjects` i redove za svaku novu funkciju (obavezno po `docs/multitenancy-plan.md` Korak 6).
7. `tests/permissions.test.ts` — matrica iz §8.

### Faza 2 — rate i izdavanje
8. `src/server/services/fundProjects.ts` — `planInstallments` (validira `Σ fraction = 1`), `issueInstallment` (transakciono, po uzoru na `issueBatch`, `billing.ts:288-347`, sa konvencijom perioda iz §3), `cancelInstallment` (storno svake fakture rate kroz `cancelInvoice`).
9. `src/server/services/billing.ts` — **bez izmjena** ako je moguće; ako `nextInvoiceNumber` (`billing.ts:273-282`, privatna funkcija) treba dijeliti, izvući je u zajednički modul, ne kopirati.
10. `tests/fund-projects.test.ts` — proširiti: rate se ne sudaraju sa mjesečnom serijom istog perioda (§0.5); poravnanje ostatka rata; storno rate sa uplatom mora pasti (`billing.ts:434`).

### Faza 3 — UI: projekti, rate, blagajna
11. `src/app/(app)/fakture/projekti/page.tsx` + `[id]/page.tsx` (novo) — server-rendered, obrazac `<form action={serverAction}>` + `revalidatePath`, po uzoru na `src/app/(app)/planovi/page.tsx` i `troskovi/page.tsx`.
12. `src/app/(app)/fakture/blagajna/page.tsx` (novo) — stanje i promet CASH računa preko postojećih `accountBalance`/`listTransactions`.
13. `src/app/(app)/fakture/page.tsx` i `fakture/uplate/page.tsx` — linkovi i filter „otvorene rate projekta X"; validacija `account.type` ↔ `payment.method` iz §4b.
14. `src/components/ui.tsx` — nova primitiva samo ako zaista zatreba (postoje `Card`, `Table`, `Td`, `StatusBadge`, `Field`, `SubmitBtn`, `Flash`, `Pagination`).

### Faza 4 — izvještaji, dokumenti, transparentnost
15. `src/server/services/reports.ts` — `fundProjectCollectionReport(actor, projectId)` po uzoru na `receivablesReport` (`reports.ts:58-86`).
16. `src/server/services/documents.ts` — `generateFundProjectReportPdf` (uzor: `generateOwnerDebtReportPdf`, `documents.ts:940`); ako P6 = da, `DocumentType.CASH_RECEIPT` + prefiks u `nextDocNumber` (`documents.ts:78-86`) + `generateCashReceiptPdf` (**ova stavka nosi migraciju enuma**).
17. `src/app/api/izvjestaji/csv/route.ts` — nov `type=fundproject`.
18. `src/app/(app)/izvjestaji/page.tsx` — kartica sa pregledom aktivnih prikupljanja.

### Faza 5 — dorada i dokumentacija (dijelom uslovna, po odgovorima)
19. Podsjetnici za dospjele rate na dugme (P9) — `queueNotification` (`notifications/service.ts:9`), bez salda u tijelu poruke (pravilo iz zaglavlja tog fajla).
20. Zatvaranje projekta i tretman viška/manjka (P11).
21. Veza na usvojen prijedlog skupštine (P10b).
22. `PERMISSION_MATRIX.md` — nova sekcija „Vanredna sredstva" (§8).
23. `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` — nova tačka u §5: vanredno prikupljanje nije fond održavanja i ne ulazi u `reserveFundBalance`; odluka o poravnanju ostatka kao izuzetak od §5.5 (P8); potvrda da neplaćene rate prate obveznika pri prometu jedinice (§5.4).
24. `README.md` / `ARCHITECTURE.md` — kratka napomena o novom domenu.

---

## 12. Rizici i ono što će zaboljeti u praksi

1. **Zaokruživanje je jedini stvarni matematički rizik** (§3, P8). Sve ostalo je vodovod.
2. **`period` sudar sa mjesečnom serijom** (§0.5) — ako se konvencija imenovanja ne ispoštuje, izdavanje rate će pasti sa porukom o već izdatoj seriji, i to tek u produkciji za mjesec u kojem su izdate obje. Vrijedi test.
3. **Vlasnik koji plaća jednom uplatom više rata i redovnu naknadu** — `allocatePayment` traži eksplicitnu alokaciju po fakturi (`payments.ts:645`), što je ispravno, ali znači više klikova. Prijedlog automatskog uparivanja već daje `suggestMatches`.
4. **Promjena vlasnika usred projekta** (P11c) — jedini scenario u kojem postojeća pravila (`§5.4`) i očekivanje korisnika mogu razići.
5. **Nagomilavanje entiteta sa riječju „projekat"** — `Project`, `FundProject`, `PlanItemType.PROJECT`. Ako P7 ne da jasan odgovor, ovo će biti izvor trajne zabune u UI-ju. Preporuka za UI naziv: **„Vanredno prikupljanje sredstava"**, nikad samo „projekat".

---

### Ključni fajlovi za implementaciju
- `prisma/schema.prisma` (novi modeli, `Invoice.fundProjectInstallmentId`, eventualno `DocumentType`)
- `src/server/services/billing.ts` (uzor za `issueInstallment`: `issueBatch` 288-347, `issueSingleInvoice` 350-383, `cancelInvoice` 426-445, `correctInvoice` 451-500)
- `src/server/engines/billing.ts` (`calculateCharge` — raspodjela se ne piše iznova)
- `src/server/services/payments.ts` (uplate, alokacije, saldo — dokaz zašto rata mora biti `Invoice`; `enterPayment` 13-67, `ownerBalance` 797-819)
- `src/server/services/plans.ts` (postojeći `Project`/`createProject` 207-218 — predmet P7; `approvePlan` 140-156 kao uzor za aktivaciju)
- `src/server/services/finance.ts` (blagajna: `accountBalance` 24-39, `listTransactions` 104-121, `reserveFundBalance` 135-141)
- `src/server/services/property.ts` (`unitsInScope` 224-251 — obuhvat obveznika)
- `src/server/services/reports.ts` (`receivablesReport` 58-86 kao uzor za status naplate)
- `src/server/services/documents.ts` (`nextDocNumber` 75-87, `storeDocument` 93-148, `generateOwnerDebtReportPdf` 940)
- `src/lib/activity/catalog.ts` (obavezna klasifikacija novih kodova — inače pada `tests/activity-catalog.test.ts`)
- `src/lib/i18n/sr-Latn.ts` (ugniježđene `auditAction` grane + `fundProjectStatus`)
- `src/app/(app)/fakture/page.tsx`, `src/app/(app)/fakture/uplate/page.tsx` (UI obrasci i mjesto novih podruta)
- `tests/tenant-isolation.test.ts`, `tests/permissions.test.ts`, `tests/billing.test.ts` (obavezna proširenja)
- `PERMISSION_MATRIX.md`, `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md`, `CHANGELOG.md`
