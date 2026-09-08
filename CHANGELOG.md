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
  sadrže id-jeve drugog.

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

### Napomena

- **Otkriven i ispravljen propust u samoj isporuci koda:** dio Koraka 5
  (`meetings.ts` osim `openVoting`, `expenses.ts`, `plans.ts`,
  `maintenance.ts`, `reports.ts`, `documents.ts`, `attachments.ts`,
  `evoteConsent.ts`, popravka `audit()`, uklanjanje `default_zev_id()`
  defaulta) i cijeli Korak 6 (test paket) su ranije pogrešno prijavljeni
  kao isporučeni i verifikovani, a zapravo nikad nisu stigli do ovog
  projekta zbog greške u ranijim sesijama (fajlovi su pisani u pogrešan,
  susjedni folder). Otkriveno 2026-09-08 kroz 20 padova u test pipeline-u;
  sav nedostajući kod je sada stvarno isporučen ovdje. Zbog toga se verzija
  diže direktno sa `1.2.0` na `2.1.0` u jednom koraku, umjesto kroz
  međuverziju `1.3.0` koja je ranije pogrešno pomenuta.
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
