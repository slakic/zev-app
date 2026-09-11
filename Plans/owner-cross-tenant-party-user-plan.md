# Jedan nalog — vlasnik u više ZEV-ova (okretanje veze `User`↔`Party`) — plan za pregled

**Status: PLAN, implementacija nije počela.** Nastalo na zahtjev korisnika (2026-09-10), kao
*zaseban* poduhvat izdvojen iz `Plans/tenant-switching-admin-accounts-plan.md`, čiji §5.3 ovu
izmjenu izričito ostavlja van svog obima:

> *"Trajno rješenje je okretanje veze (`Party.userId` umjesto `User.partyId`, jedan korisnik →
> više `Party` redova, po jedan po tenantu) — izmjena šeme, izričito van obima ovog plana."*

Izrađeno plansko-analitičkim prolazom (Opus, plan-only, bez pisanja koda), zasnovano na čitanju
stvarnog koda. Mijenja jednu od **potvrđenih** odluka iz `docs/multitenancy-plan.md` §8 tačka 3 —
to je jedini razlog zbog kojeg zaslužuje zaseban dokument, a ne pasus u nekom drugom.

---

## 0. Rezime — pročitati prije ostatka

Pitanje je bilo: *"može li jedan nalog (jedan e-mail) biti član više ZEV-ova?"* — u smislu
**vlasnika**, ne knjigovođe. Danas ne može, i to nije previd nego tvrdo ograničenje šeme u jednoj
liniji:

```prisma
// prisma/schema.prisma:38-39
party        Party?    @relation(fields: [partyId], references: [id])
partyId      String?   @unique
```

Strani ključ stoji na `User`-u i `@unique` je. Jedan `User` → najviše jedan `Party`. `Party.zevId`
je obavezan i `Party` pripada tačno jednom ZEV-u. Cjelokupno vlasništvo visi o `Party`-ju
(`OwnershipStake`, `Invoice.debtorId`, `Payment.payerId`, `Vote`, `EligibleVoter`, `Attendance`,
`BalanceCorrection`, `MaintenanceIssue`, `Occupancy`, `Proxy`, `OfficeTerm`, `NotificationMessage`,
`ViberSubscriber` — nijedan od njih ne referiše `User`). Dakle: **jedan login može biti vlasnik u
najviše jednom ZEV-u, ikad.**

Tri nalaza iz čitanja koda koji određuju cijeli plan:

1. **Površina izmjene je iznenađujuće mala — i to je glavni argument da se uradi sada.** Grep za
   direktnim čitanjem `User.partyId` daje **tačno tri mjesta** (`session.ts:137`, `users.ts:88`,
   `users.ts:147`), a za relaciju `User.party` (jednina) **dva** (`session.ts:116`,
   `users.ts:197`). Svih 28 pojavljivanja `actor.partyId` u 12 fajlova su potrošači jedne
   neprozirne vrijednosti i **ne mijenjaju se uopšte**, pod uslovom da ih sloj sesije napuni
   ispravno. Suprotni smjer veze (`Party.user`, koji koriste `listParties`/`getParty`/`documents.ts`)
   ostaje **nepromijenjen** — `Party` i dalje ima najviše jedan `User`.
2. **Razrješenje `partyId`-ja po aktivnom tenantu nije nov obrazac, nego postojeći.** `resolveActiveZev`
   (`session.ts:83-98`) već računa `roles` kao "filtriraj `memberships` po aktivnom `zevId`". Party
   se računa istom rečenicom nad drugom kolekcijom. Ovo je, konceptualno, *manja* izmjena od one
   koju je Faza 0 već uradila za `roles`.
3. **Postojeći podaci su čisti 1:1 i migracija je bezgubitna.** Svaki `Party` koji danas ima
   `User`-a ima ga tačno jednog, i obrnuto. `UPDATE ... FROM` prebacuje vezu bez ijednog gubitka i
   bez ijednog sirotog reda.

Odluka koju plan brani na svakom mjestu gdje se pojavi izbor:

> **`Party.userId` (nullable) + `@@unique([userId, zevId])`. `AuthContext.partyId` mijenja
> *značenje* (party u aktivnom ZEV-u), ne *oblik*. Nijedan `Actor` ne dobija nova polja.
> Povezivanje postojećeg naloga sa novim licem živi u tenantu (`/vlasnici`, PRESIDENT), nikad
> u `/admin`.**

---

## 1. Problem — sa dokazima iz koda

### 1.1 Šta tačno ne radi danas

Investitor koji ima stan u zgradi ZEV-a A i stan u zgradi ZEV-a B (dvije nepovezane zajednice,
dva tenanta) mora imati **dva odvojena naloga sa dvije različite e-mail adrese**. Ne postoji
nijedan put kroz aplikaciju kojim bi jedan nalog dobio drugi `Party`:

- `createUserForParty` (`users.ts:58-91`) uvijek pravi **nov** `User` (`prisma.user.create`) sa
  `partyId` postavljenim na kreiranju. Za e-mail koji već postoji puca na `User_email_key` unique
  violation.
- `createParty` (`ownership.ts:48-68`) uopšte ne dodiruje `User`.
- `createTenant` (`admin.ts:114-115`) izričito odbija postojeći e-mail:
  *"Nalog sa e-mail adresom ... već postoji."*

### 1.2 Zašto je to bila svjesna odluka, i zašto se sad mijenja

`docs/multitenancy-plan.md` §8.3, potvrđeno 2026-09-07:

> *"`OWNER` i vezanost za jedan ZEV — potvrđeno: `Party.zevId` uvijek odgovara `Membership.zevId`
> tog korisnika. Vlasnik ne može biti vlasnik u ZEV-u A a istovremeno imati `OWNER` članstvo u
> ZEV-u B — jedan `Party` red pripada tačno jednom ZEV-u."*

**Ovaj plan mijenja samo drugu rečenicu, ne prvu.** "Jedan `Party` red pripada tačno jednom ZEV-u"
ostaje netaknuto i dalje je nosilac cijele tenant izolacije (`Party.zevId` je obavezan FK, komentar
na modelu ostaje tačan). Mijenja se isključivo: *isti čovjek smije imati po jedan takav red u više
ZEV-ova.* To nije rušenje invarijante nego njeno ispravno čitanje — invarijanta je uvijek bila o
`Party`-ju, a `@unique` na `User.partyId` je bio o *nalogu*, i to je ono što je previše.

Praktična posljedica koju plan otključava, pored samog vlasništva: ograničenje iz
`tenant-switching-admin-accounts-plan.md` §8.1 ("korisnik u dva tenanta ima `Party` u najviše
jednom; u drugom je nevidljiv na `/vlasnici`, neupravljiv, ne može u organe") **nestaje**. Vanjski
knjigovođa koji opslužuje tri ZEV-a može biti upisan u registar organa svakog od njih.

### 1.3 Šta puca ako se veza samo naivno okrene

Dva mjesta u kojima "jedan party" nije neprozirna vrijednost nego **pretpostavka nad kojom se
odlučuje o ovlašćenjima**:

```ts
// src/server/services/users.ts:196-202
async function assertUserInZev(zevId: string, userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { party: true } });
  if (!user.party || user.party.zevId !== zevId) {
    throw new Error("Korisnik nije pronađen u ovom ZEV-u.");
  }
  return user;
}
```

Ovo je jedini bedem koji sprečava predsjednika ZEV-a A da `deactivateUser`/`activateUser`/
`updateUserRoles` primijeni na korisnika koji sa ZEV-om A nema veze. Mehanički port u
`user.parties[0].zevId !== zevId` bio bi **stvarna sigurnosna regresija** (redoslijed niza je
proizvoljan). Detaljno u §5.

```ts
// src/server/auth/session.ts:116, 123-127, 137
user: { include: { party: true, memberships: true } },
const displayName = u.party ? ... : u.email;
partyId: u.partyId,
```

Ovo je jedino mjesto koje `partyId` uopšte pušta u aplikaciju. Detaljno u §3.

---

## 2. P1 — Šema i migracija

### 2.1 Novi oblik

**`User` — jedno polje se briše, jedno mijenja:**

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
  parties      Party[]       // <- zamjenjuje `party Party?` + `partyId String? @unique`
  sessions     Session[]
  memberships  Membership[]
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}
```

**`Party` — dobija FK i jedan složeni unique:**

```prisma
model Party {
  ...
  zev    Zev     @relation(fields: [zevId], references: [id])
  zevId  String
  /// Portal nalog ovog lica, ako ga ima. Većina Party redova nema nalog (vlasnik kojem
  /// nikad nije otvoren pristup) — zato nullable. Jedan User ima najviše jedan Party PO
  /// ZEV-u (@@unique ispod), ali smije imati po jedan u više ZEV-ova.
  user   User?   @relation(fields: [userId], references: [id])
  userId String?
  ...
  @@unique([userId, zevId])
}
```

Četiri stvari koje treba svjesno primijetiti:

1. **`userId` ostaje nullable i to je suština.** Ogromna većina `Party` redova nema i nikad neće
   imati `User` (vlasnik bez e-maila, stanar, punomoćnik, dobavljač kao lice). `@@unique([userId,
   zevId])` u Postgresu **ne smeta** tome: `NULL` vrijednosti se u unique indeksu ne smatraju
   jednakima, pa jedan ZEV smije imati proizvoljno mnogo `Party` redova sa `userId IS NULL`. Ovo
   je jedina netrivijalna SQL činjenica u cijelom planu i vrijedi je napisati u komentar migracije.
2. **Zašto `@@unique([userId, zevId])`, a ne samo `@@index([userId])`.** Bez unique ograničenja
   ništa ne bi spriječilo dva `Party` reda za istog korisnika u istom ZEV-u — a `getAuthContext`
   mora da vrati **jedan** `partyId`, deterministički. Ograničenje pretvara to iz "biramo prvi i
   nadamo se" u invarijantu koju baza garantuje. Isti obrazac koji `Membership` već koristi
   (`@@unique([userId, zevId, role])`).
3. **Zaseban `@@index([userId])` NIJE potreban** — `userId` je vodeća kolona složenog unique
   indeksa, pa upit `where: { userId, zevId }` i upit `where: { userId }` oba koriste taj indeks.
   (Isto obrazloženje koje `tenant-switching-admin-accounts-plan.md` §7/Korak 3 već koristi za
   `Membership`.)
4. **Referencijalna akcija: `ON DELETE SET NULL`** — ista koju veza ima danas
   (`20260823175909_init/migration.sql:1201`). Brisanje `User`-a (što aplikacija ionako nikad ne
   radi — deaktivira ga) ne smije povući `Party` sa svim fakturama i glasovima. `Party` preživi
   kao nepovezano lice.

**`SessionUser`** (`session.ts:17`, `export type SessionUser = User & { party: Party | null }`) je
**mrtav tip** — grep daje nula potrošača. Briše se usput, ne "popravlja".

### 2.2 Migracija — jedna, ručno pisana, bez prelaznog perioda

**Ručno pisana SQL migracija je ovdje pravilo projekta, ne izuzetak.** Svaka ne-init migracija u
`prisma/migrations/` je ručna, iz razloga koji je zapisan u
`20260908120000_drop_zevid_default/migration.sql`:

> *"Hand-written for the same reason as the other non-init migrations in this project: the bundled
> schema-engine-wasm cannot introspect this database (PL/pgSQL trigger functions from
> append_only_guards break its Postgres catalog scan)."*

Dakle: nov direktorijum `prisma/migrations/<timestamp>_party_user_reversal/migration.sql`, pisan
rukom, primjenjuje se sa `node scripts/migrate.mjs apply` (nikad `npx prisma migrate`).

Redoslijed koraka — dodaj, prepiši, zaključaj, tek onda obriši:

```sql
-- 1. nova kolona, prazna
ALTER TABLE "Party" ADD COLUMN "userId" TEXT;

-- 2. backfill iz postojeće veze (danas čist 1:1)
UPDATE "Party" p SET "userId" = u."id" FROM "User" u WHERE u."partyId" = p."id";

-- 3. sanity: nijedan User sa partyId ne smije ostati neprenesen -> migracija pada glasno
DO $$
DECLARE missing INT;
BEGIN
  SELECT count(*) INTO missing FROM "User" u
   WHERE u."partyId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Party" p WHERE p."id" = u."partyId" AND p."userId" = u."id");
  IF missing > 0 THEN RAISE EXCEPTION 'Backfill nepotpun: % User redova bez prenesene veze', missing; END IF;
END $$;

-- 4. ograničenja (NULL-ovi se ne sudaraju -> Party bez naloga ostaje neograničen)
CREATE UNIQUE INDEX "Party_userId_zevId_key" ON "Party"("userId", "zevId");
ALTER TABLE "Party" ADD CONSTRAINT "Party_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. tek sada stara strana
ALTER TABLE "User" DROP CONSTRAINT "User_partyId_fkey";
DROP INDEX "User_partyId_key";
ALTER TABLE "User" DROP COLUMN "partyId";
```

**Treba li prelazni period sa obje kolone? Ne.** Argument nije "jednostavnije je" nego je
tehnički: aplikacija se isporučuje kao **jedan kontejner** koji na startu radi
`node scripts/migrate.mjs apply` pa tek onda `npm start` (`docker-entrypoint.sh`). Nema rolling
deploy-a sa dvije verzije koda nad istom bazom. Uz to, stari i novi kod ionako **ne mogu**
koegzistirati: generisani Prisma klijent za staru verziju traži kolonu `User.partyId` u
`SELECT`-ovima, pa bi stara instanca pucala čim kolona nestane — a da je ostavimo (korak 5
preskočen), pucala bi nova, jer bi `User.partyId` bio `NOT NULL`-neutralan ali neodržavan i tiho
bi razilazio od `Party.userId`. Dvije kolone koje moraju ostati sinhrone bez ijednog pisca koji ih
oboje održava su gori rizik od 20 sekundi zastoja.

Korak 3 (`DO $$ ... RAISE EXCEPTION`) je ono što čini jednu migraciju sigurnom: ako backfill iz
bilo kog razloga ne pokrije sve redove, migracija **pada u transakciji** i baza ostaje na staroj
šemi, umjesto da tiho ostavi sirotu vezu. To je isti duh kao "fails loudly instead of silently
misattributing" iz `drop_zevid_default` migracije.

**Povratna migracija (rollback)** je moguća i bezgubitna dok jedan korisnik nema više od jednog
`Party`-ja — a to je tačno stanje neposredno nakon deploy-a. Vrijedi zapisati u komentar migracije
kao "izlaz do prve stvarne cross-tenant veze"; poslije toga povratak nije više bezgubitan i ne
treba se pretvarati da jeste.

---

## 3. P2 — Razrješenje sesije i `Actor`

### 3.1 `getAuthContext()` — party se računa isto kao `roles`

Danas se `roles` računa iz već učitanih `memberships` filtriranjem po razriješenom `zevId`
(`session.ts:96`). `partyId` se računa istom rečenicom, nad `parties`:

- `include` postaje `user: { include: { parties: true, memberships: true } }`;
- poslije `resolveActiveZev(...)` vrati `{ zevId, roles }`, doda se
  `const party = zevId ? u.parties.find((p) => p.zevId === zevId) ?? null : null;`
- `partyId: party?.id ?? null`.

**Zašto `include: { parties: true }` a ne zaseban `prisma.party.findFirst({ where: { userId, zevId } })`.**
Drugi upit se ne može poslati prije nego što se zna `zevId`, a `zevId` se razrješava **poslije**
učitavanja sesije — dakle bio bi to dodatni round-trip na **svakom** zahtjevu (a `getAuthContext`
se zove iz `requireActor` na svakoj stranici i svakoj server akciji). Broj `Party` redova po
korisniku je ograničen brojem ZEV-ova kojima pripada — realno 1, u ekstremu nekoliko — pa je
učitavanje svih besplatno i simetrično sa `memberships`, koji se već tako učitava. Ako se ikad
pojavi nalog sa desetinama tenanta, `select` se suzi na `{ id, zevId, kind, firstName, lastName,
orgName }` (jedino što se odavde i koristi); to nije razlog da se sad bira lošiji oblik.

### 3.2 `displayName` — mala odluka koju treba donijeti svjesno

Danas: ime iz `u.party`, inače e-mail (`session.ts:123-127`). Sutra postoji treći slučaj — korisnik
ima `Party` redove, ali nijedan u aktivnom ZEV-u (npr. platformski admin sa članstvom bez
`Party`-ja u tenantu B, a vlasnik u tenantu A).

**Preporuka: `party (aktivni ZEV) → najstariji `Party` po `createdAt` → e-mail`.** Isti čovjek u
dva ZEV-a će imati isto ime u oba, pa je pad na najstariji `Party` praktično uvijek tačan, a
`displayName` se prikazuje **samo samom korisniku** (`nav-shell.tsx`, kroz `requireActor`) — nije
podatak koji curi između tenanta. Alternativa "odmah e-mail" je defanzivnija ali daje lošije
iskustvo tačno onim nalozima zbog kojih se ovaj plan i radi.

### 3.3 Treba li `Actor` novo polje? Ne.

`Actor.partyId: string | null` (`guards.ts:15`) **ostaje istog oblika**. `Actor` je po definiciji
vezan za jedan aktivni ZEV (`zevId`), pa je jedna vrijednost tačno ono što mu treba — mijenja se
samo doc komentar: *"the user's Party in the currently active ZEV, if any"* umjesto *"the user's
one and only Party"*. `requireSelfOrRole` (`guards.ts:88-97`) ostaje **nepromijenjen** — poređenje
`actor.partyId === ownerPartyId` je i dalje tačno, jer su obje strane sada tenant-scoped.

**Ne dodaje se `Actor.parties: {zevId, partyId}[]`** (tj. lista svih (ZEV, party) parova, po uzoru
na `Membership[]`). Razlog je konkretan, ne "YAGNI": jedini zamišljeni potrošač je prekidač
tenanta ("i tamo si vlasnik"), a **taj podatak već stiže kroz `Membership`** — vidi §6, gdje se
uvodi invarijanta *"`Party.userId` postavljen ⟹ postoji `Membership(userId, zevId, OWNER)`"*.
`listMyTenants` iz drugog plana vraća `roles` po tenantu, pa `OWNER` u toj listi **jeste** signal
"tamo si vlasnik". Dodavanje drugog izvora iste istine u `Actor` bi značilo da ta dva izvora mogu
da se raziđu — što je tačno klasa problema koju `Membership` kao jedini izvor `roles`-a već rješava.

### 3.4 Šta se NE mijenja (provjereno, ne pretpostavljeno)

Pročitani su svi potrošači `actor.partyId` (28 pojavljivanja, 12 fajlova). **Nijedan ne treba
izmjenu.** Razlog je uvijek isti: svaki od njih koristi `actor.partyId` kao filter unutar upita
koji je **već** zaključan na `requireZev(actor)`:

- `payments.ts:774` `payerId = ... : actor.partyId ?? "__none__"` — uz `where: { zevId, ... }`;
- `payments.ts:797-798, 877-878` `ownerBalance`/`ownerAdvance` — `requireSelfOrRole` + `zevId` u svakom `where`;
- `billing.ts:390`, `maintenance.ts:17, 42, 65, 75, 91`, `documents.ts:170-172`,
  `attachments.ts:178-181`, `meetings.ts:959, 979`, `ownership.ts:75, 247, 265, 465` — isti obrazac;
- `src/app/(app)/page.tsx:143-165` (`OwnerDashboard`) je jedini koji gađa `prisma` direktno **bez**
  `zevId` filtera, i ima sopstveni komentar koji objašnjava zašto je to bezbjedno: *"partyId, which
  is itself tenant-unique (a Party belongs to exactly one Zev)"*. **Ta rečenica ostaje tačna nakon
  ovog plana** — `Party.zevId` se ne dira. Jedina promjena je da `actor.partyId` sada pokazuje na
  party aktivnog tenanta, što je upravo ono što ta stranica želi.

Nijedno mjesto ne kešira `actor.partyId` izvan zahtjeva, ne koristi ga kao ključ u modulskom
`Map`-u, niti ga upisuje u dugovječno stanje. (Dva modulska `Map`-a koja postoje —
`failedLogins`/`resetRequests` u `users.ts` — ključuju se e-mailom, ne party-jem.) Provjereno
čitanjem `ownership.ts`, `payments.ts`, `maintenance.ts` u cjelini, plus grep-om preko ostalih.

---

## 4. P3 — Dva toka otvaranja naloga, i novi treći

### 4.1 Šta ostaje netaknuto

**(a) Novo lice + nov nalog** — `createParty` pa `createUserForParty`
(`vlasnici/page.tsx:18-32`), i admin tok `createTenantAccount` iz drugog plana. Jedina izmjena je
mehanička: `prisma.user.create({ data: { ..., partyId } })` više ne postoji, pa se veza uspostavlja
sa strane `Party`-ja. Preporuka je da `createUserForParty` zadrži identičan potpis i ponašanje, a
unutra radi:

```
user = tx.user.create({ email, passwordHash, roles })
tx.party.update({ where: { id: partyId, zevId }, data: { userId: user.id } })
tx.membership.createMany(...)
```

**u jednoj transakciji** — danas to nisu tri upisa nego dva nevezana (`user.create` pa
`membership.createMany`, `users.ts:70-83`), pa je uvođenje `$transaction` ovdje mala usputna
popravka, a ne proširenje obima: prekid između koraka bi sada ostavio `User`-a bez `Party`-ja *i*
bez članstva, tj. nalog koji se prijavljuje u prazno.

Provjera vlasništva `Party`-ja nad tenantom (`users.ts:69`,
`prisma.party.findUniqueOrThrow({ where: { id: input.partyId, zevId } })`) **ostaje netaknuta** i
i dalje je ona koja sprečava predsjednika ZEV-a A da otvori nalog nad licem iz ZEV-a B
(pokriveno testom `tenant-isolation.test.ts:605`).

### 4.2 Novi tok: povezivanje POSTOJEĆEG naloga sa novim licem

Ovo je stvarna nova funkcionalnost koju šema otključava.

**Gdje živi: u tenantu, na `/vlasnici`, kod PRESIDENT-a. Ne u `/admin`.**

Tri razloga, po težini:

1. **Znanje je u tenantu.** "Marko iz stana 12 je isti Marko koji ima stan u drugoj zgradi" zna
   predsjednik te zajednice, ne platformski administrator. Platformski admin nema način da to
   provjeri niti odgovornost da to tvrdi.
2. **Vlasništvo se ionako mora unijeti tu.** Povezivanje naloga bez `OwnershipStake`-a je prazna
   ljuštura; udio se unosi kroz `addOwnershipStake`, koje **obavezno** traži dokaz o vlasništvu
   kao fajl (`ownership.ts:110-146`, `vlasnici/page.tsx:180-182`). Držanjem oba koraka na istoj
   stranici, dokazni zahtjev ostaje neizbježan.
3. **Ne dira odluku drugog plana.** `tenant-switching-admin-accounts-plan.md` §5.2 kaže da super
   admin smije dodijeliti samo PRESIDENT/ACCOUNTANT, a OWNER isključivo kroz `/vlasnici`. Ovaj
   plan tu odluku **ne mijenja i ne slabi** — samo čini da put kroz `/vlasnici` sada radi i za
   e-mail koji već ima nalog.

**Oblik forme — dvokoračno, sa lozinkom koja nestaje.**

Forma "Dodaj lice" (`vlasnici/page.tsx:141-158`) ostaje ista, uključujući polja *"Korisnički nalog
— e-mail (opciono)"* i *"Početna lozinka"*. Mijenja se `addPartyAction`:

- `Party` se kreira kao i danas;
- ako je upisan `accountEmail` i **ne postoji** `User` sa tom adresom → današnje ponašanje
  (`createUserForParty`, lozinka obavezna);
- ako je upisan `accountEmail` i **postoji** `User` → **ne pravi se ništa** vezano za nalog,
  nego `redirect("/vlasnici?link=<partyId>")`, gdje se renderuje kartica potvrde:
  *"Nalog `m****@primjer.ba` već postoji u sistemu. Povezati ga sa licem Marko Marković?
  [Poveži] [Ne, ostavi lice bez naloga]"*.

**Lozinka se u tom slučaju ignoriše — bezuslovno, i to je sigurnosno pravilo, ne udobnost.**
Predsjednik ZEV-a B ne smije, ni greškom ni namjerno, postaviti lozinku na tuđi postojeći nalog:
to bi mu dalo pristup podacima ZEV-a A. Ako je polje popunjeno, vrijednost se odbacuje i nikad ne
stiže do `hashPassword`. (Napomena za implementaciju: lozinka ne smije ući ni u `redirect` URL —
`audit.ts:20` to već zabranjuje za audit payload, isti duh važi i za query string.)

**Enumeracija e-mail adresa — postoji već danas, ne uvodi se sada.** Predsjednik i danas može da
provjeri postoji li adresa: `createUserForParty` na postojeći e-mail vrati unique violation, a
`createTenant` čak i doslovnu poruku *"Nalog sa e-mail adresom ... već postoji."* (`admin.ts:115`).
Novi tok tu površinu ne proširuje; on je samo čini korisnom umjesto da bude greška. Vrijedi to
zapisati, a ne pretvarati se da je nova rupa.

**Nove servisne funkcije — u `users.ts`, uz `createUserForParty`** (a ne u `ownership.ts`: riječ je
o vezi naloga i članstvu, ne o vlasničkoj evidenciji):

```
findLinkableUserByEmail(actor, email)                  // PRESIDENT + requireZev; { exists, alreadyLinkedPartyId? }
linkExistingUserToParty(actor, { partyId, email })     // PRESIDENT + requireZev
unlinkUserFromParty(actor, { partyId, reason })        // PRESIDENT + requireZev
```

`linkExistingUserToParty` u jednoj transakciji:

1. `party.findUniqueOrThrow({ where: { id: partyId, zevId } })` — lice mora biti u **mom** ZEV-u;
2. `user.findUnique({ where: { email } })` — mora postojati i biti `active`;
3. ako `party.userId` već postavljen → čitljiva greška, ne unique violation;
4. ako taj `User` već ima `Party` u ovom ZEV-u → *"Taj nalog je već povezan sa licem X u ovom
   ZEV-u."* (ovo je jedini put kojim se `@@unique([userId, zevId])` može prekršiti iz aplikacije —
   uhvatiti ga prije baze);
5. `party.update({ where: { id, zevId }, data: { userId } })`;
6. `membership.upsert({ userId, zevId, role: "OWNER" })` — **obavezno, vidi §6.2**;
7. `audit(actor, { action: "party.link_user", targetType: "Party", targetId, after: { userId, email } })`;
8. `queueNotification({ zevId, recipientId: partyId, toAddress: user.email, template: "party-linked", ... })` —
   povezani korisnik mora **saznati** da mu je nalog dobio pristup novoj zajednici. Ovo je jeftina
   zamjena za pun invite-flow (§9, P2).

`unlinkUserFromParty` je obrnuto, i **nije dodatak nego obavezni par** (isti argument kojim
`tenant-switching-admin-accounts-plan.md` §3.4 traži `revokeMembership`): `party.userId = null`,
brisanje `Membership` redova tog korisnika u ovom ZEV-u (uz `assertNotLastActivePresident` ako je
među njima PRESIDENT), audit sa obaveznim razlogom. `Party` i sve što o njemu visi (udjeli,
fakture, glasovi) **ostaje netaknuto** — vlasništvo se vodi na licu, ne na nalogu. Sesija se ne
mora ručno gasiti: `resolveActiveZev` (`session.ts:89`) na prvom sljedećem zahtjevu vidi da
članstvo više ne postoji i prebaci/isprazni aktivni ZEV sam.

**UI:** kartica *"Korisnički nalog"* na `/vlasnici/[id]` (danas uslovljena sa
`isPresident && party.user`) dobija drugu granu za `!party.user`: polje za e-mail + dugme
*"Poveži postojeći nalog"*, i, kad nalog postoji, dugme *"Odveži nalog"* sa obaveznim razlogom
(isti obrazac kao postojeće *"Deaktiviraj nalog"*).

---

## 5. P4 — Sve tačke koje izvode "pripada li ovaj korisnik mom tenantu"

Iscrpna lista. Grep za `include: { party` + `user.party` + `User.partyId` daje **pet** mjesta;
svako je dolje obrađeno, plus dva koja iz njih posredno slijede.

| # | Mjesto | Danas | Sutra |
|---|---|---|---|
| 1 | `users.ts:196-202` `assertUserInZev` | `user.party.zevId !== zevId` | `prisma.party.findFirst({ where: { userId, zevId } })`; nema reda → ista greška |
| 2 | `session.ts:116` `include: { party: true }` | jedan party | `parties: true` + izbor po aktivnom `zevId` (§3.1) |
| 3 | `session.ts:137` `partyId: u.partyId` | globalni | `party?.id ?? null` |
| 4 | `users.ts:88` audit `after: { partyId: user.partyId }` | polje ne postoji | `after: { partyId: input.partyId }` (ista vrijednost, drugi izvor) |
| 5 | `users.ts:147` `recipientId: user.partyId` (reset lozinke) | globalni party | **`null`** — vidi 5.2 |
| 6 | `admin.ts:144-151` `createTenant` | `user.create({ partyId })` | `party.update({ data: { userId } })` u istoj `$transaction` |
| 7 | `ownership.ts:28, 43` `include: { user: ... }` | Party → njegov User | **nepromijenjeno** |

### 5.1 `assertUserInZev` — zašto ostaje `Party`-bazirano, a ne `Membership`-bazirano

Prirodna reakcija je da se provjera prebaci na `Membership` ("to je ionako izvor ovlašćenja").
**Preporuka je da se to ne uradi**, i razlog je konkretna odluka iz drugog plana:

`tenant-switching-admin-accounts-plan.md` §4.2 svjesno odlučuje da sopstveno članstvo super
admina **ne dobija `Party`**, i kao *poželjnu* posljedicu navodi da ga predsjednik tenanta zbog
toga ne može deaktivirati sa `/vlasnici` (dobija postojeću poruku *"Korisnik nije pronađen u ovom
ZEV-u."*). Ta zaštita počiva **isključivo** na tome da je `assertUserInZev` `Party`-bazirano. Prebacivanje na
`Membership` bi je tiho ukinulo — predsjednik bi mogao da deaktivira platformski nalog.

Dakle podjela ostaje čista i vrijedi je izgovoriti naglas:

- **`Membership` odgovara na "šta ovaj nalog smije u ovom ZEV-u"** (`roles`, `requireRole`);
- **`Party` odgovara na "je li ovaj nalog lice u poslovnoj evidenciji ovog ZEV-a"** — a samo takve
  naloge predsjednik administrira sa `/vlasnici`.

Novi upit (`findFirst({ where: { userId, zevId } })`) zadovoljava traženu garanciju iz zadatka
doslovno: korisnik čiji je jedini odnos prema tenantu A `Party` u tenantu B **nema** red sa
`(userId = X, zevId = A)`, pa `assertUserInZev` baca istu grešku kao danas. Vrijedi dodati i
`select: { id: true }` — funkcija danas vraća cijelog `user`-a jer pozivaoci gledaju `before.roles`
i `before.active`, pa realno treba oba: jedan `party.findFirst` (postojanje) + `user.findUniqueOrThrow`
(stanje). Dvije male provjere umjesto jedne, ali svaka odgovara na svoje pitanje.

### 5.2 `requestPasswordReset` — `recipientId` postaje `null`

`users.ts:145-158` danas šalje `recipientId: user.partyId`. Reset lozinke je **račun-level**
događaj; funkcija čak ima sopstveni komentar da tu namjerno nema `zevId` jer korisnik može imati
članstva u više ZEV-ova. Sa okrenutom vezom više ne postoji "njegov jedan party" — a birati jedan
proizvoljno bi značilo upisati poruku o resetu u evidenciju jedne slučajne zajednice.

**Preporuka: `recipientId: null`** (polje je već nullable, `schema.prisma:1472-1473`), uz `zevId`
koji i danas izostaje. `toAddress` (e-mail) nosi svu potrebnu informaciju. Ovo usput **zatvara**
polovinu poznate praznine iz `docs/multitenancy-plan.md` §6.4 Modul 6 umjesto da je proširi.

### 5.3 `deactivateUser` prestaje da bude bezopasan — i to treba riješiti u ovom planu

`users.ts:220-226` već nosi upozorenje:

> *"deactivateUser/activateUser toggle User.active, a GLOBAL flag. For a user whose account holds
> Memberships in more than one ZEV, a PRESIDENT of ZEV A deactivating them here also locks them
> out of ZEV B."*

Danas je to teorijski (nema naloga sa dva članstva). **Ovaj plan ga pravi svakodnevnim** — cijela
svrha izmjene je da takvi nalozi postoje. Ostaviti ga kao "poznato ograničenje" bi značilo
isporučiti funkcionalnost zajedno sa njenim najgorim ishodom: predsjednik ZEV-a A klikne
*"Deaktiviraj nalog — razlog: prodaja stana"* i izbaci čovjeka iz ZEV-a B, u koji nema nikakav uvid.

**Preporuka (minimalna, bez nove kolone i bez novog modela):**

`deactivateUser` prvo prebroji članstva tog korisnika **izvan** aktivnog ZEV-a. Ako ih ima,
**odbija** sa porukom:

> *"Ovaj nalog je aktivan i u drugim zajednicama. Ovdje mu možete ukloniti pristup ovom ZEV-u
> (Odveži nalog), ali ne i deaktivirati nalog u cjelini."*

i predsjednik umjesto toga koristi `unlinkUserFromParty` iz §4.2, koji radi tačno ono što on
zapravo hoće (ukloni pristup **mom** ZEV-u) i ne dodiruje tuđi tenant. Ako drugih članstava nema —
**današnje ponašanje se ne mijenja ni za jedan bajt**, što pokriva sve postojeće podatke.

Poruka namjerno **ne navodi koje** su to zajednice — broj ni imena tuđih tenanta nisu podatak koji
predsjednik ZEV-a A smije da vidi. (Isti oprez vrijedi i za eventualno upozorenje u UI-ju.)

`activateUser` ostaje nepromijenjen: aktiviranje ne može naškoditi drugom tenantu, a `assertUserInZev`
i dalje traži `Party` u mom ZEV-u.

---

## 6. P5 — Odnos prema `tenant-switching-admin-accounts-plan.md`

### 6.1 Šta se u tom planu mijenja: jedno ograničenje nestaje, nijedna odluka ne pada

Prošao sam kroz njegove odluke jednu po jednu:

| Odluka drugog plana | Sudbina nakon ovog plana |
|---|---|
| §2.1 prebacivanje samo uz `Membership`, bez izuzetka za super admina | **Nepromijenjeno.** Ovaj plan ne dodaje drugi izvor ovlašćenja. |
| §2.3 prekidač u `nav-shell` + chip aktivnog ZEV-a | **Nepromijenjeno u obliku**, ali dobija **više korisnika**: sad ga vide i vlasnici sa dva stana, ne samo knjigovođe. Argument iz §2.3(b) ("u kojem sam ZEV-u sad") postaje **jači**, jer pogrešan odgovor sada znači i pogrešan `partyId`. |
| §3 super admin dobija stvarni `Membership` | **Nepromijenjeno.** |
| §4.2 sopstveno članstvo super admina **nema** `Party` | **Ostaje ispravno, i to iz istog razloga.** Obrazloženje se čak **pojačava**: ranije je jedan od razloga bio tehnički (*"nalog koji možda već ima `Party`"*, tj. `@unique`), a taj razlog nestaje. Preostaje suštinski razlog, koji je uvijek bio glavni: **platformski admin nije lice u poslovnoj evidenciji te zajednice** — nikad neće biti ni vlasnik ni član organa, a sjenka-`Party` bi zagadio padajuće liste "Vlasnik"/"Davalac punomoći" na `/vlasnici` i `/organi`. Preporuka: kad se ovaj plan usvoji, u §4.2 drugog plana **izbrisati** tehnički razlog i ostaviti samo suštinski, da se kasnije ne pročita kao "ovo je bilo zbog šeme, a šema se promijenila". |
| §4.2 *"Postojeći korisnik koji se dodaje u drugi tenant → `Party` NIJE moguć"* | **Ovo pada.** Sada je moguć — ali kroz `/vlasnici` (§4.2 ovog plana), ne kroz `/admin`. |
| §5.2 super admin dodjeljuje samo PRESIDENT/ACCOUNTANT, nikad OWNER | **Nepromijenjeno i ojačano.** Put za OWNER-a sada stvarno postoji tamo gdje plan kaže da treba da bude. |
| §5.3 *"Trajno rješenje je okretanje veze ... van obima ovog plana"* | **Ovo je taj plan.** Referencu zamijeniti pokazivačem na ovaj dokument. |
| §8.1 rizik *"korisnik u dva tenanta ima `Party` u najviše jednom"* | **Briše se sa liste rizika.** |

Redoslijed nije obavezan u jednom smjeru, ali **jeste preporučen**: drugi plan (prebacivanje) prvo.
Bez prekidača tenanta, vlasnik sa dva ZEV-a bi imao ispravan `partyId` — u tenantu koji mu je
`resolveActiveZev` slučajno izabrao, bez ijednog načina da pređe u drugi. Šema bi radila, a
korisnik ne bi vidio nikakvu korist. Obrnuto (prekidač bez ovog plana) je već isporučiva
funkcionalnost za PRESIDENT/ACCOUNTANT naloge.

### 6.2 `listMyTenants` — treba li da gleda i `Party`? Ne, ali samo uz jednu invarijantu

Provjereno u kodu: **`Membership(role: OWNER)` se danas ne stvara ni u `createParty` ni u
`addOwnershipStake`.** Jedini pisci `Membership`-a u cijeloj aplikaciji su:

- `users.ts:79` `createUserForParty` (iz `roles` parametra — `/vlasnici` uvijek šalje `["OWNER"]`,
  `vlasnici/page.tsx:31`),
- `users.ts:284-291` `updateUserRoles`,
- `admin.ts:152` `createTenant` (samo PRESIDENT),
- `prisma/seed.ts:109` i `tests/helpers.ts:73` (fixture, ručno).

Dakle `Party` **može** postojati sa vlasničkim udjelima i bez ijednog `Membership` reda — ali samo
kad nema ni `User`-a, što je i normalno (vlasnik bez portala). Za svaki `Party` koji **ima** `User`,
danas članstvo postoji, ali kao posljedica toka, ne kao pravilo.

**Preporuka: to pretvoriti u eksplicitnu invarijantu servisnog sloja:**

> **Ako je `Party.userId` postavljen, mora postojati `Membership(userId, party.zevId, OWNER)`.**

Održavaju je tri mjesta i sva tri su u ovom planu ionako dirana: `createUserForParty` (već je
održava kroz `roles`), `linkExistingUserToParty` (korak 6 u §4.2), `unlinkUserFromParty` (briše
oboje). Plus jedan test koji je izričito tvrdi.

Posljedica koju time kupujemo: **`listMyTenants` ostaje `Membership`-only i ne mijenja se uopšte.**
Prekidač tenanta dobija OWNER redove besplatno, `roles` u njemu su ionako po tenantu, a
`Membership` ostaje jedini izvor istine za "gdje ovaj nalog ima šta da traži". Alternativa —
`listMyTenants` kao `UNION` nad `Membership` i `Party` — dala bi isti spisak uz drugi izvor istine
i mogućnost razilaženja (tenant u prekidaču u kojem `roles` ispadne prazan → `requireActor` odbija
svaku stranicu, tj. tačno "prazna ljuštura" koju drugi plan opisuje u §0). Ne vrijedi.

**Zašto invarijanta nije DB-nametnuta.** Projekat ima presedan za trigere
(`20260823180200_append_only_guards`), pa je tehnički izvodivo. Ali trigger za ovo bi morao da
prati `INSERT`/`UPDATE` na `Party` **i** `DELETE` na `Membership`, i da odlučuje šta uraditi kad
`updateUserRoles` legitimno skine OWNER rolu čovjeku koji je i dalje vlasnik (npr. nalog prevede u
čistog ACCOUNTANT-a). Servisni sloj + test su ovdje tačna težina; trigeri u ovom projektu čuvaju
**nepromjenjivost** evidencije (audit, glasovi), a ne poslovna pravila.

---

## 7. Fazni plan

Tri koraka. **Korak 1 je potpuno nevidljiv korisniku** — šema i sesija se okrenu, ponašanje ostaje
identično. Tek Korak 2 donosi novu mogućnost. To je namjerno: ako nešto pođe po zlu u okretanju
veze, poći će po zlu u koraku bez ijedne nove funkcionalnosti, gdje je uzrok očigledan.

### Korak 1 — Okretanje veze, bez ijedne nove funkcije

| Fajl | Izmjena |
|---|---|
| `prisma/schema.prisma` | `User.party`/`partyId` → `User.parties Party[]`; `Party.user`/`userId` + `@@unique([userId, zevId])`; ažurirati doc komentar na `Party` (§8.3 invarijanta se **precizira**, ne briše) |
| `prisma/migrations/<ts>_party_user_reversal/migration.sql` | **nov, ručno pisan** — §2.2 |
| `src/server/auth/session.ts` | `include: { parties: true, memberships: true }`; izbor party-ja po aktivnom `zevId`; `displayName` fallback lanac (§3.2); `partyId: party?.id ?? null`; brisanje mrtvog `SessionUser`; ažurirati doc komentar na `AuthContext.partyId` |
| `src/server/auth/guards.ts` | samo doc komentar na `Actor.partyId` ("party u aktivnom ZEV-u") — **nula izmjena logike** |
| `src/server/services/users.ts` | `createUserForParty` → `$transaction` (user → party.update → memberships); `assertUserInZev` → `party.findFirst({ userId, zevId })`; `audit after.partyId` iz `input`; `recipientId: null` u resetu |
| `src/server/services/admin.ts` | `createTenant`: `party.update({ data: { userId } })` umjesto `user.create({ partyId })` |
| `prisma/seed.ts` | 5 `user.create({ partyId })` → `user.create` + `party.update`, ili `party.create({ data: { user: { create: ... } } })` |
| `tests/helpers.ts` | isto, u `createFixture` (4 naloga) — **jedno mjesto, ne po testu** |
| `tests/user-admin.test.ts` | 2 ručno kreirana "druga predsjednika" (linije 65-80) |
| `docs/multitenancy-plan.md` | §8 tačka 3: dopisati da je ograničenje ukinuto ovim planom, sa datumom i pokazivačem |

**Testovi (Korak 1):** postojećih ~123 testa moraju proći nepromijenjeni osim fixture-a — to je i
najbolja provjera da je "značenje ostalo isto". Novo u `tests/tenant-isolation.test.ts`: korisnik
sa `Party`-jem u A i `Party`-jem u B (prvi takav fixture u projektu) — `assertUserInZev` iz A ga
nalazi, iz B nalazi drugi red; predsjednik A ne može `deactivateUser`/`updateUserRoles` nad
korisnikom čiji je jedini `Party` u B.

Migracija: **da** (jedina u planu). Verzija: prijedlog **2.6.0** (minor) — ali vidi §9, P4.

### Korak 2 — Povezivanje postojećeg naloga (`/vlasnici`)

| Fajl | Izmjena |
|---|---|
| `src/server/services/users.ts` | `findLinkableUserByEmail`, `linkExistingUserToParty`, `unlinkUserFromParty`; guard u `deactivateUser` (§5.3) |
| `src/app/(app)/vlasnici/page.tsx` | `addPartyAction` grana za postojeći e-mail → `?link=`; kartica potvrde |
| `src/app/(app)/vlasnici/[id]/page.tsx` | kartica "Korisnički nalog": grana "poveži postojeći" kad `!party.user`; "Odveži nalog" kad ga ima |
| `src/server/notifications/*` | novi `party-linked` template (tijelo poruke, bez tokena) |

**Testovi:** nov `tests/party-link.test.ts` (ili sekcija u `user-admin.test.ts`) — povezivanje pravi
`Membership(OWNER)`; dvostruko povezivanje istog naloga u istom ZEV-u odbijeno **čitljivom** greškom
prije unique violation-a; povezivanje lica iz tuđeg ZEV-a odbijeno; upisana lozinka se ignoriše i
hash postojećeg naloga se **ne mijenja** (izričita asercija); odvezivanje briše članstvo i čuva sve
`OwnershipStake`/`Invoice` redove; `deactivateUser` odbijen za korisnika sa članstvom u drugom ZEV-u.

Bez migracije. Verzija: prijedlog **2.7.0**.

### Korak 3 — Test paket "isti čovjek, dva ZEV-a" (i tek onda se plan smatra gotovim)

Ovo je zaseban korak jer se piše **preko** oba prethodna i jer je jedini dokaz da izmjena radi ono
zbog čega je i rađena. Sve u `tests/tenant-isolation.test.ts`, gdje takvi scenariji i pripadaju.

Fixture: `createFixture("A")` + `createFixture("B")`, pa jedan `User` povezan sa `Party`-jem u
oba, sa udjelom, fakturom i glasačkim pravom u svakom.

1. `getAuthContext` sa `session.activeZevId = A` daje `partyId` party-ja iz A; nakon
   `switchActiveZev(B)` daje **party iz B** — ista sesija, ista osoba, druga vrijednost.
2. `ownerBalance` u A vidi samo dug iz A; saldo iz B mu ne curi ni u jednu stavku (i obrnuto).
3. Kao aktor u A, poziv nad sopstvenim `partyId`-jem **iz B** je odbijen/prazan — `requireSelfOrRole`
   ne smije da ga propusti samo zato što je "njegov" party.
4. `openProposalsForOwner`/`ownVotes` vide samo prijedloge tenanta u kojem je sesija aktivna.
5. `listParties` u A prikazuje njegov `Party` iz A sa `user.email`; u B prikazuje `Party` iz B sa
   **istim** e-mailom — i to je tačno, ne bag.
6. Predsjednik A ne može `updateUserRoles` nad tim korisnikom tako da promijeni njegove role u B
   (`updateUserRoles` već rekonsiliše `Membership` samo za `actor.zevId`, `users.ts:284` — test to
   zaključava).
7. `@@unique([userId, zevId])`: pokušaj drugog `Party`-ja za istog korisnika u istom ZEV-u odbijen.

Bez migracije. Verzija: prijedlog **2.7.1** (patch — iteracija na istom poduhvatu).

### Uz svaki korak (pravila projekta)

- Unos u `CHANGELOG.md` + **potvrđen** skok verzije (nikad jednostrano).
- `npm run typecheck && npm run lint && npm test && npm run build`, pa `node scripts/migrate.mjs apply`
  na svježoj bazi + `npm run db:seed`, pa živa Playwright provjera (Koraci 2-3 su vizuelni).
- Novac ostaje `Decimal`, audit ostaje append-only, `requireZev` ostaje na svakom tenant-scoped
  upitu — ništa u ovom planu ta pravila ne dodiruje.
- **i18n:** `/vlasnici` (kao i `/admin`) danas **ne** koristi `t()` — stringovi su hardkodirani
  srpski. Isto kao u drugom planu (§7, napomena o i18n): novi stringovi idu kroz `t()` uz nove
  ključeve, zatečeni se ne diraju; migracija zatečenih je zaseban dug.

---

## 8. Rizici i šta može poći po zlu

1. **Nepotpun backfill ostavlja sirote veze.** Ublaženo `RAISE EXCEPTION` provjerom u samoj
   migraciji (§2.2, korak 3): migracija pada u transakciji umjesto da tiho prođe. Ovo je jedini
   rizik u planu koji baza može da uhvati umjesto nas — vrijedi ga iskoristiti.
2. **Propušteno mjesto koje čita `User.partyId`.** **TypeScript hvata praktično sve**: polje
   nestaje iz `UserUncheckedCreateInput`/`UserSelect`, pa svaki od 3 čitanja i 12 upisa pada na
   `npm run typecheck`, uključujući `prisma/seed.ts` i sve `tests/*`. Provjereno da u aplikaciji
   **nema nijednog** `$queryRaw`/`$executeRaw` (grep: pogodci samo u `src/generated/`), pa nema
   sirovog SQL-a koji bi izmakao. Gdje TS **ne** pomaže: (a) sama SQL migracija, (b)
   `scripts/*.sql` pomoćne skripte — provjereno, nijedna ne pominje `partyId`, (c) starije
   migracije koje pominju `User.partyId` — one su istorija i ne diraju se.
3. **`assertUserInZev` naivno portovan na `parties[0]`** — stvarna sigurnosna regresija, opisana u
   §1.3/§5.1. Zaključati testom, ne samo pregledom koda.
4. **Predsjednik jednog ZEV-a deaktivira nalog aktivan u drugom** — §5.3, rješava se u Koraku 2.
   **Ne isporučivati Korak 2 bez tog guard-a.**
5. **Pogrešno povezan nalog** (predsjednik ukuca tuđu adresu koja postoji). Ublaženo: dvokoračna
   potvrda sa prikazanom (maskiranom) adresom, obavještenje povezanom korisniku, audit zapis,
   i `unlinkUserFromParty` kao potpun povratak unazad. Puna zaštita je invite-flow sa potvrdom sa
   druge strane — §9, P2.
6. **Prekidač tenanta sada mijenja i `partyId`, ne samo `roles`.** Nova klasa korisničkih grešaka:
   plaćanje/prijava kvara upisana u pogrešnu zajednicu. Chip aktivnog ZEV-a iz drugog plana
   (§2.3b) postaje **obavezan dio**, a ne kozmetika — vrijedi to prenijeti u taj dokument.
7. **`displayName` iz "pogrešnog" tenanta** kad korisnik nema `Party` u aktivnom ZEV-u (§3.2).
   Kozmetički, vidi ga samo sam korisnik, ali neka bude svjestan izbor a ne slučajnost.

---

## 9. Pitanja za tebe

- **P1 — Ograničenje "jedan `Party` po korisniku po ZEV-u":** slažeš li se da je to prava granica?
  Alternativa (bez `@@unique`) bi dozvolila da isti čovjek u istom ZEV-u ima dva odvojena lica —
  npr. kao fizičko lice i kao vlasnik firme (`kind: ORGANIZATION`) koja ima poslovni prostor u
  istoj zgradi. **Taj slučaj je stvaran u praksi.** Preporuka je ipak `@@unique`, jer bi bez njega
  `getAuthContext` morao da bira između dva party-ja bez ijednog pravila; firma se i danas vodi kao
  zaseban `Party` (`seed.ts:78`, `ownerFirma`) sa sopstvenim nalogom ako treba. Ali ako želiš da
  jedan login "prebacuje" i između svog fizičkog i firminog lica u istom ZEV-u, to je druga i veća
  izmjena (`Session.activePartyId`) i treba je odlučiti **sada**, prije migracije.
- **P2 — Potvrda sa druge strane pri povezivanju:** v1 je "predsjednik poveže + korisnik dobije
  obavještenje" (§4.2). Pun invite-flow (korisnik mora da prihvati link prije nego što veza
  proradi) traži nova polja na `Party` (`pendingLinkUserId`, `pendingLinkTokenHash`,
  `pendingLinkExpiresAt`) ili nov model, plus rutu za prihvatanje. Ide li to u v1, ili kao Korak 4?
- **P3 — Deaktivacija naloga u više zajednica:** preporuka iz §5.3 je "odbij, ponudi odvezivanje".
  Alternativa je per-membership deaktivacija (`Membership.revokedAt`), koja je konceptualno
  ispravnija ali dodaje kolonu i mijenja `resolveActiveZev`, `assertNotLastActivePresident` i
  revizorski prikaz. Prihvataš li jeftiniju varijantu za sada?
- **P4 — Verzija:** prijedlog 2.6.0 / 2.7.0 / 2.7.1. Ali ovo je **izmjena šeme koja ukida jednu
  potvrđenu odluku iz `docs/multitenancy-plan.md` §8** — po pravilu iz `CHANGELOG.md` ("major je za
  značajniju prekretnicu", i vraća minor na 1) to bi opravdalo **3.1.0** za Korak 1. Tvoja odluka.
- **P5 — Redoslijed u odnosu na drugi plan:** preporuka je da prvo ide
  `tenant-switching-admin-accounts-plan.md` (bar njegovi Koraci 1-2), pa ovaj — obrazloženje u §6.1.
  Ako ti je vlasnik sa dva stana hitniji od prebacivanja, koraci se mogu zamijeniti, ali onda
  Korak 3 ovog plana (test "prebacivanje daje ispravan `partyId`") mora sačekati prekidač.
- **P6 — `docs/multitenancy-plan.md` §8.3:** da li tu odluku **prepisati** (uz datum i pokazivač na
  ovaj plan) ili ostaviti istorijski zapis netaknut i samo dodati napomenu ispod? Preporuka je
  drugo — potvrđene odluke sa datumom su trag odlučivanja, ne trenutno stanje.

---

### Ključni fajlovi za implementaciju

- `prisma/schema.prisma` (modeli `User`, `Party`; nov `@@unique([userId, zevId])`)
- `src/server/auth/session.ts` (`getAuthContext`, `resolveActiveZev`, `AuthContext.partyId`)
- `src/server/services/users.ts` (`createUserForParty`, `assertUserInZev`, `deactivateUser`, nove `link`/`unlink` funkcije)
- `src/app/(app)/vlasnici/page.tsx` i `src/app/(app)/vlasnici/[id]/page.tsx` (tok "Dodaj lice" + kartica "Korisnički nalog")
- `tests/helpers.ts` (`createFixture` — jedino mjesto koje popravlja sve fixture-e) i `tests/tenant-isolation.test.ts` (novi paket "isti čovjek, dva ZEV-a")
- `prisma/seed.ts`, `src/server/services/admin.ts` (`createTenant`), `Plans/tenant-switching-admin-accounts-plan.md` (§4.2/§5.3/§8.1 — uskladiti nakon usvajanja ovog plana)
