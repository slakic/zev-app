# Plan: automatski prijem SMS obavještenja Nova Banke („Priliv") i uparivanje uplata

**Status: PLAN, odluke korisnika potvrđene (2026-10-04), implementacija Faze 1 u toku.** Plan je napravljen čitanjem stvarnog koda.

## Odluke korisnika (2026-10-04)

Odgovori na „Pitanja za korisnika" i njihov uticaj na plan (tijelo plana je usklađeno sa njima):

1. **Adresa aplikacije je javna, ali mora biti konfigurabilna.** URL webhook-a se uvijek gradi iz `getEnv().APP_URL` (env promjenljiva `APP_URL`, već obavezna u produkciji). Ništa se ne hardkodira. Korisnik navodi `https://zev-app.vercel.com/` — Vercel domene su obično `*.vercel.app`, pa treba provjeriti vrijednost `APP_URL` u Vercel podešavanjima; kartica u Podešavanjima prikazuje tačno ono što je tamo postavljeno.
2. **Čovjek u petlji je obavezan** („man in the loop" provjerava i nadgleda knjiženje). Opcija (b), red za potvrdu. **Faza 3 (uslovna automatska potvrda) se ne planira** i izbačena je iz plana; vraća se samo na izričit zahtjev korisnika.
3. **Ključem upravljaju oba: PRESIDENT i ACCOUNTANT.**
4. **SMS prima predsjednik ILI računovođa** (jedan telefon). Dedup za dva telefona ostaje (besplatan), ali uputstvo je napisano za jedan telefon.
5. **Dnevni PDF izvodi (Nova Banka) se i dalje uvoze.** Zaštita od duplog knjiženja SMS ↔ PDF je zato obavezna u Fazi 1. CSV se ne koristi, pa se CSV zaštita ne radi.
6. **Banka šalje i „Odliv" poruke i one se knjiže kao odlivi** (isplata → Trošak ili opšti izlaz). **Odliv prelazi iz Faze 2 u Fazu 1.** Lanac stanja (`Raspolozivo`) ostaje Faza 2.
7. **Dostavljeni primjeri poruka** (vidi O2) postaju testni slučajevi parsera. Otkrili su dvije stvari koje je prvobitni regex promašio: Odliv za bankovnu naknadu **nema** račun/ime druge strane, a imena su skraćena i mogu sadržati zagrade.
8. **iPhone:** „Run Immediately" je podržan; **filter po pošiljaocu nije moguć** (banka nema broj pošiljaoca koji se može izabrati). Filter je isključivo „Message Contains: `NOVA BANKA-`".
9. **Verzija Faze 1: minor (2.35.0).**

## Rezime

1. **SMS je samo novi način dostave podataka. Knjiženje ostaje kakvo jeste.** Isti obrazac je postavio `Plans/gmail-bank-statement-ingestion-plan.md` §4.1: novi izvor puni čekaonicu, a uplatu (`Payment`) i dalje pravi čovjek kroz postojeći put potvrde. Komentari u kodu to izričito traže (`payments.ts:198-204`, `bankStatementPdf.ts:12-15`: *"Never wire this straight into a 'commit' path."*). Webhook zato **nikad ne pravi `Payment`, `FinTransaction` ni `PaymentAllocation`.** Pravi samo red u novoj tabeli čekaonice. Uparivanje sa fakturom se **predlaže automatski**, a potvrda je jedan klik („Potvrdi označene").
2. **Najvažniji nalaz o sigurnosti: SMS nema nikakav dokaz autentičnosti.** Jedino što razlikuje pravi „Priliv" od lažnog je tajni ključ u iPhone automatizaciji. Kombinacija „automatski proknjiži kad je poklapanje sigurno" (opcija c) ne štiti od procurelog ključa. Bilo koji komšija zna ime vlasnika i broj stana, pa lažna poruka može imati *savršen* skor poklapanja. Skor mjeri kvalitet uparivanja, a ne da li je poruka prava. Zato je preporuka (b), red za potvrdu, uz što brži UX. Uslovna automatska potvrda nije u planu (odluka korisnika #2).
3. **Pretpostavka iz zadatka nije tačna: `src/app/api/` nije prazan.** Postoji 8 route handler-a (`health`, `izvjestaji/{csv,pdf,dugovanja}`, `dokumenti/{[id],kartica,saglasnost}`, `prilozi/[id]`). **Svi su `GET`.** Svi osim `health` se oslanjaju na `getAuthContext()` (cookie sesije), a `health` ne čita i ne piše ništa osjetljivo. Novi webhook je zato **prvi `POST` route handler, i prva tačka u aplikaciji gdje pozivalac bez sesije upisuje podatke.** To je stvarno nov obrazac. Postojeći guard-ovi (`guards.ts`, `requireActor`) ovdje ne rade, pa endpoint mora imati sopstvenu autentifikaciju, ograničenje broja zahtjeva i audit.
4. **Engine za uparivanje se može ponovo koristiti, ali uz jednu izmjenu koju je ovaj SMS otkrio.** `scoreInvoiceMatch` iz teksta svrhe *„UPL. ZA 08/26 STAN BR 11"* ispravno izvlači `11` kao „keyword" kandidata (+70). Ali `nameMatchesText` (`payments.ts:512-515`) samo pretvara u mala slova i **ne uklanja dijakritike**. Banka šalje `ZELJKO GALIC`, a u evidenciji piše `Željko Galić`, pa poređenje **ne uspijeva** (`"željko"` nije podniz od `"zeljko galic"`). U `src/` ne postoji funkcija za uklanjanje dijakritika (grep potvrđen). Ista praznina već tiho šteti i PDF uvozu. Ispravka je mala i ide u Fazu 1.
5. **Duplo knjiženje između SMS-a i PDF izvoda je najveći praktični rizik, veći od lažnih poruka.** Ako knjigovođa i dalje uvozi dnevni PDF izvod, ista uplata stiže dva puta. Zato je u Fazi 1 obavezno da PDF pregled prepozna redove koji su već potvrđeni preko SMS-a i da ih podrazumijevano ne označi za uvoz.
6. **Bez šifrovanja i bez nove tajne u env-u.** Ključ webhook-a je jednosmjeran heš (isti obrazac kao `ApprovalToken.tokenHash`, `schema.prisma:730`). Zato je `Setting` legitimno mjesto za njega. Gmail plan je `Setting` s pravom odbio za *refresh token* (§1.5), ali taj token mora da se dešifruje, a ovaj ne mora.

## Zatečeno stanje

**Parser za Nova Banku (`src/server/services/bankStatementPdf.ts`)**
- Stil: male privatne funkcije `parseXLine(line): {...} | null` (linije 54, 72). Javna funkcija `parseNovaBankaStatement(text)` (119) vraća tipiziran rezultat. `normalizeSpaces`, iznosi se prave kroz `dec()` iz `@/lib/money`. Iznad svake funkcije je komentar o *konkretnom primjeru* iz stvarnog izvoda.
- **Format brojeva se razlikuje između kanala iste banke.** PDF koristi decimalnu tačku i zarez za hiljade (`MONEY_TOKEN = /\d{1,3}(?:,\d{3})*\.\d{2}/g`, linija 47). SMS koristi **decimalni zarez i tačku za hiljade** (`47,87`, `11.175,20`). To je pravilo `parseCsvAmount(value, decimalComma=true)` (`payments.ts:112-118`), a ne PDF pravilo. SMS parser mora pratiti CSV pravilo.
- Broj računa: PDF zaglavlje štampa `555-10000515469-32` (komentar, linija 113). SMS piše `5551000051546932`. **Poslije uklanjanja svega osim cifara to je isti račun.** To potvrđuje da je poređenje po ciframa (`payments.ts:317-319`) ispravan ključ.
- `extractUnitNumberCandidates` (93-104): „keyword" regex prepoznaje `BR 11`. Za `08/26`: lookahead isključuje samo `/YYYY` (4 cifre), pa su `08` i `26` „bare" kandidati. Stan „26" bi zato dobio +15 („moguće, provjeriti"), a stan „8" ništa (zbog vodeće nule). To je mali i prihvatljiv šum, ali vrijedi ga zabilježiti (vidi Rizike).

**Uvoz i uparivanje (`src/server/services/payments.ts`)**
- `importBankCsv` (120-196) knjiži **direktno**, bez pregleda. `importPdfPreview` (240-332) ne piše ništa. `commitPdfImport` (338-501) piše tačno ono što je čovjek potvrdio. Upisuje `BankImportBatch` sa `sourceType: "PDF"` i `mapping: { source: "pdf-nova-banka" }` (381-382), automatsku alokaciju sa `reason: "Automatski uparen pri uvozu PDF izvoda"` i audit `payment.allocate` (`source: "pdf_import"`) i `payment.import_pdf`. Svi upisi nose `createdById: actor.userId`.
- Prag predloga: `best.score >= 70` (288).
- `fetchOpenInvoiceCandidates` (525) i `scoreInvoiceMatch` (541) su privatne funkcije. Bodovi: poziv na broj +100, isti platilac +50, naziv platioca +40, broj stana kao keyword +70 / bare +15, ime u svrsi +35, tačan iznos +30.
- `suggestMatches` (597) radi nad postojećim `Payment`-om i dozvoljava `ACCOUNTANT` i `PRESIDENT`.

**Šema (`prisma/schema.prisma`)**
- `MoneyAccount` (813): `iban String?` je slobodan tekst („account number"), `type`, `active`.
- `BankImportBatch` (1056): `sourceType String @default("CSV") // CSV | PDF`, `rawText String?`, `importedById String?`. Vrijednost `"SMS"` staje bez migracije.
- `Payment` (1069): `payerNameRaw`, `reference`, `purposeRaw`, `importBatchId`, `createdById String?`. **Nema polja za račun platioca.**
- `Setting` (1611): `@@id([zevId, key])`, `value Json`.
- `ApprovalToken` (726): `tokenHash @unique` sa sha256 i `failedAttempts`. To je obrazac za „heš, nikad čist tekst".

**Podešavanja (`src/server/services/settings.ts`)**
- Komentar u zaglavlju kaže da je ovo *jedino* mjesto koje direktno dira `prisma.setting`.
- `setSetting` dozvoljava samo `isSettingKey(key)` (8 poznatih ključeva, `settings-defaults.ts:40`). `getSettings` vraća samo poznate ključeve. **Posljedica koja nam odgovara:** ključ `bankSms.webhook`, koji namjerno *nije* `SettingKey`, ne može se prepisati kroz formu „Parametri" i nikad se ne prikazuje na tom ekranu.

**Javni (token) tokovi**
- `glasanje/[token]/page.tsx` i `meetings.ts:1162-1237`: ograničenje broja pokušaja po heširanom IP-u (ili po hešu tokena kao rezervi), audit svakog neuspjeha (`approval_token.lookup.unknown/revoked/expired`) sa `audit(null, …)` i `ipHash`, tenant izveden **iz validiranog reda**, nikad iz ulaza.
- `audit.ts:17-24`: `input.zevId` se smije proslijediti samo kad je ZEV nezavisno potvrđen.
- Rate limiteri u memoriji: `users.ts:9-30` (prijava, 10 pokušaja/15 min) i `users.ts:114-134` (reset, 5/15 min). Isti oblik je u `meetings.ts` (`rateLimitVerify`).
- IP: `clientIp()` (`session.ts:242-244`, `x-forwarded-for`). Plan za sesije već bilježi da se na hostingu bez Vercel-a ovo može lažirati.

**Audit katalog (`src/lib/activity/catalog.ts`)**
- `payment.import_csv`, `payment.import_pdf` i `payment.allocate` su `FINANCE` (102-106). `approval_token.*`, `auth.login.*` i `password_reset.*` su `SYSTEM`.
- `tests/activity-catalog.test.ts` statički skenira svaki `action: "..."` literal. Novi kodovi se moraju dodati u istoj izmjeni, uz oznake u i18n (`auditAction.*`, `labelForAction`, linija 191).

**Okruženje**
- `getEnv().APP_URL` (`src/lib/env.ts`) je obavezan u produkciji. Iz njega se gradi URL webhook-a koji se prikazuje korisniku.
- Vercel je konkretan cilj (`deployment-portability-plan.md`, P1). U `docker-compose.yml` stoji `APP_URL: http://localhost:3000`. **iPhone može dosegnuti samo javno dostupnu instancu.** To je preduslov, vidi Pitanja.
- Middleware ne postoji, pa ništa ne blokira novu `/api` rutu.
- Trenutna verzija je `2.34.1`. Korisničko uputstvo je `public/korisnicko-uputstvo.html` i ažurira se uz svaku izmjenu vidljivu korisniku.

## Odluke

### O1. Endpoint i autentifikacija

**Ruta:** `POST /api/uplate/sms` (`src/app/api/uplate/sms/route.ts`). Imenovanje prati postojeće srpske rute (`/api/izvjestaji`, `/api/dokumenti`, `/api/prilozi`). `route.ts` je tanak: pročita zaglavlje, tijelo i IP, pa pozove servisnu funkciju `receiveBankSms({ authorization, body, contentType, ipHash })` u novom `src/server/services/bankSms.ts`. Testovi zovu tu funkciju direktno, kao što se radi sa servisima.

**Gdje je ključ:**
- (a) **u URL-u** (`/api/uplate/sms/<ključ>`). Najjednostavnije za podešavanje u Shortcuts-u (jedno polje). Mana: putanje se upisuju u logove pristupa (Vercel, reverse proxy), pa ključ curi u logove.
- (b) **u zaglavlju** `Authorization: Bearer <ključ>`. Shortcuts „Get Contents of URL" podržava zaglavlja (Headers). Ključ se ne pojavljuje u logovima.
- (c) **u JSON tijelu.** Radi, ali miješa autentifikaciju sa podacima i nije uobičajeno.

**Preporuka: (b).** Cijena je jedno dodatno polje u uputstvu.

**Oblik ključa:** `<zevId>.<tajna>`, gdje je `tajna = generateToken(32)` (`tokens.ts:4`, 256 bita, base64url).
- `zevId` (cuid) nije tajna. Prisutan je da bi provjera bila jedan upit po primarnom ključu: `Setting(zevId, "bankSms.webhook")`.
- Alternativa bi bila pretraga JSON vrijednosti preko svih tenanata (`value.path = tokenHash`), bez indeksa i nezgrapna u Prismi.
- Druga alternativa je nova tabela tokena. Ona ništa ne dodaje, jer v1 ima jedan ključ po ZEV-u.

**Čuvanje u `Setting`:** ključ `bankSms.webhook`, a `value` je:
```
{ tokenHash: sha256(tajna), issuedAt, issuedById, revokedAt: null }
```
Čist tekst tajne se **nikad** ne čuva i **nikad** ne ulazi u audit (`audit.ts:38`). Prikazuje se **jednom**, odmah po generisanju. Ako se izgubi, generiše se novi.
- `bankSms.webhook` namjerno nije `SettingKey`, pa ga `setSetting` i `getSettings` ne vide (vidi Zatečeno stanje).
- Funkcije koje ga čitaju i pišu idu u `bankSms.ts`: `issueBankSmsToken(actor)`, `revokeBankSmsToken(actor)`, `getBankSmsStatus(actor)` i interni `loadWebhookConfig(zevId)`.
- Komentar u zaglavlju `settings.ts` se dopunjava ovim imenovanim izuzetkom, da sljedeći čitalac ne protumači direktan pristup kao grešku.
- Generisanje novog ključa prepisuje heš, pa stari ključ trenutno prestaje da važi (isti obrazac kao reset lozinke, `users.ts:107-112`).

**Validacija, redom:**
1. Rate limit po `ipHash` za neuspjele pokušaje (vidi niže).
2. Zaglavlje mora imati oblik `Bearer <cuid>.<base64url>`.
3. `Zev` postoji i `active`.
4. `Setting` postoji i nije opozvan.
5. `hashesEqual(sha256(tajna), tokenHash)`, poređenje otporno na mjerenje vremena (`tokens.ts:21`).

Svaki neuspjeh vraća **isti** `401 {"error":"unauthorized"}`, da se ne otkrije koji je dio pogrešan. **Tek nakon uspjele provjere** `zevId` postaje pouzdan i smije ići u `audit({ zevId })`.

**Tijelo zahtjeva:** `Content-Type: application/json`, `{ "text": "<cijeli SMS>" }`, uz opciono `"test": true` (vidi O6). `text/plain` (sirovo tijelo) se prihvata kao rezerva, jer neke verzije Shortcuts-a lakše šalju „File". Ograničenje veličine: tijelo do 4 KB (`413`), `text` do 1000 znakova.

**Odgovori:**
- `200 {"status":"queued"|"duplicate"|"ignored"|"rejected"|"test_ok"}`;
- `400` za neispravan JSON;
- `401`;
- `413`;
- `429`.

Neparsiran SMS **nije** greška protokola, nego `200 rejected`. Shortcut nema šta da ponovi, a podatak je sačuvan.

**Ograničenje broja zahtjeva (u memoriji, kopija obrasca iz `users.ts`, bez nove infrastrukture):**
- **Neuspjela autentifikacija:** po `ipHash`, 10 pokušaja/15 min, pa `429` + audit `bank_sms.rate_limited`.
- **Uspješni zahtjevi:** po `zevId`, 60/sat. Realan vrh je početak mjeseca, kad nekoliko desetina vlasnika plati istog dana. Preko toga ide `429` + audit. Ovo ograničava štetu od procurelog ključa (spam čekaonice).
- **Nema automatskog opoziva** poslije N pogrešnih ključeva (za razliku od glasanja, gdje 5 pogrešnih kodova opoziva token). Razlog: napadač koji zna samo `zevId` mogao bi tako namjerno isključiti integraciju legitimnom korisniku. Pogrešni pokušaji se samo auditiraju.
- Iskrena granica: na Vercel-u svaka instanca funkcije ima svoju memoriju, pa je limiter „najbolji pokušaj". Stvarnu štetu ograničava **dizajn** (ništa se ne knjiži bez čovjeka, O3), ne limiter.

### O2. Opseg parsera u v1

Novi `src/server/services/bankSmsParser.ts`, u stilu `bankStatementPdf.ts`: zaglavlje sa stvarnim primjerom, male čiste funkcije, `dec()`, bez pristupa bazi.

```ts
parseNovaBankaSms(text): ParsedBankSms
// kind: "PRILIV" | "ODLIV" | "UNKNOWN"
// ownAccount, amount, purposeRaw, payerAccount, payerName, balanceAfter, error
```

Pravila:
- Prvo `normalizeSpaces` (iOS može ubaciti prelome reda).
- Oblik se prepoznaje **jednim sidrenim regexom za cijelu poruku**, ne traženjem dijelova. Isti oblik važi za Priliv („na") i Odliv („sa"), a **druga strana (račun + ime) je opciona**, jer stvarni primjeri pokazuju da bankovna naknada nema drugu stranu:
  ```
  ^NOVA BANKA-(Priliv na|Odliv sa) (\d{10,20}) Iznos ([\d.]+,\d{2}) KM, svrha (.*?)(?:, (\d{10,20}) (.+?))?\.\s*Raspolozivo (-?[\d.]+,\d{2}) KM\.?$
  ```
  - `svrha (.*?)` je lijen, a grupa druge strane opciona: parser staje na **prvom** mjestu gdje slijedi `, <10-20 cifara> <ime>.Raspolozivo` ili direktno `.Raspolozivo`. Zarez *unutar* svrhe („Racun za juli, stan 47") ne lomi parsiranje, jer iza njega nisu 10-20 cifara.
  - Ime se završava na prvom `.Raspolozivo`, pa ime sa tačkom („A.D.", „ELEKTRO D.O.O.") i zagradama („JOVICA (RATKO) DZAJIC") prolazi.
  - **Stvarni primjeri korisnika (2026-10-04) postaju testni slučajevi**, uključujući: Priliv sa skraćenim imenom („SIMIC DUSAN I LENA B L"), Priliv bez broja stana u svrsi („UPLATA RACUNA ZA 08/2026"), Priliv „ST.56 OBAVEZE ZA 8/2026", Odliv bankovne naknade **bez druge strane** („Naknada za PAKET START SME za SEPTEMBAR-2026"), Odliv porezu („POREZ PRED UO IX/26", „MINISTARSTVO FINANSIJA REPUBL"), Odliv računu za komunalije („RN 7517352", „MH ERS MP A.D. TREBINJE- JAVNO SNABDJE"), Odliv „RN VIII/26" liftu.
  - Poruka koja u tekstu sadrži **više od jednog** `NOVA BANKA-` (npr. nekoliko poruka zalijepljenih zajedno) se odbija kao `UNKNOWN` sa jasnom greškom. Shortcut šalje jednu po jednu poruku, a spojene bi se pogrešno pročitale.
- Iznosi se čitaju po pravilu decimalnog zareza (ukloni `.`, zamijeni `,` sa `.`, pa `dec()`), lokalnom funkcijom `parseKmAmount`. Valuta mora biti `KM`. `EUR` ili bilo šta drugo je `UNKNOWN` (odbijeno).
- `amount > 0`, inače odbijeno.

**Odluka o strogosti: da, parser odbija sve što nije tačno oblik „Priliv na" ili „Odliv sa" (regex iznad).**
- `NOVA BANKA-Odliv sa…` se parsira istim regexom kao Priliv i dobija `kind: "ODLIV"`, status `PENDING`, **ali se nikad ne knjiži kao uplata vlasnika**: potvrda pravi izlaznu transakciju (`FinTransaction` tipa `EXPENSE`), po potrebi vezanu za otvoreni Trošak, tačno kao „isplata" red u PDF uvozu (odluka korisnika #6). Lanac stanja ostaje Faza 2.
- Bilo šta drugo što počinje sa `NOVA BANKA` (marketing, obavještenja, Priliv/Odliv u izmijenjenom formatu) je `UNKNOWN`, status `REJECTED`, sa `parseError`.
- Poruka koja **ne počinje** sa `NOVA BANKA` je `REJECTED`, ali **bez čuvanja teksta**. Čuvaju se samo heš, dužina i vrijeme. Ako korisnik pogrešno podesi filter u Shortcut-u, njegove lične poruke ne smiju završiti u bazi ZEV-a.

**Šta se dešava sa odbijenim porukama: vide se, ne nestaju tiho.** Na ekranu SMS uplata postoji kartica „Neprepoznate poruke (N)", gdje se vidi sirovi tekst i razlog. Knjigovođa može uplatu unijeti ručno ili poruku zatvoriti. Za poruke van banke prikazuje se upozorenje: „Primljena je poruka koja nije od Nova Banke. Provjerite filter u automatizaciji na telefonu." Ako se format banke jednog dana promijeni, prva neprepoznata poruka to odmah pokaže. To je isti argument kao `lastError` u Gmail planu (§2.5): tiha tišina je najgori ishod.

### O3. Pregled prije potvrde ili automatsko knjiženje

- **(a) Automatski `Payment` + alokacija odmah.** Najbrže. Ali procureo ključ (screenshot Shortcut-a, dijeljen telefon, backup) omogućava upis lažnih uplata koje izgledaju potpuno stvarno. Faktura prelazi u `PAID`, vlasnikov dug „nestaje", a ispravka je stornom (append-only, `reversePayment`) i ostaje bučna zauvijek. Uz to, `Payment.createdById`, `FinTransaction.createdById` i `PaymentAllocation.createdById` bi prvi put nastajali bez ijednog čovjeka.
- **(b) Čekaonica + potvrda od knjigovođe.** Ponavlja ugovor PDF uvoza. Cijena je jedan klik po seriji.
- **(c) Automatska potvrda samo uz vrlo visoko povjerenje.** Ne štiti od glavne prijetnje (vidi Rezime, tačka 2): lažna poruka sa tačnim imenom, brojem stana i iznosom ima najviši skor od svih.

**Preporuka: (b), uz UX koji ukida što više ručnog rada.**
- Uplata se pojavi u aplikaciji nekoliko sekundi nakon SMS-a, već uparena (prijedlog fakture ako je skor ≥ 70, isti prag kao `payments.ts:288`) i već **označena** za potvrdu kad nema upozorenja.
- Knjigovođa otvori ekran i jednom klikne „Potvrdi označene (12)". To je razlika od tri minute nedjeljno, a sigurnost se suštinski mijenja.
- Brojač „SMS uplate na čekanju: N" je vidljiv na `/fakture/uplate`.

**Kako potvrda knjiži (ponovno korišćenje, a ne kopiranje):**
- Iz `commitPdfImport` se izdvaja privatni helper `commitStatementRows(tx, actor, zevId, { accountId, sourceType, mapping, filename, rawText, rows, auditAction, allocationReason, auditSource })`. On vraća `paymentId` po redu.
- `commitPdfImport` ga zove sa sadašnjim vrijednostima, pa se ponašanje ne mijenja. To čuvaju postojeći `tests/payments.test.ts` (linije ~237-343) i `tests/tenant-isolation.test.ts:327`.
- `confirmBankSms(actor, { items: [{ smsId, accountId, date, amount, invoiceId|null }] })`:
  - `requireRole(actor, "ACCOUNTANT")` + `requireZev`, kao `commitPdfImport`;
  - u **jednoj** transakciji prvo radi `updateMany({ where: { id: in ids, zevId, status: "PENDING" }, data: { status: "CONFIRMING" } })` i provjerava da je broj ažuriranih redova tačan. To štiti od duple potvrde iz dva taba;
  - zatim zove helper sa `sourceType: "SMS"`, `mapping: { source: "sms-nova-banka" }`, `filename: "SMS obavještenja (N) — <datum>"`, `rawText` = spojeni sirovi tekstovi i `auditAction: "payment.import_sms"`;
  - na kraju upisuje `paymentId` i `importBatchId` u SMS redove (`CONFIRMED`).
  - Grupisanje po računu: jedan `BankImportBatch` po `accountId` u jednoj potvrdi.
- `reference` se ostavlja prazan, jer SMS nema bankovnu referencu. Račun platioca ostaje u SMS redu (vidi O4) i ne trpa se u `Payment.reference`, gdje bi zbunjivao bodovanje „poziv na broj".
- Datum uplate je kalendarski dan prijema u `Europe/Sarajevo` (konstanta `TIME_ZONE`, `src/lib/i18n/index.ts:53`), upisan kao `Date.UTC(y, m, d)`, isto kao `parseStatementDate`. Bez toga bi uplata u 00:30 pala na prethodni dan, a to je klasa greške koju su v2.33.1 i v2.33.2 upravo ispravljale. Datum se može promijeniti u pregledu.
- „Odbaci" (`dismissBankSms(actor, smsId, reason)`, razlog obavezan) postavlja `DISMISSED`. Ništa se ne knjiži.

**Novi model** (migracija je neizbježna; bez nove tabele bi čekaonica morala živjeti u `BankImportBatch.mapping` JSON-u, bez jedinstvenog ključa za dedup i bez upita po statusu):

```prisma
model IncomingBankSms {
  id            String   @id @default(cuid())
  zev           Zev      @relation(fields: [zevId], references: [id])
  zevId         String
  receivedAt    DateTime @default(now())
  rawText       String?  // null za poruke koje ne počinju sa "NOVA BANKA" (privatnost, O2)
  rawHash       String   // sha256(normalizovani tekst)
  kind          String   // PRILIV | ODLIV | UNKNOWN
  status        String   // PENDING | CONFIRMING | CONFIRMED | DISMISSED | REJECTED
  parseError    String?
  ownAccount    String?  // cifre iz "Priliv na ..."
  account       MoneyAccount? @relation(fields: [accountId], references: [id])
  accountId     String?  // null = nepoznat račun (O5)
  amount        Decimal? @db.Decimal(14, 2)
  purposeRaw    String?
  payerAccount  String?
  payerNameRaw  String?
  balanceAfter  Decimal? @db.Decimal(14, 2) // "Raspolozivo" — informativno, Faza 2 lanac
  duplicateHits Int      @default(0)
  lastDuplicateAt DateTime?
  paymentId     String?  @unique
  importBatchId String?
  reviewedById  String?
  reviewedAt    DateTime?
  dismissReason String?
  ipHash        String?
  @@unique([zevId, rawHash])
  @@index([zevId, status])
}
```

Prijedlog fakture se **ne čuva** u redu. Računa se pri prikazu (`fetchOpenInvoiceCandidates` + `scoreInvoiceMatch`, kao `importPdfPreview`), pa nikad ne zastari kad se u međuvremenu plati ili stornira neka faktura. Zato `fetchOpenInvoiceCandidates` i `scoreInvoiceMatch` dobijaju `export` (ili se kroz `payments.ts` izlaže `suggestForSignal(zevId, signal)`), bez promjene logike.

**Izmjena engine-a (Faza 1):** `nameMatchesText` uklanja dijakritike na obje strane (`č/ć→c`, `š→s`, `ž→z`, `đ→dj` *i* `đ→d` kao dvije varijante, `normalize("NFD")` za ostalo). Mala funkcija `foldDiacritics` ide u `src/lib/`. Ovo popravlja i PDF uvoz. Treba novi test u `payments.test.ts`: „Željko Galić" i `ZELJKO GALIC` daju +40.

Za primjer iz zadatka, vlasnik `Željko Galić`, stan `Stan 11`, otvoreno tačno 47,87:
- 70 (stan) + 40 (ime, poslije ispravke) + 30 (iznos) = **140**;
- bez ispravke dijakritika: 100.

### O4. Detekcija duplikata

**(1) Ista poruka dva puta** (ponovljen Shortcut, retry, ili **dva telefona**, predsjednik i knjigovođa, koja oba primaju SMS).
- Ključ: `@@unique([zevId, rawHash])`, gdje je `rawHash = sha256(normalizeSpaces(text))`. Ograničenje je u bazi, ne u aplikaciji, pa ni trka dva istovremena zahtjeva ne pravi dva reda. Insert koji padne na jedinstvenom ključu se hvata: `duplicateHits++`, `lastDuplicateAt = now`, odgovor `200 {"status":"duplicate"}`, bez audit reda.
- Zašto heš ne „guta" stvarne ponovljene uplate: tekst sadrži **`Raspolozivo` stanje poslije transakcije**. Isti vlasnik koji isti dan dva puta plati isti iznos dobija dvije poruke sa različitim stanjem, dakle dva različita heša. Lažno prepoznavanje duplikata je moguće samo ako se između dvije identične uplate desi odliv tačno istog iznosa, a to je zanemarljivo.
- Dva telefona sa istim ključem su time podržana bez ikakve dodatne logike.

**(2) Između kanala: SMS i izvod (obavezno u Fazi 1).**
- **PDF pregled:** `importPdfPreview` za svaki `IN` red traži `IncomingBankSms` u statusu `CONFIRMED` sa istim `accountId`, istim iznosom, `payerAccount === partnerAccount` (cifre) i datumom prijema u opsegu `[statementDate − 1, statementDate + 3]` dana. Parovi se uparuju jedan-na-jedan, pohlepno. Pogođen red dobija `include: false` i novo polje `PdfPreviewRow.duplicateOf: { kind: "SMS", paymentId }`. `pdf-statement-import.tsx` prikazuje oznaku „Već evidentirano preko SMS-a" sa linkom na uplatu. Knjigovođa i dalje može red ručno uključiti.
- **Obrnuto (SMS stiže kad je PDF već uvezen, rijetko):** pri prikazu čekaonice traži se `Payment` sa istim računom i iznosom, datumom ±3 dana i istim imenom poslije uklanjanja dijakritika, iz serije čiji `sourceType` nije `"SMS"`. Takav SMS se prikazuje sa upozorenjem i **nije** unaprijed označen.
- **CSV** knjiži bez pregleda, pa se tamo ne može ništa „odznačiti". Faza 1 samo dokumentuje rizik. Faza 2 prebacuje CSV na preview model ili preskače redove sa jasnom porukom (vidi Pitanja).

### O5. Kojem `MoneyAccount`-u poruka pripada

- Cifre iz „Priliv na …" se porede sa ciframa `iban`-a **samo aktivnih `BANK` računa tog ZEV-a**. Ista logika kao `accountMismatch` (`payments.ts:317-319`) se izdvaja u malu zajedničku funkciju `accountDigitsMatch(a, b)`.
- **Nikad** se ne traži preko drugih ZEV-ova. Ključ je određio tenanta, a SMS koji pominje tuđi račun je samo „nepoznat račun".
- **Ima tačno jedno poklapanje:** `accountId` se postavlja.
- **Nema poklapanja:** `accountId = null`, status `PENDING`, upozorenje „Račun 555-…-32 nije upisan ni na jednom računu ZEV-a". U pregledu je padajuća lista računa, a red **ne može** biti potvrđen dok račun nije izabran. Uz upozorenje stoji link „Dopuni broj računa u Podešavanjima". Ako ZEV ima tačno jedan aktivni `BANK` račun bez upisanog broja, on se predloži, ali **ne** označi automatski.
- **Webhook nikad ne pravi `MoneyAccount`.** Struktura finansija se ne mijenja iz neautentifikovanog izvora.
- **Više poklapanja** (dva računa sa istim brojem, greška u unosu): tretira se kao „nema poklapanja", uz poruku o dvosmislenosti.

### O6. UI

Sve kroz primitive iz `src/components/ui.tsx` (`PageHeader`, `Card`, `Table`/`Td`/`ColumnSpec`, `Tabs`, `StatusBadge`, `ConfirmAction`, `Flash`, `Field`, `inputCls`, `SubmitBtn`, `BtnLink`). Implementator mora poštovati `Plans/design-system.md`. Svi novi stringovi idu kroz `t()` (`sr-Latn.ts` + `en.ts`, grupa `bankSms.*`).

**1. `/fakture/uplate`:** iznad postojećih kartica, za management, nova kompaktna kartica „SMS obavještenja banke". Sadrži „Na čekanju: N · Neprepoznate: M · Posljednja poruka: prije 2 h" i dugme „Otvori". Ako ključ nije podešen, kartica nudi link „Podesi automatski prijem" ka Podešavanjima.

**2. Nova stranica `/fakture/uplate/sms`** (`src/app/(app)/fakture/uplate/sms/page.tsx`). Uvid imaju ACCOUNTANT i PRESIDENT (kao `suggestMatches`), potvrdu i odbacivanje samo ACCOUNTANT (kao `commitPdfImport`). Redovi mogu biti uplate (Priliv) i isplate (Odliv); za Odliv umjesto fakture stoje padajuća lista Troškova i opciona kategorija, tačno kao u PDF pregledu. `Tabs` (`?tab=`):
- **„Na čekanju"**: klijentska komponenta `src/components/bank-sms-review.tsx`, po uzoru na `pdf-statement-import.tsx` (ista padajuća lista faktura, isti `matchHint`, ista kvačica „uključi"). Kopira obrazac, ali ne vadi zajedničku komponentu u Fazi 1, da se ne dira PDF tok.
  - Kolone: kvačica · Primljeno (datum i vrijeme) · Račun (padajuća lista ako je nepoznat) · Platilac (ime + račun platioca sitnim mono fontom) · Svrha · Iznos · Faktura (unaprijed izabrana ako je skor ≥ 70, plus hint) · Upozorenja (`StatusBadge`: „nepoznat račun", „moguće već uvezeno").
  - Dugmad: „Potvrdi označene (N)" i, po redu, „Odbaci" kroz `ConfirmAction` sa obaveznim razlogom.
  - Red sa upozorenjem **nije** unaprijed označen. To je isti razlog kao rizik 6 u Gmail planu: automatika ispred ljudskog koraka podstiče potvrđivanje bez čitanja.
- **„Potvrđene"**: tabela sa linkom na `/fakture/uplate/<paymentId>`.
- **„Neprepoznate"**: `REJECTED` (sirovi tekst ako postoji, razlog) i odbačene (`DISMISSED`, sa razlogom).

**3. Podešavanja → tab „ZEV":** nova kartica „Automatski prijem SMS obavještenja banke" pored „Računi". Klijentska komponenta `bank-sms-token-card.tsx` jer prikazuje ključ jednom iz povratne vrijednosti server akcije. **Ključ nikad ne ide u URL ni u `?msg=`.**
- **Status:** „Aktivno od 01.10.2026, generisao: …", posljednja primljena poruka, posljednji probni zahtjev.
- **Dugmad:**
  - „Generiši pristupni ključ";
  - ako ključ postoji: „Generiši novi ključ" kroz `ConfirmAction` („Stari ključ odmah prestaje da važi; morate ga zamijeniti u automatizaciji na telefonu");
  - „Isključi prijem" (opoziv).
- **Poslije generisanja,** jednom: URL (`${getEnv().APP_URL}/api/uplate/sms`), vrijednost zaglavlja (`Bearer <zevId>.<tajna>`) i dugmad za kopiranje. Upozorenje: „Ovaj ključ se više neće prikazati. Ne šaljite ga porukom i ne objavljujte screenshot." Ispod je `<details>` sa uputstvom (vidi niže).
- **Probni zahtjev:** tijelo sa `"test": true` prolazi autentifikaciju i parser, vraća `{"status":"test_ok","parsed":{…}}` i upisuje `lastTestAt` u `bankSms.webhook`. Ne pravi red u čekaonici. Tako korisnik provjeri podešavanje bez čekanja na stvarnu uplatu.

### O7. Audit

| Akcija | Kad | Actor / zevId | Sadržaj (bez imena, bez sirovog teksta, bez ključa) | Kategorija |
|---|---|---|---|---|
| `bank_sms.token.issue` | generisanje / novi ključ | korisnik | `{ replaced: bool }` | SYSTEM (kao `approval_token.issue`) |
| `bank_sms.token.revoke` | isključenje | korisnik | — | SYSTEM |
| `bank_sms.auth.failed` | pogrešan ključ | `null`, **`zevId: null`** (neprovjeren, `audit.ts:17-24`) | `ipHash` | SYSTEM (kao `auth.login.failed`) |
| `bank_sms.rate_limited` | 429 | `null` ili `{label:"sms-webhook"}` + provjeren zevId ako postoji | `ipHash` | SYSTEM |
| `bank_sms.receive` | nova poruka (sve vrste osim duplikata) | `{ label: "sms-webhook" }`, `zevId` provjeren | `{ smsId, kind, status, amount, accountId }` | SYSTEM: prijem nije knjiženje, nego „dostava podatka" |
| `bank_sms.dismiss` | odbacivanje | korisnik | `{ smsId }`, `reason` | FINANCE (ljudska knjigovodstvena odluka) |
| `payment.import_sms` | potvrda | korisnik | `{ importedIn, smsIds }`, target `BankImportBatch` | FINANCE (kao `payment.import_pdf`) |
| `payment.allocate` (postojeća) | auto-alokacija pri potvrdi | korisnik | `source: "sms_import"` | FINANCE (postojeće) |

- Duplikati se **ne** auditiraju (brojač u redu), jer bi dva telefona punila tabelu iz koje se ništa ne briše.
- Ime platioca i sirovi tekst ne idu u audit iz istog razloga (append-only, `audit.ts:1-2`). Žive u `IncomingBankSms`, gdje im je mjesto.
- Svi kodovi idu u `ACTION_CATEGORY` i u i18n `auditAction.*`, u istoj izmjeni, inače `tests/activity-catalog.test.ts` pada.

## Uputstvo za iPhone (Shortcuts), za korisnika

Ide u `public/korisnicko-uputstvo.html` i u `<details>` kartice u Podešavanjima. Nazivi su dati na engleskom, uz srpski u zagradi, jer zavise od jezika telefona. **Treba ih provjeriti na stvarnom iPhone-u prije puštanja** (vidi Pitanja).

1. U aplikaciji ZEV upravnik otvorite **Podešavanja → ZEV → Automatski prijem SMS obavještenja banke** i kliknite **„Generiši pristupni ključ"**. Ekran ostavite otvoren: trebaće vam **adresa** i **ključ**.
2. Na iPhone-u otvorite aplikaciju **Shortcuts (Prečice)** i izaberite karticu **Automation (Automatizacija)** na dnu.
3. Dodirnite **+** (ili „New Automation"), pa izaberite **Message (Poruka)**.
4. Podesite uslov:
   - **Message Contains (Poruka sadrži):** upišite `NOVA BANKA-` (to hvata i Priliv i Odliv).
   - **Sender (Pošiljalac):** ostavite prazno — banka nema broj pošiljaoca koji se može izabrati (potvrđeno na korisnikovom iPhone-u). Uslov „Poruka sadrži" je dovoljan; poruke koje ga ne ispunjavaju nikad ne napuštaju telefon, a aplikacija ionako odbija sve što nije poruka banke.
5. Izaberite **Run Immediately (Pokreni odmah)** i isključite **Notify When Run** ako ne želite obavještenje svaki put. Na starijim iOS verzijama isključite **Ask Before Running (Pitaj prije pokretanja)**. Dodirnite **Next**.
6. Izaberite **New Blank Automation (Nova prazna automatizacija)** i dodajte akciju **Get Contents of URL (Preuzmi sadržaj URL-a)**.
7. U polje URL nalijepite **adresu** iz koraka 1 (izgleda kao `https://…/api/uplate/sms`).
8. Dodirnite strelicu **„›"** (ili „Show More") pored akcije i podesite:
   - **Method:** `POST`.
   - **Headers (Zaglavlja):** dodajte jedno. **Key** = `Authorization`, **Value** = nalijepite **ključ** iz koraka 1 (počinje sa `Bearer `).
   - **Request Body:** `JSON`. Dodajte polje tipa **Text** sa ključem `text`. Za vrijednost dodirnite polje i izaberite promjenljivu **Shortcut Input (Ulaz prečice)**, pa u njenim opcijama izaberite **Content (Sadržaj)** poruke.
9. Dodirnite **Done (Gotovo)**.
10. Provjera: u aplikaciji kliknite **„Pošalji probnu poruku"** i pratite uputstvo na ekranu, ili sačekajte sljedeću uplatu. Na kartici treba da piše „Posljednja primljena poruka: prije nekoliko sekundi". Poruka se zatim vidi u **Uplate → SMS obavještenja banke → Na čekanju**.
11. Ako ključ ikad procuri (izgubljen telefon, screenshot), u aplikaciji kliknite **„Generiši novi ključ"** i ponovite korak 8 sa novim ključem. Stari odmah prestaje da radi.

Napomene za korisnika:
- Telefon mora imati internet u trenutku kad SMS stigne. Ako nema, ta poruka se **neće** naknadno poslati. Uplata se tada unosi iz izvoda ili ručno, a dnevni izvod ostaje kontrola.
- Ako i predsjednik i knjigovođa primaju SMS i podese istu automatizaciju sa istim ključem, aplikacija prepoznaje duplikate.

## Faze implementacije

**Faza 1: minimalna stvarna, sigurna i upotrebljiva verzija** (**2.35.0**, minor — potvrđeno). Uključuje i Odliv poruke (odluka #6); ključem upravljaju PRESIDENT i ACCOUNTANT (odluka #3).
- Migracija: model `IncomingBankSms` (+ relacije na `Zev` i `MoneyAccount`).
- `bankSmsParser.ts` + `tests/bankSmsParser.test.ts`. Slučajevi:
  - stvarni primjer iz zadatka;
  - zarez u svrsi;
  - tačka u imenu;
  - `11.175,20`;
  - Odliv je `ODLIV`;
  - marketing je `UNKNOWN`;
  - EUR se odbija;
  - prelomi reda;
  - nedostaje račun platioca, pa `UNKNOWN`.
- `bankSms.ts`:
  - `receiveBankSms` (autentifikacija, limiteri, dedup, račun, audit);
  - `issueBankSmsToken`, `revokeBankSmsToken`, `getBankSmsStatus`;
  - `listBankSms` (sa prijedlozima izračunatim pri čitanju);
  - `confirmBankSms`, `dismissBankSms`.
- `src/app/api/uplate/sms/route.ts` (tanak).
- `payments.ts`:
  - izdvajanje `commitStatementRows` (PDF ponašanje se ne mijenja);
  - `export` za funkcije uparivanja;
  - `foldDiacritics` u `nameMatchesText`;
  - `duplicateOf` u `importPdfPreview`;
  - prikaz oznake u `pdf-statement-import.tsx`.
- UI: kartica na `/fakture/uplate`, stranica `/fakture/uplate/sms`, kartica u Podešavanjima → ZEV.
- `catalog.ts` + i18n oznake. Dopuna komentara u `settings.ts`.
- Testovi (`tests/bankSms.test.ts`):
  - pogrešan, opozvan i neispravan ključ, kao i suspendovan ZEV, daju isti 401;
  - stari ključ ne radi poslije generisanja novog;
  - duplikat daje jedan red i `duplicateHits = 1`;
  - Odliv i nepoznata poruka ne prave uplatu;
  - poruka koja nije od banke se čuva bez `rawText`;
  - nepoznat račun blokira potvrdu;
  - potvrda pravi `Payment` + `FinTransaction` + alokaciju, `BankImportBatch.sourceType = "SMS"` i `payment.import_sms`;
  - dupla potvrda se odbija;
  - PDF pregled označava SMS duplikat;
  - test mod ne pravi red.
- Dopuna `tenant-isolation.test.ts`: ključ ZEV-a A ne može upisati u ZEV B; račun se traži samo u svom ZEV-u; ACCOUNTANT ZEV-a B ne vidi i ne potvrđuje SMS ZEV-a A.
- `CHANGELOG.md`, verzija uz potvrdu, `public/korisnicko-uputstvo.html` (gornje uputstvo), `typecheck && lint && test && build` i živa provjera u pregledaču (curl/Postman sa stvarnim primjerom).

**Faza 2: kontrola i udobnost**
- **Lanac stanja (`Raspolozivo`):** `prethodno stanje ± iznos = novo stanje` je **jaka provjera autentičnosti** (Priliv i Odliv poruke zajedno), jer lažna poruka bez poznavanja tekućeg stanja ne prolazi. Neuklopljena poruka dobija upozorenje i ne označava se unaprijed.
- „Unesi ručno" iz neprepoznate poruke (forma unaprijed popunjena iz sačuvanog teksta).
- Izdvajanje zajedničke komponente za pregled redova (PDF + SMS).
- CSV zaštita od duplikata sa SMS-om: **ne radi se**, korisnik ne koristi CSV (odluka #5).

**Faza 3 (uslovna automatska potvrda): IZBAČENA iz plana** (odluka #2: čovjek u petlji je obavezan). Vraća se samo na izričit zahtjev korisnika.

**Kasnije (van opsega):**
- SMS formati drugih banaka: registar parsera po prefiksu pošiljaoca, isti ugovor `ParsedBankSms`;
- više ključeva po ZEV-u (po telefonu, sa nazivom, pojedinačno opozivi);
- Android (Tasker / „SMS forwarder" aplikacije zovu isti endpoint bez izmjene servera);
- spajanje sa `IncomingStatement` iz Gmail plana ako se taj plan implementira.

## Rizici

1. **Procureo ključ.** Ublaženo dizajnom (O3: ništa se ne knjiži bez čovjeka), ograničenjem broja zahtjeva, auditom i jednim klikom za novi ključ. Šteta je ograničena na smeće u čekaonici. Nikad nije lažna uplata u knjigama, jer potvrdu uvijek daje čovjek.
2. **Duplo knjiženje SMS + izvod.** Glavni praktični rizik. Za PDF je riješeno u Fazi 1 (O4). CSV se ne koristi (odluka #5). Knjigovođa mora znati da „SMS na čekanju" i izvod pokrivaju iste uplate.
3. **Banka promijeni tekst poruke.** Strogi parser tada odbija sve, i to se **vidi** („Neprepoznate: 5"). Nikad se ne pogrešno pročita. To je namjeran izbor strogosti umjesto „pametnog" pogađanja.
4. **Izgubljene poruke.** Telefon bez interneta, ugašen, ili iOS ne pokrene automatizaciju. SMS kanal nije potpun i nikad ne zamjenjuje izvod. Dnevni ili mjesečni izvod ostaje kontrola potpunosti.
5. **Rate limiter u memoriji.** Na Vercel-u radi po instanci, a poslije restarta se briše. Isto važi za postojeće limitere i nije nova klasa slabosti. Dedup i čekaonica ne zavise od njega.
6. **`x-forwarded-for` se može lažirati van Vercel-a** (već zabilježeno u planu za sesije). Utiče samo na limiter neuspjelih pokušaja.
7. **„Bare" kandidat iz perioda `MM/YY`.** `08/26` daje stanu 26 +15. Nizak skor ispod praga, ali je vidljiv u hintu. Opciona dorada: lookahead u `extractUnitNumberCandidates` proširiti na `/YY` kad prethodni broj ima 1-2 cifre i ≤ 12. To se mora testirati protiv postojećih PDF slučajeva (`ZA STAN 7/2026 STAN 4`), pa nije u Fazi 1 bez potvrde.
8. **Prvi `POST` route handler bez sesije.** Svaka buduća izmjena mora zadržati pravilo da `route.ts` nikad ne zove `getAuthContext()`/cookie i da `zevId` dolazi **samo** iz provjerenog ključa. Treba komentar u zaglavlju route-a i test izolacije tenanata.
9. **`payments.ts` je već oko 935 linija.** Nova logika ide u `bankSms.ts` i `bankSmsParser.ts`. U `payments.ts` ulaze samo izdvajanje helpera, `export`-i, dijakritici i `duplicateOf`.
10. **Lični podaci vlasnika (ime, račun) se čuvaju u novoj tabeli.** To je isti nivo kao `Payment.payerNameRaw` i `BankImportBatch.rawText` danas. Poruke van banke se ne čuvaju (O2).

## Pitanja za korisnika

Sva pitanja su odgovorena 2026-10-04 — odgovori su na vrhu dokumenta u odjeljku „Odluke korisnika", a tijelo plana je usklađeno s njima. Otvorena ostaje samo jedna provjera:

- **Vrijednost `APP_URL` u Vercel-u:** korisnik navodi `https://zev-app.vercel.com/`; provjeriti da li je to tačna adresa (Vercel domene su obično `*.vercel.app`). Aplikacija ništa ne pretpostavlja — URL webhook-a je uvijek `APP_URL + /api/uplate/sms`.

### Kritični fajlovi za implementaciju

- `C:\Users\Administrator\Projects\ZEV\zev-app\src\server\services\payments.ts`: izdvajanje `commitStatementRows`, `export` uparivanja, `foldDiacritics` u `nameMatchesText`, `duplicateOf` u `importPdfPreview`
- `C:\Users\Administrator\Projects\ZEV\zev-app\src\server\services\bankStatementPdf.ts`: obrazac za novi `src\server\services\bankSmsParser.ts`
- `C:\Users\Administrator\Projects\ZEV\zev-app\prisma\schema.prisma`: novi model `IncomingBankSms`
- `C:\Users\Administrator\Projects\ZEV\zev-app\src\server\services\settings.ts` i `C:\Users\Administrator\Projects\ZEV\zev-app\src\server\auth\tokens.ts`: ključ `bankSms.webhook` (heš, `generateToken`, `hashesEqual`)
- `C:\Users\Administrator\Projects\ZEV\zev-app\src\lib\activity\catalog.ts`: novi audit kodovi (provjerava ih `tests\activity-catalog.test.ts`)
- Novi fajlovi:
  - `src\app\api\uplate\sms\route.ts`
  - `src\server\services\bankSms.ts`
  - `src\app\(app)\fakture\uplate\sms\page.tsx`
  - `src\components\bank-sms-review.tsx`
  - `src\components\bank-sms-token-card.tsx`
- Izmjene postojećih ekrana: `src\app\(app)\fakture\uplate\page.tsx`, `src\app\(app)\podesavanja\page.tsx`, `src\components\pdf-statement-import.tsx`
