# Faza B3 — izvještaji i usklađivanje

**Status: ODOBRENO 2026-11-22 (korisnik prihvatio sve preporuke B3-Q1–B3-Q9: sve (a)). B3a implementiran (v3.10.0): dnevnik, bruto bilans (sa zbirnim kontima i filterom namjene/projekta), kartica konta, glavna knjiga (CSV), kartice vlasnika i dobavljača, pregled po namjeni i po projektu, pregled storna, CSV svih izvještaja (`ledgerReports.ts`, `/api/knjigovodstvo/izvjestaji/csv`). Odstupanja: (1) iznosi u tabelama izvještaja su bez oznake valute (valuta je u podnaslovu), da kolone ostanu uske; (2) na stranici konta je kartica „Promet konta” sa vezom na karticu, bez salda; (3) pregled po namjeni ne prikazuje namjenu bez ijednog iznosa. B3b implementiran (v3.11.0): usklađivanje na dan po ulozi kontrolnog konta, avansi i neidentifikovane uplate, otvorene stavke po dospijeću, godišnji pregled iz knjige (`ledgerReconciliation.ts`). Odstupanja B3b: (4) objašnjenje razlike (B3-Q5) računa se po ulozi kontrolnog konta (račun novca po računu), ne po kontu — namjena se iz događaja koji čeka ne zna; isto i po vlasniku (avans) i po uplati (neidentifikovane); (5) „čeka knjiženje” obuhvata i događaj sa datumom do dana proknjižen u kasniji period (B2-Q6); (6) analitika u usklađivanju nije posebna kolona — prikazuje se samo kad se razlikuje od knjige; (7) otvorene stavke dobavljača vode na listu troškova (trošak nema svoju stranicu); kontrolni zbir potraživanja navodi i korekcije salda, koje nemaju dospijeće.** Napisan čitanjem koda v3.9.0; nijedan red koda još
nije napisan. Glavni plan: `Plans/kontni-plan-i-knjizenje-plan.md` §4.5, §11 (R-14); B1: `kontni-plan-b1-nalozi-plan.md`;
B2: `kontni-plan-b2-automatsko-knjizenje-plan.md`.

Cilj: ono što je proknjiženo (B1, B2) može se **pročitati, provjeriti i predati** — dnevnik, glavna knjiga,
bruto bilans, kartice po vlasniku/dobavljaču/namjeni, stalno usklađivanje knjige sa evidencijom i pregledi koje
je računovođa tražio u R-14. Svaki iznos vodi do stavke → naloga → izvornog dokumenta. Izvještaji samo čitaju;
ništa se ne knjiži i ne mijenja.

---

## 1. Zatečeno stanje (v3.9.0)

| Šta | Stanje | Gdje |
|---|---|---|
| Tab Knjigovodstvo → **Izvještaji** | „Nije još dostupno” | `knjigovodstvo/page.tsx` (`NotYet`), `ledger.upcoming.reports` |
| Nalozi, stavke sa dimenzijama (vlasnik, jedinica, dobavljač, projekat, namjena, pravilo) | postoje | `JournalEntry`, `JournalLine` |
| Lista naloga po periodu i statusu, detalj naloga, izvor AUTO naloga | postoje | `journal-tab.tsx`, `nalozi/[id]`, `autoEntrySource` |
| Detalj konta | samo podaci konta i radnje nad kontnim planom — **bez prometa** | `konto/[id]/page.tsx` |
| Stanje evidencije na dan (računi novca, fakture po namjeni, korekcije, avansi, neidentifikovane, dobavljači) | postoji | `operationalSnapshot` (`openingBalance.ts`) |
| Usklađivanje knjiga · analitika · evidencija po kontrolnom kontu | postoji, **samo za nalog početnog stanja** | `reconcileOpeningInTx` |
| Događaji na čekanju sa razlogom | postoje | tab Događaji, `listEvents` |
| CSV izvoz | postoji za operativne izvještaje | `toCsv` (`reports.ts`), `/api/izvjestaji/csv` (audit `report.export`) |
| Godišnji izvještaj (PDF, `ANNUAL_REPORT`, „GI”) | postoji, **iz operativne evidencije** | `documents.ts` |
| Zatvaranje poslovne godine | **ne postoji** (zatvaraju se samo periodi) | `journal.ts` `closePeriod` |
| Pravo pregleda | `ledger.view` = predsjednik + računovođa | `accountingCapabilities.ts` |

Nalazi iz koda koji utiču na plan:

1. **Stavka naloga nema dospijeće.** Dospijeće postoji samo na fakturi (`Invoice.dueDate`) i trošku
   (`Expense.dueDate`, neobavezno). Otvorene stavke „po dospijeću” iz same knjige zahtijevale bi zatvaranje
   stavki (uparivanje duguje/potražuje po dokumentu), kojeg u modelu nema. → B3-Q3.
2. **`reconcileOpeningInTx` je skoro opšti**: računa saldo kontrolnih konta iz stavki jednog naloga. Za stalno
   usklađivanje treba isto, ali iz **svih proknjiženih stavki do dana** — ista logika predznaka
   (`isLiability`), iste dimenzije (`DIMENSION_OF`), isti `operationalSnapshot`.
3. **Razlika knjiga ↔ evidencija je normalna dok događaj čeka.** Faktura izdata, a zaduženje čeka pravilo →
   evidencija ima potraživanje, knjiga nema. Bez objašnjenja svaka takva razlika izgleda kao greška. → B3-Q5.
4. **Konto ima prirodu** (`ASSET`, `LIABILITY`, `EQUITY`, `INCOME`, `EXPENSE`, `OFF_BALANCE`), pa se saldo
   može prikazati u prirodnoj strani, a zbirna konta (`postable = false`) mogu sabirati podređena.
5. **Nalog ima dva datuma** — `documentDate` i `postingDate`; period i zatvaranje vežu se za datum knjiženja.
   Događaj iz zatvorenog perioda proknjižen u tekući (B2-Q6) ima datum dokumenta u starom periodu. → B3-Q4.
6. **Godišnji izvještaj za skupštinu već postoji** iz evidencije. Pregled iz knjige ne smije tiho dati drugu
   cifru pod istim imenom. → B3-Q7.
7. **Količina podataka je mala** (ZEV: stotine do par hiljada stavki godišnje) — izvještaji se računaju na zahtjev
   iz `JournalLine` (Prisma `groupBy`/`findMany` uz filter na `entry.status = POSTED`), bez keša i bez nove tabele.
   Postojeći indeks `JournalLine(zevId, accountId)` je dovoljan; indeks `JournalEntry(zevId, status, postingDate)`
   dodaje se samo ako mjerenje pokaže potrebu.

---

## 2. Zajednička osnova

### 2.1 Servis `ledgerReports.ts` (novi)

Svaka funkcija počinje sa `requireCapability(actor, "ledger.view")` i `requireZev(actor)`; čita **samo
`POSTED`** naloge (§4.5). Jezgro:

```ts
type LedgerFilter = {
  from: string; to: string;            // ISO datumi, uključivo (gornja granica kroz endOfDay)
  accountIds?: string[];               // knjižna konta; zbirno konto se razvija u podređena
  partyId?: string; unitId?: string; supplierId?: string; projectId?: string; purposeId?: string;
};
lineQuery(db, zevId, f)                // stavke sa nalogom, kontom i dimenzijama, sortirane po datumu i broju
balances(db, zevId, f)                 // po kontu: početno stanje, duguje, potražuje, završno (Decimal)
naturalBalance(nature, debit, credit)  // ASSET/EXPENSE: D−P; LIABILITY/EQUITY/INCOME: P−D
```

**Početno stanje izvještaja** = proknjiženi `OPENING` nalog(zi) godine + sav promet prije `from`; **promet** = ostali
nalozi u [`from`, `to`]. Tako bruto bilans za cijelu godinu pokazuje PS odvojeno od prometa, kao u knjigovodstvu.

Sav novac je `Decimal` (`money.ts`); iznosi se predaju stranici kao string sa dvije decimale.

### 2.2 Navigacija

Tab **Izvještaji** postaje spisak izvještaja (kartica sa `RowLink` po izvještaju i jednom rečenicom šta pokazuje),
a svaki izvještaj je **podstranica** `/knjigovodstvo/izvjestaji/<izvještaj>` sa `PageHeader backHref` — isti obrazac
kao `konto/[id]`, `pocetno-stanje` i `nalozi/[id]`. Ne uvodi se drugi red tabova (vidi B3-Q2).

Svaka podstranica: `Card` sa `FilterBar` (period: od–do, uz izbor gotovog perioda/godine; dimenzija gdje ima
smisla) iznad `Table`. Brojevi `tabular-nums`, desno poravnati. Bez novih primitiva, boja i veličina teksta.

### 2.3 Praćenje do izvora

- iznos u bruto bilansu → kartica konta za isti period;
- red kartice → nalog (`/knjigovodstvo/nalozi/{id}`);
- nalog → izvorni dokument (postoji: `autoEntrySource`, izvor stavke početnog stanja).

### 2.4 CSV

Nova ruta `/api/knjigovodstvo/izvjestaji/csv?type=…&from=…&to=…` po uzoru na `/api/izvjestaji/csv`:
`isPrefetchRequest` zaštita, `ledger.view`, `toCsv`, audit `ledger.report.export` sa tipom i periodom. Iznosi u
CSV-u sa decimalnom tačkom (kao postojeći izvoz), datumi ISO.

---

## 3. B3a — knjigovodstveni izvještaji

### 3.1 Dnevnik knjiženja

Svi proknjiženi nalozi u periodu, hronološki po datumu knjiženja pa broju: broj (veza), vrsta (ručni, početno
stanje, storno, automatski), datum dokumenta, opis, pa njegove stavke (konto, dimenzija, duguje, potražuje).
Na dnu zbir duguje = zbir potražuje (kontrola). Filter: period, vrsta naloga.

### 3.2 Glavna knjiga i kartica konta

**Kartica konta** = promet jednog konta u periodu: početno stanje, red po stavci (datum, nalog, opis, dimenzija,
duguje, potražuje, **tekući saldo**), završno stanje. Filter po dimenziji (vlasnik, jedinica, dobavljač, projekat,
namjena). Pristup: iz bruto bilansa, iz detalja konta (nova kartica „Promet” na `konto/[id]` sa vezom na
karticu za tekuću godinu) i sa spiska izvještaja (izbor konta).

**Glavna knjiga** = kartice svih konta sa prometom u periodu, jedna ispod druge — korisna uglavnom za CSV i
arhivu; na ekranu se prikazuje kao bruto bilans sa vezama na kartice (vidi B3-Q6).

### 3.3 Bruto bilans

Po kontu: šifra, naziv, početno stanje (D, P), promet (D, P), završno stanje (D, P). Zbirna konta sabiraju
podređena; izbor nivoa prikaza („samo knjižna” / „sa zbirnim”). Na dnu zbirovi — duguje = potražuje u sva tri
para kolona, inače crveno upozorenje (ne smije se desiti, jer okidač ne dopušta neuravnotežen nalog).
Konto bez stanja i prometa se ne prikazuje.

### 3.4 Kartice po dimenziji (analitika)

- **Kartica vlasnika:** stavke sa `partyId` (opciono i jedinica), po kontu (potraživanja po namjeni, avans) —
  saldo duga i avansa vlasnika iz knjige.
- **Kartica dobavljača:** stavke sa `supplierId` na kontu dobavljača.
- **Pregled po namjeni sredstava:** po namjeni (`purposeId`) — zaduženo, naplaćeno, potrošeno, stanje; posebno
  istaknuta zajednička rezerva (R-14 „stanje po namjeni (rezerva)”). Konto rezerve 499.02 je samo jedno od konta
  koje ulazi; pregled ide po dimenziji, ne po kontu.
- **Pregled po projektu** (`projectId`): troškovi projekta iz knjige. Mali dodatak, jer dimenzija već postoji.

### 3.5 Pregled storna i korektivnih naloga

Svi `REVERSAL` nalozi u periodu sa originalom, razlogom, ko je stornirao, i — za automatske — izvorni dokument
(storno fakture, uplate, troška). R-14.

---

## 4. B3b — usklađivanje i pregledi

### 4.1 Stalno usklađivanje (§4.4 „ne samo za početno stanje”)

Na izabrani dan, po kontrolnom kontu: **glavna knjiga** (saldo svih proknjiženih stavki do dana), **analitika**
(isti saldo samo iz stavki sa dimenzijom uloge) i **evidencija** (`operationalSnapshot` na taj dan), uz razliku.
Uopštava se `reconcileOpeningInTx` u `reconcileAt(db, zevId, asOfIso)`; usklađivanje početnog stanja ostaje isto
(poziva istu jezgru nad jednim nalogom).

Za svaki red sa razlikom prikazuje se **objašnjenje** iz događaja na čekanju sa datumom do tog dana (B3-Q5):
„od toga 120,00 KM čeka knjiženje — 3 događaja” sa vezom na tab Događaji. Neobjašnjena razlika je jasno
označena kao greška koju treba istražiti.

Obuhvata R-14 „usaglašavanje banke i blagajne”: red po računu novca (konto računa ↔ stanje računa u
evidenciji). Usaglašavanje sa **izvodom banke** (stanje po izvodu) nije ovdje — aplikacija ne čuva saldo iz izvoda.

### 4.2 Avansi i neidentifikovane uplate

Iz knjige: avans po vlasniku (konto avansa, dimenzija vlasnik) i neidentifikovane uplate (konto, red po uplati
preko izvora naloga), uz zbir koji se poredi sa evidencijom (glavni plan §4.3: „mora se slagati sa
operativnim stanjem”).

### 4.3 Otvorene stavke po dospijeću

Neplaćene fakture vlasnika i računi dobavljača sa dospijećem i starošću (do 30, 31–60, 61–90, preko 90 dana),
po vlasniku odnosno dobavljaču. Izvor po B3-Q3.

### 4.4 Dokumenti koji nisu proknjiženi

Već postoji kao tab Događaji. U B3b se samo povezuje: na spisku izvještaja veza „Dokumenti koji nisu
proknjiženi” vodi na Događaje filtrirane na čekanje, a usklađivanje (4.1) na isti spisak do datuma.

### 4.5 Godišnji pregled za skupštinu

Prihodi, rashodi i utrošak sredstava po namjeni za poslovnu godinu, iz knjige: prihodi i rashodi po kontu
(zbirno do nivoa grupe), pa po namjeni stanje na početku, priliv, utrošak, stanje na kraju. Odnos prema
postojećem godišnjem izvještaju — B3-Q7.

---

## 5. Prava i bezbjednost

- Svi izvještaji: `ledger.view` (predsjednik, računovođa). Vlasnik ne vidi knjigu (ostaje kao danas).
- Svi upiti nose `zevId` iz aktera; dimenzija iz URL-a (`partyId`, `supplierId`, `accountId`) provjerava se da
  pripada ZEV-u — strani ID daje prazan izvještaj, ne grešku sa podacima (dodaje se u `tenant-isolation.test.ts`).
- CSV izvoz se bilježi u audit.

---

## 6. Otvorena pitanja

**B3-Q1 — Podjela isporuke.**
(a) B3a (§3: dnevnik, kartica konta, glavna knjiga, bruto bilans, kartice po dimenziji, pregled storna) pa
B3b (§4: usklađivanje, avansi i neidentifikovane, otvorene stavke, godišnji pregled), svaka kao minor;
(b) sve u jednoj isporuci.
**Preporuka: (a)** — B3a je samostalno korisna i čista (samo čita knjigu); B3b miješa knjigu i evidenciju i ima
više odluka.

**B3-Q2 — Navigacija.**
(a) tab Izvještaji je spisak, svaki izvještaj podstranica (§2.2);
(b) drugi red tabova unutar taba Izvještaji;
(c) izbor izvještaja padajućom listom u `FilterBar`-u.
**Preporuka: (a)** — postojeći obrazac podstranica; (b) bi ugnijezdio tabove, čega u sistemu nema; (c) sakriva
koji izvještaji postoje.

**B3-Q3 — Izvor otvorenih stavki po dospijeću.**
(a) iz evidencije (fakture i troškovi sa dospijećem), sa kontrolnim zbirom prema saldu kontrolnog konta iz
knjige i vezom na nalog svake stavke;
(b) iz knjige, uz uvođenje zatvaranja stavki (uparivanje po dokumentu) — nova kolona i logika u knjiženju.
**Preporuka: (a)** — dospijeće postoji samo u evidenciji, a B2 već garantuje da se knjiga i evidencija slažu po
kontrolnom kontu; (b) je velika izmjena modela bez dobiti za ZEV ove veličine.

**B3-Q4 — Datum po kojem izvještaji biraju period.**
(a) datum knjiženja (`postingDate`) — kao periodi i zatvaranje; datum dokumenta se prikazuje kao kolona;
(b) datum dokumenta.
**Preporuka: (a)** — izvještaj za zatvoren period se onda više nikad ne mijenja, što je i svrha zatvaranja.

**B3-Q5 — Objašnjenje razlike u usklađivanju.**
(a) razlika se automatski raščlanjuje na dio koji čeka knjiženje (događaji na čekanju do dana) i neobjašnjen
ostatak;
(b) prikazuje se samo razlika, a korisnik sam traži uzrok.
**Preporuka: (a)** — bez toga svaka faktura koja čeka pravilo izgleda kao greška, a prava greška se gubi među
njima.

**B3-Q6 — Glavna knjiga na ekranu.**
(a) na ekranu bruto bilans sa vezama na kartice, a glavna knjiga (sve kartice) samo kao CSV;
(b) i na ekranu sve kartice jedna ispod druge.
**Preporuka: (a)** — za ZEV sa 60 konta (b) je stranica od hiljadu redova; CSV je ono što se predaje.

**B3-Q7 — Godišnji pregled za skupštinu.**
(a) novi pregled iz knjige na ekranu i u CSV-u, jasno nazvan („Godišnji pregled iz knjige”), dok postojeći
godišnji izvještaj (PDF iz evidencije) ostaje nepromijenjen; PDF iz knjige kasnije, kad računovođa potvrdi oblik;
(b) postojeći godišnji izvještaj od datuma početka knjiženja prelazi na knjigu;
(c) odmah i PDF iz knjige kao novi dokument.
**Preporuka: (a)** — dvije cifre pod istim imenom bi zbunile skupštinu; oblik dokumenta za skupštinu je
računovodstvena odluka (§10 glavnog plana), ne programerska.

**B3-Q8 — Zatvaranje poslovne godine (R-12).**
(a) van B3: poseban korak (B5) prije prvog kraja godine sa knjiženjem (31.12.2027.), sa razdvajanjem rezultata od
namjenskih salda po R-12;
(b) u B3b.
**Preporuka: (a)** — to je knjiženje, ne izvještaj, traži stručnu potvrdu šeme i neće biti potrebno prije kraja 2027.

**B3-Q9 — Otvorene stavke iz B2b (unos korekcije salda, prenos između računa).**
(a) van B3: mali zaseban korak kad zatreba (obje su operativne radnje sa svojim ekranom i pravilom);
(b) uz B3b.
**Preporuka: (a)** — izvještaji ih ne trebaju, a postojeće korekcije se već knjiže.

---

## 7. Testovi (`tests/ledger-reports.test.ts`)

| Kriterijum | Test |
|---|---|
| samo POSTED | nacrt ne ulazi; storniran nalog i njegov storno oba ulaze i poništavaju se |
| bruto bilans | zbir D = zbir P u PS, prometu i završnom; zbirno konto = zbir podređenih; PS nalog u koloni PS |
| period | promet prije `from` ide u početno stanje; `to` uključuje cio dan (`endOfDay`); datum knjiženja, ne dokumenta |
| kartica konta | tekući saldo u prirodnoj strani; filter po dimenziji; početno + promet = završno |
| analitika | kartica vlasnika = saldo potraživanja vlasnika iz `operationalSnapshot` kad ništa ne čeka |
| usklađivanje (B3b) | sve proknjiženo → razlika 0; faktura čeka pravilo → razlika = iznos, objašnjena događajem; trošak izmijenjen u evidenciji poslije knjiženja (nemoguć, B2-Q5) — nema neobjašnjene razlike |
| izolacija | akter ZEV-a B sa ID-jem konta/vlasnika ZEV-a A dobija prazan izvještaj |
| CSV | audit red `ledger.report.export`; vlasnik dobija 403 |

---

## 8. Dokumentacija

- Uputstvo: novo potpoglavlje 13.12 „Izvještaji” (spisak, kako čitati bruto bilans i karticu, praćenje do
  dokumenta, CSV), u B3b dopuna sa usklađivanjem; dopuna 13.11 (veza na dokumente koji nisu proknjiženi);
  rječnik (bruto bilans, kartica konta, usklađivanje); napomena na vrhu Knjigovodstva.
- `CHANGELOG.md` (Migracija: ne — osim ako se pokaže potreba za indeksom, §1 tačka 7), dizajn sistem samo ako se
  pojavi obrazac kojeg nema (ne očekuje se).
- Ovaj plan: status i odstupanja pri isporuci.
