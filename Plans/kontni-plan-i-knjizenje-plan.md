# Kontni plan i knjiženje — arhitektonski i implementacioni plan

**Status: A1 ISPORUČENO u v3.1.0 (2026-11-20; korisnik izabrao major); dopuna u v3.2.0 (konta u nacrtu predloška bez CSV-a, preuzimanje izmjena iz nove verzije). Odobreno 2026-11-20 (preporuke A-Q1–A-Q9, §9). Sljedeće: A2. Faza B čeka stručnu potvrdu računovođe (§10).**
Plan je izrađen 2026-11-20 čitanjem stvarnog koda (v2.66.0). Nijedan red koda još nije napisan.

**Izmjene korisnika (2026-11-20), ugrađene u §2, §3.5–3.8, §4–§7, §9 i §10 (izvor kontnog okvira u §3.1 i R-1):**
- **K-1** zaduženje, uplata, raspoređivanje uplate i priznavanje prihoda su **četiri zasebna događaja** (§3.6);
- **K-2** bankovni priliv se knjiži **tačno jednom** — samo događaj uplate dira konto banke (§3.6.3);
- **K-3** pravila knjiženja **po vrsti zaduženja**, svako sa datumom početka primjene i tragom promjena (§3.6.4);
- **K-4** **odvojeno praćenje** avansa, neidentifikovanih uplata i namjena sredstava (§3.5, §3.6.2);
- **K-5** početna stanja **posebnim nalogom**, uz usklađivanje analitike i glavne knjige (§4.4, §6);
- **K-6** automatsko priznavanje prihoda i bilansna klasifikacija zajedničke rezerve **ostaju isključeni** dok
  računovođa ne potvrdi konkretne šeme knjiženja (§3.6.5).

Zadatak (korisnik, 2026-11-20): podrška za kontne planove i njihovo korišćenje u evidenciji poslovnih
promjena ZEV-a, u dvije faze — **Faza A** (kontni plan i klasifikacija) i **Faza B** (nalozi za knjiženje,
periodi, računovodstveni izvještaji). Korisnikova preporuka, koju ovaj plan usvaja: **prvo isporučiti
Fazu A i potvrditi model sa računovođom**, pa tek onda automatizovati pravila knjiženja.

> **Ovo nije zakonski usklađeno računovodstvo.** Dok stručni računovođa ne potvrdi kontni okvir, pravila
> knjiženja i izvještaje, aplikacija ovu funkcionalnost ne predstavlja kao zakonsko knjigovodstvo
> (`LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` §5.2 ostaje na snazi i dobija dopunu, vidi §8).

**Granice:**
- Postojeća operativna evidencija (fakture, uplate, alokacije, troškovi, transakcije, korekcije salda)
  **ostaje izvor istine** za dugovanja i uplate. Ne pravi se paralelna evidencija dugovanja.
- Knjigovodstvo je **sloj iznad** te evidencije: nalog nastaje iz potvrđenog poslovnog događaja, nikad
  obrnuto. Nijedan postojeći tok (zaduživanje, uplate, plaćanje) ne smije pasti zato što nedostaje
  pravilo knjiženja (kriterijum 12).
- Ne unose se službene šifre konta. Seed dobija samo jasno označen **demonstracioni** predložak.
- Faza A **ne knjiži ništa** — ni ručno ni automatski.

---

## 1. Zatečeno stanje (provjereno u kodu)

| # | Pitanje iz zadatka | Stanje | Gdje |
|---|---|---|---|
| 1 | Razdvajanje ZEV-ova | Svaki tenant-scoped model ima obavezan `zevId` sa FK na `Zev`. Servis uzima `zevId` isključivo iz aktera (`requireZev(actor)`), nikad iz ulaza; čitanja su `where: { id, zevId }`. Postoji `tests/tenant-isolation.test.ts`. | `prisma/schema.prisma` (komentar iznad `Membership`), `src/server/auth/guards.ts` `requireZev` |
| 2a | Vlasnici | `Party` (lice, po ZEV-u), `OwnershipStake` sa `validFrom/validTo` (suvlasništvo = više udjela). | `schema.prisma` `Party`, `OwnershipStake` |
| 2b | Posebni dijelovi | `Unit` (vrsta, površina, udio), verzionisan registar (`UnitRegisterChange`). | `Unit`, `UnitRegisterChange` |
| 2c | Zaduženja | `ChargeItem` (9 metoda obračuna) → `InvoiceBatch` → `Invoice` + `InvoiceLine` (sa `calcSnapshot`). Faktura čuva **`debtorId`** (odgovorni vlasnik u trenutku izdavanja) i `debtorShare`. Storno/korekcija = novi zapis (`correctionOfId`). | `billing.ts` `issueBatch`, `issueSingleInvoice`, `cancelInvoice`, `correctInvoice` |
| 2d | Uplate | `Payment` (+ `FinTransaction` INCOME u istoj transakciji), storno = novi `Payment` sa `reversalOfId`. Uvoz CSV/PDF izvoda, SMS čekaonica. | `payments.ts` `enterPayment`, `commitStatementRowsInTx`, `reversePaymentInTx` |
| 2e | Dobavljači, računi, isplate | `Supplier`, `Expense` (račun dobavljača; `categoryId`, `paidAmount`, status), plaćanje = `FinTransaction` EXPENSE sa `expenseId`. | `expenses.ts` `createExpense`, `payExpense`, `cancelExpense` |
| 3 | Poslovne godine, konta, knjiženja | **Ne postoje.** Postoji samo `TransactionCategory` (`name`, `kind` INCOME/EXPENSE, jedinstven po ZEV-u), koju koriste `FinTransaction` i `Expense`. `Project` postoji (namjena sredstava). `AnnualPlan` je plan budžeta/održavanja, ne poslovna godina. | `schema.prisma` `TransactionCategory`, `Project`, `AnnualPlan` |
| 4 | Uplata ↔ zaduženje | `PaymentAllocation` — **append-only** (DB trigger), storno alokacije je novi red sa negativnim iznosom. Status uplate/fakture se izvodi (`refreshPaymentStatus`, `refreshInvoiceStatus`). Avans = nealocirani dio uplate. | `payments.ts` `allocatePayment`, `reverseAllocation`; migracija `20260823180200_append_only_guards` |
| 5 | Promjena vlasništva, istorija duga | Vlasništvo je efektivno datirano; **dug ostaje na vlasniku** (odluka 2026-10-26): saldo se računa po licu (`ownerBalance`), faktura ne mijenja `debtorId`. Prenos duga samo izričitom, auditovanom `BalanceCorrection`. | `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` §5.4; `payments.ts` `ownerBalance`, `addBalanceCorrection` |
| 6 | Uloge i pristup | Tri uloge po ZEV-u (`Membership.role`: `PRESIDENT`, `ACCOUNTANT`, `OWNER`) + platformski `isSuperAdmin`. Nema granularnih dozvola — samo `requireRole`. Računovođa danas i **unosi i plaća** troškove. | `guards.ts`, `PERMISSION_MATRIX.md` |
| 7 | Finansijski izvještaji | Računaju se u letu iz operativnih tabela: tok novca i prihodi/rashodi po kategoriji iz `FinTransaction` (status ACTIVE), potraživanja iz `Invoice` + alokacija, dugovanja po vlasnicima iz `ownerBalanceBreakdown`, dobavljači iz `Expense`. CSV izvoz kroz `toCsv`. | `reports.ts`, `(app)/izvjestaji/page.tsx` |
| — | Trag promjena | `audit(actor, {...})` → `AuditEvent` (append-only, `before/after/reason`). | `src/server/audit.ts` |
| — | Paket (tier) | `ZevTier` postoji, ali se u aplikativnom kodu danas **ne provjerava** (samo labela u adminu). | `admin/page.tsx` |
| — | Početno stanje | Postoji samo za račune (`MoneyAccount.openingBalance/openingDate`). Početno stanje vlasnika ne postoji kao zapis — stari dug ide kroz `BalanceCorrection`. | `finance.ts` `accountBalance` |

**Zaključak:** model zaduženja, uplata i troškova je pouzdan, nepromjenjiv (storno umjesto izmjene) i
tenant-scoped — dovoljno dobar izvor za knjiženje. Nedostaju: šifarnik konta, godine/periodi, nalozi i
sloj koji iz događaja pravi naloge.

---

## 2. Arhitektura

```
Operativna evidencija (postoji, ne mijenja se)          Knjigovodstveni sloj (novo)
─────────────────────────────────────────────          ───────────────────────────
issueBatch          ──► CHARGE_ISSUED      (zaduženje, po vrsti zaduženja)
enterPayment / izvod──► PAYMENT_RECEIVED   (jedini događaj koji dira banku/blagajnu)
dodjela platioca    ──► PAYMENT_IDENTIFIED (neidentifikovano → avans vlasnika)
allocatePayment     ──► PAYMENT_ALLOCATED  (avans → potraživanje; banka se ne dira)
(posebna radnja)    ──► REVENUE_RECOGNIZED (isključeno do potvrde šeme, K-6)
createExpense / ... ──► ...
        │  AccountingEvent (outbox, ista DB transakcija), samo ako je knjiženje aktivno za ZEV
        │  i datum događaja ≥ datum početka primjene
        ▼
  Šema događaja (kontrolna konta, §3.6.2) + PostingRule po vrsti zaduženja (§3.6.4)
        │   nema pravila  ──► „Čeka podešavanje knjiženja”
        │   šema nije potvrđena ──► „Čeka potvrdu šeme knjiženja” (K-6)
        ▼
  JournalEntry + JournalLine (POSTED, nepromjenjivo)
        ▼
  Dnevnik · Glavna knjiga · Bruto bilans · Kartice (samo POSTED)
```

Principi:

1. **Outbox, ne sinhrono knjiženje.** Poslovni servis u svojoj postojećoj transakciji upiše samo
   `AccountingEvent` (vrsta, izvor, datum, iznos, snimak dimenzija). Knjiženje je odvojen korak koji
   čita događaje. Ako pravilo nedostaje, događaj stoji kao `PENDING_RULE` — faktura je i dalje izdata,
   uplata evidentirana (kriterijum 12). Nikad se ne knjiži na „opšte konto” da bi obrada prošla.
2. **Idempotentnost kroz ključ izvora.** `AccountingEvent` ima `@@unique([zevId, sourceType, sourceId, kind])`;
   `JournalEntry` ima `@@unique([zevId, eventId])`. Ponovljen zahtjev ili konkurentna obrada udara u
   jedinstveni indeks, ne u provjeru „postoji li već” (kriterijum 5).
3. **Jedan događaj — jedna poslovna promjena (K-1).** Zaduženje, uplata, raspoređivanje i priznavanje
   prihoda se nikad ne spajaju u jedan nalog, pa se svaki od njih može zasebno pratiti, stornirati i
   uskladiti, a pogrešno pravilo za jedan ne kvari ostale.
4. **Konto ≠ dimenzija ≠ kategorija.** Konto nosi računovodstvenu prirodu; dimenzije (vlasnik, poseban
   dio, dobavljač, projekat, namjena sredstava) su tipizirani FK-ovi na stavci naloga; kategorija i vrsta
   zaduženja ostaju korisnički pojmovi koje pravilo knjiženja prevodi u konto u pozadini.
5. **Nepromjenjivost na nivou baze**, isto kao `AuditEvent`/`Vote`/`PaymentAllocation`: trigger brani
   UPDATE/DELETE proknjiženog naloga i njegovih stavki; ispravka = storno nalog sa `reversalOfId`.
6. **Sve je po ZEV-u.** Predložak je platformski (dijele ga ZEV-ovi), ali kontni plan ZEV-a je **kopija**
   (snimak) predloška u trenutku dodjele — promjena predloška nikad ne dira postojeće planove (kriterijum 6).

---

## 3. Faza A — model kontnog plana

Nazivi prate konvenciju šeme (engleski nazivi modela, srpski komentari; `zevId` + FK na svakom
tenant-scoped modelu; `cuid()` ključevi).

### 3.1 Predložak (platformski, nije tenant-scoped)

```prisma
enum ChartTemplateStatus {
  DRAFT      // u izradi, ne može se dodijeliti ZEV-u
  DEMO       // demonstracioni — dodjeljiv samo ZEV-u označenom kao demo/test (§9 A-Q5)
  REVIEWED   // stručno provjeren: obavezni source + reviewedBy/reviewedAt
  RETIRED    // više se ne dodjeljuje novim ZEV-ovima; postojeći planovi ostaju
}

/// Predložak kontnog plana. Nova verzija = novi red (isti `key`, veća `version`) — postojeći red se
/// poslije izlaska iz DRAFT-a ne mijenja.
model ChartTemplate {
  id            String   @id @default(cuid())
  key           String   // stabilan identitet porodice verzija, npr. "rs-zev"
  version       Int
  name          String
  jurisdiction  String   // npr. "RS" — slobodan tekst, ne enum (ne pretpostavljamo listu)
  source        String?  // propis/izvor okvira; obavezan za REVIEWED
  status        ChartTemplateStatus @default(DRAFT)
  reviewedBy    String?  // ime i svojstvo stručnog lica (tekst — nije nužno korisnik aplikacije)
  reviewedAt    DateTime?
  validFrom     DateTime?
  validTo       DateTime?
  /// Pravila šifara vezana za predložak (ne univerzalna pretpostavka):
  /// { digitsOnly: boolean, allowedLengths: number[], childExtendsParent: boolean, maxDepth?: number }
  codeRules     Json
  accounts      ChartTemplateAccount[]
  createdById   String?
  createdAt     DateTime @default(now())

  @@unique([key, version])
}
```

**Izvor prvog produkcionog predloška (korisnik, 2026-11-20):** prema evidenciji Saveza računovođa i
revizora RS, relevantan je **Kontni okvir za privredna društva, druga pravna lica i preduzetnike**
(pravilnik, „Službeni glasnik RS” 104/21, izmjene 59/22). Poseban kontni okvir samo za ZEV nije pronađen.
Novi **Zakon o računovodstvu i reviziji** („Službeni glasnik RS” 115/25), čl. 123, predviđa da se raniji
podzakonski akti primjenjuju do donošenja novih, ako nisu u suprotnosti sa zakonom. Posljedice za model:

- predložak dobija `key = "rs-kontni-okvir-pl"`, `jurisdiction = "RS"`, `source` sa oba glasnika i
  osnovom primjene (čl. 123 Zakona 115/25), i `validFrom` po pravilniku. `validTo` ostaje prazan, a
  popunjava se kad se donese novi pravilnik;
- **novi pravilnik = nova verzija predloška** (isti `key`, `version + 1`), nikad izmjena postojeće.
  ZEV-ovi prelaze na nju samo izričitom radnjom (§3.4);
- predložak ostaje `DRAFT` dok se ne provjeri **posljednje službeno izdanje** (prečišćeni tekst) i dok ga
  stručno lice ne potvrdi. Tek tada prelazi u `REVIEWED` sa `reviewedBy`/`reviewedAt`. Šifre i nazivi se
  unose **uvozom iz službenog teksta** (CSV u `/admin/kontni-okviri`), ne prepisuju se iz ovog plana ni
  iz koda;
- predložak je okvir za pravna lica uopšte, pa se **analitika za ZEV** (podkonta za naknadu, rezervu,
  avanse vlasnika, neidentifikovane uplate) dodaje u kontnom planu ZEV-a kao lokalna razrada, ne u
  predlošku. Da li dio razrade treba biti zajednički „ZEV dodatak” predlošku, odlučuje računovođa (R-2).

*Napomena:* izvor je naveo korisnik. U ovoj sesiji nije nezavisno provjeren, a i to je jedan od uslova
za `REVIEWED`.

```prisma
enum AccountNature {   // §10 R-1: lista i nazivi čekaju potvrdu računovođe
  ASSET
  LIABILITY
  EQUITY
  INCOME
  EXPENSE
  OFF_BALANCE
}

model ChartTemplateAccount {
  id          String   @id @default(cuid())
  template    ChartTemplate @relation(fields: [templateId], references: [id])
  templateId  String
  code        String   // TEKST — vodeće nule se čuvaju ("0100" ≠ "100")
  name        String
  description String?
  parentId    String?
  parent      ChartTemplateAccount?  @relation("TplTree", fields: [parentId], references: [id])
  children    ChartTemplateAccount[] @relation("TplTree")
  nature      AccountNature
  postable    Boolean  // false = zbirno konto
  /// Podrazumijevane obavezne dimenzije za ZEV kopiju (vidi ZevAccount.requiredDimensions).
  requiredDimensions String[] @default([])

  @@unique([templateId, code])
}
```

### 3.2 Kontni plan ZEV-a i konto ZEV-a

```prisma
enum ZevChartStatus {
  DRAFT    // dodijeljen, računovođa razrađuje analitiku
  ACTIVE   // potvrđen za upotrebu (pravila knjiženja smiju upućivati na njega)
  RETIRED  // zamijenjen novim planom od datuma (istorija ostaje čitljiva)
}

/// Kontni plan jednog ZEV-a: snimak predloška u trenutku dodjele + lokalna razrada.
model ZevChart {
  id                String   @id @default(cuid())
  zev               Zev      @relation(fields: [zevId], references: [id])
  zevId             String
  sourceTemplate    ChartTemplate @relation(fields: [sourceTemplateId], references: [id])
  sourceTemplateId  String   // tačna verzija iz koje je nastao
  codeRules         Json     // kopija pravila šifara iz predloška (predložak se kasnije ne čita)
  status            ZevChartStatus @default(DRAFT)
  activatedAt       DateTime?
  accounts          ZevAccount[]
  createdById       String?
  createdAt         DateTime @default(now())

  @@index([zevId, status])
}

model ZevAccount {
  id             String   @id @default(cuid())
  zev            Zev      @relation(fields: [zevId], references: [id])
  zevId          String
  chart          ZevChart @relation(fields: [chartId], references: [id])
  chartId        String
  /// Konto iz predloška od kojeg je kopiran; null = lokalna analitika ZEV-a.
  templateAccountId String?
  code           String
  name           String
  description    String?
  parentId       String?
  parent         ZevAccount?  @relation("ZevTree", fields: [parentId], references: [id])
  children       ZevAccount[] @relation("ZevTree")
  nature         AccountNature
  postable       Boolean
  active         Boolean  @default(true)
  /// Dimenzije koje stavka naloga na ovom kontu MORA imati: "PARTY" | "UNIT" | "SUPPLIER" | "PROJECT".
  requiredDimensions String[] @default([])
  /// Kontrolisana zamjena korišćenog konta: novi red upućuje na stari (stari se deaktivira, ne mijenja).
  replacesId     String?  @unique
  replaces       ZevAccount? @relation("AccountReplace", fields: [replacesId], references: [id])
  replacedBy     ZevAccount? @relation("AccountReplace")
  settings       Json?    // dodatne postavke (rezervisano, prazno u Fazi A)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([chartId, code])
  @@index([zevId])
}
```

### 3.3 Poslovna godina i period

```prisma
enum FiscalStatus { OPEN  CLOSED }

model FiscalYear {
  id        String   @id @default(cuid())
  zev       Zev      @relation(fields: [zevId], references: [id])
  zevId     String
  label     String   // "2027"
  startDate DateTime
  endDate   DateTime
  status    FiscalStatus @default(OPEN)
  periods   FiscalPeriod[]
  @@unique([zevId, label])
}

model FiscalPeriod {
  id        String   @id @default(cuid())
  zev       Zev      @relation(fields: [zevId], references: [id])
  zevId     String
  year      FiscalYear @relation(fields: [yearId], references: [id])
  yearId    String
  label     String   // "2027-01"
  startDate DateTime
  endDate   DateTime
  status    FiscalStatus @default(OPEN)
  closedAt  DateTime?
  closedById String?
  @@unique([yearId, label])
}
```
U Fazi A godine i periodi se samo **otvaraju i pregledaju** (potrebni su za probnu migraciju i
izvještaj pokrivenosti). Zatvaranje i ponovno otvaranje je Faza B, jer bez naloga nema šta da blokira.
Preklapanje perioda unutar ZEV-a se odbija u servisu (i exclusion constraint `daterange` u migraciji).

### 3.4 Pravila (provjeravaju se u servisu, testovi u §7)

| Pravilo | Gdje se provodi |
|---|---|
| Šifra je tekst, vodeće nule ostaju | `String` kolona; validator nikad ne radi `Number(code)` |
| Jedinstvena šifra u planu/predlošku | `@@unique([chartId, code])`, `@@unique([templateId, code])` |
| Bez ciklusa u hijerarhiji | servis: roditelj mora biti u istom planu i nije potomak (šetnja naviše uz `SELECT … FOR UPDATE` na planu); plus DB trigger `zev_account_no_cycle` kao druga linija odbrane |
| Zbirno ≠ knjižno | `postable`; konto sa djecom ne može biti `postable` (servis, pri dodavanju djeteta) |
| Dužina šifre / grananje | `codeRules` iz plana: dozvoljene dužine, samo cifre, šifra djeteta počinje šifrom roditelja — **sve opciono po predlošku** |
| Korišćeno konto se ne briše | *Isporučeno u A1:* „korišćeno” = konto **aktivnog** plana (na aktivan plan će upućivati pravila i nalozi). Brisanje samo u nacrtu plana i samo bez podkonta; u aktivnom planu samo deaktivacija |
| Deaktivacija ne briše istoriju | `active=false`; izvještaji i dalje prikazuju stare stavke; novo knjiženje odbija neaktivno konto |
| Promjena šifre/značenja korišćenog konta | šifra, `nature`, `postable` i nadređeni konto su **zaključani** čim je plan aktivan (A1); promjena = „Zamijeni konto” (novi red sa `replacesId`, stari deaktiviran, pravila se prevezuju od datuma). Naziv/opis se smiju mijenjati uz audit (`before/after`). |
| Promjena predloška ne dira ZEV | `ZevChart` je kopija; nova verzija predloška se ZEV-u nudi tek izričitom radnjom. *Isporučeno u 3.2.0:* „Pregledaj izmjene” (`/knjigovodstvo/izmjene`) — računovođa bira nova konta i nove nazive; promjena značenja i uklonjena konta su samo informacija; `ZevChart.syncedTemplateId` pamti pregledanu verziju |
| Produkcioni predložak | dodjela ZEV-u traži `status = REVIEWED` sa `source`, `reviewedBy`, `reviewedAt`; `DEMO` samo za demo ZEV (§9 A-Q5) |

### 3.5 Analitičke dimenzije (§5 zadatka)

Ne otvara se konto po vlasniku/dobavljaču. Dimenzije su **tipizirani FK-ovi** (ne generička EAV
tabela), jer FK daje provjeru „isti ZEV”:

| Dimenzija | Model | Na stavci naloga (Faza B) |
|---|---|---|
| Etažni vlasnik / obveznik | `Party` (postoji) | `partyId` |
| Poseban dio | `Unit` (postoji) | `unitId` |
| Dobavljač | `Supplier` (postoji) | `supplierId` |
| Projekat | `Project` (postoji) | `projectId` |
| **Namjena sredstava** (K-4) | `FundPurpose` (**novo**) | `purposeId` |

**Namjena sredstava se prati odvojeno od projekta** (K-4): projekat je posao (sanacija krova), a namjena je
*za šta su sredstva prikupljena i smiju se trošiti* (redovno održavanje, zajednička rezerva, namjenski
prikupljena sredstva po odluci skupštine). Jedan projekat se može finansirati iz više namjena.

```prisma
/// Namjena sredstava ZEV-a (K-4). Nije konto: ne nosi računovodstvenu prirodu ni bilansnu
/// klasifikaciju — to radi konto iz pravila, i to tek kad je šema potvrđena (K-6, §3.6.5).
model FundPurpose {
  id          String   @id @default(cuid())
  zev         Zev      @relation(fields: [zevId], references: [id])
  zevId       String
  code        String   // tekst, kao i šifra konta
  name        String   // "Redovno održavanje", "Zajednička rezerva", ...
  /// Označava zajedničku rezervu: njena pravila podliježu kapiji K-6 (§3.6.5).
  isCommonReserve Boolean @default(false)
  decisionRef String?  // odluka skupštine kojom je namjena utvrđena (Proposal.id ili tekst)
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  @@unique([zevId, code])
}
```

Postojeća oznaka `isReserveFund` (na `ChargeItem` i `FinTransaction`) se ne briše; u A2 se pri prvom
podešavanju predlaže namjena „Zajednička rezerva” sa `isCommonReserve = true`, a vrste zaduženja koje
su danas `isReserveFund` dobijaju tu namjenu kao podrazumijevanu (prijedlog, potvrđuje računovođa).

`ZevAccount.requiredDimensions` određuje šta stavka na tom kontu mora imati (dozvoljene vrijednosti
dobijaju i `"PURPOSE"`). Dimenzija vlasnika na
stavci se uvijek uzima iz **izvornog dokumenta** (`Invoice.debtorId`, `Payment.payerId`), nikad iz
trenutnog vlasnika jedinice — promjena vlasnika ne prepisuje istorijskog dužnika. Prenos duga se ne
pretpostavlja: knjiži se samo ako postoji izričita `BalanceCorrection` sa osnovom (i pravilo za nju).

### 3.6 Povezivanje sa postojećim evidencijama (§6 zadatka)

#### 3.6.1 Događaji — zaduženje, uplata, raspoređivanje i priznavanje prihoda su odvojeni (K-1)

```prisma
enum AccountingEventKind {
  // Vlasnici
  CHARGE_ISSUED            // zaduženje: izdata faktura, linije grupisane po vrsti zaduženja (§3.6.4)
  CHARGE_CANCELLED         // storno fakture
  CHARGE_CORRECTED         // korekcija fakture (storno starog + novo zaduženje)
  PAYMENT_RECEIVED         // bankovni/gotovinski priliv — JEDINI događaj koji dira banku/blagajnu (K-2)
  PAYMENT_REVERSED         // storno uplate (uklj. spajanje duplikata SMS ↔ izvod)
  PAYMENT_IDENTIFIED       // neidentifikovanoj uplati je naknadno dodijeljen platilac
  PAYMENT_ALLOCATED        // raspoređivanje uplate na fakturu
  ALLOCATION_REVERSED      // storno rasporeda (negativni red PaymentAllocation)
  REVENUE_RECOGNIZED       // priznavanje prihoda — ISKLJUČENO do potvrde šeme (K-6, §3.6.5)
  // Dobavljači
  SUPPLIER_INVOICE         // prijem računa dobavljača (Expense)
  SUPPLIER_INVOICE_CANCELLED
  SUPPLIER_PAYMENT         // plaćanje dobavljača
  // Ostalo
  CASH_INCOME              // ručna transakcija prihoda bez uplate vlasnika (npr. kamata banke)
  CASH_EXPENSE             // ručna transakcija rashoda bez računa dobavljača (npr. bankarska provizija)
  TRANSACTION_CANCELLED
  BALANCE_CORRECTION       // korekcija salda / prenos duga (samo uz izričit osnov)
}
```

Početno stanje **nije** događaj: unosi se posebnim nalogom (K-5, §4.4).

| Događaj | Izvor (postojeći servis) | Dira banku? | Šema (uloge kontrolnih konta iz §3.6.2; konkretna konta potvrđuje računovođa) |
|---|---|---|---|
| `CHARGE_ISSUED` | `issueBatch`, `issueSingleInvoice` | ne | D: potraživanja od vlasnika (`partyId`, `unitId`, `purposeId`) / P: konto iz pravila **vrste zaduženja** (§3.6.4) |
| `PAYMENT_RECEIVED` | `enterPayment`, `commitStatementRowsInTx`, potvrda SMS-a | **da — jedino mjesto** | D: konto računa novca (`MoneyAccount`) / P: avansi vlasnika (`partyId`) ako je platilac poznat, inače neidentifikovane uplate |
| `PAYMENT_IDENTIFIED` | dodjela platioca uplati | ne | D: neidentifikovane uplate / P: avansi vlasnika (`partyId`) |
| `PAYMENT_ALLOCATED` | `allocatePayment` | ne | D: avansi vlasnika / P: potraživanja od vlasnika (`partyId`, `unitId`, `purposeId` iz linija fakture) |
| `REVENUE_RECOGNIZED` | nema izvora dok je isključeno | ne | **nije definisana** — čeka R-3 i potvrdu šeme (K-6) |
| `*_REVERSED`, `*_CANCELLED` | storno tokovi | samo storno uplate (obrnuto) | obrnuta šema originalnog događaja, sa vezom na njegov nalog |
| `SUPPLIER_INVOICE` | `createExpense` | ne | D: konto iz pravila kategorije (`purposeId`) / P: obaveze prema dobavljačima (`supplierId`) |
| `SUPPLIER_PAYMENT` | `payExpense` | da | D: obaveze prema dobavljačima / P: konto računa novca |
| `CASH_INCOME` / `CASH_EXPENSE` | `enterTransaction` **bez** `paymentId`/`expenseId` | da | konto računa novca ↔ konto iz pravila kategorije |
| `BALANCE_CORRECTION` | `addBalanceCorrection` | ne | po pravilu; prenos duga samo uz osnov (`authority`) |

**Strukturna posljedica K-1 i K-2 (odlučeno 2026-11-20, korisnik):** uplata nikad ne zatvara potraživanje
direktno. Priliv ide na avans (ili na neidentifikovane uplate), a potraživanje zatvara tek raspoređivanje.
Važi i kad se uplata rasporedi odmah (uvoz izvoda sa uparivanjem): to su i dalje dva događaja i dva
naloga. Zato je u svakom trenutku vidljivo koliko je novca primljeno, a nije raspoređeno.

**Zavisnost događaja:** događaj koji zatvara ili ispravlja nešto što još nije proknjiženo čeka svoj
prethodnik (status „Čeka prethodni događaj”): raspoređivanje na fakturu čije zaduženje nije proknjiženo,
identifikacija uplate čiji priliv nije proknjižen, storno neproknjiženog originala. Obrađuju se redom
datuma i redom nastanka čim prethodnik bude proknjižen. Bez toga bi potraživanje ili avans u glavnoj
knjizi mogli otići u minus, a analitika i glavna knjiga se razići.

Raspoređivanje na fakturu čije linije imaju **različite namjene**, kad uplata ne pokriva cijelu fakturu,
traži pravilo podjele (srazmjerno, ili prvo određena namjena). Dok računovođa to ne odluči (R-15), takav
događaj dobija status „Čeka potvrdu šeme knjiženja”, a raspored u operativnoj evidenciji prolazi normalno.

#### 3.6.2 Kontrolna konta — avansi, neidentifikovane uplate i namjene se prate odvojeno (K-4)

```prisma
enum ControlRole {
  MONEY_ACCOUNT          // jedan konto po MoneyAccount (banka/blagajna); moneyAccountId obavezan
  OWNER_RECEIVABLE       // potraživanja od vlasnika
  OWNER_ADVANCE          // avansi vlasnika (primljeno od poznatog platioca, još nije raspoređeno)
  UNIDENTIFIED_RECEIPTS  // neidentifikovane uplate (platilac nepoznat)
  SUPPLIER_PAYABLE       // obaveze prema dobavljačima
}

/// Koji konto ZEV-a igra koju ulogu u šemama (§3.6.1). Append-only: promjena = nov red sa
/// kasnijim validFrom; ranija knjiženja zadržavaju konto koji je tada važio.
model ZevControlAccount {
  id             String   @id @default(cuid())
  zev            Zev      @relation(fields: [zevId], references: [id])
  zevId          String
  role           ControlRole
  moneyAccountId String?
  accountId      String   // ZevAccount: postable, active
  validFrom      DateTime
  reason         String?
  createdById    String
  createdAt      DateTime @default(now())
  @@unique([zevId, role, moneyAccountId, validFrom])
}
```

- **Avansi i neidentifikovane uplate su različita konta** (ne ista sa dvije dimenzije): avans ima
  dužnika (`partyId` obavezan), neidentifikovana uplata ga nema. Kontrolna konta imaju
  `requiredDimensions` koje servis postavlja (`OWNER_ADVANCE`, `OWNER_RECEIVABLE` → `PARTY`;
  `SUPPLIER_PAYABLE` → `SUPPLIER`).
- **Namjene sredstava** su dimenzija `purposeId` (§3.5) na potraživanjima i na kontima iz pravila
  vrste zaduženja, pa se iz glavne knjige vidi koliko je zaduženo, naplaćeno i potrošeno po namjeni.
  Avans nema namjenu dok se ne rasporedi (R-5).
- Konto u kontrolnoj ulozi ne smije biti „protivkonto” u pravilu kategorije ni vrste zaduženja (§3.6.4),
  pa se na avans, neidentifikovane uplate ili banku ne može knjižiti zaobilaznim putem.
- Pregled „Avansi i neidentifikovane uplate” (B3) mora se slagati sa operativnim stanjem: zbir avansa
  po vlasniku = nealocirani dio uplata (`advanceSummary`, `ownerAdvance`); neidentifikovane = uplate bez
  `payerId` sa nealociranim dijelom.

#### 3.6.3 Bankovni priliv se knjiži jednom (K-2)

Operativna evidencija danas za jednu uplatu pravi **dva zapisa**: `Payment` i `FinTransaction` INCOME sa
`paymentId` (`payments.ts`), a plaćanje troška pravi `FinTransaction` EXPENSE sa `expenseId`. Knjigovodstvo
čita samo jedan od njih:

- priliv od vlasnika → samo `PAYMENT_RECEIVED` iz `Payment`; `FinTransaction` sa `paymentId` **ne** pravi
  `CASH_INCOME`;
- plaćanje dobavljača → samo `SUPPLIER_PAYMENT`; `FinTransaction` sa `expenseId` **ne** pravi `CASH_EXPENSE`;
- isti bankovni promet iz dva kanala (SMS i PDF izvod): red izvoda označen kao već evidentiran iz SMS-a
  (`markRowsAlreadyBookedFromSms`) ne pravi `Payment`, pa ni događaj; spajanje duplikata
  (`BankRecordMatch` MERGE) stornira drugu uplatu → `PAYMENT_REVERSED` neutrališe njen nalog;
- jedinstveni ključ `(zevId, "Payment", paymentId, PAYMENT_RECEIVED)` brani dvostruki događaj;
- kontrola u B3: promet konta svakog računa novca = promet tog računa u operativnoj evidenciji
  (`accountBalance`). Svaka razlika se prikazuje kao greška usklađivanja, ne prećutkuje se.

#### 3.6.4 Pravila po vrsti zaduženja, sa datumom početka primjene i tragom promjena (K-3)

„Vrsta zaduženja” je stabilan pojam (npr. „Redovno održavanje”, „Zajednička rezerva”, „Namjenska
sredstva — krov”), a `ChargeItem` nije: stavke se mijenjaju po stopi i periodu i prave se iznova.
Zato pravila ne vise na `ChargeItem`-u (vidi §9 A-Q8):

```prisma
/// Vrsta zaduženja (K-3). ChargeItem dobija chargeTypeId; InvoiceLine pamti snimak vrste u trenutku
/// izdavanja, pa kasnija promjena stavke ne mijenja istorijsko zaduženje.
model ChargeType {
  id               String   @id @default(cuid())
  zev              Zev      @relation(fields: [zevId], references: [id])
  zevId            String
  code             String
  name             String
  defaultPurposeId String?  // FundPurpose
  active           Boolean  @default(true)
  @@unique([zevId, code])
}
// ChargeItem.chargeTypeId   String?  (null = „Čeka podešavanje knjiženja” za njegove linije)
// InvoiceLine.chargeTypeId  String?  (snimak pri izdavanju; ručna faktura bira vrstu po liniji)

enum PostingRuleStatus { DRAFT  CONFIRMED  WITHDRAWN }

/// Pravilo knjiženja. Append-only poslije potvrde: izmjena = nov red sa `supersedesId`,
/// novim `validFrom` i obaveznim razlogom; stari red se ne mijenja (DB trigger).
model PostingRule {
  id             String   @id @default(cuid())
  zev            Zev      @relation(fields: [zevId], references: [id])
  zevId          String
  chartId        String   // ZevChart
  kind           AccountingEventKind
  /// Ključ pravila (najviše jedan popunjen):
  chargeTypeId   String?  // za CHARGE_* — pravilo PO VRSTI ZADUŽENJA
  categoryId     String?  // za SUPPLIER_INVOICE, CASH_INCOME, CASH_EXPENSE, BALANCE_CORRECTION
  /// Protivkonto šeme (druga strana je kontrolno konto iz §3.6.2). Ne smije biti kontrolno konto.
  counterAccountId String
  purposeId      String?  // namjena na stavci; null = podrazumijevana namjena vrste zaduženja
  validFrom      DateTime // datum početka primjene (datum dokumenta događaja ≥ validFrom)
  status         PostingRuleStatus @default(DRAFT)
  supersedesId   String?  @unique
  reason         String   // zašto je pravilo uvedeno / promijenjeno
  expertRef      String?  // ko je stručno potvrdio („N.N., računovođa, 2027-01-10”)
  createdById    String
  confirmedById  String?
  confirmedAt    DateTime?
  createdAt      DateTime @default(now())
  @@index([zevId, kind, chargeTypeId, categoryId, validFrom])
}
```

- **Primjena:** za događaj sa datumom `d` važi `CONFIRMED` pravilo istog ključa sa najvećim
  `validFrom ≤ d`. Nema „šireg” pravila koje uskače: ako za vrstu zaduženja nema pravila, linija čeka
  („Čeka podešavanje knjiženja”), ne knjiži se na opšte konto.
- **Nema retroaktivne promjene:** nova verzija mora imati `validFrom` poslije datuma posljednjeg
  proknjiženog događaja tog ključa; stari nalozi pamte `ruleId` po stavci (`JournalLine.ruleId`) i
  ostaju kakvi jesu (kriterijum 6).
- **Trag promjena:** sami redovi su istorija (prethodna i nova vrijednost, ko, kada, razlog, od kada važi),
  plus `audit()` (`posting_rule.create/confirm/supersede/withdraw`). Ekran pravila prikazuje istoriju
  svakog ključa kao vremensku liniju.
- Faktura sa linijama više vrsta pravi **jedan** `CHARGE_ISSUED` događaj i jedan nalog sa po jednim
  parom stavki za svaku vrstu; ako ijedna vrsta nema pravilo, ceo događaj čeka (nalog se ne knjiži
  djelimično).

#### 3.6.5 Kapije: priznavanje prihoda i zajednička rezerva (K-6)

Dvije šeme ostaju **isključene u kodu** dok računovođa ne potvrdi konkretnu šemu knjiženja (konta,
strane, trenutak):

```prisma
enum GatedSchema {
  REVENUE_RECOGNITION            // automatsko priznavanje prihoda (REVENUE_RECOGNIZED)
  COMMON_RESERVE_CLASSIFICATION  // bilansna klasifikacija zajedničke rezerve
}

/// Evidencija stručne potvrde šeme. Append-only; opoziv = nov red sa revokes.
model PostingSchemaApproval {
  id           String   @id @default(cuid())
  zev          Zev      @relation(fields: [zevId], references: [id])
  zevId        String
  schema       GatedSchema
  description  String   // konkretna šema: konta, strane, trenutak knjiženja
  expertName   String   // ime i svojstvo stručnog lica
  approvedAt   DateTime
  attachmentId String?  // pisana potvrda (Attachment)
  revokesId    String?  @unique
  recordedById String
  createdAt    DateTime @default(now())
}
```

Dok potvrde nema:

| Šema | Šta je blokirano | Šta i dalje radi |
|---|---|---|
| `REVENUE_RECOGNITION` | nijedan servis ne pravi `REVENUE_RECOGNIZED`; pravilo za tu vrstu se ne može ni kreirati; u UI-ju nema radnje, samo red „Priznavanje prihoda — čeka potvrdu šeme knjiženja” | zaduženje, uplata i raspoređivanje se knjiže normalno |
| `COMMON_RESERVE_CLASSIFICATION` | pravilo vrste zaduženja ili kategorije čija je namjena `isCommonReserve` može biti nacrt, ali se **ne može potvrditi**; takvi događaji dobijaju status „Čeka potvrdu šeme knjiženja” | operativno zaduženje i naplata rezerve rade kao danas; priliv se knjiži (banka → avans); raspoređivanje na fakturu sa linijom rezerve čeka da se proknjiži zaduženje (zavisnost, §3.6.1) |

Potvrda šeme ne knjiži automatski događaje koji su čekali: oni se obrađuju izričitom radnjom „Obradi
događaje na čekanju”, uz pregled (koji periodi, koliki iznosi, da li je neki period zatvoren).
Opoziv potvrde zaustavlja nova knjiženja po toj šemi, ali ne dira proknjižene naloge.

#### 3.6.6 Šta Faza A radi sa ovim

U Fazi A se vrste zaduženja, namjene, kontrolna konta i pravila **podešavaju i potvrđuju**, ali se ništa ne
knjiži. Ekran „Pravila knjiženja” prikazuje **pokrivenost**: za svaku vrstu događaja × vrstu zaduženja /
kategoriju / račun novca — pravilo koje važi danas, „Čeka podešavanje knjiženja” ili „Čeka potvrdu šeme
knjiženja”. To je ujedno alat za razgovor sa računovođom.

Pravila nemaju podrazumijevane vrijednosti. **Ne pretpostavlja se** da je uplata prihod ili isplata
rashod — tretman naknade, rezerve, avansa i namjenskih sredstava je u §10.

### 3.7 Ovlašćenja (§9 zadatka)

Postojeći sistem ima tri uloge, bez granularnih dozvola. Prijedlog (§9 A-Q2): mogućnosti kao **imenovane
dozvole u kodu**, mapirane na postojeće uloge u jednoj tabeli (`src/lib/accountingCapabilities.ts`),
provjeravane u servisu kroz novi guard `requireCapability(actor, cap)`:

| Mogućnost | Ko (prijedlog) |
|---|---|
| `template.manage` — predlošci i njihove verzije | super admin (platformski, jer predložak dijele svi ZEV-ovi) |
| `chart.edit` — kontni plan ZEV-a, analitika, deaktivacija, kontrolna konta | računovođa |
| `chargeTypes.edit` — vrste zaduženja, namjene sredstava | računovođa (predsjednik pregled) |
| `rules.edit` — pravila knjiženja (nacrt, nova verzija) | računovođa |
| `rules.confirm` — potvrda pravila | računovođa (A-Q3 a) |
| `schema.approve` — evidencija stručne potvrde šeme pod kapijom (§3.6.5) | računovođa, uz ime stručnog lica i prilog (A-Q9 a) |
| `journal.prepare` — nacrt naloga, uklj. nalog početnog stanja (Faza B) | računovođa |
| `journal.post` / `journal.reverse` (Faza B) | računovođa |
| `period.close` / `period.reopen` (Faza B) | računovođa zatvara; ponovno otvaranje predsjednik, uz razlog |
| `ledger.view` / `ledger.export` | predsjednik, računovođa |

Nijedna od ovih mogućnosti ne daje pravo plaćanja ili odobravanja nabavke — ta prava ostaju na
postojećim guardovima u `expenses.ts`/`maintenance.ts` i ne čitaju mapu iznad. Vlasnik ne vidi ništa od
ovoga (svoju karticu i dalje vidi kroz postojeći `ownerBalance`).

Trag: svaka izmjena ide kroz `audit()` sa `before/after`; razlog je obavezan za deaktivaciju, zamjenu
konta, novu verziju pravila, promjenu kontrolnog konta, storno i ponovno otvaranje perioda.

### 3.8 Korisnički interfejs Faze A

Nova stavka menija **„Knjigovodstvo”** (`/knjigovodstvo`) — kod predsjednika u grupi „Uprava”, kod računovođe u
grupi „Finansije” (uz Izvještaje). *Isporučeno u A1 (v3.1.0):* pet tabova — Kontni plan, Poslovne godine, Pravila
knjiženja, Nalozi, Izvještaji; „Vrste zaduženja i namjene” ulaze u tab Pravila knjiženja (A2), a „Početno stanje”
u tab Nalozi (B1), da na telefonu ne bude sedam tabova. Detalj konta je `/knjigovodstvo/konto/[id]`. Plan:

| Tab | Faza | Sadržaj |
|---|---|---|
| Kontni plan | A | hijerarhija (tabela sa uvlačenjem po dubini — §9 A-Q6), pretraga po šifri i nazivu (`FilterBar`), filter aktivna/sva, chip „zbirno/knjižno”, „neaktivno”, „kontrolno konto” |
| Konto (detalj) | A | analitička razrada (dodaj podkonto), obavezne dimenzije, deaktivacija / zamjena iza `ConfirmAction` (`caution`) |
| Vrste zaduženja i namjene | A | vrste zaduženja (koje stavke naknade pripadaju kojoj vrsti), namjene sredstava, oznaka zajedničke rezerve |
| Pravila knjiženja | A | kontrolna konta; pravila po vrsti zaduženja i kategoriji sa vremenskom linijom verzija; pokrivenost sa statusima „Čeka podešavanje knjiženja” / „Čeka potvrdu šeme knjiženja”; red za svaku šemu pod kapijom |
| Periodi | A (pregled/otvaranje), B (zatvaranje) | godine i periodi |
| Nalozi, Početno stanje, Izvještaji | B | u Fazi A vidljivi kao tab sa `StatusBadge` „Nije još dostupno” i jednom rečenicom šta će raditi — ne kao prazan ekran koji izgleda pokvareno |

Super admin dobija `/admin/kontni-okviri` (lista predložaka, verzije, izvor i status provjere, uvoz konta
iz CSV-a).

Koriste se isključivo postojeći primitivi (`PageHeader`, `Card`, `Tabs`, `Table`/`ColumnSpec`,
`FilterBar`, `StatusBadge`, `StatusTimeline` za istoriju verzija pravila, `ConfirmAction`,
`Field`/`inputCls`, `Flash`); nema novog `danger` dugmeta. Jedino novo je uvlačenje redova po dubini
hijerarhije — predlaže se kao dopuna DS-a (§9 A-Q6).

---

## 4. Faza B — nalozi, kontrole, storno, periodi

### 4.1 Model

```prisma
enum JournalStatus { DRAFT  POSTED }
enum JournalKind   { REGULAR  OPENING  REVERSAL }

enum AccountingEventStatus {
  PENDING                // upisan, čeka obradu
  PENDING_RULE           // „Čeka podešavanje knjiženja”
  PENDING_SCHEMA         // „Čeka potvrdu šeme knjiženja” (K-6, R-15)
  PENDING_DEPENDENCY     // „Čeka prethodni događaj” (§3.6.1, zavisnost)
  POSTED
  SKIPPED_BEFORE_START   // datum prije početka primjene (§6)
  ERROR
}

model AccountingEvent {        // outbox (§2)
  id          String   @id @default(cuid())
  zevId       String   // + FK
  kind        AccountingEventKind
  sourceType  String   // "Invoice" | "Payment" | "PaymentAllocation" | "Expense" | "FinTransaction" | "BalanceCorrection"
  sourceId    String
  occurredAt  DateTime // datum dokumenta
  amount      Decimal  @db.Decimal(14, 2)
  snapshot    Json     // dimenzije, vrste zaduženja po linijama, namjene, račun novca — u trenutku događaja
  status      AccountingEventStatus @default(PENDING)
  error       String?
  createdAt   DateTime @default(now())
  @@unique([zevId, sourceType, sourceId, kind])
}

model JournalEntry {
  id           String   @id @default(cuid())
  zevId        String   // + FK
  periodId     String   // FiscalPeriod, isti ZEV
  kind         JournalKind @default(REGULAR)
  number       String   // "NK-2027-000123"; početno stanje ima svoju seriju "PS-2027-0001"
  documentDate DateTime
  postingDate  DateTime
  description  String
  eventId      String?  @unique   // automatski nalog; null = ručni ili početno stanje
  sourceType   String?
  sourceId     String?
  status       JournalStatus @default(DRAFT)
  reversalOfId String?  @unique   // storno nalog upućuje na original
  reversalReason String?
  createdById  String
  postedById   String?
  postedAt     DateTime?
  lines        JournalLine[]
  @@unique([zevId, number])
}

model JournalLine {
  id         String  @id @default(cuid())
  entryId    String
  zevId      String
  accountId  String   // ZevAccount
  debit      Decimal  @default(0) @db.Decimal(14, 2)
  credit     Decimal  @default(0) @db.Decimal(14, 2)
  currency   String   @default("BAM")
  partyId    String?
  unitId     String?
  supplierId String?
  projectId  String?
  purposeId  String?  // FundPurpose (K-4)
  ruleId     String?  // PostingRule po kojem je stavka nastala (K-3); null = ručna / početno stanje
  /// Samo nalog početnog stanja: izvor stavke (pojedinačna otvorena stavka ili zbirno) — §4.4.
  openingSourceType String?   // "Invoice" | "Expense" | "MoneyAccount" | "SUMMARY"
  openingSourceId   String?
  description String?
  // CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
}
```

### 4.2 Kontrole (servis + baza)

- `Decimal` svuda; zbirovi kroz `sumDecimals`.
- `CHECK` na stavci: pozitivan iznos tačno na jednoj strani.
- Knjiženje (`DRAFT → POSTED`) u **jednoj** `prisma.$transaction`: zaključa period (`SELECT … FOR UPDATE`),
  provjeri `status = OPEN`, provjeri ravnotežu, konta (`postable && active`, isti `zevId`), obavezne
  dimenzije i da svaka dimenzija pripada istom ZEV-u, pa promijeni status. Dodatno **deferred constraint
  trigger** odbija `POSTED` nalog čiji zbir duguje ≠ potražuje (druga linija odbrane).
- Ručni nalog (`REGULAR` bez događaja) ne smije koristiti kontrolna konta (§3.6.2) — avans,
  neidentifikovane uplate, potraživanja, obaveze prema dobavljačima i konta računa novca mijenjaju se
  samo kroz događaje, storno ili nalog početnog stanja. Inače bi analitika i glavna knjiga mogle da se
  razidu.
- Trigger `journal_posted_immutable`: UPDATE/DELETE proknjiženog naloga i njegovih stavki odbijen
  (isti obrazac kao `forbid_update_delete()`).
- Storno: novi nalog (`REVERSAL`) sa zamijenjenim stranama, `reversalOfId`, obaveznim razlogom, u
  otvorenom periodu. Izmjena već proknjiženog izvornog dokumenta (storno/korekcija fakture, storno
  uplate) proizvodi svoj događaj → storno nalog + novi nalog, nikad izmjenu starog.
- Dupla obrada: jedinstveni indeksi iz §2.2; obrađivač hvata `P2002` i tretira ga kao „već obrađeno”.

### 4.3 Automatsko knjiženje (redoslijed isporuke 5)

Upis `AccountingEvent` se dodaje u postojeće transakcije, po mapi iz §3.6.1: `issueBatch`,
`issueSingleInvoice`, `cancelInvoice`, `correctInvoice` (zaduženje); `enterPayment`,
`commitStatementRowsInTx`, potvrda SMS-a, `reversePaymentInTx` (uplata); dodjela platioca (identifikacija);
`allocatePayment`, `reverseAllocation` (raspoređivanje); `createExpense`, `cancelExpense`, `payExpense`;
`enterTransaction` i `cancelTransaction` samo za transakcije bez `paymentId`/`expenseId` (§3.6.3);
`addBalanceCorrection`. Sve to **samo kad je knjiženje aktivno za ZEV** (§6). Obrada ide odmah poslije
commit-a i ponovo kroz dugme „Obradi na čekanju” (bez cron-a u Fazi B). Nijedan servis ne pravi
`REVENUE_RECOGNIZED` dok kapija K-6 nije otvorena.

### 4.4 Početno stanje — poseban nalog uz usklađivanje analitike i glavne knjige (K-5)

Početno stanje se ne pravi iz događaja ni iz pravila, nego **posebnim nalogom** (`kind = OPENING`, svoja
serija brojeva, jedan po ZEV-u i poslovnoj godini u kojoj počinje primjena):

1. **Priprema (prijedlog, ne knjiženje):** servis predloži stavke na dan početka primjene iz operativne
   evidencije — po kontu računa novca (`accountBalance(asOf)`), po vlasniku za potraživanja
   (otvorene fakture, dimenzije `partyId`/`unitId`/`purposeId`), po vlasniku za avanse (`ownerAdvance`),
   neidentifikovane uplate, po dobavljaču za obaveze (neplaćeni dio `Expense`). Svaka stavka pamti izvor
   (`openingSourceType/Id`). Računovođa može dodati, izmijeniti ili ukloniti stavke dok je nalog nacrt
   (npr. za stanja koja aplikacija ne zna: obaveze iz ranijeg perioda, sredstva rezerve iz starih knjiga).
2. **Pojedinačno ili zbirno, po kontu — nikad oboje:** za svako kontrolno konto bira se `OPEN_ITEMS`
   (stavka po dokumentu) ili `SUMMARY` (jedna stavka po dimenziji). Servis odbija nalog u kojem isti
   izvorni dokument ulazi i pojedinačno i kroz zbirnu stavku.
3. **Usklađivanje prije knjiženja** — nalog se ne može proknjižiti dok svaki red ovog izvještaja nema
   razliku 0 (ili izričito obrazloženje, upisano u nalog i audit):

   | Kontrolno konto | Glavna knjiga (zbir na kontu) | Analitika (zbir po dimenziji) | Operativna evidencija |
   |---|---|---|---|
   | račun novca | stavka konta | — | `accountBalance(asOf)` |
   | potraživanja od vlasnika | zbir | zbir po `partyId` | `ownerBalance(asOf)` po vlasniku |
   | avansi vlasnika | zbir | zbir po `partyId` | `ownerAdvance` |
   | neidentifikovane uplate | zbir | — | uplate bez platioca, nealocirano |
   | obaveze prema dobavljačima | zbir | zbir po `supplierId` | `unpaidSupplierInvoices` |
   | namjene | — | zbir po `purposeId` | po namjeni (gdje je poznata) |

   Kontrolno konto mora imati sve obavezne dimenzije na svakoj stavci — inače analitika ne može da se
   sabere u glavnu knjigu.
4. **Knjiženje** u istoj transakciji kao i svaki drugi nalog (§4.2). Ponovna priprema ne pravi drugi
   nalog: `@@unique` na (`zevId`, `kind = OPENING`, godina) preko parcijalnog indeksa; storno početnog
   stanja je moguć samo dok u godini nema drugih proknjiženih naloga.
5. Početno stanje zajedničke rezerve: dok kapija `COMMON_RESERVE_CLASSIFICATION` nije otvorena,
   stavka rezerve se ne može upisati na bilansno konto — nalog početnog stanja se tada ne može
   proknjižiti ako ZEV ima sredstva rezerve (prikazuje se razlog). To je namjerno: bez potvrđene
   klasifikacije nema ispravnog početnog stanja rezerve.

### 4.5 Izvještaji

Samo `POSTED`: dnevnik knjiženja, glavna knjiga i kartica konta, bruto bilans (početno stanje / promet /
završno), kartice vlasnika i dobavljača po dimenziji, **pregled avansa i neidentifikovanih uplata**,
**pregled po namjeni sredstava**, pregled dokumenata koji nisu proknjiženi (`PENDING_RULE`,
`PENDING_SCHEMA`, `PENDING_DEPENDENCY`, `ERROR`) sa razlikom prema operativnom pregledu, i stalni izvještaj usklađivanja iz
§4.4 (ne samo za početno stanje). Svaki iznos je link: iznos → stavka naloga → nalog → izvorni dokument.
CSV izvoz kroz postojeći `toCsv`. Propisani godišnji obrasci su van obuhvata.

---

## 5. Redoslijed isporuke

| Korak | Sadržaj | Verzija (prijedlog, potvrđuje se pri isporuci) |
|---|---|---|
| 1 | Ovaj plan | — |
| **A1** | Migracija za §3.1–3.3, servis `chartOfAccounts.ts`, admin predložaka (uvoz CSV, verzije, izvor/provjera), kontni plan ZEV-a, periodi (otvaranje), demo predložak u seed-u, testovi | **ISPORUČENO: 3.1.0** (major, izbor korisnika) |
| **A2** | Namjene (`FundPurpose`), vrste zaduženja (`ChargeType`, `ChargeItem.chargeTypeId`, snimak na `InvoiceLine`), kontrolna konta, pravila po vrsti zaduženja i kategoriji sa verzijama, kapije K-6 (`PostingSchemaApproval`), pokrivenost, `requireCapability`, dopune `PERMISSION_MATRIX.md` i `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` | minor |
| — | **Stop: potvrda računovođe** (§10) — bez nje Faza B ne počinje | — |
| B1 | Nalozi, kontrole, storno, zatvaranje perioda, ručni nalog, **nalog početnog stanja sa usklađivanjem** (§4.4) | minor |
| B2 | Outbox i automatsko knjiženje potvrđenih događaja (bez `REVENUE_RECOGNIZED`) | minor |
| B3 | Izvještaji i usklađivanje | minor |
| B4 | Probna migracija i provjera cjelovitog toka | minor |

---

## 6. Migracija postojećih podataka (B4)

Po ZEV-u se uvodi `AccountingActivation { zevId, startDate, chartId, openingEntryId, status: DRY_RUN | ACTIVE }`.

1. Postojeće evidencije se ne mijenjaju i ne pretvaraju u naloge unazad.
2. ZEV dobija `REVIEWED` kontni plan (`ACTIVE`), kontrolna konta i potvrđena pravila sa
   `validFrom ≤ startDate` za vrste zaduženja i kategorije koje koristi.
3. Početno stanje na `startDate` se unosi **posebnim nalogom** po §4.4 (priprema iz postojećih podataka,
   pojedinačno ili zbirno po kontu — nikad oboje, usklađivanje analitike i glavne knjige).
4. **Probni režim** računa sve i vraća izvještaj (prijedlog naloga početnog stanja, usklađivanje,
   pokrivenost pravila, greške: nedostaje pravilo, čeka šemu, neravnoteža, dimenzija iz drugog ZEV-a,
   neaktivno konto) bez ijednog upisa.
5. Usklađivanje banke, blagajne, vlasnika, avansa, neidentifikovanih uplata i dobavljača — razlika mora
   biti 0 ili obrazložena (§4.4 tačka 3).
6. Aktivacija proknjižava nalog početnog stanja i tek onda uključuje upis događaja. Ponovljeno pokretanje
   ne duplira (jedan `OPENING` nalog po godini; `AccountingActivation` jedinstven po ZEV-u). Događaji sa
   datumom prije `startDate` dobijaju `SKIPPED_BEFORE_START`, jer su već sadržani u početnom stanju.

---

## 7. Testovi (Vitest, servisni sloj, prava test baza)

| Kriterijum | Test |
|---|---|
| 1, 10 | dva ZEV-a, različita razrada istog predloška; akter ZEV-a B ne čita/mijenja plan, konto, pravilo, vrstu zaduženja, namjenu ni nalog ZEV-a A (dodaje se u `tenant-isolation.test.ts`) |
| 2 | `"0100"` i `"100"` su dva konta; round-trip kroz servis i CSV uvoz |
| — | ciklus odbijen (servis i trigger); konto sa djecom ne postaje knjižno; korišćeno konto se ne briše, zaključana šifra |
| 6 | nova verzija predloška ne mijenja postojeći `ZevChart`; nova verzija pravila ne mijenja stare naloge; verzija sa `validFrom` prije posljednjeg proknjiženog događaja odbijena |
| K-3 | pravilo se bira po vrsti zaduženja i datumu dokumenta; faktura sa dvije vrste → dva para stavki; vrsta bez pravila → cijeli događaj `PENDING_RULE`, faktura i dalje izdata |
| K-1, K-2 (B) | uplata + raspored = dva naloga; zbir prometa na kontu računa novca = jedan priliv (i kad postoje `Payment` i `FinTransaction`, i kad isti promet stigne SMS-om i izvodom); raspored ne dira konto banke |
| K-4 (B) | uplata bez platioca ide na neidentifikovane, identifikacija je prenosi na avans vlasnika; avans ≠ neidentifikovane; zbir avansa = `advanceSummary` |
| K-5 (B) | nalog početnog stanja se ne proknjižava uz neusklađenu analitiku; isti dokument pojedinačno + zbirno odbijen; druga priprema ne pravi drugi nalog |
| zavisnost (B) | raspored na fakturu čije zaduženje čeka (pravilo ili šemu) ostaje `PENDING_DEPENDENCY` i proknjižava se automatski poslije zaduženja; saldo potraživanja po vlasniku u glavnoj knjizi nikad nije manji od nule zbog redoslijeda |
| K-6 | `REVENUE_RECOGNIZED` se ne može kreirati ni kao pravilo ni kao događaj; pravilo za namjenu zajedničke rezerve se ne može potvrditi bez `PostingSchemaApproval`; opoziv zaustavlja nova knjiženja, stara ostaju |
| 3 (B) | knjiženje na zbirno / neaktivno konto odbijeno; ručni nalog na kontrolno konto odbijen |
| 4 (B) | neuravnotežen nalog se ne proknjižava (servis i deferred trigger) |
| 5 (B) | dvostruki i konkurentni (`Promise.all`) zahtjev za isti događaj → jedan nalog |
| 7 (B) | storno čuva `reversalOfId`; proknjižen nalog se ne može mijenjati (trigger) |
| 8 (B) | zatvoren period odbija novo knjiženje, uklj. storno |
| 9, 11 (B) | stavka bez obavezne dimenzije odbijena; svaki iznos iz bruto bilansa vodi do izvornog dokumenta |
| 12 | postojeći `billing`, `payments`, `expenses` testovi prolaze nepromijenjeni, sa i bez aktivnog knjiženja; nedostajuće pravilo ili zatvorena kapija ne ruše izdavanje serije, unos uplate ni raspored |
| migracija | probni režim ne upisuje ništa; dvostruka aktivacija ne duplira; događaji prije početka su `SKIPPED_BEFORE_START` |

---

## 8. Izmjene dokumentacije

- `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` §5.2: dopuna — aplikacija ima kontni plan (Faza A), ali to nije
  zakonsko knjigovodstvo dok računovođa ne potvrdi okvir i pravila; izvor prvog predloška (Sl. glasnik RS
  104/21, 59/22; čl. 123 Zakona 115/25) uz napomenu o provjeri posljednjeg izdanja; kapije K-6; nova
  stavka u §8 (otvoreno).
- `PERMISSION_MATRIX.md`: nova sekcija „Knjigovodstvo” po §3.7.
- `Plans/design-system.md`: red za uvlačenje hijerarhije u `Table` (ako A-Q6 = B).
- `CHANGELOG.md` + verzija po svakoj isporuci.

---

## 9. Odluke korisnika

**Odlučeno 2026-11-20 (korisnik):** K-1 do K-6 (vidi zaglavlje), izvor prvog predloška (§3.1) i **sve preporuke A-Q1–A-Q9**: A-Q1 (a), A-Q2 (a), A-Q3 (a), A-Q4 bez provjere paketa, A-Q5 da, A-Q6 (b), A-Q7 prikazati, A-Q8 (a), A-Q9 (a).

**A-Q1 — ODLUČENO: preporuka. Ko upravlja predlošcima?**
(a) super admin u `/admin` — predložak je zajednički za sve ZEV-ove, pa ga ne smije mijenjati računovođa
jednog ZEV-a. (b) računovođa ZEV-a pravi i lokalni predložak. **Preporuka: (a).**

**A-Q2 — ODLUČENO: preporuka. Granularne dozvole?**
(a) imenovane mogućnosti u kodu mapirane na postojeće tri uloge (§3.7), bez migracije; (b) dodjela
mogućnosti po članstvu (`Membership.capabilities String[]` + UI), da npr. računovođa koji knjiži nema
pravo plaćanja. Danas računovođa i unosi i plaća troškove, pa (b) mijenja postojeći tok. **Preporuka: (a)
za Fazu A; (b) razmotriti prije B1 ako se traži razdvajanje dužnosti.**

**A-Q3 — ODLUČENO: preporuka. Ko potvrđuje pravila knjiženja?**
(a) računovođa; (b) računovođa priprema, predsjednik potvrđuje. **Preporuka: (a)**, uz obavezan
`expertRef` (ko je stručno potvrdio), jer je predsjednik rijetko kompetentan za to.

**A-Q4 — ODLUČENO: preporuka. Paket.** Knjigovodstvo samo za `BASIC_FINANCE`/`FULL`? Tier se danas nigdje ne provjerava, pa bi
ovo bila prva provjera paketa u kodu. **Preporuka: prikazati svima koji imaju finansije (predsjednik,
računovođa) bez provjere paketa**, kao i ostatak finansija.

**A-Q5 — ODLUČENO: preporuka. Demo predložak.** Seed dobija predložak „DEMO — nije službeni kontni okvir” sa izmišljenim
šiframa (uklj. vodeće nule), status `DEMO`, dodjeljiv samo demo ZEV-u iz seed-a. Produkcioni predložak
po §3.1 nastaje uvozom iz službenog teksta i ostaje `DRAFT` do provjere. **Preporuka: da.**

**A-Q6 — ODLUČENO: preporuka. Hijerarhija u tabeli (dopuna DS-a).** Sistem nema prikaz stabla.
(a) ravna tabela sortirana po šifri, roditelj kao kolona; (b) `Table` + uvlačenje prve kolone po dubini
(`padding-left` u koracima od 16px iz postojećeg ritma, najviše 6 nivoa), zbirna konta `font-semibold`;
(c) sklopivo stablo (client komponenta). **Preporuka: (b)** — nema novog primitiva ni JS-a, čita se kao
kontni plan na papiru; DS dobija jedan red.

**A-Q7 — ODLUČENO: preporuka. Tabovi Faze B u Fazi A.** Prikazati „Nalozi”, „Početno stanje” i „Izvještaji” kao tab sa
„Nije još dostupno”, ili ih ne prikazivati do B1? **Preporuka: prikazati** (zadatak traži jasno
razlikovanje aktivnog i nedostupnog).

**A-Q8 — ODLUČENO: preporuka. Vrsta zaduženja kao poseban pojam (K-3).**
(a) novi model `ChargeType` po ZEV-u; stavke naknade se razvrstavaju u vrste, a linija fakture pamti
snimak vrste (§3.6.4); (b) pravilo direktno po `ChargeItem`-u, bez novog modela. Kod (b) svaka nova
stavka naknade (nova stopa, nova godina) traži novo pravilo i istorija pravila se cijepa po stavkama.
**Preporuka: (a).** Postojeće stavke dobijaju vrstu u A2 kroz ekran „Vrste zaduženja”; dok je nemaju,
njihove linije su „Čeka podešavanje knjiženja”.

**A-Q9 — ODLUČENO: preporuka. Ko evidentira stručnu potvrdu šeme pod kapijom (K-6)?**
(a) računovođa ZEV-a, uz obavezno ime stručnog lica i priloženu pisanu potvrdu; (b) samo super admin,
jer je potvrda šeme vezana za kontni okvir, a ne za jedan ZEV; (c) računovođa evidentira, predsjednik
potvrđuje. **Preporuka: (a)** — šema zavisi od odluka konkretnog ZEV-a (npr. kako je skupština utvrdila
rezervu), a prilog i audit čuvaju dokaz. Ako se pokaže da je šema ista za sve ZEV-ove, (b) se može dodati
kasnije kao platformska podrazumijevana potvrda.

---

## 10. Računovodstvene odluke koje traže stručnu potvrdu (otvoreno, ne izmišlja se)

Strukturne odluke K-1 do K-6 su donijete (korisnik, 2026-11-20). Otvoren je **sadržaj** šema: konkretna
konta, strane i trenutak knjiženja.

| # | Pitanje |
|---|---|
| R-1 | *Djelimično odgovoreno (korisnik, 2026-11-20):* izvor je Kontni okvir za privredna društva, druga pravna lica i preduzetnike (Sl. glasnik RS 104/21, 59/22), koji se primjenjuje do donošenja novog po čl. 123 Zakona o računovodstvu i reviziji (115/25). **Otvoreno:** potvrda posljednjeg službenog izdanja prije produkcije; da li se ZEV vodi kao „drugo pravno lice” i koja klasa/grupa konta mu odgovara; podjela konta po vrstama (§3.1 `AccountNature`) |
| R-2 | Pravila šifara (dužine, grananje) i analitička razrada za ZEV: lokalno po ZEV-u ili zajednički „ZEV dodatak” predlošku |
| R-3 | **Šema priznavanja prihoda (kapija K-6):** da li i kada se zaduženje vlasnika priznaje kao prihod (pri obračunu, pri naplati, pri trošenju sredstava), ili ostaje obaveza/namjenska sredstva (naknada kao akontacija) |
| R-4 | Konta i strane za raspoređivanje (avans → potraživanje). Struktura je odlučena (K-1); otvoreno je koja konta |
| R-5 | Konta za avanse i neidentifikovane uplate (odvojena po K-4); da li avans nosi namjenu prije rasporeda; povrat preplate vlasniku |
| R-6 | **Bilansna klasifikacija zajedničke rezerve (kapija K-6):** obaveza, namjenski izvor, kapital ili drugo; da li traži poseban račun (`LEGAL…` §5.7); kako se knjiži trošenje rezerve |
| R-7 | Račun dobavljača: rashod pri prijemu ili pri plaćanju; razgraničenja; kapitalni radovi |
| R-8 | Bankarska provizija, kamate na sredstva, povrati vlasnicima |
| R-9 | Storno u zatvorenom periodu: storno u tekućem periodu ili ponovno otvaranje? |
| R-10 | Otpis potraživanja i prenos duga (`BalanceCorrection`) |
| R-11 | Početna stanja: koja konta pojedinačno (otvorene stavke), a koja zbirno; početno stanje rezerve |
| R-12 | Zatvaranje godine: rezultat, prenos stanja |
| R-13 | PDV status (`LEGAL…` §5.8) i blagajnički maksimum |
| R-14 | Obim izvještaja: da li dnevnik/glavna knjiga/bruto bilans u ovom obliku zadovoljavaju; godišnji obrasci van obuhvata |
| R-15 | Djelimično raspoređivanje na fakturu sa više namjena: srazmjerno, ili prvo određena namjena (§3.6.1) |

---

## 11. Odgovori na upitnik R-1–R-15 (radni prijedlog, 2026-11-20)

Korisnik je proslijedio odgovore na upitnik iz §10. **Autor u samom tekstu navodi da to nije mišljenje ovlašćenog
računovođe**, nego radni prijedlog za tipičan registrovan ZEV u RS (bez zaposlenih i komercijalne djelatnosti,
mjesečne akontacije, održavanje, zajednička rezerva). Zato se odgovori ovdje vode kao **prijedlog za Fazu B**, a
kapije K-6 (automatsko priznavanje prihoda, bilansna klasifikacija rezerve) ostaju zatvorene dok ovlašćeni
računovođa ZEV-a ne odobri pisanu računovodstvenu politiku i ogledna knjiženja. Šifre ispod nisu nezavisno
provjerene u službenom tekstu pravilnika.

| # | Sažetak odgovora | Posljedica za aplikaciju |
|---|---|---|
| R-1 | Kontni okvir za privredna društva, druga pravna lica i preduzetnike (Sl. glasnik RS 104/21, 59/22); ZEV = drugo pravno lice; poseban okvir za ZEV ne postoji; Zakon 115/25 od 1.1.2026, stari pravilnik važi do novog. | Potvrđuje §3.1. |
| R-2 | Propisani su trocifreni računi; ZEV ih ne proširuje novim sintetičkim, nego analitikom (4. i naredne cifre) svojim opštim aktom. Analitika za ZEV nije propisana jedinstveno — aplikacija nudi standard, računovođa prilagođava. Predložena analitika: 201.01/201.02 potraživanja (održavanje/rezerva), 430.01 avansi poznatih vlasnika, 430.02 neidentifikovane uplate, 432.01 dobavljači iz RS, 499.01/499.02 razgraničena sredstva (održavanje/rezerva). Vlasnik, dobavljač, faktura, namjena, zgrada/ulaz = dimenzije. | Predložak = samo sintetika (klase, grupe, trocifreni); analitika ZEV-a lokalno ili kao „standardna analitika” koju računovođa mijenja. **Odluka: zapis analitike sa tačkom („430.01”) ili bez („43001”)** — pravila šifara predloška danas dozvoljavaju samo cifre. |
| R-3 | Mjesečni iznos je **akontacija** (čl. 35 Zakona o održavanju zgrada), ne prihod pri fakturisanju. Šema: zaduženje D 201 / P 499; priliv D 241 / P 430; raspoređivanje D 430 / P 201; priznavanje prihoda D 499 / P grupa 65 — **ne automatski**, tek po usvojenoj politici. | Potvrđuje K-1, K-2, K-6. Kontrolne uloge: OWNER_RECEIVABLE → 201.xx, OWNER_ADVANCE → 430.01, protivkonto zaduženja po vrsti → 499.xx. |
| R-4 | D 430 / P 201; priliv prvo na avans je uredan; kontrola da se uplata ne rasporedi dvaput. | Potvrđuje §3.6.1 (PaymentAllocation već brani prekoračenje). |
| R-5 | Avansi: 430, analitički po vlasniku i namjeni; neidentifikovane: 430.02, po identifikaciji prenos na vlasnika; povrat preplate D 430 / P 241; namjena se vodi odmah ako je poznata. | UNIDENTIFIED_RECEIPTS → 430.02; novi događaj „povrat preplate” (R-8). Avans može nositi namjenu kad je poznata (dopuna §3.6.2: „avans nema namjenu dok se ne rasporedi” → „ako nije poznata”). |
| R-6 | Rezerva **nije kapital**; privremeno u obavezama/razgraničenim namjenskim sredstvima (499.02), uz potvrdu računovođe. Poseban račun nije obavezan (243 = izdvojena sredstva, ako postoji). Trošenje rezerve: račun D trošak / P 432, plaćanje D 432 / P 241, korišćenje rezerve D 499.02 / P prihod ili razgraničenje — samo uz odluku koja račun veže za namjenu. | Kapija COMMON_RESERVE_CLASSIFICATION ostaje; trošenje rezerve traži vezu odluka–račun–plaćanje–namjena (novo u B). |
| R-7 | Obračunsko načelo: rashod pri nastanku obaveze. D 532 (održavanje) ili 550 (druge usluge) / P 432. Investicije na zajedničkom dijelu nisu automatski imovina ZEV-a. Razgraničenja: 280 pa mjesečni prenos na trošak. | SUPPLIER_INVOICE pri prijemu računa (kako je i planirano). Razgraničenje troškova — novo, kasnije. |
| R-8 | Provizije D 553 / P 241; kamata D 241 / P grupa 66; povrat vlasniku D 430 / P 241; povrat dobavljača prema prvobitnom knjiženju; reklamacija = korekcija računa. | Kategorije CASH_* za proviziju i kamatu; povrati kao posebni događaji. |
| R-9 | Zatvoren period se ne mijenja; ispravka stornom ili korektivnim nalogom; ponovno otvaranje izuzetno, uz odobrenje ovlašćenog predstavnika ZEV-a **i** računovođe, sa razlogom i tragom. | `period.reopen`: predsjednik + računovođa (dvostruko odobrenje), ne samo predsjednik kako je predloženo u §3.7. |
| R-10 | Otpis uz odluku i dokaz: D rashod (grupa 58) / P 201, ili preko ispravke vrijednosti 209. Prenos duga: D 201 novi vlasnik / P 201 stari, samo uz pisani osnov; promjena vlasnika ne prenosi dug automatski. | Potvrđuje §5.4 pretpostavki i BALANCE_CORRECTION. |
| R-11 | Pojedinačno: neplaćene fakture vlasnika, računi dobavljača, avansi, neidentifikovane, dati avansi; zbirno banka i slično, uz usaglašavanje. Rezerva na 499.02 uz dokument. Preporučeni početak: **1. januar 2027.** | Potvrđuje §4.4; datum početka primjene = 2027-01-01 (prijedlog). |
| R-12 | Rezultat po usvojenoj politici; neiskorišćene namjenske akontacije **nisu** višak prihoda; bilansna stanja se prenose sa analitikom. | Zatvaranje godine u B mora razdvojiti rezultat od namjenskih salda. |
| R-13 | ZEV nije automatski PDV obveznik; prag 100.000 KM oporezivog prometa; zakup i usluge trećima traže poresku analizu. Blagajna 246, blagajnički nalozi, bez fiksnog maksimuma. | Blagajna kao MONEY_ACCOUNT na 246; maksimum kao podešavanje po ZEV-u, ne fiksno. |
| R-14 | Dodati: otvorene stavke po dospijeću/vlasniku/dobavljaču, avansi i neidentifikovane, stanje po namjeni (rezerva), usaglašavanje banke i blagajne, pregled storna i korektivnih naloga, godišnji pregled prihoda, rashoda i utroška sredstava za skupštinu. APIF obrasci provjeriti posebno. | Dopuna §4.5 (B3). |
| R-15 | Ne podrazumijevati srazmjernu raspodjelu: prvo namjena koju je platilac naveo; inače pravilo koje ZEV usvoji (srazmjerno ili najstarije prvo), vidljivo i ručno ispravljivo uz trag. | Pravilo raspodjele = podešavanje po ZEV-u; dok nije izabrano, raspored na fakturu sa više namjena čeka (kako je i planirano). |

**Neslaganje sa trenutnim produkcionim predloškom.** Predložak „ZEV osnovni kontni okvir” v1 nastao je iz
`Plans/predlog-kontnog-plana-zev.csv`, čije je trocifrene šifre Claude složio bez službenog teksta. Po ovim
odgovorima razlikuju se najmanje: potraživanja od vlasnika 204 → **201**, blagajna 243 → **246** (243 =
izdvojena novčana sredstva), dobavljači 435 → **432**, platni promet 554 → **553**, 550/553 drugačije značenje, a
nedostaje **499** (razgraničena namjenska sredstva). Pošto se još ništa ne knjiži, ispravka je jeftina: nova
verzija predloška sa ispravljenom sintetikom (provjerenom u službenom tekstu), pa u planu ZEV-a povlačenje i
ponovna dodjela ili „Pregledaj izmjene” + zamjena konta.
