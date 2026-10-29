# ZEV onboarding — pozivni link i čarobnjak za kreiranje novog ZEV-a — implementacioni plan

**Status: PLAN, odluke usvojene (2026-10-29), implementacija nije počela.** Nastalo na zahtjev
korisnika (2026-10-29):
*„ZEV onboarding funkcionalnost koja omogućava super adminu da kreira novi ZEV i da pošalje link
potencijalnom klijentu koji će dobiti wizard tip interfejsa koji će ga voditi kroz proces
kreiranja ZEV-a kao novog tenanta. Korisnik će kroz seriju koraka kreirati ZEV, sa svim podacima
(adresom, brojem računa, JIB-om, registrom posebnih i zajedničkih dijelova, listom vlasnika,
određivanje rola i sl.). Ovaj wizard treba da ima validaciju svakog koraka tako da korisnik koji
ispunjava podatke ne može preći na sljedeći korak dok ne popuni sve na tekućem.“*

Zasnovano na čitanju stvarnog koda (v2.55.0). Nastavlja se na `docs/multitenancy-plan.md`
§„Faza 1 — super admin i onboarding“, `Plans/tenant-switching-admin-accounts-plan.md` (početna
lozinka, članstvo super admina) i `Plans/fr-registar-i-glasanje-po-etaznim-vlasnicima-plan.md`
(redoslijed zgrade → registar → utvrđivanje → vlasnici).

## Odluke na kojima plan počiva (korisnik, 2026-10-29)

| # | Pitanje | Odluka |
|---|---|---|
| D1 | Dostava linka i rok | Super admin **ručno** kopira i šalje link; važi **14 dana**; jedan aktivan poziv po e-mailu, novi link poništava stari |
| D2 | Gdje žive podaci tokom čarobnjaka | **JSON nacrt.** `Zev` i svi njegovi zapisi nastaju tek pri objavi, u jednoj transakciji |
| D2a | Nalog pozvanog | `User` nastaje **odmah u koraku 1, bez članstva**. Nacrt pripada tom nalogu, a nastavak ide kroz običnu prijavu. `Party` i `Membership(PRESIDENT)` nastaju pri objavi. Token se troši u koraku 1 |
| D2b | Fajlovi prije nego što ZEV postoji | **Tabela fajlova nacrta** (bajtovi u bazi, kao `AttachmentBlob`); pri objavi se prebacuju u `Attachment` u istoj transakciji |
| D3 | Ko je pozvani | Postaje **PRESIDENT**; e-mail zaključan na adresu iz poziva; postojeći nalog se prijavljuje; dokaz ovlašćenja **nije** obavezan |
| D4 | Zajednički dijelovi | **≥1 zapis vrste `AREA` po zgradi**; korak se ne preskače |
| D5 | Formati | **BiH:** JIB 13 cifara, račun 16 cifara, oba sa kontrolnom cifrom; jedan modul `src/lib/identifiers.ts` koji važi i van čarobnjaka |
| D6 | Dokaz o vlasništvu | **Dokument po udjelu** (kao danas) |
| D6a | Jedinica bez 100% vlasništva | Dozvoljeno **samo uz potvrdu po jedinici** „vlasništvo u sporu — unijeću kasnije“; sve ostale jedinice moraju imati tačno 100% |
| D7 | Paket `BASIC` i korak „Računi“ | Korak se **prikazuje kao opcioni**: može se preskočiti uz potvrdu |
| D8 | Dizajn sistem | Novi primitiv **`StepNav`**; na `/admin/novi` **dvije kartice** (poziv / asistirano kreiranje); mockup prije Faze A |

---

## 0. Rezime — pročitati prije ostatka

**1. Ništa od tenanta ne postoji dok klijent ne klikne „Objavi“.** Poziv kreira samo
`OnboardingInvite`. Korak 1 dodaje `User` bez članstva i `OnboardingDraft`. Sve ostalo (ZEV, računi,
zgrade, jedinice, registar, lica, udjeli, organi, nalozi) nastaje u `publishOnboardingDraft`, u
**jednoj** transakciji. Napušten nacrt se zato može potpuno obrisati. To nije moguće sa `Zev` redom,
koji zbog append-only audita ostaje zauvijek (`docs/multitenancy-plan.md`, odluka 2026-09-09).

**2. Cijena nacrta je dupliranje pravila, i plan je rješava izdvajanjem, a ne kopiranjem.** Servisi
(`createUnit`, `addOwnershipStake`, `establishUnitRegister`…) traže aktera sa aktivnim ZEV-om i ulogom
PRESIDENT, pa ih nacrt ne može pozivati. Svako pravilo koje čarobnjak provjerava mora zato živjeti u
**čistoj funkciji** koju koriste i servis i nacrt. Primjeri su `registerPreconditions` (već čista,
`unitRegister.ts:83`), formati iz D5 i zbir udjela po jedinici. Objava piše kroz `…InTx` jezgra
izdvojena iz postojećih servisa, po presedanu `reversePaymentInTx` i `createLinkedAttachmentTx`. Na
taj način ista pravila važe za čarobnjak i za ostatak aplikacije, i to se provjerava testom (§7).

**3. „Ne može dalje“ se izvodi iz nacrta, ne iz zastavica.** Čista funkcija
`onboardingProgress(draft)` za svaki korak vraća `{ complete, issues[] }`. Trenutni korak je prvi
nekompletan. Server odbija svaku stranicu i akciju koraka iza njega. Klijentska validacija (HTML
`required`, `pattern`) je samo udobnost.

---

## 1. Zatečeno stanje (provjereno u kodu)

| Šta | Gdje | Značaj za čarobnjak |
|---|---|---|
| Super admin kreira tenant **i** predsjednika u jednoj formi | `createTenant`, `admin.ts:120`; `/admin/novi` | Ostaje kao „asistirano kreiranje“, bez promjena |
| `Zev` je trajan čim nastane (audit `admin.tenant.create`, append-only, RESTRICT) | `docs/multitenancy-plan.md` §Faza 1 | Razlog za D2: ZEV nastaje tek pri objavi |
| Preduslovi utvrđivanja: ≥1 aktivna jedinica, popunjena polja, zbir udjela = 100% | `registerPreconditions`, `unitRegister.ts:83` (čista funkcija nad `UnitRow`) | Validacija koraka 5; treba je otvoriti i za oblik jedinice iz nacrta |
| Utvrđivanje upisuje `UnitRegisterChange(ESTABLISH)` sa snimkom i audit | `establishUnitRegister`, `unitRegister.ts:163` | Objava radi isto, verzija 1 |
| Vlasnik tek posle utvrđivanja; udio traži dokaz `OWNERSHIP_PROOF` | `ownership.ts:115`, `:126` | Korak 8 posle koraka 7; fajl po udjelu (D6) |
| Zbir udjela na jedinici ≠ 100% je u redovnom radu samo upozorenje (K-01a) | `addOwnershipStake`, `unitOwnershipWarnings` (`ownership.ts:740`) | Čarobnjak ga pretvara u blokadu, sa izuzetkom D6a |
| Funkcije u organima: PRESIDENT/ACCOUNTANT (jedan nosilac), BOARD_MEMBER (više) | `OfficeTerm`, `setOfficeTerm`, `addBoardMember` | Korak 9 |
| Nalog za lice sa direktnom početnom lozinkom | `createUserForParty`, `users.ts:58` | Korak 9 |
| Prilozi se čuvaju u bazi (`AttachmentBlob`) u istoj transakciji kao red | `attachments.ts:79` | Isti pristup za fajlove nacrta (D2b) |
| Javni token linkovi: sha256 hash, rok, opoziv, ponovno izdavanje | `ApprovalToken` + `/glasanje/[token]`; `/reset-lozinka` | Presedan za `OnboardingInvite` |
| Rate limit po `ipHash` za prijavu i zahtjev za reset | `authenticate`, `requestPasswordReset` (`users.ts:32`, `:136`) | Isto za stranicu poziva |
| Korisnik bez ZEV-a: preusmjerava se samo super admin; ostali dobijaju „Nalog nema aktivan ZEV.“ | `(app)/layout.tsx:34`, `login` (`:28`, `:33`), `guards.ts:84` | Pozvani sa nacrtom mora ići na `/onboarding` (§5.3) |
| Mail provajder je mock | `tenant-switching-admin-accounts-plan.md` §1.3 | D1: link se dostavlja ručno |
| Dizajn sistem nema obrazac čarobnjaka; `StatusTimeline` namjerno nije klikabilan | `ui.tsx:127`, `design-system.md` | D8: `StepNav` (§6) |

---

## 2. Model podataka

### 2.1 `OnboardingInvite` — pozivni link

```prisma
enum OnboardingInviteStatus {
  ACTIVE     // čeka korak 1
  ACCEPTED   // pozvani je kreirao nalog / prijavio se; nastao je nacrt
  REVOKED    // opozvan ili zamijenjen novim
}

model OnboardingInvite {
  id            String                 @id @default(cuid())
  email         String                 // korak 1 radi samo sa ovom adresom (D3)
  workingName   String                 // radni naziv ZEV-a koji je upisao super admin
  tier          ZevTier                // paket; prenosi se u nacrt i na Zev pri objavi
  note          String?
  tokenHash     String                 @unique // sha256(token), nikad otvoren tekst
  status        OnboardingInviteStatus @default(ACTIVE)
  expiresAt     DateTime               // createdAt + 14 dana (D1)
  createdById   String                 // super admin
  createdAt     DateTime               @default(now())
  openedAt      DateTime?
  acceptedAt    DateTime?
  revokedAt     DateTime?
  revokedReason String?
  draft         OnboardingDraft?

  @@index([email])
}
```

- Token: `generateToken()` (`src/server/auth/tokens.ts:4`, 32 bajta), URL `/onboarding/poziv/[token]`.
  Otvoren tekst se prikazuje super adminu **jednom**, uz dugme „Kopiraj link“.
- Jedan `ACTIVE` poziv po e-mailu. „Izdaj novi link“ prebacuje stari u `REVOKED`
  (`revokedReason: "Zamijenjen"`).
- Poziv nema `zevId`, jer ZEV još ne postoji.

### 2.2 `OnboardingDraft` — nacrt

```prisma
enum OnboardingDraftStatus {
  IN_PROGRESS
  PUBLISHED   // publishedZevId postavljen; nacrt ostaje samo za čitanje kao trag
  DISCARDED   // super admin ga je odbacio; fajlovi obrisani
}

model OnboardingDraft {
  id             String                @id @default(cuid())
  invite         OnboardingInvite      @relation(fields: [inviteId], references: [id])
  inviteId       String                @unique
  ownerUserId    String                // nalog iz koraka 1
  status         OnboardingDraftStatus @default(IN_PROGRESS)
  data           Json                  // OnboardingDraftData, §2.4
  version        Int                   @default(0) // optimistička brava: svaki upis je version+1
  publishedZevId String?               @unique
  publishedAt    DateTime?
  files          OnboardingDraftFile[]
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt

  @@index([ownerUserId, status])
}

model OnboardingDraftFile {
  id        String          @id @default(cuid())
  draft     OnboardingDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  draftId   String
  filename  String
  mime      String
  size      Int
  bytes     Bytes
  createdAt DateTime        @default(now())
}
```

Ove tabele **nisu** append-only. Nacrt i fajlovi se smiju brisati, i to je cijela poenta D2. Trajni
trag je audit: `onboarding.invite.create`, `.accept`, `.revoke`, `onboarding.draft.discard`,
`onboarding.publish`. Ti zapisi imaju `zevId = null` sve do objave (`AuditEvent.zevId` je opcion od
Korak 5 dopune).

Ograničenja fajlova su ista kao za priloge (dozvoljeni MIME tipovi i maksimalna veličina iz
`attachments.ts`), uz ukupan limit po nacrtu (prijedlog 200 MB) da nacrt ne postane skladište.

### 2.3 `Zev` — bez promjena

U modelu sa nacrtom `Zev` nikad nije „u onboardingu“: nastaje kompletan, sa
`unitRegisterStatus = ESTABLISHED`. Ne treba novo polje ni preusmjeravanje unutar `(app)` ljuske.

### 2.4 `OnboardingDraftData` — oblik JSON-a

TypeScript tip u `src/lib/onboarding/draft.ts`, validiran pri svakom čitanju (zod ili ručno, kako
projekat već radi). Ključevi su lokalni `cuid`-ovi nacrta, a ne ID-jevi iz baze:

```ts
type OnboardingDraftData = {
  zev: { legalName; shortName?; registrationNumber; jib; registeredAddress; city; municipality; foundingDate?; registrationDate? };
  president: { firstName; lastName; phone? };            // email = invite.email
  accounts: { key; type: "BANK" | "CASH"; name; bankName?; number?; openingBalance; openingDate }[];
  buildings: { key; name; address; cadastralRef?; yearBuilt?; floorsCount?; entrances: { key; name; address? }[] }[];
  units: { key; buildingKey; entranceKey?; type; label; floor?; usableArea; ownershipShare }[];
  commonAssets: { key; buildingKey; kind; name; description? }[];
  registerConfirmedAt?: string;                           // korak 7
  parties: { key; kind; firstName?; lastName?; orgName?; orgIdNumber?; email?; phone?; address? }[];
  stakes: { key; unitKey; partyKey; sharePercent; validFrom; proofFileId; acquisitionNote? }[];
  disputedUnits: string[];                                // unitKey-evi sa potvrdom D6a
  offices: { accountant?: { partyKey; validFrom; login?: { password } } | "LATER"; board: { partyKey; validFrom }[] };
  ownerLogins: { partyKey; password }[];                  // opciono
  acks: { noAccounts?: true };                            // D7
};
```

Lozinke iz koraka 9 se u nacrt upisuju **samo kao hash** (`hashPassword`), nikad kao otvoren tekst.
Objava ih prenosi takve kakve jesu.

---

## 3. Tok super admina

### 3.1 `/admin/novi` — dvije kartice (D8)

Dvije `Card` jedna pored druge (na mobilnom jedna ispod druge), svaka sa naslovom, jednom rečenicom
i dugmetom koje otvara svoju formu:

1. **„Pošalji poziv klijentu“**: radni naziv, paket, e-mail, napomena →
   `createOnboardingInvite`. Posle snimanja ekran prikazuje link jednom.
2. **„Kreiraj odmah sa predsjednikom“**: današnja forma i `createTenant`, bez promjena.

Na stranici je jedno `primary` dugme: ono iz otvorene forme. Dok nijedna forma nije otvorena, oba
okidača su `secondary`.

`createOnboardingInvite(actor, data)` je u `admin.ts`, sa `requireSuperAdmin`. E-mail koji već ima
`ACTIVE` poziv vraća grešku sa vezom na taj poziv. E-mail koji već ima nalog je dozvoljen (D3), pa
tada korak 1 traži prijavu.

### 3.2 `/admin` — „Pozivi i nacrti“

Pošto ZEV ne postoji, praćenje nije na `/admin/[zevId]`, nego u novoj sekciji (ili tabu, `Tabs`)
liste: „Pozivi i nacrti“. Kolone:
- e-mail i radni naziv;
- status poziva i nacrta;
- „Korak N od M — naziv“ (iz `onboardingProgress`, isto što vidi klijent);
- zadnja izmjena i rok.

Akcije po redu:
- **Kopiraj link** nije moguće, jer se token ne čuva. Umjesto toga postoji **„Izdaj novi link“**
  (`caution` + `ConfirmAction`, poništava stari). Dozvoljeno je samo dok je poziv `ACTIVE`.
- **„Opozovi poziv“** (`caution` + `ConfirmAction`, razlog obavezan).
- **„Pregled nacrta“** otvara `/admin/nacrti/[id]` samo za čitanje, sa sažetkom kao u koraku 10.
  Super admin tako vidi gdje je klijent zapeo, bez ulaska u tuđi nalog.
- **„Odbaci nacrt“** (`caution` + `ConfirmAction`, razlog obavezan): `status = DISCARDED`, fajlovi
  obrisani, audit. `User` iz koraka 1 ostaje, jer može imati ili kasnije dobiti druga članstva. Ako
  nema nijedno, prijava ga vodi na poruku „Vaš nacrt je odbačen, obratite se administratoru“.
  Ovo nije `danger`: brišu se podaci koji još nisu postali evidencija ZEV-a. Ako se smatra drugačije,
  prelazi u `danger` uz izričit dogovor (CLAUDE.md).

Posle objave red pokazuje vezu na `/admin/[zevId]` novog ZEV-a.

---

## 4. Koraci čarobnjaka

Ruta je `/onboarding/[korak]`, u svojoj route grupi van `(app)` ljuske (bez bočne navigacije), po
uzoru na `/admin` i `/glasanje`. Ulaz preko poziva je `/onboarding/poziv/[token]`. Svaka stranica i
akcija od koraka 2 nadalje traži prijavljenog vlasnika nacrta (`ownerUserId`).

Svaki korak ima isti oblik:
- `StepNav` (§6), naslov i jedna rečenica šta i zašto;
- forma ili lista;
- `PreconditionList` sa onim što još nedostaje;
- „Nazad“ (`secondary` link) i **jedno** `primary` „Sačuvaj i nastavi“.

„Nastavi“ je onemogućeno dok `onboardingProgress` za korak nije `complete`, a ⚠ stavke kažu tačno šta
nedostaje. Svaki upis u nacrt šalje `version`. Ako se ne poklapa (dvije kartice, dva uređaja), korisnik
dobija „Nacrt je u međuvremenu izmijenjen — osvježite stranicu“ umjesto tihog gubitka podataka.

| # | Korak | Šta se unosi | Kompletan kada… |
|---|---|---|---|
| 1 | **Vaš nalog** | Ime, prezime, telefon, lozinka ×2. E-mail je zaključan na adresu iz poziva. Ako nalog postoji: prijava postojećom lozinkom | `User` postoji i prijavljen je, poziv `ACCEPTED`, nacrt kreiran |
| 2 | **Podaci o ZEV-u** | Pun i skraćeni naziv, registarski broj, **JIB**, adresa sjedišta, grad, opština, datumi osnivanja i registracije | Obavezni: naziv, registarski broj, JIB (D5), adresa, grad, opština. Datumi opcioni |
| 3 | **Računi** | Bankovni račun(i): naziv, banka, **broj računa**, početno stanje i datum; blagajna opciono | `BASIC_FINANCE`/`FULL`: ≥1 `BANK` sa ispravnim brojem (D5). `BASIC`: isto **ili** potvrda „bez računa“ (`acks.noAccounts`, D7) |
| 4 | **Zgrade i ulazi** | Zgrada (naziv, adresa, katastarska oznaka, godina, spratnost); ulazi opciono | ≥1 zgrada sa nazivom i adresom; nazivi zgrada jedinstveni |
| 5 | **Posebni dijelovi** | Jedinice: zgrada/ulaz, vrsta, oznaka, sprat, površina, udio u zajedničkoj imovini; uživo zbir udjela | `registerPreconditions` sve ✓; oznaka jedinstvena po zgradi (kao `@@unique([buildingId, label])`) |
| 6 | **Zajednički dijelovi** | Površine, sistemi, oprema (`CommonAssetKind`), po zgradi | ≥1 `AREA` po svakoj zgradi (D4) |
| 7 | **Utvrđivanje registra** | Pregled registra (tabela + zbir) i potvrda | `registerConfirmedAt` postavljen. `caution` + `ConfirmAction`: koraci 4–6 se zaključavaju (§4.1) |
| 8 | **Vlasnici** | Po jedinici: lice (fizičko/pravno; postojeće u nacrtu ili novo), udio %, datum od, **dokaz o vlasništvu** (fajl po udjelu, D6); po jedinici opcija „vlasništvo u sporu“ (D6a) | Svaka jedinica: zbir tekućih udjela **tačno 100%** **ili** jedinica u `disputedUnits`; svaki udio ima fajl |
| 9 | **Organi i nalozi** | Predsjednik ZEV-a = pozvani (fiksno, samo prikaz); računovođa (lice + opciono nalog sa početnom lozinkom, ili „kasnije“); članovi upravnog odbora; opciono nalozi vlasnika | Računovođa postoji **ili** je `"LATER"`; e-mailovi novih naloga jedinstveni u nacrtu i ne postoje kao `User` |
| 10 | **Pregled i objava** | Sažetak svih koraka sa vezama „Izmijeni“; `PreconditionList` preko svih koraka | Svi koraci 1–9 kompletni → „Objavi ZEV“ (`caution` + `ConfirmAction`: od tada se registar mijenja samo uz razlog i dokument) |

### 4.1 Kretanje unazad i izmjene

- Na završen korak se uvijek može vratiti. Izmjena koja ga učini nekompletnim vraća „trenutni korak“
  na njega, jer se napredak izvodi iz nacrta.
- Posle koraka 7 koraci 4–6 su samo za čitanje. Za razliku od objavljenog ZEV-a, gdje izmjena registra
  traži razlog i dokument, u nacrtu nema pravne posljedice. Zato postoji **„Otključaj registar“**
  (`caution` + `ConfirmAction`). Ono briše `registerConfirmedAt`, a udjeli i oznake spora za jedinice
  koje se zatim obrišu brišu se zajedno sa njima (potvrda to unaprijed nabraja).
- Korak 2 se može mijenjati do objave.

### 4.2 Zašto je korak 8 strožiji od ostatka aplikacije

U redovnom radu zbir ≠ 100% je upozorenje (K-01a). ZEV koji izađe iz čarobnjaka sa jedinicom bez
vlasnika ne bi, međutim, mogao otvoriti glasanje (izlazni kriterijum FR plana), a to bi bila prva
prepreka za klijenta. Korak 8 zato traži 100%, osim za jedinice koje su izričito označene kao sporne
(D6a). Takve jedinice posle objave normalno ulaze u postojeća upozorenja (`unitOwnershipWarnings`).

---

## 5. Servisni sloj i provjere

### 5.1 Izdvajanje pravila (preduslov, prije ikakvog UI-ja)

| Pravilo | Danas | Postaje |
|---|---|---|
| Preduslovi registra | `registerPreconditions(units: UnitRow[])` | Ostaje gdje je, ali prima uži tip `{ label, type, usableArea, ownershipShare, active }`, koji zadovoljavaju i `Unit` i jedinica iz nacrta |
| JIB, broj računa | ne postoji | `src/lib/identifiers.ts`: `validateJib`, `validateBankAccount` (D5); pozivaju ih i `upsertZev` i `createAccount` |
| Zbir udjela po jedinici | unutar `addOwnershipStake` / `unitOwnershipWarnings` | `unitShareSum(stakes)` u `src/lib/ownershipRules.ts` |
| Udio u rasponu (0, 100] | inline u `addOwnershipStake` | `assertSharePercent` u istom modulu |
| Jačina lozinke | `assertPasswordStrong` | Bez promjene, već dijeljeno |

Uz D5 i postojeće ZEV-ove: `upsertZev` i `createAccount` počinju da odbijaju neispravan JIB ili broj
računa samo **pri izmjeni tog polja**. Postojeći zapisi se ne provjeravaju retroaktivno.

### 5.2 Novi `src/server/services/onboarding.ts`

- `inspectOnboardingInvite(token)` vraća `{ ok, workingName, maskedEmail, existingUser } | { ok: false,
  error: "invalid" | "expired" | "revoked" | "used" }`. Postavlja `openedAt`. Rate limit po `ipHash`.
- `acceptOnboardingInvite(token, input)` je jedna transakcija:
  1. ponovna provjera tokena;
  2. `User` (`roles: []`, `assertPasswordStrong`) ili provjera lozinke postojećeg;
  3. poziv `ACCEPTED`;
  4. `OnboardingDraft` sa početnim `data` (radni naziv u `zev.legalName`, ime i prezime u `president`);
  5. audit, pa nova sesija.
- `getMyDraft(actor)` vraća nacrt prijavljenog korisnika (`ownerUserId`, `IN_PROGRESS`).
- `saveDraftStep(actor, stepKey, patch, version)` čuva korak: provjera koraka (§5.3), validacija samo
  tog dijela, `version + 1`.
- `uploadDraftFile` / `removeDraftFile` rade sa fajlovima udjela; limiti iz §2.2.
- `onboardingProgress(data, tier)` je **čista funkcija**. Vraća
  `{ key, label, complete, optional, issues: { key, text }[] }[]` i `currentStep`. Koriste je stranice,
  guard, admin lista i korak 10.
- `publishOnboardingDraft(actor, version)`, jedna transakcija:
  1. ponovo `onboardingProgress`; odbija ako išta nije kompletno ili `version` nije tekući;
  2. `Zev` (`tier` iz poziva, `unitRegisterStatus: ESTABLISHED`, `unitRegisterVersion: 1`,
     `unitRegisterEstablishedAt`) + `seedDefaultSettings`;
  3. računi, zgrade, ulazi, jedinice, zajednički dijelovi; mapa `key → id`;
  4. `UnitRegisterChange(ESTABLISH, version 1)` sa snimkom kroz `snapshotUnit`;
  5. lica; `Party` predsjednika sa `userId` vlasnika nacrta + `Membership(PRESIDENT)` +
     `OfficeTerm(PRESIDENT)`;
  6. udjeli + `Attachment(OWNERSHIP_PROOF)` iz `OnboardingDraftFile` kroz `createLinkedAttachmentTx`;
  7. računovođa i odbor (`OfficeTerm`), nalozi (`User` sa hešom iz nacrta + `Party.userId` +
     `Membership`);
  8. audit: jedan zbirni `onboarding.publish` sa brojevima po vrsti + `admin.tenant.create`-ekvivalent
     `zev.create` (da trag izgleda kao kod asistiranog puta);
  9. nacrt `PUBLISHED`, `publishedZevId`, fajlovi obrisani (sada su u `AttachmentBlob`);
  10. posle transakcije `setSessionActiveZev` na novi ZEV i preusmjeravanje na početnu.

  Koraci 3–7 koriste `…InTx(tx, zevId, …)` jezgra izdvojena iz `createUnit`, `addOwnershipStake`,
  `setOfficeTerm`, `addBoardMember`, `createUserForParty` i `establishUnitRegister`. Javni servisi
  postaju tanki omotači (guard + jezgro), pa objava i redovan rad pišu istim kodom.

- `discardOnboardingDraft(actor, draftId, reason)` (super admin) i `revokeOnboardingInvite`.

### 5.3 Guard i preusmjeravanje

- `requireOnboardingStep(actor, stepKey)` se poziva na vrhu svake stranice koraka i svake akcije. Za
  korak iza `currentStep` stranica preusmjerava na trenutni korak, a akcija vraća grešku „Prvo završite
  korak X“.
- **Prijava i ljuska:** na tri mjesta koja danas preusmjeravaju samo super admina bez ZEV-a
  (`login` `:28`, `:33`; `(app)/layout.tsx:34`) dodaje se: korisnik bez aktivnog ZEV-a koji ima nacrt
  `IN_PROGRESS` ide na `/onboarding`. Korisnik sa odbačenim nacrtom ide na poruku iz §3.2. Postojeći
  korisnik koji osniva drugi ZEV (D3) i dalje ima svoj aktivni ZEV, pa do čarobnjaka dolazi preko
  veze „Nastavite podešavanje novog ZEV-a“ u izborniku ZEV-ova (`listMyTenants`).
- `/onboarding/*` za korisnika bez nacrta `IN_PROGRESS` preusmjerava na početnu.

### 5.4 Bezbjednost poziva

- Token je bearer kredencijal: hash u bazi, rok 14 dana, jednokratan, opoziv.
- Stranica poziva prikazuje samo radni naziv i maskiran e-mail.
- `Referrer-Policy: no-referrer` na `/onboarding/poziv/*`. Danas nije postavljen nigdje, ni na
  `/glasanje/[token]`, pa isti header treba usput dodati i tamo.
- Rizik koji ostaje: ko dođe do linka prije pozvanog može otvoriti nacrt pod tim e-mailom. Šteta je
  ograničena jer ZEV ne postoji i nema tuđih podataka. Super admin u listi vidi ko je i kada prihvatio
  i može odbaciti nacrt. Potvrda e-maila čeka stvarni mail provajder (§8, Faza D).

---

## 6. UI i dizajn sistem (D8 — usvojeno, mockup prije Faze A)

**Novi primitiv `StepNav`** (`src/components/ui.tsx`, dokumentuje se u `design-system.md` §primitivi):

- **≥768px:** vertikalna lista koraka lijevo od sadržaja, 13px. Svaki red ima stanje ✓ završen
  (veza), tekući (`aria-current="step"`, podebljan) ili zaključan (siv, nije veza). Opcioni korak nosi
  oznaku „opciono“.
- **<768px:** jedna linija `text-sm` „Korak 3 od 10 · Računi“ + `<details>` koji otvara istu listu.
- Bez client JS-a, kao `ConfirmAction`. Ikone iz postojećeg skupa (`CheckCircleIcon`).
- Nije zamjena za `StatusTimeline`. Taj prikazuje tok procesa koji se ne preskače (sjednica, faktura) i
  ostaje netaknut.

**Zaključano „nastavi“** se dokumentuje kao pojašnjenje obrasca „Sljedeći korak“: dugme se zaključava
samo kad servis zaista odbija korak, a ⚠ lista razloga stoji odmah iznad. U čarobnjaku server odbija
(`requireOnboardingStep`), pa je to isto pravilo, a ne izuzetak.

**`/admin/novi`:** dvije `Card` (§3.1); bez novog primitiva.

**Unos jedinica i vlasnika (koraci 5 i 8):** forma „Dodaj jedinicu“ ostaje otvorena posle snimanja
(fokus na oznaku; zgrada, ulaz i vrsta se zadržavaju), a ispod je `Table` sa uživo zbirom. U koraku 8
red tabele je jedinica, a otvara se panel (po uzoru na `building-row.tsx` / `ConfirmPanel`) sa
udjelima i dokazima te jedinice. CSV uvoz je Faza D.

**Mockupi** u `Plans/design-review/mockups/` (1440 i 375): `/admin/novi` sa dvije kartice; korak 5;
korak 8 sa otvorenim panelom jedinice; korak 10. Pregled mockupa prethodi Fazi A.

Sve ostalo koristi postojeće primitive: `Card`, `Field`, `PreconditionList`, `Table`, `Flash`,
`ConfirmAction`, `SubmitBtn`, `BtnLink`, `Tabs`. Najviše jedno `primary` po koraku. Nijedno `danger`.

---

## 7. Testovi

- **Paritet pravila:** za svako pravilo iz §5.1 isti ulaz daje isti ishod kroz servis i kroz
  `onboardingProgress`. Ovi testovi su osigurač protiv razilaženja nacrta i aplikacije.
- **`identifiers`:** ispravni i neispravni JIB-ovi i brojevi računa (kontrolna cifra, dužina, nečiste
  cifre).
- **`onboardingProgress`:** svaki korak prazan/djelimičan/kompletan; `BASIC` + `noAccounts`; jedinica
  u sporu; regresija (izmjena završenog koraka vraća `currentStep`); otključavanje registra briše
  udjele obrisanih jedinica.
- **Poziv:** važeći / istekao / opozvan / iskorišćen / zamijenjen; e-mail se mora poklapati; postojeći
  korisnik; dva paralelna prihvatanja (samo jedno uspije).
- **Guard:** direktna akcija koraka 8 dok je trenutni korak 5 se odbija; tuđi nacrt (drugi `User`) je
  nedostupan.
- **Optimistička brava:** upis sa starim `version` se odbija.
- **Objava:** kompletan nacrt daje ZEV čiji registar, udjeli, prilozi, organi, članstva i audit
  odgovaraju nacrtu; snimak registra je jednak onom iz `establishUnitRegister` za iste jedinice;
  greška usred objave ne ostavlja ništa (ni `Zev`, ni priloge); nacrt `PUBLISHED`, fajlovi obrisani.
- **Prijava:** korisnik bez ZEV-a sa nacrtom ide na `/onboarding`; sa odbačenim nacrtom na poruku;
  super admin i dalje na `/admin`.
- **E2E (Playwright, 1440 i 375):** od poziva do objave sa primjerom iz FR plana (6 lica, 8 posebnih
  dijelova), uključujući jednu jedinicu u sporu.

---

## 8. Redoslijed isporuke

Svaka faza je zasebna minor verzija sa `CHANGELOG.md` unosom, po `zev-app-guidelines`.

- **Faza 0 — izdvajanje (bez vidljive promjene).** §5.1: čiste funkcije, `identifiers.ts` (D5 važi
  odmah i u `upsertZev`/`createAccount`), `…InTx` jezgra, testovi pariteta. Ovo je patch ili minor
  zavisno od toga da li D5 mijenja ponašanje postojećih formi.
- **Mockupi + `StepNav`** u dizajn sistemu (pregled prije Faze A).
- **Faza A — kostur.** Migracija (§2), `/admin/novi` sa dvije kartice, lista „Pozivi i nacrti“,
  `/onboarding/poziv`, korak 1, preusmjeravanje (§5.3), koraci 2–4.
- **Faza B — registar.** Koraci 5–7, uključujući otključavanje.
- **Faza C — vlasnici, uloge, objava.** Koraci 8–10, fajlovi nacrta, `publishOnboardingDraft`,
  pregled i odbacivanje nacrta u adminu.
- **Faza D (opciono).** CSV uvoz jedinica i vlasnika; potvrda e-maila i slanje poziva kad postoji
  stvarni mail provajder.

Kartica „Pošalji poziv klijentu“ je skrivena iza podešavanja platforme dok Faza C nije isporučena,
jer se do tada nacrt ne može objaviti.

---

## 9. Rizici

- **Razilaženje pravila nacrta i aplikacije.** Ovo je glavni trošak odluke D2. Ublažavanja su Faza 0
  (izdvajanje prije čarobnjaka) i testovi pariteta. Svako novo pravilo u servisima registra ili
  vlasništva od sada mora ići u dijeljeni modul. To treba dopisati u `zev-app-guidelines`.
- **Velika transakcija objave.** Zgrada od 200 jedinica i 300 udjela sa prilozima znači stotine upisa
  i desetine MB u jednoj transakciji. Mjeri se u E2E testu sa velikim primjerom. Ako je presporo za
  Vercel limit, objava ide u pozadinski posao sa statusom `PUBLISHING`.
- **Veličina nacrta u bazi** (fajlovi u `Bytes`). Ublažavanja su limit po nacrtu i brisanje pri
  objavi ili odbacivanju.
- **Napušteni `User` nalozi bez članstva** posle odbačenog nacrta. Bezopasni su (nemaju pristup
  ničemu), ali ih admin lista korisnika treba moći prikazati.
- **Kontrolni algoritmi JIB-a i broja računa (D5)** moraju se potvrditi iz zvaničnog izvora prije
  Faze 0. Pogrešan algoritam bi odbijao ispravne podatke svuda u aplikaciji, ne samo u čarobnjaku.

---

## 10. Otvoreno (manje, može se riješiti tokom implementacije)

- Tačan izvor i algoritam kontrolne cifre za JIB (13) i broj računa (16) — D5.
- Treba li `Odbaci nacrt` ipak biti `danger` (§3.2)?
- Ukupan limit fajlova po nacrtu (prijedlog 200 MB).
- Da li i super admin dobija mail ili obavještenje kad klijent objavi ZEV (danas: vidi u listi).

---

## 11. Šta plan namjerno ne radi

- Ne uvozi finansijsku istoriju: početna stanja vlasnika, neplaćene fakture, stavke zaduženja.
- Ne kreira pravila glasanja niti sjednice.
- Ne mijenja postojeći asistirani `createTenant` put.
- Ne uvodi „impersonation“: super admin vidi nacrt samo za čitanje, a pomoć u objavljenom ZEV-u ide
  kroz postojeće članstvo.
