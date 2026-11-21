# Faza B2 — automatsko knjiženje događaja (outbox)

**Status: ODOBRENO 2026-11-21 (korisnik prihvatio sve preporuke B2-Q1–B2-Q9: (a), (a), (a), (a), (a), (b), (a), (a), (b)). B2a implementiran (v3.8.0): događaji vlasnika, tab Događaji, AUTO nalozi. Odstupanja od teksta ispod, odlučena pri izradi: (1) događaji se IZVODE iz evidencije (`syncEvents`, idempotentno preko jedinstvenog ključa) poslije svake radnje i na „Obradi na čekanju”, umjesto upisa u svaku poslovnu transakciju — isto pouzdano, a ne može se propustiti mjesto upisa; (2) zapisi prije datuma početka ne dobijaju red `SKIPPED_BEFORE_START` — prethodnik koji ne postoji smatra se sadržanim u početnom stanju; (3) korektivna faktura nasljeđuje vrstu zaduženja originala, jednokratna faktura prima vrstu; (4) novo početno stanje poslije storna: blokiraju ga samo ručni nalozi, a uz postojeće automatske naloge mora imati isti datum početka. B2b (dobavljači, ručne transakcije, korekcije) slijedi.** Napisan 2026-11-21 čitanjem koda v3.7.0. Nijedan red
koda još nije napisan. Glavni plan: `Plans/kontni-plan-i-knjizenje-plan.md` §2, §3.6, §4.3; B1: `kontni-plan-b1-nalozi-plan.md`.

Cilj: fakture, uplate, raspoređivanja, računi i plaćanja dobavljača, ručne transakcije i korekcije salda se od
datuma početka knjiženja **same knjiže** po potvrđenim pravilima (A2), kao zasebni nalozi (K-1), bez promjene
operativnog rada. Što nema pravilo ili čeka kapiju — vidljivo čeka, ništa se ne knjiži na „opšte konto”.
`REVENUE_RECOGNIZED` ostaje isključen (K-6).

---

## 1. Zatečeno stanje (v3.7.0)

| Šta | Stanje | Gdje |
|---|---|---|
| Nalozi, storno, periodi, brojač, nepromjenjivost | postoje (B1a) | `journal.ts`, okidači |
| Početno stanje sa usklađivanjem | postoji (B1b); datum početka = datum PS naloga | `openingBalance.ts` |
| Kontrolna konta, pravila po vrsti zaduženja/kategoriji, kapije, pravilo raspodjele | postoje (A2) | `ledgerConfig.ts` (`RULE_KINDS`: CHARGE_ISSUED, SUPPLIER_INVOICE, CASH_EXPENSE, CASH_INCOME) |
| Enum `AccountingEventKind` | postoji (A2), tabela događaja **ne** postoji | `schema.prisma` |
| Mjesta upisa u evidenciju | vidi §3 | `billing.ts`, `payments.ts`, `expenses.ts`, `finance.ts`, `bankSms.ts` |

Nalazi iz koda koji utiču na plan:

1. **Nema radnje „identifikuj platioca”.** Uplata bez platioca (`payerId = null`) raspoređuje se direktno na
   fakturu (`allocatePayment`); `payerId` se nigdje naknadno ne postavlja. → B2-Q4.
2. **`updateExpense` mijenja iznos, dobavljača, kategoriju i datum troška** i kad je trošak plaćen (uz razlog). Kad je
   račun dobavljača proknjižen, takva izmjena bi razdvojila evidenciju i knjigu. → B2-Q5.
3. **Plaćanje troška nastaje na dva mjesta:** `payExpense` i izlazni red izvoda sa izabranim troškom
   (`commitStatementRowsInTx`, `expense.update`). Oba prave `FinTransaction` EXPENSE sa `expenseId`.
4. **Uplata nastaje na četiri mjesta:** `enterPayment`, CSV uvoz (`importBankCsv`), PDF izvod
   (`commitStatementRowsInTx`), potvrda SMS-a (`confirmBankSms` → isti tok). Svaka pravi `Payment` +
   `FinTransaction` INCOME sa `paymentId` (K-2: knjiži se samo `Payment`).
5. **Storno uplate** (`reversePaymentInTx`) pravi negativne redove rasporeda pa tek onda stornira uplatu i njen
   promet — to su `ALLOCATION_REVERSED` događaji + `PAYMENT_REVERSED`, redom.
6. **Korekcija salda** nema kategoriju ni namjenu; `RULE_KINDS` nema `BALANCE_CORRECTION`. → B2-Q8.
7. Ručna transakcija (`enterTransaction`) može biti bez kategorije (`categoryId = null`) → nema ključa pravila.

---

## 2. Model (migracija B2)

```prisma
enum AccountingEventStatus {
  PENDING              // upisan, još nije obrađen
  POSTED               // proknjižen (journalEntryId)
  WAITING_RULE         // „Čeka podešavanje knjiženja” — nema potvrđenog pravila / kontrolnog konta
  WAITING_SCHEMA       // „Čeka potvrdu šeme knjiženja” — kapija K-6 ili pravilo raspodjele (R-15)
  WAITING_PREDECESSOR  // „Čeka prethodni događaj” — npr. raspored na fakturu čije zaduženje nije proknjiženo
  WAITING_PERIOD       // „Čeka otvoren period” — datum pada u zatvoren period (B2-Q6)
  SKIPPED_BEFORE_START // datum prije početka knjiženja — sadržano u početnom stanju
}

/// Outbox: upisuje ga poslovni servis U SVOJOJ transakciji, samo kad je knjiženje aktivno (B2-Q1).
model AccountingEvent {
  id             String   @id @default(cuid())
  zevId          String
  kind           AccountingEventKind
  sourceType     String   // "Invoice" | "Payment" | "PaymentAllocation" | "Expense" | "FinTransaction" | "BalanceCorrection"
  sourceId       String
  eventDate      DateTime // datum dokumenta (izdavanje fakture, datum uplate, datum računa…), ne datum unosa
  amount         Decimal  @db.Decimal(14, 2)
  snapshot       Json     // dimenzije i linije u trenutku nastanka (vlasnik, dio, namjene, vrsta zaduženja, račun novca…)
  status         AccountingEventStatus @default(PENDING)
  statusDetail   String?  // šta tačno nedostaje („Vrsta zaduženja ODRZ nema pravilo od 01.03.2027.”)
  predecessorId  String?  // događaj koji mora biti proknjižen prije ovog
  journalEntryId String?  @unique
  createdAt      DateTime @default(now())
  processedAt    DateTime?
  @@unique([zevId, sourceType, sourceId, kind])   // idempotentnost (glavni plan §2.2)
  @@index([zevId, status, eventDate])
}
// JournalEntry: eventId String? @unique (AUTO nalozi), JournalLine: ruleId String? (koje pravilo je dalo stavku)
```

Status događaja se mijenja (čekanje → proknjižen); sam nalog je i dalje nepromjenjiv. Storno AUTO naloga ide
isključivo kroz storno događaj (ručni „Storniraj” na AUTO nalogu se ne nudi — evidencija i knjiga bi se razišle).

---

## 3. Događaji, izvori i šeme

Kontrolna konta po ulozi i namjeni (A2); protivkonto iz pravila (`PostingRule`, najkasniji `validFrom ≤ eventDate`).

| Događaj | Upisuje ga | Nalog (D / P) | Napomena |
|---|---|---|---|
| `CHARGE_ISSUED` | `issueBatch` (po fakturi), `issueSingleInvoice`, nova faktura iz `correctInvoice` | D potraživanja (vlasnik, dio, namjena) / P protivkonto pravila vrste zaduženja — par stavki po vrsti | linija bez vrste → cio događaj WAITING_RULE (nema djelimičnog knjiženja) |
| `CHARGE_CANCELLED` | `cancelInvoice`, stara faktura u `correctInvoice` | obrnuto od naloga zaduženja (storno nalog sa vezom) | čeka da zaduženje bude proknjiženo |
| `PAYMENT_RECEIVED` | sva 4 mjesta nastanka uplate (§1.4) | D račun novca / P avans (vlasnik) ili neidentifikovane | jedini događaj koji dira banku/blagajnu od vlasnika (K-2) |
| `PAYMENT_IDENTIFIED` | B2-Q4 | D neidentifikovane / P avans (vlasnik) | |
| `PAYMENT_ALLOCATED` | `allocatePayment`, uparivanje pri uvozu | D avans (vlasnik) / P potraživanja (vlasnik, dio, namjena) | više namjena na fakturi → podjela po pravilu raspodjele (B2-Q7); bez pravila WAITING_SCHEMA |
| `ALLOCATION_REVERSED` | `reverseAllocation`, storno uplate | obrnuto od naloga rasporeda | |
| `PAYMENT_REVERSED` | `reversePaymentInTx` (i spajanje duplikata SMS↔izvod) | obrnuto od naloga priliva | čeka storno svih rasporeda te uplate |
| `SUPPLIER_INVOICE` | `createExpense` | D protivkonto pravila kategorije (projekat, namjena) / P dobavljači (dobavljač) | trošak bez kategorije → WAITING_RULE |
| `SUPPLIER_INVOICE_CANCELLED` | `cancelExpense` | obrnuto | |
| `SUPPLIER_PAYMENT` | `payExpense`, izlazni red izvoda sa troškom | D dobavljači / P račun novca | |
| `CASH_INCOME` / `CASH_EXPENSE` | `enterTransaction` bez `paymentId`/`expenseId`, izlazni red izvoda bez troška | račun novca ↔ protivkonto pravila kategorije | bez kategorije → WAITING_RULE |
| `TRANSACTION_CANCELLED` | `cancelTransaction` | obrnuto | |
| `BALANCE_CORRECTION` | `addBalanceCorrection` | B2-Q8 | |

`FinTransaction` sa `paymentId` ili `expenseId` **ne** pravi događaj (K-2). Red izvoda „već evidentiran iz SMS-a”
ne pravi uplatu, pa ni događaj.

---

## 4. Obrada

- **Upis:** helper `recordEvent(tx, …)` u svakoj od gornjih transakcija; ako knjiženje nije aktivno → ne upisuje
  ništa; ako je `eventDate` prije datuma početka → upisuje `SKIPPED_BEFORE_START` (vidljivo, za kontrolu).
- **Knjiženje:** `processEvents(zevId)` odmah poslije commit-a poslovne radnje (isti zahtjev, greška obrade ne
  ruši poslovnu radnju — događaj samo ostaje na čekanju) i ponovo dugmetom **„Obradi na čekanju”** (B2-Q2).
  Redom `eventDate`, pa `createdAt`; svaki događaj u svojoj transakciji: zaključa događaj, provjeri prethodnika,
  nađe pravila i kontrolna konta na `eventDate`, napravi AUTO nalog (serija NK), proknjiži ga istim
  `postEntry` provjerama (ravnoteža, otvoren period, dimenzije), postavi POSTED.
- **Idempotentnost:** jedinstveni ključ izvora + `JournalEntry.eventId @unique`; dva istovremena „Obradi” ne
  prave dva naloga.
- **Kapije:** potvrda šeme ne knjiži sama — događaji WAITING_SCHEMA se knjiže na „Obradi na čekanju”, uz pregled.
- Ručni nalog i dalje ne dira kontrolna konta (B1-Q5), pa glavna knjiga kontrolnih konta = zbir AUTO naloga +
  početno stanje, što B3 usklađuje sa evidencijom.

---

## 5. UI

| Ekran | Sadržaj |
|---|---|
| **Knjigovodstvo → Nalozi** | lista dobija vrstu „Automatski” i vezu na izvor (faktura, uplata, trošak…); filter vrste |
| **Knjigovodstvo → Događaji** (novi tab) | brojevi po statusu; tabela događaja na čekanju (datum, vrsta, izvor, iznos, razlog čekanja sa vezom na mjesto gdje se rješava — pravilo, kontrolno konto, period); **„Obradi na čekanju”** (računovođa) |
| **Detalj AUTO naloga** | veza na izvor i događaj; bez „Storniraj” (storno ide kroz storno izvora) |
| **Faktura / uplata / trošak** | mala oznaka stanja knjiženja („Proknjiženo NK-2027-0042” / „Čeka podešavanje knjiženja”) samo za računovođu i predsjednika |

---

## 6. Testovi

Svaki događaj → tačan nalog (konta, strane, dimenzije, `ruleId`); bez aktivnog knjiženja nema događaja; prije datuma
početka SKIPPED; nema pravila → WAITING_RULE, poslovna radnja prolazi; pravilo potvrđeno → „Obradi” knjiži; dupli
poziv / istovremena obrada → jedan nalog; raspored prije zaduženja → čeka prethodnika; storno uplate → storno
rasporeda pa priliva, redom; rezerva bez kapije → WAITING_SCHEMA; zatvoren period → po B2-Q6; K-2: uplata ne pravi
`CASH_INCOME`, plaćanje troška ne pravi `CASH_EXPENSE`; usklađenost: poslije niza radnji saldo kontrolnih konta u knjizi
= `operationalSnapshot` (B1b) na isti dan; razdvajanje ZEV-ova.

---

## 7. Isporuka

| Korak | Sadržaj |
|---|---|
| **B2a** | model + migracija, `recordEvent`/`processEvents`, vlasnici: zaduženje i storno fakture, uplata (sva 4 izvora), raspoređivanje i storno, storno uplate; tab Događaji; testovi; uputstvo |
| **B2b** | dobavljači (račun, storno, plaćanje iz oba izvora), ručne transakcije, korekcije salda, zaštita izmjene proknjiženog troška (B2-Q5), oznake stanja na fakturi/uplati/trošku; testovi; uputstvo |

Svaki korak sa svojom verzijom (pitam pri isporuci), migracijom na Neon i commitom.

---

## 8. Odluke korisnika (sve preporuke prihvaćene 2026-11-21; prihvaćena opcija podebljana)

**B2-Q1 — Kada je knjiženje „aktivno” za ZEV.** (a) **kad postoji proknjiženo, nestornirano početno stanje; datum
početka = njegov datum** — bez novog modela i bez prekidača; (b) poseban model `AccountingActivation` sa probnim
režimom i dugmetom „Uključi knjiženje” (glavni plan §6, B4). **Preporuka: (a)** sada; (b) ostaje za B4 ako probni
režim zatreba.

**B2-Q2 — Kada se događaj knjiži.** (a) **odmah poslije poslovne radnje + dugme „Obradi na čekanju”**; (b) samo
dugmetom (računovođa knjiži u serijama); (c) noćni posao (cron). **Preporuka: (a)** — knjiga je uvijek ažurna, a
greška obrade nikad ne ruši izdavanje fakture ili unos uplate.

**B2-Q3 — Granulacija naloga.** (a) **jedan događaj = jedan nalog** (npr. serija od 40 faktura = 40 naloga); (b)
jedan zbirni nalog po seriji/danu i vrsti događaja. **Preporuka: (a)** — K-1, storno jednog dokumenta ne dira druge,
a analitika ostaje po dokumentu; broj naloga nije problem za aplikaciju.

**B2-Q4 — Neidentifikovana uplata raspoređena na fakturu.** (a) **dva naloga: `PAYMENT_IDENTIFIED` (neidentifikovane
→ avans dužnika fakture) pa `PAYMENT_ALLOCATED`** — automatski, u istoj radnji; (b) jedan nalog D neidentifikovane / P
potraživanja; (c) zabraniti raspored dok se platilac ne odredi (nova radnja „Odredi platioca”). **Preporuka: (a)** —
avans po vlasniku i neidentifikovane ostaju čisti, a operativni rad se ne mijenja.

**B2-Q5 — Izmjena troška čiji je račun proknjižen.** (a) **iznos, dobavljač, kategorija i datum računa se više ne
mijenjaju — ispravka je storno troška i novi unos** (opis, rok, projekat i ostalo slobodno); (b) izmjena automatski
pravi storno starog i novi `SUPPLIER_INVOICE`. **Preporuka: (a)** — jasan trag i bez skrivenih naloga u zatvorenom
periodu; poruka kaže šta uraditi.

**B2-Q6 — Događaj sa datumom u zatvorenom periodu** (npr. naknadno unesena martovska uplata kad je mart zatvoren).
(a) čeka (WAITING_PERIOD) dok se period ponovo ne otvori; (b) **čeka, uz radnju „Proknjiži u tekući period”** koju
računovođa izričito pokrene (datum dokumenta ostaje martovski, datum knjiženja prvi dan otvorenog perioda); (c) uvijek
automatski u tekući period. **Preporuka: (b)** — ništa se ne prebacuje prećutno (R-9), a ne mora se otvarati period.

**B2-Q7 — Djelimičan raspored na fakturu sa više namjena** kad je pravilo raspodjele „Prvo najstarije dospjele obaveze”.
U okviru jedne fakture „najstarije” ne znači ništa. (a) **„najstarije prvo” se u okviru fakture čita kao redoslijed
linija fakture** (prva linija prva); (b) za podjelu unutar fakture uvijek srazmjerno, a pravilo važi samo za izbor
fakture; (c) takav raspored uvijek čeka ručnu odluku. **Preporuka: (a)** — dosljedno pravilu koje je ZEV izabrao, i
vidljivo u nalogu.

**B2-Q8 — Korekcija salda.** (a) **novo pravilo „Korekcija salda” (jedan protivkonto po ZEV-u, potvrđuje se kao i
ostala), namjena podrazumijevana (kao B1-Q3)**; dok ga nema, korekcija čeka; (b) korekcije se ne knjiže automatski —
računovođa ih knjiži posebnim kontrolisanim nalogom; (c) korekcija bira kategoriju pri unosu. **Preporuka: (a)** —
najmanje promjena u evidenciji; prenos duga sa vlasnika na vlasnika su dvije korekcije pa se protivkonta poništavaju.

**B2-Q9 — Ručna transakcija bez kategorije.** (a) čeka (WAITING_RULE) uz poruku „Izaberite kategoriju”, a
transakcija dobija mogućnost naknadnog izbora kategorije dok nije proknjižena; (b) **kategorija postaje obavezna pri
unosu kad je knjiženje aktivno**. **Preporuka: (b)** — jednostavnije i bez nove radnje; za stare transakcije prije početka
ne važi.
