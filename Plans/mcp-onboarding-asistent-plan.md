# MCP server za onboarding — asistent popunjava nacrt novog ZEV-a — implementacioni plan

**Status: PLAN, odluke usvojene (2026-10-29), implementacija nije počela.** Nastalo na prijedlog
korisnika (2026-10-29): onboarding novog ZEV-a kao prvi slučaj za MCP (Model Context Protocol) u
ovoj aplikaciji.

Zasnovano na kodu v2.59.0 (čarobnjak: `Plans/zev-onboarding-wizard-plan.md`) i na MCP specifikaciji,
revizija 2026-07-28 (izvori na kraju).

## Odluke na kojima plan počiva (korisnik, 2026-10-29)

| # | Pitanje | Odluka |
|---|---|---|
| M1 | Autentifikacija | **Token vezan za jedan nacrt** u prvoj verziji (kao SMS ključ); **OAuth 2.1** za konektor u claude.ai kao zasebna faza M-D |
| M2 | Ko koristi asistenta | **Vlasnik nacrta i super admin.** Super admin povezuje asistenta na `/admin/nacrti/[id]` |
| M2a | Da li klijent vidi vezu super admina | **Da.** Na stranici „Asistent“ vidi ko je povezao asistenta i od kada, i može prekinuti vezu |
| M2b | Prava super admin asistenta | **Isti alati i ista ograničenja kao klijentov asistent** |
| M3 | Brisanje | **Dozvoljeno, samo u nacrtu, uz trag** |
| M4 | Dokaz o vlasništvu | **Fajl kroz alat** (base64, do 4 MB, isti formati); pravilo „nema udjela bez dokaza“ ostaje |
| M5 | Grupni upis | **Sve ili ništa, do 200 stavki**; greške po rednom broju; jedna verzija nacrta po pozivu |
| M6 | Trag | **Audit bez sadržaja + oznaka na stavkama** („Upisao asistent“ / „Upisao asistent administratora“) |
| M7 | Rok tokena | **7 dana**; jedan aktivan token po nacrtu i izdavaču; gasi se opozivom, objavom ili odbacivanjem nacrta |
| M8 | Ciljni klijenti | **Claude i ChatGPT ravnopravno** (dopuna, 2026-10-29). Prije Faze M-A ide provjera šta svaki traži (Faza M-0, §8); ako oba za ciljne korisnike traže OAuth, M-D se pomjera odmah iza M-A (§2.1) |

---

## 0. Rezime — pročitati prije ostatka

**Problem koji MCP rješava.** Najsporiji dio čarobnjaka je prepisivanje dokumenata:
- etažni elaborat (desetine posebnih dijelova sa površinom i udjelom);
- izvodi iz katastra i ugovori (vlasnici i udjeli);
- rješenje o registraciji (JIB, registarski broj, adresa).

Klijent (ili super admin koji mu pomaže) da te dokumente svom asistentu (Claude ili ChatGPT, kroz
konektor; ili Claude Desktop / Claude Code). Asistent ih pročita i kroz MCP alate popuni nacrt, a klijent u čarobnjaku
pregleda, ispravi i **sam objavi**.

**Zašto baš ovdje.**
1. **Sve izmjene već idu kroz servise sa pravilima** (`saveZevStep`, `addDraftUnit`, `addDraftStake`…).
   MCP alat je tanak omotač oko postojeće funkcije, bez novih pravila.
2. **Asistent tačno zna šta nedostaje.** `onboardingProgress` vraća ✓/⚠ po koraku, pa asistent može
   raditi u petlji „popuni → provjeri → ispravi“.
3. **Greška asistenta ne može oštetiti evidenciju.** Sve se piše u nacrt; ZEV ne nastaje dok čovjek
   ne klikne „Objavi ZEV“.

**Tri stvari koje oblikuju plan:**
- **Asistent nikad ne potvrđuje registar, ne objavljuje ZEV i ne otvara naloge sa lozinkom.** Te radnje
  ostaju dugme u aplikaciji, iza potvrde. To je i glavna odbrana od uputstava podmetnutih u
  dokumentima (§6).
- **Token vidi tačno jedan nacrt.** I klijentov i administratorov token su vezani za jedan nacrt;
  nijedan ne otvara postojeće ZEV-ove, pozive ni druge nacrte.
- **Pristup nacrtu više nije samo „vlasnik“** (M2). Servis zato dobija jedan pojam pristupa nacrtu
  (§4.2), koji koriste čarobnjak, MCP klijenta i MCP administratora, umjesto provjere vlasnika
  rasute po funkcijama.

---

## 1. Zatečeno stanje (provjereno u kodu)

| Šta | Gdje | Značaj za MCP |
|---|---|---|
| Svaka izmjena nacrta ide kroz `updateDraft`: vlasnik, guard koraka, optimistička brava (`version`) | `src/server/services/onboarding.ts` | Alati pozivaju iste funkcije; asistent ne može preskočiti korak niti pregaziti izmjenu čovjeka |
| `updateDraft` traži nacrt po `ownerUserId` (`getMyDraft`) | isto | Za super admina (M2) pristup se mora izraziti drugačije (§4.2) |
| Napredak je čista funkcija | `onboardingProgress`, `src/lib/onboarding/progress.ts` | Alat `get_onboarding_status` je samo njen izlaz |
| Pravila su dijeljena sa aplikacijom | `identifiers.ts`, `registerRules.ts`, `shareSum.ts`, `assertUploadable` | Asistent ne dobija blaža pravila od čovjeka |
| Bearer tajna po ZEV-u za poziv bez sesije | `/api/uplate/sms` (`receiveBankSms`), `bank-sms-token-card.tsx` | Presedan za token asistenta: hash u bazi, prikaz jednom, opoziv |
| Mašinske API rute ne čitaju sesiju | komentar u `src/app/api/uplate/sms/route.ts` | Isto pravilo za `/api/mcp`: identitet samo iz tokena |
| Dokaz je obavezan po udjelu, do 4 MB, PDF/JPG/PNG/WEBP | `addDraftStake`, `assertUploadable` | `add_owner_stake` prima fajl (M4) |
| Posebni dijelovi se dodaju jedan po jedan | `addDraftUnit` | Za MCP treba grupni upis (M5) |
| Izmjene nacrta se ne bilježe u audit | `onboarding.ts` | Za MCP treba trag i oznaka (M6) |
| Pregled nacrta za super admina postoji | `/admin/nacrti/[id]` | Mjesto gdje super admin povezuje asistenta (M2) |

---

## 2. Kako izgleda za korisnike

**Klijent:**
1. U čarobnjaku otvori **„Asistent“** (`/onboarding/asistent`, veza u gornjoj traci čarobnjaka).
2. Klikne „Poveži asistenta“ i dobija adresu servera, token (prikazan jednom) i kratko uputstvo za
   Claude Desktop i Claude Code.
3. U razgovoru sa asistentom priloži elaborat i napiše npr. *„Popuni posebne dijelove iz ovog
   elaborata“*.
4. Asistent čita stanje, upisuje, provjerava i javlja šta nedostaje.
5. Klijent u čarobnjaku vidi upisane podatke sa oznakom „Upisao asistent“, ispravlja ih, **sam
   potvrđuje registar i sam objavljuje ZEV**.

**Super admin:**
1. Na `/admin/nacrti/[id]` klikne „Poveži asistenta za ovaj nacrt“ i dobija sopstveni token, vezan
   samo za taj nacrt.
2. Njegov asistent ima iste alate i ista ograničenja kao klijentov.
3. Stavke koje upiše nose oznaku „Upisao asistent administratora“.

**Vidljivost (M2a):** stranica „Asistent“ u čarobnjaku prikazuje sve aktivne veze: svoju i
administratorovu („Administrator platforme Marko Jovanović, od 29. 10. 2026.“). Klijent može prekinuti
svaku. Prekid administratorove veze se bilježi u audit, a admin na pregledu nacrta vidi da je veza
prekinuta.

**Kraj veze:** „Prekini vezu“, istek roka (7 dana), objava ili odbacivanje nacrta.

### 2.1 Klijenti: Claude i ChatGPT (M8)

MCP je otvoren standard, pa jedan server radi sa svakim klijentom koji podržava udaljene MCP servere
preko Streamable HTTP. Razlika je u tome **kako klijent dolazi do pristupa** i **na kojem planu** to
može. Stanje prema javnoj dokumentaciji i vodičima (oktobar 2026, izvori na kraju; provjerava se
ponovo u Fazi M-0):

| Klijent | Kako se dodaje | Autentifikacija | Planovi |
|---|---|---|---|
| Claude Code, Claude Desktop (lokalna konfiguracija) | Adresa servera + zaglavlje u podešavanjima | **Token** u `Authorization` zaglavlju | Svi |
| claude.ai (web i aplikacija), sopstveni konektor | „Dodaj konektor“ → adresa servera | Uglavnom **OAuth**. Fiksni token u zaglavlju dokumentovan je za konektore koje u Team/Enterprise podešava administrator | Pro/Max sami, Team/Enterprise preko administratora |
| ChatGPT, sopstveni konektor | Developer mode → „Create connector“ → adresa servera | **OAuth**, API ključ ili bez prijave (vodiči se ne slažu oko detalja) | Novi izvori: uglavnom Business/Enterprise/Edu; Plus/Pro nejasno |

**Posljedica za plan:**
- **Token (M1) pokriva Claude Code, Claude Desktop i Team/Enterprise konektore u claude.ai.** To je
  dovoljno za pilot sa super adminom (M2) i tehnički pismenim klijentom.
- **Netehnički klijent sa ličnim planom (Claude Pro/Max ili ChatGPT) praktično traži OAuth.** Zato je
  OAuth (Faza M-D) uslov da „klijent sam doda konektor“ radi za većinu klijenata.
- **ChatGPT ima dodatno ograničenje van naše kontrole:** ako su sopstveni konektori samo na poslovnim
  planovima, klijent sa ličnim planom ih neće moći dodati. To treba reći u uputstvu na stranici
  „Asistent“ i ne obećavati u prodaji.
- **OAuth server mora raditi sa oba klijenta.** Claude koristi Dynamic Client Registration i ima svoju
  callback adresu; ChatGPT ima svoju. Obje callback adrese idu na listu dozvoljenih, a registracija
  klijenta mora podržati oba toka.

---

## 3. Alati (prva verzija)

Svi alati rade nad **nacrtom za koji je token izdat** i ničim drugim. Svaki alat koji mijenja nacrt
prima `expected_version`. Ako je nacrt u međuvremenu izmijenjen, vraća grešku sa trenutnom verzijom,
pa asistent ponovo čita stanje umjesto da pregazi izmjenu (ista brava kao u UI-ju).

| Alat | Vrsta | Poziva | Napomena |
|---|---|---|---|
| `get_onboarding_status` | čitanje | `onboardingProgress` | Koraci, ✓/⚠ tekstovi, trenutni korak, `version` |
| `get_draft` | čitanje | učitavanje nacrta | Podaci **bez** bajtova fajlova i bez hasha lozinke; uz svaku stavku i njen izvor (M6) |
| `save_zev_details` | upis | `saveZevStep` | Korak 2; neispravan JIB se čuva i vraća kao upozorenje (isto kao UI) |
| `add_bank_account`, `remove_account` | upis | `addDraftAccount`, `removeDraftAccount` | Korak 3; isto pravilo za broj računa |
| `add_building`, `add_entrance`, `remove_building`, `remove_entrance` | upis | funkcije koraka 4 | |
| `add_units` | upis, grupni | **nova** `addDraftUnits` (M5) | Do 200 stavki, sve ili ništa, greške po rednom broju |
| `update_unit`, `remove_unit` | upis | `updateDraftUnit`, `removeDraftUnit` | |
| `add_common_assets` | upis, grupni | **nova** `addDraftCommonAssets` | Do 200, sve ili ništa |
| `remove_common_asset` | upis | `removeDraftCommonAsset` | |
| `add_owner_stake`, `remove_owner_stake` | upis | `addDraftStake`, `removeDraftStake` | Sa dokazom (M4) |
| `set_unit_disputed` | upis | `setUnitDisputed` | |
| `set_accountant`, `set_accountant_later`, `add_board_member`, `remove_board_member` | upis | funkcije koraka 9 | **Bez** otvaranja naloga i lozinki (§6) |

**Namjerno nema alata za:** potvrdu ili otključavanje registra, objavu, otvaranje naloga sa lozinkom,
brisanje ili odbacivanje nacrta, pozive i bilo šta van nacrta (postojeći ZEV-ovi, poruke, e-pošta).

Brisanje (M3) je dozvoljeno samo za stavke nacrta i uvijek ide u audit sa oznakom asistenta.

Svaki alat ima opis na srpskom (šta radi i šta ne radi) i zod šemu ulaza; zod v4 već postoji u
projektu.

---

## 4. Tehnička postavka

### 4.1 Ruta i biblioteka

- **Transport:** Streamable HTTP, stateless, ruta `src/app/api/mcp/[transport]/route.ts` u ovoj Next
  aplikaciji. Radi na Vercelu bez posebnog servera.
- **Biblioteka:** `mcp-handler` (Vercel) sa zvaničnim MCP TypeScript SDK-om. Verzije se moraju
  poklapati: `mcp-handler` 2.x traži SDK 2.x, a 1.x traži `@modelcontextprotocol/sdk` 1.x (najmanje
  1.26.0 zbog sigurnosne ispravke). Tačne verzije se biraju i zaključavaju pri instalaciji.
- **Autentifikacija:** `withMcpAuth` sa sopstvenom `verifyToken` funkcijom. Bez važećeg tokena ruta
  vraća 401 sa `WWW-Authenticate` zaglavljem, kako specifikacija traži.
- **Identitet:** isključivo iz tokena. Ruta ne čita kolačiće ni sesiju (isto pravilo kao SMS webhook).
- **Flag:** `ONBOARDING_MCP_ENABLED` (podrazumijevano `false`). Kad je isključen, ruta vraća 404, a
  veze „Asistent“ se ne prikazuju.

### 4.2 Pristup nacrtu — jedan pojam umjesto „vlasnik“

Danas `updateDraft` pronalazi nacrt preko `ownerUserId`. Sa M2 nacrt mijenjaju tri vrste pozivalaca:
klijent u čarobnjaku, asistent klijenta i asistent super admina. Zato servis dobija jedan tip:

```ts
type DraftAccess = {
  draftId: string;
  /** Ko stoji iza izmjene (User.id): vlasnik nacrta ili super admin koji je izdao token. */
  userId: string;
  via: "WIZARD" | "MCP_OWNER" | "MCP_ADMIN";
};
```

- Čarobnjak pravi `DraftAccess` iz sesije (vlasnik, `WIZARD`).
- MCP ruta ga pravi iz tokena (`MCP_OWNER` ili `MCP_ADMIN`).
- `updateDraft(access, step, version, mutate)` radi kao danas, ali traži nacrt po `draftId` i provjerava
  da je `access` važeći za taj nacrt.

Postojeće funkcije (`saveZevStep`, `addDraftUnit`…) mijenjaju samo prvi argument. Ponašanje
čarobnjaka se ne mijenja, što čuvaju postojeći testovi.

`via` se upisuje uz svaku stavku nacrta koju asistent doda ili izmijeni (`source`, M6), a svaka MCP
izmjena ide i u audit.

### 4.3 Model

```prisma
enum OnboardingAgentIssuer {
  OWNER       // klijent (vlasnik nacrta)
  SUPER_ADMIN // administrator platforme (M2)
}

/// Pristup MCP asistenta jednom nacrtu (Plans/mcp-onboarding-asistent-plan.md). Token se ne čuva,
/// samo sha256; prikazuje se jednom. Gasi se opozivom, istekom, objavom ili odbacivanjem nacrta.
model OnboardingAgentToken {
  id           String                @id @default(cuid())
  draft        OnboardingDraft       @relation(fields: [draftId], references: [id], onDelete: Cascade)
  draftId      String
  issuer       OnboardingAgentIssuer
  issuedById   String                // User.id: vlasnik nacrta ili super admin
  tokenHash    String                @unique
  createdAt    DateTime              @default(now())
  expiresAt    DateTime              // createdAt + 7 dana (M7)
  lastUsedAt   DateTime?
  revokedAt    DateTime?
  revokedById  String?               // ko je prekinuo vezu (klijent može prekinuti i administratorovu)

  @@index([draftId])
}
```

- Jedan aktivan token po paru (nacrt, izdavač). „Poveži asistenta“ izdaje novi i gasi prethodni istog
  izdavača.
- `verifyToken` odbija token čiji nacrt nije `IN_PROGRESS`, pa objava i odbacivanje gase pristup bez
  posebnog koraka.
- Token super admina važi samo dok nalog i dalje ima `isSuperAdmin`.
- Stavke nacrta dobijaju opciono polje `source` (`"MCP_OWNER" | "MCP_ADMIN"`, nedostaje = ručni unos).
  Ručna izmjena u čarobnjaku briše oznaku sa te stavke, jer ju je čovjek pregledao.

### 4.4 Granice

- Veličina tijela zahtjeva prati `MAX_UPLOAD_MB` (dokaz u base64 je oko 4/3 veličine fajla).
- Rate limit po tokenu (prijedlog: 120 poziva u minuti).
- Vercel timeout funkcije treba izmjeriti za `add_units` sa 200 stavki.

---

## 5. Ekrani (mockup prije Faze M-A)

- **`/onboarding/asistent`** (novi ekran u čarobnjaku): opis šta asistent smije i šta ne smije, dugme
  „Poveži asistenta“, jednokratni prikaz adrese i tokena (isti obrazac kao link poziva, `InviteLink`),
  uputstvo za Claude Desktop i Claude Code, lista aktivnih veza sa izdavačem, datumom i „Prekini vezu“
  (`caution` + `ConfirmAction`).
- **`/admin/nacrti/[id]`**: kartica „Asistent“ sa „Poveži asistenta za ovaj nacrt“ i stanjem veza
  (uključujući vezu koju je klijent prekinuo).
- **Oznaka na stavkama** u koracima 2–9: chip „Upisao asistent“ / „Upisao asistent administratora“.
  Novi ključevi u `statusTone` (`SOURCE_MCP_OWNER`, `SOURCE_MCP_ADMIN`), bez novog tona.

Sve iz postojećih primitiva; mockup ide u `Plans/design-review/mockups/` (1440 i 375).

---

## 6. Bezbjednost

- **Uputstva podmetnuta u dokumentima (prompt injection).** Elaborat ili ugovor može sadržati tekst
  napisan da navede asistenta na nešto drugo. Odbrana je u dizajnu, ne u filtriranju teksta:
  - alati mogu dirati samo jedan nacrt;
  - ne postoji alat koji šalje poruke, čita druge ZEV-ove, objavljuje ili otvara naloge;
  - sve trajne posljedice traže klik čovjeka u aplikaciji.

  Najgore što zlonamjeran dokument može postići su pogrešni podaci u nacrtu. Klijent ih vidi (oznaka
  iz M6) i ispravlja prije objave.
- **Token** je bearer kredencijal: 256 bita, samo hash u bazi, prikaz jednom, rok 7 dana, opoziv,
  rate limit. Nikad se ne vraća u odgovoru alata i ne upisuje se u audit.
- **Super admin (M2):** token je vezan za jedan nacrt i ne daje nikakav pristup postojećim ZEV-ovima.
  Izdavanje, korištenje i prekid su u auditu. Klijent vidi vezu i može je prekinuti (M2a).
- **Lozinke ne idu kroz asistenta.** `set_accountant` ne prima lozinku; nalog računovođe otvara klijent
  u čarobnjaku ili kasnije u aplikaciji.
- **Odgovori alata ne sadrže tajne:** bez `passwordHash` i bajtova fajlova, samo nazivi fajlova.
- **Isti guard koraka kao UI.** Asistent ne može pisati u korak iza trenutnog, niti u korake 4–6 posle
  potvrde registra.
- **Spoljni sigurnosni pregled** prije Faze M-D (OAuth).

---

## 7. Testovi

- **Pristup (§4.2):** postojeći testovi čarobnjaka prolaze bez izmjena ponašanja; token klijenta i token
  administratora rade samo nad svojim nacrtom; token administratora prestaje da važi kad nalog izgubi
  `isSuperAdmin`.
- **Paritet:** svaki alat za upis daje isti nacrt kao odgovarajuća funkcija servisa za isti ulaz.
- **Autentifikacija:** bez tokena, pogrešan, istekao, opozvan ili token objavljenog ili odbačenog nacrta
  → 401 sa `WWW-Authenticate`.
- **Granice alata:** lista alata ne sadrži objavu, potvrdu registra ni naloge.
- **Brava:** stara `expected_version` → greška sa trenutnom verzijom, nacrt nepromijenjen.
- **Grupni upis:** jedna neispravna stavka od 60 → ništa nije upisano, greška nosi redni broj; 200
  ispravnih → jedna nova verzija.
- **Dokaz:** prevelik ili pogrešan format → odbijeno, bez zaostalog fajla.
- **Trag:** audit `onboarding.mcp.write` (alat, broj stavki, izdavač) bez sadržaja i bez tokena; oznaka
  `source` na stavkama; ručna izmjena briše oznaku.
- **Vidljivost:** klijent vidi i prekida vezu administratora; prekid je u auditu.
- **Ručno, za svaki klijent iz §2.1:** povezivanje (Claude Code, Claude Desktop, claude.ai, ChatGPT),
  popunjavanje nacrta iz probnog elaborata, prekid veze iz aplikacije i provjera da sljedeći poziv
  klijenta dobija 401.

---

## 8. Redoslijed isporuke

Svaka faza je zasebna minor verzija sa `CHANGELOG.md` unosom.

- **Faza M-0 — provjera klijenata (bez koda u aplikaciji).** Minimalan probni MCP server (jedan alat
  `ping`, na preview okruženju) povezuje se sa Claude Code, Claude Desktop, claude.ai i ChatGPT, na
  planovima koje klijenti stvarno koriste. Bilježi se šta koji klijent prihvata (token u zaglavlju,
  OAuth, bez prijave), na kojem planu i sa kojim callback adresama. Rezultat se upisuje u §2.1 i
  određuje redoslijed:
  - ako ciljni klijenti prihvataju token → redoslijed ispod ostaje;
  - ako i Claude i ChatGPT za ciljne korisnike traže OAuth → **M-D ide odmah iza M-A**, a M-B i M-C
    posle nje.
- **Mockupi** stranice „Asistent“, kartice u adminu i oznake na stavkama (pregled prije Faze M-A).
- **Faza M-A — pristup i čitanje.** `DraftAccess` u servisu (§4.2, bez promjene ponašanja čarobnjaka),
  `OnboardingAgentToken` (migracija), stranica „Asistent“ i kartica u adminu (izdavanje, prikaz
  jednom, prekid), ruta `/api/mcp` sa `withMcpAuth`, alati `get_onboarding_status` i `get_draft`.
- **Faza M-B — upis.** Alati za korake 2–4 i 9; grupni `add_units` i `add_common_assets` (nove servisne
  funkcije sa testovima pariteta); audit i oznaka izvora (M6).
- **Faza M-C — vlasnici.** `add_owner_stake` sa dokazom, `remove_owner_stake`, `set_unit_disputed`.
- **Faza M-D — OAuth 2.1** (M1): aplikacija kao authorization server (RFC 9728 Protected Resource
  Metadata, RFC 8414, registracija klijenta, PKCE, kratkotrajni tokeni sa opsegom „jedan nacrt“),
  konektor za claude.ai i ChatGPT (obje callback adrese, Dynamic Client Registration), spoljni
  sigurnosni pregled. Prema rezultatu Faze M-0 može doći odmah iza M-A.

---

## 9. Rizici i otvoreno

- **Kvalitet čitanja dokumenata.** Skenirani elaborati i rukom pisani ugovori mogu se pogrešno
  pročitati. Klijent mora pregledati sve; oznaka iz M6 olakšava, ali ne garantuje.
- **Veličina zahtjeva i timeout na Vercelu** za grupni upis i base64 dokaze treba izmjeriti.
- **Zrelost biblioteka.** `mcp-handler` i MCP SDK se brzo mijenjaju (prelaz SDK 1.x → 2.x). Verzije se
  zaključavaju tačno, a nadogradnja ide kao zaseban zadatak.
- **Podrška klijenata se mijenja brzo i van naše kontrole.** Planovi i načini autentifikacije za
  sopstvene konektore u claude.ai i ChatGPT mijenjali su se tokom 2026, a izvori se međusobno ne
  slažu (§2.1). Faza M-0 to provjerava prije koda; uputstvo na stranici „Asistent“ mora navesti za
  koje klijente i planove je provjereno.
- **ChatGPT na ličnim planovima** možda neće moći dodati sopstveni konektor (§2.1). To je ograničenje
  OpenAI-ja; aplikacija ga ne može zaobići.
- **Pravna strana.** Dokumenti klijenta (lični podaci vlasnika) prolaze kroz asistenta koga bira klijent
  ili administrator. Uputstvo na stranici „Asistent“ mora to jasno reći, a za vezu administratora
  treba provjeriti da li je potrebna izričita saglasnost klijenta. Tekst neka pregleda pravnik.

---

## 10. Šta plan namjerno ne radi

- MCP za bilo šta osim nacrta onboardinga (postojeći ZEV-ovi, finansije, glasanje). To su sljedeći
  kandidati, ali tek kad se ovaj slučaj pokaže korisnim.
- Asistenta ugrađenog u aplikaciju (pozivi Claude API-ja sa servera). Ovdje korisnik donosi svog
  asistenta, a aplikacija nudi samo alate.
- Automatsku objavu ili potvrdu bilo čega.

---

## Izvori

- [MCP specifikacija — Authorization (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP specifikacija — Streamable HTTP (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP — Understanding Authorization](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization)
- [vercel/mcp-handler](https://github.com/vercel/mcp-handler)
- [Vercel — Deploy MCP servers to Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel)
- [Claude — Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Claude — Building custom connectors via remote MCP servers](https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)
- [anthropics/claude-ai-mcp #112 — Bearer zaglavlje u web konektoru](https://github.com/anthropics/claude-ai-mcp/issues/112)
- [Auth0 — Integrate your MCP server in ChatGPT (OAuth)](https://auth0.com/blog/add-remote-mcp-server-chatgpt/)
- [Peliqan — ChatGPT MCP: plans, setup and what breaks in 2026](https://peliqan.io/blog/chatgpt-mcp/)
- [ChatGPT Developer mode: add a custom MCP server](https://mailmcp.io/en/guides/connect-chatgpt)
