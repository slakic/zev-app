# Pristupačni prikaz (veći tekst i jednostavan prikaz) — prijedlog plana

**Status: faza A ISPORUČENA u v2.66.0; faza B (jednostavan prikaz) čeka mockupe i test sa korisnikom.** Korisnik je prihvatio sve preporuke: D-P1 A (baza), D-P2 A (jednokratno pitanje + profil), D-P3 B („A+” samo za P1), D-P4 A (sve prijavljene rute, P1 uvijek na ekranima prijave), D-P5 A (faza A sada, P2 nakon mockupa i testa). Tražio korisnik 2026-11-15: tipičan predsjednik ZEV-a je penzioner u šezdesetim, slabo vješt sa računarom. To je većina korisnika, ali ne svi, pa prilagođavanja treba da budu **opciona i da se uključuju/isključuju u profilu**.

Ovo je **dopuna dizajn sistema** (`Plans/design-system.md`), ne izmjena jedne stranice. Zato ide kao plan sa opcijama, prema `CLAUDE.md`. Tvrdnje o kodu su provjerene na v2.65.1.

**Cilj:** korisnik kome je današnji prikaz sitan i gust može jednim izborom dobiti krupniji i mirniji prikaz. Prikaz za ostale (računovođa, mlađi predsjednik) ostaje nepromijenjen.

---

## 1. Šta NE treba da bude opciono

Dio preporuka za starije korisnike pomaže svima i ne smije zavisiti od prekidača. Ide kao obična izmjena sistema, nezavisno od ovog plana:

- **Jezik bez žargona i dugmad sa glagolom** („Pošalji poziv vlasnicima”, ne „Potvrdi”). To je revizija rječnika `sr-Latn.ts`.
- **Poruke o grešci kažu šta da se uradi**, ne šta je pošlo naopako.
- **Potvrda radnje ostaje vidljiva** dok je korisnik ne skloni ili ne ode sa stranice.

Ako bi ovo bilo opciono, korisnik kome je najpotrebnije ne bi ni znao da postoji.

---

## 2. Zatečeno stanje (provjereno u kodu)

| # | Šta | Gdje |
|---|---|---|
| 1 | Tailwind v4 gradi `text-sm`, `text-base` … kao `font-size: var(--text-sm)`, a razmake kao `calc(var(--spacing) * n)`. Boje su `var(--color-slate-500)` itd. **Sve se to može promijeniti CSS varijablom pod jednim selektorom**, bez diranja komponenti | provjereno u buildovanom CSS-u `.next/static/css/*.css` |
| 2 | Proizvoljne veličine su **tvrdo upisane u px** i ne reaguju na varijable: `text-[13px]` ×238, `text-[15px]` ×56, `text-[11px]` ×2, `text-[16px]` ×1, `min-h-[28px]` ×2, `min-h-[44px]` ×10 | `grep` po `src/` (63 fajla sa `text-[13px]`) |
| 3 | Pomoćni tekst je `text-slate-500` direktno (212 pojava), ne preko tokena `ink-muted` | `src/` |
| 4 | Korisnik nema nijednu sačuvanu postavku prikaza. Jedina „preferencija” je suženi meni u `localStorage` (`zev-nav-collapsed`), dakle po uređaju, ne po osobi | `nav-shell.tsx:28, 100-110`; `model User` u `schema.prisma:24` |
| 5 | Lične postavke žive u „Moji podaci” (`/podesavanja`, tab `moji`), dostupne iz menija naloga | `podesavanja/page.tsx:215, 370`; `AccountMenu` |
| 6 | `Table` ispod `md` već crta svaki red kao karticu (`buildTableCss`), a `TaskList` („Za Vas sada”) je prva kartica početne | `ui.tsx`; design-system §4 |
| 7 | Rute van `(app)` školjke koje predsjednik koristi: `uzivo` (sjednica uživo), `glasanje`, `onboarding` | `src/app/` |

---

## 3. Prijedlog: dva nezavisna prekidača

Jedan čovjek može trebati krupnija slova, a da mu meni ne smeta, ili obrnuto. Zato su to dvije postavke, ne jedan „režim za starije”. Taj naziv i ne treba koristiti: niko ne želi da uključi „prikaz za starije”.

### P1. „Veći tekst i dugmad” (čitljivost)

Mehanička izmjena, mali rizik, sva logika je u CSS-u. Kad je uključeno, na `<html>` stoji `data-text="large"`:

```css
:root[data-text="large"] {
  --text-sm: 1rem;            /* 14 → 16px: tijelo, dugmad, labele */
  --text-base: 1.125rem;      /* 16 → 18px */
  --text-xs: 0.875rem;        /* 12 → 14px: zaglavlja tabela */
  --text-hint: 0.9375rem;     /* 13 → 15px (novi token, v. ispod) */
  --text-lead: 1.0625rem;     /* 15 → 17px (novi token) */
  --color-slate-500: #475569; /* pomoćni tekst za nijansu tamniji (slate-600) */
  --color-slate-400: #64748b;
}
```

- **Preduslov (refaktor bez vizuelne promjene):** `text-[13px]` → novi token `text-hint`, `text-[15px]` → `text-lead`, `text-[11px]` → `text-2xs`, i `min-h-[44px]`/`[28px]` → `min-h-11`/`min-h-7`. Tokeni se dodaju u `@theme` sa **istim** vrijednostima kao danas, pa se podrazumijevani prikaz ne mijenja ni za piksel. Ovo je dobro i bez P1, jer sistem dobija imenovane veličine umjesto 300 proizvoljnih.
- **U uključenom režimu:** radnje u redu tabele su najmanje 44px i na desktopu; `uppercase tracking-wider` na zaglavljima tabela i labelama `Stat` prelazi u običan tekst (`normal-case tracking-normal`).
- **Raspored:** `max-w-[1440px]` ostaje. Promjena `--spacing` širi **sve** što je na Tailwind skali, pa i sidebar `w-60` (240 → 288px), `gap-*` i `p-*`. **Odluka u fazi A: `--spacing` se ne dira**, a uvećavaju se samo mete (`large:min-h-11` na `btnBase` i `rowActionBase`). Gušće tabele mogu dobiti horizontalni skrol unutar `Table` (već ga ima), nikad stranica.
- **PDF i štampa** se ne mijenjaju.

### P2. „Jednostavan prikaz” (manje stvari na ekranu)

Ovo je promjena ponašanja. Za nju trebaju mockupi i bar jedan test sa stvarnim predsjednikom prije isporuke (faza B). Kad je uključeno, stoji `data-layout="simple"`:

- **Meni je uvijek proširen, sa tekstom uz svaku ikonu.** Prekidač za suženje se ne prikazuje.
- **Početna je samo „Za Vas sada”** (`TaskList`) plus nekoliko krupnih ulaza sa glagolom („Sazovi sjednicu”, „Pošalji fakture”, „Pogledaj ko duguje”). Brojke (`Stat`) se sklanjaju niže.
- **Tabele se uvijek prikazuju kao kartice** (postojeći `buildTableCss`, koji danas važi samo ispod `md`), sa jednom radnjom po kartici.
- **Bez radnji skrivenih iza „⋯”, hover menija i sužene trake sa ikonama.**
- Meni po ulozi (`buildTenantNav`) dobija skraćenu varijantu, a ostalo ide pod „Sve stranice”. **Tačan sadržaj je otvoreno pitanje** i rješava se mockupom, ne ovim planom.

---

## 4. Odluke za korisnika

### D-P1. Gdje se čuva postavka

**Odluka (2026-11-15): A (baza, po osobi).**
- **A (preporuka): na korisniku u bazi** (`User.uiTextLarge`, `User.uiLayoutSimple`, oba `Boolean @default(false)`). Važi na svakom uređaju. To je bitno, jer ovaj korisnik često radi sa računara djeteta ili sa telefona.
- B: `localStorage`, kao suženi meni. Bez migracije, ali postavka se gubi na novom uređaju ili u drugom pregledaču, a korisnik neće znati zašto.

Postavka je po osobi, ne po ZEV-u: isti čovjek ne čita bolje u drugom ZEV-u.

### D-P2. Ko i kada uključuje

**Odluka (2026-11-15): A (jednom pitati, pa profil i meni naloga).**
Postavka koja postoji samo u profilu je za ovog korisnika **nevidljiva**, jer on ne ide u „Moji podaci” da istražuje. Zato:
- **A (preporuka): jednom pitati, pa ostaviti u profilu.** Pri prvoj prijavi (ili prvom ulasku nakon isporuke) prikazati jedan ekran „Kako Vam je lakše čitati?” sa dva primjera jedan pored drugog (`ChoiceCards`). Izbor se kasnije mijenja u „Moji podaci” i u meniju naloga. Čuva se `User.uiPrefsAskedAt`, da se ne pita ponovo.
- B: samo u profilu, podrazumijevano isključeno. Najjednostavnije, ali većina korisnika za koje se ovo pravi ga neće naći.
- C: podrazumijevano uključeno za ulogu `PRESIDENT`, uz mogućnost isključivanja. Računovođa koji je i predsjednik dobio bi krupan prikaz koji ne želi, a kriterij „uloga = godine” je grub.

### D-P3. Brzi prekidač „A+” u gornjoj traci

**Odluka (2026-11-15): B (da, samo za P1).**
- A: ne. Postavka se mijenja rijetko, a meni naloga i profil su dovoljni.
- **B (preporuka): da, samo za P1**, kao malo dugme `secondary` pored avatara. Korisnik koga muči sitan tekst odmah vidi rješenje. Bez dodatne boje, bez `primary`.

### D-P4. Na koje rute se primjenjuje

**Odluka (2026-11-15): A (sve prijavljene rute; P1 uvijek na ekranima prijave).**
- **A (preporuka): na sve prijavljene ekrane**, uključujući `uzivo`, `glasanje` i `onboarding`. Atribut se postavlja na `<html>` u root `layout.tsx` iz sesije. Te rute su već dinamičke zbog prijave, pa nema troška.
- B: samo unutar `(app)` školjke. Sjednica uživo i glasanje, gdje je čitljivost možda najbitnija, ostale bi sitne.

Za prijavu, zaboravljenu lozinku i reset (prije nego se zna ko je korisnik) prijedlog je da P1 važi **uvijek** na tim ekranima. Imaju jednu karticu i ništa ne gube od krupnijeg teksta.

### D-P5. Redoslijed isporuke

**Odluka (2026-11-15): A (faza A sada, P2 kasnije).**
- **A (preporuka): faza A = refaktor tokena + P1 + postavka (D-P1/D-P2), faza B = P2 nakon mockupa i jednog posmatranog testa.** P1 je mehanički i brzo daje korist. P2 zahtijeva dizajn koji se ne smije improvizovati.
- B: obje odjednom. Duže čekanje, a P2 bez testa sa korisnikom je pogađanje.

---

## 5. Faza A — izmjene

1. **Tokeni** (`globals.css` `@theme`): `--text-2xs: 11px`, `--text-hint: 13px`, `--text-lead: 15px` (sa `--line-height` parovima). Codemod `text-[13px]` → `text-hint` itd. u svih 63+ fajlova, `min-h-[44px]` → `min-h-11`. Provjera: screenshot ključnih ekrana prije i poslije, bez razlike.
2. **Blok `:root[data-text="large"]`** iz §3 P1 u `globals.css`, plus pravila za zaglavlja tabela, `Stat` labelu i `rowActionBase`.
3. **Migracija:** `User.uiTextLarge`, `User.uiLayoutSimple` (polje postoji, UI tek u fazi B), `User.uiPrefsAskedAt DateTime?`.
4. **Servis** `src/server/services/uiPreferences.ts`: `getUiPreferences(actor)`, `setUiPreferences(actor, {...})` uz `requireAnyUser`, uvijek samo za sopstveni nalog. Bez audit unosa, jer je to lična postavka prikaza, ne poslovna radnja (kao suženi meni).
5. **Root `layout.tsx`:** čita postavku iz sesije i upisuje `data-text` na `<html>`.
6. **UI:** kartica „Prikaz” u „Moji podaci” (`ChoiceCards`), jednokratno pitanje kao kartica na vrhu školjke ZEV-a (D-P2 A) i „A+” u gornjoj traci svih školjki (D-P3 B). **Odstupanje:** zasebna stavka u `AccountMenu` nije dodata, jer bi duplirala „A+” koje stoji odmah pored avatara. Tekstovi pod `settingsPage.display.*`.
7. **Dizajn sistem:** `design-system.md` dobija sekciju „Pristupačni prikaz”. Pravilo „ništa ispod 13px” se dopunjuje: u velikom režimu ništa ispod 15px. Tipografska tabela navodi obje vrijednosti.
8. **Testovi:** servis (samo sopstveni nalog, podrazumijevane vrijednosti), Playwright smoke sa uključenim P1 na početnoj, fakturama i sjednici uživo, na 375px i 1280px: bez horizontalnog skrola stranice.

**Verzija:** prijedlog **minor**, uz potvrdu prije upisa.

---

## 6. Šta plan namjerno ne radi
- Ne mijenja font (Roboto ostaje) ni paletu, osim tamnijeg pomoćnog teksta u velikom režimu.
- Ne uvodi „tamni režim” niti proizvoljno podešavanje veličine klizačem. Dvije provjerene veličine su lakše za održavanje i testiranje od deset.
- Ne zamjenjuje posmatranje stvarnih korisnika. Preporuka je da se prije faze B 3–5 predsjednika posmatra dok rade jedan zadatak („pošaljite poziv za sjednicu”).
