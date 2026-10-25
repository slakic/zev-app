# F3 — Vlasnik: „Kako da platim” i početna „Za Vas sada” — implementacioni plan

**Status: ISPORUČENO u v2.46.0 (nije commitovano).** Odobreno 2026-10-25, minor → 2.46.0; implementirao Sonnet, pregleda Opus. Korisnik je prihvatio preporuke §7:
- **F3-Q1:** račun za uplate je najstariji aktivan bankovni račun ZEV-a (podešavanje „Račun za uplate vlasnika” tek ako neki ZEV ima više računa).
- **F3-Q2:** svrha uplate „ZEV {period} — {broj fakture}”.
- **F3-Q3:** „uskoro dospijeva” = narednih 14 dana.
- **F3-Q4:** minor → 2.46.0.

 Fazu F3 iz `Plans/design-review-plan.md` §6 korisnik je tražio 2026-10-25 („Da, napravi implementacioni plan za F3”). Faza koristi odluke o dizajn sistemu **D1** (obrazac „Za Vas sada”, opcija A — kompozicija postojećih primitiva) i **D7** (opcija A — krupne vrijednosti sa `select-all`, bez dugmeta „Kopiraj”), obje od 2026-10-25. Nijedan red koda još nije napisan.

Plan je izrađen čitanjem stvarnog koda (v2.45.0). Verzija: prijedlog je **minor → 2.46.0**, uz potvrdu prije upisa.

**Cilj faze:** vlasnik na telefonu, za najviše dva dodira od početne, zna **koliko duguje, do kada i kako da plati**, bez otvaranja PDF-a. Početna prvo pokazuje **ono što traži njegovu radnju**, a tek onda brojeve.

Faza rješava nalaze iz pregleda:
- K5 / V-N01 (uplatni podaci samo u PDF-u);
- V10 / V-N02 (dospjela faktura nije označena);
- dio V11 / V-N03 (glasanje na početnoj);
- V-N11, V-N12, V-N13, V-N14, V-N16, V-N18 i V-N26 (PDF i QR traže ukupan, a ne preostali iznos).

**Granice faze:**
- Nema novih boja, veličina teksta ni težina dugmadi.
- Nema migracije.
- Format poziva na broj i bankarski QR se ne mijenjaju (V-Q4 čeka provjeru sa bankom).
- Dugme „Kopiraj” nije u ovoj fazi (D7 B je kasnija dopuna).

---

## 1. Zatečeno stanje (provjereno u kodu)

| # | Šta | Gdje |
|---|---|---|
| 1 | Uplatni podaci (račun, banka, primalac, svrha) postoje **samo u PDF-u**. Detalj fakture ima samo „Poziv na broj”, kao 12px mono | `src/server/services/documents.ts` (blok fakture, oko `:232-283`); `src/app/(app)/fakture/[id]/page.tsx` kartica „Iznosi” (`:156`) |
| 2 | PDF uzima „prvi” aktivni bankovni račun bez `orderBy`, pa je izbor neodređen kad ZEV ima više računa | `documents.ts` (`accounts: { where: { type: "BANK", active: true } }`, `zev?.accounts[0]`) |
| 3 | PDF i QR koriste **ukupan** iznos (`inv.total`), ne preostali; nakon djelimične uplate traže previše | `documents.ts` („UKUPNO ZA PLAĆANJE”, `qrPayload.iznos`) |
| 4 | „Dospjela” nije status u bazi, nego se računa (`ISSUED` i `dueDate < now`). Detalj prikazuje **dva** chipa („Izdata” i „Dospjela (neplaćena)”) | `fakture/[id]/page.tsx:148-149` |
| 5 | Stavke vlasniku prikazuju interne nazive („Formula”, „Ulazi”: `rate=0.300000, usableArea=15.00`). Svaka stavka ima `allocationBasis` i `inputs` iz kojih se može složiti čitljiva rečenica | `fakture/[id]/page.tsx:20-25, 194`; `src/server/engines/billing.ts:37-100` |
| 6 | Lista faktura vlasnika: sortiranje po broju (plaćene i neplaćene izmiješane), nema kolone „Preostalo” | `fakture/page.tsx:29-40, 311-320`; `billing.ts` `listInvoices` (`:418+`) |
| 7 | „Moje uplate”: ne vidi se na koju fakturu je uplata raspoređena; kolone „Radnje” i „Platilac” su za vlasnika prazne ili suvišne | `fakture/uplate/page.tsx:13, 240` |
| 8 | Početna vlasnika: četiri jednaka `Stat`-a (dva kumulativna „od početka”), dospjela faktura kao sivi 12px „rok …”, šest ravnopravnih kartica; „Predstojeće sjednice” miješa skupštinu i upravni odbor | `src/app/(app)/page.tsx:158-270` (`OwnerDashboard`) |
| 9 | Podaci za „Za Vas sada” već postoje na stranici: neplaćene fakture, otvorena glasanja (i za suvlasnika preko predstavnika), saldo, avans; saglasnost za e-glasanje je na `Party.eVoteConsentStatus` | `page.tsx:164-184` |

---

## 2. Izmjene

### F3.1 Uplatni podaci na jednom mjestu — novi `src/server/services/paymentInstructions.ts`
- **`getPaymentInstructions(actor, invoiceId)`** (vlasnik samo za svoju fakturu, uprava za sve; isti guard kao `getInvoice`). Vraća:

  ```ts
  { recipient: string;            // zev.legalName
    account: { iban: string; bankName: string | null } | null;   // null = ZEV nema aktivan bankovni račun
    total: string; paid: string; remaining: string;               // Decimal → string (formatMoney na stranici)
    reference: string;            // inv.paymentReference ?? inv.number
    purpose: string;              // „ZEV {period} — {broj fakture}”
    dueDate: Date; overdueDays: number;   // 0 kad nije dospjela
    payable: boolean }            // ISSUED i remaining > 0
  ```

- **Račun za uplate:** najstariji aktivan `MoneyAccount` tipa `BANK` (`orderBy: { createdAt: "asc" }`). To je isto pravilo za ekran i PDF, i uklanja neodređenost iz §1.2. Izbor posebnog „računa za uplate vlasnika” u podešavanjima je otvoreno pitanje F3-Q1.
- **Pomoćna čista funkcija `paymentQrPayload(instr)`** sa preostalim iznosom. Koriste je i PDF i (budući) ekran.
- **`documents.ts`:**
  - koristi istu funkciju za račun i iznos;
  - u PDF-u **„ZA UPLATU: {preostalo}”** (uz „Ukupno” i „Plaćeno” kad je bilo uplata);
  - QR nosi preostali iznos (V-N26).

  Oznaka „informativno” na QR-u ostaje.

### F3.2 Detalj fakture (`fakture/[id]/page.tsx`)
- **Kartica „Kako da platim”** ide **prva** ispod zaglavlja kad je `payable` (vidi je i uprava, jer je korisna za upite telefonom). Sadržaj:
  - **Iznos za uplatu:** preostali iznos, `text-2xl font-semibold tabular-nums` (postojeća tipografija `Stat` vrijednosti).
  - **Rok:** „Rok plaćanja: 15.09.2026.”, a ako je prošao: `StatusBadge` „Dospjela (neplaćena)” i rečenica „Rok je bio prije 39 dana.” (13px).
  - **`dl`** sa Primalac, Račun primaoca (+ banka), Iznos, Poziv na broj, Svrha uplate. Vrijednosti su `text-[15px] tabular-nums select-all` (D7 A: jedan dodir označi cijelu vrijednost); poziv na broj **bez** 12px mono.
  - **Napomena (13px):** „Uplatu izvršite u e-bankarstvu ili na šalteru banke. Uplata se u aplikaciji pojavljuje kad računovođa uveze izvod banke.”
  - **„Preuzmi fakturu (PDF)”** kao `BtnLink secondary`, uz isto pravilo za `/api/*` (bez prefetch-a).
  - **Bez bankovnog računa** (`account === null`): umjesto `dl`-a ide rečenica „Podaci za uplatu još nisu uneseni — obratite se predsjedniku ZEV-a.” Upravi se dodaje „Unesite bankovni račun u Podešavanja › ZEV.”
- **Plaćena faktura:** kartica „Plaćanje” sa `StatusBadge` „Plaćena” i „Plaćeno {iznos} uplatom od {datum}.” Uplatni podaci se ne prikazuju, da se izbjegne dupla uplata.
- **Jedan status chip:** kad je dospjela, prikazuje se samo „Dospjela (neplaćena)” (umjesto „Izdata” i „Dospjela”); inače postojeći chip statusa. Isto pravilo važi i za listu (§F3.3).
- **Stavke:**
  - za **vlasnika** tri kolone: Stavka · Osnov obračuna · Iznos;
  - za **upravu** dodatno ostaju „Formula” i „Ulazi”, jer ih računovođa koristi za provjeru;
  - „Osnov obračuna” daje nova čista funkcija `describeChargeLine(snapshot)` u `src/lib/chargeLine.ts`. Za svaki od 9 metoda obračuna složi rečenicu iz `inputs`: npr. „15,00 m² × 0,30 KM/m²”, „Udio 3,40 % × 0,80 KM”, „3 korisnika × 2,50 KM”, „fiksno po jedinici”, „ukupno 120,00 KM ÷ 4 jedinice”. Za nepoznat metod vraća postojeći `allocationBasis`. Brojevi idu sa decimalnim zarezom.
  - Na 375 tri kolone staju bez horizontalnog skrola, pa za ovu tabelu D3 / F8 nije potreban.
- **Vlasniku uplate po fakturi** ostaju kao danas.

### F3.3 Lista faktura i „Moje uplate” za vlasnika
- **`fakture/page.tsx` (grana vlasnika):**
  - podrazumijevano sortiranje: neplaćene prve (dospjele, pa po roku), zatim plaćene po datumu opadajuće. Klik na kolonu i dalje sortira kao danas;
  - kolona **„Preostalo”**;
  - jedan status chip po pravilu iz F3.2;
  - iznad tabele dva `Stat`-a koja su sišla sa početne: „Zaduženo od početka”, „Plaćeno od početka”.
  - **Servis:** `listInvoices` dobija za vlasnika ključ sortiranja `"owner"` (`CASE` po statusu i roku). Za upravu je bez promjene.
- **`fakture/uplate/page.tsx` (grana vlasnika):**
  - kolona **„Raspoređeno na”** sa `RowLink`-ovima na fakture iz alokacija (bez storniranih);
  - za vlasnika se ne prikazuju „Platilac” (uvijek on) ni „Radnje” (uvijek prazne);
  - uprava bez promjene.

### F3.4 Početna vlasnika — „Za Vas sada” (D1 A)
- **Nova čista funkcija `ownerTasks(input)`** u `src/lib/ownerTasks.ts`. Iz podataka koje stranica već učitava (neplaćene fakture sa preostalim iznosom i rokom, otvorena glasanja sa statusom „glasali / niste / zajednica preko predstavnika”, saglasnost za e-glasanje, današnji datum) vraća **rangiranu** listu stavki:
  1. **Dospjele fakture** (najstarija prva). Najhitnija stavka na stranici dobija `primary` „Kako da platim”; ostale `secondary`.
  2. **Glasanja u kojima vlasnik ima glas, a nije se izjasnio** (najbliži rok prvi): „Glasanje: {šifra} — {naslov}”, „do {datum}”, `secondary` „Pogledaj prijedlog”. Ako je listić sjednice poslat, rečenica kaže „Lični link stigao je e-poštom.”
  3. **Uključivanje e-glasanja:** ako postoji otvoreno glasanje, a `eVoteConsentStatus ≠ SIGNED`, ide `tonal` „Uključi elektronsko glasanje” → Podešavanja.
  4. **Fakture koje dospijevaju u narednih 14 dana:** `secondary` „Kako da platim”.
  5. **Suvlasnik koji nije predstavnik:** informativni red „Za Stan 3 glasa Vaš predstavnik {ime}”, bez dugmeta.
- **Prikaz:**
  - `Card title="Za Vas sada"`, odmah ispod `PageHeader`-a;
  - redovi `divide-y` bez unutrašnjih okvira (nema ugniježđene elevacije);
  - svaki red: chip (`StatusBadge`), rečenica (`text-sm`; meta 13px) i jedno dugme;
  - na 375 dugme ide ispod teksta, u punoj širini reda.
- **Prazno stanje (uspjeh):** „Sve je izmireno. Nema glasanja koja čekaju na Vas.” plus „Posljednja uplata: {datum}, {iznos}” ako postoji. Uz to ide `CheckCircleIcon` (postojeća ikona iz `ui.tsx`), bez nove boje.
- **Brojevi ispod liste:** dva `Stat`-a, „Dugujete ukupno” (`warn` / `ok`) i „Avans / preplata”. Kumulativni prelaze na listu faktura (F3.3).
- **Ostale kartice** (Predstojeće sjednice, Moje nedavne uplate, Objavljene odluke, Moje prijave održavanja) ostaju, ispod, sa ovim izmjenama:
  - **Predstojeće sjednice:** samo skupština, osim ako je vlasnik aktivni član upravnog odbora (ili predsjednik); tada i sjednice odbora, sa oznakom tijela (V-N18);
  - **kartica „Otvorena glasanja”** se uklanja, jer su glasanja sada u „Za Vas sada” (V-N03);
  - sav `text-xs` na ovoj stranici postaje `text-[13px]` (rok, datumi, „Link ste dobili e-poštom”).
- **`design-system.md` §4.1:** novi red **„Za Vas sada” (obrazac, ne komponenta)**:
  - jedan po početnoj, uvijek prvi ispod zaglavlja;
  - redovi rangirani po hitnosti, `primary` samo na najhitnijem;
  - prazno stanje kao potvrda;
  - kasnije ga koriste predsjednik (F6) i računovođa (F5).

---

## 3. Testovi
- **`tests/payment-instructions.test.ts`:**
  - preostali iznos nakon djelimične uplate;
  - `payable` je false za plaćenu i storniranu fakturu;
  - najstariji aktivni bankovni račun pobjeđuje, i neaktivni se preskače;
  - bez računa vraća `account: null`;
  - `overdueDays` za dospjelu i nedospjelu fakturu (granica je dan roka, poređenje po kalendarskom danu Europe/Sarajevo);
  - vlasnik ne može tuđu fakturu;
  - `paymentQrPayload` nosi preostali iznos.
- **`tests/charge-line.test.ts`:** `describeChargeLine` za svih 9 metoda iz `engines/billing.ts`, decimalni zarez, i povratak na `allocationBasis` za nepoznat metod.
- **`tests/owner-tasks.test.ts`:**
  - redoslijed: dospjela → glasanje → e-glasanje → uskoro dospijeva;
  - samo jedna stavka ima `primary`;
  - glasano glasanje se ne pojavljuje;
  - suvlasnik koji nije predstavnik dobija informativni red;
  - bez ičega → prazno stanje.
- **`tests/billing.test.ts`:** sortiranje `"owner"` (neplaćene prve).
- **PDF:** postojeći testovi dokumenata ostaju zeleni. Novi test: tekst PDF-a fakture sa djelimičnom uplatom sadrži „ZA UPLATU” sa preostalim iznosom, provjerom izvučenog teksta kao u postojećim testovima dokumenata. Ako takav obrazac ne postoji, test ide preko `paymentQrPayload` i `getPaymentInstructions`.

## 4. Provjera
- **Pipeline:** `export PATH=~/.local/zev-tools/node/bin:$PATH; npm run typecheck && npm run lint && npm test && npm run build`. Dozvoljene su samo 3 zatečene greške u `tests/env.test.ts`.
- **Živi pregled** (svjež build, `next start`, Playwright + Chrome), 1440 i 375:

| Ekran (uloga) | Šta mora biti istina |
|---|---|
| početna (vlasnik Ana: dospjela faktura) | „Za Vas sada” je prvo; dospjela faktura sa „Kako da platim” (jedino `primary`); dva `Stat`-a; nema kartice „Otvorena glasanja” |
| početna (vlasnik bez duga i glasanja; lokalno izmiriti) | prazno stanje „Sve je izmireno” sa posljednjom uplatom |
| početna (vlasnik sa otvorenim glasanjem i bez saglasnosti) | red glasanja i red „Uključi elektronsko glasanje” |
| detalj dospjele fakture (vlasnik, 375) | „Kako da platim” prvo; primalac, račun, iznos, poziv na broj i svrha vidljivi bez PDF-a; jedan dodir označi cijeli račun ili poziv na broj; jedan status chip; stavke u 3 kolone bez horizontalnog skrola |
| detalj plaćene fakture | kartica „Plaćanje”, bez uplatnih podataka |
| djelimično plaćena faktura (lokalno) | iznos za uplatu = preostalo; PDF „ZA UPLATU” = preostalo |
| ZEV bez bankovnog računa (lokalno deaktivirati) | rečenica „Podaci za uplatu još nisu uneseni…”, bez praznog `dl`-a |
| lista faktura (vlasnik) | neplaćene prve, kolona „Preostalo”, dva `Stat`-a iznad |
| „Moje uplate” (vlasnik) | kolona „Raspoređeno na” sa linkovima; nema kolona „Platilac” i „Radnje” |
| detalj fakture (računovođa) | blok „Kako da platim” plus postojeće kontrole; stavke sa „Formula” i „Ulazi” |

- **Mjerilo iz pregleda:** od početne do računa primaoca na 375 su najviše 2 dodira (početna → „Kako da platim” → podaci vidljivi).
- **Nakon pregleda:** `npm run db:reset && npm run db:seed`, brisanje skripti za pregled.

## 5. Isporuka
- Jedan commit, **minor → 2.46.0** (uz potvrdu), `CHANGELOG.md` (Dodato / Izmijenjeno / Ispravljeno, uz napomenu „bez migracije”), status F3 u `Plans/design-review-plan.md`.
- **Implementacija:** po dogovoru (dosad Sonnet po planu, Opus pregleda).

## 6. Rizici
- **PDF fakture sa preostalim iznosom:** ponovo generisan PDF stare djelimično plaćene fakture pokazuje manji iznos od originalnog. To je ispravno za plaćanje, ali finalizovan dokument se ne smije prepisati.
  - Provjeriti kako se PDF fakture generiše i čuva (`ensureInvoiceDocument`, `storeDocument`): ako je finalizovan i verzionisan, novi iznos ide samo u **nove** PDF-ove. Stari ostaju kakvi jesu.
  - **Dopuna pri pregledu (v2.46.0):** dugme za PDF ide preko `ensureInvoiceDocument`, koji pravi novu verziju samo kad je poslije posljednje evidentirana (ili stornirana) alokacija ili je faktura stornirana; PDF plaćene/stornirane fakture nema račun, poziv na broj ni QR.
  - Ovo se provjerava prvo u implementaciji. Ako bi izmjena tražila novu verziju dokumenta, to se izričito prijavljuje.
- **Rangiranje u „Za Vas sada”** mora biti determinističko (čista funkcija sa testovima), da se početna ne „mijenja sama”.
- **Izbor računa za uplate:** ZEV sa više bankovnih računa dobija najstariji. Ako to nije račun za uplate vlasnika, podatak je pogrešan. Zato je F3-Q1 pitanje prije isporuke.

## 7. Otvorena pitanja za korisnika
| # | Pitanje | Opcije | Preporuka |
|---|---|---|---|
| **F3-Q1** | Koji račun se prikazuje vlasnicima za uplatu kad ZEV ima više bankovnih računa? | (a) najstariji aktivan bankovni račun (pravilo iz plana); (b) novo podešavanje „Račun za uplate vlasnika” (Podešavanja › ZEV), sa (a) kao rezervom | **(a) sada**, ako ZEV-ovi imaju jedan bankovni račun; **(b)** ako neki ima više (npr. tekući i fond rezerve) |
| **F3-Q2** | Tekst „Svrha uplate” | (a) „ZEV {period} — {broj fakture}”; (b) „Naknada za održavanje {period}”; (c) podešavanje po ZEV-u | **(a)**: broj fakture u svrsi pomaže uparivanju kad poziv na broj nije prepisan tačno |
| **F3-Q3** | Fakture koje dospijevaju „uskoro” na početnoj | prozor od 7 / 14 / 30 dana | **14 dana** |
| **F3-Q4** | Verzija | minor → 2.46.0 | **minor** |
