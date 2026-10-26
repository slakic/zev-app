# FR — Registar posebnih dijelova i glasanje po etažnim vlasnicima — implementacioni plan

**Status: PLAN ZA PREGLED (2026-10-24).** Korisnik je 2026-10-24 tražio da se faza FR iz `Plans/design-review-plan.md` §6 pretvori u implementacioni plan. Nijedan red koda još nije napisan.

Plan je nastao čitanjem stvarnog koda (v2.42.0); tvrdnje su vezane za fajl i liniju. Verzija: prijedlog je **minor → 2.43.0**, a potvrđuje se prije upisa (patch / minor / major).

## Odluke na kojima plan počiva (korisnik, 2026-10-24)

- **K-02:** prije prvog vlasnika utvrđuje se tačan i konačan registar posebnih dijelova. Pravila kvoruma i većine primjenjuju se tek nad utvrđenim registrom.
- **K-03:** svaki vlasnik **bilo kog** posebnog dijela, uključujući garaže i garažna mjesta, je etažni vlasnik. Jedan etažni vlasnik ima **jedan glas**, bez obzira na broj posebnih dijelova. Kvorum i većina se uvijek računaju po broju glasova, bez duplikata. Procenti udjela i površina se za glasanje ne koriste.
- **K-03a:** suvlasnici istog posebnog dijela **zajedno imaju jedan glas**, preko zajedničkog predstavnika.
- **K-01 / K-01a:** zbir vlasničkih udjela na jedinici (ispod ili iznad 100%) **nikad ne blokira** dodavanje vlasnika, nego se prikazuje kao upozorenje.
- **K-01b** (preformulisano u K-03): jedinica sa zbirom iznad 100% blokira **otvaranje glasanja**, jer bi prethodni vlasnik dobio glas.
- **FR-Q3:** utvrđen registar mijenja predsjednik, uz obavezan razlog i dokument. Izmjena je zabranjena dok traje bilo koje glasanje, a svaka izmjena je nova verzija registra.
- **FR-Q4:** postojeći ZEV-ovi prelaze u režim **„Za provjeru”**:
  - dodavanje vlasnika i dalje radi;
  - predsjednik dobija zadatak da registar provjeri i utvrdi;
  - novo glasanje se ne otvara dok registar nije utvrđen.
- **K-03b — ODLUČENO (korisnik, 2026-10-26):** lice daje **najviše jedan glas ukupno**. Ko je samostalni vlasnik jednog posebnog dijela, ne glasa i za zajednicu u kojoj je suvlasnik: zajednica zadržava svoj glas, ali ga daje predstavnik koji već ne glasa kao samostalni vlasnik (primjer: Nikola — Garaža 4 sam i Stan 3 sa Sarom → Nikola 1 glas, zajednica Stana 3 preko Sare). Podrazumijevani predstavnik preskače takve članove; izričito određen takav predstavnik blokira otvaranje glasanja (preduslov, poruka imenuje zajednicu); zajednica čiji su svi članovi samostalni vlasnici nije poseban subjekt (registar to prikazuje kao informaciju). Zamrznuti snimci se ne preračunavaju. Bez migracije; implementirano u `assemblyVotingSubjects` (v2.53.0). Raniji prijedlog („dva glasačka subjekta”) je time zamijenjen.

Mockup: `Plans/design-review/mockups/X-M04-registar-posebnih-dijelova.html`.

---

## 0. Rezime

1. **Model:**
   - `Zev` dobija stanje i verziju registra.
   - Nova append-only tabela `UnitRegisterChange` čuva svaku izmjenu.
   - `Unit` dobija `votingRepresentativeId` (zajednički predstavnik suvlasnika).
   - `UnitType` dobija `GARAGE_SPACE` („Garažno mjesto”).
   - `EligibleVoter` dobija `subjectKey` i `memberPartyIds`, pa jedan glasački subjekt može imati više lica.
   - Jedna migracija bez brisanja podataka, plus jednokratna skripta za konverziju pravila glasanja.
2. **Kapije:**
   - Jedinice se slobodno mijenjaju samo dok registar nije utvrđen; nakon toga samo kroz „Izmjenu registra”.
   - Vlasnik se ne može dodati u **novom** ZEV-u prije utvrđenog registra.
   - Glasanje skupštine se ne otvara bez utvrđenog registra, sa posebnim dijelom bez vlasnika, ili sa jedinicom iznad 100%.
3. **Glasanje skupštine:**
   - Osnova je lista **glasačkih subjekata** (samostalni vlasnik ili suvlasnička zajednica), sa težinom 1.
   - Postojeća pravila se prevode na „jedan etažni vlasnik — jedan glas” i kvorum po broju. Rezultati se time ne mijenjaju, jer je težina svakog glasa 1.
   - Glasanje upravnog odbora se ne mijenja.
4. **UI:**
   - registar na tabu „Posebni dijelovi” (X-M04);
   - zajednički predstavnik i upozorenja o zbiru na „Vlasništvo”;
   - forma pravila glasanja bez izbora težine;
   - prozivka uživo po subjektu;
   - rezultat glasanja u broju glasova.
5. **Produkcija:** ručna migracija prije deploy-a, zatim skripta konverzije. Postojeći ZEV-ovi ostaju u režimu „Za provjeru” dok ih predsjednik ne utvrdi. Glasanja koja su već otvorena završavaju se po zamrznutom `ruleSnapshot`-u.

---

## 1. Zatečeno stanje (provjereno u kodu)

| Šta | Gdje | Posljedica |
|---|---|---|
| Jedinice se dodaju i mijenjaju bilo kad, i nakon upisa vlasnika i otvaranja glasanja | `property.ts:113-163` (`createUnit`, `updateUnit`), `zgrade/page.tsx:34`, `actions/property.ts:30` | nema „utvrđenog” registra |
| `updateUnit` mijenja i `ownershipShare`, ali audit zapisuje samo oznaku, površinu i broj korisnika | `property.ts:156-160` | promjena udjela je nevidljiva u revizorskom tragu |
| Zbir udjela jedinica od 100% je samo informativan | `zgrade/page.tsx:94, 210-213` | — |
| `UnitType` = `APARTMENT`, `BUSINESS`, `GARAGE`, `OTHER` | `schema.prisma:328` | nema „Garažno mjesto” |
| Dodavanje udjela odbija zbir iznad 100% | `ownership.ts:136-138` | suprotno K-01a |
| Osnova glasanja je **po licu**: grupiše udjele po `ownerId` i sabira udio i površinu | `ownership.ts:475-505` | suvlasnici Stana 3 imaju dva glasa (suprotno K-03a) |
| Težina je konfigurabilna (`PER_OWNER`, `OWNERSHIP_SHARE`, `USABLE_AREA`); seed pravila skupštine su po udjelu | `engines/voting.ts:44-56`, `schema.prisma:629-633`, `prisma/seed.ts:291-300`, forma `skupstina/page.tsx:40-50, 160-180` | suprotno K-03 |
| Kvorum `PERCENT_OF_TOTAL_WEIGHT` sa težinom 1 je numerički isto što i `PERCENT_OF_OWNER_COUNT` | `engines/voting.ts:77-84` | konverzija pravila ne mijenja nijedan rezultat |
| `EligibleVoter` je jedinstven po `(proposalId, ownerId)` | `schema.prisma` (model `EligibleVoter`) | jedno lice ne može biti u dva subjekta istog glasanja (K-03b) |
| `openVoting`, `previewLiveDelivery` i `previewVotingDelivery` uzimaju osnovu iz `loadVotingBasis` | `meetings.ts:813` (od v2.42.0) | jedno mjesto za izmjenu |
| Prozivka uživo uzima osnovu iz `ownersVotingBasis`; prisustvo je po licu (`Attendance`, unique `[meetingId, partyId]`) | `meetings.ts:133-170` | treba red po subjektu |
| Vlasnik vidi svoja glasanja samo ako je `ownerId` ili `proxyId` | `meetings.ts:1724-1741` (`openProposalsForOwner`), `ownVotes` `:1744`, `prijedlog/[id]/page.tsx` („Vaše učešće”) | suvlasnik koji nije predstavnik ne bi vidio glasanje svoje zajednice |
| Seed i test helper dodaju udjele bez ikakvog registra | `prisma/seed.ts:145-154`, `tests/helpers.ts` (`createFixture`) | nova kapija bi bez izmjene oborila seed i sve testove |
| Migracije se izvršavaju naredbu po naredbu; `ALTER TYPE … ADD VALUE` je već korišten | `scripts/migrate.mjs`, `prisma/migrations/20260830154638_add_board_organs` | dodavanje enum vrijednosti je bezbjedno |
| Append-only obrazac: trigger `forbid_update_delete` | `prisma/migrations/20260823180200_append_only_guards` | isti obrazac za `UnitRegisterChange` |

---

## 2. Model podataka (migracija, npr. `20261025100000_fr_unit_register`)

Ime migracije pravi `node scripts/migrate.mjs create fr_unit_register`. Raw `prisma migrate` se ne koristi. Nakon izmjene `schema.prisma` regeneriše se `src/generated/prisma`, koji je commitovan u repozitorijum.

### 2.1 `Zev` — stanje registra

```prisma
enum UnitRegisterStatus { DRAFT ESTABLISHED REVIEW }   // REVIEW = „Za provjeru” (FR-Q4)

model Zev {
  // …
  unitRegisterStatus      UnitRegisterStatus @default(DRAFT)
  unitRegisterVersion     Int                @default(0)
  unitRegisterEstablishedAt DateTime?
  unitRegisterChanges     UnitRegisterChange[]
}
```

Backfill u istoj migraciji: `UPDATE "Zev" SET "unitRegisterStatus" = 'REVIEW' WHERE EXISTS (SELECT 1 FROM "Unit" u WHERE u."zevId" = "Zev".id)`. ZEV bez jedinica ostaje `DRAFT`.

### 2.2 `UnitRegisterChange` — istorija registra (append-only)

```prisma
enum UnitRegisterChangeKind { ESTABLISH ADD_UNIT RETIRE_UNIT MERGE_SPLIT CHANGE_AREA CHANGE_SHARE CHANGE_LABEL CHANGE_TYPE }

model UnitRegisterChange {
  id           String   @id @default(cuid())
  zev          Zev      @relation(fields: [zevId], references: [id])
  zevId        String
  version      Int                       // verzija registra NAKON ove izmjene
  kind         UnitRegisterChangeKind
  reason       String
  attachmentId String?                   // dokument izmjene (FR-Q3); obavezan osim za ESTABLISH
  before       Json                      // pogođene jedinice prije
  after        Json                      // pogođene jedinice poslije
  actorId      String
  createdAt    DateTime @default(now())
  @@unique([zevId, version])
}
```

Isti trigger `forbid_update_delete` kao za `AuditEvent` (`CREATE TRIGGER unit_register_change_append_only …`). Dokument se čuva kao `Attachment` sa novom kategorijom `UNIT_REGISTER_CHANGE`, pa i `AttachmentCategory` dobija vrijednost.

### 2.3 Glasački subjekt na `EligibleVoter`

```prisma
model EligibleVoter {
  // …postojeće…
  subjectKey     String   @default("")   // "P:<partyId>" samostalni vlasnik; "G:<sortirani partyId-jevi>" suvlasnička zajednica; "B:<partyId>" član odbora
  memberPartyIds String[] @default([])   // sva lica subjekta (za samostalnog = [ownerId])
  @@unique([proposalId, subjectKey, ownerId])   // zamjenjuje @@unique([proposalId, ownerId]); vidi §10.6 (povlačenje)
}
```

**Backfill:** `subjectKey = 'P:' || "ownerId"` (za odbor `'B:' || "ownerId"`), `memberPartyIds = ARRAY["ownerId"]`. Zatim se stari unique uklanja, a novi postavlja. Podrazumijevana prazna vrijednost i trodijelni unique postoje zbog povlačenja (§10.6): stari kod upisuje red bez `subjectKey`, a i dalje ne može dva puta upisati isto lice za isti prijedlog.

**Pravilo ostaje:** `ownerId` je **lice koje glasa**, tj. samostalni vlasnik ili predstavnik zajednice. Zato tokeni, `Vote.voterId` / `representedId`, punomoć (`activeProxyFor(…, ownerId)`) i glasačka lista ostaju semantički isti.

**K-03b (odlučeno 2026-10-26):** „jedan glas po licu” je primijenjeno u funkciji koja gradi subjekte (§3.3), model se nije mijenjao.

### 2.4 Zajednički predstavnik i garažno mjesto

```prisma
enum UnitType { APARTMENT BUSINESS GARAGE GARAGE_SPACE OTHER }

model Unit {
  // …
  votingRepresentative   Party?  @relation("UnitVotingRepresentative", fields: [votingRepresentativeId], references: [id])
  votingRepresentativeId String?
}
```

`null` znači „podrazumijevano”: suvlasnik sa najvećim udjelom, a kod jednakih udjela onaj sa ranijim `validFrom`, pa `createdAt`. Podrazumijevani predstavnik se u UI-ju označava „nije potvrđen” (FR-Q4). Eksplicitno postavljen je potvrđen.

---

## 3. Servisni sloj

### 3.1 Registar — novi `src/server/services/unitRegister.ts`

- **`getUnitRegister(actor)`** (PRESIDENT, ACCOUNTANT): vraća stanje, verziju, sažetak (broj dijelova po vrsti, zbir udjela u troškovima, površina, broj bez vlasnika, broj glasova i lica — §3.3), preduslove utvrđivanja (✓/⚠ lista) i istoriju (`UnitRegisterChange`, opadajuće).
- **`establishUnitRegister(actor, { reason? })`** (PRESIDENT):
  - dozvoljeno iz `DRAFT` ili `REVIEW`;
  - preduslovi: bar jedna aktivna jedinica; svaka aktivna jedinica ima oznaku, vrstu i površinu > 0; zbir `ownershipShare` aktivnih jedinica = 100,00 % (tolerancija 0,01).
  - piše `UnitRegisterChange{kind: ESTABLISH, version: 1 ili verzija+1, after: snimak svih jedinica}`;
  - postavlja `ESTABLISHED`, `unitRegisterVersion` i `unitRegisterEstablishedAt`;
  - audit `unit_register.establish`.
- **`changeUnitRegister(actor, input, document)`** (PRESIDENT, samo kad je `ESTABLISHED`), gdje je `input` jedno od: `ADD_UNIT`, `RETIRE_UNIT`, `MERGE_SPLIT`, `CHANGE_AREA`, `CHANGE_SHARE`, `CHANGE_LABEL`, `CHANGE_TYPE`.
  - **Uslovi:**
    - razlog nije prazan;
    - dokument je obavezan;
    - **nijedan prijedlog ZEV-a nije `VOTING_OPEN`**; inače greška sa šifrom prijedloga i rokom;
    - nakon izmjene zbir `ownershipShare` aktivnih jedinica i dalje mora biti 100,00 %.
  - **`CHANGE_SHARE`** zato prima listu jedinica sa novim udjelima.
  - **`RETIRE_UNIT`** postavlja `Unit.active = false` (jedinica se ne briše) i odbija jedinicu koja ima aktivan udio. Vlasništvo se prvo zatvara.
  - **`MERGE_SPLIT`** = ukidanje jedne ili više jedinica plus dodavanje jedne ili više, u istoj transakciji.
  - **Upis:** sve u jednoj transakciji sa `UnitRegisterChange`, `unitRegisterVersion + 1`, `Attachment` i auditom `unit_register.change`.
- **Kapija u `createUnit` / `updateUnit`** (`property.ts:113-163`): kad je registar `ESTABLISHED`, baca grešku „Registar je utvrđen — izmjene idu kroz Izmjenu registra.” U `DRAFT` i `REVIEW` rade kao danas, ali audit `unit.update` zapisuje i `ownershipShare` i `type` prije i poslije.
  - **Ispravka pri pregledu (2026-10-25):** `updateUnit` u `ESTABLISHED` odbija samo stvarnu promjenu **polja registra** (oznaka, vrsta, zgrada, površina, udio u troškovima, aktivnost). Ulazi za obračun (broj korisnika, koeficijent tipa, sprat, ulaz) ostaju uredivi. Prvobitna potpuna kapija bi zaključala obračun. Forma prikazuje polja registra samo za čitanje.
- **Novi ZEV** (admin `createZev` / `upsertZev`) počinje u `DRAFT` (podrazumijevana vrijednost kolone).

### 3.2 Vlasništvo — `src/server/services/ownership.ts`

- **`addOwnershipStake`** (`:119`):
  - **kapija:** registar u `DRAFT` baca grešku „Prvo utvrdite registar posebnih dijelova.”; u `REVIEW` i `ESTABLISHED` radi;
  - **K-01a:** provjera „zbir prelazi 100%” (`:136-138`) **se uklanja**;
  - funkcija vraća `{ stake, unitShareSum }`, a stranica prikazuje upozorenje uz uspjeh ako zbir nije 100%;
  - udio jednog vlasnika i dalje mora biti u (0, 100].
- **`transferOwnership`** (`:160`): ista kapija za `DRAFT`. Prenos zatvara udio prodavca, pa zbir ostaje isti.
- **Novo `setVotingRepresentative(actor, unitId, partyId, { note? }, document?)`** (PRESIDENT):
  - `partyId` mora imati aktivan udio na toj jedinici;
  - postavlja predstavnika na **svim** aktivnim jedinicama sa istim skupom trenutnih vlasnika, da zajednica sa više posebnih dijelova ima jednog predstavnika;
  - audit `unit.voting_representative.set` (sa vrijednostima prije i poslije);
  - zabranjeno dok je prijedlog ZEV-a `VOTING_OPEN`, ako jedinica ulazi u njegov obuhvat. Zamrznuta osnova se ne mijenja, ali predsjednik ne smije misliti da je promijenio ko glasa u toku glasanja.
- **Novo `unitOwnershipWarnings(zevId, unitIds?)`:** jedinice sa zbirom ≠ 100% i jedinice bez ijednog aktivnog udjela. Koriste ga registar, tab „Vlasništvo” i preduslovi glasanja.

### 3.3 Glasački subjekti — zamjena za `ownersVotingBasis`

**Novo `assemblyVotingSubjects(zevId, unitIds?, asOf?)`** u `ownership.ts`. Vraća listu oblika `ownersVotingBasis`, plus nova polja:

```ts
{ subjectKey, ownerId /* ko glasa */, ownerName /* "Ana Savić" ili "Nikola Ilić i Sara Ilić" */,
  email /* email ko glasa */, memberPartyIds, units: [{unitId, label, stakePercent}],
  representativeConfirmed: boolean, ownershipShareSum, areaSum /* ostaju radi kompatibilnosti, ne koriste se za težinu */ }
```

**Algoritam:**
1. Aktivni udjeli u obuhvatu se grupišu po jedinici.
2. **Skup vlasnika** jedinice je sortiran niz `ownerId`-jeva.
3. **Jedinica sa jednim vlasnikom:** subjekt `P:<id>`. Sve takve jedinice istog lica su jedan subjekt (Ana: Stan 1 + Garaža 1).
4. **Jedinica sa više vlasnika:** subjekt `G:<id1>,<id2>,…`. Jedinice sa istim skupom su jedan subjekt.
   - Glasa `votingRepresentativeId` jedinice, ili podrazumijevani suvlasnik iz §2.4.
   - Ako jedinice istog skupa imaju različite predstavnike, uzima se predstavnik jedinice sa najmanjom oznakom, uz upozorenje u preduslovima.
5. **K-03b (odlučeno 2026-10-26):** isto lice može biti član `P:` i `G:` subjekta, ali glasa samo u jednom: u zajednici ne može biti predstavnik ako već glasa kao samostalni vlasnik (§3.3 pravilo u `assemblyVotingBasis`).
6. Odbor ostaje `boardVotingBasis` (`ownership.ts:444`), sa `subjectKey = "B:<partyId>"` i `memberPartyIds = [partyId]`.

**`ownersVotingBasis`** koriste samo `meetings.ts:133` (prozivka) i `:813` (`loadVotingBasis`) — provjereno pretragom. Obje upotrebe prelaze na `assemblyVotingSubjects`, pa se `ownersVotingBasis` uklanja, da ne ostane drugi izvor istine.

### 3.4 Glasanje — `src/server/services/meetings.ts`

- **`loadVotingBasis`** (dodat u v2.42.0) za skupštinu poziva `assemblyVotingSubjects`, umjesto `ownersVotingBasis`. Isto se primjenjuje u `getLiveMeetingState` (`:133`), pa prozivka i osnova glasanja ostaju iz istog izvora.
- **`openVoting`**:
  - za skupštinu se težina **uvijek** računa kao 1, bez obzira na `votingRule.weightMethod`. Pravilo se u `ruleSnapshot` upisuje kao `PER_OWNER`, uz `basisKind: "ASSEMBLY_SUBJECTS"` i `unitRegisterVersion`;
  - `EligibleVoter` se piše sa `subjectKey`, `memberPartyIds`, i `basis: { units, members, representativeConfirmed }`;
  - **preduslovi za skupštinu**, prije transakcije, sa jasnim porukama:
    1. `unitRegisterStatus === "ESTABLISHED"` (inače: „Registar posebnih dijelova nije utvrđen — Zgrade i jedinice › Posebni dijelovi.”);
    2. nijedna aktivna jedinica u obuhvatu bez aktivnog udjela;
    3. nijedna jedinica u obuhvatu sa zbirom udjela iznad 100% (K-01b; poruka imenuje jedinice).
  - Upravni odbor bez izmjene.
- **`previewVotingDelivery(…, "ALL")`** i `previewLiveDelivery` vraćaju i `preconditionErrors: string[]`. Panel potvrde ih prikazuje umjesto dugmeta potvrde, isto kao X-M04 i D2.
- **`classifyLiveDelivery`** (`:740`): subjekt je „prisutan” ako je prisutno **bilo koje** lice iz `memberPartyIds` (ili punomoćnik predstavnika). Zato se `presentOwnerIds` pretvara u provjeru preko članova.
- **`getLiveMeetingState`:**
  - `voters` je lista **subjekata** (`subjectKey`, `ownerName`, `members`, `unitLabels`, `representativeName`);
  - `present` / `marked` se izvode iz `Attendance` članova;
  - akcija prisustva (`recordAttendance` / `recordAttendanceBulk`) za subjekt upisuje prisustvo **predstavnika**. Napomena u prozivci: „Za zajednicu je dovoljno da je prisutan jedan suvlasnik”.
  - Koji je suvlasnik fizički prisutan se u v1 ne bilježi (§13).
- **Vlasnički pogledi:**
  - `openProposalsForOwner` (`:1724`) i provjera „Vaše učešće” na prijedlogu traže i `memberPartyIds: { has: partyId }`;
  - suvlasnik koji nije predstavnik vidi „Za {jedinice} glasa Vaš zajednički predstavnik {ime}” i da li je zajednica glasala, bez prikaza izbora;
  - lični link dobija samo predstavnik (ili njegov punomoćnik), kao i danas preko `ownerId`.
- **`createVotingRule`** (`:398`): za novo pravilo se `weightMethod` više ne prima od forme, nego je uvijek `PER_OWNER`. `quorumType` je `NONE` ili `PERCENT_OF_OWNER_COUNT`; `majorityType` ostaje kakav jeste (sa težinom 1 svi tipovi znače broj glasova). Postojeća enum vrijednost `OWNERSHIP_SHARE` ostaje u bazi radi starih zamrznutih snimaka.

### 3.5 Jednokratna konverzija pravila — `scripts/fr-convert-voting-rules.ts`

Isti obrazac kao `scripts/reset-evote-prefetch-pending.ts`. Skripta je idempotentna i auditirana:
- za svako `VotingRule` sa `weightMethod ≠ PER_OWNER`: `weightMethod → PER_OWNER`;
- `quorumType PERCENT_OF_TOTAL_WEIGHT → PERCENT_OF_OWNER_COUNT` (isti procenat);
- `name` dobija sufiks „ (jedan vlasnik — jedan glas)” ako ga nema;
- audit `voting_rule.convert` po pravilu, sa vrijednostima prije i poslije;
- ispisuje šta je promijenjeno; drugo pokretanje ne mijenja ništa.

Prijedlozi u `DRAFT` dobijaju novo značenje pri sljedećem otvaranju. Zatvoreni i otvoreni prijedlozi su zamrznuti u `ruleSnapshot` i ne preračunavaju se.

---

## 4. UI (po ekranu; samo postojeći primitivi i odluke D2/D3 iz pregleda)

### 4.1 Zgrade i jedinice › Posebni dijelovi (`zgrade/page.tsx`, `unit-row.tsx`) — X-M04 ①③④
- Iznad tabele ide panel „Sljedeći korak” (D2, opcija A: `Card` + lista ✓/⚠ + jedno dugme), dok registar nije `ESTABLISHED`:
  - preduslovi iz `getUnitRegister`;
  - `ConfirmAction` „Utvrdi registar…” (okidač `caution`, potvrda `primary`, po pravilu potvrde iz v2.42.0);
  - tijelo: broj posebnih dijelova po vrsti, zbir udjela u troškovima i posljedica.
- **Status:** `StatusBadge` „Nacrt” / „Utvrđen · verzija N” / „Za provjeru”. U `statusTone` se dodaju ključevi `REGISTER_DRAFT` (slate), `REGISTER_ESTABLISHED` (green), `REGISTER_REVIEW` (amber).
- **Sažetak:** red od 4 postojeća `Stat`-a, bez dodatnog reda teksta: Posebnih dijelova · Glasova (etažnih vlasnika) · Bez upisanog vlasnika · Udio u troškovima.
- **Tabela:**
  - kolona „Udio %” postaje **„Udio u troškovima %”**; brojevi sa decimalnim zarezom;
  - u utvrđenom registru kolona „Zbir udjela vlasnika” sa chipom „100 %”, „Upisano 60 %” ili „Zbir 150 %”, i rečenicom o sljedećem koraku.
- **„Uredi” po redu:** samo u `DRAFT` i `REVIEW`. U `ESTABLISHED` umjesto toga ide dugme „Izmjena registra” u zaglavlju kartice.
- **Kartica „Etažni vlasnici · N glasova · M lica”:** subjekti, kolona „Ko glasa” (sa `RowAction` „Promijeni” za zajednice), i ⚠ za jedinice sa zbirom ≠ 100% i one bez vlasnika.
- **Kartica „Istorija registra”:** verzija, vrijeme, opis i link na dokument.
- **„Dodaj posebni dio”** samo u `DRAFT` i `REVIEW`. Vrsta dobija opciju „Garažno mjesto”, a `tEnum("unitType", "GARAGE_SPACE")` dobija prevod.

### 4.2 Izmjena registra — nova ruta `/zgrade/registar/izmjena` — X-M04 ④
- Forma: vrsta izmjene, jedinica ili jedinice, nove vrijednosti, datum, razlog i dokument (`FilePicker`, obavezan).
- Pregled „prije → poslije” sa zbirom udjela u troškovima koji mora ostati 100,00 %.
- `ConfirmAction` (okidač i potvrda `caution`). Tijelo kaže šta se mijenja, da to **utiče na troškove, a ne na glasanje**, i da nastaje verzija N+1.
- Dok traje glasanje, forma je zamijenjena tekstom (amber, `Card hint`): „Izmjena nije moguća dok traje glasanje o {kod} (do {datum}).” Kad se odobri D4, to postaje `Flash` „upozorenje”.
- **Ruta umjesto `ToggleBtn`:** forma ima pregled „prije → poslije” i dokument; na telefonu bi bila preduga za otvaranje unutar tabele.

### 4.3 Vlasnici i korisnici (`vlasnici/page.tsx`) — X-M04 ②③
- **Tab „Vlasništvo”, registar u `DRAFT`:** prazno stanje „Prvo utvrdite registar posebnih dijelova” sa `BtnLink` (`tonal`) na registar. Forme za dodavanje udjela i prenos se ne prikazuju.
- **Tab „Vlasništvo”, registar u `REVIEW` / `ESTABLISHED`:** forme kao danas.
- **Nakon dodavanja udjela:** `Flash` uspjeha, plus rečenica o zbiru ako nije 100% („Zbir udjela za Stan 3 je sada 150 % — zatvorite udio prethodnog vlasnika (Promjena vlasništva).”).
- **Jedinica dobija drugog suvlasnika:** forma traži polje **„Zajednički predstavnik za glasanje”** (select suvlasnika, podrazumijevan onaj sa najvećim udjelom). Za prvog vlasnika jedinice polje se ne prikazuje.
- **Promjena predstavnika:** `ConfirmAction` (`caution` / `caution`). Tijelo: „Za {jedinice} će glasati {ime}. Važi za glasanja koja se otvore od sada.”
- **Detalj vlasnika** (`vlasnici/[id]`): uz svaku jedinicu, „samostalni vlasnik” ili „suvlasnik — glasa {predstavnik}”.

### 4.4 Skupština › Pravila glasanja (`skupstina/page.tsx:136-180`)
- Forma više nema select „Težina glasa”. Umjesto njega ide tekst (13px): „Svaki etažni vlasnik ima jedan glas; suvlasnici jednog posebnog dijela glasaju zajedno, preko predstavnika.”
- `quorumType` nudi „Bez kvoruma” i „% broja etažnih vlasnika”.
- Labele `majorityType` u rječniku:
  - `PERCENT_OF_ELIGIBLE_WEIGHT` → „% ukupnog broja etažnih vlasnika”;
  - `PERCENT_OF_VOTES_CAST` → „% datih glasova”.
- Kolona „Težina glasa” u tabeli pravila: za skupštinu se ne prikazuje, odnosno prikazuje se kao „1 glas po etažnom vlasniku”.

### 4.5 Prijedlog i režim uživo (`skupstina/prijedlog/[id]/page.tsx`, `agenda-voting.tsx`, `roll-call.tsx`)
- **Rezultat:** za `basisKind: "ASSEMBLY_SUBJECTS"` brojevi se prikazuju kao cijeli brojevi glasova: „Glasalo 2 od 5 · kvorum: potrebno 3”. Ne prikazuju se `formatWeight` decimale ni „udio”. Ovo rješava P-R05 za skupštinu.
- **Osnova:** „Osnova: registar verzija {N} · {broj} glasova ({lica} lica, {dijelova} posebnih dijelova)”.
- **Glasačka baza (tabela):**
  - red po subjektu; zajednica kao „Nikola Ilić i Sara Ilić (predstavnik: Nikola Ilić)”;
  - glasačka lista PDF (`generateVotingListPdf` ili ekvivalent u `documents.ts`) dobija isti tekst. Provjeriti da `pdfTable` prelama dug naziv.
- **Prozivka uživo:** red po subjektu, „prisutan” ako je prisutan bilo koji član; brojač broji glasove („Prisutno 4 od 5”).
- **Potvrda otvaranja glasanja (desktop i uživo):** ako `preconditionErrors` nije prazan, dugme potvrde se ne prikazuje, nego lista razloga sa linkovima na registar ili „Vlasništvo”.

### 4.6 Početna predsjednika (`(app)/page.tsx`)
- Dok je registar `DRAFT` ili `REVIEW`, na vrhu početne ide jedna `Card` sa rečenicom i `BtnLink` („Provjerite i utvrdite registar posebnih dijelova — potrebno prije sljedećeg glasanja.”).
- **Napomena:** ovo je minimalna verzija obrasca „Za Vas sada” (D1, još neodlučen). Kad se D1 odobri, kartica se pretvara u stavku te liste. Ovdje se ne uvodi novi obrazac, samo `Card` + tekst + dugme.

### 4.7 Tekstovi
- Novi tekstovi idu u `sr-Latn.ts` pod `register.*` i `votingSubject.*` (ugniježđeno), kroz `t()` i `tf()`. Dopunjuje se i `en.ts`, jer je v2.42.0 to preskočio (§13).
- Nove audit akcije se upisuju u `src/lib/activity/catalog.ts` i `auditAction.*`, inače pada `tests/activity-catalog.test.ts`:
  - `unit_register.establish`
  - `unit_register.change`
  - `unit.voting_representative.set`
  - `voting_rule.convert`

---

## 5. Seed i test helper

- **`prisma/seed.ts`:**
  - nakon kreiranja jedinica (`:120-140`) poziva se `establishUnitRegister(president, { reason: "Seed" })`, pa tek onda udjeli (`:145-154`);
  - pravila glasanja (`:291-305`) postaju dva pravila po broju etažnih vlasnika: „Redovno upravljanje (>50% etažnih vlasnika, prosta većina)” i „Veći radovi (2/3 ukupnog broja etažnih vlasnika)”. Pravilo „Po vlasniku” se uklanja kao suvišno;
  - Stan 3: `setVotingRepresentative(president, stan3, nikola)`;
  - jedna jedinica vrste „Garažno mjesto” se **ne dodaje**, jer bi promijenila zbir udjela i sve brojeve u postojećim screenshotima i testovima. Vrsta se pokriva testom.
- **`tests/helpers.ts` (`createFixture`):** nakon jedinica poziva `establishUnitRegister` prije udjela. Bez toga sve fixture-e pada nova kapija. Opcija `{ registerStatus?: "DRAFT" | "REVIEW" }` služi testovima kapija.

---

## 6. Testovi

| Fajl | Šta se provjerava |
|---|---|
| `tests/unit-register.test.ts` (novi) | utvrđivanje: preduslovi (bez jedinica, bez površine, zbir ≠ 100) i uspjeh; verzija 1 i istorija; `createUnit`/`updateUnit` odbijeni u `ESTABLISHED`, dozvoljeni u `DRAFT`/`REVIEW`; `changeUnitRegister`: bez razloga ili dokumenta greška, zbir mora ostati 100, odbijen dok je prijedlog `VOTING_OPEN`, `RETIRE_UNIT` odbija jedinicu sa aktivnim udjelom, verzija raste i istorija se dopunjuje; `UnitRegisterChange` je append-only (UPDATE baca); audit `unit.update` sadrži `ownershipShare` |
| `tests/ownership.test.ts` ili postojeći | `addOwnershipStake` u `DRAFT` greška, u `REVIEW` radi; zbir 150% **ne baca** i vraća `unitShareSum`; `setVotingRepresentative` samo za suvlasnika jedinice, primjenjuje se na sve jedinice istog skupa, audit, odbijen u toku glasanja |
| `tests/voting-subjects.test.ts` (novi) | seed-oblik: Ana (2 jedinice) = 1 subjekt, Marko (2) = 1, Nikola + Sara = 1 sa predstavnikom Nikola (podrazumijevano 60%) i nakon promjene Sara; ukupno 5 subjekata za 6 lica i 8 dijelova; jednaki udjeli → raniji `validFrom`; K-03b slučaj daje dva subjekta sa različitim `subjectKey`; isti skup vlasnika na dvije jedinice = 1 subjekt |
| `tests/voting.test.ts` / `live-meeting.test.ts` | `openVoting` skupštine: 5 `EligibleVoter`-a, težina 1, `totalEligibleOwners` 5, `ruleSnapshot.basisKind` i `unitRegisterVersion`; lični link samo predstavniku (Sara nema token); preduslovi (registar nije utvrđen, jedinica bez vlasnika, jedinica 150%) bacaju jasne greške; `previewVotingDelivery` vraća iste `preconditionErrors`; odbor bez izmjene; prozivka: zajednica prisutna kad je prisutna samo Sara; `openProposalsForOwner(sara)` vidi prijedlog |
| `tests/voting-rules-convert.test.ts` (novi) | skripta konverzije: pravilo po udjelu postaje `PER_OWNER` + `PERCENT_OF_OWNER_COUNT`; drugo pokretanje ne mijenja ništa; audit po pravilu; zatvoren prijedlog sa starim snimkom daje **isti** rezultat prije i poslije |
| `tests/activity-catalog.test.ts` | nove audit akcije su klasifikovane (postojeći test hvata propust) |

Postojeći testovi koji računaju težinu po udjelu (npr. `tests/voting.test.ts`, `paymentMatching`, `board`) se pregledaju. Ako neki očekuje težinu po udjelu na **skupštini**, očekivanje se mijenja uz komentar „K-03”, a izmjena se navodi u izvještaju. Rezultati odbora se ne smiju promijeniti.

---

## 7. Dokumentacija

- **`LEGAL_AND_FINANCIAL_ASSUMPTIONS.md`:**
  - §2, red „Odlučivanje skupštine, kvorum i većina”: podrazumijevano pravilo postaje „jedan etažni vlasnik — jedan glas; suvlasnici zajedno jedan glas preko predstavnika”;
  - red „Etažni vlasnici kao članovi skupštine”: vlasnici svih posebnih dijelova, uključujući garaže i garažna mjesta;
  - §3 tačke 2 i 3: odgovoreno odlukama K-03 i K-03a (korisnik, 2026-10-24); oznaka **[PRAVNA PROVJERA]** ostaje samo za K-03b.
- **`Plans/design-system.md`:** novi ključevi u `statusTone`, i obrazac „Sljedeći korak” ako je D2 odobren do tada. Ako nije, plan koristi D2 samo na registru, uz napomenu.
- **`Plans/design-review-plan.md`:** FR status → „U IMPLEMENTACIJI” / „ISPORUČENO u v2.43.0”.
- **`CHANGELOG.md`** (`[2.43.0]`, Dodato / Izmijenjeno) i verzija u `package.json` / `package-lock.json`.

---

## 8. Redoslijed isporuke (četiri commita, jedna verzija)

Svaki commit prolazi pipeline. Verzija se diže tek u zadnjem.

| Korak | Sadržaj | Zašto ovim redom |
|---|---|---|
| **FR-a — Model i registar** | §2 (migracija, regenerisan klijent), §3.1, kapije u `property.ts`, seed i helper (§5), `unit-register.test.ts` | sve ostalo zavisi od stanja registra; seed i helper odmah, da pipeline ostane zelen |
| **FR-b — Vlasništvo i subjekti** | §3.2, §3.3, `voting-subjects.test.ts`, testovi vlasništva | osnova za glasanje |
| **FR-c — Glasanje** | §3.4, §3.5 (skripta), `voting.test.ts` / `live-meeting.test.ts` / `voting-rules-convert.test.ts` | najosjetljiviji dio; izolovan |
| **FR-d — UI i dokumentacija** | §4, §7, `CHANGELOG.md`, verzija | UI nad gotovim servisima |

Implementacija kao u F1: Sonnet po planu, Opus pregleda (posebno §3.3, §3.4 i §3.5) i ponovo pokreće provjere.

## 9. Provjera

- **Pipeline:** `export PATH=~/.local/zev-tools/node/bin:$PATH; npm run typecheck && npm run lint && npm test && npm run build`. Dozvoljene su samo 3 zatečene greške u `tests/env.test.ts`.
- **Migracija lokalno:**
  1. `npm run db:reset && npm run db:seed` na svježoj bazi;
  2. odvojeno, primjena migracije na **kopiju baze sa podacima v2.42.0** (seed v2.42.0 → migracija → skripta), da se provjeri backfill: ZEV u `REVIEW`, `subjectKey` popunjen, stari tokeni i glasovi netaknuti, pravila prevedena.
- **Živi pregled** (1440 i 375, predsjednik, računovođa, vlasnik; Sara kao suvlasnik bez predstavništva ako ima nalog, inače kroz test):
  - **registar:** nacrt → utvrđivanje (X-M04 ①), utvrđen sa vlasnicima i upozorenjima (③), izmjena registra i blokada dok traje glasanje (④);
  - **vlasništvo:** zaključano u `DRAFT`, upozorenje 150% nakon dodavanja, predstavnik pri drugom suvlasniku;
  - **glasanje:** pravila bez težine; otvaranje glasanja odbijeno sa razlozima, pa uspješno nakon ispravke; rezultat „Glasalo X od 5”; prozivka po subjektu;
  - **početna predsjednika** u stanju `REVIEW`.
- **Čišćenje:** `db:reset` + `db:seed`, brisanje skripti za pregled.

## 10. Produkcija (Vercel + baza)

1. **Prije deploy-a**, ručno: `MIGRATE_DATABASE_URL=… node scripts/migrate.mjs apply` (kao u v2.40.0). Migracija je aditivna; jedino se mijenja unique na `EligibleVoter`, uz backfill prije toga.
2. **Deploy v2.43.0.**
3. **Odmah nakon deploy-a:** `npx tsx scripts/fr-convert-voting-rules.ts` nad produkcijskom bazom. Između koraka 2 i 3 nova pravila još nisu prevedena, ali je težina na skupštini ionako forsirana na 1 (§3.4), pa se ništa ne računa pogrešno.
4. **Provjera:** svi ZEV-ovi sa jedinicama su u `REVIEW`; predsjednik vidi zadatak na početnoj.
5. **Već otvorena glasanja** završavaju se po zamrznutom snimku. Nova se ne mogu otvoriti dok predsjednik ne utvrdi registar (FR-Q4). Ovo se unaprijed javlja predsjednicima.
6. **Povlačenje:** vraćanje na v2.42.0 radi sa novom šemom, jer stari kod ne čita nove kolone. **Izuzetak** je unique na `EligibleVoter`: stari kod pri otvaranju glasanja upisuje `(proposalId, ownerId)` bez `subjectKey`, a kolona je NOT NULL.
   - **Mitigacija (ugrađena u §2.3):** `subjectKey` ima `DEFAULT ''`, a unique je `(proposalId, subjectKey, ownerId)`. Tako stari kod i dalje radi, a novi kod uvijek popunjava `subjectKey`.
   - U FR-a se to testira: stari obrazac upisa (bez `subjectKey`) uspijeva, a dupli upis istog lica za isti prijedlog i dalje pada.

## 11. Rizici

- **Promjena osnove glasanja (§3.3–§3.4)** je najrizičniji dio. Ublažava se:
  - testom jednakosti rezultata zatvorenih glasanja prije i poslije;
  - forsiranom težinom 1 na skupštini, nezavisno od pravila;
  - ne-preračunavanjem zamrznutih snimaka.
- **Kapija u `addOwnershipStake`** pogađa seed, helper i sve testove sa vlasnicima. Zato ide u FR-a zajedno sa izmjenom seed-a i helpera.
- **Prisustvo po licu, glas po subjektu:** v1 ne bilježi koji je suvlasnik fizički prisutan (§13).
- **K-03b:** odlučeno 2026-10-26 (jedan glas po licu); vidi odluke na početku dokumenta.
- **Produkcijski ZEV-ovi** ne mogu otvoriti novo glasanje dok predsjednik ne utvrdi registar. To je namjerno (FR-Q4), ali treba ga najaviti.

## 12. Šta FR namjerno ne radi

- Ne uvodi „Za Vas sada” (D1) ni panel „Sljedeći korak” (D2) šire od registra. Početna dobija samo jednu karticu (§4.6).
- Ne mijenja obračun troškova: `ownershipShare` ostaje osnova raspodjele i samo se preimenuje u UI-ju.
- Ne mijenja glasanje upravnog odbora.
- Ne dodaje glasanje u aplikaciji za prijavljenog vlasnika (V-Q1) ni samoposlužno ponovno izdavanje linka (V-Q2).

## 13. Otvoreno

- **Verzija:** prijedlog je minor → 2.43.0.
- ~~**K-03b (pravnik):** podrazumijevano su dva subjekta.~~ Odlučeno 2026-10-26 (korisnik): jedno lice, najviše jedan glas.
- **Prozivka:** treba li bilježiti koji je suvlasnik fizički prisutan, kad zajednicu u sali predstavlja suvlasnik koji nije određeni predstavnik? Prijedlog za v1: predsjednik u sali može promijeniti predstavnika samo prije otvaranja glasanja (§3.2). Bilježenje konkretnog lica ide u kasniju fazu.
- **`en.ts`:** dopuniti grupu `confirm` iz v2.42.0 zajedno sa novim grupama (§4.7).
