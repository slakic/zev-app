# F1 — Sigurnost novca i pravnih koraka — implementacioni plan

**Status: PLAN ZA PREGLED (2026-10-24).** Fazu F1 iz `Plans/design-review-plan.md` §6 korisnik je odobrio 2026-10-24 („Odobravam F1 (sigurnost novca i pravnih koraka)”). Nijedan red koda još nije napisan.

Plan je nastao čitanjem stvarnog koda (v2.41.0); svaka tvrdnja je vezana za fajl i liniju. Verzija: prijedlog je **minor → 2.42.0**, ali se prije upisa potvrđuje sa korisnikom (patch / minor / major).

**Cilj faze:** nijedna radnja koja knjiži ili stornira novac, šalje poruke trećim licima, zaključava tekst prijedloga ili oduzima pravo ne ide jednim klikom. U trenutku odluke korisnik vidi **koliko, kome i šta se ne može povući**.

Faza rješava nalaze iz pregleda:
- **Kritične:** K1 (R-N11), K2 (R-N04), K3 (P-N02), K4 (P-N05).
- **Visoke:** V1 (R-N12), V2 (R-N13), V3 (R-N18), V4 (P-N10), V5 (P-N07), V6 (P-N23) i dio V7 (X-N20b).

**Granice faze:**
- Nema novih obrazaca, boja ni težina dugmadi. Koristi se samo `ConfirmAction`, `Field`, `inputCls`, `RowAction`, `RowLink`, `Card` i `Flash`.
- Nijedna odluka D1–D9 nije potrebna.
- Nema migracije baze.
- `danger` ostaje na postojećim mjestima: storno uplate, storno fakture, suspenzija ZEV-a i brisanje nacrta prijedloga.

---

## 0. Pravilo potvrde koje faza uvodi (dokumentuje se u `design-system.md` §4.2)

`ConfirmAction` već ima `triggerVariant` i `confirmVariant` (`src/components/ui.tsx:588-620`). Faza ih koristi dosljedno, po jednom pravilu:

| Vrsta radnje | Okidač | Dugme potvrde | Primjeri u F1 |
|---|---|---|---|
| **Očekivani sljedeći korak sa trajnom posljedicom** (šalje poruke, zaključava, izdaje) | `caution` | `primary` | Izdaj seriju, Pošalji pozive, Otvori glasanje, Plati trošak |
| **Korektivna radnja** (poništava, oduzima) | `caution` | `caution` | Storno alokacije, storno troška, opoziv linka, nova verzija prijedloga, okončanje mandata, uklanjanje pristupa |
| **Nepovratno uništavanje novca ili prava** (postojeća 4 mjesta) | `caution` | `danger` | bez izmjene |

Tijelo potvrde (`body`) uvijek sadrži:
- **broj ili iznos:** primaoci, fakture, KM;
- **ko je druga strana:** dužnik, dobavljač, vlasnik;
- **šta se ne može povući.**

`primary` u panelu potvrde ne krši pravilo „jedno `primary` po regiji”, jer je otvoren panel zasebna regija koja zamjenjuje okidač. Okidač je `caution`, pa zatvoren panel ne dodaje `primary` na stranicu.

Svaki novi tekst ide kroz `t()` u novu ugniježđenu grupu **`confirm`** u `src/lib/i18n/sr-Latn.ts`, uz istu strukturu u `en.ts`. Primjer: `confirm: { allocation: { title, body, ... } }`. Postojeći tvrdo kodirani tekstovi na istim mjestima prelaze u istu grupu kad se mijenjaju.

---

## F1.1 Detalj uplate — raspoređivanje bez tuđe fakture, kontrole samo za računovođu *(K1, V1, dio V2)*

**Fajl:** `src/app/(app)/fakture/uplate/[id]/page.tsx`

**Zatečeno:**
- `openInvoices` su sve izdate fakture ZEV-a, sortirane po broju (`:83-87`).
- `<select name="invoiceId">` nema praznu opciju, pa je unaprijed izabrana prva faktura u ZEV-u (`:154-165`).
- Iznos je unaprijed popunjen sa svim slobodnim novcem (`:168`).
- Stranica je dostupna i predsjedniku (`:73`), ali kontrole se renderuju bez provjere uloge (`:146-219`). Server ih odbija (`requireActor("ACCOUNTANT")`, `:32, :48, :60`).
- Storno alokacije nema `body`, a razlog nije `required` (`:208-218`). Server traži razlog (`payments.ts:960`), ali akcija ga zamjenjuje sa `"Storno"` (`:51`), pa se zaštita tiho zaobilazi.

**Izmjene:**
1. **Izbor fakture:**
   - Prva opcija je `<option value="">— izaberite fakturu —</option>`, a `select` dobija `required`.
   - Otvorene fakture **platioca** (`inv.debtorId === payment.payerId`) idu u prvi `<optgroup label="Fakture platioca: {ime}">`, ostale u `<optgroup label="Ostali dužnici">`.
   - Ako uplata nema platioca (`payerId` je null), ostaje jedna grupa „Otvorene fakture”.
   - Iznos otvorenog duga se računa kroz `dec` / `sumDecimals`, ne kroz `Number` (`:156-157`).
2. **Iznos:**
   - Polje je prazno i nije `required`.
   - Hint: „Ostavite prazno za najviše moguće: manji od slobodnog iznosa ({slobodno}) i otvorenog duga izabrane fakture.”
   - **Servis:** `allocatePayment` (`src/server/services/payments.ts:910`) prihvata `amount?: string`. Kad je izostavljen, unutar iste transakcije uzima `min(paymentFree, invoiceOpen)`. Ako je taj iznos ≤ 0, baca postojeću poruku o iznosu. Akcija prosljeđuje `undefined` umjesto `""`.
3. **Uloge:**
   - `const isAccountant = actor.roles.includes("ACCOUNTANT")`.
   - Za predsjednika se ne renderuju kartica „Ručno raspoređivanje”, kolona „Radnje” u prijedlozima (uslovni `ColumnSpec`), storno alokacija ni storno uplate.
   - Umjesto toga, jedna rečenica u `Card hint`: „Raspoređivanje i storniranje radi računovođa.”
   - Server provjera ostaje kakva jeste.
4. **Avans:** kad je `free > 0` i uplata nije stornirana, ispod statusa ide rečenica (13px): „Neraspoređeni ostatak od {iznos} ostaje kao avans platioca.” Bez dugmeta „Ostavi kao avans”: to je R-Q4 / F5 i traži servisnu odluku.
5. **Storno uplate** se seli iz kartice „Ručno raspoređivanje” u zasebnu karticu **„Poništavanje”** ispod „Alokacije”, odvojeno od `primary` „Rasporedi”. Sadržaj potvrde ostaje isti; već ima iznos i `danger`.
6. **Storno alokacije:**
   - okidač „Storniraj” (velikim slovom, P-R02);
   - `body`: „Alokacija {iznos} na fakturu {broj} ({dužnik}) se poništava. Faktura ponovo postaje otvorena za {iznos}, a iznos se vraća u slobodni dio uplate.”;
   - polje razloga `required`;
   - akcija prosljeđuje razlog bez zamjene `|| "Storno"`.
7. Broj fakture u tabeli „Alokacije” postaje `RowLink` na `/fakture/[id]` (`:203`).

**Testovi** (`tests/payments.test.ts`):
- `allocatePayment` bez iznosa raspoređuje `min(slobodno, otvoreno)`, u oba slučaja: kad je uplata veća i kad je faktura veća;
- uz iznos, ponašanje je nepromijenjeno;
- `reverseAllocation` sa praznim razlogom baca grešku (zaključava postojeće ponašanje).

---

## F1.2 Detalj fakture — storno samo kad je moguć, sa iznosom *(V2)*

**Fajl:** `src/app/(app)/fakture/[id]/page.tsx`

**Zatečeno:**
- Kartica „Storniranje” se prikazuje svakoj izdatoj fakturi (`:226, :240-253`).
- Hint je `text-xs` i kaže „Moguće samo dok nema raspoređenih uplata”. Ako uplate postoje, greška dolazi tek nakon potvrde (`billing.ts:477-478`).
- `body` nema iznos ni dužnika.
- Servis nakon storna šalje obavještenje dužnicima koji su izabrali dostavu (`billing.ts:489`), ali potvrda to ne kaže.

**Izmjene:**
1. **Ako je `invoicePaidAmount(inv)` različit od nule:** umjesto `ConfirmAction` ide tekst (13px): „Faktura ima raspoređene uplate ({iznos}). Da biste je stornirali, prvo stornirajte alokacije:”. Ispod je lista `RowLink`-ova na uplate (`/fakture/uplate/[paymentId]`).
2. **Ako je nula:**
   - `body` navodi broj, dužnika i iznos: „Faktura {broj} ({dužnik}, {iznos}) ostaje u evidenciji kao stornirana i više se ne može naplatiti.”;
   - ako je dužnik izabrao dostavu e-poštom, dodaje se rečenica „{dužnik} dobija obavještenje o storniranju e-poštom.”, izvedena iz istog podatka koji koristi `queueInvoiceEmails`.
3. Hint `text-xs` postaje `text-[13px]`.

**Testovi:** nema servisne izmjene. Test da `cancelInvoice` odbija fakturu sa raspoređenom uplatom **danas ne postoji** (provjereno: `tests/billing.test.ts:169-170` pokriva samo prazan razlog), pa se dodaje u `tests/billing.test.ts`. On štiti pravilo na koje se nova grana UI-ja oslanja.

---

## F1.3 Troškovi — plaćanje i storno iza potvrde *(V2, V3)*

**Fajl:** `src/app/(app)/troskovi/page.tsx`

**Zatečeno:**
- Klik na „plati” plaća pun preostali iznos sa današnjim datumom, sa računa koji je prvi u `<select>` (Blagajna) (`:79-92`, `:242-248`).
- Servis već prima `amount` i `date` (`src/server/services/expenses.ts:125-138`).
- Storno troška nema `body`, razlog nije `required`, a akcija ga zamjenjuje sa `"Storno"` (`:94-96`, `:249-259`).
- Storno se nudi i za `PARTIALLY_PAID`, iako ga servis tada odbija (`expenses.ts:180-181`).

**Izmjene:**
1. **„Plati…” kao `ConfirmAction`** (okidač `caution`, potvrda `primary` „Evidentiraj plaćanje”):
   - `body`: „{dobavljač} · faktura {broj} · preostalo {iznos}.”
   - Polja: **Račun** (`select` sa praznom prvom opcijom „— izaberite račun —”, `required`), **Datum plaćanja** (`type="date"`, podrazumijevano danas), **Iznos (KM)** (podrazumijevano preostali iznos; može manje, za djelimično plaćanje).
   - Akcija prosljeđuje `accountId`, `date` (isti način parsiranja kao ručni unos uplate, `fakture/uplate/page.tsx:31`) i `amount` (`parseMoneyInput`).
2. **Storno troška:**
   - prikazuje se samo kad je `paidAmount` nula;
   - `body`: „Trošak {dobavljač} · {broj} · {iznos} se stornira i više se ne može platiti.”;
   - razlog je `required`;
   - akcija ne zamjenjuje prazan razlog.
3. Oznake radnji velikim slovom: „Plati…”, „Storniraj”.

**Poznato ograničenje:** panel potvrde se otvara unutar ćelije tabele i širi kolonu „Radnje”. Isti obrazac danas već ima storno troška. Panel u punoj širini ispod reda je X-R15 / F8; ovdje se samo provjerava da je panel upotrebljiv na 1440 i 375.

**Testovi** (`tests/expenses-plans.test.ts`):
- `payExpense` sa manjim iznosom daje `PARTIALLY_PAID`;
- drugi `payExpense` za ostatak daje `PAID`;
- `cancelExpense` sa praznim razlogom baca grešku.

---

## F1.4 Serija faktura — izdavanje iza potvrde *(K2)*

**Fajlovi:** `src/app/(app)/fakture/serija/[id]/page.tsx`, `src/server/services/billing.ts`

**Zatečeno:**
- `SubmitBtn` „Izdaj N faktura (iznos)” je u zaglavlju i izdaje jednim klikom (`:103-111`). Izdavanje generiše PDF-ove i šalje e-poštu dužnicima koji su izabrali dostavu (`:54-71`).
- Ukupan iznos se sabira kroz `Number` (`:92`).
- Rok plaćanja se računa unutar `issueBatch` kao 15. dan mjeseca perioda (`billing.ts:305`), pa ga nacrt ne zna prikazati.
- Broj dužnika sa dostavom e-poštom se već računa (`countOptedInDebtors`, `:96`).

**Izmjene:**
1. **Servis:** izdvojiti `defaultBatchDueDate(period: string): Date` iz `issueBatch` (`billing.ts:305`) kao izvezenu funkciju, i koristiti je i u `issueBatch` i na stranici. Logika se ne mijenja.
2. **Stranica:**
   - `grandTotal` se računa kroz `sumDecimals(preview.map(c => dec(c.total)))`.
   - Zaglavlje dobija `ConfirmAction`: okidač `caution` „Izdaj seriju…”, potvrda `primary` „Da, izdaj {N} faktura”.
3. **`body`** (lista):
   - Faktura: {N}
   - Ukupno: {iznos}
   - Rok plaćanja: {datum}
   - Odmah e-poštom: {draftOptedIn} dužnika (ostalima račun ostaje u aplikaciji)
   - Rečenica: „Izdate fakture se ne mogu mijenjati; ispravka ide kroz korektivnu fakturu ili storno.”
4. **Upozorenje** (R-Q5, preporuka „upozoriti”): ako je rok plaćanja prije današnjeg dana, `body` dobija amber rečenicu „Rok plaćanja ({datum}) je već prošao — sve fakture će odmah biti dospjele.” Izdavanje se ne blokira.

**Testovi** (`tests/billing.test.ts`): `defaultBatchDueDate("2026-09")` je 15.09.2026. UTC, a `issueBatch` bez `dueDate` koristi istu vrijednost.

---

## F1.5 Sjednica — pozivi iza potvrde, prijedlog iz tačke dnevnog reda *(K3, K4)*

**Fajlovi:** `src/app/(app)/skupstina/[id]/page.tsx`, `src/server/services/meetings.ts`

**Zatečeno:**
- „Pošalji pozive (e-mail)” je običan `SubmitBtn` (`:209-214`).
- Primaoci se biraju **u stranici** (`:83-99`), suprotno pravilu da logika živi u servisima. Zato ih stranica ne može prebrojati prije slanja.
- Okidač zatvaranja glasanja sjednice je `primary` (`:187`), suprotno P2.
- Polje „Tačka dnevnog reda” u novom prijedlogu je opciono i podrazumijevano prazno (`:280-285`). Veza se vidi samo kao `text-xs` sufiks (`:232-234`).

**Izmjene:**
1. **Servis `listInvitationRecipients(actor, meetingId)`** u `meetings.ts`:
   - premješta logiku iz `:83-99` bez izmjene pravila: za `BOARD` predsjednik i članovi odbora, za `ASSEMBLY` aktivna lica sa aktivnim udjelom;
   - vraća `{ withEmail: Party[], withoutEmailCount: number }`;
   - `statusAction` ga koristi za slanje, a stranica za tijelo potvrde.
2. **„Pošalji pozive (e-mail)” kao `ConfirmAction`** (okidač `caution`, potvrda `primary`). `body`: „Poziv na sjednicu „{naslov}” ({datum}, {mjesto}) dobija e-poštom {N} {vlasnika | članova odbora}. {M} nema e-adresu — njima uručite PDF poziva (Dokumenti).” Slanje se ne može povući.
3. **Okidač „Označi glasanje zatvorenim”**: `triggerVariant` `primary` → `caution` (`:187`). Tijelo ostaje.
4. **Dnevni red:**
   - Svaka tačka dobija oznaku (13px): „Prijedlog: {kod}” kao `RowLink`, ili „Diskusija — bez glasanja” kad nema prijedloga.
   - Predsjednik uz tačku bez prijedloga ima `RowActionLink` „Dodaj prijedlog”, koji vodi na `?tacka={id}#novi-prijedlog`.
5. **Forma „Novi prijedlog”:**
   - `<details id="novi-prijedlog">` je otvoren kad postoji `?tacka=`.
   - Select „Tačka dnevnog reda” je `required`, sa opcijama: „— izaberite tačku —” (`""`), tačke dnevnog reda, i „Bez tačke dnevnog reda” (`"none"`). Podrazumijevano je izabrana tačka iz `?tacka=`.
   - Akcija mapira `"none"` → `null`. Servis `createProposal` se ne mijenja, jer prijedlog bez tačke ostaje svjesno dozvoljen.
6. Ista promjena selecta ide u formu za izmjenu nacrta na `/skupstina/prijedlog/[id]` (`:367-372`).

**Testovi** (`tests/voting.test.ts` ili novi `tests/meeting-invitations.test.ts`):
- `listInvitationRecipients` za skupštinu vraća samo vlasnike sa aktivnim udjelom i e-adresom, svakog jednom, i tačno broji one bez e-adrese;
- za odbor vraća predsjednika i članove, bez duplikata;
- broj poruka `meeting-invitation` u outbox-u nakon prelaza u `INVITATIONS_SENT` jednak je `withEmail.length`.

---

## F1.6 Prijedlog — otvaranje glasanja, opoziv, nova verzija iza potvrde; privremeni rezultat *(K3, V4, V5)*

**Fajlovi:** `src/app/(app)/skupstina/prijedlog/[id]/page.tsx`, `src/server/services/meetings.ts`

**Zatečeno:**
- „Otvori glasanje i pošalji linkove” je običan `SubmitBtn` (`:228-232`). `openVoting` zaključava tekst i šalje lični link svakom glasaču sa e-adresom (`meetings.ts:706`).
- Pregled dostave postoji samo za režim uživo (`previewLiveDelivery`, `meetings.ts:979`).
- „opozovi” i „ponovo izdaj” su obični submitovi bez razloga (`:318-331`). Akcija upisuje podrazumijevane razloge `"Opoziv"` / `"Ponovno izdavanje"` (`:111-112`).
- „Kreiraj novu verziju” je običan submit sa poljem razloga (`:466-477`). Hint kaže da „poništava sve izdate linkove”.
- Rezultat otvorenog glasanja se ispisuje kao konačan: „Ishod: NIJE USVOJENO”, „Kvorum: NIJE postignut” (`:284-290`).

**Izmjene:**
1. **Servis `previewVotingDelivery(actor, proposalId, delivery: "ALL" | "LIVE")`:**
   - nastaje proširenjem `previewLiveDelivery` (koji ostaje kao omotač sa `"LIVE"`, da se ne mijenja režim uživo);
   - za `"ALL"` vraća `{ voters, byEmail, viaProxy, withoutEmail }`, izračunato **istim** pomoćnim kodom kojim `openVoting` gradi bazu i bira primaoca (`meetings.ts:744-835`);
   - taj dio se izdvaja u zajedničku internu funkciju, da pregled i stvarno slanje ne mogu da se raziđu.
2. **„Otvori glasanje…” kao `ConfirmAction`** (okidač `caution`, potvrda `primary` „Da, otvori glasanje”). `body`:
   - „Glasačka baza: {voters}. Lični link i verifikacioni kod e-poštom: {byEmail} (od toga {viaProxy} preko punomoćnika). Bez e-adrese: {withoutEmail} — njihove glasove unosite ručno.”
   - „Tekst prijedloga (verzija {v}) se zaključava. Izmjena nakon toga znači novu verziju i poništenje svih linkova.”
   - Glasanje traje do {datum}.
3. **Opoziv i ponovno izdavanje linka:**
   - Oba postaju `ConfirmAction` (okidač i potvrda `caution`, oznake velikim slovom: „Opozovi”, „Ponovo izdaj”), sa `required` razlogom.
   - Opoziv, `body`: „Lični link vlasnika {ime} prestaje da važi odmah.”
   - Ponovno izdavanje, `body`: „Stari link prestaje da važi; {ime} dobija novi link i kod na {adresa}.”
   - Akcija prosljeđuje razlog bez podrazumijevane zamjene.
4. **„Kreiraj novu verziju…” kao `ConfirmAction`** (okidač i potvrda `caution`). Polja „Novi tekst” i „Razlog izmjene” prelaze u `children`. `body`: „Poništava se {N} aktivnih linkova. Već dati glasovi ({M}) ostaju evidentirani uz verziju {v} i ne prenose se. Svi glasači dobijaju nove linkove.”
5. **Privremeni rezultat:**
   - Dok je `p.status === "VOTING_OPEN"`, kartica rezultata ima naslov „Trenutno stanje — glasanje traje do {datum}”.
   - Linije su rečenice, bez velikih slova: „Kvorum za sada: postignut / nije postignut” i „Ishod ako se sada zatvori: usvojeno / nije usvojeno”, uz postojeći ključ `live.resultOutcomeIfClosedNow`.
   - Nakon zatvaranja glasanja: „Konačan rezultat” i „Ishod: usvojeno / nije usvojeno”.
   - Isto važi za tijelo potvrde zatvaranja (`:240-242`).
   - Prikaz brojeva (`formatWeight`) se **ne mijenja** u F1. Prelazak na broj glasova je dio K-03 / FR.

**Testovi:**
- `previewVotingDelivery(…, "ALL")` za seed prijedlog vraća iste brojeve kao broj `approval-link` poruka i `ApprovalToken`-a koje `openVoting` zatim stvarno napravi;
- `revokeToken` i `reissueToken` (`meetings.ts:1075, :1095`) danas **prihvataju prazan razlog** (provjereno). Oba dobijaju istu provjeru kao `reverseAllocation` (`if (!reason.trim()) throw …`), uz test za svaki. Ovo je mala servisna izmjena; dodaje se na listu u §12.

---

## F1.7 Režim uživo — tačka bez prijedloga *(K4)*

**Fajlovi:** `src/components/agenda-voting.tsx`, `src/app/uzivo/[meetingId]/page.tsx`, `src/server/services/meetings.ts` (`getLiveMeetingState`)

**Zatečeno:** tačka bez vezanog prijedloga prikazuje samo „Diskusija — bez prijedloga za glasanje.” (`agenda-voting.tsx:129`), iako na sjednici postoji nevezan prijedlog (UO-2026-01 u seed-u).

**Izmjene:**
1. `getLiveMeetingState` (`meetings.ts:64`) dodatno vraća `unlinkedDraftProposals: { id, code, title }[]`: prijedloge sjednice u statusu `DRAFT` bez `agendaItemId`.
2. **Tačka bez prijedloga, kad nevezani nacrti postoje:**
   - tekst (13px): „Na sjednici postoji prijedlog koji nije vezan ni za jednu tačku.”;
   - predsjedniku, po prijedlogu, forma sa `RowAction` `tonal` „Veži {kod} za ovu tačku”;
   - nova server akcija u `uzivo/[meetingId]/page.tsx` poziva postojeći `updateDraftProposal(actor, id, { agendaItemId })` (`meetings.ts:446`, samo predsjednik) i vraća na istu tačku.
   - Računovođa vidi isti tekst sa „Povezivanje radi predsjednik.”
3. **Kad nevezanih nema:** „Ako je tačka samo diskusija, ništa ne morate raditi.”

**Testovi** (`tests/live-meeting.test.ts`, `describe("getLiveMeetingState")`): nevezan `DRAFT` prijedlog se pojavljuje u `unlinkedDraftProposals`; nakon `updateDraftProposal` sa `agendaItemId` nestaje odatle i pojavljuje se uz tačku.

---

**Dopuna (odluka korisnika 2026-10-24, u istoj verziji 2.42.0):**
- **Problem:** seed prijedlog UO-2026-01 je već `VOTING_OPEN` i nije vezan ni za jednu tačku, pa ga gornje rješenje (samo nacrti) ne pokriva.
- **Novi servis `linkProposalToAgendaItem(actor, proposalId, agendaItemId)`** (`meetings.ts`), samo za predsjednika:
  - veže prijedlog bez tačke, u statusu `DRAFT` ili `VOTING_OPEN`, za tačku iste sjednice;
  - odbija već vezan prijedlog, prijedlog u drugom statusu i tačku druge sjednice;
  - audit `proposal.link` (`activity/catalog.ts`, labela u `auditAction.proposal.link`).
- **Zašto je bezbjedno i nakon otvaranja glasanja:** tačka dnevnog reda nije dio `proposalContentHash` (naslov, tekst, verzija, prilozi). Zato se zaključan tekst i izdati linkovi ne mijenjaju; test to provjerava.
- **Ostale izmjene:**
  - `getLiveMeetingState.unlinkedDraftProposals` postaje `unlinkedProposals` (`DRAFT` i `VOTING_OPEN`, sa statusom);
  - režim uživo koristi novi servis umjesto `updateDraftProposal`;
  - na detalju sjednice tačka bez prijedloga nudi „Veži {kod} za ovu tačku” (`tonal`) uz „Dodaj prijedlog” (`secondary`).

## F1.8 Organi, Dokumenti, Admin — preostale jednoklik radnje *(V6, dio V7)*

1. **`src/app/(app)/organi/page.tsx:186-190` — „Okončaj mandat”** postaje `ConfirmAction` (okidač i potvrda `caution`):
   - polja: datum (`required`, `Field` sa labelom „Mandat traje do”, umjesto golog `text-xs` inputa) i razlog (opciono, jer ga `endBoardMembership` već prima, `ownership.ts:423`);
   - `body`: „{ime} prestaje biti član upravnog odbora od {datum}. Odbor će imati {N−1} člana.”
2. **`src/app/(app)/dokumenti/page.tsx:95-99` — „objavi vlasnicima”:**
   - prikazuje se samo za `status === "FINAL"`; za nacrt ide tekst „Objava nakon finalizacije”;
   - postaje `ConfirmAction` (okidač `caution` „Objavi vlasnicima…”, potvrda `primary`);
   - `body`: „{naslov} ({broj}) postaje vidljiv svim vlasnicima u aplikaciji. Objava se ne može povući.”
   - **Servis:** `publishDocument` (`documents.ts:198`) odbija dokument koji nije `FINAL`, sa porukom „Objaviti se može samo finalizovan dokument.”
3. **`src/app/admin/[zevId]/page.tsx:305-316` — „Ukloni moj pristup”** postaje `ConfirmAction` (okidač i potvrda `caution`):
   - polje razloga dobija pravu labelu kroz `Field` (umjesto placeholdera `text-xs`);
   - `body`: „Gubite pristup ZEV-u {naziv} kao {uloga}. Ponovo ga možete zatražiti na ovoj stranici.”

**Testovi:** `tests/documents-audit.test.ts`: `publishDocument` nad `DRAFT` dokumentom baca grešku, a nad `FINAL` radi i auditira.

---

## 9. Ažuriranje dokumentacije

- **`Plans/design-system.md` §4.2:**
  - tabela iz §0 ovog plana kao pravilo za `ConfirmAction`;
  - ispravka broja `danger` mjesta na 4 („Obriši nacrt”);
  - `SegmentedAction` u inventar.
- **`Plans/design-review-plan.md`:** status F1 „U IMPLEMENTACIJI”, a nakon isporuke „ISPORUČENO u v2.42.0”, uz link na ovaj plan.
- **`CHANGELOG.md`:** unos za novu verziju, grupisan kao Izmijenjeno / Ispravljeno, u tonu postojećih unosa.
- `package.json` i `package-lock.json`: verzija nakon potvrde.

## 10. Redoslijed isporuke

Tri logična commita na jednoj grani. Svaki prolazi pipeline:

1. **Novac:** F1.1–F1.4, sa servisnim izmjenama `allocatePayment` i `defaultBatchDueDate` i njihovim testovima.
2. **Skupština:** F1.5–F1.7, sa `listInvitationRecipients`, `previewVotingDelivery`, `getLiveMeetingState` i testovima.
3. **Ostalo i dokumentacija:** F1.8 (`publishDocument` guard), `design-system.md`, `CHANGELOG.md` i verzija.

Commit i push radi tek nakon potvrde korisnika, po pravilu sesije.

## 11. Provjera

**Pipeline** (lokalni alat na ovom Mac-u, `~/.local/zev-tools`; Postgres na :5432):

```
export PATH=~/.local/zev-tools/node/bin:$PATH
npm run typecheck && npm run lint && npm test && npm run build
```

Poznat zatečeni pad `tests/env.test.ts` u typecheck-u nije vezan za ovu fazu i ne smije se pogoršati.

**Živi pregled:** `next start` nakon svježeg build-a, Playwright sa Chrome-om, 1440 i 375, uloge računovođa, predsjednik i super admin. Za svaki ekran se pogleda screenshot zatvorene i otvorene potvrde:

| Ekran | Šta mora biti istina |
|---|---|
| `/fakture/uplate/[id]` (Jovanović 120,23) | nijedna faktura nije unaprijed izabrana; Jovanovićeve fakture su prve; predsjednik ne vidi nijednu kontrolu; storno alokacije traži razlog i pokazuje iznos |
| `/fakture/[id]` sa i bez uplata | storno se ne nudi kad postoje uplate; tekst sa linkovima |
| `/troskovi?tab=troskovi` | „Plati…” traži račun (bez podrazumijevanog), datum i iznos; djelimično plaćanje prolazi; storno samo za neplaćene |
| `/fakture/serija/[id]` (novi nacrt) | izdavanje traži potvrdu sa brojem faktura, iznosom, rokom i brojem e-poruka; upozorenje za rok u prošlosti |
| `/skupstina/[id]` (u statusu „Pozivi pripremljeni”) | „Pošalji pozive” pokazuje broj primalaca i one bez e-adrese; tačka bez prijedloga ima „Dodaj prijedlog”; forma otvorena sa izabranom tačkom |
| `/skupstina/prijedlog/[id]` (nacrt i otvoren) | otvaranje glasanja pokazuje bazu i dostavu; opoziv, ponovno izdavanje i nova verzija traže potvrdu i razlog; rezultat otvorenog glasanja piše „Ishod ako se sada zatvori” |
| `/uzivo/[id]?tab=dnevni-red` | tačka „Izbor izvođača…” nudi „Veži UO-2026-01”; nakon vezivanja glasanje se može otvoriti |
| `/organi`, `/dokumenti`, `/admin/[zevId]` | okončanje mandata, objava i uklanjanje sopstvenog pristupa traže potvrdu; nacrt dokumenta se ne može objaviti |

**A11y:** svaki `ConfirmAction` se otvara i potvrđuje samo tastaturom; fokus ostaje na `<summary>`; nijedan novi tekst nije ispod 13px; `select` sa praznom opcijom ima labelu kroz `Field`.

**Čišćenje nakon pregleda:** brišu se testni dokumenti iz `var/storage/documents` nastali tokom pregleda, i baza se vraća u početno stanje sa `npm run db:reset && npm run db:seed`.

## 12. Rizici

- **Servisne izmjene su male i aditivne:** `allocatePayment` sa opcionim iznosom, `defaultBatchDueDate`, `listInvitationRecipients` (premještena logika), `previewVotingDelivery` (izdvojena logika iz `openVoting`), `getLiveMeetingState` (dodato polje) i guard u `publishDocument`, provjera razloga u `revokeToken` i `reissueToken`.
  - Najosjetljivije je izdvajanje logike iz `openVoting`. Pokriva ga test jednakosti pregleda i stvarne dostave, a postojeći testovi `openVoting` i `live-meeting` moraju ostati zeleni bez izmjene.
- **`publishDocument` guard:** ako bi postojao tok koji namjerno objavljuje nacrt, on bi prestao da radi. Provjereno: jedini poziv je `dokumenti/page.tsx:30`.
- **Navika korisnika:** jedan klik više na rutinskim koracima. To je namjerno; navodi se u `CHANGELOG.md`.
- **Povlačenje:** bez migracije, pa je povlačenje vraćanje na prethodni deployment na Vercel-u.

## 13. Otvoreno (ne blokira F1)

- **Verzija:** prijedlog je minor → 2.42.0. Potvrđuje se prije upisa.
- **R-Q4 (avans kao završen posao)** i **R-Q6 (djelimično plaćanje troška kao posebna radnja u radnom redu)** ostaju za F5. F1 samo omogućava unos manjeg iznosa pri plaćanju.
- Panel potvrde u ćeliji tabele (troškovi, admin nalozi) se ne seli u punu širinu ispod reda u F1; to je X-R15 i ide u F8.
