# Plan: ime pošiljaoca u e-mailu i slanje probne poruke (Mailjet, go-live)

**Status: PLAN, odluke korisnika potvrđene (2026-10-22), implementacija u toku.** Plan je napravljen čitanjem stvarnog koda (v2.37.0, `package.json:3`), uz Opus plan-only prolaz; ključne tvrdnje (R2: `lastError` se ne upisuje za `ok:false`; `retryFailed` bez pozivalaca; fiksni „mock" podnaslov) ručno provjerene.

## Odluke korisnika (2026-10-22)

1. **P1: ime pošiljaoca podešava super admin u `/admin`** (ne env varijabla): osnovno ime (npr. „ZEV upravnik") + prekidač „dodaj naziv ZEV-a" („ZEV upravnik – Kneza Miloša 12"). Bez upisa važi `MAILJET_FROM_NAME`, pa „ZEV upravnik".
2. **P2: probnu poruku šalju predsjednik i računovođa** (Podešavanja → Parametri) **i super admin** (`/admin`), obje opcije (moja adresa / upisana adresa).
3. **P3: lista dozvoljenih primalaca (probni period) — da, podešava je super admin u `/admin`** (ne env varijabla). Prazna lista = isključeno.
4. **Nova tabela `PlatformSetting`** (ključ → JSON vrijednost, za podešavanja cijele platforme) i migracija — prihvaćeno. Postojeći `Setting` je vezan za ZEV (`zevId` obavezan, `schema.prisma` `model Setting`), pa ne može nositi platformska podešavanja. **Migracija se na produkciji pokreće ručno prije deploy-a.**
5. **P4: minor → 2.38.0.** **P5:** „moja adresa" = e-mail za prijavu (`User.email`). **P6:** bez Reply-To. **P7:** 5 probnih poruka na sat po korisniku, 20 dnevno po ZEV-u.

Izmjene u odnosu na nacrt ispod: `MAILJET_FROM_NAME` i `EMAIL_RECIPIENT_ALLOWLIST` nisu primarni izvor — R1 i „Lista dozvoljenih primalaca" čitaju `PlatformSetting` (ključevi `email.fromName`, `email.appendZevName`, `email.recipientAllowlist`), a `MAILJET_FROM_NAME` ostaje samo rezervna vrijednost. U `/admin` dolazi kartica „E-mail podešavanja platforme" (izmjene se bilježe u audit, akcija `platform.email_settings.update`). Tačka „Nema novog Prisma modela ni migracije" iz sekcije „Pravila projekta" više ne važi.

## Rezime

1. **Mailjet provajder već postoji, ali šalje bez imena pošiljaoca.** `mailjetEmail.ts:49` šalje `From: { Email }`. Primalac zato vidi golu adresu (npr. `noreply@zevupravnik.com`). Prijedlog: opcioni `MAILJET_FROM_NAME` (podrazumijevano „ZEV upravnik"). Uz to, za poruke koje pripadaju ZEV-u, ime se dopunjuje nazivom tog ZEV-a: „ZEV upravnik – Kneza Miloša 12". Šema baze se ne mijenja.
2. **Nova kartica „Probna e-mail poruka"** ima dvije radnje: „Pošalji na moju adresu" (jedan klik) i „Pošalji na adresu" (adresu upisuje korisnik). Karticu vide predsjednik i računovođa u Podešavanja → Parametri, a super admin u `/admin`. Kartica uvijek prikazuje koji provajder je aktivan. U mock režimu jasno piše da ništa ne izlazi iz aplikacije. Kad slanje ne uspije, prikazuje se stvarna greška provajdera.
3. **Probna poruka ide kroz postojeći outbox.** Šalje se preko `queueNotification` sa šablonom `test-email`, pa se vidi u „Poslate poruke". Ograničenje broja slanja se računa **iz baze** (broj `test-email` redova), a ne iz memorije, jer memorija na Vercel serverless funkcijama ne traje. Svako slanje se bilježi u audit sa dvije nove akcije, upisane u katalog.
4. **Usput se zatvaraju tri rupe važne za go-live.**
   - (a) `dispatchNotification` ne upisuje `lastError` kad provajder vrati `ok:false` (`service.ts:75-83`), pa se greška Mailjet-a gubi.
   - (b) Mailjet greška na nivou cijelog odgovora (npr. 401 zbog pogrešnog ključa) prijavi se samo kao „Mailjet HTTP 401".
   - (c) Podnaslov stranice „Poslate poruke" je fiksno napisan kao „mock provajderi" (`poruke/page.tsx:31`).
5. **Bezbjedan redoslijed pokretanja.** Promjena `EMAIL_PROVIDER=mailjet` odmah šalje prave poruke svima koji imaju e-mail: pozive za glasanje, nove linkove, dobrodošlice za naloge. Prijedlog je privremena lista dozvoljenih primalaca `EMAIL_RECIPIENT_ALLOWLIST`. Mailjet se uključi samo za vašu adresu, provjeri se i tek onda lista ukloni (P3).

## Zatečeno stanje

### Slanje e-maila
- `src/server/notifications/providers.ts`:
  - `:26-29` `EmailProvider.send({ to, subject, body })`, bez polja za ime pošiljaoca.
  - `:71-81` `getEmailProvider()` čita `EMAIL_PROVIDER` (`mock` podrazumijevano, `mailjet`, ostalo baca grešku).
  - `MockEmailProvider` (`:38-52`) vraća `sent` i `delivered`.
- `src/server/notifications/mailjetEmail.ts`:
  - `:29-37` čita `MAILJET_API_KEY/SECRET/FROM_EMAIL` tek pri slanju (lazy).
  - `:49` `From: { Email: fromEmail }`, bez `Name`.
  - `:52` šalje samo `TextPart`.
  - `:78-80` grešku traži samo u `Messages[0].Errors[].ErrorMessage`. Mailjet odgovor na pogrešne kredencijale ima `ErrorMessage` na vrhu tijela (`{ ErrorMessage, StatusCode: 401 }`), pa korisnik vidi samo „Mailjet HTTP 401".
- `src/server/notifications/service.ts`:
  - `:9-47` `queueNotification` upiše red pa ga odmah pošalje.
  - `:75-83` kad je `ok:false`, upisuje se `status: FAILED`, ali **ne i `lastError`**. `lastError` se puni samo u `catch` (`:84-93`), tj. kad provajder baci izuzetak.
  - `retryFailed` (`:97`) nema nijednog pozivaoca. To znači da prelazak na Mailjet **ne šalje naknadno** stare neuspjele poruke.
- `src/lib/env.ts:6-9`: komentar izričito kaže da konfiguracija provajdera **ne ide** u zod šemu, nego ostaje u `providers.ts`. Zato se `MAILJET_FROM_NAME` čita lazy u `mailjetEmail.ts`, isto kao `MAILJET_FROM_EMAIL`, a ne u `env.ts`.
- `.env.example:27` (`EMAIL_PROVIDER`), `:36-38` (MAILJET_*). `README.md:131-132` (tabela varijabli), `:201-212` (uputstvo za Mailjet).
- `src/server/notifications/testOutbox.ts:38-43`: `isTestOutboxEnabled()` traži `EMAIL_PROVIDER === "mock"`. Kad se uključi Mailjet, test-linkovi se sami gase. To je ispravno i ne mijenja se.

### Ko danas šalje e-mail
| Mjesto | Šablon | zevId | Napomena |
|---|---|---|---|
| `users.ts:166` | `password-reset` | `null` | na nivou naloga |
| `admin.ts:204` | `tenant-welcome` | ZEV | super admin kreira ZEV |
| `admin.ts:310` | `tenant-account-welcome` | ZEV | super admin kreira nalog |
| `meetings.ts:935-958` | `approval-link` | ZEV | **petlja, jedan po jedan, za svakog glasača sa e-mailom** |
| `meetings.ts:1133` | `approval-link-reissue` | ZEV | novi link |

`createUserForParty` (`users.ts:58`) **ne šalje** e-mail. Jedini e-mailovi dobrodošlice su dva koja šalje super admin.

### Uloge i „administrator"
- `guards.ts`: `requireRole` (`:64`), `requireZev` (`:82`), `requireSuperAdmin` (`:93`). Uloge u ZEV-u su PRESIDENT, ACCOUNTANT i OWNER. `isSuperAdmin` je zastavica na nivou platforme (`schema.prisma:33`).
- `requireActor()` (`src/server/actor.ts:8`) vraća i `email` i `displayName`, isto kao `requireSuperAdminActor()` (`:42`).
- „Poslate poruke" (`poruke/page.tsx:17`) je dostupna predsjedniku i računovođi. Prikazuje samo redove tekućeg ZEV-a (`:23-28`), pa poruke sa `zevId=null` tamo nikad nisu vidljive.
- `podesavanja/page.tsx`:
  - `:121-126` tabovi (Parametri vide predsjednik i računovođa).
  - `:321-335` kartica „Napomena o integracijama" već čita `process.env.EMAIL_PROVIDER`. To je prirodno mjesto za novu karticu.
  - `:149` link „Poslate poruke".

### Ograničivači broja zahtjeva
- `users.ts:9-30` (prijava) i `:115-134` (reset lozinke) koriste `Map` u memoriji.
- `bankSms.ts:144-164` koristi isti obrazac, a komentar (`:148-151`) kaže „in-memory, best effort".
- Na Vercel-u svaka instanca ima svoju mapu i ona nestaje pri hladnom startu. Za zaštitu od zloupotrebe slobodno upisane adrese to je preslabo. Zato je ovdje prijedlog brojanje iz baze.

### Audit i katalog
- `audit()` je u `src/server/audit.ts`. Katalog je `src/lib/activity/catalog.ts`, SYSTEM sekcija `:120-157`.
- `tests/activity-catalog.test.ts` skenira `action: "..."` u `src/server` i `src/app` i pada na svaku neklasifikovanu ili zastarjelu akciju.
- SYSTEM akcije se ne moraju prevoditi. Neprevedene se prikazuju kao sirovi kod (`sr-Latn.ts:376-381`).

### UI obrazac i dizajn sistem
- Postoji klijentska kartica sa server akcijama koje vraćaju `{ ok, error }` umjesto redirect-a: `src/components/bank-sms-token-card.tsx` + `src/server/actions/bankSms.ts`. Ovo je pravi obrazac za ovaj slučaj. Rezultat (provajder, greška) se ne smije stavljati u URL kao `?msg=`, a mora se prikazati odmah.
- `Plans/design-system.md`:
  - `:214` najviše jedno `primary` dugme po regiji.
  - `:215` `tonal` je podrazumijevani izbor u kartici.
  - `:219` nema novog `danger` dugmeta.
  - `:283` novi tekst ide kroz `t()`, ugniježđeno.
  - `:285` UI ne pominje interne nazive (`.env.example` i slično).
  - §8 traži živi pregled na 1440px i 375px.
- Primitivi u `src/components/ui.tsx`: `Card` `:31`, `Field` `:696`, `inputCls` `:706`, `btnBase`/`btnVariantCls` `:439`/`:456`, `Flash` `:728` (za klijentski prikaz se kopira isti stil, kao u `bank-sms-token-card.tsx`).
- Admin početna (`src/app/admin/page.tsx:71`) ima mrežu `lg:grid-cols-3` sa karticama „Svi ZEV nalozi" i „Novi ZEV nalog" (`:118`).

### Testovi
- `tests/setup-env.ts:7` postavlja `EMAIL_PROVIDER="mock"`.
- `tests/mailjetEmail.test.ts` mock-uje `fetch` preko `vi.spyOn(globalThis, "fetch")` i čuva/vraća env.
- `tests/helpers.ts`: `createFixture` (`:45`, vraća `zev`, `president`, `accountant`, `actorA`…) i `createSuperAdminActor` (`:27`).

## Rješenje

### R1. Ime pošiljaoca

| Opcija | Opis | Za | Protiv |
|---|---|---|---|
| A | Samo globalni `MAILJET_FROM_NAME` (podrazumijevano „ZEV upravnik") | najjednostavnije | vlasnik u više ZEV-ova ne vidi iz kog je ZEV-a poruka |
| B | Samo naziv ZEV-a („Kneza Miloša 12") | poznato primaocu | password-reset nema ZEV; naziv bez imena aplikacije liči na phishing |
| **C** | **Hibrid: `MAILJET_FROM_NAME` kao osnova + „ – {shortName ?? legalName}" kad poruka ima `zevId`** | primalac prepoznaje i aplikaciju i zgradu; manje prijava za spam; bez šeme | jedan dodatni `zev.findUnique` po slanju (zanemarljivo) |
| D | Podešavanje (`Setting`) po ZEV-u | puna kontrola | novo polje u UI-ju i validacija; nije potrebno sada |

**Preporuka: C.** Adresa pošiljaoca ostaje jedna (`MAILJET_FROM_EMAIL`, domen `zevupravnik.com` ovjeren kroz SPF i DKIM). Mijenja se samo ime koje se prikazuje.

Izmjene:
- `providers.ts:26-29`: `send(msg: { to; subject; body; fromName?: string })`. Mock ignoriše `fromName`.
- `mailjetEmail.ts`:
  - `const fromName = msg.fromName ?? process.env.MAILJET_FROM_NAME ?? "ZEV upravnik"` (konstanta `DEFAULT_FROM_NAME`).
  - `From: { Email, Name: sanitizeFromName(fromName) }`.
  - `sanitizeFromName` uklanja `\r\n"<>`, sažima razmake i reže na 70 znakova.
- `mailjetEmail.ts:78-80`: greška se gradi iz `Messages[0].Errors[].ErrorMessage`, zatim iz `payload.ErrorMessage` (vrh tijela), pa tek onda iz `Mailjet HTTP {status}`. Ako postoji `ErrorIdentifier`/`ErrorCode`, dodaje se u zagradi radi podrške. Ključ i secret se nikad ne ispisuju (tijelo greške ih ne sadrži, a kod ih ne dodaje).
- `service.ts` `dispatchNotification`:
  - Za EMAIL i `msg.zevId`, učitaj `zev { shortName, legalName }` i proslijedi provajderu `fromNameSuffix`.
  - Pomoćna funkcija `buildFromName(base, zev)` koristi `shortName` ako postoji; inače `legalName` skraćen na 40 znakova sa „…". Osnova (`MAILJET_FROM_NAME`) se čita u samom provajderu, pa dispatch prosljeđuje samo sufiks.
- Dokumentacija:
  - `.env.example` iza `:38`: `# MAILJET_FROM_NAME="ZEV upravnik"   # ime pošiljaoca; poruke jednog ZEV-a dobijaju i „ – {naziv ZEV-a}"`.
  - `README.md:132` i `:207-208`: dopuniti.

### R2. Ispravke u outbox-u (preduslov da se greška prikaže)

- `service.ts:75-83`: dodati `lastError: ok ? null : (res.error ?? "Nepoznata greška provajdera.")`. Iz rezultata provajdera treba izvući i `error`, a ne samo `events` i `ok`.
- `poruke/page.tsx`:
  - `:31` podnaslov zavisi od provajdera: „Outbox e-mail i Viber poruka. E-mail: Mailjet (stvarno slanje); Viber: simulacija." ili postojeći mock tekst. Koristi `describeEmailProvider()` (R3).
  - Kod reda sa `FAILED` ispod chip-a dodati `m.lastError` sitnim tekstom (`text-[13px] text-slate-600`, ne ispod 13px po §8.2). Bez nove kolone.

### R3. Opis aktivnog provajdera (bez tajni)

Nova funkcija u `providers.ts`:
```ts
export type EmailProviderInfo = { kind: "mock" | "mailjet" | "unknown"; fromEmail: string | null; fromName: string | null; configured: boolean };
export function describeEmailProvider(): EmailProviderInfo
```
- `configured` za mailjet znači da su sve tri obavezne varijable postavljene.
- **Nikad** ne vraća ključ, secret ni njihov dio.
- Adresa pošiljaoca nije tajna i korisno je da se vidi.
- Ovu funkciju koriste i postojeća kartica `podesavanja/page.tsx:324` i stranica poruka, umjesto ponovljenog `process.env` čitanja.

### R4. Servis probne poruke

Nova datoteka **`src/server/services/emailTest.ts`**. Sva poslovna logika je ovdje; stranice i akcije samo prosljeđuju.

```ts
export type TestEmailInput = { target: "self" } | { target: "address"; address: string };
export type TestEmailResult = {
  ok: boolean; provider: "mock" | "mailjet" | "unknown"; toAddress: string;
  status: NotifStatus; error: string | null; messageId: string; simulated: boolean; // simulated = mock
};

export async function getTestEmailStatus(actor): Promise<{ provider: EmailProviderInfo; myEmail: string; usedLastHour: number; perHourLimit: number }>
  // requireRole(actor, "PRESIDENT", "ACCOUNTANT"); requireZev(actor)
export async function sendTestEmail(actor, input): Promise<TestEmailResult>
  // requireRole(actor, "PRESIDENT", "ACCOUNTANT"); const zevId = requireZev(actor)
export async function adminGetTestEmailStatus(actor) / adminSendTestEmail(actor, input)
  // requireSuperAdmin(actor); zevId = null
```
Sve četiri funkcije počinju guard-om. Zajednička privatna `sendTestEmailCore(actor, zevId | null, input)` radi sljedeće:

1. **Adresa primaoca**
   - `self`: `prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }).email`. Iz baze, ne iz klijenta. To je adresa za prijavu (P5).
   - `address`: `z.string().trim().toLowerCase().max(254).pipe(z.email("Unesite ispravnu e-mail adresu."))` (zod 4).
   - Dodatno se odbija adresa koja sadrži `, ; \s < > "`, tj. samo jedan primalac i bez ubrizgavanja zaglavlja.
   - Prazno polje daje grešku „Unesite e-mail adresu."
2. **Ograničenje broja slanja (iz baze, bez nove tabele)**
   - Broji se `notificationMessage` sa `template: "test-email"`, `relatedType: "User"`, `relatedId: actor.userId`, `createdAt > now-1h`. Granica je **5 na sat po korisniku**.
   - Za ZEV dodatno: isti šablon i isti `zevId` u zadnja 24h, granica **20 na dan po ZEV-u**.
   - Važi i za slanje na sopstvenu adresu, jer i ono troši Mailjet kvotu.
   - Kad je granica dostignuta: `audit(actor, { action: "notification.test_email.rate_limited", targetType: "User", targetId: actor.userId })` i greška „Dostignut je limit probnih poruka (5 na sat). Pokušajte ponovo kasnije."
   - Konstante `TEST_EMAIL_PER_USER_HOUR = 5` i `TEST_EMAIL_PER_ZEV_DAY = 20` su na vrhu fajla.
3. **Tekst poruke** (R5). Uključuje naziv ZEV-a (ako ga ima), `displayName` pošiljaoca, vrijeme (`formatDateTime`, zona aplikacije) i `getEnv().APP_URL`.
4. **Slanje** preko `queueNotification({ zevId: zevId ?? undefined, channel: "EMAIL", recipientId: target==="self" ? actor.partyId : null, toAddress, template: "test-email", subject, body, relatedType: "User", relatedId: actor.userId })`.
   - Poruka zato ulazi u outbox i u „Poslate poruke" (za ZEV).
   - Super admin poruka ima `zevId=null` i ne vidi se ni u jednom ZEV outbox-u. Namjerno: na nivou je platforme.
5. **Audit**: `audit(actor, { action: "notification.test_email.send", targetType: "NotificationMessage", targetId: msg.id, after: { to, target, provider, status, error } })`.
6. **Rezultat**: `{ ok: status !== "FAILED", provider, simulated: provider === "mock", error: msg.lastError, ... }`.

Greška provajdera ne baca izuzetak nego se vraća kao rezultat, da UI pokaže tačan tekst (npr. Mailjet greška za neovjerenog pošiljaoca). Izuzetak se baca samo za validaciju, limit i ovlašćenja.

Katalog (`catalog.ts`, SYSTEM sekcija `:120-157`, abecedno):
```ts
"notification.test_email.rate_limited": "SYSTEM",
"notification.test_email.send": "SYSTEM",
```
Prevod je opcioni (SYSTEM). Preporuka je ipak dodati ga u `sr-Latn.ts` `auditAction.notification.test_email` = { send: "Poslata probna e-mail poruka", rate_limited: "Odbijena probna poruka (limit)" }, ugniježđeno.

### R5. Tekst probne poruke (sr-Latn, samo tekst)

**Naslov:** `Probna poruka — ZEV upravnik`

**Tijelo (ZEV):**
```
Poštovani,

ovo je probna poruka iz aplikacije ZEV upravnik. Poslata je da bi se provjerilo da slanje e-pošte radi ispravno.

ZEV: {shortName ?? legalName}
Poslao/la: {displayName} ({Predsjednik | Računovođa})
Vrijeme slanja: {dd.mm.gggg. hh:mm}
Adresa aplikacije: {APP_URL}

Ako ste primili ovu poruku, slanje e-pošte radi. Nije potrebna nikakva radnja.
Ako niste očekivali ovu poruku, slobodno je zanemarite.

Ovo je automatska poruka. Molimo da na nju ne odgovarate.
```
**Super admin:** bez reda „ZEV:", a „Poslao/la: {displayName} (administrator platforme)".

Pošiljaočeva e-mail adresa se ne stavlja u tijelo. Ako se šalje na slobodno upisanu adresu, primalac ne treba da dobije lični e-mail predsjednika. U skladu sa PRIVACY napomenom u `service.ts:3-4`, poruka nema finansijskih podataka. Uloga se prevodi postojećim `tEnum("roles", …)`.

### R6. UI

**Ko smije:**
- **Predsjednik i računovođa u ZEV-u**: isti krug koji vidi „Poslate poruke" i Parametre.
- **Super admin u `/admin`**: e-mail je konfiguracija platforme, a super admin često nema ZEV.
- Vlasnik (OWNER) ne smije.
- Slobodno upisana adresa je dostupna svima koji smiju i karticu (P2). Zaštita su limit (R4.2), audit i to što se tekst poruke ne može mijenjati, pa se ne može koristiti za slanje proizvoljnog sadržaja.

**Gdje:**
- `podesavanja/page.tsx`, tab „Parametri": nova kartica zamjenjuje i proširuje „Napomena o integracijama" (`:321-335`). Postojeći tekst o Viberu ostaje kao pasus iznad.
- `src/app/admin/page.tsx`: ista kartica ispod „Novi ZEV nalog" u desnoj koloni.

**Komponente:**
- `src/components/test-email-card.tsx` (`"use client"`, po obrascu `bank-sms-token-card.tsx`). Props: `status` (provajder, `myEmail`, iskorišteno/limit) i `scope: "zev" | "admin"`, koji bira koju server akciju poziva.
- `src/server/actions/notifications.ts` (`"use server"`):
  - `sendTestEmailAction(input)` → `requireActor("PRESIDENT","ACCOUNTANT")` → `sendTestEmail`.
  - `adminSendTestEmailAction(input)` → `requireSuperAdminActor()` → `adminSendTestEmail`.
  - Obje vraćaju `{ ok: true, result } | { ok: false, error }`, uz `revalidatePath("/podesavanja/poruke")`.

**Izgled kartice** (`Card title="Probna e-mail poruka"`):
- `dl`, red „Način slanja":
  - mock: „Simulacija — poruke se samo upisuju u „Poslate poruke", ništa ne izlazi iz aplikacije."
  - mailjet + configured: „Mailjet — stvarno slanje".
  - mailjet bez konfiguracije: „Mailjet — nije potpuno podešen; slanje neće uspjeti." Bez navođenja imena varijabli (§6).
- `dl`, red „Pošiljalac": `{fromName} <{fromEmail}>`, samo za mailjet.
- `dl`, red „Iskorišteno": „{n} od 5 u posljednjih sat vremena".
- Dugme **„Pošalji na moju adresu ({myEmail})"**: `Btn`, `tonal`.
- `details` sa `ToggleBtn` „Pošalji na drugu adresu": `Field label="E-mail adresa"` + `input type="email" required maxLength=254` + dugme „Pošalji" `secondary`.
- **Nijedno `primary` i nijedno `danger` dugme** u ovoj regiji (`design-system.md:214, :219`). Dok slanje traje, dugmad su onemogućena (`useTransition`).
- Rezultat se prikazuje ispod, stilom `Flash`:
  - Uspjeh, mailjet: „Poruka je predata Mailjet-u za {adresa}. Provjerite sanduče i folder za neželjenu poštu."
  - Uspjeh, mock: „Simulacija: poruka za {adresa} je upisana u „Poslate poruke", ali nije stvarno poslata." (zeleni ton, ali jasan tekst)
  - Greška: „Slanje nije uspjelo: {tačna poruka provajdera}".
  - Uvijek link „Poslate poruke", samo u ZEV varijanti.
- Sav novi tekst ide u `src/lib/i18n/sr-Latn.ts` pod ugniježđenu grupu `emailTest: { title, mode: { mock, mailjet, misconfigured }, sendSelf, sendOther, ... }`. Grupa se dodaje i u `en.ts` (§6). Tekst sa parametrima se sklapa u komponenti.

## Ostale rupe za bezbjedno pokretanje

1. **Lista dozvoljenih primalaca (`EMAIL_RECIPIENT_ALLOWLIST`, opciono, P3).**
   - Format: lista odvojena zarezima, sa tačnim adresama ili `@domen`.
   - Kad je postavljena i `EMAIL_PROVIDER=mailjet`, `dispatchNotification` za EMAIL poruku na adresu van liste **ne zove provajdera**. Upisuje `FAILED` i `lastError: "Slanje na ovu adresu je privremeno isključeno (probni period pokretanja)."`.
   - Probna poruka prolazi kroz istu provjeru. To je i poenta: Mailjet se uključi samo za vlastitu adresu.
   - Implementira se u `service.ts` uz čistu funkciju `isRecipientAllowed(addr, raw)`. Dokumentuje se u `.env.example` i README-u.
   - Pošto `retryFailed` nema poziva, blokirane poruke se kasnije **ne šalju same**. Zato se u probnom periodu ne otvara glasanje.
2. **„Ne odgovarajte" / Reply-To.**
   - Bez `ReplyTo` u ovoj izmjeni. Postaviti predsjednikovu adresu bi otkrilo njegov lični e-mail svim primaocima. Tekst probne poruke već kaže „ne odgovarajte".
   - Preporuka van koda: Cloudflare Email Routing za `noreply@` (ili `kontakt@`) prema vašem Gmail-u. Tako odgovori ne odbijaju (bounce), a DMARC izvještaji imaju gdje da stignu.
   - Kasnije se može dodati `MAILJET_REPLY_TO` (P6).
3. **Mailjet besplatni plan: 200 dnevno i 6.000 mjesečno.**
   - `openVoting` (`meetings.ts:935-958`) šalje sekvencijalno, jedan HTTP poziv po glasaču, poslije transakcije. Rizik 1: ZEV sa više od 200 glasača probija dnevni limit, ostatak je `FAILED` i nema automatskog ponovnog slanja.
   - Rizik 2: 100+ uzastopnih poziva (oko 0,3–0,5 s svaki) može prekoračiti vremenski limit Vercel funkcije. Pošto se red upisuje tek u petlji, nedovršeni glasači ostaju **bez reda u outbox-u**.
   - Van obima ovog plana, ali treba zabilježiti. Kasnije rješenje: grupno slanje (Mailjet v3.1 prima do 50 poruka po pozivu) ili red sa worker-om.
   - Za sada: kod prvog stvarnog glasanja provjeriti broj primalaca i „Poslate poruke".
   - Provjeriti i da li besplatni plan dodaje Mailjet oznaku u podnožje i da li je nalog još „under review". Novi Mailjet nalozi u tom stanju mogu zadržavati prve poruke.
4. **DNS kontrolna lista (Cloudflare), za korisnika:**
   - **SPF**: tačno jedan TXT na `zevupravnik.com`: `v=spf1 include:spf.mailjet.com ~all`. Ako postoji i drugi (npr. Cloudflare Email Routing), sve ide u **jedan** zapis sa više `include:`.
   - **DKIM**: TXT `mailjet._domainkey` (vrijednost iz Mailjet-a).
   - **DMARC**: TXT `_dmarc`: `v=DMARC1; p=none; rua=mailto:dmarc@zevupravnik.com`. Poslije 2–4 sedmice čistih izvještaja preći na `p=quarantine`.
   - Svi zapisi „DNS only" (siva oblačić). TXT se ionako ne proksira, ali eventualni CNAME za praćenje mora biti DNS only.
   - U Mailjet-u: domen ima zeleno „SPF/DKIM authenticated", a `MAILJET_FROM_EMAIL` je na tom domenu.
   - Provjera: Gmail → „Prikaži original" mora pokazati SPF/DKIM/DMARC **PASS**. Dodatno mail-tester.com (cilj 9/10 ili više).
5. **Vercel**: env varijable se postavljaju za Production (po potrebi i Preview) i traže **redeploy** da počnu da važe. Promjena env varijable sama ništa ne mijenja u već pokrenutom deploy-u.

### Preporučeni redoslijed pokretanja
1. Deploy ove verzije sa `EMAIL_PROVIDER=mock` (stanje kao sada). Probna kartica pokazuje „Simulacija", a red se vidi u „Poslate poruke".
2. DNS kontrolna lista i Mailjet domen zelen.
3. U Vercel Production postaviti `MAILJET_API_KEY/SECRET`, `MAILJET_FROM_EMAIL=noreply@zevupravnik.com`, `MAILJET_FROM_NAME="ZEV upravnik"`, `EMAIL_RECIPIENT_ALLOWLIST=<vaša adresa>`, `EMAIL_PROVIDER=mailjet`. Redeploy.
4. „Pošalji na moju adresu": provjeriti prijem, ime pošiljaoca i SPF/DKIM/DMARC PASS. Zatim „Pošalji na drugu adresu" na adresu van liste i potvrditi da je blokirana sa jasnom porukom.
5. Ukloniti `EMAIL_RECIPIENT_ALLOWLIST`, redeploy. Jedna probna poruka na Gmail i jedna na Outlook/Hotmail.
6. Tek onda prvo stvarno glasanje, uz pregled „Poslate poruke" odmah poslije otvaranja.

## Testovi

Vitest, prava test baza, `fetch` mock-ovan, env se čuva i vraća u `afterEach` kao u `mailjetEmail.test.ts:16-33`.

**`tests/mailjetEmail.test.ts` (dopuna)**
- `From.Name` je „ZEV upravnik" kad `MAILJET_FROM_NAME` nije postavljen. Vrijednost iz env-a kad jeste. `fromName` iz poruke ima prednost.
- `sanitizeFromName` uklanja `"\r\n<>` i reže na 70 znakova.
- Greška na vrhu tijela (`{ ErrorMessage: "API key authentication/authorization failure", StatusCode: 401 }`, HTTP 401) daje `error` koji sadrži taj tekst, a ne samo „HTTP 401".
- Greška neovjerenog pošiljaoca u `Messages[0].Errors` se prenosi u `error`.

**`tests/providers.test.ts` (dopuna)**
- `describeEmailProvider()` za mock vraća `{kind:"mock", configured:true}`. Za mailjet bez ključa vraća `configured:false`. **Rezultat ne sadrži vrijednost ključa ni secret-a** (`JSON.stringify` ne sadrži `"test-key"`/`"test-secret"`).

**Novi `tests/emailTest.test.ts`** (`createFixture`, `createSuperAdminActor`)
- Predsjednik, „self": nastaje `NotificationMessage` sa `template:"test-email"`, `toAddress` jednakim User.email predsjednika, `zevId` fixture-a, `status:"DELIVERED"` (mock) i `simulated:true`. Postoji audit `notification.test_email.send` sa `targetId` poruke.
- Tijelo sadrži `fixture.zev.legalName`, `http://localhost:3000` i „ne odgovarate". Ne sadrži `MAILJET_API_KEY`.
- Računovođa smije. `actorA` (OWNER) dobija `ForbiddenError`. Actor bez `zevId` dobija `ForbiddenError("Nalog nema aktivan ZEV.")`.
- Slobodna adresa: `"a@b.ba"` prolazi. `""`, `"nije-adresa"`, `"a@b.ba, c@d.ba"`, `"a@b.ba\nBcc: x@y.ba"` i adresa duža od 254 znaka bacaju grešku i **ne kreiraju red**.
- Limit: 5 slanja prolazi, šesto baca grešku sa „limit" i piše audit `notification.test_email.rate_limited`. Drugi korisnik istog ZEV-a i dalje smije (granica po korisniku). Opcioni test za 20 po ZEV-u.
- Mailjet režim (`EMAIL_PROVIDER="mailjet"`, env postavljen, `fetch` vraća grešku pošiljaoca): `ok:false`, `error` sadrži tekst Mailjet-a, red je `FAILED` i ima **`lastError` popunjen** (regresija za R2).
- Mailjet uspjeh: `fetch` je pozvan sa `From.Name` koji sadrži naziv ZEV-a (R1 C).
- Super admin: `adminSendTestEmail` pravi red sa `zevId: null`. `adminSendTestEmail` sa ZEV actor-om (bez `isSuperAdmin`) dobija `ForbiddenError`.
- Allowlist (ako P3 = da): adresa van liste daje `FAILED` sa porukom o probnom periodu i `fetch` **nije pozvan**. Adresa na listi prolazi.

**Regresija za ostale pošiljaoce**: postojeći `voting.test.ts`, `auth.test.ts` i `admin.test.ts` moraju proći bez izmjene, jer je mock podrazumijevan. Dodatno, password-reset u mailjet režimu dobija samo osnovno ime pošiljaoca (`zevId=null`).

**`tests/activity-catalog.test.ts`**: prolazi bez izmjene ako su obje akcije u katalogu.

**Živa provjera**
- `/podesavanja?tab=parametri` kao predsjednik, računovođa i vlasnik (kartica se ne vidi), te `/admin` kao super admin. Širine 1440px i 375px (§8.7).
- Mock režim: tekst „Simulacija", red u „Poslate poruke".
- Produkcija po redoslijedu iznad: prijem, ime pošiljaoca, PASS zaglavlja, prikaz greške (npr. privremeno pogrešan `MAILJET_FROM_EMAIL` daje Mailjet poruku u kartici i `lastError` u „Poslate poruke").

## Pravila projekta

- Logika je u `src/server/services/emailTest.ts`. Svaka izvezena funkcija počinje sa `requireRole`/`requireZev` ili `requireSuperAdmin`. Server akcije i stranice samo prosljeđuju.
- **Nema novog Prisma modela ni migracije.** Limit se računa iz `NotificationMessage`, a ime pošiljaoca iz postojećih `Zev.shortName/legalName`.
- UI tekst je na srpskom i ide kroz i18n. Nema `primary` ni `danger` dugmeta u novoj kartici. Nazivi env varijabli se ne pominju u UI-ju.
- Obavezan unos u `CHANGELOG.md` i podizanje verzije (P4).

## Koraci implementacije

1. `src/server/notifications/providers.ts`: `fromName?` u `EmailProvider.send`; `describeEmailProvider()` + tip `EmailProviderInfo`.
2. `src/server/notifications/mailjetEmail.ts`: `From.Name` (`MAILJET_FROM_NAME`, podrazumijevano „ZEV upravnik"), `sanitizeFromName`, `buildFromName`, parsiranje greške na vrhu tijela (`:78-80`).
3. `src/server/notifications/service.ts`: `lastError` za `ok:false` (`:75-83`); ime pošiljaoca po ZEV-u u `dispatchNotification`; `isRecipientAllowed` + `EMAIL_RECIPIENT_ALLOWLIST` (ako P3).
4. `src/server/services/emailTest.ts` (nov): `getTestEmailStatus`, `sendTestEmail`, `adminGetTestEmailStatus`, `adminSendTestEmail`, validacija, limit iz baze, tekst (R5), audit.
5. `src/lib/activity/catalog.ts`: `notification.test_email.send` i `notification.test_email.rate_limited` (SYSTEM).
6. `src/lib/i18n/sr-Latn.ts` (+ `en.ts`): grupa `emailTest.*`; opciono `auditAction.notification.test_email.*`.
7. `src/server/actions/notifications.ts` (nov): `sendTestEmailAction`, `adminSendTestEmailAction`.
8. `src/components/test-email-card.tsx` (nov): klijentska kartica (R6).
9. `src/app/(app)/podesavanja/page.tsx`: kartica u tabu Parametri umjesto/uz „Napomena o integracijama" (`:321-335`), učitavanje statusa u `Promise.all` (`:128`).
10. `src/app/admin/page.tsx`: kartica u desnoj koloni (ispod `:118-168`).
11. `src/app/(app)/podesavanja/poruke/page.tsx`: podnaslov prema provajderu (`:31`), `lastError` kod `FAILED` reda (`:47`).
12. `.env.example` (`:36-38`): `MAILJET_FROM_NAME`, `EMAIL_RECIPIENT_ALLOWLIST`. `README.md` (`:131-132`, `:201-212`): ime pošiljaoca, probna poruka, DNS lista, redoslijed pokretanja, limiti besplatnog plana.
13. Testovi: `tests/mailjetEmail.test.ts`, `tests/providers.test.ts`, nov `tests/emailTest.test.ts`. Pokrenuti cijeli `vitest`, `tsc` i `lint`.
14. `CHANGELOG.md` unos + podizanje verzije (poslije potvrde, P4) → 2.38.0.
15. Živa provjera (1440/375, mock), pa produkcija po redoslijedu pokretanja.

## Pitanja za korisnika

- **P1 — Ime pošiljaoca:**
  - A: samo globalno „ZEV upravnik".
  - B: samo naziv ZEV-a.
  - **C (preporuka): „ZEV upravnik – {skraćeni naziv ZEV-a}"**, a za poruke bez ZEV-a (reset lozinke) samo „ZEV upravnik".
  - D: posebno podešavanje po ZEV-u.
- **P2 — Ko smije slati probnu poruku:**
  - **Preporuka: predsjednik i računovođa u svom ZEV-u (tab Parametri) + super admin u `/admin`, obje opcije (sopstvena i upisana adresa) za sve njih.**
  - Alternativa: upisana adresa samo predsjedniku i super adminu, računovođi samo „moja adresa".
- **P3 — Lista dozvoljenih primalaca za probni period (`EMAIL_RECIPIENT_ALLOWLIST`):**
  - **Preporuka: da**. Mala izmjena, a sprečava da prvo uključenje Mailjet-a slučajno pošalje stvarne pozive svim vlasnicima.
  - Alternativa: ne. Tada samo pazite da u probnom periodu niko ne otvara glasanje ni ne kreira naloge.
- **P4 — Verzija:** patch, minor ili major? **Preporuka: minor → 2.38.0** (nova funkcionalnost).
- **P5 — „Moja adresa" je:**
  - **Preporuka: e-mail za prijavu (User.email)**, jer on uvijek postoji, i za super admina.
  - Alternativa: kontakt e-mail iz „Moji podaci" (Party.email), koji može biti prazan ili drugačiji.
- **P6 — Reply-To:**
  - **Preporuka: bez Reply-To sada.** Tekst kaže „ne odgovarajte", a `noreply@` preusmjerite na svoj Gmail preko Cloudflare Email Routing-a.
  - Alternativa: nova varijabla `MAILJET_REPLY_TO` sa zajedničkom kontakt adresom.
- **P7 — Limiti probnih poruka:** **Preporuka: 5 na sat po korisniku i 20 dnevno po ZEV-u.** Može i strože, npr. 3 na sat.
