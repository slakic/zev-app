# Multitenancy, onboarding i feature-paketi — arhitektonski plan

Status: Faza 0, koraci 1-2 (šema + jednokratna popuna podataka) **završeni i
primijenjeni** 2026-09-07 — vidi sekciju 6.1. Korak 4 (auth/sesija/Actor)
**završen i verifikovan** 2026-09-07 (v1.1.0) — vidi sekciju 6.2: `npx prisma
generate` + puni pipeline (`typecheck`, `lint`, `test`, `build`) prošli čisto.
Korak 3 (NOT NULL + prave FK veze, uklj. tenant-scoping 9 postojećih unique
ograničenja) **završen i verifikovan** 2026-09-07 (v1.2.0) — vidi sekciju 6.3:
puni pipeline (`typecheck`, `lint`, `test`, `build`) prošao čisto na
korisnikovoj mašini. Korak 5 (zevId filter u servisnom sloju): Modul 1
(property + ownership), Modul 2 (finansije/fakturisanje/uplate) i `users.ts`
iz Modula 6 su ranije stvarno isporučeni korisniku i verifikovani na
korisnikovoj mašini — vidi sekciju 6.4.

**2026-09-08 otkriveno i ispravljeno:** zbog greške u isporuci fajlova u
ranijim sesijama (dio `device_commit_files` poziva pisao je u pogrešan,
`zev-app`-manje spoljni folder umjesto u pravi korisnikov projekat), veći dio
Koraka 5 nikad nije stvarno stigao do korisnikovog projekta, uprkos ranijim
izvještajima da jeste: `meetings.ts` (sve osim `openVoting`), `expenses.ts`,
`plans.ts`, `maintenance.ts`, `reports.ts`, `documents.ts`, `attachments.ts`,
`evoteConsent.ts`, popravka `audit()` (nikad nije upisivao `zevId`), i
uklanjanje privremenog `default_zev_id()` DB defaulta (nova migracija +
`schema.prisma`) — kao i cijeli Korak 6 test paket
(`tests/tenant-isolation.test.ts`). Ovo je bio stvaran propust u
tenant-izolaciji, ne samo dokumentacioni: npr. `createMeeting`/
`createProposal`/`createVotingRule` nikad nisu postavljali `zevId`, pa je DB
tihо upisivao globalno najstariji ZEV umjesto stvarnog tenanta, što je i
otkriveno kroz 20 padova u korisnikovom test pipeline-u. Sav nedostajući kod
je 2026-09-08 isporučen u jednom paketu i nezavisno provjeren (fajlovi na
disku odgovaraju po imenu/veličini onome što je poslato). Cilj verzije je
**2.1.0**, jedan skok (korisnikova potvrđena odluka), pošto se prethodno
prijavljene v1.3.0/v2.1.0 nikad stvarno nisu desile u korisnikovom projektu.

**Status Koraka 5: ISPORUČENO 2026-09-08, NEPROVJERENO** — čeka se korisnikov
pun pipeline (`typecheck && lint && test && build`) na stvarnoj mašini; vidi
kraj sekcije 6.4. Korak 6 (test paket za izolaciju tenanta,
`tests/tenant-isolation.test.ts`) je sada isto stvarno isporučen u
`tests/` — i dalje **NAPISAN, NEPROVJEREN**: dva nezavisna tenanta (dva
poziva `createFixture()`), pa svaka exportovana, actor-facing funkcija iz
`src/server/services/*` (~90 funkcija kroz 14 modula) provjerena da tenant-A
actor ne može ni pročitati ni izmijeniti podatke tenanta B.
Datum: 2026-09-07, dopunjeno 2026-09-08

## 1. Cilj

Danas `zev-app` upravlja tačno jednim ZEV-om (postoji jedan red u tabeli `Zev`,
i skoro nijedan drugi model ne zna za njega). Cilj je da aplikacija može da
opslužuje više nezavisnih ZEV-ova ("tenant") u istoj instalaciji:

- svaki ZEV ima svog predsjednika, računovođu i vlasnike, potpuno odvojene od
  ostalih ZEV-ova;
- postoji uloga **super admin** koja ne pripada nijednom ZEV-u, nego kreira
  nove ZEV-ove i dodjeljuje im prve korisnike;
- svaki ZEV ima **paket funkcija** (npr. samo administracija / administracija
  + finansije / + elektronsko glasanje), koji određuje šta se u toj instanci
  uopšte vidi i može koristiti;
- postoji tok za **onboarding novog ZEV-a** koji kreće od praznog stanja
  (bez mock/demo podataka), ne od trenutnih demo podataka.

## 2. Trenutno stanje (činjenice iz koda, ne pretpostavke)

Istraženo direktno u `prisma/schema.prisma` i `src/server/auth/*`:

- **53 Prisma modela, 37 enum-a.** Od toga samo **2** (`Building`,
  `MoneyAccount`) imaju `zevId` FK ka `Zev`. Preostalih 51 (`User`, `Party`,
  `Unit`, `Invoice`, `Payment`, `Meeting`, `Proposal`, `Vote`, `Document`,
  `Supplier`, `Project`, `Setting`, ...) nemaju nikakvu vezu ka konkretnom
  ZEV-u, ni direktnu ni obaveznu transitivnu.
- `Zev` je danas čist singleton — `getZev()` radi `prisma.zev.findFirst()`
  bez ikakvog filtera. Ne postoji koncept "kojem ZEV-u pripada ovaj korisnik".
- `Role` enum ima samo tri vrijednosti: `PRESIDENT | ACCOUNTANT | OWNER`,
  zapisane kao ravan niz na `User.roles` — **globalno po korisniku**, ne po
  ZEV-u. Ne postoji super-admin uloga.
- `Actor` tip (`src/server/auth/guards.ts`) je `{ userId, roles, partyId }` —
  bez ikakvog tenant polja. Sesija (`src/server/auth/session.ts`) čuva samo
  `{ sid }` u JWT kolačiću.
- Nema `src/middleware.ts`, nema subdomain/path rutiranja po tenantu — sve
  bi se gradilo od nule.
- Nema koncepta feature-flag-ova. Postoji generički `Setting { key, value }`
  model, ali nije tenant-scoped niti strukturiran kao paket funkcija.
- `prisma/seed.ts` pravi jedan hardkodiran ZEV sa demo osobama/zgradama/
  fakturama — nema parametrizacije po tenantu niti "reset" alata.

**Zaključak:** ovo nije dodavanje jedne funkcije — ovo je presjek kroz skoro
cijelu šemu, kroz autentifikaciju/autorizaciju, i kroz servisni sloj koji
danas svuda upisuje/čita bez ikakvog tenant filtera.

## 3. Odluke (potvrđeno u razgovoru 2026-09-07)

| Pitanje | Odluka |
|---|---|
| Izolacija podataka | Jedna baza, `zevId` kolona na (skoro) svakom modelu, filtrirano u servisnom sloju — ne odvojena šema/baza po tenantu. |
| Odnos korisnik–tenant | **Membership** tabela (korisnik ↔ ZEV ↔ uloga), tako da jedan korisnik (npr. knjigovodstvena firma) može imati različitu ulogu u više ZEV-ova. |
| Feature-paketi | Fiksni, unaprijed definisani nivoi (npr. Osnovni / + Finansije / + Glasanje), ne granularni toggle po funkciji. |
| Sudbina trenutnih demo podataka | Postaju **tenant #1** (npr. "Vojvode Mišića 10 i 12") — ništa se ne briše, samo dobija `zevId` svuda. |

Ove četiri odluke određuju sve što slijedi. Ako se neka od njih promijeni
kasnije, dijelovi plana ispod (posebno šema u sekciji 4 i faza 0 u sekciji 6)
bi trebalo revidirati.

## 4. Promjene modela podataka

### 4.1 `Zev` postaje "tenant root"

`Zev` model već postoji i već nosi identitet ZEV-a (naziv, JIB, adresa) — ne
treba nova "Tenant" tabela, `Zev` **je** tenant. Dodaje mu se:

```prisma
model Zev {
  // ...postojeća polja...
  tier      ZevTier  @default(FULL) // postojeći tenant zadržava sve što već koristi
  active    Boolean  @default(true) // za suspendovanje tenanta bez brisanja
  memberships Membership[]
}

enum ZevTier {
  BASIC            // administracija: zgrade/jedinice/vlasnici/skupština/dokumenti
  BASIC_FINANCE    // + fakturisanje, uplate, troškovi, finansijski izvještaji
  FULL             // + elektronsko glasanje
}
```

Spisak funkcija po nivou je potvrđen (vidi sekciju 8):

- **BASIC** (Osnovni): zgrade/jedinice/vlasnici, skupština i odluke, organi
  ZEV-a, dokumenti, održavanje.
- **BASIC_FINANCE** (+ Finansije): sve iz BASIC + fakturisanje, uplate,
  troškovi, godišnji planovi, svi finansijski izvještaji.
- **FULL** (+ Glasanje): sve iz BASIC_FINANCE + elektronsko glasanje
  (tokeni, e-mail/Viber pozivi na glasanje).

### 4.2 Nova `Membership` tabela — zamjenjuje `User.roles`

```prisma
model Membership {
  id       String   @id @default(cuid())
  user     User     @relation(fields: [userId], references: [id])
  userId   String
  zev      Zev      @relation(fields: [zevId], references: [id])
  zevId    String
  role     Role     // PRESIDENT | ACCOUNTANT | OWNER — sada PO ZEV-u, ne globalno
  createdAt DateTime @default(now())

  @@unique([userId, zevId, role])
}
```

`User.roles Role[]` se uklanja — uloga se uvijek čita kroz `Membership` za
aktivni ZEV. `Party` (vlasnik/suvlasnik kao pravni entitet, odvojen od
`User` naloga) takođe dobija `zevId` direktno, jer se vlasnici danas
upisuju/pretražuju direktno, bez obaveznog prolaska kroz `Building`.

### 4.3 Super admin — van svakog tenanta

```prisma
model User {
  // ...
  isSuperAdmin Boolean @default(false)
}
```

Jednostavan bulean na `User`, ne posebna `Membership` sa `zevId = null` —
izbjegava nullable FK specijalne slučajeve u upitima nad `Membership`.
Super admin nema `Membership` red i ne prolazi kroz tenant-scoped upite;
radi u posebnom dijelu aplikacije (sekcija 5).

### 4.4 `zevId` na (skoro) svaki preostali model

Iako bi se `zevId` teorijski mogao izvesti transitivno (npr. `Invoice →
Unit → Building → Zev`), istraživanje je pokazalo da servisni sloj danas
upisuje/čita mnoge tabele **direktno**, bez join-a nazad do `Building`
(npr. `ownerBalance` upisuje/čita `Invoice` filtrirano samo po
`debtorId`). Zbog toga se preporučuje da **svaki model koji se ikad upituje
direktno u servisnom sloju dobije svoj `zevId` kao NOT NULL kolonu** (bez
default vrijednosti), umjesto oslanjanja na transitivnu vezu:

- Prednost: svaki upit koji zaboravi `zevId` filter **odmah vidljivo puca**
  (nedostaje kolona/vrijednost) umjesto da tiho procuri podatke iz drugog
  tenanta.
- Cijena: denormalizacija (ista informacija zapisana na više mjesta), ali
  za ovu razmjeru aplikacije to je prihvatljivo i sigurnije od alternative.

Ovo je najveći mehanički posao u cijelom poduhvatu — praktično svaki od
53 modela prolazi kroz migraciju.

## 5. Promjene u autentifikaciji/autorizaciji

- **`Actor`** dobija `zevId: string | null` (null samo za super admina) i
  `isSuperAdmin: boolean`; `roles` se i dalje zove isto, ali se sada
  popunjava iz `Membership` reda za **aktivni** ZEV, ne iz `User.roles`.
- **Aktivni ZEV u sesiji.** Pošto korisnik može imati više `Membership`
  redova, sesija mora pamtiti koji je ZEV trenutno aktivan (npr.
  `activeZevId` u JWT kolačiću). Ako korisnik ima tačno jedno članstvo,
  bira se automatski; ako ima više, nakon logina se prikazuje jednostavan
  izbornik "izaberi ZEV" (isti obrazac kao npr. biranje radnog prostora u
  Slack-u).
- **`requireRole`/`requireSelfOrRole`/`requireAnyUser`** (postojeći guard-ovi
  u `src/server/auth/guards.ts`) provjeravaju ulogu **za aktivni ZEV**, ne
  globalno.
- **Nov guard: `requireFeature(actor, featureKey)`** — provjerava da li
  `tier` aktivnog ZEV-a uključuje traženu funkciju. Mora se pozivati i na
  servisnom sloju (ne samo sakriti stavku menija) — ovo je isti princip koji
  već važi u projektu ("autorizacija je isključivo na serverskoj strani",
  vidi `zev-app-guidelines` skill) i ovdje se samo proširuje sa "koja
  uloga" na "koja uloga, u kojem ZEV-u, sa kojim paketom funkcija".
- **`requireActor(...)`** (`src/server/actor.ts`) dobija dodatnu provjeru:
  ako aktivni ZEV nije `active` (suspendovan), preusmjerava sa jasnom
  porukom umjesto da tiho radi.

## 6. Fazni plan

Redoslijed je namjerno takav da svaka faza ostavi aplikaciju u radnom
stanju — nema "big bang" prebacivanja gdje je aplikacija dugo polupečena.

### Faza 0 — temelji (bez vidljive promjene za korisnika)

1. Migracija šeme: `Membership`, `User.isSuperAdmin`, `Zev.tier`,
   `Zev.active`, `zevId` kolona (prvo nullable) na svim modelima iz 4.4.
2. Skripta za popunu podataka (data migration, ne šema): za svakog
   postojećeg `User`-a napravi po jedan `Membership` red prema njegovim
   trenutnim `roles` i **jedinom postojećem `Zev` redu** — ovo bukvalno
   realizuje odluku "trenutni podaci postaju tenant #1". Zatim popuni
   `zevId` na svim ostalim redovima istom vrijednošću (pošto danas i onako
   postoji samo jedan ZEV, popuna je jednoznačna).
3. `zevId` kolone postaju `NOT NULL` tek nakon popune (drugi migracioni
   korak, da ne pukne ništa u međuvremenu).
4. Prepravka `Actor`/sesije/guard-ova kako je opisano u sekciji 5.
5. Dodavanje `zevId` filtera u **svaku** funkciju u `src/server/services/*`
   — najveći i najrizičniji mehanički korak.
6. **Test paket za izolaciju tenanta**: novi test fajl koji pravi dva
   tenanta i eksplicitno provjerava da korisnik iz tenanta A ni na jedan
   način (nijedna servisna funkcija) ne može pročitati ili izmijeniti
   podatke tenanta B. Ovaj test paket je uslov da se faza 0 smatra
   završenom — ne "izgleda da radi", nego dokazano testom.

#### 6.1 Koraci 1-2 — urađeno 2026-09-07

Namjerno najuži mogući prvi rez, dogovoren u razgovoru: **samo** šema +
jednokratna popuna podataka; auth/sesija/guard-ovi i servisni sloj (koraci
4-6) nisu dirani, aplikacija se ponaša identično kao prije ove migracije.

Šta je stvarno urađeno (migracija
`prisma/migrations/20260907070201_add_multitenancy_foundations`):

- Dodato: enum `ZevTier`, `Zev.tier`/`Zev.active`, `User.isSuperAdmin`,
  tabela `Membership` (puna veza, sa `@@unique([userId, zevId, role])`),
  `zevId String?` kolona (bez FK, bez indeksa — namjerno "meko", vidi
  banner komentar u `schema.prisma` iznad `model Zev`) na svih 32 modela iz
  sekcije 4.4 (uključujući `Party`).
- Popunjeno: po jedan `Membership` red za svaki postojeći `User` × svaka
  njegova trenutna `roles` vrijednost, sve na jedini postojeći `Zev`; i
  `zevId` na svim redovima svih 32 tabela, na isti taj `Zev`. Provjereno
  upitom nad bazom — 0 NULL vrijednosti u `zevId` na bilo kojoj od 32
  tabele nakon migracije.
- **NIJE urađeno** (namjerno, ostaje za sljedeći korak uz auth cutover):
  `zevId` kolone ostaju nullable bez FK; postojeći `@unique`/`@@unique`
  nisu tenant-scoped; `Setting` (PK je `key`) nije dirana; `Session` nema
  `activeZevId`; `Actor`/guard-ovi/servisni sloj ne znaju za `Membership`.

Dvije stvari vrijedne zapamćivanja za bilo koju buduću migraciju u ovom
projektu (dodato i u `zev-app-guidelines` skill):

1. **`scripts/migrate.mjs create` ne radi pouzdano u ovoj bazi.** Čim baza
   sadrži bilo koju PL/pgSQL funkciju u `public` šemi (ovdje:
   `forbid_update_delete()` iz `append_only_guards`), `engine.introspect()`
   baca `SchemaConnectorError: Column type 'char' could not be
   deserialized from the database` (bag u WASM schema-engine-u pri čitanju
   `pg_proc.prokind`/`provolatile`/`proparallel`). Skripta to tiho guta i
   pravi diff od praznog stanja — tj. `create` bi generisao pun `CREATE
   TABLE` za cijelu bazu (uključujući tabele koje već postoje) umjesto
   pravog inkrementalnog dodatka. Zbog toga su, izgleda, i sve migracije
   nakon `append_only_guards` u ovom projektu ručno pisane. **Zaključak:
   svaku sljedeću migraciju pisati ručno** (kao `add_password_reset`,
   `add_evote_consent`, ...), nikad je ne generisati sa `create` dok god
   baza ima ove trigger funkcije.
2. **`Vote` i `AuditEvent` su append-only** (DB triger odbija svaki
   `UPDATE`/`DELETE`) — bilo koji budući migracioni backfill koji upisuje
   u te dvije tabele (ili u `PaymentAllocation`, treću append-only tabelu)
   mora prvo `ALTER TABLE ... DISABLE TRIGGER "<ime>_append_only"`, uraditi
   `UPDATE`, pa odmah `ALTER TABLE ... ENABLE TRIGGER "<ime>_append_only"`
   — vidjeti primjer u ovoj migraciji.

Takođe: **`prisma/seed.ts` još ne pravi `Membership` redove** (koristio bi
novi `prisma.membership` model, koji stalno generisani klijent u ovom
sandboxu ne poznaje dok se ne pokrene `npx prisma generate` na tvojoj
mašini — namjerno ostavljeno da se ne dira ništa van šeme/migracije u ovom
koraku). Posljedica: nakon svakog `npm run db:reset && npm run db:seed`
tokom razvoja, demo korisnici će imati `roles` popunjen kao i do sada, ali
**neće** imati odgovarajuće `Membership` redove sve dok se `seed.ts` ne
dopuni — planirano zajedno sa auth cutover korakom (4-6 iznad), kada
`Membership` ionako postaje jedini izvor istine za ulogu.

#### 6.2 Korak 4 — auth/sesija/Actor: završeno i verifikovano (2026-09-07, v1.1.0)

Sljedeći najuži rez, po dogovoru: samo `Actor`/sesija/guard prepravka, bez
diranja servisnog sloja (fakture, uplate, itd. — 30-ak fajlova, korak 5) i
bez test paketa za izolaciju (korak 6). Konkretno, urađeno je:

- Nova migracija `prisma/migrations/20260907072548_add_session_active_zev`:
  `Session.activeZevId` (nullable, **prava** FK ka `Zev`, `ON DELETE
  SET NULL`) — ovo više nije "meka" kolona kao u koraku 1-2, jer je dio
  auth sloja koji je sada u fokusu. Bez backfill-a namjerno: aktivni ZEV se
  računa lijeno pri prvom čitanju sesije (vidi `resolveActiveZev` u
  `session.ts`), ne popunjava unaprijed — sesije traju 12h pa se ionako
  brzo "samoizliječe".
- `Actor` (`guards.ts`) dobija `zevId?`/`isSuperAdmin?` (opciono, da
  postojeći test fixture-i koji ne znaju za tenant i dalje kompajliraju bez
  izmjene — servisni sloj ionako još ne čita ta polja).
  `AuthContext`/`getAuthContext` (`session.ts`) sada čita `roles` iz
  `Membership` za aktivni ZEV (ne iz `User.roles`), auto-bira ZEV kad
  korisnik ima tačno jedno članstvo (jedini stvarni slučaj danas), i
  provjerava da li je taj ZEV suspendovan (`Zev.active`) — ako jeste,
  `requireActor()` odjavljuje sesiju i vraća na `/login?err=zev_suspended`
  (namjerno NE na `/?err=...`, jer ta ruta i sama zove `requireActor()` pa
  bi se dobila beskonačna petlja preusmjeravanja za i dalje aktivnu sesiju).
- `createUserForParty`/`updateUserRoles` (`users.ts`) sada **dvostruko
  upisuju**: i dalje pišu `User.roles` (i dalje se čita direktno na koj-koj
  UI stranici, npr. checkbox-ovi uloga na stranici vlasnika) i usklađuju
  odgovarajuće `Membership` redove za `actor.zevId` — bez ovoga bi
  auth (koji sada čita isključivo `Membership`) i UI (koji i dalje čita
  `User.roles`) tiho divergirali čim neko doda/ukloni ulogu. Dodata i
  provjera da `Party.zevId` (kad je već postavljen) odgovara
  `actor.zevId`, u skladu sa potvrđenim pravilom iz §8.3.
- `prisma/seed.ts` i `tests/helpers.ts` ažurirani da prave odgovarajuće
  `Membership` redove za demo/test korisnike — bez ovoga bi
  `updateUserRoles`/`createUserForParty` odbijali test fixture-e (traže
  `actor.zevId`) i demo nalozi ne bi imali stvarne uloge nakon
  `db:reset && db:seed`.

**Verifikacija (2026-09-07):** kod je napisan u sandboxu bez mogućnosti
regeneracije Prisma klijenta (nema mrežnog pristupa binarnom schema-engine-u),
pa je provjera odrađena na korisnikovoj mašini, kroz Docker: `npx prisma
generate` (kroz privremeni `node:22-alpine` kontejner sa bind-mount-ovanim
projektom, jer host mašina nema instaliran Node), zatim puni pipeline —
`npm run typecheck && npm run lint && npm test && npm run build` (build
potvrđen kroz uspješan `docker compose up -d --build`, typecheck/lint/test
kroz `docker compose exec app ...` uz privremenu `zev_test` bazu) — sve
prošlo bez grešaka. Verzija podignuta na **1.1.0** (major, po dogovoru sa
korisnikom — mijenja temeljni model autorizacije, iako je ponašanje
identično za postojeći tenant).

**Preostalo, ne blokira:** ručna provjera u browseru (login → dashboard →
odjava, i da uređivanje uloga vlasnika na `/vlasnici/[id]` i dalje radi) —
preporučena kao brza dodatna provjera, ali automatizovani pipeline (uklj.
testove servisnog sloja koji vježbaju `Membership` dual-write) je već zelen.

#### 6.3 Korak 3 — NOT NULL + prave FK: završeno i verifikovano (2026-09-07, v1.2.0)

Sljedeći najuži rez po dogovoru: samo šema/migracija (DB integritet), bez
diranja servisnog sloja (korak 5) i bez test paketa (korak 6). Konkretno:

- Svih 32 "mekih" `zevId` kolona iz koraka 1-2 (`Party`, `Entrance`, `Unit`,
  `OwnershipStake`, `Occupancy`, `Proxy`, `OfficeTerm`, `AllocationGroup`,
  `CommonAsset`, `Meeting`, `VotingRule`, `Proposal`, `Vote`,
  `TransactionCategory`, `FinTransaction`, `ChargeItem`, `InvoiceBatch`,
  `Invoice`, `BankImportBatch`, `Payment`, `BalanceCorrection`, `Supplier`,
  `Expense`, `AnnualPlan`, `PlanItem`, `Project`, `MaintenanceIssue`,
  `WorkOrder`, `Document`, `Attachment`, `NotificationMessage`,
  `AuditEvent`) sada su **NOT NULL sa pravom `@relation` FK vezom** ka
  `Zev` (isti obrazac kao `Membership`/`Building`/`MoneyAccount` od
  početka).
- **Ključni problem i rješenje:** servisni sloj i dalje ne postavlja
  `zevId` eksplicitno ni na jednom `.create()` pozivu (to je korak 5, ~30
  fajlova). Da NOT NULL ne bi odmah pokvario svaki takav poziv, svaka
  kolona dobija **privremeni DB default** preko nove SQL funkcije
  `default_zev_id()` (`@default(dbgenerated("default_zev_id()"))` u
  schema.prisma) koja vraća id jedinog postojećeg (najstarijeg) `Zev` reda —
  ista dinamička logika kao subquery iz backfill-a u koraku 1-2, samo
  umotana u funkciju jer Postgres ne dozvoljava subquery direktno u DEFAULT
  izrazu. Ovo je namjerna privremena mjera za i dalje jednotenantsku
  aplikaciju — **mora se ukloniti u koraku 5** kad servisni sloj počne
  eksplicitno postavljati `zevId` iz `actor.zevId`, jer bi u suprotnom
  pisanje drugog tenanta tiho padalo nazad na tenant #1 umjesto da vidljivo
  puca.
- **Usput otkriveno i uključeno u ovaj korak** (po dogovoru sa korisnikom):
  9 postojećih `@@unique`/`@unique` ograničenja nije bilo svjesno tenanta —
  `Invoice.number`, `WorkOrder.number`, `Proposal(code, version)`,
  `AnnualPlan(year, kind, version)`, `Document(type, number, version)`,
  `InvoiceBatch(period, status)`, `TransactionCategory.name`,
  `VotingRule.name`, `AllocationGroup.name`. Svako od njih sada uključuje
  `zevId` kao prvo polje složenog ključa — bez ovoga bi se npr. dvije
  firme sudarile na broju fakture ili nazivu kategorije čim postoji drugi
  tenant.
- **Posljedica te promjene, pronađena kroz `npm run build`:** dva mjesta
  (`ensureCategory` u `finance.ts`, i istovjetna logika u
  `payments.ts` za bankovni import) su radila
  `transactionCategory.upsert({ where: { name } })` — to više ne
  kompajlira jer `name` sama više nije jedinstven ključ. Popravljeno na
  `findFirst` + `create` (isto get-or-create ponašanje za jedan tenant,
  bez atomičnosti upsert-a, što je zanemarivo za ovaj slučaj upotrebe).
  Obje izmjene su označene TODO komentarom da se prošire sa `zevId`
  filterom kad korak 5 stigne. Ostatak servisnog sloja provjeren
  (grep na `findUnique`/`upsert` za svih 9 pogođenih modela) — nema
  drugih pogođenih poziva, svi ostali su već po `id`.
- **Treća instanca istog problema, pronađena kroz `npm test`:**
  `tests/payments.test.ts` je provjeravao rezultat bankovnog importa preko
  `transactionCategory.findUniqueOrThrow({ where: { name } })` — isti
  slučaj kao gore, sad u test asserciji, ne u servisnom kodu (prvobitni
  grep bio je ograničen na `src/`, pa ovo mjesto nije uhvaćeno). Popravljeno
  na `findFirstOrThrow` (isti obrazac kao susjedna provjera `finTransaction`
  dva reda iznad). Naknadni grep po cijelom `tests/` folderu (svih 9
  pogođenih modela) potvrđuje da su svi preostali `findUnique(OrThrow)`
  pozivi po `id` — ovo je bilo posljednje mjesto.
- **Druga posljedica, pronađena kroz pun test pipeline:** `tests/helpers.ts`
  je pravio 5 `Party` reda **prije** nego što fixture uopšte napravi svoj
  `Zev` red. Dok god je `zevId` bio nullable, to je bilo bezopasno; sada
  kad zavisi od privremenog DB defaulta (`default_zev_id()` = globalno
  najstariji `Zev`), prva ikad izvršena fixtura na svježe resetovanoj test
  bazi (nula `Zev` redova) puca na NULL. Popravljeno premještanjem
  kreiranja `zev`-a na sam početak `createFixture` i eksplicitnim
  postavljanjem `zevId: zev.id` na svih 5 `Party` create poziva — ne samo
  da izbjegava pucanje, nego i osigurava da svaka fixtura svoje vlasnike
  ispravno veže za SVOJ zev, umjesto da (tiho, bez greške) zavisi od toga
  koji je zev "globalno najstariji" među svim paralelno pokrenutim test
  fajlovima. Isti eksplicitni `zevId` dodat i na jedno slično mjesto u
  `voting.test.ts`. Ostali direktni `prisma.<model>.create()` pozivi u
  testovima (npr. `Unit`/`Invoice`/`Expense`/`Occupancy` u
  `payments.test.ts`/`voting.test.ts`) rade tek nakon što fixture već
  postoji, pa im zev uvijek postoji do tada — nisu mijenjani, iako i oni
  formalno nasljeđuju istu privremenu (tiho pogrešan-tenant, nikad NULL)
  manu do koraka 5.
- `Zev` model dobija 32 nove back-relation `[]` liste (mehanički zahtjev
  Prisma šeme za dvosmjerne veze) — ne koriste se aktivno iz `Zev` strane
  danas.
- Migracija `prisma/migrations/20260907090000_zevid_not_null_fk`
  (ručno pisana, isti razlog kao i prethodne — schema-engine-wasm ne može
  introspektovati ovu bazu): kreira `default_zev_id()`, radi odbrambeni
  backfill (za slučaj da je neki red ostao `NULL` npr. zbog `db:reset &&
  db:seed` ciklusa između ova dva koraka), zatim SET DEFAULT + SET NOT
  NULL + FK + indeks po tabeli, pa na kraju popravlja 9 unique indeksa.
  `Vote`/`AuditEvent` append-only trigeri privremeno isključeni samo za
  odbrambeni backfill UPDATE (isti obrazac kao u koraku 1-2).

**Verifikacija:** puni pipeline (`typecheck`, `lint`, `test`, `build`) na
korisnikovoj mašini prošao čisto nakon tri kruga popravki otkrivenih kroz
sam pipeline (vidi bullete iznad — `ensureCategory`/`payments.ts` upsert,
`tests/helpers.ts` redoslijed fixture-a, i treća instanca istog
compound-unique problema u `tests/payments.test.ts`). CHANGELOG/verzija
zavedeni kao v1.2.0 (minor).

#### 6.4 Korak 5 — zevId filter u servisnom sloju: u toku, po modulima

Najveći i najrizičniji mehanički korak (~30 fajlova u `src/server/services/*`
i pozivaoci u `src/app/`). Po dogovoru sa korisnikom, radi se **sekvencijalno
po modulima** (ne sve odjednom), sa punim pipeline testom nakon svakog
modula. Privremeni DB default (`default_zev_id()` iz koraka 3) se **uklanja
tek na kraju koraka 5**, kad su svi `.create()` pozivi u cijelom servisnom
sloju eksplicitno prepravljeni — do tada ostaje kao sigurnosna mreža za
module koji još nisu obrađeni.

Novi guard `requireZev(actor)` u `src/server/auth/guards.ts`: vraća
`actor.zevId` ili baca grešku (401 ako nema actora, 403 "Nalog nema aktivan
ZEV" ako actor.zevId nije postavljen). Ovo je jedino mjesto koje pretvara
"actor nema aktivan tenant" u jasnu grešku — svaka servisna funkcija koja
dira tenant-scoped model poziva ga umjesto da vjeruje pozivaocu.

**Pravilo za sve module:** `.create()` pozivi više ne prihvataju `zevId` kao
parametar od pozivaoca (uklonjeno iz tipa) — funkcija ga uvijek izvede iz
`requireZev(actor)`. Read/update/delete pozivi po `id` koriste Prisma-in
"extended where unique" (`where: { id, zevId }`) — vraća/mijenja red samo
ako pripada actor-ovom tenantu, inače "nije pronađeno" umjesto curenja
podataka drugog tenanta. `findMany`/`count` dobijaju `zevId` u `where`.
Gdje je praktično, strane reference (npr. `buildingId` pri kreiranju
jedinice) provjeravaju se da pripadaju istom tenantu prije upisa.

**Modul 1 — property + ownership: napisano, NEPROVJERENO (2026-09-07)**

Obuhvata `src/server/services/property.ts` (ZEV, zgrade, ulazi, jedinice,
grupe alokacije, zajednički dijelovi) i `src/server/services/ownership.ts`
(lica, vlasnički udjeli, stanari, punomoći, organi ZEV), plus najuži mogući
dodir u susjednim fajlovima da sve ostane tipski konzistentno:

- `property.ts`: `getZev`/`upsertZev` sada uzimaju `actor` i rade nad
  `actor.zevId` umjesto `findFirst()` (koji bi u multi-tenant svijetu
  pogodio proizvoljan ZEV). `createBuilding`/`createEntrance`/`createUnit`/
  `createAllocationGroup`/`createCommonAsset` više ne primaju `zevId` od
  pozivaoca; validiraju da referencirana zgrada/ulaz/jedinice pripadaju
  actor-ovom ZEV-u prije upisa. `unitsInScope()` (dijeljena helper funkcija,
  koristi je i billing.ts i meetings.ts) sada prima `zevId` kao prvi
  parametar.
- `ownership.ts`: sve funkcije nad `Party`/`OwnershipStake`/`Occupancy`/
  `Proxy`/`OfficeTerm` sada filtriraju/upisuju po `actor.zevId`, uz provjeru
  da referencirane jedinice/lica/sjednice pripadaju istom tenantu.
  Dijeljene helper funkcije bez sopstvenog actora
  (`currentStakesForUnit`, `activeProxyFor`, `boardVotingBasis`,
  `ownersVotingBasis`) sada primaju `zevId` kao eksplicitan parametar —
  njihovi pozivaoci u `billing.ts`/`meetings.ts` prepravljeni da ga
  proslijede (samo ta dva poziva; ostatak tih fajlova čeka svoj modul).
- `finance.ts`: `createAccount`/`listAccounts` prepravljeni na isti obrazac
  (MoneyAccount je od početka imao "pravi" zevId, ali servisna funkcija je
  primala `zevId` od pozivaoca — sada ga izvodi iz actor-a), pošto su im
  jedini pozivaoci (`podesavanja/page.tsx`) morali da se prepravе zajedno sa
  `property.ts`.
- Pozivaoci prepravljeni da više ne dobavljaju `zev` ručno prije poziva:
  `src/app/(app)/zgrade/page.tsx`, `src/app/(app)/podesavanja/page.tsx`.
- Testovi prepravljeni da prate nove potpise: `tests/helpers.ts`
  (`createBuilding`/`createAccount` bez `zevId`), `tests/board.test.ts`
  (`boardVotingBasis(f.zev.id)`).

**Namjerno van obuhvata ovog modula** (čeka svoj red): `billing.ts`,
`meetings.ts`, `payments.ts`, `finance.ts` (transakcije/kategorije),
`expenses.ts`, `plans.ts`, `maintenance.ts`, `documents.ts`,
`attachments.ts`, `evoteConsent.ts`, `reports.ts`, `users.ts` — dotaknuti
su samo oni pozivi neophodni da modul 1 ostane tipski ispravan (vidi
bullete iznad), ne puni zevId-filter prolaz kroz te fajlove.

**Zašto NEPROVJERENO:** isti razlog kao ranije — sandbox nema mrežni
pristup za `npx prisma generate`/schema-engine, pa ne postoji način da se
ovdje pokrene stvarni `tsc`/`build` protiv trenutne šeme (lokalno
generisani Prisma klijent u sandbox-u je zastario od prije multitenancy-ja
i daje samo lažne greške). Čeka se puni pipeline na korisnikovoj mašini.

**Modul 2 — finansije/fakturisanje/uplate: napisano, NEPROVJERENO (2026-09-08)**

Obuhvata `src/server/services/finance.ts` (računi, transakcije, kategorije,
gotovina, rezervni fond — ostatak fajla, nakon što je `createAccount`/
`listAccounts` već urađen u modulu 1), `src/server/services/billing.ts`
(stavke zaduženja, mjerni uređaji, pregled/serije obračuna, izdavanje,
storniranje i korekcija faktura) i `src/server/services/payments.ts`
(ručni unos uplate, CSV/PDF uvoz izvoda, upoređivanje, alokacija/storno
alokacije/storno uplate, saldo vlasnika, korekcije salda). Isti obrazac kao
u modulu 1, dosljedno primijenjen na sve funkcije u sva tri fajla:

- `finance.ts`: `enterTransaction`/`cancelTransaction`/`listTransactions`/
  `listCategories`/`ensureCategory`/`accountBalance`/`totalCash`/
  `reserveFundBalance` sada filtriraju/upisuju po `actor.zevId`.
  `ensureCategory` mijenja potpis na `(actor, name, kind)` (ranije `(name,
  kind)`, upsert-by-name popravljen još u koraku 3 ali bez zevId filtera) —
  jedina stvarna promjena potpisa u ovom modulu; pozivaoci prepravljeni
  (`src/app/(app)/troskovi/page.tsx`, `tests/expenses-plans.test.ts`).
  `listCategories` dobija `actor` parametar (nije imao pozivaoce, provjereno
  grep-om — nema dodatnih izmjena na pozivnim mjestima).
- `billing.ts`: sve funkcije nad `ChargeItem`/`MeterReading`/`InvoiceBatch`/
  `Invoice` sada filtriraju/upisuju po `actor.zevId`, uz provjeru da
  referencirana zgrada/ulaz/grupa alokacije/jedinice pripadaju istom
  tenantu prije upisa. `MeterReading` nema sopstvenu `zevId` kolonu (vidi
  schema.prisma) — tenant se provjerava indirektno kroz njena dva
  roditelja (`chargeItemId`, `unitId`) prije upisa. Interni helper
  `nextInvoiceNumber` dobija `zevId` kao eksplicitan parametar (bez ovoga bi
  numeracija faktura bila po jednoj globalnoj sekvenci umjesto po tenantu —
  `Invoice.number` je unique po `[zevId, number]` još od koraka 3).
- `payments.ts`: sve funkcije nad `Payment`/`BankImportBatch`/
  `BalanceCorrection` sada filtriraju/upisuju po `actor.zevId`.
  `PaymentAllocation` nema sopstvenu `zevId` kolonu — `reverseAllocation`
  provjerava tenant indirektno kroz roditeljski `Payment`
  (`orig.payment.zevId !== zevId` → tretira se kao "nije pronađeno").
  Interni helperi bez sopstvenog actora (`fetchOpenInvoiceCandidates`,
  `refreshPaymentStatus`, `refreshInvoiceStatus`) dobijaju `zevId` kao
  eksplicitan parametar. `commitPdfImport`-ova get-or-create logika za
  `TransactionCategory` (ista vrsta poziva kao `ensureCategory`, ali
  duplirana jer radi unutar sopstvene transakcije) sada je i zevId-scoped —
  TODO komentar iz koraka 3 uklonjen. Nijedan javni potpis u ovom fajlu se
  ne mijenja (svi već primaju `actor` kao prvi parametar) — sve pozivaoce u
  `src/app/(app)/fakture/uplate/*` i `src/app/(app)/page.tsx`/`vlasnici/
  [id]/page.tsx` provjereno grep-om, bez potrebe za izmjenom.
- Testovi prepravljeni: `tests/payments.test.ts` je na više mjesta pravio
  `Unit`/`Invoice`/`Expense` redove direktno preko `prisma.<model>.create()`
  bez `zevId` (oslanjajući se na privremeni DB default iz koraka 3, koji
  vraća globalno najstariji `Zev` — gotovo sigurno NE fixture-in vlastiti
  `zev`, pošto se testovi izvršavaju u dijeljenoj bazi). Dok god upiti u
  `payments.ts` nisu bili zevId-filtrirani to je bilo bezopasno; sada bi
  tihо pucalo (prazni rezultati / "nije pronađeno" umjesto očekivanih
  podudaranja). Svih 6 pogođenih `Unit`/`Invoice` parova i oba `Expense`
  poziva dobili eksplicitan `zevId: f.zev.id` — isti obrazac kao popravka
  `tests/helpers.ts` iz koraka 3.

**Dopuna nakon prve povratne informacije s korisnikove mašine (2026-09-08):**
`npm run build` je pukao na `prisma/seed.ts` — fajl je propušten kod
grep-a koji je pratio module 1/2 (nije ni servisni sloj ni test), a i dalje
poziva `property.createBuilding`/`finance.createAccount` sa `zevId` u
podacima (uklonjeno iz tipa u modulu 1/2) i `finance.ensureCategory` sa
starim dvoargumentnim potpisom (promijenjeno u modulu 2). Popravljeno:
`zevId` uklonjen iz sva 4 poziva, `ensureCategory` dobija `accountant` kao
prvi argument na sva 4 mjesta. Usput otkriven dublji problem dok se ovo
popravljalo: `president`/`accountant` `Actor` objekti u seed-u uopšte nisu
imali `zevId` postavljen — bezopasno dok god ništa nije čitalo to polje, ali
bi od modula 1 nadalje `property.upsertZev(president, {...})` (poziv kojim
seed pravi sam prvi `Zev` red) pukao na `requireZev()` ("Nalog nema aktivan
ZEV"), jer taj guard zahtijeva da `actor.zevId` već postoji — a on ne može
postojati prije nego što `Zev` red uopšte postoji. Ovo je suštinski isti
"ko je prvi, kokoška ili jaje" problem koji je Faza 1 (bootstrap prvog
tenanta od strane super admina, još nije izgrađena) treba da riješi na
pravi način; seed skripta ga rješava zaobilazno tako što prvi `Zev` red
pravi direktno preko `prisma.zev.create()` (ne preko `upsertZev`), pa tek
onda gradi `president`/`accountant` (i `anaActor` za `maintenance.ts`, koji
zevId još ne čita, ali radi konzistentnosti isto dobija) sa `zevId: zev.id`
iz tog reda. `property.upsertZev` sam po sebi nije mijenjan — i dalje važi
da ga smije pozvati samo actor koji već ima aktivan ZEV (npr. predsjednik
koji uređuje podatke svog postojećeg ZEV-a na `/podesavanja`).

**Namjerno van obuhvata ovog modula** (čeka svoj red): `meetings.ts`,
`expenses.ts`, `plans.ts`, `maintenance.ts`, `documents.ts`,
`attachments.ts`, `evoteConsent.ts`, `reports.ts`, `users.ts`.

**Zašto NEPROVJERENO:** isti razlog kao za modul 1 — sandbox i dalje nema
mrežni pristup za `npx prisma generate`. Čeka se puni pipeline na
korisnikovoj mašini.

**Otkriveno 2026-09-08 tokom provjere modula 2: modul 1 nikad zapravo nije
stigao na korisnikov disk.** Kad su `property.ts`/`ownership.ts` prvi put
poslati (kraj modula 1), oba pokušaja pisanja na disk su tada javila da veza
sa uređajem nije uspostavljena — korisnik je o tome obaviješten, ali je
naknadno javio da su "svi testovi prošli" i tražio nastavak na modul 2.
Ispostavilo se da je taj test-prolaz zapravo bio nad **starim** kodom (stanje
prije koraka 5) — fajlovi sa modula 1 zaista nikad nisu stigli. Ovo je
otkriveno tek kad je build pukao na `zevId` grešci u `zgrade`-vezanim
pozivima koje modul 1 treba da ukloni; provjera direktno na korisnikovom
disku (staging + grep) potvrdila je da su `guards.ts` (bez `requireZev`),
`property.ts` (bez `requireZev`, `createBuilding` i dalje traži `zevId` od
pozivaoca) i `tests/helpers.ts` bili identični pretkorak-5 stanju, iako je
disk već imao **nove** `finance.ts`/`billing.ts`/`payments.ts` iz modula 2
(koji zavise od modula-1 potpisa) — očigledna nekonzistentnost koja bi
build učinila neispravnim na više mjesta odjednom. Svih 8 modul-1 fajlova
(`guards.ts`, `property.ts`, `ownership.ts`, `meetings.ts`,
`zgrade/page.tsx`, `podesavanja/page.tsx`, `tests/helpers.ts`,
`tests/board.test.ts`) ponovo poslano i ovaj put potvrđeno na disku
(staging + grep) da su stvarno stigli. **Pouka za ubuduće:** ne vjerovati
korisnikovoj potvrdi "testovi su prošli" kao dokazu da su fajlovi stigli na
disk — kad god `device_commit_files` prijavi grešku, tretirati to kao da
fajlovi NISU stigli dok se suprotno ne potvrdi (npr. `device_stage_files` +
čitanje sadržaja), bez obzira na kasniji utisak korisnika o ishodu testova.

**Modul 3 — sjednice/glasanje: napisano, NEPROVJERENO (2026-09-08)**

Obuhvata cijeli `src/server/services/meetings.ts` (sjednice, dnevni red,
prisustvo, pravila glasanja, prijedlozi i njihove revizije, elektronsko
izjašnjavanje — token izdavanje/opoziv/reizdavanje, ručni unos i korekcija
glasa, zatvaranje glasanja i rezultat, evidentiranje odluke,
vlasnicima-okrenuti upiti). Isti obrazac kao u modulima 1 i 2, primijenjen
na svaku funkciju:

- `Meeting`, `VotingRule`, `Proposal`, `Vote` imaju sopstvenu `zevId`
  kolonu (sve četiri dobile `@default(dbgenerated("default_zev_id()"))` u
  koraku 3) — direktno filtriranje/upisivanje po `actor.zevId` kroz
  `where: {id, zevId}` odn. `data: {..., zevId}`.
- `AgendaItem` i `Attendance` nemaju sopstvenu `zevId` kolonu (samo
  `meetingId`/`partyId`) — tenant se provjerava indirektno tako što se
  roditeljski `Meeting` (i, za `recordAttendance`, i `Party`) prvo
  učita/provjeri sa `where: {id, zevId}` prije upisa.
- `EligibleVoter`, `ApprovalToken`, `ProposalUnit` nemaju sopstvenu `zevId`
  kolonu — tenant se provjerava indirektno kroz njihov `Proposal`
  (`revokeToken`/`reissueToken`/`recordManualVote` učitavaju
  `eligibleVoter.proposal`/`approvalToken.eligibleVoter.proposal` i porede
  `.zevId !== zevId` → tretiraju kao "nije pronađeno").
- `submitVote` (javni, neautentifikovani tok preko tokena — nema `actor`)
  ne prima `zevId` od pozivaoca; izvodi ga iz samog prijedloga
  (`t.eligibleVoter.proposal.zevId`) prije upisa u `Vote.create()`.
  `inspectApprovalToken` ostaje bez izmjena — čisto pretraga po hash-u
  tokena, bez upisa bilo čega tenant-scoped.
- Interni helperi bez `actor`-a dobijaju `zevId` kao eksplicitan parametar:
  `effectiveVotes(zevId, proposalId)` i `computeProposalResult(zevId,
  proposalId)` (oba su ranije primala samo `proposalId`) — promjena
  potpisa zahtijevala izmjenu na 3 poziva izvan ovog fajla:
  `closeVoting` (unutar istog fajla), `src/app/(app)/skupstina/prijedlog/
  [id]/page.tsx` (`computeProposalResult(p.zevId, p.id)`) i 3 mjesta u
  `tests/voting.test.ts` (`computeProposalResult(f.zev.id, proposal.id)`).
- `openProposalsForOwner` i `ownVotes` nemaju postojeće pozivaoce nigdje u
  kodu (provjereno grep-om) — ipak popravljeni radi ispravnosti/buduće
  upotrebe, bez potrebe za izmjenom pozivnih mjesta.
- Nijedan drugi javni potpis u ovom fajlu nije mijenjan (svi već primaju
  `actor` kao prvi parametar) — svi pozivaoci u `src/app/(app)/skupstina/*`,
  `src/app/glasanje/[token]/page.tsx`, `tests/helpers.ts`,
  `tests/board.test.ts`, `tests/voting.test.ts`, `tests/permissions.test.ts`
  provjereni grep-om, bez potrebe za dodatnim izmjenama.
- `src/server/services/documents.ts` ne uvozi ništa iz `meetings.ts` (ide
  direktno na Prisma za PDF generisanje) — ostaje van obuhvata, kao i
  ranije planirano.

**Namjerno van obuhvata ovog modula** (čeka svoj red): `expenses.ts`,
`plans.ts`, `maintenance.ts`, `documents.ts`, `attachments.ts`,
`evoteConsent.ts`, `reports.ts`, `users.ts`.

**Zašto NEPROVJERENO:** isti razlog kao za module 1 i 2 — sandbox nema
mrežni pristup za `npx prisma generate`. Lokalni `tsc --noEmit` javlja samo
očekivane greške zastarjelog generisanog klijenta (nedostaje `zevId`/
relacije po cijeloj šemi); `eslint` je čist na svim dotaknutim fajlovima.
Čeka se puni pipeline na korisnikovoj mašini — a ovog puta je isporuka
fajlova na disk **eksplicitno provjerena** (`device_stage_files` + čitanje
sadržaja nazad), u skladu sa poukom iz modula 2.

**Modul 4 — dokumenti/prilozi: napisano, NEPROVJERENO (2026-09-08)**

Obuhvata cijeli `src/server/services/documents.ts` (generisanje i čuvanje
svih PDF dokumenata — faktura, kartica vlasnika, izjava o saglasnosti za
e-glasanje, poziv na sjednicu, zapisnik, odluka, glasačka lista, godišnji
plan, opomena, radni nalog, finansijski izvještaj, izvještaj dugovanja) i
cijeli `src/server/services/attachments.ts` (upload/čitanje priloga —
dokaz o vlasništvu, opšta biblioteka dokumenata, skenirana saglasnost).
Isti obrazac kao u prethodna tri modula:

- `Document` i `Attachment` imaju sopstvenu `zevId` kolonu (kao i
  `NotificationMessage`, vidi ispod) — direktno filtriranje/upisivanje.
- Dva interna helpera bez `actor`-a dobijaju `zevId` kao eksplicitan
  parametar: `nextDocNumber(zevId, type)` (ranije `(type)` — bez ovoga bi
  numeracija dokumenata bila globalna umjesto po tenantu, a
  `Document.number` je unique po `[zevId, type, number, version]` još od
  koraka 3) i `zevHeader(doc, zevId, meta)` (ranije `(doc, meta)` i čitao
  podatke o ZEV-u preko `prisma.zev.findFirst()` — u višezakupačkom svijetu
  "prvi ZEV u bazi" je proizvoljan i skoro sigurno pogrešan; sada čita
  tačno `zev` na koji je izdavalac dokumenta prijavljen). Oba helpera imaju
  pozive na desetak mjesta u fajlu (svaki `generate*Pdf`) — svi ažurirani.
- `storeDocument(actor, input)` je jedina funkcija u fajlu čiji `actor`
  parametar dozvoljava `null` (rezervisano za eventualni budući
  sistemski/bez-korisnika generisan dokument). Kako danas nijedan pozivalac
  ne prosljeđuje `null` i `Document.zevId` nema smislenu vrijednost bez
  aktora, `requireZev(actor)` se poziva bezuslovno — baca `AuthError` za
  `null`, isto kao što `requireRole`/`requireAnyUser` već rade za svoje
  nullable potpise.
- Svaka `generate*Pdf` funkcija dobija `const zevId = requireZev(actor)` i
  provjerava da izvorni zapis (faktura, vlasnik, sjednica, prijedlog, plan,
  radni nalog) pripada tom tenantu preko `where: {id, zevId}` prije nego
  što se iz njega generiše PDF; naknadni `update()` pozivi (npr. upis
  `documentId` nazad na fakturu/radni nalog) su isto tako scoped.
- `listDocuments`/`readDocumentFile`/`publishDocument` filtriraju/upisuju
  po `actor.zevId`; `readDocumentFile`-ova provjera "vlasnik čita svoju
  fakturu" dodatno scope-uje i tu fakturu.
- `attachments.ts`: `uploadAttachment`, `createLinkedAttachmentTx` (poziva
  se iz `ownership.ts` i `evoteConsent.ts` unutar tuđe transakcije — nema
  promjene potpisa, samo interno sad izvodi `zevId` iz `actor`-a),
  `listAttachments`, `listOwnershipProofsByStakeIds`, `readAttachmentFile`
  filtriraju/upisuju po `actor.zevId`. `readAttachmentFile`-ova provjera
  "vlasnik čita dokaz vezan za svoj udio" dodatno scope-uje i taj
  `OwnershipStake` prije poređenja `ownerId`-a.
- Nijedan javni potpis se ne mijenja (svi već primaju `actor` kao prvi
  parametar) — svi pozivaoci (`src/app/api/dokumenti/*`,
  `src/app/api/izvjestaji/*`, `src/app/api/prilozi/[id]/route.ts`,
  `src/app/(app)/fakture/*`, `planovi/[id]`, `odrzavanje/[id]`,
  `skupstina/*`, `dokumenti/page.tsx`, `vlasnici/[id]/page.tsx`,
  `tests/documents-audit.test.ts`, `tests/attachments.test.ts`) provjereni
  grep-om, bez potrebe za izmjenom. Testovi u oba fajla ne prave nikakve
  sirove `prisma.document.create()`/`prisma.attachment.create()` redove
  mimo servisnog sloja niti pretražuju po dvosmislenim kriterijumima (samo
  po jedinstvenim id-jevima) — za razliku od modula 2, ovdje nije bilo
  potrebno ništa popravljati u testovima.

**Otkriveni, namjerno neriješeni gap: `NotificationMessage`/
`queueNotification`.** `NotificationMessage` takođe ima `zevId` kolonu
(faza 0), ali funkcija koja je upisuje — `queueNotification` u
`src/server/notifications/service.ts` — nije ni u jednom Korak-5 fajlu
(živi van `src/server/services/*`) i ne prima `zevId` ni na koji način;
oba njena pozivaoca (`meetings.ts` iz modula 3, i `users.ts`, planiran za
modul "reports/administration") imaju `zevId` na dohvat ruke, ali ga ne
prosljeđuju. Popravka zahtijeva promjenu `queueNotification`-ovog potpisa
i ažuriranje oba pozivaoca odjednom — što bi ovaj modul proširilo izvan
`documents.ts`/`attachments.ts` i djelimično preskočilo modul koji tek
dolazi na red (`users.ts`). Namjerno ostavljeno za kasnije: ili kao dio
modula "reports/administration" (kad se ionako dira `users.ts`), ili kao
poseban sitan zahvat neposredno prije uklanjanja `default_zev_id()`
default-a na kraju Koraka 5 — svakako prije Koraka 6 (test paket za
izolaciju zakupaca), jer bi taj test paket ovaj propust vjerovatno uhvatio.

**Namjerno van obuhvata ovog modula** (čeka svoj red): `expenses.ts`,
`plans.ts`, `maintenance.ts`, `evoteConsent.ts`, `reports.ts`, `users.ts`,
`src/server/notifications/service.ts` (vidi gap iznad).

**Zašto NEPROVJERENO:** isti razlog kao za module 1-3 — sandbox nema
mrežni pristup za `npx prisma generate`. Lokalni `tsc --noEmit` javlja
samo očekivane greške zastarjelog generisanog klijenta; `eslint` je čist
na oba dotaknuta fajla. Čeka se puni pipeline na korisnikovoj mašini —
isporuka fajlova na disk ponovo eksplicitno provjerena (`device_stage_files`
+ čitanje sadržaja nazad), u skladu sa poukom iz modula 2.

**Modul 5 — troškovi/planovi/održavanje: napisano, NEPROVJERENO (2026-09-08)**

Obuhvata cijeli `src/server/services/expenses.ts` (dobavljači, troškovi,
upozorenje na duplikat fakture, plaćanje troška), cijeli
`src/server/services/plans.ts` (godišnji planovi i njihove stavke,
verzionisanje, prijedlog/odobrenje preko skupštinske odluke, planirano-
naspram-ostvarenog, projekti) i cijeli `src/server/services/maintenance.ts`
(prijave kvarova od statusa prijave do zatvaranja, ponude izvođača, radni
nalozi, hitne intervencije s obaveznim obrazloženjem). Isti obrazac kao u
prethodna četiri modula:

- `Supplier`, `Expense`, `AnnualPlan`, `PlanItem`, `Project`,
  `MaintenanceIssue`, `WorkOrder` imaju sopstvenu `zevId` kolonu —
  direktno filtriranje/upisivanje po `actor.zevId`.
- `ContractorOffer`, `IssueComment`, `PlanItemUnit` nemaju sopstvenu
  `zevId` kolonu — tenant se provjerava indirektno kroz roditelja:
  `addOffer`/`createWorkOrder` prije upisa provjeravaju da prijava kvara i
  dobavljač pripadaju tenantu; `selectOffer` učitava ponudu zajedno s
  njenom prijavom (`include: {issue: true}`) i poredi
  `offer.issue.zevId !== zevId`; `addIssueComment` (koja ranije uopšte
  nije imala guard — sad dobija `requireAnyUser`/`requireZev` kao i sve
  ostalo) provjerava roditeljsku prijavu prije upisa komentara.
- `createExpense` i `addPlanItem` validiraju SVAKU opcionu stranu vezu
  prije upisa (dobavljač/kategorija/zgrada/ulaz/projekat/stavka
  plana/prijava kvara/radni nalog za trošak; zgrada/ulaz/projekat/
  jedinice za stavku plana) — isti "provjeri FK prije pisanja" obrazac kao
  u modulima 1-3, primijenjen ovdje na znatno širi skup opcionih polja
  nego ranije jer `Expense` i `PlanItem` imaju najviše opcionih stranih
  veza od svih modela dosad dotaknutih u Koraku 5.
- `reportIssue` (bilo koji prijavljeni vlasnik) validira
  zgradu/ulaz/jedinicu prije upisa prijave, iako `buildingId`/`entranceId`
  na `MaintenanceIssue` nisu prave FK kolone u šemi (samo plain string) —
  ipak se tretiraju kao referenca na tenant-scoped zapis, dosljedno
  opreznijem tretmanu istih polja u `expenses.ts`.
- `payExpense` dodatno validira da `accountId` (račun sa kojeg se plaća)
  pripada tenantu prije upisa `FinTransaction`-a.
- Numerisanje radnih naloga (`createWorkOrder`, `WorkOrder.number` je
  unique po `[zevId, number]` još od koraka 3) sada broji samo naloge
  istog tenanta — `prisma.workOrder.count()` postaje
  `prisma.workOrder.count({where: {zevId}})`. Napomena: brojanje i dalje
  nije ograničeno na tekuću godinu (isto ponašanje kao prije ove izmjene —
  taj kvalitet numeracije nije uveden niti popravljen u ovom modulu).
- Nijedan javni potpis se ne mijenja (svi već primaju `actor` kao prvi
  parametar) — svi pozivaoci (`src/app/(app)/troskovi/page.tsx`,
  `planovi/page.tsx`, `planovi/[id]/page.tsx`, `odrzavanje/page.tsx`,
  `odrzavanje/[id]/page.tsx`, `src/app/(app)/page.tsx`,
  `tests/expenses-plans.test.ts`) provjereni grep-om, bez potrebe za
  izmjenom. `tests/expenses-plans.test.ts` ne pravi nikakve sirove
  `prisma.<model>.create()` pozive mimo servisnog sloja niti pretražuje po
  dvosmislenim kriterijumima — kao ni u modulu 4, ovdje nije bilo potrebno
  ništa popravljati u testovima.

**Namjerno van obuhvata ovog modula** (čeka svoj red): `evoteConsent.ts`,
`reports.ts`, `users.ts`, `src/server/notifications/service.ts` (gap
otkriven u modulu 4, još uvijek otvoren). `expenses-plans.test.ts` poziva
`allocationSummary` iz `reports.ts` koja još NIJE zevId-scoped — to je
postojeće ograničenje modula "izvještaji/administracija", ne nešto uvedeno
ili pogoršano ovim modulom.

**Zašto NEPROVJERENO:** isti razlog kao za module 1-4 — sandbox nema
mrežni pristup za `npx prisma generate`. Lokalni `tsc --noEmit` javlja
samo očekivane greške zastarjelog generisanog klijenta; `eslint` je čist
na sva tri dotaknuta fajla. Čeka se puni pipeline na korisnikovoj mašini —
isporuka fajlova na disk ponovo eksplicitno provjerena (`device_stage_files`
+ čitanje sadržaja nazad), u skladu sa poukom iz modula 2.

**Modul 6 — izvještaji/administracija: napisano, NEPROVJERENO (2026-09-08) —
posljednji modul Koraka 5**

Obuhvata cijeli `src/server/services/reports.ts` (operativni finansijski
izvještaji — tok gotovine, prihod/rashod, potraživanja, dobavljači,
neplaćene fakture dobavljača, zbir po zgradi/ulazu/projektu, dugovanja po
vlasnicima), cijeli `src/server/services/users.ts` (administracija korisničkih
naloga — role, aktivacija/deaktivacija, lozinke) i cijeli
`src/server/services/evoteConsent.ts` (saglasnost za elektronsko glasanje).
Prva dva fajla dijele iste tenant-scoped modele kao ranije, ali `users.ts`
zahtijeva suštinski drugačiji pristup — vidi niže.

- `reports.ts`: svih sedam izvještajnih funkcija
  (`cashFlowReport`/`incomeExpenseReport`/`receivablesReport`/
  `supplierReport`/`unpaidSupplierInvoices`/`allocationSummary`/
  `ownerDebtReport`) dobija `const zevId = requireZev(actor)` i filtrira
  svaki upit (`MoneyAccount`, `FinTransaction`, `Invoice`, `Expense`,
  `Party`) po njemu. `allocationSummary`-ini pomoćni upiti koji grade
  mapu naziva (zgrada/ulaz/projekat, za prikaz umjesto sirovog id-a) su isto
  scoped — bez ovoga bi po jedan red iz svakog tenanta mogao pogrešno dobiti
  naziv iz drugog. `toCsv` ostaje čista funkcija bez pristupa bazi, bez
  izmjene.
- `evoteConsent.ts`: `markEVoteConsentSigned`/`revokeEVoteConsent` filtriraju
  i upisuju `Party.eVoteConsentStatus` po `where: {id, zevId}`;
  `getEVoteConsentHistory` dodatno provjerava (novi red koda, prije nije
  postojao) da lice pripada tenantu prije nego što vrati istoriju, pa tek
  onda filtrira `AuditEvent` po `zevId`.
- **`users.ts` — arhitektonski drugačiji slučaj.** `User` je namjerno
  **ostao bez sopstvene `zevId` kolone** (vidi sekcije 4.3/5) — jedan
  korisnički nalog može imati `Membership` u više ZEV-ova, ili nijednom, pa
  filtriranje `prisma.user.findMany({where: {zevId}})` naprosto nije
  moguće niti smisleno. Umjesto toga, svaka funkcija koja djeluje na
  konkretan `userId` prvo mora potvrditi da taj korisnik uopšte pripada
  ZEV-u actora koji poziva — preko njegovog povezanog `Party` reda (isti
  invarijant na koji se već oslanja `createUserForParty`: "Party uvijek
  pripada tačno jednom ZEV-u", §8.3). Novi helper:
  ```ts
  async function assertUserInZev(zevId: string, userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { party: true } });
    if (!user.party || user.party.zevId !== zevId) {
      throw new Error("Korisnik nije pronađen u ovom ZEV-u.");
    }
    return user;
  }
  ```
  `deactivateUser`/`activateUser`/`updateUserRoles` sada pozivaju ovaj
  helper prije bilo kakve izmjene — bez njega bi predsjednik jednog ZEV-a
  mogao (de)aktivirati ili mijenjati role bilo kog korisnika na cijeloj
  platformi, samo ako pogodi njegov `userId`. `createUserForParty` je
  pojednostavljen na isti obrazac: ručna provjera "da li party pripada
  ovom ZEV-u" zamijenjena scoped `findUniqueOrThrow({where: {id, zevId}})`
  pozivom (sad kad je `Party.zevId` garantovano NOT NULL od koraka 3, više
  nije bilo potrebe za posebnom `ForbiddenError` granom — nepripadajući ili
  nepostojeći party sad ravnopravno ispada kao "nije pronađen").
- **Pravi bug pronađen i popravljen:** `assertNotLastActivePresident` (guard
  koji sprječava brisanje/deaktivaciju posljednjeg aktivnog predsjednika)
  je do sada brojao aktivne predsjednike **preko cijele platforme**, preko
  zastarjelog `User.roles` polja (`prisma.user.count({where: {id: {not:
  userId}, active: true, roles: {has: "PRESIDENT"}}})`) — bez ikakvog
  `zevId` filtera. U višezakupačkom svijetu ovo je stvaran propust: broj
  predsjednika ZEV-a B bi mogao "prekriti" činjenicu da ZEV A upravo gubi
  svog jedinog predsjednika (ili obrnuto). Popravljeno brojanjem preko
  `Membership` (koja od koraka 4 tačno odražava rolu-po-tenantu), scoped na
  `zevId` actora koji poziva:
  ```ts
  const others = await prisma.membership.count({
    where: { zevId, role: "PRESIDENT", userId: { not: userId }, user: { active: true } },
  });
  ```
  Oba pozivaoca (`deactivateUser`, `updateUserRoles`) prepravljena da
  proslijede `zevId`.
- **Namjerno OSTAVLJENO neriješeno (arhitektonsko/produktno pitanje, ne
  jednostavan filter):** `deactivateUser`/`activateUser` i dalje mijenjaju
  `User.active` — jedno **globalno** polje na cijelom nalogu. Za korisnika
  čiji nalog ima `Membership` u više ZEV-ova, predsjednik ZEV-a A koji
  deaktivira taj nalog time zaključava korisnika i iz ZEV-a B. Ovo NIJE
  popravljeno u ovom modulu — zahtijeva odluku šta "deaktivirati" treba da
  znači za nalog sa članstvom u više tenanata (po-članstvu vs. po-nalogu),
  što je produktna odluka, ne mehanička izmjena upita. Označeno komentarom
  u kodu (`users.ts`, iznad `deactivateUser`) i ovdje, čeka razgovor prije
  nego što se rješava.
- **Zatvoren gap odgođen iz modula 4: `queueNotification`/
  `NotificationMessage`.** `queueNotification` (u
  `src/server/notifications/service.ts`, van `src/server/services/*`, zato
  nije bio ni u jednom ranijem modulu) dobija novo, **opciono** `zevId?:
  string` polje — namjerno opciono, ne obavezno, jer pokoji pozivalac (npr.
  `requestPasswordReset` u `users.ts`) nema jedan smislen tenant kome bi
  upisao poruku (korisnik može imati članstvo u više ZEV-ova ili nijednom).
  Pozivaoci koji zevId imaju na dohvat ruke sad ga prosljeđuju:
  `meetings.ts` (`openVoting`, `reissueToken` — oba već imala `const zevId
  = requireZev(actor)` iz modula 3), i dva novootkrivena pozivaoca izvan
  servisnog sloja, `src/app/(app)/skupstina/[id]/page.tsx` (slanje poziva
  na sjednicu) i `src/app/(app)/fakture/serija/[id]/page.tsx` (slanje
  obavještenja o izdatoj fakturi) — oba su, ispostavilo se, imala `actor` na
  dohvat ruke pa je dodavanje `const zevId = requireZev(actor)` bilo
  direktno. `requestPasswordReset` namjerno NE prosljeđuje `zevId` (red i
  dalje pada na privremeni `default_zev_id()` DB default) — otvoreno
  pitanje koje treba riješiti prije nego što se taj default ukloni.
- **Usput otkriven i popravljen pravi cross-tenant propust u
  `skupstina/[id]/page.tsx`** (van `src/server/services/*`, ali direktno na
  putu izmjene `queueNotification` poziva iznad, pa popravljeno tu gdje je
  nađeno): kad se sjednica prebacuje u status `INVITATIONS_SENT` za
  ne-upravni-odbor sastanak, stranica je čitala **sve** vlasnike preko
  `prisma.party.findMany({where: {active: true, email: {not: null}, ...}})`
  — bez `zevId` filtera — i svakom slala e-mail poziv na sjednicu. U
  višezakupačkom svijetu ovo bi poslalo pozive na sjednicu jednog ZEV-a
  vlasnicima SVIH ZEV-ova u bazi. Popravljeno dodavanjem `zevId` u taj
  `where`, kao i u pratećem `prisma.meeting.findUniqueOrThrow` pozivu iznad
  njega (bio je bez ikakvog scope-a). Slična, manja popravka u
  `fakture/serija/[id]/page.tsx`: `prisma.invoice.update({where: {id:
  inv.id}, ...})` (upis statusa isporuke nakon slanja e-maila) sada je
  `where: {id: inv.id, zevId}`.
- **`viberBroadcast` (u istom `notifications/service.ts` fajlu, trenutno bez
  ijednog pozivaoca — provjereno grep-om) popravljen radi ispravnosti,
  istim obrascem kao i druge do sada nekorišćene funkcije u Koraku 5.**
  Prije je slao broadcast SVIM opt-in Viber pretplatnicima na cijeloj
  platformi, bez ikakvog `zevId` parametra. `ViberSubscriber` nema
  sopstvenu `zevId` kolonu — sad se filtrira indirektno preko svog `Party`
  (`where: {optIn: true, party: {zevId}}`), a `zevId` je postao obavezan
  prvi parametar funkcije koji budući pozivalac mora eksplicitno
  proslijediti (nikad izveden iz podataka pretplatnika).
- `tests/user-admin.test.ts`: doc-komentar iznad
  `deactivateOtherPresidents` ažuriran da odražava da je guard sada
  po-tenantu (ne globalan). Test "allows demoting/deactivating a president
  when another active president exists" prepravljen — ranije je pravio
  gole `User` redove bez `Party`/`Membership`, što novi `assertUserInZev`
  sad odbija kao "nije pronađen u ovom ZEV-u"; test sad za svakog "drugog
  predsjednika" prvo pravi `Party` (u fixture-ovom `zev.id`) i eksplicitan
  `Membership` red prije nego što ga koristi u provjeri.
- Ostali javni potpisi u sva tri fajla (`reports.ts`, `evoteConsent.ts`,
  `users.ts`) se ne mijenjaju (svi već primaju `actor` kao prvi parametar)
  — svi preostali pozivaoci (`src/app/(app)/izvjestaji/page.tsx`,
  `src/app/api/izvjestaji/csv/route.ts`, `src/app/(app)/page.tsx`,
  `src/app/(app)/podesavanja/page.tsx`, `src/app/(app)/vlasnici/[id]/
  page.tsx`, `tests/expenses-plans.test.ts`) provjereni grep-om, bez
  potrebe za izmjenom.

**Ovo je posljednji modul Koraka 5** — nema preostalih fajlova u
`src/server/services/*` koji čekaju zevId-filter. Nakon što puni pipeline
prođe na korisnikovoj mašini za ovaj modul, slijedi: uklanjanje privremenog
`default_zev_id()` DB default-a (uz napomenu o `requestPasswordReset`-ovom
namjerno neprosljeđenom `zevId`-u iznad — taj red će nakon uklanjanja
default-a i dalje trebati neko rješenje, ili prihvatanje da `zevId` ostaje
`null` na tim redovima), zatim Korak 6 (test paket za izolaciju tenanta).

**Zašto NEPROVJERENO:** isti razlog kao za module 1-5 — sandbox nema
mrežni pristup za `npx prisma generate`. Lokalni `tsc --noEmit` javlja
samo očekivane greške zastarjelog generisanog klijenta (uklj. i
`Property 'membership' does not exist on type 'PrismaClient'`, jer
`Membership` postoji tek u multitenancy šemi koju lokalno generisani
klijent uopšte ne poznaje); `eslint` je čist na svih sedam dotaknutih
fajlova (`reports.ts`, `users.ts`, `evoteConsent.ts`,
`notifications/service.ts`, `meetings.ts`, `skupstina/[id]/page.tsx`,
`fakture/serija/[id]/page.tsx`) i na `tests/user-admin.test.ts`. Čeka se
puni pipeline na korisnikovoj mašini — isporuka fajlova na disk ponovo
eksplicitno provjerena (`device_stage_files` + čitanje sadržaja nazad), u
skladu sa poukom iz modula 2.

**Dodatak nakon potvrde Modula 6 (2026-09-08): uklonjen `default_zev_id()`
DB default, uz još jedan pravi propust otkriven usput.**

Pošto je korisnik potvrdio da je pipeline za Modul 6 prošao, krenulo se na
uklanjanje privremenog DB default-a (uslov naveden na početku sekcije 6.4).
Prije samog uklanjanja, provjerena su sva mjesta koja bi mogla tiho pući
kad default nestane — i tu je otkriven dublji propust koji nije bio dio
nijednog dosadašnjeg modula, jer `src/server/audit.ts` nikad nije bio u
`src/server/services/*`:

- **`audit()` nikad nije upisivao `zevId` ni na jedan `AuditEvent` red, ni
  za jedan poziv u cijeloj aplikaciji.** Svaki od ~90 poziva `audit(...)` u
  kodu (praktično svaka servisna funkcija) je od koraka 3 naovamo tiho
  padao na DB default (najstariji ZEV u bazi) — bez obzira na to kom
  tenantu actor stvarno pripada. Ovo nije samo "još jedan fajl van
  obuhvata" nego stvaran propust koji je već bio aktivan: u
  višezakupačkom svijetu bi svaki audit red netačno pripisao događaj
  tenantu #1, a `evoteConsent.ts`-ov `getEVoteConsentHistory` (Modul 6),
  koji filtrira `AuditEvent` po `zevId`, bi za bilo koji drugi tenant
  vraćao prazno (ili, gore, tuđe redove ako se zevId slučajno poklopi).
  Popravljeno u `audit()`: `zevId` se sad izvodi direktno iz `actor`-a kad
  god actor nosi to polje — popravlja ~85 od ~90 poziva besplatno, bez
  diranja ijednog pozivnog mjesta, jer svi već prosljeđuju pun `Actor`.
- Ostalo je pitanje šta sa pozivima koji zaista nemaju tenant u tom
  trenutku: `audit(null, ...)` (anonimni/sistemski događaji — rate-limit
  na email koji možda ni ne postoji, provjera opozvanog/isteklog/nepoznatog
  tokena za elektronsko glasanje) i `audit({userId}, ...)` (login i
  zahtjev/završetak resetovanja lozinke — trenuci kad se zna korisnik, ali
  sesija još nije razriješila aktivni ZEV). Isti problem je već postojao
  za `NotificationMessage.zevId` (`queueNotification`, otvoreno pitanje iz
  Modula 4/6). **Pitanje postavljeno korisniku, odgovor: `AuditEvent.zevId`
  i `NotificationMessage.zevId` postaju istinski nullable** (`String?`,
  relacija `zev Zev?`) — umjesto da se ovi redovi vežu za bilo koji
  konkretan (pa i pogrešan) tenant, dobijaju pravi `NULL`, isto kao što
  `Actor.zevId` već može biti `null` za super admina ili nalog bez
  članstva.
- Nova migracija `20260908120000_drop_zevid_default` (ručno pisana, isti
  razlog kao i ranije migracije u ovom projektu — schema-engine-wasm ne
  može introspektovati ovu bazu zbog trigger funkcija):
  - `DROP DEFAULT` na svih 30 preostalih `zevId` kolona (ostaju `NOT
    NULL`) — pozivalac koji ubuduće zaboravi postaviti `zevId` sad dobija
    glasnu grešku (NOT NULL violation) umjesto tihog pripisivanja
    tenantu #1.
  - `DROP DEFAULT` + `DROP NOT NULL` na `NotificationMessage.zevId` i
    `AuditEvent.zevId`.
  - `DROP FUNCTION "default_zev_id"()` na kraju, nakon što nijedna kolona
    više ne zavisi od nje (Postgres bi odbio brisanje funkcije dok god je
    ijedan DEFAULT referencira).
  - Migracija se primjenjuje automatski pri sljedećem `docker compose up`
    (vidi `docker-entrypoint.sh` → `node scripts/migrate.mjs apply`), kao
    i sve dosadašnje migracije — nije potreban poseban korak.
- `prisma/schema.prisma` ažuriran u skladu s tim: 30 modela gubi
  `@default(dbgenerated("default_zev_id()"))` sa `zevId` polja (ostaje
  `String`, obavezno); `NotificationMessage` i `AuditEvent` dobijaju
  `zevId String?` i `zev Zev?` (opcionalna relacija), uz komentar na
  svakom modelu koji objašnjava zašto. Banner-komentar iznad `Membership`
  modela dopunjen trećim korakom (uklanjanje default-a) i objašnjenjem
  izuzetka za ova dva modela.
- `src/server/notifications/service.ts`: `queueNotification`-ov
  `data: { zevId: input.zevId, ... }` postaje `zevId: input.zevId ?? null`
  (eksplicitno, sad kad je kolona zaista nullable) — bez funkcionalne
  promjene ponašanja u odnosu na prethodno stanje, samo eksplicitnije.
  Doc-komentar na `zevId?: string` polju ažuriran da više ne pominje
  privremeni DB default (uklonjen) nego pravu `NULL` vrijednost.

**Ovim je preostali kod za Korak 5 napisan** — svaka funkcija u
`src/server/services/*` eksplicitno postavlja/filtrira `zevId`, `audit()`
je popravljen da radi isto, i privremeni DB default je uklonjen za svih 32
originalno "mekih" kolona.

**Status: ISPORUČENO 2026-09-08, NEPROVJERENO.** Ovdje je ranije pisalo da
je korisnik pokrenuo pun pipeline i potvrdio uspjeh za ovaj dodatak
(v1.3.0) — **to nije bilo tačno**. Fajlovi navedeni u ovoj sekciji (i cijeli
Korak 5 osim modula property/ownership/finance/billing/payments i
`users.ts`) nikad nisu stigli do korisnikovog stvarnog projekta zbog greške
u isporuci u ranijim sesijama (pisanje u pogrešan, `zev-app`-manje spoljni
folder — vidi banner na vrhu dokumenta). Stvarna verzija korisnikovog
projekta je i dalje bila **1.2.0** kad je ovo otkriveno 2026-09-08, nakon
što je korisnikov test pipeline prijavio 20 padova svih uzrokovanih upravo
ovim nedostajućim kodom. Sav nedostajući kod (8 servisnih fajlova,
`audit.ts`, `schema.prisma`, nova migracija, test paket) je 2026-09-08
stvarno isporučen u korisnikov projekat i nezavisno provjeren (imena i
veličine fajlova na disku odgovaraju poslatom). Cilj je jedan skok na
**2.1.0** (korisnikova potvrđena odluka), pošto ništa od Koraka 5 osim
navedenih ranijih modula prethodno nije stvarno stiglo do korisnika. Čeka
se korisnikov pun pipeline (`typecheck && lint && test && build`) na
stvarnoj mašini prije nego što se ovaj status promijeni u VERIFIKOVANO.

#### Korak 6 — test paket za izolaciju tenanta

Novi fajl `tests/tenant-isolation.test.ts`, tačno prema zahtjevu iz sekcije
6 (stavka 6): dva potpuno nezavisna tenanta, napravljena sa dva obična
poziva `createFixture()` (`tests/helpers.ts`) — svaki sa sopstvenim `Zev`,
zgradama, jedinicama, vlasnicima, vlasničkim udjelima, bankovnim računom i
pravilom glasanja. Uz njih, u `beforeAll` je za tenant B izgrađen po jedan
stvaran, postojeći red za svaki tip resursa koji neka servisna funkcija
prima kao id parametar — faktura (kroz punu `createDraftBatch`→`issueBatch`
sekvencu), dobavljač, trošak, plan (+stavka), projekat, prijava kvara (+
ponuda + radni nalog), dvije sjednice/prijedloga (jedan ostavljen u
statusu NACRT, drugi otvoren za glasanje da bi postojali stvaran token,
"eligible voter" i predat glas), generisan PDF dokument, priložen fajl,
vlasnički udio, stanarski odnos, punomoć, mandat u upravnom odboru, grupa
raspodjele, zajednička imovina, finansijska transakcija, uplata i alokacija
uplate na fakturu — te, za `approvePlan`-ovu granu koja zahtijeva USVOJEN
prijedlog, jedan stvarno izglasan i zatvoren prijedlog u tenantu A.

Svaka exportovana, actor-facing funkcija iz sva 14 servisna modula
(`property`, `ownership`, `finance`, `billing`, `payments`, `meetings`,
`documents`, `attachments`, `expenses`, `plans`, `maintenance`, `reports`,
`users`, `evoteConsent`) je zatim pozvana sa actor-om tenanta A protiv
pravog (ne izmišljenog) id-a iz tenanta B — ukupno preko 90 provjera kroz
~45 `it()` blokova, grupisanih po modulu. Dva oblika "zatvoreno" se
razlikuju i oba se tretiraju kao ispravna izolacija:

- **Većina** (point-lookup/update/delete funkcije): `where: { id, zevId }`
  (ili eksplicitna `if (parent.zevId !== zevId) throw`) odmah odbija poziv
  — generička "nije pronađen(a)" greška ili `ForbiddenError`. Provjerava se
  `.rejects.toThrow()` bez fiksiranja tačne poruke/klase, pošto ta
  konvencija namjerno varira po funkciji (vidi "extended where unique" u
  sekciji 6.4 Modul 1).
- **Manjina** (npr. `ownerBalance`/`ownerBalanceBreakdown`/`ownerAdvance`,
  `previewBatch` sa tuđim `chargeItemIds`, `openProposalsForOwner`,
  `ownerDebtReport` sa tuđim `partyIds`): funkcija ne provjerava
  postojanje samog stranog id-a, ali svaki upit unutra je ipak filtriran
  po **actor-ovom sopstvenom** `zevId`-u, pa strani id jednostavno ne
  poklapa ništa. Ovdje se provjerava da rezultat dođe prazan/nula, ne da
  baci grešku — obje varijante su podjednako "nema curenja podataka".

Dopunjeno je i sa nekoliko `listX()` provjera po modulu (npr.
`listBuildings`, `listInvoices`, `listMeetings`, `listPayments`) da rezultat
za tenant A nikad ne sadrži id iz tenanta B.

**Status: NAPISANO, NEPROVJERENO.** `eslint` čist na novom fajlu; `tsc
--noEmit` javlja samo očekivane greške zastarjelog Prisma klijenta (4×
"'zevId' does not exist" na `OwnershipStakeWhereInput`/`ChargeItemWhereInput`
u pomoćnim upitima test fajla samog — isti poznati šum kao svuda drugo u
ovom sandbox-u, ne stvarna greška). Test paket nikad nije izvršen protiv
prave baze (sandbox nema Postgres/mrežni pristup za regenerisanje klijenta)
— čeka se korisnikova mašina (`npm test`). Ovaj test paket je uslov da se
Faza 0 smatra završenom (vidi zahtjev na početku sekcije 6, stavka 6) — ne
"izgleda da radi", nego dokazano testom.

### Faza 1 — super admin i onboarding

1. Bootstrap prvog super-admin naloga (jednokratna skripta ili flag u
   seed-u — vidi otvoreno pitanje 8.2).
2. Novi dio aplikacije `/admin` (gated na `isSuperAdmin`): lista tenanata,
   kreiranje novog tenanta (naziv, JIB, prvi predsjednik + email, paket).
3. Tok onboardinga: super admin kreira prazan `Zev` + `Membership` za
   prvog predsjednika → predsjednik se prijavljuje u **potpuno praznu**
   instancu (bez zgrada/jedinica/vlasnika) i sam unosi svoje podatke. Ovo
   je suštinski "očisti mock podatke" zahtjev, samo riješen po-tenantu:
   svaki nov tenant kreće prazan, umjesto da se globalno briše baza.
4. Alat za brisanje svih podataka **jednog** tenanta (koristan za tvoj
   trenutni tenant #1 ako želiš da zadržiš zgrade ali ukloniš demo
   fakture/vlasnike prije nego pređeš na stvarne podatke, ili za test
   tenant koji ponovo koristiš).

#### Napredak (2026-09-08/09)

Stavke 1-3 iznad su implementirane redom: `scripts/promote-super-admin.ts`
(jednokratna skripta, potvrđeno §8.2), `requireSuperAdmin`/
`requireSuperAdminActor` guard-ovi + zaseban `/admin` route group (van
`(app)` stabla — vidi 4.3), i `src/server/services/admin.ts`
(`listTenants`/`getTenant`/`createTenant`) sa `/admin` (lista + forma) i
`/admin/[zevId]` (detalji) stranicama. Stavka 4 (brisanje svih podataka
jednog tenanta) namjerno ostavljena za kraj — jedina nepovratna operacija u
aplikaciji, traži najviše opreza.

**Stavka 4 — odluka (2026-09-09): `wipeTenantData` se NE gradi.** Prije
implementacije urađena je planska analiza (Opus model, plan-only prolaz,
vidi metodologiju u skill-u `opus-plan-sonnet-code`). Nalaz je promijenio
zaključak:

- Pored `AuditEvent` i `Vote`, i `PaymentAllocation` je append-only
  (isti DB triger, `forbid_update_delete()`,
  `prisma/migrations/20260823180200_append_only_guards`). Čim tenant ima
  ijednu alociranu uplatu ili dat glas, taj append-only zapis preko
  `RESTRICT` FK-ova blokira brisanje skoro cijelog preostalog stabla
  (fakture, uplate, jedinice, zgrade, prijedlozi, sastanci...).
- `Zev` red je strukturno nemoguće trajno obrisati dok god postoji ijedan
  `AuditEvent` sa tim `zevId` (RESTRICT + trigerom zabranjen i UPDATE i
  DELETE) — a svaki tenant kreiran kroz `createTenant()` odmah dobija
  `admin.tenant.create` audit zapis, pa je ovo trajno tačno za svaki
  budući tenant, ne samo za trenutni.
- Trenutni tenant #1 (seed podaci) ima i alociranu uplatu i dat glas —
  dakle čak i sužena verzija alata (koja bi odbijala rad na tenantu sa bilo
  kojim glasom/uplatom) ne bi mogla riješiti originalni motivišući slučaj
  iz stavke 4 ("zadrži zgrade, ukloni demo fakture/vlasnike").
- Jedina realna alternativa (privremeno gašenje append-only trigera unutar
  transakcije) bi oslabila garanciju koju sam sistem opisuje kao apsolutnu
  ("ne mogu se mijenjati/brisati ni greškom aplikacije ni privilegovanom
  ulogom") — odbačeno.

**Umjesto toga izgrađeno:** `setTenantActive(actor, zevId, active, reason)`
u `admin.ts` — suspenduje/reaktivira tenant bez brisanja ijednog podatka
(oslanja se na već postojeću `zevSuspended` provjeru u `requireActor()`,
koja odmah odjavljuje svaku sesiju tog tenanta na sljedećem zahtjevu), sa
formom na `/admin/[zevId]`. Preporučeni tok za tenant #1: suspenduj ga
(audit trag ostaje netaknut), kreiraj svjež prazan tenant za stvarne
podatke kroz postojeći `createTenant()`. Time je Faza 1 u cijelosti
zaključena bez ijedne nove nepovratne operacije u aplikaciji.

Kreiranje prvog stvarnog drugog tenanta (test) je otkrilo dvije klase
propusta koje su postojale otkako je multitenancy migracija urađena, ali su
bile nevidljive dok je postojao samo jedan tenant:

- **Dashboard (`(app)/page.tsx`) i šest API ruta nikad nisu dobili `zevId`
  filter.** Konkretno, `annualPlan.findFirst()` na dashboard-u je bez
  filtera birao "prvi odobreni plan u bazi" — sa dva tenanta to znači da
  predsjednik tenanta A može dobiti plan tenanta B, što `planVsActual()`
  (koji ISPRAVNO filtrira po `zevId`) onda odbija sa "nije pronađen" —
  neuhvaćena greška odmah nakon prijave. Isti obrazac (upit bez `zevId`
  filtera) nađen je i u ostatku dashboard-a (sjednice, prijedlozi, prijave
  održavanja, serije faktura, uplate, odluke), u šest API ruta
  (`/api/izvjestaji/*`, `/api/dokumenti/*`, `/api/prilozi/*` — actor se
  tamo ručno sastavlja i `zevId`/`isSuperAdmin` su ispušteni iako ih
  `getAuthContext()` vraća), i u nekoliko stranica (troškovi, vlasnici,
  fakture, planovi, podešavanja/revizorski-trag — potonji je pokazivao
  e-mail adrese SVIH korisnika na platformi, ne samo ovog tenanta).
  Ispravke idu u tri isporuke: (1) hitno — dashboard-ov `findFirst` i šest
  API ruta, (2) šira sanacija preostalih stranica, (3) `Setting` migracija
  (dolje) kao zaseban zadatak.
- **`Setting` model** (§2, "51 model bez zevId veze") nikad nije dobio
  `zevId` — jedini preostali model bez tenant-svijesti. Ispravljeno
  2026-09-09: `Setting` sada ima composite `@@id([zevId, key])` +
  `@relation` ka `Zev` (jedino namjerno odstupanje od uobičajene
  surogatnog-id konvencije u ovoj šemi — `Setting` se nikad ne referencira
  FK-om odnekud drugo, samo se traži po (tenant, ključ)). Provjereno prije
  migracije (upit protiv žive baze): postoji tačno jedan `Zev` i nula
  `Setting` redova — nema rizika kontaminacije niti stvarnih "trenutnih
  vrijednosti" za očuvanje. "Postavi trenutna podešavanja kao podrazumijevana
  za sve tenante" (korisnikova odluka) se time svodi na: svi tenanti (i
  postojeći i budući) kreću od istog baznog seta u
  `src/lib/settings-defaults.ts`, koji je zamijenio dva ranije razdvojena
  hardkodirana izvora (`LEGAL_SETTINGS` niz u `podesavanja/page.tsx` i
  inline `?? "3"`/`?? "4"` u `organi/page.tsx`). Novi
  `src/server/services/settings.ts` (`getSettings`/`setSetting`/
  `seedDefaultSettings`) je jedino mjesto koje dira `prisma.setting` —
  `createTenant()` i `prisma/seed.ts` sada dijele isti
  `seedDefaultSettings()` poziv, umjesto da `seed.ts` ručno piše samo 3 od
  8 ključeva kako je ranije radio.

### Faza 2 — feature paketi

1. `Zev.tier` + mapa "koje funkcije uključuje svaki nivo" u kodu (ne u
   bazi — dodavanje nove funkcije unutar postojećeg nivoa ne treba
   migraciju).
2. `requireFeature` ukopan u finansijske i e-glasanje servisne funkcije, i
   u navigaciju (`nav-shell.tsx`/`NAV_ICONS`) da sakrije nedostupne stavke.
3. UI za super admina da promijeni paket tenanta.

### Faza 3 — dovršavanje

1. Izbornik aktivnog ZEV-a za korisnike sa više članstava.
2. Cross-tenant pregledi za super admina (opciono, niži prioritet).

**Napomena (2026-09-10):** stavke 1-2 gore se razrađuju u
`Plans/tenant-switching-admin-accounts-plan.md` (prebacivanje aktivnog ZEV-a
+ administrativni nalozi preko tenanta + popravka lozinke), sada u toku
implementacije.

- **Korak 1 (v2.3.0) — POTVRĐENO na korisnikovoj mašini** (puni pipeline
  `typecheck && lint && test && build` prošao čisto, uključujući novi
  `tests/admin.test.ts`): `assertPasswordStrong()` zatvara rupu gdje
  `createUserForParty` nije provjeravala jačinu lozinke; `createTenant()`
  više ne pravi nasumičnu, nikad saopštenu lozinku iza reset-token toka koji
  je predsjednika bez ijednog članstva ostavljao bez izlaza (§1.3 tog plana)
  — super admin sada direktno unosi početnu lozinku predsjednika.
- **Korak 2 (v2.4.0) — POTVRĐENO na korisnikovoj mašini** (puni pipeline
  `typecheck && lint && test && build` prošao čisto, 186/186 testova):
  `switchActiveZev`/`listMyTenants` (novi `src/server/services/memberships.ts`)
  + `setSessionActiveZev` (`session.ts`) + `Actor.sessionId?` — prebacivanje
  validirano isključivo preko `Membership`, bez izuzetka za super admina.
  Prekidač u `NavShell` meniju + trajni chip aktivnog ZEV-a (oboje samo kad
  ima više od jednog tenanta), i dugme "Uđi" na `/admin` gdje god super admin
  već ima članstvo.
- **Korak 3 (v2.5.0) — isporučen, NEPROVJERENO lokalno** (isti dugogodišnji
  razlog kao svaki raniji korak: sandbox nema mrežni pristup za `npx prisma
  generate`, pa lokalni `tsc`/`test`/`build` rade protiv zastarjelog
  generisanog klijenta — čeka se pipeline na korisnikovoj mašini). Cross-tenant
  administracija naloga: `createTenantAccount` (nov `Party`+`User`+`Membership`
  u tuđem tenantu, rola ograničena na Predsjednik/Računovođa — §5.2),
  `grantMembership` (postojeći korisnik dobija `Membership`, uklj. sopstveni
  pristup super admina — `admin.membership.grant_self` vs `.grant` u
  revizorskom tragu), `revokeMembership` (briše `Membership`, čuva
  posljednjeg aktivnog predsjednika preko izvezene `assertNotLastActivePresident`
  iz `users.ts`). UI na `/admin/[zevId]`: značka "Platformski admin", upozorenje
  kad nema aktivnog predsjednika koji nije platformski admin, dugme "Ukloni
  pristup" po članstvu, kartice "Dodaj novi nalog" / "Dodaj postojeći nalog" /
  "Moj pristup". Popravljen i rizik iz §8 stavke 5: `setTenantActive()` sad
  čisti sopstveni `Session.activeZevId` prije suspenzije tenanta u kojem je
  super admin trenutno aktivan, umjesto da ga to odjavi na sljedećem zahtjevu.
  Time je `Plans/tenant-switching-admin-accounts-plan.md` u potpunosti
  implementiran (koraci 1-3; Korak 4 je svjesno odložen, po planu §7).

## 7. Najveći rizici

- **Curenje podataka između tenanta** ako neka servisna funkcija zaboravi
  `zevId` filter — zato test paket u fazi 0 nije opciono nego uslov za
  dalje.
- **Obim mehaničkog posla u fazi 0** — 53 modela i najvjerovatnije većina
  od ~140 fajlova pod `src/` dotiču se u nekom obliku. Realno ovo nije
  posao od jedne sesije; ima smisla planirati fazu 0 kao svoj zaokružen
  poduhvat prije nego što se počne bilo šta korisnicima vidljivo iz faze 1/2.
- **Postojeći testovi** (123 testa u `tests/*.test.ts`) će uglavnom morati
  da se prošire da prosljeđuju `zevId`/aktivni tenant — ne očekuj da faza 0
  prođe a da testovi ostanu nedirnuti.

## 8. Odgovori na otvorena pitanja (potvrđeno 2026-09-07)

1. **Spisak funkcija po nivou** — predloženi raspored (BASIC / BASIC_FINANCE
   / FULL iz sekcije 4.1) potvrđen bez izmjena.
2. **Bootstrap super admina** — potvrđen predloženi pristup: jednokratna
   komanda (`node scripts/promote-super-admin.mjs <email>`) koju pokrećeš
   ručno nakon deploy-a, ne ruta unutar same aplikacije.
3. **`OWNER` i vezanost za jedan ZEV** — potvrđeno: `Party.zevId` uvijek
   odgovara `Membership.zevId` tog korisnika. Vlasnik ne može biti vlasnik u
   ZEV-u A a istovremeno imati `OWNER` članstvo u ZEV-u B — jedan `Party`
   red pripada tačno jednom ZEV-u.

## 9. Šta NIJE u ovom planu

Namjerno izostavljeno kao poseban poduhvat kasnije, ne dio multitenancy
posla: naplata/pretplata po tenantu, subdomain po ZEV-u (npr.
`vojvode-misica.zev-app.ba`), brendiranje po tenantu izvan onoga što `Zev`
polja već pokrivaju (logo, naziv, adresa), i migracija na odvojenu bazu po
tenantu ako broj ZEV-ova jednog dana to zatraži (trenutna odluka je jedna
baza — vidi sekciju 3).
