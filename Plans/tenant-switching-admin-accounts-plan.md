# Prebacivanje između ZEV-ova, administrativni nalozi i početna lozinka — plan za pregled

**Status: PLAN, implementacija nije počela.** Nastalo na zahtjev korisnika (2026-09-10):
*"Right now, I can create a new tenant, and create one account within that tenant, but after
that I cannot switch to this zev, nor can I do anything else. I need ability to seamlessly
switch between the tenants, and as a super admin add accounts with permission to administer.
When creating account, there are no login information, so I don't have ability to set login
password (at least initial one)."*

Izrađeno plansko-analitičkim prolazom (Opus model, plan-only, bez pisanja koda —
metodologija u skill-u `opus-plan-sonnet-code`), zasnovano na čitanju stvarnog koda projekta.
Nastavlja se direktno na `docs/multitenancy-plan.md` §"Faza 3 — dovršavanje", čija je stavka 1
("Izbornik aktivnog ZEV-a za korisnike sa više članstava") upravo ovo — planirana ali nikad
izgrađena.

---

## 0. Rezime — pročitati prije ostatka

Tri tražene stvari nisu tri nezavisna zadatka. Jedna odluka ih povezuje i određuje
cijeli plan:

> **Super admin ulazi u tenant tako što dobije stvarni `Membership` red u njemu — ne kroz
> paralelni "view as"/impersonation mehanizam.**

Razlog nije stilski. `Actor.roles` se popunjava **isključivo** iz `Membership` redova za
aktivni ZEV (`resolveActiveZev`, `src/server/auth/session.ts:96`). Kad bi se super adminu
samo postavio `session.activeZevId` na tenant u kojem nema članstvo, dobio bi `roles: []` —
prošao bi kroz `requireZev()`, ali bi ga `requireActor("PRESIDENT")` odmah vratio na
`/?err=forbidden` sa skoro svake stranice. To nije "pristup", nego prazna ljuštura. Dakle
prebacivanje (P1) bez članstva (P2) ne rješava ništa, a članstvo u tenantu koji je tek
kreiran zahtijeva nalog sa upotrebljivom lozinkom (P5).

Druga stvar koju je čitanje koda promijenilo u odnosu na polaznu formulaciju zadatka:
**problem sa lozinkom nije "nedostaje opcija", nego bag u `createTenant()`** — onboarding
novog tenanta danas strukturno **ne može da se završi** bez ispravnog mail provajdera, kojeg
aplikacija nema (provajderi su mock). Zato se to ne rješava samo za novi tok, nego u korijenu
(§6, Korak 1).

Treća: `User.partyId` je `@unique` (`prisma/schema.prisma:39`) — jedan korisnik ima **najviše
jedan** `Party`. To znači da knjigovođa koji opslužuje dva ZEV-a **ne može** imati `Party` u
oba. To je tvrdo ograničenje šeme, ne izbor, i ono diktira odgovor na P3 (§4).

---

## 1. Problem — tri praznine, sa dokazima iz koda

### 1.1 Nema načina da se promijeni aktivni ZEV

`Session.activeZevId` postoji od Faze 0. `resolveActiveZev()`
(`src/server/auth/session.ts:83-98`) ga **postavlja**, ali ništa u aplikaciji ga nikad ne
**mijenja** na zahtjev korisnika. Njegov sopstveni doc komentar to i priznaje:

> *"a user with more than one Membership also defaults to the first (by createdAt) until Faza 3
> adds an actual 'choose ZEV' screen"*

Nijedna ruta, server akcija ni servisna funkcija ne piše `session.activeZevId` osim tog
auto-izbora. Grep potvrđuje: jedini upis je linija 93.

### 1.2 Nema načina da super admin dobije pristup postojećem tenantu

`createTenant()` (`src/server/services/admin.ts:87-192`) je **jedino** mjesto u cijeloj
aplikaciji koje kreira `Membership` za tenant koji super admin administrira — i to tačno
jednom, u trenutku kreiranja, za tačno jednog PRESIDENT-a. Poslije toga:

- `updateUserRoles`/`deactivateUser`/`activateUser` (`users.ts`) traže `requireRole(actor,
  "PRESIDENT")` **i** `requireZev(actor)` — super admin nema nijedno (njegov nalog po pravilu
  ima nula članstava, pa mu je `zevId` uvijek `null`).
- `createUserForParty` isto (`users.ts:62-63`).
- `/admin/[zevId]` prikazuje `zev.memberships` samo za čitanje — nema nijedne akcije nad njima.

Link "Moj ZEV" u `src/app/admin/layout.tsx:27` je uslovljen sa `actor.zevId &&` — kod već
predviđa da super admin ponekad ima aktivan tenant, ali ne postoji nijedan put kojim bi to
`zevId` ikad postalo različito od `null`.

### 1.3 Nema početne lozinke — i onboarding zbog toga strukturno ne radi

`createTenant()` hešira `generateToken()` kao lozinku (linija 120: *"Random,
never-communicated password"*), zatim upisuje `passwordResetTokenHash` i šalje reset link
kroz `queueNotification({ zevId: zev.id, ... })`. Provajderi su mock — poruka završi u
`NotificationMessage` tabeli tog tenanta. Jedino mjesto gdje se te poruke vide je
`/podesavanja/poruke`, koje je gated sa `requireActor("PRESIDENT", "ACCOUNTANT")` **i**
`requireZev(actor)` (`src/app/(app)/podesavanja/poruke/page.tsx:8-9`), plus filtrira
`where: { zevId }`.

Zaključak koji treba naglasiti: **super admin koji je upravo kreirao tenant ne može ni da se
prijavi kao njegov predsjednik (lozinka mu je nepoznata), ni da pročita poruku sa linkom
(nije član tog tenanta).** Uz to link važi 1 sat. Ne postoji nijedan izlaz iz te situacije
kroz UI aplikacije.

Presedan za rješenje već postoji i radi: `createUserForParty(actor, { partyId, email,
**password**, roles })` uzima čist tekst lozinke koju bira pozivalac, bez ijednog mail/token
koraka — a `/vlasnici` forma ima bukvalno `<Field label="Početna lozinka"><input
name="accountPassword" type="text"></Field>` (`src/app/(app)/vlasnici/page.tsx:156`).

---

## 2. P1 — Mehanizam prebacivanja aktivnog ZEV-a

### 2.1 Odluka: validacija isključivo prema `Membership`, i za super admina

Prebacivanje se dozvoljava **samo** u ZEV u kojem pozivalac ima `Membership` red — bez
izuzetka za `isSuperAdmin`.

Zašto ne "super admin može u bilo koji tenant":

- **Ne bi radilo.** Kao u §0: bez `Membership` reda `roles` je prazan niz, pa je rezultat
  prazna ljuštura, a ne pristup. Da bi "super admin može svuda" stvarno funkcionisalo,
  moralo bi se dodati i pravilo "super adminu se sintetišu PRESIDENT ovlašćenja u svakom
  tenantu" — a to je drugi sistem dozvola paralelan `Membership`-u, tačno ono što
  `admin.ts`-ov sopstveni header komentar opisuje kao namjerno izbjegnuto.
- **Jedan izvor istine.** "Ko smije da radi unutar tenanta X" ostaje odgovoreno jednim
  upitom nad `Membership` — istom tabelom koju već čitaju `getTenant()`, revizorski trag
  (`podesavanja/audit/page.tsx:24`, e-mail se razrješava kroz `Membership` za taj zev) i
  `assertNotLastActivePresident`.
- **Trag.** Članstvo je red u bazi sa `createdAt`, vidljiv predsjedniku tenanta. Prećutno
  prebacivanje bez ijednog zapisa nije.

Dodatne provjere u samoj akciji, pored članstva:

1. Ciljni `Zev.active === true`. Bez ove provjere prebacivanje u suspendovan tenant bi
   pozvalo `requireActor()` → `destroySession()` → `/login?err=zev_suspended`
   (`src/server/actor.ts:14-17`), tj. prebacivanje bi te **odjavilo**. Bolje jasna greška
   nego odjava.
2. Ako je `zevId` isti kao trenutni — no-op, bez audit zapisa (izbjegava šum).

### 2.2 Gdje živi kod

- `src/server/auth/session.ts` — nova mala funkcija `setSessionActiveZev(sessionId, zevId)`,
  bez autorizacije, susjed `resolveActiveZev`-u (koji je jedini drugi pisac tog polja).
  Usput ispraviti zastarjeli doc komentar na `resolveActiveZev` ("until Faza 3 adds...").
- `src/server/auth/guards.ts` — `Actor` dobija `sessionId?: string`, po istom obrascu po kojem
  su `zevId?` i `isSuperAdmin?` dodati u Fazi 0 (opciono, da stare test fixture ostanu
  tipski ispravne). `getAuthContext()` ga već vraća (`AuthContext.sessionId`), samo ga
  `requireActor`/`requireSuperAdminActor`/`maybeActor` trenutno odbacuju.
  *Alternativa razmotrena i odbačena:* proslijediti `sessionId` kao zaseban argument servisnoj
  funkciji — izbjegava izmjenu `Actor`-a, ali tjera svaku server akciju da pored
  `requireActor()` pozove i `getAuthContext()` (dva ista upita nad sesijom po zahtjevu).
- **Novi modul `src/server/services/memberships.ts`** (business logika ide u `services/*`, po
  pravilima projekta):
  - `listMyTenants(actor)` → `[{ zevId, legalName, shortName, roles, active }]` za pozivaoca.
  - `switchActiveZev(actor, targetZevId)` → guard-ovi iz §2.1, `setSessionActiveZev`, `audit()`.
    Audit akcija: `session.switch_zev`, `targetType: "Zev"`, `after: { zevId }`. Napomena:
    `audit()` izvodi `zevId` iz `actor.zevId` (`src/server/audit.ts:53`), tj. zapis pada u
    **stari** tenant — što je i tačno ("iz ovog ZEV-a je otišao"). Ako želiš i zapis u novom,
    to je drugi poziv sa `{ ...actor, zevId: targetZevId }`; preporuka je **oba**, jer
    predsjednik ciljanog tenanta treba da vidi da je neko ušao.

Zašto ne u `admin.ts`: ovu funkciju koristi i običan korisnik sa dva članstva, ne samo super
admin, a sve u `admin.ts` je po definiciji `requireSuperAdmin`.

### 2.3 UI — dvije tačke ulaza, namjerno različite

**(a) U `(app)` — prekidač u korisničkom meniju.**
`src/components/nav-shell.tsx` već ima dropdown u gornjoj traci (`menuOpen`, linije 196-235)
koji prikazuje `displayName` + `rolesText`. Tu, iznad "Podešavanja", ide sekcija sa listom
ZEV-ova: svaki red je `<form action={switchAction}>` sa `<input type="hidden" name="zevId">`
i dugmetom, aktivni je označen i onemogućen.

Zašto baš tu, a ne u sidebar-u: dropdown je u gornjoj traci koja je vidljiva i na mobilnom
(sidebar je tamo drawer koji se mora otvoriti), a to je i uobičajeno mjesto za prekidač
radnog prostora (Slack/Google obrazac, isti koji `multitenancy-plan.md` §5 pominje).

**Renderovati samo kad `tenants.length > 1`.** Korisnik sa jednim članstvom (praktično svi
danas) ne vidi nikakvu promjenu.

`NavShell` je `"use client"`, pa `src/app/(app)/layout.tsx` prosljeđuje `tenants`,
`activeZevId` i server akciju kao props — isti obrazac kojim već prosljeđuje `logoutAction`.

**(b) Trajna oznaka aktivnog ZEV-a.** Uz prekidač, u gornju traku ide mali chip sa
`shortName ?? legalName` aktivnog ZEV-a, vidljiv **bez** otvaranja menija (opet samo kad ih
ima više od jednog). Ovo nije kozmetika: čim super admin počne da skače između tenanta,
"u kojem sam ZEV-u sad" postaje pitanje čiji pogrešan odgovor znači unos podataka u pogrešnu
zajednicu. Jeftino, a uklanja cijelu klasu grešaka.

**(c) U `/admin` — "Uđi u ovaj ZEV".**
Na `/admin/[zevId]`, pored postojeće kartice "Suspenzija", akcija koja poziva istu
`switchActiveZev` i onda `redirect("/")`. Prikazuje se **samo** kad super admin ima članstvo
u tom tenantu; kad nema, na tom mjestu stoji forma "Dodaj mi pristup" (§3). Na listi
`/admin/page.tsx` isto, kao link u redu tabele za tenante gdje članstvo postoji.

**(d) Povratak iz tenanta u `/admin`** već postoji — `src/app/(app)/layout.tsx:42` ubacuje
nav stavku "Super admin". Bez izmjene.

### 2.4 Šta se namjerno NE gradi u v1

- **Ekran "izaberi ZEV" nakon prijave.** `resolveActiveZev` i dalje auto-bira najstarije
  članstvo; prekidač iz (a) čini taj izbor bezopasnim. Zaseban ekran je nova ruta plus rizik
  od petlje preusmjeravanja, za korist koju prekidač već daje.
- **`User.lastActiveZevId` (pamćenje izbora između prijava).** Svaka prijava pravi nov
  `Session` red sa `activeZevId = null`, pa se izbor "zaboravlja" pri odjavi. Jedna kolona +
  jedan upis u `switchActiveZev` bi to riješili; preporuka je da bude Faza 3 korak 4, kad se
  vidi da li smeta u praksi.

---

## 3. P2 — Kako super admin dobija ovlašćenje unutar tuđeg tenanta

### 3.1 Preporuka: stvarni `Membership` red, eksplicitno dodijeljen, vidljiv tenantu

Razmotrene su dvije opcije. Preporuka je (a) — `Membership`, ne impersonation.

**Zašto `Membership`:**

| | `Membership` | "View as" / impersonation |
|---|---|---|
| Guard-ovi | Nijedan se ne mijenja | Svaki `requireRole`/`requireZev` mora znati da uvaži lažni kontekst |
| Audit `zevId` | Automatski tačan (`audit()` čita `actor.zevId`) | Zavisi od toga kako je impersonation izveden |
| Ko je akter u tragu | Stvarni `userId` super admina | Ili tuđi (najgori mogući ishod), ili stvarni ali nerazrješiv |
| Vidljivost tenantu | Red u tabeli, `createdAt`, prikazan | Nevidljivo osim ako se ne izgradi zaseban prikaz |
| Opoziv | Brisanje reda; `resolveActiveZev` izbaci sesiju na sljedećem zahtjevu | Novi mehanizam |

Posebno o auditu, jer je to najkonkretniji argument: `/podesavanja/audit`
(`src/app/(app)/podesavanja/audit/page.tsx:24-25`) razrješava e-mail aktera **preko
`Membership` za taj zev**:

```ts
const memberships = await prisma.membership.findMany({ where: { zevId }, include: { user: ... } });
const emailById = new Map(memberships.map((m) => [m.user.id, m.user.email]));
// ... e.actorId ? emailById.get(e.actorId) ?? e.actorId.slice(-8) : ...
```

Akter bez članstva u tom ZEV-u prikazuje se kao **posljednjih 8 znakova ID-a**. Dakle: sa
`Membership`-om predsjednik tenanta vidi konkretnu e-mail adresu pored svake radnje
platformskog admina — besplatno, bez ijedne izmjene te stranice. Bez njega vidi nerazumljiv
niz znakova. (Ovo već važi i danas za `admin.tenant.create`/`admin.tenant.suspend` zapise,
koji se upisuju sa `zevId` ciljanog tenanta i **već sad** stoje u njegovom tragu kao
neidentifikovan akter.)

### 3.2 Treba li vidjeti da platformski admin ima članstvo? Da.

Preporuka je da se to ne skriva, nego naglasi. ZEV je pravno lice čiji je predsjednik
odgovoran za njegovu evidenciju; "neko izvan zajednice ima predsjedničko ovlašćenje" je
podatak koji predsjednik ima pravo da vidi. Praktično se to i ne može sakriti — članstvo
ionako izlazi u `getTenant()`, u revizorskom tragu, i (ako bi dobio `Party`) na `/vlasnici`.

### 3.3 Odvojena rola? Ne u v1 — oznaka umjesto nove `Role` vrijednosti

Dodavanje četvrte vrijednosti u `Role` enum (npr. `PLATFORM_ADMIN`) izgleda čistije, ali
cijena je nesrazmjerna: migracija enum-a, pa svaki `requireRole(...)` poziv, svaka
`ROLE_LABELS` mapa (`admin/[zevId]/page.tsx:15`, `vlasnici/[id]/page.tsx:13`),
`ALL_ROLES` checkbox lista, `updateUserRoles`, `assertNotLastActivePresident`, `NAV` filter u
`(app)/layout.tsx`, `tests/*` fixture, plus buduće `requireFeature` mapiranje iz Faze 2.

**Ista korist se dobija iz podatka koji već postoji:** `User.isSuperAdmin` je na `User` redu,
pa svaka lista članstava može da renderuje značku "Platformski admin" pored takvog člana.
Konkretno:

- `/admin/[zevId]` kartica "Nalozi u ovom ZEV-u" već uključuje `m.user` — jedna linija
  rendera.
- `/vlasnici` bi tražilo da se `isSuperAdmin` doda u `select` unutar `listParties()`
  (`ownership.ts`) — ali po §4 platformski admin **neće** imati `Party`, pa se tamo ni ne
  pojavljuje.

Uz to, razlikovanje u tragu ide kroz **audit akciju**, ne kroz rolu:
`admin.membership.grant_self` vs `admin.membership.grant`.

### 3.4 Opoziv je obavezan dio, ne dodatak

Bez `revokeMembership` super admin trajno akumulira predsjednička ovlašćenja u svakom
tenantu koji je ikad dotakao. Preporuka: na `/admin/[zevId]`, pored svakog članstva, akcija
"Ukloni pristup" sa obaveznim razlogom (isti obrazac kao `setTenantActive`, koji već traži
`reason`). Kad se ukloni sopstveno članstvo, `resolveActiveZev` (linija 89: *"if ... no longer
among the user's memberships"*) automatski prebacuje sesiju na drugo članstvo ili na `null` —
izbacivanje radi samo od sebe, bez posebnog koraka.

### 3.5 Posljedica koju treba svjesno prihvatiti

`assertNotLastActivePresident` broji **sve** aktivne PRESIDENT `Membership` redove u tenantu.
Super admin sa PRESIDENT članstvom se tu broji. Posljedica: tenant može ostati u stanju gdje
je jedini predsjednik platformski admin (npr. predsjednik zajednice deaktiviran, a admin
zaboravio da opozove svoje članstvo). To je istovremeno i poželjno (to je izlaz iz slijepe
ulice) i nešto što treba nadgledati. Preporuka: na `/admin/[zevId]` prikazati upozorenje kad
tenant nema nijednog aktivnog PRESIDENT-a koji **nije** platformski admin.

---

## 4. P3 — Treba li administrativnom nalogu `Party` red?

### 4.1 Šta stvarno puca bez `Party`-ja — provjereno, ne pretpostavljeno

**Ne puca ništa u prijavi ni u upravljačkim stranicama.** Provjereno kroz sve pozivaoce
`actor.partyId`:

- `getAuthContext()` ima fallback na e-mail za `displayName` (`session.ts:123-127`).
- `payments.ts:774`, `billing.ts:390`, `maintenance.ts:17` koriste `actor.partyId ?? "__none__"`.
- `ownership.ts:465`, `maintenance.ts:65` bacaju jasan `ForbiddenError("Nalog nije povezan sa
  licem.")`.
- `podesavanja/page.tsx:101-102` uslovljava sa `actor.partyId ? ... : null`.
- `(app)/page.tsx:143-145` — `OwnerDashboard` ispisuje razumljivu poruku umjesto pada.

**Ali tri stvari se degradiraju:**

1. **Nalog postaje nevidljiv i neupravljiv unutar samog tenanta.** Jedini UI tenanta za
   administraciju naloga je kartica "Korisnički nalog" na `/vlasnici/[id]`
   (`vlasnici/[id]/page.tsx:304-345`) — dostupna isključivo kroz `Party`. Uz to
   `assertUserInZev()` (`users.ts:196-202`) odbija svakog korisnika bez `party` ili sa
   `party.zevId !== zevId`, pa `updateUserRoles`/`deactivateUser`/`activateUser` bacaju
   *"Korisnik nije pronađen u ovom ZEV-u."*. Predsjednik zajednice **ne može** takvom nalogu
   ni promijeniti role ni deaktivirati ga.
2. **Organi ZEV-a ne rade.** `OfficeTerm` (mandat predsjednika/članova odbora) se unosi
   biranjem iz `listParties()` (`organi/page.tsx:127-128, 166-167`). Predsjednik bez `Party`
   reda **ne može se upisati u registar organa** — a to je pravna evidencija, ne udobnost.
3. Revizorski trag je uredu — razrješava se preko `Membership`, ne preko `Party`.

**Cijena `Party`-ja:** `listParties()` (`ownership.ts`) vraća sve aktivne stranke i puni
padajuće liste "Vlasnik", "Lice", "Davalac/Punomoćnik" na `/vlasnici` i `/organi`. Vanjski
knjigovođa bez ijednog vlasničkog udjela pojavljuje se kao izbor u formi za promjenu
vlasništva. To je rizik pogrešnog odabira, ne integritetski bag — i **već postoji danas**:
`createTenant()` i seed već prave `Party` za predsjednika i knjigovođu.

### 4.2 Odluka

- **Nov administrativni nalog (novo lice) → `Party` je OBAVEZAN.** Isto što `createTenant()`
  već radi za prvog predsjednika. Forma traži ime/prezime (ili naziv), e-mail, telefon; jedna
  transakcija pravi `Party` + `User` + `Membership`. Time nalog ostaje vidljiv i upravljiv
  tenantu (tačka 1 gore) i može u registar organa (tačka 2).
- **Sopstveno članstvo super admina → `Party` se NE pravi.** Platformski admin nije lice u
  poslovnoj evidenciji te zajednice: nikad neće biti ni vlasnik ni član organa, a sjenka-`Party`
  bi zagadila tačno one padajuće liste iz §4.1. Prihvaćena posljedica: predsjednik tenanta ne
  može tim nalogom upravljati sa `/vlasnici` (što je i ispravno — ne treba da može da
  deaktivira platformskog admina), i dobija čistu, već postojeću poruku *"Korisnik nije
  pronađen u ovom ZEV-u."*. Opoziv se radi iz `/admin` (§3.4).
- **Postojeći korisnik koji se dodaje u drugi tenant → `Party` NIJE moguć.** Nije odluka nego
  ograničenje: `User.partyId` je `@unique` (`schema.prisma:39`). Korisnik koji već ima `Party`
  bilo gdje **ne može** dobiti drugi. Vidi §5.3 i §8.

---

## 5. P4 — Gdje živi "dodaj nalog u postojeći ZEV" i šta ponovo koristi

### 5.1 Nova funkcija u `admin.ts`, ne proširenje `createUserForParty`

Preporuka: nove funkcije u `src/server/services/admin.ts`, guarded sa `requireSuperAdmin` (bez
`requireZev`), po obrascu koji `setTenantActive` već koristi — `zevId` dolazi kao **argument**,
ne iz aktora.

```
createTenantAccount(actor, zevId, { role, firstName, lastName, orgName?, email, phone?, password })
grantMembership(actor, zevId, { email, role, reason })     // postojeći korisnik, uklj. samog sebe
revokeMembership(actor, zevId, { userId, role, reason })
```

Zašto ne proširiti `createUserForParty`:

- Ta funkcija je gated sa `requireRole(actor, "PRESIDENT")` **i** `requireZev(actor)`
  (`users.ts:62-63`). To je upravo guard koji sprečava predsjednika ZEV-a A da pravi naloge u
  ZEV-u B. Dodavanje `zevId` parametra ili opuštanje bilo kojeg od ta dva guard-a na funkciji
  koju koristi tenant self-service put je najrizičnija pojedinačna izmjena moguća u ovoj bazi
  koda. Header `admin.ts`-a to i propisuje: cross-tenant funkcije žive tu, iza
  `requireSuperAdmin`, i nigdje drugdje.
- Ulazi se ionako razlikuju: `createUserForParty` traži **postojeći** `partyId`; admin tok
  `Party` tek pravi.
- Zajednička logika je mala: `hashPassword` je jedan poziv, upis `Membership`-a tri linije.
  Nedovoljno za apstrakciju; duplikacija je ovdje jeftinija i sigurnija.

### 5.2 Koje role se mogu dodijeliti: PRESIDENT i ACCOUNTANT — ne OWNER

OWNER nalog bez vlasničkog udjela nema smisla, a udjeli se unose kroz `addOwnershipStake`, koje
**obavezno** traži dokaz o vlasništvu kao fajl (`vlasnici/page.tsx:48`, `:180-182`). Kad bi
super admin pravio "vlasnike" iz platformske konzole, zaobišao bi taj dokazni zahtjev. Ako mu
treba vlasnik — prebaci se u tenant (P1/P2) i koristi `/vlasnici`, gdje pravila važe.
*(Ovo je i pitanje za tebe — §9, P1.)*

### 5.3 Dodavanje POSTOJEĆEG korisnika: da, podržati

Slučaj "knjigovodstvena firma opslužuje više ZEV-ova" je jedna od osnivačkih odluka
multitenancy plana (§3, tabela: *"tako da jedan korisnik ... može imati različitu ulogu u više
ZEV-ova"*), a danas za njega ne postoji **nijedan** put. Forma na `/admin/[zevId]` ima dva
načina rada:

- unese se e-mail; ako `User` postoji → `grantMembership` (nov `Membership` red, bez novog
  `User`-a i bez `Party`-ja);
- ako ne postoji → forma se proširi na ime/prezime/lozinku i ide `createTenantAccount`.

Guard: postojeće `(userId, zevId, role)` članstvo → čitljiva greška, ne sirovi Prisma unique
violation.

Ograničenje koje uz ovo ide (iz §4.2): takav nalog u drugom tenantu nema `Party`, pa
**ne može biti upisan u organe tog ZEV-a** i **ne može se administrirati sa `/vlasnici`**.
Preporuka je da se to prihvati u v1 i dokumentuje, a ne da se blokira funkcionalnost. Trajno
rješenje je okretanje veze (`Party.userId` umjesto `User.partyId`, jedan korisnik → više
`Party` redova, po jedan po tenantu) — izmjena šeme, izričito van obima ovog plana.

### 5.4 UI

Sve na `src/app/admin/[zevId]/page.tsx`, uz postojeću karticu "Suspenzija":

- **Kartica "Nalozi u ovom ZEV-u"** (postoji) se dopunjuje: značka "Platformski admin" za
  `m.user.isSuperAdmin`, kolona sa akcijom "Ukloni pristup" (razlog obavezan), i upozorenje iz
  §3.5.
- **Nova kartica "Dodaj nalog"** — rola (PRESIDENT/ACCOUNTANT), e-mail, ime/prezime, telefon,
  početna lozinka (§6).
- **Nova kartica / akcija "Moj pristup"** — "Dodaj mi pristup ovom ZEV-u" (rola + razlog) kad
  članstvo ne postoji; "Uđi u ovaj ZEV" + "Ukloni moj pristup" kad postoji.

Jedna sitna popravka koju treba uzeti usput: `setTenantActive` bi trebalo da odbije (ili prvo
očisti sopstveni `activeZevId`) kad super admin suspenduje tenant **u kojem trenutno radi** —
inače ga sljedeći zahtjev odjavljuje kroz `requireActor()` → `destroySession()`.

---

## 6. P5 — Lozinka

### 6.1 Direktan unos lozinke, u oba toka

Preporuka: i nova `createTenantAccount` i **postojeći `createTenant`** uzimaju lozinku koju
super admin upiše. Za `createTenant` to je popravka baga iz §1.3 u korijenu, ne zaobilaženje:

- uklanja zavisnost onboardinga od mail provajdera kojeg aplikacija nema;
- uklanja TTL od 1 sata iz toka koji je u praksi "kreiraj danas, javi predsjedniku sutra";
- uklanja `passwordResetTokenHash` upis iz `createTenant` (linije 167-174).

Poruka dobrodošlice (`queueNotification`, template `tenant-welcome`) **ostaje** — ona je zapis
u evidenciji tenanta da je nalog otvoren — ali joj se tijelo mijenja: bez tokena, sa uputom da
je početnu lozinku postavio administrator platforme i da se mijenja kroz
`/zaboravljena-lozinka`.

### 6.2 Validacija — jedno mjesto, prag ostaje 8

Danas: `resetPassword` ima `newPassword.length < 8` (`users.ts:171`), a `createUserForParty`
**nema nikakvu provjeru** — predsjednik danas može postaviti jednoznakovnu lozinku. To je mala
postojeća rupa koju treba zatvoriti usput.

Preporuka: `assertPasswordStrong(password)` u `src/server/auth/password.ts` (fajl je danas dvije
funkcije), pa ga zovu `resetPassword`, `createUserForParty`, `createTenant` i
`createTenantAccount`. Prag ostaje 8 znakova u ovom prolazu — pooštravanje mijenja ponašanje
postojećih tokova i zaslužuje zasebnu odluku (§9, P4).

### 6.3 Generisanje lozinke u UI — da, u pretraživaču

Nova klijentska komponenta `src/components/password-field.tsx`: `type="text"` input (da se
lozinka može pročitati i prepisati — isto kao postojeće polje "Početna lozinka"), dugme
"Generiši" (`crypto.getRandomValues`) i "Kopiraj". Koristi je i `/admin` forma za nov tenant, i
`/admin/[zevId]` forma za nov nalog, i `/vlasnici` (zamjena sirovog input-a — dobija se
generator besplatno).

Zašto u pretraživaču a ne na serveru: server-side generisana lozinka mora nekako da se **vrati
i prikaže** — kroz redirect URL ili render stranice, oboje sa realnim rizikom da završi u
logovima ili istoriji pretraživača. Generisanje u pretraživaču i slanje kroz isti POST nije
gore od onoga što forma već radi danas.

Ni u jednom slučaju lozinka ne smije ući u `audit()` payload — `src/server/audit.ts:20` to
izričito zabranjuje.

### 6.4 Obavezna promjena pri prvoj prijavi — van v1, svjesno

Argument za: super admin poslije ovoga zna radnu lozinku predsjedničkog naloga, neograničeno
i bez ijednog signala. U sistemu čiji revizorski trag pripisuje pravno značajne radnje (npr.
evidentiranje glasova) konkretnom korisniku, "samo predsjednik zna svoj kredencijal" nije
sitnica.

Cijena: kolona `User.mustChangePassword`, nova ruta `/promjena-lozinke`, i presretanje u
`requireActor()` — plus u `requireSuperAdminActor()` i u šest API ruta koje aktora sastavljaju
ručno — sa izuzetkom za samu tu stranicu, inače petlja preusmjeravanja. Obrazac postoji
(`zevSuspended` provjera u `src/server/actor.ts:14-17` je bukvalno taj oblik), ali je to
zasebna faza.

**Preporuka: v1 bez toga, sa jasno navedenim kompromisom** (gore), i sa jeftinom djelimičnom
mjerom: `audit()` zapis `admin.account.create` sa e-mailom i rolom (nikad lozinkom) upisan u
`zevId` tog tenanta, tako da je bar **činjenica** da je platformski admin otvorio nalog trajno
u evidenciji zajednice.

---

## 7. Fazni plan

Numeracija se nastavlja na `docs/multitenancy-plan.md` §"Faza 3 — dovršavanje" (čija je
stavka 1 upravo ovo), a ne kao nova šema. Redoslijed je takav da **Korak 1 sam po sebi
odblokira korisnika** (moći će ručno da se prijavi kao predsjednik novog tenanta), prije nego
što koraci 2-3 stignu.

### Korak 1 — Lozinka: temelj + popravka `createTenant` *(bez novih koncepata)*

| Fajl | Izmjena |
|---|---|
| `src/server/auth/password.ts` | nova `assertPasswordStrong()` |
| `src/server/services/users.ts` | poziv u `resetPassword` i `createUserForParty` |
| `src/server/services/admin.ts` | `createTenant` prima `presidentPassword`; briše token upis; novo tijelo `tenant-welcome` poruke |
| `src/app/admin/page.tsx` | polje za lozinku u formi za nov ZEV |
| `src/components/password-field.tsx` | **nov** klijentski `PasswordField` |
| `src/app/(app)/vlasnici/page.tsx` | zamjena sirovog `accountPassword` input-a `PasswordField`-om |
| `src/lib/i18n/sr-Latn.ts`, `en.ts` | ključevi za nove poruke |

**Testovi:** `tests/admin.test.ts` — **novi fajl, danas ne postoji nijedan test za `admin.ts`**
(grep: nula pogodaka za `createTenant`/`setTenantActive`/`listTenants` u `tests/`). Pokriva:
`createTenant` pravi `Zev` + `Party` + `User` + `Membership` + settings; postavljena lozinka
stvarno prolazi kroz `authenticate()`; slaba lozinka odbijena; duplirani e-mail odbijen;
poziv sa ne-super-admin aktorom odbijen.

Bez migracije. Verzija: prijedlog **2.3.0** (minor) — na potvrdu.

### Korak 2 — Prebacivanje aktivnog ZEV-a

| Fajl | Izmjena |
|---|---|
| `src/server/auth/session.ts` | `setSessionActiveZev()`; ispravka doc komentara na `resolveActiveZev` |
| `src/server/auth/guards.ts` | `Actor.sessionId?: string` |
| `src/server/actor.ts` | `sessionId` u sve tri funkcije (`requireActor`, `requireSuperAdminActor`, `maybeActor`) |
| `src/server/services/memberships.ts` | **nov** — `listMyTenants`, `switchActiveZev` |
| `src/app/(app)/layout.tsx` | učitava tenante, prosljeđuje props + server akciju u `NavShell` |
| `src/components/nav-shell.tsx` | sekcija prekidača u korisničkom meniju + chip aktivnog ZEV-a |
| `src/app/admin/[zevId]/page.tsx` | akcija "Uđi u ovaj ZEV" (kad članstvo postoji) |
| `src/app/admin/page.tsx` | link "Uđi" u redu tabele |
| `src/lib/i18n/*` | novi `tenant.*` ključevi |

**Testovi:** nova sekcija u `tests/tenant-isolation.test.ts` — ovo je jedini kod u aplikaciji
koji legitimno mijenja `actor.zevId`, pa mu tamo i jeste mjesto:
korisnik tenanta A ne može da se prebaci u B; prebacivanje u suspendovan tenant odbijeno;
prebacivanje sa validnim članstvom mijenja `Session.activeZevId` i daje **role tenanta B**, ne
A; super admin bez članstva odbijen.
`tests/helpers.ts` dobija `createSuperAdmin()` i pomoćnik za drugo članstvo.

Bez migracije — `Session.activeZevId` i `@@index([activeZevId])` postoje od Faze 0.
Verzija: prijedlog **2.4.0**.

### Korak 3 — Cross-tenant administracija naloga

| Fajl | Izmjena |
|---|---|
| `src/server/services/admin.ts` | `createTenantAccount`, `grantMembership`, `revokeMembership`; provjera "suspenduješ ZEV u kojem si" u `setTenantActive` |
| `src/server/services/users.ts` | export (ili `zevId`-parametrizovan blizanac) `assertNotLastActivePresident` — da se brojanje ne piše dvaput |
| `src/app/admin/[zevId]/page.tsx` | kartica "Nalozi" (značke, opoziv, upozorenje §3.5) + kartica "Dodaj nalog" + kartica "Moj pristup" |
| `src/lib/i18n/*` | ključevi |

**Testovi:** `tests/admin.test.ts` raste — dodjela/opoziv članstva; čuvanje posljednjeg
aktivnog predsjednika; duplirano članstvo; dodavanje **postojećeg** korisnika u drugi tenant
(i provjera da se `Party` NE pravi); `createTenantAccount` pravi `Party`+`User`+`Membership`;
i negativni slučaj — PRESIDENT aktor odbijen na svakoj od ovih funkcija.

Bez migracije. **Indeksi:** nisu potrebni — `listMyTenants` filtrira po `userId`, što je vodeća
kolona postojećeg `@@unique([userId, zevId, role])`; `Membership` već ima i `@@index([zevId])`.
Verzija: prijedlog **2.5.0**.

### Korak 4 — odloženo, po tvojoj odluci

`User.mustChangePassword` + `/promjena-lozinke` + presretanje u `requireActor` (§6.4);
`User.lastActiveZevId` (§2.4); ekran za izbor ZEV-a nakon prijave, ako se pokaže potreba.

### Uz svaki korak (pravila projekta)

- Unos u `CHANGELOG.md` + **potvrđen** skok verzije (nikad jednostrano).
- `typecheck && lint && test && build` + živa Playwright provjera — sva tri koraka su vizuelna.
- Ažurirati `docs/multitenancy-plan.md` §"Faza 3" da odražava šta je stvarno urađeno.

**Napomena o i18n:** `/admin` stranice danas **ne** koriste `t()` — sve je hardkodirano
srpski ("ZEV nalozi", "Suspenzija", `TIER_LABELS`, `ROLE_LABELS`). To je odstupanje od pravila
projekta koje je nastalo prije ovog plana. Preporuka: **novi** stringovi (i u `/admin` i u
`NavShell`) idu kroz `t()` uz nove grupe `admin.*` i `tenant.*` u oba rječnika; postojeći
hardkodirani stringovi se ne diraju u ovom prolazu. Migracija zatečenih `/admin` stringova je
zaseban, mehanički zadatak — vrijedi ga zapisati kao dug, ne raditi ga usput.

---

## 8. Rizici i posljedice koje treba svjesno prihvatiti

1. **`User.partyId @unique`** — korisnik u dva tenanta ima `Party` u najviše jednom. U drugom:
   nevidljiv na `/vlasnici`, neupravljiv od strane tog predsjednika, ne može u organe. Zaobići
   se ne može bez izmjene šeme (§5.3).
2. **Super admin sa PRESIDENT članstvom se broji u `assertNotLastActivePresident`** (§3.5).
3. **Bez obavezne promjene lozinke, super admin trajno zna kredencijal predsjednika** (§6.4).
4. **Prekidač tenanta = nova klasa korisničkih grešaka** (unos u pogrešan ZEV). Ublaženo
   chip-om aktivnog ZEV-a (§2.3b); vrijedno je da Playwright provjera to izričito pokrije.
5. **Suspendovanje tenanta u kojem si aktivan te odjavljuje** — postojeće ponašanje, novo
   dostižno; popravka u Koraku 3 (§5.4).
6. **`admin.ts` raste u površini napada.** Svaka nova funkcija tamo je cross-tenant po
   definiciji. Zato je u Koraku 3 negativni test ("PRESIDENT aktor odbijen na svakoj") obavezan
   dio, ne dodatak.

---

## 9. Pitanja za tebe

- **P1 — Role kroz `/admin`:** slažeš li se da super admin može dodijeliti samo
  PRESIDENT/ACCOUNTANT, a OWNER isključivo kroz `/vlasnici` unutar tenanta (zbog obaveznog
  dokaza o vlasništvu, §5.2)?
- **P2 — Sopstveno članstvo:** je li prihvatljivo da predsjednik zajednice vidi tvoj e-mail kao
  člana sa rolom Predsjednik (u `/admin` listi i u revizorskom tragu), ili želiš da se to
  posebno označi/sakrije? Preporuka je puna vidljivost sa značkom "Platformski admin" (§3.2/3.3).
- **P3 — Obavezna promjena lozinke pri prvoj prijavi:** v1 bez toga (Korak 4), ili odmah u
  Koraku 1? Kompromis je opisan u §6.4.
- **P4 — Prag jačine lozinke:** ostaje 8 znakova (isto kao danas u `resetPassword`), ili se
  pooštrava (npr. 10 + mješavina znakova)? Pooštravanje mijenja i postojeći tok resetovanja.
- **P5 — Redoslijed:** je li Korak 1 (lozinka) prioritet da te odblokira odmah, prije Koraka 2
  (prebacivanje)? Plan je tako složen, ali ako ti prebacivanje treba prvo, koraci 1 i 2 su
  nezavisni i mogu zamijeniti mjesta.
- **P6 — Verzije:** prijedlog 2.3.0 / 2.4.0 / 2.5.0 (po jedan minor po koraku), ili sve tri kao
  jedan zaokružen poduhvat sa jednim skokom?

---

### Ključni fajlovi za implementaciju

- `src/server/services/admin.ts`
- `src/server/auth/session.ts`
- `src/server/auth/guards.ts`
- `src/server/actor.ts`
- `src/server/services/users.ts`
- `src/app/admin/[zevId]/page.tsx`
- `src/app/admin/page.tsx`
- `src/components/nav-shell.tsx`
- `src/app/(app)/layout.tsx`
- `prisma/schema.prisma` (referenca — `User`, `Session`, `Membership`)
- `docs/multitenancy-plan.md` (§"Faza 3 — dovršavanje", na koju se ovaj plan nastavlja)
