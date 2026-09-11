# Changelog

Sve bitne izmjene u aplikaciji se evidentiraju ovdje.

## Verzionisanje

**Od verzije 0.2.0 koristi se standardni SemVer, `MAJOR.MINOR.PATCH`, sa jednom
namjernom izmjenom u odnosu na podrazumijevano ponašanje:**

- **Minor je podrazumijevani korak.** Svaka normalna, zaokružena izmjena/funkcionalnost/
  ispravka podiže minor za `1` i vraća patch na `0` — npr. `0.2.0` → `0.3.0`.
- **Patch se koristi za iteracije na nečemu što još nije završeno.** Dok se ista
  funkcionalnost/ispravka doradjuje kroz više krugova u istom poduhvatu (npr. pronađe
  se i ispravi bag, pa se u istom dijelu koda otkrije još nešto prije nego što je posao
  zaista gotov), svaki takav međukorak podiže patch — npr. `0.3.0` → `0.3.1` → `0.3.2`,
  umjesto da svaki put ide novi minor. Kad je taj rad zaista završen i stabilan,
  *sljedeća nova* izmjena opet ide kao minor.
- **Major je za značajniju prekretnicu** i vraća minor na `1` (ne na `0`), a patch na
  `0` — npr. `1.4.2` → `2.1.0`, a ne `2.0.0`. Ovo je namjerno odstupanje od
  podrazumijevanog semver/npm ponašanja: sâm `npm version major` završi na `X.0.0`, pa
  je za željeno `X.1.0` potrebno odmah nakon toga pokrenuti i `npm version minor`
  (za major izdanje: `npm version major && npm version minor`). `npm version minor` i
  `npm version patch` sami po sebi već rade tačno ono što treba za ta dva slučaja.
- Prije svake nadogradnje verzije se potvrđuje sa korisnikom da li je u pitanju patch,
  minor ili major.

**Napomena o promjeni šeme:** verzije `0.900` i `0.901` niže su nastale po staroj šemi
(`MAJOR.mmm`, minor kao trocifreni brojač 1/1000, opisano dolje radi istorijskog
konteksta) i nisu preimenovane. Od unosa `0.2.0` na dalje važi šema opisana iznad.
Nastavak brojanja minor verzija (a ne povratak na `0.1.0`) odražava da su `0.900` i
`0.901` već predstavljale dvije zaokružene isporuke pod major `0`.

<details>
<summary>Stara šema (do 0.901, radi istorijskog konteksta)</summary>

Korištena je jednostavnija šema oblika `MAJOR.mmm`:

- **Minor** (`mmm`, tri cifre) raste za `1` pri svakom manjem izdanju / zaokruženom skupu
  izmjena — npr. `0.900` → `0.901` → `0.902`. Jedan korak = 1/1000 verzije.
- **Major** raste za `1` pri značajnijoj prekretnici, i tada se minor vraća na `000`.
- Prva verzionisana isporuka je bila `0.900` (postojeća aplikacija u trenutku uvođenja
  verzionisanja), ne `0.000`.

</details>

## [2.5.3] - 2026-09-11

### Izmijenjeno

- **Vizuelno osvježen meni naloga (`NavShell`)** — dropdown ispod avatara
  (prebacivanje ZEV-a, Podešavanja, Odjava) sada ima: profilnu "karticu" na
  vrhu (avatar + ime + role, umjesto samog teksta), red za svaki ZEV sa
  ikonicom zgrade i plavom pozadinom/kvačicom za trenutno aktivan (umjesto
  golog teksta "(aktivan)"), ikonice uz Podešavanja i Odjavu, širi i
  zaobljeniji okvir sa jačom sjenkom, i suptilnu animaciju otvaranja
  (poštuje `prefers-reduced-motion`).
- **Značka aktivnog ZEV-a u gornjoj traci** — od golog sivog "pilula" teksta
  do plave tonalne značke sa ikonicom zgrade, dosljedno sa ostatkom
  aplikacije (isti `ring-1 ring-inset` obrazac kao `StatusBadge`).
- Dodate dvije nove monohromatske ikonice u `nav-icons.tsx`: `IconCheck`
  (kvačica za aktivan ZEV) i `IconLogout` (izlazna strelica za Odjavu),
  istim stilom kao postojeće.
- Nema promjena u ponašanju/logici prebacivanja ZEV-a — popravka iz 2.5.2
  (odgođeno zatvaranje menija zbog `type="submit"`) je zadržana bez izmjena.
  Provjereno vizuelno u izolovanom renderu komponente (van Next/Prisma
  stacka, sa lažnim podacima za dva ZEV-a) — desktop i mobilni prikaz, otvoren
  i zatvoren meni, klik na prebacivanje ZEV-a.

## [2.5.2] - 2026-09-10

### Ispravljeno

- **Prekidač aktivnog ZEV-a u meniju naloga (`NavShell`) nije stvarno
  prebacivao na neaktivni tenant** — klik bi zatvorio meni, ali prebacivanje
  se nikad ne bi izvršilo. Uzrok: dugme je istovremeno `type="submit"` (šalje
  formu `switchZevAction`-u) i imalo je `onClick` koji odmah poziva
  `setMenuOpen(false)`, čime se sama forma ukloni iz stranice prije nego što
  browser stigne da izvrši podrazumijevanu radnju klika (submit) — submit se
  time tiho poništi. Popravka: zatvaranje menija se odgađa za sljedeći tik
  (`setTimeout(..., 0)`), tako da se forma prvo pošalje. Otkriveno uživo (nije
  ga mogao uhvatiti automatski test paket — servisni testovi ne simuliraju
  klik u pravom browseru).

## [2.5.1] - 2026-09-10

### Ispravljeno

- **`tests/tenant-isolation.test.ts` je padao sa `Error: This module cannot be
  imported from a Client Component module`.** Uzrok: paket `server-only`
  (koga uvoze `session.ts`, `actor.ts`, `admin.ts`, `memberships.ts`) postaje
  no-op samo pod Next-ovim posebnim `"react-server"` export-uslovom — Vitest
  taj uslov nikad ne postavlja, pa svaki test koji stvarno učita taj lanac
  uvoza pogodi paketov bezuslovni `throw`. Taj lanac je prvi put postao
  dostupan testovima u Koraku 2 (`tenant-isolation.test.ts` →
  `memberships.ts` → `session.ts`); Korak 3 je dodao još jedan takav uvoz
  (`admin.ts`) i pad je postao vidljiv. Popravka: `vitest.config.ts` sad
  alias-uje `"server-only"` direktno na paketov sopstveni no-op
  `node_modules/server-only/empty.js` — ne dira stvarni Next.js build (koji i
  dalje ispravno primjenjuje `server-only` provjeru), samo uklanja lažni pad
  u test runneru koji tu provjeru ne može zadovoljiti.

## [2.5.0] - 2026-09-10

### Dodato

- **Cross-tenant administracija naloga** (Faza 3, Korak 3 iz
  `Plans/tenant-switching-admin-accounts-plan.md`): super admin sada može, sa
  `/admin/[zevId]`, otvoriti potpuno nov nalog u tuđem tenantu
  (`createTenantAccount` — pravi `Party` + `User` + `Membership`, rola
  ograničena na Predsjednik/Računovođa jer vlasništvo obavezno traži dokaz o
  vlasništvu koji ovaj put zaobilazi), dodijeliti pristup postojećem nalogu
  (`grantMembership` — samo nov `Membership` red, uklj. sopstveni pristup
  super admina), i ukloniti pristup (`revokeMembership` — čuva posljednjeg
  aktivnog predsjednika preko iste provjere koju koristi i sam predsjednik
  ZEV-a na `/vlasnici`).
- **UI na `/admin/[zevId]`:** značka "Platformski admin" pored naloga
  platformskog admina u tabeli članova; upozorenje kad ZEV nema nijednog
  aktivnog predsjednika koji nije platformski admin; dugme "Ukloni pristup"
  (sa obaveznim razlogom) po članstvu; nove kartice "Dodaj novi nalog",
  "Dodaj postojeći nalog" i "Moj pristup" (zahtjev/ulazak/uklanjanje
  sopstvenog pristupa).

### Izmijenjeno

- `setTenantActive()` (`admin.ts`): suspendovanje ZEV-a u kojem je super
  admin trenutno aktivan više ga ne odjavljuje na sljedećem zahtjevu — prvo
  se očisti sopstveni `Session.activeZevId` (`setSessionActiveZev(...,
  null)`), pa se tek onda tenant suspenduje.
- `assertNotLastActivePresident()` (`users.ts`) je sad izvezena funkcija —
  koristi je i `revokeMembership()` u `admin.ts`, umjesto da se ista provjera
  piše dvaput.

## [2.4.0] - 2026-09-10

### Dodato

- **Prebacivanje aktivnog ZEV-a** za korisnike sa članstvom u više tenanata
  (Faza 3, stavka 1 iz `docs/multitenancy-plan.md`; puni plan u
  `Plans/tenant-switching-admin-accounts-plan.md`, Korak 2). Novo:
  `setSessionActiveZev()` (`session.ts`), `Actor.sessionId?`, i novi servisni
  modul `src/server/services/memberships.ts` (`listMyTenants`,
  `switchActiveZev`) — prebacivanje se dozvoljava isključivo u ZEV u kojem
  pozivalac ima `Membership` red (bez izuzetka za super admina), i samo dok je
  ciljni ZEV aktivan. Isti nalog ne mora imati samo jedno članstvo, pa se ovo
  odnosi i na obične korisnike (npr. knjigovođa u više ZEV-ova), ne samo super
  admina.
- **UI za prebacivanje:** korisnički meni u `NavShell`-u dobija sekciju sa
  listom ZEV-ova (prikazuje se samo kad ih ima više od jednog) i trajni chip
  aktivnog ZEV-a pored menija. Na `/admin` (lista i detalji tenanta) dodato
  dugme "Uđi" za tenante u kojima super admin već ima članstvo.

### Izmijenjeno

- `listTenants()` (`admin.ts`) sada uz svaki tenant vraća i da li pozivalac
  (super admin) već ima članstvo u njemu — koristi ga link "Uđi" na listi.

## [2.3.0] - 2026-09-10

### Dodato

- `assertPasswordStrong()` u `src/server/auth/password.ts` — jedno mjesto za
  provjeru jačine lozinke (i dalje prag od 8 znakova), sada pozvano iz
  `resetPassword` (zamjenjuje njenu staru inline provjeru istog praga) **i**
  `createUserForParty` (koja do sada nije imala nikakvu provjeru — predsjednik je
  mogao postaviti i jednoznakovnu lozinku za novog vlasnika preko `/vlasnici`).
- Nova klijentska komponenta `src/components/password-field.tsx` — polje za
  lozinku (`type="text"`, čitljivo kao i dosadašnje sirovo polje) sa dugmadima
  "Generiši" (nasumična lozinka preko `crypto.getRandomValues`) i "Kopiraj".
  Zamjenjuje sirovi `<input type="text" name="accountPassword">` na `/vlasnici`
  i koristi se i za novo polje "Početna lozinka" na `/admin`.

### Izmijenjeno

- **Popravljen "kokoška-jaje" bag u onboardingu novog tenanta.**
  `createTenant()` (`/admin`) je do sada heširao nasumičan, nikad saopšten
  token kao lozinku predsjednika i slao mu (mock) e-mail sa linkom za
  postavljanje lozinke — ali predsjednik, nemajući još nijedno članstvo u
  novom tenantu, nije imao ni gdje da tu poruku pročita (`/podesavanja/poruke`
  traži članstvo), a link je uz to važio samo 1h. Onboarding preko UI-ja je
  time bio strukturno neizvodljiv. Sada `createTenant()` prima lozinku koju
  super admin direktno unese (isti obrazac koji `/vlasnici` već koristi za
  nove vlasničke naloge), bez ijednog tokena — poruka dobrodošlice ostaje
  (trag u evidenciji tenanta da je nalog otvoren), ali sada objašnjava da je
  početnu lozinku postavio administrator platforme. Vidi
  `Plans/tenant-switching-admin-accounts-plan.md`, Korak 1.
- Novi test `tests/admin.test.ts` (prvi test paket za `src/server/services/admin.ts`):
  `createTenant` pravi `Zev`+`Party`+`User`+`Membership`+podešavanja; postavljena
  lozinka stvarno prolazi kroz `authenticate()`; slaba lozinka i duplirani e-mail
  se odbijaju; poziv sa aktorom koji nije super admin se odbija. `tests/helpers.ts`
  dobija `createSuperAdminActor()`.

## [2.2.0] - 2026-09-09

### Dodato

- Faza 1 (multitenancy), Korak 4 zaključen — ali drugačije od plana:
  `setTenantActive()` u `admin.ts` suspenduje/reaktivira tenant (bez
  brisanja ijednog podatka; sesije tog tenanta se automatski odjavljuju na
  sljedećem zahtjevu preko postojeće `zevSuspended` provjere), sa formom
  na `/admin/[zevId]`.

### Izmijenjeno

- **Odluka: `wipeTenantData` (brisanje svih podataka jednog tenanta) se ne
  gradi.** Planska analiza (Opus model, plan-only prolaz) je pokazala da
  je, pored `AuditEvent`-a i `Vote`-a, i `PaymentAllocation` append-only
  (isti DB triger) — čim tenant ima ijednu alociranu uplatu ili dat glas,
  to strukturno blokira brisanje skoro cijelog preostalog stabla podataka
  preko `RESTRICT` FK-ova, uključujući trenutni tenant #1. Jedina
  alternativa (privremeno gašenje append-only trigera) bi oslabila
  garanciju koju sistem opisuje kao apsolutnu. Vidi
  `docs/multitenancy-plan.md`, Faza 1 → "Stavka 4 — odluka (2026-09-09)"
  za puno obrazloženje i preporučenu alternativu (suspenduj stari tenant,
  kreiraj svjež prazan tenant za stvarne podatke).

## [2.1.1] - 2026-09-09

### Dodato

- Faza 1 (multitenancy), Korak 4: `/admin` oblast za super admina — bootstrap
  skripta (`npm run admin:promote <email>`) za promociju postojećeg korisnika u
  super admina, `requireSuperAdmin()`/`requireSuperAdminActor()` čuvari,
  `/admin` layout i stranice (lista tenanata, kreiranje novog tenanta, detalji
  tenanta). Super admin koji je istovremeno predsjednik svog ZEV-a nastavlja
  da se prijavljuje direktno na svoj tenant (`/`), sa linkom ka `/admin` u
  meniju — na `/admin` se automatski šalje samo super admin bez ijednog
  tenanta.
- `Setting` model prebačen sa jedinstvenog (platform-wide) na model po
  tenantu (`@@id([zevId, key])`) — svaki ZEV sada ima svoja podešavanja
  (naziv organa, veličina odbora, mandat, itd.), umjesto da dijeli jedan
  zajednički red sa svim ostalim tenantima. Podrazumijevane vrijednosti
  (`src/lib/settings-defaults.ts`) se sada eagerly sjeme (seed) i za nove
  tenante (`createTenant()`) i za `prisma/seed.ts`, uz dodatni fallback pri
  čitanju (`getSettings()`) za slučaj da se u budućnosti doda novi ključ.
  Ručno pisana migracija (`20260909100000_tenant_scope_settings`) prebacuje
  postojeći red na trenutni (jedini) tenant kao podrazumijevanu vrijednost za
  sve buduće tenante.

### Ispravljeno

- **Sigurnosna ispravka: curenje podataka između tenanata (cross-tenant).**
  Revizija (uz pomoć Opus modela za plan/analizu) je pronašla niz mjesta gdje
  su stranice i API rute pravile `prisma` upite direktno (mimo servisnog
  sloja, koji je već ispravno filtriran po `zevId`) bez filtera po `zevId` —
  greška koja je postojala od trenutka kad bi postojao drugi tenant, ne samo
  teoretski rizik za prazan tenant. Ispravljeno u:
  - `(app)/page.tsx` — oba dashboarda (upravni i vlasnički): sastanci,
    prijedlozi, prijave kvarova, serije faktura, uplate i (najozbiljnije)
    `annualPlan.findFirst()` koji je bez filtera birao "bilo koji" plan i
    rušio stranicu čim bi postojao plan drugog tenanta.
  - Sedam API ruta (izvještaji CSV/PDF, dugovanja, kartica i saglasnost
    vlasnika, preuzimanje dokumenata i priloga) — akter proslijeđen u
    servisni sloj nije nosio `zevId`/`isSuperAdmin`, pa su servisne provjere
    tiho prolazile.
  - `troskovi`, `vlasnici`, `fakture`, `fakture/serija/[id]`,
    `fakture/uplate/[id]`, `planovi/[id]` — padajuće liste i pomoćni upiti
    (stavke plana, punomoćja, serije faktura, otvorene fakture, prihvaćeni
    prijedlozi) učitavali su podatke svih tenanata, ne samo trenutnog.
  - `podesavanja/audit` — revizorski trag i mapa e-mailova za prikaz aktera
    učitavali su **sve korisnike platforme**, ne samo članove trenutnog
    tenanta (najosjetljivija stavka u ovoj seriji ispravki).
  - `podesavanja/poruke` — outbox poruka (e-mail/Viber) prikazivao je poruke
    svih tenanata.
- Dopunjen `tests/tenant-isolation.test.ts` sa testovima za `settings`
  modul (dva tenanta imaju nezavisna podešavanja).

## [2.1.0] - 2026-09-08

### Dodato

- Test paket za izolaciju tenanta (`tests/tenant-isolation.test.ts`, vidi
  `docs/multitenancy-plan.md` §6, Korak 6): dva potpuno nezavisna tenanta
  (dva `createFixture()` poziva), pa svaka exportovana funkcija iz sva 14
  servisna modula (`property`, `ownership`, `finance`, `billing`,
  `payments`, `meetings`, `documents`, `attachments`, `expenses`, `plans`,
  `maintenance`, `reports`, `users`, `evoteConsent`) pozvana sa actor-om
  jednog tenanta protiv pravog (postojećeg, ne izmišljenog) id-a iz drugog
  — i provjereno da uvijek ili baci grešku ("nije pronađen(a)" /
  `ForbiddenError`) ili, gdje funkcija ne provjerava postojanje samog
  stranog id-a (npr. `ownerBalance`, `previewBatch` sa tuđim
  `chargeItemIds`), vrati prazan/nula rezultat — nikad tuđe podatke.
  Dopunjeno sa `listX()` provjerama da liste jednog tenanta nikad ne
  sadrže id-jeve drugog. Ovim test paketom se — dokazano testom, ne samo
  pregledom koda — zatvara Faza 0 (temelji multitenancy-ja): svaki korak
  1-6 iz `docs/multitenancy-plan.md` §6 je sada napisan i (na korisnikovoj
  mašini) verifikovan.
- `docker-compose.yml`: `TEST_DATABASE_URL` za `app` servis (`db:5432`,
  umjesto `.env`-ovog `localhost`, koji unutar kontejnera ne radi i koji
  `.dockerignore` i onako isključuje iz builda) — bez ovoga
  `tests/global-setup.ts` baca "TEST_DATABASE_URL is not set" pri
  pokretanju testova u kontejneru.

### Izmijenjeno

- Multitenancy — peti korak, cijela sekcija (vidi `docs/multitenancy-plan.md`
  §6.4): svaka funkcija u `src/server/services/*` sada eksplicitno
  filtrira/upisuje `zevId` umjesto da se oslanja na privremeni DB default.
  Rađeno po modulima — property/ownership, finansije/fakturisanje/uplate,
  sjednice/glasanje, dokumenti/prilozi, troškovi/planovi/održavanje,
  izvještaji/administracija. `.create()` pozivi više ne primaju `zevId` od
  pozivaoca (uvijek se izvodi iz `actor.zevId` preko novog `requireZev`
  guard-a); čitanje/izmjena po `id` koristi `where: {id, zevId}`; strane
  reference se prije upisa provjeravaju da pripadaju istom tenantu.
- Privremeni `default_zev_id()` DB default (uveden u koraku 3) je uklonjen
  za 30 od 32 kolone koje su ga imale — pozivalac koji ubuduće zaboravi
  postaviti `zevId` sad dobija grešku umjesto tihog pripisivanja pogrešnom
  tenantu. `AuditEvent.zevId` i `NotificationMessage.zevId` su namjerno
  postali istinski nullable (`String?`) — nekoliko događaja (anonimni
  rate-limit, login/reset lozinke prije razrješenja aktivnog ZEV-a,
  password-reset e-mail) legitimno nemaju jedan tenant kome pripadaju.
- `queueNotification` (`src/server/notifications/service.ts`) dobija
  opciono `zevId` polje; `audit()` (`src/server/audit.ts`) sad automatski
  izvodi `zevId` iz actora na svakom pozivu.

### Ispravljeno

Usput otkriveni i popravljeni pravi propusti (van izvornog obuhvata "dodaj
zevId filter", ali direktno na putu dok se taj filter dodavao):

- `addIssueComment` (maintenance.ts) uopšte nije imao provjeru ovlaštenja —
  sad zahtijeva prijavljenog korisnika i provjerava da prijava kvara
  pripada tenantu.
- `zevHeader` (documents.ts) je čitao podatke o ZEV-u preko
  `prisma.zev.findFirst()` ("prvi u bazi", proizvoljno i pogrešno čim
  postoji drugi tenant) — sad čita tačno ZEV izdavaoca dokumenta.
- `assertNotLastActivePresident` (users.ts) je brojao aktivne predsjednike
  preko cijele platforme umjesto po ZEV-u — u višezakupačkom svijetu bi
  roster predsjednika jednog ZEV-a mogao prikriti da drugi upravo gubi
  svog jedinog. Sad broji preko `Membership`, scoped na `zevId`.
- `viberBroadcast` (notifications/service.ts, trenutno bez pozivaoca) je
  slao svim opt-in Viber pretplatnicima na cijeloj platformi — sad prima
  `zevId` kao obavezan parametar i filtrira preko `Party`.
- `skupstina/[id]/page.tsx`: slanje poziva na sjednicu (za sastanke van
  upravnog odbora) je čitalo **sve** vlasnike u bazi bez `zevId` filtera —
  slalo bi pozive na sjednicu jednog ZEV-a vlasnicima svih ostalih.
- `audit()` (`src/server/audit.ts`) nikad nije upisivao `zevId` ni na jedan
  `AuditEvent` red, za nijedan poziv u aplikaciji — svaki audit red je tiho
  padao na DB default (najstariji ZEV u bazi), bez obzira na actora.

Otkriveno tek u punom pipeline-u (`typecheck && lint && test && build`)
nakon isporuke gornjih izmjena, popravljeno u istoj isporuci:

- `prisma/seed.ts` je pravio `Party` redove PRIJE nego što `Zev` red uopšte
  postoji — radilo je dok god je postojao privremeni `default_zev_id()` DB
  default; čim je taj default uklonjen (vidi iznad), seed je počeo padati na
  `Property 'zev' is missing`. Ispravljeno redoslijedom: `Zev` se sad kreira
  prije prvog `Party.create()`.
- `tests/voting.test.ts`: dva poziva `computeProposalResult()` su ostala na
  starom jednoparametarskom potpisu (od prije nego što je funkcija počela
  tražiti i `zevId`); i jedan `occupancy.create()` bez `zevId` u istom
  fajlu.
- `tests/user-admin.test.ts`: test za demotion/deaktivaciju predsjednika je
  pravio "drugog predsjednika" kao goli `User` red bez `Party`/`Membership`
  — nije više dovoljno otkad `assertNotLastActivePresident` broji preko
  `Membership` po `zevId`-u. Ispravljeno dodavanjem prave `Party`/
  `Membership` veze za oba testna korisnika.

### Napomena

- Namjerno OSTAVLJENO neriješeno (produktna odluka, ne mehanička izmjena):
  `deactivateUser`/`activateUser` i dalje mijenjaju `User.active`, globalno
  polje na cijelom nalogu — za korisnika sa članstvom u više ZEV-ova, jedan
  ZEV koji deaktivira nalog time zaključava i pristup drugom.

## [1.2.0] - 2026-09-07

### Izmijenjeno

- Multitenancy — treći korak (vidi `docs/multitenancy-plan.md` §6.3): svih 32
  "mekih" `zevId` kolona iz koraka 1-2 sada su **NOT NULL sa pravom
  `@relation` FK vezom** ka `Zev`, umjesto slobodnog string polja bez
  integriteta. Kolone privremeno dobijaju DB default (`default_zev_id()`,
  nova SQL funkcija koja vraća id jedinog postojećeg ZEV-a) dok servisni
  sloj (korak 5) ne počne eksplicitno postavljati `zevId` na svakom upisu —
  ponašanje za postojećeg (jedinog) tenanta ostaje identično.
- Usput popravljeno 9 postojećih unique ograničenja koja nisu bila svjesna
  tenanta (`Invoice.number`, `WorkOrder.number`, `Proposal(code, version)`,
  `AnnualPlan(year, kind, version)`, `Document(type, number, version)`,
  `InvoiceBatch(period, status)`, `TransactionCategory.name`,
  `VotingRule.name`, `AllocationGroup.name`) — svako sada uključuje `zevId`
  kao dio složenog ključa, čime se sprječava sudar dva različita ZEV-a na
  istom broju fakture, nazivu kategorije i sl. čim se doda drugi tenant.

### Ispravljeno

- `ensureCategory` (finance.ts) i istovjetna logika u payments.ts (bankovni
  import) prebačeni sa `upsert({ where: { name } })` na `findFirst` +
  `create`, jer `TransactionCategory.name` više nije samostalno jedinstven
  ključ.



### Izmijenjeno

- Multitenancy — drugi korak (vidi `docs/multitenancy-plan.md`): auth/sesija/
  Actor prebačeni na `Membership` kao izvor uloga, umjesto zastarjelog
  `User.roles`. `Session` sada nosi `activeZevId` (stvarni FK na `Zev`,
  `onDelete: SetNull`), a `getAuthContext()`/`requireActor`/`maybeActor`
  automatski biraju i pamte aktivni ZEV korisnika iz njegovih `Membership`
  redova te prepoznaju suspendovan (`Zev.active = false`) ZEV, odjavljujući
  sesiju uz poruku na `/login`. `createUserForParty`/`updateUserRoles` sada
  upisuju i u `User.roles` i u `Membership` (dual-write), uz provjeru da
  `Party.zevId` odgovara ZEV-u aktera. Ovo je značajnija prekretnica jer
  mijenja temeljni model autorizacije aplikacije, iako ponašanje ostaje
  identično za postojeći (jedini) tenant. Filtriranje po `zevId` kroz
  servisni sloj i test paket za izolaciju tenanta slijede u narednim
  koracima.

## [0.2.3] - 2026-09-07

### Dodato

- Prvi korak ka multitenancy podršci (vidi `docs/multitenancy-plan.md`): šema
  + jednokratna popuna podataka, bez ikakve promjene u ponašanju aplikacije.
  Dodato: tabela `Membership` (korisnik ↔ ZEV ↔ uloga), `Zev.tier`/
  `Zev.active`, `User.isSuperAdmin`, i (za sada nevezana, nullable) `zevId`
  kolona na 32 postojeća modela. Postojeći podaci postaju "tenant #1" —
  svaki korisnik dobija `Membership` red prema svojim trenutnim ulogama, a
  sve postojeće tabele dobijaju `zevId` popunjen na jedini postojeći ZEV.
  Auth, sesije, servisni sloj i test paket za izolaciju tenanta ostaju
  nepromijenjeni — slijede u narednim koracima.

## [0.2.2] - 2026-09-06

### Izmijenjeno

- Izvještaj „Dugovanja po vlasnicima" sada jasnim tekstom i oznakom uz svaki iznos
  (duguje / preplata / izmireno) objašnjava šta znači prethodni saldo i konačni
  saldo — pozitivan iznos = vlasnik duguje ZEV-u, negativan = ima preplatu
  (kredit/avans), nula = izmireno. Isto pojašnjenje dodato i u PDF izvoz.
- Biranje vlasnika u istom izvještaju zamijenjeno je dropdown menijem sa
  checkboxovima (umjesto teško preglednog `<select multiple>`), sa dugmadima
  „Izaberi sve" i „Obriši izbor".

## [0.2.1] - 2026-09-05

### Izmijenjeno

- Izvještaj „Dugovanja po vlasnicima" sada jasno razdvaja **prethodni saldo**
  (stanje prije izabranog dana) od **promjena knjiženih na izabrani dan**
  (zaduženo/plaćeno/korekcije tog dana), umjesto da prikazuje samo kumulativne
  ukupne iznose otkad postoji vlasnik. Ako na izabrani dan nije bilo nijedne
  promjene, izvještaj sada jasno pokazuje samo prethodni saldo (u plusu, minusu
  ili nula), i za vlasnika i u PDF izvozu.

## [0.2.0] - 2026-09-05

### Izmijenjeno

- Promijenjena šema verzionisanja sa `MAJOR.mmm` na standardni semver
  `MAJOR.MINOR.PATCH` (minor kao podrazumijevani korak, patch za međukorake dok se
  nešto dovršava, major resetuje minor na `1` umjesto na `0`). Vidjeti sekciju
  „Verzionisanje" iznad. Prethodne verzije (`0.900`, `0.901`) ostaju kako su
  zabilježene, bez preimenovanja.

## [0.901] - 2026-09-05

### Dodato

- Izvoz svih operativnih izvještaja (stanje računa, prihodi/rashodi, potraživanja,
  dobavljači, fond održavanja, pregled po zgradama/projektima) u jedan PDF dokument,
  pored postojećeg CSV izvoza po pojedinačnom izvještaju.
- Novi izvještaj „Dugovanja po vlasnicima" na stranici Izvještaji — zaduženo/plaćeno/
  korekcije/saldo po vlasniku, sa stanjem na proizvoljno izabran dan i mogućnošću da
  se prikaže za jednog, više ili sve vlasnike. Izvoz u PDF (izvod otvorenih stavki),
  verzionisan i vidljiv u Dokumentima.

### Ispravljeno

- Filter „stanje na dan" (i za dugovanja po vlasnicima) je do sada isključivao stavke
  izdate/knjižene istog dana nakon ponoći (npr. izvještaj za „danas" je znao pokazati
  sve nule) — sada obuhvata cijeli izabrani dan.

## [0.900] - 2026-09-05

Prva verzionisana isporuka — snimak trenutnog stanja aplikacije.

### Osnovna funkcionalnost

- Autentifikacija i sesije (jose + bcryptjs, sesije u bazi), RBAC (predsjednik,
  računovođa, vlasnik) sa autorizacijom isključivo na serverskom sloju.
- Imovina i vlasništvo: zgrade, jedinice, vlasnici/suvlasnici, korisnici.
- Skupština i organi ZEV-a: prijedlozi, elektronsko glasanje sa kvorumom/većinom po
  snimljenim pravilima, sigurni tokeni za glasanje, izjave o saglasnosti (PDF).
- Fakturisanje i uplate: konfigurabilne stavke naknada (9 metoda obračuna), serije
  faktura, uparivanje uplata, salda.
- Troškovi, dobavljači i godišnji planovi (planirano/realizovano).
- Održavanje: prijave kvarova, zakazivanje, preventivni pregledi.
- Dokumenti, izvještaji i notifikacije (e-mail/Viber, mock provajderi u MVP-u).
- Append-only audit trag (DB trigerima zabranjen UPDATE/DELETE nad audit tabelom i
  glasovima), sav novac kao `Decimal`.

### Izmijenjeno / poboljšano (uoči ove verzije)

- Meni preuređen: lijevi sidebar sa punom navigacijom + tanka gornja traka sa
  profilom/odjavom u gornjem desnom uglu.
- Sidebar se collapsuje/proširuje (defaultno proširen, pamti izbor po korisniku), sa
  monohromatskim pictogram ikonicama za svaku stavku menija.
- Redizajn UI komponenti (`ui.tsx`) u Material Design stilu — dugmad, kartice,
  tabele, polja, statusni bedževi.
- Dodata mogućnost uređivanja postojećih stavki naknada (do sada samo kreiranje).
- Izjava o saglasnosti (PDF) prepravljena da stane na jednu stranicu.
- Proširen tekst saglasnosti i dodana lična Podešavanja sekcija.
- Dodat ZEV logo pored imena aplikacije u meniju (prošireno i suženo stanje) i
  postavljen kao favicon/app ikonica.
