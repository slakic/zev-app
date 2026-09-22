# Upravljanje nacrtima prijedloga (izmjena/brisanje) i testno izlaganje glasačkih linkova — plan za pregled

**Status: PRIJEDLOG — čeka odluke korisnika (P1–P7 u §0.3).** Plan-only prolaz
(Opus, bez izmjena koda), zasnovan na stvarnom čitanju `src/server/services/meetings.ts`,
`src/app/(app)/skupstina/**`, `src/server/notifications/**`, `prisma/schema.prisma`,
`tests/helpers.ts` i `e2e/smoke.e2e.mjs` — ne na pretpostavkama.

Dokument pokriva **dvije nepovezane stavke** koje su se pojavile u istoj sesiji:

- **Dio A — Ispravka:** prijedlog u statusu `DRAFT` („tačka glasanja") se danas
  **ne može ni izmijeniti ni ukloniti**. Jedina radnja nad nacrtom je „Otvori
  glasanje", što je nepovratan korak.
- **Dio B — Testiranje:** ne postoji način da se vidi stvarni „magični" link za
  glasanje i verifikacioni kod bez pravog e-mail provajdera, pa se kompletan tok
  glasanja ne može proći kroz pregledač. Tvrd, neprenosiv uslov korisnika:
  **ovo smije biti upotrebljivo isključivo za testiranje i nikada ne smije
  izložiti stvarne produkcione linkove.**

---

## 0.1 Rezime — tri najvažnija nalaza

1. **`updateDraftProposal` postoji i radi, ali ga ne poziva nijedna stranica.**
   `meetings.ts:230-243` ima ispravan guard (`status !== "DRAFT"` → `ForbiddenError`),
   audituje izmjenu i već je pokriven testom (`tests/voting.test.ts` ga uvozi), ali
   u `src/app` ne postoji nijedan obrazac koji ga zove. Funkcija je „mrtav kod sa
   testom" — cijeli Dio A je uglavnom **spajanje postojeće funkcije sa UI-jem**, ne
   pisanje nove logike.

2. **`WITHDRAWN` je jedina vrijednost `ProposalStatus` enuma bez ijednog pisca.**
   Postoji u šemi (`prisma/schema.prisma:564`), ima prevod (`i18n/sr-Latn.ts:126`
   „Povučen") i ima boju badža (`ui.tsx:71` → `slate`), ali nijedna linija koda je
   nikada ne postavlja. Cio put je već pripremljen — fali samo servisna funkcija.

3. **`NotificationMessage.body` **već sadrži** link i kod u čistom tekstu — Dio B
   ne traži nijednu izmjenu u generisanju tokena.** `meetings.ts:473-474` upisuje
   `Vaš lični link za izjašnjavanje: ${d.link}` i `Vaš verifikacioni kod: ${d.verificationCode}`
   direktno u `body` koji `queueNotification` trajno perzistira (`service.ts:29-42`).
   `tests/helpers.ts:188-199` to **već koristi** — regexom vadi token i kod iz outbox
   tijela. Posljedica: izvedivost Dijela B je 100%, a težište plana se pomjera sa
   „kako doći do linka" na **„kako ga izložiti a da se nikada ne izloži u produkciji"**.

## 0.2 Najopasniji pojedinačni nalaz (Dio B)

**Naivna kapija `EMAIL_PROVIDER === "mock"` bila bi OTVORENA na živoj produkciji
već danas.** Tri nezavisne potvrde:

- `providers.ts:75` — `process.env.EMAIL_PROVIDER ?? "mock"`: **neizostavljena
  varijabla znači mock**, dakle loš deployment koji zaboravi varijablu pada u
  „otvoreno", ne u „zatvoreno".
- `docker-compose.yml:39` i `.env.example:27` — `mock` je posvuda podrazumijevano.
- `Plans/ui-ux-redesign-plan.md:59-61` (odluka P9) — **„produkcioni Vercel
  deployment ima `EMAIL_PROVIDER=mock`"**. Nije hipoteza: živa produkcija je
  trenutno u tačno onom stanju koje bi naivnu kapiju otvorilo.

Zaključak koji nosi cijeli §B.3: kapija **ne smije** zavisiti od varijable čija je
podrazumijevana vrijednost „dozvoli". Mora tražiti **eksplicitno prisustvo**
varijable koja u produkciji nikada nije postavljena.

## 0.3 Otvorena pitanja za korisnika

| # | Pitanje | Preporuka plana |
|---|---------|-----------------|
| **P1** | Da li nacrt prijedloga smije da se **trajno briše**, ili samo da se povlači (`WITHDRAWN`)? | **Oboje, sa jasnom granicom** (§A.3, opcija C) |
| **P2** | Smiju li se u nacrtu mijenjati i **obuhvat** (`scopeType`/`buildingId`) i **šifra** (`code`), ne samo tekst? | **Da** — prije glasanja su bezopasni (§A.2) |
| **P3** | Da li i **tačke dnevnog reda** (`AgendaItem`) dobijaju izmjenu/brisanje u istom poduhvatu? | **Ne u ovom obimu** — zabilježena asimetrija (§A.6) |
| **P4** | Površina za testne linkove: konzola, HTML stranica, ili oboje? | **Oboje, u dvije faze** (§B.2) |
| **P5** | Ime i oblik nove env varijable za kapiju | `SHOW_TEST_LINKS="1"` (§B.3) |
| **P6** | Da li se radi i opciono otvrdnjavanje — brisanje tajne iz `body` nakon slanja pravim provajderom? | **Da, ali kao zasebna Faza B3** (§B.7) |
| **P7** | Verzionisanje: jedan minor za oba dijela ili dva odvojena minora? | **Dva minora** (§C.2) |

---
---

# DIO A — Izmjena i uklanjanje prijedloga u statusu „Nacrt"

## A.1 Trenutno stanje (nalazi iz koda)

### A.1.1 Životni ciklus prijedloga, kakav zaista jeste

| Status | Kako se u njega ulazi | Šta se nad njim može uraditi danas |
|--------|----------------------|-------------------------------------|
| `DRAFT` | `createProposal` (`meetings.ts:204`, šema ga podrazumijeva — `schema.prisma:626`) | **samo** „Otvori glasanje" (`prijedlog/[id]/page.tsx:167-171`) |
| `VOTING_OPEN` | `openVoting` (`meetings.ts:396-406`) | ručni glas, revizija (nova verzija), zatvaranje glasanja (`prijedlog/[id]/page.tsx:288-329`) |
| `ACCEPTED` / `REJECTED` | `closeVoting` (`meetings.ts:937-943`) | evidentiranje odluke, ispravka glasa (`prijedlog/[id]/page.tsx:331-365`) |
| `SUPERSEDED` | `createProposalRevision` (`meetings.ts:266`) | ništa (guard na `:259`) |
| `VOTING_CLOSED` | **nikada** — `closeVoting` ide pravo u `ACCEPTED`/`REJECTED` | — |
| `WITHDRAWN` | **nikada** — nijedan pisac u cijelom kodu | — |

Dakle: **dvije od sedam vrijednosti enuma nemaju pisca**, a jedna od njih
(`WITHDRAWN`) je tačno ono što Dio A traži.

### A.1.2 Šta postoji, a nije spojeno

- **`updateDraftProposal` (`meetings.ts:230-243`)** — `requireRole(actor, "PRESIDENT")`,
  `requireZev`, guard `before.status !== "DRAFT"` sa jasnom sr-Latn porukom
  („Prijedlog je zamrznut … Kreirajte novu verziju."), validacija
  `votingRuleId` protiv `zevId`, i `audit(... "proposal.update" ...)`. Potpis prima
  `title`, `text`, `rationale`, `financialImpact`, `votingRuleId`, `votingOpensAt`,
  `votingClosesAt`. **Nula pozivalaca u `src/app`.**
- **`proposal.update` je već klasifikovan** u `src/lib/activity/catalog.ts:49`
  (`GOVERNANCE`) i već ima prevod u `i18n/sr-Latn.ts:350` („Izmijenjen prijedlog
  odluke") — dakle izmjena nacrta se **odmah pojavljuje u `/aktivnosti`** bez
  ijedne dodatne linije.
- **`WITHDRAWN`** — šema `:564`, prevod `:126` („Povučen"), tonalitet badža
  `ui.tsx:71` (`slate`). Fali samo pisac.

### A.1.3 Šta ne postoji nigdje

- Nema `deleteProposal`, `withdrawProposal`, niti bilo kakvog `prisma.proposal.delete`
  poziva — samo negenerisani, nekorišteni Prisma `.delete`/`.deleteMany`.
- Nema obrasca za izmjenu prijedloga nigdje u `src/app`.
- `AgendaItem` je isto tako **samo-dodavanje**: `addAgendaItem` (`meetings.ts:97-109`)
  i obrazac na `skupstina/[id]/page.tsx:193-199`; nema ni izmjene ni brisanja.

### A.1.4 Referencijalni integritet — da li je tvrdo brisanje nacrta uopšte bezbjedno?

Provjereno u `prisma/schema.prisma`, red po red:

| Referenca na `Proposal` | Ponašanje | Postoji li za `DRAFT`? |
|---|---|---|
| `ProposalUnit.proposalId` (`:648`) | `onDelete: Cascade` | Da (ako je obuhvat po jedinicama) — briše se sa njim |
| `EligibleVoter.proposalId` (`:659`) | `onDelete: Cascade` | **Ne** — kreira se tek u `openVoting` (`meetings.ts:413`) |
| `ApprovalToken.eligibleVoterId` (`:686`) | `onDelete: Cascade` preko `EligibleVoter` | **Ne** — `meetings.ts:425` |
| `Vote.proposalId` (`:725`) | bez kaskade (restrict) | **Ne** — glas traži token ili `recordManualVote`, oboje zahtijevaju `VOTING_OPEN` |
| `Proposal.supersedesId` (`:614`) | `@unique`, self-relacija | **Ne** — nastaje samo u `createProposalRevision` |
| `Attachment.proposals` (`:1458`, implicitna M:N) | kaskada nad spojnom tabelom | **Ne** — relacija `"ProposalAttachments"` **nema nijednog pisca u cijelom kodu** (provjereno); prilozi se vezuju labavo, preko `linkedType`/`linkedId` (`attachments.ts:94`) |
| `Document.sourceType = "Proposal"` (`documents.ts:630`, `:670`) | labav string, bez FK | **Ne** — nastaje tek uz odluku/glasačku listu |
| `AuditEvent.targetId` (`:1544`) | labav string, bez FK | Da — **i ostaje** nakon brisanja |

**Zaključak:** tvrdo brisanje prijedloga u statusu `DRAFT` je referencijalno
potpuno bezbjedno. Jedina „viseća" referenca koja preživi je `AuditEvent` — a to
je **tačno ono što želimo**, jer je audit trag i dalje sistem zapisa.

Jedan nalaz koji ublažava, ali ne poništava, argument „nacrt niko nije vidio":
**kartica „Prijedlozi" na `skupstina/[id]/page.tsx:202-262` nije zaštićena
`isPresident` uslovom** — svaki vlasnik vidi nacrte u listi prijedloga sjednice, a
`prijedlog/[id]/page.tsx:136-155` ima i punu vlasničku granu. Dakle nacrt
**jeste** vidljiv vlasnicima prije glasanja, iako o njemu nije poslata nijedna
poruka (`queueNotification` za sjednicu — `skupstina/[id]/page.tsx:95-105` —
šalje samo poziv sa naslovom sjednice, bez ijednog prijedloga).

## A.2 Koja polja nacrta smiju da se mijenjaju (P2)

`createProposal` (`meetings.ts:170-228`) prima 13 polja; `updateDraftProposal`
(`:230`) prima 7. Razlika je nastala usput, ne odlukom:

| Polje | U `createProposal` | U `updateDraftProposal` danas | Preporuka | Obrazloženje |
|---|---|---|---|---|
| `title`, `text`, `rationale`, `financialImpact` | da | **da** | zadržati | Sadržaj se zamrzava tek u `openVoting` (`contentHash`, `:394`) |
| `votingRuleId` | da | **da** (uz `findUniqueOrThrow` na `zevId`) | zadržati | `ruleSnapshot` nastaje tek pri otvaranju (`:384-393`) |
| `votingOpensAt`, `votingClosesAt` | da | **da** | zadržati | `openVoting:335` ionako pada nazad na `meeting.eVoteClosesAt` |
| `code` | da | **ne** | **dodati** | `@@unique([zevId, code, version])` (`:643`) sam hvata sudar; pogrešna šifra pri unosu je najčešća greška koju korisnik hoće da ispravi |
| `agendaItemId` | da | **ne** | **dodati** | Prijedlog vezan za pogrešnu tačku dnevnog reda je realna greška; validacija već postoji u `createProposal:193-195` (`agendaItemId` mora pripadati istoj sjednici) — preseliti je u zajednički pomoćni izraz |
| `scopeType`, `buildingId`, `entranceId`, `allocationGroupId`, `unitIds` | da | **ne** | **dodati** | Obuhvat određuje **glasačku bazu**, a ona nastaje tek u `openVoting:342-354`. Prije otvaranja glasanja obuhvat nema nikakvu posljedicu — mijenjati ga je bezbjedno; **poslije** je nemoguće i tako i treba da ostane |
| `version`, `supersedesId`, `status`, `contentHash`, `ruleSnapshot`, `frozenAt`, `resultSummary`, `decisionNumber` | ne | ne | **nikada ne dodavati** | Sve to je mašinerija verzionisanja i dokaza; ručna izmjena bi razbila lanac `createProposalRevision`/`closeVoting` |

**Odluka (P2): proširiti potpis `updateDraftProposal` na sva polja koja
`createProposal` prima, osim mašinerije iz zadnjeg reda.** Time obrazac za
izmjenu postaje ogledalo obrasca za unos (isti `Field`-ovi, isti `select`-i), što
je i najlakše korisniku i najlakše za održavanje. `unitIds` traži `deleteMany` +
`create` nad `ProposalUnit` unutar transakcije (jedini dio koji nije trivijalan
`prisma.proposal.update`).

## A.3 Brisanje vs. povlačenje (P1) — opcije

Projektna smjernica koja se ovdje aktivira: *„Audit trail is append-only … a fix
to bad historical data must always be a new corrective write, never an edit or
delete in place"* (`zev-app-guidelines`). Pitanje je da li se ona **odnosi** na
nacrt. Odgovor mora biti eksplicitan, ne izbjegnut:

> **Ta smjernica štiti dokaz, a nacrt prijedloga nije dokaz.** Nacrt nema
> `contentHash`, nema `ruleSnapshot`, nema nijednog `EligibleVoter`, nijedan
> izdat token, nijedan glas, nijedan generisani dokument i nijednu poslatu poruku
> (§A.1.4). Nije stvorio nikakvo pravno dejstvo. **Ali** — audit trag o njegovom
> nastanku (`proposal.create`) postoji i, po istoj smjernici, **mora da preživi**
> brisanje reda. To je granica: briše se **red**, nikada **trag**.

| # | Opcija | Prednosti | Nedostaci | |
|---|--------|-----------|-----------|---|
| A | **Samo tvrdo brisanje** `DRAFT` prijedloga | Najjednostavnije; lista prijedloga ostaje čista; greška pri unosu nestaje bez traga u UI-ju | `WITHDRAWN` ostaje mrtva vrijednost enuma; nema načina da se označi prijedlog koji je **svjesno odustan** (a vlasnici su ga već vidjeli u listi — §A.1.4) | |
| B | **Samo `WITHDRAWN`** (meko povlačenje) | Ništa se ne gubi; enum dobija pisca; potpuno u duhu „append-only" konvencije | Greška pri unosu („P-2026-01 je bio duplikat, samo sam se zabunio") **zauvijek stoji u listi** kao „Povučen" — lista sjednice se puni šumom; korisnik je tražio da može da **ukloni** pogrešnu tačku | |
| C | **Oboje, sa objektivnom granicom**: `WITHDRAWN` je podrazumijevano i uvijek dostupno; tvrdo brisanje samo dok sjednica **nije prešla** u `INVITATIONS_SENT` | Rješava oba slučaja, a granica nije subjektivna procjena („da li je neko vidio?") nego **stanje u bazi** koje se može provjeriti u guardu; audit `proposal.delete` sa punim `before` snimkom čuva sadržaj zauvijek | Dvije radnje umjesto jedne — predsjednik mora razumjeti razliku; dva dugmeta na kartici | **✓ preporuka** |
| D | Ne raditi ništa (status quo) | — | Prijavljeni problem ostaje nerješen | |

**Preporuka: C.** Granica `meeting.status` se bira namjerno: `INVITATIONS_SENT`
je jedini trenutak u kodu u kojem aplikacija **sama** pošalje nešto vlasnicima o
sjednici (`skupstina/[id]/page.tsx:74-107`). Prije njega je dnevni red interna
priprema; poslije njega je saopšten materijal. `MEETING_FLOW` (`meetings.ts:21-25`)
daje uredan način da se to provjeri poređenjem indeksa, bez nabrajanja statusa.

Konkretno pravilo u guardu `deleteDraftProposal`:

```
status === "DRAFT"
  && MEETING_FLOW.indexOf(meeting.status) < MEETING_FLOW.indexOf("INVITATIONS_SENT")
  && eligibleVoters.length === 0        // strukturno uvijek tačno; provjera je pojas i tregeri
  && votes.length === 0
```

Ako bilo koji uslov padne → `ForbiddenError` sa porukom koja **upućuje na
povlačenje**: „Sjednica je već saopštena vlasnicima — prijedlog se ne može
obrisati, ali može biti povučen."

## A.4 Preporučeni pristup — konkretno

### A.4.1 Tri servisne funkcije u `src/server/services/meetings.ts`

1. **`updateDraftProposal` — proširiti** (postojeća, `:230-243`)
   - Potpis dobija `code`, `agendaItemId`, `scopeType`, `buildingId`, `entranceId`,
     `allocationGroupId`, `unitIds`.
   - Validacije se **dijele** sa `createProposal` — izdvojiti privatni
     `assertProposalRefs(tx|prisma, zevId, meetingId, data)` koji radi tačno ono
     što `createProposal:193-203` danas radi inline (agendaItem pripada sjednici,
     building/entrance/allocationGroup pripadaju ZEV-u, sve jedinice pripadaju ZEV-u).
     Ovo je jedina „refaktorska" stavka u Dijelu A i vrijedi je uraditi jer se
     inače ista validacija piše dvaput.
   - `unitIds` → `prisma.$transaction`: `proposalUnit.deleteMany({ where: { proposalId } })`
     pa `createMany`. Samo kad je `unitIds !== undefined` (razlika između „nisam
     dirao" i „postavi na praznu listu").
   - `audit` ostaje `"proposal.update"`, ali `before`/`after` proširiti sa
     `code`/`scopeType` (danas nosi samo `title`, `:241`) — inače izmjena obuhvata
     nije vidljiva u `/aktivnosti`.

2. **`withdrawProposal(actor, id, reason)` — nova**
   ```
   requireRole(actor, "PRESIDENT"); zevId = requireZev(actor)
   before = findUniqueOrThrow({ id, zevId })
   if (before.status !== "DRAFT") throw ForbiddenError(...)   // vidi napomenu ispod
   if (!reason.trim()) throw new Error("Povlačenje prijedloga zahtijeva razlog.")
   update → { status: "WITHDRAWN" }
   audit(actor, { action: "proposal.withdraw", targetType: "Proposal", targetId: id,
                  before: { status: before.status }, after: { status: "WITHDRAWN" }, reason })
   ```
   **Namjerno ograničenje na `DRAFT` u ovoj fazi.** Povlačenje već otvorenog
   glasanja je zasebna, teža odluka (šta biva sa izdatim tokenima i već predatim
   glasovima — `closeVoting:931-936` ih gasi, `createProposalRevision:262-265` ih
   poništava). Ne rješavati usput; zabilježeno u §A.9 kao moguće proširenje.

3. **`deleteDraftProposal(actor, id)` — nova**
   ```
   requireRole(actor, "PRESIDENT"); zevId = requireZev(actor)
   prisma.$transaction(async (tx) => {
     p = findUniqueOrThrow({ id, zevId }, include: { meeting: true,
                                                     _count: { eligibleVoters, votes } })
     // guard iz §A.3
     audit(actor, { action: "proposal.delete", targetType: "Proposal", targetId: id,
                    before: { code, version, title, text, rationale,
                              financialImpact, scopeType, status, meetingId },
                    reason }, tx)          // audit PRIJE brisanja — sadržaj se čuva u tragu
     await tx.proposal.delete({ where: { id, zevId } })   // ProposalUnit ide kaskadom
   })
   ```
   **`audit` se poziva prije `delete` i unutar iste transakcije** — audit tabela
   ima trigger koji zabranjuje `UPDATE`/`DELETE` (`schema.prisma:1529`), pa
   `before` snimak postaje trajan zapis sadržaja obrisanog nacrta. Ovo je ono što
   čini tvrdo brisanje prihvatljivim u projektu koji je inače append-only.

### A.4.2 Katalog radnji i rječnik — obavezno, inače pada test

`tests/activity-catalog.test.ts` skenira izvorni kod regexom
`action:\s*"([a-zA-Z0-9_.]+)"` i **pada** ako nađe akciju koje nema u
`ACTION_CATEGORY`. Dakle obavezno:

- `src/lib/activity/catalog.ts` (uz postojeće `:47-52`):
  `"proposal.withdraw": "GOVERNANCE"`, `"proposal.delete": "GOVERNANCE"`
- `src/lib/i18n/sr-Latn.ts`, u već postojećoj **ugniježđenoj** grupi
  `auditAction.proposal` (`:347-353`):
  `withdraw: "Povučen prijedlog odluke"`, `delete: "Obrisan nacrt prijedloga"`
- `src/lib/i18n/en.ts` — isti ključevi (rječnik ima `en` paralelu; `t()` pada
  nazad na sr-Latn, ali ostavljati rupu je nepotrebno)

Napomena o obliku: ključevi **moraju** biti ugniježđeni (`proposal: { withdraw: ... }`),
nikad ravni (`"proposal.withdraw"`), jer `lookup()` (`i18n/index.ts:15-22`) dijeli
ključ po tački i hoda objektom — ravan ključ tiho vraća sam ključ.

### A.4.3 Ostali i18n ključevi — provjereno, nisu potrebni

- `proposalStatus.WITHDRAWN` → **postoji** (`sr-Latn.ts:126`, „Povučen").
- `StatusBadge` tonalitet za `WITHDRAWN` → **postoji** (`ui.tsx:71`, `slate`).
- Labele obrazaca i naslovi kartica: stranice u `skupstina/**` pišu sr-Latn tekst
  **inline** (npr. `prijedlog/[id]/page.tsx:317` „Izmjena prijedloga (materijalna
  promjena)"), a rječnik se koristi za enume, prazna stanja i navigaciju. Novi
  tekst u Dijelu A prati taj isti obrazac — **ne uvoditi novu i18n grupu za
  labele** samo zbog ove izmjene.
- Servisne poruke o grešci: `meetings.ts` ih piše inline na sr-Latn
  (`:236`, `:332`, `:356`) — nastaviti isto.

## A.5 Razmještaj u UI-ju (`prijedlog/[id]/page.tsx`)

Stranica već ima uspostavljen obrazac: **po jedna sekcija kartica po statusu**,
gejtovana sa `isPresident && p.status === X`:

- `:167-171` — `DRAFT` → dugme „Otvori glasanje" u `PageHeader.actions`
- `:288-329` — `VOTING_OPEN` → `grid lg:grid-cols-2` sa „Unos papirnog glasa" +
  „Izmjena prijedloga (materijalna promjena)"
- `:331-365` — `ACCEPTED || REJECTED` → „Evidentiraj odluku" + „Ispravka glasa"

**Preporuka: dodati četvrtu, simetričnu sekciju za `DRAFT`**, tačno iznad
sekcije za `VOTING_OPEN`:

```
{isPresident && p.status === "DRAFT" && (
  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
    <Card title="Izmjena nacrta prijedloga"
          hint="Nacrt se može slobodno mijenjati dok glasanje nije otvoreno.">
       …puni obrazac, `defaultValue` iz p…
    </Card>
    <Card title="Uklanjanje nacrta">
       …ConfirmAction „Povuci prijedlog” (caution)…
       …ConfirmAction „Obriši nacrt” (danger) — samo kad je brisanje dozvoljeno…
    </Card>
  </div>
)}
```

Obrazloženje izbora (naspram zasebne `/skupstina/prijedlog/[id]/izmjena` rute):

| Opcija | Prednosti | Nedostaci | |
|---|---|---|---|
| Zasebna ruta za izmjenu | Više prostora za veliki obrazac; čist URL | Nova ruta, novi `requireActor`, novi `Flash`, novi „nazad" tok — sve duplirano; **razbija** obrazac koji cijela stranica već koristi | |
| **Kartica na istoj stranici, gejtovana statusom** | Doslovno isti obrazac kao tri postojeće sekcije; nula novih ruta; predsjednik vidi tekst i obrazac za izmjenu jedno pored drugog | Stranica raste (već je najsloženiji ekran u aplikaciji — `ui-ux-redesign-plan.md` je tako i klasifikuje) | **✓ preporuka** |
| Inline „uredi na licu mjesta" (contenteditable/JS) | Najkraći put do izmjene | Traži klijentski JS; aplikacija je dosljedno server-rendered sa `<details>` idiomom, bez klijentskih formi | |

Ublažavanje rasta stranice: obrazac za izmjenu staviti u
`<details className="group"><ToggleBtn>Izmijeni nacrt</ToggleBtn>…</details>` —
isti idiom kao „Novi prijedlog" na `skupstina/[id]/page.tsx:221-260`. Zatvoren po
podrazumijevanom, pa kartica u mirnom stanju zauzima jedan red.

**Destruktivne radnje idu kroz `ConfirmAction` (`ui.tsx:525`)** — to je kuća već
odlučila (`ui-ux-redesign-plan.md`, odluka P2: puna crvena samo iza obaveznog
koraka potvrde). Konkretno:

- **„Povuci prijedlog"** → `ConfirmAction` sa `triggerVariant="caution"`,
  `confirmVariant="caution"`, obaveznim poljem „Razlog povlačenja" kao `children`
  (`ConfirmAction` to podržava — `ui.tsx:546`), `hiddenFields={{ proposalId: p.id }}`.
- **„Obriši nacrt (trajno)"** → `ConfirmAction` sa `triggerVariant="danger"`,
  `confirmVariant="danger"`, `body` koji doslovno kaže **šta se gubi a šta ostaje**:
  „Prijedlog `{code}` se briše iz evidencije sjednice. Zapis o njegovom nastanku i
  brisanju ostaje u revizorskom tragu i ne može se ukloniti." Prikazuje se **samo**
  kad je brisanje dozvoljeno po §A.3 (stranica računa isti uslov iz `p.meeting.status`
  koji `getProposal` već učitava — `meetings.ts:160`), inače se na tom mjestu
  renderuje jedna rečenica zašto brisanje više nije moguće.

Ovo bi bila **četvrta** upotreba pune crvene u aplikaciji (`ui-ux-redesign-plan.md`
ih broji tri: storniranje uplate, storniranje fakture, suspendovanje ZEV-a) — i
uklapa se u definiciju iz te odluke („stvarno nepovratno"), pa je dosljedno.

## A.6 `AgendaItem` — zabilježena asimetrija (P3)

Korisnikova prijava se odnosi na **prijedloge** („tačke glasanja"). Ali nalaz je
simetričan: `AgendaItem` danas ima **samo dodavanje** (`meetings.ts:97-109`,
`skupstina/[id]/page.tsx:193-199`) — nema ni izmjene naslova, ni promjene
redoslijeda, ni brisanja. Ako predsjednik pogriješi naslov tačke dnevnog reda,
jednako je zaglavljen.

**Preporuka: van obima ovog poduhvata**, ali zabilježeno kao posljedica, ne kao
previd. Ako se kasnije radi, dodatne komplikacije koje treba unaprijed znati:

- `@@unique([meetingId, order])` (`schema.prisma:542`) — brisanje ostavlja rupu u
  numeraciji, a svaka prava „promijeni redoslijed" operacija mora da renumeriše
  unutar transakcije da ne bi pala na jedinstvenom indeksu u međukoraku.
- `AgendaItem.proposals` (`:540`) je **bez kaskade** — brisanje tačke koja ima
  vezane prijedloge bi palo na FK ograničenju. Trebalo bi ili odbiti brisanje, ili
  prvo odvezati (`agendaItemId = null`, kolona je nullable — `:611`).
- Nove akcije bi opet tražile unos u `catalog.ts` i `auditAction.agenda` (danas
  ima samo `add` — `sr-Latn.ts:346`).

## A.7 Skica po fajlovima (Dio A)

| Fajl | Izmjena |
|------|---------|
| `src/server/services/meetings.ts` | (1) izdvojiti `assertProposalRefs(...)` iz `createProposal:193-203`; (2) proširiti `updateDraftProposal:230-243` na sva polja iz §A.2 + `ProposalUnit` sinhronizacija u transakciji + bogatiji `audit` payload; (3) nova `withdrawProposal`; (4) nova `deleteDraftProposal` sa guardom preko `MEETING_FLOW` indeksa i `audit` prije `delete`, sve u jednoj transakciji |
| `src/lib/activity/catalog.ts` | `"proposal.withdraw"` i `"proposal.delete"` → `"GOVERNANCE"` (uz `:47-52`) |
| `src/lib/i18n/sr-Latn.ts` | `auditAction.proposal.withdraw` i `.delete` (ugniježđeno, uz `:347-353`) |
| `src/lib/i18n/en.ts` | isti ključevi |
| `src/app/(app)/skupstina/prijedlog/[id]/page.tsx` | tri nove server akcije (`updateDraftAction`, `withdrawAction`, `deleteDraftAction`) po obrascu postojećih (`:21-126`: `requireActor("PRESIDENT")` → `try/catch` → `redirect(?err=)` → `revalidatePath`); nova `DRAFT` sekcija iz §A.5; `deleteDraftAction` na kraju radi `redirect` na `/skupstina/{meetingId}?msg=…`, ne `revalidatePath` (prijedlog više ne postoji) |
| `src/app/(app)/skupstina/[id]/page.tsx` | `searchParams` proširiti sa `msg` i proslijediti ga `<Flash err={err} msg={msg} />` (`:150-151`, `:174`) — danas prima samo `err`, pa bi poruka o uspješnom brisanju nestala |
| `tests/voting.test.ts` | novi testovi (§A.8) |
| `CHANGELOG.md`, `package.json`, `package-lock.json` | obavezan unos + potvrđeni bump (§C.2) |

**Bez migracije šeme.** `WITHDRAWN` već postoji u `ProposalStatus`, nema novih
kolona. Dakle pravilo „provjeri Neon prije push-a" iz projektnih smjernica se
**ne aktivira** za Dio A — ali to treba potvrditi pogledom u `prisma/migrations/`
pri isporuci, ne pretpostaviti.

## A.8 Testovi (Dio A)

U `tests/voting.test.ts` (već uvozi `updateDraftProposal`), koristeći
`createProposalFixture` i `openVotingWithLinks` iz `tests/helpers.ts`:

1. izmjena nacrta mijenja tekst **i obuhvat**, i piše `proposal.update` audit sa
   `before`/`after` koji sadrže promijenjena polja;
2. izmjena nakon `openVoting` i dalje pada sa `ForbiddenError` (regresija na
   postojeći guard `:234`);
3. `withdrawProposal` postavlja `WITHDRAWN`, a `openVoting` nad povučenim
   prijedlogom pada („Glasanje se može otvoriti samo iz statusa Nacrt", `:332`) —
   ovo je besplatna posljedica postojećeg guarda i vrijedi je zaključati testom;
4. `withdrawProposal` bez razloga pada;
5. `deleteDraftProposal` briše red **i** `ProposalUnit` redove, a `AuditEvent` sa
   `action: "proposal.delete"` i dalje postoji i sadrži `text` obrisanog nacrta;
6. `deleteDraftProposal` pada kad je sjednica u `INVITATIONS_SENT` ili dalje;
7. `deleteDraftProposal` pada za `VOTING_OPEN` prijedlog (i, posredno, ne ostavlja
   siročad `EligibleVoter`/`ApprovalToken`).

Plus obavezni živi pregled po smjernicama: pokrenuti aplikaciju, Playwright-om
proći `/skupstina/prijedlog/[id]` u statusu `DRAFT` na **1440px i 375px** i
stvarno pogledati snimke — nova sekcija ima dvije kartice u `lg:grid-cols-2`, a
`ConfirmAction` na uskom ekranu otvara amber blok koji nije trivijalno uzak.

## A.9 Rizici (Dio A)

1. **Dva dugmeta za „ukloni" mogu zbuniti.** Ublažavanje: nikad se ne prikazuju
   oba u istom vizuelnom težinskom razredu bez teksta — „Povuci" je `caution` sa
   objašnjenjem „ostaje u evidenciji kao Povučen", „Obriši" je `danger` sa
   objašnjenjem „nestaje iz evidencije sjednice". Ako se pri živom pregledu pokaže
   kao previše — pasti nazad na opciju B (§A.3), ne izmišljati treću varijantu.
2. **Povlačenje `VOTING_OPEN` prijedloga će biti traženo čim `WITHDRAWN` postoji.**
   Namjerno nije u obimu (§A.4.1); kad se bude radilo, mora obraditi gašenje
   aktivnih tokena (obrazac postoji u `closeVoting:931-936`) i sudbinu već predatih
   glasova — to je odluka o dokazu, ne o UI-ju.
3. **`unitIds` sinhronizacija je jedino mjesto u Dijelu A gdje transakcija zaista
   treba.** `deleteMany` + `createMany` bez transakcije ostavlja prijedlog bez
   obuhvata ako drugi upit padne.
4. **Proširen `updateDraftProposal` potpis znači da `createProposal` i on moraju
   ostati u koraku.** Otuda zajednički `assertProposalRefs` — ako se izostavi,
   sljedeće polje dodato u `createProposal` tiho neće biti izmjenjivo.
5. **Regexom vođen test iscrpnosti akcija (`tests/activity-catalog.test.ts`) hvata
   samo literale.** Nove akcije pisati kao obične string literale
   (`action: "proposal.delete"`), nikad kroz promjenljivu ili šablonski string.

---
---

# DIO B — Testno izlaganje glasačkih linkova i verifikacionih kodova

## B.1 Trenutno stanje (nalazi iz koda)

### B.1.1 Gdje tajna zaista postoji, a gdje ne

| Mjesto | Sadrži li čist token/kod? | Referenca |
|---|---|---|
| `openVoting`, lokalni niz `out` | **Da** — `link` i `verificationCode` u čistom tekstu | `meetings.ts:440-448` |
| `ApprovalToken.tokenHash` / `.verificationHash` | **Ne** — samo SHA-256 | `meetings.ts:427-428`, `schema.prisma:688-689` |
| Povratna vrijednost `openVoting` prema pozivaocu | **Ne** — `link` i `verificationCode` su namjerno odsječeni | `meetings.ts:481-483` |
| `AuditEvent` | **Ne** — audituje se samo `tokenId` | `meetings.ts:434-439`, uz `audit.ts` upozorenje „never pass plaintext tokens" |
| **`NotificationMessage.body`** | **DA — u čistom tekstu, trajno** | `meetings.ts:469-478` (link `:473`, kod `:474`); reissue: `:553` |

Dakle **jedino mjesto na kojem tajna preživi** jeste outbox tijelo poruke. To je
i odgovor na pitanje iz zadatka („da li treba hvatati link, ili samo prikazati
ono što već postoji?"): **ne treba hvatati ništa — sve već postoji.**

Sporedan, ali važan nalaz: `service.ts:1-4` nosi komentar „PRIVACY: notification
bodies must never contain balances, debts or other sensitive personal data".
Komentar je formalno ispoštovan (nema salda), ali **tijelo poruke sadrži nosilački
kredencijal** (bearer token) — što je, po posljedici, osjetljivije od salda.
Isto važi za fusnotu na `poruke/page.tsx:52-54` („Sadržaj poruka ne uključuje
salda ni lične finansijske podatke") — tačna je, ali nepotpuna. Oba mjesta treba
dopuniti u sklopu Dijela B, bez obzira koja se opcija izabere.

### B.1.2 Ono što već radi — i za šta niko ne zna

`tests/helpers.ts:188-199` (`openVotingWithLinks`) **već** poziva `openVoting`, pa
očita outbox i regexom izvuče token i kod:

```
const link = m.body.match(/http\S+\/glasanje\/(\S+)/);
const code = m.body.match(/verifikacioni kod: (\d{6})/i);
```

Cijeli `tests/voting.test.ts` radi na tome. Znači: **automatizovano E2E testiranje
kompletnog toka glasanja je već rješivo bez ijedne nove linije produkcionog koda.**

Dodatno: zaglavlje `e2e/smoke.e2e.mjs:3-5` **tvrdi** da
`npm run test:e2e` čita token i kod iz najnovijeg e-maila u outbox-u ako
argumenti izostanu („token+code are read from the newest approval e-mail in the
outbox if arguments are omitted — requires DATABASE_URL"). **Skripta to ne radi** —
`:36-37` čita isključivo `process.argv[2]`/`[3]`, a `DATABASE_URL` se nigdje ne
koristi. Dokumentovano ponašanje koje ne postoji: najjeftiniji dio Dijela B je
naprosto **implementirati ono što zaglavlje već obećava.**

### B.1.3 Postojeća površina outbox-a

`podesavanja/poruke/page.tsx`:
- `requireActor("PRESIDENT", "ACCOUNTANT")` (`:17`) i `where: { zevId }` (`:24`) —
  već je ispravno zaključana i tenant-skopirana;
- prikazuje **samo metapodatke** (`:41-50`: vrijeme, kanal, primalac,
  naslov/šablon, status, broj pokušaja) — **`body` se nigdje ne renderuje**;
- ulaz sa `podesavanja/page.tsx:128` (`BtnLink` „Poslate poruke").

### B.1.4 Raspoloživi signali okruženja i njihova podrazumijevana vrijednost

| Signal | Izvor | Vrijednost kad NIJE postavljen | Bezbjedan po sebi? |
|---|---|---|---|
| `EMAIL_PROVIDER` | `providers.ts:75` | **`"mock"`** | **Ne — pada OTVORENO** |
| `NODE_ENV` | `env.ts:23` (`.default("development")`) | **`"development"`** | **Ne — pada OTVORENO** kad se čita kroz `getEnv()`; u praksi ga `next build`/`next start` i Vercel sami postave na `production`, ali **oslanjati se na to znači oslanjati se na ponašanje alata, ne na odluku** |
| `APP_URL` | `env.ts:27`, obavezan u produkciji (`:51-57`) | greška u produkciji | Nije upotrebljiv kao kapija (staging ima pravi URL) |

`EMAIL_PROVIDER` ima podrazumijevanu vrijednost koja znači „dozvoli" — **ne smije
biti jedina brava.** `NODE_ENV` ovdje ne pomaže na drugi način: u ovom projektu je
identičan i u Docker dev/test okruženju i na pravoj produkciji (vidi ispravku u §B.3),
pa ne razlikuje ništa — nije "slaba dodatna brava", nego brava koja ništa ne brava.

## B.2 Gdje izložiti link/kod (P4) — opcije

| # | Opcija | Prednosti | Nedostaci | |
|---|--------|-----------|-----------|---|
| A | **Playwright/E2E čita `NotificationMessage.body` direktno iz testne baze** (obrazac iz `tests/helpers.ts:188-199`); implementirati ono što `e2e/smoke.e2e.mjs:3-5` već obećava | **Nula produkcionog koda, nula HTTP površine, nula rizika.** Radi već danas u Vitest-u. Rješava automatizovani E2E u potpunosti | Ne pomaže kad korisnik hoće **rukom** da klikne kroz tok u pregledaču — mora prvo pokrenuti skriptu | **✓ obavezna osnova** |
| B | **CLI skripta** `scripts/show-test-links.ts` + `npm run test:links`, ispisuje najnovije linkove/kodove iz outbox-a u konzolu | Korisnikova izričito prihvaćena opcija („kroz konzolu"); nula HTTP površine — **nijedan web korisnik je nikada ne može vidjeti, ni pod kojom konfiguracijom**; radi kroz `docker compose exec app npm run test:links`, što je već uobičajen tok u ovom projektu | Traži prelazak u terminal; kopiranje linka iz konzole u pregledač | **✓ preporuka (Faza B1)** |
| C | **Proširiti `/podesavanja/poruke`** — sadržaj poruke u `<details>` bloku, renderovan samo iza kapije | Najbliže „HTML stranici" koju je korisnik pomenuo; nula novih ruta; već ima ulogu i tenant skop (`:17`, `:24`); link je klikabilan direktno iz tabele | **Uvodi tajnu u produkcionu render putanju.** Jedan pogrešan `&&` ili jedna promašena varijabla i kredencijali su na ekranu | **✓ preporuka (Faza B2), uz kapiju iz §B.3** |
| D | **Zasebna ruta** `/podesavanja/poruke/test` ili `/_test/outbox` | Testni kod fizički odvojen od produkcione stranice; lakše ga je kasnije obrisati u cjelini | Nova ruta koja u produkciji **postoji i odgovara** (makar 404/redirect) je veća napadna površina od jednog `if`-a unutar već zaštićene stranice; duplira `requireActor`/`requireZev`/tabelu | |
| E | **Logovanje u konzolu servera** iz `openVoting` (`docker compose logs`) | Trivijalno | Tajna curi u **log agregator** (na Vercelu: Runtime Logs, vidljivi svakom članu tima, čuvani); to je gore od stranice, ne bolje. Logovi se ne brišu kad se prestane testirati | **odbijeno** |
| F | Ne raditi ništa | — | Korisnik ne može da testira tok glasanja | |

**Preporuka: A + B (Faza B1), pa C (Faza B2).** Obrazloženje kombinacije:

- **A i B ne dodiruju nijednu produkcionu putanju renderovanja.** Skripta i E2E
  pristupaju bazi direktno; ne postoji HTTP ruta koju bi neko mogao pogoditi, ne
  postoji uslov koji može tiho pasti na pogrešnu stranu. Ako se posao zaustavi
  poslije Faze B1, korisnik **ima** ono što je tražio (može proći kroz tok), a
  produkcija nije dobila nijednu novu liniju.
- **C se radi tek poslije**, jer je jedina opcija sa stvarnim rizikom — i zato
  dobija punu kapiju iz §B.3, zaseban test kapije i eksplicitan vizuelni marker u
  UI-ju („TESTNI REŽIM") tako da se pogrešna konfiguracija **vidi**, a ne otkrije
  tek kad neko pročitа tuđi link.
- Sve tri površine dijele **jedan** pomoćni modul, pa se pravilo izvlačenja i
  pravilo kapije pišu tačno jednom.

## B.3 Sigurnosna kapija (P5) — opcije

> **Ispravka unesena tokom implementacije Faze B1 (nije bila vidljiva u plan-only
> prolazu).** Provjereno u `Dockerfile:27`: `ENV NODE_ENV=production` je **tvrdo
> upisan** u sliku koju ovaj projekat koristi i za lokalni Docker razvoj/testiranje
> i (isto ponašanje `next build`/`next start` daje) na Vercel produkciji. `NODE_ENV`
> je dakle **identičan u oba okruženja koja kapija treba da razlikuje** — brava C
> ispod ne razlikuje ništa; uključena kao uslov, samo bi **trajno onemogućila
> `SHOW_TEST_LINKS` tačno u okruženju za koje je napravljen** (Docker dev/test), bez
> ijedne stvarne bezbjednosne dobiti (prava produkcija je i dalje `production`, pa je
> ne bi ni „uhvatila"). Opcija E je zato ispravljena na **D ∧ B** (dvije brave, ne
> tri) — vidi izmijenjenu preporuku i formulu ispod. `NODE_ENV` je uklonjen iz
> implementacije (`src/server/notifications/testOutbox.ts`), sa komentarom koji
> upravo ovo objašnjava.

| # | Kapija | Ponašanje kad je `EMAIL_PROVIDER` neizostavljen | Ponašanje na današnjoj produkciji (Vercel, `EMAIL_PROVIDER=mock`) | |
|---|--------|---|---|---|
| A | `EMAIL_PROVIDER !== "mailjet"` (crna lista) | **otvoreno** | **otvoreno** | **odbijeno** — crna lista je po definiciji zastarjela čim se doda treći provajder |
| B | `EMAIL_PROVIDER === "mock"` (bijela lista) | **otvoreno** (`providers.ts:75` podrazumijeva mock) | **OTVORENO** — potvrđeno `ui-ux-redesign-plan.md:59-61` | **odbijeno samo po sebi** |
| C | ~~`NODE_ENV !== "production"`~~ | ~~zavisi od alata~~ | ~~zatvoreno (Vercel postavlja `production`)~~ | **odbijeno** — `Dockerfile:27` pokazuje da je `NODE_ENV=production` identičan u Docker dev/test okruženju i na pravoj produkciji; ne razlikuje ništa, samo bi trajno gasio funkciju tamo gdje treba da radi |
| D | **Eksplicitan pozitivan opt-in: `process.env.SHOW_TEST_LINKS === "1"`** | zatvoreno (varijable nema) | zatvoreno (varijable nema) | nosiva brava |
| E | **D ∧ B** — konjunkcija dvije brave (~~i C~~, izbačeno) | zatvoreno (D pada) | zatvoreno (D pada) | **✓ preporuka (ispravljeno)** |

**Preporuka: E (D ∧ B).** Ključna osobina koja E razlikuje od svega ostalog: **jedina
brava od koje zavisi bezbjednost je ona čija je podrazumijevana vrijednost
„zabranjeno"** (`SHOW_TEST_LINKS`). `EMAIL_PROVIDER` je tu kao dubinska odbrana — da
bi i namjerno postavljen `SHOW_TEST_LINKS=1` uz pravi provajder i dalje bio
bezuspješan. `NODE_ENV` nije uključen (vidi ispravku iznad) — u ovom projektu ne nosi
informaciju koja bi tu bilo šta razlikovala.

Formalno:

```
izloži testne linkove  ⟺  SHOW_TEST_LINKS === "1"
                        ∧ EMAIL_PROVIDER === "mock"   (bijela lista, ne crna)
```

Napomene o oblikovanju:

- **Striktno poređenje sa `"1"`**, nikad „truthy" provjera: `SHOW_TEST_LINKS=false`
  ili `SHOW_TEST_LINKS=0` su neprazni stringovi i pod truthy pravilom bi otvorili
  kapiju. Ovo je klasična greška i vrijedi je zaključati testom.
- **Bijela lista za provajdera** (`=== "mock"`), ne crna (`!== "mailjet"`) — tako
  je budući treći pravi provajder bezbjedan po podrazumijevanom, tačno po traženom
  pravilu.
- **Gdje živi:** novi modul `src/server/notifications/testOutbox.ts`, jedna
  izvezena funkcija `isTestOutboxEnabled(): boolean` + funkcija za čitanje
  podataka. **Ne u `src/lib/env.ts`** — taj fajl u zaglavlju (`:5-9`) izričito
  objašnjava da `EMAIL_PROVIDER`/`VIBER_PROVIDER` namjerno **ne** idu kroz njegovu
  šemu, nego imaju vlastiti validirani prekidač u `providers.ts` (odluka
  `deployment-portability-plan.md` §2, „opcija B"). Nova varijabla iste prirode
  prati taj isti presedan. Bonus: kapija i pristup podacima su u istom, kratkom
  fajlu koji se može pročitati u cjelini pri svakom pregledu.
- **Ne inline po stranici.** Tri pozivaoca (skripta, E2E, stranica) moraju dijeliti
  istu funkciju — inline uslov bi značio tri mjesta na kojima se može pogriješiti.
- `docker-compose.yml` (lokalni Docker dev/test) sada postavlja i
  `SHOW_TEST_LINKS: "1"` pored postojećeg `EMAIL_PROVIDER: mock` — Vercel produkcija
  ne čita ovaj fajl uopšte, pa ovo ne dopire donde ni posredno.

## B.4 Preporučeni pristup — konkretno

### Faza B1 — bez ijedne produkcione linije

1. **`src/server/notifications/testOutbox.ts`** (novi, ~50 linija):
   - `isTestOutboxEnabled(): boolean` — konjunkcija iz §B.3;
   - `extractApprovalSecrets(body: string): { link: string | null; code: string | null }`
     — regex iz `tests/helpers.ts:195-196`, sada na jednom mjestu;
   - `listApprovalLinks(opts: { zevId?: string; proposalId?: string; limit?: number })`
     — `prisma.notificationMessage.findMany` nad
     `template: { in: ["approval-link", "approval-link-reissue"] }`,
     `orderBy: { createdAt: "desc" }`, pa mapiranje kroz `extractApprovalSecrets`.
     **Ova funkcija sama po sebi ne provjerava kapiju** — provjeravaju je njeni
     pozivaoci koji rendеruju (stranica), jer skripta i testovi je legitimno
     zovu van HTTP konteksta. Kapija se provjerava na **svakoj površini koja
     nešto prikazuje**, i to je zapisano u komentaru fajla.
2. **`scripts/show-test-links.ts`** + `"test:links"` u `package.json` scripts —
   poziva `isTestOutboxEnabled()`; ako je `false`, **ispiše zašto** (koja od tri
   brave nije ispunjena) i izađe sa kodom 1; inače ispiše tabelu
   `primalac | link | kod | status tokena`. Prati obrazac postojećih `tsx` skripti
   (`scripts/promote-super-admin.ts`).
3. **`e2e/smoke.e2e.mjs`** — implementirati ponašanje koje zaglavlje `:3-5` već
   obećava: ako `process.argv[2]` izostane, pročitaj najnoviju `approval-link`
   poruku i izvuci token/kod (isti regex). Time `npm run test:e2e` **postaje
   samostalan** — danas bez ručno proslijeđenog tokena puca na `:38`.
4. **`tests/testOutbox.test.ts`** (novi) — vidi §B.6.
5. **`tests/helpers.ts:188-199`** — `openVotingWithLinks` prelazi na zajednički
   `extractApprovalSecrets` umjesto vlastite kopije regexa.
6. **`.env.example`** — dodati `# SHOW_TEST_LINKS="1"` **zakomentarisano**, sa
   upozorenjem iznad na sr-Latn: „SAMO za lokalni razvoj i testiranje. Nikada ne
   postavljati u produkciji — prikazuje stvarne glasačke linkove i verifikacione
   kodove." Zakomentarisano je bitno: `.env.example` se kopira u `.env`, pa aktivan
   red znači da svako novo okruženje kreće otvoreno.
7. **`README.md`** — kratak pasus u sekciji „Šta je mock / poznata ograničenja"
   (`:175+`), gdje je već objašnjeno da outbox nosi cijeli tok.

### Faza B2 — gejtovani prikaz u outbox-u

8. **`src/app/(app)/podesavanja/poruke/page.tsx`**:
   - `const testMode = isTestOutboxEnabled();`
   - kad je `testMode === true`: iznad tabele **upadljiv `caution` baner** —
     „TESTNI REŽIM: sadržaj poruka, uključujući glasačke linkove i verifikacione
     kodove, je vidljiv. Ovo nikada ne smije biti uključeno u produkciji.";
   - nova kolona/red „Sadržaj" sa
     `<details><ToggleBtn>Prikaži sadržaj</ToggleBtn><pre>{m.body}</pre></details>`
     — `<details>` idiom, bez klijentskog JS-a, u skladu sa ostatkom aplikacije;
     tijelo se renderuje **samo** unutar `{testMode && ( … )}`;
   - kad je `testMode === false`: **ništa se ne mijenja u odnosu na danas** —
     ni kolona, ni baner, ni prazan `<details>`. Uslov gejtuje cijeli JSX, ne samo
     sadržaj unutar njega (prazna kolona bi odala postojanje funkcije i mamila
     pokušaje).
   - dopuniti fusnotu `:52-54` — vidi §B.1.1.
9. **`src/server/notifications/service.ts:1-4`** — dopuniti PRIVACY komentar
   rečenicom da tijela poruka **sadrže** jednokratne glasačke linkove i kodove, pa
   je `NotificationMessage.body` osjetljiv podatak i ne smije se renderovati ni
   logovati bez `isTestOutboxEnabled()`.

## B.5 Skica po fajlovima (Dio B)

| Fajl | Faza | Izmjena |
|------|------|---------|
| `src/server/notifications/testOutbox.ts` | B1 | **novi** — `isTestOutboxEnabled()`, `extractApprovalSecrets()`, `listApprovalLinks()` |
| `scripts/show-test-links.ts` | B1 | **novi** — CLI ispis; bez kapije ne radi ništa osim objašnjenja |
| `package.json` | B1 | `"test:links": "tsx scripts/show-test-links.ts"` |
| `e2e/smoke.e2e.mjs` | B1 | automatsko čitanje tokena/koda kad argumenti izostanu (`:3-5` konačno tačno; `:36-37`) |
| `tests/helpers.ts` | B1 | `openVotingWithLinks:188-199` koristi zajednički regex |
| `tests/testOutbox.test.ts` | B1 | **novi** — testovi kapije (§B.6) |
| `.env.example` | B1 | zakomentarisan `SHOW_TEST_LINKS` sa upozorenjem |
| `README.md` | B1 | uputstvo za testiranje toka glasanja bez pravog e-maila |
| `src/app/(app)/podesavanja/poruke/page.tsx` | B2 | gejtovan prikaz tijela + baner + dopunjena fusnota |
| `src/server/notifications/service.ts` | B2 | dopunjen PRIVACY komentar `:1-4` |
| `CHANGELOG.md`, `package.json`, `package-lock.json` | B1/B2 | obavezan unos + potvrđen bump |

**Bez migracije šeme** — `NotificationMessage.body` već postoji (`schema.prisma:1504`).

## B.6 „Šta nikada ne smije da se desi"

**Scenario od kojeg se branimo, doslovno:**

> Računovođa (ili predsjednik) otvori `/podesavanja/poruke` na **živoj produkciji**,
> proširi poruku upućenu vlasniku Petroviću, pročita njegov lični link
> `https://…/glasanje/<token>` i šestocifreni verifikacioni kod, otvori link u
> anonimnom prozoru i **glasa kao Petrović**. Glas se upisuje kao
> `channel: "ELECTRONIC"` (`meetings.ts:710`), sa Petrovićevom težinom, sa
> `acknowledgementText` koji tvrdi da se izjasnio lično (`ACK_TEXT`,
> `meetings.ts:27-30`), i **nepovratan je** — `Vote` je zaštićen DB triggerom
> (`schema.prisma:719`), a ispravka traži razlog i osnov (`correctVote:859-861`)
> i ostaje vidljiva zauvijek.

Zašto je ovo ozbiljnije nego što izgleda:

- Cijeli sigurnosni model iz zaglavlja `meetings.ts:3-8` — token samo kao hash,
  odvojen verifikacioni kod, jedan token po biraču po verziji — postoji **tačno
  zato** da ni predsjednik ne može glasati umjesto vlasnika. Predsjednik već danas
  može da opozove i ponovo izda token (`revokeToken`, `reissueToken`) — dakle može
  da **ometa** — ali ne može da **glasa u tuđe ime**. Prikaz tijela poruke bi tu
  granicu srušio.
- Odvojena dostava koda i linka je jedina stvar koja razdvaja „imam link" od
  „jesam ta osoba". U outbox tijelu su **oba, jedno ispod drugog** (`:473-474`).
- Meta nije hipotetički napadač spolja: `/podesavanja/poruke` je dostupan
  `PRESIDENT` **i `ACCOUNTANT`** (`:17`). Računovođa nema glasačko pravo, ali bi
  imao pristup svim glasačkim kredencijalima svog ZEV-a.

**Kako preporučeni dizajn to sprječava, po režimu otkaza:**

| Režim otkaza | Ishod pod preporučenom kapijom |
|---|---|
| `EMAIL_PROVIDER` **neizostavljen** u lošem deployment-u (`providers.ts:75` → `"mock"`) | **Zatvoreno.** `SHOW_TEST_LINKS` nije postavljen → kapija pada na prvoj bravi. Ovo je tačno onaj „fail open" scenario koji je tražen da se adresira, i jedini razlog zašto brava D postoji |
| Današnja produkcija ima `EMAIL_PROVIDER=mock` (`ui-ux-redesign-plan.md:59-61`) | **Zatvoreno** — `SHOW_TEST_LINKS` nije postavljen na Vercelu (i nikad neće biti postavljen kroz `docker-compose.yml`, koji Vercel ne čita) |
| Neko kopira `.env.example` → `.env` na produkcionom serveru | **Zatvoreno** — red je zakomentarisan i nosi upozorenje |
| Neko **namjerno** postavi `SHOW_TEST_LINKS=1` na Vercelu | **Otvoreno ako je `EMAIL_PROVIDER` i dalje `mock`** — ovo je jedini scenario koji `NODE_ENV` ne bi ni u originalnom, netačnom dizajnu spriječio (Vercel takođe postavlja `NODE_ENV=production`, kao Docker), pa gubitak te brave ništa ne mijenja u praksi; stvarna odbrana ovdje je operativna (ko ima pristup Vercel env varijablama), ne kod |
| `SHOW_TEST_LINKS="true"` / `"yes"` / `"0"` | **Zatvoreno** — striktno `=== "1"`; zaključano testom |
| Faza B1 se isporuči, Faza B2 nikad | **Nula rizika** — ne postoji HTTP površina; ovo je namjerna osobina redoslijeda faza |
| Neko ukloni `{testMode && …}` iz JSX-a pri kasnijem refaktoru | **Nije pokriveno kapijom** — pokriva se testom iz reda ispod i obaveznim komentarom iznad bloka |

**Testovi u `tests/testOutbox.test.ts` (obavezni, po uzoru na `tests/providers.test.ts:8-22`
koji već čuva i vraća `process.env`):**

1. kapija je `false` kad `SHOW_TEST_LINKS` nije postavljen — **čak i kad je**
   `EMAIL_PROVIDER=mock`;
2. kapija je `false` kad je `SHOW_TEST_LINKS="1"`, ali `EMAIL_PROVIDER="mailjet"` —
   **i za izmišljeni `EMAIL_PROVIDER="sendgrid"`** (dokaz da je bijela lista, ne crna);
3. kapija je `false` za `SHOW_TEST_LINKS` ∈ {`"true"`, `"yes"`, `"0"`, `"false"`, `""`};
4. kapija je `true` za tačan par (`SHOW_TEST_LINKS="1"` + `EMAIL_PROVIDER="mock"` ili
   izostavljen), **i ostaje `true` i kad je `NODE_ENV="production"`** — eksplicitan
   test koji dokumentuje da to nije previd, nego namjera (vidi ispravku u §B.3);
5. `extractApprovalSecrets` izvlači token i kod iz stvarnog tijela koje proizvodi
   `openVoting` (integrativno, preko `openVotingWithLinks`) — štiti od tihe
   promjene teksta e-maila koja bi razbila i regex i E2E.

## B.7 Rizici i opciono otvrdnjavanje (Dio B)

1. **Tajna u `NotificationMessage.body` je latentan problem nezavisan od ovog
   plana.** I bez ijedne izmjene, svako sa pristupom produkcionoj bazi (ili budući
   izvještaj/izvoz nad outbox-om) može pročitati **aktivne** glasačke linkove. To
   djelimično potkopava svrhu hešovanja u `ApprovalToken`.
   **Opciono otvrdnjavanje (P6, predloženo kao zasebna Faza B3):** nakon *uspješne*
   dostave pravim provajderom, zamijeniti link i kod u `body` sa markerom
   (`[uklonjeno nakon slanja]`). Uslovno — **samo kad provajder nije mock** — pa
   lokalno/testno okruženje zadržava današnje ponašanje i sve iz Faze B1 i dalje
   radi. Dvije zamke koje to mora riješiti: (a) `retryFailed()` (`service.ts:97-112`)
   bi ponovo slao očišćeno tijelo — čišćenje smije ići samo poslije statusa
   `SENT`/`DELIVERED`, nikad poslije `FAILED`; (b) `dispatchNotification` čita
   `msg.body` (`:60`), pa se čišćenje radi kao poseban `update` **nakon** slanja.
   Vrijedi uraditi, ali ne miješati sa Fazom B1/B2 — to je izmjena ponašanja
   produkcione dostave, ne testni alat.
2. **Faza B2 uvodi tajnu u putanju renderovanja.** Jedino stvarno ublažavanje su
   (a) kapija koja podrazumijeva „zabranjeno", (b) test koji to zaključava, i (c)
   **vidljiv** baner — pogrešna konfiguracija tako postaje očigledna prvom
   korisniku koji otvori stranicu, umjesto da tiho stoji mjesecima.
3. **Regex je krhka veza između e-maila i testova.** Već danas je tako
   (`helpers.ts:195-196`); objedinjavanjem u `testOutbox.ts` bar postaje jedna
   krhka veza umjesto tri. Test 5 iz §B.6 je taj koji je čuva.
4. **`SHOW_TEST_LINKS` na Vercelu se može postaviti kroz web konzolu, bez
   `git`-a.** Ne postoji način da se to kodom spriječi, a `NODE_ENV` tu ionako ne bi
   pomogao (vidi ispravku u §B.3 — Vercel produkcija je isto `NODE_ENV=production`).
   Jedina stvarna odbrana je operativna (ograničiti ko ima pristup Vercel env
   varijablama) — zato baner iz Faze B2 mora biti glasan, kao posljednja linija
   odbrane koja *jeste* u kodu.
5. **Šuma u outbox-u.** `listApprovalLinks` mora sortirati opadajuće i ograničiti
   broj redova; nakon više proba nad istim prijedlogom postoji više `approval-link`
   poruka za istog primaoca, a **važi samo najnovija** (`reissueToken:519-521`
   stari token prebacuje u `SUPERSEDED`). Skripta treba, uz link, ispisati i
   **status tokena**, inače će korisnik pola vremena kliktati na poništene linkove
   i misliti da je nešto pokvareno.

---
---

# C. Zajednički dio

## C.1 Redoslijed implementacije — preporuka za potvrdu

**Preporuka: Faza B1 → Dio A → Faza B2.** Nije „A pa B" niti „B pa A", i evo
zašto — pitanje nije koja je stavka važnija, nego **šta čini testiranje druge
moguće**:

1. **Faza B1 ide prva jer Dio A bez nje ne može da se provjeri do kraja.**
   Najvažniji test Dijela A nije „da li se obrazac šalje", nego **„da li izmjena
   nacrta zaista stigne do birača"** — tj. da tekst koji vlasnik vidi na
   `/glasanje/<token>` bude izmijenjeni tekst, i da `contentHash` (`meetings.ts:394`)
   bude izračunat nad njim. To se rukom može potvrditi jedino ako se dođe do
   stvarnog linka. Faza B1 je pritom **najjeftinija stavka u cijelom planu** (jedan
   pomoćni modul, jedna skripta, jedna dopuna e2e skripte) i **nema produkcionu
   površinu**, pa ne uvodi rizik koji bi morao čekati pregled.
2. **Dio A ide drugi** jer je to prijavljena smetnja i donosi stvarnu vrijednost
   korisniku; do tada već postoji alat kojim se rezultat provjerava kroz cio tok
   (izmijeni nacrt → otvori glasanje → `npm run test:links` → glasaj → zatvori).
3. **Faza B2 ide posljednja** jer je jedina sa stvarnim bezbjednosnim ulogom.
   Ako se pokaže da je konzola sasvim dovoljna — a vjerovatno hoće — **Faza B2 se
   naprosto ne mora uraditi**, i to je najbolji mogući ishod za bezbjednost.
   Zato je i odvojena, umjesto da bude nerazdvojni dio Dijela B.

Ono što **ne** treba raditi: A i B istovremeno u jednoj isporuci. Dio A dodiruje
`meetings.ts` i `skupstina/**`, Dio B dodiruje `notifications/**` i
`podesavanja/**` — nema preklapanja fajlova, ali ima preklapanja pažnje, a jedna
od dvije stavke nosi kredencijale. Odvojene isporuke znače odvojene preglede.

## C.2 Verzionisanje i obim (P7)

Po konvenciji iz `CHANGELOG.md` i projektnih smjernica — **svaki bump se potvrđuje
sa korisnikom prije nego što se upiše.** Trenutna verzija: `2.21.0`.

| Faza | Obim | Prijedlog bump-a | Migracija šeme? | Neon provjera? |
|------|------|------------------|-----------------|----------------|
| **B1** | `testOutbox.ts`, `scripts/show-test-links.ts`, `e2e/smoke.e2e.mjs`, `tests/`, `.env.example`, `README.md` | minor → `2.22.0` | **ne** | **ne** |
| **A** | `meetings.ts` (+3 funkcije), `catalog.ts`, i18n, `prijedlog/[id]/page.tsx`, `skupstina/[id]/page.tsx`, `tests/voting.test.ts` | minor → `2.23.0` | **ne** (`WITHDRAWN` već postoji u enumu) | **ne** |
| **B2** *(uslovno)* | `podesavanja/poruke/page.tsx`, `service.ts` komentar | minor → `2.24.0` | **ne** | **ne** |
| **B3** *(opciono, §B.7)* | čišćenje tajne iz `body` nakon stvarnog slanja | minor | **ne** | **ne** |

Nijedna faza ne uvodi novi folder pod `prisma/migrations/`, pa se obavezna
provjera Neon produkcione baze **ne aktivira** — ali to se **potvrđuje pogledom
u `prisma/migrations/` pri svakoj isporuci**, ne pretpostavlja.

Obavezno uz svaku fazu, bez izuzetka: `npm run typecheck && npm run lint &&
npm test && npm run build` (sva četiri), pa živi pregled sa Playwright-om za sve
što se vidi — za Dio A to je `DRAFT` stanje `/skupstina/prijedlog/[id]` na 1440px
i 375px, za Fazu B2 `/podesavanja/poruke` u oba režima kapije.

---

### Ključni fajlovi za implementaciju

- **`src/server/services/meetings.ts`** — težište Dijela A i izvor tajne za Dio B:
  `updateDraftProposal` (`:230-243`, ispravan ali bez ijednog pozivaoca),
  `createProposal` validacije za izdvajanje (`:193-203`), `MEETING_FLOW` za guard
  brisanja (`:21-25`), i mjesto gdje čist link i kod ulaze u outbox tijelo
  (`:463-478`, link `:473`, kod `:474`; reissue `:546-557`)
- **`src/app/(app)/skupstina/prijedlog/[id]/page.tsx`** — najsloženiji ekran u
  aplikaciji; obrazac „jedna sekcija po statusu" koji nova `DRAFT` sekcija
  ogledalski prati (`:167-171`, `:288-329`, `:331-365`), i obrazac server akcija
  sa `redirect(?err=)`/`revalidatePath` (`:21-126`)
- **`src/server/notifications/testOutbox.ts`** *(novi)* — jedina kapija i jedini
  put do tajne u Dijelu B; mora se moći pročitati u cjelini u jednom dahu
- **`src/app/(app)/podesavanja/poruke/page.tsx`** — već `PRESIDENT`/`ACCOUNTANT` i
  `zevId`-skopiran (`:17`, `:24`), prikazuje samo metapodatke (`:41-50`); Faza B2
  ovdje dodaje gejtovan prikaz tijela i ispravlja nepotpunu fusnotu (`:52-54`)
- **`src/lib/activity/catalog.ts`** (`:47-52`) + **`src/lib/i18n/sr-Latn.ts`**
  (`auditAction.proposal`, `:347-353`) — bez unosa za `proposal.withdraw` i
  `proposal.delete` pada `tests/activity-catalog.test.ts`, a ključevi moraju biti
  **ugniježđeni**, nikad ravni
- **`tests/helpers.ts`** (`openVotingWithLinks`, `:188-199`) i
  **`e2e/smoke.e2e.mjs`** (`:3-5` obećava ponašanje koje `:36-37` ne implementira)
  — dokaz da Dio B ne traži novu logiku, samo objedinjavanje postojeće
