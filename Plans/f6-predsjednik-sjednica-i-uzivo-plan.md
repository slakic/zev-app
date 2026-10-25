# F6 — Predsjednik: sjednica, režim uživo i početna — implementacioni plan

**Status: ISPORUČENO u v2.47.0 (nije commitovano).** Odobreno 2026-10-25, minor → 2.47.0; implementirao Sonnet po planu, pregleda Opus. Korisnik je prihvatio preporuke §7:
- **P-Q2: (b)** — „Odobreno” uz obavezan izbor odluke ili „u okviru ovlašćenja”; odobrenje prije usvojene odluke je upozorenje na početnoj. F6.4 se radi.
- **P-Q3: da** — P10 se ukida; kartica „Prisustvo” postaje sažetak + link na prozivku.
- **P-Q4: da** — režim uživo za upravni odbor ostaje (kvorum po članu); P3 u `live-meeting-mode-plan.md` se dopunjava.
- **P-Q5: (a)** — bez zakonskih rokova u panelu.
- **F6-Q1: (a)** — traka uživo pokazuje kvorum prisustva, uz napomenu o e-glasovima.
- **F6-Q2: (a)** — pregled „prošao rok” = datum prošao (posljednjih 90 dana) i nema vezane prijave.
- **F6-Q3:** minor → 2.47.0.

Fazu F6 iz `Plans/design-review-plan.md` §6 korisnik je pokrenuo 2026-10-25 („Proceed” poslije isporuke F3). Plan je izrađen čitanjem stvarnog koda (v2.46.0).

Faza koristi odluke o dizajn sistemu **D1** (obrazac „Za Vas sada”, opcija A) i **D2** (obrazac „Sljedeći korak”, opcija A — kompozicija `Card` + `StatusTimeline` + lista preduslova + jedno dugme), obje od 2026-10-25.

**Cilj faze:** predsjednik (laik) na svakom koraku sjednice zna **gdje je, šta je sljedeće i šta mora biti gotovo prije toga**; u sali u svakom trenutku vidi **ima li kvorum**; na početnoj prvo vidi **šta čeka njegovu radnju**, a tek onda saldo.

Faza rješava nalaze iz pregleda:
- V20 / P-N01, P-N03 (nema sljedećeg koraka; tri `primary` u istom pogledu);
- V21 / P-N04 (tabela prijedloga bez roka i „glasalo X/Y”);
- V22 / P-N12, P-N14 (traka uživo broji neoznačene kao odsutne, nema kvoruma);
- V23 / P-N16 (početna predsjednika: 8 pokazatelja prije ijednog zadatka);
- V24 / P-N06 (izvršenje bez veze sa odlukom) — **samo ako P-Q2 = (b)**;
- P-N13 (uživo za upravni odbor) — po odgovoru na P-Q4;
- P-N15 (dupla kartica prisustva) — po odgovoru na P-Q3.

**Granice faze:**
- **Bez migracije.** Veza prijava → odluka koristi postojeću kolonu `MaintenanceIssue.approvalProposalId` (u šemi postoji, UI je ne puni).
- Nema novih boja, veličina teksta ni težina dugmadi. `PreconditionList` (`src/components/precondition-list.tsx`, iz FR) se ponovo koristi; nema novog primitiva.
- Početna **računovođe** se ne mijenja (to je F5). Mijenja se samo pogled korisnika koji ima ulogu predsjednika.
- Panel ne tvrdi zakonske rokove (P-Q5): samo datumi i brojevi koje sistem već ima.

---

## 1. Zatečeno stanje (provjereno u kodu)

| # | Stanje | Gdje |
|---|---|---|
| 1 | Sljedeći korak sjednice je dugme u `PageHeader` `actions`, sa četiri grane (potvrda zatvaranja, potvrda poziva, blokirano otvaranje kao amber kutija, potvrda otvaranja) i običnim `SubmitBtn` (`primary`) za ostale statuse. Ne piše šta korak radi ni šta mora biti gotovo. | `skupstina/[id]/page.tsx:191-201` (`NEXT_STATUS`), `:242-356` |
| 2 | `StatusTimeline` stoji odvojeno ispod zaglavlja. | `:361-364` |
| 3 | Tri `primary` u pogledu: dugme koraka u zaglavlju (za statuse bez potvrde), „Dodaj” u dnevnom redu, „Evidentiraj” u prisustvu. | `:353`, `:411`, `:595` |
| 4 | Tabela prijedloga ima 4 kolone (Šifra, Naziv, Verzija, Status); nema roka glasanja ni „glasalo X/Y”. `getMeeting` ne učitava birače ni glasove. | `:25-30`, `:416-433`; `meetings.ts:45-56` |
| 5 | Kartica „Prisustvo (za sjednicu uživo)” — `select` svih lica + checkbox + `primary` „Evidentiraj” (odluka P10 ju je zadržala). | `:569-598` |
| 6 | „Dokumenti sjednice”: napomena `text-xs text-slate-500`. | `:606` |
| 7 | **Već riješeno u F1/FR/listiću** (ne dira se, samo se seli u panel): potvrda slanja poziva sa brojem primalaca, potvrda otvaranja sa listićima i dnevnim limitom, potvrda zatvaranja sa spiskom prijedloga, prijedlog iz tačke dnevnog reda, vezivanje nevezanog prijedloga. | `:242-356`, `:367-414` |
| 8 | Strana efekta koraka: `VOTING_OPEN` otvara nacrte i izdaje listiće (servis); `VOTING_CLOSED` zatvara otvorene prijedloge (servis); `INVITATIONS_PREPARED` pravi PDF poziva, `INVITATIONS_SENT` šalje e-mailove, `MINUTES_FINALIZED` pravi **konačan** zapisnik (stranica). `RESULTS_REVIEW`, `DECISION_RECORDED`, `ARCHIVED` mijenjaju samo status. | `meetings.ts` `advanceMeetingStatus` (`:370-470`); `skupstina/[id]/page.tsx:104-134` |
| 9 | Traka uživo: `Prisutno N · Odsutno M`, `text-lg`, bez kvoruma. `absentCount = voters.length − presentCount`, dakle **neoznačeni se broje kao odsutni**. | `roll-call.tsx:68-76`; `meetings.ts:191, 280` |
| 10 | Odobreni plan uživo (§3.1) traži `Prisutno · Odsutno · Kvorum X %`, brojeve `text-2xl`, prema pravilu aktivne tačke ili prve tačke. | `live-meeting-mode-plan.md:220-231` |
| 11 | Ulaz u režim uživo se nudi za svaku sjednicu u statusima `SCHEDULED…VOTING_CLOSED`, uključujući **upravni odbor**; P3 ga je ograničio na skupštinu. | `skupstina/[id]/page.tsx:21-23, 237`; `live-meeting-mode-plan.md:15` |
| 12 | Početna predsjednika: 8 `Stat`-ova u dva reda, pa kartice „Prijedlozi na glasanju” (`text-xs` „glasalo X/Y”), „Predstojeće sjednice”, „Otvorene prijave”, „Neraspoređene uplate”, plan, pregledi (samo budući). Kartica registra (FR-Q4) stoji iznad svega. | `(app)/page.tsx:29-140` |
| 13 | Isti `ManagementDashboard` služi i računovođi. | `(app)/page.tsx:22-25` |
| 14 | Održavanje: `TRIAGED → AUTHORIZATION_REQUIRED → APPROVED` je slobodan prelaz; `transitionIssue` prima `approvalProposalId`, ali ga forma ne nudi i ništa ga ne provjerava. Hitni put (`markEmergency`) ide direktno u `APPROVED`, a ratifikacija je slobodan tekst. | `odrzavanje/[id]/page.tsx:37-49, 152-164`; `maintenance.ts:95-130, 131-175` |
| 15 | Plan: „Usvojen odlukom skupštine (datum)” je tekst, iako `approvedByProposalId` postoji. | `planovi/[id]/page.tsx:128` |
| 16 | `PlanItem` (pregledi, preventivno održavanje) nema status „obavljeno”; prijava održavanja može nositi `planItemId`. | `prisma/schema.prisma` `PlanItem`, `MaintenanceIssue.planItemId` |

---

## 2. Izmjene

### F6.1 Model sljedećeg koraka — nova čista funkcija `src/lib/meetingNextStep.ts`

Jedan izvor istine za panel sjednice (F6.2) i za stavku „Sjednica za N dana — sljedeći korak: …” na početnoj (F6.5).

- `meetingNextStep(input)` vraća `{ to, label, consequence, kind, preconditions[] }` ili `null` (arhivirana sjednica).
  - `kind`: `"plain"` (bez posljedice → `primary`), `"confirm"` (šalje poruke ili je nepovratno → `caution` okidač + `ConfirmAction`), `"blocked"` (servis bi odbio korak → bez dugmeta, samo ⚠ preduslovi).
  - `preconditions`: `{ ok: boolean; text: string; href?: string }[]` — isključivo činjenice iz podataka; ⚠ **ne blokira** dugme, osim kad servis blokira (`kind: "blocked"`).
- Ulaz je običan objekat (status, tijelo, datum sjednice, tačke sa brojem prijedloga, prijedlozi sa statusom/rokom/glasalo, broj primalaca sa/bez e-maila, rezultat `previewSessionVotingOpen`), pa se testira bez baze.
- `NEXT_STATUS` (labele) se seli iz stranice u ovaj modul, preko `t()`.

| Status sada | Sljedeći korak | Rečenica posljedice (prijedlog teksta) | Preduslovi (✓/⚠) | Dugme |
|---|---|---|---|---|
| Nacrt | Zakaži sjednicu | „Sjednica postaje zakazana. Niko ne dobija poruku; dnevni red se i dalje mijenja.” | ⚠ dnevni red je prazan; ⚠ datum sjednice je prošao | `primary` |
| Zakazana | Pripremi pozive (PDF) | „Nastaje PDF poziva u Dokumentima. Niko još ne dobija poruku.” | ✓/⚠ svaka tačka ima prijedlog ili je diskusija (⚠ navodi tačke bez prijedloga kao „biće diskusija”); ⚠ nevezan prijedlog (sa radnjom „Veži” u dnevnom redu) | `primary` |
| Pozivi pripremljeni | Pošalji pozive | postojeći tekst potvrde (broj primalaca, bez e-maila) | ✓ PDF poziva postoji; ⚠ N lica bez e-maila dobija PDF lično | `caution` + `ConfirmAction` (postojeći) |
| Pozivi poslati | Otvori glasanje | postojeći tekst potvrde (prijedlozi, listići, dnevni limit) | iz `previewSessionVotingOpen`: greške po prijedlogu kao ⚠ sa linkom; ako ih ima → `blocked` | `caution` + `ConfirmAction` (postojeći) ili bez dugmeta |
| Glasanje otvoreno | Zatvori glasanje | postojeći tekst potvrde (prijedlozi koji se zatvaraju) | po otvorenom prijedlogu: „P-2026-02: glasalo 3 od 5, rok 07.11.2026.” — ⚠ ako rok još traje ili kvorum nije postignut | `caution` + `ConfirmAction` (postojeći) |
| Glasanje zatvoreno | Pređi na provjeru rezultata | „Rezultati prijedloga ostaju kakvi jesu; sjednica prelazi na provjeru.” | ✓ svi prijedlozi zatvoreni (usvojeno X, odbijeno Y) | `primary` |
| Provjera rezultata | Odluke evidentirane | „Sjednica bilježi da su odluke evidentirane; zapisnik se još može mijenjati.” | ✓/⚠ svaki usvojeni prijedlog ima broj odluke (ako `decisionNumber` nije upisan → ⚠ sa linkom) | `primary` |
| Odluke evidentirane | Finalizuj zapisnik (PDF) | „Nastaje konačan zapisnik. Poslije toga se ne mijenja — ispravka je nova verzija.” | ✓ nacrt zapisnika generisan (ako postoji `MINUTES` nacrt) | `caution` + `ConfirmAction` (**novo**: nepovratno) |
| Zapisnik finalizovan | Arhiviraj | „Sjednica se premješta u arhivu; dokumenti ostaju dostupni.” | — | `primary` |

> Tekstovi u tabeli su prijedlog; konačni idu u rječnik (`meetingStep.*`, ugniježđeno) i u `en.ts`.

### F6.2 Detalj sjednice (`skupstina/[id]/page.tsx`) — panel „Sljedeći korak” (D2 A)

- **Panel** odmah ispod `PageHeader`/`Flash`, prvi sadržaj stranice: `Card title="Sljedeći korak"` sa
  1. postojećim `StatusTimeline` (premješten u panel; labela trenutnog koraka 13px, bez `slate-400` za sadržaj koji se čita — provjeriti `ui.tsx` `StatusTimeline` i, ako treba, ispraviti boju kao bugfix tokena, ne novu varijantu),
  2. rečenicom posljedice (`text-sm`),
  3. `PreconditionList` (ako ima preduslova),
  4. **jednim** dugmetom po `kind` (postojeće grane `ConfirmAction` se sele iz zaglavlja bez izmjene teksta).
- Vidi ga samo predsjednik; vlasnik i računovođa vide samo `StatusTimeline` (kao danas).
- **Zaglavlje** zadržava samo „Vodi sjednicu uživo” (`secondary`).
- **Jedan `primary` po regiji:** „Dodaj” tačku dnevnog reda → `tonal`; forma „Dodaj tačku” ostaje vidljiva (pravilo „lista prvo, forma iza `ToggleBtn`” je F8, P-R09).
- **Tabela prijedloga** dobija kolone **„Rok”** (`votingClosesAt`, `formatDateTime`, „—” bez roka) i **„Glasalo”** („3 od 5” dok je glasanje otvoreno ili zatvoreno; „—” u nacrtu). „Verzija” ide u `priority: "detail"`. `getMeeting` dobija agregat po prijedlogu (broj birača i broj važećih glasova) jednim upitom (`groupBy`), bez N+1.
- **„Dokumenti sjednice”:** napomena sa `text-xs` na `text-[13px] text-slate-600`.
- **Kartica „Prisustvo”** — po P-Q3:
  - (preporuka, ukinuti P10) postaje sažetak: „Prisutno N od M — evidentira se u režimu uživo” + `BtnLink secondary` „Otvori prozivku” (kad je uživo dostupan), tabela evidentiranih ostaje samo za čitanje; forma sa `select`-om se uklanja. `recordAttendance` ostaje u servisu (koristi ga uživo).
  - (ne) naslov „Naknadni unos prisustva”, dugme `tonal`.

### F6.3 Režim uživo — traka kvoruma po odobrenom planu (P-R08)

- **Servis:** `getLiveMeetingState` vraća `presentCount`, **`unmarkedCount`**, **`absentCount` = označeni kao odsutni** (ne više `voters − present`), i **`quorum`**:
  - pravilo: proposal aktivne tačke ako je ima, inače prvi prijedlog na dnevnom redu (otvoren → `ruleSnapshot`, nacrt → `votingRule`); bez prijedloga → `quorum: null` (traka tada ne pokazuje kvorum, nego „Nema prijedloga za glasanje”);
  - **ista formula kao rezultat**: iz `computeVotingResult` se izdvaja čista `quorumRequirement(rule, totals)` (`src/server/engines/voting.ts`), a `computeVotingResult` je poziva — bez druge formule. Traka računa `presenceQuorum(rule, prisutni subjekti)`: za `PERCENT_OF_OWNER_COUNT` „prisutno N, potrebno K”; za `PERCENT_OF_TOTAL_WEIGHT` težina prisutnih subjekata (po `weightMethod`) prema potrebnoj, sa `formatWeight`; za `NONE` „bez kvoruma”.
  - Imenilac je baza subjekata iz FR (`assemblyVotingSubjects` / `boardVotingBasis`), ista kao prozivka.
- **Traka (`roll-call.tsx`, obje kartice):** sticky, bez kartice (pravilo elevacije):
  `Prisutno N · Neoznačeno N · Odsutno N` (brojevi `text-2xl font-semibold tabular-nums`, labele 13px) i ispod `Kvorum: prisutno 4 od 5 · potrebno 3 — postignut` ili `… — nedostaje 2` (tekst, ne samo boja; ✓/⚠ kao u `PreconditionList`).
  - Traka se izdvaja u komponentu `LiveQuorumBar` (u `roll-call.tsx` ili novi `src/components/live-quorum-bar.tsx`) i renderuje se i na kartici „Dnevni red” (danas traka postoji samo u prozivci).
  - Napomena 13px ispod kvoruma, samo kad aktivni prijedlog prima e-glasove: „Elektronski glasovi se računaju u kvorum glasanja i kad osoba nije u sali” (F6-Q1).
- **Raspored:** sadržaj `/uzivo` na širokom ekranu `mx-auto max-w-[68ch]` (postojeća vrijednost iz DS §3.3), u `LiveShell`.
- **Upravni odbor** — po P-Q4:
  - (namjerno) ostaje; traka koristi `boardVotingBasis` (po članu) — već tako radi servis; `live-meeting-mode-plan.md` P3 se dopunjava napomenom;
  - (nije namjerno) dugme „Vodi sjednicu uživo” se ne prikazuje za `body = BOARD`, a ruta `/uzivo/[id]` za sjednicu UO preusmjerava na detalj sa porukom.

### F6.4 Veza odluka → izvršenje (P-R04) — samo ako P-Q2 = (b)

- **`/odrzavanje/[id]`**, prelaz „Traži odobrenje” i „Odobreno (odluka/ovlašćenje)”: `select` „Odluka (prijedlog)” sa prijedlozima ZEV-a u statusima `VOTING_OPEN` i `ACCEPTED` (šifra — naslov — status), plus opcija „U okviru ovlašćenja predsjednika (bez odluke)”.
  - `transitionIssue`: ako je `approvalProposalId` dat, provjerava da prijedlog postoji u istom ZEV-u (`zevId`), inače greška. Prelaz u `APPROVED` sa prijedlogom koji **nije** `ACCEPTED` je **dozvoljen**, ali se u napomenu statusa upisuje „prije odluke” i stavka ide na početnu (F6.5). Bez prijedloga i bez opcije „u okviru ovlašćenja” — greška „Izaberite odluku ili ovlašćenje”.
  - Prikaz: u sekciji statusa „Odobreno odlukom P-2026-02 (Usvojeno)” kao `RowLink` na prijedlog; ako nije usvojen, `StatusBadge` prijedloga uz tekst „glasanje još traje”.
- **`/planovi/[id]`:** „Usvojen odlukom skupštine” postaje `RowLink` na `approvedByProposalId`.
- Audit: postojeći `issue.transition` dobija `after.approvalProposalId` (bez nove akcije).
- Ako P-Q2 = (a) tvrda kapija: isto, ali `APPROVED` sa ne-`ACCEPTED` prijedlogom je greška (osim hitnog puta). Ako (c): F6.4 otpada.

### F6.5 Početna predsjednika — „Za Vas sada” prije salda (P-R07, D1 A)

- **Nova čista funkcija `src/lib/presidentTasks.ts`** (kao `ownerTasks.ts`): ulaz su obični objekti, izlaz rangirana lista `{ key, rank, chip, sentence, meta?, href, actionLabel }`, determinističan redoslijed (rang, pa datum, pa id). Stavke:
  1. **Registar nije utvrđen** (FR-Q4) — postojeća kartica postaje prva stavka liste.
  2. **Glasanje kojem je prošao rok, a još je otvoreno** — „Rok je bio …; zatvorite glasanje na sjednici …”.
  3. **Glasanje ističe za ≤ 3 dana bez postignutog kvoruma** — „Glasalo X od Y; kvorum još nije postignut (potrebno K)”. Kvorum iz `computeProposalResult` (najviše 5 otvorenih prijedloga, kao danas).
  4. **Sjednica u narednih 7 dana** — „Sjednica … za N dana — sljedeći korak: {label iz `meetingNextStep`}”; ⚠ preduslovi se sažimaju u rečenicu („Prijedlog UO-2026-01 nije vezan za tačku 1”).
  5. **Radni nalog / izabran izvođač prije odluke** — samo uz F6.4: prijava u statusu ≥ `APPROVED` čiji vezani prijedlog nije `ACCEPTED`.
  6. **Pregled ili preventivno održavanje kojem je prošao datum** (u posljednjih 90 dana), a nema vezane prijave održavanja (`planItemId`) — „Planiran za 15.10.2026. (prije 9 dana); nije evidentirana prijava/izvršenje.” (F6-Q2).
  7. **Nove prijave održavanja čekaju trijažu** (`REPORTED`) — jedna zbirna stavka „N novih prijava”.
  - Neraspoređene uplate i nacrti serija faktura **nisu** stavke predsjednika (to je posao računovođe, F5); ako korisnik ima obje uloge, F5 ih dodaje svojom funkcijom.
- **Prikaz:** isti obrazac kao vlasnik (DS §4.1): `Card` „Za Vas sada” + `ul.divide-y` + postojeći `TaskRow` iz istog fajla (generalizovan na zajednički tip reda, bez novog primitiva); `primary` samo na najhitnijoj stavci. Prazno stanje: `IconCheck` + „Ništa ne čeka Vašu radnju.” + sljedeći događaj iz kartice ispod.
- **Ispod liste:** 4 `Stat`-a — Stanje računa i blagajne, Dospjelo (kasni), Neplaćeno dobavljačima, Fond održavanja. Ostala 4 (potraživanja ukupno, plan planirano/realizovano, nacrti serija) ostaju na `/izvjestaji` i na početnoj računovođe.
- **Kartice ispod:** „Narednih 30 dana” (sjednice + pregledi iz plana, hronološki) zamjenjuje „Predstojeće sjednice” i „Predstojeći pregledi”; „Prijedlozi na glasanju” i „Otvorene prijave održavanja” ostaju, sa metom 13px umjesto `text-xs`.
- **Računovođa bez uloge predsjednika:** pogled ostaje kakav je (F5).

### F6.6 Rječnik i DS

- Nove ugniježđene grupe u `sr-Latn.ts` i `en.ts`: `meetingStep.*` (labele, posljedice, preduslovi), `live.quorum.*`, `presidentTasks.*`, `maintenance.approval.*`.
- `Plans/design-system.md` §4.1: red **„Sljedeći korak” (obrazac, ne komponenta)** — `Card` + `StatusTimeline` + `PreconditionList` + jedno dugme po §4.2; jedan po detalju procesa, uvijek prvi ispod zaglavlja; ⚠ ne blokira osim kad servis blokira. Red „Za Vas sada” dobija napomenu da ga koristi i predsjednik (druga uloga; primitiv `TaskList` i dalje tek uz treću).
- `Plans/design-review-plan.md`: status F6.

---

## 3. Testovi

- **`tests/meeting-next-step.test.ts`** (čista funkcija): za svaki status tačan `to`, `kind` i preduslovi; tačka bez prijedloga daje ⚠ „biće diskusija”; nevezan prijedlog daje ⚠; blokirano otvaranje daje `kind: "blocked"` bez dugmeta; `MINUTES_FINALIZED` je `confirm`; arhivirana → `null`.
- **`tests/voting.test.ts`** (postojeći engine): `quorumRequirement` daje iste pragove kao dosadašnji `computeVotingResult` (regresija za sva tri `quorumType`); `presenceQuorum` za broj vlasnika i za težinu, uključujući zaokruživanje naviše.
- **Servis uživo** (postojeći test uživo/FR): neoznačeni nisu odsutni (`unmarkedCount`, `absentCount`); kvorum trake po pravilu aktivne tačke; suvlasnička zajednica prisutna ako je prisutan bilo koji član; bez prijedloga `quorum: null`.
- **`tests/president-tasks.test.ts`**: rangiranje i determinizam; prošao rok > ističe uskoro > sjednica; pregled sa vezanom prijavom nije stavka; pregled stariji od 90 dana nije stavka; prazna lista.
- **Održavanje** (ako F6.4): prijedlog drugog ZEV-a odbijen; `APPROVED` bez izbora odbijen; `APPROVED` sa ne-usvojenim prijedlogom dozvoljen (b) i daje stavku na početnoj; audit nosi `approvalProposalId`.
- **`getMeeting` agregat:** „glasalo” jednako broju važećih efektivnih glasova (ispravljeni se ne broje dvaput).

## 4. Provjera

- Pipeline: `npm run typecheck && npm run lint && npm test && npm run build` (dozvoljeno samo poznate 3 greške u `tests/env.test.ts` i 1 upozorenje `ui.tsx:305`).
- **Živo, 1440 i 375:** cijeli tok sjednice skupštine od Nacrta do Arhivirane; za svaki status zapisati šta panel kaže (status, rečenica, preduslovi, dugme) — tabela ide u izvještaj pregleda. Provjeriti da je na svakom statusu tačno jedno dugme koraka i da u pogledu nema drugog `primary`.
- **Uživo:** 375 sa 3 i sa ~40 subjekata (seed lokalno proširen skriptom koja se poslije briše): traka ostaje vidljiva pri skrolu, na početku prozivke „Neoznačeno 40 · Odsutno 0”, kvorum se mijenja uz označavanje; desktop 1440 sa `max-w-[68ch]`.
- **Početna predsjednika:** seed (sjednica za 3 dana, glasanje bez kvoruma, pregled koji je prošao) — redoslijed stavki, jedan `primary`, 4 `Stat`-a, 13px meta.
- **Nakon provjere:** `npm run db:reset && npm run db:seed`, brisanje skripti i test dokumenata.

## 5. Isporuka

- Jedan commit, **minor → 2.47.0** (uz potvrdu), `CHANGELOG.md` (Dodato / Izmijenjeno / Ispravljeno, uz napomenu **„bez migracije”**).
- **Implementacija:** po dogovoru — Sonnet po planu, Opus pregleda. Redoslijed: F6.1 → F6.3 → F6.2 → F6.4 → F6.5 (traka i model koraka prvi, jer ih koriste ostali dijelovi).
- Povlačenje: Vercel vraćanje na prethodni deployment (nema migracije).

## 6. Rizici

- **Preduslovi u panelu moraju biti tačni.** Panel koji kaže ✓ za nešto što servis odbije uči pogrešno. Mjera: `kind: "blocked"` dolazi samo iz `previewSessionVotingOpen` (iste provjere kao servis); svi ostali preduslovi su ⚠ koji ne blokiraju.
- **Kvorum u traci ≠ kvorum glasanja.** Traka mjeri prisustvo; rezultat glasanja mjeri glasove (uključujući e-glasove osoba van sale). Zato traka piše „Kvorum: prisutno …”, a tabla rezultata na tački ostaje mjerodavna (F6-Q1).
- **Izdvajanje `quorumRequirement`** dira engine glasanja. Mjera: regresioni testovi postojećih rezultata prije i poslije, bez promjene ijednog očekivanog broja.
- **Početna sa novim upitima:** do 5 `computeProposalResult` + upiti sjednica i plana; provjeriti trajanje na ZEV-u sa 100+ jedinica (seed proširen lokalno).
- **Postojeće prijave održavanja** u `APPROVED` bez veze ne dobijaju stavku „prije odluke” (nema prijedloga za poređenje) — namjerno, da stari podaci ne preplave početnu.

## 7. Otvorena pitanja za korisnika

| # | Pitanje | Opcije | Preporuka |
|---|---|---|---|
| **P-Q2** | Smije li prijava održavanja biti „Odobrena” bez usvojene odluke? | (a) tvrda kapija — samo uz usvojen prijedlog ili hitni put; (b) dozvoljeno uz obavezan izbor odluke ili „u okviru ovlašćenja”, a „prije odluke” ide kao upozorenje na početnu; (c) ostaje slobodan tekst | **(b) sada**; (a) kad se granica ovlašćenja predsjednika upiše u Podešavanja |
| **P-Q3** | Ukinuti P10 (stara kartica „Prisustvo” sa `select`-om)? | (da) sažetak „Prisutno N od M” + link na prozivku; (ne) „Naknadni unos prisustva”, dugme `tonal` | **Da** |
| **P-Q4** | Režim uživo za upravni odbor — namjerno? | (da) ostaje, kvorum po članu; P3 se dopunjava; (ne) dugme i ruta samo za skupštinu | **Da, ostaje** — servis već broji po članu, a sjednice UO se održavaju uživo |
| **P-Q5** | Zakonski rokovi u panelu (npr. rok slanja poziva prije sjednice)? | (a) prva verzija bez zakonskih rokova, samo datumi iz sistema; (b) rokovi iz `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` uz oznaku „pretpostavka” | **(a)** |
| **F6-Q1** | Šta traka uživo zove „kvorum”? | (a) „Kvorum: prisutno N od M · potrebno K” (prisustvo) + napomena da se e-glasovi računaju u glasanje; (b) dok je glasanje otvoreno, traka pokazuje kvorum glasova aktivnog prijedloga (iz rezultata), inače prisustvo | **(a)** — jedno značenje, a tabla rezultata tačke već pokazuje kvorum glasova |
| **F6-Q2** | Kad je pregled iz plana „prošao rok”? | (a) datum je prošao (posljednjih 90 dana) i nema vezane prijave održavanja; (b) novo polje „obavljeno” na stavci plana (migracija) | **(a)** sada, bez migracije |
| **F6-Q3** | Verzija | minor → 2.47.0 | **minor** |
