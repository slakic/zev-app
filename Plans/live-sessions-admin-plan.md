# Plan: pregled aktivnih sesija za super admina (sa IP adresama)

## Rezime

1. **Sesija je već pravi red u bazi, pa je glavni dio posla samo jedan upit.** Cookie `zev_session` nosi samo `{ sid }` (`src/server/auth/session.ts:47-51`), a sve ostalo je u tabeli `Session` (`prisma/schema.prisma:57-75`). Da bi se dobio spisak prijavljenih, nije potrebna nikakva nova infrastruktura. Dovoljan je upit `revokedAt IS NULL AND expiresAt > now()` sa spojem na `User`, `Zev` i `Membership`. Za "uživo" osvježavanje već postoji `LiveRefresh` (`src/components/live-refresh.tsx`) i koristi se bez ikakve izmjene.
2. **Najteža odluka: aplikacija danas nigdje ne čuva sirovu IP adresu.** Kolona `Session.ip` uprkos imenu sadrži `sha256(ip)` (`session.ts:43`). Isti obrazac važi za `AuditEvent.ipHash` (`src/server/audit.ts:16,95`) i za glasanje. Da bi korisnik vidio IP, moramo početi čuvati nešto novo. Preporuka je puna IP adresa u novoj koloni, ali samo dok je sesija važeća: briše se pri odjavi ili opozivu, a najkasnije kad sesija istekne (12 h, `session.ts:9`). Stare sesije nikad neće imati IP. Pošto sesija traje najviše 12 h, sve važeće sesije će imati IP najkasnije 12 sati nakon puštanja.
3. **Samo "važeća" sesija ne znači da je neko tu.** Ne postoji `lastSeenAt`. Sesija čiji je vlasnik zatvorio browser prije 11 sati izgleda isto kao ona u kojoj neko upravo radi. Takve sesije se ne čiste ni kad korisnik obriše cookie. Zato preporučujem `lastSeenAt` sa ograničenim upisom (najviše jedan upis po sesiji na 5 minuta), u zasebnoj fazi.
4. **Opoziv sesije ("odjavi ovu sesiju") je jeftin, ali nije tražen.** Primitiv već postoji (`users.ts:207`, `users.ts:279`, `session.ts:63-73`). Predlažem ga kao opcionu Fazu 3, samo ako je korisnik izričito odobri.

## Zatečeno stanje

**Model i životni ciklus sesije**
- `Session` ima polja `id, userId, activeZevId?, expiresAt, revokedAt?, ip?, userAgent?, createdAt` (`schema.prisma:57-75`). Indeksi postoje samo na `userId` i `activeZevId`, a `lastSeenAt` ne postoji.
- `createSession()` je na `session.ts:37-61`. Tu se `ip` hešira (linija 43), `userAgent` se čuva neobrađen do 255 znakova (linija 44), a TTL je 12 h (linija 9).
- Login akcija je na `src/app/login/page.tsx:12-29`. Sirovi IP stiže iz `clientIp()` (`session.ts:194-197`: `x-forwarded-for`, prvi element, pa `x-real-ip`). Postoji samo kao lokalna varijabla i ide u `authenticate(..., sha256(ip))` (audit `auth.login` sa `ipHash`, `users.ts:54`) i u `createSession`.
- `getAuthContext()` (`session.ts:113-173`) odbija sesiju koja je opozvana, istekla ili pripada neaktivnom korisniku (linije 155-156). Aktivni ZEV i uloge dobija preko `resolveActiveContext()` (`session.ts:91-110`), a uloge dolaze iz `Membership`, ne iz `Session`. Ovu funkciju zove 17 mjesta u `src/`, pa se u jednom zahtjevu (layout, stranica, akcija) često izvrši više puta. To je važno za throttling `lastSeenAt`.
- Opoziv danas:
  - `destroySession()` za trenutnu sesiju (`session.ts:63-73`);
  - `updateMany({ where: { userId }, data: { revokedAt } })` pri resetu lozinke (`users.ts:207`) i deaktivaciji (`users.ts:279`).
- **Ništa ne ograničava broj istovremenih sesija.** `createSession` samo radi `create`, a login ne opoziva prethodne sesije. Jedino `LoginPage` preusmjerava već prijavljenog korisnika (`login/page.tsx:32-33`), pa nova sesija nastaje samo kad browser nema cookie. Jedan korisnik zato može imati N sesija (telefon, laptop, obrisan cookie...).
- **Istekle i opozvane sesije se nikad ne brišu.** Nema `deleteMany` nad `Session` nigdje u `src/`, nema cron rute (`src/app/api/cron` ne postoji, nema `vercel.json`).

**Privatnost i retencija**
- `sha256()` (`src/server/auth/tokens.ts:14-17`) je **bez soli**, a komentar kaže "Only hashes are ever stored or logged." IPv4 prostor ima 2³² vrijednosti, pa je ovakav heš u praksi pseudonimizacija, a ne anonimizacija, jer se IP može povratiti nabrajanjem. Ovo je sporedni nalaz. Plan to **ne** koristi za "backfill" starih sesija, jer bi to bilo protivno namjeri postojeće odluke (vidi Rizike).
- `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md:17-18` navodi Zakon o zaštiti ličnih podataka BiH (Sl. glasnik BiH 12/25): minimizacija, svrha, rokovi čuvanja. Stavka 3.6 (oko linija 56-58) određuje rokove čuvanja kao konfigurabilne, podrazumijevano "30 dana za IP metapodatke glasanja", uz oznaku **[PRAVNA PROVJERA]**.
- Postavka `retention.voteIpDays` postoji (`src/lib/settings-defaults.ts:9,21`), ali je **nigdje ne primjenjuje nijedan kod**. Grep za `retention` u `src/` pogađa samo taj fajl. `Setting` je vezan za tenant (`schema.prisma:1594-1602`, `@@id([zevId, key])`), pa ne odgovara platformskim podacima kao što su sesije.
- `AuditEvent` je append-only, DB trigger odbija UPDATE i DELETE (`audit.ts:1-2`). **Sve što uđe u audit ne može se naknadno obrisati.**

**Obrasci koje kloniramo**
- Guard: `requireSuperAdminActor()` (`src/server/actor.ts:42-57`). Servisni sloj ima `requireSuperAdmin(actor)` (`src/server/auth/guards.ts:93`), koji koristi npr. `listTenants` (`src/server/services/admin.ts:30-31`).
- Stranica: `src/app/admin/aktivnosti/page.tsx`. To je async server komponenta, guard je prva linija, podaci se učitavaju kroz `Promise.all`, filteri idu preko `searchParams` (Promise), a koriste se primitivi iz `ui.tsx`.
- Ispravka pretpostavke iz zadatka: `/admin` **ima** shell. `src/app/admin/layout.tsx:19-37` renderuje `NavShell variant="platform"` sa linkovima na linijama 21-24. Komentar u `aktivnosti/page.tsx:38-45` govori o *tenant* navigaciji iz `(app)`. Nova stranica automatski dobija platformski shell, a treba dodati link u `layout.tsx`, ikonu u `src/components/nav-icons.tsx:207` i i18n ključ (npr. `admin.sessions`, uz postojeće `admin.activity`).
- Audit katalog: `src/lib/activity/catalog.ts:31` (`ACTION_CATEGORY`). Postojeće `admin.*` i `session.switch_zev` akcije su `SYSTEM` (linije 114-148), a potpunost provjerava `tests/activity-catalog.test.ts`.
- U projektu nema biblioteke za parsiranje user-agenta (`ua-parser`/`bowser` nisu u `package.json`).
- Nigdje u aplikaciji ne postoji ekran koji prikazuje više sesija. Ovo bi bio prvi.

## Odluke

### O1. Prikaz IP adrese (centralna odluka)

Korisnik je tražio sesije "sa IP adresama sa kojih su ulogovani". To znači da želi čitati i porediti adrese, npr. uočiti prijavu iz neočekivane zemlje ili mreže, ili provjeriti da li dvije sesije dolaze sa iste mreže.

- **(a) Puna IP adresa u novoj koloni, vezana za život sesije.**
  - Dodaje se `Session.ipAddress String?`, a sirovi IP se upisuje u `createSession`.
  - Heš ostaje u postojećoj koloni. Poljeu se mijenja ime u `ipHash` preko `@map("ip")`, što ne zahtijeva DB migraciju, a ispravlja zbunjujuće ime. Heš i dalje služi za povezivanje sa `AuditEvent.ipHash` iz `auth.login`.
  - Sirovi IP **se briše** (`ipAddress: null`):
    - pri odjavi (`destroySession`);
    - pri opozivu (`users.ts:207`, `users.ts:279`, eventualni admin opoziv);
    - kad sesija istekne, lijenim čišćenjem.
  - Rezultat: sirovi IP postoji najviše oko 12 h plus kašnjenje čišćenja, što je znatno kraće od postojećih 30 dana za IP glasanja.
  - Pravni osnov je legitimni interes za bezbjednost sistema. Vidi samo super admin.
  - Prednost: tačno ispunjava zahtjev. Mana: svjesno odstupanje od pravila "samo heševi", pa ga treba dokumentovati (komentar u `tokens.ts:14`, zapis u `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md`).
- **(b) Skraćena IP adresa**: IPv4 `/24` (`203.0.113.xxx`), IPv6 `/48`.
  - Dovoljno je za grubu procjenu ISP-a i regiona i za uočavanje anomalija, a pojedinačni uređaj se ne identifikuje.
  - Mana 1: ne odgovara na pitanje "da li je ovo tačno ista adresa kao X" niti omogućava prijavu ili blokiranje konkretne adrese.
  - Mana 2: korisnik je tražio "IP adrese", a ovo je djelimično ispunjenje.
  - Čuvanje bi i dalje trebalo vezati za život sesije kao u (a), jer je `/24` kod kućnih priključaka često i dalje lični podatak.
- **(c) Prikaz samo postojećeg heša.** Heš se ne može pročitati ni geolocirati. Jedino što omogućava je grupisanje, tj. prikaz "iste mreže" kao sesija 3. Za stvarnu potrebu je gotovo bezvrijedan, pa ne vrijedi graditi UI oko njega.

**Preporuka: (a).**
- Zahtjev je izričit, a korisnik je operater platforme sa legitimnim bezbjednosnim interesom.
- Vezivanjem za život sesije rizik je znatno manji nego kod bilo kakvog trajnog loga. Sirovi IP nestaje zajedno sa sesijom, pa se "minimizacija i rok čuvanja" poštuju strože nego kod postojećeg `retention.voteIpDays`.
- (b) je razumna alternativa ako korisnik želi manji otisak. Implementacija se razlikuje samo u jednoj funkciji (`maskIp()` pri upisu), pa se odluka može promijeniti i kasnije.
- **Sirovi IP nikad ne ide u `AuditEvent`**, jer se tamo ne može obrisati (trigger, `audit.ts:1-2`).

**Čišćenje isteklih sesija.** Cron ne postoji, a `Setting` je vezan za tenant, pa tu ne odgovara. Zato se koristi fiksna konstanta i lijeno čišćenje:
```ts
prisma.session.updateMany({ where: { ipAddress: { not: null }, OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] }, data: { ipAddress: null } })
```
Poziva se u `createSession` (svaki login, pa radi i ako niko ne otvara admin stranicu) i na početku učitavanja admin stranice. Na ovoj veličini baze upit je jeftin. Ako tabela naraste, dodaje se indeks na `expiresAt`.

**Istorija.** Postojeće sesije imaju samo heš. U UI se prikazuje "— (prije v.X)" ili prazno. Rampa je ograničena na 12 h.

### O2. `lastSeenAt` (stvarna aktivnost)

- **(a) Bez `lastSeenAt` u v1.** Prikazuje se samo vrijeme prijave i isteka, a `LiveRefresh` otkriva nove prijave i odjave. Mana: prikaz obmanjuje, jer napuštene sesije (zatvoren browser, obrisan cookie) izgledaju "prijavljene" još do 12 h. Za "live" pogled to je ozbiljna slabost.
- **(b) `lastSeenAt DateTime?` sa ograničenim upisom u `getAuthContext()`.** Nakon uspješne validacije sesije:
  ```ts
  if (!session.lastSeenAt || now - session.lastSeenAt > 5 min)
    prisma.session.updateMany({ where: { id, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: now - 5min } }] }, data: { lastSeenAt: now } }).catch(() => {})
  ```
  - Uslov je u `where` klauzuli, pa ni istovremeni pozivi (više `getAuthContext` u istom zahtjevu, paralelni tabovi) ne prave više od jednog stvarnog upisa po intervalu. Isti fire-and-forget obrazac sa `.catch(() => {})` već postoji na `session.ts:98`.
  - Trošak: najviše 1 UPDATE po sesiji na 5 minuta. Rezultat: kolona "Posljednja aktivnost" i oznaka "aktivan sada" (< 15 min).
- **(c) Upis na svaki zahtjev.** Odbacuje se: pravi višestruke upise po zahtjevu bez ikakve koristi.

**Preporuka: (b), kao zasebna Faza 2.** Faza 1 je korisna i bez nje. Interval od 5 min i prag "aktivan" od 15 min su konstante u `session.ts`. IP se **ne** osvježava pri `lastSeenAt`, nego ostaje IP prijave, jer bi i to bilo proširenje obima (vidi Pitanja).

### O3. Opoziv sesije ("Odjavi")

- **(a) Samo pregled u v1.** Tačno ono što je traženo.
- **(b) Dugme "Odjavi ovu sesiju" u v1.**
- **(c) Pregled odmah, opoziv kao opciona Faza 3**, samo uz izričitu potvrdu.

**Preporuka: (c).** Trošak je mali: servis `revokeSession(actor, sessionId)` u `admin.ts` postavlja `revokedAt = now, ipAddress = null` i radi audit. Ali to je mutirajuća akcija nad tuđim nalogom, koja nije tražena, a obrasci iz ovog projekta ne proširuju obim prećutno.

Ako se Faza 3 odobri:
- Akcija ponovo zove `requireSuperAdminActor()`.
- Odbija opoziv sopstvene trenutne sesije (`actor.sessionId`), jer za to postoji "Odjava".
- Traži potvrdu (`RowAction` sa confirm).
- UI treba jasno reći da opoziv **ne sprečava ponovnu prijavu**, jer to radi deaktivacija naloga (`users.ts:279`).
- Opcioni dodatak: "Odjavi sve sesije korisnika", reuse `updateMany` obrasca.

### O4. Šta znači "trenutno prijavljen"

Osnovni uslov: `revokedAt: null, expiresAt: { gt: now }, user: { active: true }`. Filter `user.active` usklađuje prikaz sa `getAuthContext` (`session.ts:156`), koji takvu sesiju ionako odbija.

Dodatno se samo **označava**, bez posebnih pravila:
- ZEV suspendovan (`activeZev.active === false`): sesija formalno važi, ali `requireActor` korisnika izbacuje. Prikazuje se oznaka "ZEV suspendovan".
- Bez aktivnog ZEV-a (`activeZevId` null): prikazuje se "—" ili "Platforma" za super admina.
- Uskoro ističe: nije potreban poseban tretman. Kolona "Ističe" sa relativnim vremenom je dovoljna.

Uz Fazu 2 se dodaje filter "Samo aktivni sada (< 15 min)". Za "live" namjenu vjerovatno treba biti podrazumijevano uključen (vidi Pitanja).

### O5. Više sesija istog korisnika

Potvrđeno je da ništa ne ograničava broj istovremenih sesija (Zatečeno stanje).

- **(a) Ravna lista sesija** sortirana po posljednjoj aktivnosti (Faza 1: po `createdAt`), uz oznaku "3 sesije" kod korisnika. Oznaka je link na `?korisnik=<id>`, koji filtrira listu.
- **(b) Grupisanje po korisniku** (redovi koji se proširuju ili `rowSpan`). Čitljivije kod mnogo duplikata, ali traži novi UI obrazac koji `ui.tsx` nema.

**Preporuka: (a).** Uklapa se u postojeći `Table`/`FilterBar`. Pri očekivanom obimu (desetine istovremenih sesija) grupisanje nije potrebno.

### O6. Privatnost i retencija

Pokriveno u O1:
- Sirovi IP živi koliko i sesija.
- Briše se na svim putanjama opoziva i lijenim čišćenjem isteklih sesija.
- Nikad ne ulazi u audit.
- Vidljiv je samo super adminu.
- `userAgent` ostaje kao danas.

Dokumentacija: dopuna `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` §3.6 ("IP adresa aktivne sesije: čuva se do isteka ili odjave sesije, max 12 h; svrha: bezbjednost platforme") uz **[PRAVNA PROVJERA]**, i ispravka komentara `tokens.ts:14`, koji više ne bi bio tačan. Redovi `Session` se i dalje ne brišu. To je van obima, ali nakon brisanja IP-a u njima ostaju samo heš i UA (vidi Rizike).

### O7. Audit

- **Pregled stranice: ne auditovati.** Nema presedana: ni `/admin/aktivnosti` ne loguje pregled. `LiveRefresh` bi svakih 10 s pravio novi događaj (360 na sat) u tabeli iz koje se ništa ne može obrisati.
- **Opoziv (ako se radi Faza 3): auditovati** kao `admin.session.revoke` sa `targetType: "Session"` i `after: { userId, sessionId }`, **bez IP-a**. U `ACTION_CATEGORY` ide kao `"SYSTEM"`, uz ostale `admin.*`, u istoj izmjeni, da bi `tests/activity-catalog.test.ts` prošao. `zevId` se ne postavlja, jer je akcija platformska (kao `admin.account.create`).

## UI dizajn: `/admin/sesije`

- **Navigacija:** novi link "Sesije" u `src/app/admin/layout.tsx:21-24`, i18n ključ `admin.sessions`, ikona u `nav-icons.tsx`.
- **Zaglavlje:** `PageHeader` "Aktivne sesije", uz `<LiveRefresh />` bez izmjena. Ispod je red sažetka: "12 sesija · 9 korisnika · 4 aktivno sada" (zadnji podatak od Faze 2).
- **Filteri (`FilterBar`, GET forma):**
  - ZEV (`<select>` iz `listTenants`);
  - "Samo aktivni sada" (od Faze 2);
  - skriveni `korisnik`, sa linkom "poništi".
- **Tabela (`Table`/`Td`/`ColumnSpec`):**

| Kolona | Sadržaj |
|---|---|
| Korisnik | ime (kao u `getAuthContext`: Party u aktivnom ZEV-u, inače e-mail), e-mail sitnije; oznake "Super admin", "Vi (ova sesija)", "N sesija" |
| ZEV / uloge | kratki naziv aktivnog ZEV-a + uloge iz `Membership` za taj ZEV (t() labele); "ZEV suspendovan" |
| IP adresa | `ipAddress` monospace; "—" za sesije prije uvođenja |
| Uređaj | skraćeni opis ("Chrome · Windows", "Safari · iPhone") iz male regex funkcije `describeUserAgent()` u `src/lib/`, puni UA u `title` atributu |
| Prijava | `formatDateTime(createdAt)` |
| Posljednja aktivnost (Faza 2) | relativno ("prije 2 min") + tačka "aktivan" ako < 15 min |
| Ističe | relativno ("za 7 h") |
| (Faza 3) | `RowAction` "Odjavi" sa potvrdom; nema ga u redu trenutne sesije |

- **Sortiranje:** Faza 1 `createdAt desc`, od Faze 2 `lastSeenAt desc nulls last`. Ograničenje od 200 redova uz napomenu, bez paginacije. Paginacija i `LiveRefresh` se ionako loše slažu, a obim to ne traži.
- **Prazno stanje:** "Nema aktivnih sesija."

**Servis:** `listActiveSessions(actor, { zevId?, userId?, activeOnly? })` u `src/server/services/admin.ts` (ili novi `sessions.ts`).
- Prva linija je `requireSuperAdmin(actor)`.
- Jedan `findMany` sa `select` koji uzima samo potrebno:
  - `user { id, email, isSuperAdmin, memberships { zevId, role }, parties { zevId, kind, firstName, lastName, orgName } }`;
  - `activeZev { id, shortName, legalName, active }`.
- Uloge i ime se računaju u JS-u, filtrirano na `activeZevId`. Ne vraća heš ni puni UA ako nisu potrebni.

## Faze implementacije

**Faza 1: IP u sesiji + stranica samo za pregled.**
- Migracija: `Session.ipAddress String?`, a polje `ip` se u Prismi preimenuje u `ipHash` sa `@map("ip")`, bez promjene u bazi.
- `createSession` upisuje oba i poziva lijeno čišćenje.
- `ipAddress: null` se dodaje u `destroySession` (`session.ts:67`), `users.ts:207` i `users.ts:279`.
- Servis `listActiveSessions`, stranica `/admin/sesije`, nav link, `describeUserAgent`.
- Dopuna `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` i komentara u `tokens.ts:14`.
- Testovi (`tests/admin-sessions.test.ts`):
  - opozvane, istekle i sesije neaktivnih korisnika se ne prikazuju;
  - ne-super-admin dobija grešku;
  - uloge se uzimaju za `activeZevId`;
  - opoziv i čišćenje brišu `ipAddress`.
- `createSession` zove `cookies()`, pa se upisni podaci izdvajaju u pomoćnu funkciju (npr. `sessionCreateData(userId, ip, ua)`) koja se testira direktno. To je isti razlog zbog kojeg je `resolveActiveContext` izvezen (`session.ts:88-90`).
- Faza 1 ide prva, jer se IP podaci počinju skupljati tek od puštanja.

**Faza 2: `lastSeenAt`.**
- Migracija `lastSeenAt DateTime?`, ograničeni upis u `getAuthContext`, izvezena funkcija za test throttlinga.
- Kolona "Posljednja aktivnost", filter "Samo aktivni sada" i brojač u sažetku.

**Faza 3 (opciono, samo uz odobrenje): opoziv.**
- `revokeSession` servis i akcija, audit `admin.session.revoke` + `catalog.ts` + test.
- Eventualno "Odjavi sve sesije korisnika".

## Rizici

- **Lažiranje `x-forwarded-for` van Vercela.** Na Vercelu edge sloj postavlja zaglavlje, pa je prvi element pouzdan. Na drugom hostingu (vidi `Plans/deployment-portability-plan.md`) klijent može podmetnuti vrijednost, pa bi prikazani IP bio laž. Treba dodati napomenu u `clientIp()` (`session.ts:194`). Isti problem već pogađa rate-limit po heširanom IP-u.
- **Odstupanje od pravila "samo heševi".** Mora biti dokumentovano (O6), inače ga sljedeći čitalac koda protumači kao grešku ili, gore, kao presedan za čuvanje sirovih IP adresa i drugdje.
- **Neslani heš IP-a se može povratiti nabrajanjem.** "Backfill" starih sesija na taj način se izričito odbacuje: bio bi protivan namjeri postojeće odluke, a donosi vrijednost za najviše 12 h. Ispravka samog heširanja (HMAC sa tajnom) je poseban zadatak van ovog obima, jer menja i poređenje sa `AuditEvent.ipHash` i rate-limit.
- **Lijeno čišćenje zavisi od aktivnosti.** Ako niko nema ni login ni pregled admin stranice, istekle sesije zadržavaju IP duže od 12 h. To je prihvatljivo, jer pri ovom obimu logini su svakodnevni. Ako se kasnije uvede cron, čišćenje se tamo premješta.
- **`lastSeenAt` upis u `getAuthContext`.** Mora ostati fire-and-forget i ne smije usporiti niti oboriti zahtjev (`.catch`). Uslov u `where` sprečava višestruke upise.
- **Tabela `Session` raste neograničeno**, jer se redovi nikad ne brišu. To postoji i danas. Upit za aktivne sesije treba indeks na `expiresAt` ili composite `(revokedAt, expiresAt)` kad tabela naraste. Brisanje starih redova je zaseban zadatak.
- **Oznaka "Vi (ova sesija)" i opoziv sopstvene sesije.** U Fazi 3 bez provjere super admin bi mogao sam sebe izbaciti. Rješenje je eksplicitna zabrana u servisu.

## Pitanja za korisnika

1. **IP prikaz:** da li prihvatate punu IP adresu koja se čuva samo dok sesija važi (preporuka, O1-a), ili radije skraćenu adresu `203.0.113.xxx` (O1-b)? Svjesni ste da stare sesije neće imati IP, ali da će sve važeće sesije imati IP najkasnije 12 h nakon puštanja?
2. **Rok čuvanja IP-a:** da li je "do odjave ili isteka sesije (max 12 h)" prihvatljivo, ili želite duže čuvanje, npr. i nakon odjave radi naknadne istrage (to bi bila nova odluka o retenciji i zahtijevala bi pravnu provjeru)?
3. **`lastSeenAt` (Faza 2):** da li je "posljednja aktivnost" dio onoga što podrazumijevate pod "uživo"? Da li su interval upisa od 5 min i prag "aktivan sada" od 15 min u redu?
4. **Podrazumijevani filter:** kada postoji Faza 2, da li stranica treba podrazumijevano prikazivati samo "aktivne sada" ili sve važeće sesije?
5. **Opoziv sesije (Faza 3):** da li želite dugme "Odjavi ovu sesiju", i eventualno "Odjavi sve sesije korisnika"? Ili ostajemo samo na pregledu?
6. **IP pri promjeni mreže:** da li je dovoljno prikazati IP sa kojeg je sesija *prijavljena* (kako ste tražili), ili treba pratiti i promjenu IP-a tokom sesije (npr. telefon koji pređe sa Wi-Fi na mobilnu mrežu)? To bi bilo dodatno proširenje uz Fazu 2.
7. **Geolokacija:** da li vam treba prikaz zemlje/grada uz IP? Plan to namjerno ne uključuje, jer bi zahtijevao eksternu bazu (GeoIP) ili servis, a slanje IP adresa trećoj strani je posebno pitanje privatnosti.
8. **Ime rute i stavke u meniju:** da li su `/admin/sesije` i "Sesije" u redu?

### Kritični fajlovi za implementaciju

- `src/server/auth/session.ts`
- `prisma/schema.prisma`
- `src/server/services/admin.ts`
- `src/app/admin/aktivnosti/page.tsx` (šablon za novu `src/app/admin/sesije/page.tsx`)
- `src/app/admin/layout.tsx`
- `src/server/services/users.ts` (linije 207 i 279, brisanje `ipAddress` pri opozivu)
- `src/lib/activity/catalog.ts` (samo ako se radi Faza 3)
