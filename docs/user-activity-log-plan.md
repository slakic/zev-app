# Dnevnik korisničkih aktivnosti (user action log) — plan za pregled

**Status: PLAN ODOBREN (2026-09-09), implementacija još nije počela.**
Nastalo na zahtjev korisnika (2026-09-09): "give ZEV presidents ability to show
user action log, which would record user actions like voting, submitting
maintenance requests, uploading documents etc." Izrađeno kroz plansku analizu
(Opus model, plan-only prolaz — metodologija u skill-u `opus-plan-sonnet-code`),
zasnovano na stvarnom čitanju koda projekta, ne na pretpostavkama.

## Odluke korisnika (2026-09-09) — odgovori na pitanja iz §"Pitanja za tebe"

- **P1 (upload dokumenata od strane vlasnika)** — potvrđeno da ta
  funkcionalnost danas ne postoji; ostaje van obima ove funkcionalnosti,
  bez izmjene.
- **P2 (izbor glasa)** — **za prvu verziju, evidentirati SAMO da je glasanje
  izvršeno, ne i izbor.** Ovo je stroža odluka od originalne preporuke §6(a)
  (koja je predlagala samo da se izbor ne prikazuje u UI) — `choice` se sada
  uopšte ne piše u `after` payload novog/ispravljenog `vote.submit` audit
  zapisa. Sam izbor ostaje ispravno sačuvan tamo gdje mora biti — u `Vote`
  tabeli, za prebrojavanje i zvanični rezultat — samo se ne duplira u audit
  zapisu namijenjenom ovom prikazu.
- **P3 (agregacija po osobi)** — **odbačeno u korist filtera.** Umjesto
  posebnog prikaza po vlasniku (bivša Faza 3, kartica na
  `/vlasnici/[id]`), dovoljan je `akter` filter/selekt na već planiranom
  globalnom feedu (§5) — predsjednik otvori `/aktivnosti` i filtrira po
  osobi. Faza 3 iz §8 se u cijelosti uklanja; njena svrha je već pokrivena
  filterom iz Faze 2.
- **P4 (ko vidi kurirani feed)** — **samo PRESIDENT.** Za razliku od
  postojeće tehničke stranice `/podesavanja/audit` (koja ostaje
  PRESIDENT+ACCOUNTANT, bez izmjene), novi `/aktivnosti` feed je gated
  isključivo na `requireActor("PRESIDENT")`. Posljedica: self-service
  prikaz vlasniku (§6, red "Self-service prikaz vlasniku") se takođe
  uklanja — nije traženo, i P3-ova odluka ionako uklanja mjesto gdje bi
  živio (kartica na `/vlasnici/[id]`).

Sekcije §3, §6 i §8 ispod su ažurirane da odražavaju ove odluke; ostatak
dokumenta (§1, §2, §4, §5, §7) ostaje kako je izvorno predloženo.

---

## 0. Rezime — pročitati prije ostatka

Postojeća `AuditEvent` infrastruktura **jeste** ispravna osnova za ovu
funkcionalnost — ali trenutno ne može da isporuči baš primjer koji je naveden
kao vodeći ("voting"), i razlog nije kozmetički. Tri nalaza oblikuju cijeli
plan:

1. **`vote.submit` se upisuje sa `actor: null`** (`src/server/services/meetings.ts:719`).
   Posljedica: `zevId = NULL` i `actorId = NULL` na tom zapisu. Trenutna
   stranica revizije filtrira `where: { zevId }`, pa su **elektronski glasovi
   već sada nevidljivi na njoj**, i ništa u `AuditEvent`-u ne govori *ko* je
   glasao. Vodeći primjer iz zahtjeva je upravo ono što trenutna
   infrastruktura strukturno ne može prikazati bez izmjene.
2. **`attachment.upload` je dostupan samo predsjedniku/računovođi**
   (`requireRole(actor, "PRESIDENT", "ACCOUNTANT")`,
   `src/server/services/attachments.ts:111`). Vlasnik trenutno **ne može**
   uploadovati dokument. "Uploading documents" iz zahtjeva je, kako sistem
   danas radi, akcija uprave, ne aktivnost vlasnika — ovo treba razjasniti
   prije implementacije (vidi pitanje Q1 na kraju).
3. **`actorLabel` se nikad ne popunjava stvarnim imenom.** `audit()` računa
   `actorLabel` iz `actor.label`, ali `Actor` tip nema `label` polje i nijedno
   mjesto u kodu ga ne prosljeđuje. Kolona dokumentovana kao "denormalized
   display" je u praksi uvijek `null` za stvarne korisnike. Imena danas
   preživljavaju samo kroz živi join na `Membership → User.email`, što se
   pokvari čim član napusti ZEV.

**Preporuka:** zadržati `AuditEvent` kao jedini izvor istine (write-side);
izgraditi kurirani prikaz (read-model) preko njega; prvo ispraviti gornja tri
nedostatka instrumentacije; isporučiti jedan globalni feed sa filterom po
akteru (odluka korisnika P3 — posebna stranica/kartica po vlasniku se ne
gradi).

---

## 1. Da li je `AuditEvent` ispravna osnova?

### Razmotrene opcije

| Opcija | Ocjena |
|---|---|
| **A. Ponovo iskoristiti postojeću stranicu revizije, samo je filtrirati** | Nedovoljno — ne hvata glasove uopšte (§0.1), a sirovi payload-i nisu prezentabilni (ispod). |
| **B. Nova `UserActivity` write-side tabela, dupli upis iz servisa** | Odbačeno. Udvostručava write putanju na ~102 mjesta, stvara dva izvora istine koja će se vremenom razići, i duplira podatke koji već imaju append-only garanciju. |
| **C. Kurirani read-model preko `AuditEvent`-a** ✅ | **Preporučeno.** Jedna write putanja, jedna istina, sloj prikaza koji se može mijenjati bez migracija. |

### Zašto sirovi podaci nisu prezentabilni — dokazi iz koda

- `proposal.voting.open` → `after: { contentHash, totalEligibleWeight, voters }` — beznačajno predsjedniku.
- `attendance.record` → `after: { partyId, present }` — subjekat je sirovi cuid.
- `document.publish` i `attachment.download` **nemaju `after` uopšte** — nije moguće prikazati naziv dokumenta bez join-a.
- `party.evote_consent.request` → `after: { email }` — **e-mail adresa sjedi u JSON blob-u.** Trenutna stranica ga ispisuje sirovo (`JSON.stringify(e.after)`). Kurirani prikaz to ne smije nikad raditi.
- Dobra vijest: `issue.report` → `after: { title, urgency }` **jeste** dovoljno za čitljiv jednoredni prikaz.

Dakle opcija C zahtijeva **renderer po akciji**, ne generičko JSON formatiranje — to je stvarni posao ovdje.

### Presedan već postoji u kodu

`getEVoteConsentHistory` (`src/server/services/evoteConsent.ts:93-119`) već radi upravo ovaj oblik: čitanje `AuditEvent`-a na nivou servisa, filtrirano po `zevId`, suženo po `targetType`/`targetId`, sa **eksplicitnom listom dozvoljenih akcija**, koje vraća domenski oblikovan objekat umjesto sirovih redova. Novi servis ovo generalizuje, ne izmišlja iznova.

### Zadržati obje stranice

`/podesavanja/audit` ostaje tehnički/forenzički prikaz (bez izmjena, PRESIDENT+ACCOUNTANT). Novi kurirani prikaz je posebna ruta. Služe različitim pitanjima — spajanje bi degradiralo oba.

---

## 2. Obuhvat: kategorizacija 102 postojeća koda akcije

Potvrđeno brojanje: **102 različita `action` koda** već postoje u
`src/server/services/*` i par API ruta. Predloženi model: svaki kod nosi
**kategoriju**, kurirani feed prikazuje `OWNER` + `GOVERNANCE` po
podrazumijevanom filteru.

### Kategorija `OWNER` — obična aktivnost vlasnika (suština zahtjeva)

Provjereno naspram stvarnih guard-ova u kodu:

| Akcija | Guard | Napomena |
|---|---|---|
| `issue.report` | `requireAnyUser` | ✅ vodeći primjer |
| `party.evote_consent.revoke` | `requireSelfOrRole(..., "PRESIDENT")` | ✅ vlasnik može sam povući |
| `party.update` | `requireSelfOrRole(id, "PRESIDENT")` | ✅ izmjena kontakta |
| `proxy.grant` | vlastita self-or-predsjednik provjera | ✅ |
| `proxy.revoke` | — | provjeriti guard u implementaciji |
| `document.download` | `requireAnyUser` | visok obim — vidi §5 |
| `attachment.download` | `requireAnyUser` | visok obim |
| `vote.submit` | nosilac tokena, bez actor-a | ⚠️ blokirano — vidi §7.1 |
| `auth.login`, `password_reset.*` | prije rezolucije tenanta | ⚠️ `zevId = NULL`, nevidljivo po tenantu |

**Ova lista je kratka i to treba iskreno reći naručiocu.** Bez preuzimanja
fajlova i bez popravljenog glasanja, vlasnik danas generiše tačno pet vrsta
evidentirane aktivnosti.

### Kategorija `GOVERNANCE` — akcije uprave od legitimnog interesa vlasnicima

≈37 kodova: `meeting.*`, `agenda.add`, `proposal.*`, `vote.manual_entry`,
`vote.correct`, `attendance.record`, `plan.*` (create/revise/propose/approve),
`issue.transition`, `issue.emergency*`, `issue.offer.*`, `work_order.*`,
`document.generate`, `document.publish`, `attachment.upload`,
`party.evote_consent.request`, `party.evote_consent.sign`, `office.*`,
`ownership.stake.add`, `ownership.transfer`, `occupancy.*`, `party.create`.

Zajedno sa `OWNER`, ovo je **~42 koda** za prevod (§4).

### Kategorija `FINANCE` — knjigovodstvo uprave (dostupno kroz filter, isključeno po default-u)

`invoice.*`, `invoice_batch.*`, `charge_item.*`, `payment.*`, `expense.*`,
`transaction.*`, `balance.correction`, `meter_reading.enter`,
`account.create`, `supplier.create`, `allocation_group.create`,
`report.export`, `project.create`. Ovo su stvarne akcije sa stvarnim akterima,
ali "šta je ovaj vlasnik radio" ne odgovara na `charge_item.update`.

### Kategorija `SYSTEM` — potpuno isključeno iz kuriranog prikaza

`auth.*`, `password_reset.*`, `approval_token.*`, `vote.verify.failed`,
`admin.tenant.*`, `user.*`, `setting.update`, `building.*`, `unit.*`,
`entrance.create`, `common_asset.create`, `voting_rule.create`.

### Test iscrpnosti — bitno

Lista dozvoljenih akcija znači da nova akcija u budućnosti tiho nikad neće
biti prikazana. Rješenje: novi test (`tests/activity-catalog.test.ts`, po
uzoru na `tests/documents-audit.test.ts`) koji grep-uje izvorni kod za sve
`action: "…"` literale i provjerava da je svaki eksplicitno klasifikovan.
Nova neklasifikovana akcija tada pada na testu umjesto da nestane neprimjetno.

---

## 3. Globalni feed (Faza 3 uklonjena — vidi Odluke korisnika)

**Preporuka: jedan prikaz — globalni feed sa filterom po akteru.** Prvobitno
predložena Faza 3 (posebna kartica po vlasniku na `/vlasnici/[id]`) je
uklonjena po odluci korisnika (P3): `akter` filter na globalnom feedu
pokriva istu potrebu ("predsjednik filtrira po osobi") bez nove rute,
nove komponente ili nove tabele guard-ova.

### Globalni feed — `/aktivnosti`

Nova ruta na vrhovnom nivou, ne pod `/podesavanja`. `/podesavanja/audit`
ostaje "podešavanja/usklađenost" kutak; novi feed odgovara na svakodnevno
pitanje ("šta se dešavalo ove sedmice"). Link dodati na
`src/app/(app)/podesavanja/page.tsx` pored postojećeg dugmeta "Revizorski
trag".

### `akter` filter pokriva potrebu za prikazom po osobi

Predsjednik otvori `/aktivnosti` i izabere osobu u `akter` selektu (§5) — isti
rezultat kao poseban prikaz po vlasniku, bez dodatne stranice. Nema
self-service prikaza vlasniku: pristup je isključivo PRESIDENT (§6, odluka
P4), pa se pitanje "vlasnik vidi svoju stranicu" i ne postavlja za v1.

### Ograničenje koje ostaje: `AuditEvent` nema "subjekta" (party)

`akter` filter radi preko `actorId` (`User.id`) — filtrira po tome **ko je
izvršio** radnju, ne po tome **o kome** je radnja. Mnogi vlasnici nemaju
korisnički nalog uopšte, a neki relevantni događaji su akcije predsjednika
*o* vlasniku (`party.evote_consent.sign`, `attendance.record`,
`ownership.stake.add`) — ti se pojavljuju pod akterom "predsjednik", ne pod
vlasnikom. Ovo je svjesno prihvaćen propust za v1 (isti propust koji bi
imala i bivša Faza 3 bez dodatne kolone).

- **Kasnije (opciono, Faza 3 stavka u §8):** dodati `subjectPartyId String?`
  na `AuditEvent`, pa `akter` filter proširiti da pretražuje i po njemu.
  Dodavanje nullable kolone je bezbjedno na ovoj tabeli — append-only triger
  se aktivira samo na `UPDATE`/`DELETE`, ne na `ALTER TABLE ADD COLUMN`.
  Istorijski redovi ostaju `NULL`, što je korektno.

---

## 4. Prevod i označavanje

### Zamka na koju treba paziti

`tEnum(group, value)` poziva `t(\`${group}.${value}\`)`, a `t()` **dijeli
ključ po tačkama i hoda kroz ugniježđeni objekat** rječnika. Dakle
`tEnum("auditAction", "vote.submit")` traži putanju
`["auditAction","vote","submit"]` — **ravan** ključ
`auditAction: { "vote.submit": "…" }` se nikad ne bi razriješio.

**Rješenje: ugniježđeni oblik** — `auditAction: { vote: { submit: "…" },
issue: { report: "…" } }`. Ne zahtijeva nikakvu izmjenu
`src/lib/i18n/index.ts`, a ugnježđavanje prirodno prati postojeće
tačka-odvojene kodove (uklj. trostepene poput
`party.evote_consent.sign`).

### Konkretan rad na rječniku

U `src/lib/i18n/sr-Latn.ts` (i `en.ts`), dvije nove grupe pored postojećih
(`invoiceStatus`, `issueStatus`, ...):

```
auditAction: {
  issue:  { report: "Prijavio/la kvar", transition: "Promijenio/la status prijave", … },
  vote:   { submit: "Glasao/la elektronski", manual_entry: "Glas evidentiran ručno", correct: "Ispravka glasa" },
  party:  { update: "Ažurirao/la kontakt podatke",
            evote_consent: { sign: "Potpisana saglasnost za e-glasanje",
                             revoke: "Povučena saglasnost za e-glasanje",
                             request: "Zatražena saglasnost za e-glasanje" } },
  document: { generate: "Kreiran dokument", publish: "Dokument objavljen vlasnicima", download: "Preuzeo/la dokument" },
  attachment: { upload: "Postavio/la dokument", download: "Preuzeo/la dokument" },
  proxy:  { grant: "Data punomoć", revoke: "Povučena punomoć" },
  …
},
activityCategory: {
  OWNER: "Aktivnost vlasnika",
  GOVERNANCE: "Upravljanje i skupština",
  FINANCE: "Finansije",
  SYSTEM: "Sistemski događaji",
},
```

### Fallback ponašanje — mora biti eksplicitno

`t()` se vraća na **sami ključ** kad prevod ne postoji, pa bi neprevedeni kod
inače prikazao `auditAction.vote.submit` — **gore** nego sadašnji sirovi
`vote.submit`. Rješenje: helper `labelForAction(action)` u
`src/lib/activity/catalog.ts` koji poziva `tEnum`, prepoznaje kad je vraćen
puni ključ (promašaj), i tada vraća `{ label: action, translated: false }`.
UI takav slučaj prikazuje istim prigušenim monospace stilom kao danas —
nova akcija nikad ne prikazuje prazninu ili sirovi ključ sa tačkama.

### Prikaz jednorednog rezimea

Odvojeno od labele, katalog nosi opcioni `summarize(event)` po akciji koji
pretvara payload u jednu čitljivu rečenicu — npr. `issue.report` →
`after.title`; `issue.transition` → `tEnum("issueStatus", before.status) →
tEnum("issueStatus", after.status)`. Akcije bez summarizer-a prikazuju samo
labelu. **Nikad `JSON.stringify(after)`** — vidi curenje e-maila u §1.

---

## 5. Filtriranje, pretraga, paginacija

### Ustaljeni stil u projektu (provjereno)

`src/app/(app)/izvjestaji/page.tsx` je najbliži uzor: obična `<form>` sa
`<input type="date" name="from">`/`name="to"`, `searchParams` promise,
`defaultValue`, bez client-side state-a, `endOfDay()` iz `src/lib/i18n` za
uključivu gornju granicu. Pratiti isti obrazac.

### Nedostatak indeksa — preduslov, ne opcija

`AuditEvent` ima samo `@@index([targetType, targetId])` i
`@@index([action])`. **Nema indeksa na `zevId` niti na `createdAt`.**
Trenutni upit (`where: { zevId }, orderBy: { createdAt: "desc" }, take: 200`)
je sekvencijalno skeniranje plus potpuno sortiranje cijele platformske
audit tabele, na append-only tabeli koja samo raste. Dodavanje paginacije
preko toga pogoršava, ne popravlja.

Potrebna migracija prije bilo čega od ovoga:

```sql
CREATE INDEX "AuditEvent_zevId_createdAt_idx"          ON "AuditEvent" ("zevId", "createdAt" DESC);
CREATE INDEX "AuditEvent_zevId_actorId_createdAt_idx"  ON "AuditEvent" ("zevId", "actorId", "createdAt" DESC);
```

### Predloženi oblik upita

```
where: {
  zevId,                                    // requireZev(actor) — nikad opciono
  action: { in: actionsForCategories(cats) },
  createdAt: { gte: from, lte: endOfDay(to) },
  ...(actorUserId ? { actorId: actorUserId } : {}),
}
orderBy: { createdAt: "desc" }
skip: (page - 1) * PAGE_SIZE
take: PAGE_SIZE            // 50
```
plus paralelni `prisma.auditEvent.count({ where })` za broj stranica.

**Offset, ne cursor.** Obrazloženje: obim po tenantu je ograničen (jedan ZEV
generiše stotine do nekoliko hiljada događaja mjesečno, ne miliona);
obavezan vremenski prozor drži offset plitkim; brojevi stranica su korisniji
od beskonačnog skrola za "pokaži mi prošli mart"; a `orderBy: createdAt`
nije jedinstven pa bi cursor na `id` trebao stabilan tiebreak koji `cuid()`
daje samo približno.

**Podrazumijevani vremenski prozor: zadnjih 30 dana.** Ovo, ne granica od
200 redova, je ono što čini stranicu ograničenom.

### Filteri

| Parametar | Kontrola | Podrazumijevano |
|---|---|---|
| `from` / `to` | dva `type="date"` polja | zadnjih 30 dana |
| `kat` (kategorija) | multi-checkbox ili `<select>` | `OWNER,GOVERNANCE` |
| `akter` | `<select>` članova ovog tenanta | svi |
| `q` | slobodan tekst | vidi ispod |
| `str` (stranica) | prev/next + stranica N od M | 1 |

**Ukloniti pretragu po podstringu na `action`.** Trenutni `q` box radi
`contains` na `action`/`targetType`, tj. pretražuje *engleske kodove* na
*srpskoj* stranici — predsjednik koji ukuca "glasanje" ne dobija ništa.
Zamijeniti sa `kat`/`akter` selektorima. Ako je slobodan tekst i dalje
poželjan, ograničiti ga na `reason` polje (stvarno ljudski pisan tekst).

### Novа dijeljena komponenta

`src/components/ui.tsx` nema primitivu za paginaciju. Dodati mali
`Pagination({ page, pageCount, hrefFor })` tamo, da je dijele i ova i buduće
stranice.

---

## 6. Pristup i privatnost

### Kapije po ulozi

| Prikaz | Guard | Obrazloženje |
|---|---|---|
| `/aktivnosti` globalni feed | `requireActor("PRESIDENT")` | **Odluka korisnika (P4): samo predsjednik.** Uže od postojeće stranice revizije (`/podesavanja/audit`, ostaje `PRESIDENT`+`ACCOUNTANT`, bez izmjene) — kurirani feed je namijenjen isključivo predsjedniku, ne računovođi. |

Nema posebnog prikaza po vlasniku niti self-service prikaza vlasniku (bivše
Faza 3 stavke) — oboje uklonjeno odlukama P3 i P4 (vidi §3, §"Odluke
korisnika" na vrhu dokumenta).

### Pitanja privatnosti koja treba svjesno riješiti

**(a) Izbor glasa — najoštrije pitanje. Riješeno odlukom korisnika (P2), i to
strože od originalne preporuke.** Glasanje u ZEV-u nije zakonski tajno, ali
**slučajno pregledljiv feed po osobi** koji kaže "Marko Marković — glasao
PROTIV" je suštinski drugačiji od formalne liste glasanja vezane za zapisnik
sjednice. Umjesto da se `choice` samo sakrije u UI-ju (originalna preporuka),
korisnik je odlučio da se `choice` **uopšte ne piše** u `after` payload
`vote.submit` audit zapisa (§7.1) — kurirani feed prikazuje samo "Glasao/la
elektronski". Izbor ostaje ispravno sačuvan u `Vote` tabeli, za prebrojavanje
i formalnu listu glasanja.

**(b) Efekat filtera po osobi.** Predsjednik već može vidjeti svaku prijavu
kvara na `/odrzavanje`, pa nijedna pojedinačna činjenica nije novo izložena.
Ono što *jeste* novo je mogućnost da se `akter` filter na `/aktivnosti`
iskoristi kao vremenska linija po osobi: čini obrasce vidljivim ("ovaj
vlasnik prijavljuje žalbu svaki mjesec") koje nijedan postojeći ekran ne
prikazuje. Korisnik je svjesno odabrao ovaj oblik (filter, ne posebna
agregisana stranica — P3), pa je ova promjena karaktera funkcionalnosti već
razmotrena i prihvaćena, ne samo nuspojava.

**(c) Curenje payload-a.** `party.evote_consent.request` čuva e-mail u
`after`; `vote.submit` nosi `ipHash`. Kurirani renderer mora biti lista
dozvoljenih polja po akciji — nikad passthrough. `ipHash`/`userAgent` se ne
smiju pojaviti u ovom prikazu (ostaju na forenzičkoj stranici).

**(d) Nema brisanja.** Append-only triger znači da se profil aktivnosti po
osobi nikad ne može obrisati ili ispraviti. Ovo je već tačno za audit trag,
ali funkcionalnost *brendirana* kao dnevnik po osobi privlači zahtjev za
brisanje podataka koji sistem arhitektonski ne može zadovoljiti. Vrijedi
jedna rečenica u `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md`.

---

## 7. Nedostaci instrumentacije (provjereno na mjestima poziva)

### 7.1 `vote.submit` — blokira implementaciju, mora se popraviti

`meetings.ts:719` poziva `audit(null, {...})`. Posljedica: `zevId: null`,
`actorId: null`. Okolni kod već zna oba potrebna podatka (`p.zevId` i
`voterParty.id`), samo nema način da ih proslijedi jer `audit()` izvodi
`zevId` samo iz `Actor` objekta.

**Predložena ispravka (mala, hirurška):** proširiti `AuditInput` u
`src/server/audit.ts` opcionim `zevId?: string` i `subjectPartyId?: string`
poljima za anonimne-ali-tenant-poznate tokove, sa komentarom da su namijenjena
isključivo takvim slučajevima. Zatim `submitVote` prosljeđuje
`zevId: p.zevId`, `subjectPartyId: voterParty.id`. **Istom izmjenom, ukloniti
`choice: input.choice` iz `after` objekta** (odluka korisnika P2, vidi §6a) —
`choice` se više ne piše ni u jedan `AuditEvent`, ne samo da se ne prikazuje.

**Razmotrena alternativa:** čitati glasove iz `Vote` tabele umjesto iz
`AuditEvent`-a (ima `zevId`, `voterId`, `choice`, sopstveni append-only
guard). Radi već danas bez izmjene `audit()`-a, i jedini je način da se
prikažu *istorijski* glasovi. Nedostatak: globalni feed postaje unija dvije
tabele, što se ne paginira čisto preko offset-a.
**Preporuka:** uraditi `audit()` ispravku za nove glasove; ako se žele
istorijski glasovi, dodati read-side spajanje iz `Vote` kao Fazu 4 stavku.

### 7.2 `attachment.upload` — pitanje obuhvata, ne bag

Vlasnik trenutno **ne može** uploadovati dokument (guard je
PRESIDENT/ACCOUNTANT). "Uploading documents" kao aktivnost vlasnika ne
postoji da bi se evidentirala — bila bi nova funkcionalnost. Kao aktivnost
uprave, već se evidentira dovoljno dobro za jednoredni prikaz.

### 7.3 Payload-i koji nedostaju

- `document.publish` — nema `after` uopšte. **Preporuka:** dodati
  `after: { type: d.type, number: d.number, title: d.title }`.
- `attachment.download` i `document.download` — nema `after`, i **visok
  obim** (svaki pregled PDF-a piše red). **Preporuka:** klasifikovati kao
  `OWNER`, ali **isključeno po default-u**, iza checkbox-a "prikaži
  preuzimanja".

### 7.4 `issue.report` — dobre vijesti, provjereno

`after: { title, urgency }` je dovoljno za "Prijavio/la kvar: *Curi voda u
podrumu* (Hitno)". Nije potrebna izmjena. Opciono obogaćenje: dodati
`unitId`/`buildingId` da se lokacija prikaže bez dodatnog join-a.

### 7.5 `actorLabel` je mrtvo polje

Nijedno mjesto u kodu ne prosljeđuje `label`, `Actor` tip nema to polje.
Trenutno ime se dobija samo preko živog join-a na `Membership → User.email`,
što se pokvari kad član napusti ZEV. **Preporuka:** budući da
`requireActor()` već vraća `displayName`/`email`, ili proširiti `Actor` sa
opcionim `label` i popuniti ga tamo, ili proširiti tip koji `audit()`
prihvata. Ovo čini log čitljivim i nakon što član ode.

### 7.6 Nedostatak indeksa

Vidi §5 — `@@index([zevId, createdAt])` je preduslov.

---

## 8. Fazni plan implementacije (za pregled — nije kod)

Po ustaljenom pravilu projekta: svaka faza nosi CHANGELOG unos i potvrđen
version bump sa korisnikom (patch dok se faza dorađuje, minor po završenoj
fazi).

### Faza 1 — temelji (bez vidljive promjene za korisnika)
1. `prisma/schema.prisma` — dodati `@@index([zevId, createdAt])` i
   `@@index([zevId, actorId, createdAt])` na `AuditEvent`.
2. Nova migracija — dva `CREATE INDEX` iskaza.
3. `src/server/audit.ts` — dodati opcione `zevId`/`subjectPartyId` na
   `AuditInput`; popuniti `actorLabel` iz prikazanog imena aktera.
4. `src/server/services/meetings.ts:719` — proslijediti `zevId`/
   `subjectPartyId` na `vote.submit` i **ukloniti `choice` iz `after`**
   (odluka korisnika P2, §7.1).
5. `src/server/services/documents.ts:187` — dodati `after` na
   `document.publish`.
6. Testovi — proširiti `tests/voting.test.ts` i
   `tests/tenant-isolation.test.ts` da provjere da predat glas sada
   proizvodi `zevId`-označen, party-atribuiran `AuditEvent` **bez `choice`
   polja u `after`**.

### Faza 2 — katalog + globalni feed
7. `src/lib/activity/catalog.ts` (novo) — klasifikacija 102 koda,
   `labelForAction()` sa fallback-om, `summarize()` po akciji,
   `actionsForCategories()`.
8. `src/lib/i18n/sr-Latn.ts` + `en.ts` — ugniježđena `auditAction` grupa
   (~42 kurirana koda) i `activityCategory` grupa.
9. `src/server/services/activity.ts` (novo) —
   `listActivity(actor, { from, to, categories, actorUserId, page })`
   (`actorUserId` = `akter` filter iz §5, filtrira po `AuditEvent.actorId`),
   `requireZev` na svakom čitanju, po uzoru na `getEVoteConsentHistory`.
10. `src/components/ui.tsx` — dodati `Pagination`.
11. `src/app/(app)/aktivnosti/page.tsx` (novo) — server-rendered forma
    filtera + tabela.
12. `src/app/(app)/podesavanja/page.tsx` — link pored postojećeg dugmeta
    "Revizorski trag"; dodati stavku menija.
13. `tests/activity-catalog.test.ts` (novo) — test iscrpnosti (§2).

> **Bivša Faza 3 (prikaz po vlasniku + self-service) je u cijelosti uklonjena**
> odlukama korisnika P3 i P4 — vidi §3 i §"Odluke korisnika" na vrhu
> dokumenta. `akter` filter iz Faze 2 pokriva istu potrebu.

### Faza 3 — opciono doterivanje (bivša Faza 4, prenumerisana)
14. `subjectPartyId` kolona + migracija, ako se `akter`-only (`actorId`)
    filter pokaže preuzak za praksu (§3).
15. Prikaz istorijskih glasova preko read-side spajanja sa `Vote` (§7.1).
16. Obogaćenje `issue.report` payload-a lokacijom.
17. `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` — zabilježiti odluke o
    nemogućnosti brisanja i skrivanju izbora glasa.

---

## Pitanja za tebe prije nego što krenemo u implementaciju (ODGOVORENO — vidi §"Odluke korisnika" na vrhu dokumenta)

- **P1.** "Uploading documents" — da li si mislio na predsjednika koji
  uploaduje (radi već danas) ili vlasnika koji uploaduje (ne postoji danas —
  posebna funkcionalnost)? Vidi §7.2.
- **P2.** Da li sakriti izbor glasa u feedu, prikazujući samo da je osoba
  glasala? Vidi §6(a).
- **P3.** Da li je agregisani prikaz po osobi (§6b) namjeravan, ili je
  dovoljan samo globalni hronološki feed?
- **P4.** Da li ACCOUNTANT treba da vidi kurirani feed, ili samo PRESIDENT?

---

### Ključni fajlovi za implementaciju
- `src/server/audit.ts`
- `src/server/services/meetings.ts`
- `prisma/schema.prisma`
- `src/lib/i18n/sr-Latn.ts`
- `src/app/(app)/podesavanja/audit/page.tsx`
- `src/server/services/evoteConsent.ts` (uzor za novi `activity.ts` servis)
