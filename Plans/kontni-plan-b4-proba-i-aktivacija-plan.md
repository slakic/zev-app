# Faza B4 — probno knjiženje, aktivacija i provjera cijelog toka

**Status: ODOBRENO 2026-11-22 (korisnik prihvatio sve preporuke B4-Q1–B4-Q7: sve (a)). Implementirano (v3.12.0): probno knjiženje (`ledgerDryRun.ts`, `/knjigovodstvo/proba`), obrada događaja u zadatoj transakciji (`processEventInTx`, `syncEvents(zevId, db)`, savepoint po događaju u probi), kasno uneseni dokumenti, napomena uz aktivaciju, testovi `ledger-dry-run` i `ledger-e2e`, uputstvo 13.11. Odstupanja: (1) „kasno unesen” = zapis (ili storno) nastao poslije trenutka knjiženja početnog stanja (`postedAt`), sa datumom prije početka — ne čuva se oznaka, izvodi se; (2) kad je početno stanje prazno (evidencija bez stanja na dan), proba dodaje tehnički par stavki od 0,01 KM da bi nastavila i to jasno napiše; neuravnotežena razlika se privremeno stavlja na prvo slobodno konto kapitala; (3) razlozi čekanja „čeka prethodni događaj” se grupišu po vrsti događaja (ostali po tekstu razloga); (4) podrazumijevani datum probe: nacrt početnog stanja, inače 1. januar tekuće godine (od decembra sljedeće); (5) poglavlje uputstva je 13.11, a dosadašnja 13.11 i 13.12 su prenumerisana u 13.12 i 13.13. Provjera produkcije (B4-Q6) se radi zasebno, uz izričitu dozvolu, prije 31.12.2026.** Napisan čitanjem koda v3.11.0; nijedan red koda još nije
napisan. Glavni plan: `Plans/kontni-plan-i-knjizenje-plan.md` §6 (migracija postojećih podataka), §11 (R-11:
početak primjene 1.1.2027.); B1: `kontni-plan-b1-nalozi-plan.md` §4 (početno stanje); B2:
`kontni-plan-b2-automatsko-knjizenje-plan.md`; B3: `kontni-plan-b3-izvjestaji-plan.md`.

Cilj: stvarni ZEV može **bez rizika** preći na knjiženje od 1.1.2027. Računovođa prije knjiženja početnog stanja
vidi tačno šta bi se desilo (početno stanje, koji bi se događaji proknjižili, koji bi čekali i zašto, bruto bilans
i usklađivanje), bez ijednog upisa. Poslije aktivacije knjiga ostaje usklađena i kad se dokument iz prethodne godine
unese kasno. Cijeli tok je pokriven jednim testom od početka do kraja.

---

## 1. Zatečeno stanje (v3.11.0)

| Šta §6 traži | Stanje | Gdje |
|---|---|---|
| Postojeća evidencija se ne pretvara u naloge unazad | ispunjeno — događaji samo od datuma početka | `syncEvents` (`onOrAfter`) |
| Plan `ACTIVE`, kontrolna konta, potvrđena pravila | postoji, sa pokrivenošću | `ledgerConfig.ts` `getCoverage` |
| Početno stanje posebnim nalogom, usklađivanje | postoji (B1b); knjiženje traži uravnotežen i usklađen nalog | `openingBalance.ts`, `journal.ts` `postEntryInTx` |
| `AccountingActivation { DRY_RUN \| ACTIVE }` | **ne postoji**; aktivacija = proknjiženo, nestornirano početno stanje | `ledgerStart` (`ledgerEvents.ts`) |
| **Probni režim bez upisa** | **ne postoji**; „Pripremi prijedlog” upisuje nacrt naloga | — |
| Usklađivanje poslije početka | postoji (B3b) | `ledgerReconciliation.ts` |
| `SKIPPED_BEFORE_START` | namjerno izostavljeno (B2, odstupanje 2) | — |

Nalazi iz koda koji utiču na plan:

1. **Probu nije moguće sastaviti iz postojećih funkcija bez upisa.** Šeme knjiženja (`build`) primaju `db` i mogu
   raditi u transakciji, ali `syncEvents`, `processEvent` i `processEvents` koriste globalni `prisma` i svoju
   transakciju. Prethodnik (`requirePosted`) se čita iz tabele događaja, pa proba bez stvarnih redova pogrešno
   kaže „čeka prethodni događaj”. → B4-Q2.
2. **Kasno unesen dokument iz vremena prije početka razdvaja knjigu i evidenciju.** Primjer: početno stanje
   proknjiženo 5.1.2027. na 1.1.2027.; 8.1. računovođa uveze decembarski izvod sa uplatom od 30.12.2026. Uplata
   nema događaj (datum prije početka), a početno stanje je nema (pripremljeno ranije). Usklađivanje od tada
   pokazuje **neobjašnjenu razliku** na računu novca i avansu, a raspored te uplate (događaj od 8.1.) knjiži avans
   koji u knjizi nikad nije nastao. Isto važi za fakturu, račun dobavljača i ručnu transakciju sa datumom prije
   početka. U stvarnom radu (izvodi kasne) ovo je skoro sigurno. → B4-Q5.
3. **Aktivacija je već jednokratna i idempotentna:** jedno nestornirano početno stanje po ZEV-u, ponovna priprema
   zamjenjuje stavke iz evidencije bez dupliranja, poslije storna samo isti datum (ako postoje automatski nalozi).
   Nova tabela bi samo ponovila ovo stanje. → B4-Q1.
4. **Produkcija:** ne znam u kakvom je stanju knjigovodstvo stvarnog ZEV-a na Neonu (dodijeljen plan, demo
   predložak, otvorene godine, pravila). To se provjerava čitanjem, uz tvoju dozvolu, prije aktivacije (§5).

---

## 2. Probno knjiženje (§6 tačka 4)

Nova stranica **Knjigovodstvo → Nalozi → Probno knjiženje** (`/knjigovodstvo/proba`), sa veze na kartici
„Početno stanje” i na stranici početnog stanja dok ono nije proknjiženo. Polje **Datum početka** (podrazumijevano
datum postojećeg nacrta, inače 1. januar tekuće ili sljedeće godine) i dugme **Pokreni probu** (računovođa i
predsjednik — samo čita).

Proba radi **sve kao prava aktivacija, u transakciji koja se na kraju poništava** (B4-Q2 (a)): priprema početno
stanje, proknjižava ga, izvodi i obrađuje sve događaje od datuma početka do danas, pa izračuna izvještaje — i
vrati sve unazad. Rezultat (samo brojevi i spiskovi, ne upisuje se nigdje osim jednog reda u revizorskom tragu
„Pokrenuto probno knjiženje”) prikazuje se na stranici:

1. **Spremnost** (lista provjera sa statusom, B4-Q4): plan aktivan; poslovna godina i otvoren period za datum
   početka; kontrolna konta za sve račune novca, namjene, avanse, neidentifikovane i dobavljače; pokrivenost
   pravila (broj vrsta/kategorija bez potvrđenog pravila); pravilo raspodjele djelimične uplate; potvrda šeme
   rezerve; stavke naknada bez vrste zaduženja.
2. **Početno stanje:** zbir duguje/potražuje, broj stavki iz evidencije po ulozi, razlika koju treba pokriti ručnom
   stavkom, usklađivanje po kontrolnom kontu (ista tabela kao B1b).
3. **Događaji od datuma početka do danas:** po vrsti — koliko bi se proknjižilo, koliko bi čekalo; razlozi čekanja
   grupisani („12 faktura čeka pravilo za vrstu zaduženja REZ”), sa vezom na dokumente.
4. **Bruto bilans danas** kakav bi bio (zbirno po grupi konta) i **usklađivanje na danas** (B3b) — mora biti bez
   neobjašnjene razlike.

Greške iz §6 tačka 4 (neravnoteža, dimenzija iz drugog ZEV-a, neaktivno konto) pokrivaju postojeće kontrole naloga
(`checkLines`) — u probi se prikazuju kao poruka koraka koji je pao, a proba se ne prekida bez izvještaja.

---

## 3. Aktivacija (§6 tačka 6)

Ostaje kao danas: **„Proknjiži” na stranici početnog stanja je aktivacija** (B4-Q1 (a)). Dodaje se:

- prije potvrde u `ConfirmAction` piše šta slijedi („Od {datum} se fakture, uplate i troškovi knjiže automatski;
  događaji od tog dana do danas se odmah obrađuju”) i veza na probu;
- ako proba za isti datum nije pokrenuta u posljednja 24 sata, ispod dugmeta stoji napomena da se preporučuje
  (B4-Q4 (a) — ne blokira);
- poslije knjiženja poruka sa brojem proknjiženih i čekajućih događaja (već postoji iz B2a) i veza na usklađivanje.

---

## 4. Kasno uneseni dokumenti (nalaz 2, B4-Q5)

Dokument sa datumom prije početka knjiženja koji je **nastao poslije knjiženja početnog stanja** (`createdAt >
postedAt` naloga početnog stanja) dobija događaj kao i ostali, sa:

- **datumom dokumenta** = njegov datum (npr. 30.12.2026.);
- **datumom knjiženja** = datum početka knjiženja (1.1.2027.) — kao „Proknjiži u tekući period” (B2-Q6), jer
  period prije početka u knjizi ne postoji;
- oznakom na tabu Događaji i u dnevniku: „Kasno unesen dokument (datum prije početka knjiženja)”.

Isto za storno takvog dokumenta poslije početka (već radi — storno ima svoj datum). Operativni snimak na dan prije
početka se ne mijenja retroaktivno, pa usklađivanje početnog stanja ostaje kakvo je bilo pri knjiženju; usklađivanje
na bilo koji dan od početka (B3b) je ponovo bez razlike.

Za fakturu/uplatu/trošak koji je **izmijenjen** poslije početka a datiran ranije (npr. raspored stare uplate) ništa
se ne mijenja — raspored već ima svoj datum (dan unosa).

---

## 5. Prelaz stvarnog ZEV-a (produkcija)

Redoslijed, koji vodi računovođa kroz aplikaciju (nijedan korak ne radi skripta):

1. **Prije 31.12.2026.** (B4-Q6): provjera stanja na Neonu (samo čitanje, uz tvoju dozvolu): da li je dodijeljen
   pregledani predložak (ne demo), otvorena godina 2027, kontrolna konta, pravila, potvrda šeme rezerve.
2. Računovođa podešava šta nedostaje (tabovi „Pravila knjiženja” i „Poslovne godine”).
3. **Početkom januara 2027.:** proba sa datumom 1.1.2027.; ispravke dok proba ne prođe.
4. Priprema i knjiženje početnog stanja na 1.1.2027. = aktivacija.
5. Prvih nekoliko sedmica: usklađivanje (B3b) bez neobjašnjene razlike; kasni decembarski izvodi idu kroz §4.

U uputstvu se dodaje poglavlje „Prelazak na knjiženje” sa ovim koracima (B4-Q7).

---

## 6. Provjera cijelog toka (test)

`tests/ledger-e2e.test.ts` — jedan ZEV kroz cijelu godinu: plan, pravila, kontrolna konta, evidencija prethodne godine
(fakture, uplate, raspored, neidentifikovana uplata, trošak sa plaćanjem), proba (bez ijednog upisa — broj redova u
`JournalEntry`, `JournalLine`, `AccountingEvent`, `JournalCounter` isti prije i poslije), aktivacija, mjesec rada svim
vrstama događaja (uključujući storna i čekanja koja se kasnije razriješe), kasno unesena uplata iz prethodne godine,
zatvaranje perioda i događaj u zatvoren period, pa na kraju: bruto bilans uravnotežen, usklađivanje bez neobjašnjene
razlike, kartica vlasnika = dug iz evidencije, dnevnik duguje = potražuje.

---

## 7. Otvorena pitanja

**B4-Q1 — Tabela `AccountingActivation`.**
(a) ne uvoditi: aktivacija ostaje proknjiženo početno stanje (`ledgerStart`), proba ne upisuje ništa;
(b) uvesti tabelu po §6 (`DRY_RUN | ACTIVE`, jedinstvena po ZEV-u).
**Preporuka: (a)** — postojeća pravila već daju jednokratnost i idempotentnost (nalaz 3); druga tabela bi bila drugi
izvor istine koji se može razići sa nalogom.

**B4-Q2 — Kako proba radi bez upisa.**
(a) prava obrada u transakciji koja se poništava — `syncEvents`/`processEvent(s)` dobijaju parametar `db`
(transakcija), bez promjene ponašanja van probe;
(b) zasebna simulacija u memoriji (šeme bez tabele događaja, prethodnik se pretpostavlja).
**Preporuka: (a)** — proba je tačno ono što će aktivacija uraditi, istim kodom; (b) bi bila druga implementacija
koja se s vremenom razilazi. Cijena: refaktor potpisa u `ledgerEvents.ts` i duža transakcija (ZEV ima stotine
događaja — sekunde).

**B4-Q3 — Šta proba prikazuje.**
(a) sve četiri cjeline iz §2 (spremnost, početno stanje, događaji, bruto bilans i usklađivanje);
(b) samo spremnost i početno stanje.
**Preporuka: (a)** — najvažnije pitanje za prelaz je „šta će čekati”, a to daje samo obrada događaja.

**B4-Q4 — Da li proba ili spremnost blokira aktivaciju.**
(a) ne blokira — samo preporuka i napomena; blokiraju samo postojeće kontrole (uravnoteženo, usklađeno);
(b) aktivacija dozvoljena tek kad je proba za isti datum prošla bez greške.
**Preporuka: (a)** — događaj bez pravila po dizajnu čeka vidljivo (B2), pa nedostajuće pravilo nije razlog da se ne
počne; blokada bi tjerala da se sve podesi unaprijed i za kategorije koje se rijetko koriste.

**B4-Q5 — Kasno uneseni dokumenti sa datumom prije početka.**
(a) knjiže se na datum početka uz datum dokumenta (§4);
(b) zabraniti unos datuma prije početka knjiženja poslije aktivacije;
(c) ostaviti kako jeste (razlika u usklađivanju).
**Preporuka: (a)** — (b) bi blokirao uvoz decembarskog izvoda u januaru, što je redovan slučaj; (c) trajno kvari
usklađivanje.

**B4-Q6 — Provjera produkcije.**
(a) prije kraja godine pročitam stanje knjigovodstva stvarnog ZEV-a na Neonu (samo `SELECT`, bez ličnih podataka u
izvještaju) i napišem spisak šta nedostaje;
(b) ne diram produkciju — računovođa sam pokreće probu.
**Preporuka: (a)**, uz tvoju izričitu dozvolu u tom trenutku — proba to radi i sama, ali spisak unaprijed daje
računovođi vremena.

**B4-Q7 — Uputstvo za prelaz.**
(a) novo poglavlje „Prelazak na knjiženje” (13.x, prije „Automatsko knjiženje”) sa koracima §5 i probom;
(b) samo dopuna 13.10.
**Preporuka: (a)** — prelaz je jednokratan, ali ga računovođa radi sam i treba mu redoslijed na jednom mjestu.

---

## 8. Isporuka

Jedna minor isporuka (B4), migracija: **ne** uz B4-Q1 (a) (oznaka kasno unesenog dokumenta se izvodi iz datuma, ne
čuva). Testovi: `ledger-dry-run.test.ts` (proba ne upisuje ništa, rezultat = stvarna aktivacija za isti datum),
`ledger-events` dopuna (kasno unesen dokument), `ledger-e2e.test.ts` (§6). Uputstvo, CHANGELOG, dizajn sistem samo ako
stranica probe traži obrazac kojeg nema (lista provjera — vjerovatno postojeći `TaskList`/`StatusBadge`).
