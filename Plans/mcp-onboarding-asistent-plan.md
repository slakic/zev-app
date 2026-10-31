# MCP onboarding — asistent popunjava nacrt novog ZEV-a — implementacioni plan

**Status: PLAN, odluke usvojene (2026-10-29/31), implementacija nije počela.** Prvi skup MCP alata u
aplikaciji. Tokeni, opsezi, ruta, OAuth i stranica „Povezani asistenti“ su u
[`Plans/mcp-platforma-plan.md`](mcp-platforma-plan.md); ovaj plan opisuje samo **alate za nacrt
onboardinga** i ono što oni traže od servisa i čarobnjaka.

Zasnovano na kodu v2.59.0 (čarobnjak: `Plans/zev-onboarding-wizard-plan.md`).

## Odluke na kojima plan počiva

| # | Pitanje | Odluka |
|---|---|---|
| M1 | Autentifikacija | **Prema planu platforme:** token sa stranice „Povezani asistenti“ i OAuth 2.1 (P7: OAuth odmah iza osnove, zbog Claude Pro i ChatGPT Plus). Ranija ideja tokena vezanog za nacrt je **zamijenjena** tokenom naloga sa opsegom „Onboarding: [nacrt]“ (2026-10-31) |
| M2 | Ko koristi asistenta | **Vlasnik nacrta i super admin.** Super admin svom tokenu dodaje pristup nacrtu sa `/admin/nacrti/[id]` (platforma P6) |
| M2a | Da li klijent vidi pristup super admina | **Da**, na „Povezani asistenti“, i može ga ukloniti |
| M2b | Prava super admin asistenta | **Isti alati i ista ograničenja** kao klijentov asistent |
| M3 | Brisanje | **Dozvoljeno, samo u nacrtu, uz trag** |
| M4 | Dokaz o vlasništvu | **Fajl kroz alat** (base64, do 4 MB, isti formati); pravilo „nema udjela bez dokaza“ ostaje |
| M5 | Grupni upis | **Sve ili ništa, do 200 stavki**; greške po rednom broju; jedna verzija nacrta po pozivu |
| M6 | Trag | **Audit bez sadržaja** (platforma §4) **+ oznaka na stavkama** („Upisao asistent“ / „Upisao asistent administratora“) |
| M7 | Rok | **Prema platformi (P5):** 7, 30 ili 90 dana; opseg se gasi i objavom ili odbacivanjem nacrta |
| M8 | Ciljni klijenti | **Claude Pro i ChatGPT Plus** (platforma P7); provjera u Fazi M-0 |

---

## 0. Rezime — pročitati prije ostatka

**Problem koji ovi alati rješavaju.** Najsporiji dio čarobnjaka je prepisivanje dokumenata:
- etažni elaborat (desetine posebnih dijelova sa površinom i udjelom);
- izvodi iz katastra i ugovori (vlasnici i udjeli);
- rješenje o registraciji (JIB, registarski broj, adresa).

Klijent (ili super admin koji mu pomaže) da te dokumente svom asistentu. Asistent ih pročita i kroz
MCP alate popuni nacrt, a klijent u čarobnjaku pregleda, ispravi i **sam objavi**.

**Zašto je ovo dobar prvi slučaj:**
1. **Sve izmjene već idu kroz servise sa pravilima.** Alat je tanak omotač oko postojeće funkcije.
2. **Asistent tačno zna šta nedostaje** (`onboardingProgress`), pa radi u petlji „popuni → provjeri →
   ispravi“.
3. **Greška asistenta ne može oštetiti evidenciju.** Sve se piše u nacrt; ZEV ne nastaje dok čovjek ne
   klikne „Objavi ZEV“.

**Granica:** asistent nikad ne potvrđuje registar, ne objavljuje ZEV, ne otvara naloge i ne postavlja
lozinke. To je i glavna odbrana od uputstava podmetnutih u dokumentima (§5).

---

## 1. Zatečeno stanje (provjereno u kodu)

| Šta | Gdje | Značaj |
|---|---|---|
| Svaka izmjena nacrta ide kroz `updateDraft`: vlasnik, guard koraka, optimistička brava (`version`) | `src/server/services/onboarding.ts` | Alati pozivaju iste funkcije; asistent ne preskače korake i ne gazi izmjene čovjeka |
| `updateDraft` traži nacrt po `ownerUserId` | isto | Za super admina (M2) pristup se izražava kroz `DraftAccess` (§3) |
| Napredak je čista funkcija | `onboardingProgress` | Alat `get_onboarding_status` je njen izlaz |
| Pravila su dijeljena sa aplikacijom | `identifiers.ts`, `registerRules.ts`, `shareSum.ts`, `assertUploadable` | Asistent nema blaža pravila od čovjeka |
| Posebni dijelovi se dodaju jedan po jedan | `addDraftUnit` | Treba grupni upis (M5) |
| Izmjene nacrta nemaju oznaku izvora | `src/lib/onboarding/draft.ts` | Treba polje `source` (M6) |

---

## 2. Alati

Svi alati traže opseg `ONBOARDING_DRAFT` (platforma §3) i rade samo nad tim nacrtom. Svaki alat koji
mijenja nacrt prima `expected_version`; na zastarjelu verziju vraća grešku sa trenutnom verzijom, pa
asistent ponovo čita stanje umjesto da pregazi izmjenu.

| Alat | Vrsta | Poziva | Napomena |
|---|---|---|---|
| `get_onboarding_status` | čitanje | `onboardingProgress` | Koraci, ✓/⚠ tekstovi, trenutni korak, `version` |
| `get_draft` | čitanje | učitavanje nacrta | **Bez** bajtova fajlova i hasha lozinke; uz stavke i njihov izvor (M6) |
| `save_zev_details` | upis | `saveZevStep` | Neispravan JIB se čuva i vraća kao upozorenje (isto kao UI) |
| `add_bank_account`, `remove_account` | upis | funkcije koraka 3 | Isto pravilo za broj računa |
| `add_building`, `add_entrance`, `remove_building`, `remove_entrance` | upis | funkcije koraka 4 | |
| `add_units` | upis, grupni | **nova** `addDraftUnits` | Do 200, sve ili ništa (M5) |
| `update_unit`, `remove_unit` | upis | funkcije koraka 5 | |
| `add_common_assets` | upis, grupni | **nova** `addDraftCommonAssets` | Do 200, sve ili ništa |
| `remove_common_asset` | upis | `removeDraftCommonAsset` | |
| `add_owner_stake`, `remove_owner_stake` | upis | `addDraftStake`, `removeDraftStake` | Sa dokazom (M4) |
| `set_unit_disputed` | upis | `setUnitDisputed` | |
| `set_accountant`, `set_accountant_later`, `add_board_member`, `remove_board_member` | upis | funkcije koraka 9 | **Bez** naloga i lozinki |

**Namjerno nema alata za:** potvrdu ili otključavanje registra, objavu, naloge sa lozinkom, brisanje
ili odbacivanje nacrta, pozive i bilo šta van nacrta.

Svaki alat ima opis na srpskom (šta radi i šta ne radi) i zod šemu ulaza.

---

## 3. Šta se mijenja u servisu i čarobnjaku

### 3.1 `DraftAccess` — jedan pojam pristupa nacrtu

```ts
type DraftAccess = {
  draftId: string;
  /** Ko stoji iza izmjene (User.id): vlasnik nacrta ili super admin sa pristupom (platforma P6). */
  userId: string;
  via: "WIZARD" | "MCP_OWNER" | "MCP_ADMIN";
};
```

- Čarobnjak pravi `DraftAccess` iz sesije (vlasnik, `WIZARD`).
- MCP pravi `DraftAccess` iz veze i opsega, posle provjere `resolveMcpAccess` (platforma §3).
- `updateDraft(access, step, version, mutate)` traži nacrt po `draftId` i radi kao danas.
- Postojeće funkcije (`saveZevStep`, `addDraftUnit`…) mijenjaju samo prvi argument; ponašanje
  čarobnjaka ostaje isto, što čuvaju postojeći testovi.

### 3.2 Grupni upis (M5)

- `addDraftUnits(access, version, units[])` i `addDraftCommonAssets(...)`: validacija svake stavke
  istim pravilima kao pojedinačni upis, uključujući jedinstvenost oznake **i unutar same grupe**.
  Ako ijedna stavka ne prođe, ništa se ne upisuje, a greške nose redni broj.
- Jedna nova verzija nacrta po pozivu.

### 3.3 Oznaka izvora (M6)

- Stavke nacrta (račun, zgrada, ulaz, posebni i zajednički dio, lice, udio, organi) dobijaju opciono
  polje `source: "MCP_OWNER" | "MCP_ADMIN"`. Nedostaje = ručni unos.
- Ručna izmjena stavke u čarobnjaku briše oznaku, jer ju je čovjek pregledao.
- Čarobnjak uz takve stavke prikazuje chip „Upisao asistent“ / „Upisao asistent administratora“.
  Novi ključevi u `statusTone` (`SOURCE_MCP_OWNER`, `SOURCE_MCP_ADMIN`), bez novog tona.

### 3.4 Pristup administratora nacrtu (M2, platforma P6)

- Na `/admin/nacrti/[id]`: kartica „Asistent“ sa „Dozvoli mom asistentu pristup ovom nacrtu“ (pravi
  `OnboardingDraftAdminAccess`) i stanjem pristupa.
- Kod klijenta: veza „Asistent“ u gornjoj traci čarobnjaka vodi na „Povezani asistenti“ sa
  preselektovanim opsegom ovog nacrta; ista stranica prikazuje i pristup administratora.

---

## 4. Ekrani

- Oznaka izvora na stavkama u koracima 2–9 (§3.3).
- Kartica „Asistent“ na `/admin/nacrti/[id]` (§3.4).
- Veza „Asistent“ u ljusci čarobnjaka.

Stranica „Povezani asistenti“ i meni naloga su u planu platforme (mockup X-M05). Za oznaku izvora i
admin karticu ide mali mockup prije Faze O-A.

---

## 5. Bezbjednost (specifično za onboarding)

- **Uputstva podmetnuta u dokumentima.** Elaborat ili ugovor može sadržati tekst napisan da navede
  asistenta na nešto drugo. Odbrana je u dizajnu: alati diraju samo jedan nacrt, nema alata sa
  nepovratnom posljedicom, a sve trajne radnje traže klik čovjeka. Najgore što zlonamjeran dokument
  može postići su pogrešni podaci u nacrtu, koje klijent vidi (oznaka M6) i ispravlja prije objave.
- **Lozinke ne idu kroz asistenta.** `set_accountant` ne prima lozinku.
- **Odgovori alata ne sadrže tajne:** bez `passwordHash` i bajtova fajlova.
- **Isti guard koraka kao UI:** nema pisanja u korak iza trenutnog niti u korake 4–6 posle potvrde
  registra.

---

## 6. Testovi

- **`DraftAccess`:** postojeći testovi čarobnjaka prolaze; pristup administratora važi samo dok je
  aktivan i dok nalog ima `isSuperAdmin`; uklonjen pristup → greška na sljedećem pozivu.
- **Paritet:** svaki alat za upis daje isti nacrt kao odgovarajuća funkcija servisa.
- **Granice alata:** lista alata za onboarding opseg ne sadrži objavu, potvrdu registra ni naloge.
- **Brava:** stara `expected_version` → greška sa trenutnom verzijom, nacrt nepromijenjen.
- **Grupni upis:** jedna neispravna od 60 → ništa nije upisano, greška sa rednim brojem; duplikat
  oznake unutar grupe se hvata; 200 ispravnih → jedna nova verzija.
- **Dokaz:** prevelik ili pogrešan format → odbijeno, bez zaostalog fajla.
- **Oznaka izvora:** postavlja se kroz MCP, briše se ručnom izmjenom.
- **Kraj:** objava ili odbacivanje nacrta → sljedeći poziv sa tim opsegom dobija grešku.
- **Ručno, za Claude Pro i ChatGPT Plus (prema M-0):** povezivanje, popunjavanje nacrta iz probnog
  elaborata, prekid veze.

---

## 7. Redoslijed isporuke

Usklađeno sa planom platforme (§8 tamo):

1. **M-0** (platforma) — provjera Claude Pro i ChatGPT Plus.
2. **P-A** (platforma) — veze, stranica, ruta, opsezi.
3. **Faza O-A — pristup i čitanje.** `DraftAccess` (§3.1), pristup administratora (§3.4), alati
   `get_onboarding_status` i `get_draft`, veza „Asistent“ u čarobnjaku.
4. **P-B** (platforma) — OAuth 2.1.
5. **Faza O-B — upis.** Alati za korake 2–6 i 9, grupni upis (§3.2), oznaka izvora (§3.3).
6. **Faza O-C — vlasnici.** `add_owner_stake` sa dokazom, `remove_owner_stake`, `set_unit_disputed`.

---

## 8. Rizici i otvoreno

- **Kvalitet čitanja dokumenata.** Skenirani elaborati i rukom pisani ugovori mogu se pogrešno
  pročitati. Klijent mora pregledati sve; oznaka iz M6 olakšava, ali ne garantuje.
- **Veličina zahtjeva i timeout na Vercelu** za grupni upis i base64 dokaze treba izmjeriti.
- **Pravna strana:** dokumenti klijenta (lični podaci vlasnika) prolaze kroz asistenta koga bira
  klijent ili administrator; tekst obavještenja i saglasnost — pregled pravnika (platforma §9).
- Ideje van plana, za kasnije: uvoz iz Excel/CSV tabele, provjera dosljednosti prije objave
  (površine vs. udjeli, dvostruko upisana lica), izvještaj asistenta o stavkama koje treba ručno
  provjeriti.
