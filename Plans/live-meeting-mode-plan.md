# Sjednica uživo — vođenje skupštine sa telefona (prozivka, glasanje po tačkama, rezultati u realnom vremenu) — plan za pregled

**Status: ODLUKE DONESENE (2026-09-23) — spreman za faznu implementaciju.** Nijedan red koda nije još napisan; ovaj dokument je ažuriran da odražava odluke ispod prije nego što implementacija počne.
Nastalo na zahtjev korisnika (2026-09-23): predsjedniku treba alat kojim, stojeći u sali, sa telefona, vodi skupštinu — evidentira ko je došao, unosi rezultate glasanja po tačkama dnevnog reda, automatski šalje e-glasačke linkove samo onima kojih **nema** u sali, i gleda kako rezultat raste u realnom vremenu. Izričit dodatni zahtjev: **to mora biti poseban, namjerno uključen režim, bez značajnog uticaja na standardni UI na velikom ekranu.**

Izrađeno plan-only prolazom (Opus), zasnovano na stvarnom čitanju koda — svaka tvrdnja ispod je vezana za fajl i liniju. Ciljna publika je ista kao u `Plans/ui-ux-redesign-plan.md:16-19`: netehnički, često stariji korisnici, u finansijsko-pravnom softveru gdje jedan pogrešan klik zatvara glasanje. Ovdje se tome dodaje novi kontekst koji dosad nije postojao ni na jednom ekranu aplikacije: **korisnik stoji, drži telefon jednom rukom, ispred njega je 40 ljudi koji čekaju.** To je, a ne estetika, razlog za svaku odluku u §3.

## Odluke korisnika

Donesene 2026-09-23, kao odgovor na pitanja iz §8 (izvorna pitanja ostaju dolje, radi konteksta):

- **P1 — Saglasnost i punomoć: OBA.** Kad odsutnog vlasnika zastupa punomoćnik, elektronski kanal (korpa B, §2.1) se otvara samo ako **i** vlasnik **i** punomoćnik imaju `eVoteConsentStatus = "SIGNED"` i e-mail. Nedostatak bilo kog od dva svodi tog glasača u korpu C.
- **P2 — Odsutan bez saglasnosti (korpa C): DA.** Ostaje u glasačkoj bazi i u imeniocu kvoruma; ne dobija e-mail; predsjednik mu naknadno može unijeti papirni (`PAPER`) glas.
- **P3 — Upravni odbor: NE, van obima prve verzije.** Režim uživo je za sada isključivo za `body = "ASSEMBLY"` sjednice.
- **P4 — Ulazna tačka: zasebna ruta.** `/uzivo/[meetingId]`, sopstvena minimalna školjka, izvan `(app)`.
- **P5 — Status sjednice: DA.** Mora postojati mogućnost da se glasanje pokrene direktno iz režima uživo, bez povratka na desktop — uključujući jednim tapom prelazak `Meeting.status` u `VOTING_OPEN` kad sjednica još nije tamo. Razrađeno u §2.6 (novo) i §3.4.
- **P6 — Interval osvježavanja: 10 sekundi.** Potvrđena preporuka iz §2.3, bez izmjene.
- **P7 — Ko smije da koristi režim: PRESIDENT i ACCOUNTANT.** Ovo je **stvarna izmjena ovlašćenja u servisnom sloju**, ne samo u UI-ju režima uživo — razrađeno u novom §2.7, jer widening pogađa i postojeće desktop stranice koje pozivaju iste funkcije.
- **P8 — Dizanje ruku: DA, glas ide po osobi.** Potvrđena preporuka (i) iz §3.4, bez izmjene.
- **P9 — Punomoć sa telefona: samo prikaz već evidentiranih.** Kreiranje nove punomoći iz režima uživo ostaje van obima prve verzije (bez izmjene u odnosu na plan).
- **P10 — Stara kartica prisustva: ostaje netaknuta.** `/skupstina/[id]`-ova postojeća kartica „Prisustvo (za sjednicu uživo)” se ne dira ni u ovoj fazi.
- **P11 — Novi primitiv `SegmentedAction`: ODOBREN.** Gradi se u `ui.tsx`, po pravilima iz §3.3, kao formalna dopuna `Plans/design-system.md`.

---

## 0. Rezime — tri najvažnija nalaza

1. **Veza koju ova funkcionalnost treba da napravi danas uopšte ne postoji u modelu.** `Attendance` je vezan za sjednicu (`prisma/schema.prisma:570-580`, unique `[meetingId, partyId]`), a `EligibleVoter`/`Vote` za prijedlog (`:682`, `:746`). `openVoting` (`src/server/services/meetings.ts:472`) **ni jednom ne pogleda `Attendance`** — formira glasačku bazu iz `ownersVotingBasis`/`boardVotingBasis` (`:510`) i onda bezuslovno pošalje e-mail sa ličnim linkom **svakome** (`:617-636`). Predsjednik koji sjedi u sali sa svojih 40 vlasnika danas svima njima pošalje e-mail. To je jedina suštinska domenska praznina koju ovaj plan zatvara; sve ostalo je UI.

2. **Postojeća kartica „Prisustvo (za sjednicu uživo)” nije rješenje koje treba doraditi — ona je uzorak onoga što ne radi.** `src/app/(app)/skupstina/[id]/page.tsx:264-293`: jedan `<select>` sa svim licima, jedan checkbox, jedno dugme, jedan server action po osobi (`:117-127`). Za 40 vlasnika to je 40 puta: otvori dropdown → skroluj kroz 40 imena → nađi ime → potvrdi → čekaj odgovor servera. Bez pretrage, bez „koga još nisam prozvao”, bez brojača kvoruma, bez ijedne naznake dokle se stiglo. Naziv kartice tvrdi da je to alat za sjednicu uživo; funkcionalno je to obrazac za naknadni unos zapisnika za jednu osobu. Zamjena, ne dorada.

3. **„Realno vrijeme” u ovom stacku ne traži novu infrastrukturu — i ne smije je tražiti.** U cijelom `src/` nema ni SSE, ni websocket, ni pub/sub; jedini `router.refresh()` u aplikaciji je `src/components/pdf-statement-import.tsx:90`, a `setInterval` ne postoji nigdje. Za salu sa nekoliko desetina glasača, „realno vrijeme” je periodični `router.refresh()` iz malog client komponenta. Ključna tehnička činjenica koja to čini **boljim**, a ne samo jeftinijim, rješenjem: `router.refresh()` ponovo izvršava server komponente, ali **čuva stanje client komponenti i poziciju skrola** — dakle ekran koji se sam osvježava ispod predsjednikovog palca neće mu poništiti upisano u polje za pretragu ni odskočiti na vrh liste. Fetch + ručno stanje (opcija B u §2.3) tu garanciju nema besplatno.

---

## 1. Zatečeno stanje — šta tačno postoji

### 1.1 Dvije nezavisne mašine stanja, i to je važno

`Meeting.status` ima 10 linearnih koraka (`MEETING_STATUS_ORDER`, `skupstina/[id]/page.tsx:16-19`; ista lista kao `MEETING_FLOW`, `meetings.ts:21-25`). `advanceMeetingStatus` (`meetings.ts:79-95`) samo zapisuje status i auditira ga; unazad traži razlog (`:86-88`).

**Nalaz koji je bitan za aktivaciju režima:** status sjednice **nije kapija ni za šta u glasanju**. `openVoting` provjerava isključivo `p.status !== "DRAFT"` (`meetings.ts:488`) i da postoji `closesAt` iz `p.votingClosesAt ?? p.meeting.eVoteClosesAt` (`:491-492`). Ne postoji nijedna provjera `meeting.status`. Isto važi za `recordAttendance` (`:111-125`) i `createProposal` (`:192`). Meeting status je, u odnosu na glasanje, **deklarativna oznaka faze za ljude**, a stvarnu kapiju drži `Proposal.status` (`DRAFT → VOTING_OPEN → ACCEPTED|REJECTED`).

Posljedica za ovaj plan: režim uživo **ne smije** uvoditi novu tvrdu zavisnost od `meeting.status` (to bi bila nova pravna kapija koje danas nema), ali **smije** ga koristiti da odluči da li uopšte prikazuje ulazno dugme.

### 1.2 `openVoting` — šta tačno radi

Jedna interaktivna transakcija sa `timeout: 20000` (`meetings.ts:483`, `:614`; produženo jer je Prisma default od 5 s pucao na Neonu, `:477-482`):

1. zamrzne prijedlog: `contentHash`, `ruleSnapshot`, `status: "VOTING_OPEN"`, `frozenAt` (`:550-562`)
2. izgradi bazu: `boardVotingBasis` za `body === "BOARD"`, inače `ownersVotingBasis` sa opcionim scope-om jedinica (`:497-513`)
3. po svakom glasaču: težina preko `computeVoterWeight` (`:523`), aktivna punomoć preko `activeProxyFor` (`:526`, punomoći nema kod odbora), pa `EligibleVoter` + `ApprovalToken` + audit `approval_token.issue` (`:569-595`)
4. **van transakcije**, serijski, `queueNotification` za svakog ko ima e-mail (`:617-636`). Primalac je `proxyEmail ?? email` (`:600`) — punomoćnik, ako postoji, inače vlasnik.

Nigdje se ne konsultuje `Attendance` niti `Party.eVoteConsentStatus`.

### 1.3 Ručni unos glasa

`recordManualVote` (`meetings.ts:956-1002`) prima **jedan** `eligibleVoterId` + izbor + kanal `PAPER | IN_PERSON`. Odbija ako prijedlog nije `VOTING_OPEN` (`:970`) i ako taj glasač već ima važeći glas (`:971-974`). Piše `Vote` i audit `vote.manual_entry` (`:993-999`). Kroz UI se poziva iz jednog obrasca sa 4 polja (`skupstina/prijedlog/[id]/page.tsx:453-477`).

Bitna posljedica koja radi u našu korist: **`EligibleVoter` red postoji tek nakon `openVoting`.** Znači, redoslijed u sali je nužno: prozivka → otvori glasanje za tačku → tek onda unos glasova iz sale.

### 1.4 Rezultati

`computeProposalResult` (`:1064-1077`) se računa na zahtjev iz `ruleSnapshot` + `effectiveVotes` (`:1055-1062`, ispravke potiskuju original). Ništa se ne kešira i ništa se ne gura klijentu. Jedini prikaz danas je `serializeResult(...)` na `prijedlog/[id]/page.tsx:222`, izračunat pri svakom renderu stranice — dakle **svježe je, ali samo kad korisnik ručno osvježi stranicu.** `closeVoting` (`:1079-1109`) zamrzne isti taj izračun i istekne neiskorišćene tokene.

### 1.5 Saglasnost za e-glasanje

`Party.eVoteConsentStatus` je običan `String` sa `@default("NONE")` (`schema.prisma:102`), vrijednosti `NONE | PENDING | SIGNED | REVOKED` (`evoteConsent.ts:13`). `SIGNED` se postavlja tek kad predsjednik/računovođa priloži skeniranu potpisanu izjavu (`evoteConsent.ts:26-59`). To je **jedini** zapis u sistemu koji znači „ovo lice je registrovano za elektronsko glasanje”, i to je ono na šta korisnik misli u zahtjevu. Danas `openVoting` tu vrijednost ne čita.

### 1.6 Notifikacije

`queueNotification` (`src/server/notifications/service.ts:9-47`) upiše `NotificationMessage` i **odmah sinhrono** pozove `dispatchNotification` (`:43-46`, komentar priznaje da bi pravi deployment imao worker). Status poruke je čitljiv (`QUEUED/SENT/DELIVERED/FAILED`), a `testOutbox.ts:77-103` već zna da izvuče token/kod/link i spoji ih sa živim `ApprovalToken.status` — gotova infrastruktura za odgovor na pitanje „je li e-mail zaista otišao”, koja se u režimu uživo koristi kao dijagnostika, ne kao prikaz tajni (gejt `isTestOutboxEnabled()`, `:38-43`).

### 1.7 Dizajn sistem i školjke

`Plans/design-system.md` je izvor istine (§1 tokeni, §2 tipografska skala, §3.5 tri nivoa elevacije i zabrana ugnježđavanja, §4.2 stablo odlučivanja za šest težina dugmadi, §5 ručno crtane ikone). `CLAUDE.md:23-25` izričito traži da se novi obrazac, ako je zaista potreban, **predloži sa obrazloženjem**, a ne improvizuje — §3.3 ovog plana je taj prijedlog.

Presedan za „drugačija, minimalna školjka za drugačiji kontekst” već postoji: `src/app/glasanje/[token]/page.tsx` živi **izvan** `(app)` grupe, pa ne dobija `NavShell` (`src/app/(app)/layout.tsx` ga omotava oko svega unutar grupe), a `src/components/auth-shell.tsx:1-7` u komentaru objašnjava upravo tu odluku za `/login`, `/zaboravljena-lozinka`, `/reset-lozinka`.

Presedan za „client red koji prima server action kao prop i komponuje primitive iz `ui.tsx`” takođe postoji i ustaljen je: `src/components/unit-row.tsx:1-45`, `src/components/charge-item-row.tsx:1-30`, `src/components/building-row.tsx`.

---

## 2. Odluke — razmotrene opcije i preporuke

### 2.1 Kako prisustvo određuje kanal glasanja

**Semantika koju model već nosi, i koju ne treba mijenjati.** `Attendance.viaProxyId` je komentarisan kao „`Proxy.id` when represented” (`schema.prisma:576`). Dakle red `(meetingId, partyId = Marko, present = true, viaProxyId = <Proxy.id>)` znači *„Marko se računa prisutnim, zastupa ga njegov punomoćnik”*. Iz toga slijedi jedino konzistentno pravilo, bez ijedne izmjene šeme:

> **Glasač je „u sali” ako i samo ako postoji `Attendance` red sa `present = true` za `EligibleVoter.ownerId`** — sa punomoćnikom ili bez njega.

Punomoćnik koji je fizički u sali, a sam nije vlasnik, **ne dobija svoj `Attendance` red** — on nije glasač; njegovo prisustvo se izražava kroz `viaProxyId` na redu vlasnika kojeg zastupa. Punomoćnik koji **jeste** i sam vlasnik ima svoj zaseban red, za svoj glas. Ovo je važno napisati jer je to jedino tumačenje koje ne dvostruko broji ljude.

U trenutku otvaranja glasanja glasačka baza se dijeli na tri korpe:

| Korpa | Uslov | Šta se dešava |
|---|---|---|
| **A — u sali** | `Attendance.present = true` za `ownerId` | `EligibleVoter` + token se kreiraju kao i danas, **e-mail se ne šalje**, očekuje se ručni unos kanalom `IN_PERSON` |
| **B — odsutan, registrovan za e-glasanje** | nema reda ili `present = false`, i **vlasnik i njegov eventualni punomoćnik** (kad postoji) oboje imaju `eVoteConsentStatus = "SIGNED"` i e-mail — vidi P1 u §Odluke korisnika | **e-mail se šalje**, tačno kao danas |
| **C — odsutan, nije registrovan (ili nema e-mail)** | ostatak | `EligibleVoter` + token se kreiraju, **e-mail se ne šalje**, lice ostaje u bazi i u imeniocu kvoruma |

**Korpa C je najosjetljivija odluka u cijelom planu i mora biti izričita:** to lice se **ne izbacuje iz glasačke baze**. Izbacivanje bi smanjilo `totalEligibleWeight` u `ruleSnapshot` (`meetings.ts:547`), što bi automatski snizilo prag kvoruma i prag većine u `computeVotingResult` (`src/server/engines/voting.ts:64-80`) — to jest, *tiho bi promijenilo pravni ishod glasanja u korist onoga ko je odsutne isključio*. To je neprihvatljivo. Oni ostaju u bazi, jednostavno ne glasaju — i predsjednik ih vidi kao zaseban, imenovan spisak, uz mogućnost naknadnog `PAPER` unosa (`recordManualVote` prima bilo koji `EligibleVoter`).

**Kad se to računa — uživo ili uz potvrdu?**

| Opcija | Za | Protiv |
|---|---|---|
| (a) Računa se uživo u trenutku `openVoting`, bez pitanja | najmanje koraka | predsjednik ne vidi šta šalje dok ne pošalje; `openVoting` je nepovratan (zamrzava prijedlog) |
| (b) Obavezan korak potvrde sa tri broja prije slanja | predsjednik vidi „18 u sali · 9 dobija e-mail · **4 nemaju nijedan kanal**” prije nepovratne radnje | jedan tap više |
| (c) Zasebna „priprema slanja” stranica | najviše kontrole | prespor tok za salu; još jedan ekran |

**Odluka: (b).** Računa se uživo iz `Attendance` u trenutku poziva, ali uvijek iza `ConfirmAction` (`ui.tsx:525`), čiji `body` nosi tri broja. To nije improvizacija — docstring te komponente (`ui.tsx:517-524`) doslovno kaže da je `body` mjesto za ono što korisnik mora znati *u trenutku odluke* (i navodi „sažetak kvoruma” kao primjer). Isti obrazac već stoji na zatvaranju glasanja (`prijedlog/[id]/page.tsx:245-262`).

U taj panel ide i najkorisnija sigurnosna provjera cijele funkcionalnosti: **da li je kvorum uopšte dostižan** iz zbira težina korpi A i B. Ako nije, panel to kaže u amber tonu prije otvaranja, jer poslije toga je kasno — prijedlog je zamrznut.

**Šta ako se prisustvo mijenja poslije otvaranja glasanja?** Poslana pošta se ne može povući. Prihvata se, uz dvije mjere: (1) čim bilo koji prijedlog sjednice pređe u `VOTING_OPEN`, na kartici prozivke stoji trajna napomena da izmjene prisustva više ne utiču na već poslane linkove; (2) izlaz za nuždu već postoji i ne piše se nanovo — `reissueToken` (`meetings.ts:664-715`) poništi stari i pošalje novi link onome ko je u međuvremenu izašao iz sale. Obrnut slučaj (neko uđe u salu nakon što je dobio link) rješava se sam: ako još nije glasao, predsjednik mu unese glas iz sale; ako jeste, `recordManualVote` odbija dupli glas (`:971-974`) — što je tačno ponašanje.

### 2.2 Da li se mijenja `openVoting` ili se piše novi put

| Opcija | Za | Protiv |
|---|---|---|
| (a) Filtriranje po prisustvu postaje **podrazumijevano** ponašanje `openVoting` | nema nove površine | tiho mijenja ponašanje za svakog postojećeg pozivaoca, uključujući čisto elektronske sjednice gdje `Attendance` redovi mogu postojati iz sasvim drugog razloga; regresija koja se primijeti tek kad neko ne dobije e-mail |
| (b) `openVoting` dobija **opcioni `opts.delivery`**, podrazumijevano = današnje ponašanje | jedan jedini kod-put za zamrzavanje, bazu, tokene i audit — a to je pravno osjetljiv dio; postojeći pozivaoci se ne diraju ni jednim znakom | funkcija dobija još jedan parametar |
| (c) Zasebna `openVotingLive()` koja duplira zamrzavanje | „režim uživo ne dira ništa postojeće” | dvije kopije logike zamrzavanja prijedloga i izdavanja tokena, koje se s vremenom razilaze; najgora moguća vrsta duplikata u ovoj aplikaciji |

**Odluka: (b).** Konkretno, `opts` bag već postoji (`meetings.ts:472`, `opts?: { expiresAt?: Date }`), pa se proširuje:

- `delivery?: "ALL" | "LIVE"`, podrazumijevano `"ALL"` — bukvalno današnje ponašanje, bit po bit.
- U režimu `"LIVE"`, unutar iste transakcije, učita se `Attendance` za `p.meetingId` u `Set` prisutnih `partyId`, i po svakom redu glasačke baze odredi se da li se dostavlja i, ako ne, zašto (`PRESENT | NO_CONSENT | NO_EMAIL`).
- **Tokeni se kreiraju za sve, i u režimu uživo.** Razlozi: `closeVoting` uniformno istiskuje sve `ACTIVE` tokene (`:1088-1092`) i ne smije se granati; `reissueToken` kao izlaz za nuždu iz §2.1 zahtijeva postojeći token; i oblik podataka ostaje identičan za oba režima. Token je samo hash u bazi — neposlat token nije izložen ničemu.
- Za nedostavljene se postavlja **`deliveredVia: null`** umjesto `"EMAIL"`. To polje je već nullable `String?` (`schema.prisma`, `ApprovalToken.deliveredVia`) i danas se uvijek puni sa `"EMAIL"` (`:587`). Time postojeća tabela glasačke baze (`prijedlog/[id]/page.tsx:317-348`) dobija tačan podatak („nije dostavljen”) bez nove kolone i bez migracije.
- Audit `proposal.voting.open` (`:607-612`) proširuje se sa `delivery`, `deliveredCount`, `suppressedPresent`, `suppressedNoConsent`, `suppressedNoEmail`. Time **zašto neko nije dobio e-mail trajno ostaje u append-only tragu** — a to je tačno pitanje koje će se postaviti ako neko kasnije ospori odluku.

Filtriran je **isključivo `queueNotification` petlja** (`:617-636`). Ništa iznad nje.

**Odluka o saglasnosti u režimu `"ALL"`:** ne mijenja se. Danas `openVoting` šalje svima bez obzira na `eVoteConsentStatus`; uvođenje provjere saglasnosti u podrazumijevani put bi bilo tiho mijenjanje ponašanja postojećih sjednica i nije predmet ovog zahtjeva. Provjera saglasnosti postoji **samo** u `"LIVE"`.

### 2.3 Rezultati u realnom vremenu

| Opcija | Mehanizam | Procjena |
|---|---|---|
| (a) `router.refresh()` na interval iz malog client komponenta | server komponente se ponovo izvrše, `computeProposalResult` je ionako on-demand (`:1064`) | **Bez nove rute, bez druge serijalizacije istih brojeva, bez nove auth površine. Čuva stanje client komponenti i skrol** — presudno za ekran koji se sam osvježava dok korisnik kuca u polju za pretragu. |
| (b) JSON route handler + `fetch` + lokalno stanje | npr. `/api/skupstina/[id]/uzivo` | Drugi prikaz istih brojeva → rizik razilaženja sa serverskim prikazom; nova autorizovana ruta koja vraća ko je kako glasao; više koda za istu stvar. Odbačeno. |
| (c) SSE / websocket | — | Nema ničega u stacku; Vercel serverless; za nekoliko desetina glasača to je inženjering radi inženjeringa. Odbačeno. |
| (d) Samo ručno dugme „Osvježi” | — | Poštena osnova, ali ne ispunjava zahtjev 4. Ostaje kao *dopuna*, ne kao rješenje. |

**Odluka: (a), sa intervalom od 10 sekundi (P6).** Obrazloženje intervala: jedan korisnik, jedan uređaj, ~6 zahtjeva u minuti; elektronski glasovi od kuće pristižu u minutima, ne u milisekundama; 10 s je neprimjetno zastarjelo za čovjeka koji čita tablu, a dovoljno rijetko da ne troši bateriju i mobilni podatak. Komponenta `LiveRefresh` (~30 linija, `"use client"`):

- pauzira kad `document.visibilityState !== "visible"` (telefon u džepu, ekran ugašen),
- prikazuje **„ažurirano prije Xs”** — da predsjednik vidi da je živo, i, što je važnije, da vidi kad se *zaglavilo*,
- uz sebe ima i ručno dugme „Osvježi” (`secondary`) kao rješenje za lošu vezu u sali.

**Ograničenje koje ova odluka nameće ostatku dizajna, i koje mora biti ispoštovano:** ruta uživo se izvršava iznova svakih 10 s, pa mora biti jeftina. Zato se uvodi jedna namjenska servisna funkcija `getLiveMeetingState(actor, meetingId, opts?: { proposalId })` koja radi **jedan** set upita i računa `computeProposalResult` **samo za aktivnu tačku**, nikad za sve prijedloge sjednice. Svaki server action u režimu uživo završava sa `revalidatePath("/uzivo/<id>")` — sopstvene radnje predsjednika se vide odmah, tuđi elektronski glasovi u sljedećem ciklusu.

### 2.4 Aktivacija i oblik rute

| Opcija | Procjena |
|---|---|
| (a) Prekidač na `/skupstina/[id]` koji otkriva panel u stranici | **Odbačeno.** Ta stranica živi unutar `(app)`, dakle unutar `NavShell` sa sidebar-om, sticky top barom, `p-4 md:p-8` i `max-w-[1440px]` (`nav-shell.tsx:390-391`) — hrom koji na telefonu pojede vertikalu koja nam najviše treba. Uz to bi promijenio standardnu stranicu na velikom ekranu, što je izričito ono što korisnik ne želi. |
| (b) Zasebna ruta sa **sopstvenom minimalnom školjkom**, izvan `(app)` | **Preporuka.** Tačan presedan već postoji: `/glasanje/[token]` je na `src/app/glasanje/[token]/page.tsx`, izvan `(app)`, i zato ne dobija `NavShell`; `auth-shell.tsx:1-7` dokumentuje isti obrazac kao svjesnu odluku. |
| (c) Zasebna ruta, ali unutar `(app)` (zadržava `NavShell`) | Kompromis koji ne rješava ništa — hrom ostaje, a stranica je i dalje nova. |

**Odluka: (b), na `src/app/uzivo/[meetingId]/page.tsx` → `/uzivo/<id>` (P4).**

Zašto `/uzivo/<id>`, a ne `(live)/skupstina/[id]/uzivo`: `(app)/skupstina/[id]/…` već drži to podstablo, a slaganje druge route grupe preko istog prefiksa je nepotrebno osjetljiva konfiguracija za dobitak od nule. Kratak, ravan, srpski segment na vrhu je i dosljedan svemu ostalom u aplikaciji (`/glasanje`, `/vlasnici`, `/skupstina`, `/organi`) i lakše se otkuca rukom.

**Sigurnosna posljedica koju implementacija ne smije propustiti:** izvan `(app)` **nema** nasljeđivanja `(app)/layout.tsx`-ove `maybeActor()` provjere. Zato i stranica i **svaki pojedinačni server action** režima uživo moraju sami zvati `requireActor("PRESIDENT", "ACCOUNTANT")` (`src/server/actor.ts:8-33`, koji usput pokriva i suspendovan tenant, `:14-17`) — usklađeno sa P7 (§2.7): servisni sloj već prihvata oba, pa ruta ne smije biti uža od servisa koji poziva. Servisni sloj ionako čuva svoje (`requireRole` u `recordAttendance`, `openVoting`, `recordManualVote`, sad `"PRESIDENT", "ACCOUNTANT"`), ali ruta ne smije zavisiti isključivo od toga.

**Nova školjka `LiveShell`** (`src/components/live-shell.tsx`), po uzoru na `auth-shell.tsx`: `min-h-screen`, `p-3`, kompaktno sticky zaglavlje sa naslovom sjednice i linkom „‹ Nazad na sjednicu” ka `/skupstina/<id>`, bez sidebar-a, bez prekidača ZEV-a, bez menija naloga. Nijedan nov token, nijedna nova boja.

**Kad je režim smislen i kako se ulazi u njega.** Jedina izmjena standardnog UI-ja je **jedno `BtnLink variant="secondary"` dugme „Vodi sjednicu uživo”** u već postojećem `actions` slotu `PageHeader`-a na `skupstina/[id]/page.tsx:164-172`, vidljivo za `PRESIDENT` i `ACCOUNTANT` (P7), i samo za statuse `SCHEDULED`, `INVITATIONS_PREPARED`, `INVITATIONS_SENT`, `VOTING_OPEN`, `VOTING_CLOSED`. Za `DRAFT` (sjednica još nije ni zakazana) i za `RESULTS_REVIEW` i dalje — nema ga. `PageHeader` već prima više akcija (`ui.tsx:26`, `flex flex-wrap gap-2`), pa nema izmjene rasporeda.

**Izričita potvrda, jer je to bio direktan zahtjev korisnika:**
- `/skupstina/[id]` — jedina izmjena je to jedno dugme u zaglavlju. Kartica prozivke, dnevni red, tabela prijedloga, statusna traka i kartica dokumenata ostaju identični. *(Zasebno pitanje za korisnika u §8: da li stara kartica „Prisustvo (za sjednicu uživo)” ostaje kao desktop pogled ili se u kasnijoj fazi svodi na read-only pregled.)*
- `/skupstina/prijedlog/[id]` — **nula izmjena** u renderu. Jedina promjena koja ga dodiruje je da kolona „Token status” sada može prikazati i „nije dostavljen” kad je `deliveredVia = null` — dodatna informacija, ne izmjena ponašanja.
- Sam režim uživo ne blokira po statusu sjednice: ako je sjednica već prošla, ekran se renderuje read-only umjesto da baci grešku.

### 2.5 Pravni integritet i revizorski trag

Ovo je provjera, ne odluka — ali mora stajati u planu jer je to razlog zbog kojeg se ovako projektuje.

- **Nijedan glas se ne kreira novim kodom.** Glasovi iz sale idu isključivo kroz `recordManualVote` (`meetings.ts:956`), sa `channel: "IN_PERSON"`; glasovi od kuće isključivo kroz postojeći `submitVote` (`:813`) preko `/glasanje/[token]`. režim uživo ne dobija nijednu funkciju koja piše u `Vote`.
- Time ostaju netaknute sve postojeće garancije: DB trigger koji zabranjuje `UPDATE/DELETE` nad `Vote` (`schema.prisma:745`, komentar), odbijanje duplog glasa (`:971-974` i `:848-851`), `proposalHash` iz zamrznutog prijedloga, `acknowledgementText`, i audit `vote.manual_entry` / `vote.submit`.
- **`openVoting` se proširuje, ne zamjenjuje.** Sa `delivery` izostavljenim ponašanje je znak po znak današnje. Zamrzavanje (`contentHash`, `ruleSnapshot`, `frozenAt`), izgradnja baze, kreiranje `EligibleVoter`/`ApprovalToken` i audit `approval_token.issue` su **identični u oba režima**; razlikuje se samo koje poruke se stavljaju u red za slanje, i ta razlika se sama upisuje u audit.
- **`closeVoting`, `computeProposalResult`, `effectiveVotes`, `correctVote` se ne diraju.**
- Prozivka i dalje ide kroz `recordAttendance` (`:111-125`) sa svojim `attendance.record` auditom; masovni unos iz §3.2 poziva **istu** logiku u petlji unutar jedne transakcije, sa jednim audit redom po licu — dosljednost sa postojećim tragom je vrijednija od kraćeg zapisa.
- Sve nove servisne funkcije su `zevId`-scoped, po uzoru na `getMeeting` (`:45-53`).

### 2.6 Otvaranje glasanja direktno iz sjednice (P5)

Korisnik je potvrdio da čekanje na desktop nije prihvatljivo: predsjednik koji je već u sali, na telefonu, mora moći da pokrene glasanje bez ijednog koraka van `/uzivo/<id>`.

Podsjetnik iz §1.1: `Meeting.status` nije kapija ni za šta u glasanju — `openVoting` traži samo da je `Proposal.status === "DRAFT"`. To znači da **otvaranje glasanja na tački dnevnog reda (§3.4) već radi bez obzira na to gdje je `Meeting.status`** — ta radnja ne treba nikakvu dodatnu izmjenu da bi bila dostupna uživo.

Ono što P5 stvarno traži je nešto uže i konkretnije: da `/uzivo/<id>` sam ponudi napredovanje **sjednice** u `VOTING_OPEN`, za slučaj da je predsjednik preskočio taj korak na desktopu (npr. zaboravio, ili je sjednica sazvana u žurbi). Konkretno:

- Na vrhu ekrana „Dnevni red” (§3.4), kad je `meeting.status` bilo koji od `SCHEDULED`, `INVITATIONS_PREPARED`, `INVITATIONS_SENT` (dakle prije `VOTING_OPEN`), prikazuje se jedna traka: „Sjednica još nije označena kao „Glasanje otvoreno“ — [Otvori glasanje (sjednica)]”, `secondary` dugme koje poziva **istu** `advanceMeetingStatus(actor, meetingId, "VOTING_OPEN")` (`meetings.ts:79`) koju desktop `NEXT_STATUS` mapa već koristi (`skupstina/[id]/page.tsx:141`) — nema paralelnog puta, samo drugi ulaz u isti servis.
- Ovo je namjerno **odvojeno** od otvaranja glasanja na pojedinačnoj tački: predsjednik može otvoriti glasanje na tački 1 dok je `Meeting.status` još `INVITATIONS_SENT` (model to dozvoljava, §1.1), i tek kasnije, ili nikad, formalno označiti sjednicu kao „Glasanje otvoreno”. Traka je informativna pomoć, ne blokada — ne postoji provjera koja bi zaustavila otvaranje glasanja na tački zato što meeting status kasni.
- Nema `ConfirmAction`: `advanceMeetingStatus` je jednosmjerno napredovanje statusne oznake, ne uništavanje ni zamrzavanje podataka (za razliku od `openVoting` na nivou prijedloga), pa je dovoljan jedan `secondary` tap — dosljedno pravilu iz §3.2 da se potvrda ne traži za bezopasne radnje.

### 2.7 Ovlašćenja — PRESIDENT i ACCOUNTANT (P7)

**Ovo nije samo UI odluka za `/uzivo/<id>` — to je stvarna izmjena servisnog sloja, i pogađa i postojeće desktop stranice.** Svaka funkcija u `meetings.ts` danas provjerava isključivo `requireRole(actor, "PRESIDENT")` (potvrđeno grep-om — nema nijednog `"ACCOUNTANT"` u cijelom fajlu). Režim uživo poziva pet postojećih funkcija: `advanceMeetingStatus` (`:79`), `recordAttendance` (`:111`), `openVoting` (`:472`), `recordManualVote` (`:956`), `closeVoting` (`:1079`). Da bi `ACCOUNTANT` mogao da vodi sjednicu uživo, guard na tih **istih pet** funkcija mora postati `requireRole(actor, "PRESIDENT", "ACCOUNTANT")`.

**Posljedica koju treba prihvatiti otvoreno:** pošto su to iste funkcije koje pozivaju i desktop stranice (`skupstina/[id]/page.tsx`, `skupstina/prijedlog/[id]/page.tsx`), `ACCOUNTANT` time dobija mogućnost da napreduje status sjednice, evidentira prisustvo, otvara/zatvara glasanje i unosi ručne glasove **i sa desktopa**, ne samo iz `/uzivo/<id>`. Servisni sloj ne zna niti smije da zna kroz koju je rutu pozvan — jedinstven guard je jedini ispravan način da se ovo uradi bez dupliranja autorizacione logike (isti princip kao §2.2 za `openVoting`: jedan kod-put, ne dva). Ovo je namjerno prihvaćeno proširenje, ne slučajna posljedica: predsjednik i računovođa već dijele ulogu pripreme sjednice u praksi (računovođa kao zapisničar), a `PRESIDENT`-only guard na ovih pet funkcija je bio odraz toga da do sada nije bilo razloga da bude šire, ne namjerna brana protiv računovođe.

**Funkcije koje se NE dodiruju** (ostaju `PRESIDENT`-only): `createMeeting`, `updateMeeting`, `addAgendaItem`, `createProposal`, `updateDraftProposal`, `withdrawProposal`, `deleteDraftProposal`, `createProposalRevision`, `revokeToken`, `reissueToken`, `correctVote`, `recordDecision` — režim uživo ih ne poziva (van obima po §4), pa se guard ne dira dok se za njih zasebno ne zatraži.

Nove servisne funkcije iz Faze 0 (`getLiveMeetingState`, `recordAttendanceBulk`) se od početka pišu sa `requireRole(actor, "PRESIDENT", "ACCOUNTANT")`.

Test u `tests/live-meeting.test.ts` (Faza 0, §4) dobija eksplicitan slučaj: `ACCOUNTANT` uspješno poziva svih pet proširenih funkcija; svaka uloga koja nije ni `PRESIDENT` ni `ACCOUNTANT` (npr. `OWNER`) i dalje dobija `ForbiddenError` — čuva se postojeće ponašanje za svakog trećeg.

---

## 3. UI dizajn — konkretno

Cijeli režim je jedna ruta sa dva taba (`Tabs`, `ui.tsx:602` — obični `<Link>`-ovi, stanje u URL-u): **Prozivka** i **Dnevni red**. Stanje u URL-u, a ne u Reactu, je posljedica odluke iz §2.3: ekran se sam osvježava, pa ništa što korisnik „drži otvorenim” ne smije zavisiti od toga da server komponenta ostane nepromijenjena.

### 3.1 Sticky traka kvoruma (obje kartice)

Odmah ispod zaglavlja `LiveShell`-a, sticky: **Prisutno N** · **Odsutno M** · **Kvorum X%** (težinski, prema pravilu aktivne tačke ako je ima, inače prema pravilu prve tačke). Brojevi `text-2xl font-semibold tabular-nums`, labele 13px. Ovo je jedina stvar koju predsjednik treba da vidi u svakom trenutku, bez skrolanja.

Namjerno se **ne** koristi `Stat` (`ui.tsx:43`): `Stat` je elevacija 1 (`border … shadow-sm`), a ovo stoji unutar sticky trake — tri kartice u traci bi bile ugniježđena elevacija, što `Plans/design-system.md §3.5` izričito zabranjuje. Koriste se iste vrijednosti i isti tokeni, bez kartice oko njih.

### 3.2 Kartica „Prozivka” — roll-call

```
┌─────────────────────────────────────┐
│ Prisutno 18 · Odsutno 22 · Kvorum 46%│  ← sticky
├─────────────────────────────────────┤
│ [ traži ime…                       ]│  ← client-side filter
│ ( Svi ) (Neoznačeni) (Prisutni) (Odsutni)│
├─────────────────────────────────────┤
│ Marković Ana                        │
│ St. 12 · e-glasanje: da             │
│            [ Prisutna ][ Odsutna ]  │
├─────────────────────────────────────┤
│ Nikolić Petar                       │
│ St. 4, G-3 · e-glasanje: ne   ⚠     │
│            [ Prisutan ][ Odsutan ]  │
└─────────────────────────────────────┘
│ Označi sve neoznačene kao odsutne   │  ← na dnu, iza potvrde
```

Konkretne odluke i zašto:

- **Lista je lista glasača, ne lista lica.** Izvor je `ownersVotingBasis(zevId)` (`ownership.ts:428`), ne `listParties` — tako se prozivka i glasačka baza ne mogu razići. Iz `basis.units[].label` dolazi drugi red („St. 12”), što je ono po čemu predsjednik zapravo prepoznaje ljude u zgradi.
- **Sortiranje: azbučno po prikaznom imenu, i nikad se ne mijenja od označavanja.** Lista koja se presloži pod palcem je klasičan način da se prozivka izgubi. Mijenja se samo *članstvo* kroz filter čipove, nikad redoslijed.
- **Filter „Neoznačeni” je glavni radni pogled** — to je doslovno „koga još nisam prozvao”. Predlaže se kao podrazumijevani filter kad na sjednici još nema nijednog `Attendance` reda.
- **Pretraga je client-side.** Za ZEV sa 60 vlasnika server round-trip po pritisku tastera dok stojiš u sali nije opcija. `router.refresh()` iz §2.3 čuva stanje client komponente, pa upisani tekst preživljava automatsko osvježavanje — što je i bio argument za tu opciju.
- **Jedan tap = jedno stanje.** Dvopoložajni prekidač, ne checkbox: „Prisutan” i „Odsutan” su dva izričita izbora, jer „neoznačen” je treće, stvarno i korisno stanje koje checkbox ne ume da prikaže.
- **Poništavanje je trivijalno i zato nigdje nema potvrde.** `recordAttendance` je upsert (`meetings.ts:118-122`) — tap na drugo stanje *jeste* undo. Cijeli ovaj ekran je idempotentan i nedestruktivan, pa se `ConfirmAction` ovdje namjerno **ne** koristi (osim za masovnu radnju ispod). To je važno: potvrda koja se traži za nešto bezopasno obučava korisnika da potvrde ignoriše.
- **Punomoćnik, inline.** Za vlasnika koji **već ima** aktivnu punomoć za ovu sjednicu (`activeProxyFor`, `ownership.ts:277`; podaci su već učitani jer `getMeeting` uključuje `proxies`, `meetings.ts:51`) prikazuje se mala dopunska kontrola „prisutan preko punomoćnika: <Ime>”, koja u `recordAttendance` prosljeđuje `viaProxyId`. **Kreiranje nove punomoći sa telefona nije u obimu prve verzije** — `grantProxy` traži `scope`, `validFrom`, `documentRef` (`ownership.ts:232-243`), dakle pravi obrazac sa pravnim posljedicama, a ne tap u sali. Pitanje za korisnika u §8.
- **Masovna radnja „Označi sve neoznačene kao odsutne”** na dnu — poslije prozivke ostatak je po definiciji odsutan, i nema smisla to raditi 22 puta. Nije destruktivna, ali piše N redova, pa ide iza `ConfirmAction` sa `caution` težinom i brojem u `body` („Označiće se 22 lica kao odsutna.”).
- **Upozorenje ⚠ uz „e-glasanje: ne”** je 13px tekst uz čip, nikad samo boja (`design-system.md §0` pravilo 5). To je jedini način da predsjednik *prije* otvaranja glasanja shvati da će ta 4 čovjeka biti u brojiocu nule i u imeniocu kvoruma.
- **Bez JS-a i dalje radi.** Prekidač je `<form action={…}>` sa dva `SubmitBtn name="present" value="true|false"` — `SubmitBtn` već prima `name`/`value` (`ui.tsx:472`). Za osjećaj trenutnog odziva red se pakuje u `"use client"` komponentu sa optimističkim stanjem, tačno po ustaljenom obrascu `unit-row.tsx`/`charge-item-row.tsx`/`building-row.tsx`. Bez JS-a ostaje sporije, ali ispravno.

### 3.3 Novi primitiv koji ovaj zadatak zaista traži

Po `CLAUDE.md:23-25`, ovo se predlaže izričito, a ne improvizuje na jednoj stranici.

**Prijedlog: `SegmentedAction` — red međusobno isključivih radnji, veličine palca.**

Šta tačno nedostaje: sistem ima dugmad (`btnBase`, 40/44px, `ui.tsx:436`) i radnje u redu tabele (`RowAction`, 28/44px, `:386`), ali nema **grupu od 2–3 međusobno isključive radnje u jednom redu, gdje je jedna trenutno aktivna**. To je oblik koji se u ovom režimu ponavlja dvaput i na kojem stoji cijela upotrebljivost: Prisutan/Odsutan u prozivci i Za/Protiv/Uzdržan u glasanju. Danas bi se to pisalo ručno na dva mjesta, sa dvije kopije klasa — tačno ono što `ui.tsx:486-491` u komentaru navodi kao razlog postojanja `Btn`-a.

Razmotrene alternative:

| Opcija | Procjena |
|---|---|
| Tri zasebna `SubmitBtn`-a | Radi, ali ne komunicira „izaberi jedno od ovoga” i troši širinu; na 375px tri pilule sa razmakom se prelamaju. |
| `<select>` + `SubmitBtn` | To je današnji obrazac (`prijedlog/[id]/page.tsx:462-468`) — dva tapa i modalni picker po glasu. Upravo ono što zamjenjujemo. |
| **Novi `SegmentedAction`** | **Preporuka.** Jedan tap, puna širina, jasna isključivost. |

Ograničenja koja prijedlog na sebe preuzima, tako da ne uvodi ništa novo u sistem:
- geometrija i fokus **isključivo** iz `btnBase` (`:436`) — bez novih px vrijednosti;
- boje **isključivo** iz `btnVariantCls` (`:453`): neaktivan segment = `secondary`, aktivan = `tonal`; za glasanje „Protiv” u aktivnom stanju koristi `caution`, nikad `danger` (glasanje protiv nije uništavanje podataka, `design-system.md §4.2`);
- oblik: `rounded-full` spolja, kao i sva ostala dugmad;
- stanje se **nikad ne prenosi samo bojom** — aktivan segment nosi i `✓` (postojeći `IconCheck` stil, `nav-icons.tsx`) i `aria-pressed`;
- visina 44px bezuslovno (ne samo `max-md:`), jer ovaj primitiv postoji isključivo za dodir.

**Odobreno (P11).** `SegmentedAction` se gradi kao formalna dopuna `Plans/design-system.md` §4 (inventar primitiva), sa ograničenjima iz ovog pasusa.

### 3.4 Kartica „Dnevni red” — glasanje po tačkama

Vertikalna lista tačaka (`meeting.agendaItems`, već uređena i sa `proposals`, `meetings.ts:48`). Tačno jedna je otvorena; koja — stoji u URL-u (`?t=<agendaItemId>`), da je automatsko osvježavanje ne zatvori.

**Tačka bez prijedloga** (a `agendaItemId` je opcion na `Proposal`, `schema.prisma`, pa ih ima): naslov, `note`, oznaka „diskusija”. Nema šta da se radi i to treba da bude vidljivo, da predsjednik ne traži dugme kojeg nema.

**Tačka sa prijedlogom u statusu `DRAFT`:**
- šifra + naslov, tekst prijedloga sakriven iza `ToggleBtn` („Tekst prijedloga”) — u sali se čita naglas, ne sa ekrana, ali mora biti dostupan;
- jedina `primary` radnja na ekranu: **„Otvori glasanje”**, iza `ConfirmAction` sa `body` iz §2.1:
  > U sali: **18** (glasaju ručno) · Dobiće e-mail: **9** · **Bez ikakvog kanala: 4** — ostaju u glasačkoj bazi i računaju se u kvorum.
  > *(i, kad je slučaj)* Zbir težina u sali i onih koji dobijaju e-mail **ne dostiže kvorum**.

**Tačka sa prijedlogom u statusu `VOTING_OPEN` — srce ekrana:**

1. **Tabla rezultata**, na vrhu: Za / Protiv / Uzdržan sa težinom i brojem, linija kvoruma, i jedna rečenica „Ishod ako se sada zatvori: …”. Brojevi prvo (`formatWeight`, `tabular-nums`), boja kao pojačanje. Isti podaci kao `prijedlog/[id]/page.tsx:295-302`, samo raspoređeni za uspravan telefon.
2. **Unos iz sale** — lista filtrirana na *prisutne koji još nisu glasali*, svaki red: ime + `SegmentedAction` Za/Protiv/Uzdržan. Jedan tap = jedan `recordManualVote(channel: "IN_PERSON")`. Red nestaje sa liste čim se glas unese, uz brojač **„Ostalo: 6 od 18 u sali”**.
3. **Sklopivo: „Glasali elektronski (K)”** — read-only, da predsjednik vidi kako glasovi od kuće pristižu. Ovo je mjesto gdje se zahtjev za realnim vremenom zapravo vidi.
4. **Sklopivo: „Bez kanala (4)”** — imenovan spisak korpe C, sa mogućnošću naknadnog `PAPER` unosa.
5. Na dnu: **„Zatvori glasanje”**, `caution` + `ConfirmAction` sa pregledom rezultata — doslovno isti oblik koji već postoji na `prijedlog/[id]/page.tsx:245-262`. Ne piše se nanovo.

**Dizanje ruku — problem koji se ne smije prećutati.** Kod dizanja ruku predsjednik zna „18 za, 4 protiv”, a **ne zna ko je šta**. Model to ne dozvoljava: `Vote` je po `EligibleVoter`-u i nosi `weight` tog konkretnog glasača (`:976-991`).

| Opcija | Procjena |
|---|---|
| (i) Unos po osobi | Jedino što model podržava. Uz to, kod pravila `OWNERSHIP_SHARE`/`USABLE_AREA` (`voting.ts:42-53`) zbirni unos je **matematički neizvodljiv** — 18 „za” ne daje nikakvu težinu dok se ne zna kojih 18. |
| (ii) Zbirni unos koji sistem razdijeli na prisutne | **Odbačeno.** To je fabrikovanje pojedinačnih dokaza o glasanju — tačno ono što append-only `Vote` model postoji da spriječi. |

**Odluka: (i) (P8)**, i to se korisniku kaže otvoreno: dizanje ruku se i dalje mora evidentirati po osobi, jer težina glasa zavisi od toga ko ga je dao. Cijena u brzini se plaća dizajnom — jedan tap po osobi, lista se sama skraćuje, brojač pokazuje koliko je ostalo. U Fazi 4 se dodaje **„Svi preostali prisutni: Za”** iza potvrde sa nabrojanim imenima: ulaz je zbiran, ali se i dalje piše po jedan `Vote` red po osobi kroz `recordManualVote` — dokaz ostaje pojedinačan.

---

## 4. Fazni plan implementacije

### Faza 0 — Domen i servisi, bez ijednog piksela
- `openVoting` dobija `opts.delivery?: "ALL" | "LIVE"` (podrazumijevano `"ALL"`), potiskivanje slanja po korpama A/C (uz P1 — provjera saglasnosti i vlasnika i punomoćnika), `deliveredVia: null` za nedostavljene, prošireni `proposal.voting.open` audit.
- `advanceMeetingStatus`, `recordAttendance`, `openVoting`, `recordManualVote`, `closeVoting` — guard proširen na `requireRole(actor, "PRESIDENT", "ACCOUNTANT")` (§2.7, P7). Desktop stranice koje ih pozivaju nisu inače dirane, ali ovim automatski dobijaju isto proširenje.
- `getLiveMeetingState(actor, meetingId, opts?)` — `zevId`-scoped, `requireRole(actor, "PRESIDENT", "ACCOUNTANT")`, jedan set upita: glasačka baza + `Attendance` + status saglasnosti + dnevni red sa prijedlozima + rezultat **samo aktivne tačke**.
- `recordAttendanceBulk(actor, { meetingId, entries })` — `requireRole(actor, "PRESIDENT", "ACCOUNTANT")`, jedna transakcija, ista semantika i isti audit po licu kao `recordAttendance`.
- Vitest (`tests/live-meeting.test.ts`, po uzoru na `tests/voting.test.ts`): (1) podrazumijevani `openVoting` šalje svima — **postojeći `voting.test.ts` mora proći bez ijedne izmjene**; (2) `"LIVE"` potiskuje tačno skup prisutnih, uz provjeru da odsutni punomoćnik bez saglasnosti svodi vlasnika u korpu C i kad vlasnik lično ima saglasnost (P1); (3) odsutan bez saglasnosti ostaje u bazi i u `totalEligibleWeight`; (4) audit payload nosi razloge potiskivanja; (5) `recordManualVote` i dalje odbija dupli glas nakon elektronskog; (6) `ACCOUNTANT` uspješno poziva svih pet proširenih funkcija, `OWNER` i dalje dobija `ForbiddenError` (P7).

### Faza 1 — Prozivka (MVP-A)
Ruta `/uzivo/[meetingId]`, `LiveShell`, `SegmentedAction`, sticky traka kvoruma, ekran prozivke sa pretragom i filter čipovima, jedno ulazno dugme na `/skupstina/[id]`. **Bez glasanja.** Ovo je pošten samostalan MVP: već zamjenjuje neupotrebljivu postojeću karticu i samo po sebi vrijedi na sjednici. Rječnik: nova ugniježđena grupa `live: { … }` u `sr-Latn.ts` i `en.ts`.

### Faza 2 — Glasanje po tačkama (MVP-B)
Tab dnevnog reda, traka za napredovanje `Meeting.status` u `VOTING_OPEN` direktno iz sjednice kad je potrebno (§2.6, P5), otvaranje glasanja sa potvrdom i tri broja, unos iz sale jednim tapom, tabla rezultata, zatvaranje glasanja, spiskovi „elektronski” i „bez kanala”.

### Faza 3 — Realno vrijeme
`LiveRefresh` (10 s, pauza kad kartica nije vidljiva, „ažurirano prije Xs”, ručno „Osvježi”). **Namjerno poslije Faze 2:** ekran mora biti tačan i upotrebljiv uz ručno osvježavanje prije nego što počne da se osvježava sam — inače se ne zna da li je greška u podacima ili u osvježavanju.

### Faza 4 — Poliranje
„Svi preostali prisutni: Za” iza potvrde sa imenima; punomoćnik inline; status dostave po glasaču iz `NotificationMessage.status` uz upozorenje kad je nešto `FAILED`; „Označi sve neoznačene kao odsutne”.

### Van obima prve verzije (svjesno)
Sjednice upravnog odbora (`body = "BOARD"`); kreiranje punomoći sa telefona; izmjene zapisnika/PDF-ova; offline/PWA rad; projekcija table u sali; izmjene `/skupstina/prijedlog/[id]`.

---

## 5. Rizici

1. **Kvorum se ne može dostići, a to se shvati tek poslije otvaranja glasanja (nepovratno — prijedlog je zamrznut).** *Mjera:* panel potvrde iz §2.1 računa i prikazuje dostižnost kvoruma iz zbira težina korpi A+B **prije** otvaranja. Ovo je pojedinačno najvrednija zaštita u cijelom planu.
2. **Sinhrono slanje e-pošte u server akciji.** `openVoting` šalje serijski, van transakcije (`meetings.ts:617-636`), a `queueNotification` odmah dispečuje (`service.ts:43-46`). Sa pravim provajderom i 40 primalaca to je dugačko čekanje na telefonu. *Mjera:* režim uživo sam po sebi smanjuje N (prisutni se preskaču); postojeći `retryFailed()` pokriva neuspjehe. **Prihvaćeno za MVP, bez nove infrastrukture** — ali treba izmjeriti na prvoj stvarnoj sjednici.
3. **E-mail ne ode, a niko ne primijeti.** *Mjera:* Faza 4 prikazuje status dostave po glasaču i upozorenje kad ijedna poruka za tu tačku ima status `FAILED`.
4. **Prisustvo se mijenja nakon otvaranja glasanja → poslata pošta je zastarjela.** *Mjera:* trajna napomena na kartici prozivke čim bilo koji prijedlog uđe u `VOTING_OPEN`; `reissueToken` kao izlaz za nuždu.
5. **Telefon izgubi vezu usred sjednice.** *Mjera:* nijedna radnja nije opasna pri ponavljanju — prisustvo je upsert, a `recordManualVote` odbija dupli glas. **Prihvaćeno**; offline red nije u obimu.
6. **Automatsko osvježavanje na 10 s postane skupo** ako ruta računa rezultat za sve prijedloge. *Mjera:* `getLiveMeetingState` računa rezultat isključivo za aktivnu tačku (§2.3).
7. **Dvoje ljudi unosi glasove istovremeno** (predsjednik + zapisničar, oba `PRESIDENT`). *Mjera:* drugi unos padne na provjeri postojećeg glasa (`:971-974`) — vidljiva greška, nikakva korupcija podataka. **Prihvaćeno.**
8. **Nova ruta izvan `(app)` ostane bez zaštite**, jer ne nasljeđuje layout provjeru. *Mjera:* `requireActor("PRESIDENT", "ACCOUNTANT")` u stranici **i u svakoj** server akciji; test po uzoru na `tests/permissions.test.ts` i `tests/tenant-isolation.test.ts`.
9. **Nova školjka vremenom odluta od dizajn sistema.** *Mjera:* `LiveShell` komponuje isključivo postojeće tokene; jedini nov primitiv je `SegmentedAction` i on je u §3.3 vezan za `btnBase`/`btnVariantCls`, bez ijedne nove vrijednosti.
10. **Predsjednik ne primijeti da 4 čovjeka nemaju nijedan kanal** i odluka se kasnije ospori. *Mjera:* vidljivo u prozivci (⚠ uz ime), u panelu potvrde (brojem) i u auditu (razlogom potiskivanja) — tri nezavisna mjesta.
11. **Režim uživo „razdvoji istinu”** — dva mjesta prikazuju rezultat istog prijedloga. *Mjera:* oba čitaju **isti** `computeProposalResult`; nema drugog izračuna ni druge serijalizacije (upravo razlog odbacivanja opcije (b) u §2.3).

---

## 6. Provjera prije isporuke (uz standardnu listu iz `design-system.md §8`)

Živi vizuelni pregled je ovdje obavezan na **375px** (Faza 1 i 2 su prvenstveno telefonske) **i** na 1440px — ne zato što se režim koristi na desktopu, nego da se potvrdi da standardne stranice nisu pomjerene. Uz to: pregled `/skupstina/[id]` i `/skupstina/prijedlog/[id]` prije/poslije, kao dokaz zahtjeva „bez uticaja na veliki ekran”.

---

## 7. Rizik po postojeće ponašanje — sažetak u jednoj rečenici

Za samu logiku glasanja: **nijedna** — `openVoting` bez `opts.delivery` radi identično, `submitVote`/`closeVoting`/`computeProposalResult` se ne diraju. Postoje tačno dvije namjerne, korisnikom potvrđene izmjene postojećeg ponašanja: (1) jedno dodatno `secondary` dugme u zaglavlju `/skupstina/[id]`; (2) pet postojećih `meetings.ts` funkcija (`advanceMeetingStatus`, `recordAttendance`, `openVoting`, `recordManualVote`, `closeVoting`) sad prihvataju i `ACCOUNTANT`, ne samo `PRESIDENT` — i na desktopu, ne samo uživo (§2.7, P7).

---

## 8. Pitanja za korisnika (odgovoreno 2026-09-23 — vidi „Odluke korisnika” na vrhu)

1. **Saglasnost i punomoć.** Kad odsutnog vlasnika zastupa punomoćnik, čija saglasnost za e-glasanje otvara elektronski kanal — punomoćnikova (on klikće), vlasnikova (njegov je glas), ili obje? → **Obje (P1).**
2. **Odsutan bez saglasnosti (korpa C).** Potvrđujete li da ostaje u glasačkoj bazi i u imeniocu kvoruma, samo bez e-maila, i da mu predsjednik kasnije može unijeti papirni glas? → **Da (P2).**
3. **Upravni odbor.** Da li režim uživo treba i za sjednice odbora, ili prvo samo skupština? → **Ne, samo skupština za sada (P3).**
4. **Ulazna tačka.** Zasebna ruta `/uzivo/<id>` sa sopstvenom minimalnom školjkom, ili prekidač u samoj stranici sjednice? → **Zasebna ruta (P4).**
5. **Status sjednice.** Treba li ulazak u režim uživo da ponudi jednim tapom prelazak sjednice u status `VOTING_OPEN`, ili status ostaje isključivo ručna stvar sa desktopa? → **Da, mora postojati mogućnost da se glasanje pokrene direktno iz sjednice (P5, razrada u §2.6).**
6. **Interval osvježavanja.** Je li 10 sekundi u redu, ili radije 15–30 s zbog mobilnog podatka? → **10 sekundi je dovoljno (P6).**
7. **Ko smije da koristi režim.** Samo `PRESIDENT`, ili i `ACCOUNTANT` kao zapisničar? → **PRESIDENT i ACCOUNTANT (P7, razrada u §2.7 — stvarna izmjena servisnog sloja, ne samo UI-ja uživo).**
8. **Dizanje ruku.** Prihvatate li da se i kod dizanja ruku glas unosi po osobi? → **Da, glas ide po osobi (P8).**
9. **Punomoć sa telefona.** Da li je evidentiranje **nove** punomoći iz režima uživo potrebno u prvoj verziji, ili je dovoljno prikazati već evidentirane? → **Dovoljno je prikazati već evidentirane (P9).**
10. **Stara kartica prisustva.** Ostaje li „Prisustvo (za sjednicu uživo)” na `/skupstina/[id]` netaknuta, ili se kasnije svodi na read-only pregled? → **Ostaje netaknuta (P10).**
11. **Novi primitiv `SegmentedAction`** (§3.3) — odobravate li ga kao dopunu dizajn sistema, ili radije rezervnu varijantu sa tri obična dugmeta? → **Odobren novi primitiv (P11).**

**Verzionisanje** se, po kućnom pravilu, pita zasebno neposredno pred isporuku (patch/minor/major) — ovaj plan ga ne odlučuje. Trenutna verzija je `2.25.1`; očekuje se niz **minor** koraka, po jedan po fazi, kao u `Plans/deployment-portability-plan.md`.

---

### Kritični fajlovi za implementaciju

- `src/server/services/meetings.ts` — `openVoting:472` (dodaje se `opts.delivery`), `advanceMeetingStatus:79`, `recordAttendance:111`, `recordManualVote:956`, `closeVoting:1079` (svih pet dobija prošireni `requireRole(actor, "PRESIDENT", "ACCOUNTANT")`, §2.7), `computeProposalResult:1064`; ovdje žive i nove `getLiveMeetingState`/`recordAttendanceBulk`
- `src/app/(app)/skupstina/[id]/page.tsx` — jedina izmjena standardnog UI-ja (ulazno dugme u `PageHeader actions:164`)
- `src/components/ui.tsx` — `ConfirmAction:525`, `btnBase:436`, `btnVariantCls:453`, `Tabs:602`, `SubmitBtn:472`; ovdje ide `SegmentedAction`
- `src/components/auth-shell.tsx` — uzor za novi `live-shell.tsx`
- `prisma/schema.prisma` — `Attendance:570`, `EligibleVoter:682`, `ApprovalToken.deliveredVia`, `Party.eVoteConsentStatus:102` (**bez izmjena šeme — nijedna migracija nije potrebna**)
