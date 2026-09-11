# Automatsko preuzimanje bankovnih izvoda sa Gmail-a i „učenje" formata izvoda — plan za pregled

**Status: PLAN, implementacija nije počela.** Nastalo na zahtjev korisnika (2026-09-11):
*"Currently bank statements are delivered to a gmail address, so I would like to have those downloaded automatically from gmail, processed in the application and prepared for mapping for the president or accountant to sort. What would it take from the gmail side and how can we achieve this. Also, different ZEV's will have different banks, and therefore different formats of bank statements. Can we have the feature that will be able to 'learn' the format based on a couple of examples."*

Izrađeno plansko-analitičkim prolazom (Opus model, plan-only, bez pisanja koda), zasnovano na čitanju stvarnog koda projekta i na **provjeri aktuelnih Google pravila kroz pretragu** (a ne po sjećanju — Google je konzolu i pravila mijenjao, i nekoliko činjenica ispod nije ono što bi se očekivalo). Svi izvori su navedeni u §10.

---

## 0. Rezime — pročitati prije ostatka

Tvoja dva zahtjeva su u stvari **tri različita problema**, i vrijedi ih razdvojiti jer imaju vrlo različitu cijenu:

1. **Kako fajl doći sa Gmail-a** — tehnički rješivo, ali cijena nije u kodu nego u **Google podešavanju** (§2).
2. **Šta znači „automatski" u aplikaciji koja nema nijedan pozadinski posao** — ovo je arhitekturna odluka, ne detalj (§3).
3. **Kako pročitati izvod banke koju aplikacija ne poznaje** — ovdje je stvarni trud, i ovdje treba najviše pažnje (§5).

Pet nalaza koji određuju cijeli plan:

> **(1) Gmail je samo novi *dostavljač fajla*. Ništa nizvodno se ne mijenja.**

Postojeći tok „parsiraj → čovjek pregleda i ispravi → commit" (`payments.ts:240` `importPdfPreview` → `payments.ts:338` `commitPdfImport`) **ostaje netaknut**. Gmail ne dobija svoj paralelni put do baze. Komentar u kodu je tu vrlo izričit (`payments.ts:198-204`, `bankStatementPdf.ts:12-15`): *"Never wire this straight into a 'commit' path."* To je tvrdo pravilo ovog projekta i ovaj plan ga ne dira. Automatizuje se **samo dostava fajla i predlog mapiranja** — nikad upis uplate.

> **(2) Najvažnija provjerena činjenica: `gmail.readonly` je kod Google-a „restricted" scope — najstroža kategorija, ista kao pun pristup pošti.**

Ne „sensitive", nego **restricted** ([Google: Restricted Scopes](https://support.google.com/cloud/answer/13464325?hl=en)). To normalno znači obaveznu Google verifikaciju + **godišnju sigurnosnu provjeru (CASA) kod vanjskog ocjenjivača**. **Ali postoji izuzetak koji nas pokriva:** Google izričito kaže da verifikacija nije potrebna *"if you are the only user of your app or if your app is used by only a few users, all of whom are known personally to you"* ([Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)). To je tačno naš slučaj — nekoliko ZEV-ova, sve tvoji nalozi. Dakle: **nema verifikacije, nema CASA troška, ali ima ekran „aplikacija nije verifikovana" kroz koji se svaki put prolazi ručno pri povezivanju.**

> **(3) Druga provjerena činjenica, koja je „ubila" mnoge male integracije: ako aplikacija ostane u statusu „Testing", refresh token umire za 7 dana.**

Google: *"A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of 'Testing' is issued a refresh token expiring in 7 days"* ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)), i *"Authorizations by a test user will expire seven days from the time of consent"* ([Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en)). Znači: u „Testing" statusu bi morao **svake nedjelje ponovo klikati povezivanje za svaki ZEV**. Neupotrebljivo.

Rješenje: aplikacija se prebaci u status **„In production" bez verifikacije**. Tada token ne ističe po rasporedu, a cijena je: ekran upozorenja pri povezivanju + **trajno ograničenje na 100 naloga u životu projekta** (nikad se ne resetuje). Za nekoliko ZEV-ova to je više nego dovoljno. **Ova jedna činjenica diktira cijelu proceduru u §2.6 — i zato §2 nije „administrativni dodatak" nego glavni dio ovog plana.**

> **(4) „Učenje formata" — iskreno preimenovanje: 90% koristi je u tome da aplikacija *zapamti* ono što je knjigovođa podesio jednom.**

To danas **ne radi**, i to je čista praznina, ne nedostatak inteligencije. Mapiranje kolona se **ponovo prekucava pri svakom uvozu** (`uplate/page.tsx:43-53` gradi `mapping` iz polja forme, `uplate/page.tsx:112-122` su ta polja sa hardkodiranim `defaultValue`). Mapiranje se **jeste** upisuje u `BankImportBatch.mapping` (`payments.ts:154`, `schema.prisma:1019`) — ali samo kao revizorski trag, i **nikad se ne čita natrag**. Grep to potvrđuje: nijedno mjesto u `src/` ne čita `BankImportBatch.mapping`.

Dakle Faza 1 („zapamti profil po banci/računu") nije zamjena za pravo učenje — ona je **funkcionalnost koja je pola napravljena i stoji neiskorišćena**. Pravo zaključivanje šablona i LLM su Faza 3/4, i **uslovni** su: grade se samo ako se Faza 1 u praksi pokaže nedovoljnom.

> **(5) Preporuka za „automatski": u prvoj fazi dugme „Provjeri Gmail sada", ne pozadinski tajmer.**

Ne iz lijenosti. Aplikacija **nema nijedan mehanizam za pozadinske poslove** — grep za `setInterval`, `cron`, `bullmq`, `instrumentation` u `src/` daje **nula pogodaka**. Uvođenje tajmera je nov koncept u ovoj bazi koda (§3.3). A pošto je **ljudski pregled ionako obavezan prije svake uplate**, razlika između „izvod je u aplikaciji 30 sekundi nakon što je stigao mejl" i „izvod je u aplikaciji kad knjigovođa otvori ekran uplata" je **praktično nula** — jer u oba slučaja čeka čovjeka. Automatika ispred obaveznog ljudskog koraka ne štedi vrijeme, samo dodaje rizik. Tajmer se dodaje u Fazi 2, kad se sam mehanizam preuzimanja dokaže.

---

## 1. Problem — sa dokazima iz koda

### 1.1 Izvod se danas ručno skida iz Gmail-a i ručno kači

Ne postoji nikakav ulaz osim `<input type="file">`:
- CSV: `uplate/page.tsx:105` — `<input name="file" type="file" accept=".csv,text/csv" required>`
- PDF: `src/components/pdf-statement-import.tsx` (277 linija klijentske komponente za pregled), preko `src/server/actions/bankPdfImport.ts:14` `parsePdfPreviewAction(formData)` koja čita `formData.get("file") as File`.

Nijedna funkcija u `src/server/` ne prima izvod iz ikakvog drugog izvora. Nema HTTP klijenta ka bilo kojoj vanjskoj usluzi.

### 1.2 Mapiranje kolona se ne pamti — praznina, sa dokazom

`CsvMapping` (`payments.ts:71-86`) ima 9 polja: `dateCol`, `amountCol`, `payerCol`, `referenceCol`, `purposeCol?`, `dateFormat`, `delimiter`, `skipRows`, `decimalComma`. `DEFAULT_CSV_MAPPING` (`payments.ts:88-98`) je *nagađanje za jednu banku* (`delimiter: ";"`, `skipRows: 1`, `decimalComma: true`, kolone 0/1/2/3).

`importBankCsv` ga spaja sa onim što pošalje forma (`payments.ts:127`: `{ ...DEFAULT_CSV_MAPPING, ...input.mapping }`). A forma ga gradi **ispočetka pri svakom uvozu** (`uplate/page.tsx:43-53`). Ako ZEV „A" ima banku sa zapetom kao separatorom i iznosom u 5. koloni, knjigovođa to prekuca **svaki mjesec, svaki put**. Prva pogrešna cifra = pogrešno parsiran izvod.

Za PDF je i gore: `commitPdfImport` upisuje `mapping: { source: "pdf-nova-banka" }` (`payments.ts:381`) — konstantu, ne konfiguraciju. Nema šta da se pamti jer nema šta da se podesi.

**Zaključak: „profil formata" nije nova ideja u ovoj aplikaciji. To je postojeći `CsvMapping` kojem fali jedna tabela i dva čitanja.**

### 1.3 PDF parser poznaje tačno jednu banku, i to hardkodirano

`src/server/services/bankStatementPdf.ts` (154 linije) je cijela posvećena jednoj banci. Zaglavlje fajla (linije 1-2) to i kaže: *"Nova Banka format, confirmed against a real statement sample"*.

Zašto se ne može „samo dodati druga banka": parser ne čita kolone, nego **razdvaja slijepljeni tekst pogađanjem oblika**:
- `parseAmountLine` (`bankStatementPdf.ts:54-69`) traži `/^(\d{6,})(.*)$/` — red **mora** počinjati sa 6+ cifara (broj računa partnera) — pa onda uzima **posljednja dva** novčana tokena po obrascu `MONEY_TOKEN = /\d{1,3}(?:,\d{3})*\.\d{2}/g` (`bankStatementPdf.ts:47`) i tumači ih kao zaduženje i odobrenje.
- `parsePurposeLine` (`bankStatementPdf.ts:72-76`) traži `/^(\d+)\s*\/\s*(.*)$/`.
- `parseOwnAccountNumber` (`bankStatementPdf.ts:112-116`) traži `\d{2,4}-\d{6,}-\d{1,3}` — domaći format računa kako ga **ta** banka štampa.
- `parseNovaBankaStatement` (`bankStatementPdf.ts:119-147`) pretpostavlja tačan **redoslijed tri linije**: svrha, iznosi, pa (opciono) RBR.

Druga banka koja stavlja datum u red, ili zapetu kao decimalni znak, ili ima jednu kolonu iznosa sa predznakom — **ne prolazi ni kroz prvi regex**. Danas bi se za nju pisala nova funkcija od ~150 linija. To je tačno ono što tražiš da izbjegneš.

**Jedna dobra vijest:** `extractPdfText` (`bankStatementPdf.ts:78-81`) radi na **tekstualnom sloju** PDF-a, ne na slici. Izvodi koje banka generiše digitalno imaju taj sloj, pa je izvlačenje teksta **tačno**, nije OCR. Problem nije čitljivost teksta, nego **raspored** — a to je bitno lakši problem.

### 1.4 Nema nijednog mehanizma za zakazivanje

Grep kroz `src/` za `setInterval`, `cron`, `node-cron`, `bullmq`, `instrumentation`: **nula pogodaka**. `next.config.ts` je prazan (samo tip). `src/instrumentation.ts` ne postoji. `docker-entrypoint.sh` čeka bazu, pusti migracije, opciono seed, pa `exec npm start` — jedan proces, bez ičega uz njega.

Dakle „automatski" doslovno nema gdje da živi dok se to ne napravi.

### 1.5 Nema nijedne prave vanjske integracije, ni mjesta za šifrovane tajne

Ovo je „nema prethodnika" rizik i treba ga izgovoriti otvoreno:
- `getEmailProvider()` (`notifications/providers.ts:69-79`) i `getViberProvider()` (`:81-91`) **bacaju grešku** za sve osim `"mock"`. Mock provajder samo upiše u `NotificationMessage` outbox i simulira dostavu.
- Nema nijedne `fetch()` prema vanjskom API-ju u `src/server/`.
- Nema šifrovanja tajni. Sve podešavanje je **čist tekst** u `.env` / `docker-compose.yml` (`SESSION_SECRET: change-me-in-production-...`, `EMAIL_PROVIDER: mock`).
- `Setting` model (`schema.prisma:1534-1542`) je `Json` po ključu, bez šifrovanja — namijenjen pravnim/finansijskim parametrima (`src/lib/settings-defaults.ts`), **nije mjesto za token**.
- Jedino postojeće „hešovanje" je `bcrypt` za lozinke (`src/server/auth/password.ts`) — a to je **jednosmjerno**, dok token mora da se dešifruje. Nema šablona za kopiranje.

Dakle: **Gmail bi bila prva prava vanjska integracija u ovoj aplikaciji, i prvo mjesto gdje se čuva tajna koju treba dešifrovati.** Oba obrasca treba izmisliti (§4.4).

### 1.6 Šta je danas dobro i mora ostati

Ovo nabrajam da se u §3-§5 vidi šta je *ograničenje*, a ne propust:

1. **Dvostepeni tok za PDF.** `importPdfPreview` **ne piše ništa** — vraća redove za pregled. `commitPdfImport` piše **tačno ono što je čovjek potvrdio**. Razdvojeno je i na nivou server akcija (`bankPdfImport.ts:1-6`) upravo zato.
2. **Automatsko predlaganje uparivanja, sa pragom.** `scoreInvoiceMatch` predlaže fakturu samo ako je `best.score >= 70` (`payments.ts:288`); za troškove `>= 50` (`payments.ts:308`). Ispod praga: prazno, čovjek bira. **Ovaj obrazac — „predloži samo kad si siguran, ostalo ostavi čovjeku" — je tačno obrazac koji treba primijeniti i na prepoznavanje formata** (§5.6).
3. **Provjera da izvod pripada tom računu.** `payments.ts:317-319` upoređuje cifre iz `MoneyAccount.iban` sa brojem računa pročitanim sa izvoda i postavlja `accountMismatch`. **Ovo je već napola gotovo usmjeravanje za zajednički inbox** (§3.1) — i to bolje od usmjeravanja po pošiljaocu.
4. **Append-only knjiga.** `PaymentAllocation` je append-only preko DB trigera; ispravke su novi negativni redovi (`payments.ts:1-2`). Ništa u ovom planu ne zahtijeva mijenjanje potvrđene uplate — sve novo stanje je **pre-commit** stanje.
5. **Zaštita na servisnom sloju, ne u UI.** `requireRole(actor, "ACCOUNTANT")` + `requireZev(actor)` na ulazu svake funkcije uvoza (`payments.ts:124-125`, `:244-245`, `:357-358`). `guards.ts` komentar: *"hiding a button in the UI is never the enforcement point."*

---

## 2. (A) Šta treba na Google strani — provjerene činjenice

### 2.1 Šta se kreira

| Korak | Gdje | Napomena |
|---|---|---|
| Google Cloud projekt | console.cloud.google.com | besplatno; jedan projekt je dovoljan za sve ZEV-ove |
| Uključiti **Gmail API** | APIs & Services → Library | bez ovoga svaki poziv vraća 403 |
| **Google Auth Platform** podešavanje | nova sekcija konzole | zamijenila stari „OAuth consent screen" ekran |
| **OAuth 2.0 Client ID** tipa *Web application* | Auth Platform → Clients | daje `client_id` + `client_secret` |
| Redirect URI | u tom klijentu | npr. `http://localhost:3000/api/gmail/oauth/callback` |

Google je 2025. preuredio taj dio konzole u **Google Auth Platform** sa pet stranica: **Branding, Audience, Clients, Data Access, Verification Center** ([Get started with the Google Auth Platform](https://support.google.com/cloud/answer/15544987?hl=en)). Stariji vodiči na internetu govore o „OAuth consent screen" — to je ista stvar, novo ime i raspored.

**Važno i dobro:** `http://localhost` je dozvoljen redirect URI za Google OAuth — **javni HTTPS nije potreban za samo povezivanje**. Pošto ti aplikaciju otvaraš na `http://localhost:3000` na svojoj Windows mašini, povezivanje radi bez domena, bez reverse proxy-ja, bez sertifikata. Ovo je razlog zbog kojeg OAuth uopšte dolazi u obzir u tvom rasporedu.

### 2.2 Koji scope je minimalno dovoljan — i jedan zaključak koji šteti manje nego što se očekuje

| Scope | Šta daje | Treba li nam |
|---|---|---|
| `gmail.metadata` | zaglavlja, **bez tijela i bez priloga** | **ne** — ne može skinuti prilog |
| `gmail.readonly` | čitanje poruka **i priloga** | **da, dovoljno** |
| `gmail.modify` | + označavanje pročitano / dodavanje labele | ne u Fazi 1 |
| `https://mail.google.com/` | sve, uključujući brisanje | nikad |

Uobičajena pretpostavka je da nam treba `gmail.modify` — da bi se poruka označila kao obrađena i ne bi se uvozila dvaput. **Ali nam ne treba**, i to zbog nečega što ionako moramo napraviti: **evidenciju obrađenih `messageId`-jeva u Postgresu** (§4.3). Ta evidencija je obavezna bez obzira na Gmail, jer idempotencija mora da preživi restart kontejnera — a Gmail labela to ne garantuje (mreža otkaže između „skinuo sam prilog" i „označio sam labelu"). Kad već imamo evidenciju u bazi, Gmail labela je **suvišna**, a scope je veći.

**Preporuka: `gmail.readonly`, jedini scope.** Aplikacija u tvoj inbox **ne piše ništa** — ne mijenja stanje pročitanosti, ne dodaje labele, ne briše. To je i lakše objasniti (i sebi i bilo kome kasnije).

Cijena te odluke: u Gmail-u se **ne vidi** koja je poruka obrađena — to se vidi samo u aplikaciji. Ako ti to zatreba, `gmail.modify` + labela „ZEV/obrađeno" je kasniji dodatak; **klasifikacija scope-a se ne mijenja** (oba su „restricted"), pa to nije pravno/administrativno pitanje, samo pitanje najmanjeg potrebnog ovlašćenja.

### 2.3 Klasifikacija, verifikacija i CASA — i izuzetak koji nas spasava

Provjereno, i nije ono što bi se pretpostavilo: **`gmail.readonly` i `gmail.modify` su „restricted" scope-ovi** — ista najstroža kategorija kao `https://mail.google.com/` ([Restricted Scopes](https://support.google.com/cloud/answer/13464325?hl=en)). Pun spisak restricted Gmail scope-ova: `gmail.readonly`, `gmail.metadata`, `gmail.modify`, `gmail.insert`, `gmail.compose`, `gmail.settings.basic`, `gmail.settings.sharing`. **Nema „bezopasne" varijante čitanja Gmail-a.**

Za javnu aplikaciju to znači: Google verifikacija + **godišnja CASA sigurnosna provjera kod vanjskog ocjenjivača** ([Security Assessment](https://support.google.com/cloud/answer/13465431?hl=en)) — trošak reda hiljada dolara godišnje. **To za nas ne važi.**

Google izričito navodi izuzetke ([Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)):
- *"If you are the only user of your app or if your app is used by only a few users, all of whom are known personally to you"* — **ovo je tačno naš slučaj.**
- aplikacija u statusu „Testing" (samo test korisnici)
- aplikacija sa „Internal" tipom, unutar jedne Workspace organizacije

Dakle: **nema verifikacije, nema CASA, nema troška.** Cijena je ekran „Google hasn't verified this app" pri svakom povezivanju, i trajno ograničenje na 100 naloga (§2.5).

**Lični Gmail nalog je dovoljan. Google Workspace nije potreban.** Workspace bi dao „Internal" tip (bez ekrana upozorenja), ali za nekoliko ZEV-ova to je plaćanje pretplate da se izbjegne jedan klik.

### 2.4 Zamka sa 7 dana — i zašto određuje proceduru

Ovo je najskuplja greška koju možeš napraviti u podešavanju, pa je izdvajam:

**Ako projekt ostane u statusu „Testing", refresh token ističe za 7 dana.** Google: *"...publishing status of 'Testing' is issued a refresh token expiring in 7 days"* ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)) i *"Authorizations by a test user will expire seven days from the time of consent"* ([Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en)). Izuzetak važi samo za scope-ove imena/e-maila/profila — **ne za Gmail**.

Praktično: aplikacija bi radila nedjelju dana, pa bi svaki ZEV pao sa `invalid_grant`, i ti bi ručno ponovo povezivao. **Svake nedjelje. Za svaki ZEV.**

**Rješenje:** u **Audience** postaviti status na **„In production"** (bez verifikacije). Tada token ne ističe po rasporedu. Ostaje ekran upozorenja i ograničenje od 100 naloga.

### 2.5 Ostali načini na koje token umire — i šta aplikacija mora da uradi

Google navodi ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)):

| Uzrok | Naša odbrana |
|---|---|
| **Korisnik promijeni lozinku Google naloga, a token sadrži Gmail scope** | *nikakva* — token se **poništava**. **Mora se ponovo povezati.** Ovo je najvjerovatniji uzrok u praksi. |
| Token nije korišćen 6 mjeseci | poll (i kad nema pošte) drži token živim |
| Korisnik odobri pristup u „Testing" statusu | §2.4 — biti u „In production" |
| Preko 100 refresh tokena za jedan client ID | nerelevantno (nekoliko naloga) |
| Korisnik povuče pristup | nema odbrane (i ne treba je) |
| „Unverified app" ograničenje: **100 novih naloga u životu projekta, ne resetuje se** ([Unverified app screen](https://support.google.com/cloud/answer/7454865)) | nekoliko ZEV-ova — daleko od granice |

**Zahtjev za dizajn iz ovoga:** kad token pukne, aplikacija to mora **jasno pokazati** („Gmail veza za ZEV X je prekinuta — povežite ponovo"), a **ne** tiho prestati da provjerava. Tiha tišina bi bila najgori ishod: mislio bi da radi mjesecima. Stoga `GmailConnection.lastError` + `lastCheckedAt` + vidljiv status na ekranu (§4.2) **nisu ukras, nego dio funkcionalnosti.**

### 2.6 Šta ti konkretno klikaš (jednom za sve ZEV-ove)

Namjerno napisano kao lista za neprogramera. Radi se **jednom**; po ZEV-u se kasnije samo klikne „Poveži".

**Priprema (jednom):**
1. `console.cloud.google.com` → prijava → **New Project**, npr. „zev-app-gmail".
2. **APIs & Services → Library** → „Gmail API" → **Enable**.
3. **Google Auth Platform → Branding**: ime aplikacije („ZEV upravnik"), tvoj e-mail za podršku, tvoj e-mail kao developer contact.
4. **Audience**: User type = **External**.
5. **Data Access**: dodaj **jedan** scope — `https://www.googleapis.com/auth/gmail.readonly`. (Nije na spisku „ponuđenih" → „Add scope" / ručni unos.)
6. **Clients** → Create client → **Web application** → Authorized redirect URI: `http://localhost:3000/api/gmail/oauth/callback` → zapiši **Client ID** i **Client secret**.
7. **Audience → Publish app** → status **„In production"**. **Ovaj korak nemoj preskočiti** — vidi §2.4. Google će ponuditi „Prepare for verification"; **to se ne popunjava** (§2.3).
8. U `docker-compose.yml` (ili `.env`) upisati `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, i novi `SECRETS_KEY` (§4.4) → `docker compose up -d --build app`.

**Po ZEV-u (svaki put kad dodaješ zajednicu):**
9. Uloguj se u aplikaciju kao PRESIDENT/ACCOUNTANT tog ZEV-a → *Uplate → Gmail veza* → **„Poveži Gmail"**.
10. Google pita za nalog → izaberi Gmail adresu na koju **dolaze izvodi za taj ZEV**.
11. Pojavljuje se **„Google hasn't verified this app"** → **Advanced** → **„Go to ZEV upravnik (unsafe)"**. (Ovo je očekivano i normalno za neverifikovanu aplikaciju — §2.3. „unsafe" se odnosi na to da Google nije pregledao aplikaciju, a ne na to da nešto nije u redu.)
12. Odobri „Read your email messages and settings" → vratiš se u aplikaciju → status „Povezano: ime@gmail.com".

**Koliko traje:** koraci 1-8 realno 20-40 minuta prvi put. Koraci 9-12: manje od minute po ZEV-u.

### 2.7 Ozbiljna alternativa koju vrijedi razmotriti: IMAP + App Password

Ovo **ne preporučujem kao prvo rješenje**, ali ga stavljam na sto jer je za samostalno hostovanu aplikaciju iznenađujuće razumno i **eliminiše cijeli §2.1-§2.6**.

Google je 2022. isključio „less secure apps" za lične naloge, ali **App Passwords za IMAP i dalje rade** za lične Gmail naloge sa uključenom dvofaktorskom prijavom ([Nylas: Gmail App Password Setup](https://cli.nylas.com/guides/gmail-app-password-setup), [Mailbird 2026](https://www.getmailbird.com/gmail-oauth-changes-app-password-phase-out/) — ovaj drugi izvor izričito potvrđuje da IMAP+app password ostaje put za klijente bez OAuth-a, i **ne** navodi nikakvu objavu o ukidanju app passworda). Rok iz 2024. o kojem se pisalo odnosio se na **Workspace** naloge, ne na lične.

| | OAuth (`gmail.readonly`) | IMAP + App Password |
|---|---|---|
| Google Cloud projekt | potreban | **nije** |
| Auth Platform, scope-ovi, publish | potrebno | **nije** |
| Ekran „unverified app" | da, pri svakom povezivanju | **nema ga** |
| Zamka sa 7 dana | da (rješiva, §2.4) | **nema je** |
| Šta korisnik dobavi | klikanje kroz konzolu | **jedna 16-znakovna šifra** |
| Ograničenje pristupa | samo čitanje | **cijeli mejl nalog** (šalji/briši) |
| Umire kad | promjena lozinke, povlačenje | promjena lozinke, ručno povlačenje |
| Opoziv | Google → Third-party access | Google → App passwords → Remove |
| Nova zavisnost u projektu | OAuth klijent (može bez biblioteke) | **IMAP biblioteka** (`imapflow`/`node-imap`) |
| „Ako Google ovo ukine" | mala vjerovatnoća | **srednja** — Google godinama gura OAuth |
| Uslov | — | **obavezna 2FA na nalogu** |

**Ključna razmjena:** OAuth je **uže ovlašćenje ali više administracije**; App Password je **jedan klik ali šifra sa punim pristupom mejlu**.

**Moja preporuka:** OAuth kao **glavni put** — jer scope „samo čitanje" je materijalno bolji za nalog na koji dolaze bankovni izvodi, i jer je budućnosnije. **Ali:** ako se pri prvom pokušaju pokaže da je Google konzola prevelika muka po ZEV-u, IMAP je dostupan izlaz **bez mijenjanja ostatka plana** — jer sav kod nizvodno radi sa „pronašao sam prilog X u poruci Y", a ne sa Gmail-om (§4.1). Ovo je **P2** u §9.

---

## 3. (B) Arhitektura preuzimanja

### 3.1 Jedan inbox za sve ZEV-ove, ili jedan po ZEV-u?

Tvoja formulacija — *"delivered to a gmail address"*, **u jednini** — navodi na to da danas **jedna** adresa prima izvode za (potencijalno) više ZEV-ova. **To ne pretpostavljam — to je pitanje P1 u §9.** Ali plan mora raditi u oba slučaja, pa:

**Dizajn koji pokriva oba:** `GmailConnection` je vezan za **ZEV** (`zevId`), a ne globalan. Onda:
- **Jedna adresa po ZEV-u** → jedna veza po ZEV-u, svaka gleda svoj inbox, nema usmjeravanja. Najčistije.
- **Jedna zajednička adresa** → **ista adresa se poveže više puta, po jednom za svaki ZEV**, i svaka veza nosi svoja **pravila filtriranja** (§4.2: `queryFilter`, `senderFilter`, `subjectFilter`). Isti fizički inbox, različiti pogledi na njega.

Šema se **ne mijenja** između ova dva scenarija — mijenja se samo koliko redova stoji u tabeli i da li su filteri popunjeni. **Zato ovo pitanje ne blokira početak rada** (blokira samo tekst uputstva), i zato ga rješavam dizajnom a ne nagađanjem.

**Kako usmjeravati u zajedničkom inboxu — i ovdje je dobra vijest.** Naivno rješenje je po pošiljaocu/naslovu; to je krhko (ista banka, dva ZEV-a → identičan pošiljalac i naslov). **Pouzdano rješenje već postoji u kodu:** `payments.ts:317-319` čita broj računa **sa samog izvoda** i upoređuje ga sa `MoneyAccount.iban` (`schema.prisma:778`).

Dakle predlog: **usmjeravanje u dva nivoa.**
1. **Gruba mreža** — Gmail upit (`has:attachment newer_than:30d from:...`) samo da se smanji količina.
2. **Konačna odluka** — pročitaj broj računa sa izvoda i **traži `MoneyAccount` sa tim `iban`-om**. Račun određuje ZEV. Ako se broj ne nađe ili pripada drugom ZEV-u → prilog se ne usmjerava nego se **označi „nerazvrstano"** i čovjek kaže kome pripada (i ta odluka se pamti kao pravilo).

Ovo je isti obrazac kao `accountMismatch` — samo iskorišćen za usmjeravanje, a ne samo za upozorenje.

### 3.2 Push (watch + Pub/Sub) ili poll?

Provjerio sam nešto što je često nejasno: **Gmail `users.watch()` *ne* zahtijeva javni HTTPS endpoint.** Google topic može imati **pull** pretplatu koju aplikacija sama poziva ([Configure push notifications in Gmail API](https://developers.google.com/workspace/gmail/api/guides/push)): *"a webhook push (that is, an HTTP POST callback) or a pull (that is, initiated by your app)"*. Dakle nedostatak javnog endpointa **ne** eliminiše push automatski.

**Ali pull pretplata ga eliminiše iz drugog razlo— i to je važno vidjeti:** ako aplikacija ionako mora sama da zove Pub/Sub da pokupi obavještenja, onda **već postoji tajmer koji nešto povlači**. Push + pull pretplata je tada samo **poll nad drugim API-jem**, sa dodatkom:

| | Obično pollovanje (`messages.list`) | Watch + Pub/Sub pull |
|---|---|---|
| Javni HTTPS | nije potreban | nije potreban |
| Novi Google resursi | **nijedan** | Pub/Sub topic + pretplata + IAM za `gmail-api-push@system.gserviceaccount.com` |
| Novi scope/API | — | **+ Pub/Sub API** u projektu (još podešavanja u §2.6) |
| Održavanje | nema | **`watch()` se mora obnavljati najmanje svakih 7 dana** (dokumentacija preporučuje **dnevno**) → još jedan zakazani posao |
| Model rada | „ima li novog?" | `historyId` + `history.list` + `acknowledge()` |
| Kod | ~1 poziv | notably složenije (sinhronizacija historyId, potvrđivanje, oporavak od izgubljenog historyId) |
| Svježina | do intervala (npr. 15 min) | sekunde |
| Kvota | trivijalna (§3.4) | trivijalna |

**Preporuka: obično pollovanje. Push se ne gradi — ni sada, ni kasnije, osim ako se pojavi razlog koji danas ne vidim.**

Obrazloženje, a ne samo tvrdnja: **svježina ovdje ne vrijedi ništa.** Izvod koji dođe u aplikaciju za 5 sekundi umjesto za 15 minuta **i dalje čeka da knjigovođa otvori ekran, pregleda redove i klikne potvrdu** — jer je to obavezno (§1.6). Push, dakle, plaća 3 nova Google resursa, obavezno dnevno obnavljanje `watch()`-a i cijelu `historyId` mašinu — da bi ubrzao korak koji je ionako *ispred* ljudskog čekanja. To je pogrešna razmjena. **Ako se ne složiš — ovo je P4 u §9.**

### 3.3 Kako se „automatski" pojavljuje u aplikaciji — tri stepena

**(a) Ručno dugme „Provjeri Gmail sada" — Faza 1, preporuka**

Dugme na *Uplate* (ili *Uplate → Gmail*), vidljivo ACCOUNTANT/PRESIDENT-u. Klik → aplikacija se poveže, nađe nove poruke sa prilogom, skine priloge, upiše ih kao „na čekanju", i pokaže listu: *„3 nova izvoda čekaju pregled."*

Zašto ovo prvo:
- **Nijedan nov arhitekturni koncept.** Obična server akcija, kao sve ostalo u aplikaciji.
- **Odgovara postojećem obrascu projekta** — osjetljiv korak uvijek pokreće čovjek.
- **Greške su vidljive odmah.** Ako je token pukao (§2.5), to vidiš u trenutku klika, a ne kroz tri nedjelje tišine.
- **Testirljivo bez tajmera.** `vitest` test poziva funkciju direktno.
- **Dovoljno dobro.** Knjigovođa i danas ide na taj ekran da uveze izvod; sad tamo klikne jedno dugme manje-više isti broj puta, ali **bez otvaranja Gmail-a, bez skidanja i kačenja fajla, i bez prekucavanja mapiranja.** To je ~90% cijele koristi koju tražiš.

**(b) Tajmer u procesu aplikacije — Faza 2**

Next.js 15 podržava `src/instrumentation.ts` sa `register()` funkcijom koja se izvrši jednom pri startu servera — to je prirodno mjesto za `setInterval` (npr. na 15 minuta) koji zove istu funkciju kao dugme.

Šta pri tome treba svjesno prihvatiti:
- **Radi samo dok kontejner radi.** Isključiš računar → nema provjere. Za samostalni hosting na Windows mašini to je normalno, ali treba znati.
- **Zaključavanje.** Ako se `register()` izvrši više puta (dev režim, više instanci), dva tajmera rade paralelno. Rješenje: Postgres savjetodavno zaključavanje (`pg_advisory_lock`) ili `UPDATE ... WHERE lastCheckedAt < now() - interval`. Idempotencija iz §4.3 to ionako pokriva, ali dupli rad treba izbjeći.
- **Greška u tajmeru ne smije ubiti server.** Sve u `try/catch`, sve u `lastError`.

**(c) Vanjski zakazivač (Windows Task Scheduler → HTTP poziv) — alternativa za (b)**

Zaštićena ruta (`/api/gmail/poll` sa tajnim tokenom) koju zove Windows Task Scheduler. Prednost: zakazivanje van aplikacije, aplikacija ostaje bez stanja. Nedostatak: **još jedna stvar koju ti moraš podesiti na Windowsu**, a upravo to izbjegavamo. **Preporuka: (b), ne (c)** — ali (c) je iskrena rezerva ako se tajmer u procesu pokaže nestabilnim.

### 3.4 Kvota — nije problem, ali da bude zapisano

Gmail API ([Usage limits](https://developers.google.com/workspace/gmail/api/reference/quota?hl=en)): **80.000.000 jedinica kvote dnevno po projektu**, 1.200.000/min po projektu, 6.000/min po korisniku. Cijene: `messages.list` = 5, `messages.get` = 20, `messages.attachments.get` = 20, `history.list` = 2, `watch` = 100.

Naša potrošnja pri pollovanju na 15 min: 96 provjera/dan × 5 = **480 jedinica**, plus ~40 po novom izvodu. Za 10 ZEV-ova sa po 30 izvoda mjesečno: **ispod 10.000 jedinica dnevno** — oko **0,01%** dnevne kvote. Kvota je nebitna; ne treba je ni optimizovati.

---

## 4. (C) Model podataka

### 4.1 Vodeća odluka: Gmail je *ulaz*, ne paralelni tok

Najvažnija odluka u §4, i odgovor na tvoje pitanje „should a Gmail-sourced statement just become an input": **da, tačno tako.**

```
DANAS:   <input type=file> ──┐
                             ├──> importPdfPreview / importBankCsv ──> [pregled] ──> commitPdfImport
                             │
NOVO:    Gmail prilog ───────┘        (isti kod, isti ekran, isti commit)
```

Konkretno: nova tabela `IncomingStatement` čuva **skinuti fajl + odakle je došao + status**. Kad knjigovođa otvori red iz te tabele, poziva se **postojeća** `importPdfPreview(actor, { accountId, filename, buffer })` — samo što `buffer` dolazi sa diska umjesto iz forme. `commitPdfImport` se **ne dira uopšte**. `BankImportBatch` (`schema.prisma:1014`) i dalje ostaje jedini revizorski zapis uvoza, samo dobija jedno polje da kaže odakle je fajl stigao.

Posljedice ove odluke, sve pozitivne:
- Nula rizika za postojeći tok — ručno kačenje radi identično i poslije.
- `commitPdfImport` (jedino mjesto koje pravi uplate iz izvoda) **ne raste ni za jednu liniju** — invarijanta iz §1.6 je strukturno očuvana, ne samo „poštovana".
- Pravilo iz §1.6.1 se **ne može slučajno prekršiti**, jer Gmail kod ne zna za `commitPdfImport`.
- IMAP (§2.7) se kasnije dodaje kao drugi punilac iste tabele, bez ijedne izmjene nizvodno.

### 4.2 `GmailConnection` — jedna veza po ZEV-u

| Polje | Tip | Svrha |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `zevId` | `String` + relacija na `Zev` | izolacija tenanta, kao kod svih modela |
| `emailAddress` | `String` | koji je nalog povezan (prikazuje se u UI) |
| `provider` | `String @default("GMAIL_OAUTH")` | ostavlja mjesta za `"IMAP"` (§2.7) bez migracije |
| `refreshTokenEnc` | `String` | **šifrovan** refresh token (§4.4) |
| `accessToken` / `accessTokenExpiresAt` | `String?` / `DateTime?` | keš; može i da se ne čuva (traje ~1h) |
| `scope` | `String` | šta je stvarno odobreno — za dijagnostiku |
| `queryFilter` | `String?` | Gmail upit, npr. `has:attachment from:izvodi@banka.ba` |
| `senderFilter` / `subjectFilter` | `String?` | dodatna pravila za zajednički inbox (§3.1) |
| `defaultAccountId` | `String?` → `MoneyAccount` | na koji račun ide izvod kad se ne prepozna sa izvoda |
| `active` | `Boolean @default(true)` | pauziranje bez brisanja veze |
| `lastCheckedAt` | `DateTime?` | „kad je zadnji put provjereno" u UI |
| `lastError` | `String?` | **obavezno** — §2.5, tiha tišina je najgori ishod |
| `connectedById`, `createdAt` | | revizija |

`@@unique([zevId, emailAddress])` — jedna veza po ZEV-u po adresi; ista adresa **smije** da stoji u više ZEV-ova (§3.1).

### 4.3 `IncomingStatement` — evidencija obrađenog + idempotencija + čekaonica

Jedna tabela nosi tri posla; namjerno nije razdvojena, jer su to tri kolone istog reda.

| Polje | Tip | Svrha |
|---|---|---|
| `id` | `String @id` | |
| `zevId` | `String` | izolacija |
| `connectionId` | `String` → `GmailConnection` | odakle |
| `providerMessageId` | `String` | **Gmail `messageId`** |
| `providerAttachmentId` | `String?` | koji prilog (poruka može imati više) |
| `messageDate`, `fromAddress`, `subject` | | kontekst za čovjeka („od koga je ovo došlo") |
| `filename`, `mime`, `size`, `sha256`, `filePath` | | **isti obrazac kao `Attachment`** (`schema.prisma:1428-1450`); `filePath` pod `STORAGE_DIR` kao u `attachments.ts:65` |
| `accountId` | `String?` → `MoneyAccount` | rezultat usmjeravanja (§3.1); `null` = nerazvrstano |
| `profileId` | `String?` → `StatementFormatProfile` | koji profil je prepoznat (§5) |
| `status` | `String` | `PENDING` / `PARSED` / `IMPORTED` / `IGNORED` / `FAILED` |
| `parseError` | `String?` | zašto nije prošlo |
| `importBatchId` | `String?` → `BankImportBatch` | **veza na stvarni uvoz kad se potvrdi** |
| `fetchedAt`, `reviewedById`, `reviewedAt` | | revizija |

**Idempotencija:** `@@unique([connectionId, providerMessageId, providerAttachmentId])`. Poll uvijek prvo provjeri ovaj ključ i preskoči poznato. **Ovo je u Postgresu, ne u memoriji — pa preživljava restart kontejnera**, što je tvoj izričit zahtjev, i što Gmail labela (da smo išli na `gmail.modify`) ne bi garantovala (§2.2). Ako se ista poruka dva puta obradi zbog trke između dva tajmera, **DB ograničenje to odbija** — ne aplikativna logika.

**Dodatna zaštita:** `sha256` sadržaja. Ako banka pošalje **isti** izvod iz druge poruke (npr. reslanje), `messageId` je nov, ali heš je isti → upozorenje „ovaj izvod je već uvezen dana X, serija Y". Ovo je jeftino i sprečava duple uplate, što je najskuplja greška u ovoj aplikaciji.

### 4.4 Šifrovanje refresh tokena — i iskrena ograda

Nema šablona za kopiranje (§1.5). Predlog, najjednostavniji koji je ozbiljan:

- **AES-256-GCM** iz Node-ovog ugrađenog `node:crypto` — **bez nove zavisnosti**. (`attachments.ts:9` već uvozi `createHash` iz `node:crypto`, pa je obrazac uvoza poznat.)
- Ključ iz nove env varijable **`SECRETS_KEY`** (32 bajta hex, `openssl rand -hex 32`) — isti postupak kao za postojeći `SESSION_SECRET`.
- Novi mali modul `src/lib/secrets.ts`: `encryptSecret(plain): string` / `decryptSecret(enc): string`. Format: `v1:<iv_base64>:<tag_base64>:<ciphertext_base64>` — prefiks verzije da se ključ može rotirati bez migracije podataka.
- Ako `SECRETS_KEY` nije postavljen: **odbij da uspostaviš Gmail vezu sa jasnom greškom**, ne pravi „bez šifrovanja" varijantu. Tiho slabljenje je gore od odbijanja.

**Iskrena ograda, jer je važna:** ovo štiti od **jednog** konkretnog scenarija — da neko dobije pristup bazi (dump, backup fajl, ukradeni `zev-pgdata` volume) **bez** pristupa env konfiguraciji. To je stvarna korist i vrijedna je 40 linija koda. **Ne štiti** od nekoga sa pristupom samoj mašini ili kontejneru, jer je ključ tu, u istom `docker-compose.yml`. Prava zaštita tajni (vanjski vault) nije u opsegu samostalno hostovane aplikacije na jednom Windows računaru i ne bih je gradio. **Ovo treba svjesno prihvatiti, ne prikazati kao da je rješeno.**

### 4.5 `StatementFormatProfile` — profil formata (srce §5)

| Polje | Tip | Svrha |
|---|---|---|
| `id` | `String @id` | |
| `zevId` | `String` | izolacija (**vidi P7 u §9** — da li profili smiju da se dijele između ZEV-ova) |
| `name` | `String` | „Nova Banka — dnevni izvod PDF" |
| `kind` | `String` | `CSV` \| `PDF` |
| `accountId` | `String?` → `MoneyAccount` | profil obično pripada računu |
| `bankNameHint` | `String?` | uparuje se sa `MoneyAccount.bankName` (`schema.prisma:777`) |
| `fingerprint` | `String` | **potpis formata** za automatsko prepoznavanje (§5.5) |
| `config` | `Json` | za CSV: **tačno postojeći `CsvMapping`** (`payments.ts:71-86`), bez izmjene tipa. Za PDF: opis šablona (§5.3) |
| `parserKey` | `String?` | `"nova-banka"` za postojeći hardkodirani parser (§5.5) |
| `confirmedBy`, `confirmedAt` | | **ko je i kad potvrdio da je ovaj profil ispravan** — profil bez potvrde se ne primjenjuje automatski (§5.6) |
| `timesUsed`, `lastUsedAt` | | za sortiranje predloga i za odgovor na pitanje „da li Faza 1 radi" |
| `sampleText` | `String?` | isječak uzorka na kojem je profil napravljen — za dijagnostiku kad banka promijeni format |

Ključna stvar: **`config` za CSV nije nov tip.** To je `CsvMapping` kakav već postoji. Faza 1 tehnički = „upiši taj objekat u tabelu i pročitaj ga natrag". `importBankCsv` ostaje potpuno nepromijenjen jer već prima `mapping` kao parametar (`payments.ts:122`).

### 4.6 Sitna izmjena postojeće šeme

`BankImportBatch` (`schema.prisma:1014-1025`) dobija:
- `sourceChannel String @default("UPLOAD")` — `UPLOAD` \| `GMAIL`. Postojeći `sourceType` ostaje **format** (`CSV`/`PDF`), novo polje je **kanal dostave**. Ne mijenjaju se postojeći redovi (default).
- `incomingStatementId String? @unique` — veza natrag.
- `profileId String?` — koji profil je korišćen.

`MoneyAccount` se **ne mijenja** — `bankName` i `iban` (`schema.prisma:777-778`) su dovoljni kao ključevi.

---

## 5. (D) „Učenje formata iz nekoliko primjera" — srž zahtjeva

### 5.1 Prvo razdvajanje: CSV i PDF nisu isti problem

Ovo je najkorisnija stvar koju čitanje koda daje, i preporučujem da se vidi prije razmatranja opcija:

| | CSV | PDF |
|---|---|---|
| Struktura | **postoji** — separator dijeli kolone | **ne postoji** — `bankStatementPdf.ts:8` pokazuje stvarni izlaz: `"5673215000276394DRAGANA DEJANAC0.0049.47"` |
| Šta treba naučiti | „iznos je 5. kolona, decimalna zapeta" — **9 brojeva i prekidača** | „gdje u slijepljenom nizu prestaje ime a počinje iznos" |
| Može li se pogoditi automatski | **da, prilično dobro** — po zaglavlju i obliku vrijednosti | **slabo** bez pretpostavki o toj banci |
| Koliko primjera treba | **jedan** (često i nula) | 2-3 minimum, i dalje krhko |
| Trud za implementaciju | mali | **veliki** |

**Praktičan zaključak:** za CSV je „učenje formata" skoro trivijalno i vrijedi ga uraditi kako treba. Za PDF je stvarno teško, i tu se odlučuje da li ide šablon ili LLM. Rješavanje oba istom mašinom bilo bi loše za oba.

**Zato — i to je konkretno pitanje za tebe (P3 u §9): u kojem formatu banke stvarno šalju izvode?** Ako većina novih ZEV-ova može dobiti CSV/XML od banke, cijeli teški dio (§5.3/§5.4) postaje nepotreban. Elektronsko bankarstvo u BiH obično nudi izvoz u CSV/XLS uz PDF — i **ako ga banka nudi, traženje CSV-a je jeftinije od bilo kakvog parsiranja PDF-a.** To nije izbjegavanje zahtjeva; to je uklanjanje 70% posla jednim podešavanjem u e-bankingu.

### 5.2 Opcija 1 — Zapamćeni profil („zapamti šta je čovjek podesio jednom")

**Šta je:** knjigovođa jednom podesi mapiranje (kao danas), ali sada klikne **„Sačuvaj kao profil"**. Aplikacija upiše `StatementFormatProfile` sa `fingerprint`-om. Sljedeći izvod sa istim potpisom → profil se **automatski primijeni**, redovi se pojave popunjeni, čovjek samo pregleda i potvrdi.

**Zašto je ovo preporuka za Fazu 1:**
- **Nije nova funkcionalnost — to je dovršavanje polovične.** Mapiranje već postoji, već se serijalizuje u `BankImportBatch.mapping` (`payments.ts:154`), samo se nikad ne čita natrag (§1.2).
- **Nula novih zavisnosti.** Nema ML, nema API-ja, nema troška.
- **Savršeno se uklapa u filozofiju projekta.** Sve što aplikacija primijeni je nešto što je **čovjek izričito potvrdio i što je u revizorskom tragu** (`confirmedBy`/`confirmedAt`).
- **Determinističko.** Isti fajl + isti profil = isti rezultat, uvijek. To se može testirati u `vitest`-u.
- **Objašnjivo.** Kad nešto ispadne pogrešno, vidi se `config` i zna se **zašto** — devet vrijednosti, ne crna kutija.

**Iskreno ograničenje:** **ovo nije „učenje" u smislu koji tvoja formulacija možda podrazumijeva.** Aplikacija ne zaključuje ništa — ona pamti. Za **prvi** izvod nove banke čovjek i dalje radi isti posao kao danas. Ušteda je od **drugog** izvoda te banke nadalje — a to je 11 od 12 izvoda godišnje po banci. **Ovo je P8 u §9** i mislim da je ovo pitanje na koje je najvažnije da odgovoriš prije bilo kakve implementacije.

**Dodatak male cijene, velike koristi:** i bez ikakvog zaključivanja šablona, za CSV se može uraditi **pogađanje po zaglavlju** — ako prvi red sadrži `datum`/`date`, `iznos`/`amount`/`odobrenje`, `platilac`/`naziv`, `poziv na broj`/`reference`/`svrha`, predloži mapiranje po imenima kolona. To je jedna tabela sinonima (~40 riječi, srpski + engleski), ne ML. Realno bi pogodila većinu domaćih CSV izvoza i za **prvi** izvod. **Ovo preporučujem da uđe već u Fazu 1** — jeftino je i pokriva najveći dio žalbe „moram sve prekucati".

### 5.3 Opcija 2 — Zaključivanje šablona iz 2-3 označena primjera

**Šta je:** knjigovođa učita 2-3 uzorka i na **jednom** od njih označi „ovo je datum", „ovo je iznos", „ovo je platilac", „ovo je poziv na broj" — klikom na vrijednost, ne kucanjem. Aplikacija izvede šablon, **provjeri ga na ostalim uzorcima**, i pokaže: *„Datum: sigurno. Iznos: sigurno. Platilac: nesigurno na 2. uzorku — provjerite."*

**Za CSV je ovo realno.** Označena vrijednost → indeks kolone (pronađi u kojoj koloni stoji), format datuma → prepoznaj iz oblika, decimalni znak → prepoznaj iz oblika, `skipRows` → prvi red sa parsabilnim datumom. **To je nekoliko stotina linija razumljivog koda, plus ekran za označavanje.** Rezultat je `CsvMapping` — **isti tip, ista tabela, isti nizvodni kod kao u Opciji 1.** Opcija 2 za CSV, dakle, nije druga arhitektura, nego **bolji način da se popuni isti profil.** To je važno: Faza 3 ne odbacuje Fazu 1, nego joj dodaje ulaz.

**Za PDF je ovo mnogo teže, i vrijedi biti konkretan zašto.** Da bi se iz `"5673215000276394DRAGANA DEJANAC0.0049.47"` naučilo gdje šta počinje, treba naučiti pravilo za razdvajanje slijepljenog niza. Šta se realno može izvesti:
- **Oblik novčanog tokena** — da li je `1,234.56` ili `1.234,56` ili `1234.56`. Izvedivo iz uzorka, pouzdano.
- **Broj novčanih tokena u redu i njihovo značenje** — jedan sa predznakom, ili dva (zaduženje/odobrenje)? Izvedivo, sa razumnom sigurnošću.
- **Šta je „sidro" početka reda** — kod Nova Banke to je 6+ cifara (`bankStatementPdf.ts:55`). Druga banka može imati datum, ili RBR. Izvedivo iz onoga što je zajedničko svim redovima uzorka.
- **Koliko linija čini jedan red** — Nova Banka: dvije do tri (`bankStatementPdf.ts:123-137`). Izvedivo prepoznavanjem obrasca koji se ponavlja.
- **Gdje prestaje ime a počinje iznos** — izvedivo *samo* iz pozicije prvog novčanog tokena, tj. isto pravilo koje je danas hardkodirano.

Znači: **automatsko izvođenje ide tačno dokle ide i današnja hardkodirana heuristika** — ne dalje. To je ozbiljan posao (procjena: 600-1000 linija sa ekranom za označavanje i validacijom), i **rezultat je krhak na banku koja radi nešto strukturno drugačije** (npr. štampa iznos lijevo od imena, ili ima višelinijsku svrhu promjenljive dužine, ili grupiše po datumu u podzaglavlja). Iskrena procjena: **pokrilo bi vjerovatno 60-75% domaćih PDF izvoda, a ne 100%** — i za onih 25% bi se ipak vratili na ručni rad ili na Opciju 3.

**Zato je preporuka: Opcija 2 se gradi za CSV, ali se za PDF NE gradi prije nego što se vidi koliko ZEV-ova stvarno ima PDF-only izvode iz banaka koje nisu Nova Banka.** Graditi 1000 linija zaključivanja PDF šablona za banku koja možda može izvesti CSV (§5.1) bila bi najskuplja greška u ovom planu.

### 5.4 Opcija 3 — LLM izvlačenje

**Šta je:** izvučeni tekst PDF-a (ili uzorak CSV-a) + opis traženih polja se pošalje jezičkom modelu, koji vrati strukturirane redove. Opciono uz 2-3 ispravljena primjera kao primjere u upitu.

**Gdje je iskreno bolja od svega ostalog:** za **nov, neuredan, strukturno nepoznat** PDF raspored. Ne treba joj šablon, ne treba joj sidro na početku reda, ne smeta joj višelinijska svrha, snalazi se sa podzaglavljima po datumima. Ono što u Opciji 2 traži 1000 linija krhkog koda, tu je upit.

**Cijena — u novcu je zanemarljiva, i to treba reći tačno.** Procjena iz stvarnih podataka: red izvoda u izvučenom tekstu je ~120 znakova (`bankStatementPdf.ts:8`). Mjesečni izvod sa 60 redova ≈ 8-10 KB ≈ **3-4 hiljade tokena** na ulazu, i 1-3 hiljade na izlazu (JSON). Po cijenama manjih modela reda 0,25-1 USD za milion ulaznih tokena, to je **oko pola centa do tri centa po izvodu** — dakle **manje od jedne konvertibilne marke godišnje po ZEV-u.** Novac **nije** argument protiv.

**Cijena koja jeste argument — i ovo je najvažniji pasus u §5:**

> **Cijela aplikacija je samostalno hostovana. Podaci ZEV-a — imena vlasnika, brojevi računa, iznosi, ko je koliko dugovao — nikad ne napuštaju tvoj računar. Slanje teksta bankovnog izvoda vanjskom LLM API-ju to mijenja iz temelja.**

Izvučeni tekst izvoda sadrži, u čitljivom obliku: **puna imena i prezimena vlasnika, brojeve njihovih ličnih računa, iznose koje su platili, i ono što su napisali u svrhu uplate**. To je, za jednu zajednicu, prilično potpuna finansijska slika njenih stanara. To je **materijalno drugačija odluka o privatnosti** od svega ostalog u ovoj aplikaciji, i ima i pravnu dimenziju (obrada ličnih podataka stanara kod vanjskog obrađivača, van njihovog znanja).

**Zato: ovo se ne uvodi tiho, kao „poboljšanje parsiranja".** Ako se ikad uvede, minimalni uslovi bi bili:
1. **Isključeno po podrazumijevanju**, i uključuje se izričitim podešavanjem (`LLM_EXTRACTION=...` + API ključ) — ne postoji „slučajno uključeno".
2. **Nikad automatski.** Samo dugme **„Pokušaj naprednije čitanje"**, koje se pojavi **tek kad determinističko parsiranje očigledno padne** (nula prepoznatih redova).
3. **Vidljivo pri svakom korišćenju.** Poruka „Sadržaj izvoda će biti poslan vanjskoj usluzi X" na samom dugmetu, ne u podešavanjima.
4. **Zapisano u reviziji** — `audit()` unos da je za izvod Y sadržaj poslan vani, ko je to pokrenuo i kad.
5. **Nikad zaobilazi pregled.** LLM rezultat ulazi u **isti** ekran za pregled i **isti** `commitPdfImport` (§4.1) — nedeterminizam je time već pokriven, jer čovjek gleda svaki red. Ovo je, priznajem, jedina stvar koja LLM ovdje čini uopšte prihvatljivim: **greška modela ne može sama da napravi uplatu.**

**Preporuka: Opcija 3 je opciona rezerva, nikad glavni mehanizam, i ne gradi se dok ti izričito ne kažeš da je slanje podataka stanara vanjskoj usluzi prihvatljivo. To je P6 u §9 i to je tvoja odluka, ne tehnička.**

### 5.5 Kako se profil automatski prepoznaje — `fingerprint`

Da bi „zapamti profil" radilo bez pitanja „koji profil?" pri svakom izvodu, treba potpis formata. Predlog, po padajućoj pouzdanosti:

**Za CSV:** heš od (normalizovan prvi red / zaglavlje) + separator + broj kolona. Vrlo pouzdano — banka ne mijenja zaglavlje između mjeseci.

**Za PDF:** heš od (normalizovano prvih ~300 znakova teksta, bez cifara) + prisustvo ključnih fraza (npr. `"IZVOD BR."`, `"O PROMJENAMA SREDSTAVA NA RAČUNU"` iz `bankStatementPdf.ts:2`). Cifre se izbacuju jer se mijenjaju svaki dan; zaglavlje banke ne.

**Redoslijed odlučivanja pri dolasku izvoda:**
1. Poklapanje `fingerprint`-a → **primijeni profil** (najpouzdanije).
2. Bez poklapanja, ali postoji potvrđen profil za taj `accountId` → **predloži ga** („Izgleda kao 'Nova Banka PDF' — primijeniti?"). Ne primjenjuj sam.
3. Ni to → `bankNameHint` uparen sa `MoneyAccount.bankName` → predloži.
4. Ništa → **ekran za podešavanje kao danas**, sa pogađanjem po zaglavlju (§5.2) ako je CSV, sa dugmetom „Sačuvaj kao profil" na kraju.

**Postojeći Nova Banka parser se uklapa bez prepisivanja.** Napravi se jedan profil sa `parserKey: "nova-banka"` i `config: {}`. `importPdfPreview` onda mjesto današnjeg fiksnog `parseNovaBankaStatement(text)` (`payments.ts:248`) poziva odabir po `parserKey`. **Postojeći parser ostaje potpuno nepromijenjen** — samo prestaje biti jedini. To je mala, sigurna izmjena (jedan `switch` na jednoj liniji), i **daje odmah jedan gotov, dokazan profil** kao referencu.

### 5.6 Nepregovorljivo, bez obzira na izabranu opciju

Ovo važi za sve tri opcije i preslikava postojeći obrazac pragova iz `payments.ts:288`/`:308`:

1. **Profil nikad ne preskače ljudski pregled.** Automatsko prepoznavanje popunjava **istu** tablicu za pregled koja postoji danas. Nema „pouzdan profil → direktno u bazu". Nikad.
2. **Sigurnost se prikazuje, ne skriva.** Red parsiran pouzdano izgleda drugačije od reda za koji aplikacija nije sigurna. Nesigurna polja prazna, ne pogođena — isto kao što `invoiceId` ostaje `null` pod pragom 70.
3. **Provjere zbira su obavezne.** Ako izvod štampa kontrolne sume (`UKUPNO`), uporedi ih sa zbirom parsiranih redova i **upozori na razliku**. Ovo je najjača pojedinačna zaštita od tiho pogrešnog profila — i jednako vrijedi za šablon i za LLM.
4. **Profil koji počne da griješi mora biti lako opoziv.** Kad banka promijeni raspored, treba jedno dugme „Ovaj profil više ne odgovara" koje ga isključi, uz `sampleText` za poređenje starog i novog oblika.

---

## 6. (E) Ko šta smije

Polazna tačka je postojeće stanje, ne nova šema: svaki uvoz izvoda danas traži `requireRole(actor, "ACCOUNTANT")` + `requireZev(actor)` (`payments.ts:124-125`, `:244-245`, `:357-358`).

| Radnja | Predlog | Obrazloženje |
|---|---|---|
| Povezati/odvezati Gmail za svoj ZEV | **ACCOUNTANT ili PRESIDENT**, unutar tenanta | Ko unosi izvode, taj i povezuje izvor. Ne treba te za svaki ZEV. |
| „Provjeri Gmail sada" | **ACCOUNTANT ili PRESIDENT** | isto |
| Vidjeti listu dolazećih izvoda | **ACCOUNTANT ili PRESIDENT** | isto |
| Uvezti dolazeći izvod (pregled → commit) | **ACCOUNTANT** | **bez izmjene** — to je današnje pravilo |
| Kreirati / potvrditi profil formata | **ACCOUNTANT** | on i podešava mapiranje danas |
| Vidjeti profile | ACCOUNTANT + PRESIDENT | predsjednik treba da vidi kako se izvodi čitaju |
| **Nikad**: OWNER bilo šta od ovoga | — | vlasnik ne vidi tuđe uplate |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `SECRETS_KEY` | **env, nije u UI** — ni za super admina | Ovo je podešavanje instalacije, kao `SESSION_SECRET`. Nema razloga da postoji ekran za to. |
| Pregled svih Gmail veza kroz `/admin/[zevId]` | **super admin, samo čitanje** | dijagnostika („je li veza pukla?") bez ovlašćenja da povezuje tuđi mejl |

**Zašto super admin ne povezuje Gmail umjesto tebe-kao-predsjednika:** OAuth odobrenje je vezano za **Google nalog koji klikne odobri**, a to je nalog ZEV-a. Super admin bi morao da ima pristup tom mejlu — što znači da bi platformski nalog držao kredencijale svih mejl naloga zajednica. To je nepotrebna koncentracija ovlašćenja. **Zajednički dio (OAuth aplikacija) je u env-u; nezajednički dio (token) nastaje unutar tenanta, rukom osobe koja ima taj mejl.** Ovo se čisto poklapa sa postojećim razdvajanjem iz `docs/multitenancy-plan.md`.

**Obavezni testovi izolacije** (u `tests/tenant-isolation.test.ts`, gdje tom kodu i jeste mjesto): ACCOUNTANT ZEV-a A ne može pročitati `GmailConnection` ni `IncomingStatement` ni `StatementFormatProfile` ZEV-a B; OWNER je odbijen na svakoj novoj funkciji; poll za vezu ZEV-a A ne može upisati `IncomingStatement` sa `zevId` ZEV-a B.

---

## 7. (G) Fazni plan

Redoslijed je takav da **Faza 1 sama po sebi rješava najveći dio žalbe** („moram sve prekucati"), i to **bez ijednog Google podešavanja** — pa je korisna čak i ako se Gmail dio nikad ne uradi. Faza 2 je Gmail. Faze 3-5 su uslovne.

### Faza 1 — Profili formata *(bez Gmail-a, bez novih zavisnosti)*

| Fajl | Izmjena |
|---|---|
| `prisma/schema.prisma` | **nov** `StatementFormatProfile`; `BankImportBatch` + `profileId` |
| `src/server/services/statementProfiles.ts` | **nov** — `listProfiles`, `saveProfile`, `confirmProfile`, `deactivateProfile`, `computeFingerprint`, `findMatchingProfile` |
| `src/server/services/payments.ts` | `importBankCsv` prima `profileId?` (mapiranje iz profila); `importPdfPreview` bira parser po `parserKey` mjesto fiksnog `parseNovaBankaStatement` (`payments.ts:248`); `commitPdfImport` upisuje `profileId` mjesto konstante `{ source: "pdf-nova-banka" }` (`payments.ts:381`) |
| `src/server/services/csvSniffer.ts` | **nov** — pogađanje `CsvMapping` po zaglavlju + obliku vrijednosti (§5.2) |
| `src/app/(app)/fakture/uplate/page.tsx` | izbor profila; „Sačuvaj kao profil"; predlog iz sniffera mjesto hardkodiranih `defaultValue` (`:112-122`) |
| `src/app/(app)/podesavanja/formati/page.tsx` | **nov** — spisak/uređivanje profila |
| `src/lib/i18n/sr-Latn.ts`, `en.ts` | ključevi |

**Migracija:** jedna nova tabela + jedna kolona. Postojeći podaci nepromijenjeni. Seed jednog `nova-banka` profila po ZEV-u koji ima PDF uvoze.
**Testovi:** `tests/statementProfiles.test.ts` (**nov**) — `fingerprint` stabilan između dva izvoda iste banke i različit za različite; sniffer pogađa mapiranje iz realnog zaglavlja; profil se primijeni i da **isti** rezultat kao ručno mapiranje (regresija!); nepotvrđen profil se **ne** primjenjuje sam; OWNER odbijen. Dopuna `tests/payments.test.ts` da postojeći tokovi nisu promijenjeni. Dopuna `tests/tenant-isolation.test.ts`.
**Verzija:** prijedlog **2.6.0** (minor) — na potvrdu.

### Faza 2 — Gmail veza + ručna provjera *(„Provjeri Gmail sada")*

| Fajl | Izmjena |
|---|---|
| `prisma/schema.prisma` | **nov** `GmailConnection`, **nov** `IncomingStatement`; `BankImportBatch` + `sourceChannel`, `incomingStatementId` |
| `src/lib/secrets.ts` | **nov** — AES-256-GCM preko `node:crypto` (§4.4) |
| `src/server/integrations/gmail/oauth.ts` | **nov** — URL za odobrenje, zamjena koda za token, osvježavanje (obično `fetch`, bez nove biblioteke) |
| `src/server/integrations/gmail/client.ts` | **nov** — `listMessages` (upit), `getMessage`, `getAttachment` |
| `src/server/services/mailImport.ts` | **nov** — `connectGmail`, `disconnectGmail`, `checkMailbox` (poll + idempotencija + usmjeravanje §3.1), `listIncoming`, `ignoreIncoming`, `previewIncoming` (→ postojeći `importPdfPreview`/`importBankCsv`) |
| `src/app/api/gmail/oauth/callback/route.ts` | **nov** — jedini novi HTTP endpoint |
| `src/server/actions/mailImport.ts` | **nov** — server akcije za dugmad |
| `src/app/(app)/fakture/uplate/gmail/page.tsx` | **nov** — status veze, „Poveži"/„Odveži", „Provjeri sada", lista dolazećih, `lastError` (§2.5) |
| `src/components/pdf-statement-import.tsx` | prima `buffer` i iz `IncomingStatement`, ne samo iz forme |
| `src/app/admin/[zevId]/page.tsx` | kartica „Gmail veze" — **samo čitanje** (§6) |
| `docker-compose.yml`, `.env.example`, `README.md` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SECRETS_KEY`; **uputstvo iz §2.6 u README** |

**Migracija:** dvije nove tabele + tri kolone.
**Testovi:** `tests/mailImport.test.ts` (**nov**), sa Gmail klijentom kao mock-om (obrazac postoji — `MockEmailProvider`, `notifications/providers.ts:33`): ista poruka dva puta → jedan `IncomingStatement`; restart (nova instanca servisa) ne duplira; usmjeravanje po broju računa sa izvoda nađe pravi `MoneyAccount`; nepoznat račun → `accountId: null`, ne pogrešan ZEV; pukao token → `lastError` postavljen, **ne** bačena greška koja ubija poll; token se u bazi nikad ne pojavi u čistom tekstu. Dopuna `tests/tenant-isolation.test.ts` (§6).
**Verzija:** prijedlog **2.7.0**.

### Faza 3 — Pozadinska provjera *(mali korak, velika vidljivost)*

| Fajl | Izmjena |
|---|---|
| `src/instrumentation.ts` | **nov** — `register()` + `setInterval` sa zaključavanjem (§3.3b) |
| `src/server/services/mailImport.ts` | `checkAllMailboxes()` — obilazak aktivnih veza, svaka u `try/catch` |
| `prisma/schema.prisma` | `GmailConnection.pollIntervalMinutes Int @default(15)` |
| `src/app/(app)/fakture/uplate/gmail/page.tsx` | prekidač „Provjeravaj automatski" + „zadnja provjera: ..." |
| `docker-compose.yml`, `.env.example` | `GMAIL_POLL_ENABLED`, `GMAIL_POLL_MINUTES` |

Radi se **tek nakon** što se Faza 2 dokaže u stvarnoj upotrebi. Ako se ručno dugme pokaže dovoljnim, **ovu fazu vrijedi preskočiti** — manje pokretnih dijelova.
**Verzija:** prijedlog **2.8.0**.

### Faza 4 — Zaključivanje CSV šablona iz označenih primjera *(uslovno)*

Gradi se **samo ako** Faza 1 u praksi bude nedovoljna za CSV (tj. ako se pojave banke gdje ni sniffer ni zapamćeni profil ne pomognu pri prvom izvodu).

| Fajl | Izmjena |
|---|---|
| `src/server/services/formatInference.ts` | **nov** — izvođenje `CsvMapping` iz označenih vrijednosti + validacija na ostalim uzorcima |
| `src/app/(app)/podesavanja/formati/nauci/page.tsx` | **nov** — učitavanje 2-3 uzorka, označavanje klikom, prikaz sigurnosti po polju |
| `src/server/services/statementProfiles.ts` | prima izvedeni `config` — **isti tip kao Faza 1** |

Rezultat je **isti `StatementFormatProfile`** — dakle nizvodno se ne mijenja ništa (§5.3).
**Verzija:** prijedlog **2.9.0**.

### Faza 5 — Odloženo i uslovno, po tvojoj odluci

- **Zaključivanje PDF šablona** (§5.3) — **samo** ako se pokaže da postoji više PDF-only banaka i da CSV izvoz iz e-bankinga nije opcija (§5.1, P3).
- **LLM izvlačenje** (§5.4) — **samo** uz tvoju izričitu saglasnost o privatnosti (P6), i samo pod pet uslova iz §5.4.
- **IMAP put** (§2.7) — ako OAuth podešavanje bude prevelika muka; puni se ista `IncomingStatement` tabela.
- **`gmail.modify` + labela „obrađeno"** — ako zatreba vidljivost u samom Gmail-u (§2.2).
- **Push (watch + Pub/Sub)** — ne preporučujem uopšte (§3.2).

### Uz svaku fazu (pravila projekta)

- Unos u `CHANGELOG.md` + **potvrđen** skok verzije (nikad jednostrano) — trenutna verzija je `2.5.3`.
- `typecheck && lint && test && build` + živa Playwright provjera — Faze 1 i 2 su izrazito vizuelne.
- Novi stringovi kroz `t()` (`src/lib/i18n/sr-Latn.ts` + `en.ts`), nove grupe `gmail.*` i `format.*`.
- `audit()` unos za svaku novu radnju: `gmail.connect`, `gmail.disconnect`, `gmail.poll`, `statement.fetched`, `profile.create`, `profile.confirm`, `profile.deactivate`.

---

## 8. Rizici i posljedice koje treba svjesno prihvatiti

1. **Gmail će se povremeno odvezati, i to je van naše kontrole.** Promjena lozinke Google naloga **poništava** token koji sadrži Gmail scope (§2.5). Ublaženo: `lastError` + vidljiv status + jasna poruka. Nikad riješeno.
2. **Ekran „Google hasn't verified this app" se pojavljuje pri svakom povezivanju.** Posljedica odluke da se ne ide na verifikaciju/CASA (§2.3). Za nekoliko poznatih naloga je ispravna razmjena, ali izgleda zastrašujuće ako to ne očekuješ.
3. **Trajno ograničenje od 100 naloga po projektu, bez resetovanja** ([Unverified app screen](https://support.google.com/cloud/answer/7454865)). Nerelevantno danas; bilo bi relevantno da aplikacija ikad postane usluga za desetine korisnika. Tada je verifikacija + CASA neizbježna i to je odvojena, skupa odluka.
4. **Šifrovanje tokena štiti od dumpa baze, ne od pristupa mašini** (§4.4). Iskrena granica, ne propust.
5. **Automatski primijenjen profil je nova klasa tihe greške.** Ako banka nešto suptilno promijeni (npr. zamijeni kolone zaduženja i odobrenja), profil se i dalje „poklapa" a redovi su pogrešni. **Zato su provjere zbira (§5.6.3) obavezan dio Faze 1, ne kasniji dodatak.**
6. **Zapamćeni profil čini pregled *lakšim za površno klikanje*.** Danas knjigovođa mora da razmisli o mapiranju, pa gleda redove sa dozom sumnje. Kad sve bude prepopunjeno, iskušenje je „potvrdi bez čitanja". To je stvaran rizik automatizacije ispred ljudskog koraka i vrijedi mu se suprotstaviti u UI — npr. izvod sa upozorenjem o zbiru ili sa `accountMismatch` **ne smije** imati omogućeno dugme za potvrdu dok se upozorenje ne prihvati izričito.
7. **Tajmer u procesu (Faza 3) radi samo dok kontejner radi.** Isključen računar = nema provjere. Nema tihe naknadne nadoknade osim sljedeće provjere.
8. **`payments.ts` je već 910 linija.** Novi kod ide u **nove** fajlove (`mailImport.ts`, `statementProfiles.ts`, `integrations/gmail/*`), a u `payments.ts` ulazi samo minimalna izmjena (profil mjesto konstante). Inače najosjetljiviji fajl u aplikaciji nastavlja da raste.
9. **Prilog može biti zaštićen lozinkom.** Neke banke šalju PDF sa šifrom (JMBG, dio broja računa). `pdf-parse` tada pada. Ublaženo: `parseError` + jasna poruka + ručni put ostaje. **Ako je to slučaj za tvoju banku, reci — mijenja procjenu Faze 2** (P9).
10. **Prilog ne mora biti izvod.** Reklame, obavještenja, ugovori. Zato `IncomingStatement.status = IGNORED` i dugme „nije izvod" postoje od Faze 2 — filtriranje po upitu nikad nije savršeno.

---

## 9. (F) Pitanja za tebe

Ovo su stvari koje **ne mogu** riješiti čitanjem koda niti pretragom — traže tvoju odluku ili tvoje poznavanje situacije. Poređano po tome koliko blokira plan.

- **P1 — Jedna Gmail adresa ili jedna po ZEV-u?** Tvoja formulacija („*a* gmail address") navodi na jednu zajedničku, ali to **ne pretpostavljam**. Ako je jedna zajednička: dolaze li izvodi za više ZEV-ova na nju već sada, i **razlikuju li se po pošiljaocu** ili je banka ista pa se poruke ne mogu razlikovati po zaglavlju? (Vidi §3.1 — usmjeravanje po broju računa sa izvoda radi u oba slučaja, ali tekst uputstva i broj veza zavise od odgovora.)

- **P2 — OAuth ili IMAP + App Password?** §2.7. Preporuka je OAuth (uže ovlašćenje, samo čitanje), uz cijenu od 20-40 minuta u Google konzoli **jednom** (§2.6) i ekrana upozorenja pri svakom povezivanju. IMAP je jedna 16-znakovna šifra i **nikakvo** podešavanje, ali daje **pun pristup mejlu**. Pročitaj tabelu u §2.7 i reci koja ti razmjena više odgovara — ovo je odluka koja najviše mijenja koliko posla imaš **ti**, a najmanje koliko ga ima kod.

- **P3 — U kom formatu banke stvarno šalju izvode, i može li se dobiti CSV?** Ovo je **pitanje sa najvećim uticajem na cijenu cijelog poduhvata** (§5.1). Za koje banke konkretno (Nova Banka + koje još)? I: da li njihovo elektronsko bankarstvo nudi izvoz u CSV/XLS pored PDF-a? Ako da za većinu — **cijeli teški dio (§5.3) postaje nepotreban**, i „učenje formata" postaje mali posao umjesto velikog.

- **P4 — Ručno dugme ili pozadinska provjera, i koliko je „automatski" doslovno?** Preporuka je dugme u Fazi 2, tajmer u Fazi 3 (§3.3), jer ljudski pregled ionako čeka. Ako pod „automatski" misliš „ne želim ni to dugme da kliknem", reci — onda Faza 3 ide odmah uz Fazu 2 i zamijeni mjesta sa dijelom Faze 2.

- **P5 — Zajednička Google OAuth aplikacija za sve ZEV-ove, ili po jedna?** Preporuka: **jedna** aplikacija (jedan `client_id` u env-u), po ZEV-u se razlikuje samo token (§2.6, §6). Alternativa (projekt po ZEV-u) bi ponavljala korake 1-8 iz §2.6 za svaku zajednicu i ništa suštinski ne bi poboljšala. Slažeš li se?

- **P6 — Je li slanje teksta bankovnog izvoda vanjskoj LLM usluzi ikad prihvatljivo, čak i kao izričito uključena opcija?** §5.4. Izvod sadrži imena, brojeve računa i iznose stanara. Novčani trošak je zanemarljiv (centi po izvodu); pitanje je **isključivo privatnost i pravna odgovornost prema stanarima**. Tri moguća odgovora: (a) nikad — ne gradi se ni kao opcija; (b) da, ali samo kao dugme „pokušaj naprednije" kad determinističko čitanje padne, uz upozorenje i revizorski trag; (c) da, i koristi se kad god pomaže. **Preporuka je (a) ili (b); (c) ne bih gradio.**

- **P7 — Smiju li se profili formata dijeliti između ZEV-ova?** Danas je sve strogo `zevId`-scoped. Ali „Nova Banka PDF dnevni izvod" je **činjenica o banci, ne o zajednici** — dva ZEV-a u istoj banci bi svaki podešavao isto. Opcije: (a) strogo po ZEV-u (najčistije, malo dupliranja); (b) super admin drži „platformske" šablone koje ZEV kopira; (c) profili dijeljeni po `bankName`. **Preporuka: (a) za Fazu 1** (dupliranje jednog profila je manja cijena od nove klase dijeljenih podataka u aplikaciji koja je do sad strogo izolovana), (b) kao kasniji dodatak ako se dupliranje pokaže dosadnim.

- **P8 — Da li ti je Faza 1 dovoljna za ono što si mislio pod „learn the format based on a couple of examples"?** Iskreno rečeno (§5.2): Faza 1 **ne uči** — ona **pamti** ono što si podesio jednom, plus pogađa CSV kolone po zaglavlju. Za **prvi** izvod nove banke i dalje podešavaš ručno; od **drugog** nadalje je automatski. Ako je to ono što si zamislio — plan je gotov i Faze 4/5 se ne grade. Ako izričito želiš „označim polja na dva-tri primjera i sistem izvede pravilo" — to je Faza 4 (CSV, realno) odnosno Faza 5 (PDF, teško i krhko), i vrijedi reći sada.

- **P9 — Jesu li prilozi ikad zaštićeni lozinkom, i koliki su?** Ako banka šalje PDF sa šifrom, `pdf-parse` ne može da ga pročita bez dodatnog koraka (rizik 9 u §8). Isto: dolaze li izvodi dnevno ili mjesečno, i koliko redova imaju? (Utiče na to koliko je bitna brzina pregleda.)

- **P10 — Verzionisanje.** Prijedlog 2.6.0 / 2.7.0 / 2.8.0 / 2.9.0 (po jedan minor po fazi), ili Faze 1+2 kao jedan zaokružen poduhvat sa jednim skokom?

---

## 10. Izvori za provjerene Google činjenice

Sve činjenice u §2 i §3.2/§3.4 su provjerene kroz pretragu u toku izrade ovog plana, jer se Google konzola i pravila mijenjaju:

- [Restricted Scopes — Google Cloud Console Help](https://support.google.com/cloud/answer/13464325?hl=en) — `gmail.readonly`/`gmail.modify`/`gmail.metadata` su „restricted"
- [Restricted scope verification — Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) — izuzetak za lične/poznate korisnike, CASA
- [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2) — istek refresh tokena: 7 dana u „Testing", promjena lozinke uz Gmail scope, 6 mjeseci neaktivnosti, granica od 100 tokena
- [Manage App Audience — Google Cloud Console Help](https://support.google.com/cloud/answer/15549945?hl=en) — 100 test korisnika, odobrenje traje 7 dana
- [Unverified app screen — Google Cloud Console Help](https://support.google.com/cloud/answer/7454865) — kad se pojavljuje, granica od 100 novih naloga
- [Get started with the Google Auth Platform](https://support.google.com/cloud/answer/15544987?hl=en) — nove stranice konzole (Branding / Audience / Clients / Data Access / Verification Center)
- [Security Assessment — Google Cloud Console Help](https://support.google.com/cloud/answer/13465431?hl=en) — godišnja CASA provjera za restricted scope-ove
- [Configure push notifications in Gmail API](https://developers.google.com/workspace/gmail/api/guides/push) — pull pretplata je moguća (javni endpoint nije obavezan), `watch()` se obnavlja najmanje svakih 7 dana
- [Usage limits — Gmail API](https://developers.google.com/workspace/gmail/api/reference/quota?hl=en) — dnevna kvota i cijene poziva
- [Gmail App Passwords: Setup and Gotchas — Nylas](https://cli.nylas.com/guides/gmail-app-password-setup) i [Gmail OAuth 2.0 Changes 2026 — Mailbird](https://www.getmailbird.com/gmail-oauth-changes-app-password-phase-out/) — IMAP + App Password i dalje radi za lične Gmail naloge sa 2FA; rok iz 2024. odnosio se na Workspace
- [Transition from less secure apps to OAuth — Google Workspace Admin Help](https://support.google.com/a/answer/14114704?hl=en) — kontekst za Workspace naloge

---

### Ključni fajlovi za implementaciju

- `/home/claude/zev-app/src/server/services/payments.ts`
- `/home/claude/zev-app/src/server/services/bankStatementPdf.ts`
- `/home/claude/zev-app/prisma/schema.prisma`
- `/home/claude/zev-app/src/app/(app)/fakture/uplate/page.tsx`
- `/home/claude/zev-app/src/server/actions/bankPdfImport.ts` (+ `/home/claude/zev-app/src/components/pdf-statement-import.tsx`)
