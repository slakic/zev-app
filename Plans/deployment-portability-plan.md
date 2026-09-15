# Prenosivost deployment-a (deployment portability) — smanjenje zavisnosti od Dockera — plan za pregled

**Status: PLAN NA ČEKANJU ODGOVORA KORISNIKA.**
Nastalo na zahtjev korisnika (2026-09-15), nakon prethodnog pitanja u istoj
konverzaciji: „how could I deploy this application to Vercel?". Zahtjev je
proširen sa „kako na Vercel" na **„kako učiniti aplikaciju konfigurabilno
prenosivom preko više okruženja — Docker self-host (kao danas), Vercel, ili bilo
koji Node hosting — bez izmjene koda, samo promjenom konfiguracije"**. Izrađeno
kroz plansku analizu (Opus model, plan-only prolaz — metodologija u skill-u
`opus-plan-sonnet-code`), zasnovano na stvarnom čitanju koda projekta.

## Odluke korisnika

**N/A — čeka odgovore na pitanja iz §11.** Nijedna odluka još nije donesena;
sekcije ispod nose preporuke, ne odluke. Nekoliko preporuka (posebno §3.5, §4
i §12 raspored faza) mijenja oblik u zavisnosti od odgovora na P1, P2 i P6.

---

## 0. Rezime — pročitati prije ostatka

Aplikacija je **bliže prenosivosti nego što se očekuje**, i to nije slučajno:
`src/lib/prisma.ts:6-11` već koristi `PrismaPg` driver adapter (nema native Rust
engine binarnih fajlova), sesije su u bazi (`Session` tabela +
JWT cookie, `src/server/auth/session.ts:36-58`), nema `middleware.ts`, nema
`instrumentation.ts`, nema edge runtime-a, nema nijednog `setInterval`/cron-a, i
nema in-memory state-a koji bi preživljavao između zahtjeva (jedini modul-level
`globalThis` je Prisma keš, `src/lib/prisma.ts:4`, koji je po dizajnu per-instance).

Ono što **jeste** vezano za Docker svodi se na **četiri stvarna problema i jedan
proceduralni**, i samo prvi je pravi blokator:

1. **Lokalni fajlsistem kao skladište** — i to na **dva mjesta**, ne jednom.
   Pored `documents.ts` (generisani PDF-ovi), tu je i
   `src/server/services/attachments.ts` (korisnički uploadi: dokazi o
   vlasništvu, skenirane saglasnosti). Druga grupa je **nereproducibilna** —
   ako se izgubi, nema je odakle vratiti. Ovo je jedini nalaz koji zaista
   sprečava deployment na platformu sa efemernim fajlsistemom.
2. **Apsolutne putanje u bazi.** `Document.filePath` (`prisma/schema.prisma:1412`)
   i `Attachment.filePath` (`:1435`) čuvaju `/app/var/storage/...` — pun rezultat
   `path.join(process.cwd(), …)`. Redovi baze su time vezani za konkretan
   radni direktorijum procesa, ne samo za konkretnu mašinu.
3. **Fontovi se čitaju sirovom `fs` putanjom** (`documents.ts:27-28`) — ne kroz
   modulni graf, pa ih automatsko praćenje fajlova (Next output tracing) ne
   vidi. Tihi izostanak iz bundle-a → PDF generisanje pada u runtime-u, ne u
   build-u.
4. **Migracije i seed žive isključivo u `docker-entrypoint.sh`.** Platforma bez
   custom entrypoint-a ih nikad ne pokrene.
5. *(proceduralno)* **Nema validacije konfiguracije.** `APP_URL` tiho pada
   nazad na `http://localhost:3000` na tri mjesta (`meetings.ts:318`, `:504`,
   `zaboravljena-lozinka/page.tsx:15`) — pogrešan deployment ne pukne, nego
   generiše QR kodove i linkove za reset lozinke koji vode u prazno.

**Preporuka u jednoj rečenici:** uvesti tanak `StorageAdapter` sloj sa
`local` backend-om kao podrazumijevanim (tačno današnje ponašanje, zero-config
za Docker) i `s3` backend-om kao alternativom, izabranom **ortogonalnom** env
varijablom po već postojećem `EMAIL_PROVIDER` obrascu — bez „magičnog"
`DEPLOYMENT_TARGET` preseta — plus izdvojiti migracije iz entrypoint-a u
eksplicitan, dokumentovan korak koji entrypoint *poziva*, umjesto da ga *sadrži*.

**Usput otkriven bag koji nema veze sa prenosivošću, ali ga ovaj posao mora
dodirnuti** — vidi §8.1: upload veći od 1 MB danas pada **i u Dockeru**.

---

## 1. Inventar zavisnosti od Dockera — sa dokazima iz koda

### 1.1 Skladište fajlova — dva potrošača, ne jedan

| Potrošač | Piše | Čita | Priroda podataka |
|---|---|---|---|
| `src/server/services/documents.ts` | `:121-122` (`fs.writeFileSync`) | `:180` (`fs.readFileSync`) | Generisani PDF-ovi — **reproducibilni iz baze** |
| `src/server/services/attachments.ts` | `:71-77` (`stageFile`) | `:186` | Korisnički uploadi — **nereproducibilni** |

Oba koriste identičan `storageDir()` obrazac (`documents.ts:30-34`,
`attachments.ts:64-68`), oba `path.join(process.cwd(), process.env.STORAGE_DIR ?? "./var/storage", …)`.

Dodatno, tri rute čitaju `filePath` **direktno**, zaobilazeći servisni sloj:

- `src/app/api/izvjestaji/pdf/route.ts:18` — `const fs = await import("node:fs"); fs.readFileSync(stored.filePath)`
- `src/app/api/izvjestaji/dugovanja/route.ts:19` — isto
- (`src/app/api/dokumenti/[id]/route.ts` i `src/app/api/prilozi/[id]/route.ts` **ne** zaobilaze — pozivaju `readDocumentFile`/`readAttachmentFile`, što je ispravno.)

**Posljedica po plan:** ta dva `route.ts` fajla moraju se prvo *ispraviti* da idu
kroz servis, prije nego što adapter uopšte može biti jedina tačka pristupa.
`generateFinancialReportPdf` i `generateOwnerDebtReportPdf` ionako već vraćaju
`Document` red — dovoljno je pozvati `readDocumentFile(actor, doc.id)`, kao što
`src/app/api/dokumenti/kartica/[partyId]/route.ts:12-13` već radi.

`ARCHITECTURE.md:97-99` eksplicitno dokumentuje da backup procedura zahtijeva
i `pg_restore` **i** ručno vraćanje `var/storage` — dva odvojena artefakta koja
mogu ispasti iz sinhronizacije.

**Odvojena napomena:** `Plans/gmail-bank-statement-ingestion-plan.md:357` planira
**treći** potrošač (`IncomingStatement.filePath`, „pod `STORAGE_DIR` kao u
`attachments.ts:65`"). Ako se taj plan implementira prije ovog, dobija se treći
poziv istog obrasca koji treba naknadno prepravljati. Ovo je argument za
redoslijed — vidi §12.

### 1.2 Apsolutne putanje u bazi

`storageDir()` na oba mjesta prefiksira sa `process.cwd()`, pa `filePath`
u bazi izgleda kao `/app/var/storage/documents/RN-2026-0001_v1.pdf`.

Ovo znači da **čak i migracija sa Dockera na običan Node hosting sa perzistentnim
diskom** (bez ikakvog object storage-a) razbija sve postojeće redove, jer se
`cwd` mijenja sa `/app` na nešto drugo. Prenosivost nije samo pitanje serverless
platformi.

`tests/documents-audit.test.ts:29,31,43,44` direktno provjerava
`fs.existsSync(doc.filePath)` — dakle testovi kodiraju tu istu pretpostavku i
moraće se prilagoditi (§9).

### 1.3 Upis fajla unutar DB transakcije

```
src/server/services/ownership.ts:131-137   prisma.$transaction(async (tx) => { … createLinkedAttachmentTx(tx, …) })
src/server/services/evoteConsent.ts:34-39  isti obrazac
```

`createLinkedAttachmentTx` (`attachments.ts:82`) zove `stageFile()` — sinhroni
`fs.writeFileSync` — dok je DB transakcija otvorena. Sa lokalnim diskom to je
mikrosekunda. Sa S3 PUT-om to je mrežni round-trip (desetine do stotine ms) sa
otvorenom transakcijom, što na pooled konekciji (§6) postaje stvaran izvor
zaglavljivanja.

**Bitno:** današnji kod **već** ostavlja siroče na disku ako se transakcija
rollback-uje (fajl je upisan prije `tx.attachment.create`). Nova arhitektura to
ne pogoršava, ali je prilika da se to eksplicitno adresira.

### 1.4 Fontovi preko sirove `fs` putanje

```
documents.ts:27  const FONT_REG  = path.join(process.cwd(), "assets/fonts/DejaVuSans.ttf");
documents.ts:28  const FONT_BOLD = path.join(process.cwd(), "assets/fonts/DejaVuSans-Bold.ttf");
```

`assets/` nije u `.dockerignore`, pa Docker build to kopira (`Dockerfile:17` —
`COPY . .`) i sve radi. Ali nijedan `import`/`require` ne pokazuje na te fajlove,
pa ih Next-ov output tracing **ne može** otkriti. Na platformi koja pakuje samo
praćene fajlove, `pdfkit.registerFont` puca u runtime-u — i to ne pri startu, nego
tek pri prvom generisanju PDF-a, dakle **poslije uspješnog deploy-a**.

Fontovi su 1.4 MB ukupno (`DejaVuSans.ttf` 759 KB, `DejaVuSans-Bold.ttf` 709 KB) —
veličina je relevantna za jednu od opcija u §4.

### 1.5 Migracije i seed samo u entrypoint-u

`docker-entrypoint.sh` radi četiri stvari, nijednu od kojih druga platforma neće:

| Linija | Radnja | Van Dockera |
|---|---|---|
| `:6-25` | wait-for-postgres petlja (60×2s) | Nepotrebno na managed bazi; `depends_on: service_healthy` (`docker-compose.yml:25-27`) to ionako već pokriva |
| `:27-28` | `node scripts/migrate.mjs apply` | **Ne izvršava se** |
| `:30-33` | opcioni `npx tsx prisma/seed.ts` uz `SEED_ON_START=1` | **Ne izvršava se**; `npx tsx` zahtijeva devDependency |
| `:36` | `exec npm start` | Platforma to radi sama |

Dodatno: `scripts/migrate.mjs` zavisi od `@prisma/schema-engine-wasm`, koji je
**devDependency** (`package.json`). U Docker slici to nije problem (`npm ci` bez
`--omit=dev`, `Dockerfile:11`), ali svaka platforma koja radi production install
neće imati taj paket u runtime-u — što je argument da migracija **ne smije** biti
runtime korak izvan Dockera.

### 1.6 Baza — šta je već dobro, a šta nedostaje

Dobro: `PrismaPg` driver adapter (`src/lib/prisma.ts:6-9`) znači da nema
preuzimanja native engine-a ni pri build-u ni pri startu — ovo je jedna od
najčešćih prepreka za Prisma na serverless platformama i ovdje **ne postoji**.
`Dockerfile:21` čak build-uje sa lažnim `DATABASE_URL` bez ikakvog pristupa bazi.

Nedostaje:
- `PrismaPg` se konstruiše samo sa `connectionString` — nema kontrole nad
  veličinom pool-a. Podrazumijevani `pg` Pool je `max: 10` **po instanci**. U
  Dockeru je to jedna instanca = 10 konekcija. Na serverless platformi je to
  10 × broj istovremenih instanci → iscrpljivanje konekcija.
- `globalForPrisma` keš (`src/lib/prisma.ts:15`) se namjerno **ne** koristi u
  produkciji. To je ispravno za Docker, ali znači da ne postoji nijedan
  mehanizam za dijeljenje klijenta ako bi build sistem ikad radio više
  evaluacija modula.
- `MIGRATE_DATABASE_URL` **već postoji** (`scripts/migrate.mjs:34`:
  `process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL`) i već se
  koristi u testovima (`tests/global-setup.ts:11`). Pola posla za razdvajanje
  pooled runtime URL-a od direktnog migracionog URL-a je urađeno — samo nije
  dokumentovano u `.env.example`.

### 1.7 Šta je provjereno i NIJE problem

| Provjera | Nalaz |
|---|---|
| Middleware / edge runtime | `find src -name "middleware*"` → prazno. Nema. |
| `instrumentation.ts` | Nema. |
| `export const runtime/dynamic/revalidate` | Nijedan fajl ih ne izvozi — sve rute su podrazumijevano dinamičke zbog cookie auth-a, što `Dockerfile:19-21` i eksplicitno tvrdi u komentaru. |
| In-memory state između zahtjeva | Nema. Sve `new Map`/`new Set` su lokalne unutar funkcija ili React state. |
| Pozadinski poslovi | Nema `setInterval`, cron, bullmq. Potvrđeno grep-om. `Plans/gmail-bank-statement-ingestion-plan.md:80` to i konstatuje („nema nijednog mehanizma za zakazivanje"). |
| Sesije | DB-backed (`Session` tabela) + `jose` JWT u httpOnly cookie-ju. Nema server-side session store-a u memoriji. Prenosivo. |
| Hardkodovani portovi u `src/` | Nema. `PORT`/`HOSTNAME` se postavljaju samo u `Dockerfile:28-29`, a `next start` ih čita iz okruženja. |
| Pristup drugim kontejnerima po imenu servisa | Samo `docker-compose.yml:29` (`@db:5432`) — to je konfiguracija, ne kod. |
| CORS / origin pretpostavke | Nema CORS konfiguracije; sve je same-origin. `sameSite: "lax"`, `secure: NODE_ENV === "production"` (`session.ts:53-55`) — ispravno za HTTPS platforme. |
| `pdf-parse` self-test na importu | Već zaobiđeno (`bankStatementPdf.ts:19` importuje `pdf-parse/lib/pdf-parse.js` umjesto korijena, uz komentar `:16-18`). Ovo bi inače bila klasična prepreka za file tracing. |

### 1.8 Sitniji nalazi

- **Nema health endpoint-a.** `find src/app/api -name route.ts` daje 7 ruta,
  nijedna nije health. `docker-compose.yml` ima healthcheck samo za `db`
  (`:14-19`), ne i za `app`. Većina PaaS platformi očekuje health probe.
- **Nema `engines` polja** u `package.json`. Platforme koje biraju Node verziju
  iz `engines` će uzeti svoju podrazumijevanu. Docker je zaključan na
  `node:22-alpine` (`Dockerfile:6`) — nema garancije da će druga platforma
  koristiti isto.
- **Nema CI-ja** (`.github` ne postoji) i nema `postinstall: prisma generate`.
  `src/generated/prisma` mora biti komitovan da bi git-based build igdje radio.
  *(Napomena: git stanje u ovom sandbox-u sadrži samo 16 praćenih fajlova —
  početni scaffold — pa ovo nisam mogao potvrditi kroz `git ls-files`. Potvrdio
  sam indirektno: `.gitignore` ne isključuje ni `src/generated` ni `assets/`.)*
- **`APP_URL` tiho pada na localhost** — `meetings.ts:318`, `meetings.ts:504`
  (QR kodovi za prisustvo / glasanje), `zaboravljena-lozinka/page.tsx:15`
  (link za reset lozinke). Pogrešna konfiguracija ne pukne nego proizvede
  neispravne linkove.
- **`next.config.ts` je prazan** — nema nijedne opcije. To je i prilika (nema
  šta da se pokvari) i uzrok baga iz §8.1.

---

## 2. Oblik konfiguracije — jedan `DEPLOYMENT_TARGET` ili nezavisne varijable?

Ovo je prva i najvažnija arhitektonska odluka jer određuje oblik svega ostalog.

### Razmotrene opcije

| # | Opcija | Za | Protiv | Ocjena |
|---|---|---|---|---|
| A | Jedna varijabla `DEPLOYMENT_TARGET=docker\|vercel\|generic` koja bira paket podešavanja | Jedan potez za korisnika; „radi odmah" | **Magično**: iz `DEPLOYMENT_TARGET=vercel` se ne vidi da je storage sad S3 dok se ne pročita izvorni kod. Neriješivo pitanje prioriteta („target=vercel ali STORAGE_BACKEND=local — ko pobjeđuje?"). Preseti trunu kad se platforma promijeni. Debug je gori, ne bolji. | ✗ |
| B | Nezavisne, ortogonalne varijable: `STORAGE_BACKEND`, `DB_POOL_MAX`, … | Svaka varijabla znači tačno jednu stvar; log ispiše šta je aktivno; **slijedi već postojeći obrazac** `EMAIL_PROVIDER`/`VIBER_PROVIDER` (`providers.ts:71-95`) | Više varijabli za podesiti pri deployment-u na novu platformu | **✓ preporuka** |
| C | B + `DEPLOYMENT_TARGET` **isključivo kao savjetodavna dijagnostika** (ne mijenja ponašanje, samo upozorava na nekonzistentnu kombinaciju) | Zadržava „jedan potez" ergonomiju bez skrivenog ponašanja | Još jedna varijabla; korist je ograničena na startni log | Vrijedi razmotriti kao dodatak uz B (P6) |

### Preporuka: opcija B, uz obrazloženje iz koda, ne iz ukusa

`getEmailProvider()`/`getViberProvider()` (`providers.ts:71-95`) su **već** tačno
taj obrazac: `switch` po env varijabli, `?? "mock"` kao podrazumijevana vrijednost,
i `throw` sa jasnom porukom za nepoznatu vrijednost. Projekat već ima ustaljen
način da radi ovu stvar. Uvođenje `DEPLOYMENT_TARGET` preseta bi bio **drugi,
paralelni** mehanizam konfiguracije pored postojećeg — što je gore od bilo koje
od dvije opcije samostalno.

Dodatno, `EMAIL_PROVIDER` i `STORAGE_BACKEND` su zaista nezavisni: neko može
raditi Docker self-host **sa** S3 (npr. MinIO ili R2 za backup-friendly storage),
ili serverless **sa** mock notifikacijama. Preseti bi tu kombinatoriku razbili.

### Centralna tačka: `src/lib/env.ts`

Sve nove opcije treba da prolaze kroz **jedan** modul koji ih validira **pri
prvom pristupu** i pukne sa razumljivom porukom na sr-Latn. `zod` je već
zavisnost (`package.json`, `zod@^4.4.3`), pa nema nove biblioteke.

Ovo rješava i §1.8 problem tihog `APP_URL` fallback-a: umjesto
`process.env.APP_URL ?? "http://localhost:3000"` razasutog na tri mjesta,
`env.APP_URL` je obavezan u produkciji, a podrazumijevan samo kad
`NODE_ENV !== "production"`.

**Šta `env.ts` NE smije da radi:** ne smije biti importovan iz client komponenti
(zahtijeva `import "server-only"`), i ne smije se evaluirati pri build-u na način
koji bi zahtijevao stvarne vrijednosti — `Dockerfile:21` build-uje sa lažnim
`DATABASE_URL`, i to mora ostati moguće. Rješenje: lijena (memoizovana)
validacija na prvi pristup, ne top-level `parse()`.

---

## 3. Storage adapter — dizajn

### 3.1 Interfejs

Predlog: `src/server/storage/` (nov direktorijum, ogledalo strukture
`src/server/notifications/`, koji je već presedan za „provider iza env varijable").

```
src/server/storage/
  index.ts        getStorage() — switch po STORAGE_BACKEND, memoizovan
  types.ts        StorageAdapter interfejs + StorageObject tip
  local.ts        LocalStorageAdapter (današnje ponašanje)
  s3.ts           S3StorageAdapter (uslovno — vidi §3.5 i P2)
```

Minimalan interfejs, izveden iz onoga što kod **stvarno** radi (ne špekulativno):

| Metoda | Zašto postoji | Ko je zove danas |
|---|---|---|
| `put(key, buffer, opts?)` | jedini oblik upisa u kodu | `documents.ts:122`, `attachments.ts:75` |
| `get(key)` → `Buffer` | jedini oblik čitanja | `documents.ts:180`, `attachments.ts:186` |
| `delete(key)` | **ne postoji nijedan pozivalac danas** | — |
| `exists(key)` | koriste samo testovi | `documents-audit.test.ts:29,43` |

**Preporuka:** implementirati sve četiri, ali biti svjestan da su `delete` i
`exists` tu za testove i buduću upotrebu, ne zato što ih aplikacija treba.
`delete` posebno: `Document` je po dizajnu **nepromjenljiv i verzionisan**
(`documents.ts:1-2` komentar, `schema.prisma:1419` unique na `[zevId, type, number, version]`)
— brisanje bi bilo pogrešno izlagati servisnom sloju. Držati ga za alat za
čišćenje siročadi (§3.3), ne za domenski kod.

Namjerno **NE** u interfejsu:
- `getSignedUrl()` / redirect na presigned URL. Djeluje privlačno (rasterećuje
  aplikaciju od streamovanja bajtova), ali **razbija autorizaciju**:
  `readAttachmentFile` (`attachments.ts:165-186`) i `readDocumentFile`
  (`documents.ts:159-181`) sprovode netrivijalnu kontrolu pristupa po vlasništvu
  udjela i po `publishedToOwners`. Presigned URL je bearer token koji izlazi iz
  domena te kontrole. Ako se ikad uvede, mora biti kratkotrajan i to je zasebna
  odluka. Van obima.
- `list()`. Nijedan kod ne pretražuje storage — baza je indeks. Ne uvoditi.
- Streaming. Limit je 15 MB (`attachments.ts:37`), sve staje u memoriju, a rute
  ionako već grade `new Uint8Array(buffer)`.

### 3.2 Ključ umjesto putanje — i šta sa postojećim redovima

Adapter mora raditi sa **ključem** (`documents/RN-2026-0001_v1.pdf`), ne sa
apsolutnom putanjom. Postojeći redovi imaju apsolutne putanje (§1.2).

| # | Opcija | Za | Protiv | Ocjena |
|---|---|---|---|---|
| A | Zadržati kolonu `filePath`, promijeniti značenje na „ključ"; **pri čitanju**: ako vrijednost počinje sa `/`, tretirati je kao naslijeđenu apsolutnu putanju i čitati sa lokalnog diska | Nula migracija podataka; postojeći Docker deployment nastavlja raditi netaknut; novi redovi su prenosivi | Kolona ima dva značenja neko vrijeme; naslijeđeni redovi ostaju vezani za lokalni disk zauvijek dok se ne migriraju | **✓ preporuka za Fazu 1** |
| B | Nove kolone `storageKey` + `storageBackend`, backfill migracija, `filePath` se kasnije ukida | Čisto, eksplicitno, podržava više backend-a istovremeno | Migracija šeme + backfill + dupla logika u prelaznom periodu; `storageBackend` je potreban samo ako se backend-i miješaju (vidi P3) | Ako P3 kaže „da, ista baza služi obje platforme" |
| C | Jednokratna SQL migracija koja skida prefiks sa `filePath` | Jednostavno, jedan `UPDATE` | Nepovratno; oslanja se na to da je prefiks uvijek isti (jeste danas, ali `STORAGE_DIR` je konfigurabilan pa nije garantovano); ne pomaže pri prelasku Docker→S3 jer fajlovi i dalje moraju biti prekopirani | Kao *opcioni* alat uz A, ne umjesto A |

**Preporuka: A**, sa `C` kao opcionim `scripts/`-alatom kasnije. Razlog je
konkretan: opcija A je jedina koja **garantuje** da postojeći Docker korisnik ne
mora ništa da uradi — što je izričit zahtjev („Docker ostaje prva/default opcija").

`sha256` postoji na oba modela (`schema.prisma:1413`, `:1436`) i može se
provjeriti pri čitanju — jeftino, i vrijedno kad podaci pređu preko mreže.
Preporuka: provjeravati i **logovati** neslaganje, ne bacati grešku (stari
`Attachment.sha256` je nullable, `:1436`).

### 3.3 Transakciona semantika (§1.3)

Preporuka: **izbaciti upis iz transakcije.**

Konkretno, razdvojiti `createLinkedAttachmentTx` na dva koraka:
1. `stageUpload(input)` → `{ key, sha256, size }` — radi `put()`, **prije**
   `prisma.$transaction`, u pozivaocima (`ownership.ts:131`, `evoteConsent.ts:34`).
2. `createLinkedAttachmentTx(tx, actor, staged, meta)` — samo DB upis.

Time transakcija nikad ne čeka mrežu. Semantika grešaka ostaje **ista kao danas**:
ako DB dio padne, objekat je siroče u storage-u — što se i sada dešava. Razlika
je da je sada eksplicitno i dokumentovano, i može se pokriti `scripts/`-alatom za
pronalaženje siročadi (objekti bez reda u bazi). Taj alat je opcion i može u
kasniju fazu.

**Alternativa koja se odbacuje:** upisati DB red prvo pa storage poslije. Gore —
proizvodi redove koji pokazuju na nepostojeće objekte, što je vidljivo korisniku
(pokvaren download) za razliku od siročeta, koje nije.

### 3.4 Nusprodukt koji treba popraviti usput

`src/app/api/dokumenti/kartica/[partyId]/route.ts:12-13` radi
`generateOwnerStatementPdf` → `readDocumentFile` — dakle **upiše pa odmah
pročita nazad**. Sa lokalnim diskom to je besplatno; sa S3 su to dva mrežna
poziva za bajtove koji su bili u memoriji prije milisekunde. Isti obrazac je i u
`izvjestaji/pdf/route.ts` i `izvjestaji/dugovanja/route.ts`.

Preporuka: `storeDocument` da vraća `{ row, buffer }`, pa rute koriste buffer koji
već imaju. To je i danas poboljšanje, a sa S3 postaje bitno.

### 3.5 Koji backend-i

| Backend | `STORAGE_BACKEND` | Napomena |
|---|---|---|
| Lokalni fajlsistem | `local` (**podrazumijevano**) | Tačno današnje ponašanje. Ako varijabla nije postavljena — kao danas. |
| S3-kompatibilan | `s3` | Jedan adapter pokriva AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces — sve preko `S3_ENDPOINT` + `S3_REGION` + `S3_BUCKET` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` + `S3_FORCE_PATH_STYLE` (potrebno za MinIO) |

**Vercel Blob je namjerno izostavljen** iz preporuke: nije S3-kompatibilan, ima
vlastiti SDK, i vezuje aplikaciju za jednu platformu — što je suprotno cilju
ovog poduhvata. Cloudflare R2 radi i sa Vercel-a i sa Dockera, preko istog S3
adaptera. Ovo je predmet pitanja P2.

**Nova zavisnost:** `@aws-sdk/client-s3` (+ `@aws-sdk/lib-storage` samo ako
zatreba multipart, što na 15 MB limitu ne treba). Ovo je **prva prava vanjska
integracija u projektu** — `Plans/gmail-bank-statement-ingestion-plan.md:86-96`
to konstatuje. Vrijedi razmisliti o lijenom `await import("./s3")` unutar
`getStorage()`, tako da Docker deployment nikad ne učita AWS SDK u memoriju.

---

## 4. Fontovi (§1.4)

### Razmotrene opcije

| # | Opcija | Za | Protiv | Ocjena |
|---|---|---|---|---|
| A | `outputFileTracingIncludes` u `next.config.ts` za `assets/fonts/**` | Nula izmjena runtime koda; nula troška za Docker; jedna linija konfiguracije | Next-specifično — ne pomaže hostingu koji sam pakuje; oslanja se na to da `process.cwd()` u runtime-u pokazuje na korijen projekta (tačno na Vercel-u, nije garantovano svugdje) | ✓ osnova |
| B | Centralizovan `src/server/pdf/fonts.ts` koji učita font u memoizovan `Buffer` i preda ga `registerFont(name, buffer)`; putanja preko `FONT_DIR` env sa današnjim default-om | Jedna tačka; `pdfkit` prima `Buffer` direktno; omogućava korisniku da nadjača lokaciju; može pući sa jasnom porukom pri startu umjesto kriptično pri prvom PDF-u | I dalje `fs` čitanje — sam po sebi ne rješava tracing | ✓ **uz A** |
| C | Base64-embed fonta u `.ts` modul | Radi na apsolutno svakoj platformi; tracing garantovan jer je to modul | ~1.9 MB base64 po fontu, ~3.8 MB ukupno u bundle-u; usporava build i parsiranje; ružno u repou | Rezerva ako neka ciljna platforma ignoriše tracing |
| D | Fontovi u object storage, dovlače se u runtime-u | Nema u bundle-u | Mrežni poziv na cold start prije prvog PDF-a; nova tačka otkaza za osnovnu funkciju; besmisleno za Docker | ✗ |
| E | Fontovi u `public/` | Djeluje očigledno | `public/` se servira kao statika i **ne** pakuje u serverless funkciju — `fs` čitanje bi puklo. Aktivno pogrešno. | ✗ |

### Preporuka: A + B zajedno

`outputFileTracingIncludes` rješava tracing; `fonts.ts` sa memoizovanim
`Buffer`-om i eksplicitnom greškom („Font `X` nije pronađen. Provjerite
`FONT_DIR` ili `outputFileTracingIncludes` u `next.config.ts`.") rješava
dijagnostiku. C ostaje dokumentovana rezerva, ne implementira se sada.

Dodatna korist od B: `renderPdf` (`documents.ts:39-50`) danas radi
`doc.registerFont("reg", FONT_REG)` pri **svakom** PDF-u — dakle `fs` čitanje po
dokumentu. Sa memoizovanim buffer-om to postaje jedno čitanje po instanci
procesa. Mala, ali stvarna optimizacija koja dolazi besplatno.

---

## 5. Migracije i seed (§1.5)

### Princip: entrypoint *poziva* korake, ne *sadrži* ih

| Korak | Danas | Predlog |
|---|---|---|
| Primjena migracija | `docker-entrypoint.sh:28` inline | `npm run db:migrate` (**već postoji**, `package.json`) — entrypoint samo poziva skriptu |
| Seed | `docker-entrypoint.sh:32` inline `npx tsx` | `npm run db:seed` (**već postoji**) |
| Čekanje na bazu | `docker-entrypoint.sh:6-25` inline Node heredoc | Zadržati, ali izdvojiti u `scripts/wait-for-db.mjs` (ili obrisati — `docker-compose.yml:25-27` već čeka `service_healthy`) |

Time se `docker-entrypoint.sh` svodi na tri poziva npm skripti, a **iste te
skripte** korisnik ili CI pokreće ručno na platformi bez entrypoint-a. Nula
duplirane logike.

### Dokumentovan deployment redoslijed za platforme bez entrypoint-a

```
1. (lokalno ili u CI, protiv produkcione baze)  npm run db:migrate
2. deploy aplikacije
```

Migracija **prije** deploy-a, ne poslije — jer nova verzija koda očekuje novu
šemu. Ovo zahtijeva da migracije budu unazad kompatibilne sa **prethodnom**
verzijom koda tokom prozora između koraka 1 i 2, što je standardno pravilo i
treba ga zapisati u README.

**Zašto ne migrirati u build koraku platforme:** `scripts/migrate.mjs` traži
`@prisma/schema-engine-wasm` (devDependency — dostupan pri build-u, ali ne u
production install-u), i, važnije, build se dešava i za preview/branch
deployment-e. Automatska migracija u build-u znači da PR preview može
migrirati **produkcionu** bazu. Ne raditi to.

**Napomena o `SEED_ON_START`:** ostaje kakav jeste za Docker (idempotentan je —
`docker-compose.yml:36` komentar to i tvrdi). Van Dockera se prosto ne postavlja.

---

## 6. Baza — pooling i URL-ovi (§1.6)

### Razmotrene opcije za pooling

| # | Opcija | Za | Protiv | Ocjena |
|---|---|---|---|---|
| A | Ne dirati; osloniti se na to da korisnik stavi pooler URL (PgBouncer / Neon / Supabase pooler) u `DATABASE_URL` | Nula koda; standardan Prisma+serverless obrazac | Ne postoji način da se veličina pool-a smanji po instanci; korisnik mora znati da mu treba pooler | Nedovoljno samo |
| B | `DB_POOL_MAX` env → `PrismaPg({ connectionString, max })` | Jedna linija u `src/lib/prisma.ts`; direktno rješava umnožavanje konekcija po instanci; podrazumijevana vrijednost = današnje ponašanje | Ne zamjenjuje pravi pooler pri visokoj konkurentnosti | **✓ preporuka** |
| C | Dokumentovati `DIRECT_DATABASE_URL` za migracije nasuprot pooled `DATABASE_URL` | Neophodno: PgBouncer u transaction mode-u ne podržava DDL/advisory lock-ove koje migracioni engine koristi | — | **✓ preporuka** — i **već postoji kao `MIGRATE_DATABASE_URL`** (`scripts/migrate.mjs:34`) |

### Preporuka: B + C

- `B`: dodati `max` (i eventualno `idleTimeoutMillis`) u `PrismaPg` poziv,
  čitano iz `env.ts`, sa podrazumijevanom vrijednošću koja daje **identično**
  ponašanje kao danas (tj. ne postavljati ništa ako varijabla nije zadata).
- `C`: **ne uvoditi novo ime.** `MIGRATE_DATABASE_URL` već radi tačno to i već
  se koristi (`tests/global-setup.ts:11`). Treba ga samo dodati u `.env.example`
  i README sa objašnjenjem kada je potreban. Uvođenje `DIRECT_DATABASE_URL` kao
  sinonima bi bilo čisto dupliranje.

---

## 7. Notifikacioni provajderi — potvrda obrasca

`providers.ts:71-95` je **već** tačan obrazac i ne treba ga mijenjati radi
prenosivosti. Interfejsi `EmailProvider`/`ViberProvider` (`:22-33`) su čisti,
`SendResult` je platformski neutralan, i `service.ts:47` dispatch-uje kroz njih.

Jedina sitna primjedba koja je **relevantna za prenosivost**: `service.ts:45-46`
komentariše da bi „a real deployment would use a worker with retry/backoff", a
`retryFailed()` (`service.ts:101`) postoji ali **nema pozivaoca**. Na Docker-u bi
se to riješilo `setInterval`-om; na serverless platformi bi trebalo scheduler
(Vercel Cron). Pošto danas nema nijednog pozivaoca, **ovo ostaje van obima** —
ali treba biti zapisano kao prva stvar koja će zahtijevati platform-specific
scheduler kad se uvede pravi email provajder (P4).

Isti zaključak važi i za `Plans/adhoc-fund-collection-plan.md` P9 (planirani
podsjetnici) i `Plans/gmail-bank-statement-ingestion-plan.md` Faza 3
(pozadinska provjera Gmail-a). Kad *bilo koji* od ta tri stigne, trebaće
apstrakcija zakazivanja — vjerovatno „HTTP endpoint zaštićen tajnom + platformski
scheduler koji ga zove", jer to radi i na Dockeru (cron u host sistemu) i na
Vercel-u (Vercel Cron) i svugdje drugdje. **Predložiti kao dizajn, ne graditi sada.**

---

## 8. Ostalo

### 8.1 Bag: limit veličine upload-a (nije vezan za prenosivost, ali blokira ovaj posao)

`attachments.ts:37` postavlja `MAX_SIZE_BYTES = 15 MB`. Upload ide kroz Server
Action (`src/app/(app)/dokumenti/page.tsx:16-24`, `formData.get("file")` →
`file.arrayBuffer()`). Next-ov podrazumijevani `experimental.serverActions.bodySizeLimit`
je **1 MB**, a `next.config.ts` je prazan.

**Posljedica: skenirani dokaz o vlasništvu veći od 1 MB danas pada i u Dockeru** —
sa Next-ovom greškom o body limitu, ne sa aplikativnom porukom iz `assertUploadable`.
Validaciju od 15 MB nikad ništa ne dosegne.

Treba potvrditi empirijski (nisam mogao pokrenuti build u ovom okruženju), ali
ako se potvrdi:
- postaviti `serverActions.bodySizeLimit` u `next.config.ts` da odgovara `MAX_SIZE_BYTES`;
- učiniti oba broja izvedenim iz **jedne** env varijable (`MAX_UPLOAD_MB`), jer
  platformski limiti variraju — Vercel serverless funkcije imaju tvrd limit od
  4.5 MB na tijelo zahtjeva koji aplikacija ne može podići. Na takvoj platformi
  korisnik postavi `MAX_UPLOAD_MB=4`, i aplikacija odbije prevelik fajl **svojom**
  porukom na sr-Latn umjesto platformskom greškom.

### 8.2 Health endpoint

Dodati `src/app/api/health/route.ts`: provjeri dohvatljivost baze (trivijalan
`SELECT 1`), dohvatljivost storage-a (opcionalno, iza flag-a — ne raditi S3
poziv na svaki health check), i vrati verziju iz `package.json`.

Korist na obje strane: `docker-compose.yml` dobija healthcheck za `app` servis
(danas ga nema), a svaka PaaS platforma dobija probe. Mora biti dostupan bez
autentikacije, i **ne smije** otkrivati detalje konekcije.

### 8.3 `engines` i `prisma generate`

Dodati `"engines": { "node": ">=22" }`. Trivijalno, i sprečava da platforma
izabere stariji Node od onog na kojem se testira (`Dockerfile:6`).

Za `prisma generate`:

| # | Opcija | Za | Protiv |
|---|---|---|---|
| A | Ostaviti kako jeste (komitovan `src/generated`, bez `postinstall`) | Build ne zahtijeva ništa; radi offline; radi na svakoj platformi | Programer mora zapamtiti da regeneriše |
| B | Dodati `postinstall: prisma generate` | Nemoguće zaboraviti | Trči na svakoj `npm install`, uključujući u build sandbox-u platforme; `provider = "prisma-client"` (`schema.prisma:6`) je čisto-TS generator pa **ne** treba mrežu ni engine — dakle rizik je manji nego što obično jeste, ali i dalje dodaje korak build-u koji trenutno ne postoji |
| C | A + provjera u testovima: regeneriši u temp i uporedi sa komitovanim | Hvata zaborav bez dodavanja build koraka | Zahtijeva CI, kojeg nema |

**Preporuka: A za sada**, uz izričitu napomenu u README. B je razuman kad se
uvede CI. Ovo je usput, ne srž ovog plana.

### 8.4 `maxDuration`

`generateFinancialReportPdf` (`documents.ts:802`) i `generateOwnerDebtReportPdf`
(`:940`) pokreću više agregatnih izvještaja pa render PDF-a. Na platformama sa
podrazumijevanim limitom od 10 s to može biti tijesno za veći ZEV.

`export const maxDuration = N` u odgovarajućim `route.ts` fajlovima je **no-op**
na Dockeru i poštuje se na Vercel-u — dakle besplatno za današnji tok. Vrijedno
dodati na dvije-tri najteže rute.

---

## 9. Da li ovo kvari postojeći Docker tok — i kako se testira

### Da li kvari: ne, ali pod tri uslova

1. **Svaka nova varijabla mora imati podrazumijevanu vrijednost jednaku
   današnjem ponašanju.** `STORAGE_BACKEND` neizostavljen → `local`.
   `STORAGE_DIR` neizostavljen → `./var/storage`. `DB_POOL_MAX` neizostavljen →
   ne prosljeđivati `max` uopšte. Praktičan test: **`docker compose up -d --build`
   sa nepromijenjenim `docker-compose.yml` mora raditi identično.**
2. **Naslijeđeni apsolutni `filePath`-ovi moraju ostati čitljivi** (§3.2, opcija A).
   Bez toga svaki postojeći Docker deployment gubi pristup svim dokumentima.
3. **`docker-entrypoint.sh` mora nastaviti da radi migracije i seed.** Refaktor
   iz §5 mijenja *gdje logika živi*, ne *šta se dešava* pri `docker compose up`.

Jedina izmjena koja **namjerno** mijenja postojeće ponašanje je §8.1 (limit
upload-a) — i to je ispravka baga, ne regresija.

### Kako se testira

| Šta | Kako |
|---|---|
| Docker default nepromijenjen | `docker compose up -d --build` bez ijedne izmjene u `docker-compose.yml`; upload dokaza o vlasništvu, generisanje PDF-a, `docker compose down && up` pa provjera da su fajlovi tu (volume `zev-storage`) |
| Naslijeđeni redovi | Pokrenuti stari deployment, generisati dokumente, pa nadograditi na novi kod bez ijedne nove env varijable → svi stari dokumenti se i dalje otvaraju |
| `local` adapter | Postojeći testovi (`tests/attachments.test.ts`, `tests/documents-audit.test.ts`) rade bez izmjene — osim asercija koje gledaju `fs.existsSync(doc.filePath)` (`documents-audit.test.ts:29,31,43,44`), koje treba prepisati na `storage.exists(key)` / `storage.get(key)`. **To je poželjno**: test postaje agnostičan na backend i time važi za oba. |
| `s3` adapter bez pravog naloga | MinIO kao servis u **odvojenom** compose fajlu (`docker-compose.test-s3.yml`), `S3_FORCE_PATH_STYLE=true`. Isti test suite se pokrene sa `STORAGE_BACKEND=s3` — dokazuje da su oba puta ekvivalentna. |
| Kontrakt adaptera | Jedan zajednički test fajl (`tests/storage-adapter.test.ts`) koji se parametrizuje po backend-u: put/get round-trip, get nepostojećeg ključa, sha256 podudaranje, ključ sa dijakritikom u imenu (`č`, `ž` — `stageFile` ih danas zamjenjuje sa `_`, `attachments.ts:73`, što treba zadržati) |
| Fontovi | `npm run build` pa provjera da traced izlaz sadrži oba `.ttf` fajla; plus test koji generiše PDF sa `č/ć/ž/š/đ` u tekstu i provjeri da nije prazan |
| Konfiguracija | Unit test za `env.ts`: nedostajuće obavezne varijable → jasna greška; podrazumijevane vrijednosti → današnje vrijednosti |

`tests/setup-env.ts:9` postavlja `STORAGE_DIR = "./var/test-storage"` — ostaje
kako jeste za `local` prolaz; za `s3` prolaz doda se `STORAGE_BACKEND=s3` +
MinIO parametri, uz čišćenje bucket-a u `tests/global-setup.ts`.

`vitest.config.ts` ima `fileParallelism: false`, pa nema trke oko dijeljenog
bucket-a — dobro.

---

## 10. Šta ovaj plan namjerno NE radi

- **Ne uklanja Docker.** `Dockerfile`, `docker-compose.yml` i
  `docker-entrypoint.sh` ostaju prva i podrazumijevana opcija u README.
- **Ne uvodi presigned URL-ove** (§3.1) — razbija postojeću autorizaciju.
- **Ne implementira prave email/Viber provajdere** (§7) — zaseban posao (P4).
- **Ne uvodi apstrakciju zakazivanja** — nema šta da se zakaže danas (§7).
- **Ne uvodi CDN, keširanje, ni `Cache-Control` promjene.** Rute svjesno šalju
  `private, no-store` (`api/dokumenti/[id]/route.ts:19`) — to je ispravno za
  dokumente sa kontrolom pristupa i ne dira se.
- **Ne migrira postojeće fajlove u object storage.** Ako korisnik pređe sa
  Dockera na S3, prenos postojećih fajlova je jednokratna operacija koja
  zaslužuje svoj `scripts/` alat — ali tek kad se zna da je stvarno potrebna (P3).
- **Ne dodaje CI.** Nekoliko preporuka (§8.3) bi bilo prirodnije uz CI, ali CI
  je zaseban poduhvat.
- **Ne mijenja `Document` verzionisanje ni nepromjenljivost.**

---

## 11. Pitanja za korisnika prije implementacije

**P1 — Da li je Vercel konkretan, blizak cilj, ili je ovo investicija u buduću
fleksibilnost?** Ovo najviše mijenja oblik plana. Ako je Vercel konkretan cilj u
narednim sedmicama, radi se sve iz §3-§8 i pravi se stvaran probni deployment.
Ako je „opšta fleksibilnost bez konkretnog drugog hostinga", preporučujem da se
uradi **samo** §3 (storage adapter) i §5 (izdvajanje migracija) — to su dvije
stvari koje su vrijedne same po sebi (backup, čistoća) čak i ako se nikad ne ode
sa Dockera; ostalo se odgađa dok se ne zna ciljna platforma.

**P2 — Koji object storage stvarno planiraš?** AWS S3, Cloudflare R2, MinIO
(self-host), ili nešto drugo? Ako je odgovor „ostajem na lokalnom fajlsistemu
zauvijek za Docker", onda `s3` adapter ne treba implementirati sada — dovoljno je
uvesti interfejs sa `local` implementacijom, što je i dalje korisno (§3.4,
uklanjanje direktnog `fs` pristupa iz ruta). Napominjem da **ne** preporučujem
Vercel Blob (§3.5) — ako ti je Vercel cilj, R2 ili S3 su bolji izbor jer ne
vezuju za platformu.

**P3 — Da li ista baza treba istovremeno da služi i Docker i serverless
deployment, ili je scenario „biraš jednu platformu"?** Ako je odgovor „istovremeno",
onda §3.2 mora ići na opciju B (zasebna `storageBackend` kolona po redu), što je
osjetno više posla. Ako je „biraš jednu", opcija A je dovoljna.

**P4 — Da li pravi email/Viber provajderi ulaze u ovaj poduhvat?** Preporuka je
**ne** — to je zaseban posao. Ali ako je plan da se aplikacija stavi na Vercel i
odmah šalje prave e-mailove, onda se §7 (i pitanje zakazivanja `retryFailed`)
vraća u obim.

**P5 — Da li potvrđuješ nalaz iz §8.1 (upload > 1 MB pada i danas)?** Konkretno:
da li si ikad uspješno uploadovao skenirani dokument veći od 1 MB kroz stranicu
`/dokumenti`? Ako jesi, moj zaključak je pogrešan i treba ga ponovo ispitati.
Ako nisi probao — vrijedi probati prije nego što se planira išta drugo, jer to
je bag koji pogađa i današnje korisnike.

**P6 — Nivo truda sada nasuprot kasnije.** Tri realne varijante:
- **(a) Samo blokator:** §3 (storage) + §4 (fontovi) + §5 (migracije). Aplikacija
  postaje tehnički deploy-abilna izvan Dockera.
- **(b) Blokator + higijena:** (a) + §2 (`env.ts` validacija) + §8.1 (upload limit)
  + §8.2 (health) + §8.3 (`engines`). Preporučujem ovo.
- **(c) Sve:** (b) + §6 (pooling) + §8.4 (`maxDuration`) + stvaran probni
  deployment na drugu platformu.

**P7 — Da li želiš `DEPLOYMENT_TARGET` kao savjetodavnu dijagnostiku** (§2,
opcija C) — varijablu koja **ne** mijenja ponašanje, nego pri startu ispiše
upozorenje ako je kombinacija besmislena (npr. `DEPLOYMENT_TARGET=serverless`
uz `STORAGE_BACKEND=local`)? Korisno, ali nije neophodno.

---

## 12. Fazni plan implementacije (za pregled — nije kod)

Redoslijed je vođen jednim praktičnim razlogom: `Plans/gmail-bank-statement-ingestion-plan.md:357`
planira **treći** potrošač `STORAGE_DIR` obrasca. Ako se Faza 1 uradi prije tog
plana, taj plan odmah koristi adapter umjesto da se naknadno prepravlja.

### Faza 0 — Priprema, bez promjene ponašanja *(mala)*

- Ispraviti `src/app/api/izvjestaji/pdf/route.ts:18` i
  `src/app/api/izvjestaji/dugovanja/route.ts:19` da idu kroz `readDocumentFile`
  umjesto direktnog `fs.readFileSync` — ili, bolje, da koriste buffer koji
  `storeDocument` već ima (§3.4).
- `storeDocument` (`documents.ts:95`) da vraća `{ row, buffer }`.
- Rezultat: **nijedno mjesto van `documents.ts`/`attachments.ts` ne dodiruje
  `filePath`.** Ovo je preduslov za sve ostalo.

### Faza 1 — `StorageAdapter` sa `local` backend-om *(srž)*

- Nov `src/server/storage/` (types, index, local) po §3.1.
- `documents.ts` i `attachments.ts` prelaze na `getStorage()`; `storageDir()`
  nestaje sa oba mjesta.
- `filePath` postaje ključ za nove redove; čitanje ostaje unazad kompatibilno za
  apsolutne putanje (§3.2, opcija A).
- Razdvajanje `stageUpload` / `createLinkedAttachmentTx` (§3.3); ažurirati
  pozivaoce u `ownership.ts:131` i `evoteConsent.ts:34`.
- `tests/storage-adapter.test.ts` (parametrizovan kontrakt-test);
  `tests/documents-audit.test.ts` prelazi sa `fs.existsSync` na adapter.
- **Docker ponašanje: identično, bez ijedne nove env varijable.**

### Faza 2 — Fontovi i konfiguracija *(mala-srednja)*

- `src/server/pdf/fonts.ts` sa memoizovanim `Buffer`-om i `FONT_DIR` overrideom (§4, B).
- `outputFileTracingIncludes` u `next.config.ts` (§4, A).
- `src/lib/env.ts` sa `zod` validacijom (§2); `APP_URL` prestaje da tiho pada na
  localhost u produkciji; tri pozivaoca (`meetings.ts:318`, `:504`,
  `zaboravljena-lozinka/page.tsx:15`) prelaze na `env.APP_URL`.
- `.env.example` dopunjen svim novim varijablama, sa `MIGRATE_DATABASE_URL` koji
  je do sada bio nedokumentovan (§6).

### Faza 3 — `s3` backend *(uslovno, po P2)*

- `src/server/storage/s3.ts`, lijeno importovan.
- `docker-compose.test-s3.yml` sa MinIO za testiranje.
- Kontrakt-test iz Faze 1 se pokreće i za `s3`.
- README: kako se konfiguriše R2 / S3 / MinIO.

### Faza 4 — Deployment procedura *(mala)*

- `docker-entrypoint.sh` refaktorisan da poziva npm skripte (§5); opciono
  `scripts/wait-for-db.mjs`.
- `src/app/api/health/route.ts` (§8.2); healthcheck za `app` u `docker-compose.yml`.
- `"engines"` u `package.json` (§8.3).
- `MAX_UPLOAD_MB` + `serverActions.bodySizeLimit` (§8.1).
- README: nova sekcija „Deployment na druge platforme" sa tabelom varijabli i
  eksplicitnim redoslijedom migracija.

### Faza 5 — Fino podešavanje *(uslovno, po P1 i P6)*

- `DB_POOL_MAX` (§6).
- `maxDuration` na teškim rutama (§8.4).
- Alat za pronalaženje siročadi u storage-u (§3.3).
- Stvaran probni deployment na ciljnu platformu i ispravke onoga što se pokaže.

### Uz svaku fazu (pravila projekta)

Svaka faza nosi **unos u `CHANGELOG.md`** i **podizanje verzije**, po konvenciji
opisanoj u `CHANGELOG.md` §„Verzionisanje" (minor je podrazumijevani korak; patch
za iteracije unutar istog nezavršenog posla; tip podizanja se **potvrđuje sa
korisnikom prije** nego što se uradi). Trenutna verzija je `2.7.0`.
Očekivanje: Faza 0 i Faza 1 zajedno su jedan minor sa patch iteracijama;
Faza 3 (nova vanjska zavisnost) vjerovatno zaslužuje svoj minor.

---

## 13. Rizici i ono što će zaboljeti u praksi

1. **Tihi gubitak dokumenata pri pogrešnoj konfiguraciji.** Ako neko postavi
   `STORAGE_BACKEND=s3` na postojećem Docker deployment-u bez prenošenja
   fajlova, novi dokumenti idu u S3, stari ostaju na disku, i sve *djeluje* da
   radi dok neko ne otvori stari dokument. Ublažavanje: unazad kompatibilno
   čitanje (§3.2 A) rješava tačno ovaj slučaj — stari apsolutni `filePath`-ovi se
   i dalje čitaju sa diska. Ali ako se pređe na platformu **bez** diska, ti fajlovi
   su nedostupni. **Ovo mora biti krupno napisano u README.**
2. **Fontovi pucaju tek poslije uspješnog deploy-a.** Build prođe, health prođe,
   a prvi pokušaj generisanja fakture padne. Ublažavanje: health endpoint (§8.2)
   može opciono provjeriti prisustvo fontova, ili — jeftinije — `fonts.ts` da se
   inicijalizuje eagerly pri prvom importu modula `documents.ts`.
3. **Siročad u storage-u.** Postoji i danas (§3.3), ali sa S3 to košta novac i
   nije vidljivo. Alat za čišćenje je u Fazi 5 — dotle prihvatiti svjesno.
4. **`env.ts` može pokvariti build.** `Dockerfile:21` build-uje sa lažnim
   `DATABASE_URL`. Ako `env.ts` radi top-level `parse()`, build puca. **Mora**
   biti lijena validacija. Ovo je najvjerovatniji izvor regresije u cijelom planu.
5. **Novi obavezni `APP_URL` u produkciji je breaking change za nekoga ko ga
   danas ne postavlja.** `docker-compose.yml:32` ga postavlja, pa standardni
   Docker tok je pokriven — ali neko ko je pokrenuo ručno (README §„Instalacija
   (ručno, bez Dockera)") može biti pogođen. Preporuka: u prvoj verziji
   upozorenje u logu umjesto greške, pa greška u sljedećoj.
6. **Trošak S3 zahtjeva pri današnjem obrascu „upiši pa odmah pročitaj".**
   Ublaženo u Fazi 0/§3.4, ali ako se ta izmjena preskoči, svaki download
   izvještaja je jedan PUT + jedan GET umjesto nule mrežnih poziva.
7. **Testovi sa MinIO usporavaju suite.** `fileParallelism: false` i
   `testTimeout: 60000` već čine suite sporim. Preporuka: `s3` prolaz kao
   **odvojen, opcion** run (npr. `npm run test:storage-s3`), ne kao dio
   podrazumijevanog `npm test`.

---

### Ključni fajlovi za implementaciju

- `/home/claude/zev-app/src/server/services/attachments.ts` — drugi (i važniji, jer su podaci nereproducibilni) potrošač lokalnog fajlsistema: `storageDir()` `:64`, `stageFile()` `:71-77`, `readAttachmentFile` `:186`
- `/home/claude/zev-app/src/server/services/documents.ts` — `storageDir()` `:30-34`, upis `:121-122`, čitanje `:180`, fontovi `:27-28`, `renderPdf` `:39-50`
- `/home/claude/zev-app/docker-entrypoint.sh` — cijeli sadržaj se refaktoriše u pozive npm skripti (§5)
- `/home/claude/zev-app/next.config.ts` — danas prazan; prima `outputFileTracingIncludes` (§4) i `serverActions.bodySizeLimit` (§8.1)
- `/home/claude/zev-app/src/lib/prisma.ts` — jedina tačka gdje se konfiguriše `PrismaPg` pool (§6)
- `/home/claude/zev-app/.env.example` — ugovor konfiguracije prema korisniku; mora nabrojati sve nove varijable i već postojeći nedokumentovani `MIGRATE_DATABASE_URL`
