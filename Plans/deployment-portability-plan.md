# Prenosivost deployment-a (deployment portability) — smanjenje zavisnosti od Dockera — plan za pregled

**Status: ODLUKE DONESENE — plan ažuriran, spreman za implementaciju od Faze 0.**
Nastalo na zahtjev korisnika (2026-09-15), nakon prethodnog pitanja u istoj
konverzaciji: „how could I deploy this application to Vercel?". Zahtjev je
proširen sa „kako na Vercel" na „kako učiniti aplikaciju konfigurabilno
prenosivom preko više okruženja — Docker self-host (kao danas), Vercel, ili bilo
koji Node hosting — bez izmjene koda, samo promjenom konfiguracije". Izrađeno
kroz plansku analizu (Opus model, plan-only prolaz — metodologija u skill-u
`opus-plan-sonnet-code`), zasnovano na stvarnom čitanju koda projekta.

Odgovori na §11 primljeni 2026-09-15 su **promijenili arhitekturu** u odnosu na
prvobitnu preporuku: umjesto `StorageAdapter`-a sa `local`/`s3` backend-ima
(izvorni §3), dokumenti i prilozi idu **direktno u Postgres bazu**. §3 je u
cjelosti prepisan; sve što je zavisilo od S3 (§3.5, `docker-compose.test-s3.yml`,
`@aws-sdk/client-s3`, dio §9) je uklonjeno iz obima.

## Odluke korisnika

Donesene 2026-09-15, kao odgovor na pitanja iz §11:

- **P1 — Vercel je konkretan cilj**, ne buduća fleksibilnost. Ovo opravdava
  puni obim izmjena (bivši §3-§8), ali korisnik je za **nivo truda** (P6)
  izabrao opciju **(b)**, ne (c) — vidi ispod. Stvaran probni deployment na
  Vercel ostaje u Fazi 5, van trenutnog obima.
- **P2/§3 — Umjesto object storage-a (S3/R2/MinIO), dokumenti i prilozi se
  čuvaju direktno u Postgres bazi.** Ovo je izmijenjeni odgovor u odnosu na
  izvorno pitanje P2 („koji S3?") — korisnik je odabrao da izbjegne object
  storage u potpunosti. Vidi prepisan §3. Ovo **automatski rješava P3**
  („ista baza za obje platforme?") na najjednostavniji mogući način: baza je i
  dalje jedini izvor istine, na obje platforme, bez pojma „backend-a" koji
  bira.
- **P3 — Ne treba** ista baza da servisira Docker i serverless istovremeno kao
  dvije žive produkcije. Bespredmetno nakon P2 odluke: DB storage radi
  identično na obje platforme bez grananja.
- **P4 — Pravi email provajder (Mailjet) ulazi u obim.** Viber ostaje `mock`,
  odloženo za kasnije izdanje. §7 prepisan da uključi `MailjetEmailProvider`.
- **P5 — Potvrđeno kroz P2/odgovor #2, uz novo ograničenje otkriveno
  provjerom (vidi §8.1):** Vercel Functions imaju tvrd infrastrukturni limit od
  4.5 MB po tijelu zahtjeva (izvor: [Vercel Functions Limits](https://vercel.com/docs/functions/limitations),
  potvrđeno pretragom 2026-09-15) — korisnikov prvobitni prijedlog od 10 MB po
  fajlu ne staje ispod tog zida ni uz `MAX_UPLOAD_MB`. Korisnik je nakon toga
  odabrao **spuštanje limita na ~4 MB** (opcija „minimalna izmjena, zadržati
  današnji jednozahtjevni upload") umjesto chunked upload-a ili presigned
  relay-a. Efektivan `MAX_UPLOAD_MB=4`.
- **P6 — Nivo truda: opcija (b), Blokator + higijena.** U obim ulaze: DB
  storage (prepisan §3), §4 (fontovi), §5 (migracije), §2 (`env.ts`
  validacija), §8.1 (upload limit, sada 4 MB), §8.2 (health), §8.3 (`engines`).
  **Van** trenutnog obima (odloženo u Fazu 5): §6 (pooling), §8.4
  (`maxDuration`), stvaran probni deployment na Vercel.
- **P7 — Ne.** `DEPLOYMENT_TARGET` dijagnostička varijabla se ne uvodi.
  Dodatno bespredmetna nakon P2 odluke — glavni scenario koji je štitila
  (`STORAGE_BACKEND` mismatch) više ne postoji jer postoji samo jedan
  „backend" (Postgres).

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

**Odluka (nakon §11):** umjesto `StorageAdapter`-a sa `local`/`s3` backend-ima,
dokumenti i prilozi se čuvaju **direktno u Postgres bazi** (§3) — nema više
pojma „backend-a" niti ortogonalne `STORAGE_BACKEND` varijable, jer postoji
samo jedan način čuvanja bajtova, identičan na Dockeru i na Vercel-u. Plus:
izdvojiti migracije iz entrypoint-a u eksplicitan, dokumentovan korak koji
entrypoint *poziva*, umjesto da ga *sadrži* (§5, nepromijenjeno).

**Usput otkriven bag koji nema veze sa prenosivošću, ali ga ovaj posao mora
dodirnuti** — vidi §8.1: upload veći od 1 MB danas pada **i u Dockeru**. Ispravka
je sada čvrsto vezana za drugo, nezavisno ograničenje: Vercel Functions imaju
tvrd limit od 4.5 MB po tijelu zahtjeva, pa je konačan izabran limit 4 MB, ne
prvobitno razmatranih 10-15 MB.

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
kroz servis, prije nego što `documents.ts`/`attachments.ts` uopšte mogu biti
jedina tačka pristupa bajtovima (sada: jedina tačka koja čita/piše
`DocumentBlob`/`AttachmentBlob`, §3). `generateFinancialReportPdf` i
`generateOwnerDebtReportPdf` ionako već vraćaju `Document` red — dovoljno je
pozvati `readDocumentFile(actor, doc.id)`, kao što
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
mikrosekunda.

**Bitno:** današnji kod **već** ostavlja siroče na disku ako se transakcija
rollback-uje (fajl je upisan prije `tx.attachment.create`).

**Ovaj problem u potpunosti nestaje odlukom da bajtovi idu u Postgres (§3).**
Upis u `AttachmentBlob` postaje **dio iste `tx.$transaction`** — nema više
razdvajanja na „upiši van transakcije pa referenciraj unutra" (izvorna
preporuka §3.3 dolje je zamijenjena): ako transakcija padne, blob red se
rollback-uje zajedno sa svim ostalim, atomski, bez ikakvog siročeta. Ovo je
strogo jednostavnije od originalnog plana, ne kompromis.

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

Dodatno, `EMAIL_PROVIDER`/`VIBER_PROVIDER` i ostale nove varijable (§8.1
`MAX_UPLOAD_MB`, §6 `DB_POOL_MAX`) su zaista nezavisne jedna od druge: neko
može raditi Docker self-host **sa** pravim Mailjet provajderom (§7), ili
Vercel **sa** mock notifikacijama dok ne konfiguriše Mailjet. Preseti bi tu
kombinatoriku razbili. (Napomena: nakon odluke iz §3, storage više nema
zasebnu env varijablu uopšte — DB je jedini mehanizam — pa je ovaj argument
sada suženiji nego u izvornom planu, ali i dalje važi za preostale opcije.)

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

## 3. Skladištenje dokumenata i priloga — dizajn (DB umjesto object storage-a)

**Odluka korisnika (§11 P2, revidirano):** umjesto `StorageAdapter`-a sa
`local`/`s3` backend-ima, binarni sadržaj ide **direktno u Postgres**. Ovo je
u potpunosti zamijenilo izvorni dizajn ovog paragrafa.

### 3.1 Šema: `DocumentBlob` / `AttachmentBlob`

```prisma
model DocumentBlob {
  documentId String   @id
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  data       Bytes
  createdAt  DateTime @default(now())
}

model AttachmentBlob {
  attachmentId String     @id
  attachment   Attachment @relation(fields: [attachmentId], references: [id], onDelete: Cascade)
  data         Bytes
  createdAt    DateTime   @default(now())
}
```

`Bytes` u Prisma 7 mapira na Postgres `bytea`. Za fajlove do ~4 MB (§8.1) TOAST
automatski čuva vrijednost van glavne stranice (out-of-line, kompresovano) —
nema potrebe za `Large Object` (`lo`) API-jem, koji bi tražio posebno
upravljanje transakcijama i nije dostupan kroz Prisma.

### 3.2 Zašto zasebne tabele, ne kolona na `Document`/`Attachment`

Prisma upit bez eksplicitnog `select` povlači **sve** skalarne kolone. Liste
dokumenata (`/dokumenti`, kartica vlasnika, itd.) rade tačno takve upite. Da je
`data Bytes` kolona direktno na `Document`/`Attachment`, svako listanje bi
nenamjerno povlačilo pune sadržaje fajlova (do 4 MB po redu) preko mreže. Sa
zasebnom 1:1 tabelom, blob se dohvata samo eksplicitnim upitom na
`DocumentBlob`/`AttachmentBlob` — tačno tamo gdje kod danas zove
`fs.readFileSync`, u `readDocumentFile`/`readAttachmentFile`. Ovo je najveći
implementacioni rizik ove odluke (vidi §13) — svaki budući `prisma.document.findMany`
bez `select` i dalje je siguran samo zato što je blob u drugoj tabeli.

### 3.3 `filePath` — nazad-kompatibilnost sa postojećim Docker redovima

Princip je jednostavniji nego u izvornom planu jer sada postoji samo jedan novi
mehanizam čuvanja, ne izbor između više:

- Kolona `filePath` (`schema.prisma:1412`, `:1435`) **ostaje netaknuta** — jedini
  način da postojeći Docker redovi (apsolutna putanja, §1.2) i dalje rade.
- Novi redovi (od Faze 1 nadalje) **ne pišu** `filePath`; umjesto toga dobijaju
  odgovarajući `DocumentBlob`/`AttachmentBlob` red.
- Čitanje (`readDocumentFile`, `readAttachmentFile`): prvo pokušaj blob relaciju;
  ako ne postoji, pad-back na `fs.readFileSync(filePath)` (legacy Docker put).
  Ako ni jedno ni drugo — greška, kao i danas.
- **Jedina stvarna izmjena šeme na postojećim modelima:** `filePath` mora
  postati `filePath String?` (danas obavezno) da bi novi redovi mogli imati
  prazan `filePath`. Sigurna, širi tip — sve postojeće vrijednosti ostaju validne.
- `sha256` (već postoji na oba modela, `:1413`, `:1436`) i dalje se provjerava
  pri čitanju kao i u izvornom planu — provjeravati i logovati neslaganje, ne
  bacati grešku.

**Jednokratni backfill alat** (opcion, ne u trenutnom obimu — P6 (b) ga ne
uključuje): pročitaj sve redove sa ne-null `filePath`, upiši sadržaj u
odgovarajući blob, obriši `filePath`. Vrijedan tek kad se stvarno planira
ugasiti Docker deployment koji te fajlove drži — dotle pad-back čitanje radi
neograničeno, bez hitnosti.

### 3.4 Upis — unutar transakcije, ne van nje

Izvorni plan je preporučivao izbacivanje upisa **iz** DB transakcije zbog
mrežnog S3 PUT-a sa otvorenom transakcijom (§1.3). DB storage čini suprotno
prirodnim: upis u `DocumentBlob`/`AttachmentBlob` ide **unutar** iste
`prisma.$transaction` kao i upis reda u `Document`/`Attachment`. Ovo u
potpunosti uklanja problem siročadi u storage-u (§1.3) — bez potrebe za bilo
kakvim alatom za čišćenje.

`createLinkedAttachmentTx` (`attachments.ts:82`) i ekvivalent u `documents.ts`
se pojednostavljuju: `stageFile()`/`storeDocument()` rade **oba** upisa (red +
odgovarajući blob red) u istom `tx`. Pozivaoci u `ownership.ts:131` i
`evoteConsent.ts:34` se ne mijenjaju — i dalje prosljeđuju `tx` nadalje.

### 3.5 Nusprodukt koji treba popraviti usput (nepromijenjeno u suštini)

`src/app/api/dokumenti/kartica/[partyId]/route.ts:12-13` radi
`generateOwnerStatementPdf` → `readDocumentFile` — upiše pa odmah pročita
nazad. Sa DB storage-om to je i dalje nepotreban dodatni `SELECT` na
`DocumentBlob` odmah nakon `INSERT`-a u istoj bazi — jeftinije nego sa S3
(nema mrežnog PUT/GET-a), ali i dalje suvišno. Ista preporuka: `storeDocument`
vraća `{ row, buffer }`, rute koriste buffer koji već imaju. Isti obrazac je i
u `izvjestaji/pdf/route.ts` i `izvjestaji/dugovanja/route.ts` (§1.1).

### 3.6 Šta ova odluka uklanja iz obima

- `src/server/storage/` adapter sloj (interfejs + `local`/`s3` implementacije) —
  ne treba, nema izbora backend-a.
- `STORAGE_BACKEND` env varijabla i cijela tabela backend-a iz izvornog plana.
- `@aws-sdk/client-s3` zavisnost — prva prava vanjska integracija koju je
  izvorni plan predviđao za ovaj poduhvat više nije potrebna ovdje
  (`Plans/gmail-bank-statement-ingestion-plan.md:86-96` i dalje može biti prva
  vanjska integracija, ako do toga dođe).
- `docker-compose.test-s3.yml` + MinIO test servis.
- Pitanja P2 (izvorno „koji S3 provider") i P3 (dvostruki backend) — oba
  bespredmetna, vidi Odluke korisnika.
- `STORAGE_DIR` env varijabla ostaje **samo** za nazad-kompatibilno čitanje
  postojećih Docker redova (§3.3 gore) — više se ne koristi za nove upise.

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

## 7. Notifikacioni provajderi — Mailjet ulazi u obim (§11 P4)

`providers.ts:71-95` je **već** tačan obrazac za dodavanje pravog provajdera:
`switch` po env varijabli, `?? "mock"` kao podrazumijevana vrijednost, `throw`
za nepoznatu vrijednost (`:71-80`). Interfejsi `EmailProvider`/`ViberProvider`
(`:22-33`) su čisti, `SendResult` je platformski neutralan, i dispatch ide kroz
njih — nema potrebe mijenjati obrazac, samo dodati implementaciju.

### 7.1 `MailjetEmailProvider`

- Nov `src/server/notifications/mailjetEmail.ts`, implementira `EmailProvider`.
- Mailjet REST API (`POST /v3.1/send`), autentikacija preko API key + secret
  (Basic Auth) — dvije nove env varijable: `MAILJET_API_KEY`,
  `MAILJET_API_SECRET`, plus `MAILJET_FROM_EMAIL` (pošiljalac mora biti
  verifikovan domen/adresa u Mailjet nalogu).
- `getEmailProvider()` (`providers.ts:71`) dobija novi `case "mailjet"`; ostaje
  `mock` kao podrazumijevano ako `EMAIL_PROVIDER` nije postavljen — Docker
  deployment koji ništa ne mijenja nastavlja da radi identično (§9 princip).
- Mapiranje na `SendResult`: Mailjet API vraća `Messages[].Status` ("success"/
  "error") i `Messages[].To[].MessageID` — direktno se preslikava na
  `ok`/`providerMessageId`. Mailjet ne šalje delivery/seen webhook-ove bez
  dodatne konfiguracije (Event API) — van obima ovog plana; `events` niz u
  `SendResult` se popunjava samo sa `"sent"` u trenutku uspješnog API poziva,
  ne sa `"delivered"`/`"seen"` kao mock provajder danas simulira.
- `VIBER_PROVIDER` **ostaje `mock`** — pravi Viber provajder je eksplicitno
  odloženo za kasnije izdanje (§11 P4).

### 7.2 Zakazivanje/retry — i dalje van obima, ali sada bliže

`service.ts:45-46` komentariše da bi „a real deployment would use a worker with
retry/backoff", a `retryFailed()` (`service.ts:101`) postoji ali **nema
pozivaoca**. Uvođenje pravog provajdera (7.1) ovo čini konkretnijim rizikom —
Mailjet API poziv može otkazati (mrežna greška, rate limit, nevalidna adresa)
na način na koji mock provajder nikad ne otkazuje — ali `retryFailed`
zakazivanje **ostaje van obima ovog plana** po odluci P4 (samo pravi provajder
je tražen, ne i scheduler). Zapisano kao prva stvar koja će zahtijevati
platform-specific scheduler kad se ikad uvede.

Isti zaključak važi i za `Plans/adhoc-fund-collection-plan.md` P9 (planirani
podsjetnici) i `Plans/gmail-bank-statement-ingestion-plan.md` Faza 3
(pozadinska provjera Gmail-a). Kad *bilo koji* od ta tri stigne, trebaće
apstrakcija zakazivanja — vjerovatno „HTTP endpoint zaštićen tajnom + platformski
scheduler koji ga zove", jer to radi i na Dockeru (cron u host sistemu) i na
Vercel-u (Vercel Cron) i svugdje drugdje. **Predložiti kao dizajn, ne graditi sada.**

---

## 8. Ostalo

### 8.1 Bag: limit veličine upload-a — RIJEŠENO, limit spušten na 4 MB (§11 P5)

`attachments.ts:37` postavlja `MAX_SIZE_BYTES = 15 MB`. Upload ide kroz Server
Action (`src/app/(app)/dokumenti/page.tsx:16-24`, `formData.get("file")` →
`file.arrayBuffer()`). Next-ov podrazumijevani `experimental.serverActions.bodySizeLimit`
je **1 MB**, a `next.config.ts` je prazan.

**Posljedica: skenirani dokaz o vlasništvu veći od 1 MB danas pada i u Dockeru** —
sa Next-ovom greškom o body limitu, ne sa aplikativnom porukom iz `assertUploadable`.
Validaciju od 15 MB nikad ništa ne dosegne.

**Drugo, nezavisno ograničenje potvrđeno pretragom (2026-09-15):** Vercel
Functions imaju **tvrd infrastrukturni limit od 4.5 MB** na tijelo zahtjeva —
nije podesivo iz `vercel.json` ni iz aplikativnog koda; prekoračenje vraća
`413 FUNCTION_PAYLOAD_TOO_LARGE` prije nego što kod uopšte izvrši
([Vercel Functions Limits](https://vercel.com/docs/functions/limitations),
[Vercel KB: bypass the 4.5MB limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)).
Pošto upload i dalje ide kroz jedan Server Action zahtjev (nepromijenjeno —
korisnik je odbio chunked upload i presigned relay kao veći zahvat), efektivan
maksimum na Vercel-u je taj zid, ne bilo koja vrijednost koju aplikacija
postavi.

**Odluka:** `MAX_UPLOAD_MB=4` (umjesto ranije razmatranih 10-15 MB), sa
marginom ispod 4.5 MB zida za multipart/form-data overhead. Implementacija:
- `attachments.ts:37` `MAX_SIZE_BYTES` postaje izveden iz `env.MAX_UPLOAD_MB`
  (podrazumijevano `4`), ne fiksnih 15 MB — **ovo je namjerna izmjena
  ponašanja koja smanjuje danas dokumentovani limit**, ne samo ispravka baga;
  treba je istaknuti korisnicima ZEV aplikacije prije objave (CHANGELOG,
  §12 svaka faza).
- `serverActions.bodySizeLimit` u `next.config.ts` postavljen na isti broj.
- Aplikacija odbija prevelik fajl **svojom** porukom na sr-Latn (postojeći
  `assertUploadable`) umjesto platformskom `413` greškom, na obje platforme.

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
   današnjem ponašanju.** `EMAIL_PROVIDER` neizostavljen → `mock` (Mailjet se
   ne aktivira sam od sebe). `STORAGE_DIR` neizostavljen → `./var/storage`,
   ostaje relevantan samo za pad-back čitanje postojećih redova (§3.3).
   `DB_POOL_MAX` neizostavljen → ne prosljeđivati `max` uopšte. Praktičan test:
   **`docker compose up -d --build` sa nepromijenjenim `docker-compose.yml`
   mora raditi identično.**
2. **Naslijeđeni apsolutni `filePath`-ovi moraju ostati čitljivi** (§3.3).
   Bez toga svaki postojeći Docker deployment gubi pristup svim dokumentima.
3. **`docker-entrypoint.sh` mora nastaviti da radi migracije i seed.** Refaktor
   iz §5 mijenja *gdje logika živi*, ne *šta se dešava* pri `docker compose up`.

Jedina izmjena koja **namjerno** mijenja postojeće ponašanje je §8.1 (limit
upload-a) — i to je ispravka baga, ne regresija.

### Kako se testira

| Šta | Kako |
|---|---|
| Docker default nepromijenjen | `docker compose up -d --build` bez ijedne izmjene u `docker-compose.yml`; upload dokaza o vlasništvu, generisanje PDF-a, `docker compose down && up` pa provjera da su dokumenti i dalje čitljivi (sada iz Postgres baze, volume `zev-pgdata`, ne `zev-storage`) |
| Naslijeđeni redovi | Pokrenuti stari deployment, generisati dokumente (upisuju u `filePath`), pa nadograditi na novi kod → stari dokumenti se i dalje otvaraju kroz pad-back čitanje (§3.3), novi idu u `DocumentBlob`/`AttachmentBlob` |
| DB blob upis/čitanje | Postojeći testovi (`tests/attachments.test.ts`, `tests/documents-audit.test.ts`) rade uz izmjenu: asercije koje gledaju `fs.existsSync(doc.filePath)` (`documents-audit.test.ts:29,31,43,44`) se prepisuju na provjeru postojanja odgovarajućeg `DocumentBlob`/`AttachmentBlob` reda. |
| Kontrakt čitanja/upisa | Jedan test fajl (`tests/document-storage.test.ts`): upiši-pa-pročitaj round-trip kroz `storeDocument`/`readDocumentFile`, `sha256` podudaranje, ponašanje kad `DocumentBlob` ne postoji a `filePath` postoji (legacy put), ponašanje kad ni jedno ni drugo ne postoji (greška) |
| Fontovi | `npm run build` pa provjera da traced izlaz sadrži oba `.ttf` fajla; plus test koji generiše PDF sa `č/ć/ž/š/đ` u tekstu i provjeri da nije prazan |
| Konfiguracija | Unit test za `env.ts`: nedostajuće obavezne varijable → jasna greška; podrazumijevane vrijednosti → današnje vrijednosti |
| Upload limit | Test da fajl >4 MB pada sa aplikativnom porukom (`assertUploadable`), ne sa Next/platformskom greškom |

`tests/setup-env.ts:9` postavlja `STORAGE_DIR = "./var/test-storage"` — nakon
ove odluke ostaje samo kao dokumentacija legacy putanje za testove koji
provjeravaju pad-back čitanje (§3.3); testovi za nove upise ga više ne koriste.

Nema više potrebe za `fileParallelism: false` zbog dijeljenog bucket-a (nema
bucket-a); ta postavka u `vitest.config.ts` ostaje samo ako je motivisana
nečim drugim (dijeljena test baza) — provjeriti pri implementaciji, van obima
ovog plana da se to mijenja.

---

## 10. Šta ovaj plan namjerno NE radi

- **Ne uklanja Docker.** `Dockerfile`, `docker-compose.yml` i
  `docker-entrypoint.sh` ostaju prva i podrazumijevana opcija u README.
- **Ne uvodi eksterni object storage (S3/R2/MinIO)** (§3) — namjerna odluka,
  ne propust; sav binarni sadržaj ide u Postgres.
- **Ne uvodi presigned URL-ove** — razbija postojeću autorizaciju, i dodatno
  bespredmetno nakon odluke o DB storage-u (§3).
- **Ne implementira pravi Viber provajder** — ostaje `mock`, odloženo za
  kasnije izdanje (§11 P4). Mailjet email provajder **jeste** u obimu (§7.1).
- **Ne uvodi apstrakciju zakazivanja** — nema šta da se zakaže danas (§7.2).
- **Ne gradi jednokratni backfill alat za postojeće Docker fajlove** (§3.3) —
  pad-back čitanje je dovoljno dok se stvarno ne planira gašenje Docker diska.
- **Ne uvodi CDN, keširanje, ni `Cache-Control` promjene.** Rute svjesno šalju
  `private, no-store` (`api/dokumenti/[id]/route.ts:19`) — to je ispravno za
  dokumente sa kontrolom pristupa i ne dira se.
- **Ne dodaje CI.** Nekoliko preporuka (§8.3) bi bilo prirodnije uz CI, ali CI
  je zaseban poduhvat.
- **Ne mijenja `Document` verzionisanje ni nepromjenljivost.**

---

## 11. Pitanja za korisnika prije implementacije — SVA ODGOVORENA 2026-09-15

**P1 — Da li je Vercel konkretan, blizak cilj, ili je ovo investicija u buduću
fleksibilnost?** Ovo najviše mijenja oblik plana. Ako je Vercel konkretan cilj u
narednim sedmicama, radi se sve iz §3-§8 i pravi se stvaran probni deployment.
Ako je „opšta fleksibilnost bez konkretnog drugog hostinga", preporučujem da se
uradi **samo** §3 (storage adapter) i §5 (izdvajanje migracija) — to su dvije
stvari koje su vrijedne same po sebi (backup, čistoća) čak i ako se nikad ne ode
sa Dockera; ostalo se odgađa dok se ne zna ciljna platforma.

> **Odgovoreno: Vercel je konkretan cilj.** Vidi ipak P6 — korisnik je za nivo
> truda izabrao (b), ne (c), pa stvaran probni deployment ostaje u Fazi 5.

**P2 — Koji object storage stvarno planiraš?** AWS S3, Cloudflare R2, MinIO
(self-host), ili nešto drugo? Ako je odgovor „ostajem na lokalnom fajlsistemu
zauvijek za Docker", onda `s3` adapter ne treba implementirati sada — dovoljno je
uvesti interfejs sa `local` implementacijom, što je i dalje korisno (§3.4,
uklanjanje direktnog `fs` pristupa iz ruta). Napominjem da **ne** preporučujem
Vercel Blob (§3.5) — ako ti je Vercel cilj, R2 ili S3 su bolji izbor jer ne
vezuju za platformu.

> **Odgovoreno: nijedan — korisnik je odbio object storage u cjelosti.**
> Umjesto S3/R2/MinIO, dokumenti idu direktno u Postgres (novi §3). Ovo je
> promijenilo plan više nego bilo koje pojedinačno pitanje — §3 je u potpunosti
> prepisan.

**P3 — Da li ista baza treba istovremeno da služi i Docker i serverless
deployment, ili je scenario „biraš jednu platformu"?** Ako je odgovor „istovremeno",
onda §3.2 mora ići na opciju B (zasebna `storageBackend` kolona po redu), što je
osjetno više posla. Ako je „biraš jednu", opcija A je dovoljna.

> **Odgovoreno: ne treba istovremeno.** Bespredmetno nakon P2 — DB storage
> radi identično na obje platforme, nema više „backend-a" koji bira.

**P4 — Da li pravi email/Viber provajderi ulaze u ovaj poduhvat?** Preporuka je
**ne** — to je zaseban posao. Ali ako je plan da se aplikacija stavi na Vercel i
odmah šalje prave e-mailove, onda se §7 (i pitanje zakazivanja `retryFailed`)
vraća u obim.

> **Odgovoreno: email da (Mailjet), Viber ne (odloženo).** Vidi prepisan §7.1.
> Zakazivanje/retry (§7.2) i dalje van obima.

**P5 — Da li potvrđuješ nalaz iz §8.1 (upload > 1 MB pada i danas)?** Konkretno:
da li si ikad uspješno uploadovao skenirani dokument veći od 1 MB kroz stranicu
`/dokumenti`? Ako jesi, moj zaključak je pogrešan i treba ga ponovo ispitati.
Ako nisi probao — vrijedi probati prije nego što se planira išta drugo, jer to
je bag koji pogađa i današnje korisnike.

> **Odgovoreno indirektno kroz P2 (10 MB ceiling za DB storage), zatim
> korigovano nalazom o Vercelovom 4.5 MB zidu (potvrđeno pretragom) na 4 MB.**
> Vidi prepisan §8.1. Empirijska provjera „jesi li ikad uploadovao >1MB" nije
> više toliko bitna — novi limit (4 MB) je i dalje iznad 1 MB Next
> podrazumijevanog limita, pa se ispravka radi bez obzira na odgovor.

**P6 — Nivo truda sada nasuprot kasnije.** Tri realne varijante:
- **(a) Samo blokator:** §3 (storage) + §4 (fontovi) + §5 (migracije). Aplikacija
  postaje tehnički deploy-abilna izvan Dockera.
- **(b) Blokator + higijena:** (a) + §2 (`env.ts` validacija) + §8.1 (upload limit)
  + §8.2 (health) + §8.3 (`engines`). Preporučujem ovo.
- **(c) Sve:** (b) + §6 (pooling) + §8.4 (`maxDuration`) + stvaran probni
  deployment na drugu platformu.

> **Odgovoreno: (b).** §6 i §8.4 i probni deployment ostaju u Fazi 5, uslovno.

**P7 — Da li želiš `DEPLOYMENT_TARGET` kao savjetodavnu dijagnostiku** (§2,
opcija C) — varijablu koja **ne** mijenja ponašanje, nego pri startu ispiše
upozorenje ako je kombinacija besmislena (npr. `DEPLOYMENT_TARGET=serverless`
uz `STORAGE_BACKEND=local`)? Korisno, ali nije neophodno.

> **Odgovoreno: ne.** Dodatno bespredmetno nakon P2 — scenario koji je štitila
> (`STORAGE_BACKEND` mismatch) više ne postoji.

---

## 12. Fazni plan implementacije (za pregled — nije kod)

Obim faza 0-4 odgovara odluci P6 (b). Faza 5 je uslovna i odložena.

Redoslijed Faze 0/1 je i dalje vođen istim praktičnim razlogom kao u izvornom
planu: `Plans/gmail-bank-statement-ingestion-plan.md:357` planira **treći**
potrošač istog `STORAGE_DIR`/fajl-čuvanje obrasca (`IncomingStatement.filePath`).
Ako se Faza 1 uradi prije tog plana, taj plan odmah koristi
`DocumentBlob`-obrazac umjesto da se naknadno prepravlja.

### Faza 0 — Priprema, bez promjene ponašanja *(mala)*

- Ispraviti `src/app/api/izvjestaji/pdf/route.ts:18` i
  `src/app/api/izvjestaji/dugovanja/route.ts:19` da idu kroz `readDocumentFile`
  umjesto direktnog `fs.readFileSync` — ili, bolje, da koriste buffer koji
  `storeDocument` već ima (§3.5).
- `storeDocument` (`documents.ts:95`) da vraća `{ row, buffer }`.
- Rezultat: **nijedno mjesto van `documents.ts`/`attachments.ts` ne dodiruje
  `filePath`.** Ovo je preduslov za sve ostalo.

### Faza 1 — Skladištenje u Postgres bazi *(srž)*

- Migracija šeme: `DocumentBlob`, `AttachmentBlob` (§3.1); `Document.filePath`
  i `Attachment.filePath` postaju `String?` (§3.3).
- `documents.ts` i `attachments.ts` prelaze na čitanje/upis kroz
  `DocumentBlob`/`AttachmentBlob`; `storageDir()` nestaje sa oba mjesta.
- Novi redovi ne pišu `filePath`; čitanje ostaje unazad kompatibilno za
  postojeće apsolutne putanje (§3.3).
- Upis blob reda ulazi **unutar** postojeće `prisma.$transaction` —
  `createLinkedAttachmentTx` (`attachments.ts:82`) i ekvivalent u
  `documents.ts` rade oba upisa u istom `tx` (§3.4); pozivaoci u
  `ownership.ts:131` i `evoteConsent.ts:34` se ne mijenjaju.
- `tests/document-storage.test.ts` (kontrakt-test iz §9);
  `tests/documents-audit.test.ts` prelazi sa `fs.existsSync` na provjeru blob
  reda.
- **Docker ponašanje: identično, bez ijedne nove env varijable** (postojeći
  Docker redovi i dalje čitljivi kroz pad-back na `filePath`).

### Faza 2 — Fontovi i konfiguracija *(mala-srednja)*

- `src/server/pdf/fonts.ts` sa memoizovanim `Buffer`-om i `FONT_DIR` overrideom (§4, B).
- `outputFileTracingIncludes` u `next.config.ts` (§4, A).
- `src/lib/env.ts` sa `zod` validacijom (§2); `APP_URL` prestaje da tiho pada na
  localhost u produkciji; tri pozivaoca (`meetings.ts:318`, `:504`,
  `zaboravljena-lozinka/page.tsx:15`) prelaze na `env.APP_URL`.
- `.env.example` dopunjen svim novim varijablama (`MAILJET_API_KEY`,
  `MAILJET_API_SECRET`, `MAILJET_FROM_EMAIL`, `MAX_UPLOAD_MB`), sa
  `MIGRATE_DATABASE_URL` koji je do sada bio nedokumentovan (§6).

### Faza 3 — Mailjet email provajder *(mala, uslovno po P4 — sada potvrđeno u obimu)*

- `src/server/notifications/mailjetEmail.ts`, implementira `EmailProvider`
  (§7.1); `getEmailProvider()` dobija `case "mailjet"`.
- `mock` ostaje podrazumijevano ako `EMAIL_PROVIDER` nije postavljen.
- Test sa mock HTTP odgovorom Mailjet API-ja (uspjeh i greška), bez pravog
  naloga u test suite-u.
- README: kako se pribavlja Mailjet API key/secret i verifikuje `FROM` adresa.

### Faza 4 — Deployment procedura *(mala)*

- `docker-entrypoint.sh` refaktorisan da poziva npm skripte (§5); opciono
  `scripts/wait-for-db.mjs`.
- `src/app/api/health/route.ts` (§8.2); healthcheck za `app` u `docker-compose.yml`.
- `"engines"` u `package.json` (§8.3).
- `MAX_UPLOAD_MB=4` + `serverActions.bodySizeLimit` (§8.1) — istaknuti u
  CHANGELOG-u kao namjernu izmjenu ponašanja (smanjenje sa 15 MB).
- README: nova sekcija „Deployment na Vercel" sa tabelom varijabli
  (uključujući `MAILJET_*`) i eksplicitnim redoslijedom migracija.

### Faza 5 — Fino podešavanje *(uslovno, van trenutnog obima — P6 je (b), ne (c))*

- `DB_POOL_MAX` (§6).
- `maxDuration` na teškim rutama (§8.4).
- Jednokratni backfill alat: postojeći Docker `filePath` redovi →
  `DocumentBlob`/`AttachmentBlob`, pa `filePath` na `null` (§3.3) — vrijedan
  tek kad se stvarno planira ugasiti Docker disk.
- Stvaran probni deployment na Vercel i ispravke onoga što se pokaže — ovo je
  dio P1 preporuke koji P6 (b) svjesno odlaže dok Faze 0-4 ne budu gotove i
  provjerene na Dockeru.

### Uz svaku fazu (pravila projekta)

Svaka faza nosi **unos u `CHANGELOG.md`** i **podizanje verzije**, po konvenciji
opisanoj u `CHANGELOG.md` §„Verzionisanje" (minor je podrazumijevani korak; patch
za iteracije unutar istog nezavršenog posla; tip podizanja se **potvrđuje sa
korisnikom prije** nego što se uradi). Trenutna verzija je `2.7.0`.
Očekivanje: Faza 0 i Faza 1 zajedno su jedan minor sa patch iteracijama;
Faza 3 (nova vanjska zavisnost) vjerovatno zaslužuje svoj minor.

---

## 13. Rizici i ono što će zaboljeti u praksi

1. **Nenamjerno povlačenje blob-ova pri listanju (§3.2).** Najveći novi rizik
   uveden ovom odlukom: bilo koji budući `prisma.document.findMany(...)` ili
   `prisma.attachment.findMany(...)` koji doda `include: { blob: true }` iz
   pogodnosti (npr. neko kopira postojeći upit i doda relaciju „da bude pri
   ruci") tiho pretvara stranicu liste u prenos više desetina MB. Nema
   kompajlerske zaštite od ovoga — samo code review disciplina. Ublažavanje:
   `blob` relacija se dohvata **isključivo** unutar `readDocumentFile`/
   `readAttachmentFile`, nigdje drugo; vrijedi razmotriti eksplicitan komentar
   uz `DocumentBlob`/`AttachmentBlob` model u `schema.prisma` koji na to
   upozorava.
2. **Rast veličine baze i backup-a.** Svaki dokument/prilog do 4 MB sada živi u
   `pg_dump` izlazu i u `zev-pgdata` volume-u, ne u zasebnom, lakše
   komprimujućem fajlsistemu. `ARCHITECTURE.md:97-99` danas dokumentuje da
   backup zahtijeva `pg_restore` **i** ručno vraćanje `var/storage` — nakon ove
   izmjene backup postaje **jednostavniji** (jedan artefakt, `pg_restore`
   dovoljan za nove podatke), ali baza raste brže i sporije se backup-uje.
   Treba zapisati u README kao očekivanu posljedicu, ne kao bag.
3. **Fontovi pucaju tek poslije uspješnog deploy-a.** Build prođe, health prođe,
   a prvi pokušaj generisanja fakture padne. Ublažavanje: health endpoint (§8.2)
   može opciono provjeriti prisustvo fontova, ili — jeftinije — `fonts.ts` da se
   inicijalizuje eagerly pri prvom importu modula `documents.ts`.
4. **`env.ts` može pokvariti build.** `Dockerfile:21` build-uje sa lažnim
   `DATABASE_URL`. Ako `env.ts` radi top-level `parse()`, build puca. **Mora**
   biti lijena validacija. Ovo je najvjerovatniji izvor regresije u cijelom planu.
5. **Novi obavezni `APP_URL` u produkciji je breaking change za nekoga ko ga
   danas ne postavlja.** `docker-compose.yml:32` ga postavlja, pa standardni
   Docker tok je pokriven — ali neko ko je pokrenuo ručno (README §„Instalacija
   (ručno, bez Dockera)") može biti pogođen. Preporuka: u prvoj verziji
   upozorenje u logu umjesto greške, pa greška u sljedećoj.
6. **Mailjet poziv može otkazati bez ikakvog retry mehanizma (§7.2).** Za
   razliku od mock provajdera, koji nikad ne otkazuje, pravi API poziv može
   pasti zbog mreže, rate limit-a ili nevalidne adrese. `retryFailed()` postoji
   ali nema pozivaoca i ostaje van obima (P4) — korisnik treba znati da
   propali e-mailovi danas **ne** dobijaju automatski pokušaj ponovo.
7. **4 MB upload limit je smanjenje u odnosu na danas dokumentovanih 15 MB.**
   I dalje popravlja postojeći bag (>1 MB pada), ali neko ko je navikao na
   veće skenove (npr. viestranični PDF dokaz o vlasništvu) može prvi put udariti
   u ovaj limit tek nakon objave. Treba biti istaknuto u CHANGELOG-u.

---

### Ključni fajlovi za implementaciju

- `prisma/schema.prisma` — `Document` (`:1401-1421`) i `Attachment` (`:1428-1449`):
  `filePath` → `String?` (§3.3), dodati `DocumentBlob`/`AttachmentBlob` modele (§3.1)
- `src/server/services/attachments.ts` — drugi (i važniji, jer su podaci nereproducibilni) potrošač lokalnog fajlsistema: `storageDir()` `:64`, `stageFile()` `:71-77`, `createLinkedAttachmentTx` `:82`, `readAttachmentFile` `:186` — svi prelaze na `AttachmentBlob` (§3)
- `src/server/services/documents.ts` — `storageDir()` `:30-34`, upis `:121-122`, čitanje `:180`, fontovi `:27-28`, `renderPdf` `:39-50` — upis/čitanje prelazi na `DocumentBlob` (§3), fontovi na §4 nezavisno
- `src/server/notifications/providers.ts` — `getEmailProvider()` `:71-80` dobija `case "mailjet"` (§7.1)
- `docker-entrypoint.sh` — cijeli sadržaj se refaktoriše u pozive npm skripti (§5)
- `next.config.ts` — danas prazan; prima `outputFileTracingIncludes` (§4) i `serverActions.bodySizeLimit` (§8.1)
- `src/lib/prisma.ts` — jedina tačka gdje se konfiguriše `PrismaPg` pool (§6, Faza 5)
- `.env.example` — ugovor konfiguracije prema korisniku; mora nabrojati sve nove varijable (`MAILJET_API_KEY`, `MAILJET_API_SECRET`, `MAILJET_FROM_EMAIL`, `MAX_UPLOAD_MB`) i već postojeći nedokumentovani `MIGRATE_DATABASE_URL`
