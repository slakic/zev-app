# F4 — Vlasnik: glasanje — implementacioni plan

**Status: ODOBRENO 2026-10-26, implementacija u toku (Sonnet po planu, pregled Opus).** Korisnik je prihvatio sve preporuke §7:
- **F4-Q1 (a):** vlasnik u aplikaciji vidi svoj izbor (sopstveni glas i glas punomoćnika u njegovo ime; nikad glas zajednice preko predstavnika).
- **F4-Q2 (a):** u aplikaciji ime + telefon + e-adresa predsjednika; na javnoj stranici glasanja samo ime.
- **F4-Q3 (a):** adresa potvrde radi trajno, dok postoji zapis glasa.
- **F4-Q4 (a):** izjava uključuje priloge, samo za nove glasove (tekst neka pregleda predsjednik ili pravnik).
- **F4-Q5 (a):** prikazuje se „Preostalo pokušaja: N”.
- **F4-Q6:** minor → 2.55.0. Plan je napravio Opus (plan-only, čitanjem stvarnog koda v2.54.1); ključne tvrdnje iz §1 (klasični link gubi unos kroz `redirect(?err=…)`, potvrda je samo `?receipt={voteId}`, vlasnik ne može otvoriti prilog prijedloga, akcija listića odbacuje `ballotId`) ručno su provjerene.

Fazu F4 iz `Plans/design-review-plan.md` §6 treba isporučiti poslije F3, F5, F6 i F8. Plan polazi od stvarnog koda (v2.54.1). Odluke na koje se oslanja:
- **D6** (2026-10-25): `ConfirmAction` bez sopstvene forme, opcija B, uz izuzetak upisan u DS. Kod glasa je okidač `secondary`, a jedino `primary` je u panelu potvrde.
- **K-04** (2026-10-26):
  - **V-Q1 (b):** glasa se samo preko ličnog linka.
  - **V-Q2 (b):** novi link izdaje samo predsjednik.
  - **V-Q3:** potvrda prikazuje izbor, ali izbor nikad ne ide u URL.
  - **V-Q6:** kod ostaje samo e-poštom, a tekst o njemu postaje iskren.

Verzija: prijedlog je **minor → 2.55.0**, uz potvrdu prije upisa.

**Cilj faze:** pravno relevantno izjašnjenje je potpuno (prilozi su dostupni prije izjave „u cijelosti”) i nedvosmisleno (jedno `primary`, greška ne briše unos). Vlasnik dobija čitljiv dokaz (prijedlog, izbor, vrijeme, broj potvrde). U aplikaciji vidi da li se izjasnio i koga da zove ako link nije stigao.

**Faza rješava nalaze iz pregleda:**
- K6 / V-N05 (prilozi);
- V12 / V-N04 (slijepa ulica u aplikaciji);
- V13 / V-N06 (dva `primary`, ručni duplikat `ConfirmAction`-a);
- V-N07, V-N08, V-N09, V-N10, V-N17, V-N27;
- ostatak V11 (sjednica vlasniku).

Početnu je riješio F3, a V-N18 F3.4. F4 ih ne dira.

**Već urađeno u v2.44.0 (listić po sjednici) — ne radi se ponovo, samo dorađuje:**
- prilozi su na listiću navedeni po nazivu, veličini i otisku, ali **bez preuzimanja**;
- greška čuva izbore, kod i izjavu (klijentsko stanje + `useActionState`);
- otisak je pod „Tehnički detalji”;
- okidač „Pregledaj i potvrdi” je `secondary`, a „Da, pošalji izjašnjenje” je jedino `primary`, ali u **ručno pravljenom** panelu;
- potvrda prikazuje prijedlog, izbor, vrijeme, broj potvrde i „Odštampaj”, ali **samo jednom**, iz stanja akcije: osvježavanje stranice je gubi;
- `Flash` sa `role="alert"` za greške (ručni `div`).

**Šta ostaje:**
- **klasična stranica jednog prijedloga** (pojedinačno otvaranje i odsutni u režimu uživo) je netaknuta i ima sve stare nalaze;
- preuzimanje priloga, i na listiću i u aplikaciji;
- D6 u primitivu;
- potvrda koja se može ponovo otvoriti;
- iskren tekst o kodu;
- stanje glasanja i kontakt predsjednika u aplikaciji;
- sjednica viđena očima vlasnika.

**Granice faze:**
- **Bez migracije.** Potvrda se traži po postojećim id-jevima (`Ballot.id`, `Vote.id`). Kontakt predsjednika dolazi iz `OfficeTerm` (PRESIDENT) i `Party.email`/`phone`.
- **Bezbjednost glasanja se ne dira.** `submitVote`, `submitBallot`, `castElectronicVoteTx`, `rateLimitVerify`, opoziv poslije 5 promašaja, append-only `Vote` (trigger) i audit `vote.submit`/`ballot.submit` bez izbora ostaju kakvi jesu. Jedina izmjena u tim funkcijama je **dodatno polje u povratnoj vrijednosti** (`attemptsLeft`) i nijedan uslov.
- Nema glasanja u aplikaciji (V-Q1), nema samoposluge „pošalji mi link” (V-Q2) i nema drugog kanala za kod (V-Q6).
- Nema novih boja, veličina teksta ni težina dugmadi, i nema novog `danger`. Jedina dopuna DS-a je D6 (prop `formless` u `ConfirmPanel` + red u §4.2).

---

## 1. Zatečeno stanje (provjereno u kodu)

| # | Stanje | Gdje |
|---|---|---|
| 1 | **Klasični link (jedan prijedlog)** i dalje koristi staru stranicu: `voteAction` radi `redirect(?err=…)`, pa se izbor, kod i izjava gube (V-N07). Provjera izjave postoji samo u akciji. | `src/app/glasanje/[token]/page.tsx:33-52` (`:38-40`, `:48-50`) |
| 2 | Ista stranica ima **dva `primary`**: `ToggleBtn variant="primary"` „Potvrdi i pošalji…” i `SubmitBtn` u ručnom amber panelu. | `page.tsx:205-225` |
| 3 | Na istoj stranici:<br>• „Vaša glasačka težina”;<br>• „(verzija N)” uvijek;<br>• otisak `text-xs text-slate-400`;<br>• naziv sjednice `text-xs uppercase`;<br>• hint koda „Potvrda identiteta — sam link nije dovoljan dokaz.” (V-N27);<br>• checkbox izjave `h-4 w-4`. | `page.tsx:146-148`, `:152-154`, `:165-168`, `:195`, `:200-203` |
| 4 | **Potvrda klasičnog glasa:** `?receipt={voteId}` u URL-u. Prikazuje samo id u ručnom emerald okviru, bez prijedloga, vremena i izbora (V-N08). | `page.tsx:51`, `:61-76` |
| 5 | **Listić (v2.44.0):** potvrda dolazi iz stanja akcije. Tekst kaže „Izbor se prikazuje samo sada, na ovom ekranu”. `actions.ts` odbacuje `ballotId`, iako ga servis vraća. Ponovno otvaranje linka poslije glasanja daje grešku `used`. | `ballot-form.tsx:59-111`; `actions.ts:39-46`; `meetings.ts:2546`; `sr-Latn.ts:1429` |
| 6 | **Prilozi na listiću** nisu linkovi, a otisak priloga stoji u meti (`{velicina} KB · otisak …`). Naslov prijedloga uvijek ima „(verzija N)”. | `ballot-form.tsx:172`, `:187-202`; `sr-Latn.ts:1396, 1399` |
| 7 | **Panel potvrde na listiću** je ručna kopija `ConfirmPanel`-a: amber klase, a `Btn type="submit" variant="primary"` i „Nazad na izmjene” su ugrađeni ručno. `ConfirmPanel` uvijek pravi svoj `<form action>`, pa ga klijentska forma ne može koristiti. `SubmitBtn` nema `disabled`. | `ballot-form.tsx:293-311`; `src/components/ui.tsx:428-433`, `:533-585` |
| 8 | Greške na listiću su ručni crveni `div` sa `role="alert"`, uvijek ispod izjave. Checkbox izjave je `h-4 w-4`. Pogrešan kod ne kaže koliko je pokušaja ostalo, iako servis to zna (`failedAttempts`, opoziv kod 5). | `ballot-form.tsx:260-282`; `meetings.ts:2559-2569`, `:1849-1865` |
| 9 | `inspectApprovalToken` učitava `attachments`, ali ih **ne vraća**. `inspectBallot` ne vraća tijelo sjednice (skupština/UO) ni jedinice glasača (`EligibleVoter.basis.units`). | `meetings.ts:1733`, `:1769-1794`; `:2390-2452` |
| 10 | **Preuzimanje priloga:** `readAttachmentFile` vlasniku dozvoljava samo `OWNERSHIP_PROOF` i `CONSENT`. Prilog prijedloga vlasnik ne može otvoriti ni u aplikaciji. Javne (token) rute za prilog nema. | `src/server/services/attachments.ts:170-193`; `src/app/api/prilozi/[id]/route.ts` |
| 11 | **Prijedlog u aplikaciji (vlasnik):** „Vaše učešće” je jedna rečenica, bez roka, bez „izjasnili ste se”, bez priloga i bez kontakta (V-N04). Pogrešan uslov: vlasnik koji je dao punomoć (seed: Ana → Dragan) čita „Lični link … dobili ste e-poštom”, a link je dobio punomoćnik. `getProposal` vlasniku učitava **sve** birače i glasove (filtrira se tek u stranici). | `skupstina/prijedlog/[id]/page.tsx:211-258`; `meetings.ts:731-744` |
| 12 | **Sjednica (vlasnik):** 10-koračni `MeetingTimeline` (11px labele, V-N17). Tabela prijedloga ima „Glasalo X od Y”, a nema „Vaš status”. | `skupstina/[id]/page.tsx:235-246`, `:25-32`, `:317-321`; `components/meeting-next-step-panel.tsx:18-25`; `ui.tsx:125-170` |
| 13 | **Kontakt predsjednika:** `OfficeTerm` (role `PRESIDENT`, `validTo` null ili u budućnosti) → `Party` (`email`, `phone`). Vlasniku se danas nigdje ne prikazuju telefon i e-adresa (Organi: samo ime i mandat). | `prisma/schema.prisma` `OfficeTerm`, `Party`; `ownership.ts:422-434` (`listOfficeHolders`); `organi/page.tsx:127-131` |
| 14 | **Tekstovi o kodu (V-N27):**<br>• `ballot.page.codeHint` „sam link nije dovoljan dokaz”;<br>• `ballot.mail.personal` i tijelo e-maila `approval-link` „Za potvrdu identiteta biće potreban verifikacioni kod”.<br>Kod je u istoj poruci. Red „Vaš verifikacioni kod: NNNNNN” čita `testOutbox` regexom i **ne smije se mijenjati**. | `sr-Latn.ts:1386, 1410`; `meetings.ts:1453-1454`; `src/server/notifications/testOutbox.ts:52` |
| 15 | `ACK_TEXT` kaže „pročitao/la prijedlog u cijelosti” (bez „priloge”) i čuva se u `Vote.acknowledgementText` svakog glasa. | `meetings.ts:31-34`, `:1917` |
| 16 | DS §4.2: pravilo potvrde ima tri reda (sljedeći korak / korektivna / uništavanje). Izuzetak za glas (D6) nije upisan. | `Plans/design-system.md:229-237` |

---

## 2. Izmjene

### F4.1 D6 — `ConfirmPanel`/`ConfirmAction` bez sopstvene forme (`src/components/ui.tsx`)

- **`ConfirmPanelProps`** postaje unija:
  - `{ action: (fd) => …; formless?: false }`, ili
  - `{ formless: true; action?: never }`.
- Kad je `formless`, panel se renderuje kao `<div role="group" aria-labelledby={titleId}>` sa istim klasama. Dugme potvrde je `type="submit"` i predaje **okolnu** formu. `hiddenFields` i `formId` važe samo uz `action`; uz `formless` TypeScript ih zabranjuje.
- **Novi propovi:** `confirmDisabled?: boolean` i `titleId?: string` (`useId` nije moguć jer je komponenta server-safe, pa se `titleId` prosljeđuje izvana ili se koristi `title` kao `aria-label`).
- **`SubmitBtn`** dobija `disabled?: boolean`. Vizuelna promjena: nijedna.
- `ConfirmAction` samo prosljeđuje propove, pa radi i sa `formless`.
- **`Plans/design-system.md`:**
  - §4.2, tabela „Pravilo potvrde”, novi red: **„Konačno izjašnjenje (glas)” | okidač `secondary` | potvrda `primary` | e-glasački listić**. Obrazloženje: glas je očekivani sljedeći korak, a ne administrativna radnja sa posljedicom (D6);
  - red `ConfirmAction` u §4.3 dobija rečenicu o `formless`.

### F4.2 Jedna forma za oba linka — `src/app/glasanje/[token]/`

**Klasična stranica jednog prijedloga prelazi na `BallotForm`.** Ručni JSX iz `page.tsx:134-231` i `voteAction` se brišu.

- **`ballot-form.tsx` → generalizovan:**
  - novi propovi:
    - `variant: "session" | "single"`;
    - `action: (prev, fd) => Promise<BallotActionState>` (server akcija prosljeđena iz `page.tsx`);
    - `contact: { presidentName: string | null }`;
    - `who: { body: "ASSEMBLY" | "BOARD"; units: string[] }`;
  - `single`:
    - nema brojača „Izabrano N od M”;
    - uvod je `ballot.page.introSingle`;
    - prefiks izjave je `ballot.page.ackPrefixSingle`;
    - rok je `proposal.votingClosesAt`;
  - **„Ko ste vi”:**
    - skupština: `tf("ballot.page.whoAssembly", { jedinice })` — „Glasate jednom, kao etažni vlasnik: Stan 1, Garaža 1.”;
    - UO: `ballot.page.whoBoard` — „Glasate kao član upravnog odbora. Svaki član ima jedan glas.”;
    - punomoćnik i zajednica: kao danas;
    - red težine se prikazuje **samo** kad težina ≠ 1 (`ballot.page.weight`), samo na klasičnom linku;
  - **naslov prijedloga:** `{kod} — {naslov}`. Verzija ide u naslov samo kad je `version > 1` (`ballot.page.proposalTitleVersion`), a uvijek u „Tehnički detalji”;
  - **prilozi (V-N05):** `ul` redova „{naziv} · {VRSTA} · {N} KB” + `RowLink newTab` „Otvori” → `/glasanje/{token}/prilog/{attachmentId}`, sa `sr-only` „(otvara se u novoj kartici)”. Nova kartica je obavezna, jer bi ista kartica izgubila klijentsko stanje. Otisak svakog priloga prelazi u `<details>` „Tehnički detalji”: otisak teksta i priloga i verzija, `text-[13px] text-slate-600`;
  - **izjava:** cijela labela je kartica iste geometrije kao opcije izbora (`choiceCardCls`, `min-h-14`), checkbox `h-5 w-5`, tekst 15px;
  - **greške:** ručni `div` → `Flash err inset`:
    - `bad_code` stoji **neposredno iznad polja koda**, uz rečenicu `ballot.page.choicesKept` („Vaši izbori i izjava su sačuvani — samo ispravite kod.”) i, kad servis vrati `attemptsLeft`, „Preostalo pokušaja: N.”;
    - kad je `attemptsLeft === 0`, umjesto toga ide `ballot.errors.revokedAfterAttempts` sa kontaktom predsjednika;
    - ostale greške ostaju gdje su sada;
    - fokus ide na poruku (`errRef.current.focus()`, `tabIndex={-1}`) i za klijentske i za serverske greške;
  - **panel potvrde:** ručni amber blok (`:293-311`) → `ConfirmPanel` sa:
    - `formless`;
    - `confirmVariant="primary"`;
    - `title` `ballot.page.reviewTitle`;
    - `body` = postojeća lista „{kod} — {naslov}: **ZA**” (puni naslov, ne samo šifra);
    - `confirmLabel` sending/send, `confirmDisabled={pending}`;
    - `footer` = `Btn secondary` „Nazad na izmjene”.

    Panel je umotan u `div ref tabIndex={-1}`, koji pri otvaranju dobija fokus (`requestAnimationFrame`), pa VoiceOver čita naslov i izbore. Okidač ostaje `Btn secondary` „Pregledaj i potvrdi”. Enter u polju koda i dalje samo otvara pregled.
- **`actions.ts`:**
  - `BallotActionState.receipt` dobija `receiptId` (`ballotId`), `voterName` i `closesAt`;
  - `error` stanje dobija `attemptsLeft?: number`;
  - **nova `submitSingleVoteAction(prev, fd)`:**
    - čita jedini `choice:{proposalId}`;
    - bez izbora → `{ error: "missing_choices" }`;
    - izbor nije u `APPROVE|REJECT|ABSTAIN` → `{ error: "invalid_choice" }`;
    - `ack !== "on"` → `{ error: "ack_required" }` (prije servisa, pa se ne troši pokušaj, kao danas);
    - zatim **neizmijenjen** `submitVote(...)`;
    - uspjeh → `receipt` sa jednom stavkom i `receiptId = voteId`.
- **Poslije uspjeha** forma prikazuje `VoteReceipt` (F4.3) i radi `window.history.replaceState(null, "", "/glasanje/{token}?potvrda={receiptId}")`, pa osvježavanje i zabilješka vode na istu potvrdu. **Izbor nikad nije u URL-u.**
- **`page.tsx`:**
  - redoslijed: `potvrda` (ili stari `receipt` kao alias) → `getVoteReceipt` → `VoteReceipt`;
  - inače `isBallotLink` → `inspectBallot` → `BallotForm variant="session"`;
  - inače `inspectApprovalToken` → `BallotForm variant="single"`;
  - greška linka: `Flash err` sa tekstom iz `ballot.errors.*` (klasični `voting_closed` → `ballot.errors.voting_closed_single`) + rečenica sa kontaktom (`ballot.page.contact`: „Novi lični link izdaje predsjednik ZEV-a {ime}.”, a bez imena `ballot.page.contactNoName`);
  - lokalni `ERR_TEXT` se briše (sve ide u rječnik).
- **`shell.tsx`:** podnožje dobija `presidentName?` („…obratite se predsjedniku ZEV-a {ime}.”).

### F4.3 Potvrda koja se može ponovo otvoriti (V-Q3) — servis + `receipt.tsx`

- **Novi `getVoteReceipt({ tokenPlain, receiptId, ipHash })`** u `meetings.ts`. Javno, bez `Actor`-a: „guard” je tajni token u putanji, kao kod `inspectBallot`.
  1. `rateLimitVerify(verifyKey(...))` (isti brojač kao glasanje).
  2. **Listić** (`ballot.findUnique({ tokenHash })`): traži se `status === "USED"` i `b.id === receiptId`. Stavke su tokeni listića sa `vote` (`code`, `title`, `choice`, `voteId`, `submittedAt`), a „preskočeno” su tokeni bez glasa. `submittedAt = b.usedAt`, `voterName = recipient`, `closesAt = b.expiresAt`.
  3. **Klasični token:** `ballotId === null`, `status === "USED"` i `vote.id === receiptId`. Jedna stavka.
  4. Sve drugo (nepoznat token, pogrešan id, neiskorišten listić, `SUPERSEDED`/`REVOKED` bez glasa, id drugog listića) → `{ ok: false, error: "not_found" }`, bez razlikovanja razloga.
  5. Uspjeh → audit **`vote.receipt.view`** (`targetType` `Ballot`/`Vote`, `zevId` i `subjectPartyId` izvedeni iz zapisa, **bez izbora**).
- **Odakle izbor:** iz `Vote.choice` u bazi, po `receiptId` koji već postoji (`Ballot.id` / `Vote.id`, cuid). Za pristup su potrebna **oba**: tajni token iz e-maila i id koji se vidi tek poslije slanja. Sam proslijeđen e-mail bez adrese potvrde ne otkriva izbor.
- **Prihvaćen rizik (K-04 V-Q3):** ko dobije adresu potvrde (proslijeđena, istorija pregledača) vidi izbor. Isto važi za stare `?receipt=` adrese iz istorije, koje sada pokazuju punu potvrdu. Ispravljen glas (`correctVote`) na potvrdi i dalje pokazuje ono što je glasač poslao; to je dokaz njegove radnje, a ne rezultat.
- **`receipt.tsx`** je nova komponenta bez direktive, pa je koriste i klijentska forma i serverska stranica. Sastav:
  - `Flash msg` „Vaše izjašnjenje je evidentirano.”;
  - `Card title="Potvrda izjašnjavanja"` sa `dl`-om: Sjednica, Glasao/la (ime), Vrijeme (`formatDateTime`);
  - lista stavki (`ul.divide-y`, bez tabele, da na 375 nema horizontalnog skrola). Svaka stavka ima „{kod} — {naslov}”, „Vaš izbor: **ZA**” (`text-[15px]`) i „Broj potvrde: {voteId}” (`font-mono text-[13px] break-all`);
  - preskočeni prijedlozi kao danas;
  - rečenica `ballot.receipt.final`: „Glas je zabilježen kao nepromjenjiv zapis i ne može se promijeniti. Rezultat se objavljuje nakon zatvaranja glasanja {rok}.”;
  - upozorenje `ballot.receipt.keep`: „Ovu potvrdu možete ponovo otvoriti sa adrese ove stranice. Ko dobije tu adresu, vidi i Vaš izbor — ne prosljeđujte je. Svoje izjašnjenje vidite i u aplikaciji (Skupština i glasanje).”;
  - `PrintButton` (mali client: `Btn secondary` → `window.print()`, `print:hidden`).
- **`ballot.errors.used`** dobija nastavak: „Ako ste sačuvali adresu potvrde ili je odštampali, tamo je Vaše izjašnjenje; vidite ga i u aplikaciji.”

### F4.4 Prilozi — preko linka i u aplikaciji

- **Novi `readVotingAttachment({ tokenPlain, attachmentId, ipHash })`** u `meetings.ts` (javni, token je guard):
  - provjerava `rateLimitVerify`;
  - **listić:** status `ACTIVE` i `expiresAt > now`, ili `USED`;
  - **klasični token:** `ballotId === null` i status `ACTIVE` neistekao, ili `USED`;
  - `REVOKED`/`SUPERSEDED`/istekao → `not_found`;
  - prilog mora pripadati nekom prijedlogu **sa tog linka** (`proposal.attachments`); inače `not_found`;
  - bajtovi se čitaju preko nove interne `loadAttachmentBuffer(a)`, izdvojene iz `readAttachmentFile` (blob ili legacy `filePath`), bez promjene guard-a;
  - audit **`voting.attachment.download`** (`zevId`, `subjectPartyId` iz zapisa, `targetId` = prilog).
- **Nova ruta `src/app/glasanje/[token]/prilog/[attachmentId]/route.ts`:**
  - `isPrefetchRequest` → `prefetchIgnored()`;
  - uspjeh: `Content-Disposition: inline`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`;
  - svaka greška → 404 „Prilog nije dostupan.”
- **`readAttachmentFile` (aplikacija):** nova grana za ne-upravu. Dozvoljeno je ako je prilog vezan za prijedlog istog ZEV-a koji **nije `DRAFT`** (`prisma.proposal.count({ where: { zevId, status: { not: "DRAFT" }, attachments: { some: { id } } } })`). Audit ostaje `attachment.download`.
- `inspectApprovalToken` vraća `attachments` (id, naziv, mime, veličina, sha256), a i `inspectBallot` dodaje `mime`.

### F4.5 Vlasnik u aplikaciji — prijedlog i sjednica (V-R04)

**Novi servis (u `meetings.ts`):**
- `getOwnerProposalView(actor, proposalId)`:
  - `requireAnyUser`, `requireZev`;
  - vraća samo podatke prijedloga (bez tuđih birača i glasova), priloge (ako status ≠ `DRAFT`), `participations: OwnerVoteState[]` i `contact`.
- `ownerVoteStates(actor, proposalIds): Map<proposalId, OwnerVoteState>`:
  - isti izvor za sjednicu;
  - jedan upit `eligibleVoter.findMany` po `OR [ownerId, proxyId, memberPartyIds has]` + `tokens` + važeći efektivni glasovi (`invalid: false`, `correctedBy: null`);
  - aktivni listići primaoca jednim upitom.
- `getVotingContact(actor)` → `{ name, email, phone } | null` (tekući `OfficeTerm` PRESIDENT; pravilo isto kao `listOfficeHolders`).
- Isto ime predsjednika (`presidentName`) vraćaju i `inspectBallot`/`inspectApprovalToken` (uspjeh i greške `revoked`/`used`/`expired`/`voting_closed`), po `zevId` zapisa.

```ts
type OwnerVoteState =
  | { kind: "draft" } | { kind: "boardOnly" } | { kind: "notInBase" }
  | { kind: "canVote"; closesAt: Date | null; link: "ballot" | "single" | "none"; linkActive: boolean;
      proxyName: string | null /* link je dobio punomoćnik */; forOwnerName: string | null /* ja sam punomoćnik */ }
  | { kind: "voted"; at: Date; choice: VoteChoice | null /* null kad F4-Q1 = (b) */; receiptNo: string;
      channel: VoteChannel; viaProxyName: string | null; forOwnerName: string | null }
  | { kind: "viaRepresentative"; units: string; representativeName: string; communityVoted: boolean; at: Date | null } // bez izbora (K-03a)
  | { kind: "closedNotVoted" };
```

**`/skupstina/prijedlog/[id]` (grana vlasnika)** koristi `getOwnerProposalView`, ne `getProposal`:
- **podnaslov:** „{sjednica} · glasanje do {rok}”, a „Verzija N” samo kad je N > 1;
- **`Card` „Vaše učešće” je prva**, iznad teksta prijedloga. Po stavci `participations` ide `StatusBadge` + rečenica (`text-[15px]`):
  - `canVote`:
    - chip „Niste se izjasnili” (status `PENDING`);
    - „Imate pravo glasa · glasanje traje do 03.11.2026. u 07:53.”;
    - `link`:
      - `ballot` → „Lični link za ovu sjednicu stigao je jednim e-mailom; glasate o svim prijedlozima odjednom.”;
      - `single` → „Lični link i kod stigli su e-poštom.”;
      - `none` → „Lični link Vam nije poslat jer ZEV nema Vašu e-adresu.”;
    - `proxyName` → „Za Vas se izjašnjava punomoćnik {ime}; lični link je dobio on.”;
  - `voted`:
    - chip „Izjasnili ste se” (`ok`);
    - „Izjasnili ste se 24.10.2026. u 09:12 (elektronski / na papiru).”;
    - po F4-Q1 „Vaš izbor: **Za**”;
    - „Broj potvrde: {receiptNo}” (13px mono);
    - preko punomoćnika: „Izjasnio se Vaš punomoćnik {ime}.”;
  - `viaRepresentative`: postojeći tekstovi (`votingSubject.owner.*`) + datum kad je zajednica glasala; **bez izbora**;
  - `boardOnly`, `draft`, `notInBase`: postojeći `confirm.participation.*`;
  - `closedNotVoted`: „Glasanje je zatvoreno; niste se izjasnili.”
- **Kontakt** se prikazuje samo kad postoji `canVote` (V-Q2), kao rečenica (13px meta + 15px tekst), bez dugmeta:
  - „Niste dobili link ili ste ga izgubili? Novi lični link izdaje predsjednik ZEV-a {ime} — {telefon} · {e-adresa}. Stari link tada prestaje da važi.”;
  - telefon je `tel:`, a e-adresa `mailto:` kao `RowLink`;
  - bez predsjednika: „Obratite se predsjedniku ZEV-a.”;
  - za `link: "none"`: „Javite predsjedniku e-adresu za novi link ili glasajte na papiru.”
- **`Card` „Prilozi”** (kad ih ima i status ≠ DRAFT): „{naziv} · {N} KB” + `RowLink newTab` „Otvori” → `/api/prilozi/{id}`.
- Tekst prijedloga: `text-[15px] leading-relaxed max-w-[68ch]`.
- Nijedno `primary` na stranici.

**`/skupstina/[id]` (ne-uprava, tj. `!isManagement(actor)`):**
- umjesto `MeetingTimeline` (10 koraka): `StatusTimeline` sa **3 koraka** iz nove čiste funkcije `src/lib/ownerMeetingStage.ts`:
  - `ownerMeetingStage(status)` → `{ activeKey: "SCHEDULED" | "VOTING" | "DECIDED"; sentenceKey }`;
  - DRAFT…INVITATIONS_SENT → `SCHEDULED`;
  - VOTING_OPEN, VOTING_CLOSED, RESULTS_REVIEW → `VOTING` (rečenica razlikuje „Glasanje je otvoreno do …” i „Glasanje je završeno; rezultati se provjeravaju.”);
  - DECISION_RECORDED, MINUTES_FINALIZED, ARCHIVED → `DECIDED` („Odluke su evidentirane; dokumenti su u Dokumentima.”);
  - labele: „Zakazana · Glasanje · Odluke”;
- u istoj `Card` (prva, ispod zaglavlja):
  - `dl` Termin / Mjesto;
  - rečenica o ulozi iz `ownerVoteStates`: „Imate pravo glasa o 3 prijedloga; izjasnili ste se o 1.” / „Za Stan 3 glasa Vaš predstavnik …” / „Ovo je sjednica upravnog odbora — glasaju članovi odbora.”;
  - kontakt kao na prijedlogu, kad postoji neizjašnjen `canVote`;
- **tabela prijedloga za vlasnika:**
  - Šifra · Naziv · Rok · **Vaš status** (`StatusBadge`: Izjasnili ste se / Niste se izjasnili / Glasa predstavnik / Nemate pravo glasa / —) · Status;
  - 5 kolona: bez „Glasalo” i „Verzija”;
  - uprava bez promjene;
- računovođa i predsjednik vide današnji prikaz.

### F4.6 Iskren tekst o kodu (V-Q6) i izjava

- `ballot.page.codeLabel`: „Verifikacioni kod iz poruke”.
- `ballot.page.codeHint`: „Kod je u istoj e-poruci kao link. Štiti od slučajno proslijeđenog linka (bez koda link ne radi), ali ne od nekoga ko ima pristup Vašem e-sandučetu. Isti kod važi za sve prijedloge.” Za `single` važi isti tekst bez posljednje rečenice (`codeHintSingle`).
- `ballot.page.identityTitle`: „Verifikacioni kod” (umjesto „Potvrda identiteta”).
- `ballot.mail.personal` i tijelo `approval-link` (`meetings.ts:1454`): „Ne prosljeđujte ovu poruku: link i kod zajedno omogućavaju izjašnjavanje u Vaše ime.” Red „Vaš verifikacioni kod: {kod}” se **ne mijenja** (regex `testOutbox`).
- `ACK_TEXT` i `ackPrefix`, **samo ako F4-Q4 = (a)**: „…da sam pročitao/la prijedlog i njegove priloge (ako ih ima) u cijelosti…”. Prefiks listića: „Pročitao/la sam sve prijedloge i njihove priloge u cijelosti.” Važi samo za nove glasove (stari zadržavaju svoj `acknowledgementText`). Tekst neka pregleda predsjednik ili pravnik.

### F4.7 Rječnik, katalog, DS

- **`sr-Latn.ts` i `en.ts`** (isti ključevi):
  - `ballot.page.{introSingle, ackPrefixSingle, whoAssembly, whoBoard, weight, proposalTitleVersion, attachmentRow, attachmentOpen, newTab, choicesKept, attemptsLeft, contact, contactNoName, codeHintSingle}`;
  - `ballot.receipt.{title, done, meeting, voter, time, yourChoice, number, final, keep, print}`;
  - `ballot.errors.{voting_closed_single, revokedAfterAttempts}`, dopuna `used`;
  - nova grupa `ownerVoting.*` (stanja, chipovi, kontakt, faze sjednice, kolona „Vaš status”);
  - `auditAction.vote.receipt.view` „Otvorena potvrda izjašnjavanja” i `auditAction.voting.attachment.download` „Preuzet prilog prijedloga preko glasačkog linka”;
  - postojeći `receiptIntro`/`receiptKeep` se brišu.
- **`src/lib/activity/catalog.ts`:** `"vote.receipt.view": "SYSTEM"`, `"voting.attachment.download": "SYSTEM"`. Ime `voting.*` namjerno nije `attachment.download.*`, jer bi `attachment.download` postao prefiks i tražio `auditActionExact`.
- **`Plans/design-system.md`:** §4.2 (F4.1), §4.3 `ConfirmAction`/`ConfirmPanel`. **`Plans/design-review-plan.md`:** status F4 (V-R03, V-R04, V-R09 pokriveni).
- **Servisi:** `submitVote`/`submitBallot` na `bad_code` vraćaju `attemptsLeft: Math.max(0, 5 - updated.failedAttempts)`. Samo povratna vrijednost; uslov i opoziv se ne mijenjaju.

### Koraci implementacije

1. `src/components/ui.tsx`: `SubmitBtn disabled`, `ConfirmPanel`/`ConfirmAction` `formless` (F4.1).
2. `src/server/services/attachments.ts`: izdvojiti `loadAttachmentBuffer`; vlasnička grana za prilog prijedloga koji nije `DRAFT` (F4.4).
3. `src/server/services/meetings.ts`:
   - `attemptsLeft` u `submitVote`/`submitBallot` (samo povratna vrijednost);
   - `inspectApprovalToken` + `attachments`, `presidentName`, `body`, `units`;
   - `inspectBallot` + `body`, `units`, `mime`, `presidentName` (i na greškama);
   - novi `getVoteReceipt`, `readVotingAttachment`, `getVotingContact`, `ownerVoteStates`, `getOwnerProposalView`;
   - tekst `approval-link` poruke (F4.6);
   - `ACK_TEXT` (po F4-Q4).
4. `src/lib/ownerMeetingStage.ts` (čista funkcija).
5. `src/lib/activity/catalog.ts` + `src/lib/i18n/sr-Latn.ts` + `src/lib/i18n/en.ts` (F4.7).
6. `src/app/glasanje/[token]/`:
   - `actions.ts` (`submitSingleVoteAction`, prošireno stanje);
   - `receipt.tsx` + `print-button.tsx`;
   - `ballot-form.tsx` (F4.2);
   - `page.tsx` (redoslijed `potvrda` → listić → klasični; brisanje `voteAction`/`ERR_TEXT`);
   - `shell.tsx`;
   - nova `prilog/[attachmentId]/route.ts`.
7. `src/app/(app)/skupstina/prijedlog/[id]/page.tsx` (grana vlasnika) i `src/app/(app)/skupstina/[id]/page.tsx` (vlasnički prikaz).
8. Testovi (§3), pipeline, živa provjera (§4), `CHANGELOG.md`, verzija, `Plans/design-system.md`, `Plans/design-review-plan.md`.

---

## 3. Testovi

**Moraju ostati zeleni bez izmjene očekivanja** (čuvari bezbjednosti glasanja):
- `tests/voting.test.ts` „secure electronic approval”:
  - jednokratnost;
  - istekao / opozvan / ponovo izdat link;
  - proslijeđen link bez koda i opoziv poslije promašaja;
  - jedan glas po biraču (e + papir);
  - zamrznut tekst;
  - nova verzija poništava linkove;
- `tests/voting.test.ts`: FR i K-03 testovi (predstavnik, suvlasnik bez linka);
- `tests/ballots.test.ts`, `submitBallot` blok:
  - sve ili ništa;
  - pogrešan kod, 5 puta = opoziv;
  - `use_ballot`;
  - zatvoren ili papirom riješen prijedlog;
  - nevažeći izbor;
- `tests/ballots.test.ts`: jednakost rezultata i `reissueBallot`/`revokeBallot`;
- `tests/permissions.test.ts`:
  - „owner cannot access another owner's approval link”;
  - „nobody can UPDATE or DELETE a submitted vote”;
- `tests/tenant-isolation.test.ts`:
  - `revokeToken`/`reissueToken`;
  - `openProposalsForOwner`/`ownVotes`;
  - audit `submitVote`;
- `tests/activity-catalog.test.ts` (nove šifre moraju biti u katalogu);
- `tests/live-meeting.test.ts`, `tests/session-voting-open.test.ts`.

**Dopune postojećih:**
- `tests/ballots.test.ts`:
  - `bad_code` vraća `attemptsLeft` 4, 3, 2, 1, 0, a peti promašaj i dalje opoziva listić;
  - `inspectBallot` vraća `body`, jedinice glasača, `mime` priloga i `presidentName`;
  - greška `revoked` nosi `presidentName`.
- `tests/voting.test.ts`:
  - `inspectApprovalToken` vraća priloge prijedloga;
  - `submitVote` na `bad_code` vraća `attemptsLeft`.

**Novi `tests/vote-receipt.test.ts`:**
- listić: poslije `submitBallot`, `getVoteReceipt(token, ballotId)` daje stavke sa izborima, `voteId`-jevima, `submittedAt = usedAt`, ime primaoca i preskočene (papirni glas);
- audit `vote.receipt.view` postoji i **ne sadrži izbor** (`JSON.stringify(after)` bez `APPROVE`/`REJECT`/`ABSTAIN`);
- `not_found` za:
  - neiskorišten listić sa svojim id-jem;
  - pogrešan id;
  - id drugog listića sa ovim tokenom;
  - zamijenjen (`SUPERSEDED`) listić;
  - nepoznat token;
- klasični token: poslije `submitVote`, `getVoteReceipt(token, voteId)` daje jednu stavku; `voteId` drugog glasa → `not_found`;
- ispravljen glas: potvrda i dalje pokazuje poslati izbor (zapis glasača), bez greške.

**Novi `tests/voting-attachments.test.ts`:**
- listić čita prilog svog prijedloga: bajtovi su jednaki, audit `voting.attachment.download` ima `zevId`;
- prilog drugog prijedloga istog ZEV-a koji nije na listiću → `not_found`;
- prilog drugog ZEV-a → `not_found`;
- opozvan, zamijenjen ili istekao listić → `not_found`; iskorišten → dozvoljeno;
- klasični token: isto;
- `readAttachmentFile`: vlasnik čita prilog otvorenog prijedloga, a prilog nacrta → `ForbiddenError`. Postojeći slučajevi (dokaz vlasništva, saglasnost) se ne mijenjaju.

**Novi `tests/owner-voting.test.ts`:**
- stanja `draft`, `boardOnly` (vlasnik koji nije član), `notInBase` (obuhvat drugih jedinica), `canVote` sa `link: "ballot"` i `linkActive`, `canVote` sa `link: "none"` (birač bez e-adrese), `voted` (datum, `receiptNo` = id glasa, izbor po F4-Q1), `closedNotVoted`;
- vlasnik koji je dao punomoć: `canVote.proxyName`; kad punomoćnik glasa, `voted.viaProxyName`;
- punomoćnik vidi `forOwnerName`;
- suvlasnik koji nije predstavnik: `viaRepresentative` i objekat **nema** ključ `choice`;
- ispravljen glas: stanje pokazuje ispravku (efektivni glas);
- `getOwnerProposalView` ne vraća tuđe birače ni glasove (provjera oblika);
- prijedlog drugog ZEV-a → greška;
- nalog bez `partyId` → `notInBase`;
- `getVotingContact`: ime, e-adresa i telefon tekućeg predsjednika; zatvoren mandat se ne vidi; bez mandata → `null`;
- `ownerVoteStates` za sjednicu sa 3 prijedloga: jedan upit po vrsti (bez N+1; provjera brojem rezultata, ne vremenom).

**Novi `tests/owner-meeting-stage.test.ts`** (čista funkcija): svih 10 statusa → tačan `activeKey` i rečenica.

**Opciono** (ako je jednostavno, `react-dom/server` `renderToStaticMarkup`): `ConfirmPanel formless` renderuje `div` bez `<form>` i dugme `type="submit"`. Inače se provjerava uživo.

## 4. Provjera

- **Pipeline:** `export PATH=~/.local/zev-tools/node/bin:$PATH; npm run typecheck && npm run lint && npm test && npm run build`. Dozvoljene su samo poznate 3 greške u `tests/env.test.ts`.
- **Podaci:** seed (klasični tokeni za UO-2026-01 i prijedloge skupštine; Ana → punomoćnik Dragan). Lokalna skripta pravi sjednicu sa 2 prijedloga (jedan sa PDF prilogom) i otvara je listićima. Link i kod se čitaju iz `NotificationMessage` (`extractApprovalSecrets`). Skripta se poslije briše.
- **Živi pregled** (svjež build, `next start`, Playwright + Chrome), **1440 i 375**:

| Ekran (stanje) | Šta mora biti istina |
|---|---|
| listić, svježe | koraci čitljivi; „Glasate jednom, kao etažni vlasnik: …”; prilog sa „Otvori” se otvara u novoj kartici i izbori ostaju; otisak samo pod „Tehnički detalji”; **nijedno `primary`** dok panel nije otvoren; ništa ispod 13px, bez `slate-400` sadržaja |
| listić, panel otvoren | fokus je na panelu; panel navodi svaki prijedlog sa naslovom i izborom; **tačno jedno `primary`** („Da, pošalji izjašnjenje”) + `secondary` „Nazad na izmjene” |
| pogrešan kod | `Flash` iznad polja koda, „izbori su sačuvani”, „Preostalo pokušaja: 4”; izbori i izjava označeni |
| bez izjave / bez izbora | poruka imenuje šta nedostaje; ništa se ne gubi |
| peti pogrešan kod | „Listić je opozvan…” + ime predsjednika |
| potvrda | prijedlog, ime, vrijeme, izbor, broj potvrde, „Odštampaj”; URL je `?potvrda=…` **bez izbora**; osvježavanje pokazuje istu potvrdu; pregled štampe bez dugmeta |
| isti link ponovo (bez `potvrda`) | „već izvršeno” + uputa o potvrdi i aplikaciji |
| istekao / opozvan / nepoznat link | poruka + sljedeći korak sa imenom predsjednika (nepoznat: bez imena) |
| klasični link (UO-2026-01, Nikola) | isti obrazac kao listić (jedan prijedlog, bez brojača); svih 5 stanja iznad |
| prijedlog u aplikaciji (Ana, pa Nikola, pa Sara) | Ana: „Za Vas se izjašnjava punomoćnik Dragan Babić…” + kontakt; Nikola poslije glasanja: „Izjasnili ste se … · Vaš izbor (F4-Q1) · Broj potvrde”; Sara: „Za Stan 3 glasa Vaš predstavnik…”, bez izbora; prilozi otvaraju PDF |
| sjednica (vlasnik) | 3 koraka, termin i mjesto, rečenica o ulozi, kolona „Vaš status”; na 375 bez odsječenih kolona |
| sjednica (predsjednik, računovođa) | bez promjene (panel „Sljedeći korak”, 10 koraka, „Glasalo”) |

- **Tastatura:** cijeli tok listića bez miša: Tab kroz opcije (strelice u grupi), prilog (Enter otvara novu karticu), kod, izjava (Space), „Pregledaj i potvrdi”, fokus u panelu, „Da, pošalji”, potvrda, „Odštampaj”. Fokus je stalno vidljiv.
- **VoiceOver (macOS Safari):**
  - pri otvaranju panela čita naslov „Slanje izjašnjenja je konačno” i listu „{kod} — {naslov}: ZA”;
  - greška se najavljuje (`role="alert"`);
  - brojač „Izabrano N od M” se najavljuje (`aria-live`);
  - grupa izbora ima legendu sa šifrom prijedloga.
- **Izlazni kriterijum (design-review-plan §6 F4):**
  - tačno jedno `primary`;
  - prilozi dostupni;
  - greška ne briše izbor;
  - potvrda navodi prijedlog i vrijeme (i izbor);
  - vlasnik u aplikaciji vidi „Izjasnili ste se”.
- **Poslije pregleda:** `npm run db:reset && npm run db:seed`, brisanje skripti i test dokumenata.

## 5. Isporuka

- Jedan commit. **Verzija: prijedlog minor → 2.55.0** (nova mogućnost: potvrda, prilozi, stanje glasanja u aplikaciji). **Korisnik potvrđuje patch/minor/major prije upisa.**
- `CHANGELOG.md`: Dodato / Izmijenjeno / Ispravljeno, uz napomenu **„bez migracije — deploy ne traži ručni korak”**. Pomenuti i da stare `?receipt=` adrese sada pokazuju punu potvrdu (V-Q3).
- Implementacija po dogovoru: Sonnet po planu, Opus pregleda, posebno F4.3, F4.4 i diff u `meetings.ts` oko `submitVote`/`submitBallot`. Pregled ide redom: `git diff` tih funkcija smije sadržati samo `attemptsLeft`.
- Povlačenje: Vercel vraćanje na prethodni deployment (nema migracije; nove audit šifre stari kod prikazuje kao sirovu šifru).

## 6. Rizici

- **Bezbjednost glasanja (najveći).** Bilo kakva izmjena uslova u `submitVote`, `submitBallot` ili `castElectronicVoteTx` je van obima. Mjere: postojeći testovi iz §3 bez izmjene očekivanja, a diff tih funkcija ograničen na povratnu vrijednost. Nova klasična akcija poziva **isti** `submitVote`; provjera izjave je, kao danas, prije servisa.
- **Potvrda otkriva izbor** onome ko dobije njenu adresu. Rizik je prihvaćen (K-04 V-Q3) i ublažen time što adresa traži i token i id potvrde, kao i upozorenjem na ekranu. `cuid` nije kriptografska tajna, ali je samo drugi faktor uz tajni token, a lookup je ograničen istim brojačem pokušaja (20 / 15 min). Audit `vote.receipt.view` bilježi svako otvaranje.
- **Javna ruta priloga** je nova javna površina. Mjere:
  - samo prilozi prijedloga sa tog linka;
  - opozvan, zamijenjen ili istekao link ne radi;
  - isti limit pokušaja;
  - prefetch guard i `no-store`;
  - generička 404.
- **`readAttachmentFile` šira prava za vlasnika:** prilozi prijedloga (osim nacrta) postaju vidljivi svim vlasnicima ZEV-a, uključujući prijedloge UO. To je u skladu s tim da tekst prijedloga vlasnik već vidi (`getProposal`). Ako ponuda izvođača sadrži povjerljive podatke, predsjednik je ne treba prilagati (napomena u CHANGELOG-u).
- **Kontakt predsjednika** (telefon, e-adresa) postaje vidljiv vlasnicima. To je nova izloženost ličnih podataka, pa je F4-Q2 pitanje prije isporuke.
- **`ACK_TEXT`** je pravni tekst. Izmjena važi samo za nove glasove, a stari čuvaju svoj tekst u `Vote.acknowledgementText`. Pregled predsjednika ili pravnika (F4-Q4).
- **Regex `testOutbox`** (`verifikacioni kod: (\d{6})`) zavisi od teksta e-maila. Red sa kodom se ne dira; test listića to i provjerava.
- **Klasična stranica prelazi na klijentsku formu (JS).** Bez JS-a slanje ne radi. To je već slučaj za listić od v2.44.0 i prihvaćeno je; stari server-only put se namjerno ne zadržava, da ne ostanu dva toka.

## 7. Otvorena pitanja za korisnika

| # | Pitanje | Opcije | Preporuka |
|---|---|---|---|
| **F4-Q1** | Da li vlasnik u aplikaciji (iza prijave) vidi **svoj izbor** na prijedlogu? | (a) da: „Vaš izbor: Za” uz datum i broj potvrde, za sopstveni glas i za glas punomoćnika u njegovo ime; nikad za glas zajednice preko predstavnika (K-03a); (b) ne: samo „Izjasnili ste se {datum}” i broj potvrde | **(a)**: to je njegov trajni dokaz, u skladu sa V-Q3, i manje je izložen od adrese potvrde |
| **F4-Q2** | Koji kontakt predsjednika se prikazuje (V-Q2)? | (a) u aplikaciji ime + telefon + e-adresa (ako su upisani), a na javnoj stranici glasanja samo ime; (b) ime i kontakt i na javnoj stranici; (c) svuda samo ime | **(a)**: vlasnik u aplikaciji može odmah nazvati, a proslijeđen javni link ne otkriva predsjednikov telefon |
| **F4-Q3** | Koliko dugo radi adresa potvrde (`?potvrda=`)? | (a) trajno, dok postoji zapis glasa; (b) do zatvaranja glasanja + 30 dana, a poslije samo u aplikaciji | **(a)**: rizik je već prihvaćen (K-04), a ograničenje bi uzelo dokaz vlasniku bez naloga |
| **F4-Q4** | Izjava „pročitao/la … u cijelosti” uključuje priloge? | (a) „…prijedlog i njegove priloge (ako ih ima) u cijelosti”, za nove glasove; (b) bez izmjene teksta | **(a)**, uz pregled predsjednika ili pravnika prije isporuke |
| **F4-Q5** | Pokazati „Preostalo pokušaja: N” poslije pogrešnog koda? | (a) da, tačan broj iz servisa; (b) ne, samo „kod nije ispravan” | **(a)**: stariji korisnik zna kada da stane i nazove predsjednika; broj ne pomaže napadaču koji ionako ima 5 pokušaja |
| **F4-Q6** | Verzija | patch / **minor → 2.55.0** / major | **minor** |
