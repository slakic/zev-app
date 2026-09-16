# ZEV upravnik — MVP

Web aplikacija za svakodnevno i godišnje upravljanje jednom **Zajednicom etažnih vlasnika (ZEV)**
u Republici Srpskoj (BiH): imovina i vlasništvo, skupština i sigurno elektronsko odobravanje,
fakturisanje i uplate, troškovi i dobavljači, godišnji planovi, održavanje, dokumenti,
izvještaji i revizorski trag.

Interfejs je na srpskom (latinica); i18n sloj omogućava dodavanje jezika bez izmjene logike
(`src/lib/i18n`).

> Pravne i finansijske pretpostavke, mapiranje na Zakon o održavanju zgrada RS (101/11) i
> stavke koje mora potvrditi pravnik/računovođa: **`LEGAL_AND_FINANCIAL_ASSUMPTIONS.md`**.
> Arhitektura: **`ARCHITECTURE.md`**. Matrica prava: **`PERMISSION_MATRIX.md`**.

## Tehnologije

Next.js 15 (App Router) · TypeScript · PostgreSQL 16 · Prisma 7 (WASM, bez Rust binarki) ·
Tailwind CSS · Zod · jose + bcryptjs (sesije u bazi) · pdfkit + DejaVu (sr-Latn PDF) ·
qrcode · Vitest (62 testa) · Playwright smoke e2e.

## Pokretanje kroz Docker (najjednostavnija opcija)

Preduslov: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac)
ili Docker Engine + Compose plugin (Linux). PostgreSQL i Node.js **nisu** potrebni na
računaru — sve ide u kontejnere.

```bash
docker compose up -d --build
```

Prvo pokretanje traje nekoliko minuta (build). Zatim otvorite **http://localhost:3000**
i prijavite se demo nalogom (tabela ispod). Šta se dešava automatski pri startu:
kontejner sačeka bazu, primijeni migracije, ubaci demo podatke (samo ako je baza prazna —
seed je idempotentan) i pokrene server.

Korisne komande:

```bash
docker compose logs -f app     # logovi aplikacije (i ispis seed-a sa demo nalozima)
docker compose down            # zaustavi (podaci ostaju u volume-ima)
docker compose down -v         # zaustavi i OBRIŠI podatke (baza + generisani PDF-ovi)
```

Podešavanja su u `docker-compose.yml`: za produkciju obavezno promijenite
`SESSION_SECRET` i `POSTGRES_PASSWORD` (na oba mjesta u fajlu), a `SEED_ON_START`
postavite na `"0"` kada demo podaci više nisu potrebni. Podaci žive u imenovanim
volume-ima `zev-pgdata` (baza) i `zev-storage` (generisani dokumenti).

> Napomena: Docker konfiguracija je pažljivo pripremljena i validirana
> (`docker compose config`, sintaksa, idempotentan seed), ali sam build slike nije mogao
> biti izvršen u razvojnom sandbox okruženju jer su registry-ji slika tamo blokirani.
> Ako build kod vas zapne, javite tačnu poruku greške.

## Instalacija (ručno, bez Dockera)

Preduslovi: Node.js ≥ 20, PostgreSQL ≥ 14.

```bash
# 1. baza
createuser zev --pwprompt          # lozinka npr. zev_dev_password
createdb zev  -O zev
createdb zev_test -O zev           # za testove

# (ili u psql)
#   CREATE USER zev WITH PASSWORD 'zev_dev_password' CREATEDB;
#   CREATE DATABASE zev OWNER zev;  CREATE DATABASE zev_test OWNER zev;

# 2. aplikacija
npm install
cp .env.example .env               # uredite DATABASE_URL i SESSION_SECRET

# 3. šema + demo podaci
npm run db:migrate                 # primjenjuje prisma/migrations
npm run db:seed                    # realistični demo podaci

# 4. pokretanje
npm run dev                        # http://localhost:3000
# ili produkcijski:
npm run build && npm start
```

### Migracije bez pristupa binaries.prisma.sh

`scripts/migrate.mjs` pokreće **službeni Prisma schema engine u WASM izdanju** (paket sa npm-a),
pa migracije rade i u okruženjima bez pristupa `binaries.prisma.sh`. Direktoriji i tabela
`_prisma_migrations` su standardni, pa na mašini s normalnim pristupom mreži možete
koristiti i `npx prisma migrate dev`.

| Komanda | Radnja |
|---|---|
| `npm run db:migrate` | primijeni neprimijenjene migracije (kao `migrate deploy`) |
| `npm run db:migrate:new <naziv>` | generiši novu migraciju iz izmjena šeme |
| `npm run db:reset` | obriši šemu + primijeni sve + (ručno) `npm run db:seed` |

## Deployment na Vercel (ili bilo koji Node hosting bez Dockera)

Aplikacija je konfigurabilno prenosiva preko više okruženja — Docker self-host
(podrazumijevano, iznad), Vercel, ili bilo koji drugi Node ≥ 22 hosting — bez izmjene koda,
samo promjenom konfiguracije. Puna analiza i odluke: `Plans/deployment-portability-plan.md`.

### Redoslijed

Migracija **prije** deploy-a aplikacije, ne poslije — nova verzija koda očekuje novu šemu, pa
migracije moraju biti unazad kompatibilne sa **prethodnom** verzijom koda tokom prozora između
ova dva koraka:

```bash
# 1. lokalno ili u CI, protiv produkcione baze
npm run db:migrate

# 2. deploy aplikacije (npr. `vercel deploy --prod`, ili push na repo povezan sa Vercel-om)
```

Ne migrirati unutar platforminog build koraka: `scripts/migrate.mjs` zahtijeva
`@prisma/schema-engine-wasm` (devDependency, dostupan pri build-u, ali ne u production
install-u), a build se dešava i za preview/branch deployment-e — automatska migracija u
build koraku bi značila da PR preview može migrirati produkcionu bazu.

### Varijable okruženja

Pun spisak sa objašnjenjima je u `.env.example`; sljedeće su posebno bitne van Dockera (gdje
`docker-compose.yml` već postavlja razumne vrijednosti umjesto vas):

| Varijabla | Obavezno? | Napomena |
|---|---|---|
| `DATABASE_URL` | da | Pooled connection string (npr. preko platforminog PgBouncer-a/Neon/Supabase poolera) |
| `MIGRATE_DATABASE_URL` | ne | Direktan (unpooled) connection string za `npm run db:migrate` — pooler u transaction modu ne podržava DDL/advisory lock-ove koje migracioni engine koristi. Bez ovoga koristi se `DATABASE_URL`. |
| `DB_POOL_MAX` | ne | Ograničava veličinu `pg` connection pool-a po instanci (podrazumijevano 10). Bitno na serverless-u, gdje više istovremenih instanci × neograničenih 10 konekcija svaka može iscrpiti limit baze — ako `DATABASE_URL` već ide preko poolera (gornji red), ovo obično nije potrebno. |
| `SESSION_SECRET` | da | `openssl rand -hex 32` |
| `APP_URL` | **da, u produkciji** | Javan URL aplikacije (linkovi, QR kodovi, e-mailovi) — startup sada puca sa jasnom greškom ako nedostaje, umjesto da tiho generiše neispravne linkove |
| `EMAIL_PROVIDER` | ne (podrazumijevano `mock`) | `mailjet` za pravi e-mail — vidi §„Šta je mock" niže |
| `MAILJET_API_KEY` / `MAILJET_API_SECRET` / `MAILJET_FROM_EMAIL` | samo uz `EMAIL_PROVIDER=mailjet` | vidi §„Šta je mock" niže |
| `MAX_UPLOAD_MB` | ne (podrazumijevano `4`) | Ostaviti na `4` na Vercel-u — serverless Function-e odbijaju tijelo zahtjeva preko 4.5 MB bez obzira na ovu vrijednost |
| `FONT_DIR` | ne | Override lokacije PDF fontova ako platforma ne poštuje `outputFileTracingIncludes` iz `next.config.ts` |
| `STORAGE_DIR` | ne | Samo za nazad-kompatibilno čitanje dokumenata generisanih prije prelaska skladišta u Postgres — nebitno za nov deployment |

### Šta NE treba podešavati

- **Object storage (S3/R2/MinIO)** — dokumenti i prilozi žive u Postgres bazi
  (`DocumentBlob`/`AttachmentBlob`), ne na disku ni u eksternom storage-u.
- **`DEPLOYMENT_TARGET` ili slična platformska varijabla** — ne postoji; svaka opcija
  (storage, e-mail provajder, upload limit...) se bira nezavisno, kao iznad.
- **Migracija unutar platforminog build koraka** — vidi §„Redoslijed" iznad.

### Health check

`GET /api/health` vraća `{ status: "ok" | "error", version }`, bez autentikacije i bez
detalja o konekciji — provjerava samo dohvatljivost baze (`SELECT 1`). Koristi ga i
`docker-compose.yml` (healthcheck za `app` servis) i svaka PaaS platforma koja radi probe.

## Demo nalozi (nakon `npm run db:seed`)

| Uloga | E-mail | Lozinka |
|---|---|---|
| Predsjednik ZEV | `predsjednik@zev.ba` | `Lozinka123!` |
| Računovođa | `racunovodja@zev.ba` | `Lozinka123!` |
| Vlasnik (Ana Savić) | `vlasnik@zev.ba` | `Lozinka123!` |
| Vlasnik (Marko Jovanović) | `marko@zev.ba` | `Lozinka123!` |
| Vlasnik/suvlasnik (Nikola Ilić) | `nikola@zev.ba` | `Lozinka123!` |

Seed ostavlja prijedlog **P-<godina>-02 otvoren za glasanje**: lični linkovi i verifikacioni
kodovi vide se u *Podešavanja → Poslate poruke* (mock e-mail outbox).

## Testovi i provjere

```bash
npm test            # 62 Vitest testa (prava pristupa, glasanje, obračuni, uplate, planovi, audit)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test:e2e    # Playwright smoke (zahtijeva pokrenut server + seed)
```

Testovi koriste `TEST_DATABASE_URL` (baza se resetuje pri svakom pokretanju).

## Šta je mock / poznata ograničenja

* **E-mail i Viber su podrazumijevano mock provajderi** (`EMAIL_PROVIDER=mock`,
  `VIBER_PROVIDER=mock`). Poruke se upisuju u outbox (`NotificationMessage`) sa
  simuliranim događajima isporuke (sent/delivered/seen); kompletan tok sjednica i
  glasanja radi bez stvarnih kredencijala. Viber i dalje nema pravi provajder — bot API
  šalje poruke **pretplaćenim** korisnicima, pa automatsko objavljivanje u proizvoljne
  privatne Viber grupe nije podržano zvaničnim API-jem.
  * **E-mail ima i pravog provajdera — Mailjet** (`EMAIL_PROVIDER=mailjet`,
    `src/server/notifications/mailjetEmail.ts`). Podešavanje:
    1. Napravite nalog na [mailjet.com](https://www.mailjet.com/) i verifikujte
       pošiljaočevu adresu/domen (Account Settings → Sender addresses & domains) —
       Mailjet odbija slanje sa neverifikovane adrese.
    2. API key i secret: Account Settings → REST API → API Key Management.
    3. U `.env` postavite `EMAIL_PROVIDER="mailjet"`, `MAILJET_API_KEY`,
       `MAILJET_API_SECRET` i `MAILJET_FROM_EMAIL` (verifikovana adresa iz koraka 1).
    4. Mailjet ne šalje delivery/seen callback-ove bez zasebno podešenog Event API-ja
       (van obima) — uspješno slanje bilježi samo `"sent"` događaj, za razliku od mock
       provajdera koji simulira i `delivered`/`seen`.
    5. Neuspjeli pokušaji **ne** dobijaju automatski retry (`retryFailed()` postoji, ali
       nema pozivaoca — zakazivanje je van obima dok se ne uvede platformski scheduler).
* Elektronsko odobravanje je **evidentirano elektronsko izjašnjavanje sa dokazima**, ne
  kvalifikovani elektronski potpis (tako je i označeno korisnicima).
* Nema obračuna zatezne kamate (parametar postoji, isključen — čeka pravnu potvrdu).
* Nije zakonsko knjigovodstvo: bez dvojnog knjigovodstva, kontnog plana, glavne knjige,
  bilansa — operativna evidencija + CSV izvoz za eksternog računovođu.
* Prilozi (fotografije uz prijave kvarova itd.) imaju model (`Attachment`), ali upload UI
  nije uključen u MVP obim.
* Jedna ZEV po instalaciji (multi-tenant SaaS je svjesno van obima; slojevi su odvojeni
  tako da se kasnije može dodati bez prerade domena).
* MFA je pripremljena arhitekturno (sesije u bazi, verifikacioni kodovi), nije uključena.

## Backlog za produkcijsko očvršćavanje

1. Pravna revizija: kvorumi/većine po tipu odluke, snaga e-izjašnjavanja, rokovi čuvanja,
   obavezni sadržaj dokumenata (vidi `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` §6).
2. Stvarni e-mail (SMTP/API) i Viber bot provajder + worker sa retry/backoff redom.
3. MFA (TOTP) i politika lozinki; „zaboravljena lozinka" tok.
4. Upload priloga (skladište + antivirus + potpisani URL-ovi sa istekom).
5. HTTPS/HSTS/CSP zaglavlja na reverse proxy-ju; rate limiting na nivou infrastrukture
   (trenutno u procesu aplikacije).
6. Automatsko izvršavanje politike retencije (brisanje IP hash metapodataka nakon roka).
7. Backup/restore automatizacija (pg_dump raspored + testirana procedura vraćanja;
   dokumentovano u ARCHITECTURE.md §Backup).
8. Praćenje događaja povrede podataka (breach log postoji kao audit; dodati alarmiranje).
9. Penetracioni test tokova glasanja i izolacije vlasnika.
10. Izvoz kompletnog paketa podataka vlasnika (GDPR-stil „data export") — djelimično
    pokriveno karticom vlasnika.
