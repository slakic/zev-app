# Glasački listić po sjednici — jedan e-mail, jedan link i jedan kod za sve prijedloge — plan za pregled

**Status: ISPORUČENO u v2.44.0 (nije commitovano).** Odobreno 2026-10-25, minor → 2.44.0. Korisnik je prihvatio preporuke za P-L1 do P-L6 (§9):
- **P-L1:** „Uzdržan” je validan odgovor; listić se predaje tek kad svaki prijedlog ima odgovor.
- **P-L2:** novi prijedlog se ne može dodati sjednici dok je njeno glasanje otvoreno (listić je zaključan skup); nova tačka ide na novu sjednicu.
- **P-L3:** svi prijedlozi listića moraju imati isti rok glasanja — preduslov za otvaranje glasanja na sjednici.
- **P-L4:** poziv na sjednicu i listić ostaju odvojene poruke.
- **P-L5:** režim uživo bez izmjene u ovoj fazi.
- **P-L6:** dnevni limit ostaje varijabla okruženja `EMAIL_DAILY_SOFT_LIMIT` (podrazumijevano 180).

Nastalo na zahtjev korisnika (2026-10-25): „Pošto koristimo Mailjet koji ima dnevni limit poslatih e-mailova, slanje e-maila za svaki prijedlog nije optimalno. Kad je dnevni red postavljen i svi prijedlozi finalizovani, treba poslati linkove tako da korisnik dobije **jedan e-mail po sjednici**, sa linkom na sve prijedloge. Korisnik onda koristi **jedan lični kod** da završi glasanje, a pravila validacije osiguravaju da se glasa o **svim prijedlozima**.”

Plan je izrađen čitanjem stvarnog koda (v2.43.2). Verzija: prijedlog je **minor → 2.44.0**, uz potvrdu prije upisa.

---

## 0. Rezime

1. **Danas** svaki prijedlog šalje svakom glasaču zaseban e-mail sa svojim linkom i kodom (`openVoting`, `meetings.ts:1184-1206`). Svi ti e-mailovi izgledaju isto: naslov je „Poziv na elektronsko izjašnjavanje”, bez šifre i naslova prijedloga. Sjednica sa 3 prijedloga i 40 glasača troši 120 poruka.
2. **Glasačke poruke ne poštuju dnevni limit.** `queueNotification` šalje odmah (`notifications/service.ts:64-66`). Dnevni „meki” limit (`EMAIL_DAILY_SOFT_LIMIT`, podrazumijevano 180) i dugme „Pošalji neposlate” postoje samo za fakture (`invoiceEmail.ts:246-323`). Iznad limita glasačke poruke tiho padaju u `FAILED`.
3. **Prijedlog:** novi pojam **glasački listić (`Ballot`)**, jedan po glasaču po sjednici.
   - Kad predsjednik na sjednici otvori glasanje (korak iz v2.43.2), za sve prijedloge u nacrtu se pravi osnova glasanja i tokeni po prijedlogu **bez slanja**, a zatim po jedan listić i **jedan e-mail** po glasaču. E-mail sadrži jedan link, jedan kod i spisak svih prijedloga.
   - Na stranici listića glasač vidi sve prijedloge, za svaki bira Za / Protiv / Uzdržan, upisuje kod jednom i potvrđuje jednom.
   - Listić se **ne može poslati dok nije izabran odgovor za svaki prijedlog**. Glasovi se upisuju **svi zajedno ili nijedan**, u jednoj transakciji.
4. **Dokaz po prijedlogu ostaje isti.** Za svaki prijedlog se i dalje piše poseban `Vote`, sa otiskom zamrznutog teksta tog prijedloga i auditom `vote.submit`. Rezultat, kvorum, zatvaranje i glasačka lista se ne mijenjaju. Listić je samo zajednički „ključ” nad postojećim tokenima po prijedlogu.
5. **Dnevni limit:** listići (i pozivi na sjednicu) idu kroz isti ograničeni put slanja kao fakture, uz upozorenje u potvrdi kad broj poruka prelazi preostali dnevni limit i dugme „Pošalji neposlate”.
6. **Režim uživo se ne mijenja** u ovoj fazi (§13). Prijedlozi se i dalje otvaraju po tački, a odsutni dobijaju poruku po prijedlogu.

---

## 1. Zatečeno stanje (provjereno u kodu)

| Šta | Gdje | Posljedica |
|---|---|---|
| Token i kod su po prijedlogu: `ApprovalToken` pripada `EligibleVoter`-u jednog prijedloga, a `Vote.tokenId` je `@unique` | `schema.prisma` (modeli `ApprovalToken`, `Vote`) | jedan token ne može nositi više glasova; listić mora biti iznad postojećih tokena, ne umjesto njih |
| `openVoting` piše osnovu, tokene i audit u jednoj transakciji, pa šalje e-mail po glasaču | `meetings.ts` (`openVoting`, slanje `:1184-1206`) | treba novi način dostave: tokeni bez e-maila |
| `submitVote` provjerava token (status, istek, otvoreno glasanje, kod po hash-u), sprečava dupli glas, piše `Vote`, troši token i audit | `meetings.ts:1534-1660` | jezgro se izdvaja i poziva za svaki prijedlog sa listića |
| 5 neuspjelih kodova automatski opoziva token; ograničenje pokušaja po ključu | `meetings.ts:1437, 1639-1656` | isto pravilo prelazi na listić |
| `reissueToken` / `revokeToken` po tokenu | `meetings.ts:1359, 1380` | za listić treba ponovno izdavanje na nivou listića |
| Sjednica otvara prijedloge iz nacrta odjednom (v2.43.2), ali svaki šalje svoje poruke | `advanceMeetingStatus(…, { openDraftProposals })` | prirodno mjesto za listić |
| Slanje odmah, bez dnevnog limita; limit i „Pošalji neposlate” samo za fakture | `notifications/service.ts:64-66`; `invoiceEmail.ts:246-323` | limit se izdvaja u zajedničku funkciju |
| Javna stranica glasanja `/glasanje/[token]` je za jedan prijedlog | `src/app/glasanje/[token]/page.tsx` (212 linija) | dobija prikaz listića za više prijedloga |
| Prijedlozi jedne sjednice mogu imati različite rokove (`votingClosesAt`) i različit obuhvat (cijeli ZEV ili jedinice) | `Proposal` | listić sadrži samo prijedloge u kojima je glasač u osnovi; rok listića se mora pravilno odrediti (P-L3) |

---

## 2. Model podataka (jedna aditivna migracija)

```prisma
enum BallotStatus { ACTIVE USED REVOKED SUPERSEDED }

model Ballot {
  id               String        @id @default(cuid())
  zev              Zev           @relation(fields: [zevId], references: [id])
  zevId            String
  meeting          Meeting       @relation(fields: [meetingId], references: [id])
  meetingId        String
  recipient        Party         @relation(fields: [recipientPartyId], references: [id])
  recipientPartyId String        // ko dobija listić: samostalni vlasnik / predstavnik zajednice / punomoćnik
  tokenHash        String        @unique   // sha256(link token), nikad plaintext
  verificationHash String                  // sha256(lični kod)
  status           BallotStatus  @default(ACTIVE)
  expiresAt        DateTime
  issuedAt         DateTime      @default(now())
  openedAt         DateTime?
  usedAt           DateTime?
  revokedAt        DateTime?
  revokedReason    String?
  failedAttempts   Int           @default(0)
  replacedById     String?       @unique
  replacedBy       Ballot?       @relation("BallotReissue", fields: [replacedById], references: [id])
  replaces         Ballot?       @relation("BallotReissue")
  tokens           ApprovalToken[]
  createdAt        DateTime      @default(now())
  @@index([meetingId])
}

model ApprovalToken {
  // …postojeće…
  ballot   Ballot? @relation(fields: [ballotId], references: [id])
  ballotId String?             // null = klasični token po prijedlogu (režim uživo, pojedinačno otvaranje)
}
```

- **Tokeni ispod listića:** zadržavaju svoj `tokenHash`, nasumičan i nikad poslat, pa se ne mogu koristiti sami za sebe. Imaju `deliveredVia = "BALLOT"`.
- **Glas sa listića:** `Vote` se piše na token po prijedlogu, kao danas. `Vote.deliveryChannel = "BALLOT"`.
- **Bez append-only triggera:** `Ballot` mijenja status (`ACTIVE` → `USED` / `REVOKED`), kao i `ApprovalToken`.
- **Nova polja nisu obavezna,** pa je povlačenje na v2.43.2 bezbjedno: stari kod ignoriše `ballotId`.

---

## 3. Servisni sloj

### 3.1 Otvaranje: tokeni bez slanja, pa listići
- **`openVoting`** dobija treći način dostave, `delivery: "BALLOT"`: osnova, tokeni i audit kao danas, ali bez `queueNotification`. Vraća parove (token po prijedlogu, primalac).
- **Novo `issueMeetingBallots(actor, meetingId, proposalIds)`:**
  - grupiše nove tokene po primaocu (`recipientPartyId` = punomoćnik ili lice koje glasa; §3.4 iz FR);
  - za svakog primaoca pravi jedan `Ballot` (link i kod; isti generatori `generateToken` / `generateVerificationCode`) i veže njegove tokene;
  - audit `ballot.issue` (bez tajni);
  - stavlja **jednu poruku po listiću** u red (`template: "ballot-link"`, §3.5).
- **`advanceMeetingStatus(…, { openDraftProposals: true })`** (v2.43.2):
  - otvara sve nacrte sa `delivery: "BALLOT"`, pa poziva `issueMeetingBallots`;
  - redoslijed „prvo provjeri sve, pa otvori, pa promijeni status sjednice” ostaje;
  - ako `issueMeetingBallots` padne nakon otvaranja prijedloga, ponovljen korak izdaje listiće samo za tokene koji još nemaju `ballotId` (idempotentno).
- **Pojedinačno otvaranje prijedloga** (dugme na prijedlogu) i **režim uživo** ostaju kao danas (`delivery: "ALL"` / `"LIVE"`), sa porukom po prijedlogu. Prijedlog dodat nakon što su listići poslati obrađuje P-L2.
- **P-L2 (odlučeno, precizirano 2026-10-25):** `createProposal` odbija novi prijedlog samo na sjednici za koju su **izdati glasački listići**, uz poruku „Za ovu sjednicu su poslati glasački listići — novi prijedlog ide na novu sjednicu.” Sjednica u „Glasanje otvoreno” bez listića (režim uživo, prijedlozi po tački) i dalje može dobiti novi prijedlog.
- **P-L3 (odlučeno):** `previewSessionVotingOpen` dobija preduslov: svi prijedlozi u nacrtu imaju isti efektivni rok (`votingClosesAt ?? meeting.eVoteClosesAt`); inače greška imenuje prijedloge sa različitim rokom. Listić važi do tog roka.

### 3.2 Glasanje listićem
- **Novo `inspectBallot(tokenPlain, ipHash?)`:** vraća sjednicu, primaoca i za svaki token listića: prijedlog (šifra, naslov, zamrznut tekst, prilozi, otisak), stanje (`otvoren` / `zatvoren` / `već glasano`, npr. ručni papirni glas) i rok. Prvo otvaranje upisuje `openedAt` i audit `ballot.open`, isto kao danas za token.
- **Novo `submitBallot({ tokenPlain, verificationCode, choices: Record<proposalId, VoteChoice>, ack, ipHash, userAgent })`:**
  1. ograničenje pokušaja i provjera listića: status, istek, kod po hash-u. Pogrešan kod povećava `Ballot.failedAttempts`, a 5 promašaja opoziva listić (isto kao token, audit `ballot.revoke.auto`);
  2. **validacija potpunosti:** za **svaki** prijedlog listića koji je u tom trenutku otvoren, a za koji glasač još nije glasao, mora postojati izbor u `choices`. Nedostaje li i jedan, nema upisa, a greška kaže koji (`missing_choices`). Izbor za prijedlog koji nije na listiću ili je zatvoren je greška;
  3. jedna transakcija: za svaki takav prijedlog poziva **isto jezgro kao `submitVote`**, izdvojeno kao `castElectronicVoteTx(tx, token, choice, meta)`, sa svim današnjim provjerama (dupli glas, otvoreno glasanje, otisak teksta). Zatim `Ballot.status = USED` i audit `ballot.submit` sa listom `voteId`-jeva, bez izbora;
  4. vraća potvrdu: sjednica, vrijeme i lista prijedloga sa brojem potvrde po prijedlogu.
- **`submitVote`** ostaje za klasične tokene. Token koji pripada listiću odbija sam (`error: "use_ballot"`), da se ne može glasati mimo listića.

### 3.3 Uprava listićima
- **`reissueBallot(actor, ballotId, reason)`** (PRESIDENT, razlog obavezan): novi listić sa novim linkom i kodom. Stari prelazi u `SUPERSEDED`, a neiskorišteni tokeni se vežu za novi. Poruka ide u red. Audit `ballot.reissue`.
- **`revokeBallot(actor, ballotId, reason)`** (PRESIDENT): opoziv bez novog listića; neiskorišteni tokeni ispod ostaju neupotrebljivi. Audit `ballot.revoke`.
- Pojedinačni „Ponovo izdaj” / „Opozovi” na prijedlogu, za token koji pripada listiću, upućuje na listić (ne radi se po tokenu).
- **Zatvaranje prijedloga** (`closeVoting`) radi kao danas. Listić u kojem su svi prijedlozi zatvoreni prikazuje „Glasanje je završeno”.

### 3.4 Primalac i punomoći
- Primalac listića je ista osoba kojoj bi danas išao link: punomoćnik ako postoji, inače lice koje glasa (`approvalLinkAddress`).
- Ako punomoć važi **samo za neki prijedlog** (`Proxy.scope` po prijedlogu), isti glasač može imati različite primaoce po prijedlogu. Tada nastaju **dva listića**: jedan punomoćniku za taj prijedlog, a jedan vlasniku za ostale. Grupisanje je uvijek po primaocu.

### 3.5 E-mail i dnevni limit
- **Poruka listića** (`template: "ballot-link"`):
  - naslov: „Glasanje: {sjednica} — {N} prijedloga (do {rok})”;
  - tijelo: spisak „{šifra} — {naslov}”, jedan lični link, jedan verifikacioni kod, rok, i rečenica „Na stranici glasate o svim prijedlozima odjednom; potrebno je izabrati odgovor za svaki.”
- **Zajednički limit:**
  - logika dnevnog limita iz `invoiceEmail.ts:246-323` se izdvaja u `notifications/dailyBudget.ts` (`remainingToday()`, `dispatchQueued({ templates, max, budgetMs })`);
  - koriste je fakture, listići i pozivi na sjednicu: pozivi danas idu odmah (`queueMeetingInvitations`) i troše isti dnevni limit;
  - `queueNotification` za ove šablone **samo upisuje u red**, a slanje radi ograničeni dispečer.
- **Na sjednici:**
  - potvrda „Označi glasanje otvorenim” kaže: „Poslaće se {N} e-poruka (po jedna po glasaču). Danas je preostalo {M} od dnevnog limita.” Ako je N > M: „{N−M} poruka ostaje u redu i šalje se sutra ili dugmetom ‘Pošalji neposlate’.”;
  - kartica **„Glasački listići”**: poslato / u redu / neuspješno / iskorišteno, i `secondary` „Pošalji neposlate”.

---

## 4. UI

| Ekran | Šta se mijenja |
|---|---|
| `/glasanje/[token]` (javno) | Prepoznaje token listića i prikazuje listić: zaglavlje sjednice i rok; za svaki prijedlog kartica sa tekstom, prilozima (V-R03) i izborom Za / Protiv / Uzdržan (postojeće velike kartice izbora, `min-h-14`); jedno polje za kod; jedna izjava „Pročitao/la sam sve prijedloge u cijelosti”; brojač „Izabrano 2 od 3”; `secondary` „Pregledaj i potvrdi” pa panel potvrde sa sažetkom svih izbora i jedinim `primary` „Da, pošalji izjašnjenje”. Ako nedostaje izbor, greška imenuje prijedlog, a **izbori i izjava se ne gube** (V-R03). Prijedlog zatvoren u međuvremenu ili već glasan papirnim glasom prikazuje se kao takav, bez izbora. Za klasični token stranica ostaje kakva jeste. |
| Potvrda nakon slanja | Sjednica, vrijeme i tabela „prijedlog — broj potvrde”. Izbor se prikazuje samo na ekranu odmah nakon slanja, ne u URL-u (V-Q3). |
| `/skupstina/[id]` (predsjednik) | Potvrda otvaranja glasanja: broj listića i poruka i stanje dnevnog limita (§3.5). Nova kartica „Glasački listići”: brojevi, „Pošalji neposlate”, tabela po primaocu (status listića, glasano / nije) sa „Ponovo izdaj” / „Opozovi” (`ConfirmAction` `caution`, razlog obavezan). |
| `/skupstina/prijedlog/[id]` | U tabeli glasačke baze, za token sa listića: „Preko listića” i link na karticu listića umjesto radnji po tokenu. |
| Vlasnik u aplikaciji („Vaše učešće”) | „Lični link za ovu sjednicu stigao je jednim e-mailom; glasate o svim prijedlozima odjednom.” Za suvlasnika koji nije predstavnik ostaje tekst iz FR. |

Dizajn sistem: samo postojeći primitivi i pravilo potvrde iz v2.42.0. Brojač „Izabrano N od M” je tekst (13px), ne nova komponenta.

---

## 5. Testovi

- **`openVoting(…, "BALLOT")`:** tokeni i osnova postoje, nijedna poruka nije u redu.
- **`issueMeetingBallots`:**
  - jedan listić i jedna poruka po primaocu;
  - glasač iz obuhvata samo nekih prijedloga dobija listić samo sa njima;
  - punomoć za jedan prijedlog daje dva listića;
  - ponovni poziv ne pravi duplikate.
- **`submitBallot`:**
  - **nedostaje izbor:** ništa nije upisano, greška `missing_choices` imenuje prijedlog;
  - **sve izabrano:** po jedan `Vote` po prijedlogu, sa otiskom svog prijedloga, `deliveryChannel = "BALLOT"`, tokeni `USED`, listić `USED`;
  - **pogrešan kod:** ništa nije upisano; 5 puta znači opozvan listić;
  - **ponovno slanje:** `used`;
  - **prijedlog zatvoren u međuvremenu** nije obavezan;
  - **ranije unesen papirni glas** za jedan prijedlog: taj prijedlog se preskače, ostali se upisuju;
  - **izbor za prijedlog van listića:** greška.
- **`submitVote` sa tokenom koji pripada listiću:** `use_ballot`.
- **`reissueBallot`:** stari link više ne radi, novi radi sa novim kodom, neiskorišteni tokeni prelaze na novi listić.
- **Dnevni limit:** sa limitom 3 i 5 listića, 3 se šalju, a 2 ostaju u redu; „Pošalji neposlate” sljedećeg dana šalje ostatak. Fakture i listići troše isti limit.
- **Rezultat:** glasanje listićem daje isti `computeProposalResult` kao isti glasovi preko pojedinačnih tokena.
- **Regresija:** postojeći testovi `voting`, `live-meeting`, `session-voting-open` i `invoiceEmail` ostaju zeleni. Test v2.43.2 se dopunjuje: sjednica sada pravi listiće umjesto poruka po prijedlogu.

## 6. Redoslijed isporuke

1. **L-a:** model, `openVoting` „BALLOT”, `issueMeetingBallots`, izdvojeno jezgro glasa, `submitBallot`, `reissueBallot` / `revokeBallot`, testovi.
2. **L-b:** zajednički dnevni limit (§3.5) za fakture, listiće i pozive, i „Pošalji neposlate” za listiće; testovi.
3. **L-c:** UI (javni listić, kartica na sjednici, prijedlog, „Vaše učešće”), živi pregled 1440 / 375.
4. **L-d:** `CHANGELOG.md`, verzija, `design-system.md` (ako treba) i ažuriran `Plans/design-review-plan.md` (V-R03 djelimično pokriven).

Implementacija kao FR: Sonnet po planu, Opus pregleda (posebno §3.2 i §3.5).

## 7. Produkcija

- Jedna aditivna migracija, pokreće se ručno prije deploy-a (`MIGRATE_DATABASE_URL=… node scripts/migrate.mjs apply`). Provjera nakon migracije: `_prisma_migrations` sadrži novu migraciju.
- Već otvorena glasanja (pojedinačni tokeni) rade do kraja kao danas. Listići važe samo za sjednice otvorene nakon deploy-a.
- **Povlačenje:** v2.43.2 radi sa novom šemom. Listići izdati u v2.44.0 tada ne rade, ali su glasovi već upisani po prijedlogu. Neiskorišteni listići se moraju ponovo izdati kao pojedinačni tokeni (napomena u `CHANGELOG.md`).

## 8. Rizici

- **Pravno:** jedna izjava i jedan kod za više odluka. Dokaz po prijedlogu ostaje (otisak teksta, poseban `Vote`), a izjava na listiću nabraja sve prijedloge i njihove otiske. Preporuka: tekst izjave da potvrdi pravnik.
- **Obaveza da se glasa o svemu:** ako glasač ne želi da se izjasni o jednom prijedlogu, mora izabrati „Uzdržan”. Ne može predati djelimičan listić (P-L1).
- **Dnevni limit:** listići odlaze sa zakašnjenjem ako je glasača više nego preostalog limita. Potvrda to unaprijed kaže, a rok glasanja treba planirati sa rezervom.
- **Izdvajanje jezgra iz `submitVote`:** test jednakosti rezultata i postojeći testovi glasanja čuvaju ponašanje.

---

## 9. Otvorena pitanja za korisnika

| # | Pitanje | Opcije | Preporuka |
|---|---|---|---|
| **P-L1** | „Svi prijedlozi moraju biti izglasani”: da li je „Uzdržan” dovoljan odgovor? | (a) da, „Uzdržan” je validan izbor; (b) ne, samo Za ili Protiv | **(a)** — inače glasač bez stava ne može predati listić |
| **P-L2** | Prijedlog dodat sjednici **nakon** što su listići poslati? | (a) zabraniti nove prijedloge dok je glasanje sjednice otvoreno; (b) „dopunski listić”: jedan novi e-mail po glasaču samo sa novim prijedlozima; (c) pojedinačne poruke kao danas | **(a)**: listić je zaključan skup prijedloga, što je i pravno jasnije; nova tačka ide na novu sjednicu |
| **P-L3** | Rok glasanja za listić kad prijedlozi imaju različite rokove? | (a) svi prijedlozi listića moraju imati isti rok (preduslov za otvaranje sjednice); (b) listić važi do najkasnijeg roka, a svaki prijedlog se zatvara u svom roku | **(a)**: jedan rok po sjednici, isti u e-mailu i na listiću |
| **P-L4** | Spojiti poziv na sjednicu i listić u jedan e-mail? | (a) ne: poziv ide unaprijed (zakonski rok), listić kad se glasanje otvori; (b) da, kad se oba šalju istog dana | **(a)**: poziv i glasanje su različiti pravni koraci; oba troše po jednu poruku po vlasniku |
| **P-L5** | Režim uživo | (a) bez izmjene u ovoj fazi; (b) i uživo listić za odsutne na početku sjednice | **(a)**: uživo se prijedlozi otvaraju po tački, a listić traži sve odjednom |
| **P-L6** | Dnevni limit kao parametar | (a) `EMAIL_DAILY_SOFT_LIMIT` ostaje varijabla okruženja (180); (b) i podešavanje platforme (admin) | **(a)** sada; **(b)** ako se plan Mailjet-a mijenja |
