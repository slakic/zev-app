# F8 — Mobilne tabele i evidencija vlasnika i jedinica — implementacioni plan

**Status: ISPORUČENO u v2.50.0 (nije commitovano).** (Odobreno 2026-10-25, minor → 2.50.0.) Implementira Sonnet po planu, pregleda Opus. Korisnik je prihvatio preporuke §7:
- **V-Q5: (a)** — vlasnik ne vidi imena drugih vlasnika dok se pravni osnov ne potvrdi; F8 ne dodaje nove prikaze, postojeći se samo popišu.
- **F8-Q1: (a)** — fiksna lista kategorija kvara u kodu + „Drugo”.
- **F8-Q2: (a)** — bez rečenice o preporučenom broju članova UO (nema postavke ni izvora), pa taj dio F8.7 otpada.
- **F8-Q3:** minor → 2.50.0.

Fazu F8 iz `Plans/design-review-plan.md` §6 korisnik je pokrenuo 2026-10-25 („let's do F8”). Plan je izrađen čitanjem stvarnog koda (v2.49.0).

Faza koristi odluku **D3** od 2026-10-25: card-transform na telefonu je **pravilo, ne prop** — tabela sa kolonom radnji uvijek prelazi u kartice, bez obzira na broj kolona (opcija A); tabela bez radnji čija je glavna kolona zadnja dobija preuređene kolone (opcija C). Ispravke rasporeda kartice (X-N19) su bugfix.

**Cilj faze:** na 375 px nijedna radnja ni ključni podatak nisu van ekrana; na listama je lista prvi sadržaj; evidencija vlasnika pokazuje ono što određuje glas prije kontakta i salda; zbir udjela po jedinici je vidljiv tamo gdje se udio upisuje.

Faza rješava nalaze K7, X-N18, X-N19, P-N17–P-N22, V-N19–V-N23 (vidi `Plans/design-review/0{1,2,4}-*.md`).

**Već riješeno ranije (ne dira se):**
- **K-01 / K-01a / K-01b** (FR, v2.43.0): `addOwnershipStake` ne odbija zbir ≠ 100 % nego vraća `unitShareSum` i forma ga prikazuje; jedinica iznad 100 % blokira otvaranje glasanja (`meetings.ts` `unitOwnershipWarnings` u preduslovima); upozorenja OVER/UNDER/NONE stoje na tabu „Vlasništvo” (`PreconditionList`). **K-01c** riješen kroz K-03/FR.
- Potvrda „Objavi vlasnicima” samo za konačne dokumente (F1); ikona menija (F2); `font-mono` na labeli kartice (F5b).

**Granice faze:**
- **Bez migracije.**
- Nema novih boja, veličina teksta ni težina dugmadi; novi ključevi u `statusTone` koriste postojeće tonove.
- Platformski admin (`/admin/*`) i podešavanja nisu ovdje (F7, F9), osim što ih pravilo `Table` automatski obuhvata.

---

## 1. Zatečeno stanje (provjereno u kodu)

| # | Stanje | Gdje |
|---|---|---|
| 1 | Card-transform samo kad tabela ima **> 5 kolona** (`useCardTransform = columns.length > 5`, odluka P5). Tabele sa 3–5 kolona i kolonom „Radnje” skroluju horizontalno na 375, a radnja je van ekrana. | `ui.tsx:307` |
| 2 | Kolonu radnji imaju **21 tabela** (labela „Radnje” ili `…cols.actions`), npr. organi, dokumenti, vlasnik (udjeli), prijedlog, fakture (naknade), uplate, SMS, usklađivanje, troškovi, održavanje (ponude, nalozi), podešavanja, admin. | `grep "label: \"Radnje\""` |
| 3 | U kartici: ćelija sa više djece stavlja drugo dijete u kolonu labele (`grid-template-columns: 40% 1fr` na `td`); chip se rasteže preko cijele širine. | `ui.tsx:222` |
| 4 | `/aktivnosti` i slične tabele bez radnji imaju glavnu kolonu zadnju; na 375 ona je odsječena. | X-N18 |
| 5 | Detalj vlasnika: redoslijed Kontakt (forma, uvijek otvorena) → Vlasnički udjeli → Korištenje → Punomoći → Dostava računa → Saglasnost (sken izjave kao goli `<input type="file">`) → Korisnički nalog. 11 upotreba `text-xs` na stranicama vlasnika/održavanja/organa/plana. | `vlasnici/[id]/page.tsx:200-442, 413` |
| 6 | Tab „Vlasništvo”: upozorenja zbira postoje kao lista, ali **nema tabele aktivnih udjela** (jedinica, vlasnik, udio, od) ni zbira po jedinici uz nju; forme „Dodaj udio” / „Prenos” imaju goli `type="file"` za dokaz. | `vlasnici/page.tsx:268-390, 353, 386` |
| 7 | Održavanje: forma „Prijavi kvar” je prva kartica, lista ispod. Planovi: forme planova/projekata otvorene uz listu. Dnevni red sjednice: forma „Dodaj tačku” uvijek vidljiva (F6 ju je ostavio za F8). | `odrzavanje/page.tsx:83, 133`; `planovi/page.tsx:51, 86`; `skupstina/[id]/page.tsx` |
| 8 | Dokumenti: kolone Broj (mono, primarna) · Vrsta · Naziv · Verzija · Status · Objavljen · Generisan · Radnje — i za vlasnika; nema grupisanja po vrsti/sjednici. | `dokumenti/page.tsx:15-24` |
| 9 | „Bezbjednosni rizik” se crta kao `status="UNPAID"` (pozajmljena boja); slično i drugi pozajmljeni ključevi. | `odrzavanje/[id]/page.tsx:182`; `ui.tsx:71` `statusTone` |
| 10 | Predsjednik nema stavku „Za Vas sada” za jedinice sa zbirom udjela ≠ 100 % (F6 je to ostavio za F8). | `src/lib/presidentTasks.ts` |

---

## 2. Izmjene

### F8.1 `Table` — pravilo card-transforma (D3) i bugfix kartice

- `ColumnSpec` dobija **`actions?: true`** (oznaka kolone, ne prop tabele). Pravilo u `Table`: `useCardTransform = columns.length > 5 || columns.some((c) => c.actions)`. Svih 21 kolona „Radnje” dobija `actions: true` (mehanička izmjena, jedan red po tabeli).
- U kartici kolona `actions` ide **na dno** kartice bez labele, radnje jedna do druge (`flex-wrap`, razmak iz DS-a).
- **Bugfix X-N19:** sadržaj ćelije u kartici se omotava — `td` ostaje grid, ali `td > *` ide u drugu kolonu (`grid-column: 2`), tako da drugo dijete više ne pada u kolonu labele; chip ne rasteže (`justify-self: start`); `priority: "primary"` kolona ide `order: -1` (vrh kartice, bez labele).
- **Opcija C (tabele bez radnji, glavna kolona zadnja):** `/aktivnosti` (i `/admin/aktivnosti` po istom obrascu) — glavna kolona („Šta je urađeno”) postaje prva i `priority: "primary"`, ostale `detail` gdje nisu ključne. Popis takvih tabela se pravi u implementaciji i ide u izvještaj.
- DS §4 (`Table`) i §3 (P5) se ažuriraju: „kartice: > 5 kolona **ili** kolona radnji”.

### F8.2 „Lista prvo, forma iza `ToggleBtn`” (P-R09, V-R06)

- **`/odrzavanje`:** lista prijava i filter na vrhu; „Prijavi kvar” kao `<details>` sa `ToggleBtn`, submit `tonal`. Za vlasnika forma je otvorena automatski **samo** kad nema nijednu prijavu. „Kategorija” → `select` (postojeće kategorije iz koda/seed-a + „Drugo”); checkbox bezbjednosnog rizika → `Field` sa hintom. Kolona „Prijavio” se ne prikazuje vlasniku.
- **`/planovi`:** forme „Novi plan” i „Novi projekat” iza `ToggleBtn`; liste prve.
- **Dnevni red sjednice:** „Dodaj tačku” iza `ToggleBtn` (submit `tonal`, kao u F6).

### F8.3 Detalj vlasnika (P-R10)

- Redoslijed: (1) **Vlasnički udjeli** + **Punomoći** + **Saglasnost za e-glasanje** (ono što određuje glas), (2) 4 `Stat`-a finansija (saldo 0 bez zelenog tona), (3) **Kontakt samo za čitanje** sa `ToggleBtn` „Uredi kontakt” (forma iza njega, submit `tonal`), (4) Dostava računa, (5) Korisnički nalog.
- Uz svaku jedinicu u „Vlasnički udjeli” chip zbira udjela te jedinice (isti kao F8.4).
- Sken izjave o saglasnosti kroz `FilePicker` (`src/components/file-picker.tsx`).
- `text-xs` sa sadržajem → `text-[13px]` na ovoj stranici.
- Lista lica na 375: kartica reda prikazuje ime, jedinice i nalog; e-mail i telefon su `detail` (vide se u detalju).

### F8.4 Tab „Vlasništvo” — tabela aktivnih udjela sa zbirom (K-01, P-R09)

- Nova kartica **„Aktivni udjeli”** iznad formi: `Table` grupisana po jedinici — Jedinica · Vlasnik · Udio · Od · **Zbir jedinice** (chip u prvom redu jedinice): „100 %” bez tona; „Upisano 50 %” amber; „Zbir 150 %” amber; „Bez vlasnika” amber. Podaci iz postojećeg servisa (`unitOwnershipWarnings` + aktivni udjeli); funkcija formata chipa je čista (`src/lib/shareSum.ts`) sa testom, i koristi je i detalj vlasnika (F8.3).
- Postojeća lista upozorenja (`PreconditionList`) ostaje iznad tabele (ona kaže šta ne valja; tabela pokazuje gdje).
- Forme „Dodaj udio” i „Prenos”: dokaz kroz `FilePicker`.

### F8.5 Stavka u „Za Vas sada” predsjednika (K-01)

- `presidentTasks` dobija stavku **„Zbir udjela ≠ 100 %”**: jedna zbirna stavka „N jedinica ima zbir udjela različit od 100 % (Garaža 1: 150 %, …)” sa linkom na `/vlasnici?tab=vlasnistvo`. Rang: odmah iza registra (zbir iznad 100 % blokira otvaranje glasanja); jedinice samo ispod 100 % ili bez vlasnika — niži rang. Test u `tests/president-tasks.test.ts`.

### F8.6 Dokumenti (P-R12, V-R08)

- **Uprava:** `FilterBar` po vrsti (Sjednice i odluke · Fakture · Izvještaji · Ostalo); broj dokumenta 13 px bez `font-mono`; „Naziv” `primary`.
- **Vlasnik:** kolone Naziv (`primary`) · Vrsta · Datum · „Preuzmi PDF”; bez „Objavljen vlasnicima”, „Status” i „Verzija” (verzija samo kad ih ima više).
- Na detalju sjednice kartica „Dokumenti sjednice” dobija spisak poziva/zapisnika/odluka te sjednice sa statusom objave (postojeći upit po `sourceType/sourceId`).

### F8.7 Boje statusa i čitljivost (P-R13, V-R07)

- `statusTone` dobija sopstvene ključeve sa postojećim tonovima: `SAFETY_RISK` (amber), `EMERGENCY` (red), i ostali pozajmljeni ključevi pronađeni u implementaciji (popis ide u izvještaj). „Razlika” u planu neutralna, crvena samo za prekoračenje.
- Organi: ⚠ 13 px „Upravni odbor ima N člana; preporučeno je 3” kad je manje (bez zakonske tvrdnje — vrijednost „3” iz postojećih podešavanja, ako postoji; inače bez rečenice).
- `text-xs` sa sadržajem → `text-[13px]` na stranicama vlasnika, održavanja (lista i detalj), organa i plana; `ColumnSpec.priority` na tabelama planova i upravnog odbora.
- DS §4.2: `SegmentedAction` u inventar; četvrto `danger` mjesto (ako postoji u kodu) se dokumentuje kakvo jeste.

---

## 3. Testovi

- **`Table`:** test pomoćne `buildTableCss` — tabela od 3 kolone sa `actions` dobija card-transform; bez `actions` i ≤ 5 kolona ne dobija; `primary` dobija `order:-1`; pravilo `td > *` i `justify-self` postoje.
- **`shareSum` format:** 100 / 50 / 150 / bez vlasnika, decimalni zarez, tolerancija 0,0001 kao `unitOwnershipWarnings`.
- **`presidentTasks`:** stavka zbira udjela, rang iznad 100 % prije ispod 100 %.
- Postojeći testovi K-01 (FR) ostaju zeleni bez izmjene.

## 4. Provjera

- Pipeline: `npm run typecheck && npm run lint && npm test && npm run build` (dozvoljene samo poznate 3 greške u `tests/env.test.ts` i 1 upozorenje u `ui.tsx`).
- **Regresija `Table` na 375** (rizik: ~59 tabela): skripta prolazi kroz sve stranice sa tabelom kao predsjednik, računovođa i vlasnik i bilježi (a) horizontalni skrol stranice, (b) tabele čija je kolona radnji van ekrana, (c) e-adresu u koloni labele — rezultat je tabela u izvještaju; screenshot svake stranice sa tabelom radnji na 375 i 1440.
- **Živo, 1440 i 375:** detalj vlasnika (redoslijed, uređivanje kontakta), tab „Vlasništvo” sa jedinicom 150 % i 50 % (lokalno), održavanje kao vlasnik bez i sa prijavama, planovi, dokumenti kao uprava i vlasnik, početna predsjednika sa stavkom zbira.
- Nakon provjere: `npm run db:reset && npm run db:seed`, brisanje skripti.

## 5. Isporuka

- Jedan commit, **minor → 2.50.0** (uz potvrdu), `CHANGELOG.md` („Bez migracije”), DS §3/§4, status F8 u `design-review-plan.md`.
- Implementacija po dogovoru: Sonnet po planu, Opus pregleda. Redoslijed: F8.1 (primitiv, najveći rizik) → F8.4/F8.5 → ostalo.

## 6. Rizici

- **Izmjena `Table` dira sve tabele.** Mjera: pravilo je jedna linija + CSS; regresiona skripta na 375 za sve uloge prije isporuke; screenshot prije/poslije za tabele bez kolone radnji i ≤ 5 kolona (moraju ostati iste).
- **Pozajmljene boje statusa:** promjena ključa ne smije promijeniti boju gdje je bila ispravna. Mjera: popis starih → novih ključeva u izvještaju.
- **Vidljivost imena drugih vlasnika vlasniku (V-Q5):** F8 ne dodaje nijedan novi prikaz tuđih imena vlasniku; ako postojeći prikazi to rade, popisuju se u izvještaju bez izmjene dok pitanje nije odlučeno.

## 7. Otvorena pitanja za korisnika

| # | Pitanje | Opcije | Preporuka |
|---|---|---|---|
| **V-Q5** | Smije li vlasnik vidjeti imena drugih vlasnika i zakupaca (npr. suvlasnika, susjeda u istoj zgradi)? | (a) ne, dok se pravni osnov ne potvrdi — F8 ne dodaje nove prikaze, a postojeći se samo popišu; (b) da, samo suvlasnika iste jedinice; (c) da | **(a)** |
| **F8-Q1** | Kategorije kvara za vlasnika (forma „Prijavi kvar”) | (a) fiksna lista u kodu (Vodovod i kanalizacija, Struja, Lift, Krov i fasada, Grijanje, Zajednički prostori, Drugo); (b) lista iz Podešavanja (nova postavka) | **(a)** sada |
| **F8-Q2** | Preporučeni broj članova upravnog odbora u upozorenju na Organima | (a) bez rečenice dok nema izvora; (b) „preporučeno 3” iz `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` uz oznaku pretpostavke | **(a)**, osim ako je broj već u podešavanjima |
| **F8-Q3** | Verzija | minor → 2.50.0 | **minor** |
