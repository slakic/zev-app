# F5 — Računovođa: radni red, serija i unos novca — implementacioni plan

**Status: F5a ISPORUČENO u v2.48.0 (nije commitovano); F5b čeka.** Ranije: ODOBRENO 2026-10-25 — F5a → minor 2.48.0, zatim F5b → minor 2.49.0.** Implementira Sonnet po planu, pregleda Opus (svaku isporuku posebno). Korisnik je prihvatio preporuke §8:
- **F5-Q1: B** — `TaskList`/`TaskRow` u `ui.tsx`; vlasnik i predsjednik prelaze na njega bez vizuelne promjene.
- **F5-Q2: (a)** — korisnik sa obje uloge ima jednu listu, rangirano spajanje.
- **F5-Q3: (a)** — avans je izvedeno pravilo (platilac bez otvorenih faktura), bez migracije.
- **F5-Q4: (a)** — PDF izvod prvi na stranici uplata.
- **F5-Q5: (a)** — CSV mapiranje u `localStorage` po računu.
- **F5-Q6: (a)** — dvije verzije.

Fazu F5 iz `Plans/design-review-plan.md` §6 korisnik je pokrenuo 2026-10-25 („lets do F5”). Plan je izrađen čitanjem stvarnog koda (v2.47.0). Nijedan red koda još nije napisan.

Faza koristi odluke o dizajn sistemu iz 2026-10-25:
- **D1 A** — obrazac „Za Vas sada” (kompozicija; računovođa je **treća uloga**, pa se po DS §4.1 sada razmatra primitiv — vidi F5-Q1);
- **D4 B** — `Flash` varijanta „upozorenje” (amber, postojeći `warning-*` tokeni) i `inset` (bez sjenke unutar kartice);
- **D5 B** — novi client primitiv `ReviewTable` za tok „pregledaj → potvrdi” (PDF izvod, SMS), sa karticama na telefonu.

**Cilj faze:** računovođa sa početne vidi **koliko posla čeka i gdje**, jednim klikom stiže do svakog zadatka, nacrt serije provjeri na jednom ekranu prije izdavanja, a unos novca počinje od posla („šta treba upariti”), ne od tri forme.

Faza rješava nalaze iz pregleda (`Plans/design-review/03-racunovodja.md`): R-N01, R-N02, R-N05, R-N06, R-N07, R-N08, R-N09, R-N10, R-N14, R-N15, R-N16, R-N17, R-N19, R-N20, R-N21 (dio uplate), R-N22, R-N23, R-N24.

**Već riješeno ranije (ne dira se):** potvrda izdavanja serije sa upozorenjem o dospijeću u prošlosti (F1, R-N04 / R-Q5), bezbjedno raspoređivanje i kontrole samo za računovođu (F1, R-N11, R-N12), ujednačen storno i „plati” sa računom/datumom/iznosom (F1, R-N13, R-N18), aktivna stavka sidebara po prefiksu (F2, R-N03), rečenica o avansu na detalju uplate (F1).

**Granice faze:**
- **Bez migracije** u preporučenim odgovorima (F5-Q3 (a), F5-Q5 (a)). Opcija sa migracijom je izričito označena.
- Nove boje, veličine teksta i težine dugmadi se ne uvode. Novi su samo primitivi odobreni odlukama D4 i D5, i (ako F5-Q1 = B) `TaskList`.
- Početna predsjednika (F6) se ne mijenja, osim što — ako F5-Q1 = B — prelazi na isti primitiv bez vizuelne razlike.
- R-Q1 (uplate kao tab ili stavka menija) se **odlaže na F9** (IA po ulogama), kako je pregled i predložio.

**Isporuka u dvije verzije** (F5-Q6): **F5a → 2.48.0** (radni red, serija, liste), **F5b → 2.49.0** (unos novca, `ReviewTable`, troškovi, izvještaji). Svaka ima svoj commit, provjeru i pregled.

---

## 1. Zatečeno stanje (provjereno u kodu)

| # | Stanje | Gdje |
|---|---|---|
| 1 | Početna računovođe = stari `ManagementDashboard`: 8 `Stat`-ova, pa kartice; „Neraspoređene uplate” `take: 6` bez ukupnog broja i linka; nema SMS-a na čekanju, duplikata, neuspjele e-pošte, troškova koji dospijevaju. | `(app)/page.tsx` `ManagementDashboard` |
| 2 | Uplata sa avansom (`PARTIALLY_APPLIED`, platilac nema otvorenih faktura) ostaje „posao” na početnoj zauvijek. Avans se ne primjenjuje automatski na sljedeću fakturu (`allocatePayment` odbija višak; nema servisa koji avans troši). | `payments.ts:908-936, 1182` |
| 3 | Nacrt serije: jedna `Card` sa `Table` od 7 kolona **po jedinici**; formule i ulazi su interni nazivi (`rate=0.300000`) u `text-xs`; kolona „Prije zaokruž.” sa 6 decimala. Nema zbirne tabele ni upozorenja o nula-stavkama i jedinicama bez dužnika. `describeChargeLine` (F3) već pravi čitljivu rečenicu iz istih ulaza. | `fakture/serija/[id]/page.tsx:36-44, 194-217`; `src/lib/chargeLine.ts` |
| 4 | Serija: status i „Račun e-poštom dobiće N od M” su odvojeni redovi teksta, bez `Stat` reda. | `serija/[id]/page.tsx:137-146` |
| 5 | Period serije: slobodan tekst `GGGG-MM`, placeholder `2026-08`; „Stopa/iznos” sirovo (`0.3`, decimalna tačka, bez jedinice). | `fakture/page.tsx:22-27, 262, 271`; `charge-item-row.tsx:43` |
| 6 | Lista faktura (uprava): nema kolone „Otvoreno”, filter statusa nema „Dospjela”, Period i chip se lome, nema zbira. (F3 je dodao „Preostalo” samo za vlasnika.) | `fakture/page.tsx:29-40, 286-293, 343-351` |
| 7 | Brojač na tabu: `text-xs text-slate-400` (12 px, boja zabranjena za sadržaj). | `ui.tsx:692` |
| 8 | Stranica uplata: SMS kartica, pa **tri forme** (ručni, CSV sa 10 polja i indeksima od nule, PDF), pa tek lista; tri `primary` („Evidentiraj uplatu”, „Uvezi”, „Učitaj i pregledaj”). Ručni unos: „Račun” i „Način” nezavisni, datum bez podrazumijevane vrijednosti, platilac nepretraživ `select`. CSV: goli `<input type="file">`. Referenca u listi `font-mono text-xs`. | `fakture/uplate/page.tsx:118-197, 236` |
| 9 | Pregled PDF izvoda i SMS-a: dvije ručne tabele (`cellInputCls` bez fokus prstena, sopstveni `border + shadow-sm` unutar `Card`-a, ručne alert kutije, „Predlog:” ekavski), bez card-transforma; na 375 ~1000 px širine; polja bez labela. Poslije uvoza nema broja preostalih za uparivanje ni linka. | `pdf-statement-import.tsx:25-26, 128-134, 197-321`; `bank-sms-review.tsx:77, 87-221` |
| 10 | SMS i usklađivanje: prazno stanje tvrdi da poruke stižu i kad prijem **nije uključen**. | `bank-sms-review.tsx:64-68`; `uskladjivanje/page.tsx:167-168` |
| 11 | Trošak: upozorenje o duplikatu ide kroz `redirect` sa `err` — **svih 11 polja se gubi**; checkbox „dozvoli mogući duplikat” stalno vidljiv; podrazumijevani tab „Dobavljači”. | `troskovi/page.tsx:70-75, 115, ~301` |
| 12 | Izvještaji: izvoz `primary` u zaglavlju; „Od/Do” iznad tabova (ne važi za „Dugovanja”); legenda i oznake salda `text-xs`; ime dužnika nije link. | `izvjestaji/page.tsx:150-156, 173-193, 212, 219` |
| 13 | `Flash` ima samo uspjeh/grešku; amber upozorenja se crtaju ručno na više mjesta. | `ui.tsx:747-759` |

---

## 2. F5a — Radni red, serija i liste (→ 2.48.0)

### F5a.1 Primitivi D4 i (po F5-Q1) `TaskList`

- **`Flash` dobija `warn`** (`<Flash warn="…" />`): amber lijevi rub i pozadina iz postojećih `warning-*` tokena, `role="status"`, ista ikona-konvencija. Prop **`inset`**: bez `shadow-sm` i bez donje margine, za upotrebu unutar `Card`-a (pravilo elevacije). DS §4 dobija red.
- **F5-Q1 = B (preporuka):** `TaskList` + `TaskRow` u `ui.tsx` — izvlači se postojeća kompozicija „Za Vas sada” iz `(app)/page.tsx` (vlasnik F3, predsjednik F6) bez promjene izgleda: `Card title` + `ul.divide-y` + red (chip, rečenica `text-sm`, meta `text-[13px]`, najviše jedno dugme; `primary` samo na prvom; na telefonu dugme ispod teksta). Novo za računovođu: opcioni **broj** u redu (`tabular-nums font-semibold`) i red „Sve ostalo je završeno” za sažete nule. Vlasnik i predsjednik prelaze na primitiv; vizuelna regresija se provjerava screenshotom prije/poslije.

### F5a.2 Početna računovođe — „Za Vas sada” (R-R01, D1)

- **Nova čista funkcija `src/lib/accountantTasks.ts`** (kao `ownerTasks`, `presidentTasks`): ulaz brojevi i datumi, izlaz rangirana lista `{ key, count, chip, sentence, href, actionLabel }`, determinističan redoslijed. Stavke i odredišta (broj na početnoj = broj na odredištu):

| Rang | Stavka | Broj iz | Odredište |
|---|---|---|---|
| 1 | Nacrt serije čeka izdavanje | `invoiceBatch` `DRAFT` | `/fakture/serija/[id]` (jedan nacrt) ili `/fakture?tab=naknade` |
| 2 | Neuspjela e-pošta faktura | `notificationMessage` `FAILED` za fakture | `/fakture/serija/[id]` posljednje serije sa greškom |
| 3 | Uplate za uparivanje (bez avansa, F5-Q3) | `payment` `UNAPPLIED`/`PARTIALLY_APPLIED` koje **nisu avans** | `/fakture/uplate?status=ZA_UPARIVANJE` (novi filter, isti uslov) |
| 4 | SMS na čekanju | `getBankSmsStatus().pending` | `/fakture/uplate/sms` |
| 5 | Mogući duplikati SMS ↔ izvod | `getChannelReconciliation().duplicates` | `/fakture/uplate/uskladjivanje` |
| 6 | SMS bez potvrde izvodom | `…unconfirmed` | `/fakture/uplate/uskladjivanje` |
| 7 | Troškovi koji dospijevaju u 7 dana (i dospjeli neplaćeni) | `expense` neplaćen, `dueDate ≤ danas + 7` | `/troskovi?tab=troskovi&status=…` |
| 8 | Nema serije za tekući period (od 1. u mjesecu) | posljednja serija < tekući period | `/fakture?tab=naknade` sa predloženim periodom |
| info | Avansi vlasnika (zbir) | uplate-avansi (F5-Q3) | `/fakture/uplate?status=AVANS` — informativno, bez dugmeta |

  - SMS stavke postoje samo kad je automatski prijem uključen (inače bez reda — R-N16).
  - Nule se sažimaju u jedan red „Sve ostalo je završeno.” sa `IconCheck`.
- **Ispod liste:** 4 `Stat`-a za računovođu — Stanje računa i blagajne, Potraživanja od vlasnika, Dospjelo (kasni), Neplaćeno dobavljačima. Fond i plan ostaju na `/izvjestaji`. `Stat` **ne postaje link** (R-Q2: ne u ovom krugu).
- Kartice ispod: „Posljednje uplate” (5, sa linkom „Sve uplate”) i „Serije faktura” (posljednje 3 sa statusom). Kartica „Neraspoređene uplate” `take: 6` se uklanja (pokriva je stavka 3 sa tačnim brojem).
- **Korisnik sa obje uloge:** predsjednik + računovođa vidi listu predsjednika (F6) **i** stavke računovođe u istoj listi, rangirane: najprije predsjednikove stavke 1–3, zatim računovođine, zatim ostale (jedna lista, jedan `primary`). Pravilo je u funkciji `mergeTasks`, sa testom.

### F5a.3 Nacrt i izdata serija (R-R03 tačke 1–3)

- **`Stat` red** na vrhu: broj faktura · ukupan iznos · dobija e-poštom N od M · dospijeće (amber ton i rečenica ako je u prošlosti). Zamjenjuje odvojene redove teksta (#4).
- **„Upozorenja prije izdavanja”** (samo nacrt) — `Flash warn` lista: stavke od 0,00 KM sa razlogom iz ulaza („nema broja korisnika”, „potrošnja 0”), jedinice bez dužnika, dospijeće u prošlosti, jedinice sa ukupnim iznosom 0. Funkcija `batchWarnings(preview, dueDate, now)` u `src/lib/batchWarnings.ts`, čista, sa testom. Upozorenja ne blokiraju izdavanje (kao F1).
- **Jedna zbirna `Table`** umjesto N kartica: Jedinica · Dužnik · Iznos · Upozorenje (chip) · „Obračun” (`<details>` red). U otvorenom redu: lista stavki „Redovno održavanje — 15,00 m² × 0,30 KM/m² = 4,50 KM” na 13 px preko `describeChargeLine`; sirovi ulazi, formula i „Prije zaokruž.” se **ne prikazuju na ekranu** (ostaju u `previewData` i u PDF-u fakture). Zbir ispod tabele.
- Isto važi za izdatu seriju (bez upozorenja), iznad kartice „Dostava e-poštom”.

### F5a.4 Liste i naknade (R-R09, dio)

- **Brojač taba** u `ui.tsx` `Tabs`: `text-[13px] text-slate-500` (ispravka primitiva da poštuje DS §2, ne nova vrijednost); brojač na svim tabovima istog niza (Troškovi dobija brojač kao Dobavljači; SMS „Potvrđene” dobija brojač).
- **Lista faktura (uprava):** kolona **„Otvoreno”** (isti izračun kao F3 „Preostalo”), filter statusa dobija **„Dospjela”** (isti kalendarski uslov kao F3), `whitespace-nowrap` na Period i status, **zbir** (Iznos, Plaćeno, Otvoreno) ispod tabele za trenutni filter.
- **Period nove serije:** `<input type="month">` sa predloženim sljedećim periodom (mjesec poslije posljednje izdate serije, inače tekući).
- **„Stopa/iznos”** naknada kroz `formatMoney`/`num` + jedinica po metodi („0,30 KM/m²”, „8,00 KM po jedinici”, „120,00 KM ukupno”, „1,95 KM po korisniku”).

---

## 3. F5b — Unos novca, troškovi i izvještaji (→ 2.49.0)

### F5b.1 `ReviewTable` (D5 B)

- Novi client primitiv u **`src/components/review-table.tsx`** (`"use client"`; `ui.tsx` je server-friendly i ostaje bez klijentskog koda), dokumentovan u DS §4 kao primitiv: props `columns` (labela, širina, `priority`), `rows`, `renderCell(row, col)`, `selected`/`onToggle` (checkbox „Uvezi” po redu), `summary` (sticky red: „Označeno 12 od 15 · Uplate 1.234,56 KM · Isplate 0,00 KM”).
  - Desktop: zaglavlje i ćelije kao `Table`; polja `inputCls` (fokus prsten), bez sopstvenog okvira/sjenke (pravilo elevacije).
  - **< md:** svaka stavka je kartica (checkbox + iznos + platilac u naslovu, ostala polja ispod kao `Field`).
  - Svako polje dobija `aria-label` sa brojem reda („Iznos, red 3”).
  - Smjer (uplata/isplata) preko `StatusBadge`; alerti preko `Flash`/`Flash warn inset`.
- **PDF uvoz** (`pdf-statement-import.tsx`) i **SMS pregled** (`bank-sms-review.tsx`) prelaze na `ReviewTable` bez promjene server akcija (`parsePdfPreviewsAction`, `commitPdfImportsAction`, SMS akcije). „Predlog” → „Prijedlog”.
- Poziv na broj / IBAN: `font-mono text-[13px]`, bez `font-mono` na labeli u card-transformu (`Table` bugfix, R-N22).
- **Poslije uvoza:** `Flash` „Uvezeno 12 stavki (ulaz 1.234,56 KM, izlaz 0,00 KM). 3 uplate čekaju uparivanje” + `BtnLink` „Upari sada” na `/fakture/uplate?status=ZA_UPARIVANJE`.

### F5b.2 Stranica uplata — „prvo posao, pa unos” (R-R04)

Novi redoslijed:
1. **Traka posla** (jedan red teksta sa linkovima, bez kartice): „Za uparivanje: N · SMS na čekanju: N · Mogući duplikati: N” — isti brojevi kao početna.
2. **Uvoz izvoda (PDF)** — jedina `primary` radnja na stranici (redoslijed po F5-Q4).
3. **Lista uplata** sa podrazumijevanim filterom „Za uparivanje” kad takvih ima (inače „Sve”); filter dobija „Za uparivanje” i „Avansi” (F5-Q3).
4. **„Ručni unos”** i **„CSV uvoz”** iza `ToggleBtn`, submit `tonal`.
- **Ručni unos:** „Način” se izvodi iz tipa računa (BANK → Banka, CASH → Blagajna) i polje se uklanja; datum = danas; platilac `select` ostaje (pretraživo polje je F8/F9 — nije u ovoj fazi).
- **CSV:** `FilePicker`; kolone se biraju kao „1. kolona … N. kolona” (indeks od 1 u UI-ju, servis i dalje od 0); mapiranje se **pamti po računu** u `localStorage` (F5-Q5 (a), bez migracije) i nudi kao „Sačuvano mapiranje za {račun}” sa „Promijeni mapiranje” iza `ToggleBtn`.
- SMS kartica postaje dio trake posla (status prijema + linkovi „SMS” i „Usklađivanje” kao `RowActionLink`).
- **Prazna stanja SMS-a i usklađivanja** (R-N16): kad prijem nije uključen, tekst „Automatski prijem SMS-a nije uključen” + link na Podešavanja, umjesto obećanja da poruke stižu.

### F5b.3 Troškovi — forma koja ne gubi unos (R-R08)

- `createExpenseAction` prelazi na `useActionState` (client wrapper forme) koji vraća `{ duplicates, values }`: forma se ponovo renderuje **sa unesenim vrijednostima**, iznad nje `Flash warn inset` sa listom sumnjivih troškova (broj fakture, dobavljač, iznos, datum, link) i dugme **„Ipak evidentiraj”** (`caution`) koje šalje istu formu sa `allowDuplicate=on`. Checkbox „dozvoli mogući duplikat” nestaje iz osnovne forme.
- Podrazumijevani tab = **„Troškovi”**; forma „Novi trošak” iza `ToggleBtn` iznad liste; polja u `fieldset`-ovima (Faktura · Raspored · Veze), kao kod stavki naknada.

### F5b.4 Izvještaji (R-R09, ostatak)

- „Izvoz svih izvještaja (PDF)” → `secondary`.
- „Od/Do” se seli u kartice kojima pripada (Novac, Fakture, Pregledi); „Dugovanja” zadržava samo „Stanje na dan + Vlasnici”.
- Legenda i oznake salda `text-[13px]`; ime vlasnika → `RowLink` na `/vlasnici/[id]`.
- Postojeći `from`/`to` bug sa UTC ponoći (zev-app smjernice) se **ne dira** bez posebnog dogovora — samo se premješta UI.

---

## 4. Testovi

- **F5a:** `tests/accountant-tasks.test.ts` (rangiranje, sažimanje nula, SMS stavke samo uz uključen prijem, `mergeTasks` za dvije uloge); `tests/batch-warnings.test.ts` (nula-stavka sa razlogom, jedinica bez dužnika, dospijeće u prošlosti po kalendarskom danu); avans pravilo (F5-Q3) u servisu uplata: uplata sa avansom i bez otvorenih faktura platioca nije „za uparivanje”, a postaje kad se izda nova faktura; broj na početnoj = broj filtera `ZA_UPARIVANJE` (isti upit); filter „Dospjela” i kolona „Otvoreno” na listi faktura; predloženi period serije.
- **F5b:** postojeći testovi PDF/SMS uvoza ostaju zeleni (server akcije se ne mijenjaju); test `useActionState` toka troška na nivou servisa (`DuplicateExpenseWarning` nosi duplikate; drugi poziv sa `allowDuplicate` uspijeva); CSV indeksi od 1 u UI-ju mapirani na 0 u servisu (čista funkcija).

## 5. Provjera

- Pipeline: `npm run typecheck && npm run lint && npm test && npm run build` (dozvoljene samo poznate 3 greške u `tests/env.test.ts` i 1 upozorenje `ui.tsx:305`).
- **F5a živo, 1440 i 375:** početna računovođe sa praznom i punom bazom (svaka stavka klik → odredište sa istim brojem); početna vlasnika i predsjednika prije/poslije prelaska na `TaskList` (bez vizuelne razlike); nacrt serije sa nula-stavkom i jedinicom bez dužnika; lista faktura sa filterom „Dospjela”.
- **F5b živo, 1440 i 375:** PDF uvoz sa 2 izvoda (pregled bez horizontalnog skrola na 375, tastaturom kroz polja), SMS pregled, poruka poslije uvoza → „Upari sada”; trošak sa duplikatom (vrijednosti ostaju); izvještaji.
- **Performanse:** početna računovođe na ZEV-u sa 100+ jedinica (seed lokalno proširen skriptom koja se poslije briše).
- Nakon provjere: `npm run db:reset && npm run db:seed`, brisanje skripti i test dokumenata.

## 6. Isporuka

- **F5a:** jedan commit, **minor → 2.48.0**, `CHANGELOG.md` („Bez migracije”), DS §4 (`Flash warn`/`inset`, `TaskList`), status u `design-review-plan.md`.
- **F5b:** jedan commit, **minor → 2.49.0**, DS §4 (`ReviewTable`).
- Implementacija po dogovoru: Sonnet po planu, Opus pregleda svaku isporuku.

## 7. Rizici

- **`TaskList` mijenja već isporučene početne (vlasnik, predsjednik).** Mjera: izvlačenje bez promjene markup-a, screenshot prije/poslije na 1440 i 375.
- **Avans pravilo (F5-Q3 (a))** je izvedeno, ne zapisano: uplata „izlazi” iz radnog reda dok platilac nema otvorenih faktura i vraća se kad se izda nova. To je namjerno (avans se tada stvarno može rasporediti), ali u CHANGELOG-u i na početnoj mora pisati šta znači.
- **Prepis klijentskih komponenti uvoza** (F5b): regresija PDF/SMS uvoza — server akcije se ne mijenjaju, pa testovi servisa ostaju mjerilo; ručno proći 2 PDF izvoda (testni izvodi iz postojećih testova PDF uvoza, ili izvod koji korisnik dostavi).
- **`localStorage` mapiranje CSV-a** važi po pregledaču; drugi računar ga nema. Prihvatljivo za prvu verziju (F5-Q5).
- **Početna sa više upita** (do 8 brojača): svi su `count`/`groupBy`, bez učitavanja redova.

## 8. Otvorena pitanja za korisnika

| # | Pitanje | Opcije | Preporuka |
|---|---|---|---|
| **F5-Q1** | „Za Vas sada” kao primitiv sada kad ga koristi treća uloga? (DS §4.1 kaže: primitiv tek uz treću ulogu) | (A) ostaje kompozicija, treći put ručno; (B) `TaskList`/`TaskRow` u `ui.tsx`, vlasnik i predsjednik prelaze na njega bez vizuelne promjene | **B** |
| **F5-Q2** | Korisnik sa obje uloge (predsjednik + računovođa) | (a) jedna lista, rangirano spajanje; (b) dvije kartice („Kao predsjednik” / „Kao računovođa”) | **(a)** |
| **F5-Q3** (R-Q4) | Je li avans „završen posao”? | (a) izvedeno pravilo bez migracije: uplata sa slobodnim iznosom čiji platilac **nema otvorenih faktura** je avans — izlazi iz radnog reda, vraća se kad se izda nova faktura; (b) izričito dugme „Ostavi kao avans” (nova kolona + audit, **migracija**); (c) ostaje posao dok se ne rasporedi | **(a)** |
| **F5-Q4** (R-Q3) | Koji kanal unosa uplata je prvi na stranici? | (a) PDF izvod (pretpostavka pregleda); (b) prebrojati uvoze po izvoru u produkciji prije odluke; (c) Vi znate odgovor | **(a)**, uz (b) ako možete da potvrdite |
| **F5-Q5** | Gdje se pamti CSV mapiranje kolona? | (a) `localStorage` po računu (bez migracije, samo taj pregledač); (b) u bazi po računu (migracija) | **(a)** sada |
| **F5-Q6** | Isporuka | (a) dvije verzije: F5a → 2.48.0, F5b → 2.49.0; (b) jedna verzija 2.48.0 | **(a)** |
