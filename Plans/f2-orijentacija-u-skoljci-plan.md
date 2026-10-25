# F2 — Orijentacija u školjci i prijava — implementacioni plan

**Status: ISPORUČENO u v2.45.0 (nije commitovano); implementirao Sonnet, pregleda Opus.** (Odobreno 2026-10-25, verzija minor.) Fazu F2 iz `Plans/design-review-plan.md` §6 korisnik je tražio kao sljedeći korak 2026-10-25 („Da, napravi implementacioni plan za F2”). Odluka o dizajn sistemu koju faza koristi je **D9** (naziv ZEV-a uvijek vidljiv, 2026-10-25). 

Plan je izrađen čitanjem stvarnog koda (v2.44.0); tvrdnje su vezane za fajl i liniju. Verzija: prijedlog je **minor → 2.45.0**, uz potvrdu prije upisa.

**Cilj faze:** korisnik u svakom trenutku zna **gdje je** i **u kom ZEV-u**, i ima **jedan dodir nazad**. Kontrole školjke su dovoljno velike za dodir. Ekrani za prijavu imaju dosljedne, pristupačne poruke.

Faza rješava nalaze iz pregleda: V8 (X-N01 = R-N03), V9 (X-N02), X-N05 (= V-N25), X-N06, X-N07, X-N08 (= V-N28) i X-N09.

**Granice faze:**
- Nema novih boja, veličina ni težina dugmadi.
- Nema migracije ni servisnih izmjena.
- Meni se **ne preuređuje** po ulogama (to je F9 / D8). Mijenja se samo kako se aktivna stavka prepoznaje i šta stoji u zaglavlju.

---

## 1. Zatečeno stanje (provjereno u kodu)

| # | Šta | Gdje |
|---|---|---|
| 1 | Aktivna stavka menija se računa samo tačnim poklapanjem `pathname === href`, pa na podstranicama nijedna stavka nije označena; nema `aria-current` | `src/components/nav-shell.tsx:207-210` |
| 2 | Podstranice bez „‹ Nazad” (`PageHeader backHref`): detalj fakture, serija, lista uplata, detalj plana, detalj sjednice, detalj prijedloga, detalj prijave održavanja, revizorski trag, poslate poruke | `fakture/[id]`, `fakture/serija/[id]`, `fakture/uplate`, `planovi/[id]`, `skupstina/[id]`, `skupstina/prijedlog/[id]`, `odrzavanje/[id]`, `podesavanja/audit`, `podesavanja/poruke` (provjereno: 0 pojava `backHref`) |
| 3 | Naziv aktivnog ZEV-a se prikazuje samo kad korisnik ima više članstava (`showSwitcher`), i to samo od `sm` naviše (`hidden … sm:inline-flex`), kao `text-xs` | `nav-shell.tsx:89-90, 307-317`; podaci već stižu (`tenants` sa jednim elementom), `(app)/layout.tsx:59-73` |
| 4 | Dugmad menija na telefonu su Unicode glifovi `☰` i `✕` sa `p-1.5` / `p-1` (oko 30px i 26px) | `nav-shell.tsx:267-274, 291-298` |
| 5 | Meni naloga koristi `role="menu"` / `menuitem` bez navigacije strelicama. Uloge su `text-xs`, naslov prekidača ZEV-a je `text-[11px] uppercase` | `nav-shell.tsx:323, 332, 341, 346, 357, 398, 410, 420` |
| 6 | `/zaboravljena-lozinka` i `/reset-lozinka` crtaju ručne poruke (`rounded-md border-…`) umjesto `Flash`; greške na resetu nemaju `role="alert"`. Na `/login` `Flash` stoji **unutar** kartice `AuthShell` (ugniježđena elevacija). Tekstovi su tvrdo kodirani | `zaboravljena-lozinka/page.tsx:30-32`; `reset-lozinka/[token]/page.tsx:13-16`; `login/page.tsx:38-47`; `auth-shell.tsx:24-37` |
| 7 | Fusnota na prijavi je `text-xs` | `auth-shell.tsx:35` |
| 8 | Prekidač „prikaži lozinku” je `text-slate-400` (oko 2,6:1, ispod 3:1 za kontrolu) | `password-input.tsx:31` |
| 9 | `PasswordField` (admin) ima svoj `smallBtnCls` (`text-xs`, bez mete od 44px na telefonu) umjesto `Btn` | `password-field.tsx:23-26, 67-72` |
| 10 | `design-system.md` ne navodi `PasswordInput` u inventaru, opis `PasswordField` ne odgovara kodu, a za `Stat` kaže „traka” iako kod crta tačku | `design-system.md` §1.4 (red „Uspjeh/Upozorenje … traka na `Stat`”), §4.5 (`PasswordField`) |

---

## 2. Izmjene

### F2.1 Aktivna stavka i `aria-current` (`nav-shell.tsx`)
- **Nova funkcija `isActive(href)`:** `pathname === href || (href !== "/" && pathname.startsWith(href + "/"))`. Ako više stavki odgovara (npr. `/podesavanja` i `/podesavanja/…`), aktivna je ona sa **najdužim** `href`.
  - Sad se to ne može dogoditi, ali pravilo štiti od budućih ugniježđenih stavki menija.
  - Stavka `/` (Početna) je aktivna samo tačno na `/`.
- **`linkCls`** koristi `isActive`; svaki `<Link>` u meniju dobija `aria-current={isActive(n.href) ? "page" : undefined}`.
- **Platformska školjka:** isto pravilo, pa `/admin/[zevId]` označava „ZEV nalozi”.

### F2.2 „‹ Nazad” na podstranicama (`PageHeader backHref` / `backLabel`)

| Stranica | `backHref` | `backLabel` |
|---|---|---|
| `fakture/[id]` | `/fakture?tab=fakture` | „Fakture i uplate” |
| `fakture/serija/[id]` | `/fakture?tab=naknade` | „Naknade i serije” |
| `fakture/uplate` | `/fakture` | „Fakture i uplate” |
| `planovi/[id]` | `/planovi` | „Planovi” |
| `skupstina/[id]` | `/skupstina?tab={ASSEMBLY\|BOARD}` po tijelu sjednice | „Skupština i odluke” / „Upravni odbor” |
| `skupstina/prijedlog/[id]` | `/skupstina/{meetingId}` | naslov sjednice (skraćen) |
| `odrzavanje/[id]` | `/odrzavanje` | „Održavanje” |
| `podesavanja/audit`, `podesavanja/poruke` | `/podesavanja` | „Podešavanja” |

- **Vlasnik na detalju fakture** ima „‹ Fakture i uplate” kao i uprava, jer je ruta ista.
- **Grana vlasnika na detalju prijedloga** (`prijedlog/[id]/page.tsx`, rani `return`) dobija isti `backHref`.
- **Tekstovi** `backLabel` idu kroz `t()` (`nav.*` labele već postoje i ponovo se koriste).

### F2.3 Naziv ZEV-a uvijek vidljiv (D9)
- **U sidebaru i meniju na telefonu**, ispod naziva aplikacije: `<div className="truncate text-[13px] text-slate-500" title={puni naziv}>{activeTenant.label}</div>`.
  - Prikazuje se za **svakog** korisnika koji ima aktivni ZEV, i kad ima samo jedan.
  - U suženom režimu se ne prikazuje (`md:hidden` kad je `collapsed`, isto kao naziv aplikacije).
  - U platformskoj školjci se ne prikazuje (tamo nema aktivnog ZEV-a; oznaka „Super admin” ostaje).
- **Chip u gornjoj traci** (za više ZEV-ova) se vidi i na telefonu (`sm:` se uklanja). Tekst `text-xs` → `text-[13px]`, a `max-w` se smanjuje na telefonu (`max-w-[10rem] sm:max-w-[16rem]`).
- **`activeTenant`** se računa i kad `showSwitcher` nije tačno (`tenants?.find(…)` već radi za jedan element); mijenja se samo uslov prikaza.
- **`design-system.md` §4.5:** opis ponašanja se mijenja („jednočlani korisnik ne vidi promjenu” → naziv uvijek vidljiv, D9), kao i komentar u `nav-shell.tsx:73-75`.

### F2.4 Kontrole menija na telefonu
- **Nove ikone** u `nav-icons.tsx`, po ugovoru `IconBase` (P6): `IconMenu` (tri linije) i `IconClose` (×). Ne ulaze u `NAV_ICONS`, jer nisu rute; idu u izvoz pored `IconChevronLeft`.
- **Dugme „Otvori meni”:** `inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 md:hidden`, sa `IconMenu` i vidljivom labelom **„Meni”**. Vidljiva labela olakšava starijim korisnicima (hipoteza iz pregleda; jeftino, bez rizika).
- **Dugme „Zatvori meni”:** `h-11 w-11` sa `IconClose`; `aria-label` ostaje.
- Fokus zamka i vraćanje fokusa u draweru (`nav-shell.tsx:155-205`) se ne mijenjaju.

### F2.5 Meni naloga — pristupačnost i čitljivost
- **Uklanjaju se** `role="menu"` i `role="menuitem"`. Dugme zadržava `aria-expanded`, a `aria-haspopup="menu"` postaje `aria-controls` na id panela.
  - Ostaje obična lista linkova i formi, isto obrazloženje kao za `Tabs` (DS §4.4): lažna ARIA uloga bez navigacije strelicama je gora od nikakve.
  - Escape zatvara meni (provjeriti da postoji; ako ne postoji, dodati zatvaranje na Escape i vraćanje fokusa na dugme).
- **Tekstovi:**
  - uloge `text-xs` → `text-[13px]`;
  - naslov prekidača ZEV-a `text-[11px] font-semibold uppercase tracking-wider` → `text-[13px] font-medium text-slate-500` (bez verzala).
- **Aktivni ZEV u prekidaču:** `aria-current="true"` ostaje.

### F2.6 Ekrani za prijavu
- **`AuthShell`** dobija prop `flash?: { err?: string; msg?: string }` i renderuje `Flash` **iznad** kartice, između zaglavlja i kartice. Tako nema elevacije u elevaciji, a `role="alert"` / `role="status"` dolazi iz `Flash`.
- **Stranice:**
  - `/login`: `<Flash>` se seli iz kartice u `AuthShell flash`;
  - `/zaboravljena-lozinka`: ručni zeleni `div` (`:32`) → `AuthShell flash.msg`;
  - `/reset-lozinka/[token]`: ručne poruke → `AuthShell flash.err`.
- **Tekstovi** sa tri stranice idu u rječnik: `auth.login.*`, `auth.forgot.*`, `auth.reset.*` (ugniježđeno, `sr-Latn.ts` i `en.ts`). Tekst se ne mijenja, samo se seli.
- **Fusnota:** `text-xs` → `text-[13px]`.
- **Prekidač „prikaži lozinku”** (`password-input.tsx`):
  - boja `text-slate-400` → `text-slate-500` (iznad 3:1);
  - ikona prikazuje **radnju**: oko kad je lozinka skrivena („Prikaži”), precrtano oko kad je vidljiva („Sakrij”), uz postojeći `aria-label` i `aria-pressed`;
  - danas je obrnuto: ikona pokazuje stanje.

### F2.7 `PasswordField` i dokumentacija
- **`password-field.tsx`:** „Generiši” i „Kopiraj” postaju `Btn variant="secondary"` (dobijaju 44px na telefonu); `smallBtnCls` se briše. Poruka „Kopirano” dobija `aria-live="polite"`.
- **`design-system.md`:**
  - §1.4: „traka na `Stat`” → „tačka na `Stat`”;
  - §4.5: novi red `PasswordInput` (polje sa „prikaži / sakrij”, koristi ga prijava i reset) i ispravljen opis `PasswordField` (admin: polje + „Generiši” + „Kopiraj”);
  - §5: ikone `IconMenu` i `IconClose` u inventar;
  - §4.5: novo ponašanje naziva ZEV-a (D9).

---

## 3. Testovi
- **Logika aktivne stavke** se izdvaja u čistu funkciju (`src/components/nav-active.ts`: `activeHref(pathname, hrefs)`), sa testom `tests/nav-active.test.ts`:
  - `/` aktivna samo na `/`;
  - `/fakture/uplate/123` → `/fakture`;
  - `/podesavanja/audit` → `/podesavanja`;
  - `/admin/abc` → `/admin`;
  - najduži prefiks pobjeđuje;
  - nepoznata ruta → nijedna.
- **Rječnik:** postojeći testovi i18n moraju proći; novi ključevi su ugniježđeni (lak propust: ravni ključ s tačkom tiho vraća sam ključ). Pregled screenshota to hvata.
- Servisnih testova nema, jer nema servisnih izmjena.

## 4. Provjera
- **Pipeline:** `export PATH=~/.local/zev-tools/node/bin:$PATH; npm run typecheck && npm run lint && npm test && npm run build`. Dozvoljene su samo 3 zatečene greške u `tests/env.test.ts`.
- **Živi pregled** na 1440 i 375 (svjež build, `next start`, Playwright + Chrome), za vlasnika, računovođu, predsjednika i super admina:

| Ekran | Šta mora biti istina |
|---|---|
| svaka podstranica iz §2 tabele | tačno jedna stavka menija je označena, ima `aria-current="page"`; „‹ Nazad” vodi na tačnu stranicu (i tab) |
| sidebar i meni na telefonu, korisnik sa jednim ZEV-om | naziv ZEV-a ispod „ZEV upravnik”; u suženom režimu skriven |
| korisnik sa dva ZEV-a (super admin koji je i vlasnik) | chip u gornjoj traci vidljiv i na 375 |
| gornja traka na 375 | dugme „Meni” sa ikonom, mjereno ≥ 44px; „Zatvori” ≥ 44px |
| meni naloga | bez `role="menu"`; Tab prolazi kroz stavke; Escape zatvara i vraća fokus na avatar; tekst uloga 13px |
| `/login` sa greškom, `/zaboravljena-lozinka` nakon slanja, `/reset-lozinka/x` sa nevažećim linkom | poruka iznad kartice (ne u njoj), `role="alert"` za grešku; fusnota 13px; prekidač lozinke vidljiv i pokazuje radnju |
| `/admin` (Super admin) | „Generiši” i „Kopiraj” kao standardna dugmad |

- **Mjerenje u pregledu:** `getBoundingClientRect` za dugmad menija (≥ 44×44) i provjera da u `nav-shell.tsx`, `auth-shell.tsx` i `password-field.tsx` nema `text-xs` / `text-[11px]` (grep).
- **Nakon pregleda:** `npm run db:reset && npm run db:seed`, brisanje skripti za pregled.

## 5. Isporuka
- Jedan commit, **minor → 2.45.0** (uz potvrdu), sa `CHANGELOG.md` (Izmijenjeno / Ispravljeno) i statusom F2 u `Plans/design-review-plan.md` („ISPORUČENO u v2.45.0”).
- **Bez migracije**, pa deploy ne traži ručni korak.
- **Implementacija:** Sonnet po planu, Opus pregleda (odluka korisnika 2026-10-25).

## 6. Rizici
- **Aktivna stavka po prefiksu:** ruta koja počinje kao druga stavka, a nije njena podstranica (npr. `/fakture-xyz`), ne smije se poklopiti. Zato se poredi sa `href + "/"`, ne sa golim prefiksom; test to pokriva.
- **Uklanjanje `role="menu"`:** čitači ekrana više neće najavljivati „meni”. To je namjerno; najavljuje se dugme sa `aria-expanded`.
- **Preseljenje `Flash`-a na prijavi:** poruka je sada iznad kartice. Na 375 mora ostati vidljiva bez skrolovanja (provjera u pregledu).
- **Naziv ZEV-a:** dug naziv se skraćuje (`truncate`), a pun naziv je u `title`.

## 7. Otvoreno
- Ništa otvoreno (verzija i način implementacije odlučeni 2026-10-25).
