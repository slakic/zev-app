# ZEV upravnik — dizajn sistem (referenca)

**Status: OPIS ZATEČENOG STANJA, ne prijedlog.** Ovaj dokument opisuje sistem koji je **već isporučen** kroz Faze 0, 1, 2, 3 (3a–3h), 4 i 6 plana `Plans/ui-ux-redesign-plan.md` (v2.12.1 → v2.24.1). On je **izvor istine za svaki budući UI rad**. Originalni plan ostaje kao zapis *zašto* su odluke donesene (heuristička evaluacija, razmotrene opcije, odluke korisnika P1–P10); ovaj dokument je *šta je na kraju u kodu*.

Svaka tvrdnja ispod je vezana za konkretan fajl i liniju u zatečenom kodu. Gdje se isporučeno stanje razlikuje od originalnog prijedloga, mjerodavno je **isporučeno stanje** i to je izričito označeno.

---

## 0. Principi — zašto sistem izgleda ovako

Publika određuje sve ostalo: **netehnički, često stariji** etažni vlasnici i predsjednici ZEV-a koji nisu profesionalni upravnici, u **finansijsko-pravnom** softveru gdje jedan klik može stornirati novac ili zatvoriti glasanje. Mir, čitljivost i predvidivost su **funkcionalni zahtjevi**, ne estetska preferencija (`ui-ux-redesign-plan.md:16-19`).

Iz toga slijedi pet pravila koja objašnjavaju svaku pojedinačnu odluku u ovom dokumentu:

1. **Hijerarhija kroz težinu i veličinu, ne kroz boju.** Boja nosi *značenje* (status, ozbiljnost), ne *važnost*. Naslov je naslov jer je 24px/600, a ne zato što je plav.
2. **Suzdržanost umjesto dekoracije.** Nema gradijenata, ilustracija, fotografija, sjenki preko `shadow-sm` osim na overlay-ima, ni animacija preko postojećeg `dropdown-in` (`globals.css:52-71`).
3. **Glasnoća je ograničen resurs.** Šest težina dugmadi postoji upravo zato da puna crvena (`danger`) bude rijetka i time ponovo nešto znači — danas tačno 3 mjesta u cijeloj aplikaciji, sva tri iza koraka potvrde (`ui-ux-redesign-plan.md:27-32`, P2).
4. **Ništa što korisnik mora pročitati ne ide ispod 13px.**
5. **Statusi se nikad ne prenose samo bojom** — uvijek tekstualna labela uz ton (`ui.tsx:84-91`).

**Odbačeni obrasci (ne vraćati ih):**
- `text-xs` (12px) za bilo šta što objašnjava, upozorava ili nudi izbor.
- `slate-400` (`#94a3b8`, ≈2,8:1 na bijeloj — pada WCAG AA) kao boja sadržaja; ostaje **samo dekorativno** (`ui-ux-redesign-plan.md:470, 485-492`).
- Više od jednog `primary` dugmeta po ekranskoj regiji; puna crvena za bilo šta što nije nepovratno uništavanje.
- Ugniježđena elevacija (kartica u kartici sa istim ili jačim okvirom/sjenkom) — kutija u kutiji.
- Uvođenje komponentne biblioteke (shadcn/MUI/Radix) ili ikonične biblioteke (`lucide-react`) — vidi §5 i P6.
- Tamni režim. Nije u sistemu i ne uvodi se usput.

---

## 1. Boja

Tokeni su deklarisani kroz Tailwind v4 `@theme` u `src/app/globals.css:12-35` (CSS-first, nema `tailwind.config.js`). Svaki token automatski generiše `bg-*`, `text-*`, `border-*` i `ring-*` utility.

### 1.1 Površine i ivice

| Uloga | Token | Vrijednost | Utility | Kada |
|---|---|---|---|---|
| Platno | `--color-canvas` | `#f8fafc` (slate-50) | `bg-canvas` | pozadina stranice — postavljena jednom, na `<body>` (`layout.tsx:21`) |
| Površina | `--color-surface` | `#ffffff` | `bg-surface` | kartice, redovi tabele |
| Površina 2 | `--color-surface-sunken` | `#f8fafc` | `bg-surface-sunken` | zaglavlje tabele, sažeci unutar kartice |
| Ivica | `--color-border` | `#e2e8f0` (slate-200) | `border-border` | sve ivice |
| Ivica jaka | `--color-border-strong` | `#cbd5e1` (slate-300) | `border-border-strong` | ivica polja za unos, `secondary` dugme |

### 1.2 Tekst

| Uloga | Token | Vrijednost | Kada |
|---|---|---|---|
| Tekst jak | `--color-ink` | `#0f172a` (slate-900) | naslovi stranica, iznosi, primarna kolona u karticama tabele |
| Tekst | `--color-ink-body` | `#334155` (slate-700) | podrazumijevani tekst, naslovi kartica, labele polja |
| Tekst tih | `--color-ink-muted` | `#64748b` (slate-500) | meta, hintovi, podnaslovi, zaglavlja tabela |
| Tekst vrlo tih | `--color-ink-faint` | `#94a3b8` (slate-400) | **samo dekorativno; nikad za sadržaj** |

`bg-canvas text-ink` je jedino mjesto gdje se boja postavlja globalno (`layout.tsx:21`).

### 1.3 Primarna

| Uloga | Token | Vrijednost | Kada |
|---|---|---|---|
| Primarna | `--color-primary` | `#2563eb` (blue-600) | **jedna glavna radnja po ekranskoj regiji**; fokus prsten (`globals.css:44-47`) |
| Primarna hover | `--color-primary-hover` | `#1d4ed8` (blue-700) | hover na primarnoj |
| Primarna tonalna | `--color-primary-soft` | `#eff6ff` (blue-50) | aktivna nav stavka, `tonal` dugme, aktivni tenant chip |
| Primarna tekst | `--color-primary-ink` | `#1d4ed8` (blue-700) | linkovi u redovima (`RowLink`, `ui.tsx:427`), aktivni tab, tonalni tekst |

Primarna boja je **blue-600 i ostaje blue-600** (odluka P1, `ui-ux-redesign-plan.md:25-26`). Promjena brenda nije u obimu ni jednog UI zadatka.

### 1.4 Semantičke

| Uloga | Token | Vrijednost | Kada |
|---|---|---|---|
| Uspjeh | `--color-success` | `#059669` (emerald-600) | traka na `Stat`, ikona |
| Uspjeh tonalni | `--color-success-soft` / `-ink` | `#ecfdf5` / `#065f46` | chip, uspješan `Flash` |
| Upozorenje | `--color-warning` | `#d97706` (amber-600) | traka, ikona |
| Upozorenje tonalno | `--color-warning-soft` / `-ink` | `#fffbeb` / `#92400e` | chip, **`caution` dugme, panel potvrde** |
| Opasnost | `--color-danger` | `#dc2626` (red-600) | **samo nepovratno uništavanje** |
| Opasnost tonalna | `--color-danger-soft` / `-ink` | `#fef2f2` / `#991b1b` | chip greške, `Flash` greške |

**Amber nosi posebnu ulogu:** „ozbiljno, ali ne destruktivno". To je ključ cijele skale dugmadi (§4.2) i boja panela potvrde (`ConfirmAction`, `ui.tsx:549-550`).

### 1.5 Platformska (Faza 5)

| Uloga | Token | Vrijednost | Utility | Kada |
|---|---|---|---|
| Platformski akcenat | `--color-platform` | `#1e293b` (slate-800) | `bg-platform` | aktivni nav link (inverzija), avatar, trajna oznaka „Super admin" u `NavShell variant="platform"` |
| Platformski akcenat hover | `--color-platform-hover` | `#0f172a` (slate-900) | `hover:bg-platform-hover` | hover na platformskom akcentu |
| Platformski tekst | `--color-platform-ink` | `#1e293b` (slate-800) | `text-platform-ink` | naziv aplikacije u platformskom sidebar-u |
| Platformski tonalni | `--color-platform-soft` | `#f1f5f9` (slate-100) | `bg-platform-soft` | rezervisano, danas bez upotrebe (inverzija je jača od tonalnosti — vidi §7 ispod) |

Nijedna od ove četiri vrijednosti nije nova u aplikaciji — sve su već u upotrebi kao neutrali. **Platformska varijanta ne uvodi boju, ona uklanja boju.** Tenant školjka je plava; platformska je siva. Korisnik ne mora ništa naučiti da bi razliku vidio.

### 1.6 Tonovi status chipova

`StatusBadge` mapira ~50 enum vrijednosti na 5 tonova (`ui.tsx:59-81`), svaki po obrascu `bg-*-50 / text-*-800 / ring-*-600/20`:

`green` (emerald) · `red` · `amber` · `blue` · `slate`

Mapa `statusTone` (`ui.tsx:67-81`) je jedino mjesto gdje se odlučuje koji status je koje boje. **Novi enum status dodaje red u tu mapu**, ne novi chip i ne inline boju na stranici.

> **Napomena o zatečenom stanju:** `ui.tsx` u velikoj mjeri i dalje koristi sirove Tailwind nijanse (`bg-blue-600`, `text-slate-700`) umjesto tokena — tokeni i nijanse su iste vrijednosti, pa nema vizuelne razlike. Tokeni se dosljedno koriste tamo gdje su uvedeni kasnije (`StatusTimeline` `ui.tsx:126-142`, `RowLink` `:427`, `Tabs` `:615-618`, fokus prsteni). **Za novi kod: koristiti tokene** (`bg-primary`, `text-ink-muted`), ne sirove nijanse.

---

## 2. Tipografija

**Font: Roboto**, self-hosted kroz `@fontsource` u težinama 400/500/700 (`globals.css:2-4`), postavljen na `body` sa sistemskim fallback stackom (`globals.css:37-39`). **Font se ne mijenja.**

Nema globalne veličine tijela teksta — veličinu postavlja primitiv koji renderuje tekst. Isporučena skala:

| Uloga | Klase | px / težina | Gdje |
|---|---|---|---|
| Naslov stranice | `text-2xl font-semibold tracking-tight text-slate-900` | 24 / 600 | `PageHeader`, `ui.tsx:23` |
| Podnaslov stranice | `text-[15px] text-slate-500` | 15 / 400 | `ui.tsx:24` |
| Naslov kartice | `text-sm font-semibold text-slate-700` | 14 / 600, **bez `uppercase`** | `Card`, `ui.tsx:36` |
| Hint kartice | `text-[13px] text-slate-500` | 13 / 400 | `ui.tsx:37` |
| Vrijednost `Stat` | `text-2xl font-semibold tabular-nums` | 24 / 600 | `ui.tsx:53` |
| Labela `Stat` | `text-xs font-medium uppercase tracking-wider text-slate-500` | 12 / 500 | `ui.tsx:52` — dozvoljeno: kratka labela uz ogroman broj |
| Tijelo tabele | `text-sm` | 14 | `Table`, `ui.tsx:317` |
| Ćelija | `px-3 py-1.5` | — | `Td`, `ui.tsx:378` |
| Zaglavlje tabele | `text-xs font-semibold uppercase tracking-wider text-slate-500` | 12 / 600 | `ui.tsx:324, 336` |
| Labela polja | `text-sm font-medium text-slate-700` | 14 / 500 | `Field`, `ui.tsx:648` |
| Hint polja | `text-[13px] text-slate-500` | 13 | `ui.tsx:650` |
| Status chip | `text-[13px] font-medium` | 13 / 500 | `StatusBadge`, `ui.tsx:87` |
| Dugme | `text-sm font-medium` | 14 / 500 | `btnBase`, `ui.tsx:437` |
| Radnja u redu | `text-[13px] font-medium` | 13 / 500 | `rowActionBase`, `ui.tsx:387` |
| Naslov praznog stanja | `text-[15px] font-medium text-slate-700` | 15 / 500 | `ui.tsx:357` |
| Hint praznog stanja | `text-[13px] text-slate-500` | 13 | `ui.tsx:358` |
| Korak `StatusTimeline` | `text-[11px]` | 11 | `ui.tsx:123, 134` — dozvoljeno: numerička oznaka koraka + kratka labela uz nju |
| Numerički | `tabular-nums` | — | svaki iznos i svaka desno poravnata kolona |

### Tvrdo pravilo

> **`text-xs` (12px) je dozvoljen samo za zaglavlja tabela i za oznake koje korisnik ne mora pročitati da bi obavio posao. Nijedna rečenica koja objašnjava, upozorava ili nudi izbor ne smije biti ispod 13px.** (`ui-ux-redesign-plan.md:516-519`)

Kad treba „sitno ali čitljivo", vrijednost je **`text-[13px]`**, ne `text-xs`.

> **Poznati dug (ne popravljati usput, ali ne dodavati novo):** `text-xs` se i dalje pojavljuje na ~81 mjesta u `src/`, i dio tih upotreba nosi sadržaj koji korisnik mora pročitati — npr. `„Osnov: …"` (`organi/page.tsx:124,135,183`), `„Link ste dobili e-poštom"` (`(app)/page.tsx:204`), datumi u tabeli mandata (`organi/page.tsx:232-233`). Ovo je preostala migracija iz Faze 0, ne odobren obrazac. **Novi kod ne dodaje nove takve upotrebe.**

---

## 3. Razmak, raspored i oblik

### 3.1 Ritam

- Baza **4px** (Tailwind podrazumijevano). Dozvoljene vrijednosti za vertikalni ritam: **4 / 8 / 12 / 16 / 24 / 32**. Ništa izvan te liste.
- **Razmak između sekcija stranice: `space-y-6` (24px)** na korijenskom `<div>` stranice (`ui-ux-redesign-plan.md:530-533`). Uzor: `organi/page.tsx:90`.
  > **Zatečeno stanje:** ova konvencija je stvarno primijenjena **samo na `organi/page.tsx`**; ostale stranice i dalje koriste pojedinačne `mt-4`/`mt-6` omotnice. Pravilo i dalje važi za **novi** kod i za svaku stranicu koja se ionako prerađuje.
- `PageHeader` sam nosi svoj donji razmak (`mb-6`, `ui.tsx:13`) — ne dodavati još jedan iznad prve kartice.
- `Flash`, `Tabs` i `FilterBar` sami nose `mb-4` (`ui.tsx:682, 606, 638`); `StatusTimeline` nosi `mb-4` (`:114`); `Pagination` nosi `mt-3` (`:570`).

### 3.2 Padding kartice

`Card` je **`p-5` (20px)**, jedinstveno (`ui.tsx:35`). Originalni prijedlog dva paddinga (`p-5` za guste, `p-6` za tekstualne) **nije isporučen** — jedan padding je i dalje mjerodavan. Kad je zaista potrebno drugačije, ide kroz `className` prop, ne kroz novu komponentu.

### 3.3 Širina sadržaja

- **Maksimalna širina sadržaja: `mx-auto w-full max-w-[1440px]`**, postavljena jednom u `nav-shell.tsx:391`. Stranice **ne postavljaju svoju maksimalnu širinu**.
- Padding glavne oblasti: `p-4 md:p-8` (`nav-shell.tsx:390`).
- Tekstualni pasusi: `max-w-[68ch]` (u upotrebi na 3 mjesta).
- Sidebar: `md:w-60` (240px) prošireno, `md:w-[76px]` suženo (`nav-shell.tsx:206`).

### 3.4 Oblik

| Radijus | Gdje |
|---|---|
| `rounded-full` | dugmad, chipovi, nav linkovi, avatar, paginacija — **oblik dugmeta u ovoj aplikaciji je pilula** |
| `rounded-xl` | `Card` (`:35`), `Stat` (`:49`), `Flash` (`:682`) |
| `rounded-lg` | skrol-region tabele (`:314`), `inputCls` (`:656`), kartica reda u card-transformu (`0.75rem`, `:209`) |
| `rounded-2xl` | dropdown naloga (`nav-shell.tsx:300`) |
| `md:rounded-xl` | nav stavka u suženom icon-rail režimu (`nav-shell.tsx:180`) |

### 3.5 Elevacija — tri nivoa, i nikad ugniježđeno

| Nivo | Stil | Koristi se za |
|---|---|---|
| 0 | `border` bez sjenke | tabela unutar kartice (`Table` nema ni okvir ni sjenku, `ui.tsx:309-315`), `FilterBar` (`:638`) |
| 1 | `border + shadow-sm` | `Card` (`:35`), `Stat` (`:49`), `Flash` (`:682`), sticky top bar (`nav-shell.tsx:265`) |
| 2 | `shadow-xl ring-1 ring-slate-900/5` | isključivo overlay-i: dropdown naloga (`nav-shell.tsx:300`), mobilni drawer (`:204`) |

> **Pravilo: element nivoa 0 ili 1 nikad ne sadrži drugi element istog ili višeg nivoa.** Konkretna posljedica koja je već implementirana: `Table` **nema svoj okvir ni sjenku** jer ga svaki pozivalac ionako umotava u `Card` — jedan okvir umjesto dva (`ui.tsx:303-308`, komentar). Ako pišete novu kompozitnu komponentu koja ide unutar `Card`-a, ona **ne dobija** `border`+`shadow-sm`.
>
> Napomena: isporučeni `Card` je nivo 1 (ima `shadow-sm`), a ne nivo 0 kako je originalno predloženo. To je mjerodavno stanje.

### 3.6 Tap target i fokus

- **Dugme:** `px-4 py-2.5 text-sm` ≈ 40px visine, uz `max-md:min-h-[44px]` na dodirnim ekranima (`btnBase`, `ui.tsx:436-439`) — WCAG 2.5.5.
- **Radnja u redu tabele:** `min-h-[28px]` na desktopu (svjestan ustupak gustini reda koju je korisnik tražio; i dalje iznad WCAG 2.2 AA praga od 24px), uz `max-md:min-h-[44px]` (`rowActionBase`, `ui.tsx:386-389`).
- **Tab:** `min-h-[44px]` (`ui.tsx:615`).
- **Fokus:** globalni `:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px }` (`globals.css:44-47`) pokriva nav i tekstualne linkove; dugmad i polja imaju svoj `focus-visible:ring-2` (`btnBase`, `inputCls`).
- **Skrolabilna tabela je fokusabilna:** `tabIndex={0}` + `role="region"` + `aria-label` (`ui.tsx:309-315`), uz `inset` sjenku na desnoj ivici kao statičku naznaku da ima još sadržaja.
- **Mobilni drawer je modal:** `role="dialog"`, `aria-modal`, fokus ulazi pri otvaranju, Tab/Shift+Tab ne može pobjeći, fokus se vraća pri zatvaranju (`nav-shell.tsx:130-171`).
- **`prefers-reduced-motion` se poštuje** (`globals.css:67-71`).

---

## 4. Komponente — inventar `src/components/ui.tsx`

Ovo je lista „ponovo upotrijebi ovo, nemoj pisati novo". Svaki primitiv ima jednu rečenicu svrhe; detaljna obrazloženja su u komentarima uz sam kod, koji su namjerno opširni.

### 4.1 Struktura stranice

| Primitiv | Linija | Svrha |
|---|---|---|
| `PageHeader` | `ui.tsx:9` | Naslov + podnaslov + akcije + opcioni „‹ Nazad" link. Jedan po stranici, uvijek prvi. |
| `Card` | `:31` | Sekcija stranice: opcioni naslov + hint + sadržaj. Osnovni kontejner za sve — tabele, forme, sažetke. |
| `Stat` | `:43` | KPI kutija sa 1px tonskom trakom (`ok`/`warn`/`bad`/`neutral`). **Referentni uzor za gustinu i za količinu boje koju jedan element smije da nosi.** |
| `Flash` | `:677` | Poruka o uspjehu/grešci iz query stringa. `role="alert"` za greške, `role="status"` za uspjeh. |

### 4.2 Dugmad — stablo odlučivanja

Šest težina (`btnVariantCls`, `ui.tsx:453-460`). Geometrija je jedna (`btnBase`, `:436`); mijenja se samo glasnoća.

| Težina | Stil | Kada posegnuti za njom |
|---|---|---|
| **`primary`** | `bg-blue-600 text-white shadow-sm` | Očekivani sljedeći korak. **Najviše jedno po ekranskoj regiji.** Ako su dva, jedno nije primarno. |
| **`tonal`** | `bg-blue-50 text-blue-700` | Podržavajuća radnja koja se često koristi: „Sačuvaj" u kartici, „Dodaj stavku", „Primijeni filter". **Podrazumijevana težina za većinu formi unutar kartice** i najveći pojedinačni izvor smirivanja stranice. |
| **`secondary`** | `border-slate-300 bg-white text-slate-700` | Neutralne, sporedne radnje: „Izvoz PDF", „Nazad", paginacija. **Podrazumijevano za `RowAction`/`RowActionLink`** (`:401, :413`) i za `BtnLink`/`Btn` (`:466, :490`). |
| **`ghost`** | `text-slate-600 hover:bg-slate-100`, bez ivice | Zaista de-emfazirana radnja **izvan** tabele. **Ne koristiti u redu tabele** — bez ivice i ispune izgleda kao običan tekst, ne kao kontrola; to je pronađeno u živom pregledu („Uredi" u tabeli Ulazi bio nevidljiv osim na hover, `ui.tsx:391-396`, `:448-452`). Danas nije u upotrebi nigdje u aplikaciji. |
| **`caution`** | `border-amber-600/40 bg-amber-50 text-amber-900` | **Ozbiljno, ali ne uništava podatke.** Zatvaranje glasanja, povlačenje saglasnosti, hitna intervencija, kreiranje nove verzije. Podrazumijevana težina za `ConfirmAction` okidač i potvrdu (`:548, :555`). |
| **`danger`** | `bg-red-600 text-white shadow-sm` | **Samo nepovratno uništavanje ili poništavanje novca/prava, i obavezno iza `ConfirmAction`.** Danas tačno 3 mjesta: storniranje uplate, storniranje fakture, suspendovanje ZEV-a. **Četvrto mjesto se ne dodaje bez razgovora sa korisnikom.** |

Nosioci:

| Primitiv | Linija | Svrha |
|---|---|---|
| `SubmitBtn` | `:472` | `type="submit"` u server-action formi. Podrazumijevano `primary`. |
| `BtnLink` | `:464` | Dugme koje navigira (`<Link>`). Podrazumijevano `secondary`. |
| `Btn` | `:486` | Generičko client-safe dugme sa `onClick`. Postoji da client komponente prestanu da prepisuju `btnBase` klase — tri su to radile i ispale iz sinhronizacije sa ispravkom tap targeta. |
| `ToggleBtn` | `:504` | `<summary>` za `<details>` sekciju „otkrij formu", sa rotirajućim chevronom. Bez JS-a. Obavezno `className="group"` na `<details>`. |
| `RowAction` | `:397` | Radnja u koloni „Radnje" — **glagol**, ne identitet. Kompaktna geometrija, `type="submit"` ili `onClick`. |
| `RowActionLink` | `:409` | Isto, ali navigira. |
| `RowLink` | `:423` | **Identitet reda** (broj fakture, ime osobe) — podvučeni tekst, ne pilula: mora da čita kao podatak reda, ne kao kontrola koja se takmiči sa pravim radnjama. |
| `btnBase`, `btnVariantCls` | `:436, :453` | Izvezeni za client komponente koje moraju da sastave dugme same. Uvoziti ih, ne prepisivati klase. |

### 4.3 Podaci

| Primitiv | Linija | Svrha |
|---|---|---|
| `Table` | `:270` | Jedina tabela u aplikaciji. Nema svoj okvir (živi u `Card`-u), fokusabilan skrol-region, `<caption>` za čitače ekrana, ugrađeno prazno stanje. |
| `ColumnSpec` | `:159` | Ponašanje kolone: `label`, `priority` (`primary`/`secondary`/`detail` — progresivno otkrivanje po širini), `align`, `sortKey`, `nowrap`. **Jedan izvor istine** iz kojeg se generišu i `<thead>` i CSS za `<tbody>`. |
| — card-transform | `:189-227` | Tabela sa **više od 5 kolona** se ispod `md` prelama u niz kartica po redu (`labela: vrijednost`), umjesto horizontalnog skrola. Generiše se kao jedan `<style>` blok po tabeli, keyed po `id` — zato je `id` **obavezan** kad su `headers` tipa `ColumnSpec[]` (dev warning na `:298-301`). |
| `Td` | `:375` | Ćelija. `right` prop je **deprecated** — poravnanje ide kroz `align: "right"` u `ColumnSpec`. |
| `TableSort` | `:249` | Sortiranje kroz query parametre (`active`, `dir`, `hrefFor`) — pravi linkovi, bookmarkabilni, rade bez JS-a, komponuju se sa server-side paginacijom. Klikabilne su samo kolone koje imaju `sortKey`. |
| `Pagination` | `:565` | „Prethodna / Stranica N od M / Sljedeća". Ne renderuje ništa za jednostranični rezultat. |
| `StatusBadge` | `:84` | Tonalni chip: **tekstualna labela + boja, nikad samo boja.** Ton se čita iz `statusTone` mape. |
| `StatusTimeline` | `:109` | Read-only prikaz napretka kroz **striktno linearan** proces („gdje sam u nizu i šta slijedi"), komplementaran sa `StatusBadge` („koji je status sada"). Koraci nisu klikabilni. |

**Prazna stanja:** `emptyTitle` + `emptyHint` na `Table` (`:281-290`) daju ikonu praznog pladnja, naslov i **konkretan sljedeći korak** umjesto golog „Nema podataka.". Tekstovi žive u rječniku pod `empty.*` (`sr-Latn.ts:400+`).

### 4.4 Unos i navigacija kroz sekcije

| Primitiv | Linija | Svrha |
|---|---|---|
| `Field` | `:645` | `<label>` + naslov + opcioni hint oko jednog polja. |
| `inputCls` | `:655` | Klase za `<input>`/`<select>`/`<textarea>`. **Nema `Input` komponente** — namjerno: polja se prosljeđuju u `Field` kao djeca. |
| `FilterBar` | `:636` | GET forma za filtriranje: bez `action` (submit na trenutnu putanju), fiksno „Primijeni" dugme na kraju. Zamjenjuje ručno kopirane filter redove sa 4 stranice. |
| `Tabs` | `:602` | Prebacivanje između **ravnopravnih, nezavisnih** sekcija stranice. Obični `<Link>`-ovi, **ne** ARIA tabovi (jer nemaju navigaciju strelicama — lažna `role="tab"` bi bila gora priča od nikakve). Nikad za linearan proces — za to je `StatusTimeline`. |
| `ConfirmAction` | `:525` | Korak potvrde za nepovratnu radnju, **bez ijedne linije client JS-a**: `<details>` + `ToggleBtn` + amber panel sa `title`/`body` koji korisnik mora vidjeti + zasebno stilizovano dugme potvrde. `body` je mjesto gdje ide ono što korisnik mora znati **u trenutku odluke** (sažetak kvoruma, iznos koji se stornira), a ne u drugoj kartici niže na stranici. |

### 4.5 Školjke (izvan `ui.tsx`)

| Komponenta | Fajl | Svrha |
|---|---|---|
| `NavShell` | `nav-shell.tsx:48` | Školjka prijavljene aplikacije: suzivi sidebar sa pamćenjem stanja, mobilni drawer sa fokus zamkom, sticky top bar, meni naloga, prekidač aktivnog ZEV-a. `variant?: "tenant" \| "platform"` (Faza 5) bira akcenat i sadržaj top-bar oznake — vidi §7. |
| `AuthShell`, `AuthBrandHeader` | `auth-shell.tsx:24, :12` | Školjka neautentifikovanih stranica (prijava, zaboravljena lozinka, reset). |
| `PasswordField` | `password-field.tsx:28` | Polje za lozinku sa „prikaži lozinku" prekidačem. |

---

## 5. Ikone

- **Ručno crtani monohromatski inline SVG. Bez ikonične biblioteke** (odluka P6, `ui-ux-redesign-plan.md:48-50`). Ne uvoditi `lucide-react` ni slično.
- `IconBase` (`nav-icons.tsx:8-22`) definiše ugovor: **`viewBox="0 0 20 20"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.6}`, `strokeLinecap`/`strokeLinejoin="round"`, `aria-hidden="true"`**, podrazumijevana veličina `h-5 w-5`, `className` override od pozivaoca.
- Boju nosi `currentColor` — **ikona nikad ne postavlja svoju boju**; nasljeđuje je od roditelja (nav linka, dugmeta, chipa).
- **Mapa `NAV_ICONS`** (`nav-icons.tsx`) preslikava rutu → ikonu za sidebar; `IconDot` je fallback za nemapirano. Nova ruta u sidebaru **mora** dobiti unos ovdje, inače dobija tačku.
- Isporučeno 18 ikona: `IconHome`, `IconBuilding`, `IconUsers`, `IconLandmark`, `IconBallot`, `IconReceipt`, `IconWallet`, `IconCalendar`, `IconWrench`, `IconDocument`, `IconChart`, `IconSliders`, `IconShield`, `IconActivity` (Faza 5), `IconDot`, `IconChevronLeft`, `IconCheck`, `IconLogout`.
- Ikone koje **nisu** navigacione ostaju lokalne u fajlu koji ih koristi, u istom stilu — npr. `EmptyTrayIcon` (`ui.tsx:233`), `SortIcon` (`:255`), `CheckCircleIcon` (`:93`), chevron u `ToggleBtn` (`:509`). Ne zatrpavati `nav-icons.tsx` ne-nav ikonama.

---

## 6. Copy i i18n

- Svaki novi tekst ide kroz `t()`/`tEnum()` (`src/lib/i18n`). Ključevi su **ugniježđeni** i `t()` ih hoda cijepanjem po `.` — nova grupa mora biti `group: { sub: { leaf: "…" } }`, **nikad ravna** `{"sub.leaf": "…"}`, inače pretraga tiho promaši i vrati sam ključ (`ui-ux-redesign-plan.md:822-824`).
- Oba rječnika se ažuriraju: `sr-Latn.ts` (primarni) i `en.ts` (`DeepPartial` — dozvoljeno je izostaviti, ali ne i razići se strukturno).
- **Iz UI-ja se ne pominju interni nazivi fajlova** (`LEGAL_AND_FINANCIAL_ASSUMPTIONS.md`, `.env.example`) ni implementacioni detalji — to je urađeno u Fazi 6 i ne vraća se.
- Ton: obraćanje na „Vi", konkretan sljedeći korak umjesto opisa stanja sistema („Dodajte prvu zgradu obrascem *Dodaj zgradu* ispod." umjesto „Nema podataka.").

---

## 7. Platformska (admin) školjka — Faza 5

`admin/layout.tsx` koristi `<NavShell variant="platform">` umjesto ručno pisanog zaglavlja — ista komponenta, isti primitivi i ikone kao tenant školjka, ali vizuelno označena kao platformski nivo:

- **Aktivni nav link:** `bg-slate-800 text-white` (inverzija, ne tonalnost — tonalno `bg-slate-100` bi bilo identično hover stanju neaktivnog linka).
- **Avatar / naziv aplikacije:** `bg-slate-700`/`text-slate-800` umjesto `bg-blue-600`/`text-blue-700`.
- **Trajna oznaka „Super admin":** ide u isti slot gdje tenant školjka drži chip aktivnog ZEV-a — `bg-slate-800 text-white`, **bez `sm:` gate-a** (uvijek vidljiva, i na telefonu), `IconShield` + tekst na `text-[13px] font-semibold` (nije skip-safe labela — nosi pravnu težinu nivoa ovlašćenja).
- **„Podešavanja" se ne renderuje** u meniju naloga — `/podesavanja` je zevId-scoped, super admin bez članstva bi dobio `ForbiddenError`.
- **Prekidač tenanata se nikad ne prosljeđuje** u platformskoj varijanti — `tenants`/`switchZevAction` ostaju `undefined`, `showSwitcher` je već po konstrukciji `false`.
- **Fokus prsten ostaje plav** — globalna pristupačnosna afordansa, ne brend hrom.
- **Sve ostalo identično:** geometrija sidebar-a, suženi icon-rail, `localStorage` ključ `zev-nav-collapsed` (dijeljen sa tenant školjkom — jedan čovjek, jedna preferencija), mobilni drawer, fokus zamka, `max-w-[1440px]`.

Nav linkovi platformske školjke: `/admin` „ZEV nalozi" (`IconShield`), `/admin/aktivnosti` „Aktivnosti" (`IconActivity`), `/` „Moj ZEV" (`IconHome`, samo kad `actor.zevId` postoji).

**Invarijanta:** `variant="platform"` ⇒ `tenants`/`switchZevAction` se nikad ne prosljeđuju. Ako se ikad proslijede zajedno, to je greška u pozivaocu.

---

## 8. Provjera prije isporuke bilo koje UI izmjene

1. Nijedna nova boja, veličina razmaka ni težina dugmeta nije izmišljena — sve dolazi iz §1–§5.
2. Ništa što korisnik mora pročitati nije ispod 13px.
3. Najviše jedno `primary` dugme po ekranskoj regiji; nijedno novo `danger` bez `ConfirmAction` i bez dogovora sa korisnikom.
4. Nema ugniježđene elevacije.
5. Svaka nova tabela sa `ColumnSpec[]` ima `id`; svaka tabela ima `emptyTitle`/`emptyHint`.
6. Svaki novi tekst je u rječniku, ugniježđen.
7. **Živi vizuelni pregled na 1440px i 375px** — build koji prolazi ne dokazuje ništa za ovaj tip izmjene (`ui-ux-redesign-plan.md:1610-1614`).
8. Unos u `CHANGELOG.md` + podizanje verzije, potvrđeno sa korisnikom (patch/minor/major).
