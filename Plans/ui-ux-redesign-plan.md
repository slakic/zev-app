# UI/UX redizajn — heuristička evaluacija (Nielsen) i vizuelni sistem — plan za pregled

**Status: ODLUKE DONESENE (2026-09-16) — spreman za implementaciju od Faze 0.**
Trenutni obim je **Faza 0, 1, 2, 4 i 6**; Faza 3 (tabele/gustina) i Faza 5
(admin oblast) su **svjesno odložene** (P3), ali njihove odluke su već
donesene (P4, P5, P7, P8) i primjenjuju se čim se te faze pokrenu.
Nastalo na zahtjev korisnika (2026-09-16), nakon puštanja aplikacije u produkciju
na Vercel: „aplikacija treba da bude super upotrebljiva, prijatna oku i laka za
korištenje, bez agresivnih boja". Izrađeno kroz plansku analizu (Opus model,
plan-only prolaz — metodologija u skill-u `opus-plan-sonnet-code`), zasnovano na
stvarnom čitanju koda projekta i na navigaciji kroz živu lokalnu instancu
(`http://localhost:3000`, Docker, prijavljena sesija vlasnika).

Ciljna publika aplikacije je bitna za svaku preporuku ispod: ovo je
**finansijsko-pravni** softver koji koriste **netehnički, često stariji** etažni
vlasnici i predsjednici ZEV-a koji nisu profesionalni upravnici. Mir, čitljivost
i predvidivost su ovdje funkcionalni zahtjevi, ne estetska preferencija.

## Odluke korisnika

Donesene 2026-09-16, kao odgovor na pitanja iz §10:

- **P1 — Primarna boja ostaje `blue-600`.** Bez izmjene brenda; preporuka
  prihvaćena bez izmjene.
- **P2 — Reklasifikacija dugmadi iz §3.6 prihvaćena.** Puna crvena (`danger`)
  ostaje na tačno 3 mjesta u cijeloj aplikaciji (storniranje uplate/fakture,
  suspendovanje ZEV-a), sva tri iza obaveznog koraka potvrde (§3.8). Uključuje
  i pojedinačno potvrđenu promjenu za „Povuci saglasnost za elektronsko
  glasanje" i „Zatvori glasanje i utvrdi rezultat" — oba prelaze na `caution`
  (amber) + potvrda.
- **P3 — Obim: opcija (b), Higijena + hijerarhija.** U obim ulaze Faza 0, 1, 2,
  4 i 6. **Faza 3 (tabele/gustina) i Faza 5 (admin oblast) su van trenutnog
  obima** — najveći pojedinačni dio posla (Faza 3) i vizuelna unifikacija
  admin oblasti (Faza 5) čekaju posebno pokretanje. Napomena: P4, P5, P7 i P8
  ispod su ipak odgovoreni sada, kao odluke koje **već važe za te faze kad se
  pokrenu** — ne treba ih ponovo pitati.
- **P4 — Kad se Faza 5 pokrene: opcija C.** `/admin` dobija `NavShell` sa
  `variant="platform"` — ista školjka, ista dugmad i tabele kao ostatak
  aplikacije, ali vizuelno označena kao platformski nivo (trajna „Super admin"
  oznaka, drugačiji akcenat sidebar-a). Razdvojenost nije bila namjerna kao
  „drugi, ozbiljniji alat" — samo posljedica toga da `NavShell` nije bio
  pogodan za `zevId`-nezavisnu navigaciju kad je admin oblast pisana.
- **P5 — Kad se Faza 3 pokrene: opcija B+C prihvaćena.** Tabele sa >5 kolona
  se ispod `md` prelamaju u kartice po redu (labela: vrijednost), ne ostaju u
  horizontalnom skrolu.
- **P6 — Ikone ostaju ručno crtani inline SVG.** Bez uvođenja biblioteke
  (`lucide-react` ili slično); nedostajuće ikone za nove primitive (§4.3) se
  crtaju u istom stilu (`IconBase`, `strokeWidth 1.6`).
- **P7 — Kad se Faza 3 pokrene: da, prazna stanja koja vode.** `Table` dobija
  `emptyHint` sa konkretnim sljedećim korakom umjesto golog „Nema podataka."
  na svih ~50 tabela.
- **P8 — Kad se Faza 3 pokrene: korisnik organizuje 20-minutnu posmatranu
  sesiju** (predsjednik ili vlasnik, „nađi ovu fakturu na telefonu" ili
  slično) **prije** nego što se tabele/mobilni raspored implementiraju.
  Podsjetiti korisnika kad se Faza 3 bude pokretala.
- **P9 — Riješeno provjerom koda, bez potrebe za pitanjem.** Poruka na
  `podesavanja:256` („mock provajderi") je danas i dalje tačna (produkcioni
  Vercel deployment ima `EMAIL_PROVIDER=mock`), ali je potpuno statična — ne
  čita stvarnu vrijednost `EMAIL_PROVIDER` i tiho će postati netačna čim se
  prebaci na Mailjet. Pošto je trenutno tačna, ostaje u Fazi 6 (copy higijena),
  ne pomjera se u Fazu 0, u skladu sa originalnim uslovom iz P9.
- **P10 — Verzionisanje: niz minor izmjena, jedna po fazi.** Bez major skoka;
  isti obrazac kao `Plans/deployment-portability-plan.md` (2.7.0 → 2.12.0 kroz
  faze). Svaki bump se i dalje potvrđuje sa korisnikom prije isporuke, po
  standardnoj konvenciji iz `CHANGELOG.md`.

---

## 0. Rezime — tri najvažnija nalaza

Ako se iz cijelog dokumenta pročita samo ovo:

1. **„Agresivna boja" nije problem palete — problem je težina dugmadi.**
   Paleta je već suzdržana (slate neutrali, blue-600 primarna, tonalni status
   chipovi `bg-*-50 / text-*-800 / ring-*-600/20`, nigdje zasićena puna boja za
   status — `ui.tsx:56-62`). Ali sistem nudi **samo tri varijante dugmeta**
   (`ui.tsx:120-124`: `primary` solid plavo, `secondary` outline, `danger` solid
   crveno) — dakle tačno dva nivoa glasnoće: **vrlo glasno** i **tiho**. Nema
   ničega između. Posljedica: `danger` (puno `bg-red-600`) se u kodu koristi da
   znači „ozbiljna radnja", a ne „destruktivna radnja". Od **13** poziva
   `variant="danger"` u aplikaciji, najmanje **5 nisu destruktivne** — npr.
   „Evidentiraj prenos" (`vlasnici/page.tsx:215`, obično unošenje podataka o
   prometu jedinice), „Evidentiraj ispravku" (`skupstina/prijedlog/[id]:331`),
   „Kreiraj korektivnu fakturu" (`fakture/[id]:133`), „Označi kao hitno i
   odobri" (`odrzavanje/[id]:206`), „Okončaj mandat"
   (`organi/page.tsx:153` — i to **u svakom redu tabele**). Na inače mirnoj
   stranici jedno puno crveno dugme postaje najglasnija stvar na ekranu bez
   obzira na to koliko je radnja zapravo prioritetna. **Rješenje nije mijenjati
   nijansu crvene — nego uvesti srednje težine i rezervisati punu crvenu za
   stvarno nepovratno.** (§3.6)

2. **Gustina i hijerarhija: aplikacija cijela govori jednim, tihim glasom.**
   Mjereno: **161** upotreba `text-sm` i **111** upotreba `text-xs` naspram
   **12** ukupno `text-lg`/`text-xl`/`text-2xl` (svi naslovi). **Nijedna**
   upotreba `text-base`. Naslov kartice je `text-xs uppercase tracking-wider`
   (`ui.tsx:34`) — 12px verzalom je najteži oblik teksta za čitanje, a to je
   *jedini* signal čemu kartica služi. Uz to, `Table` (`ui.tsx:92`) i `Card`
   (`ui.tsx:33`) **oboje** crtaju `rounded-xl border bg-white shadow-sm`, pa je
   tabela unutar kartice bijela zaobljena kutija u bijeloj zaobljenoj kutiji —
   dvostruka elevacija koja je direktan uzrok utiska „gomila skoro identičnih
   blokova jedan ispod drugog". Tabele idu do **11 kolona** (`zgrade`, posebni
   dijelovi) i **9** (`troskovi:171`), a jedini responzivni mehanizam u cijeloj
   aplikaciji je `overflow-x-auto` na jednom mjestu (`ui.tsx:92`). (§3.3, §4)

3. **Javni, neautentifikovani tokovi su vizuelno siročad — a najviše ih koriste
   najmanje vješti korisnici, pod pravnim posljedicama.**
   `/glasanje/[token]` — jednokratno, nepovratno, bez ispravke — **ne koristi
   nijedan primitiv iz `ui.tsx` osim `Field`/`inputCls`/`SubmitBtn`**; kutije su
   ručno pisane (`rounded-md border border-slate-200`, `:94`, `:108`), nema
   logotipa, tekst prijedloga o kojem se glasa je `text-sm`, a **pravno
   obavezujuća izjava o saglasnosti je `text-xs`** (`glasanje/[token]:121`).
   Nema koraka potvrde prije nepovratnog slanja. Istovremeno, `/login`,
   `/zaboravljena-lozinka` i `/reset-lozinka/[token]` tri puta ponavljaju istu
   ručno pisanu kartu (`login:42`, `zaboravljena-lozinka:30`,
   `reset-lozinka/[token]:44`), bez logotipa — iako `/logo-mark.png` postoji i
   koristi se u sidebar-u (`nav-shell.tsx:170`), i bez slogana — iako
   `app.tagline` („Upravljanje zajednicom etažnih vlasnika") **postoji u
   rječniku i nigdje se ne koristi** (`src/lib/i18n/sr-Latn.ts:7`). (§6)

Sve ostalo u ovom dokumentu je razrada, dokaz ili posljedica ova tri nalaza.

---

## 1. Metod — šta je viđeno uživo, a šta samo u kodu

Bitno je da korisnik zna gdje da provjeri dva puta.

| Stranica / tok | Uživo u ovoj sesiji | Uživo (ranija sesija, orkestrator) | Samo čitanje koda |
|---|---|---|---|
| `/` (vlasnik) | ✓ | ✓ (i predsjednik) | |
| `/podesavanja` (vlasnik) | ✓ | ✓ (predsjednik) | |
| `/organi` | ✓ | ✓ | |
| `/skupstina` | ✓ | ✓ | |
| `/fakture` (vlasnik) | ✓ | ✓ (predsjednik, desktop+375px) | |
| `/login` | | ✓ | ✓ |
| `/zgrade`, `/vlasnici`, `/skupstina/[id]`, `/skupstina/prijedlog/[id]`, `/dokumenti`, `/izvjestaji`, `/admin` | | ✓ | ✓ |
| `/glasanje/[token]`, `/reset-lozinka/[token]`, `/zaboravljena-lozinka` | | | **✓ samo kod** |
| `/troskovi`, `/planovi`, `/planovi/[id]`, `/odrzavanje`, `/odrzavanje/[id]`, `/aktivnosti`, `/fakture/[id]`, `/fakture/serija/[id]`, `/fakture/uplate`, `/fakture/uplate/[id]`, `/podesavanja/audit`, `/podesavanja/poruke`, `/admin/[zevId]`, `/admin/aktivnosti` | | | **✓ samo kod** |

**Šta to znači u praksi:** nalazi o `/glasanje/[token]` (§6.1) su izvedeni iz
JSX-a, ne iz stvarnog ekrana, jer za to treba važeći token iz otvorenog
glasanja. Prije nego što se Faza 4 implementira, vrijedi otvoriti jedan pravi
token link i potvrditi da se stranica zaista tako i ponaša. Isto važi za
`/troskovi` (9 kolona) i `/odrzavanje/[id]`.

Mjerenja u ovom dokumentu (brojevi `text-sm`/`text-xs`, broj `danger` dugmadi,
broj kolona po tabeli, 9 od 85 formi sa progresivnim otkrivanjem) su dobijena
grep-om nad `src/` i ponovljiva su.

---

## 2. Heuristička evaluacija (Nielsen 1–10)

Grupisano po **obrascu**, ne po stranici — isti obrazac se ponavlja na 10+
stranica, pa bi analiza „svaka heuristika × svaka stranica" bila 90% ponavljanja.
Svaka stavka nosi konkretnu referencu `fajl:linija`.

### 2.1 H1 — Vidljivost statusa sistema

**Dobro:**
- `StatusBadge` (`ui.tsx:81-88`) je dosljedno primijenjen na svaki domenski
  status, i **uvijek nosi tekstualnu oznaku pored boje** (`ui.tsx:80` komentar
  to i propisuje). Ovo je ispravno urađeno i ne treba dirati.
- Dashboard `Stat` kartice (`ui.tsx:40-54`) sa tonskom trakom od 1px daju
  pregled stanja na prvi pogled bez vikanja. Ovo je najbolji dio današnjeg
  vizuelnog jezika i **osnova je za sve ostalo**, ne meta za promjenu.
- `Flash` (`ui.tsx:228-241`) ima `role="status"` i ikonu uz boju.

**Slabo:**
- **Nema nijednog indikatora napretka za dugačke procese.** `Flash` poruka
  nestaje pri sljedećem učitavanju; nema „spremam…" stanja ni za jedan Server
  Action. Generisanje PDF izvještaja (`izvjestaji:65`) i kreiranje nacrta serije
  faktura (`fakture:183`) su operacije koje traju sekundama — korisnik ne dobija
  nikakav signal da se išta dešava i prirodno klikne ponovo.
- **`/skupstina/[id]` je devetostepeni linearni proces vođen jednim dugmetom
  koje mijenja naziv** (`skupstina/[id]:120-130`, `NEXT_STATUS` mapa). Korisnik
  vidi samo „sljedeći korak", nikad **gdje je u nizu ni šta slijedi poslije**.
  `StatusBadge` na `:158` kaže trenutni status, ali ne i da je to korak 4 od 9.
  Ovo je najjasniji H1 propust u aplikaciji.
- Skrolabilna tabela (`ui.tsx:92`) nema **nikakvu vizuelnu naznaku** da se
  desno nastavlja — ni sjenke na ivici, ni fade-a. Na 375px korisnik vidi 2,5
  kolone i nema razloga da posumnja da postoji još.
- Vlasnikova kartica „Otvorena glasanja" (`page.tsx:194-206`) kaže „Link ste
  dobili e-poštom" — ali **ne nudi nikakvu radnju**. Slijepa ulica: korisnik
  zna da nešto treba da uradi, i nema šta da klikne. (Ovo je i H7.)

### 2.2 H2 — Podudaranje sistema i stvarnog svijeta

**Dobro:**
- Domenska terminologija je stvarno domenska: „etažni vlasnik", „posebni
  dijelovi", „upravni odbor", „punomoćnik", „fond održavanja". Rječnik
  (`sr-Latn.ts`, 381 linija) je bogat i tačan.
- Formati datuma i novca su lokalizovani (`i18n/index.ts`, `formatDate` →
  `DD.MM.GGGG.`, `formatMoney` → KM).

**Slabo — konkretno i popravljivo:**
- **Tri mjesta u UI-ju pokazuju krajnjem korisniku interne nazive fajlova iz
  repozitorijuma:**
  - `organi/page.tsx:87` — „…vidi `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §Organi
    ZEV`." (potvrđeno uživo)
  - `podesavanja/page.tsx:235` — „Vrijednosti označene u
    `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` — pravna/računovodstvena provjera
    obavezna prije produkcijske upotrebe."
  - `podesavanja/page.tsx:258` — „…opisana je u `.env.example` i README."

  Vlasnik stana nema pojma šta su ti fajlovi ni gdje da ih nađe. Gore: druga
  poruka zvuči kao upozorenje da aplikacija **nije spremna za produkciju** — a
  aplikacija je u produkciji. Ovo je i pitanje povjerenja, ne samo formulacije.
- `podesavanja/page.tsx:256` — „E-mail i Viber rade preko **mock** provajdera".
  „Mock" je programerski termin. (Napomena: nakon uvođenja Mailjet-a po
  `Plans/deployment-portability-plan.md` §7.1 ova poruka može biti i **netačna**
  u produkciji — vrijedi provjeriti.)
- `skupstina/prijedlog/[id]:176` — `hash: a3f9c2…` prikazan bez ikakvog
  objašnjenja šta je to i čemu služi. Isto na `glasanje/[token]:102`
  („otisak sadržaja (SHA-256)"), gdje je publika još manje tehnička.
- `skupstina/prijedlog/[id]:213` — naslov kartice „Glasačka baza i lični linkovi
  (tokeni se čuvaju samo kao hash)". Tačno, ali je to implementacioni detalj u
  naslovu kartice.

### 2.3 H3 — Korisnička kontrola i sloboda (izlaz u slučaju greške)

**Dobro:**
- `PageHeader` ima opcioni `backHref`/`backLabel` (`ui.tsx:15-22`) sa jasnim
  „‹ Nazad".
- Revizorski trag je append-only po dizajnu, i UI to poštuje: ispravka glasa je
  **nova, obrazložena radnja** (`prijedlog:310-333`), ne tiha izmjena. To je
  ispravno i za pravni kontekst neophodno.

**Slabo:**
- **Nijedna nepovratna radnja u aplikaciji nema korak potvrde.** Nijedna.
  „Zatvori glasanje i utvrdi rezultat" (`prijedlog:166`), „Storniraj uplatu"
  (`uplate/[id]:137`), „Storniraj" fakturu (`fakture/[id]:141`), „Povuci
  saglasnost" (`podesavanja:179`), „Suspenduj ZEV" (`admin/[zevId]:343`) —
  sve su jedan klik, bez `confirm`, bez međukoraka. Kombinovano sa nalazom #1
  (najglasnije dugme na ekranu), ovo je stvaran rizik.
- `backHref` se koristi rijetko — većina detaljnih stranica ga ne prosljeđuje,
  pa je jedini izlaz browser-ovo „nazad" ili sidebar.
- Forme se ne mogu odustati: inline forma za dodavanje na `/zgrade` je stalno
  otvorena i nema „Otkaži" (`zgrade:95-101`, `:114-124`, `:165-192`, `:210-228`).

### 2.4 H4 — Dosljednost i standardi

Ovo je **najgušća** heuristika za ovu aplikaciju — nalazi se sami množe.

- **`/admin` koristi potpuno drugu aplikacijsku školjku** (`admin/layout.tsx`):
  bez sidebar-a, bez ikona, običan tekstualni top bar. **Ali:** `admin/layout.tsx:7-10`
  sadrži **eksplicitan komentar** da je to namjerno („a super admin acts at the
  platform level, outside any single ZEV… See docs/multitenancy-plan.md
  §4.3/§8"). Ovo dakle **nije propust nego odluka** — vaganje u §5, ne
  automatska „popravka".
- **Ručno pisana dugmad koja zaobilaze sistem** — 4 mjesta, sva sa `rounded-md`
  (uglasto) umjesto `rounded-full` (pilula) iz `btnBase` (`ui.tsx:116`):
  `izvjestaji:70`, `izvjestaji:88`, `aktivnosti:100`, `admin/aktivnosti:123`.
  Plus dva u `pdf-statement-import.tsx:131,260` koja doslovno kopiraju
  `btnBase` string.
  **Korijenski uzrok je u `ui.tsx`:** `btnBase` (`:115`) i `btnVariantCls`
  (`:120`) **nisu eksportovani**, pa svaka client komponenta koja treba dugme sa
  `disabled`/`onClick` mora da prepiše klase rukom. Popravka je jedna riječ
  (`export`), ali bez nje se duplikat garantovano vraća.
- **Ručno pisana polja koja zaobilaze `inputCls`:** `izvjestaji:68,69,79`
  (`rounded border border-slate-300 px-2 py-1` — bez fokus prstena, bez
  sjenke), `organi:152` (`text-xs` date input unutar reda tabele).
- **Tabovi su ručno pisani na `/skupstina`** (`skupstina/page.tsx:55-71`) —
  nema `Tabs` primitiva, pa je to jedini tab pattern u aplikaciji i ne može se
  ponoviti nigdje drugdje bez kopiranja.
- **Progresivno otkrivanje formi je primijenjeno nasumično.** `ToggleBtn` +
  `<details>` (`ui.tsx:150-161`) je odličan, JS-free obrazac i postoji — ali
  se koristi **9 puta** naspram **85** `<form action={…}>` u aplikaciji.
  Konkretno: `/fakture:114` koristi, a susjedna kartica na istoj stranici
  (`:181`) ne; `/vlasnici:141` koristi za „Dodaj lice", a četiri druge forme na
  istoj stranici (`:167`, `:192`, `:220`, `:255`) su stalno otvorene;
  `/zgrade`, `/organi` i `/podesavanja` ga ne koriste uopšte. Ista stranica
  time uči korisnika dva različita pravila.
- **`Card` i `Table` crtaju isti okvir** (`ui.tsx:33` i `ui.tsx:92`: oboje
  `rounded-xl border border-slate-200/80 bg-white shadow-sm`). Tabela u kartici
  = kutija u kutiji. Ovo je uzrok vizuelnog utiska „ravna gomila skoro
  identičnih blokova".
- **Ritam razmaka nije jedinstven:** `/organi` koristi `space-y-6` + `gap-6`
  (`organi:74,92`), `/zgrade` i `/fakture` koriste `mt-4` + `gap-4`
  (`zgrade:128,197`; `fakture:190`), dashboard koristi `mt-3`/`mt-6`
  (`page.tsx:67,74`). Tri različita vertikalna ritma u istoj aplikaciji.

### 2.5 H5 — Prevencija grešaka

**Dobro:**
- Server-side autorizacija na svakoj radnji (`requireActor("PRESIDENT")` itd.) —
  UI nikad nije jedina brana.
- `/glasanje/[token]` zahtijeva **i** link **i** verifikacioni kod **i**
  potvrdu izjave (`glasanje:28-30, 118-124`) — tri brane za pravno obavezujuću
  radnju. Ovo je dobro dizajnirano.
- Korisne `placeholder` vrijednosti kao primjer formata (`fakture:182`
  „2026-08", `prijedlog:306` „OD-2026-01", `zgrade:187` „54.50").

**Slabo:**
- **Nema potvrde ni za jednu nepovratnu radnju** (vidi H3).
- **„Zatvori glasanje i utvrdi rezultat" (`prijedlog:166`) stoji u zaglavlju,
  iznad podataka na osnovu kojih se ta odluka donosi.** Rezultat kvoruma se
  računa i prikazuje niže na stranici (`:200-207`), unutar druge kartice u
  desnoj koloni. Predsjednik pod vremenskim pritiskom na sjednici vidi prvo
  najglasnije dugme, pa tek onda — ako skroluje — brojeve. Trebalo bi obrnuto.
- Datumi: `organi:152` nudi prazan `<input type="date">` u redu tabele uz
  „Okončaj mandat"; prazna vrijednost znači „danas" (`organi:50`), što nigdje
  ne piše.
- Formе sa 10+ polja bez grupisanja (`fakture:116-165`, 11 polja; `zgrade:165-192`,
  9 polja) povećavaju šansu da se nešto preskoči.

### 2.6 H6 — Prepoznavanje umjesto prisjećanja

**Slabo — ovo je zajedno sa H8 srž problema gustine:**
- **Naslov kartice je `text-xs uppercase tracking-wider text-slate-500`**
  (`ui.tsx:34`) — najsitniji i najteže čitljiv oblik teksta na stranici nosi
  jedinu informaciju o tome čemu kartica služi. Na `/podesavanja` (6 kartica)
  i `/organi` (6 kartica) korisnik mora **pročitati sadržaj** svake kartice da
  bi je razlikovao.
- **Ništa ne sumira tabelu.** Tabela od 40 redova i 11 kolona (`/zgrade`,
  posebni dijelovi) nema ni ukupan broj jedinica, ni zbir površina, ni zbir
  vlasničkih udjela — a zbir udjela koji nije 100% je stvarna greška u podacima
  koju bi korisnik htio da vidi odmah. Izuzetak: `/izvjestaji` **radi** ovo
  dobro — zbir je u naslovu kartice (`izvjestaji:74`, `:160`). Taj obrazac
  treba proširiti, ne izmišljati novi.
- Skrivene kolone iza horizontalnog skrola (H1) su po definiciji „prisjećanje" —
  korisnik mora da pamti da tamo nešto ima.
- `Field` `hint` je `text-xs text-slate-400` (`ui.tsx:201`) — savjet koji
  sprečava grešku je odštampan slabije od svega ostalog na ekranu.

### 2.7 H7 — Fleksibilnost i efikasnost

**Dobro:**
- Sidebar se sažima u „icon rail" i pamti stanje (`nav-shell.tsx:86-107`,
  `localStorage`) — realna ušteda prostora za svakodnevnog korisnika.
- Navigacija je filtrirana po roli (`(app)/layout.tsx:49-52`); vlasnik vidi 8
  stavki umjesto 13. **Ovo radi dobro i treba ga sačuvati kao obrazac.**
- Prebacivanje između ZEV-ova (tenant switcher) se prikazuje samo kad ih ima
  više od jednog (`nav-shell.tsx:80`) — nula troška za 99% korisnika.

**Slabo:**
- **Nijedna tabela nema pretragu, sortiranje ni filter** osim `/izvjestaji`,
  `/aktivnosti` i `/podesavanja/audit`. `/vlasnici` i `/zgrade` sa 40+ redova
  se pregledaju isključivo očima i `Ctrl+F`-om.
- `Pagination` primitiv postoji (`ui.tsx:167-194`) ali se koristi samo na
  log stranicama; liste koje realno rastu (`/fakture`, `/vlasnici`) ga nemaju.
- Vlasnikova kartica „Otvorena glasanja" nema link (vidi H1).
- `/fakture` za **vlasnika** koristi identično zaglavlje tabele kao za
  upravu — 8 kolona (`fakture:192`), uključujući „Dužnik" (uvijek on sam) i
  puno ime zgrade. Potvrđeno uživo: vlasnik sa dvije fakture dobija tabelu
  širine cijelog ekrana u kojoj su dvije kolone konstantne.

### 2.8 H8 — Estetski i minimalistički dizajn

Ovdje se sve gore navedeno sabira. Dokazi:

| Mjera | Vrijednost |
|---|---|
| `text-sm` u `src/` | **161** |
| `text-xs` u `src/` | **111** |
| `text-base` | **0** |
| `text-lg` / `text-xl` / `text-2xl` | 5 / 4 / 3 |
| Tabela sa 11 kolona | `/zgrade` (posebni dijelovi, `zgrade:131-135`) |
| Tabela sa 9 kolona | `troskovi:171` |
| Tabele sa 7–8 kolona | `fakture:91`, `fakture:192`, `dokumenti:58`, `izvjestaji:98`, `fakture/serija/[id]:76`, `admin/page:69` |
| Responzivni mehanizam za sve njih | `overflow-x-auto`, jedno mjesto (`ui.tsx:92`) |
| `<form action>` ukupno | 85 |
| od toga iza progresivnog otkrivanja | **9** |
| `variant="danger"` (puno crveno) | **13** |
| od toga stvarno destruktivnih | ~5–6 |

Dodatno, potvrđeno uživo: **glavni sadržaj nema maksimalnu širinu.**
`nav-shell.tsx:343` je `<main className="min-w-0 flex-1 p-4 md:p-8">`. Na 1440px
i širem, tekstualni pasusi (npr. `organi:82-89`, `podesavanja:148-153`) se
razvlače preko 140+ karaktera po redu — daleko iznad čitljivih 60–75. Istovremeno
stranice sa malo sadržaja (`/skupstina` sa jednom sjednicom, `/podesavanja` za
vlasnika) izgledaju prazno i nedovršeno, jer su dvije kartice zalijepljene uz
gornji lijevi ugao ogromnog praznog platna. To je isti utisak koji je
`/login` ostavio — i isti uzrok.

### 2.9 H9 — Prepoznavanje, dijagnostika i oporavak od grešaka

**Dobro:**
- `ERR_TEXT` mape na javnim stranicama (`glasanje/[token]:12-21`,
  `reset-lozinka/[token]:10-15`) su **odlične**: objašnjavaju šta se desilo i
  šta uraditi („Koristite najnoviji link koji ste dobili"). Ovo je bolje od
  prosjeka industrije i ne treba dirati.
- `/reset-lozinka` nudi izlaz iz greške („Zatraži novi link", `:53-55`).
- `/zaboravljena-lozinka` namjerno ne otkriva da li nalog postoji (`:1-3`) —
  bezbjednosno ispravno, i poruka je formulisana tako da ne zbuni.

**Slabo:**
- **Greške servisnog sloja se prosljeđuju sirove u URL i prikazuju kao takve.**
  Obrazac `redirect(?err=${encodeURIComponent(e.message)})` se ponavlja
  desetinama puta (`prijedlog:19,31,48,65,78,99,115`; `organi:23,38,54`;
  `zgrade`, `podesavanja:51,67,81`…). Koliko je ta poruka razumljiva zavisi od
  toga kako je napisan `throw` duboko u servisu — što nije UI odluka i nije
  provjereno ni na jednom mjestu. Ovo je H9 rizik koji ne može da se ocijeni
  bez prolaska kroz stvarne poruke.
- **Greška se prikazuje na vrhu stranice, a forma koja je greškom popunjena je
  niže i prazna** — jer `redirect` briše unos. Korisnik gubi sve što je
  otkucao. To je najbolniji obrazac u cijeloj aplikaciji za formu od 11 polja
  (`fakture:116-165`).
- `Flash` ima `role="status"`; za greške bi trebalo `role="alert"`
  (`ui.tsx:232`).

### 2.10 H10 — Pomoć i dokumentacija

**Dobro:**
- Kontekstualna objašnjenja postoje i ponegdje su izvrsna: `izvjestaji:90-96`
  objašnjava šta znači pozitivan/negativan saldo; `organi:136` objašnjava
  posljedicu postavljanja novog nosioca funkcije; `skupstina/[id]:267-269`
  objašnjava nepromjenjivost zapisnika. Ovo je prava domenska pomoć na pravom
  mjestu.

**Slabo:**
- Sva ta pomoć je odštampana u `text-xs text-slate-400/500` — dakle tekst koji
  najviše pomaže je vizuelno najtiši.
- **Nema ničega za prvi put.** Nema onboarding-a, nema praznog stanja koje vodi.
  `Table` prazno stanje je doslovno „Nema podataka." (`ui.tsx:103`) — isto za
  svaku od 50 tabela u aplikaciji, i nikad ne kaže **šta uraditi da podataka
  bude**. Novi predsjednik koji prvi put otvori `/zgrade` dobija četiri prazne
  tabele koje sve kažu istu rečenicu.
- `/login` ne govori **šta je ovo** — ni šta je „ZEV upravnik", ni ko treba da
  se prijavi, ni šta da radi neko ko nema nalog (a vlasnici naloge dobijaju od
  predsjednika, što niko ne kaže).

---

## 3. Vizuelni sistem — prijedlog tokena

Polazište: **evolucija postojećeg Tailwind v4 + Material-ish sistema.** Nema
nove biblioteke, nema komponentnog framework-a, nema promjene fonta. Aplikacija
je u produkciji.

### 3.1 Šta se zadržava bez izmjene (i zašto to treba reći naglas)

- **Roboto** (self-hosted, `globals.css:2-4`) — neutralan, dobro čitljiv,
  već ima 400/500/700.
- **Slate neutrali + blue-600 primarna** — mirno, profesionalno, ne „banka iz
  2005." Nema razloga za promjenu brenda (ali vidi P1 u §10).
- **Tonalni status chipovi** (`ui.tsx:56-62`) — `bg-*-50 / text-*-800 /
  ring-*-600/20`. Ovo je tačno ono što se traži pod „bez agresivnih boja" i
  već je urađeno. Ne dirati.
- **`Stat` kartica sa 1px tonskom trakom** (`ui.tsx:40-54`) — najbolji postojeći
  element. Postaje **referentni uzor** za gustinu i za količinu boje koju
  element smije da nosi.
- **Ikone: hand-drawn monochrome inline SVG** (`nav-icons.tsx`, 16 ikona,
  `IconBase` sa `strokeWidth 1.6`) — koherentne, bez zavisnosti. Vidi P6 u §10
  prije bilo kakve promjene.
- **Pilula (`rounded-full`) kao oblik dugmeta** (`btnBase`, `ui.tsx:116`) —
  već je karakter aplikacije; uglasta ručno pisana dugmad (§2.4) se poravnavaju
  na ovo, ne obrnuto.

### 3.2 Uloge boja — konkretni tokeni

Tailwind v4 je CSS-first (`@import "tailwindcss"`, nema `tailwind.config.js`),
pa se tokeni deklarišu kroz `@theme` u `globals.css`. Danas taj blok **ne
postoji**, a dvije varijable koje postoje (`--background`, `--foreground`,
`globals.css:6-9`) se **nigdje ne koriste** (`layout.tsx:21` hardkoduje
`bg-slate-50 text-slate-900`). Dakle: tokenskog sloja danas nema uopšte.

| Uloga | Token | Vrijednost | Kada se koristi |
|---|---|---|---|
| Platno | `--color-canvas` | `#f8fafc` (slate-50) | pozadina stranice |
| Površina | `--color-surface` | `#ffffff` | kartice, redovi tabele |
| Površina 2 | `--color-surface-sunken` | `#f8fafc` | zaglavlje tabele, sažeci unutar kartice |
| Ivica | `--color-border` | `#e2e8f0` (slate-200) | sve ivice |
| Ivica jaka | `--color-border-strong` | `#cbd5e1` (slate-300) | ivica polja za unos |
| Tekst jak | `--color-ink` | `#0f172a` (slate-900) | naslovi, iznosi |
| Tekst | `--color-ink-body` | `#334155` (slate-700) | **novi podrazumijevani tekst** |
| Tekst tih | `--color-ink-muted` | `#64748b` (slate-500) | meta, labele, pomoć |
| Tekst vrlo tih | `--color-ink-faint` | `#94a3b8` (slate-400) | **samo dekorativno; nikad za sadržaj** |
| Primarna | `--color-primary` | `#2563eb` (blue-600) | jedna glavna radnja po ekranu |
| Primarna hover | `--color-primary-hover` | `#1d4ed8` (blue-700) | |
| Primarna tonalna | `--color-primary-soft` | `#eff6ff` (blue-50) | aktivna nav stavka, tonalno dugme |
| Primarna tekst | `--color-primary-ink` | `#1d4ed8` (blue-700) | linkovi, tonalni tekst |
| Uspjeh | `--color-success` | `#059669` (emerald-600) | traka, ikona |
| Uspjeh tonalni | `--color-success-soft` | `#ecfdf5` / `#065f46` | chip, uspješan flash |
| Upozorenje | `--color-warning` | `#d97706` (amber-600) | traka, ikona |
| Upozorenje tonalno | `--color-warning-soft` | `#fffbeb` / `#92400e` | chip, **„caution" dugme** |
| Opasnost | `--color-danger` | `#dc2626` (red-600) | **samo nepovratno uništavanje** |
| Opasnost tonalna | `--color-danger-soft` | `#fef2f2` / `#991b1b` | chip greške, flash greške |

**Dvije ciljane izmjene u odnosu na danas** (sve ostalo su imena za ono što već
postoji):

1. `slate-400` prestaje da bude boja sadržaja. Kontrast `#94a3b8` na bijeloj
   je **≈2,8:1** — ispod WCAG AA praga 4,5:1 za normalan tekst. Danas se
   koristi za stvari koje korisnik mora pročitati: `Field` hint (`ui.tsx:201`),
   prazno stanje tabele (`ui.tsx:103`), prazna stanja na dashboard-u
   (`page.tsx:76,92,103,114,127,178,195,208,226,236,247`), `rolesText` u
   nalogu (`nav-shell.tsx:264`), hash (`prijedlog:176`). Sve to ide na
   `slate-500` (`#64748b`, ≈4,76:1 — prolazi, tijesno) ili na `slate-600`
   gdje je tekst zaista važan.
2. `amber` dobija **novu ulogu kao boja „oprezno, ali ne destruktivno"** —
   danas postoji samo kao status chip. To je ključ za §3.6.

### 3.3 Tipografska skala

Danas ne postoji skala — postoje `text-sm` i `text-xs`, plus tri naslova.
Prijedlog (Tailwind v4 `@theme`, uz zadržavanje postojećih imena gdje ima
smisla):

| Uloga | Danas | Prijedlog | px / line-height | Gdje |
|---|---|---|---|---|
| Naslov stranice | `text-2xl` 600 | bez izmjene | 24 / 1.25 | `PageHeader` `ui.tsx:23` |
| Podnaslov stranice | `text-sm` slate-500 | `text-[15px]` slate-500 | 15 / 1.5 | `ui.tsx:24` |
| **Naslov kartice** | **`text-xs uppercase tracking-wider` slate-500** | **`text-sm` (14) semibold slate-700, bez `uppercase`** | 14 / 1.4 | `ui.tsx:34` — **najvažnija pojedinačna izmjena u ovoj sekciji** |
| Tijelo | `text-sm` (14) | **`text-[15px]`** | 15 / 1.6 | podrazumijevano na `body` |
| Ćelija tabele | `text-sm` (14) | `text-sm` (14) / 1.5 | 14 | `ui.tsx:93` — zadržati 14, ali povećati `py` |
| Zaglavlje tabele | `text-xs uppercase` slate-500 | `text-xs` (12) semibold slate-600, **zadržati `uppercase`** | 12 / 1.3 | `ui.tsx:97` — ovdje verzal radi (kratke riječi, skenira se) |
| Labela polja | `text-sm` 500 slate-700 | bez izmjene | 14 | `ui.tsx:199` |
| Pomoć / hint | `text-xs` slate-400 | **`text-[13px]` slate-500** | 13 / 1.5 | `ui.tsx:201` |
| Meta / caption | `text-xs` slate-400/500 | `text-[13px]` slate-500 | 13 | razni |
| Status chip | `text-xs` 500 | `text-[13px]` 500 | 13 | `ui.tsx:84` |
| Numerički | `tabular-nums` | bez izmjene | | već ispravno |

**Pravilo koje se zapisuje u `ui.tsx` kao komentar i poštuje:** `text-xs` (12px)
je dozvoljen **samo** za zaglavlja tabela i za oznake koje korisnik ne mora
pročitati da bi obavio posao. Nijedna rečenica koja objašnjava, upozorava ili
nudi izbor ne smije biti ispod 13px.

**Očekivana posljedica koju treba prihvatiti unaprijed:** sve stranice postaju
**duže**. Za tabele od 9–11 kolona postaju i **gore** dok se §4.2 ne uradi —
zato §11 vezuje Fazu 0 i Fazu 3 u isti ciklus objave.

### 3.4 Ritam razmaka i širina sadržaja

- Baza 4px (Tailwind podrazumijevano). **Dozvoljene vrijednosti za vertikalni
  ritam: 4 / 8 / 12 / 16 / 24 / 32.** Danas se koriste `mt-2`, `mt-3`, `mt-4`,
  `mt-6`, `space-y-6`, `gap-3`, `gap-4`, `gap-6` naizmjenično.
- **Jedno pravilo za razmak između sekcija stranice: `space-y-6` (24px) na
  korijenskom `<div>` stranice.** Time nestaju sve `mt-4` omotnice
  (`zgrade:128,197`, `fakture:190`, `prijedlog:212,258,301`, …) i stranica
  dobija jedan ritam. `/organi:74` to već radi — to je uzor.
- Razmak unutar grid-a kartica: `gap-5` (20px), umjesto današnjih `gap-3`/`gap-4`/`gap-6`.
- Padding kartice: `p-5` (20px) za guste kartice sa tabelom, `p-6` (24px) za
  kartice sa tekstom/formom.
- **Maksimalna širina sadržaja:** `nav-shell.tsx:343` dobija
  `mx-auto w-full max-w-[1440px]`. Tekstualni pasusi unutar kartica dobijaju
  `max-w-[68ch]`.

### 3.5 Elevacija — tri nivoa, i nikad ugniježđeno

| Nivo | Stil | Koristi se za |
|---|---|---|
| 0 | `border border-slate-200` bez sjenke | **sadržajne kartice** (`Card`), tabele unutar kartice |
| 1 | `border border-slate-200 shadow-sm` | elementi koji „stoje iznad" platna: `Stat`, `Flash`, sticky top bar |
| 2 | `shadow-xl ring-1 ring-slate-900/5` | isključivo overlay-i: dropdown naloga (`nav-shell.tsx:256`), mobilni drawer (`:160`) |

**Pravilo:** element nivoa 0 ili 1 **nikad** ne sadrži drugi element istog ili
višeg nivoa. Konkretno: `Table` unutar `Card` gubi svoj okvir i sjenku i postaje
`overflow-hidden rounded-lg` sa samo gornjom ivicom na `thead` — jedan okvir
umjesto dva. `Table` van kartice (ako takvih ima) zadržava okvir. To se rješava
`inset` prop-om na `Table`, ne novom komponentom.

### 3.6 Težina dugmadi — pravilo koje rješava „agresivne boje"

Ovo je najvažnija sekcija dokumenta.

**Dijagnoza još jednom:** sistem ima 3 varijante (`ui.tsx:120-124`) i time samo
dva nivoa glasnoće. Autor stranice koji hoće da kaže „ovo je ozbiljno" ima na
raspolaganju jedino `danger` — puno `bg-red-600`. Otuda 13 crvenih dugmadi od
kojih pola nije destruktivno.

#### Razmotrene opcije

| # | Opcija | Za | Protiv | Ocjena |
|---|---|---|---|---|
| A | Ostaviti 3 varijante, samo omekšati crvenu (npr. `red-500` umjesto `red-600`) | Trivijalno; jedna linija | **Ne rješava ništa** — problem je što je jedno dugme na stranici 5× glasnije od svega ostalog bez obzira na nijansu. Omekšana crvena i dalje dominira mirnom slate stranicom, samo malo manje. Uz to stvarno destruktivne radnje gube signal. | ✗ |
| B | Uvesti 5 težina (`primary`, `tonal`, `outline`, `ghost`, `danger`) + novo značenje `caution` | Autor stranice dobija vokabular za „ozbiljno ali nije uništavanje"; puna crvena postaje rijetka i time ponovo znači nešto; poštuje Material-ish osnovu (filled / tonal / outlined / text je doslovno M3 skala) | Zahtijeva prolazak kroz svih 13 `danger` + ~40 `primary` poziva i odluku po svakom | **✓ preporuka** |
| C | B + veličine (`sm`/`md`/`lg`) | Više kontrole | Otvara novu osu neusklađenosti; danas jedna veličina radi svuda | Odložiti; vidi §3.7 (jedna izmjena visine za tap target je dovoljna) |
| D | Ukloniti `danger` u potpunosti, sve destruktivno iza koraka potvrde u neutralnoj boji | Najmirnije | Gubi se signal ozbiljnosti na mjestu odluke; za pravni/finansijski softver to je previše | ✗ |

#### Preporuka: opcija B — pet težina, jasno pravilo upotrebe

| Težina | Stil | Pravilo upotrebe |
|---|---|---|
| **`primary`** — puna | `bg-primary text-white shadow-sm` (danas) | **Najviše jedno po ekranskoj regiji.** Očekivani sljedeći korak. Ako su dva, jedan nije primaran. |
| **`tonal`** *(novo)* | `bg-blue-50 text-blue-700 hover:bg-blue-100` | Podržavajuća radnja koja se često koristi: „Dodaj stavku", „Sačuvaj" unutar kartice, „Primijeni filter". **Ovo je nova podrazumijevana težina za većinu formi u kartici** i najveći pojedinačni izvor smirivanja stranice. |
| **`outline`** — današnji `secondary` | `border-slate-300 bg-white text-slate-700` | Neutralne, sporedne radnje: „Izvoz PDF", „Nazad", paginacija. Ostaje kako jeste. |
| **`ghost`** *(novo)* | `text-slate-600 hover:bg-slate-100`, bez ivice | Radnje u redu tabele. Zamjenjuje današnje golo `<button className="text-xs text-blue-700 hover:underline">` (`prijedlog:233,239`; `admin/page:97`) i daje im pravi tap target. |
| **`caution`** *(novo)* | `border-amber-600/40 bg-amber-50 text-amber-900 hover:bg-amber-100` | **Ozbiljno, ali nije uništavanje podataka.** Ovo preuzima većinu današnjih `danger` poziva. |
| **`danger`** — puna crvena | `bg-red-600 text-white` (danas) | **Samo:** nepovratno uništavanje ili poništavanje novca/prava. **I obavezno iza koraka potvrde** (§3.8). |

#### Reklasifikacija svih 13 današnjih `danger` poziva

| Mjesto | Tekst | Danas | Prijedlog | Obrazloženje |
|---|---|---|---|---|
| `fakture/uplate/[id]:137` | Storniraj uplatu | danger | **danger + potvrda** | poništava evidentiran novac |
| `fakture/[id]:141` | Storniraj | danger | **danger + potvrda** | poništava izdatu fakturu |
| `admin/[zevId]:343` | Suspenduj ZEV | danger | **danger + potvrda** | gasi pristup cijelom ZEV-u |
| `podesavanja:179` | Povuci saglasnost za e-glasanje | danger | **caution + potvrda** | gubi se pravo, ali se može ponovo steći; **i nije primarni zadatak posjete podešavanjima** — vizuelno najglasniji element mirne stranice danas |
| `vlasnici/[id]:299` | Povuci saglasnost (predsjednik) | danger | **caution + potvrda** | isto |
| `prijedlog:166` | Zatvori glasanje i utvrdi rezultat | danger | **caution + potvrda sa sažetkom kvoruma** | nepovratno, ali je to **normalan i očekivan** korak procesa, ne greška; vidi §3.8 |
| `prijedlog:295` | Kreiraj novu verziju | danger | **caution** | poništava izdate linkove; ozbiljno, ali konstruktivno |
| `prijedlog:331` | Evidentiraj ispravku | danger | **tonal** | append-only ispravka uz razlog i osnov — ništa se ne uništava, trag ostaje |
| `fakture/[id]:133` | Kreiraj korektivnu fakturu | danger | **tonal** | kreira novi dokument; ne briše ništa |
| `vlasnici:215` | Evidentiraj prenos | danger | **tonal** | obično unošenje podataka o prometu jedinice |
| `organi:153` | Okončaj mandat | danger | **ghost** ili **caution**, i **ne u svakom redu** | danas je puno crveno dugme u **svakom redu** tabele upravnog odbora — najveći izvor „crvenila" po površini ekrana u aplikaciji |
| `odrzavanje/[id]:199` | Hitna intervencija (ToggleBtn) | danger | **caution** | otkriva formu; već je iza `<details>` |
| `odrzavanje/[id]:206` | Označi kao hitno i odobri | danger | **caution** | preskače odobrenje — ozbiljno, ne destruktivno |

Neto rezultat: **3 puna crvena dugmeta u cijeloj aplikaciji** umjesto 13, i sva
tri iza potvrde. To je „bez agresivnih boja" dobijeno disciplinom hijerarhije, a
ne promjenom palete.

### 3.7 Tap target i fokus (netehnički, stariji korisnici)

- `btnBase` je danas `px-4 py-1.5 text-sm` (`ui.tsx:116`) → visina ≈**30px**.
  WCAG 2.5.5 traži **44×44px**. Prijedlog: `px-4 py-2.5 text-sm` →
  ≈**40px**, uz `min-h-[44px]` na dodirnim ekranima (`max-md:min-h-[44px]`).
- Golo tekstualno dugme u redu tabele (`prijedlog:233,239` — „ponovo izdaj" i
  **„opozovi"** jedno pored drugog sa `gap-1`, oba `text-xs`) je meta od ≈16px
  visine, a jedno od njih je destruktivno. Prelazi na `ghost` varijantu sa
  punim tap targetom i većim razmakom.
- Radio dugmad na `/glasanje/[token]:113-115` su podrazumijevane veličine
  (≈13px) — za stranicu koju koristi 80-godišnjak jednom u životu. Vidi §6.1.
- Fokus prsten postoji na dugmadi i poljima (`btnBase`, `inputCls`), ali **ne**
  na nav linkovima (`nav-shell.tsx:139-146`) ni na tekstualnim linkovima u
  tabelama. Dodati globalni `:focus-visible` stil u `globals.css`.
- Skrolabilni kontejner tabele (`ui.tsx:92`) nije fokusabilan — sadržaj desno
  od ivice je **nedostupan tastaturom**. Dodati `tabIndex={0}` +
  `role="region"` + `aria-label`.

### 3.8 Obrazac potvrde bez ijedne linije novog JS-a

Aplikacija je gotovo u cjelosti server-rendered, bez client state-a. `confirm()`
bi tražio `"use client"` na desetinama stranica. Ali obrazac već postoji:
**`<details>` + `ToggleBtn`** (`ui.tsx:142-161`).

Prijedlog: novi primitiv `ConfirmAction` u `ui.tsx` koji je isti `<details>`
obrazac, ali sa semantikom potvrde:
<ConfirmAction
trigger="Zatvori glasanje i utvrdi rezultat" // caution težina
title="Zatvaranje glasanja je nepovratno"
body={<QuorumSummary … />} // ono što korisnik mora vidjeti
confirmLabel="Da, zatvori glasanje" // danger/caution težina
action={closeVotingAction}
/>

Za `prijedlog:166` ovo usput rješava i H5 nalaz iz §2.5: **stanje kvoruma se
prikazuje unutar panela potvrde**, dakle tačno u trenutku odluke — umjesto da
bude u drugoj kartici niže na stranici.
Za `admin/[zevId]:343` („Suspenduj ZEV") panel može tražiti da se ukuca
skraćeni naziv ZEV-a — standardni obrazac za radnje sa širokim posljedicama.
---
## 4. Gustina informacija i hijerarhija
### 4.1 Obrazac „lista + forma" (nalaz o gustini)
Obrazac danas: `Card` → `Table` → odmah ispod, u istoj kartici, forma za
dodavanje. Ponavlja se na `/zgrade` (4×), `/vlasnici` (5×), `/troskovi`,
`/fakture`, `/organi` (2×), `/podesavanja` (2×), `/skupstina/[id]`, `/planovi/[id]`.
#### Razmotrene opcije
| # | Opcija | Za | Protiv | Ocjena |
|---|---|---|---|---|
| A | Ostaviti; samo povećati razmake | Nula rizika | Ne rješava ništa — problem je što je forma od 9–11 polja vizuelno jednako važna kao lista koju korisnik gleda | ✗ |
| B | **Dosljedno progresivno otkrivanje** — svaka „dodaj" forma iza `ToggleBtn`/`<details>` | Obrazac **već postoji u projektu** i radi bez JS-a; primijenjen na svih 85 formi ukida 2/3 vizuelne gustine odjednom; jedna dosljedna priča umjesto današnjih 9-od-85 | Jedan klik više za korisnika koji stalno dodaje; treba proći kroz ~20 mjesta | **✓ preporuka** |
| C | Forma u modalu/dijalogu | Najčistija lista | Zahtijeva client komponentu i upravljanje fokusom na svakoj stranici; `<dialog>` + Server Actions je izvodljivo ali je novi obrazac za cijeli tim; a11y teret | ✗ za sada |
| D | Forma na zasebnoj ruti (`/zgrade/nova`) | Najčišće; deep-linkable; nema JS | Puno novih ruta (~20); gubi se kontekst liste; više navigacije za česte unose | Razmotriti samo za najveće forme (11 polja, `fakture:116`) |
| E | B + grupisanje polja unutar otkrivene forme (`<fieldset>` sa legendom) | Forma od 11 polja postaje 3 grupe od 4 | Malo više markupa | **✓ uz B**, za forme sa >6 polja |
#### Preporuka: B + E, uz D kao izuzetak
- **B:** svaka forma za kreiranje ide iza `ToggleBtn`. Konkretno, nedostaje na:
  `zgrade:95, :114, :165, :210`; `organi:119, :164`; `vlasnici:167, :192, :220,
  :255`; `podesavanja:215`; `fakture:181`; `skupstina/[id]:174, :248`.
- **E:** `fakture:116-165` (11 polja) i `zgrade:165-192` (9 polja) dobijaju
  `<fieldset>` grupe: „Osnovno" / „Obračun" / „Dospijeće i prikaz".
- **Sažetak iznad svake tabele** (rješava H6): obrazac sa `/izvjestaji:74` —
  ključni zbir u naslovu kartice. Za `/zgrade` posebne dijelove: „38 jedinica ·
  2.140,50 m² · **ukupan udio 100,00 %**" — pri čemu udio različit od 100%
  nosi `warning` ton. To je jedan podatak koji predsjedniku vrijedi više od
  cijele tabele.
- **Prazna stanja koja vode** (rješava H10): `Table` dobija opcioni
  `emptyHint` prop; „Nema podataka." ostaje kao naslov, ispod njega ide
  rečenica sa sljedećim korakom i `tonal` dugme. Podrazumijevano ponašanje
  ostaje današnje, pa se uvodi postepeno.
### 4.2 Responzivne tabele (nalaz o horizontalnom skrolu)
Dva odvojena problema koja izgledaju kao jedan:
**(a) Desktop.** Tabela „Stavke naknada" ima **7 kolona** (`fakture:91`) i
nalazi se u **`lg:grid-cols-2`** grid-u (`fakture:89`) — dakle dobija polovinu
širine ekrana. Otuda horizontalni skrol na 1440px uprkos praznini okolo. Isto
važi za `izvjestaji:132` (6 kolona u pola širine) i `podesavanja:205`.
**Rješenje za (a) je rasporedno, ne tehničko: tabela sa >5 kolona ne ide u
dvokolonski grid.** Ona ide u punu širinu, a kartice sa manje sadržaja se
grupišu pored nje.
**(b) Mobilni (375px).** Ovdje nijedan raspored ne pomaže — 8 kolona ne staje.
#### Razmotrene opcije za (b)
| # | Opcija | Za | Protiv | Ocjena |
|---|---|---|---|---|
| A | Status quo `overflow-x-auto` | Nula posla | Sadržaj je nevidljiv i neotkriv (H1/H6); nije dostupan tastaturom | ✗ |
| A+ | Status quo + vidljiva naznaka skrola (fade/sjenka na ivici) + `tabIndex={0}` | Vrlo jeftino; odmah popravlja H1 i a11y | Ne rješava suštinu — 8 kolona na 375px ostaje neupotrebljivo | ✓ **kao hitna zakrpa u Fazi 0** |
| B | Prioritet kolona — sporedne se sakriju ispod `md` (`hidden md:table-cell`) | Jednostavno, čist CSS; nema novog markupa | Sakriveni podaci su **nedostupni** na telefonu, ne samo skriveni | Dobro samo uz C |
| C | **Transformacija u kartice ispod `md`** — svaki red postaje blok „labela: vrijednost" | Sve je vidljivo; standardan i poznat obrazac; čitljivo za starije korisnike | Traži da `Table` zna labelu za svaku ćeliju (danas `Td` ne zna kojoj koloni pripada) | ✓ **uz B** |
| D | Po redu `<details>` — sažetak u redu, ostatak na klik | Kompaktno; bez JS-a | Dodatni klik po redu; slabo za skeniranje | Alternativa za najduže tabele (11 kolona) |
| E | Horizontalni skrol sa **zaključanom prvom kolonom** (`sticky left-0`) | Zadržava tabelarni oblik; mala izmjena | I dalje skrol; i dalje 8 kolona | Djelimično |
#### Preporuka: B + C, uz A+ odmah
`Table` primitiv dobija unazad kompatibilan potpis:
headers: string[] | ColumnSpec[]
ColumnSpec = { label: string; priority?: "primary" | "secondary" | "detail"; align?: "left" | "right" }

- `string[]` nastavlja da radi identično → **nijedan od 50 postojećih poziva se
  ne mora mijenjati odjednom**; migrira se tabela po tabela.
- `priority: "primary"` — uvijek vidljivo (1–3 kolone: identifikator, ključna
  vrijednost, status).
- `priority: "secondary"` — vidljivo od `md`.
- `priority: "detail"` — vidljivo od `lg`, a ispod toga **ide u karticu reda**
  (C), ne nestaje.
- Ispod `md`, tabela se renderuje kao lista kartica: `primary` kolone kao
  naslov reda, ostalo kao `dl` parovi. `Td` dobija labelu preko `data-label`
  koji `Table` prosljeđuje kroz kontekst — ili, jednostavnije i bez React
  konteksta, `Table` sam mapira `children` (prihvatljivo jer su svi pozivaoci
  server komponente).
Prioritet migracije (najgore prvo): `zgrade` posebni dijelovi (11) →
`troskovi:171` (9) → `fakture:192` (8) → `dokumenti:58` (8) → `fakture:91` (7)
→ `izvjestaji:98` (7).
**Usput, jeftino:** `/fakture` za vlasnika treba drugo zaglavlje nego za upravu
(`fakture:192` je danas isto za oboje) — bez „Dužnik", sa skraćenom jedinicom.
Role-based pojednostavljenje već postoji za navigaciju i dashboard i dobro radi;
ovo je isti obrazac.
### 4.3 Primitivi koji nedostaju u `ui.tsx`
Svi proizlaze iz konkretnog dupliranja pronađenog u kodu:
| Primitiv | Zamjenjuje | Dokaz |
|---|---|---|
| `Tabs` | ručno pisane tabove | `skupstina/page.tsx:55-71` (jedina upotreba, nema gdje da se ponovi) |
| `ConfirmAction` | nepostojeći korak potvrde | §3.8; 5 mjesta |
| `AuthShell` | 3 kopije iste karte | `login:42`, `zaboravljena-lozinka:30`, `reset-lozinka/[token]:44` |
| `FilterBar` | ručno pisani filter redovi sa golim `input`/`button` | `izvjestaji:67-71`, `izvjestaji:76-89`, `aktivnosti:100`, `admin/aktivnosti:123` |
| `StatusTimeline` | nepostojeći prikaz napretka | `skupstina/[id]` devetostepeni proces (H1) |
| `EmptyState` | 50× „Nema podataka." | `ui.tsx:103` |
| `export btnBase, btnVariantCls` | copy-paste klasa u client komponentama | `pdf-statement-import.tsx:131,260` |
---
## 5. Konzistentnost admin oblasti (`/admin`)
Ovo se **ne smije** riješiti pretpostavkom. `admin/layout.tsx:7-10` sadrži
eksplicitan komentar da je odvojenost namjerna, sa referencom na
`docs/multitenancy-plan.md §4.3/§8`. Argument u komentaru je validan: super
admin djeluje na nivou platforme, van bilo kog ZEV-a, a cijeli `NavShell` nav
je građen oko `zevId`-scoped stranica.
**Ali:** stvarni korisnički tok nije „super admin ostaje u admin oblasti".
`(app)/layout.tsx:55` dodaje „Super admin" link u sidebar, a `admin/layout.tsx:27-34`
dodaje „Moj ZEV" link nazad — dakle isti čovjek se **očekivano i često** kreće
tamo-amo. Danas pri svakom prelasku dobija aplikaciju koja izgleda kao drugi
proizvod.
### Razmotrene opcije
| # | Opcija | Za | Protiv | Ocjena |
|---|---|---|---|---|
| A | Ostaviti kako jeste | Nula posla; poštuje dokumentovanu odluku; „drugačije izgleda" je i signal „pažnja, drugi nivo ovlašćenja" | Dva nepovezana proizvoda za istog korisnika; admin oblast ne dobija ništa od poboljšanja iz §3–§4 (sidebar, ikone, tap target, tabele) — divergencija s vremenom raste | Prihvatljivo samo ako je razdvojenost stvarno željena |
| B | Puni `NavShell` sa identičnim izgledom | Maksimalna dosljednost; sve iz §3–§4 se primjenjuje besplatno | **Briše koristan signal** da je korisnik u režimu sa najširim ovlašćenjima nad tuđim podacima; za softver gdje super admin može suspendovati cijeli ZEV, „izgleda isto kao obična stranica" je rizik | ✗ |
| C | **`NavShell` sa `variant="platform"`** — ista komponenta, isti raspored, iste ikone i primitivi, ali vizuelno označena kao platformski nivo (trajna „Super admin" oznaka u top baru, neutralniji/tamniji akcenat sidebar-a umjesto plavog) | Zadržava **obje** vrijednosti: dokumentovanu namjeru (odvojen nivo, nav nije `zevId`-scoped) i dosljednost (ista školjka, ista dugmad, iste tabele). Admin oblast automatski nasljeđuje svako buduće poboljšanje. Tehnički izvodljivo bez izmjene arhitekture: `NavShell` već prima `links` kao prop, `tenants` je opcion, a `showSwitcher` (`nav-shell.tsx:80`) se ionako ne aktivira. Admin layout već prosljeđuje server action, kao i `(app)` layout. | Treba dodati `variant` prop i admin-specifičnu listu linkova (`/admin`, `/admin/aktivnosti`); mala izmjena `NavShell`-a koji je danas stabilan | **✓ preporuka — ali kao pitanje, ne kao odluka (P4)** |
| D | Zajednički `AppChrome` iz kojeg se izvode obje školjke | Najčistije teorijski | Preuređivanje komponente koja radi, bez dodatne koristi u odnosu na C | ✗ |
**Napomena o obimu:** čak i ako korisnik izabere A, admin stranice
(`admin/page.tsx`, `admin/[zevId]/page.tsx`, `admin/aktivnosti/page.tsx`)
**već koriste `ui.tsx` primitive** (`PageHeader`, `Card`, `Table`, `StatusBadge`,
`Field`, `SubmitBtn`). Dakle Faze 0–3 ih poboljšavaju bez obzira na odluku o
školjci. Odluka se tiče **samo** `admin/layout.tsx`.
---
## 6. Javni / neautentifikovani tokovi
Ovo su ekrani sa **najmanje vještim korisnicima i najvećim pravnim ulogom**, a
danas dobijaju najmanje dizajnerske pažnje. Zaslužuju odvojen tretman.
*(Napomena: sve u §6.1 je izvedeno iz čitanja koda — te stranice nisu viđene
uživo u ovoj sesiji, jer traže važeći token. Vidi §1.)*
### 6.1 `/glasanje/[token]` — elektronsko izjašnjavanje
Kontekst koji određuje sve: korisnik je etažni vlasnik koji je dobio e-mail,
klikuje link **jednom u životu**, nema nikakvo iskustvo sa aplikacijom, radnja
je **pravno relevantna**, **nepovratna** i **jednokratna** — `used` grana
(`glasanje:15`) kaže „Ponovno glasanje nije moguće."
**Šta danas radi dobro (i ne treba dirati):**
- Trostruka brana: link + verifikacioni kod + potvrda izjave (`:28-30, 118-124`).
- `ERR_TEXT` poruke (`:12-21`) su među najboljim tekstovima u aplikaciji.
- Potvrda nakon glasanja (`:51-66`) sa ID-em potvrde i jasnim „Ovu stranicu
  možete zatvoriti."
- Pravna ograda na dnu (`:136-138`) — „evidentirano elektronsko odobravanje, a
  ne kvalifikovani elektronski potpis."
**Šta ne valja:**
| # | Nalaz | Linija |
|---|---|---|
| 1 | Ne koristi `Card`/`PageHeader`; kutije su ručno pisane `rounded-md border` — vizuelno pripada drugoj aplikaciji | `:94, :106, :108` |
| 2 | **Nema logotipa.** Samo tekst `ZEV upravnik — elektronsko odobravanje`. Za link iz e-maila, gdje je prvo pitanje „je li ovo prevara?", odsustvo vizuelnog identiteta je bezbjednosni i psihološki problem | `:134` |
| 3 | Tekst prijedloga o kojem se glasa je **`text-sm` (14px)** | `:97` |
| 4 | **Pravno obavezujuća izjava saglasnosti je `text-xs` (12px) `slate-600`** — najsitniji tekst na stranici nosi najveću pravnu težinu | `:121-124` |
| 5 | Radio dugmad su podrazumijevane veličine; tri opcije sa `gap-2` — tap targeti ~20px | `:112-116` |
| 6 | **Nema koraka potvrde prije nepovratnog slanja.** Jedan klik na „Potvrdi i pošalji izjašnjenje" i gotovo je zauvijek | `:125` |
| 7 | Greška „ack" (`:82`) se prikazuje **iznad** forme, a checkbox je pri dnu — na telefonu korisnik ne vidi poruku | `:106` |
| 8 | „otisak sadržaja (SHA-256): a3f9…" prikazan bez objašnjenja | `:102` |
| 9 | Nema načina da se dobije pomoć — nema kontakta predsjednika ZEV-a, ni „šta ako je moj kod istekao" | — |
**Prijedlog: prestrukturirati u tri numerisana koraka na jednoj stranici**
(bez višestranične forme — ona uvodi stanje i rizik gubitka):
1. **„Ko ste vi"** — ime vlasnika (i punomoćnika), glasačka težina. Danas je
   ovo `text-sm slate-500` podnaslov (`:87-92`); postaje jasan blok koji
   korisnik može potvrditi. Ako ovdje piše pogrešno ime, sve ostalo je nevažno.
2. **„O čemu se izjašnjavate"** — naslov prijedloga, **tekst na 16–17px sa
   `max-w-[68ch]`**, obrazloženje, rok. Hash ide u fusnotu sa objašnjenjem
   („Tehnički otisak teksta prijedloga — garantuje da se tekst nije mijenjao
   nakon što vam je poslat.").
3. **„Vaše izjašnjenje"** — tri opcije kao **velike kartice sa radio
   ponašanjem** (min 56px visine, cijela kartica je klikabilna), verifikacioni
   kod, izjava saglasnosti **na veličini tijela teksta**, pa `ConfirmAction`
   (§3.8) koji prije slanja pokaže sažetak: „Izjašnjavate se **ZA** prijedlog
   P-2026-01. Ovo je konačno i ne može se promijeniti."
Plus: logotip u zaglavlju; `AuthShell` kao osnova; kontakt/pomoć na dnu.
### 6.2 `/login`, `/zaboravljena-lozinka`, `/reset-lozinka/[token]`
Tri kopije istog markupa (`max-w-sm rounded-lg border border-slate-200 bg-white
p-6 shadow-sm`), sa `h1` koji je na dva mjesta hardkodovan `"ZEV upravnik"`
(`reset-lozinka:45`, `zaboravljena-lozinka:31`) a na trećem ide kroz
`t("app.name")` (`login:43`).
**Prijedlog — `AuthShell` primitiv,** i u njemu:
- **Logotip** — `/logo-mark.png` već postoji i koristi se (`nav-shell.tsx:170`).
- **Slogan** — `t("app.tagline")` → „Upravljanje zajednicom etažnih vlasnika".
  **Postoji u rječniku (`sr-Latn.ts:7`) i nigdje se ne koristi.** Jedna linija
  rješava „ne znam šta je ovo".
- **Kontekst za prvi put:** kratka rečenica ispod forme — „Nalog dobijate od
  predsjednika vaše zajednice etažnih vlasnika." To je danas nigdje, a
  vlasnik koji nema nalog nema nikakvu uputu.
- **Kompozicija umjesto praznine:** platno ostaje `slate-50`, ali kartica se
  centrira u kolonu sa logotipom iznad i diskretnom fusnotom ispod, tako da
  stranica ima vertikalni ritam umjesto jedne kutije u praznini. **Bez
  ilustracija, bez gradijenta, bez fotografija** — za finansijski/pravni
  softver mirno i suzdržano je tačan ton.
- `PasswordField` komponenta već postoji (`src/components/password-field.tsx`) —
  provjeriti zašto se ne koristi na `/login` i `/reset-lozinka` (ima li
  „prikaži lozinku" toggle, što je za starije korisnike značajno).
---
## 7. Copy i i18n — pravila za svaku izmjenu teksta
Svaka izmjena teksta u ovom planu mora poštovati postojeći mehanizam
(`src/lib/i18n`, vidi projektne smjernice §Backend/domain conventions):
- `t()`/`tEnum()` hodaju **ugniježđeni** objekat cijepanjem ključa po `.`.
  Nova grupa mora biti ugniježđena (`group: { sub: { leaf: "…" } }`), **nikad
  ravna** (`{"sub.leaf": "…"}`) — inače pretraga tiho promaši i vrati sam ključ.
- Danas je stanje **mješovito**: navigacija, enumi i auth idu kroz `t()`, ali
  su naslovi stranica i sav prateći tekst hardkodovani u JSX-u — npr.
  `zgrade:84` `title="Zgrade i jedinice"` iako `nav.buildings` sadrži **tačno
  taj string** (`sr-Latn.ts:11`). Isto na `vlasnici:124`, `organi:76`,
  `fakture:82`, `podesavanja:108`, `izvjestaji:63`.
- **Preporuka:** ne raditi veliku migraciju svega. Ali **svaki tekst koji ovaj
  plan mijenja** (§2.2 pravni fajlovi, prazna stanja, potvrde, `/glasanje`)
  ide kroz rječnik — inače se povećava nesrazmjera.
Konkretne izmjene teksta koje plan traži:
| Mjesto | Danas | Prijedlog |
|---|---|---|
| `organi:87` | „…vidi `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §Organi ZEV`." | ukloniti referencu; zadržati suštinu („Ovi parametri su podesivi u Podešavanjima.") |
| `podesavanja:235` | „Vrijednosti označene u LEGAL_AND_FINANCIAL_ASSUMPTIONS.md — pravna/računovodstvena provjera obavezna prije produkcijske upotrebe." | „Ove vrijednosti utiču na obračun i na pravila glasanja. Prije izmjene se posavjetujte sa računovođom." |
| `podesavanja:256-258` | „…preko **mock** provajdera… opisana je u `.env.example` i README." | opisati stvarno stanje slanja bez naziva fajlova; **prvo provjeriti da li je i dalje tačno** nakon Mailjet-a |
| `ui.tsx:103` | „Nema podataka." | ostaje kao naslov + `emptyHint` sa sljedećim korakom |
| `glasanje:102` | „otisak sadržaja (SHA-256)" | „Tehnički otisak teksta — garantuje da tekst nije mijenjan." |
| `prijedlog:213` | „…(tokeni se čuvaju samo kao hash)" | premjestiti u hint ispod naslova |
---
## 8. Šta ovaj plan namjerno NE radi
- **Ne uvodi komponentnu biblioteku** (shadcn, MUI, Radix). `ui.tsx` je 242
  linije i pokriva potrebe; zamjena bi bila prepisivanje svih 34 stranice.
- **Ne mijenja font.** Roboto ostaje.
- **Ne uvodi tamni režim.** Zaseban poduhvat; ciljna publika ga ne traži.
- **Ne mijenja primarnu boju brenda** — osim ako korisnik tako odluči (P1).
- **Ne uvodi animacije** preko postojećeg `dropdown-in` (`globals.css:18-31`).
- **Ne prebacuje stranice na client komponente.** Sve predloženo (`<details>`
  potvrde, card-transform tabela, tabovi kao linkovi) radi server-side.
- **Ne dira poslovnu logiku, servise, šemu ni autorizaciju.** Ovo je čisto
  prezentacioni sloj. Jedini izuzetak koji dodiruje ponašanje su koraci potvrde
  (§3.8) — i oni dodaju korak, ne mijenjaju rezultat.
- **Ne radi veliku i18n migraciju** (§7).
- **Ne uvodi vizuelno regresiono testiranje.** Vrijedilo bi, ali je zaseban
  poduhvat (vidi §12, rizik 5).
- **Ne mijenja PDF izlaze.** `documents.ts` i `pdfTable` ostaju netaknuti — to
  je odvojen vizuelni sistem sa svojim pravilima.
---
## 9. Pristupačnost — sažetak provjerljivih nalaza
Skupljeno na jedno mjesto jer je za ovu publiku ovo funkcionalni zahtjev:
| # | Nalaz | Mjesto | Status |
|---|---|---|---|
| A1 | `slate-400` na bijeloj ≈2,8:1 — **pada WCAG AA** za normalan tekst, a koristi se za sadržaj | `ui.tsx:103, :201`; `page.tsx` (11 mjesta); `nav-shell.tsx:264`; `prijedlog:176` | §3.2 |
| A2 | Tap target dugmadi ≈30px (traži se 44) | `ui.tsx:116` | §3.7 |
| A3 | Destruktivan tekstualni link 12px, 4px od susjednog | `prijedlog:233,239` | §3.6 (`ghost`) |
| A4 | Skrolabilna tabela nije fokusabilna — sadržaj nedostupan tastaturom | `ui.tsx:92` | §3.7, §4.2 |
| A5 | Nema `:focus-visible` na nav linkovima i tekstualnim linkovima | `nav-shell.tsx:139-146`; razni | §3.7 |
| A6 | `Flash` za greške ima `role="status"` umjesto `role="alert"` | `ui.tsx:232` | §2.9 |
| A7 | Radio/checkbox podrazumijevane veličine na pravno obavezujućoj formi | `glasanje:112-124` | §6.1 |
| A8 | `Table` nema `<caption>` ni `scope="col"` na `<th>` | `ui.tsx:94-100` | Faza 3 |
| A9 | Mobilni drawer nema `role="dialog"`/fokus zamku | `nav-shell.tsx:159` | Faza 3 |
| ✓ | `lang="sr-Latn"` ispravno postavljen | `layout.tsx:20` | dobro |
| ✓ | `prefers-reduced-motion` poštovan | `globals.css:33-37` | dobro |
| ✓ | Status se nikad ne prenosi samo bojom | `ui.tsx:80-88` | dobro |
---
## 10. Pitanja za korisnika prije implementacije
**P1 — Brend: ostaje li `blue-600` primarna boja?**
Preporuka je **da** — plava je mirna, pouzdana, već je u logotipu i u cijeloj
aplikaciji, i nijedan nalaz u ovoj analizi ne ukazuje da je hue problem. Ali
ako postoji brend odluka (npr. boja iz logotipa ZEV-a, ili želja da se
aplikacija razlikuje od „generičkog plavog SaaS-a"), sada je trenutak — nakon
Faze 0 promjena primarne boje je jedna linija u `@theme`, prije toga je 40
mjesta.
**P2 — Prihvata li se pravilo da puna crvena ostaje na 3 dugmeta u aplikaciji?**
(§3.6). Konkretno: da li se slažete da „Povuci saglasnost za elektronsko
glasanje" (`podesavanja:179`) i „Zatvori glasanje" (`prijedlog:166`) prestanu
da budu puna crvena i postanu `caution` (amber outline) **uz obavezan korak
potvrde**? Ovo je izmjena naučenog obrasca za korisnike koji već rade u
aplikaciji.
**P3 — Koliko apetita ima za višefaznu vizuelnu promjenu na živoj produkciji?**
Tri varijante:
- **(a) Samo higijena** — Faza 0 (tokeni, tipografija, kontrast, tap target) +
  Faza 6 (copy). Nevidljivo kao „redizajn", ali svaka stranica postaje
  čitljivija i pristupačnija. Najniži rizik.
- **(b) Higijena + hijerarhija** — (a) + Faza 1 (težine dugmadi) + Faza 2
  (potvrde) + Faza 4 (javni tokovi). Rješava sva tri nalaza iz §0.
  **Preporuka.**
- **(c) Sve** — (b) + Faza 3 (tabele i gustina, najveći posao) + Faza 5 (admin).
**P4 — Da li je vizuelna odvojenost `/admin` oblasti nešto što želite da
sačuvate?** (§5). Komentar u kodu (`admin/layout.tsx:7-10`) kaže da jeste
namjerna. Pitanje je da li je namjera bila „drugačiji nav" (što opcija C čuva)
ili „namjerno izgleda kao drugi, ozbiljniji alat" (što bi značilo opciju A).
**P5 — Tabele: prihvata li se da se na telefonu tabele pretvaraju u kartice po
redu** (§4.2, opcija C)? To znači da izgled na telefonu prestaje da liči na
izgled na desktopu. Za `/fakture` i `/vlasnici` to je jasno bolje; ako neko od
korisnika redovno radi ozbiljan rad na telefonu i navikao je na skrolovanje,
vrijedi znati unaprijed.
**P6 — Ikone: ostaje li ručno crtani inline SVG pristup?** (`nav-icons.tsx`,
16 ikona, `IconDot` fallback; ovo je i utvrđena projektna konvencija). Argument
**za zadržavanje**: nula zavisnosti, koherentan stil, radi. Argument **za
biblioteku** (npr. `lucide-react`): redizajn iz §4.3 traži nekoliko novih ikona
(prazna stanja, potvrde, chevron za skrol, stanja u `StatusTimeline`), a
ručno crtanje svake je sporo i kvalitet varira. **Preporuka: zadržati**, ali
ovo je svjesno odstupanje od „idealnog" i vrijedi da bude vaša odluka, ne moja.
**P7 — Prazna stanja koja vode („Nema zgrada. Dodajte prvu zgradu →"):
želite li ih?** To znači pisanje ~20 kratkih tekstova i odluku koja je „sljedeća
radnja" za svaku tabelu. Vrijedi mnogo za novog predsjednika, ništa za
postojećeg.
**P8 — Da li postoji neki stvarni korisnik (predsjednik ili vlasnik) sa kojim
se može uraditi 20-minutno posmatranje prije Faze 3?** Najskuplji dio plana
(tabele) je i najlakše pogrešno pogoditi. Jedan stvarni korisnik koji pokuša da
nađe fakturu na telefonu vrijedi više od cijele §4.2.
**P9 — Da li je poruka na `podesavanja:256` („mock provajderi") i dalje
tačna** nakon uvođenja Mailjet-a (`Plans/deployment-portability-plan.md` §7.1)?
Ako nije, to nije samo copy nego pogrešna informacija korisniku u produkciji i
ide u Fazu 0, ne u Fazu 6.
**P10 — Verzionisanje:** po `CHANGELOG.md` konvenciji, da li ovaj poduhvat
tretiramo kao niz minor izmjena (jedna po fazi) ili kao **major** prekretnicu
(trenutna verzija je `2.12.1` → `3.1.0`)? Vizuelni redizajn cijele aplikacije
je kandidat za major, ali to je vaša odluka.
---
## 11. Fazni plan implementacije
Svaka faza je samostalno isporučiva i testabilna, i svaka ostavlja aplikaciju u
boljem stanju nego što ju je zatekla. **Trenutni obim (P3, opcija b): Faza 0,
1, 2, 4, 6.** Faza 3 i Faza 5 su niže dokumentovane u potpunosti — odluke za
njih (P4, P5, P7, P8) su donesene — ali se ne pokreću dok se to izričito ne
zatraži.
### Faza 0 — Tokeni, tipografija, kontrast *(mala; nula izmjena rasporeda)*
Ne dira se nijedna `page.tsx`. Sve ide kroz `globals.css`, `ui.tsx`,
`nav-shell.tsx`, `layout.tsx`.
- `@theme` blok u `globals.css` sa tokenima iz §3.2; obrisati mrtve
  `--background`/`--foreground` (`globals.css:6-9`) ili ih povezati sa `body`.
- Tipografska skala (§3.3): **naslov kartice prestaje da bude `text-xs
  uppercase`** (`ui.tsx:34`); tijelo na 15px; hint na 13px/slate-500.
- Kontrast (§3.2, A1): `slate-400` → `slate-500`/`600` svuda gdje nosi sadržaj.
- Tap target (§3.7, A2): `btnBase` `py-1.5` → `py-2.5`, `min-h-[44px]` ispod `md`.
- `:focus-visible` globalno (A5); `Flash` greška → `role="alert"` (A6).
- Maksimalna širina sadržaja u `nav-shell.tsx:343` (§3.4).
- **Ukinuti dvostruku elevaciju** (§3.5): `Table` unutar `Card` gubi svoj okvir.
- **A+ zakrpa za skrol** (§4.2): naznaka skrola + `tabIndex={0}` + `aria-label`
  na kontejneru tabele.
- Ako je P9 potvrdio netačnost: ispraviti `podesavanja:256-258`.
**Rezultat:** cijela aplikacija odmah čitljivija i pristupačnija; ništa se ne
pomjera; rizik regresije minimalan.
### Faza 1 — Hijerarhija dugmadi *(mala–srednja)*
- Nove varijante u `ui.tsx`: `tonal`, `ghost`, `caution` (§3.6); `export btnBase`
  i `btnVariantCls`.
- Reklasifikacija svih **13** `danger` poziva po tabeli iz §3.6.
- Uklanjanje 6 ručno pisanih dugmadi (`izvjestaji:70,88`, `aktivnosti:100`,
  `admin/aktivnosti:123`, `pdf-statement-import.tsx:131,260`) i 3 ručno pisana
  polja (`izvjestaji:68,69,79`, `organi:152`).
- Tekstualne radnje u redovima tabela → `ghost` (`prijedlog:233,239`;
  `admin/page:97`).
- **CHANGELOG mora eksplicitno navesti promjenu boje poznatih dugmadi** —
  korisnici su u produkciji.
### Faza 2 — Potvrda za nepovratne radnje *(mala)*
- `ConfirmAction` primitiv (§3.8), bez ijedne linije client JS-a.
- Primjena na 5 mjesta: `prijedlog:166` (sa sažetkom kvoruma **unutar** panela —
  rješava H5 nalaz iz §2.5), `podesavanja:179`, `vlasnici/[id]:299`,
  `fakture/[id]:141`, `uplate/[id]:137`, `admin/[zevId]:343` (sa ukucavanjem
  naziva).
### Faza 3 — Tabele i gustina *(srednja–velika; najveći dio posla — VAN TRENUTNOG OBIMA, vidi P3)*

**Ne pokreće se sada.** Odluke P5, P7 i P8 su donesene unaprijed za kad se
ova faza zaista pokrene — uključujući P8, dogovorenu 20-minutnu posmatranu
sesiju sa stvarnim korisnikom **prije** početka ove faze. Podsjetiti
korisnika na taj dogovor pri pokretanju.
- `Table` prima `ColumnSpec[]` uz zadržan `string[]` (§4.2) — unazad
  kompatibilno, migracija tabela jedna po jedna.
- Card-transform ispod `md`; `<caption>`, `scope="col"` (A8).
- Migracija redoslijedom: `zgrade` (11 kol.) → `troskovi:171` (9) →
  `fakture:192` (8) → `dokumenti:58` (8) → `fakture:91` (7) → `izvjestaji:98` (7).
- **Rasporedna ispravka:** tabele sa >5 kolona izlaze iz `lg:grid-cols-2`
  (`fakture:89`, `izvjestaji:130`, `podesavanja:127`).
- Progresivno otkrivanje na preostalih ~13 formi (§4.1, B) + `<fieldset>`
  grupisanje za forme >6 polja (§4.1, E).
- Sažeci iznad tabela (§4.1) — počevši od zbira vlasničkih udjela na `/zgrade`.
- `Tabs` primitiv; `/skupstina:55-71` prelazi na njega.
- `EmptyState` + `emptyHint` (uslovno po P7).
- `StatusTimeline` za `/skupstina/[id]` (H1).
- Role-based zaglavlje tabele na `/fakture` za vlasnika (§4.2).
- Mobilni drawer `role="dialog"` + fokus zamka (A9).
### Faza 4 — Javni i neautentifikovani tokovi *(srednja)*
- `AuthShell` primitiv; `/login`, `/zaboravljena-lozinka`, `/reset-lozinka/[token]`
  prelaze na njega (§6.2).
- Logotip + `t("app.tagline")` (već postoji, nekorišten) + rečenica „Nalog
  dobijate od predsjednika…".
- **Redizajn `/glasanje/[token]`** po §6.1: tri koraka, tekst prijedloga na
  16–17px, izjava saglasnosti na veličini tijela, velike klikabilne kartice
  izbora, `ConfirmAction` prije slanja, logotip, pomoć na dnu.
- **Prije implementacije:** otvoriti stvaran token link i pogledati današnju
  stranicu uživo (§1).
### Faza 5 — Admin oblast *(mala–srednja; VAN TRENUTNOG OBIMA, vidi P3)*

**Ne pokreće se sada.** Odluka P4 je donesena unaprijed: kad se ova faza
pokrene, `NavShell` dobija `variant="platform"`; `admin/layout.tsx` prelazi na
njega sa admin-specifičnim `links`; dokumentovati odluku i **ažurirati
komentar `admin/layout.tsx:7-10`** da odražava novo stanje.
### Faza 6 — Copy i i18n higijena *(mala)*
- Uklanjanje internih naziva fajlova iz UI-ja (§7, tri mjesta).
- Naslovi stranica koji dupliraju postojeće rječničke ključeve → `t()`
  (`zgrade:84`, `vlasnici:124`, `organi:76`, `fakture:82`, `podesavanja:108`,
  `izvjestaji:63`).
- Objašnjenja hash-a; premještanje implementacionih detalja iz naslova kartica
  u hint.
- Tekstovi praznih stanja (uslovno po P7).
### Uz svaku fazu (pravila projekta)
Svaka faza nosi **unos u `CHANGELOG.md`** i **podizanje verzije**, po konvenciji
iz `CHANGELOG.md` §„Verzionisanje" (minor je podrazumijevani korak; patch za
iteracije unutar iste nezavršene faze; tip podizanja se **potvrđuje sa
korisnikom prije** nego što se uradi). Trenutna verzija je `2.12.1`; po P10 ide
niz minor izmjena, jedna po fazi (bez major skoka), kao kod
`Plans/deployment-portability-plan.md`.

Pošto je sve u ovom planu čisto prezentaciono, **nijedna faza ne uvodi migraciju
šeme**, pa se Neon produkciona provjera („Vercel production deployment" pravilo
iz projektnih smjernica) ne aktivira. To treba potvrditi pri svakoj isporuci,
ne pretpostaviti.

**Živi vizuelni pregled je obavezan za svaku fazu:** pokrenuti aplikaciju,
proći Playwright-om kroz najmanje
`/`, `/zgrade`, `/fakture`, `/skupstina/prijedlog/[id]`, `/podesavanja`,
`/login` na **1440px i na 375px**, i stvarno pogledati snimke. Build koji prolazi
ne dokazuje ništa za ovaj tip izmjene.
---
## 12. Rizici i ono što će zaboljeti u praksi
1. **Faza 0 čini tabele privremeno gorim.** Podizanje tijela teksta sa 14 na
   15px i povećanje `py` u ćelijama znači da tabela od 9–11 kolona postaje
   **šira i skrolabilnija** nego danas — a Faza 3 koja to rješava dolazi tek
   kasnije. **Ublažavanje:** A+ zakrpa (naznaka skrola) ulazi već u Fazu 0, a
   Faze 0 i 3 se po mogućnosti objavljuju u istom ciklusu ako se izabere P3(c).
2. **Promjena boje poznatih dugmadi je promjena naučenog obrasca na živim
   korisnicima.** Predsjednik koji je naučio „crveno dugme gore desno zatvara
   glasanje" ga sljedeći put neće naći na isti način — i naći će korak potvrde
   koji ranije nije postojao. Ovo je **namjerno poboljšanje koje se privremeno
   osjeća kao pogoršanje**. Mora biti u CHANGELOG-u i, po mogućnosti, najavljeno
   korisnicima.
3. **`ColumnSpec` migracija dodiruje ~50 poziva `Table`.** Unazad kompatibilan
   potpis (`string[] | ColumnSpec[]`) je jedina stvar koja ovo čini izvodljivim
   postepeno. Ako se to preskoči i uradi „sve odjednom", Faza 3 postaje jedna
   ogromna, nepregledna izmjena — tačno ono što ovaj plan pokušava da izbjegne.
4. **Tailwind v4 `@theme` ponašanje treba provjeriti rano.** Token koji nije
   deklarisan u `@theme` se ne može koristiti kao `bg-primary`; projekat danas
   **nema nijedan `@theme` blok**, pa je ovo neprovjerena pretpostavka u planu.
   Prva stvar u Fazi 0 treba da bude minimalan `@theme` sa jednom bojom i
   potvrda da `npm run build` prolazi — prije nego što se napiše cijela
   tokenska tabela.
5. **Nema vizuelnog regresionog testiranja.** Jedina mreža je Playwright smoke
   e2e (`e2e/`), koja provjerava da stranice rade, ne kako izgledaju. Izmjena u
   `ui.tsx` pogađa svih 34 stranice odjednom, a kvar se vidi samo okom.
   **Ublažavanje:** fiksna lista od 6 stranica × 2 širine koja se gleda uz svaku
   fazu (§11). Uvođenje pravog vizuelnog snapshot testiranja je zaseban
   poduhvat i vrijedi ga razmotriti prije Faze 3.
6. **i18n migracija može tiho vratiti sirovi ključ.** `t()` pada nazad na sam
   string ključa kad ga ne nađe (`i18n/index.ts:30-34`), a nova grupa mora biti
   ugniježđena, ne ravna. Naslov stranice koji odjednom piše
   `nav.buildings` je tiha, ružna regresija. Faza 6 treba test koji provjeri da
   nijedan renderovan naslov ne sadrži tačku.
7. **`/glasanje/[token]` se ne može lako testirati.** Traži otvoren prijedlog i
   važeći token. Faza 4 mora predvidjeti vrijeme za pripremu tog scenarija u
   seed podacima — inače će redizajn najosjetljivije stranice u aplikaciji biti
   isporučen bez ijednog stvarnog pogleda na nju.
8. **Rizik prekomjernog čišćenja.** Nekoliko stvari koje ovaj plan hvali —
   `Stat` kartice, tonalni chipovi, `ERR_TEXT` poruke, role-based navigacija,
   append-only obrazac ispravke — su **već dobro urađene**. Redizajn koji ih
   „usput" prepiše bi bio čista šteta. Zapisano ovdje da se ne izgubi.
---
### Ključni fajlovi za implementaciju
- `src/components/ui.tsx` — **jedina tačka kroz koju sve prolazi.** Sve iz
  Faze 0–3 živi ovdje: tipografska skala (`:23-24`, `:34`, `:97`, `:199-201`),
  varijante dugmadi (`:115-140`, plus `export`), elevacija (`:33`, `:92`),
  `Table` → `ColumnSpec` (`:90-113`), novi primitivi (`ConfirmAction`, `Tabs`,
  `EmptyState`, `AuthShell`, `FilterBar`, `StatusTimeline`)
- `src/app/globals.css` — danas 37 linija bez ijednog `@theme` bloka i sa dvije
  mrtve varijable (`:6-9`); prima cijeli tokenski sloj iz §3.2–§3.5 i globalni
  `:focus-visible`
- `src/app/(app)/skupstina/prijedlog/[id]/page.tsx` — najsloženiji ekran u
  aplikaciji i sabirno mjesto za H1/H3/H5/H6: tri `danger` dugmeta (`:166`,
  `:295`, `:331`), kvorum odvojen od dugmeta koje o njemu odlučuje (`:200-207`
  naspram `:166`), destruktivan 12px link u redu tabele (`:239`)
- `src/app/glasanje/[token]/page.tsx` — najveći ulog po korisniku, najmanje
  dizajna; ne koristi `Card`/`PageHeader`, nema logotip, pravna izjava na 12px
  (`:121`), nepovratno slanje bez potvrde (`:125`)
- `src/components/nav-shell.tsx` — maksimalna širina sadržaja (`:343`),
  kontrast `rolesText` (`:264`), fokus na nav linkovima (`:139-146`), mobilni
  drawer a11y (`:159`), i `variant="platform"` ako P4 ide na opciju C
- `src/app/admin/layout.tsx` — 48 linija koje nose cijelu odluku iz §5;
  komentar `:7-10` je razlog zašto ovo nije automatska „popravka"
- `src/lib/i18n/sr-Latn.ts` — sve izmjene teksta iz §7; sadrži nekorišten
  `app.tagline` (`:7`) koji rješava dio problema `/login` stranice jednom linijom
