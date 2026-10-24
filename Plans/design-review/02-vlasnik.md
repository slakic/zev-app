## Etažni vlasnik (OWNER) — od prijave do glasanja

Obim: tok etažnog vlasnika (uloga `OWNER`, seed korisnica Ana Savić, i javni e-glasački listić otvoren seed tokenom za Nikolu Ilića) kroz `/login`, `/` („Moj pregled”), `/fakture`, `/fakture/[id]`, `/fakture/uplate`, `/glasanje/[token]`, `/skupstina`, `/skupstina/[id]`, `/skupstina/prijedlog/[id]`, `/dokumenti`, `/odrzavanje`, `/odrzavanje/[id]`, `/planovi`, `/planovi/[id]`, `/zgrade`, `/organi` i `/podesavanja` (tab vlasnika), na 1440px i 375px.

> **Metod i ograničenja.** Nalazi su izvedeni iz screenshota žive aplikacije (seed podaci, 2026-10-24, v2.41.0) i čitanja koda. **Nema korisničkih intervjua, testiranja sa korisnicima ni analitike** — sve što govori o ponašanju ili razumijevanju stvarnih vlasnika označeno je kao **hipoteza**. „Danas” u ovom tekstu je 24.10.2026. (datum screenshota). `src/components/agenda-voting.tsx` je pregledan, ali **nije površina vlasnika** — koristi ga samo `/uzivo/[meetingId]` koji traži `PRESIDENT`/`ACCOUNTANT` (`src/app/uzivo/[meetingId]/page.tsx:24`), pa ovdje nema nalaza o njemu.

### Ključni korisnički poslovi

1. **„Koliko dugujem, do kada i kako da platim?”** — saznati iznos, rok i uplatne podatke, i platiti iz e-bankarstva ili na šalteru.
2. **„Da li je moja uplata primljena i na šta je raspoređena?”**
3. **„Imam li glasanje koje me čeka i kako da glasam (pravno valjano)?”** — razumjeti o čemu se glasa, glasati jednom i ispravno, i imati dokaz.
4. **„Šta je odlučeno / šta se planira?”** — odluke, pozivi, planovi.
5. **„Prijavio sam kvar — šta se dešava?”**
6. **„Podesiti kako me ZEV kontaktira”** — e-mail, dostava računa, saglasnost za e-glasanje.

**Trenutni tok — posao 1 (platiti dospjelu fakturu), 375px:**
1. Prijava → „Moj pregled”. Saldo 7,22 KM (narandžasto) je prvi; ispod je lista „Moje neplaćene fakture” sa redom `FAK-2026-000001 (Garaža 1) · rok 15.09.2026. · 7,22 KM` — bez oznake da je rok prošao prije 39 dana ([`owner__home__375`](zateceno/owner__home__375.jpg)).
2. Tap na broj fakture → detalj. Vidi „Otvoreno: 7,22 KM” i „Poziv na broj: 202609-936D4T” (12px mono). **Nema broja računa primaoca, naziva primaoca ni svrhe uplate** ([`owner__fakture_id__375`](zateceno/owner__fakture_id__375.jpg)).
3. Tap „Preuzmi PDF” → server generiše PDF i preusmjerava na preuzimanje; tek u PDF-u je račun `5620990000123456 (NLB Banka…)` (`src/server/services/documents.ts:268`).
4. Ručno prepisivanje računa i poziva na broj iz PDF-a u e-bankarstvo. **Ukupno: 3 tapa + otvaranje PDF-a + prepisivanje; uplatni podaci se ne mogu dobiti nigdje u samoj aplikaciji.**

**Trenutni tok — posao 3 (glasati), e-glasački listić, 375px:**
1. Otvaranje linka iz e-pošte → stranica u tri koraka ([`public__glasanje_landing__375`](zateceno/public__glasanje_landing__375.jpg)).
2. Izbor (Za/Protiv/Uzdržan) → upis verifikacionog koda (iz **iste** e-poruke, `src/server/services/meetings.ts:951-952`) → štikliranje izjave → „Potvrdi i pošalji izjašnjenje” (otvara amber panel) → „Da, pošalji izjašnjenje”. **5 interakcija + upis koda**; pogrešan kod vraća stranicu sa praznim izborom (`src/app/glasanje/[token]/page.tsx:47`).
3. Potvrda: zeleni okvir sa internim ID-jem glasa; o kojem prijedlogu i kojim izborom — ne piše.

**Trenutni tok — posao 3, prijavljen u aplikaciji:** „Moj pregled” → „Otvorena glasanja: Trenutno nema otvorenih izjašnjavanja.” dok istovremeno „Skupština i odluke” prikazuje sjednicu sa statusom „Glasanje otvoreno” ([`owner__home__1440`](zateceno/owner__home__1440.jpg) vs [`owner__skupstina__1440`](zateceno/owner__skupstina__1440.jpg)). Vlasnik u aplikaciji **ne može glasati ni doći do svog linka** (`src/app/(app)/skupstina/prijedlog/[id]/page.tsx:199-205`).

### Snage koje treba sačuvati

- **E-glasački listić u tri numerisana koraka na jednoj stranici** („Ko ste vi / O čemu se izjašnjavate / Vaše izjašnjenje”), bez višestranične forme koja gubi stanje — dobra odluka za jednokratnu, pravno relevantnu radnju (`src/app/glasanje/[token]/page.tsx:5-10, 95-124`; [`public__glasanje_landing__375`](zateceno/public__glasanje_landing__375.jpg)).
- **Opcije glasa kao velike kartice** `min-h-14` (56px) sa radiom unutar labele, stanjem `has-[:checked]` i vidljivim fokusom — najbolja tap meta u cijeloj aplikaciji za starijeg korisnika (`glasanje/[token]/page.tsx:133-144`).
- **Sažetak izbora u trenutku potvrde** („Izjašnjavate se **ZA** prijedlog UO-2026-01. Ovo je konačno…”) bez JS-a, kroz `:has()` (`glasanje/[token]/page.tsx:163-174`). Ideja je tačna; mijenja se samo težina dugmadi (V-N06).
- **Tekst prijedloga na listiću je 16px, `leading-relaxed`, `max-w-[68ch]`** (`glasanje/[token]/page.tsx:109`) — čitljivo i na 375.
- **Card-transform tabela na telefonu** daje čitljive kartice „labela: vrijednost” za fakture, uplate, prijave ([`owner__fakture__375`](zateceno/owner__fakture__375.jpg), [`owner__odrzavanje__375`](zateceno/owner__odrzavanje__375.jpg)) — umjesto horizontalnog skrola.
- **Kartica „Dostava računa”** jasno kaže šta će se desiti i na koju adresu, i da fakture ostaju u aplikaciji (`podesavanja/page.tsx:205-216`, [`owner__podesavanja__375`](zateceno/owner__podesavanja__375.jpg)).
- **Objašnjenje saglasnosti za e-glasanje je konkretno** (preuzmi, odštampaj, potpiši, predaj predsjedniku) ([`owner__podesavanja__1440`](zateceno/owner__podesavanja__1440.jpg)).
- **Prijava je mirna i jednostavna**: jedno `primary` dugme, prikaz lozinke, jasan link za zaboravljenu lozinku, objašnjenje odakle nalog ([`anon__login__375`](zateceno/anon__login__375.jpg)).
- **Prazna stanja sa ikonom i rečenicom** na detalju fakture („Još nema uplata po ovoj fakturi.”, [`owner__fakture_id__1440`](zateceno/owner__fakture_id__1440.jpg)).
- **Vlasniku se ne prikazuju tuđi glasovi** na prijedlogu (`skupstina/prijedlog/[id]/page.tsx:189-190`) — ispravna granica privatnosti.

### Nalazi

| ID | Ekran/tok | Nalaz | Dokaz (screenshot + fajl:linija) | Vrsta | Ozbiljnost | Uticaj na posao | Pouzdanost |
|---|---|---|---|---|---|---|---|
| V-N01 | Detalj fakture | **U aplikaciji nigdje ne postoje uplatni podaci.** Kartica „Iznosi” ima samo poziv na broj; broj računa, naziv primaoca, banka i svrha postoje samo u PDF-u (koji se mora generisati i otvoriti). Vlasnik na telefonu ne može platiti bez PDF čitača i prepisivanja. | [`owner__fakture_id__375`](zateceno/owner__fakture_id__375.jpg), [`owner__fakture_id__1440`](zateceno/owner__fakture_id__1440.jpg); `src/app/(app)/fakture/[id]/page.tsx:144-151`; podaci postoje u `src/server/services/documents.ts:229-230, 267-269` | posmatrano | kritično | Posao 1 („kako da platim”) nije rješiv u aplikaciji | visoka |
| V-N02 | Početna | **Dospjela faktura nije označena kao dospjela.** Rok 15.09.2026. (39 dana prošao) stoji kao sivi `text-xs` „rok …” — isto kao da je rok u budućnosti; nema chipa „Dospjela”, nema radnje „Kako da platim”. Lista je jedna od šest ravnopravnih kartica. | [`owner__home__1440`](zateceno/owner__home__1440.jpg), [`owner__home__375`](zateceno/owner__home__375.jpg); `src/app/(app)/page.tsx:179-194` (rok na `:189` kao `text-xs text-slate-500`) | posmatrano | visoko | Vlasnik ne razlikuje „treba da platim” od „kasnim sa plaćanjem” | visoka |
| V-N03 | Početna ↔ Skupština | **Kontradiktorna slika glasanja.** Početna: „Trenutno nema otvorenih izjašnjavanja.” Skupština: redovna godišnja sjednica „Glasanje otvoreno”, 3 prijedloga. Početna ne kaže **zašto** (vlasnik nije u glasačkoj bazi? e-glasanje mu nije uključeno — „Nije pokrenuto” u Podešavanjima?) niti šta da uradi. Kad glasanje postoji, red nema rok, nema link ka prijedlogu, a uputa „Link ste dobili e-poštom” je 12px amber. | [`owner__home__1440`](zateceno/owner__home__1440.jpg), [`owner__skupstina__1440`](zateceno/owner__skupstina__1440.jpg), [`owner__podesavanja__1440`](zateceno/owner__podesavanja__1440.jpg); `src/app/(app)/page.tsx:162, 196-207` (`:204` `text-xs text-amber-700`); `podesavanja/page.tsx:227-253` | posmatrano (kontradikcija); uzrok — hipoteza (prijedlozi skupštine možda nisu u `VOTING_OPEN` ili Ana nije u bazi) | visoko | Pravno obavezujuće glasanje može proći mimo vlasnika | srednja |
| V-N04 | Prijedlog (vlasnik u aplikaciji) | **Slijepa ulica za glasanje u aplikaciji.** Vlasnik sa pravom glasa vidi samo rečenicu „Lični link i verifikacioni kod dobili ste e-poštom — glasa se isključivo putem ličnog linka.” Nema: roka glasanja, statusa „izjasnili ste se / niste”, priloga, ni puta ako je e-poruka izgubljena (osim implicitno „obratite se predsjedniku” — koji se ovdje ni ne pominje). Nema ni „‹ Nazad”. | [`owner__skupstina_prijedlog_id__1440`](zateceno/owner__skupstina_prijedlog_id__1440.jpg), `…__375`; `src/app/(app)/skupstina/prijedlog/[id]/page.tsx:190-207` | posmatrano | visoko | Glas se gubi ako vlasnik izgubi e-poruku; nema potvrde da je glasao | visoka |
| V-N05 | E-glasački listić | **Prilozi prijedloga se ne prikazuju glasaču**, iako ih servis učitava (`attachments: true`), otisak teksta ih uključuje („sha256 of text+attachments”), a izjava koju glasač mora štiklirati kaže „pročitao/la prijedlog **u cijelosti**”. Za prijedlog tipa „izbor izvođača” ponuda je suština odluke. | [`public__glasanje_landing__1440`](zateceno/public__glasanje_landing__1440.jpg); `src/server/services/meetings.ts:1180` (učitava), `:1215-1229` (ne vraća); `prisma/schema.prisma:680, 688`; `glasanje/[token]/page.tsx:104-122, 155` | posmatrano (u seed-u prijedlog nema priloga, pa je praznina danas nevidljiva) | kritično | Pravna valjanost izjave „u cijelosti” je upitna; glasač odlučuje bez dokumenta | visoka |
| V-N06 | E-glasački listić | **Dva `primary` dugmeta u istoj regiji i ručni duplikat `ConfirmAction`-a.** `ToggleBtn variant="primary"` („Potvrdi i pošalji…”) i odmah ispod `SubmitBtn` (podrazumijevano `primary`, „Da, pošalji…”). Panel potvrde ručno kopira klase `ConfirmAction`-a. Na mobilnom „Potvrdi i pošalji” sa chevronom izgleda kao da šalje — a samo otvara panel. | [`public__glasanje_landing__375`](zateceno/public__glasanje_landing__375.jpg); `glasanje/[token]/page.tsx:158-178`; pravilo `Plans/design-system.md` §4.2 | posmatrano | visoko | Nejasno koji klik je konačan; kršenje DS pravila „najviše jedno primary” | visoka |
| V-N07 | E-glasački listić — greška | **Greška briše unos.** Pogrešan kod ili neštiklirana izjava rade `redirect(?err=…)`, pa se stranica vraća sa praznim izborom, kodom i izjavom; korisnik mora sve ponoviti, a poruka greške je ručni `div` bez `role="alert"`, prikazan samo na vrhu koraka 3. | `glasanje/[token]/page.tsx:36-38, 46-48, 125-127` | posmatrano (kod) | srednje | Frustracija i rizik da stariji korisnik odustane ili pogrešno ponovo izabere | visoka |
| V-N08 | E-glasački listić — potvrda | **Potvrda nije dokaz koji čovjek razumije.** Prikazuje samo interni `voteId` u mono fontu; ne kaže koji prijedlog, kada, ni (opciono) koji izbor; upućuje „detalje… u aplikaciji nakon prijave”, a vlasnik u aplikaciji svoje izjašnjenje ne vidi (V-N04). Ručni emerald okvir umjesto postojećih primitiva. | `glasanje/[token]/page.tsx:59-73`; `skupstina/prijedlog/[id]/page.tsx:199-205` | posmatrano (kod; potvrda nije screenshotovana) | srednje | Vlasnik nema čitljiv dokaz glasanja | visoka |
| V-N09 | E-glasački listić | **Sadržaj za čitanje ispod 13px i `slate-400` kao boja sadržaja**: linija otiska SHA-256 (`text-xs text-slate-400`), pravna fusnota „…nije kvalifikovani elektronski potpis” i „obratite se predsjedniku” (`text-xs`), naziv sjednice (`text-xs uppercase`). Checkbox izjave je 16px (`h-4 w-4`) — najmanja meta na stranici koja odlučuje o valjanosti. | [`public__glasanje_landing__375`](zateceno/public__glasanje_landing__375.jpg); `glasanje/[token]/page.tsx:105, 118, 154, 194` | posmatrano | srednje | Pravno bitna obavještenja su najmanje čitljiva; kršenje DS §2 i §1.2 | visoka |
| V-N10 | Listić, prijedlog, sjednica | **Interni žargon bez objašnjenja**: „Vaša glasačka težina: 1”, „(verzija 1)”, „Tehnički otisak teksta (SHA-256)”, „Niste u glasačkoj bazi ovog prijedloga.” (bez razloga — prijedlog je upravnog odbora, glasaju samo članovi). | [`public__glasanje_landing__375`](zateceno/public__glasanje_landing__375.jpg), [`owner__skupstina_prijedlog_id__375`](zateceno/owner__skupstina_prijedlog_id__375.jpg); `glasanje/[token]/page.tsx:101, 107, 118-121`; `skupstina/prijedlog/[id]/page.tsx:203` | posmatrano (tekst); nerazumijevanje — hipoteza | srednje | Nepovjerenje / zabuna „da li sam isključen?” | srednja |
| V-N11 | Detalj fakture — stavke | **Sirove interne varijable** u kolonama „Formula” i „Ulazi”: `rate=0.300000, usableArea=15.00`, `iznos = cijena_po_m2 × korisna_površina` (12px). Na 375 tabela skroluje horizontalno i kolona **Iznos je odsječena**. PDF iste fakture već koristi čitljiv `allocationBasis`. | [`owner__fakture_id__1440`](zateceno/owner__fakture_id__1440.jpg), [`owner__fakture_id__375`](zateceno/owner__fakture_id__375.jpg); `fakture/[id]/page.tsx:20-25, 191-197`; `documents.ts:256-258` | posmatrano | srednje | Vlasnik ne može provjeriti obračun; na telefonu ne vidi iznos stavke | visoka |
| V-N12 | Detalj fakture | **Dva statusa za jednu činjenicu**: plavi „Izdata” + amber „Dospjela (neplaćena)”; lista faktura za isti red prikazuje samo jedan chip. Uz to „Izdata: 24.10.2026.” a „Dospijeće: 15.09.2026.” — rok prije izdavanja. | [`owner__fakture_id__1440`](zateceno/owner__fakture_id__1440.jpg); `fakture/[id]/page.tsx:136-137` vs `fakture/page.tsx:345-351`; `:149-150` | posmatrano (chipovi); datumi — vjerovatno artefakt seed-a (hipoteza), ali UI ga ne sprječava ni ne objašnjava | srednje | Razvodnjen signal „kasnite”; zbunjujući datumi | srednja |
| V-N13 | Lista faktura | **Neplaćene nisu prve** (podrazumijevani sort po broju, opadajuće: plaćena 000002 iznad dospjele 000001); nema kolone „Preostalo za uplatu”; na 375 status chip se rasteže preko cijele širine reda (izgleda kao polje/dugme). Kumulativne „Ukupno zaduženo/plaćeno” žive na početnoj, a ne ovdje gdje pripadaju. | [`owner__fakture__1440`](zateceno/owner__fakture__1440.jpg), [`owner__fakture__375`](zateceno/owner__fakture__375.jpg); `fakture/page.tsx:29-39, 334-351`; card-transform `ui.tsx:211-213` (`grid-template-columns:40% 1fr`) | posmatrano | srednje | Sporije nalaženje onoga što treba platiti | visoka |
| V-N14 | Moje uplate | Ne vidi se **na koju fakturu je uplata raspoređena**; kolona „Radnje” je za vlasnika uvijek prazna (na 375 ostaje labela „Radnje” bez sadržaja); „Platilac” je uvijek on sam; na 375 labela „Poziv na broj” se renderuje u mono fontu (nasljeđuje `font-mono` ćelije). Nema „‹ Nazad” ka Fakturama. | [`owner__fakture_uplate__375`](zateceno/owner__fakture_uplate__375.jpg), `…__1440`; `fakture/uplate/page.tsx:15-19, 103, 236` | posmatrano | srednje | Posao 2 („na šta je otišla uplata”) zahtijeva otvaranje svake fakture | visoka |
| V-N15 | Poziv na broj | Poziv na broj je alfanumerički (`202609-936D4T`) i prikazan 12px mono. Slova poput `D`/`0`/`O` se lako pogrešno prepišu, a uparivanje uplate zavisi od njega. | [`owner__fakture_id__1440`](zateceno/owner__fakture_id__1440.jpg); `fakture/[id]/page.tsx:151`; format `prisma/seed.ts:324` | posmatrano (prikaz); da li banke u RS/BiH prihvataju slova u ovom polju i da li vlasnici griješe — **hipoteza** | srednje | Pogrešno prepisan poziv → neuparena uplata → lažni „dug” | niska |
| V-N16 | Početna — KPI | Četiri jednake `Stat` kutije; dvije su **kumulativne od početka** („Ukupno zaduženo 83,07”, „Ukupno plaćeno 75,85” — bez perioda) iste težine kao „Moj saldo”. „Ukupno plaćeno” je zeleno i vizuelno se takmiči sa narandžastim dugom. Na 375 labele se lome u dva reda. | [`owner__home__375`](zateceno/owner__home__375.jpg); `src/app/(app)/page.tsx:172-177` | posmatrano | srednje | Odgovor „koliko dugujem” je jedan od četiri broja | visoka |
| V-N17 | Sjednica (vlasnik) | Vlasniku se prikazuje **10-koračni interni tok sjednice** („Pozivi pripremljeni”, „Provjera rezultata”, „Zapisnik finalizovan”) sa 11px labelama; na 375 se prelama u tri reda sa visećim spojnicama. Vlasniku ne kaže ništa o njegovoj ulozi (kada, gdje, da li glasa). | [`owner__skupstina_id__375`](zateceno/owner__skupstina_id__375.jpg), `…__1440`; `skupstina/[id]/page.tsx:221-224`; `ui.tsx:126, 137` | posmatrano | srednje | Šum; važna informacija (termin, mjesto) je samo u podnaslovu | visoka |
| V-N18 | Početna — sjednice | „Predstojeće sjednice” miješa sjednice **upravnog odbora** (vlasnik nije član) sa skupštinom, bez oznake tijela; datum/vrijeme je 12px. | [`owner__home__1440`](zateceno/owner__home__1440.jpg); `src/app/(app)/page.tsx:165, 220-229` | posmatrano | nisko | Pogrešan utisak da je vlasnik pozvan | visoka |
| V-N19 | Održavanje | Forma sa 8 polja je **uvijek otvorena iznad** „Moje prijave”; na 375 lista počinje tek ~830px niže. „Kategorija” je slobodan tekst; checkbox „utiče na bezbjednost” je malim slovom, bez objašnjenja i sa podrazumijevanom (≈13px) metom; kolona „Prijavio” je za vlasnika uvijek on sam. | [`owner__odrzavanje__375`](zateceno/owner__odrzavanje__375.jpg); `odrzavanje/page.tsx:12, 83-112` (`:102`, `:111`) | posmatrano | srednje | Posao 5 („šta se dešava sa mojom prijavom”) je ispod forme | visoka |
| V-N20 | Detalj prijave | Podnaslov završava visećim „·” kad nema jedinice ni lokacije; vremena u „Tok statusa” i komentarima su 12px; nema „‹ Nazad”. | [`owner__odrzavanje_id__1440`](zateceno/owner__odrzavanje_id__1440.jpg); `odrzavanje/[id]/page.tsx:167, 203, 328` | posmatrano | nisko | Kozmetika / orijentacija | visoka |
| V-N21 | Dokumenti | Vlasniku se prikazuju kolone bez informacije za njega („Objavljen vlasnicima: Da” uvijek, „Status: Finalizovan”, „Verzija v1”); primarna kolona je šifra (`POZ-2026-0001`, 12px mono) umjesto naziva; na 375 svaka kartica ~360px. Kartica nema naslov. | [`owner__dokumenti__375`](zateceno/owner__dokumenti__375.jpg), `…__1440`; `dokumenti/page.tsx:16-25, 85` | posmatrano | nisko | Sporije nalaženje „poziva na sjednicu” ili „odluke” | visoka |
| V-N22 | Zgrade → Posebni dijelovi | Vlasnik vidi **imena svih vlasnika (sa udjelima) i zakupaca svih jedinica**; svoje jedinice nisu istaknute. Tabovi na 375 su odsječeni („Zajed…”). | [`owner__zgrade__tab-posebni__375`](zateceno/owner__zgrade__tab-posebni__375.jpg); `zgrade/page.tsx:105-115` (bez provjere uloge za kolone „Vlasnici”, „Stanari/zakupci”) | posmatrano (prikaz); da li je to pravno dozvoljeno/poželjno — **hipoteza**, pitanje V-Q5 | srednje | Moguće izlaganje ličnih podataka; „gdje su moje jedinice” traži skrolovanje | srednja |
| V-N23 | Planovi, Organi (375) | Tabele sa ≤5 kolona ne prelaze u kartice: lista planova odsijeca „Verzija/Status”, tabela upravnog odbora odsijeca kolonu; „Osnov: …” je 12px. | [`owner__planovi__375`](zateceno/owner__planovi__375.jpg), [`owner__organi__375`](zateceno/owner__organi__375.jpg); `planovi/page.tsx:15-21`; `organi/page.tsx:124, 135` | posmatrano | srednje | Horizontalni skrol na telefonu za starijeg korisnika | visoka |
| V-N24 | Podešavanja (vlasnik) | Hint upućuje na „Vlasnici i korisnici” — stranicu kojoj vlasnik **nema pristup** (i 12px). Pravno najvažnija kartica („Elektronsko glasanje — Nije pokrenuto”) je posljednja; nakon predaje izjave ne piše šta slijedi ni koliko traje. | [`owner__podesavanja__1440`](zateceno/owner__podesavanja__1440.jpg), `…__375`; `podesavanja/page.tsx:196-197, 227-253` | posmatrano | srednje | Vlasnik koji želi e-glasanje ga mora pronaći na dnu | visoka |
| V-N25 | Mobilna školjka | Dugme menija je tekstualni glif `☰` (`text-sm`) u `p-1.5` — ≈32px, ispod 44px praga koji DS traži za dodir; to je jedini put do navigacije na telefonu. | [`owner__home__375`](zateceno/owner__home__375.jpg); `src/components/nav-shell.tsx:290-297` | posmatrano | srednje | Stariji korisnik teško pogađa meni | visoka |
| V-N26 | PDF fakture | Iznos na PDF-u („UKUPNO ZA PLAĆANJE”) i u QR-u je `inv.total`, a ne preostali iznos — nakon djelimične uplate PDF traži puni iznos. QR je JSON označen „informativno”, ne bankarski standard. | `documents.ts:264, 271-273, 279` | posmatrano (kod) | srednje | Preplata ili zbunjenost kod djelimičnih uplata | visoka |
| V-N27 | E-glasanje — identitet | Listić kaže „Potvrda identiteta — sam link nije dovoljan dokaz”, ali se verifikacioni kod šalje **u istoj e-poruci** kao link — tekst obećava zaštitu koju tok ne daje. | `glasanje/[token]/page.tsx:148`; `meetings.ts:950-953` | posmatrano | srednje | Lažni osjećaj sigurnosti; pravni rizik ako je e-pošta kompromitovana | visoka |
| V-N28 | Prijava | Fusnota „Nalog dobijate od predsjednika…” je 12px. | [`anon__login__375`](zateceno/anon__login__375.jpg); `src/components/auth-shell.tsx:34` | posmatrano | nisko | Novi vlasnik bez naloga teško nalazi uputu | visoka |

Ukupno: **2 kritična, 4 visoka, 18 srednjih, 4 niska** (28).

### Preporuke

**V-R01 — Blok „Kako da platim” na detalju fakture** (rješava V-N01, V-N15, V-N26, dio V-N12)
- Šta: na `/fakture/[id]`, za neplaćenu fakturu, **prva kartica** postaje „Kako da platim”: veliki iznos za uplatu (preostali, ne ukupni), rok uz chip „Dospjela (neplaćena)” i broj dana kašnjenja, zatim `dl` sa: Primalac (`zev.legalName`), Račun primaoca (sa nazivom banke), Iznos, Poziv na broj (15px, `tabular-nums`, bez mono 12px), Svrha uplate. Ispod: „Preuzmi fakturu (PDF)” `secondary`. Za plaćenu fakturu kartica se ne prikazuje (ili prelazi u „Plaćeno dd.mm.”). PDF i QR koriste preostali iznos (V-N26).
- Zašto: posao br. 1 vlasnika danas nije rješiv u aplikaciji; svi podaci već postoje u bazi (`documents.ts:229-230`).
- Kompromis: više sadržaja na vrhu detalja; računovođa vidi isti blok (koristan i njemu za telefonske upite).
- Napor: **M**.
- Dizajn sistem: `Card`, `StatusBadge`, `SubmitBtn secondary`, postojeća tipografija — **samo postojeći tokeni/primitivi** za sam blok. Dugme „Kopiraj” uz račun i poziv na broj je **DOPUNA DS-a (traži odluku)**:
  - **A — bez kopiranja**; vrijednosti se samo prikažu krupno i sa `select-all` (klik selektuje cijelu vrijednost). Nula JS-a, nula novog obrasca; na telefonu i dalje dugi pritisak + „Kopiraj”.
  - **B — `secondary` dugme „Kopiraj” (kompaktna geometrija `RowAction`-a) + kratka povratna informacija „Kopirano” u samom dugmetu (2s)**. Mali client komponent nad postojećim `Btn`; novi obrazac je samo povratna informacija bez `Flash`-a.
  - **C — standardizovani bankarski QR (NBS/IPS-stil ili ekvivalent koji podržavaju banke u RS)** umjesto kopiranja. Najveća korist za e-bankarstvo, ali zavisi od standarda koji ne znamo da banke podržavaju (V-Q4).
  - **Preporuka: A odmah (Faza V1), B kao dopuna ako se odobri; C tek nakon provjere sa bankom.**

**V-R02 — „Moj pregled” rangiran po hitnosti: region „Za Vas sada”** (rješava V-N02, V-N03, V-N16, V-N18)
- Šta: odmah ispod `PageHeader`-a jedna `Card` „Za Vas sada” sa redovima (`divide-y`, bez unutrašnjih okvira — nema ugniježđene elevacije), poredanim: (1) dospjele fakture — chip „Dospjela (neplaćena)”, iznos, „rok je bio 15.09.2026. (prije 39 dana)”, **jedino `primary` dugme na ekranu „Kako da platim”** (vodi na V-R01); (2) otvorena glasanja u kojima vlasnik ima pravo glasa — rok, status „Niste se izjasnili / Izjasnili ste se”, `secondary` „Pogledaj prijedlog”; (3) ako postoji otvoreno glasanje a e-glasanje nije uključeno — rečenica šta to znači + `tonal` „Uključi e-glasanje” (vodi na Podešavanja); (4) fakture koje dospijevaju u narednih N dana. Kad nema ništa: stanje uspjeha „Sve je izmireno. Nema glasanja koja čekaju na Vas.” sa datumom posljednje uplate.
  `Stat` red se smanjuje na **dva**: „Dugujete ukupno” (`warn`/`ok`) i „Avans / preplata”; kumulativne vrijednosti prelaze na `/fakture` (V-R06). Ostale kartice (sjednice — samo skupština ili sa oznakom tijela; uplate; odluke; prijave) ostaju ispod, nepromijenjene.
- Zašto: odgovor „koliko dugujem i šta moram uraditi” mora biti prvi pogled, ne jedan od deset elemenata iste težine.
- Kompromis: početna postaje dinamičnija (raspored se mijenja sa stanjem); traži jasno pravilo rangiranja.
- Napor: **M**.
- Dizajn sistem: kompozicija od `Card`, `StatusBadge`, `BtnLink` (`primary`/`secondary`/`tonal`), `Stat` — bez nove boje i komponente. Ali „lista radnji sa prioritetom” je **novi obrazac na nivou stranice → DOPUNA DS-a (traži odluku)**:
  - **A — kompozicija postojećih primitiva** (Card + redovi + chip + jedno dugme po redu, `primary` samo na najhitnijem), dokumentovana u `design-system.md` kao obrazac „Za Vas sada”. Bez novog koda u `ui.tsx`.
  - **B — novi primitiv `Notice`** (amber/tonal panel nivoa 0, iste klase kao tijelo `ConfirmAction`-a) za svaku stavku. Glasnije, ali uvodi novu „kutiju” i rizik da se počne koristiti za sve.
  - **C — `Flash` na vrhu** za dug. Pogrešna semantika (`Flash` je odgovor na radnju, `role="alert"`), i ne skalira na više stavki.
  - **Preporuka: A.**

**V-R03 — E-glasački listić: potpun, jedno `primary`, greška ne briše unos, čitljiva potvrda** (rješava V-N05, V-N06, V-N07, V-N08, V-N09, V-N10)
- Šta:
  1. U koraku 2 lista **priloga** (naziv, veličina, „Otvori PDF”) preko tokena — prije izjave „pročitao/la u cijelosti”.
  2. Korak 3: okidač panela postaje `secondary` „Pregledaj i potvrdi”; u amber panelu jedino `primary` „Da, pošalji izjašnjenje”. Sažetak u panelu ponavlja **naslov prijedloga**, ne samo šifru.
  3. Greška (`bad_code`, `ack`) vraća stranicu sa **zadržanim izborom i štikliranom izjavom** (kod se može očistiti), poruka kroz `Flash` (`role="alert"`) neposredno iznad polja koje je problem.
  4. Sav tekst ≥13px, bez `slate-400` za sadržaj; checkbox izjave dobija veću labelu/metu (cijela labela je klikabilna, `min-h-[44px]`). Otisak SHA-256 ide u `<details>` „Tehnički detalji”.
  5. Copy: red „Vaša glasačka težina” se **uklanja** (odluka K-03: jedan etažni vlasnik — jedan glas, uvijek 1). Umjesto njega, ako vlasnik ima više posebnih dijelova: „Glasate jednom, kao etažni vlasnik Stana 1 i Garaže 1.”; „verzija 1” se prikazuje samo ako postoji više verzija; poruka „Link je istekao.” dobija sljedeći korak.
  6. Potvrda: `Card` sa naslovom prijedloga, datumom i vremenom, (opciono izborom — V-Q3), brojem potvrde, i „Odštampaj potvrdu”.
- Zašto: pravno obavezujuća, jednokratna radnja za korisnika koji aplikaciju vidi prvi put.
- Kompromis: duža stranica (prilozi); izmjena `submitVote` povratka da očuva stanje.
- Napor: **M**.
- Dizajn sistem: tačke 2–6 su **samo postojeći tokeni/primitivi**. Tačka 2 traži da se `ConfirmAction` koristi unutar postojeće forme (danas sam pravi svoj `<form>`, pa ga listić ne može koristiti i duplira ga) — **DOPUNA DS-a (traži odluku)**:
  - **A** — zadržati ručni panel, ali uskladiti težine (okidač `secondary`, potvrda `primary`) i komentarom vezati za `ConfirmAction`. Brzo, ali duplikat ostaje.
  - **B** — proširiti `ConfirmAction` opcijom „bez sopstvene forme” (renderuje `<div>` i `type="submit"` dugme koje predaje okolnu formu). Jedan primitiv, nula vizuelnih promjena.
  - **C** — poseban korak/stranica „Pregled izjašnjenja”. Više stanja, suprotno odluci o jednoj stranici (`glasanje/[token]/page.tsx:9-10`).
  - **Preporuka: B.** Napomena: težina potvrde ovdje je `primary`, a ne podrazumijevana `caution` — glas nije „ozbiljna ali ne-destruktivna” administrativna radnja nego očekivani sljedeći korak; to treba eksplicitno upisati u DS kao izuzetak.

> **Odluka korisnika K-03a (2026-10-24):** suvlasnici istog posebnog dijela zajedno imaju jedan glas, preko zajedničkog predstavnika (`design-review-plan.md`). Za vlasnika to znači:
> - lični link i verifikacioni kod dobija samo predstavnik;
> - suvlasnik koji nije predstavnik na prijedlogu vidi stanje „Za Stan 3 glasa Vaš zajednički predstavnik Nikola Ilić · Zajednica se izjasnila 24.10.2026.” (ili „još se nije izjasnila”), bez prikaza izbora;
> - na „Za Vas sada” (V-R02) glasanje se pojavljuje kao zadatak samo predstavniku, a ostalim suvlasnicima kao informacija.

**V-R04 — Prijedlog i sjednica kako ih vidi vlasnik** (rješava V-N04, V-N10, V-N17, V-N18)
- Šta: kartica „Vaše učešće” na prijedlogu dobija stanje: „Imate pravo glasa · glasanje traje do 03.11.2026. 07:53 · **Niste se izjasnili**” ili „Izjasnili ste se 24.10.2026. u 09:12” ili „Ovo je prijedlog upravnog odbora — o njemu glasaju članovi odbora.”; plus šta uraditi ako link nije stigao (vidi V-Q2). Prilozi prijedloga. `PageHeader backHref` na sjednicu. Na sjednici vlasnik umjesto 10-koračnog `StatusTimeline`-a vidi termin, mjesto i 3 koraka relevantna za njega (Zakazana → Glasanje otvoreno → Odluka objavljena) ili samo `StatusBadge`; kolona „Vaš status” u tabeli prijedloga.
- Zašto: vlasnik u aplikaciji danas ne može saznati da li je njegov glas zabilježen.
- Kompromis: dodatni upit (glas po `eligibleVoter`), bez otkrivanja tuđih glasova.
- Napor: **S–M**.
- Dizajn sistem: **samo postojeći tokeni/primitivi** (`Card`, `StatusBadge`, `StatusTimeline` sa manje koraka, `PageHeader backHref`).

**V-R05 — Fakture i uplate: neplaćeno prvo, čitljiv obračun, veza uplata→faktura** (rješava V-N11, V-N12, V-N13, V-N14)
- Šta: lista vlasnika podrazumijevano sortira neplaćene (dospjele prve), dodaje kolonu „Preostalo”, a iznad tabele dva `Stat`-a koja su sišla sa početne („Ukupno zaduženo”, „Ukupno plaćeno” — sa periodom). Detalj: jedan status chip (kao u listi); stavke kao „Stavka · Osnov obračuna (čitljivo, npr. 15 m² × 0,30 KM) · Iznos” — tri kolone, na 375 bez odsijecanja; tehnička formula samo za upravu. Moje uplate: kolona „Raspoređeno na” (linkovi na fakture), bez „Radnje” i „Platilac” za vlasnika, `backHref="/fakture"`. Ispravka card-transform-a: chip u ćeliji ne rasteže (`justify-self:start`), labela ne nasljeđuje `font-mono`.
- Napor: **M** (ispravka card-transform-a je globalna, **S**).
- Dizajn sistem: **samo postojeći tokeni/primitivi** (ispravka u `Table` primitivu je bugfix, ne novi obrazac).

**V-R06 — Održavanje: moje prijave prve, forma na zahtjev** (rješava V-N19, V-N20)
- Šta: za vlasnika „Moje prijave” iznad; forma iza `ToggleBtn` „Prijavi novi kvar” (`tonal`) u `<details>`, otvorena automatski samo kad vlasnik nema nijednu prijavu. „Kategorija” → `<select>` sa ponuđenim vrijednostima + „Drugo”; checkbox → `Field` sa hintom „Označite ako postoji opasnost po ljude ili imovinu (struja, gas, voda u instalacijama)”. Kolona „Prijavio” skrivena vlasniku. Detalj: podnaslov bez visećeg separatora, vremena 13px, `backHref`.
- Napor: **S**. Dizajn sistem: **samo postojeći tokeni/primitivi**.

**V-R07 — Čitljivost na 375 za starijeg korisnika** (rješava V-N09 dio, V-N23, V-N25, V-N28, V-N22 dio)
- Šta: dugme menija 44×44 sa ručno crtanom ikonom „meni” po `IconBase` konvenciji (3 linije, `nav-icons.tsx`); na stranicama vlasnika `text-xs` → `text-[13px]` za sve rečenice (Osnov, rok, vremena, fusnote); `ColumnSpec.priority` na tabelama planova i upravnog odbora tako da se na 375 ne odsijecaju kolone.
- Napor: **S**. Dizajn sistem: **samo postojeći tokeni/primitivi** (nova ikona prati postojeću konvenciju §5; nije nova biblioteka ni stil).

**V-R08 — Dokumenti i Podešavanja za vlasnika** (rješava V-N21, V-N24)
- Šta: Dokumenti vlasniku: kolone Naziv (primarna) · Vrsta · Datum · „Preuzmi PDF”; bez „Objavljen vlasnicima”, „Status”, „Verzija” (osim kad postoji više verzija). Podešavanja: kad e-glasanje nije uključeno, kartica „Elektronsko glasanje” ide **prva** i dobija 3 numerisana koraka (preuzmi → potpiši → predaj predsjedniku) i stanje nakon predaje; hint „Ime, prezime i adresu nekretnine mijenja predsjednik ZEV-a — obratite mu se ako nešto nije tačno.” (bez reference na nedostupnu stranicu).
- Napor: **S**. Dizajn sistem: **samo postojeći tokeni/primitivi**.

**V-R09 — Verifikacioni kod drugim kanalom ili iskren tekst** (rješava V-N27)
- Šta: ili kod ide SMS-om / štampanim pozivom (drugi kanal), ili se hint mijenja u iskren („Kod iz iste poruke štiti od slučajno proslijeđenog linka”). Odluka je pravna/bezbjednosna (V-Q6).
- Napor: S (tekst) / L (drugi kanal). Dizajn sistem: n/a (copy).

### Predložene faze za ovu grupu

**Faza V1 — „Kako da platim” (novac)** — V-R01 (opcija A za kopiranje), V-R05.
- Zašto prvo: najveći uticaj (kritični V-N01), mali rizik, bez pravnih pitanja.
- Zavisnosti: nijedna; V-Q4 utiče samo na QR, ne blokira.
- Rizik: nizak; računovođa vidi isti blok — provjeriti da njegove kontrole (korekcija, storno) ostanu ispod.
- Provjera: živi pregled `/fakture`, `/fakture/[id]` (neplaćena, plaćena, djelimično plaćena, korektivna), `/fakture/uplate` na 1440 i 375; a11y: redoslijed naslova, `dl` struktura, nijedan tekst <13px, kontrast.
- Izlazni kriterijum: vlasnik na 375 dolazi do računa primaoca, iznosa i poziva na broj u ≤2 tapa od početne, bez PDF-a.

**Faza V2 — „Moj pregled” po hitnosti** — V-R02.
- Zavisnost: V1 (CTA „Kako da platim” vodi na novi blok). Odluka o obrascu (V-R02 A/B/C).
- Rizik: srednji — pravilo rangiranja mora biti deterministično; provjeriti stanja: dug+glasanje, samo dug, samo glasanje, glasanje bez e-saglasnosti, sve izmireno, nalog bez `partyId`.
- Provjera: 1440/375 za svih šest stanja; jedno `primary` po ekranu; čitač ekrana čita „Za Vas sada” prije KPI-ja.
- Izlazni kriterijum: u stanju „dug” prvi element ispod naslova je dospjela faktura sa CTA; u stanju „sve izmireno” postoji eksplicitna potvrda.

**Faza V3 — Glasanje (listić + prijedlog za vlasnika)** — V-R03, V-R04, (V-R09 tekst).
- Zavisnosti: odgovori na V-Q1, V-Q2, V-Q3; odluka o `ConfirmAction` (V-R03 B).
- Rizik: srednji–visok — pravno osjetljivo; izmjena toka slanja (očuvanje stanja) mora zadržati jednokratnost i rate limit. Uključiti predsjednika u pregled teksta.
- Provjera: živi pregled `/glasanje/[token]` (svježe, pogrešan kod, bez izjave, istekao, iskorišten, potvrda) na 375 i 1440; tastatura do kraja bez miša; VoiceOver čita izbor u panelu potvrde.
- Izlazni kriterijum: tačno jedno `primary`; prilozi dostupni; greška ne briše izbor; potvrda navodi prijedlog i vrijeme; vlasnik u aplikaciji vidi „izjasnili ste se”.

**Faza V4 — Higijena ostalih stranica vlasnika** — V-R06, V-R07, V-R08.
- Zavisnosti: nijedna (može paralelno sa V1); V-N22 čeka V-Q5.
- Rizik: nizak.
- Provjera: 375 bez horizontalnog skrola na Planovima/Organima; dugme menija 44px; pretraga `text-xs` u stranicama vlasnika = samo zaglavlja tabela i `Stat` labele.
- Izlazni kriterijum: svi screenshotovi `owner__*__375` bez odsječenih kolona i bez rečenica <13px.

### Otvorena pitanja za korisnika

- **V-Q1 — Može li prijavljen vlasnik (sa uključenom e-saglasnošću) glasati direktno u aplikaciji?** Danas samo lični link. (a) Da: nestaje slijepa ulica „izgubio sam e-poruku”, prijava već potvrđuje identitet; ali mijenja pravni model (izjava, otisak, dokaz) i traži pravnu provjeru. (b) Ne: zadržati link, ali aplikacija mora pokazati status i put do novog linka (V-R04). **Preporuka: (b) sada, (a) kao zaseban plan sa pravnom provjerom.**
- **V-Q2 — Ko izdaje novi lični link?** Danas samo predsjednik (`meetings.ts:1140`). (a) Samoposluga „Pošalji mi link ponovo” na prijedlogu (na postojeću e-adresu, poništava stari) — manje opterećenje predsjednika, rizik ako je e-adresa kompromitovana; (b) samo predsjednik, a aplikacija jasno kaže koga i kako kontaktirati. **Preporuka: (b) uz kontakt predsjednika na ekranu; (a) razmotriti uz drugi kanal koda.**
- **V-Q3 — Treba li potvrda glasanja prikazati izbor (Za/Protiv/Uzdržan)?** Za: vlasnik ima čitljiv dokaz. Protiv: URL potvrde (`?receipt=`) se može proslijediti/ostati u istoriji pregledača, pa izbor postaje vidljiv trećima. **Preporuka: prikazati prijedlog, vrijeme i broj potvrde; izbor samo na ekranu odmah nakon slanja (ne u URL-u), uz „Odštampaj”.**
- **V-Q4 — Uplatnica i QR**: da li postoji bankarski standard QR/uplatnice koji banke u RS/BiH prihvataju i da li je alfanumerički poziv na broj prihvatljiv za sve banke? Od odgovora zavisi V-R01 opcija C i eventualna promjena formata poziva na broj (V-N15). **Preporuka: provjeriti sa NLB/bankom ZEV-a prije bilo kakve izmjene formata.**
- **V-Q5 — Smije li vlasnik vidjeti imena drugih vlasnika i zakupaca** (Zgrade → Posebni dijelovi)? (a) Da, kao članovi skupštine (provjeriti zakonski osnov); (b) ne — vlasnik vidi samo svoje jedinice i agregate; (c) samo imena vlasnika bez zakupaca/udjela. **Preporuka: (b) dok se pravni osnov ne potvrdi; istaći „Moje jedinice”.**
- **V-Q6 — Verifikacioni kod drugim kanalom (SMS / štampano)?** Ako ne, mijenjamo tekst da ne obećava više nego što daje (V-R09). **Preporuka: kratkoročno iskren tekst; drugi kanal kao zaseban plan (zavisi od SMS provajdera).**
- **V-Q7 — Odobravanje DOPUNA**: obrazac „Za Vas sada” (V-R02, preporuka A), dugme „Kopiraj” (V-R01, preporuka A pa B), `ConfirmAction` bez sopstvene forme + izuzetak `primary` za potvrdu glasa (V-R03, preporuka B).

### Mockupi

- [V-M01-pocetna-vlasnika.html](mockups/V-M01-pocetna-vlasnika.html) — „Moj pregled” preuređen po hitnosti: stanje „dug + otvoreno glasanje + e-glasanje nije uključeno” (desktop 1440 i mobilni 375) i stanje „sve izmireno” (mobilni 375). Pokriva V-R02 (i KPI dio V-R05), nalaze V-N02, V-N03, V-N16, V-N18, V-N25.
- [V-M02-faktura-kako-platiti.html](mockups/V-M02-faktura-kako-platiti.html) — detalj fakture sa blokom „Kako da platim”, jednim status chipom, čitljivim osnovom obračuna (desktop i mobilni) i opcijom „Kopiraj” označenom kao DOPUNA. Pokriva V-R01, V-R05; nalaze V-N01, V-N11, V-N12, V-N15, V-N26.
- [V-M03-e-glasacki-listic.html](mockups/V-M03-e-glasacki-listic.html) — e-glasački listić na 375 (sa prilozima, jednim `primary`, panelom potvrde, stanjem greške koje čuva izbor i ekranom potvrde) i na desktopu. Pokriva V-R03 (i copy V-R09); nalaze V-N05–V-N10, V-N27.
