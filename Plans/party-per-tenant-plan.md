# `Party` po tenantu — okretanje veze `User`↔`Party` i zatvaranje curenja `partyId` između ZEV-ova — plan za pregled

**Status: PLAN, implementacija nije počela.** Nastalo nakon što je u ovoj sesiji
dijagnostikovan i korisniku prijavljen konkretan bag: `getAuthContext()` razrješava `roles`
po aktivnom ZEV-u, a `partyId` globalno — pa korisnik sa članstvima u dva ZEV-a nakon
prebacivanja vidi podatke pogrešne zajednice. Korisnik je izabrao **potpunu ispravku**
(okretanje veze u šemi), ne usku zakrpu u `session.ts`.

**Odnos prema `Plans/owner-cross-tenant-party-user-plan.md`:** taj dokument (10.09.2026)
predlaže istu izmjenu šeme, ali iz ugla *funkcionalnosti* („vlasnik sa stanom u dvije
zajednice"), i nikad nije implementiran. Ovaj plan ga **zamjenjuje**, iz tri razloga:

1. Motiv je drugi i mijenja prioritet — ovo više nije željena funkcionalnost nego
   **ispravka koja pogrešne podatke prikazuje pod tuđim tenantom**, sa jednim mjestom
   (`reportIssue`) koje i **upisuje** red sa cross-tenant referencom (§1.3).
2. Kod se u međuvremenu pomjerio: `Plans/tenant-switching-admin-accounts-plan.md` je
   **isporučen** (postoje `switchActiveZev`, `setSessionActiveZev`, `createTenantAccount`,
   `grantMembership`, `revokeMembership`), pa je uslov iz njegovog §6.1 („prvo prekidač,
   pa okretanje veze") već ispunjen — i, što je važnije, prekidač je ono što bag čini
   **dostižnim u praksi**, a ne teorijskim.
3. Njegova odluka o migraciji (§2.2: *„Treba li prelazni period sa obje kolone? Ne."*)
   **više nije tačna**. Obrazloženje je bilo *„aplikacija se isporučuje kao jedan kontejner
   koji na startu radi migraciju pa `npm start` — nema rolling deploy-a sa dvije verzije
   koda nad istom bazom."* Produkcija je danas **Vercel + Neon**, gdje migracija ide
   **ručno, prije** push-a, a stari deployment nastavlja da opslužuje saobraćaj dok se novi
   ne promoviše. To je bukvalno „dvije verzije koda nad istom bazom" — vidi §3.2.

Preostale odluke iz tog dokumenta koje ovaj plan preuzima nepromijenjene su izričito
označene (§2.1, §4.2, §5.1).

---

## 0. Rezime — pročitati prije ostatka

Pet nalaza iz čitanja koda koji određuju cijeli plan:

1. **Bag je u jednoj liniji, ali uzrok je u šemi.** `getAuthContext()` vraća
   `partyId: u.partyId` (`src/server/auth/session.ts:138`) — globalnu kolonu `User.partyId`,
   koja je `@unique` (`prisma/schema.prisma:39`). `roles` iz iste funkcije su ispravno
   skopirani po aktivnom ZEV-u (`resolveActiveZev`, `:84-99`). Dakle jedan aktor nosi
   **dvije vrijednosti razriješene po dva različita pravila**, i to se vidi tek kad neko
   stvarno pređe iz ZEV-a u ZEV — što je moguće tek od isporuke prekidača tenanta.
2. **Posljedica nije jedna.** Tri različite klase, ne jedna (§1.2/§1.3): prikaz tuđih
   podataka (`OwnerDashboard`), **upis reda sa referencom na `Party` iz drugog ZEV-a**
   (`reportIssue`), i tiho „prazno stanje" na svim ostalim mjestima. Samo prva je
   očigledna; druga je trajna i ostaje u bazi.
3. **Površina izmjene je mala, i to je glavni argument da se uradi sada.** Čitalaca
   `actor.partyId` ima ~40, i **nijedan se ne mijenja** — svi ga već tretiraju kao „moj
   party, sada", što post-ispravkom postaje istina. Stvarno se mijenja **šest** mjesta
   koja čitaju relaciju `User.party` ili upisuju `User.partyId` (§6, Grupa G/I).
4. **Obrazac razrješenja već postoji.** `roles` = „filtriraj učitanu kolekciju po
   razriješenom `zevId`". `partyId` se računa **istom rečenicom** nad `parties`. Ovo je
   konceptualno *manja* izmjena od one koju je Faza 0 već uradila za `roles`.
5. **Postojeći podaci su čisti 1:1.** `User.partyId` je `@unique` i FK; svaki `Party` koji
   danas ima `User` ima ga tačno jednog. `UPDATE ... FROM` prenosi vezu bez gubitka i bez
   ijednog sirotog reda.

Odluka koju plan brani na svakom mjestu gdje se pojavi izbor:

> **`Party.userId` (nullable) + `@@unique([userId, zevId])`. `AuthContext.partyId` mijenja
> *značenje* (party u aktivnom ZEV-u), ne *oblik* — nijedan `Actor` ne dobija novo polje.
> Migracija ide u **dva koraka**, sa prelaznim periodom u kojem obje kolone postoje i
> obje se upisuju, jer Vercel/Neon raspored deploya to zahtijeva. `grantMembership` se u
> ovom planu **ne mijenja** — ispravka curenja ne smije da nosi novu funkcionalnost.**

---

## 1. Bag — dokazi iz koda

### 1.1 Tačan mehanizam

```ts
// src/server/auth/session.ts:129-138
const { zevId, roles } = await resolveActiveZev(session.id, session.activeZevId, u.memberships);
// ...
return {
  userId: u.id,
  roles,                 // <- po aktivnom ZEV-u (Membership filtriran po zevId)
  partyId: u.partyId,    // <- GLOBALNO, kolona na User redu
  ...
```

`resolveActiveZev` (`:84-99`) radi tačno ono što treba: uzme `memberships`, izabere/potvrdi
`zevId`, pa `roles` izvede kao `memberships.filter((m) => m.zevId === zevId)`. Dvije linije
niže `partyId` preskoči tu istu logiku jer je nema gdje da primijeni — `User` ima **najviše
jedan** `Party` (`prisma/schema.prisma:38-39`, `partyId String? @unique`), pa nema šta da se
filtrira.

Put kojim se do baga stiže postoji od isporuke prekidača:
`switchActiveZev` (`src/server/services/memberships.ts:52`) → `setSessionActiveZev`
(`session.ts:158`) → sljedeći `getAuthContext()` vrati **nove `roles`** i **stari `partyId`**.

### 1.2 Šta se vidi — `OwnerDashboard`

`src/app/(app)/page.tsx:142-166`. Četiri upita namjerno **nemaju** `zevId` filter, uz
komentar koji objašnjava zašto je to bilo bezbjedno (`:152-155`):

> *„filtered by partyId, which is itself tenant-unique (a Party belongs to exactly one Zev),
> so they can't cross tenants even without an explicit zevId"*

Rečenica je i dalje tačna **o `Party`-ju**, ali netačna o `actor.partyId`: tenant-unique
vrijednost je ubačena u kontekst drugog tenanta. Konkretno, korisnik sa `Party`-jem u ZEV-u A
koji je prebačen u ZEV B vidi, pod zaglavljem ZEV-a B:

| Upit (`page.tsx`) | Prikazuje |
|---|---|
| `:157` `invoice.findMany({ debtorId: partyId, status: "ISSUED" })` | **neplaćene fakture iz ZEV-a A** |
| `:158` `payment.findMany({ payerId: partyId })` | **uplate iz ZEV-a A** |
| `:159-162` `eligibleVoter.findMany({ OR: [{ownerId}, {proxyId}] })` | **otvorena glasanja iz ZEV-a A** |
| `:165` `maintenanceIssue.findMany({ reporterId: partyId })` | **prijave kvarova iz ZEV-a A** |
| `:148-151` `ownerBalance`/`ownerAdvance` | nule (te funkcije **jesu** `zevId`-skopirane) |

Dakle i najgori mogući spoj: saldo iz ZEV-a B (nula) prikazan **pored** faktura iz ZEV-a A.

### 1.3 Šta se upisuje — `reportIssue` (najozbiljniji pojedinačni nalaz)

```ts
// src/server/services/maintenance.ts:63-79
const zevId = requireZev(actor);
if (!actor.partyId) throw new ForbiddenError("Nalog nije povezan sa licem.");
// ... building/entrance/unit se PROVJERAVAJU po zevId ...
const issue = await prisma.maintenanceIssue.create({
  data: { ...data, zevId, reporterId: actor.partyId, ... }
});
```

`reporterId` je jedino polje koje se **ne** provjerava po `zevId` (jer je do sada bilo
nemoguće da bude tuđe). Rezultat: `MaintenanceIssue` sa `zevId = B` i `reporterId` koji
pokazuje na `Party` iz ZEV-a A. FK ka `Party(id)` prolazi, nijedan guard ne puca. Red ostaje
u bazi trajno, i predsjedniku ZEV-a B na `/odrzavanje` prikazuje ime lica koje u njegovoj
evidenciji ne postoji (`include: { reporter: true }`, `maintenance.ts:20`).

**Ovo je jedina posljedica koju ispravka `session.ts`-a ne poništava unazad** — postojeći
takvi redovi (ako ih ima) moraju se pronaći i riješiti zasebno; vidi §8, rizik 6.

### 1.4 Šta se, provjereno, NE dešava

Vrijedi izgovoriti naglas da se obim ne naduva: **ne postoji put kojim korisnik vidi podatke
drugog *korisnika*.** Svako mjesto koje prima `partyId` kao parametar prolazi kroz
`requireSelfOrRole` (`guards.ts:100-109`) **pa** kroz upit skopiran sa `zevId`
(`getParty`, `updateParty`, `revokeEVoteConsent`, `ownerBalance`, `generateOwnerStatementPdf`).
Zastarjeli `actor.partyId` tu vodi u `findUniqueOrThrow` koji baca, ili u prazan rezultat —
restriktivno, ne permisivno. Curi isključivo **sopstveni podatak iz pogrešnog tenanta**
(§1.2) plus jedan pokvaren upis (§1.3).

---

## 2. Šema

### 2.1 Opcije

| # | Oblik | Trade-off | |
|---|---|---|---|
| a | `Party.userId String? @unique` | Ogledalo istog ograničenja: jedan `User` → jedan `Party`, samo sa druge strane. Ne rješava ništa, a košta migraciju. | ✗ |
| b | **`Party.userId String?` + `@@unique([userId, zevId])`** | Jedan `Party` po korisniku **po ZEV-u**, proizvoljno mnogo ZEV-ova. Baza garantuje determinizam koji `getAuthContext` traži. Isti obrazac koji `Membership` već koristi (`schema.prisma:243`). | **✓** |
| c | `Party.userId String?` bez ijednog unique | Dozvoljava dva `Party` reda istog korisnika u istom ZEV-u → `getAuthContext` bira „prvi i nada se". Nedeterministički `partyId` je gori bag od onog koji se ispravlja. | ✗ |
| d | Spojna tabela `UserParty(userId, zevId, partyId)` | Treći izvor istine pored `Party.zevId` i `Membership`; mogućnost razilaženja (party u tabeli sa jednim `zevId`, a `Party.zevId` drugi). Nula dodatne izražajnosti u odnosu na (b). | ✗ |
| e | `Session.activePartyId` (izbor lica unutar ZEV-a) | Rješava drugi problem (isti čovjek kao fizičko lice **i** kao firma u istom ZEV-u), ne ovaj. Veća izmjena, zaseban poduhvat — vidi §9, P2. | ✗ |

### 2.2 Konačan oblik (poslije Koraka 2)

```prisma
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  roles        Role[]        // legacy, nepromijenjeno
  isSuperAdmin Boolean   @default(false)
  active       Boolean   @default(true)
  deactivatedAt DateTime?
  passwordResetTokenHash String?
  passwordResetExpiresAt DateTime?
  /// Po jedan Party po ZEV-u u kojem ovaj nalog ima lice u poslovnoj evidenciji.
  /// Zamjenjuje raniju `party Party? @relation(...)` + `partyId String? @unique`
  /// (Plans/party-per-tenant-plan.md §2).
  parties      Party[]
  sessions     Session[]
  memberships  Membership[]
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}

model Party {
  id     String @id @default(cuid())
  // Party i dalje pripada tačno jednom ZEV-u (docs/multitenancy-plan.md §8.3) —
  // ta invarijanta se NE mijenja; mijenja se samo to da isti korisnik smije imati
  // po jedan takav red u više ZEV-ova.
  zev    Zev    @relation(fields: [zevId], references: [id])
  zevId  String
  ...
  /// Portal nalog ovog lica, ako ga ima. Većina Party redova nema i nikad neće imati
  /// nalog (vlasnik bez e-maila, stanar, punomoćnik) — zato nullable.
  user   User?   @relation(fields: [userId], references: [id])
  userId String?
  ...
  @@unique([userId, zevId])
}
```

Četiri stvari koje treba svjesno primijetiti:

1. **`userId` ostaje nullable i to je suština.** U Postgresu se `NULL` vrijednosti u unique
   indeksu **ne smatraju jednakima** (podrazumijevano `NULLS DISTINCT`), pa jedan ZEV smije
   imati proizvoljno mnogo `Party` redova sa `userId IS NULL`. Ovo je jedina netrivijalna
   SQL činjenica u planu i ide u komentar migracije.
2. **Zaseban `@@index([userId])` nije potreban** — `userId` je vodeća kolona složenog unique
   indeksa, pa ga koriste i `where: { userId, zevId }` i `where: { userId }`. (Isto
   obrazloženje koje je već primijenjeno na `Membership`.)
3. **Referencijalna akcija: `ON DELETE SET NULL ON UPDATE CASCADE`** — identična onoj koju
   veza ima danas (`prisma/migrations/20260823175909_init/migration.sql:1201`). Aplikacija
   `User` ionako nikad ne briše (deaktivira ga), ali brisanje naloga ne smije povući `Party`
   sa svim fakturama, udjelima i glasovima.
4. **Ime relacije `Party.user` se namjerno ZADRŽAVA.** Danas `Party.user`
   (`schema.prisma:94`) znači „`User` čiji `partyId` pokazuje ovdje" i koriste ga
   `listParties` (`ownership.ts:28`), `getParty` (`:43`) i kartica „Korisnički nalog" na
   `/vlasnici/[id]:338-375`. Poslije izmjene isto ime znači „`User` na koji pokazuje moj
   `userId`" — **ista vrijednost, drugi FK**. Zato se nijedan od tih poziva ne mijenja. To
   je korist, ali je i klopka za čitaoca: treba je izričito zapisati u komentar modela.

### 2.3 Prelazni oblik (Korak 1, dok obje kolone postoje)

Dvije relacije između istih modela traže imenovane relacije na **obje** strane. Ako se
imenuju pogrešno, `prisma generate` pada glasno — što je ovdje poželjno.

```prisma
model User {
  /// LEGACY — briše se u Koraku 2. Održava se dvostrukim upisom isključivo da bi
  /// povratak (rollback) na prethodni Vercel deployment ostao ispravan (§3.2).
  /// Nikad se ne ČITA iz aplikacije poslije Koraka 1.
  party        Party?  @relation("LegacyUserParty", fields: [partyId], references: [id])
  partyId      String? @unique
  parties      Party[] @relation("PartyAccount")
}

model Party {
  user        User?   @relation("PartyAccount", fields: [userId], references: [id])
  userId      String?
  /// LEGACY back-reference; postoji samo zato što Prisma traži obje strane. Nikad se ne čita.
  legacyUser  User?   @relation("LegacyUserParty")
  @@unique([userId, zevId])
}
```

**Napomena o alatu (pravilo projekta):** `src/generated/prisma` je komitovan i **ne**
regeneriše ga `docker compose build`. Poslije svake izmjene `schema.prisma` prvo ide
regeneracija kroz jednokratni kontejner, pa tek onda build.

---

## 3. Migracija

### 3.1 Opcije

| # | Pristup | Trade-off | |
|---|---|---|---|
| a | Jedna migracija: dodaj + backfill + **odmah** obriši `User.partyId` | Najčistije stanje na kraju. Ali između trenutka primjene na Neon i promocije novog Vercel deploymenta **stari kod je živ** i njegov Prisma klijent u svaki `SELECT` nad `User` upisuje `"partyId"` eksplicitno → `42703 column does not exist` → **svaki prijavljen zahtjev puca**. Povratak na prethodni deployment je nemoguć. | ✗ |
| b | **Dvije migracije: (1) aditivna + dvostruki upis, (2) brisanje legacy kolone** | Kratak period sa dvije kolone koje se obje održavaju. Zauzvrat: prozor deploya je bezopasan, a povratak na prethodni deployment ostaje ispravan sve dok Korak 2 ne krene. | **✓** |
| c | Aditivna migracija + DB trigger koji sinhronizuje kolone | Uklanja mogućnost razilaženja bez dvostrukog upisa u kodu. Ali trigeri u ovom projektu čuvaju **nepromjenjivost** evidencije (`20260823180200_append_only_guards`), ne poslovna pravila; i trigger bi se ionako morao brisati u Koraku 2. Nesrazmjerno. | ✗ |
| d | Zadržati `User.partyId` zauvijek kao „keš prvog party-ja" | Dvije kolone koje moraju ostati sinhrone bez ijednog razloga da postoje. Garantovano razilaženje čim se pojavi drugi `Party`. | ✗ |

### 3.2 Zašto (b), konkretno

Pravilo projekta (`zev-app-guidelines`, sekcija „Vercel production deployment"):

> *„Migrations go through **before** the corresponding code deploys, never after, and never
> inside Vercel's own build step."*

To znači da između primjene migracije na Neon i promocije novog builda postoji prozor od
nekoliko minuta u kojem **stari kod radi nad novom šemom**. Aditivna promjena je tom kodu
nevidljiva (Prisma nabraja kolone eksplicitno, pa nova kolona nikoga ne dodiruje). Uklonjena
kolona je fatalna. Odatle dvije migracije.

**Jedini izvor razilaženja u tom prozoru:** stari kod, ako u tih nekoliko minuta neko otvori
nalog, upisuje samo `User.partyId` i ostavlja `Party.userId` prazan. Rješenje je u samoj
migraciji 2: **isti backfill se ponavlja idempotentno prije brisanja kolone**, pa je prozor
zatvoren bez ijedne dodatne procedure.

### 3.3 Migracija 1 — `<ts>_party_user_link_add` (aditivna, bezopasna)

Ručno pisan SQL, kao i sve ne-init migracije u ovom projektu (razlog je zapisan u
`20260908120000_drop_zevid_default/migration.sql`: WASM schema-engine ne može da
introspektuje bazu zbog PL/pgSQL trigger funkcija iz `append_only_guards`). Primjenjuje se
sa `node scripts/migrate.mjs apply`, nikad `npx prisma migrate`.

```sql
-- 1. nova kolona, prazna
ALTER TABLE "Party" ADD COLUMN "userId" TEXT;

-- 2. backfill iz postojeće veze (danas garantovano čist 1:1: User.partyId je @unique + FK)
UPDATE "Party" p SET "userId" = u."id" FROM "User" u WHERE u."partyId" = p."id";

-- 3. sanity — nijedan User sa partyId ne smije ostati neprenesen; inače migracija
--    PADA u transakciji i baza ostaje na staroj šemi (isti duh kao "fails loudly
--    instead of silently misattributing" iz 20260908120000_drop_zevid_default)
DO $$
DECLARE missing INT;
BEGIN
  SELECT count(*) INTO missing FROM "User" u
   WHERE u."partyId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Party" p WHERE p."id" = u."partyId" AND p."userId" = u."id");
  IF missing > 0 THEN
    RAISE EXCEPTION 'Backfill nepotpun: % User redova bez prenesene veze', missing;
  END IF;
END $$;

-- 4. ograničenja. NULL vrijednosti se u unique indeksu ne sudaraju (NULLS DISTINCT),
--    pa proizvoljno mnogo Party redova bez naloga ostaje dozvoljeno u istom ZEV-u.
CREATE UNIQUE INDEX "Party_userId_zevId_key" ON "Party"("userId", "zevId");
ALTER TABLE "Party" ADD CONSTRAINT "Party_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "User"."partyId" se NAMJERNO ne dira u ovoj migraciji — vidi <ts>_party_user_link_drop_legacy.
```

**Povratak unazad je bezgubitan i trivijalan:** `DROP INDEX` + `DROP CONSTRAINT` +
`DROP COLUMN "Party"."userId"`, jer je `User.partyId` i dalje jedini izvor istine za stari
kod.

### 3.4 Migracija 2 — `<ts>_party_user_link_drop_legacy` (destruktivna)

```sql
-- 1. ponovi backfill za sve što je stari kod eventualno upisao između migracije 1
--    i promocije novog deploya. Idempotentno; preskače slučaj u kojem bi upis
--    prekršio @@unique([userId, zevId]) (ne može se desiti u Koraku 1, ali se ne
--    oslanjamo na to).
UPDATE "Party" p SET "userId" = u."id" FROM "User" u
 WHERE u."partyId" = p."id"
   AND p."userId" IS DISTINCT FROM u."id"
   AND NOT EXISTS (
     SELECT 1 FROM "Party" q
      WHERE q."userId" = u."id" AND q."zevId" = p."zevId" AND q."id" <> p."id"
   );

-- 2. ista glasna provjera kao u migraciji 1
DO $$
DECLARE missing INT;
BEGIN
  SELECT count(*) INTO missing FROM "User" u
   WHERE u."partyId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Party" p WHERE p."id" = u."partyId" AND p."userId" = u."id");
  IF missing > 0 THEN
    RAISE EXCEPTION 'Zaostalih %: brisanje User.partyId bi izgubilo vezu', missing;
  END IF;
END $$;

-- 3. tek sada stara strana
ALTER TABLE "User" DROP CONSTRAINT "User_partyId_fkey";
DROP INDEX "User_partyId_key";
ALTER TABLE "User" DROP COLUMN "partyId";
```

**Povratak unazad poslije ove migracije je bezgubitan samo dok nijedan korisnik nema više od
jednog `Party`-ja** — a to je tačno stanje neposredno nakon deploya, jer ovaj plan ne
isporučuje nijedan put kojim se drugi `Party` može napraviti (§5.3). To vrijedi zapisati u
komentar migracije kao „izlaz do prve stvarne cross-tenant veze"; poslije toga povratak nije
bezgubitan i ne treba se pretvarati da jeste.

---

## 4. Razrješenje sesije

### 4.1 Opcije

| # | Gdje se računa `partyId` | Trade-off | |
|---|---|---|---|
| a | Zaseban `prisma.party.findFirst({ where: { userId, zevId } })` poslije `resolveActiveZev` | Upit se ne može poslati prije nego što se zna `zevId`, a `zevId` se razrješava tek poslije učitavanja sesije → **dodatni round-trip na svakom zahtjevu** (`getAuthContext` zove `requireActor` sa svake stranice i svake server akcije). | ✗ |
| b | **`include: { parties: { select: ... } }` uz postojeći `memberships`, pa `.find()` po razriješenom `zevId`** | Nula dodatnih upita; simetrično sa `memberships`, koji se već tako učitava. Broj `Party` redova po korisniku je ograničen brojem ZEV-ova (realno 1). | **✓** |
| c | Proširiti `resolveActiveZev` da vraća i `partyId` | Ta funkcija ima jednu odgovornost i jedan **upis** (`session.update`); dodavanje party-ja joj miješa namjenu i otežava test. Izbor party-ja je čist `find`, bez ijednog efekta. | ✗ |

### 4.2 Konkretno

```ts
// src/server/auth/session.ts

// ISPRED: user: { include: { party: true, memberships: true } }
// IZA:
user: {
  include: {
    memberships: true,
    // select suzen na ono što se odavde zaista koristi (id + zevId za izbor,
    // ostalo za displayName) — a ne cijeli Party red sa svim poljima.
    parties: { select: { id: true, zevId: true, kind: true, firstName: true, lastName: true, orgName: true, createdAt: true } },
  },
},
```

```ts
const { zevId, roles } = await resolveActiveZev(session.id, session.activeZevId, u.memberships);

// Party se razrješava istom rečenicom kao roles iznad: filtriraj već učitanu kolekciju
// po aktivnom ZEV-u. @@unique([userId, zevId]) garantuje da find() ne bira između
// više kandidata — najviše jedan red može zadovoljiti uslov.
const activeParty = zevId ? u.parties.find((p) => p.zevId === zevId) ?? null : null;
```

```ts
return {
  ...
  partyId: activeParty?.id ?? null,   // umjesto u.partyId
  ...
};
```

**`displayName` (`:124-128`) dobija treći slučaj** — korisnik ima `Party` redove, ali nijedan
u aktivnom ZEV-u (npr. platformski admin sa članstvom u tenantu B, a licem u tenantu A).
Preporuka: **party aktivnog ZEV-a → najstariji `Party` po `createdAt` → e-mail.** Isti čovjek
u dva ZEV-a nosi isto ime, pa je pad na najstariji praktično uvijek tačan, a `displayName` se
prikazuje **samo samom korisniku** (`nav-shell.tsx`, kroz `requireActor`) — nije podatak koji
može procuriti između tenanta. Alternativa („odmah e-mail") je defanzivnija, ali daje lošije
iskustvo tačno nalozima zbog kojih se plan i radi.

**Doc komentari koji se ažuriraju usput (obavezno, ne kozmetika):**
- `AuthContext.partyId` (`session.ts:23`) — *„the user's Party in this session's active ZEV,
  if any"*.
- `Actor.partyId` (`guards.ts:15`) — isto. **Nula izmjena logike**; `requireSelfOrRole`
  (`:100-109`) ostaje nepromijenjen jer su sada obje strane poređenja tenant-skopirane.
- `(app)/page.tsx:152-155` — rečenicu treba precizirati: tačna je jer je `actor.partyId`
  **sada** party aktivnog tenanta, a ne samo zato što je `Party` tenant-unique.

**`SessionUser` (`session.ts:17`, `User & { party: Party | null }`) je mrtav tip** —
provjereno grepom kroz `src`, `tests`, `e2e`, `prisma`: nula potrošača. Briše se usput, ne
„popravlja".

---

## 5. Putevi upisa — tri plus jedan

Svaki se obrađuje zasebno, poštujući obrazloženje iz
`Plans/tenant-switching-admin-accounts-plan.md` §5.1 zbog kojeg su to odvojene funkcije, a ne
jedna zajednička: `createUserForParty` je gated sa `requireRole(actor,"PRESIDENT")` **i**
`requireZev(actor)` (upravo guard koji sprečava predsjednika ZEV-a A da radi u ZEV-u B), dok
funkcije u `admin.ts` po definiciji rade cross-tenant iza `requireSuperAdmin`, sa `zevId` kao
argumentom. **Ovaj plan tu podjelu ne dira.**

### 5.1 `createTenant` (`admin.ts:118-219`)

```
PRIJE (u $transaction, :156-189):
  zev    = tx.zev.create({...})
  party  = tx.party.create({ zevId: zev.id, kind: "PERSON", firstName, lastName, email, phone })
  user   = tx.user.create({ email, passwordHash, roles: ["PRESIDENT"], partyId: party.id })   // :183
  tx.membership.create({ userId: user.id, zevId: zev.id, role: "PRESIDENT" })
  seedDefaultSettings(tx, zev.id)

POSLIJE (Korak 1 — redoslijed obrnut, jedan upis manje):
  zev    = tx.zev.create({...})
  user   = tx.user.create({ email, passwordHash, roles: ["PRESIDENT"] })
  party  = tx.party.create({ zevId: zev.id, kind: "PERSON", ..., userId: user.id })
  tx.user.update({ where: { id: user.id }, data: { partyId: party.id } })   // LEGACY, samo Korak 1
  tx.membership.create({ ... })
  seedDefaultSettings(tx, zev.id)

POSLIJE (Korak 2): linija `tx.user.update(... partyId ...)` se briše.
```

Sve ostaje u istoj `$transaction`. Audit i `queueNotification` (`:191-216`) nepromijenjeni —
`recipientId: party.id` je i dalje tačan.

### 5.2 `createTenantAccount` (`admin.ts:236-321`)

Identična mehanika (`:286` `partyId: party.id` → `userId` na `party.create` + legacy
`user.update`). Ništa drugo se ne mijenja: `assertAssignableRole`, provjera postojećeg
e-maila (`:263-264`), `assertPasswordStrong`, audit, `queueNotification`.

### 5.3 `grantMembership` (`admin.ts:334-366`) — **odluka: ne mijenja se**

Danas namjerno ne pravi `Party` (`admin.ts:330-333`), uz dokumentovan razlog koji izmjenom
šeme **prestaje da bude tačan**:

> *„Known, accepted limitation carried from §5.3/§8 item 1: the granted user gets no Party in
> this tenant (User.partyId is @unique — one Party per user, ever)"*

| # | Opcija | Trade-off | |
|---|---|---|---|
| a | Ostaviti kako jeste; ispraviti samo komentar | Ispravka curenja ostaje ispravka curenja. Ograničenje („nalog bez `Party`-ja u ovom ZEV-u se ne vidi na `/vlasnici` i ne može u `/organi`") ostaje, ali sada kao **odluka**, a ne kao ograničenje šeme. | **✓** |
| b | Opcioni korak „napravi i `Party` ovdje" (checkbox u `/admin/[zevId]`) | Otključava vanjskog knjigovođu u registru organa. Ali: platformski admin dodjeljuje `Party` u tuđoj poslovnoj evidenciji, i time **ruši zaštitu iz §4.2** — `assertUserInZev` (`users.ts:201-207`) je `Party`-bazirano upravo zato da predsjednik tenanta **ne može** da deaktivira platformski nalog. Čim admin sam sebi napravi `Party`, ta zaštita nestaje tiho. | ✗ (u ovom planu) |
| c | Obavezni `Party` za svaki `grantMembership` | Isto što (b), plus zagađenje padajućih lista „Vlasnik"/„Davalac punomoći" na `/vlasnici` i `/organi` nalozima koji nikad neće biti vlasnici (§4.1 prethodnog plana). | ✗ |

**Preporuka ✓ (a).** Razlog nije konzervativizam nego obim: ovo je ispravka curenja podataka
koja nosi migraciju nad živom bazom. Funkcionalnost koja mijenja *ko se pojavljuje u
poslovnoj evidenciji tenanta* zaslužuje sopstvenu odluku i sopstveni korak. Pravo mjesto za
nju je **u tenantu, kod predsjednika** (`/vlasnici`, funkcija tipa
`linkExistingUserToParty`) — tamo gdje je znanje („ovo je isti čovjek") i gdje `/vlasnici`
ionako zahtijeva dokaz o vlasništvu. To je detaljno razrađeno u
`Plans/owner-cross-tenant-party-user-plan.md` §4.2 i ostaje kao sljedeći korak.

**Konkretno u ovom planu:** briše se rečenica *„User.partyId is @unique — one Party per user,
ever"* iz doc komentara i zamjenjuje stvarnim razlogom (platformski admin nije lice u
poslovnoj evidenciji te zajednice; put za `Party` vodi kroz `/vlasnici`). Vidi §9, **P1**.

### 5.4 `createUserForParty` (`users.ts:58-92`) — smjer veze se okreće

Ovo je jedini od četiri puta u kojem `Party` **već postoji** i po pravilu nosi istoriju koja
prethodi svakom nalogu (vlasnički udjeli sa dokazom, fakture, uplate, glasovi, punomoći).

```
PRIJE:
  party.findUniqueOrThrow({ where: { id: input.partyId, zevId } })   // :69 — ostaje
  assertPasswordStrong(input.password)                               // :70 — ostaje
  user = prisma.user.create({ ..., partyId: input.partyId })         // :71-78
  prisma.membership.createMany({ ... })                              // :79-84 (odvojen upis!)
  audit(..., after: { ..., partyId: user.partyId })                  // :89

POSLIJE (Korak 1), sve u JEDNOJ $transaction:
  party = tx.party.findUniqueOrThrow({ where: { id: input.partyId, zevId } })
  if (party.userId) throw new Error("Ovo lice je već povezano sa korisničkim nalogom.")
  user  = tx.user.create({ email, passwordHash, roles })
  tx.party.update({ where: { id: input.partyId, zevId }, data: { userId: user.id } })
  tx.user.update({ where: { id: user.id }, data: { partyId: input.partyId } })   // LEGACY, samo Korak 1
  tx.membership.createMany({ data: roles.map(...), skipDuplicates: true })
  audit(..., after: { ..., partyId: input.partyId })
```

Tri stvari koje treba naglasiti:

1. **Šta se dešava sa istorijom `Party`-ja: ništa.** Sve što o njemu visi
   (`OwnershipStake.ownerId`, `Invoice.debtorId`, `Payment.payerId`, `Vote.voterId`,
   `EligibleVoter.ownerId`, `Attendance.partyId`, `OfficeTerm.partyId`, `Occupancy.partyId`,
   `Proxy.grantorId/holderId`, `BalanceCorrection.partyId`, `MaintenanceIssue.reporterId`,
   `ViberSubscriber.partyId`, `NotificationMessage.recipientId`) referiše **`Party.id`**,
   koji se ne mijenja. Dodaje se jedna kolona na postojeći red. Nijedan FK se ne premješta,
   nijedan red se ne prepisuje. Ovo je ključni razlog zbog kojeg je izmjena bezbjedna baš u
   ovom smjeru — suprotan smjer (premještanje istorije sa `Party`-ja na `User`) bi bio
   nesrazmjerno veći poduhvat.
2. **`$transaction` je usputna, ali stvarna ispravka.** Danas su `user.create` i
   `membership.createMany` dva nevezana upisa (`:71-84`); prekid između njih ostavlja nalog
   koji se prijavljuje u prazno (bez ijedne role → `requireActor` ga vraća na
   `/?err=forbidden` sa svake stranice). Sa okrenutom vezom to postaje **tri** upisa, pa
   transakcija prelazi iz „bilo bi lijepo" u „obavezno".
3. **Provjera `party.zevId` ostaje netaknuta** (`:69`) — to je ona koja sprečava predsjednika
   ZEV-a A da otvori nalog nad licem iz ZEV-a B, i pokrivena je testom
   `tests/tenant-isolation.test.ts:618`.

### 5.5 Prateće izmjene u `users.ts`

| Mjesto | Danas | Poslije |
|---|---|---|
| `:201-207` `assertUserInZev` | `user.party.zevId !== zevId` | `prisma.party.findFirst({ where: { userId, zevId }, select: { id: true } })`; nema reda → **ista poruka, isti guard** |
| `:89` audit `after.partyId` | `user.partyId` | `input.partyId` (ista vrijednost, drugi izvor) |
| `:148` `recipientId: user.partyId` u `requestPasswordReset` | globalni party | **`null`** — vidi ispod |

**`assertUserInZev` — zašto ostaje `Party`-bazirano, a ne `Membership`-bazirano.** Prirodna
reakcija je prebaciti ga na `Membership` („to je ionako izvor ovlašćenja"). **Ne raditi to.**
`Plans/tenant-switching-admin-accounts-plan.md` §4.2 svjesno odlučuje da sopstveno članstvo
super admina **ne dobija `Party`**, i kao *poželjnu* posljedicu navodi da ga predsjednik
tenanta zbog toga ne može deaktivirati sa `/vlasnici`. Ta zaštita počiva **isključivo** na
tome da je `assertUserInZev` `Party`-bazirano. Podjela koju vrijedi izgovoriti naglas:

- **`Membership` odgovara na „šta ovaj nalog smije u ovom ZEV-u"** (`roles`, `requireRole`);
- **`Party` odgovara na „je li ovaj nalog lice u poslovnoj evidenciji ovog ZEV-a"** — a samo
  takve naloge predsjednik administrira sa `/vlasnici`.

**Zabranjen mehanički port `user.parties[0].zevId !== zevId`** — redoslijed niza je
proizvoljan; to bi bila stvarna sigurnosna regresija. Zaključati testom, ne pregledom koda
(§7).

**`recipientId: null` u resetu lozinke.** Funkcija već ima sopstveni komentar (`:142-145`) da
tu namjerno nema `zevId` jer korisnik može imati članstva u više ZEV-ova. Sa okrenutom vezom
više ne postoji „njegov jedan party", a birati jedan proizvoljno značilo bi upisati poruku o
resetu u evidenciju slučajne zajednice. Polje je već nullable (`schema.prisma:1499-1500`), a
`toAddress` nosi svu potrebnu informaciju. Ovo usput **zatvara** polovinu poznate praznine iz
`docs/multitenancy-plan.md` §6.4 Modul 6, umjesto da je proširi.

---

## 6. Revizija potrošača — svi ~40 poziva, grupisano, sa presudom

Metod: grep za `actor.partyId`, `session.partyId`, `ctx.partyId`, `user.partyId`,
`include: { party`, `parties`, uz isključivanje `src/generated/**` i polja drugih modela koja
samo sadrže niz `partyId` (`ownerId`, `payerId`, `debtorId`, `grantorId`, `reporterId`,
`recipientId`, `voterId`). Svaka grupa je čitana, ne pretpostavljena.

### Grupa A — `actor.partyId` kao filter u upitu koji je **već** `requireZev`-skopiran → **NEPROMIJENJENO**

`payments.ts:788` (`listPayments`), `billing.ts:411` (`listInvoices`), `maintenance.ts:17`
(`listIssues`), `:42` (`getIssue`), `:91` (`addIssueComment`), `documents.ts:181,183`
(`readDocumentFile`), `attachments.ts:178,181` (`readAttachmentFile`), `meetings.ts:1132`
(`openProposalsForOwner`), `:1152` (`ownVotes`), `ownership.ts:75` (`updateParty`), `:247`
(`grantProxy`), `:265` (`revokeProxy`), `:465` (`requireOwnerParty`),
`(app)/vlasnici/[id]/page.tsx:145` (`isSelf`),
`(app)/skupstina/prijedlog/[id]/page.tsx:202`, `(app)/podesavanja/page.tsx:112,113`.

Presuda: **nepromijenjeno, uz promjenu značenja na bolje.** Svi ovi koriste `actor.partyId`
kao „moj party, sada" unutar upita koji već nosi `zevId` u `where`. Danas je ta pretpostavka
suptilno netačna (rezultat je prazan ili `Forbidden`); poslije ispravke je tačna. Nula
izmjena koda.

### Grupa B — `requireSelfOrRole` (`guards.ts:100-109`) → **NEPROMIJENJENO (samo doc)**

Poređenje `actor.partyId === ownerPartyId` ostaje ispravno jer su obje strane sada
tenant-skopirane. Ova funkcija **ne** provjerava `zevId` i ne treba da ga provjerava — svaki
njen pozivalac odmah zatim radi `findUniqueOrThrow({ where: { id, zevId } })`.

### Grupa C — API rute koje aktora sastavljaju ručno iz `session.partyId` → **NEPROMIJENJENO**

`api/prilozi/[id]/route.ts:12`, `api/dokumenti/[id]/route.ts:11`,
`api/dokumenti/saglasnost/[partyId]/route.ts:10`, `api/dokumenti/kartica/[partyId]/route.ts:10`,
`api/izvjestaji/pdf/route.ts:13`, `api/izvjestaji/dugovanja/route.ts:14`,
`api/izvjestaji/csv/route.ts:9`.

Presuda: **nepromijenjeno.** Sve čitaju `AuthContext.partyId`, čije se **značenje** popravlja
u §4; oblik (`string | null`) je identičan. (Vrijedi zabilježiti kao dug, van obima: sedam
kopija istog objekta koje bi trebalo da zovu zajednički helper — ali to je mehanički zadatak
koji ne treba raditi usput uz ispravku curenja.)

### Grupa D — `actor.partyId` kao vrijednost koja se **UPISUJE** → **DANAS POKVARENO, POPRAVLJA SE §4**

Jedno mjesto: `maintenance.ts:75` `reporterId: actor.partyId` (`reportIssue`). Detaljno u
§1.3. Nema izmjene koda — ispravka `getAuthContext`-a je dovoljna — ali **traži sopstveni
regresioni test** (§7) i provjeru zatečenih podataka (§8, rizik 6).

### Grupa E — `(app)/page.tsx` `OwnerDashboard` → **DANAS CURI, POPRAVLJA SE §4 (+ doc)**

`:143-166`. Nema izmjene logike; jedino se precizira komentar `:152-155` (§4.2). Ovo je
jedino mjesto u aplikaciji koje `partyId` koristi **bez** `zevId` u `where`, i jedino gdje se
bag vidi kao pogrešan podatak, a ne kao prazno stanje.

### Grupa F — `partyId` koji **nije** `actor.partyId` → **VAN OBIMA, NEPROMIJENJENO**

`meetings.recordAttendance` (`Attendance.partyId`), `ownership.setOfficeTerm` /
`addBoardMember` (`OfficeTerm.partyId`), `setOccupancy` (`Occupancy.partyId`),
`payments.addBalanceCorrection` (`BalanceCorrection.partyId`), `evoteConsent.*` (parametar),
`reports.ownerDebtReport` (`opts.partyIds`), `ViberSubscriber.partyId`,
`(app)/izvjestaji/page.tsx:207`, `(app)/skupstina/[id]/page.tsx:123,285`.

Presuda: **ništa.** To su parametri/kolone drugih modela, ne razriješeni identitet aktora.
Svi su već `zevId`-skopirani i pokriveni u `tests/tenant-isolation.test.ts`.

### Grupa G — čitaoci relacije `User.party` → **JEDINA GRUPA KOJA SE STVARNO MIJENJA**

| # | Mjesto | Danas | Poslije |
|---|---|---|---|
| 1 | `session.ts:117` `include: { party: true }` | jedan party | `parties: { select: ... }` (§4.2) |
| 2 | `session.ts:124-128` `displayName` | `u.party` | lanac: aktivni ZEV → najstariji → e-mail |
| 3 | `session.ts:138` `partyId: u.partyId` | globalno | `activeParty?.id ?? null` |
| 4 | `session.ts:17` `SessionUser` | mrtav tip | briše se |
| 5 | `users.ts:201-207` `assertUserInZev` | `user.party.zevId !== zevId` | `party.findFirst({ userId, zevId })` (§5.5) |
| 6 | `users.ts:89` audit `after.partyId` | `user.partyId` | `input.partyId` |
| 7 | `users.ts:148` `recipientId` | `user.partyId` | `null` (§5.5) |
| 8 | **`activity.ts:56`** `listActivityActors` | `include: { user: { include: { party: true } } }` | `parties: { where: { zevId }, take: 1 }` |
| 9 | **`activity.ts:122`** `listActivityActorsForZev` | isto | isto, sa `zevId` iz parametra |

**Stavke 8 i 9 su jedini nalaz revizije koji prethodni plan nije imao, i nisu mehanički
port nego usputna ispravka.** Obje funkcije grade labelu filtera „akter" na `/aktivnosti`
odnosno `/admin/aktivnosti` iz `m.user.party` — dok je upit nad `Membership` **već skopiran
po `zevId`**. Danas član ZEV-a B koji ima `Party` u ZEV-u A biva prikazan **imenom iz ZEV-a
A** u listi aktera ZEV-a B; poslije izmjene se bira party tog istog tenanta, a fallback na
`m.user.email` (koji već postoji) pokriva ostatak. Isti bag, druga fasada.

### Grupa H — `Party.user` (obrnuti smjer) → **NEPROMIJENJENO**

`ownership.ts:28` (`listParties`), `:43` (`getParty`), i kartica „Korisnički nalog"
(`(app)/vlasnici/[id]/page.tsx:338-375`). `Party` i dalje ima **najviše jedan** `User`, a
ime relacije se namjerno zadržava (§2.2 tačka 4) — pa se nijedan od ovih poziva ne mijenja.

### Grupa I — upisi `User.partyId` → **SVI SE MIJENJAJU (Korak 1 dvostruko, Korak 2 brišu)**

`admin.ts:183` (`createTenant`), `admin.ts:286` (`createTenantAccount`), `users.ts:76`
(`createUserForParty`) — §5. Plus fixture/seed: `prisma/seed.ts:85,88,91,94,97` (5),
`tests/helpers.ts:79,82,85,88` (4), `tests/user-admin.test.ts:69,78` (2), i asertacije u
`tests/admin.test.ts:37,107,126,206`.

**TypeScript hvata sve od ovoga u Koraku 2** — polje nestaje iz `UserUncheckedCreateInput` i
`UserSelect`, pa svako pojavljivanje pada na `npm run typecheck`. Gdje TS **ne** pomaže:
(a) sam SQL migracija, (b) `scripts/*.sql` — provjereno, nijedna ne pominje `partyId`,
(c) starije migracije — one su istorija i ne diraju se. Sirovog SQL-a u aplikaciji nema
(`$queryRaw`/`$executeRaw`: nula pogodaka van `src/generated/`).

### Zbirna presuda

| Presuda | Broj mjesta |
|---|---|
| Nepromijenjeno (potvrđeno čitanjem) | ~35 (Grupe A, B, C, F, H) |
| Popravlja se samo kroz §4, bez izmjene koda | 2 (Grupe D, E) — ali oba traže test |
| Stvarna izmjena koda | 9 (Grupa G) + 3 puta upisa (Grupa I) + fixture/seed |

**Hipoteza iz zadatka („svih ~40 čitalaca `actor.partyId` ostaje nepromijenjeno") je
potvrđena, sa jednim ispravkom:** ona važi za **čitaoce** `actor.partyId`, ali **ne** za
čitaoce relacije `User.party` — `activity.ts` ×2 bi tihom mehaničkom zamjenom nastavio da
prikazuje ime iz pogrešnog tenanta.

---

## 7. Testovi

### 7.1 Kako uopšte testirati `getAuthContext()` — opcije

`getAuthContext` čita kolačić kroz `cookies()` iz `next/headers`, čega u Vitest okruženju
nema; svi postojeći testovi gađaju servisni sloj direktno (`tests/auth.test.ts` npr. testira
reset lozinke kroz `requestPasswordReset`, bez ijedne sesije).

| # | Pristup | Trade-off | |
|---|---|---|---|
| a | Mock-ovati `next/headers` + `jose` | Testira se mock, ne ponašanje; krhko na svaku izmjenu `createSession`. | ✗ |
| b | **Izdvojiti razrješenje u izvezenu funkciju i testirati nju nad stvarnim redovima** | `resolveActiveZev` već ima taj oblik (prima `sessionId` + kolekcije). Proširuje se u `resolveActiveContext(sessionId, currentActiveZevId, memberships, parties) → { zevId, roles, partyId }` i **izvozi**. `getAuthContext` postaje tanak omotač oko nje. Testira se stvarna logika, nad stvarnim `Session`/`Membership`/`Party` redovima. | **✓** |
| c | Samo Playwright e2e | Spor, i ne može da tvrdi `partyId` — samo posredno, kroz ono što se renderuje. Korisno kao **dopuna**, ne kao dokaz. | ✗ |

Napomena uz (b): ovo je jedino odstupanje od odluke u §4.1 opcija (c) — tamo je odbijeno da
`resolveActiveZev` *računa* party jer miješa odgovornosti; ovdje se predlaže da funkcija
ostane ista po sadržaju, ali dobije party-`find` i bude izvezena, tako da `getAuthContext`
nema ni jednu netestiranu granu. Ako se to čini kao previše za jedan `find`, alternativa je
izvesti samo čist `export function partyForZev(parties, zevId)` i testirati nju — ali onda
veza „Session.activeZevId → partyId" nije pokrivena testom, što je tačno ono što treba
zaključati. Preporuka ostaje (b).

### 7.2 Regresioni test za **originalni** bag — `tests/tenant-isolation.test.ts`

Tamo mu je i mjesto: to je jedini fajl u projektu čija je tema cross-tenant izolacija.

Fixture (prvi takav u projektu): `createFixture("A")` + `createFixture("B")`, pa **jedan
`User`** povezan sa `Party`-jem u oba, sa `Membership` u oba, plus po jedna faktura, uplata i
`EligibleVoter` u svakom.

1. **Jezgro:** `Session` sa `activeZevId = A` → `resolveActiveContext` vrati `partyId` party-ja
   iz **A**; poslije `switchActiveZev(actor, B.zev.id)` isti `Session` → `partyId` party-ja iz
   **B**. Ista sesija, ista osoba, druga vrijednost. *Ovo je test koji bi danas pao.*
2. **Nula-slučaj:** korisnik sa `Membership` u B ali **bez** `Party`-ja u B → `partyId === null`
   (a ne party iz A). Ovo je slučaj platformskog admina iz §5.3.
3. **`roles` i `partyId` su dosljedni:** oba se razrješavaju po istom `zevId` (spriječiti
   regresiju u kojoj neko „popravi" jedno a ne drugo).
4. **`assertUserInZev`:** iz A nalazi party iz A, iz B nalazi party iz B; predsjednik A **ne
   može** `deactivateUser`/`updateUserRoles` nad korisnikom čiji je jedini `Party` u B
   (zaključava zabranu `parties[0]` porta iz §5.5).
5. **`@@unique([userId, zevId])`:** pokušaj drugog `Party`-ja za istog korisnika u **istom**
   ZEV-u odbijen na nivou baze.
6. **`Party` bez naloga nije ograničen:** N `Party` redova sa `userId = NULL` u istom ZEV-u
   prolazi (dokaz `NULLS DISTINCT` pretpostavke iz §2.2).
7. **Grupa D (`reportIssue`):** aktor prebačen u B prijavljuje kvar → `reporterId` je party iz
   **B**, i `MaintenanceIssue` sa `reporterId` iz tuđeg ZEV-a se ne može napraviti.
8. **Grupa E (`OwnerDashboard` upiti):** direktno nad `prisma` — `invoice.findMany({ debtorId:
   resolvedPartyId })` u kontekstu B ne vraća nijednu fakturu iz A.
9. **`listActivityActors` (Grupa G, 8/9):** label člana koji ima `Party` u oba ZEV-a je, u
   listi za B, ime iz **B**.

### 7.3 Postojeći testovi koji se mijenjaju

- **`tests/helpers.ts`** (`createFixture`, `:78-89`) — 4 `user.create({ partyId })`. **Jedno
  mjesto popravlja sve fixture-e**, i to je najbolja provjera da je „značenje ostalo isto":
  postojećih ~20 test fajlova mora proći **nepromijenjeno**.
- **`tests/user-admin.test.ts:69,78`** — 2 ručno kreirana „druga predsjednika".
- **`tests/admin.test.ts:37,107,126`** — asertacije `user.partyId` → `party.userId`.
- **`tests/admin.test.ts:202-207`** — asertacija koja **izričito tvrdi ograničenje koje ovaj
  plan ukida**: *„User.partyId is @unique, so it keeps its one Party in 'home'"*. Test se
  **zadržava** (`grantMembership` i dalje ne pravi `Party` — §5.3), ali mu se mijenja
  obrazloženje u komentaru i asertacija prelazi sa `user.partyId` na „korisnik nema `Party`
  u ciljanom ZEV-u".
- **`prisma/seed.ts:85-97`** — 5 poziva.

---

## 8. Rizici

1. **Nepotpun backfill ostavlja sirote veze.** Ublaženo `RAISE EXCEPTION` provjerom u **obje**
   migracije (§3.3 korak 3, §3.4 korak 2): migracija pada u transakciji umjesto da tiho prođe.
   Ovo je jedini rizik u planu koji baza može da uhvati umjesto nas — vrijedi ga iskoristiti.
2. **Polovično primijenjena migracija.** Konkretno: migracija 1 primijenjena na Neon, a kod
   nikad deployovan. Posljedica: **nikakva** — nova kolona je popunjena i nevidljiva starom
   kodu. Suprotno (kod deployovan bez migracije) puca odmah i glasno (`Party.userId does not
   exist` na prvom `getAuthContext`), tj. na svakoj prijavljenoj stranici. To je razlog zašto
   je redoslijed „migracija → pa push" pravilo, a ne preporuka.
3. **Prozor između migracije 2 i deploya Koraka 2.** Ovo je jedini istinski opasan trenutak u
   planu: stari (Korak 1) kod upisuje `User.partyId`, a kolona više ne postoji → svaki
   `createUserForParty`/`createTenant`/`createTenantAccount` puca dok se novi build ne
   promoviše. **Ublažavanje:** migracija 2 se pušta **neposredno prije** push-a, i to u
   periodu male aktivnosti; čitanja (velika većina saobraćaja) ne pate jer Korak-1 kod
   `User.partyId` više ne **čita**. *Alternativa koju vrijedi razmotriti ako se ovo čini
   preuskim: u Koraku 1 ostaviti dvostruki upis iza jednostavne env zastavice, pa je isključiti
   deployom bez migracije, i tek onda pustiti migraciju 2 — vidi §9, **P3**.*
4. **Naivan port `assertUserInZev` na `parties[0]`** — stvarna sigurnosna regresija (redoslijed
   niza je proizvoljan; predsjednik ZEV-a A bi mogao da administrira korisnika iz ZEV-a B).
   Zaključano testom 7.2/4, ne samo pregledom koda.
5. **Dvije relacije između `User` i `Party` u Koraku 1.** Prisma traži imenovane relacije na
   obje strane; pogrešno imenovanje pada na `prisma generate`, što je poželjno. Stvarni rizik
   je **čitljivost**: `Party.user` mijenja FK koji obilazi, a da mu ime ostaje isto. Ublaženo
   izričitim komentarom na modelu (§2.2 tačka 4) i time što Korak 2 tu dvojnost briše.
6. **Zatečeni pokvareni redovi iz §1.3.** Prije Koraka 1 pustiti provjeru nad Neon bazom:
   ```sql
   SELECT i."id", i."zevId", p."zevId" AS reporter_zev
     FROM "MaintenanceIssue" i JOIN "Party" p ON p."id" = i."reporterId"
    WHERE p."zevId" <> i."zevId";
   ```
   Isto i za `Attendance`, `OfficeTerm`, `Occupancy` (tamo je `partyId` provjeren pri upisu, pa
   se očekuje nula — provjera je jeftina i potvrđuje da je §1.3 zaista jedini put). Ako pogodaka
   ima: audit trag je append-only, pa ispravka mora biti **nov korektivni upis** (ili
   `IssueStatusEvent` + zatvaranje prijave), nikad `UPDATE` istorije. Rezultat provjere ide u
   `CHANGELOG.md` unos.
7. **Vidljiva promjena ponašanja za naloge koji su danas pokvareni.** Korisnik sa članstvom u B
   i `Party`-jem samo u A poslije ispravke na `/` dobija *„Vaš nalog nije povezan sa evidencijom
   vlasnika"* umjesto (pogrešnih) podataka iz A, a na `/podesavanja` nestaje tab „Moji podaci"
   (`podesavanja/page.tsx:112-113`). **To je ispravno ponašanje**, ali izgleda kao regresija ako
   se ne najavi. Vrijedi ga navesti u `CHANGELOG.md` unosu eksplicitno.
8. **Zagađenje padajućih lista na `/vlasnici` i `/organi` (§4.1 prethodnog plana): ne nastaje.**
   Provjereno: `listParties` (`ownership.ts:22-33`) nabraja `Party` redove tog ZEV-a, a ovaj
   plan **ne pravi nijedan nov `Party` red** — `grantMembership` ostaje bez `Party`-ja (§5.3),
   a `createTenant`/`createTenantAccount`/`createUserForParty` prave tačno onoliko `Party`
   redova koliko i danas. Dakle nijedan nalog se ne pojavljuje na `/vlasnici` koji se tamo i
   danas ne pojavljuje. Briga iz §4.1 postaje aktuelna tek ako se usvoji P1 ili kasniji
   `linkExistingUserToParty` tok — i tada joj je mjesto u **tom** planu, ne ovdje.
9. **`deactivateUser` je i dalje globalna zastavica.** `users.ts:231-237` to već priznaje:
   predsjednik ZEV-a A deaktivacijom zaključava korisnika i iz ZEV-a B. Ovaj plan taj problem
   **ne pravi gorim** (ne otvara nijedan nov put ka nalogu sa dva `Party`-ja), ali ga ni ne
   rješava. Rješenje je razrađeno u `Plans/owner-cross-tenant-party-user-plan.md` §5.3 i
   **mora** ući prije nego što bilo koji put ka drugom `Party`-ju bude isporučen. Vidi §9, P1.

### 8.1 Raspored deploya (Vercel + Neon) — obavezan redoslijed

Za **svaki** od dva koraka, bez izuzetka:

1. `npm run typecheck && npm run lint && npm test && npm run build` lokalno (sva četiri).
2. Regeneracija `src/generated/prisma` kroz jednokratni kontejner (šema se mijenja u oba
   koraka), pa ponovni build.
3. `node scripts/migrate.mjs apply` nad **svježom lokalnom bazom** + `npm run db:seed`, pa živa
   provjera (prebacivanje tenanta, `/`, `/vlasnici`, `/aktivnosti`).
4. **Pitati korisnika za odobrenje migracije nad Neon-om** — nikad pretpostaviti da je već
   puštena, čak i ako korisnik kaže samo „pushuj".
5. Migracija nad Neon-om kroz **direktnu (ne-pooled)** konekciju:
   `docker compose exec -T -e DATABASE_URL="<neon-direct>" app npm run db:migrate`.
6. Tek onda push na `main` → Vercel build → promocija.
7. Provjera na produkciji: prijava, prebacivanje tenanta, `/`.

Nikad unutar Vercel build koraka — PR preview build bi inače mogao da dodirne produkcionu bazu.

---

## 9. Otvorena pitanja za tebe

- **P1 — Treba li `grantMembership` da dobije opcioni korak „napravi i `Party` ovdje"?**
  Preporuka je **ne u ovom planu** (§5.3, opcija a): ispravka curenja ne treba da nosi novu
  funkcionalnost, a opcija (b) tiho ruši zaštitu iz
  `Plans/tenant-switching-admin-accounts-plan.md` §4.2 (`assertUserInZev` je `Party`-bazirano
  upravo zato da predsjednik tenanta ne može da deaktivira platformski nalog). Pravo mjesto je
  `/vlasnici` kod predsjednika, kao zaseban korak. **Ako se ne slažeš**, to je izvodivo odmah
  poslije Koraka 1 — ali tada u isti paket **mora** ući i guard iz rizika 9 (`deactivateUser`
  za nalog sa članstvima u više ZEV-ova).
- **P2 — Je li `@@unique([userId, zevId])` prava granica?** Bez njega bi isti čovjek u istom
  ZEV-u mogao imati dva lica — npr. kao fizičko lice **i** kao vlasnik firme (`kind:
  ORGANIZATION`) koja ima poslovni prostor u istoj zgradi. **Taj slučaj je stvaran u praksi**
  (`prisma/seed.ts` već vodi firmu kao zaseban `Party`). Preporuka je ipak `@@unique`, jer bi
  bez njega `getAuthContext` morao da bira između dva party-ja bez ijednog pravila. Ali ako
  želiš da jedan login „prebacuje" i između svog fizičkog i firminog lica u istom ZEV-u, to je
  druga i veća izmjena (`Session.activePartyId`) i treba je odlučiti **sada, prije migracije**.
- **P3 — Koliko uzak smije biti prozor iz rizika 3?** Jednostavna varijanta: migracija 2 se
  pusti neposredno prije push-a (nekoliko minuta izloženosti na *upisnim* putevima). Sigurnija:
  dvostruki upis iza env zastavice, isključi se deployom bez migracije, pa tek onda migracija 2
  (nula izloženosti, ali jedan deploy više i jedna privremena zastavica u kodu). Preporuka je
  jednostavna varijanta — ali odluka je tvoja jer zavisi od toga koliko naloga se stvarno
  otvara u produkciji.
- **P4 — Opcioni Korak 0 (uska zakrpa odmah)?** Bez ijedne migracije, u `session.ts` se može
  odmah vratiti `partyId: u.party?.zevId === zevId ? u.partyId : null`. Curenje prestaje danas,
  a cijena je da korisnik iz §8/7 vidi „nalog nije povezan sa licem" dok ne stigne prava
  ispravka. Preporuka: **da**, ako Koraci 1-2 ne mogu da krenu u roku od par dana; ne, ako
  mogu (da se ista logika ne piše dvaput).
- **P5 — Verzija.** Prijedlog u §10. Ali ovo je izmjena šeme koja ukida jednu **potvrđenu**
  odluku iz `docs/multitenancy-plan.md` §8 tačka 3 — po pravilu iz `CHANGELOG.md` („major je za
  značajniju prekretnicu", i vraća minor na 1) to bi opravdalo **3.1.0** umjesto `2.24.0`.
  Tvoja odluka.
- **P6 — `docs/multitenancy-plan.md` §8 tačka 3.** Prepisati tu odluku (uz datum i pokazivač na
  ovaj plan), ili ostaviti istorijski zapis netaknut i dodati napomenu ispod? Preporuka je
  drugo — potvrđene odluke sa datumom su trag odlučivanja, ne trenutno stanje.

---

## 10. Skica po fajlovima i obim

### Korak 0 *(opciono, vidi P4)* — uska zakrpa, bez migracije

| Fajl | Izmjena |
|---|---|
| `src/server/auth/session.ts` | `partyId` se vraća samo kad `u.party.zevId === zevId`, inače `null` |
| `tests/tenant-isolation.test.ts` | jedan test: prebacivanje u ZEV bez `Party`-ja daje `partyId === null` |
| `CHANGELOG.md`, `package.json`, `package-lock.json` | unos + verzija |

### Korak 1 — okretanje veze, bez ijedne nove funkcionalnosti

| Fajl | Izmjena |
|---|---|
| `prisma/schema.prisma` | `Party.userId` + `@@unique([userId, zevId])` + `user`/`legacyUser` imenovane relacije; `User.parties`; `User.party`/`partyId` označeni kao LEGACY; ažuriran komentar na `Party` (§2.2) |
| `prisma/migrations/<ts>_party_user_link_add/migration.sql` | **nov, ručno pisan** — §3.3 |
| `src/server/auth/session.ts` | `include: { parties: { select } }`; `resolveActiveContext` (izvezena, vraća i `partyId`); `displayName` lanac; brisanje `SessionUser`; doc komentari |
| `src/server/auth/guards.ts` | **samo doc komentar** na `Actor.partyId` — nula izmjena logike |
| `src/server/services/users.ts` | `createUserForParty` → `$transaction` + `party.update` + legacy `user.update`; `assertUserInZev` → `party.findFirst`; audit `after.partyId`; `recipientId: null` |
| `src/server/services/admin.ts` | `createTenant` i `createTenantAccount` → `party.create({ userId })` + legacy `user.update`; ispravljen doc komentar na `grantMembership` (§5.3) |
| `src/server/services/activity.ts` | `listActivityActors` i `listActivityActorsForZev` → `parties: { where: { zevId }, take: 1 }` |
| `src/app/(app)/page.tsx` | **samo komentar** `:152-155` |
| `prisma/seed.ts` | 5 `user.create({ partyId })` → `user.create` + `party.update` |
| `tests/helpers.ts` | `createFixture` — 4 naloga, **jedno mjesto popravlja sve** |
| `tests/user-admin.test.ts`, `tests/admin.test.ts` | 2 ručna naloga + 4 asertacije |
| `tests/tenant-isolation.test.ts` | nov paket „isti korisnik, dva ZEV-a" (§7.2) |
| `docs/multitenancy-plan.md` | §8 tačka 3 — napomena sa datumom i pokazivačem (vidi P6) |
| `Plans/owner-cross-tenant-party-user-plan.md` | označiti kao zamijenjen ovim dokumentom |
| `Plans/tenant-switching-admin-accounts-plan.md` | §4.2/§5.3/§8.1 — ukloniti tehnički razlog („`@unique`"), zadržati suštinski |

### Korak 2 — brisanje legacy kolone

| Fajl | Izmjena |
|---|---|
| `prisma/migrations/<ts>_party_user_link_drop_legacy/migration.sql` | **nov, ručno pisan** — §3.4 |
| `prisma/schema.prisma` | brisanje `User.party`/`partyId`/`Party.legacyUser`; uklanjanje imena relacije `"PartyAccount"` (ostaje jedna, bezimena) |
| `src/server/services/users.ts`, `src/server/services/admin.ts` | brisanje tri legacy `user.update({ partyId })` linije |
| `tests/*`, `prisma/seed.ts` | sve što `typecheck` prijavi (očekivano: ništa, ako je Korak 1 urađen dosljedno) |

### Verzionisanje i obim

| Korak | Sadržaj | Migracija | Neon odobrenje | Verzija (prijedlog) |
|---|---|---|---|---|
| Korak 0 *(opciono)* | uska zaštita u `session.ts` | ne | — | **2.23.1** (patch — iteracija na zatečenom bagu) |
| Korak 1 | šema (aditivno) + auth + putevi upisa + testovi | **da** (aditivna, bezopasna) | **da** | **2.24.0** (minor) |
| Korak 2 | brisanje `User.partyId` + čišćenje | **da** (destruktivna) | **da** | **2.24.1** (patch — dovršetak istog poduhvata) |

Uz svaki korak, bez izuzetka: unos u `CHANGELOG.md` + **potvrđen** skok verzije (nikad
jednostrano), `typecheck && lint && test && build`, i živa Playwright provjera za sve što se
vidi (za Korak 1 to su `/` kao vlasnik, prekidač tenanta u `nav-shell`, `/podesavanja`,
`/aktivnosti` filter „akter").

---

## Redoslijed implementacije — preporuka za potvrdu

Ovo je preporuka, ne odluka — molim potvrdu prije početka.

**1. Može li se isporučiti postepeno? Da, i treba — ali granica nije tamo gdje bi se očekivalo.**

Unutar Koraka 1 **ne postoji** bezbjedna manja isporuka. Šema, `getAuthContext` i sva tri puta
upisa moraju ući **kao jedna atomska izmjena**: čim `Party.userId` postoji a `getAuthContext`
ga čita, svaki put upisa koji ga ne postavlja pravi nalog koji se prijavljuje bez `partyId`-ja
— tj. zamjenjuje jedan bag drugim. Obrnuto (putevi upisa prvi, čitanje kasnije) ostavlja
popunjenu kolonu koju niko ne čita, pa bag traje. Veza je previše centralna da bi se sjekla po
sredini.

Granica po kojoj se **jeste** isplati sjeći je **kolona `User.partyId`**: Korak 1 je isporučiv
i koristan sam za sebe (bag je ispravljen), a Korak 2 je čisto čišćenje koje može sačekati dan,
sedmicu ili koliko treba da se u produkciji potvrdi da ništa ne puca. To je ujedno i jedini
prozor u kojem je povratak na prethodni Vercel deployment još uvijek ispravan.

**2. Predloženi redoslijed:**

1. **Korak 0** *(samo ako Koraci 1-2 ne kreću odmah — P4)*: uska zakrpa u `session.ts`,
   isporuka istog dana, bez migracije. Curenje prestaje.
2. **Provjera zatečenih podataka na Neon-u** (rizik 6, SQL iz §8) — prije bilo koje migracije,
   da se zna da li uz Korak 1 ide i korektivni upis.
3. **Korak 1**, u jednom potezu: šema → migracija 1 → `getAuthContext` → tri puta upisa →
   `assertUserInZev` → `activity.ts` → fixture/seed → testovi. Migracija na Neon **uz tvoje
   izričito odobrenje**, prije push-a.
4. **Pauza i posmatranje** produkcije (bar nekoliko dana, i bar jedno stvarno prebacivanje
   tenanta + jedno otvaranje naloga). Povratak unazad je u ovom prozoru još uvijek ispravan.
5. **Korak 2**: migracija 2 neposredno prije push-a, pa brisanje legacy linija.
6. **Tek poslije toga**, kao zaseban poduhvat i zaseban plan: `linkExistingUserToParty` /
   `unlinkUserFromParty` na `/vlasnici` + guard za `deactivateUser` (rizik 9) — tj. ono zbog
   čega je okretanje veze i predloženo u
   `Plans/owner-cross-tenant-party-user-plan.md`. **Nikad prije Koraka 2.**

**3. Šta bi promijenilo ovaj redoslijed:** ako odgovoriš „da" na P1 (`grantMembership` dobija
`Party`), tačka 6 se ne može odložiti — guard iz rizika 9 mora ući u isti paket, jer bi inače
predsjednik jednog ZEV-a mogao da deaktivira nalog aktivan u drugom, a tih naloga bi po prvi
put stvarno bilo.

---

### Ključni fajlovi za implementaciju

- **`prisma/schema.prisma`** — `Party.userId` + `@@unique([userId, zevId])`, `User.parties`,
  prelazne imenovane relacije (`:24-44` `User`, `:72-116` `Party`, `:234-245` `Membership` kao
  obrazac)
- **`src/server/auth/session.ts`** — težište ispravke: `resolveActiveZev` (`:84-99`) kao
  obrazac, `getAuthContext` (`:102-146`), sama pokvarena linija `:138`, mrtav `SessionUser`
  (`:17`), `displayName` (`:124-128`)
- **`src/server/services/users.ts`** — `createUserForParty` (`:58-92`, smjer veze se okreće i
  dobija `$transaction`), `assertUserInZev` (`:201-207`, jedini bedem cross-tenant
  administracije naloga — **ne** portovati na `parties[0]`), `requestPasswordReset` (`:146-159`)
- **`src/server/services/admin.ts`** — `createTenant` (`:156-189`), `createTenantAccount`
  (`:268-290`), i doc komentar `grantMembership`-a (`:323-333`) koji sadrži tvrdnju koja
  izmjenom postaje netačna
- **`prisma/migrations/<ts>_party_user_link_add/`** i **`<ts>_party_user_link_drop_legacy/`**
  *(nove, ručno pisane)* — jedina dva mjesta koja dodiruju produkcione podatke; obje nose
  `RAISE EXCEPTION` provjeru koja ih obara umjesto da tiho prođu
- **`tests/helpers.ts`** (`createFixture`, `:45-144`) — jedno mjesto koje popravlja sve
  fixture-e u projektu — i **`tests/tenant-isolation.test.ts`** (nov paket „isti korisnik, dva
  ZEV-a"; test koji bi danas pao)
- **`src/server/services/activity.ts`** (`:49-63`, `:115-131`) — jedini čitalac `User.party`
  koji se ne bi uhvatio pretragom za `actor.partyId`, i koji danas prikazuje ime iz pogrešnog
  tenanta
