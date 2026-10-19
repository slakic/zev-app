# Plan: mapiranje uplata iz SMS-a i PDF izvoda i prepoznavanje iste uplate

**Status: IMPLEMENTIRANO u v2.36.0 (2026-10-19), odluke korisnika ugrađene.** Plan je napravljen čitanjem stvarnog koda (v2.35.1).

## Odluke korisnika (2026-10-19)

1. **P1 (c):** pri spajanju ostaje uplata koja ima alokacije; ako ih imaju obje ili nijedna, ostaje uplata iz izvoda.
2. **P2 da:** ručni unos (`enterPayment`, bez serije) je kandidat za duplikat SMS uplate.
3. **P3:** za odlive samo detekcija i povezivanje („samo poveži" / „nisu iste"); spajanje (storno) samo za prilive.
4. **P4:** SMS je „bez potvrde izvodom" kad je stariji od 3 dana.
5. **P5:** verzija minor, 2.36.0.

## Rezime

1. **Zaštita već postoji, ali samo u trenutku uvoza i ne ostavlja trag.** `markRowsAlreadyBookedFromSms` (`payments.ts:352`) u PDF pregledu odznači red koji je već potvrđen preko SMS-a. Obrnuto, `listBankSmsReview` (`bankSms.ts:327`) upozori kad je izvod već uvezen. U oba slučaja se veza **nigdje ne upisuje**. Kad knjigovođa odznači red, aplikacija zaboravlja da je izvod potvrdio SMS uplatu.
2. **Ne postoji pregled već proknjiženih uplata.** Ako je knjigovođa ipak potvrdio oba (ponovo označio red, ignorisao upozorenje, ili su uplate unesene prije v2.35.0), ista uplata postoji dva puta. Vlasniku se tada priznaje dvostruki iznos. Ništa to naknadno ne otkriva.
3. **Nedostaje i obrnuta kontrola: SMS uplata koju izvod nikad nije potvrdio.** SMS nema dokaz autentičnosti (SMS plan, Rezime §2). Zato je izvod jedina stvarna kontrola. Uplata iz SMS-a za koju nijedan izvod ne sadrži odgovarajući red je ili lažna, ili izvod još nije uvezen. Danas se ne može vidjeti koje su to.
4. **Prijedlog: nova tabela veza `BankRecordMatch` + ekran „Usklađivanje SMS ↔ izvod"** (`/fakture/uplate/uskladjivanje`). Ekran prikazuje (a) vjerovatne duplikate koje treba spojiti, (b) SMS uplate bez potvrde izvodom. Veza se upisuje automatski pri PDF uvozu i ručno na ekranu.
5. **Spajanje ne briše ništa.** Duplikat se stornira postojećim `reversePayment` (append-only, sa razlogom). Ako je samo duplikat bio uparen sa fakturom, alokacija se prenosi na preživjelu uplatu: storno alokacije + nova alokacija. Isto kao ručni postupak koji knjigovođa danas može uraditi kroz tri ekrana.

## Zatečeno stanje

- `Payment` nema polje za izvor. Izvor se vidi samo preko `importBatch.sourceType` (`"PDF"` | `"SMS"` | `"CSV"`). `null` znači ručni unos (`enterPayment`).
- SMS uplata je povezana preko `IncomingBankSms.paymentId` (unique), a SMS odliv preko `IncomingBankSms.transactionId`.
- `Payment` **ne čuva račun druge strane**. PDF ga ima u pregledu (`partnerAccounts`), ali ga ne upisuje. Za već proknjižene uplate poređenje zato ide po: istom računu ZEV-a, istom iznosu, datumu (SMS `receivedAt` u odnosu na datum izvoda, −2…+3 dana, isti prozor kao danas) i sličnom imenu (`foldDiacritics`, `namesSimilar` iz `bankSms.ts:321`).
- `PaymentAllocation` je append-only (trigger). `Payment` i `IncomingBankSms` nisu, ali se po konvenciji ne prepravljaju u mjestu.
- `reversePayment` (`payments.ts:835`) stornira sve alokacije, otkazuje `FinTransaction` i piše audit.

## Rješenje

### R1. Model

```prisma
/// Veza između zapisa iste bankovne transakcije pristiglih različitim kanalima
/// (SMS obavještenje i PDF izvod). Append-only odluka; nova odluka za isti par se piše kao nov red.
model BankRecordMatch {
  id                     String   @id @default(cuid())
  zev                    Zev      @relation(fields: [zevId], references: [id])
  zevId                  String
  sms                    IncomingBankSms @relation(fields: [smsId], references: [id])
  smsId                  String
  statementBatchId       String?  // PDF serija u kojoj je red nađen
  statementPaymentId     String?  // proknjižen red izvoda (IN) — null ako je red odznačen pri uvozu
  statementTransactionId String?  // proknjižen red izvoda (OUT)
  decision               String   // SAME | NOT_SAME
  origin                 String   // IMPORT_SKIP (red odznačen pri uvozu) | MANUAL_LINK | MERGE
  survivorPaymentId      String?  // MERGE: uplata koja ostaje
  reversedPaymentId      String?  // MERGE: uplata stornirana kao duplikat
  createdById            String?
  createdAt              DateTime @default(now())

  @@index([zevId, smsId])
  @@index([statementPaymentId])
}
```

- Za ručnu uplatu (P2) `statementPaymentId` drži njen id, a `statementBatchId` je null.
- `NOT_SAME` pamti da je knjigovođa rekao „nisu iste", da se par ne predlaže ponovo (npr. dvije stvarne uplate istog iznosa istog dana).
- „SMS potvrđen izvodom" = postoji red `SAME` za taj `smsId`.

### R2. Automatski upis pri PDF uvozu

- `PdfPreviewRow.duplicateOf` već nosi `smsId`. `commitPdfImport` za svaki red koji je **ostao odznačen** a ima `duplicateOf` upisuje `BankRecordMatch { decision: SAME, origin: IMPORT_SKIP, statementBatchId }`. Zato klijent mora slati i odznačene redove sa `duplicateOf` (danas šalje samo označene), ili poseban niz `confirmedSmsIds`. Prijedlog: poseban niz, jer ne mijenja `StatementRowInput`.
- Server ponovo provjerava da je SMS `CONFIRMED`, istog ZEV-a i računa (klijentu se ne vjeruje).

### R3. Detekcija (servis `findChannelDuplicates(actor)`)

Nova datoteka `src/server/services/paymentMatching.ts`, `requireRole(actor, "PRESIDENT", "ACCOUNTANT")`.

1. **Vjerovatni duplikati:** parovi (SMS uplata, uplata iz PDF-a ili ručna), oba nestornirana, isti `accountId`, isti iznos, datum u prozoru, bez `BankRecordMatch` za taj par. Pouzdanost:
   - **Visoka:** ime se poklapa (`namesSimilar`) i datum ±1 dan.
   - **Moguća:** samo iznos i datum.
   Uparivanje jedan-na-jedan, pohlepno po pouzdanosti (isti princip kao `markRowsAlreadyBookedFromSms`).
2. **SMS bez potvrde izvodom:** `CONFIRMED` SMS stariji od 3 dana (odluka P4) bez `SAME` veze i bez para iz tačke 1.
3. Isto za odlive (`FinTransaction` EXPENSE): SMS odliv ↔ nestorniran izlaz plaćen preko banke, koji nije sam nastao iz SMS-a (odluka P3: samo detekcija i povezivanje, bez spajanja).

### R4. Akcije (ACCOUNTANT)

- **„Ista uplata — spoji"** (`mergeChannelDuplicate(actor, { smsId, otherPaymentId })`, samo prilivi, jedna transakcija):
  1. Preživjela uplata (odluka P1 (c)): ona koja ima neto alokacije; ako ih imaju obje ili nijedna, ostaje uplata iz izvoda (odnosno ručna). Ako obje imaju alokacije, alokacije duplikata se prenose na preživjelu (korak 2).
  2. Ako duplikat ima neto alokacije, a preživjela ima dovoljno neraspoređenog iznosa i nema konfliktnih alokacija: za svaku fakturu storno alokacije duplikata + nova alokacija preživjele (razlog „Prenos sa duplikata …"). Inače greška sa jasnom porukom (rijetko; rješava se ručno).
  3. `reversePayment` nad duplikatom, razlog „Duplikat uplate iz SMS-a/izvoda (usklađivanje)". Logika se izdvaja u `reversePaymentInTx` da sve bude u jednoj transakciji.
  4. `BankRecordMatch { SAME, origin: MERGE, survivorPaymentId, reversedPaymentId }`, audit `payment.channel_merge`.
- **„Ista isplata"** (samo odlivi, odluka P3, `linkChannelTransaction`): upis `SAME, MANUAL_LINK` sa `statementTransactionId`. Ništa se ne stornira. Dok su oba izlaza aktivna, par ostaje na listi sa oznakom da je dupli izlaz i dalje u knjigama (UI za storno izlaza danas ne postoji, pa se ispravlja ručno).
- **„Nisu iste"** (`markChannelNotSame`): upis `NOT_SAME`, par nestaje sa liste.
- **„Potvrđeno izvodom"** (`confirmSmsByStatement`) na listi SMS stavki bez potvrde: `SAME, MANUAL_LINK` bez drugog zapisa — računovođa je stavku vidio na izvodu (npr. red je preskočen pri uvozu prije v2.36.0). Ide iza `ConfirmAction`.
- Varijanta „Ista uplata — samo poveži" iz prvog nacrta je izbačena: par sa jednom već storniranom uplatom se ni ne prikazuje kao duplikat, pa nije imala slučaj upotrebe.

### R5. UI

- Nova stranica `/fakture/uplate/uskladjivanje`, link iz `/fakture/uplate` i `/fakture/uplate/sms`. Postojeći primitivi (`PageHeader`, `Card`, `Table`/`Td`, `StatusBadge`, `ConfirmAction` za spajanje). Bez novog `danger` dugmeta. Pošto je dozvoljeno najviše jedno `primary` po regiji, „Spoji" u redu tabele je `secondary` iza `ConfirmAction`.
- Dvije kartice: „Vjerovatni duplikati" (SMS stavka | izvod/ručna stavka | pouzdanost | akcije) i „SMS uplate bez potvrde izvodom".
- Na detalju uplate (`/fakture/uplate/[id]`) bedž „Potvrđeno izvodom" / „Čeka izvod" za SMS uplate i link na drugi zapis.
- Brojač na `/fakture/uplate/sms` („N mogućih duplikata").

### R6. Testovi (Vitest, servisni sloj)

- PDF uvoz sa odznačenim SMS redom upisuje `SAME/IMPORT_SKIP`; klijent ne može podmetnuti tuđi `smsId`.
- Detekcija: visoka/moguća pouzdanost, `NOT_SAME` isključuje par, stornirane uplate se ignorišu, tenant izolacija.
- Spajanje: preživjela zadržava alokaciju; prenos alokacije sa duplikata; faktura ostaje sa ispravnim statusom; saldo vlasnika nije dupliran; ponovno spajanje istog para baca grešku; samo ACCOUNTANT.

## Pitanja za korisnika

- **P1. Koja uplata ostaje pri spajanju?** (a) Uvijek ona iz izvoda (zvanični bankovni dokument, puno ime, poziv na broj). (b) Uvijek SMS (obično ranija i već uparena sa fakturom). (c) Ona koja ima alokacije, a ako obje ili nijedna — izvod. **Preporuka: (c).**
- **P2. Ručni unos (`enterPayment`) kao kandidat za duplikat SMS-a?** Preporuka: da.
- **P3. Odlivi (SMS „Odliv" ↔ isplata iz izvoda)?** Spajanje odliva vezanog za Trošak mijenja `paidAmount` troška. Preporuka: u ovoj verziji samo detekcija i povezivanje za odlive, spajanje samo za prilive.
- **P4. Prag „SMS bez potvrde izvodom"**: 3 dana od prijema? (izvod se uvozi dnevno).
- **P5. Verzija:** minor (2.36.0)?
