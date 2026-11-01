# MCP platforma — povezani asistenti, tokeni i opsezi — implementacioni plan

**Status: PLAN, odluke usvojene (2026-10-31). Faza P-A (osnova platforme) implementirana 2026-11-01; P-B i dalje čekaju.** Nastalo iz razgovora o MCP-u
za onboarding (2026-10-29/31): MCP se gradi kao **opšta mogućnost aplikacije**, a onboarding je prvi
skup alata na njoj (`Plans/mcp-onboarding-asistent-plan.md`).

Zasnovano na kodu v2.59.0 i na MCP specifikaciji, revizija 2026-07-28 (izvori na kraju). Mockup:
[X-M05-povezani-asistenti.html](design-review/mockups/X-M05-povezani-asistenti.html).

## Odluke na kojima plan počiva (korisnik, 2026-10-31)

| # | Pitanje | Odluka |
|---|---|---|
| P1 | Struktura | **Dva plana:** ovaj (platforma) i `mcp-onboarding-asistent-plan.md` (alati za nacrt) |
| P2 | Gdje se izdaju tokeni | **Meni naloga → „Povezani asistenti“** (`/nalog/asistenti`), u sve tri ljuske; radi i za korisnika bez ZEV-a |
| P3 | Dizajn sistem | **Odobrene dvije dopune** iz X-M05: meni naloga sa listom stavki i izbor sa opisom (radio kartice) |
| P4 | Opsezi u prvoj verziji | **Samo „Onboarding: [nacrt]“.** „Samo čitanje: [ZEV]“ je drugi slučaj, kasnije |
| P5 | Rok tokena | **7, 30 ili 90 dana**; onboarding opseg se gasi i objavom ili odbacivanjem nacrta |
| P6 | Super admin i nacrt klijenta | Super admin svom tokenu **dodaje pristup** nacrtu sa stranice nacrta; klijent taj pristup vidi i može ga ukloniti |
| P7 | Ciljni klijenti | **Claude Pro i ChatGPT Plus.** Na tim planovima sopstveni konektor praktično traži OAuth, pa **OAuth ide odmah iza osnove platforme** (§8) |
| M-0 | Provjera klijenata (2026-10-31) | **Urađena** ([`mcp-m0-provjera-klijenata.md`](mcp-m0-provjera-klijenata.md)): Claude Pro traži OAuth sa Dynamic Client Registration (nema polja za token); OpenAI aplikacija sa „Add MCP server“ (vjerovatno Codex) prihvata token u zaglavlju; ChatGPT web nije provjeren |

---

## 0. Rezime — pročitati prije ostatka

**Token pripada korisniku, ne nacrtu niti ZEV-u.** Token kaže samo ko je korisnik i šta mu je
dozvolio (opseg). Šta asistent stvarno smije, server provjerava **na svakom pozivu**, istim izvorom
kao aplikacija:
- za postojeće ZEV-ove iz `Membership` (kad dođu ti opsezi);
- za onboarding iz vlasništva nacrta ili pristupa koji je super admin dobio (P6).

Kad se članstvo ukine ili nacrt objavi, asistent gubi pristup na sljedećem pozivu, bez diranja tokena.

**Asistent nikad nema više prava od korisnika, a može imati manje.** Opseg sužava; nikad ne proširuje.

**Dva načina povezivanja, jedan server:**
- **Token** (ručno, sa stranice „Povezani asistenti“): za Claude Code, za pilot i za klijente koji
  podržavaju zaglavlje.
- **OAuth 2.1** (konektor: „Poveži → prijava → Dozvoli“): za Claude Pro i ChatGPT Plus (P7). Na
  ekranu „Dozvoli“ korisnik bira isti opseg kao u formi za token, pa obje vrste veze završe u istoj
  listi „Povezani asistenti“.

---

## 1. Zatečeno stanje (provjereno u kodu)

| Šta | Gdje | Značaj |
|---|---|---|
| Prava po ZEV-u su `Membership` (korisnik, ZEV, uloga) | `prisma/schema.prisma`, `resolveActiveContext` u `session.ts` | Jedini izvor istine i za asistenta |
| Servisi provjeravaju `requireRole` / `requireZev` i filtriraju po `zevId` | `src/server/services/*` | MCP alati pozivaju iste servise sa `Actor`-om izvedenim iz tokena |
| Bearer tajna za mašinski poziv (SMS) | `/api/uplate/sms`, `bankSms.ts` | Presedan: hash u bazi, prikaz jednom, opoziv; ruta ne čita sesiju |
| Meni naloga ima mjesto za **jednu** stavku (`accountLink`) | `src/components/nav-shell.tsx` | Dopuna DS-a (P3) |
| Ljuska čarobnjaka nema meni naloga (samo „Odjava“) | `src/app/onboarding/(wizard)/layout.tsx` | Mora dobiti meni naloga sa „Povezani asistenti“ |
| Izbor sa opisom ne postoji kao obrazac | `Plans/design-system.md` | Dopuna DS-a (P3) |
| Jednokratni prikaz tajne već postoji | `InviteLink` (`src/components/invite-link.tsx`) | Isti obrazac za token |

---

## 2. Model podataka

```prisma
/// Veza asistenta (MCP) sa nalogom korisnika (Plans/mcp-platforma-plan.md). Token se ne čuva, samo
/// sha256; prikazuje se jednom. Veza napravljena kroz OAuth (§5) ima isti red, sa `kind = OAUTH`.
model McpConnection {
  id          String            @id @default(cuid())
  user        User              @relation(fields: [userId], references: [id])
  userId      String            // vlasnik veze (User.id)
  name        String            // „Moj Claude na laptopu“
  client      McpClient         // CLAUDE | OPENAI | OTHER — samo za uputstvo i prikaz
  kind        McpConnectionKind @default(TOKEN)
  scopes      Json              // McpScope[] (§3)
  tokenHash   String?           @unique // TOKEN; za OAUTH tokeni su u McpOAuthToken (§5)
  createdAt   DateTime          @default(now())
  expiresAt   DateTime
  lastUsedAt  DateTime?
  revokedAt   DateTime?
  revokedById String?

  @@index([userId])
}

enum McpConnectionKind {
  TOKEN
  OAUTH
}

enum McpClient {
  CLAUDE
  OPENAI
  OTHER
}

/// **Nastao u fazi O-A (✅ isporučeno), ne u P-A:** P-A nema alata koji čita nacrt, pa model ne bi imao šta da radi.
/// Pristup super admina nacrtu klijenta (P6). Dodaje se sa /admin/nacrti/[id]; klijent ga vidi na
/// „Povezani asistenti“ i može ukloniti. Važi za sve veze super admina koje imaju onboarding opseg
/// za taj nacrt: red odlučuje, pa uklanjanje pristupa odmah gasi sve te veze, a ponovno dodavanje ih opet
/// uključuje (Q8). Najviše jedan aktivan red po (nacrt, admin) — parcijalni jedinstveni indeks
/// `WHERE "revokedAt" IS NULL` dodat ručno u migraciju (Prisma ga ne modelira).
model OnboardingDraftAdminAccess {
  id          String          @id @default(cuid())
  draft       OnboardingDraft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  draftId     String
  adminUserId String
  grantedAt   DateTime        @default(now())
  lastUsedAt  DateTime?       // posljednji poziv alata kroz pristup; upis najviše jednom u 5 minuta
  revokedAt   DateTime?
  revokedById String?         // klijent ili super admin

  @@index([draftId])
  @@index([adminUserId])
}
```

- Token: `zev_mcp_` + 32 nasumična bajta (`generateToken`). Prefiks pomaže da se procurjeli token
  prepozna (npr. u logu ili repozitorijumu).
- Bez ograničenja broja veza u prvoj verziji; lista ih sve prikazuje.

---

## 3. Opsezi

Opseg je tipizovan objekat, ne slobodan string, i provjerava se na svakom pozivu.

```ts
type McpScope =
  | { kind: "ONBOARDING_DRAFT"; draftId: string } // prva verzija (P4)
  | { kind: "ZEV_READ"; zevId: string };          // drugi slučaj, kasnije
```

**Ponuđeni opsezi** u formi (i na ekranu OAuth „Dozvoli“) su samo oni koje korisnik ima:
- `ONBOARDING_DRAFT`: nacrt u toku čiji je korisnik vlasnik, ili nacrt kojem super admin ima pristup
  (P6).
- `ZEV_READ` (kasnije): ZEV-ovi iz `Membership`.

**Provjera na pozivu** (`resolveMcpAccess(connection, scope)`):
1. veza postoji, nije opozvana ni istekla, korisnik je aktivan;
2. opseg je u vezi;
3. pravo i dalje postoji: nacrt je `IN_PROGRESS` i korisnik je vlasnik ili ima aktivan
   `OnboardingDraftAdminAccess` (za `ZEV_READ`: članstvo u tom ZEV-u);
4. tek tada se pravi `Actor`/`DraftAccess` i poziva servis.

Alat koji traži opseg koji veza nema vraća jasnu grešku („Ova veza nema pristup …“), ne 401.

---

## 4. Ruta, autentifikacija i trag

- **Ruta (isporučeno u P-A):** `src/app/api/mcp/route.ts`, javni URL `${APP_URL}/api/mcp`, Streamable HTTP,
  stateless. Biblioteka je **`@modelcontextprotocol/server` 2.4.0 (SDK v2) direktno, bez `mcp-handler`**
  (odluka 2026-11-01): njegov web-standardni `createMcpHandler(factory, { responseMode: "json" })` vraća
  `{ fetch }`, a `handler.fetch(request, { authInfo })` prosljeđuje provjerenu vezu fabrici koja po zahtjevu
  pravi `McpServer` samo sa alatima dozvoljenim opsegom veze.
- **Provjera tokena (`src/server/mcp/auth.ts`)**: prihvata token veze (`TOKEN`); OAuth access token (`OAUTH`,
  §5) dolazi u P-B. Bez važećeg tokena ruta vraća 401 sa `WWW-Authenticate: Bearer realm="zev-upravnik"`.
  **Zaglavlje još NE upućuje na Protected Resource Metadata (RFC 9728)** — nema `/.well-known/oauth-protected-resource`
  dok P-B ne doda metapodatke i authorization server.
- **Identitet samo iz tokena;** ruta ne čita kolačiće ni sesiju (isto pravilo kao SMS webhook).
- **Registar alata:** svaki skup alata (onboarding, kasnije čitanje ZEV-a) se registruje sa opsegom
  koji traži. Lista alata koju klijent vidi zavisi od opsega veze, pa asistent ne vidi alate koje ne
  može koristiti.
- **Trag:** svaki poziv koji mijenja podatke → audit `mcp.call` (alat, broj stavki, `connectionId`,
  opseg; **bez** sadržaja i bez tokena). Pozivi za čitanje → samo `lastUsedAt`. Izdavanje, opoziv i
  dodjela pristupa nacrtu → audit (`mcp.connection.create`, `mcp.connection.revoke`,
  `mcp.draft_access.grant`, `mcp.draft_access.revoke`).
- **Granice:** rate limit po vezi (prijedlog: 120 poziva u minuti); veličina tijela prati
  `MAX_UPLOAD_MB`.
- **Flag:** `MCP_ENABLED` (podrazumijevano `false`). Isključen → ruta vraća 404, stavka „Povezani
  asistenti“ se ne prikazuje.

---

## 5. OAuth 2.1 (Faza P-B, odmah iza osnove — P7)

> **Implementirano u Fazi P-B (uz flag `MCP_OAUTH_ENABLED`, podrazumijevano isključen).** Stvarna rješenja i odluke
> korisnika (2026-11-01) su ispod; tekst iza ovog okvira je izvorni plan. Cijela OAuth površina je u
> `src/lib/mcp/oauth.ts` (čista pravila) i `src/server/mcp/oauth/*` (HTTP, klijenti, autorizacija, tokeni, čišćenje),
> sa rutama u `src/app/.well-known/*` i `src/app/oauth/*`.
>
> - **D1.** DCR prvi, CIMD napravljen ali ne oglašen: `CIMD_ADVERTISED = false` u `oauth.ts` (promijeniti nakon provjere
>   na pravom Claude klijentu); CIMD se prihvata samo za domaćine claude.ai, claude.com, chatgpt.com, openai.com.
> - **D2.** Povratne adrese: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`,
>   `https://chatgpt.com/connector_platform_oauth_redirect`, `https://chatgpt.com/connector/oauth/<id>` i
>   `http://localhost|127.0.0.1|[::1]` (bilo koji port i putanja; port se pri poređenju ignoriše). Bez fragmenta.
> - **D3.** `MCP_OAUTH_ENABLED` (samo uz `MCP_ENABLED`): isključen → `/.well-known/*` i `/oauth/*` su 404, a 401 na
>   `/api/mcp` ostaje kao u P-A.
> - **D4.** Neprozirni tokeni (`zev_mcp_at_…`, `zev_mcp_rt_…`), u bazi samo sha256. Access 1 h (ne duže od veze), refresh
>   ističe s vezom (bez produžavanja), rotira se pri svakoj upotrebi. Ponovljen stari refresh unutar 60 s → samo
>   `invalid_grant`; poslije 60 s → veza i svi tokeni se prekidaju i piše se `mcp.oauth.token_reuse`.
> - **D5.** `McpConnection` (kind OAUTH) nastaje pri razmjeni koda, ne pri saglasnosti. Ponovna upotreba koda prekida vezu.
> - **D6.** Ekran saglasnosti u `AuthShell` sa novim `width="wide"` (jedina dopuna dizajn sistema u ovoj fazi).
> - **D7.** Nema `/.well-known/openid-configuration`.
> - **D8.** `/oauth/revoke` (RFC 7009) postoji; opoziv refresh tokena prekida cijelu vezu.
> - **D9.** `recordMcpAuthFailure` samo kad je Authorization zaglavlje poslato; `/oauth/token` 120 / 10 min po IP,
>   `/oauth/register` 60 / sat po IP, uz plafon od 500 neiskorišćenih DCR klijenata u 24 h (503).
>
> **Odstupanja od plana pri izradi:** metapodaci se grade ručno (bez SDK pomoćnika) radi čitljivosti; `redirect_uri` na
> token endpointu mora biti identičan onom iz zahtjeva autorizacije (RFC 6749), uključujući port na lokalnom računaru;
> greške odluke na ekranu saglasnosti vraćaju se kao kratak kod (`err=scope|name|days|request|other`), ne kao tekst u
> adresi; dodata je akcija „Nisam ja, odjavi me" koja vraća na isti zahtjev; zaglavlja `/oauth/:path*` (DENY okviri,
> `no-referrer`, `no-store`) su u `next.config.ts`. **Spoljni sigurnosni pregled i dalje prethodi uključivanju u produkciji.**

Za Claude Pro i ChatGPT Plus korisnik dodaje konektor sam, a sopstveni konektor na tim planovima
praktično traži OAuth. **M-0 je to potvrdio za Claude Pro:** na 401 claude.ai odmah traži OAuth
metapodatke i pokušava Dynamic Client Registration; polja za token nema. Aplikacija je istovremeno **authorization server** i **resource server**:

- **Protected Resource Metadata** (RFC 9728) na `/.well-known/oauth-protected-resource`.
- **Authorization Server Metadata** (RFC 8414) na `/.well-known/oauth-authorization-server`.
- **Registracija klijenta:** Dynamic Client Registration (Claude ga koristi automatski — potvrđeno u
  M-0; bez njega Claude Pro traži ručni „OAuth Client ID“) i Client ID Metadata
  Documents prema reviziji specifikacije; callback adrese Claude-a i ChatGPT-ja na listi dozvoljenih.
- **`/oauth/authorize`:** korisnik se prijavi postojećom prijavom aplikacije, vidi **isti izbor opsega
  kao u formi X-M05** i klikne „Dozvoli“. PKCE je obavezan.
- **`/oauth/token`:** kratkotrajni access token (npr. 1 sat) i refresh token sa rokom veze (P5).
  Tokeni se čuvaju samo kao hash.
- Svaka OAuth dozvola je jedan red `McpConnection` (`kind = OAUTH`), pa je korisnik vidi i prekida na
  istoj stranici kao token.
- **Spoljni sigurnosni pregled** prije uključivanja u produkciji.

Dodatni model (`McpOAuthClient`, `McpOAuthCode`, `McpOAuthToken`) se detaljno razrađuje na početku
Faze P-B, prema rezultatu Faze M-0.

---

## 6. Ekrani (mockup X-M05)

- **Meni naloga** dobija listu stavki („Moji podaci“, „Povezani asistenti“, „Korisničko uputstvo“,
  „Odjava“) u sve tri ljuske: aplikacija ZEV-a, platformski admin i čarobnjak. `NavShell` prop
  `accountLink` postaje `accountLinks`; ljuska čarobnjaka dobija isti meni naloga.
- **`/nalog/asistenti`:** forma „Poveži asistenta“ (naziv, asistent, opseg kao radio kartice sa „smije
  / ne smije“, rok), jednokratni prikaz adrese i tokena sa uputstvom po asistentu, lista aktivnih veza
  sa „Prekini vezu“ (`caution` + `ConfirmAction`).
- **Pristup administratora** (P6): na istoj stranici, kod klijenta, kartica „Pristup administratora
  Vašem nacrtu“ (ko, od kada, „Ukloni pristup“).
- **Prečice sa preselektovanim opsegom:** iz čarobnjaka (veza „Asistent“) i iz admin pregleda nacrta.
- Dopune `Plans/design-system.md`: `accountLinks` u `NavShell`, primitiv izbora sa opisom
  (`ChoiceCards`: `fieldset` + radio, izabrana kartica `border-2 border-primary bg-primary-soft/40`,
  opis `text-[13px]`), bez nove boje, veličine ili razmaka.

---

## 7. Bezbjednost

- **Token je bearer kredencijal:** 256 bita, prefiks `zev_mcp_`, samo hash u bazi, prikaz jednom, rok,
  opoziv, rate limit. Nikad u odgovoru alata ni u auditu.
- **Prava se ne kopiraju u token:** svaki poziv ponovo provjerava članstvo, vlasništvo nacrta ili
  pristup administratora (§3).
- **Uputstva podmetnuta u sadržaju koji asistent čita** (dokumenti, poruke): odbrana je u dizajnu
  alata — nema alata sa nepovratnom posljedicom (objava, potvrda, slanje poruka, nalozi, lozinke).
  Svaki skup alata to mora poštovati; pravilo se upisuje u `Plans/design-system.md` ili
  `zev-app-guidelines` kao obavezno za nove MCP alate.
- **Super admin** nema automatski pristup ničemu kroz MCP: samo ono što bi imao i u aplikaciji, plus
  izričit i vidljiv pristup nacrtu (P6).
- **OAuth:** PKCE obavezan, kratkotrajni access tokeni, tačna lista callback adresa, spoljni pregled.

---

## 8. Redoslijed isporuke

Svaka faza je zasebna minor verzija sa `CHANGELOG.md` unosom. Redoslijed sa planom onboardinga:

1. **Faza M-0 — provjera klijenata (bez koda u aplikaciji). ✅ Urađena 2026-10-31**, rezultati u
   [`mcp-m0-provjera-klijenata.md`](mcp-m0-provjera-klijenata.md). Probni MCP server (jedan alat `ping`) na
   preview okruženju. **Korisnik ga dodaje kao konektor u svom Claude Pro i ChatGPT Plus nalogu**; ja
   pripremam server, preview i uputstvo. Bilježi se šta koji klijent prihvata (token u zaglavlju,
   OAuth, bez prijave) i da li ChatGPT Plus uopšte dozvoljava sopstveni konektor. Rezultat se upisuje
   u §5 i u plan onboardinga.
2. **Faza P-A — osnova platforme. ✅ Urađena 2026-11-01** (v2.60.0 uz potvrdu korisnika). `McpConnection`, `/nalog/asistenti` (forma, jednokratni prikaz,
   lista, prekid), meni naloga u sve tri ljuske, ruta `/api/mcp` sa `withMcpAuth`, provjera opsega,
   audit, flag `MCP_ENABLED`. Bez ijednog alata osim `whoami` (ko sam i koje opsege imam).
3. **Faza P-B — OAuth 2.1** (§5), **odmah iza P-A** (odluka 2026-10-31): posle P-A i P-B korisnik u
   svom Claude Pro dodaje pravi konektor, klikne „Dozvoli“ i pozove `whoami`, pa se svaka kasnija faza
   onboardinga odmah provjerava u Claude Pro, kao kod klijenata.
4. **Onboarding O-A** (plan onboardinga): pristup nacrtu, čitanje, pristup administratora (P6). ✅ Urađena 2026-11-01.
5. **Onboarding O-B i O-C:** upis, grupni unos, vlasnici sa dokazima.

M-0 je pokazao da Claude Pro **ne** prihvata token u zaglavlju, pa P-B (OAuth) ide odmah iza P-A,
prije svih faza onboardinga. Token iz P-A se koristi od početka u klijentima koji ga prihvataju
(OpenAI aplikacija sa „Add MCP server“, Claude Code).

---

## 9. Rizici i otvoreno

- **ChatGPT:** u M-0 je provjerena OpenAI aplikacija sa „Plugins → Add MCP server“ (vjerovatno Codex,
  alat za programere) — radi sa tokenom. **ChatGPT web (chatgpt.com) na Plus planu nije provjeren**
  (odluka korisnika); noviji izvori kažu da su sopstveni konektori tamo uglavnom na poslovnim
  planovima. Dok se ne provjeri, uputstvo i prodaja ne obećavaju ChatGPT web.
- **Promjenljivost klijenata i biblioteka:** konektori u claude.ai i ChatGPT i `mcp-handler`/SDK se
  mijenjaju brzo. Verzije se zaključavaju; M-0 se ponavlja prije svakog većeg izdanja.
- **OAuth je najveći i najrizičniji dio posla;** spoljni pregled je uslov za produkciju.
- **Pravna strana:** saglasnost klijenta za pristup administratora (P6) i tekst obavještenja na
  stranici „Povezani asistenti“ — pregled pravnika.
- **O-A (odluke Q1, Q5, 2026-11-01):** pristup administratora je aktivan odmah, bez koraka saglasnosti klijenta;
  klijent ga vidi (kartica na „Povezani asistenti“ i obavještenje u čarobnjaku) i može ukloniti, a admin ga može
  ponovo dodati (klijent to opet vidi). `get_draft` asistentu šalje lične podatke vlasnika (imena, e-pošta, telefon,
  JMBG/ID organizacije), udjele i e-adresu za prijavu računovođe — nikad hash lozinke, bajtove fajlova ni e-poštu
  iz poziva. **Pravnik pregleda tekst obavještenja i ovu obradu podataka prije uključivanja `MCP_ENABLED` u
  produkciji.**

---

## Izvori

- [MCP specifikacija — Authorization (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP specifikacija — Streamable HTTP (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP — Understanding Authorization](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization)
- [vercel/mcp-handler](https://github.com/vercel/mcp-handler)
- [Claude — Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Claude — Building custom connectors via remote MCP servers](https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)
- [Auth0 — Integrate your MCP server in ChatGPT](https://auth0.com/blog/add-remote-mcp-server-chatgpt/)
- [Peliqan — ChatGPT MCP: plans, setup and what breaks in 2026](https://peliqan.io/blog/chatgpt-mcp/)
