# Changelog

Sve bitne izmjene u aplikaciji se evidentiraju ovdje.

## Verzionisanje

**Od verzije 0.2.0 koristi se standardni SemVer, `MAJOR.MINOR.PATCH`, sa jednom
namjernom izmjenom u odnosu na podrazumijevano ponašanje:**

- **Minor je podrazumijevani korak.** Svaka normalna, zaokružena izmjena/funkcionalnost/
  ispravka podiže minor za `1` i vraća patch na `0` — npr. `0.2.0` → `0.3.0`.
- **Patch se koristi za iteracije na nečemu što još nije završeno.** Dok se ista
  funkcionalnost/ispravka doradjuje kroz više krugova u istom poduhvatu (npr. pronađe
  se i ispravi bag, pa se u istom dijelu koda otkrije još nešto prije nego što je posao
  zaista gotov), svaki takav međukorak podiže patch — npr. `0.3.0` → `0.3.1` → `0.3.2`,
  umjesto da svaki put ide novi minor. Kad je taj rad zaista završen i stabilan,
  *sljedeća nova* izmjena opet ide kao minor.
- **Major je za značajniju prekretnicu** i vraća minor na `1` (ne na `0`), a patch na
  `0` — npr. `1.4.2` → `2.1.0`, a ne `2.0.0`. Ovo je namjerno odstupanje od
  podrazumijevanog semver/npm ponašanja: sâm `npm version major` završi na `X.0.0`, pa
  je za željeno `X.1.0` potrebno odmah nakon toga pokrenuti i `npm version minor`
  (za major izdanje: `npm version major && npm version minor`). `npm version minor` i
  `npm version patch` sami po sebi već rade tačno ono što treba za ta dva slučaja.
- Prije svake nadogradnje verzije se potvrđuje sa korisnikom da li je u pitanju patch,
  minor ili major.

**Napomena o promjeni šeme:** verzije `0.900` i `0.901` niže su nastale po staroj šemi
(`MAJOR.mmm`, minor kao trocifreni brojač 1/1000, opisano dolje radi istorijskog
konteksta) i nisu preimenovane. Od unosa `0.2.0` na dalje važi šema opisana iznad.
Nastavak brojanja minor verzija (a ne povratak na `0.1.0`) odražava da su `0.900` i
`0.901` već predstavljale dvije zaokružene isporuke pod major `0`.

<details>
<summary>Stara šema (do 0.901, radi istorijskog konteksta)</summary>

Korištena je jednostavnija šema oblika `MAJOR.mmm`:

- **Minor** (`mmm`, tri cifre) raste za `1` pri svakom manjem izdanju / zaokruženom skupu
  izmjena — npr. `0.900` → `0.901` → `0.902`. Jedan korak = 1/1000 verzije.
- **Major** raste za `1` pri značajnijoj prekretnici, i tada se minor vraća na `000`.
- Prva verzionisana isporuka je bila `0.900` (postojeća aplikacija u trenutku uvođenja
  verzionisanja), ne `0.000`.

</details>

## [2.19.2] - 2026-09-17

### Izmijenjeno

- **Faza 3c plana UI/UX redizajna — migracija tabela na `ColumnSpec` (talas 3c-1
  od 5, §3.G).** Pet talasa dijeli jednu verziju (`2.19.2`), po planu — svaki
  talas je zaseban commit sa vizuelnom provjerom, ali samo prvi diže verziju.
  - **Talas 3c-1 — tabele sa ≥8 kolona (kartični prelom obavezan):**
    `/zgrade` posebni dijelovi (11/10 kolona), `/troskovi` (9), `/dokumenti`
    generisani dokumenti (8), `/fakture` sve/moje fakture (8).
  - Svaka tabela dobija `id` + `caption` (sr-only) + `ColumnSpec[]` zaglavlje:
    poravnanje brojčanih kolona (`align: "right"`) sada dolazi iz istog izvora
    za `<th>` i `<td>`, pa je nesklad iz N4 nalaza strukturno nemoguć na ovim
    tabelama. Jedna kolona po tabeli je `priority: "primary"` (identitet reda
    — npr. "Oznaka" na `/zgrade`, "Broj" na `/dokumenti` i `/fakture`) i
    postaje podebljan naslov kartice ispod 768px; manje kritične kolone su
    `priority: "detail"` (sakrivene samo na tablet širini 768–1023px, vraćaju
    se na `lg`).
  - Zastarjeli `right` prop na `Td` uklonjen sa svih migriranih ćelija —
    poravnanje sada dolazi isključivo iz `ColumnSpec`.
  - **Zaustavljeno poslije 3c-1** (po planu) radi provjere kartičnog preloma
    na `/zgrade` i `/troskovi` prije nastavka na preostalih 47 tabela —
    mehanizam vizuelno i strukturno ispravan na 1440px i 375px. 247/247
    testova prolazi.
  - **Talas 3c-2 — tabele sa 7 kolona:** `/fakture` stavke naknada, `/izvjestaji`
    dugovanja po vlasnicima, `/fakture/serija/[id]` pregled obračuna po stavci
    (posebna tabela po jedinici — provjereno da više instanci `id`-a na istoj
    stranici rade nezavisno), `/admin` svi ZEV nalozi (usput dobio i vidljiv
    „Radnje" naslov kolone umjesto praznog stringa — isti a11y razlog kao i
    `<caption>`/`scope="col"` iz Faze 3a). 247/247 testova prolazi; provjereno
    na 1440px i 375px.
  - **Talas 3c-3 — tabele sa 6 kolona (10 tabela):** `/vlasnici` lica, `/skupstina`
    sjednice, `/odrzavanje` prijave, `/fakture/uplate` uplate, `/izvjestaji`
    (tok novca, neplaćene fakture vlasnika), `/planovi/[id]` stavke plana,
    `/skupstina/prijedlog/[id]` glasačka baza, `/podesavanja/audit` revizorski
    trag, `/podesavanja/poruke` outbox.
    - **Nađen i ispravljen stvaran bag u mehanizmu**, ne samo migracija: na
      `/podesavanja/audit`, kartični prelom prisilno postavlja
      `white-space: normal !important` na `<td>`, ali CSS Grid-ova podrazumijevana
      `min-width: auto` na grid-stavci i dalje računa širinu prema
      min-content-u nepreloma teksta (JSON dump, `document.download`-tip
      nazivi radnji bez razmaka) — `overflow-wrap`/`break-words` to ne rješava
      jer ne utiče na min-content proračun u Grid kontekstu, pa je ćelija i
      dalje gurala karticu u horizontalni skrol unutar samog `Table`-a (upravo
      ono što je N6 nalaz prijavio, sada iznutra umjesto spolja). Ispravljeno
      sa `break-all` (koji *smanjuje* min-content), uz `md:truncate` da se
      desktop izgled (elipsa jednog reda) ne promijeni na `lg+`, gdje se ova
      kolona (`priority: "detail"`) i dalje prikazuje kao obična ćelija.
      Provjereno JS-om (`table.scrollWidth` ≤ širina viewporta) na svih 10
      tabela ovog talasa nakon ispravke, ne samo vizuelno.
  - **Talas 3c-4 — tabele sa tačno 5 kolona (11 tabela, bez kartičnog preloma
    po P5 — samo `align` + `caption` + `id`):** `/zgrade` zgrade, `/vlasnici`
    punomoći, `/vlasnici/[id]` vlasnički udjeli, `/organi` istorija mandata,
    `/planovi` planovi, `/odrzavanje/[id]` ponude izvođača + radni nalozi,
    `/fakture/uplate/[id]` prijedlozi uparivanja + alokacije, `/admin/aktivnosti`,
    `/admin/[zevId]` nalozi u ZEV-u. Nekoliko tabela je usput dobilo vidljiv
    „Radnje" naslov kolone umjesto praznog stringa (isti a11y razlog kao 3c-2).
    Provjereno JS-om da se generisani `<style>` blok NE generiše (`useCardTransform`
    je `false` za tačno 5 kolona, po dizajnu iz §3.B) i da tabele ostaju obične
    horizontalno-skrolabilne tabele na 375px, kao i prije migracije.
  - 247/247 testova prolazi; provjereno na 1440px i 375px za svih 29 tabela
    (3c-1 + 3c-2 + 3c-3 + 3c-4) isporučenih do sada.

## [2.19.1] - 2026-09-17

### Izmijenjeno

- **Faza 3b plana UI/UX redizajna** — uniformnost radnji i linkova u redovima
  tabela kroz cijelu aplikaciju, direktan odgovor na nalaze posmatrane sesije
  (N1: "uredi" link nedosljedan sa ostalim dugmadima; N7: "Action buttons
  should be uniformed"). Koristi primitive iz Faze 3a (`RowAction`,
  `RowActionLink`, `RowLink`, `Btn`), bez izmjene `ui.tsx`.
  - 18 radnji u redovima tabela (dugmad "uredi"/"plati"/"upari"/"izaberi"/
    "završi"/"objavi vlasnicima"/"preuzmi"/itd.) prevedeno sa ručno pisanih
    klasa ili teksta-kao-linka na `RowAction`/`RowActionLink` (ghost ili
    tonal, prema radnji).
  - 13 linkova identiteta reda (broj fakture, naziv vlasnika/zgrade/ZEV-a i
    sl.) prevedeno na `RowLink`.
  - 3 dugmeta u client komponentama (`building-row.tsx`, `unit-row.tsx`,
    `charge-item-row.tsx`) sa ručno prepisanim `btnBase` klasama prevedeno na
    `Btn`.
  - Destruktivne-ali-povratne radnje u redovima (storno troška, storno
    alokacije uplate, storno uplate, uklanjanje pristupa ZEV nalogu)
    prevedene na `ConfirmAction` (uveden u Fazi 2) — razlog storniranja sada
    eksplicitno polje, a ne go trag u formi.
  - ~12 preostalih "golih" polja (datum/select filteri na `/aktivnosti`,
    `/admin/aktivnosti`, `/podesavanja/audit`) dobili `inputCls` radi
    vizuelne dosljednosti sa ostatkom aplikacije.
  - 20 izmijenjenih fajlova; 247/247 testova prolazi; uživo provjereno na
    1440px i 375px (uključujući ulogovanog kao računovođa radi provjere
    role-gated radnji plaćanja/storna, i predsjednika radi provjere radnji
    održavanja i uklanjanja pristupa).

## [2.19.0] - 2026-09-17

### Dodano

- **Faza 3a plana UI/UX redizajna** (`Plans/ui-ux-redesign-plan.md`) — prvi
  korak Faze 3 (tabele, gustina, navigacija kroz sekcije), pokrenute nakon
  posmatrane sesije sa stvarnim korisnikom (P8 preduslov ispunjen). Ovaj
  korak mijenja samo dijeljene primitive u `ui.tsx` — nijedna stranica još
  ne koristi novi sistem (dolazi u Fazi 3c).
  - `Table` prima `headers` kao `ColumnSpec[]` (pored postojećeg `string[]`,
    koji nastavlja da radi identično) — po koloni: poravnanje, prioritet
    vidljivosti na širim ekranima, i preobražaj u kartice ispod 768px za
    tabele sa više od 5 kolona. Poravnanje zaglavlja i sadržaja se sada
    generiše iz istog izvora istine, pa je nesklad (đipovan tekst iznad
    poravnatih brojeva) strukturno nemoguć na migriranim tabelama.
  - **Gušći redovi:** `Td`/`th` sa `px-4 py-2.5` (40px red) na `px-3 py-1.5`
    / `px-3 py-2` (32px red) — direktan odgovor na nalaz posmatrane sesije.
    Dugmad van redova tabele (van `Table`-a) ostaju nepromijenjena.
  - Novi primitivi: `RowAction` (radnja u redu, kompaktnija geometrija —
    28px na desktopu uz zadržanih 44px na dodirnim ekranima), `RowActionLink`,
    `RowLink` (identitet reda), `Btn` (client-safe generički omotač nad
    `btnBase`, zamjenjuje ručno prepisane klase u tri client komponente),
    `Tabs` (URL-bazirana navigacija kroz sekcije stranice, bez client JS-a).
  - `<caption>` (sr-only) + `scope="col"` na zaglavljima — pristupačnost.
  - Mehanizam preobražaja u kartice provjeren uživo na stvarnoj,
    najsloženijoj tabeli u aplikaciji (`/zgrade`, posebni dijelovi, 11
    kolona) prije isporuke, pa vraćen na prethodno stanje — ova faza
    isporučuje samo primitive, migracija stvarnih tabela je Faza 3c.
  - Bez izmjene ijedne stranice. 247/247 testova prolazi; uživo provjereno
    na 1440px i 375px na šest ključnih stranica.

## [2.18.0] - 2026-09-17

### Izmijenjeno

- **Faza 6 plana UI/UX redizajna** (`Plans/ui-ux-redesign-plan.md`) — copy i
  i18n higijena. Ovo je posljednja faza iz trenutnog obima (Faza 0, 1, 2, 4,
  6); Faza 3 i Faza 5 ostaju odložene po ranijoj odluci.
  - **Naslovi stranica kroz rječnik:** `/zgrade`, `/vlasnici`, `/organi`,
    `/fakture`, `/podesavanja`, `/izvjestaji` su hardkodovano ponavljali
    string koji već postoji u `nav` dijelu rječnika — sada idu kroz `t()`,
    pa se ne mogu razminuti sa nazivom stavke u meniju.
  - **Uklonjeni interni nazivi fajlova iz teksta koji vidi korisnik** — pet
    mjesta je referenciralo `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md`,
    `.env.example` ili `README` (na `/organi`, `/podesavanja` dva mjesta,
    `/skupstina`, i oznaka podešavanja „predsjednik je ujedno predsjednik
    upravnog odbora"). Ovi fajlovi nisu dostupni korisniku pa referenca nije
    nosila informaciju — suština teksta je zadržana, samo bez naziva fajla.
  - **Novi opcioni `hint` prop na `Card`-u** (`ui.tsx`) — naslovi kartica
    koji su u zagradi nosili implementacioni detalj (npr. „Glasačka baza i
    lični linkovi (tokeni se čuvaju samo kao hash)") sada imaju kratak,
    jasan naslov i detalj premješten u hint red ispod, manjim, prigušenim
    fontom. Primijenjeno na pet kartica: glasačka baza i lični linkovi,
    ispravka glasa, alokacije uplate, pravila glasanja, vlasnički udjeli.
  - Bez izmjene rasporeda ni ponašanja — čisto tekstualna izmjena. 247/247
    testova prolazi; uživo provjereno na 1440px i 375px.

## [2.17.0] - 2026-09-17

### Dodano

- **Faza 4 plana UI/UX redizajna** (`Plans/ui-ux-redesign-plan.md`) — javni i
  neautentifikovani tokovi. Ovo su ekrani sa najmanje vještim korisnicima
  (link iz e-maila, otvara se jednom u životu) i najvećim pravnim ulogom, a
  do sada su dobijali najmanje dizajnerske pažnje.
  - **Novi `AuthShell` primitiv** (`src/components/auth-shell.tsx`) —
    logotip, naziv i slogan aplikacije (`t("app.tagline")`, postojao u
    rječniku a nikad se nije prikazivao), primijenjen na `/login`,
    `/zaboravljena-lozinka` i `/reset-lozinka/[token]` umjesto tri kopije
    istog ručno pisanog markupa. Na `/login` dodata rečenica „Nalog dobijate
    od predsjednika vaše zajednice etažnih vlasnika." — za vlasnika koji
    prvi put treba nalog, to danas nije pisalo nigdje.
  - **Novi `PasswordInput` sa „prikaži lozinku” prekidačem**
    (`src/components/password-input.tsx`), na `/login` i `/reset-lozinka` —
    značajno za starije korisnike koji žele provjeriti šta su ukucali.
  - **Redizajn `/glasanje/[token]`** (elektronsko izjašnjavanje) u tri
    numerisana koraka na jednoj stranici: 1) ko ste vi, 2) o čemu se
    izjašnjavate (tekst prijedloga sada 16px umjesto 14px, `max-w-[68ch]`;
    otisak sadržaja premješten u fusnotu sa objašnjenjem), 3) vaš izbor —
    tri velike klikabilne kartice umjesto sitnih radio dugmadi (min. 56px
    visine, cijela kartica klikabilna), izjava saglasnosti na veličini
    tijela teksta (bila `text-xs`). Dodat stvaran korak potvrde prije
    nepovratnog slanja: sažetak izbora („Izjašnjavate se **ZA** prijedlog
    P-2026-02...") koji se ažurira **bez ijedne linije JavaScripta**
    (CSS `:has()` selektori prate koji je radio označen). Greška
    potvrde izjave sada se prikazuje uz sam obrazac umjesto na vrhu
    stranice. Dodat logotip i red za pomoć na dnu („Ako vaš kod ne radi...
    obratite se predsjedniku vaše zajednice").
  - Prije implementacije stranica `/glasanje/[token]` je otvorena uživo sa
    stvarnim tokenom (generisanim lokalno za potrebe provjere), kako plan i
    traži — do sada nikad nije viđena uživo, samo kroz čitanje koda.
  - Bez izmjene tri postojeće brane identiteta (link + verifikacioni kod +
    potvrda izjave) niti pravne ograde na dnu stranice. 247/247 testova
    prolazi; uživo provjereno na 1440px i 375px.

## [2.16.0] - 2026-09-17

### Ispravljeno

- **Rušenje stranice uplate za predsjednika** (prijavljeno iz produkcije,
  `/fakture/uplate/[id]`) — `suggestMatches()` je tražio isključivo ulogu
  `ACCOUNTANT`, dok je sama stranica dostupna i računovođi i predsjedniku i
  poziva tu funkciju bezuslovno za svaku neraspoređenu/djelimično raspoređenu
  uplatu. Predsjednik bez uloge računovođe je zato dobijao sirovu grešku
  (Next.js digest stranicu) umjesto prijedloga uparivanja. Ispravljeno da
  prihvata i `PRESIDENT`, u skladu sa pristupom same stranice.

### Dodano

- **`error.tsx` granice grešaka** — jedna za sve stranice pod `(app)`
  (zadržava bočnu navigaciju vidljivom, ispisuje smiren tekst objašnjenja) i
  jedna na korijenu aplikacije (samostalna, bez pretpostavke da bilo koji
  layout postoji — hvata npr. grešku iz `admin/layout.tsx` koja se dešava u
  samom layout-u, van dometa granice na tom nivou). Next.js briše stvarnu
  poruku greške u produkcijskom build-u iz bezbjednosnih razloga, pa ove
  granice ne tvrde tačan uzrok — samo daju miran, koristan izlaz (nazad na
  početnu / pokušaj ponovo) umjesto sirove tehničke stranice sa digest kodom
  koju je vidio korisnik u produkciji.
- Provjereno: 247/247 testova prolazi; greška je uživo reprodukovana lokalno
  (predsjednik bez računovodstvene uloge, uplata sa slobodnim iznosom) i
  potvrđeno da je stranica nakon ispravke ponovo upotrebljiva.

## [2.15.0] - 2026-09-17

### Dodano

- **Faza 2 plana UI/UX redizajna** (`Plans/ui-ux-redesign-plan.md`) — potvrda
  za nepovratne radnje. Novi primitiv `ConfirmAction` u `ui.tsx`: isti
  `<details>/<summary>` obrazac koji već postoji u projektu (bez ijedne
  linije novog client JS-a), ali sa semantikom potvrde — naslov + tekst koji
  korisnik mora pročitati prije nego što se pojavi stvarno dugme za potvrdu.
  Primijenjeno na svih 6 mjesta iz plana:
  - **Zatvori glasanje i utvrdi rezultat** — sažetak kvoruma i trenutnog
    rezultata glasanja sada se prikazuje **unutar panela potvrde**, tačno u
    trenutku odluke, umjesto samo u odvojenoj kartici niže na stranici koju
    je trebalo skrolovati do nje (heuristički nalaz H5).
  - **Povuci saglasnost za elektronsko glasanje** — na `/podesavanja` i na
    `/vlasnici/[id]` (predsjednik u ime vlasnika).
  - **Storniraj** (faktura) i **Storniraj uplatu** — potvrda ostaje
    puna crvena (`danger`) težina, jer poništavaju novac/izdate dokumente.
  - **Suspenduj ZEV** (super admin) — dodatno traži da se ukuca skraćeni
    naziv ZEV-a prije potvrde (standardni obrazac za radnje sa širokim
    posljedicama), provjereno HTML `pattern` atributom bez JS-a.
  - Bez izmjene rasporeda van neposredne okoline svakog dugmeta; provjereno
    uživo na 1440px i 375px na šest ključnih stranica plus `/fakture/uplate/[id]`
    i `/admin/[zevId]`, bez regresija. 247/247 testova prolazi (nepromijenjeno).

## [2.14.0] - 2026-09-16

### Izmijenjeno

- **Faza 1 plana UI/UX redizajna** (`Plans/ui-ux-redesign-plan.md`) — hijerarhija
  dugmadi. **Pažnja: mijenja se boja poznatih dugmadi u produkciji** — ko je
  navikao da traži crveno dugme na nekim mjestima, sada će ga naći u drugoj
  boji (obrazloženje ispod).
  - Sistem dugmadi proširen sa 3 na 6 težina (`ui.tsx`, `btnVariantCls` sada
    izvezen): pored postojećih `primary`/`secondary`/`danger`, dodati `tonal`
    (plava, tiha — podržavajuće radnje u kartici), `ghost` (bez pozadine —
    radnje u redu tabele) i `caution` (jantar — ozbiljno, ali ne uništavanje
    podataka).
  - **Reklasifikovano svih 13 dosadašnjih `danger` (puno crvenih) dugmadi** po
    tome koliko su zaista nepovratna: 3 ostaju puno crvena jer poništavaju
    novac ili gase pristup (Storniraj fakturu/uplatu, Suspenduj ZEV — i dalje
    bez izmjene, iza potvrde dolazi u Fazi 2); 4 prelaze na jantar/`caution`
    (Povuci saglasnost za e-glasanje — na dva mjesta, Zatvori glasanje i
    utvrdi rezultat, Kreiraj novu verziju prijedloga, Hitna intervencija);
    3 prelaze na tihu plavu/`tonal` jer ništa ne uništavaju, samo dodaju trag
    (Evidentiraj ispravku glasa, Kreiraj korektivnu fakturu, Evidentiraj
    prenos vlasništva); „Okončaj mandat" u tabeli upravnog odbora prelazi na
    `ghost` (više nije crveno u svakom redu tabele).
  - Redovi tabela: „ponovo izdaj"/„opozovi" (glasački tokeni) i „Uđi u ZEV"
    (super admin) prelaze sa golog teksta bez tap targeta na `ghost` dugmad
    sa punim dodirnim ciljem.
  - 6 ručno pisanih dugmadi (`izvjestaji`, `aktivnosti`, `admin/aktivnosti`,
    `pdf-statement-import`) i 3 ručno pisana polja (`izvjestaji`, `organi`)
    zamijenjeni dijeljenim `SubmitBtn`/`inputCls` primitivima — ista boja i
    ponašanje kao svuda drugo, bez duplirane definicije stila.
  - Usput ispravljena napomena na `/podesavanja` koja je tvrdila da e-mail
    uvijek ide preko mock provajdera — sada tačno odražava da li je
    `EMAIL_PROVIDER=mailjet` podešen.
  - Bez izmjene rasporeda/teksta radnji (osim gore navedene napomene); samo
    boja/težina dugmadi. Provjereno uživo na 1440px i 375px na šest ključnih
    stranica (`/`, `/zgrade`, `/fakture`, `/skupstina/prijedlog/[id]`,
    `/podesavanja`, `/login`) plus `/organi` i `/fakture/[id]`, bez
    regresija. 247/247 testova prolazi (nepromijenjeno — prezentaciona
    izmjena).

## [2.13.0] - 2026-09-16

### Izmijenjeno

- **Faza 0 plana UI/UX redizajna** (`Plans/ui-ux-redesign-plan.md`) — tokeni,
  tipografija, kontrast:
  - Nov `@theme` blok u `globals.css` — nazvani tokeni za paletu koja je već
    bila u upotrebi (slate neutrali, blue-600 primarna, tonalni emerald/amber/
    red) — nijedna boja se stvarno nije promijenila, samo je dobila ime
    (`bg-primary`, `bg-danger-soft` itd.) za buduću upotrebu (Faza 1). Uklonjene
    mrtve `--background`/`--foreground` varijable; `layout.tsx` sada koristi
    `bg-canvas text-ink` umjesto hardkodovanog `bg-slate-50 text-slate-900`.
  - Naslov kartice (`Card`, `ui.tsx`) prestaje da bude 12px verzal
    (`text-xs uppercase`) — sada je 14px polu-podebljan tekst, čitljiviji na
    prvi pogled.
  - **Kontrastna ispravka (WCAG AA):** `text-slate-400` (≈2,8:1, ispod praga
    4,5:1) zamijenjen sa `text-slate-500` (≈4,76:1) svuda gdje nosi stvarni
    sadržaj koji korisnik mora pročitati (hintovi, prazna stanja, napomene) —
    18 fajlova. Dekorativne upotrebe (ikone, fokus prstenovi, zatamnjeni redovi
    isteklih vlasničkih udjela) namjerno nisu dirane.
  - Dodirne mete dugmadi sa ≈30px na ≈40px (44px na užim ekranima) — WCAG 2.5.5.
  - Globalan `:focus-visible` prsten — do sada su ga imali samo dugmad i polja,
    ne i linkovi u navigaciji i tabelama.
  - `Flash` greška sada nosi `role="alert"` umjesto `role="status"`.
  - Maksimalna širina glavnog sadržaja (1440px) — spriječava da se pasusi na
    širim ekranima razvuku preko 140+ karaktera po redu.
  - Uklonjena dvostruka elevacija: `Table` više ne crta svoj okvir/sjenku kad
    je (kao skoro uvijek) već unutar `Card`-a koji to obezbjeđuje.
  - Tabela sa horizontalnim skrolom je sada dostupna tastaturom
    (`tabIndex`/`role="region"`/`aria-label`) i ima suptilnu naznaku da sadržaj
    nastavlja desno — stvarno rješenje gustine tabela dolazi tek u Fazi 3.
  - Bez izmjene rasporeda/logike; provjereno uživo na 1440px i 375px na šest
    ključnih stranica (`/`, `/zgrade`, `/fakture`, `/skupstina/prijedlog/[id]`,
    `/podesavanja`, `/login`), bez regresija. 247/247 testova prolazi
    (nepromijenjeno — ovo je čisto prezentaciona izmjena).

## [2.12.1] - 2026-09-16

### Ispravljeno

- **`openVoting` (`src/server/services/meetings.ts`) — otkriveno tokom stvarnog probnog
  deployment-a na Vercel + Neon** (`Plans/deployment-portability-plan.md` §12 Faza 5).
  Transakcija radi 3-4 sekvencijalna upita po biraču (provjera punomoćja, upis
  `EligibleVoter`, upis `ApprovalToken`, audit zapis). Lokalno je to trenutno; preko
  stvarne mrežne latencije do udaljene baze (Vercel → Neon) skup ovih upita je premašio
  Prisma-in podrazumijevani limit interaktivne transakcije od 5s već sa skromnim brojem
  birača — reprodukovano na pravom Neon nalogu tokom seed-a demo podataka. Ispravka:
  eksplicitan `timeout: 20000` na `$transaction` pozivu. Verifikovano: reset + reseed
  Neon baze prošao čisto nakon ispravke, 247/247 testova i dalje prolazi.

## [2.12.0] - 2026-09-16

### Dodato

- **Faza 5 plana prenosivosti deployment-a** (`Plans/deployment-portability-plan.md`) —
  fino podešavanje:
  - `DB_POOL_MAX` (`src/lib/prisma.ts`) — opciono ograničava veličinu `pg` connection
    pool-a po instanci; bez varijable ponašanje je identično današnjem (`pg`-ov
    podrazumijevani `max: 10`, ništa se ne prosljeđuje `PrismaPg`-u). Čitano direktno iz
    `process.env`, ne preko `getEnv()` — `createClient()` se izvršava pri učitavanju
    modula, uključujući Next-ov build, gdje `getEnv()` ne smije da se pozove (isto
    obrazloženje kao `next.config.ts`). Ručno provjereno: `DB_POOL_MAX=2` ispravno
    postavlja `pool.options.max`, upiti i dalje rade.
  - `export const maxDuration = 60` na `izvjestaji/pdf` i `izvjestaji/dugovanja` rutama
    (agregiraju više izvještaja prije renderovanja PDF-a — može biti tijesno za veći ZEV
    na platformi sa podrazumijevanim limitom od 10s). No-op na Dockeru, poštuje se na
    Vercel-u.
  - Nov `scripts/backfill-storage-blobs.ts` (`npm run storage:backfill [-- --apply]`) —
    jednokratni alat koji naslijeđene Docker `filePath` redove (dokumenti/prilozi sa
    diska, od prije Faze 1) prebacuje u `DocumentBlob`/`AttachmentBlob` i briše
    `filePath`. Podrazumijevano dry-run (ništa ne upisuje dok se ne doda `--apply`).
    Nije neophodan za ispravnost — čitanje sa pad-back na `filePath` iz Faze 1 radi
    neograničeno — vrijedan tek kad se stvarno planira ugasiti disk na kojem ti fajlovi
    žive. 4 nova testa (`tests/backfill-storage-blobs.test.ts`): dry-run ne upisuje,
    stvarno prebacivanje dokumenta i priloga, i siguran preskok reda čiji fajl više ne
    postoji na disku (bez rušenja, bez gubljenja reda).
  - `.env.example`/README dopunjeni sa `DB_POOL_MAX`.
  - 247/247 testova prolazi.
  - Ovim je kompletan kod iz plana prenosivosti deployment-a (Faze 0-5) implementiran.
    Preostaje samo stvaran probni deployment na Vercel — svjesno odloženo, van obima
    ovog izdanja (zahtijeva Vercel nalog i produkcionu Postgres bazu koje ova sesija
    nema pristup da sama podesi).

## [2.11.0] - 2026-09-15

### Izmijenjeno

- **Faza 4 plana prenosivosti deployment-a** (`Plans/deployment-portability-plan.md`) —
  deployment procedura:
  - `docker-entrypoint.sh` refaktorisan da poziva `npm run db:migrate` / `npm run db:seed`
    umjesto da direktno zove `scripts/migrate.mjs`/`tsx prisma/seed.ts` — iste komande koje
    korisnik/CI pokreće ručno na platformi bez ovog entrypoint-a, nula duplirane logike.
    Petlja čekanja na Postgres izdvojena u `scripts/wait-for-db.mjs` (i dalje redundantna sa
    `docker-compose.yml`-ovim `depends_on: service_healthy`, ali korisna odbrana za `docker run`
    bez Compose-a ili eksterni/managed Postgres).
  - Nov `GET /api/health` (`src/app/api/health/route.ts`) — provjerava dohvatljivost baze
    (`SELECT 1`) i vraća verziju iz `package.json`, bez autentikacije, bez detalja o konekciji.
    `docker-compose.yml` dobija healthcheck za `app` servis preko njega (ranije ga nije imao).
  - `"engines": { "node": ">=22" }` u `package.json`.
  - **`MAX_UPLOAD_MB` sada stvarno primijenjen** (`src/lib/env.ts`, podrazumijevano `4`) —
    `attachments.ts` više ne koristi fiksnih 15 MB, i `next.config.ts`-ov
    `serverActions.bodySizeLimit` je usklađen sa istom vrijednošću. **Namjerna izmjena
    ponašanja: efektivan limit za upload skeniranih dokumenata pada sa 15 MB na 4 MB**
    (margina ispod Vercel-ovog tvrdog infrastrukturnog zida od 4.5 MB po tijelu zahtjeva,
    §11 P5) — istaknuto ovdje jer neko ko je navikao na veće skenove može prvi put udariti u
    ovaj limit tek nakon objave.
  - `.env.example` i README dopunjeni: `MAX_UPLOAD_MB` više nije zakomentarisan (sada aktivan),
    i nova README sekcija „Deployment na Vercel" sa tabelom varijabli (uključujući `MAILJET_*`)
    i eksplicitnim redoslijedom migracija.
  - 243/243 testova prolazi (novi: `tests/health.test.ts`; prošireni `tests/env.test.ts` za
    `MAX_UPLOAD_MB`; `tests/attachments.test.ts`-ov test limita usklađen sa novih 4 MB).
  - Ovim je Faza 0-4 (P6 opcija b) plana prenosivosti deployment-a u potpunosti implementirana;
    preostaje samo Faza 5 (pooling, `maxDuration`, backfill alat, stvaran probni deployment na
    Vercel), namjerno odložena van trenutnog obima.

## [2.10.0] - 2026-09-15

### Dodato

- **Faza 3 plana prenosivosti deployment-a** (`Plans/deployment-portability-plan.md`) —
  Mailjet kao pravi e-mail provajder:
  - `src/server/notifications/mailjetEmail.ts` — `MailjetEmailProvider`, implementira
    postojeći `EmailProvider` interfejs preko Mailjet REST API-ja (`POST /v3.1/send`,
    Basic Auth). Mapira Mailjet-ov `Messages[].Status`/`Errors` na `SendResult`; mrežne
    greške i ne-2xx HTTP odgovori se hvataju i vraćaju kao `ok: false`, ne bacaju grešku.
  - `getEmailProvider()` (`providers.ts`) dobija `case "mailjet"`; `mock` ostaje
    podrazumijevano ako `EMAIL_PROVIDER` nije postavljen — Docker deployment koji ništa
    ne mijenja nastavlja da radi identično.
  - Mailjet ne šalje delivery/seen callback-ove bez zasebno podešenog Event API-ja (van
    obima) — uspješan `send()` bilježi samo `"sent"` događaj, za razliku od mock
    provajdera koji simulira i `delivered`/`seen`.
  - `VIBER_PROVIDER` ostaje `mock` — pravi Viber provajder je i dalje odloženo.
  - README dopunjen uputstvom za podešavanje (API key/secret, verifikacija `FROM`
    adrese) i napomenom da neuspjeli pokušaji ne dobijaju automatski retry
    (`retryFailed()` i dalje nema pozivaoca, zakazivanje van obima).
  - Novi testovi `tests/mailjetEmail.test.ts` (6, mockovan HTTP odgovor — uspjeh, greška
    na nivou Mailjet-a, ne-2xx HTTP, mrežna greška, nedostajuća konfiguracija) i
    `tests/providers.test.ts` (5, provjera switch-a za oba kanala). 239/239 testova
    prolazi.

## [2.9.0] - 2026-09-15

### Dodato

- **Faza 2 plana prenosivosti deployment-a** (`Plans/deployment-portability-plan.md`) —
  fontovi i konfiguracija:
  - `src/lib/env.ts` — centralna, lijeno validirana (`zod`) konfiguracija. `APP_URL`
    više ne pada tiho na `http://localhost:3000` u produkciji — u produkciji je
    obavezan i nedostatak sada puca sa jasnom porukom na sr-Latn umjesto da tiho
    generiše neispravne linkove/QR kodove. Van produkcije zadržava podrazumijevanu
    lokalnu vrijednost, bez izmjene ponašanja. Tri pozivaoca (`meetings.ts` ×2,
    `zaboravljena-lozinka/page.tsx`) prešla sa `process.env.APP_URL ?? "…"` na
    `getEnv().APP_URL`.
  - `src/server/pdf/fonts.ts` — fontovi se sada čitaju jednom po instanci procesa
    (memoizovan `Buffer`) umjesto po svakom generisanom PDF-u; putanja je
    podesiva preko `FONT_DIR`, sa jasnom greškom ako font nije pronađen.
  - `outputFileTracingIncludes` u `next.config.ts` za `assets/fonts/**` — Next-ovo
    praćenje fajlova ranije nije moglo otkriti fontove jer se čitaju preko sirove
    `fs` putanje, ne preko `import`-a.
  - `.env.example` dopunjen (`MIGRATE_DATABASE_URL`, `MAILJET_*`, `MAX_UPLOAD_MB`
    dokumentovani unaprijed za kasnije faze) — i **prvi put stvarno komitovan**:
    `.gitignore`-ov `.env*` je do sada tiho isključivao i njega, pa fajl nikad
    nije bio dio istorije repozitorija iako ga README od početka referencira.
  - Usput otkriven i ispravljen bag: `import "server-only"` u `env.ts` je rušio
    `prisma/seed.ts` (poziva `meetings.openVoting`, koji sada zove `getEnv()`) pod
    plain `tsx`-om, koji nikad ne postavlja Next-ov `"react-server"` export
    uslov — paket bezuslovno puca van Next build-a. `env.ts` namjerno ne uvozi
    `server-only`, po istom obrascu kao `src/lib/prisma.ts`.
  - Novi testovi `tests/env.test.ts` (5) i `tests/fonts.test.ts` (3, uklj. PDF sa
    č/ć/ž/š/đ). 228/228 testova prolazi.

### Izmijenjeno

- **Faza 1 plana prenosivosti deployment-a** (`Plans/deployment-portability-plan.md`) —
  dokumenti i prilozi se sada čuvaju u Postgres bazi umjesto na lokalnom fajlsistemu:
  - Nove tabele `DocumentBlob`/`AttachmentBlob` (1:1 sa `Document`/`Attachment`,
    `onDelete: Cascade`), zasebne od glavnih tabela da listanje dokumenata/priloga
    (obična `findMany` bez `select`) nikad nenamjerno ne povuče sadržaj fajlova.
  - `Document.filePath` i `Attachment.filePath` su sada opcioni — postojeći Docker
    redovi (apsolutna putanja sa diska) i dalje rade bez izmjene, novi redovi ih
    više ne postavljaju.
  - `storeDocument`, `uploadAttachment` i `createLinkedAttachmentTx` upisuju red i
    blob **u istoj DB transakciji** — bivši rizik od siročeta na disku (upis fajla
    uspije, DB upis padne) više ne postoji po dizajnu, bez potrebe za alatom za
    čišćenje.
  - `readDocumentFile`/`readAttachmentFile` prvo pokušaju blob, pa se vraćaju na
    `fs.readFileSync` samo za naslijeđene redove bez blob-a.
  - **Docker ponašanje nepromijenjeno** — nema nove env varijable; `docker compose up`
    sa nepromijenjenim `docker-compose.yml` radi identično kao prije.
  - Novi kontrakt-test `tests/document-storage.test.ts` (round-trip, sha256,
    naslijeđeni `filePath`, red bez ijednog izvora podataka); `tests/documents-audit.test.ts`
    prešao sa `fs.existsSync`/`fs.readFileSync` na provjeru `DocumentBlob` reda.
  - Uklanja S3/object-storage granu iz plana u cjelosti (`StorageAdapter`,
    `STORAGE_BACKEND`, `@aws-sdk/client-s3`) — vidi odluku iz §11 P2.
  - 220/220 testova prolazi.

## [2.7.1] - 2026-09-15

### Izmijenjeno

- **Faza 0 plana prenosivosti deployment-a** (`Plans/deployment-portability-plan.md`) —
  priprema bez promjene ponašanja, prvi korak ka skladištenju dokumenata u bazi
  (Faza 1):
  - `storeDocument` sada vraća `{ row, buffer }` umjesto samo reda — pozivaoci koji
    generišu i odmah preuzimaju isti dokument koriste bafer koji već imaju, umjesto
    da ga ponovo čitaju sa diska.
  - `api/izvjestaji/pdf`, `api/izvjestaji/dugovanja` i `api/dokumenti/kartica/[partyId]`
    više ne rade nepotreban dodatni upis-pa-čitanje; prva dva su i prestala direktno
    da diraju `Document.filePath` (`fs.readFileSync`), zaobilazeći servisni sloj.
  - Usput vraćen `document.download` audit zapis na `kartica/[partyId]` ruti, koji bi
    inače nestao ovom optimizacijom (generisanje i preuzimanje su sada isti korak, pa
    se revizioni zapis piše direktno u `generateOwnerStatementPdf`).
  - Bez ijedne vidljive promjene za korisnika; 217/217 testova prolazi.

## [2.7.0] - 2026-09-14

### Dodato

- **Faza 3 dnevnika korisničkih aktivnosti** (`Plans/user-activity-log-plan.md`) — nova
  stranica **Aktivnosti — svi ZEV nalozi** (`/admin/aktivnosti`, dostupna isključivo
  super adminu, dugme na `/admin` pored liste svih ZEV naloga):
  - Platformski, cross-tenant pregled aktivnosti — u potpunosti dijeli katalog radnji,
    prevode i renderer iz Faze 2 (`/aktivnosti`), razlikuje se samo po obimu upita.
  - Podrazumijevano prikazuje sve četiri kategorije (uklj. sistemske događaje poput
    prijava i platformske administracije) — za razliku od `/aktivnosti`, koja po
    default-u prikazuje samo aktivnost vlasnika i upravljanja.
  - Filter po konkretnom ZEV nalogu (ili "Svi ZEV nalozi"); filter po akteru postaje
    aktivan tek kad je izabran konkretan ZEV. Nova kolona "ZEV" u tabeli, uklj. redove
    bez tenanta (npr. prijava prije nego što je sesija razriješila aktivan ZEV).
  - Novi indeks na `AuditEvent` (`createdAt`) za upit preko svih tenanata bez filtera po
    ZEV-u.
  - Novi test koji provjerava da pristup ima isključivo super admin, da filter po ZEV-u
    ispravno suzi rezultate na jedan tenant, i da bez filtera vraćaju redovi iz više
    tenanata (uklj. one bez tenanta).
  - Ovim je `Plans/user-activity-log-plan.md` u potpunosti implementiran (Faza 1-3);
    preostaje samo opciono doterivanje iz Faze 4, po potrebi.

## [2.6.1] - 2026-09-14

### Dodato

- **Faza 2 dnevnika korisničkih aktivnosti** (`Plans/user-activity-log-plan.md`) — nova
  stranica **Aktivnosti** (`/aktivnosti`, dostupna samo predsjedniku, dugme na
  Podešavanjima pored "Revizorski trag"):
  - Katalog svih 111 postojećih tipova zabilježenih radnji, razvrstanih u četiri
    kategorije (aktivnost vlasnika, upravljanje i skupština, finansije, sistemski
    događaji) — podrazumijevano se prikazuju prve dvije, ostale su dostupne preko
    filtera.
  - Filteri: period (podrazumijevano zadnjih 30 dana), kategorija, akter (ko je
    izvršio radnju) — sa straničenjem (50 po strani).
  - Čitljive labele umjesto sirovih engleskih kodova za aktivnost vlasnika i
    upravljačke radnje (npr. "Prijavio/la kvar", "Glasao/la elektronski", "Otvoreno
    glasanje"); finansijske i sistemske radnje za sada ostaju u sirovom obliku
    (prigušen prikaz) — mogu se dodati naknadno na zahtjev.
  - Nekoliko radnji (prijava kvara, promjena statusa prijave, objava dokumenta) ima
    i kratak jednoredni rezime iz podataka same radnje.
  - Novo: dijeljena komponenta za straničenje (`Pagination`) u `src/components/ui.tsx`.
  - Test koji provjerava da je svaka radnja u kodu zaista klasifikovana (spriječava
    da nova, nepregledana radnja tiho nestane iz prikaza).
  - Slijedi Faza 3 (`/admin/aktivnosti` za super admina, preko svih ZEV naloga).

## [2.6.0] - 2026-09-14

### Dodato

- **Faza 1 dnevnika korisničkih aktivnosti** (`Plans/user-activity-log-plan.md`,
  plan odobren 2026-09-09) — temelji, bez vidljive promjene za korisnika:
  - Dva nova indeksa na `AuditEvent` (`[zevId, createdAt]`,
    `[zevId, actorId, createdAt]`), neophodna za bilo koji paginirani prikaz
    aktivnosti preko ove tabele (koja samo raste).
  - **Ispravljen `vote.submit` audit zapis** — do sada se upisivao potpuno
    neatribuiran (`zevId: null`, bez ikoga ko je glasao), pa je elektronsko
    glasanje bilo strukturno nevidljivo na `/podesavanja/audit`. Sada nosi
    `zevId` (iz već provjerenog prijedloga) i identitet glasača (preko
    `Party`, dok ne dobije posebnu kolonu). **Izbor glasa (`choice`) se više
    uopšte ne upisuje** ni u jedan audit zapis (stroža odluka od originalne
    preporuke — glasanje nije zakonski tajno, ali pregledljiv feed po osobi
    je drugačija izloženost od formalne liste glasanja). Sam izbor ostaje
    ispravno sačuvan u `Vote` tabeli za prebrojavanje i zvaničan rezultat.
  - `document.publish` audit zapis sada nosi čitljiv sadržaj (tip, broj,
    naslov dokumenta) — ranije nije imao nikakav.
  - Ime aktera (`actorLabel`) sada preživljava i nakon što član napusti ZEV
    (ranije se oslanjalo na živi join koji se tada pokvari).
  - Prošireni `tests/voting.test.ts` i `tests/tenant-isolation.test.ts`.
  - Slijedi Faza 2 (katalog akcija + `/aktivnosti` feed za predsjednika) i
    Faza 3 (`/admin/aktivnosti` za super admina, preko svih ZEV naloga).

## [2.5.5] - 2026-09-12

### Izmijenjeno

- **Dugme "+ Dodaj X" za otvaranje inline formi zamijenjeno standardnom
  komponentom (`ToggleBtn`)** na svih 9 mjesta gdje se koristi
  (`vlasnici`, dvaput na `skupstina`, `skupstina/[id]`, `planovi/[id]`,
  `fakture`, `troskovi`, `dokumenti`, `odrzavanje/[id]`) — umjesto golog
  plavog linka ("+ Dodaj lice" i sl.), sada je to ista "pilula" kao ostala
  dugmad u aplikaciji (`btnBase`/`btnVariantCls`), sa strelicom (`›`) koja
  se rotira za 90° kad se sekcija otvori/zatvori (isti obrazac kao
  strelica za sažimanje bočnog menija) — jasnija vizuelna naznaka da
  dugme otvara/zatvara sadržaj. Crveni "Hitna intervencija" prekidač na
  `odrzavanje/[id]` koristi `danger` varijantu iste komponente. Ponašanje
  nepromijenjeno — i dalje čist `<details>/<summary>` bez JS-a. Provjereno
  vizuelno (izolovan render obje varijante, otvoreno/zatvoreno stanje) i
  `typecheck`/`lint` na svih 9 izmijenjenih fajlova.

## [2.5.4] - 2026-09-11

### Dodato

- **Tooltip sa punim pravnim nazivom ZEV-a** na meniju za prebacivanje (svaki red u
  „Moji ZEV-ovi") i na značci aktivnog ZEV-a u gornjoj traci — hover preko kratkog
  naziva (`Zev.shortName`, kad postoji) sada prikazuje `Zev.legalName` kao naslov
  (`title` atribut), umjesto da se pun naziv vidi samo na /admin. Tooltip se ne
  prikazuje kad kratki i puni naziv nisu postavljeni različito (nema suvišnog
  ponavljanja iste vrijednosti). `TenantOption` (`nav-shell.tsx`) dobio novo opciono
  polje `fullLabel`; `src/app/(app)/layout.tsx` ga popunjava sa `legalName`.

## [2.5.3] - 2026-09-11

### Izmijenjeno

- **Vizuelno osvježen meni naloga (`NavShell`)** — dropdown ispod avatara
  (prebacivanje ZEV-a, Podešavanja, Odjava) sada ima: profilnu "karticu" na
  vrhu (avatar + ime + role, umjesto samog teksta), red za svaki ZEV sa
  ikonicom zgrade i plavom pozadinom/kvačicom za trenutno aktivan (umjesto
  golog teksta "(aktivan)"), ikonice uz Podešavanja i Odjavu, širi i
  zaobljeniji okvir sa jačom sjenkom, i suptilnu animaciju otvaranja
  (poštuje `prefers-reduced-motion`).
- **Značka aktivnog ZEV-a u gornjoj traci** — od golog sivog "pilula" teksta
  do plave tonalne značke sa ikonicom zgrade, dosljedno sa ostatkom
  aplikacije (isti `ring-1 ring-inset` obrazac kao `StatusBadge`).
- Dodate dvije nove monohromatske ikonice u `nav-icons.tsx`: `IconCheck`
  (kvačica za aktivan ZEV) i `IconLogout` (izlazna strelica za Odjavu),
  istim stilom kao postojeće.
- Nema promjena u ponašanju/logici prebacivanja ZEV-a — popravka iz 2.5.2
  (odgođeno zatvaranje menija zbog `type="submit"`) je zadržana bez izmjena.
  Provjereno vizuelno u izolovanom renderu komponente (van Next/Prisma
  stacka, sa lažnim podacima za dva ZEV-a) — desktop i mobilni prikaz, otvoren
  i zatvoren meni, klik na prebacivanje ZEV-a.

## [2.5.2] - 2026-09-10

### Ispravljeno

- **Prekidač aktivnog ZEV-a u meniju naloga (`NavShell`) nije stvarno
  prebacivao na neaktivni tenant** — klik bi zatvorio meni, ali prebacivanje
  se nikad ne bi izvršilo. Uzrok: dugme je istovremeno `type="submit"` (šalje
  formu `switchZevAction`-u) i imalo je `onClick` koji odmah poziva
  `setMenuOpen(false)`, čime se sama forma ukloni iz stranice prije nego što
  browser stigne da izvrši podrazumijevanu radnju klika (submit) — submit se
  time tiho poništi. Popravka: zatvaranje menija se odgađa za sljedeći tik
  (`setTimeout(..., 0)`), tako da se forma prvo pošalje. Otkriveno uživo (nije
  ga mogao uhvatiti automatski test paket — servisni testovi ne simuliraju
  klik u pravom browseru).

## [2.5.1] - 2026-09-10

### Ispravljeno

- **`tests/tenant-isolation.test.ts` je padao sa `Error: This module cannot be
  imported from a Client Component module`.** Uzrok: paket `server-only`
  (koga uvoze `session.ts`, `actor.ts`, `admin.ts`, `memberships.ts`) postaje
  no-op samo pod Next-ovim posebnim `"react-server"` export-uslovom — Vitest
  taj uslov nikad ne postavlja, pa svaki test koji stvarno učita taj lanac
  uvoza pogodi paketov bezuslovni `throw`. Taj lanac je prvi put postao
  dostupan testovima u Koraku 2 (`tenant-isolation.test.ts` →
  `memberships.ts` → `session.ts`); Korak 3 je dodao još jedan takav uvoz
  (`admin.ts`) i pad je postao vidljiv. Popravka: `vitest.config.ts` sad
  alias-uje `"server-only"` direktno na paketov sopstveni no-op
  `node_modules/server-only/empty.js` — ne dira stvarni Next.js build (koji i
  dalje ispravno primjenjuje `server-only` provjeru), samo uklanja lažni pad
  u test runneru koji tu provjeru ne može zadovoljiti.

## [2.5.0] - 2026-09-10

### Dodato

- **Cross-tenant administracija naloga** (Faza 3, Korak 3 iz
  `Plans/tenant-switching-admin-accounts-plan.md`): super admin sada može, sa
  `/admin/[zevId]`, otvoriti potpuno nov nalog u tuđem tenantu
  (`createTenantAccount` — pravi `Party` + `User` + `Membership`, rola
  ograničena na Predsjednik/Računovođa jer vlasništvo obavezno traži dokaz o
  vlasništvu koji ovaj put zaobilazi), dodijeliti pristup postojećem nalogu
  (`grantMembership` — samo nov `Membership` red, uklj. sopstveni pristup
  super admina), i ukloniti pristup (`revokeMembership` — čuva posljednjeg
  aktivnog predsjednika preko iste provjere koju koristi i sam predsjednik
  ZEV-a na `/vlasnici`).
- **UI na `/admin/[zevId]`:** značka "Platformski admin" pored naloga
  platformskog admina u tabeli članova; upozorenje kad ZEV nema nijednog
  aktivnog predsjednika koji nije platformski admin; dugme "Ukloni pristup"
  (sa obaveznim razlogom) po članstvu; nove kartice "Dodaj novi nalog",
  "Dodaj postojeći nalog" i "Moj pristup" (zahtjev/ulazak/uklanjanje
  sopstvenog pristupa).

### Izmijenjeno

- `setTenantActive()` (`admin.ts`): suspendovanje ZEV-a u kojem je super
  admin trenutno aktivan više ga ne odjavljuje na sljedećem zahtjevu — prvo
  se očisti sopstveni `Session.activeZevId` (`setSessionActiveZev(...,
  null)`), pa se tek onda tenant suspenduje.
- `assertNotLastActivePresident()` (`users.ts`) je sad izvezena funkcija —
  koristi je i `revokeMembership()` u `admin.ts`, umjesto da se ista provjera
  piše dvaput.

## [2.4.0] - 2026-09-10

### Dodato

- **Prebacivanje aktivnog ZEV-a** za korisnike sa članstvom u više tenanata
  (Faza 3, stavka 1 iz `docs/multitenancy-plan.md`; puni plan u
  `Plans/tenant-switching-admin-accounts-plan.md`, Korak 2). Novo:
  `setSessionActiveZev()` (`session.ts`), `Actor.sessionId?`, i novi servisni
  modul `src/server/services/memberships.ts` (`listMyTenants`,
  `switchActiveZev`) — prebacivanje se dozvoljava isključivo u ZEV u kojem
  pozivalac ima `Membership` red (bez izuzetka za super admina), i samo dok je
  ciljni ZEV aktivan. Isti nalog ne mora imati samo jedno članstvo, pa se ovo
  odnosi i na obične korisnike (npr. knjigovođa u više ZEV-ova), ne samo super
  admina.
- **UI za prebacivanje:** korisnički meni u `NavShell`-u dobija sekciju sa
  listom ZEV-ova (prikazuje se samo kad ih ima više od jednog) i trajni chip
  aktivnog ZEV-a pored menija. Na `/admin` (lista i detalji tenanta) dodato
  dugme "Uđi" za tenante u kojima super admin već ima članstvo.

### Izmijenjeno

- `listTenants()` (`admin.ts`) sada uz svaki tenant vraća i da li pozivalac
  (super admin) već ima članstvo u njemu — koristi ga link "Uđi" na listi.

## [2.3.0] - 2026-09-10

### Dodato

- `assertPasswordStrong()` u `src/server/auth/password.ts` — jedno mjesto za
  provjeru jačine lozinke (i dalje prag od 8 znakova), sada pozvano iz
  `resetPassword` (zamjenjuje njenu staru inline provjeru istog praga) **i**
  `createUserForParty` (koja do sada nije imala nikakvu provjeru — predsjednik je
  mogao postaviti i jednoznakovnu lozinku za novog vlasnika preko `/vlasnici`).
- Nova klijentska komponenta `src/components/password-field.tsx` — polje za
  lozinku (`type="text"`, čitljivo kao i dosadašnje sirovo polje) sa dugmadima
  "Generiši" (nasumična lozinka preko `crypto.getRandomValues`) i "Kopiraj".
  Zamjenjuje sirovi `<input type="text" name="accountPassword">` na `/vlasnici`
  i koristi se i za novo polje "Početna lozinka" na `/admin`.

### Izmijenjeno

- **Popravljen "kokoška-jaje" bag u onboardingu novog tenanta.**
  `createTenant()` (`/admin`) je do sada heširao nasumičan, nikad saopšten
  token kao lozinku predsjednika i slao mu (mock) e-mail sa linkom za
  postavljanje lozinke — ali predsjednik, nemajući još nijedno članstvo u
  novom tenantu, nije imao ni gdje da tu poruku pročita (`/podesavanja/poruke`
  traži članstvo), a link je uz to važio samo 1h. Onboarding preko UI-ja je
  time bio strukturno neizvodljiv. Sada `createTenant()` prima lozinku koju
  super admin direktno unese (isti obrazac koji `/vlasnici` već koristi za
  nove vlasničke naloge), bez ijednog tokena — poruka dobrodošlice ostaje
  (trag u evidenciji tenanta da je nalog otvoren), ali sada objašnjava da je
  početnu lozinku postavio administrator platforme. Vidi
  `Plans/tenant-switching-admin-accounts-plan.md`, Korak 1.
- Novi test `tests/admin.test.ts` (prvi test paket za `src/server/services/admin.ts`):
  `createTenant` pravi `Zev`+`Party`+`User`+`Membership`+podešavanja; postavljena
  lozinka stvarno prolazi kroz `authenticate()`; slaba lozinka i duplirani e-mail
  se odbijaju; poziv sa aktorom koji nije super admin se odbija. `tests/helpers.ts`
  dobija `createSuperAdminActor()`.

## [2.2.0] - 2026-09-09

### Dodato

- Faza 1 (multitenancy), Korak 4 zaključen — ali drugačije od plana:
  `setTenantActive()` u `admin.ts` suspenduje/reaktivira tenant (bez
  brisanja ijednog podatka; sesije tog tenanta se automatski odjavljuju na
  sljedećem zahtjevu preko postojeće `zevSuspended` provjere), sa formom
  na `/admin/[zevId]`.

### Izmijenjeno

- **Odluka: `wipeTenantData` (brisanje svih podataka jednog tenanta) se ne
  gradi.** Planska analiza (Opus model, plan-only prolaz) je pokazala da
  je, pored `AuditEvent`-a i `Vote`-a, i `PaymentAllocation` append-only
  (isti DB triger) — čim tenant ima ijednu alociranu uplatu ili dat glas,
  to strukturno blokira brisanje skoro cijelog preostalog stabla podataka
  preko `RESTRICT` FK-ova, uključujući trenutni tenant #1. Jedina
  alternativa (privremeno gašenje append-only trigera) bi oslabila
  garanciju koju sistem opisuje kao apsolutnu. Vidi
  `docs/multitenancy-plan.md`, Faza 1 → "Stavka 4 — odluka (2026-09-09)"
  za puno obrazloženje i preporučenu alternativu (suspenduj stari tenant,
  kreiraj svjež prazan tenant za stvarne podatke).

## [2.1.1] - 2026-09-09

### Dodato

- Faza 1 (multitenancy), Korak 4: `/admin` oblast za super admina — bootstrap
  skripta (`npm run admin:promote <email>`) za promociju postojećeg korisnika u
  super admina, `requireSuperAdmin()`/`requireSuperAdminActor()` čuvari,
  `/admin` layout i stranice (lista tenanata, kreiranje novog tenanta, detalji
  tenanta). Super admin koji je istovremeno predsjednik svog ZEV-a nastavlja
  da se prijavljuje direktno na svoj tenant (`/`), sa linkom ka `/admin` u
  meniju — na `/admin` se automatski šalje samo super admin bez ijednog
  tenanta.
- `Setting` model prebačen sa jedinstvenog (platform-wide) na model po
  tenantu (`@@id([zevId, key])`) — svaki ZEV sada ima svoja podešavanja
  (naziv organa, veličina odbora, mandat, itd.), umjesto da dijeli jedan
  zajednički red sa svim ostalim tenantima. Podrazumijevane vrijednosti
  (`src/lib/settings-defaults.ts`) se sada eagerly sjeme (seed) i za nove
  tenante (`createTenant()`) i za `prisma/seed.ts`, uz dodatni fallback pri
  čitanju (`getSettings()`) za slučaj da se u budućnosti doda novi ključ.
  Ručno pisana migracija (`20260909100000_tenant_scope_settings`) prebacuje
  postojeći red na trenutni (jedini) tenant kao podrazumijevanu vrijednost za
  sve buduće tenante.

### Ispravljeno

- **Sigurnosna ispravka: curenje podataka između tenanata (cross-tenant).**
  Revizija (uz pomoć Opus modela za plan/analizu) je pronašla niz mjesta gdje
  su stranice i API rute pravile `prisma` upite direktno (mimo servisnog
  sloja, koji je već ispravno filtriran po `zevId`) bez filtera po `zevId` —
  greška koja je postojala od trenutka kad bi postojao drugi tenant, ne samo
  teoretski rizik za prazan tenant. Ispravljeno u:
  - `(app)/page.tsx` — oba dashboarda (upravni i vlasnički): sastanci,
    prijedlozi, prijave kvarova, serije faktura, uplate i (najozbiljnije)
    `annualPlan.findFirst()` koji je bez filtera birao "bilo koji" plan i
    rušio stranicu čim bi postojao plan drugog tenanta.
  - Sedam API ruta (izvještaji CSV/PDF, dugovanja, kartica i saglasnost
    vlasnika, preuzimanje dokumenata i priloga) — akter proslijeđen u
    servisni sloj nije nosio `zevId`/`isSuperAdmin`, pa su servisne provjere
    tiho prolazile.
  - `troskovi`, `vlasnici`, `fakture`, `fakture/serija/[id]`,
    `fakture/uplate/[id]`, `planovi/[id]` — padajuće liste i pomoćni upiti
    (stavke plana, punomoćja, serije faktura, otvorene fakture, prihvaćeni
    prijedlozi) učitavali su podatke svih tenanata, ne samo trenutnog.
  - `podesavanja/audit` — revizorski trag i mapa e-mailova za prikaz aktera
    učitavali su **sve korisnike platforme**, ne samo članove trenutnog
    tenanta (najosjetljivija stavka u ovoj seriji ispravki).
  - `podesavanja/poruke` — outbox poruka (e-mail/Viber) prikazivao je poruke
    svih tenanata.
- Dopunjen `tests/tenant-isolation.test.ts` sa testovima za `settings`
  modul (dva tenanta imaju nezavisna podešavanja).

## [2.1.0] - 2026-09-08

### Dodato

- Test paket za izolaciju tenanta (`tests/tenant-isolation.test.ts`, vidi
  `docs/multitenancy-plan.md` §6, Korak 6): dva potpuno nezavisna tenanta
  (dva `createFixture()` poziva), pa svaka exportovana funkcija iz sva 14
  servisna modula (`property`, `ownership`, `finance`, `billing`,
  `payments`, `meetings`, `documents`, `attachments`, `expenses`, `plans`,
  `maintenance`, `reports`, `users`, `evoteConsent`) pozvana sa actor-om
  jednog tenanta protiv pravog (postojećeg, ne izmišljenog) id-a iz drugog
  — i provjereno da uvijek ili baci grešku ("nije pronađen(a)" /
  `ForbiddenError`) ili, gdje funkcija ne provjerava postojanje samog
  stranog id-a (npr. `ownerBalance`, `previewBatch` sa tuđim
  `chargeItemIds`), vrati prazan/nula rezultat — nikad tuđe podatke.
  Dopunjeno sa `listX()` provjerama da liste jednog tenanta nikad ne
  sadrže id-jeve drugog. Ovim test paketom se — dokazano testom, ne samo
  pregledom koda — zatvara Faza 0 (temelji multitenancy-ja): svaki korak
  1-6 iz `docs/multitenancy-plan.md` §6 je sada napisan i (na korisnikovoj
  mašini) verifikovan.
- `docker-compose.yml`: `TEST_DATABASE_URL` za `app` servis (`db:5432`,
  umjesto `.env`-ovog `localhost`, koji unutar kontejnera ne radi i koji
  `.dockerignore` i onako isključuje iz builda) — bez ovoga
  `tests/global-setup.ts` baca "TEST_DATABASE_URL is not set" pri
  pokretanju testova u kontejneru.

### Izmijenjeno

- Multitenancy — peti korak, cijela sekcija (vidi `docs/multitenancy-plan.md`
  §6.4): svaka funkcija u `src/server/services/*` sada eksplicitno
  filtrira/upisuje `zevId` umjesto da se oslanja na privremeni DB default.
  Rađeno po modulima — property/ownership, finansije/fakturisanje/uplate,
  sjednice/glasanje, dokumenti/prilozi, troškovi/planovi/održavanje,
  izvještaji/administracija. `.create()` pozivi više ne primaju `zevId` od
  pozivaoca (uvijek se izvodi iz `actor.zevId` preko novog `requireZev`
  guard-a); čitanje/izmjena po `id` koristi `where: {id, zevId}`; strane
  reference se prije upisa provjeravaju da pripadaju istom tenantu.
- Privremeni `default_zev_id()` DB default (uveden u koraku 3) je uklonjen
  za 30 od 32 kolone koje su ga imale — pozivalac koji ubuduće zaboravi
  postaviti `zevId` sad dobija grešku umjesto tihog pripisivanja pogrešnom
  tenantu. `AuditEvent.zevId` i `NotificationMessage.zevId` su namjerno
  postali istinski nullable (`String?`) — nekoliko događaja (anonimni
  rate-limit, login/reset lozinke prije razrješenja aktivnog ZEV-a,
  password-reset e-mail) legitimno nemaju jedan tenant kome pripadaju.
- `queueNotification` (`src/server/notifications/service.ts`) dobija
  opciono `zevId` polje; `audit()` (`src/server/audit.ts`) sad automatski
  izvodi `zevId` iz actora na svakom pozivu.

### Ispravljeno

Usput otkriveni i popravljeni pravi propusti (van izvornog obuhvata "dodaj
zevId filter", ali direktno na putu dok se taj filter dodavao):

- `addIssueComment` (maintenance.ts) uopšte nije imao provjeru ovlaštenja —
  sad zahtijeva prijavljenog korisnika i provjerava da prijava kvara
  pripada tenantu.
- `zevHeader` (documents.ts) je čitao podatke o ZEV-u preko
  `prisma.zev.findFirst()` ("prvi u bazi", proizvoljno i pogrešno čim
  postoji drugi tenant) — sad čita tačno ZEV izdavaoca dokumenta.
- `assertNotLastActivePresident` (users.ts) je brojao aktivne predsjednike
  preko cijele platforme umjesto po ZEV-u — u višezakupačkom svijetu bi
  roster predsjednika jednog ZEV-a mogao prikriti da drugi upravo gubi
  svog jedinog. Sad broji preko `Membership`, scoped na `zevId`.
- `viberBroadcast` (notifications/service.ts, trenutno bez pozivaoca) je
  slao svim opt-in Viber pretplatnicima na cijeloj platformi — sad prima
  `zevId` kao obavezan parametar i filtrira preko `Party`.
- `skupstina/[id]/page.tsx`: slanje poziva na sjednicu (za sastanke van
  upravnog odbora) je čitalo **sve** vlasnike u bazi bez `zevId` filtera —
  slalo bi pozive na sjednicu jednog ZEV-a vlasnicima svih ostalih.
- `audit()` (`src/server/audit.ts`) nikad nije upisivao `zevId` ni na jedan
  `AuditEvent` red, za nijedan poziv u aplikaciji — svaki audit red je tiho
  padao na DB default (najstariji ZEV u bazi), bez obzira na actora.

Otkriveno tek u punom pipeline-u (`typecheck && lint && test && build`)
nakon isporuke gornjih izmjena, popravljeno u istoj isporuci:

- `prisma/seed.ts` je pravio `Party` redove PRIJE nego što `Zev` red uopšte
  postoji — radilo je dok god je postojao privremeni `default_zev_id()` DB
  default; čim je taj default uklonjen (vidi iznad), seed je počeo padati na
  `Property 'zev' is missing`. Ispravljeno redoslijedom: `Zev` se sad kreira
  prije prvog `Party.create()`.
- `tests/voting.test.ts`: dva poziva `computeProposalResult()` su ostala na
  starom jednoparametarskom potpisu (od prije nego što je funkcija počela
  tražiti i `zevId`); i jedan `occupancy.create()` bez `zevId` u istom
  fajlu.
- `tests/user-admin.test.ts`: test za demotion/deaktivaciju predsjednika je
  pravio "drugog predsjednika" kao goli `User` red bez `Party`/`Membership`
  — nije više dovoljno otkad `assertNotLastActivePresident` broji preko
  `Membership` po `zevId`-u. Ispravljeno dodavanjem prave `Party`/
  `Membership` veze za oba testna korisnika.

### Napomena

- Namjerno OSTAVLJENO neriješeno (produktna odluka, ne mehanička izmjena):
  `deactivateUser`/`activateUser` i dalje mijenjaju `User.active`, globalno
  polje na cijelom nalogu — za korisnika sa članstvom u više ZEV-ova, jedan
  ZEV koji deaktivira nalog time zaključava i pristup drugom.

## [1.2.0] - 2026-09-07

### Izmijenjeno

- Multitenancy — treći korak (vidi `docs/multitenancy-plan.md` §6.3): svih 32
  "mekih" `zevId` kolona iz koraka 1-2 sada su **NOT NULL sa pravom
  `@relation` FK vezom** ka `Zev`, umjesto slobodnog string polja bez
  integriteta. Kolone privremeno dobijaju DB default (`default_zev_id()`,
  nova SQL funkcija koja vraća id jedinog postojećeg ZEV-a) dok servisni
  sloj (korak 5) ne počne eksplicitno postavljati `zevId` na svakom upisu —
  ponašanje za postojećeg (jedinog) tenanta ostaje identično.
- Usput popravljeno 9 postojećih unique ograničenja koja nisu bila svjesna
  tenanta (`Invoice.number`, `WorkOrder.number`, `Proposal(code, version)`,
  `AnnualPlan(year, kind, version)`, `Document(type, number, version)`,
  `InvoiceBatch(period, status)`, `TransactionCategory.name`,
  `VotingRule.name`, `AllocationGroup.name`) — svako sada uključuje `zevId`
  kao dio složenog ključa, čime se sprječava sudar dva različita ZEV-a na
  istom broju fakture, nazivu kategorije i sl. čim se doda drugi tenant.

### Ispravljeno

- `ensureCategory` (finance.ts) i istovjetna logika u payments.ts (bankovni
  import) prebačeni sa `upsert({ where: { name } })` na `findFirst` +
  `create`, jer `TransactionCategory.name` više nije samostalno jedinstven
  ključ.



### Izmijenjeno

- Multitenancy — drugi korak (vidi `docs/multitenancy-plan.md`): auth/sesija/
  Actor prebačeni na `Membership` kao izvor uloga, umjesto zastarjelog
  `User.roles`. `Session` sada nosi `activeZevId` (stvarni FK na `Zev`,
  `onDelete: SetNull`), a `getAuthContext()`/`requireActor`/`maybeActor`
  automatski biraju i pamte aktivni ZEV korisnika iz njegovih `Membership`
  redova te prepoznaju suspendovan (`Zev.active = false`) ZEV, odjavljujući
  sesiju uz poruku na `/login`. `createUserForParty`/`updateUserRoles` sada
  upisuju i u `User.roles` i u `Membership` (dual-write), uz provjeru da
  `Party.zevId` odgovara ZEV-u aktera. Ovo je značajnija prekretnica jer
  mijenja temeljni model autorizacije aplikacije, iako ponašanje ostaje
  identično za postojeći (jedini) tenant. Filtriranje po `zevId` kroz
  servisni sloj i test paket za izolaciju tenanta slijede u narednim
  koracima.

## [0.2.3] - 2026-09-07

### Dodato

- Prvi korak ka multitenancy podršci (vidi `docs/multitenancy-plan.md`): šema
  + jednokratna popuna podataka, bez ikakve promjene u ponašanju aplikacije.
  Dodato: tabela `Membership` (korisnik ↔ ZEV ↔ uloga), `Zev.tier`/
  `Zev.active`, `User.isSuperAdmin`, i (za sada nevezana, nullable) `zevId`
  kolona na 32 postojeća modela. Postojeći podaci postaju "tenant #1" —
  svaki korisnik dobija `Membership` red prema svojim trenutnim ulogama, a
  sve postojeće tabele dobijaju `zevId` popunjen na jedini postojeći ZEV.
  Auth, sesije, servisni sloj i test paket za izolaciju tenanta ostaju
  nepromijenjeni — slijede u narednim koracima.

## [0.2.2] - 2026-09-06

### Izmijenjeno

- Izvještaj „Dugovanja po vlasnicima" sada jasnim tekstom i oznakom uz svaki iznos
  (duguje / preplata / izmireno) objašnjava šta znači prethodni saldo i konačni
  saldo — pozitivan iznos = vlasnik duguje ZEV-u, negativan = ima preplatu
  (kredit/avans), nula = izmireno. Isto pojašnjenje dodato i u PDF izvoz.
- Biranje vlasnika u istom izvještaju zamijenjeno je dropdown menijem sa
  checkboxovima (umjesto teško preglednog `<select multiple>`), sa dugmadima
  „Izaberi sve" i „Obriši izbor".

## [0.2.1] - 2026-09-05

### Izmijenjeno

- Izvještaj „Dugovanja po vlasnicima" sada jasno razdvaja **prethodni saldo**
  (stanje prije izabranog dana) od **promjena knjiženih na izabrani dan**
  (zaduženo/plaćeno/korekcije tog dana), umjesto da prikazuje samo kumulativne
  ukupne iznose otkad postoji vlasnik. Ako na izabrani dan nije bilo nijedne
  promjene, izvještaj sada jasno pokazuje samo prethodni saldo (u plusu, minusu
  ili nula), i za vlasnika i u PDF izvozu.

## [0.2.0] - 2026-09-05

### Izmijenjeno

- Promijenjena šema verzionisanja sa `MAJOR.mmm` na standardni semver
  `MAJOR.MINOR.PATCH` (minor kao podrazumijevani korak, patch za međukorake dok se
  nešto dovršava, major resetuje minor na `1` umjesto na `0`). Vidjeti sekciju
  „Verzionisanje" iznad. Prethodne verzije (`0.900`, `0.901`) ostaju kako su
  zabilježene, bez preimenovanja.

## [0.901] - 2026-09-05

### Dodato

- Izvoz svih operativnih izvještaja (stanje računa, prihodi/rashodi, potraživanja,
  dobavljači, fond održavanja, pregled po zgradama/projektima) u jedan PDF dokument,
  pored postojećeg CSV izvoza po pojedinačnom izvještaju.
- Novi izvještaj „Dugovanja po vlasnicima" na stranici Izvještaji — zaduženo/plaćeno/
  korekcije/saldo po vlasniku, sa stanjem na proizvoljno izabran dan i mogućnošću da
  se prikaže za jednog, više ili sve vlasnike. Izvoz u PDF (izvod otvorenih stavki),
  verzionisan i vidljiv u Dokumentima.

### Ispravljeno

- Filter „stanje na dan" (i za dugovanja po vlasnicima) je do sada isključivao stavke
  izdate/knjižene istog dana nakon ponoći (npr. izvještaj za „danas" je znao pokazati
  sve nule) — sada obuhvata cijeli izabrani dan.

## [0.900] - 2026-09-05

Prva verzionisana isporuka — snimak trenutnog stanja aplikacije.

### Osnovna funkcionalnost

- Autentifikacija i sesije (jose + bcryptjs, sesije u bazi), RBAC (predsjednik,
  računovođa, vlasnik) sa autorizacijom isključivo na serverskom sloju.
- Imovina i vlasništvo: zgrade, jedinice, vlasnici/suvlasnici, korisnici.
- Skupština i organi ZEV-a: prijedlozi, elektronsko glasanje sa kvorumom/većinom po
  snimljenim pravilima, sigurni tokeni za glasanje, izjave o saglasnosti (PDF).
- Fakturisanje i uplate: konfigurabilne stavke naknada (9 metoda obračuna), serije
  faktura, uparivanje uplata, salda.
- Troškovi, dobavljači i godišnji planovi (planirano/realizovano).
- Održavanje: prijave kvarova, zakazivanje, preventivni pregledi.
- Dokumenti, izvještaji i notifikacije (e-mail/Viber, mock provajderi u MVP-u).
- Append-only audit trag (DB trigerima zabranjen UPDATE/DELETE nad audit tabelom i
  glasovima), sav novac kao `Decimal`.

### Izmijenjeno / poboljšano (uoči ove verzije)

- Meni preuređen: lijevi sidebar sa punom navigacijom + tanka gornja traka sa
  profilom/odjavom u gornjem desnom uglu.
- Sidebar se collapsuje/proširuje (defaultno proširen, pamti izbor po korisniku), sa
  monohromatskim pictogram ikonicama za svaku stavku menija.
- Redizajn UI komponenti (`ui.tsx`) u Material Design stilu — dugmad, kartice,
  tabele, polja, statusni bedževi.
- Dodata mogućnost uređivanja postojećih stavki naknada (do sada samo kreiranje).
- Izjava o saglasnosti (PDF) prepravljena da stane na jednu stranicu.
- Proširen tekst saglasnosti i dodana lična Podešavanja sekcija.
- Dodat ZEV logo pored imena aplikacije u meniju (prošireno i suženo stanje) i
  postavljen kao favicon/app ikonica.
