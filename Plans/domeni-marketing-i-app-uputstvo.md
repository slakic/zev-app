# Domeni: marketinški sajt na `zevupravnik.com`, aplikacija na `app.zevupravnik.com` — uputstvo

**Status: UPUTSTVO za ručno podešavanje (2026-11-02).** Nastalo na zahtjev korisnika: marketinška
stranica na `https://zevupravnik.com`, aplikacija na `https://app.zevupravnik.com`. Ovo je opcija C iz
`Plans/marketing-sajt-plan.md` §7.1 (plan je preporučivao B, `www` za sajt). Korisnik je izabrao C, a
ovo uputstvo rješava rizike koje plan navodi za C.

**Hosting (izmjena 2026-11-02):** sajt ide na **Cloudflare Pages** (besplatan plan, dozvoljena
komercijalna upotreba, a DNS je već na Cloudflare-u). Aplikacija ostaje na Vercelu. Vercelov
besplatni Hobby plan je samo za nekomercijalnu upotrebu, pa nije opcija za sajt koji reklamira uslugu.

Zasnovano na stanju v2.64.1 i na trenutnom DNS-u (provjereno `dig`-om 2026-11-02):

| Zapis | Danas |
|---|---|
| Nameserveri | Cloudflare (`mallory.ns.cloudflare.com`, `plato.ns.cloudflare.com`) |
| `zevupravnik.com` A/AAAA | Cloudflare IP adrese → zapis je **proxied** (narandžasti oblak) prema Vercelu |
| MX | Cloudflare Email Routing (`route1–3.mx.cloudflare.net`) |
| TXT (SPF) | `v=spf1 include:_spf.mx.cloudflare.net include:spf.mailjet.com ~all` |
| `mailjet._domainkey` | DKIM ključ za Mailjet |
| `www`, `app` | ne postoje |

> **Ne dirati MX, SPF, DKIM ni DMARC zapise.** E-pošta aplikacije (Mailjet) i dalje ide sa domena
> `zevupravnik.com`; selidba aplikacije na poddomen na to ne utiče.

---

## Ukratko

1. **Faza 1 — može odmah:** aplikacija dobija i adresu `app.zevupravnik.com` i prelazi na nju
   (`APP_URL`). Stari domen i dalje služi aplikaciju, pa ništa ne puca.
   Na kraju Faze 1 jedno Cloudflare pravilo šalje **sve** sa `zevupravnik.com` na `app.`, uz istu
   putanju i parametre. Tako se odmah vidi da stari linkovi rade.
2. **Faza 2 — kad marketinški sajt bude napravljen:** `zevupravnik.com` prelazi na Cloudflare Pages.
   Pravilo se sužava na putanje aplikacije (`/login`, `/glasanje/…`, `/onboarding/…`, moduli, API), a
   ostalo služi sajt. Lični linkovi za glasanje i pozivi iz već poslatih e-poruka rade i dalje.

Kod aplikacije se ne mijenja. Mijenja se samo varijabla `APP_URL`, a preusmjerenja su Cloudflare
pravilo (Rules → Redirect Rules), nezavisno od toga gdje je sajt.

---

## Šta zavisi od domena (provjereno u kodu)

Sve adrese aplikacija gradi iz **jedne varijable, `APP_URL`** (`src/lib/env.ts`), nikad iz zaglavlja
zahtjeva:

| Šta | Gdje u kodu | Šta se dešava pri selidbi |
|---|---|---|
| Linkovi u e-porukama (fakture, sjednice, glasanje, reset lozinke, test e-pošte) | `invoiceEmail.ts`, `meetings.ts`, `zaboravljena-lozinka/page.tsx`, `emailTest.ts` | Nove poruke nose `app.` čim se `APP_URL` promijeni. **Već poslate poruke** nose stari domen → pokriva ih preusmjerenje iz Faze 2 |
| Lični link i kod za e-glasanje (`/glasanje/…`) | `meetings.ts` | Kao gore. Ovo je najvažniji stari link: dok glasanje traje, mora raditi |
| Poziv za novi ZEV (`/onboarding/poziv/…`, važi 14 dana) | `onboarding.ts:147` | Kao gore |
| Adresa za SMS banke (`POST /api/uplate/sms`) | `bankSms.ts:76` | Automatizacija na iPhone-u ima staru adresu upisanu. **Treba je ažurirati** (korak 1.6). Rezerva je preusmjerenje 308, koje zadržava `POST` |
| MCP server (`/api/mcp`) i OAuth (`/.well-known/…`, izdavač, resurs) | `src/server/mcp/**`, `src/lib/mcp/oauth.ts` | Resurs i izdavač su vezani za `APP_URL`, pa **postojeće veze sa asistentima prestaju da rade** i prave se nove (korak 1.6). Funkcija je iza `MCP_ENABLED`, pa pogađa mali broj ljudi |
| Kolačić sesije | `src/server/auth/session.ts` | Kolačić nije vezan za poddomene, pa se svako jednom ponovo prijavljuje na `app.` |
| QR kod na fakturi | `documents.ts` | Nosi podatke za plaćanje, ne adresu, pa **nije pogođen** |
| PDF-ovi (zapisnici, odluke…) | — | Ne sadrže adresu aplikacije, pa nisu pogođeni |

---

## Faza 1 — aplikacija na `app.zevupravnik.com` (može odmah)

Za vrijeme cijele Faze 1 aplikacija radi na **oba** domena. Rizik je mali i nema prekida.

### 1.1 Vercel: dodati domen projektu aplikacije

1. Vercel → projekat aplikacije (onaj koji danas služi `zevupravnik.com`) → **Settings → Domains**.
2. **Add Domain** → upisati `app.zevupravnik.com` → Environment **Production** → *Connect to an
   environment* (ne „Redirect“).
3. Vercel prikazuje traženi DNS zapis, najčešće **CNAME** sa vrijednošću `cname.vercel-dns.com` ili
   projektnom vrijednošću oblika `xxxxxxxx.vercel-dns-0xx.com`. **Upisuje se tačno vrijednost koju
   Vercel prikaže.**

### 1.2 Cloudflare: DNS zapis za `app`

Cloudflare → `zevupravnik.com` → **DNS → Records → Add record**:

| Type | Name | Target | Proxy status | TTL |
|---|---|---|---|---|
| CNAME | `app` | vrijednost iz Vercela (korak 1.1) | **DNS only** (sivi oblak) | Auto |

**Zašto DNS only:** Vercel tada sam izdaje i obnavlja TLS sertifikat i vidi pravu IP adresu
posjetioca, a time i ograničenje pokušaja prijave. Vercel ne preporučuje Cloudflare proxy ispred
svoje platforme. Ako ipak želite proxy (narandžasti oblak), **SSL/TLS → Overview** mora biti
**Full (strict)**, nikako „Flexible“ (inače nastaje beskonačno preusmjeravanje).

### 1.3 Sačekati sertifikat

U Vercel → Domains, uz `app.zevupravnik.com` treba da piše **Valid Configuration**. Obično traje
nekoliko minuta. Provjera iz terminala:

```bash
curl -sI https://app.zevupravnik.com/api/health
```

Odgovor treba da bude `HTTP/2 200`.

### 1.4 Promijeniti `APP_URL`

1. Vercel → projekat aplikacije → **Settings → Environment Variables** → `APP_URL` (Production) →
   **Edit** → `https://app.zevupravnik.com`, tačno tako: `https`, bez kose crte na kraju.
2. **Deployments** → posljednji Production deploy → **⋯ → Redeploy**. Varijable važe tek u novom
   deployu.
3. Ako postoje i Preview varijable sa `APP_URL`, ne treba ih dirati.

### 1.5 Provjera (nakon redeploya)

- `https://app.zevupravnik.com/login`: prijava radi, a poslije prijave ste na Početnoj.
- **Podešavanja → ZEV → Test e-pošte:** poruka pokazuje „Adresa aplikacije: https://app.zevupravnik.com“.
- **Zaboravljena lozinka** za svoj nalog: link u e-poruci vodi na `app.`.
- `https://zevupravnik.com` i dalje otvara aplikaciju (stari linkovi rade).

### 1.6 Ažurirati ono što ima staru adresu upisanu van aplikacije

1. **SMS banke (iPhone Shortcuts):** Podešavanja → ZEV → kartica *Automatski prijem SMS obavještenja
   banke* sada prikazuje novu adresu (`https://app.zevupravnik.com/api/uplate/sms`). Na svakom telefonu
   koji prosljeđuje poruke: Shortcuts → Automation → ta automatizacija → akcija *Get contents of URL* →
   zamijeniti adresu. Pristupni ključ ostaje isti. Zatim u istoj kartici kliknuti **provjera poruke**.
2. **Povezani asistenti (samo ako je `MCP_ENABLED` uključen i postoje veze):** stare veze više ne
   prolaze, jer je resurs vezan za staru adresu. Na stranici *Povezani asistenti* prekinuti stare veze i
   napraviti nove. Claude konektor (OAuth) ukloniti u Claude-u i ponovo dodati sa adresom
   `https://app.zevupravnik.com/api/mcp`.
3. **Korisnici:** pri prvom ulasku na `app.` prijavljuju se ponovo. Preporuka je kratka obavijest
   predsjednicima: „Aplikacija je od danas na app.zevupravnik.com; stari linkovi i dalje rade.“

Faza 1 može ovim stajati koliko god treba. Stari domen i dalje služi aplikaciju.

### 1.7 Pravilo: sve sa `zevupravnik.com` na `app.` (završetak Faze 1)

Pravilo radi samo dok je apex zapis **proxied** (narandžasti oblak), što je danas slučaj.

1. Cloudflare → `zevupravnik.com` → **Rules → Redirect Rules → Create rule** (Single Redirect).
2. Naziv: `Aplikacija na app.`
3. **If incoming requests match… → Custom filter expression → Edit expression**:
   ```
   (http.host eq "zevupravnik.com")
   ```
4. **Then… → Type: Dynamic**, **Expression**:
   ```
   concat("https://app.zevupravnik.com", http.request.uri.path)
   ```
   **Status code: 308**, **Preserve query string: uključeno**.
5. **Deploy.**

Provjera:

```bash
curl -sI "https://zevupravnik.com/glasanje/primjer?potvrda=1" | grep -i -E "^HTTP|^location"
```

Očekivano: `308` i `location: https://app.zevupravnik.com/glasanje/primjer?potvrda=1`.

Poslije ovoga svi koriste samo `app.`. Pravilo zadržava i `POST` (308), pa i telefon kome SMS
automatizacija još nije ažurirana i dalje radi. Ako preusmjerenje ipak ne prati, rješenje je korak 1.6.1.

---

## Faza 2 — marketinški sajt na `zevupravnik.com` (Cloudflare Pages)

**Preduslov:** marketinški sajt postoji (Astro u `marketing/`, `Plans/marketing-sajt-plan.md` §9 M1–M3),
a pravilo iz 1.7 radi.

### 2.1 Cloudflare Pages: projekat za sajt

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → GitHub, repozitorijum
   `slakic/zev-app` → grana `main`.
2. **Build settings:**
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - **Root directory:** `marketing`
   - Environment variable `NODE_VERSION` = `22` (ili verzija koju `marketing/package.json` traži)
3. **Settings → Builds → Build watch paths:** Include `marketing/*`. Sajt se tada gradi samo kad se
   mijenja sajt, ne pri svakoj izmjeni aplikacije.
4. Ključ za slanje upita (forma „Javite se“, Pages Function `/api/upit`): **Settings → Variables and
   Secrets**, npr. `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `UPIT_PRIMALAC` (tip *Secret*).
5. Prvi deploy je dostupan na `<projekat>.pages.dev`, gdje se sajt provjeri prije prebacivanja domena.

Ograničenja besplatnog plana (u vrijeme pisanja): 500 deploya mjesečno; statički sadržaj bez
ograničenja saobraćaja; Pages Functions (forma) troše dnevnu kvotu Workers Free (100.000 zahtjeva).

### 2.2 Vercel: aplikacija se ne gradi zbog izmjena sajta

Vercel → projekat aplikacije → **Settings → Git → Ignored Build Step** → *Custom*:

```bash
git diff --quiet HEAD^ HEAD -- . ':!marketing' ':!Plans'
```

Aplikacija se ne gradi kad se mijenjaju samo sajt ili planovi.

### 2.3 Suziti pravilo iz 1.7 na putanje aplikacije

**Prije** prebacivanja domena (2.4), jer bi inače pravilo i dalje sve slalo na `app.`:
Rules → Redirect Rules → `Aplikacija na app.` → **Edit** → izraz zamijeniti sa:

```
(http.host eq "zevupravnik.com" and (
  starts_with(http.request.uri.path, "/login") or
  starts_with(http.request.uri.path, "/zaboravljena-lozinka") or
  starts_with(http.request.uri.path, "/reset-lozinka") or
  starts_with(http.request.uri.path, "/glasanje") or
  starts_with(http.request.uri.path, "/onboarding") or
  starts_with(http.request.uri.path, "/uzivo") or
  starts_with(http.request.uri.path, "/nalog") or
  starts_with(http.request.uri.path, "/admin") or
  starts_with(http.request.uri.path, "/oauth") or
  starts_with(http.request.uri.path, "/dokumenti") or
  starts_with(http.request.uri.path, "/evidencije") or
  starts_with(http.request.uri.path, "/fakture") or
  starts_with(http.request.uri.path, "/izvjestaji") or
  starts_with(http.request.uri.path, "/odrzavanje") or
  starts_with(http.request.uri.path, "/organi") or
  starts_with(http.request.uri.path, "/planovi") or
  starts_with(http.request.uri.path, "/podesavanja") or
  starts_with(http.request.uri.path, "/skupstina") or
  starts_with(http.request.uri.path, "/troskovi") or
  starts_with(http.request.uri.path, "/vlasnici") or
  starts_with(http.request.uri.path, "/zgrade") or
  starts_with(http.request.uri.path, "/korisnicko-uputstvo.html") or
  starts_with(http.request.uri.path, "/.well-known/oauth") or
  starts_with(http.request.uri.path, "/api/uplate") or
  starts_with(http.request.uri.path, "/api/dokumenti") or
  starts_with(http.request.uri.path, "/api/prilozi") or
  starts_with(http.request.uri.path, "/api/izvjestaji") or
  starts_with(http.request.uri.path, "/api/admin") or
  starts_with(http.request.uri.path, "/api/onboarding") or
  starts_with(http.request.uri.path, "/api/mcp") or
  starts_with(http.request.uri.path, "/api/health")
))
```

Cilj (Dynamic, `concat(...)`, 308, Preserve query string) ostaje isti. Do prebacivanja domena (2.4)
`/` i ostale putanje i dalje služi aplikacija na Vercelu, pa ovaj korak ništa ne kvari.

Napomene:
- Lista odgovara vrhovima `src/app/` i `src/app/(app)/` u v2.64.1. **Kad aplikacija dobije novi
  modul na vrhu** (nova fascikla u `src/app/(app)/` ili `src/app/api/`), treba ga dodati ovdje.
  Preporuka je da to uđe u kontrolnu listu u `zev-app-guidelines`.
- Sajt **ne smije** imati stranice sa istim počecima putanje (`/login`, `/fakture`…). Forma sajta je na
  `/api/upit`, što se ne sudara sa listom.
- `starts_with` hvata i duže putanje sa istim početkom (npr. `/organizacija`). Sajt ne treba da ima
  takve putanje.

### 2.4 Prebaciti domen na Pages

Najbolje u terminu bez otvorenih glasanja. Prekid traje oko minut.

1. **Zapisati** trenutne apex zapise: Cloudflare → DNS → zapisi za `zevupravnik.com` (Type, Content,
   Proxy). Trebaju za povratak.
2. Cloudflare → DNS → **obrisati** apex A/AAAA (ili CNAME) zapise koji vode na Vercel.
   **MX i TXT zapise ne dirati.**
3. Odmah: **Workers & Pages → projekat sajta → Custom domains → Set up a custom domain** →
   `zevupravnik.com` → **Activate domain**. Cloudflare sam pravi proxied CNAME na `<projekat>.pages.dev`.
4. Isto za `www.zevupravnik.com`.
5. **www → apex:** Rules → Redirect Rules → **Create rule** → predložak *Redirect from WWW to root*
   (ili: izraz `(http.host eq "www.zevupravnik.com")`, Dynamic
   `concat("https://zevupravnik.com", http.request.uri.path)`, 308, Preserve query string).
6. Vercel → projekat aplikacije → Settings → Domains → **Remove** `zevupravnik.com` (i `www`, ako je
   tamo). Ostaje samo `app.zevupravnik.com`.

### 2.5 Provjera

```bash
curl -sI https://zevupravnik.com | head -1
```
```bash
curl -sI "https://zevupravnik.com/glasanje/primjer?potvrda=1" | grep -i -E "^HTTP|^location"
```
```bash
curl -sI https://zevupravnik.com/login | grep -i -E "^HTTP|^location"
```
```bash
curl -sI https://www.zevupravnik.com/paketi | grep -i -E "^HTTP|^location"
```

Očekivano:
- sajt vraća `200`;
- `/glasanje/…` i `/login` vraćaju `308` na `https://app.zevupravnik.com/…`, a parametar `?potvrda=` ostaje;
- `www` vraća `308` na `https://zevupravnik.com/paketi`.

Ručno još:
- otvoriti stari lični link za glasanje ili poziv iz neke ranije e-poruke: otvara se na `app.`;
- na sajtu poslati probni upit kroz formu „Javite se“;
- u aplikaciji: Podešavanja → ZEV → SMS kartica → **provjera poruke**.

---

## Povratak ako nešto pođe po zlu

- **Faza 1 (koraci 1.1–1.6):** vratiti `APP_URL` na `https://zevupravnik.com` i uraditi Redeploy.
  `app.` može ostati dodat.
- **Pravilo 1.7:** Rules → Redirect Rules → isključiti pravilo (prekidač). Djeluje odmah.
- **Faza 2:**
  1. Pages → Custom domains → ukloniti `zevupravnik.com` i `www`;
  2. vratiti apex zapise zapisane u 2.4.1;
  3. u Vercelu ponovo dodati `zevupravnik.com` projektu aplikacije;
  4. pravilo iz 2.3 vratiti na izraz iz 1.7 (sve na `app.`).

---

## Kontrolna lista

- [ ] 1.1 `app.zevupravnik.com` dodat u Vercel projekat aplikacije
- [ ] 1.2 Cloudflare CNAME `app`, DNS only
- [ ] 1.3 Valid Configuration + `/api/health` 200
- [ ] 1.4 `APP_URL=https://app.zevupravnik.com` + Redeploy
- [ ] 1.5 prijava, test e-pošte, link za reset lozinke
- [ ] 1.6 iPhone SMS automatizacije ažurirane; MCP veze ponovo napravljene; obavijest predsjednicima
- [ ] 1.7 Redirect Rule: sve sa apexa na `app.` (308, query string) + `curl` provjera
- [ ] 2.1 Cloudflare Pages projekat (`marketing/`, watch paths, tajne za formu), provjeren na `*.pages.dev`
- [ ] 2.2 Ignored Build Step u Vercel projektu aplikacije
- [ ] 2.3 pravilo suženo na putanje aplikacije
- [ ] 2.4 apex zapisi zapisani, pa obrisani; custom domain na Pages; `www` → apex; domen uklonjen sa Vercela
- [ ] 2.5 `curl` provjere, stari link iz e-poruke, probni upit
- [ ] MX / SPF / DKIM netaknuti

---

Izvori: [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby) ·
[Cloudflare Pages Limits](https://developers.cloudflare.com/pages/platform/limits/) ·
[Single Redirects settings](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/settings/) ·
[Redirect all requests to another domain](https://developers.cloudflare.com/rules/url-forwarding/examples/redirect-all-another-domain/)
