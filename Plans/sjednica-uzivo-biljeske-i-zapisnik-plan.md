# Sjednica uživo: bilješke, zaključci i zapisnik — implementacioni plan

**Status: ISPORUČENO u v2.54.0 (nije commitovano) — odobreno 2026-10-26, minor (sa migracijom).** Implementira Sonnet po planu, pregleda Opus. Korisnik je prihvatio preporuke §7: **P-B1 (b)** zasebni unosi Bilješka/Zaključak · **P-B2 (b)** pišu predsjednik i računovođa · **P-B3 (a)** teme van dnevnog reda samo zapis, bez glasanja · **P-B4 (b)** izbor zapisničara na sjednici (polje `Meeting.minutesTakerId` u istoj migraciji), ime ide uz potpis · **P-B5 (a)** ispravke do finalizacije zapisnika · **P-B6** minor 2.54.0.

Korisnik je 2026-10-26 tražio: *„osoba koja vodi sjednicu uživo može pisati zaključke i sve ostalo što je bitno da se zapiše tokom sjednice uživo, te da te bilješke budu uključene u zapisnik. Ovo se može odnositi na teme koje nisu dio agende, ili koje su dio tačke dnevnog reda pod ‚Razno’.”* Plan je izrađen čitanjem stvarnog koda (v2.53.0). Nijedan red koda još nije napisan. Prijedlog verzije: **minor → 2.54.0**, uz potvrdu prije upisa.

**Cilj:** ono što se na sjednici kaže i zaključi zapisuje se **u trenutku**, na telefonu, uz tačku dnevnog reda na koju se odnosi (ili kao tema van dnevnog reda), i bez prepisivanja ulazi u nacrt i konačni zapisnik. Poslije sjednice, a prije finalizacije zapisnika, bilješke se mogu ispraviti na desktopu.

---

## 1. Zatečeno stanje (provjereno u kodu)

| # | Stanje | Gdje |
|---|---|---|
| 1 | `Meeting.discussionNotes` (jedan tekst) postoji u šemi i zapisnik ga štampa kao „Tok rasprave”, ali **nijedan ekran ga ne upisuje**. | `prisma/schema.prisma` `Meeting`; `documents.ts` `generateMinutesPdf` (`:659-661`) |
| 2 | `AgendaItem.note` je opis tačke unaprijed (upisuje se pri dodavanju tačke), prikazuje se uživo ispod naslova tačke; nije bilješka sa sjednice. | `meetings.ts:637`; `agenda-voting.tsx:142` |
| 3 | Režim uživo (`/uzivo/[id]`): tabovi „Prozivka” i „Dnevni red”; panel tačke ima glasanje ili „samo diskusija”. Nema mjesta za pisanje. Ekran se osvježava svakih 10 s kroz `router.refresh()`, koji čuva stanje klijentskih komponenti (`live-refresh.tsx`). | `src/app/uzivo/[meetingId]/page.tsx`; `agenda-voting.tsx`; `live-refresh.tsx` |
| 4 | Pravo na režim uživo: `PRESIDENT` i `ACCOUNTANT` (ruta i servisi). | `uzivo/[meetingId]/page.tsx` (`requireActor("PRESIDENT","ACCOUNTANT")`) |
| 5 | Zapisnik (`generateMinutesPdf`): zaglavlje uvijek „ZAPISNIK SA SJEDNICE **SKUPŠTINE**” (i za upravni odbor), prisutni, dnevni red kao lista naslova, pa svi rezultati prijedloga u jednom bloku (ne po tački), pa „Tok rasprave”, pa potpisi sa praznim „Zapisničar: ____”. | `documents.ts:625-677` |
| 6 | Nacrt zapisnika se generiše dugmetom na detalju sjednice; konačni pri prelasku u „Zapisnik finalizovan” (od F6 iza potvrde). Konačan dokument je nepromjenjiv (`storeDocument`, verzije). | `skupstina/[id]/page.tsx`; `meetingNextStep.ts` |
| 7 | Tačka „Razno” postoji u seed-u kao obična tačka bez prijedloga. | `prisma/seed.ts:321` |

---

## 2. Izmjene

### 2.1 Model podataka — nova tabela `MeetingNote` (**migracija**)

```
MeetingNote
  id, zevId, meetingId
  agendaItemId   String?   // null = tema van dnevnog reda
  topic          String?   // naslov teme van dnevnog reda (obavezan kad je agendaItemId null)
  kind           NOTE | CONCLUSION   // „Bilješka” / „Zaključak”
  text           String
  position       Int       // redoslijed unutar tačke/teme
  version        Int       // optimistička zaštita: dva uređaja ne prepisuju jedan drugog
  createdById, updatedById, createdAt, updatedAt
```

- Bilješke se mogu mijenjati i brisati **dok zapisnik nije finalizovan**; svaka promjena ide u audit (`meeting.note.create|update|delete`, sa tekstom prije i poslije), pa je trag potpun iako tabela nije append-only. Poslije `MINUTES_FINALIZED` servis odbija svaku izmjenu.
- Akcije se registruju u `src/lib/activity/catalog.ts` i `auditAction.*`.
- `Meeting.discussionNotes` ostaje za stare sjednice (zapisnik ga i dalje štampa ako postoji), novi UI ga ne koristi.
- Migracija: `node scripts/migrate.mjs create meeting_notes`, SQL ručno; na produkciji se pokreće **prije** deploy-a (`MIGRATE_DATABASE_URL=… node scripts/migrate.mjs apply`). Povlačenje je samo naprijed.

### 2.2 Servis — `src/server/services/meetingNotes.ts`

- `listMeetingNotes(actor, meetingId)`, `addMeetingNote`, `updateMeetingNote(…, expectedVersion)`, `deleteMeetingNote`, `moveMeetingNote` (gore/dolje).
- Guard: `requireRole(actor, "PRESIDENT", "ACCOUNTANT")` (isto kao uživo; vidi P-B2), `zevId` u svakom upitu, tačka mora pripadati sjednici.
- Pravila: tekst nije prazan; tema van dnevnog reda ima naslov; izmjena sa zastarjelim `version` vraća poruku „Bilješku je u međuvremenu promijenio {ime} — osvježite” umjesto tihog prepisivanja; sjednica u statusu `MINUTES_FINALIZED`/`ARCHIVED` → greška.
- Bilješke se mogu pisati od statusa „Zakazana” (priprema) do „Odluke evidentirane”.

### 2.3 Režim uživo — pisanje u trenutku

- **Panel tačke** (`AgendaItemPanel`, i kad tačka ima prijedlog i kad je „samo diskusija”) dobija karticu **„Bilješke i zaključci”** ispod glasanja:
  - lista postojećih (zaključci prvi, numerisani „Zaključak 1, 2…”, zatim bilješke), svaka sa „Uredi” i „Obriši” (brisanje iza `ConfirmAction` `caution`);
  - forma: `SegmentedAction` **Bilješka / Zaključak**, `textarea` (`inputCls`, 4 reda, raste), dugme **„Sačuvaj”** (`tonal` — `primary` u panelu ostaje radnja glasanja, pravilo jednog `primary`).
  - Forma je klijentska komponenta: tekst koji se kuca **preživljava automatsko osvježavanje** (isti razlog kao pretraga u prozivci) i čuva se kao nacrt u `localStorage` po sjednici i tački (u try/catch), pa ga ne briše ni slučajno zatvoren tab ili gubitak mreže; poslije uspješnog čuvanja nacrt se briše.
- **„Van dnevnog reda”**: posljednji čip u nizu tačaka. Panel ima polje „Tema” + istu formu; svaka tema je zaseban blok sa svojim bilješkama i zaključcima. Uz naslov stoji 13 px napomena: *„Teme van dnevnog reda se samo zapisuju; o njima se na ovoj sjednici ne glasa.”* (P-B3).
- Tačka **„Razno”** je obična tačka — bilješke se pišu uz nju bez posebne logike.
- **Treći tab „Zapisnik”**: pregled svega što će ući u zapisnik, redom tačaka (rezultati glasanja + zaključci + bilješke po tački, pa teme van dnevnog reda), sa brojem bilješki po tački i dugmetom **„Nacrt zapisnika (PDF)”** (`secondary`). Ovdje predsjednik prije kraja sjednice vidi da li je nešto ostalo nezapisano.

### 2.4 Detalj sjednice (desktop) — ispravke poslije sjednice

- Nova kartica **„Bilješke i zaključci”** (vidi je uprava): isti sadržaj kao tab „Zapisnik”, sa uređivanjem i promjenom redoslijeda, sve do finalizacije. Poslije finalizacije samo za čitanje, uz rečenicu „Zapisnik je finalizovan — bilješke se više ne mijenjaju.”
- Panel „Sljedeći korak” (F6) na koraku **„Finalizuj zapisnik”** dobija preduslov ✓/⚠: „Zaključaka: N, bilješki: M” i ⚠ „Tačka X nema nijedan zaključak” za tačke bez prijedloga (samo upozorenje — diskusija bez zaključka je dozvoljena).

### 2.5 Zapisnik (PDF) — novi raspored

Preko postojećih `pdfSection` / `pdfTable` helpera, sa paginacijom:

1. Zaglavlje: **„ZAPISNIK SA SJEDNICE SKUPŠTINE”** ili **„… UPRAVNOG ODBORA”** po `meeting.body` (ispravka postojeće greške).
2. Sjednica, vrijeme, mjesto; prisutni (kao danas, po glasačkom subjektu).
3. Dnevni red (lista).
4. **Tok sjednice po tačkama:** za svaku tačku — naslov; rezultat glasanja prijedloga **te tačke** (premješteno iz zajedničkog bloka); **Zaključci** (numerisani); **Bilješke** (redom). Tačka bez ičega: „Bez zapisanih zaključaka.”
5. **Van dnevnog reda:** po temi naslov, zaključci, bilješke, uz rečenicu da se o njima nije odlučivalo.
6. Stari „Tok rasprave” (`discussionNotes`) samo ako postoji.
7. Potpisi: „Predsjednik ZEV” i **„Zapisničar: {ime}”** ako je zapisničar određen (P-B4), inače prazna linija kao danas.

Nacrt i konačni zapisnik koriste isti kod; konačni nastaje kao i do sada pri prelasku u „Zapisnik finalizovan”.

### 2.6 Rječnik i DS

- Nove ugniježđene grupe u `sr-Latn.ts` i `en.ts`: `meetingNotes.*` (labele, potvrde, greške), `live.notes.*`, `minutes.*` (naslovi sekcija PDF-a).
- DS: bez novih primitiva — `Card`, `SegmentedAction`, `inputCls`, `ConfirmAction`, `PreconditionList`, `Flash`. Ako se pokaže potreba za novim obrascem, implementacija staje i pita.

---

## 3. Testovi

- **Servis:** guardovi (vlasnik odbijen, drugi ZEV odbijen), tačka iz druge sjednice odbijena, tema van dnevnog reda bez naslova odbijena, zastarjeli `version` odbijen sa porukom, izmjena poslije finalizacije odbijena, audit zapis za create/update/delete sa tekstom prije/poslije, redoslijed (`moveMeetingNote`).
- **Zapisnik:** izvučen tekst PDF-a (kao postojeći testovi dokumenata) sadrži zaključke ispod prave tačke, rezultat prijedloga ispod njegove tačke, sekciju „Van dnevnog reda”, naslov „UPRAVNOG ODBORA” za sjednicu UO, ime zapisničara kad je određen.
- **„Sljedeći korak”:** preduslov sa brojem zaključaka/bilješki i ⚠ za tačku bez zaključka (čista funkcija `meetingNextStep`).

## 4. Provjera

- Pipeline: `npm run typecheck && npm run lint && npm test && npm run build` (poznate 3 greške u `tests/env.test.ts` i 1 upozorenje u `ui.tsx`).
- **Živo, 375 i 1440:** sjednica uživo — zapisati bilješku i zaključak uz tačku sa prijedlogom, uz „Razno” i kao temu van dnevnog reda; tekst u polju preživljava automatsko osvježavanje (sačekati 2–3 osvježavanja dok se kuca); zatvoriti i ponovo otvoriti tab (nacrt ostaje); dva prozora istovremeno uređuju istu bilješku (drugi dobija poruku, ne prepisuje); tab „Zapisnik”; nacrt PDF-a (pregled renderovane strane); finalizacija → bilješke zaključane.
- Nakon provjere: `npm run db:reset && npm run db:seed`, brisanje skripti i test dokumenata.

## 5. Isporuka

- Jedan commit, **minor → 2.54.0** (uz potvrdu), `CHANGELOG.md` sa napomenom **„Migracija: da — pokrenuti na produkciji prije deploy-a”**.
- Implementacija po dogovoru: Sonnet po planu, Opus pregleda.

## 6. Rizici

- **Gubitak teksta na telefonu u sali** (osvježavanje, mreža, zatvoren tab). Mjera: klijentska forma koja preživljava `router.refresh()` + nacrt u `localStorage` + jasna poruka kad čuvanje ne uspije (tekst ostaje u polju).
- **Dva uređaja** (predsjednik i računovođa) uređuju istu bilješku. Mjera: `version` i poruka umjesto tihog prepisivanja.
- **Pravna težina zapisnika:** bilješke postaju dio dokumenta koji se finalizuje. Mjera: zaključavanje poslije finalizacije, audit svake izmjene prije toga, i jasna razlika „zaključak” / „bilješka” u PDF-u.
- **Teme van dnevnog reda** ne smiju izgledati kao odluke. Mjera: odvojena sekcija i rečenica da se o njima nije glasalo; nema glasanja ni prijedloga iz te sekcije.

## 7. Otvorena pitanja za korisnika

| # | Pitanje | Opcije | Preporuka |
|---|---|---|---|
| **P-B1** | Oblik bilješki | (a) jedan slobodan tekst po tački + jedan za „van dnevnog reda”; (b) **zasebni unosi** sa vrstom „Bilješka” / „Zaključak”, redoslijedom i uređivanjem | **(b)** — zaključci se u zapisniku numerišu i odvajaju od bilješki, a dva uređaja se manje sudaraju |
| **P-B2** | Ko smije pisati bilješke | (a) samo predsjednik; (b) predsjednik i računovođa (isti krug kao režim uživo); (c) i vlasnik određen kao zapisničar | **(b)** sada; (c) uz P-B4 ako zapisničar često nije u upravi |
| **P-B3** | Teme van dnevnog reda | (a) samo zapis pod „Van dnevnog reda”, **bez glasanja**; (b) dozvoliti dodavanje nove tačke dnevnog reda tokom sjednice | **(a)** — o temi koja nije na dnevnom redu skupština ne odlučuje; nova tačka ide na sljedeću sjednicu |
| **P-B4** | Zapisničar u zapisniku | (a) prazna linija kao danas; (b) izbor lica „Zapisničar” na sjednici (iz evidencije), ime se štampa uz potpis | **(b)** |
| **P-B5** | Ispravke poslije sjednice | (a) do finalizacije zapisnika, na detalju sjednice; (b) samo tokom režima uživo | **(a)** |
| **P-B6** | Verzija | minor → 2.54.0 (sa migracijom) | **minor** |
