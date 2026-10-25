# Pregled dizajna aplikacije po korisničkim tokovima — prijedlog za odobravanje po fazama

**Status: ČEKA PREGLED KORISNIKA (2026-10-24).** Ovo je **dizajn pregled**, ne implementacioni plan. Nijedan red koda aplikacije nije promijenjen. Kad korisnik odobri jednu fazu iz §6, ta faza se pretvara u zaseban implementacioni plan u `Plans/` (po fajlovima, sa verzijom), u stilu postojećih planova.

Nastalo na zahtjev korisnika (2026-10-24): „sveobuhvatna analiza dizajna aplikacije, u fazama, sa preporukama izmjena; fazni pristup u kojem pregledam i odobrim dizajn, a zatim se pretvara u plan implementacije; po korisničkom toku ili po grupama stranica, da izmjene mogu uvoditi postepeno”.

Analizu su uradila četiri paralelna Opus prolaza, jedan po grupi tokova. Ovaj dokument ih spaja, uklanja duplikate između uloga i predlaže redoslijed. Detaljni nalazi, sa dokazom za svaki, su u četiri priloga:

| Prilog | Grupa | Nalazi (krit./visoko/srednje/nisko) | Mockupi |
|---|---|---|---|
| [01-zajednicko-skoljka-admin.md](design-review/01-zajednicko-skoljka-admin.md) | **X** — školjka, navigacija, prijava, podešavanja, evidencije, platformski admin, unakrsna dosljednost | 1 / 7 / 12 / 5 | X-M01, X-M02, X-M03 |
| [02-vlasnik.md](design-review/02-vlasnik.md) | **V** — etažni vlasnik: početna → fakture i plaćanje → glasanje → održavanje, dokumenti, podešavanja | 2 / 4 / 18 / 4 | V-M01, V-M02, V-M03 |
| [03-racunovodja.md](design-review/03-racunovodja.md) | **R** — računovođa: serije → uplate, izvodi, SMS → uparivanje → troškovi → izvještaji | 2 / 10 / 11 / 1 | R-M01, R-M02, R-M03 |
| [04-predsjednik.md](design-review/04-predsjednik.md) | **P** — predsjednik: sjednice i prijedlozi → režim uživo → vlasnici, jedinice, organi, planovi, održavanje, dokumenti | 2 / 9 / 12 / 2 | P-M01, P-M02, P-M03 |
| **Ukupno** | | **7 / 30 / 53 / 12 = 102** (prije spajanja duplikata, §4) | 13 mockupa (X-M04 dodat uz K-02) |

Mockupi su u [`design-review/mockups/`](design-review/mockups/). To su samostalni HTML fajlovi koji koriste iste Tailwind klase kao `ui.tsx` i `nav-shell.tsx`, svaki sa desktop (1440) i mobilnim (375) prikazom i numerisanim anotacijama. Otvaraju se direktno u pregledaču; Tailwind i Roboto se učitavaju sa CDN-a, pa je potrebna mreža. Dokazi (screenshoti zatečenog stanja) su u [`design-review/zateceno/`](design-review/zateceno/).

---

## Kako odobravati

1. Pročitajte §0 (rezime) i §5 (odluke o dizajn sistemu). Odluke D1–D9 su jedina mjesta gdje se predlaže nešto što sistem danas nema.
2. Za svaku fazu u §6 pogledajte navedene mockupe. Odgovorite „odobreno”, „odobreno uz izmjene: …” ili „ne sada”.
3. Odobrena faza → implementacioni plan u `Plans/<faza>-plan.md` → implementacija → živi pregled 1440/375 → `CHANGELOG.md` + verzija, koju potvrđujete Vi.

### Odluke korisnika (unose se kako stižu)

- **K-01 (2026-10-24) — Vlasnički udio nije kapija za dodavanje vlasnika.** Zbir udjela na jedinici ne mora biti 100% da bi se dodao novi vlasnik. Evidencija se može voditi postepeno, a nepotpun zbir se prikazuje kao upozorenje, nikad kao blokada.
  - **Zatečeno stanje (provjereno u kodu):** `addOwnershipStake` (`src/server/services/ownership.ts:136-138`) već dozvoljava zbir ispod 100%. Odbija samo udio koji bi zbir na jedinici podigao **iznad** 100% („Zbir udjela za jedinicu prelazi 100%”). Upozorenje „zbir treba biti 100%” na Zgrade → Posebni dijelovi (`zgrade/page.tsx:94, 213`) odnosi se na udjele jedinica u ZEV-u i samo informiše.
- **K-01a (2026-10-24) — Ni prekoračenje 100% ne blokira dodavanje vlasnika; samo upozorenje.** Tipičan slučaj: novi vlasnik ili suvlasnik se upisuje prije nego što je stari udio zatvoren. Provjera u `addOwnershipStake` (`ownership.ts:136-138`) prestaje bacati grešku. Umjesto toga vraća upozorenje koje forma prikazuje uz uspjeh: „Udio je dodat. Zbir udjela za Stan 3 je sada 150 % — zatvorite udio prethodnog vlasnika (Promjena vlasništva).” Udio ispod 0 ili iznad 100% za **jednog** vlasnika ostaje greška unosa.
  - Ostala pravila za dodavanje udjela ostaju: dokaz o vlasništvu je obavezan i upis se audituje.

- **K-01b — Kako glasanje tretira jedinicu sa zbirom iznad 100% (PRIJEDLOG, traži odluku).** *(Zastarjelo u dijelu o težini i opcijama B/C: po K-03 nema težine po udjelu. Važeća formulacija je u K-03, tačka 5; preporuka A ostaje.)*

  **Zašto je bitno:** glasačka težina vlasnika je `udio vlasnika × udio jedinice u ZEV-u` (ili × površina), zbirno po njegovim jedinicama (`ownersVotingBasis`, `ownership.ts:491-502`). Ukupna glasačka težina, od koje se računaju kvorum i većina, je zbir težina svih glasača (`meetings.ts:849`). Jedinica sa 150% upisanog udjela zato:
  - nosi 1,5× svoju stvarnu težinu;
  - **razvodnjava sve ostale vlasnike**, jer im povećava imenilac;
  - kod metode „jedan vlasnik — jedan glas” (`PER_OWNER`) dodaje jednu glavu više.

  Rezultat je pogrešan, ali to niko ne vidi. Pravilo `ruleSnapshot` se zamrzava pri otvaranju glasanja, pa se pogrešna osnova kasnije ne može ispraviti bez nove verzije prijedloga.

  | Opcija | Šta se dešava pri otvaranju glasanja | Za | Protiv |
  |---|---|---|---|
  | **A — Ne otvara se dok se ne ispravi** | `openVoting` (i „Otvori glasanje” u režimu uživo) odbija otvaranje ako neka jedinica u obimu glasanja ima zbir iznad 100%. Poruka imenuje jedinice i nudi link na ispravku. | Pravno najčistije: osnova glasanja je uvijek tačna i objašnjiva. Prisiljava na ispravku tamo gdje greška i nastaje (nezatvoren stari udio). | Greška u evidenciji može zaustaviti glasanje na dan sjednice ako se ne uoči ranije. |
  | **B — Normalizacija po jedinici** | Težina svakog vlasnika na takvoj jedinici se računa kao `njegov udio / zbir udjela`. Jedinica nikad ne nosi više od svoje težine. Normalizacija se upisuje u `ruleSnapshot` i u PDF glasačke liste. | Glasanje nikad nije blokirano; ukupna težina je tačna. | Tiho mijenja upisani udio: vlasnik sa 50% glasa sa 33%. Teško objasniti vlasniku i ranjivo pred osporavanjem. |
  | **C — Broji se kako je upisano, uz upozorenje** | Bez izmjene računice; samo upozorenje predsjedniku. | Nula koda. | Rezultat glasanja je pogrešan, a ostali vlasnici razvodnjeni. **Ne preporučuje se.** |

  **Preporuka: A, uz rano upozorenje, tako da blokada u praksi ne iznenadi:**
  1. **Na jedinici i detalju vlasnika:** chip „Zbir 150 %” i rečenica sa radnjom („Zatvorite udio prethodnog vlasnika”).
  2. **„Za Vas sada” predsjednika (D1):** stavka „N jedinica ima zbir udjela iznad 100 % — ispravite prije glasanja”.
  3. **Panel „Sljedeći korak” na sjednici (D2):** preduslov ⚠ „Osnova glasanja: Stan 3 ima 150 %” prije koraka „Otvori glasanje”, sa linkom.
  4. **Potvrda otvaranja glasanja:** desktop i uživo ponavljaju provjeru. Ako problem postoji, dugme potvrde se ne prikazuje, nego se prikazuje spisak jedinica.

  Ako je važnije da glasanje **nikad** ne stane, rezervna opcija je **B**, ali samo uz izričitu potvrdu predsjednika u panelu potvrde („Glasaće se sa normalizovanim udjelima za: Stan 3”) i zapis u glasačkoj listi. Odluka je pravna koliko i dizajnerska; preporuka je da je potvrdi pravnik ZEV-a.

- **K-01c — Povezano: jedinica sa zbirom ispod 100% (PITANJE, bez prijedloga izmjene).** *(Zastarjelo: po K-03 imenilac je broj etažnih vlasnika. Važeća formulacija je u K-03, tačka 6.)* Neupisani dio udjela danas ne glasa i **ne ulazi u imenilac**, pa je kvorum lakše postići nego da je evidencija potpuna. K-01 to sada izričito dozvoljava kao normalno stanje evidencije. Preporuka:
  - za sada samo upozorenje, isto kao u K-01b (tačke 1–3), sa tekstom „Upisano 50 % od 100 %”;
  - otvaranje glasanja se ne blokira;
  - pitanje da li neupisani dio treba ulaziti u imenilac kvoruma ide pravniku. Ako da, to je izmjena `openVoting`, ne dizajna.

- **Gdje slijeće:** u **F8**, vidi tamo, uz zavisnost od K-02 ispod.

- **K-02 (2026-10-24) — Suštinski problem je registar posebnih dijelova, ne zbir udjela vlasnika.** *(Dio o „pravu glasa” po posebnom dijelu i o imeniocu u procentu udjela zamijenjen je odlukom K-03 ispod; registar kao temelj ostaje.)* Udio i pravo glasa se moraju utvrditi **prije** nego što se doda prvi vlasnik. Prvo se unosi tačan i konačan broj posebnih dijelova, uz oznaku koji daju pravo glasa, a koji ne (npr. stanovi da, garaže ne). Tek nad tako utvrđenim registrom primjenjuju se pravila o kvorumu i većini za usvajanje prijedloga.

  **Zatečeno stanje (provjereno u kodu):**
  - Jedinice se mogu dodavati i mijenjati u bilo kom trenutku (`createUnit`, `updateUnit`, `src/server/services/property.ts:113-163`), i prije i poslije upisa vlasnika i otvaranja glasanja.
  - `updateUnit` mijenja i `ownershipShare` (udio jedinice u ZEV-u), ali **audit tu promjenu ne bilježi**: zapisuje samo oznaku, površinu i broj korisnika (`:156-160`).
  - `Unit` nema polje za pravo glasa. `type` (`APARTMENT` / `BUSINESS` / `GARAGE` / `OTHER`, `schema.prisma:328`) se koristi samo za obračun.
  - Glasačka osnova (`ownersVotingBasis`, `ownership.ts:479-505`) uzima **svaku aktivnu jedinicu sa upisanim vlasnikom**, uključujući garaže.
  - Imenilac kvoruma je zbir težina **upisanih glasača**, ne registra (`meetings.ts:849`). Zato jedinica bez upisanog vlasnika ili sa nepotpunim udjelom jednostavno nestaje iz računice (K-01c).
  - Registar nema stanje „utvrđen”. Zbir udjela jedinica od 100% je samo informativno upozorenje (`zgrade/page.tsx:94, 213`).

  **Posljedica za K-01:** K-01b i K-01c su simptomi istog uzroka. Kad je registar utvrđen, imenilac kvoruma i većine se računa iz **registra**: zbir udjela (ili površina, ili broj) svih posebnih dijelova sa pravom glasa u obimu glasanja, a ne zbir upisanih glasača.
  - **K-01c je time riješen.** Neupisani dio udjela ulazi u imenilac, ali nema ko da glasa za njega. To je ispravno, jer kvorum postaje teže postići, ne lakše.
  - **K-01b se sužava** na jedan slučaj: vlasnički udjeli unutar **jedne** jedinice prelaze 100% (prelazno stanje kod prodaje). Preporuka A ostaje: glasanje se ne otvara dok se ne ispravi. Pošto je imenilac sada fiksan, takva jedinica ne razvodnjava ostale, ali bi sama nosila više od svoje težine.
  - **K-01 i K-01a ostaju:** zbir udjela **vlasnika unutar jedinice** ne blokira dodavanje vlasnika. Nova kapija iz K-02 je druge vrste: vlasnik se ne može dodati dok **registar jedinica** nije utvrđen.

  Prijedlog je razrađen kao zasebna faza **FR — Registar posebnih dijelova** u §6. Otvorena pitanja su FR-Q1 do FR-Q5.

- **K-03 (2026-10-24) — Ko je etažni vlasnik i koliko glasova ima (pravno pravilo, od korisnika).** Ovo pravilo **mijenja dio K-01 i K-02**; gdje se razlikuju, važi K-03.
  - **Ko je etažni vlasnik:** prema zakonu o stanovanju, svaki vlasnik **bilo kog** posebnog dijela je etažni vlasnik, uključujući vlasnike garaža i garažnih mjesta. Ne postoje posebni dijelovi „bez prava glasa”. Kolona „Pravo glasa” iz K-02 i FR-Q1 se **ukidaju**.
  - **Koliko glasova ima:** jedan etažni vlasnik ima **jedan glas**, bez obzira na to koliko posebnih dijelova ima. Kvorum i većina se **uvijek** računaju po broju etažnih vlasnika, bez duplikata. Procenat udjela i površina se za glasanje ne koriste. Suvlasnici istog posebnog dijela su zajedno jedan etažni vlasnik u smislu glasanja (K-03a).

  **Kako se to slaže sa kodom (provjereno):**
  - Metoda `PER_OWNER` već radi tačno ovo. `ownersVotingBasis` grupiše po licu (`ownership.ts:479-505`), pa Ana Savić sa Stanom 1 i Garažom 1 ima jedan glas. Garaže su već uključene, jer osnova uzima sve aktivne jedinice.
  - Problem je što je metoda **konfigurabilna** (`WeightMethod`: `PER_OWNER` / `OWNERSHIP_SHARE` / `USABLE_AREA`, `schema.prisma:629-633`). Podrazumijevana pravila skupštine u seed-u koriste `OWNERSHIP_SHARE` sa kvorumom u procentu udjela (`prisma/seed.ts:293-300`).
  - `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` §3 tačke 2 i 3 ovo vode kao **[PRAVNA PROVJERA]**. K-03 je odgovor na to pitanje, pa se taj dokument ažurira u istoj isporuci.

  **Posljedice za plan:**
  1. **Pravila glasanja skupštine:** težina je uvijek „jedan etažni vlasnik — jedan glas”. Kvorum je procenat **broja** etažnih vlasnika (`PERCENT_OF_OWNER_COUNT`); većina je od glasova datih po glavi, ili od ukupnog broja etažnih vlasnika za odluke koje to traže.
     - Izbor metode težine nestaje iz forme „Pravila glasanja” (`skupstina/page.tsx`).
     - Postojeća pravila sa `OWNERSHIP_SHARE` ili `USABLE_AREA` se prevode ili arhiviraju migracijom.
     - Već otvorena i zatvorena glasanja ostaju na pravilu zamrznutom u `ruleSnapshot`.
     - Upravni odbor je i danas `PER_OWNER` po članu, pa ga ova izmjena ne mijenja.
  2. **Udio u procentima ostaje, ali samo za ono čemu služi:**
     - udio posebnog dijela u zajedničkim dijelovima (`Unit.ownershipShare`) je osnova za troškove, npr. fond rezerve;
     - vlasnički udio unutar jedinice (`OwnershipStake.sharePercent`) je evidencija vlasništva i koristi se za izbor primaoca računa.
     - U UI-ju za glasanje se ne prikazuje nijedan od ova dva procenta.
  3. **Brojevi u glasanju su brojevi ljudi.** Gdje pregled predlaže „% udjela”, umjesto toga ide broj etažnih vlasnika:
     - P-R05: „učestvovalo 4 od 5 glasova”, umjesto „0 od 36.9”;
     - P-R08: traka uživo „Prisutno 4 od 5 · kvorum: potrebno 3”;
     - P-R01 / P-M01: preduslovi u panelu „Sljedeći korak”;
     - V-R03: red „Vaša glasačka težina” se uklanja sa listića, jer je uvijek 1.

     Mockupi P-M01 i P-M03 još prikazuju procente; zamjena je tekstualna i radi se pri implementaciji F6 (nije ponovo crtano).
  4. **K-01, K-01a (zbir vlasničkih udjela ne blokira dodavanje vlasnika): ostaju.**
  5. **K-01b se preformuliše:** zbir iznad 100% više ne povećava težinu, ali obično znači da **udio prethodnog vlasnika nije zatvoren**. Prethodni vlasnik bi tada bio brojan kao etažni vlasnik i dobio bi lični link. Preporuka A ostaje: glasanje se ne otvara dok se to ne razriješi. Obrazloženje više nije „pogrešna težina”, nego „pogrešna osoba u glasačkoj bazi”.
  6. **K-01c se preformuliše:**
     - **Zbir ispod 100%** na jedinici znači da možda nedostaje suvlasnik, pa i jedan etažni vlasnik. To je upozorenje, ne blokada.
     - **Posebni dio bez ijednog upisanog vlasnika** znači da broj etažnih vlasnika nije poznat. To je **preduslov za otvaranje glasanja** (vidi FR).
  7. **K-02 (registar) ostaje, sa drugom svrhom.** Registar više ne određuje ko ima pravo glasa, nego osigurava da je **spisak posebnih dijelova potpun i konačan**, kako bi i spisak etažnih vlasnika bio potpun. Imenilac kvoruma je broj različitih lica koja su vlasnici bar jednog posebnog dijela iz registra.
  8. **Garažno mjesto kao vrsta posebnog dijela:** danas postoje samo `APARTMENT` / `BUSINESS` / `GARAGE` / `OTHER`. Prijedlog je nova vrijednost „Garažno mjesto” u istoj listi, da registar može tačno opisati zgradu. Ovo je domenska izmjena, ne dizajn.

- **K-03a (2026-10-24) — Suvlasnici istog posebnog dijela zajedno imaju jedan glas, preko zajedničkog predstavnika.** Zajedno sa K-03 to znači da se ne broje lica, nego **glasački subjekti**:
  - **samostalni vlasnik** = jedno lice, jedan glas, bez obzira na broj posebnih dijelova (Ana Savić: Stan 1 + Garaža 1 = 1 glas);
  - **suvlasnička zajednica** = svi suvlasnici jednog posebnog dijela zajedno, jedan glas, koji daje njihov zajednički predstavnik (Nikola i Sara Ilić: Stan 3 = 1 glas, glasa predstavnik);
  - ista grupa suvlasnika sa više posebnih dijelova je **jedan** subjekt (npr. Nikola i Sara zajedno vlasnici i Stana 3 i Garaže 3 = 1 glas).

  Imenilac kvoruma i većine je **broj glasačkih subjekata**. Za seed ZEV: Ana, Marko, Ilići (zajedno), Milan i Apoteka su **5 glasova za 8 posebnih dijelova** (6 lica). Kvorum od 50% je 3.

  **Zatečeno stanje (provjereno):** osnova glasanja se gradi po licu (`ownersVotingBasis`, `ownership.ts:479-505`), pa danas Nikola i Sara dobijaju dva glasa i dva lična linka. Lični link ide licu ili njegovom punomoćniku (`meetings.ts:809, 835`). `Unit` ima „primaoca računa” i „kontakt za korespondenciju” (`invoiceRecipient`, `correspondenceContact`), ali nema zajedničkog predstavnika.

  **Prijedlog — zajednički predstavnik:**
  1. **Gdje se određuje.** Kad posebni dio dobije drugog suvlasnika, forma „Dodaj vlasnički udio” traži i polje **„Zajednički predstavnik za glasanje”** (izbor jednog od suvlasnika).
     - Podrazumijevano: suvlasnik sa najvećim udjelom; kod jednakih udjela, onaj upisan prvi.
     - Predsjednik ga može promijeniti na tabu „Vlasništvo”, uz napomenu i opcioni dokument (izjava suvlasnika); promjena ide u audit.
     - Predstavnik je uvijek **jedan od suvlasnika**. Ako suvlasnici žele da glasa neko izvan zajednice, to je **punomoć** (postojeći mehanizam), koju daje predstavnik.
  2. **Glasanje.**
     - Lični link, verifikacioni kod i glas u sali idu **predstavniku** (ili njegovom punomoćniku).
     - Ostali suvlasnici u aplikaciji vide: „Za Stan 3 glasa Vaš zajednički predstavnik Nikola Ilić” i da li je zajednica glasala (V-R04).
     - Na glasačkoj listi i u zapisniku red glasi „Stan 3 — Nikola Ilić i Sara Ilić (predstavnik: Nikola Ilić)”.
  3. **Preduslov.** Svaka suvlasnička zajednica u obimu glasanja ima predstavnika. Zbog podrazumijevane vrijednosti ovo je u praksi uvijek ispunjeno. Ostaje kao provjera za podatke prenesene iz postojećih ZEV-ova, gdje predstavnik još nije potvrđen (stavka „Za provjeru”).
  4. **Režim uživo:** u prozivci se zajednica prikazuje kao jedan red („Stan 3 — Ilići · predstavnik Nikola Ilić”) i označava se prisutnom ako je prisutan bilo koji suvlasnik. Glas unosi predsjednik u ime zajednice.

  **Jedan granični slučaj (K-03b, pitanje za pravnika).** Lice koje je **samostalni** vlasnik jednog posebnog dijela i **suvlasnik** drugog: npr. Nikola sam ima Garažu 4, a sa Sarom Stan 3. Po gornjem pravilu to su dva subjekta, pa bi Nikola glasao jednom kao vlasnik garaže i jednom kao predstavnik zajednice.
  - Alternativa: samostalno vlasništvo „upija” lice, pa Nikola ima jedan glas, a zajednica Stana 3 glasa preko Sare.
  - **Preporuka:** dva subjekta, jer su to dva različita etažna vlasnika u smislu zakona. Potvrditi sa pravnikom. U seed podacima ovaj slučaj ne postoji, pa ne blokira ništa.

Faze su namjerno male i, gdje je moguće, nezavisne. **F1 ne traži nijednu odluku o dizajn sistemu i rješava 4 od 7 kritičnih nalaza.** Ona je preporučeni prvi korak bez obzira na ostatak.

---

## 0. Rezime — šta je najvažnije

1. **Najveći problem nije izgled, nego jednoklik radnje nad novcem i pravom.** Sedam kritičnih nalaza; četiri su ista greška na različitim mjestima: radnja koja se ne može povući ide jednim klikom, a u trenutku odluke korisnik ne vidi posljedicu:
   - **R-N11:** na detalju uplate Marka Jovanovića select je unaprijed postavljen na fakturu Ane Savić, sa upisanim iznosom. Jedan klik na `primary` „Rasporedi” knjiži novac na tuđi dug. Provjereno u kodu: `uplate/[id]/page.tsx:83-87, 153-169`.
   - **R-N04:** „Izdaj N faktura” izdaje cijelu seriju bez potvrde. Provjereno: `serija/[id]/page.tsx:107-111`.
   - **P-N02:** „Pošalji pozive (e-mail)” i „Otvori glasanje i pošalji linkove” šalju poruke svim vlasnicima i zaključavaju tekst prijedloga, bez potvrde. Isti korak u režimu uživo ima `ConfirmAction` sa pregledom posljedica.
   - **P-N05:** prijedlog nije obavezno vezan za tačku dnevnog reda. U sali tačka zato piše „bez prijedloga za glasanje” iako prijedlog postoji, pa se glasanje uživo ne može otvoriti.

   Sve ovo se rješava **postojećim primitivima** (`ConfirmAction`, `caution`, prazan podrazumijevani izbor). To je faza **F1**.
2. **Nijedna početna ne odgovara na pitanje „šta treba da uradim”.** Vlasnik vidi četiri jednaka broja, a dospjela faktura stoji kao siva 12px napomena (V-N02). Početna kaže „nema otvorenih glasanja”, dok Skupština kaže „Glasanje otvoreno” (V-N03). Računovođa vidi stanja, a ne posao koji čeka (R-N01). Predsjednik prvo vidi osam finansijskih pokazatelja (P-N16). Predlaže se **jedan zajednički obrazac „Za Vas sada”** za sve tri uloge, sastavljen od postojećih primitiva (odluka D1).
3. **Vlasnik u aplikaciji ne može saznati kako da plati.** Račun primaoca, primalac i svrha postoje samo u PDF-u (V-N01, kritično). Blok „Kako da platim” na detalju fakture je najveća pojedinačna korist za najbrojniju ulogu (F3).
4. **E-glasački listić je dobro zamišljen, ali nije potpun.** Prilozi prijedloga se glasaču ne prikazuju, iako izjava traži „pročitao/la u cijelosti” (V-N05, kritično). Uz to ima dva `primary` dugmeta, a greška briše unesen izbor (F4; traži i pravne odgovore).
5. **Orijentacija i telefon.** Na svakoj podstranici nijedna stavka menija nije aktivna (X-N01). Tabele sa 5 ili manje kolona na 375px guraju kolonu radnji van ekrana na najmanje deset mjesta (X-N18, kritično). Ikona menija je glif od oko 30px (X-N05). Prvo je mala izmjena (F2); drugo traži proširenje ranije odluke P5 (D3, F8).

**Šta se NE predlaže:** nova boja, nova veličina teksta, novi razmak, nova težina dugmeta, biblioteka komponenti ili ikona, tamni režim, promjena primarne boje. Svih devet dopuna dizajn sistema (§5) su ili kompozicija postojećeg, ili proširenje postojećeg primitiva.

---

## 1. Metod i dokazi

- **Viđeno uživo:** produkcioni build v2.41.0 (`next start`, lokalni Postgres, seed podaci). Playwright i Chrome su prošli kroz sve stranice dostupne svakoj ulozi, na 1440px i 375px, uključujući sve `?tab=` varijante i otvoren mobilni meni. Ukupno 290 screenshota za ove uloge:
  - vlasnik (`vlasnik@zev.ba`), računovođa, predsjednik;
  - super admin (seed korisnik `marko@zev.ba`, kojem je zastavica `isSuperAdmin` privremeno uključena u lokalnoj bazi i odmah zatim vraćena);
  - neprijavljen korisnik (prijava, zaboravljena lozinka);
  - javni e-glasački listić, otvoren tokenom iz seed outbox-a; glas nije poslan.

  Citirani screenshoti su kopirani u `design-review/zateceno/` (JPEG, smanjeni).
- **Pročitano u kodu:** svaka stranica i komponenta grupe; svaki nalaz ima `fajl:linija`. Dva kritična nalaza (R-N11, R-N04) i V-N01 su dodatno ručno provjereni u kodu i na screenshotu prilikom spajanja.
- **Nije urađeno i ne tvrdi se:** nema korisničkih intervjua, posmatranih sesija ni analitike korištenja. Sve tvrdnje o tome šta je „često” ili „zbunjujuće” su u prilozima označene kao **hipoteza**. Posmatrana sesija iz odluke P8 (`ui-ux-redesign-plan.md`) i dalje nije održana. Preporučuje se prije F8 i F9, gdje je promjena navike najveća.
- **Bez screenshota:** `/reset-lozinka/[token]`, nacrt serije prije izdavanja, ekran pregleda PDF izvoda i ekran potvrde nakon glasanja. Za njih nalazi dolaze samo iz koda i tako su označeni.
- **Seed artefakti:** neki nalazi se vide samo zbog seed podataka. Primjeri: dospijeće serije prije datuma izdavanja; radni nalog prije usvojene odluke. Nalaz u tim slučajevima nije „podaci su pogrešni”, nego „UI to ne sprečava i ne upozorava”.
- **Referenca na izvorni opis vještine** (`review-and-rollout.md`) nije bila dostupna u instaliranom skill-u. Format pregleda i uvođenja je zato izveden iz same vještine i iz stila postojećih `Plans/`.

---

## 2. Publika, poslovi i principi za ovaj krug

Publika je ista kao u `design-system.md` §0: netehnički, često stariji ljudi, u finansijsko-pravnom softveru. Glavni poslovi po ulozi (detaljno u prilozima):

| Uloga | Posao koji mora biti očigledan |
|---|---|
| Vlasnik | Koliko dugujem, do kada i **kako da platim**; ima li glasanje koje me čeka i kako da glasam pravno valjano; šta je sa mojom prijavom kvara |
| Računovođa | Izdati seriju bez greške; unijeti priliv (izvod, SMS); **upariti** i riješiti ostatak; platiti dobavljača; ispraviti grešku stornom |
| Predsjednik | Provesti sjednicu kroz pravni tok **znajući sljedeći korak**; voditi salu sa telefona uz vidljiv kvorum; održavati osnovu glasanja (vlasnici, udjeli, punomoći) |
| Super admin | Otvoriti ZEV, dodijeliti i oduzeti pristup bez greške |

Pet principa ovog kruga dopunjuju pet principa iz `design-system.md` §0; ne zamjenjuju ih:

1. **Novac i pravo se nikad ne pomjeraju jednim klikom.** Pod to spada svaka radnja koja knjiži, stornira, šalje poruke trećim licima ili zaključava tekst. Takva radnja ide iza `ConfirmAction`, čije tijelo kaže **koliko, kome i šta se ne može povući**.
2. **Svaki ekran procesa kaže koji je sljedeći korak.** Sistem već zna redoslijed (statusi, preduslovi); treba ga izgovoriti.
3. **Odgovor prije podataka.** Početna prvo pokazuje ono što čeka na korisnika, a tek onda pokazatelje.
4. **Telefon je punopravan.** Nijedna radnja ni ključni podatak ne smiju biti van ekrana na 375px.
5. **Laički jezik.** Bez hash-eva, tokena, internih naziva varijabli i dobavljača u UI-ju (DS §6 već to traži, ali se ne poštuje svuda).

---

## 3. Snage koje ostaju (ne dirati)

- Mirna vizuelna osnova i šest težina dugmadi: nijedan nalaz ne traži novu boju ni promjenu brenda.
- `ConfirmAction` tamo gdje postoji: storno uplate sa iznosom, spajanje duplikata, zatvaranje glasanja sa sažetkom kvoruma, suspenzija ZEV-a. To je **uzor**; F1 ga samo dosljedno primjenjuje.
- Pregled prije knjiženja kod PDF izvoda i SMS-a („ništa još nije sačuvano”), zaštita od dvostrukog uvoza i storno kao novi zapis.
- Režim uživo je pravi mobilni alat: zasebna školjka, mete od 44px, lista koja se ne preuređuje pod palcem, osvježavanje koje čuva pretragu. Potvrda otvaranja glasanja uživo pokazuje posljedice.
- E-glasački listić u tri koraka na jednoj stranici i opcije glasa kao velike kartice: najbolja dodirna meta u aplikaciji.
- Card-transform tabela sa više od 5 kolona; pristupačan mobilni drawer; jedna školjka za tenant i platformu; `/aktivnosti` kao „ljudski” dnevnik.

---

## 4. Konsolidovani nalazi — kritični i visoki

Isti problem viđen iz više uloga je spojen; ID-jevi u zagradi su duplikati iz drugih priloga. Srednji i niski nalazi su samo u prilozima.

| # | Nalaz | ID-jevi | Ozbiljnost | Faza |
|---|---|---|---|---|
| K1 | Raspoređivanje uplate podrazumijevano bira tuđu fakturu sa upisanim iznosom | R-N11 | kritično | F1 |
| K2 | Izdavanje serije jednim klikom (izdaje sve fakture, šalje e-poštu onima koji su izabrali dostavu) | R-N04 | kritično | F1 |
| K3 | Slanje poziva i otvaranje glasanja (e-mail svima, zaključavanje teksta) jednim klikom | P-N02 | kritično | F1 |
| K4 | Prijedlog nije vezan za tačku dnevnog reda, pa se u sali ne može glasati | P-N05 | kritično | F1 |
| K5 | Uplatni podaci ne postoje u aplikaciji, samo u PDF-u | V-N01 | kritično | F3 |
| K6 | Prilozi prijedloga se ne prikazuju na e-glasačkom listiću | V-N05 | kritično | F4 |
| K7 | Tabele sa 5 ili manje kolona na 375px: radnje i ključni sadržaj van ekrana | X-N18 (= V-N23, R-N21, P-N21) | kritično | F8 |
| V1 | Predsjednik vidi kontrole raspoređivanja i storna koje server odbija | R-N12 | visoko | F1 |
| V2 | Potvrde storna nejednake (bez iznosa, razlog nije obavezan); storno fakture nudi se i kad ne može uspjeti | R-N13 | visoko | F1 |
| V3 | Trošak se „plaća” jednim klikom, za pun iznos, podrazumijevano iz blagajne | R-N18 | visoko | F1 |
| V4 | Opoziv ličnog linka i „Kreiraj novu verziju” (poništava sve linkove) bez potvrde | P-N10 | visoko | F1 |
| V5 | Privremeni rezultat napisan kao konačan („NIJE USVOJENO”) | P-N07 | visoko | F1 |
| V6 | „Objavi vlasnicima” dostupno i za nacrt zapisnika, bez potvrde | P-N23 | visoko | F1 |
| V7 | „Ukloni moj pristup” (admin) bez potvrde; kolona radnji odsječena | X-N20 | visoko | F1 / F9 |
| V8 | Nijedna stavka menija nije aktivna na podstranicama; 8 podstranica bez „‹ Nazad” | X-N01 (= R-N03) | visoko | F2 |
| V9 | Naziv ZEV-a nije vidljiv u školjci korisniku sa jednim ZEV-om | X-N02 | visoko | F2 (D9) |
| V10 | Dospjela faktura nije označena kao dospjela na početnoj vlasnika | V-N02 | visoko | F3 |
| V11 | Početna i Skupština daju vlasniku suprotnu sliku o glasanju | V-N03 | visoko | F3 / F4 |
| V12 | Vlasnik ne može saznati da li je glasao niti doći do svog linka | V-N04 | visoko | F4 |
| V13 | Listić: dva `primary` dugmeta i ručni duplikat `ConfirmAction`-a | V-N06 | visoko | F4 |
| V14 | Početna računovođe pokazuje stanja, ne posao | R-N01 | visoko | F5 |
| V15 | Pregled serije: kartica po jedinici (11.411px na telefonu), interni nazivi formula na 12px | R-N05 | visoko | F5 |
| V16 | Nacrt serije ne upozorava na anomalije (dospijeće u prošlosti, stavke 0,00) | R-N06 | visoko | F5 |
| V17 | Stranica uplata počinje sa tri forme za unos; lista na oko 1270px; tri `primary` | R-N08 | visoko | F5 |
| V18 | Pregled PDF izvoda i SMS-a: ručne tabele, ugniježđena elevacija, neupotrebljive na telefonu | R-N14 | visoko | F5 (D5) |
| V19 | Upozorenje o duplikatu troška briše svih 11 polja forme | R-N19 | visoko | F5 |
| V20 | Detalj sjednice ne kaže sljedeći korak; tri `primary` u istom pogledu | P-N01, P-N03 | visoko | F6 (D2) |
| V21 | Tabela prijedloga na sjednici nema rok ni „glasalo X/Y” | P-N04 | visoko | F6 |
| V22 | Režim uživo: brojač računa neoznačene kao odsutne, kvoruma nema (odobreni plan ga je tražio) | P-N12 | visoko | F6 |
| V23 | Početna predsjednika: 8 pokazatelja prije ijednog zadatka | P-N16 | visoko | F6 (D1) |
| V24 | Izvršenje (nalog, faktura 4.650 KM) bez veze sa usvojenom odlukom | P-N06 | visoko | F6 (P-Q2) |
| V25 | Računovođi su polja onemogućena, ali izgledaju kao da se mogu mijenjati | X-N11 | visoko | F7 |
| V26 | Bulovi parametri ZEV-a se upisuju kao slobodan tekst `true`/`false`; nema potvrde snimanja | X-N12, X-N13 | visoko | F7 |
| V27 | Revizorski trag: 200 sirovih redova, JSON, bez paginacije (44.021px na telefonu) | X-N16 | visoko | F7 |
| V28 | Napomena upućuje vlasnika na „Vlasnici i korisnici”, stranicu koju nema | X-N10 (= V-N24) | visoko | F7 |

Ostali duplikati: X-N05 = V-N25 (ikona menija); X-N08 = V-N28 (fusnota na prijavi); X-N19 ≈ V-N13 i R-N22 (raspored card-transforma: rastegnut chip, `font-mono` na labeli).

---

## 5. Odluke o dizajn sistemu — ODLUČENO (2026-10-25)

**Korisnik je prihvatio preporuku za svih devet odluka (2026-10-25):**
- **D1 — „Za Vas sada”:** opcija A — kompozicija postojećih primitiva (`Card` + redovi + `StatusBadge` + jedno dugme po redu, `primary` samo na najhitnijem), opisana jednom u `design-system.md`; bez nove komponente.
- **D2 — „Sljedeći korak”:** opcija A — kompozicija (`Card` + `StatusTimeline` + postojeća lista preduslova `PreconditionList` iz v2.43.0 + jedno dugme po pravilu potvrde), upisana u `design-system.md`.
- **D3 — tabele na telefonu:** opcija A — pravilo: svaka tabela sa kolonom radnji postaje kartice ispod `md`, bez obzira na broj kolona; tabele bez radnji kojima je glavna kolona zadnja dobijaju preuređen redoslijed kolona. Proširuje P5; bez prop-a po tabeli.
- **D4 — `Flash` „upozorenje” + `inset`:** da.
- **D5 — `ReviewTable`:** opcija B — novi client primitiv za tok „pregledaj → potvrdi” (PDF izvod, SMS).
- **D6 — `ConfirmAction` bez sopstvene forme:** opcija B, uz izuzetak upisan u DS: potvrda glasa je `primary`.
- **D7 — „Kopiraj”:** opcija A u F3 (krupna vrijednost + `select-all`); dugme „Kopiraj” (B) kao kasnija dopuna; QR tek nakon provjere sa bankom.
- **D8 — navigacija po ulogama:** opcija B — redoslijed po ulozi + naslov grupe (13px; u suženom režimu tanka linija); idealno provjeriti na posmatranoj sesiji (P8) prije F9.
- **D9 — naziv ZEV-a uvijek vidljiv:** da, kao tih 13px tekst ispod „ZEV upravnik”; chip za više ZEV-ova vidljiv i na telefonu.

Time su faze F2–F9 deblokirane u dijelu koji zavisi od dizajn sistema. Tabela ispod ostaje kao zapis razmotrenih opcija.

### Zapis razmotrenih opcija (prije odluke)

`CLAUDE.md` traži da se svaki obrazac koji sistem nema predloži izričito. Ovdje su sve takve odluke iz četiri priloga, spojene. Opcije i obrazloženja su u prilozima, na mjestu navedenom u koloni „Detalj”.

| # | Prijedlog | Opcije (ukratko) | Preporuka | Šta blokira | Detalj | Mockup |
|---|---|---|---|---|---|---|
| **D1** | Obrazac **„Za Vas sada”**: rangirana lista zadataka na početnoj. Jedan obrazac za vlasnika, računovođu i predsjednika (prilozi ga zovu „Za Vas sada” i „Čeka na vas”; predlaže se jedan naziv). | A kompozicija `Card` + redovi + `StatusBadge` + jedno dugme po redu, `primary` samo na najhitnijem · B novi primitiv `Notice` / `TaskList` · C `Flash` na vrhu | **A**, upisano jednom u DS §4.1. Primitiv `TaskList` tek ako ga treća uloga zatraži. | F3, F5, F6 | V-R02, R-R01, P-R07 | V-M01, R-M01, P-M02 |
| **D2** | Obrazac **„Sljedeći korak”** na detalju procesa: gdje smo, jedan sljedeći korak, preduslovi ✓/⚠, jedno dugme | A kompozicija `Card` + `StatusTimeline` + lista + jedno dugme · B primitiv sa plavim lijevim akcentom · C samo hint | **A**. B krši princip „hijerarhija kroz težinu, ne boju”. | F6 | P-R01 | P-M01 |
| **D3** | **Proširenje P5:** card-transform na telefonu i za tabele sa 5 ili manje kolona | Prilog P: A automatski kad tabela ima kolonu radnji · Prilog X: B opt-in prop po tabeli · C bez kartica, samo preuređenje kolona | **A (pravilo, ne prop)**, uz C za tabele bez radnji kojima je glavna kolona zadnja (npr. `/aktivnosti`). Prilozi se razilaze; spajanje daje prednost pravilu, jer je opt-in već jednom odbijen kao nova osa neusklađenosti (`ui-ux-redesign-plan.md:1094`). Ispravke rasporeda kartice (X-N19: drugo dijete ćelije u koloni labele, `font-mono` na labeli, rastegnut chip) su **bugfix**, ne odluka. | F8 | X-R14, P-R11 | X-M02, X-M03 |
| **D4** | **`Flash` varijanta „upozorenje”** (amber, postojeći tokeni `warning-*`) i **`inset`** (bez sjenke unutar kartice) | A amber tekst u `Card hint` · B `Flash warn` + `inset` · C panel u stilu `ConfirmAction` | **B**. Upozorenja se danas crtaju ručno ili crveno na više mjesta. | F7, F9 (i R-R03 upozorenja serije u F5) | X-R15 | X-M03 |
| **D5** | **`ReviewTable`**: editabilna tabela za tok „pregledaj → potvrdi” (PDF izvod, SMS), sa karticama na telefonu | A `Table editable` · B novi client primitiv · C uvijek kartice | **B**: dva postojeća ručna poziva za isti posao | F5b | R-R07 | R-M02 |
| **D6** | **`ConfirmAction` bez sopstvene forme** (da ga e-listić može koristiti) + izričit izuzetak: potvrda glasa je `primary`, ne `caution` | A uskladiti ručni panel · B prop „bez forme” · C zaseban korak „Pregled” | **B** + izuzetak upisan u DS §4.2 | F4 | V-R03 | V-M03 |
| **D7** | Dugme **„Kopiraj”** uz račun i poziv na broj | A bez dugmeta, `select-all` · B `secondary` „Kopiraj” sa kratkim „Kopirano” · C bankarski QR | **A u F3; B kao dopuna ako je odobrite; C tek nakon provjere sa bankom** (V-Q4) | — (F3 radi i sa A) | V-R01 | V-M02 |
| **D8** | **Navigacija po ulogama sa naslovima grupa** (npr. vlasnik: *Moje* / *Zajednica*; uprava: *Svakodnevno* / *Zajednica* / *Uprava*) | A samo redoslijed po ulozi · B redoslijed + naslov grupe (13px, postojeći tokeni) · C vlasnik vidi samo 5 stavki | **B**, idealno provjereno u P8 sesiji | F9 | X-R03 | X-M01 |
| **D9** | **Naziv aktivnog ZEV-a uvijek vidljiv u školjci**, i za korisnika sa jednim ZEV-om. Mijenja dokumentovano ponašanje (`nav-shell.tsx:73-75`), ali ne uvodi novi obrazac. | da / ne | **Da**, kao tih 13px tekst ispod naziva aplikacije | F2 (dio) | X-R02 | X-M01 |

**Odbačeno ili odloženo bez odluke:** `Stat` kao link (R-Q2): preporuka „ne u ovom krugu”, jer „Za Vas sada” pokriva potrebu. Dvije nove ikone (`IconMenu`, `IconClose`) i ikona za „Kopiraj” ne traže odluku: P6 već propisuje ručno crtane ikone u istom stilu.

**Ispravke DS dokumenta bez odluke** (zatečeno stanje se razilazi sa `design-system.md`; ide uz F2):
- `danger` je danas na **4** mjesta, ne na 3: dodato je „Obriši nacrt (trajno)” iz plana nacrta skupštine.
- `SegmentedAction` (odobren u planu uživo, P11) nije u inventaru.
- `PasswordInput` nije u inventaru, a opis `PasswordField` ne odgovara kodu.
- `Stat` ima tačku, ne traku.
- `text-xs` je na **102** mjesta, ne „~81”: dug raste.

---

## 6. Fazni prijedlog — po tokovima

Svaka faza navodi: svrhu, tokove i ekrane, preporuke iz priloga, mockupe, odluke koje traži, rizik, provjeru i izlazni kriterijum. Napor je relativan (S/M/L) za jednu sesiju implementacije sa živim pregledom. Datumi se ne navode, jer kapacitet nije poznat.

**Uloge u svakoj fazi:**
- **Vi:** odobravanje dizajna i verzije.
- **Implementaciona sesija:** plan po fajlovima, kod, testovi, živi pregled.
- **Stvarni računovođa / predsjednik ZEV-a:** pregled teksta i toka u F4, F5 i F6 (preporuka).
- **Pravnik:** tamo gdje je naznačeno.

### Redoslijed i zavisnosti

```
F1 Sigurnost novca i prava ──┐  (bez odluka; prvo)
F2 Orijentacija u školjci ───┼──► F3 Vlasnik: plaćanje + početna (D1, D7)
                             │        └─► F4 Vlasnik: glasanje (D6 + pravna pitanja)
                             ├──► F5 Računovođa: radni red i unos novca (D1, D5, D4)
                             ├──► F6 Predsjednik: sjednica i uživo (D1, D2)
                             └──► F7 Podešavanja i evidencije (D4)
FR Registar posebnih dijelova ──┐  (K-02; domenska izmjena + pravnik)
P8 posmatrana sesija ───────────┴► F8 Mobilne tabele i evidencija vlasnika (D3; glasački dio K-01 tek poslije FR)
                                    └─► F9 IA po ulogama i platformski admin (D8, D4)
F10 Higijena: kontinuirano, uz svaku fazu koja dira stranicu
```

F3, F5, F6 i F7 su međusobno nezavisne, mogu ići bilo kojim redom i nijedna ne dira fajlove druge. Izuzetak je D1: obrazac se gradi u prvoj od njih i ponovo koristi u ostalim.

### F1 — Sigurnost novca i pravnih koraka *(sve uloge · S–M · nijedna odluka o DS-u)*

**Status: ISPORUČENO u v2.42.0 (nije commitovano).** Implementacioni plan: [`f1-sigurnost-novca-i-pravnih-koraka-plan.md`](f1-sigurnost-novca-i-pravnih-koraka-plan.md).

- **Svrha:** nijedna radnja koja knjiži, stornira, šalje poruke ili zaključava tekst nije jedan klik. Rješava K1–K4 i V1–V7.
- **Ekrani:**
  - `/fakture/uplate/[id]`;
  - `/fakture/serija/[id]` (samo potvrda izdavanja);
  - storno na fakturi, uplati, alokaciji i trošku;
  - „plati” trošak;
  - `/skupstina/[id]`, `/skupstina/prijedlog/[id]`, `/dokumenti`;
  - `/organi` („Okončaj mandat”);
  - `/admin/[zevId]` („Ukloni moj pristup”).
- **Šta se mijenja** (R-R05, R-R06, R-R03 tačka 4, P-R02, P-R03, P-R05, dio P-R12, dio X-R15):
  - **Raspoređivanje uplate:** izbor fakture bez podrazumijevane vrijednosti; fakture platioca su prve, u svojoj grupi; iznos se popunjava tek po izboru fakture.
  - **Uloge:** kontrole za raspoređivanje i storno renderuju se samo računovođi.
  - **Storno:** svaki storno pokazuje iznos, dokument i drugu stranu; razlog je obavezan.
  - **„plati” trošak:** izbor računa, datuma i iznosa iza potvrde.
  - **Izdavanje serije:** iza `ConfirmAction` sa brojem faktura, iznosom, dospijećem i brojem e-poruka.
  - **Sjednica i prijedlog:** pozivi, otvaranje glasanja, opoziv linka, nova verzija, okončanje mandata i objava dokumenta idu iza `ConfirmAction`. Tijelo potvrde kaže koliko ljudi dobija poruku, po uzoru na `previewLiveDelivery` iz režima uživo.
  - **Dnevni red:** prijedlog se pravi iz tačke dnevnog reda.
  - **Rezultat otvorenog glasanja:** piše se kao „Trenutno stanje · Ishod ako se sada zatvori”.
- **Mockupi:** R-M02 (detalj uplate: grupisan izbor fakture, rečenica o avansu), R-M03 (otvoren panel potvrde izdavanja), P-M01 (`ConfirmAction` sa brojem primalaca, prijedlog iz tačke).
- **Pravila DS-a:**
  - `danger` ostaje na postojećim mjestima.
  - Storno troška i alokacije su `caution`.
  - Izdavanje serije ima `caution` okidač i `primary` potvrdu; prop `confirmVariant` već postoji (`ui.tsx:594`).
- **Opciona pitanja** (ne blokiraju):
  - **R-Q4:** da li je avans „završen posao”.
  - **R-Q5:** izdavanje serije sa dospijećem u prošlosti. Preporuka: upozoriti.
  - **R-Q6:** djelimično plaćanje troška.
- **Rizik:** nizak. Dodaju se koraci, servisi se ne mijenjaju. Izuzetak je veza prijedlog → tačka: polje postaje obavezno, uz svjesnu opciju „Bez tačke”.
- **Provjera:** živi pregled 1440/375 za svaku novu potvrdu. Predsjednik na detalju uplate ne vidi kontrole. Tastaturom kroz svaki `ConfirmAction`.
- **Izlazni kriterijum:** pretraga kroz `src/app` ne nalazi nijedan submit koji knjiži, stornira, šalje ili zaključava bez `ConfirmAction`; svaka potvrda ima `body` sa iznosom ili brojem primalaca.

### F2 — Orijentacija u školjci i prijava *(sve uloge · S · D9 za jedan dio)*

**Status: ISPORUČENO u v2.45.0 (nije commitovano):** [`f2-orijentacija-u-skoljci-plan.md`](f2-orijentacija-u-skoljci-plan.md).

- **Svrha:** korisnik uvijek zna gdje je i u kom ZEV-u, i ima jedan dodir nazad. Rješava V8, V9, X-N05–X-N09 i R-N03.
- **Šta se mijenja** (X-R01, X-R04, X-R05, X-R06, X-R07, X-R02):
  - **Meni:** aktivna stavka po prefiksu putanje, uz `aria-current`.
  - **Nazad:** `backHref` na svih 8 podstranica.
  - **Mobilne kontrole:** ☰/✕ postaju ručno crtane ikone sa metom od 44px i labelom „Meni”.
  - **Meni naloga:** bez lažnog `role="menu"`; tekst od 13px.
  - **Auth stranice:** koriste `Flash`, bez ugniježđene elevacije, a tekstovi idu kroz rječnik.
  - **`PasswordField`:** prelazi na `Btn`.
  - **Naziv ZEV-a:** vidljiv u školjci (ako je D9 = da).
  - **DS dokument:** ispravke iz §5.
- **Mockup:** X-M01.
- **Rizik:** nizak. Poklapanje po prefiksu mora isključiti `/`.
- **Provjera:** svaka podstranica na 1440 i 375; VoiceOver najava greške na resetu lozinke.
- **Izlazni kriterijum:** tačno jedna stavka sa `aria-current="page"` na svakoj ruti; nema `text-xs`/`text-[11px]` u `nav-shell.tsx`, `auth-shell.tsx` i `password-field.tsx`.

### F3 — Vlasnik: „koliko dugujem i kako da platim” + početna *(M · D1, D7)*

**Status: ISPORUČENO u v2.46.0 (nije commitovano):** [`f3-vlasnik-kako-da-platim-i-pocetna-plan.md`](f3-vlasnik-kako-da-platim-i-pocetna-plan.md).

- **Svrha:** posao br. 1 vlasnika rješiv je u aplikaciji, na telefonu, bez PDF-a. Rješava K5, V10, V11 (dio) i V-N11–V-N16.
- **F3a — plaćanje** (V-R01, V-R05):
  - **Blok „Kako da platim”** je prva kartica na neplaćenoj fakturi. Sadrži preostali iznos, rok i broj dana kašnjenja, primaoca, račun i banku, poziv na broj (15px), svrhu i `secondary` „Preuzmi PDF”. PDF i QR računaju preostali iznos.
  - **Detalj fakture:** jedan status chip; stavke sa osnovom obračuna napisanim prirodnim jezikom.
  - **Lista faktura:** neplaćene su prve; dodaje se kolona „Preostalo”.
  - **Moje uplate:** kolona „Raspoređeno na”.
- **F3b — početna** (V-R02):
  - **Prvi element:** „Za Vas sada” (D1). Redoslijed je dospjeli dug, pa glasanje, pa uključivanje e-glasanja; jedino `primary` je „Kako da platim”.
  - **Pokazatelji:** svedeni na dva.
  - **Sve izmireno:** eksplicitna poruka.
- **Mockupi:** V-M02 (F3a), V-M01 (F3b, sa stanjima „dug + glasanje” i „sve izmireno”).
- **Pitanje:** V-Q4 (bankarski QR i format poziva na broj) utiče samo na D7 opciju C; ne blokira.
- **Rizik:**
  - F3a nizak; računovođa vidi isti blok, a njegove kontrole ostaju ispod.
  - F3b srednji; pravilo rangiranja mora biti determinističko.
- **Provjera:**
  - Fakture: neplaćena, plaćena, djelimično plaćena i korektivna.
  - Početna, šest stanja: dug + glasanje, samo dug, samo glasanje, glasanje bez e-saglasnosti, sve izmireno, nalog bez lica.
  - Obje provjere na 1440 i 375.
- **Izlazni kriterijum:** sa početne, na 375, do računa primaoca, iznosa i poziva na broj stiže se u najviše 2 dodira, bez PDF-a.

### F4 — Vlasnik: glasanje *(M · D6 · traži pravne odgovore)*

- **Svrha:** pravno obavezujuće izjašnjenje je potpuno, nedvosmisleno i ima čitljiv dokaz. Rješava K6, V11 (ostatak), V12, V13 i V-N07–V-N10, V-N27.
- **Šta se mijenja** (V-R03, V-R04, V-R09):
  - **Prilozi:** prikazani na listiću. *(v2.44.0: V-R03 djelimično pokriven na listiću po sjednici — prilozi navedeni po nazivu/veličini/otisku, greška čuva izbor i izjavu, otisak pod „Tehnički detalji”, potvrda sa brojem po prijedlogu i „Odštampaj”; preuzimanje priloga i klasična stranica jednog prijedloga ostaju za F4.)*
  - **Dugmad:** okidač je `secondary`, a jedino `primary` je u panelu potvrde (D6).
  - **Greška:** čuva izbor i izjavu.
  - **Čitljivost:** sve ≥13px; tehnički otisak ide pod „Tehnički detalji”.
  - **Potvrda:** naslov prijedloga, vrijeme, broj potvrde i „Odštampaj”.
  - **Prijedlog u aplikaciji:** vlasnik vidi „Imate pravo glasa · do … · Niste se izjasnili / Izjasnili ste se …” i šta da uradi ako link nije stigao.
  - **Sjednica:** vlasnik vidi termin, mjesto i 3 koraka relevantna za njega umjesto 10 internih.
- **Mockup:** V-M03.
- **Pitanja koja traže odgovor prije implementacionog plana:**
  - **V-Q1:** glasanje direktno u aplikaciji. Preporuka: ne u ovom krugu.
  - **V-Q2:** ko izdaje novi link. Preporuka: predsjednik, a ekran kaže kako ga kontaktirati.
  - **V-Q3:** da li potvrda prikazuje izbor. Preporuka: samo odmah nakon slanja, ne u URL-u.
  - **V-Q6:** verifikacioni kod drugim kanalom. Preporuka: kratkoročno iskren tekst.
- **Rizik:** srednji do visok, jer je tok pravno osjetljiv. Jednokratnost glasa i ograničenje pokušaja moraju ostati netaknuti. Tekst neka pregleda predsjednik ili pravnik.
- **Provjera:** svježe, pogrešan kod, bez izjave, istekao, iskorišten i potvrda, na 375 i 1440; cijeli tok tastaturom; VoiceOver čita izbor u panelu.
- **Izlazni kriterijum:** tačno jedno `primary`; prilozi dostupni; greška ne briše izbor; potvrda navodi prijedlog i vrijeme; vlasnik u aplikaciji vidi „izjasnili ste se”.

### F5 — Računovođa: radni red i tok unosa novca *(M–L · D1, D5, D4)*

Dijeli se na dvije isporuke:

- **F5a — Radni red i serija** (R-R01, R-R03 tačke 1–3, R-R09, R-R02 tab ili stavka):
  - **Početna:** „Za Vas sada” sa brojem, glagolom i linkom (nacrt serije, za uparivanje, SMS na čekanju, duplikati, neuspjela e-pošta, troškovi koji dospijevaju).
  - **Nacrt serije:** red `Stat`-ova; upozorenja prije izdavanja (D4); jedna zbirna tabela; obračun prirodnim jezikom na 13px.
  - **Liste:** brojač na tabu 13px; kolona „Otvoreno” i filter „Dospjela” na fakturama; period serije kao `month` polje sa predloženim sljedećim periodom.
  - **Mockupi:** R-M01, R-M03.
- **F5b — Unos novca, troškovi, izvještaji** (R-R04, R-R07, R-R08, ostatak R-R09):
  - **Stranica uplata:** redoslijed posao → uvoz PDF izvoda (jedino `primary`) → lista; ručni unos i CSV iza `ToggleBtn`; CSV na `FilePicker` sa sačuvanim mapiranjem kolona.
  - **Poslije uvoza:** „N uplata čeka uparivanje → Upari sada”.
  - **`ReviewTable`** (D5) za PDF i SMS.
  - **Trošak:** forma ne gubi unos na upozorenju o duplikatu.
  - **Izvještaji:** izvoz je `secondary`; filteri su u kartici kojoj pripadaju; dužnik je link.
  - **Mockup:** R-M02.
- **Pitanja:**
  - **R-Q1:** uplate kao treći tab ili zasebna stavka menija. Preporuka: zasebna stavka. Može se odložiti do F9.
  - **R-Q3:** koji kanal je najčešći. Pitati jednog do dva stvarna računovođe ili prebrojati uvoze po izvoru u produkciji.
- **Rizik:** srednji. Client komponente uvoza se prepisuju, pa treba regresija uvoza PDF/SMS; početna dobija nove upite, pa provjeriti performanse na ZEV-u sa 100+ jedinica.
- **Izlazni kriterijum:**
  - Sa početne se jednim klikom stiže do svakog zadatka koji čeka, i broj na početnoj jednak je broju na odredištu.
  - Pregled izvoda je upotrebljiv na 375 bez horizontalnog skrola.
  - Nijedna forma ne gubi unos na upozorenju.

### F6 — Predsjednik: sjednica i režim uživo *(M · D1, D2)*

**Status: ISPORUČENO u v2.47.0 (nije commitovano):** [`f6-predsjednik-sjednica-i-uzivo-plan.md`](f6-predsjednik-sjednica-i-uzivo-plan.md).

- **F6a — Režim uživo po odobrenom planu** (P-R08):
  - **Traka:** sticky „Prisutno · Neoznačeno · Odsutno · Kvorum X % / potrebno Y %”, sa vrijednostima već odobrenim u `live-meeting-mode-plan.md §3.1`. Neoznačeni se ne računaju kao odsutni. Na desktopu sadržaj ide u `max-w-[68ch]`.
  - **Mockup:** P-M03.
  - **Prije faze:** odgovor na **P-Q4**, tj. da li je režim uživo za upravni odbor namjeran (odluka P3 ga je isključila, a danas radi).
- **F6b — „Sljedeći korak” i početna** (P-R01, P-R07, P-R06, P-R04):
  - **Detalj sjednice:** panel (D2) sa jednim dugmetom za sljedeći korak; tabela prijedloga dobija kolone „Rok” i „Glasalo”.
  - **Početna:** „Za Vas sada” prije finansija (D1); pokazatelji svedeni na 4.
  - **Copy:** bez hash-a i tokena.
  - **Veza odluka → izvršenje:** samo ako P-Q2 = da.
  - **Mockupi:** P-M01, P-M02.
- **Pitanja:**
  - **P-Q2:** smije li prijava održavanja biti odobrena bez usvojene odluke. Preporuka: dozvoljeno uz obaveznu vezu i upozorenje.
  - **P-Q3:** ukinuti P10 (stara kartica prisustva postaje sažetak sa linkom). Preporuka: da.
  - **P-Q5:** prva verzija panela bez „zakonskih rokova”, samo sa činjenicama iz sistema. Preporuka: da.
- **Rizik:** srednji. Preduslovi u panelu moraju biti tačni, pa se pišu samo iz podataka koje sistem ima. Kvorum u traci mora koristiti isti servis kao rezultat.
- **Provjera:** cijeli tok sjednice od Nacrta do Arhivirane, na 1440 i 375, uz zapis šta panel kaže u svakom statusu. Režim uživo sa 3 i sa oko 40 lica (lokalno proširen seed).
- **Izlazni kriterijum:**
  - Na svakom statusu postoji tačno jedno dugme za sljedeći korak, sa rečenicom posljedice.
  - U režimu uživo kvorum je vidljiv bez skrolanja.

### F7 — Podešavanja i evidencije *(M · D4 · X-Q5)*

- **Svrha:** podešavanja ne zbunjuju i ne dozvoljavaju pogrešan unos; dnevnici su upotrebljivi. Rješava V25–V28 i X-N13–X-N17.
- **Šta se mijenja** (X-R08–X-R13, dio V-R08):
  - **Moji podaci:** svjesni uloge; bez reference na meni koji uloga nema.
  - **Uloge bez prava izmjene:** vide prikaz samo za čitanje umjesto onemogućenih polja.
  - **Parametri:** tipizirani (Uključeno/Isključeno, brojevi sa jedinicom i posljedicom); jedna forma, jedno „Sačuvaj” i `Flash` „Sačuvano: … → …”.
  - **Povratna informacija:** svaka radnja daje `Flash`.
  - **Copy:** bez `APP_URL`, Vercel, Mailjet i API.
  - **„Evidencije”:** jedno mjesto sa tabovima Aktivnosti, Poslate poruke i Revizorski trag. Revizorski trag dobija paginaciju, prevedene radnje i JSON iza „Detalji”.
  - **Saglasnost vlasnika:** kartica e-glasanja je prva kad nije uključena.
- **Mockup:** X-M02.
- **Pitanje:**
  - **X-Q5:** „Evidencije” kao stavka menija ili tabovi u Podešavanjima. Preporuka: stavka menija. Ako D8 nije odlučen, stavka se privremeno dodaje na kraj liste.
- **Rizik:** srednji. Parametri utiču na obračun: potrebni su testovi parsiranja, a server upisuje samo promijenjene vrijednosti (zbog revizorskog traga).
- **Izlazni kriterijum:** nema slobodnog teksta za bulove; nijedna onemogućena forma; svaka radnja potvrđena; revizorski trag ≤ ~3.000px po strani na 375.

### FR — Registar posebnih dijelova i spisak etažnih vlasnika: temelj glasanja *(M–L · domenska izmjena · K-02, K-03, K-03a, FR-Q3, FR-Q4 odlučeni · otvoreno samo K-03b, pravnik)*

**Status: ISPORUČENO u v2.43.0 (nije commitovano). Odluke donesene 2026-10-24; implementacioni plan: [`fr-registar-i-glasanje-po-etaznim-vlasnicima-plan.md`](fr-registar-i-glasanje-po-etaznim-vlasnicima-plan.md).**

- **Svrha:** spisak posebnih dijelova je potpun i utvrđen prije prvog vlasnika. Zato je i spisak etažnih vlasnika potpun prije prvog glasanja. Kvorum i većina se računaju po **broju glasačkih subjekata**: samostalni vlasnik ili suvlasnička zajednica, svaki sa jednim glasom (K-03, K-03a), nad utvrđenim registrom (K-02).
- **Rješava:**
  - neauditovanu izmjenu `ownershipShare`;
  - konfigurabilnu težinu glasa koja dozvoljava glasanje po udjelu;
  - glasanje otvoreno dok neki posebni dio nema upisanog vlasnika;
  - prethodnog vlasnika koji ostaje u glasačkoj bazi (K-01b).
- **Kako izgleda za predsjednika (tok podešavanja ZEV-a):**
  1. **Zgrade i ulazi** — kao danas.
  2. **Posebni dijelovi (registar u nacrtu).**
     - Tabela svih posebnih dijelova, uključujući garaže i garažna mjesta (K-03 tačka 8): oznaka, zgrada/ulaz, vrsta, površina i udio u zajedničkim dijelovima.
     - Udio se ovdje zove **„Udio u troškovima”**: služi za raspodjelu troškova, ne za glasanje.
     - Sažetak iznad tabele: „8 posebnih dijelova · 2 zgrade · zbir udjela u troškovima 100,00 %”.
     - Dok je registar u nacrtu, sve se može mijenjati.
  3. **„Utvrdi registar”:**
     - Dugme je `caution`, iza `ConfirmAction`. Tijelo potvrde ponavlja sažetak i posljedicu: dalje izmjene samo kao evidentirana izmjena registra.
     - Preduslovi ✓/⚠ (obrazac D2): svaki posebni dio ima oznaku, vrstu i površinu; zbir udjela u troškovima je 100,00 %. Zbir je preduslov zbog troškova, ne zbog glasanja.
  4. **Vlasnici i udjeli** su dostupni tek kad je registar utvrđen. Prije toga tab „Vlasništvo” i „Dodaj vlasnički udio” pokazuju „Prvo utvrdite registar posebnih dijelova”, sa linkom.
  5. **Spisak etažnih vlasnika (glasova)** se izvodi iz registra i upisanih vlasnika: svaki samostalni vlasnik jednom, svaka suvlasnička zajednica jednom, sa predstavnikom.
     - Prikazuje se kao sažetak („5 glasova · 6 lica · 8 posebnih dijelova · 0 bez upisanog vlasnika”).
     - Na listi vlasnika je kolona „Glasa kao”: „samostalni vlasnik — 2 posebna dijela, 1 glas” / „predstavnik zajednice Stan 3” / „suvlasnik Stana 3 — glasa predstavnik Nikola Ilić”.
- **Nakon utvrđivanja:**
  - Svaka izmjena registra ide kroz **„Izmjena registra”**: novi posebni dio, ukidanje, spajanje ili dioba, promjena površine ili udjela u troškovima.
  - Izmjena traži razlog i dokument (FR-Q3) i ne može se uraditi dok je bilo koje glasanje otvoreno.
  - Svaka izmjena ide u audit sa vrijednostima prije i poslije.
  - Registar ima istoriju verzija.
  - Promjena udjela u troškovima kaže u potvrdi da **ne utiče na glasanje**.
- **Glasanje (skupština):**
  - **Jedno pravilo težine:** jedan etažni vlasnik — jedan glas. Forma „Pravila glasanja” više ne nudi izbor metode, nego to piše kao tekst. Kvorum i većina se zadaju u procentu broja etažnih vlasnika.
  - **Preduslovi u `openVoting`** (desktop i uživo; prikazani i u panelu „Sljedeći korak”):
    - registar je utvrđen;
    - nijedan posebni dio u obimu glasanja nije bez upisanog vlasnika;
    - nijedna jedinica nema zbir vlasničkih udjela iznad 100% (K-01b);
    - svaka suvlasnička zajednica u obimu glasanja ima zajedničkog predstavnika (K-03a; podrazumijevano je uvijek određen).
  - **Upozorenje bez blokade:** jedinica sa zbirom ispod 100% (moguće nedostaje suvlasnik).
  - **Imenilac:** broj glasačkih subjekata u obimu glasanja. Lični link i glas idu samostalnom vlasniku ili predstavniku zajednice (ili njihovom punomoćniku).
  - `ruleSnapshot` bilježi verziju registra, broj glasova i sastav svake suvlasničke zajednice sa predstavnikom.
  - Na prijedlogu piše: „Osnova: registar verzija 2 od 24.10.2026. · 5 glasova (6 lica, 8 posebnih dijelova)”.
- **Postojeći ZEV-ovi sa podacima (FR-Q4):**
  - Registar počinje kao **„Za provjeru”**; dodavanje vlasnika i dalje radi.
  - Za svaku postojeću suvlasničku zajednicu predstavnik se popunjava po podrazumijevanom pravilu (najveći udio) i označava „Za potvrdu”.
  - Predsjednik dobija stavku u „Za Vas sada” (D1).
  - Novo glasanje traži utvrđen registar.
  - Postojeća pravila glasanja sa metodom po udjelu ili površini se pri migraciji prevode na „jedan vlasnik — jedan glas”, uz zapis u istoriji pravila. Glasanja koja su već otvorena završavaju se po zamrznutom pravilu.
- **Dizajn sistem:** samo postojeći primitivi i obrasci (`Table`, `Stat`, `StatusBadge` sa novim ključevima u `statusTone`, `ConfirmAction` `caution`, D2, `FilePicker`). Novih obrazaca nema.
- **Domenska izmjena** (ide u implementacioni plan):
  - stanje i verzija registra na `Zev`;
  - zapis izmjene registra;
  - vrsta „Garažno mjesto”;
  - audit `ownershipShare`;
  - preduslovi u `openVoting`;
  - zajednički predstavnik suvlasničke zajednice i osnova glasanja po subjektu, a ne po licu (`ownersVotingBasis`, `EligibleVoter`, prozivka uživo);
  - fiksiranje metode težine za skupštinu i migracija postojećih pravila;
  - ažuriranje `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md` §2 (tabela „Odlučivanje skupštine”) i §3 tačke 2 i 3;
  - seed sa pravilima po broju vlasnika.
- **Zavisnosti i redoslijed:**
  - FR ide prije glasačkog dijela F8 (K-01b) i prije F6a. Traka kvoruma uživo broji ljude, pa F6a koristi isti imenilac.
  - F1 ne zavisi od FR.
- **Mockup:** [X-M04](design-review/mockups/X-M04-registar-posebnih-dijelova.html), ažuriran po K-03. Prikazuje:
  - ① registar u nacrtu sa potvrdom utvrđivanja;
  - ② zaključan tab „Vlasništvo” i stanje „Za provjeru”;
  - ③ utvrđen registar sa spiskom etažnih vlasnika (jedan glas po licu) i upozorenjima o zbiru vlasničkih udjela;
  - ④ izmjenu registra i karticu rezultata glasanja po broju etažnih vlasnika;
  - ⑤ sve to na 375px.
- **Rizik:** srednji do visok.
  - Mijenja pravila glasanja: testovi moraju pokazati da se zamrznuti `ruleSnapshot` nikad ne preračunava.
  - Migracija na produkciji se pokreće ručno prije deploy-a.
  - K-03b (lice koje je i samostalni vlasnik i suvlasnik) potvrđuje pravnik.
  - Prelazak sa glasa po licu na glas po subjektu mijenja glasačke liste i prozivku; testovi moraju pokriti zajednicu sa punomoćnikom predstavnika.
- **Provjera:**
  - Novi ZEV: zgrade → registar → utvrđivanje → vlasnici → glasanje, na 1440 i 375.
  - Postojeći ZEV: „Za provjeru” → utvrđivanje.
  - Primjer imenioca: Ana (Stan 1 + Garaža 1), Marko (Stan 2 + Stan 4), Nikola i Sara zajedno (Stan 3, predstavnik Nikola), Milan (Stan 5 + Garaža 2) i Apoteka (Poslovni prostor 1) su **5** glasova za 8 posebnih dijelova i 6 lica. Kvorum od 50% je 3 glasa. Sara ne dobija lični link.
- **Izlazni kriterijum:**
  - Nijedan vlasnik se ne dodaje u novom ZEV-u prije utvrđenog registra.
  - Nijedno glasanje skupštine se ne otvara bez utvrđenog registra, sa posebnim dijelom bez vlasnika, ili sa jedinicom iznad 100%.
  - Imenilac je broj glasačkih subjekata; suvlasnici jednog posebnog dijela nikad ne dobijaju više od jednog linka.
  - Forma pravila glasanja ne nudi glasanje po udjelu ni po površini.
- **Pitanja:**
  - **FR-Q1:** *zatvoreno odlukom K-03.* Svi posebni dijelovi, uključujući garaže i garažna mjesta, čine vlasnika etažnim vlasnikom.
  - **FR-Q2:** *zatvoreno odlukama K-03 i K-03a.* Jedan glas po samostalnom vlasniku ili suvlasničkoj zajednici. Ostaje **K-03b** (granični slučaj, pravnik).
  - **FR-Q3 — ODLUČENO (2026-10-24):** utvrđen registar mijenja **predsjednik**, uz obavezan razlog i dokument (elaborat, rješenje katastra i sl.). Izmjena je zabranjena dok traje bilo koje glasanje, a svaka izmjena je nova verzija registra u auditu. Veza na odluku skupštine nije obavezna.
  - **FR-Q4 — ODLUČENO (2026-10-24):** postojeći ZEV-ovi prelaze u **prelazni režim „Za provjeru”**:
    - dodavanje vlasnika i dalje radi;
    - predsjednik dobija zadatak da registar provjeri i utvrdi;
    - novo glasanje se ne može otvoriti dok registar nije utvrđen.
  - **FR-Q5:** *zatvoreno odlukom K-03.* Zbir od 100% je preduslov samo zbog troškova; glasanje ne koristi procente.

### F8 — Mobilne tabele i evidencija vlasnika i jedinica *(M · D3 · preporučeno nakon P8 sesije)*

- **Svrha:** nijedna radnja ni ključni podatak van ekrana na 375; lista je prvi sadržaj na svakoj listi. Rješava K7, X-N19, P-N17–P-N22 i V-N19–V-N23.
- **Šta se mijenja:**
  - **Tabele:** pravilo card-transforma (D3) i bugfix rasporeda kartice (X-R14, P-R11, dio V-R05).
  - **Liste:** „lista prvo, forma iza `ToggleBtn`” na održavanju, planovima i dnevnom redu (P-R09, V-R06).
  - **Detalj vlasnika:** preuređen po važnosti za glas; kontakt samo za čitanje uz „Uredi” (P-R10).
  - **Tab „Vlasništvo”:** dobija tabelu udjela.
  - **Fajlovi:** `FilePicker` za sken izjave.
  - **Dokumenti:** po vrsti/sjednici; vlasnik vidi naziv, a ne šifru (P-R12, V-R08).
  - **Boje statusa:** sopstvene, umjesto pozajmljenih (P-R13).
  - **Čitljivost:** na 375 (V-R07).
  - **Vlasnički udio kao upozorenje, ne blokada (K-01, K-01a, K-01b, K-01c):**
    - `addOwnershipStake` više ne odbija zbir iznad 100%, nego vraća upozorenje koje forma prikazuje uz uspjeh.
    - Tab „Vlasništvo” dobija kolonu „Zbir udjela” po jedinici, sa chipom: „100 %” bez tona, „Upisano 50 %” amber, „Zbir 150 %” amber.
    - Detalj vlasnika prikazuje isto upozorenje uz svaku njegovu jedinicu.
    - Stavka u „Za Vas sada” predsjednika (ako je F6b isporučena; inače samo na tabu).
    - Pravilo glasanja po odluci K-01b. Kod preporučene opcije A to znači: preduslov u `openVoting`, isti preduslov u potvrdi otvaranja glasanja na desktopu i uživo, i ⚠ u panelu „Sljedeći korak” (ako je F6b isporučena). **Gradi se nad registrom iz faze FR**, koja mijenja imenilac; ako FR još nije isporučena, glasački dio K-01 čeka nju.
    - **Redoslijed:** pravilo glasanja ide u istu isporuku kao uklanjanje blokade dodavanja, nikad poslije. Inače bi prvi zbir iznad 100% mogao ući u glasanje neprimijećen.
- **Pitanja:**
  - **V-Q5:** da li vlasnik smije vidjeti imena drugih vlasnika i zakupaca. Preporuka: ne, dok se pravni osnov ne potvrdi.
  - **K-01b:** jedinica iznad 100% (prethodni vlasnik u bazi) blokira otvaranje glasanja; preduslov se gradi u FR.
  - **K-01c:** riješeno kroz K-03 i FR.
- **Rizik:** srednji.
  - Izmjena `Table` utiče na svih ~50 tabela, pa treba regresioni pregled svake na 375.
  - K-01 dira servis vlasništva i otvaranje glasanja, pa trebaju testovi:
    - dodavanje udjela preko 100% uspijeva i vraća upozorenje;
    - glasanje se ne otvara (opcija A) ili normalizuje (opcija B) za jedinicu iznad 100%, i na desktopu i uživo;
    - jedinica ispod 100% ne blokira glasanje.
- **Izlazni kriterijum:**
  - Nijedna tabela sa kolonom radnji ne traži horizontalni skrol na 375; nema e-adrese u koloni labele.
  - Dodavanje vlasnika nikad ne pada zbog zbira udjela.
  - Nijedno glasanje se ne otvara sa jedinicom iznad 100% bez pravila iz K-01b.

### F9 — Informaciona arhitektura po ulogama i platformski admin *(M · D8, D4 · X-Q6, R-Q1)*

- **Svrha:** meni odgovara poslovima uloge; admin je pregledan i siguran. Rješava X-N03, X-N04, X-N20–X-N22.
- **Šta se mijenja** (X-R03, X-R15, X-R16):
  - **Meni:** redoslijed i grupe po ulozi (D8).
  - **Vlasnik:** „Podešavanja” se premješta u meni naloga kao „Moji podaci” (X-Q6).
  - **Uplate:** zasebna stavka menija za upravu (R-Q1).
  - **Admin lista:** u punoj širini, sa `primary` „Novi ZEV nalog” u zaglavlju.
  - **„Podešavanja platforme”:** zasebna stavka.
  - **Radnje nad nalozima:** potvrda se otvara u punoj širini ispod reda.
  - **Upozorenje „nema predsjednika”:** kao `Flash warn` (D4).
- **Mockupi:** X-M01, X-M03.
- **Rizik:** srednji. Postojeći korisnici gube naviknut redoslijed; ublažiti napomenom u `CHANGELOG.md` i, ako postoji, korisničkim uputstvom.
- **Provjera:** P8 sesija sa zadacima „platite”, „prijavite kvar”, „nađite ko je promijenio parametar”, „uklonite pristup računovođi”.
- **Izlazni kriterijum:** svaka uloga ima dokumentovan redoslijed i grupe u DS §4.5; „Super admin” ide kroz `t()`; „Ukloni moj pristup” je iza potvrde.

### F10 — Higijena, kontinuirano *(uz svaku fazu)*

Svaka faza koja dira stranicu na njoj radi i sljedeće:
- korijen stranice postaje `space-y-6`;
- `text-xs` za sadržaj postaje `text-[13px]`;
- `slate-400` za sadržaj postaje `slate-500`;
- brojevi sa decimalnim zarezom i jedinicom (`formatWeight`, P-R05);
- „korišćenje” postaje „korištenje”.

Uz to se predlaže jednostavna CI provjera koja pada ako broj `text-xs` raste (hipoteza o korisnosti; odluka na Vama).

---

## 7. Uvođenje, mjerenje i povlačenje

- **Isporuka:** jedna faza (ili pod-faza a/b) je jedna minor verzija, kao u P10 prethodnog plana. Svaka ima `CHANGELOG.md` unos, potvrđenu verziju i živi pregled na 1440/375 prije isporuke.
- **Izloženost:** aplikacija nema zastavice funkcionalnosti. F1–F7 se isporučuju direktno, jer je svaka promjena aditivna (potvrda, blok, panel) i ne uklanja postojeći put.
  - Za **F9** (promjena menija), jedinu fazu koja mijenja naviku, predlaže se pilot: grupe menija iza parametra ZEV-a (postojeći mehanizam podešavanja po ZEV-u), uključen prvo za jedan ZEV, 2–4 sedmice. To je prijedlog; odluka je Vaša.
- **Povlačenje:** Vercel vraćanje na prethodni deployment za svaku fazu. Nijedna faza ne predlaže migraciju baze kao dio dizajna. Izuzeci, ako se odobre, su veza prijedlog ↔ tačka (F1), veza odluka ↔ prijava (F6, P-Q2) i tip parametra (F7, kod, ne baza). Uz takvu migraciju povlačenje je samo naprijed (novi deploy), pa to mora pisati u implementacionom planu.
- **Mjerenje:** nema analitike, pa se ne navode brojke poboljšanja. Za poređenje prije/poslije predlažu se pokazatelji koje baza već ima. Svi pragovi su **prijedlozi**, ne utvrđeni ciljevi:

| Pokazatelj (iz postojećih podataka) | Faza | Predloženi signal uspjeha | Zaštitna granica |
|---|---|---|---|
| Storno alokacije u roku 24h od raspoređivanja (audit log) — posredni znak pogrešnog uparivanja | F1, F5 | pada | ne raste broj neraspoređenih uplata starijih od 30 dana |
| Serije korigovane ili stornirane u roku 48h od izdavanja | F1, F5 | pada | vrijeme od nacrta do izdavanja ne raste značajno |
| Starost neraspoređenih uplata (medijana dana) | F5 | pada | — |
| Udio e-glasova po prijedlogu (glasalo / glasačka baza) | F3, F4 | raste ili ostaje | ne raste broj ponovo izdatih linkova |
| Udio uplata uparenih automatski po pozivu na broj | F3 | raste (manje pogrešno prepisanih poziva) | — |
| Zahtjevi za pomoć predsjedniku („kako da platim”, „nisam dobio link”) | F3, F4 | pada | bilježi predsjednik; nema sistema za to |

  - **Prozor posmatranja:** jedan pun mjesečni ciklus (serija → uplate → uparivanje) po fazi.
  - **Odluka nakon prozora:** proširiti / doraditi / vratiti.
  - **Okidač za vraćanje:** bilo koja zaštitna granica se pogorša i vezana je za izmjenu.
- **Kvalitativno:** posmatrana sesija P8 (20 minuta, vlasnik ili predsjednik, telefon) prije F8 i F9, sa istim zadacima prije i poslije.

---

## 8. Pregled otvorenih pitanja

| Pitanje | Gdje | Posljedica izbora | Preporuka | Blokira |
|---|---|---|---|---|
| D1–D9 | §5 | vidi §5 | vidi §5 | F2–F9 |
| P-Q4 — režim uživo za upravni odbor: namjerno? | 04, P-N13 | ako ne, dugme se sakriva za UO; ako da, P3 se ažurira i provjerava se kvorum po članu | potvrditi | F6a |
| P-Q3 — ukinuti P10 (stara kartica prisustva) | 04 | da: kartica postaje sažetak + link; ne: preimenuje se u „Naknadni unos” | ukinuti | F6b |
| P-Q2 — odobrenje prijave bez usvojene odluke | 04 | tvrda kapija vs. veza + upozorenje vs. slobodan tekst | veza + upozorenje | F6b (P-R04) |
| P-Q5 — pravni rokovi u panelu „Sljedeći korak” | 04 | bez izvora panel ne tvrdi zakonske rokove | prva verzija bez rokova | F6b |
| V-Q1, V-Q2, V-Q3, V-Q6 — glasanje u aplikaciji, novi link, izbor na potvrdi, drugi kanal koda | 02 | pravni model izjašnjenja | vidi F4 | F4 |
| V-Q4 — bankarski QR i format poziva na broj | 02 | zavisi od banke | provjeriti sa bankom ZEV-a | D7 C |
| K-01b — glasanje kad jedinica ima zbir udjela iznad 100% (preformulisano K-03: prethodni vlasnik u glasačkoj bazi) | §Odluke korisnika | A: glasanje se ne otvara dok se ne ispravi; B i C otpadaju (nema težine po udjelu) | A | FR |
| K-01c — nepotpun upis vlasnika | §Odluke korisnika | posebni dio bez vlasnika: broj etažnih vlasnika nepoznat | **riješeno kroz K-03 / FR:** bez vlasnika = preduslov glasanja; ispod 100% = upozorenje | FR |
| FR-Q1 — pravo glasa po vrsti ili po jedinici | §6 FR | — | **zatvoreno (K-03):** svi posebni dijelovi, uključujući garaže | — |
| FR-Q2 — „jedan vlasnik — jedan glas” uz registar | §6 FR | — | **zatvoreno (K-03):** po licu, bez duplikata | — |
| K-03a — suvlasnici istog posebnog dijela | §Odluke korisnika | — | **odlučeno:** zajedno jedan glas, preko zajedničkog predstavnika | — |
| K-03b — lice koje je samostalni vlasnik jednog dijela i suvlasnik drugog | §Odluke korisnika K-03a | dva subjekta (dva glasa) vs. jedan glas, a zajednica glasa preko drugog suvlasnika | dva subjekta; potvrda pravnika | FR (ne blokira) |
| FR-Q3 — izmjena utvrđenog registra | §6 FR | — | **odlučeno:** predsjednik uz razlog i dokument; ne tokom glasanja | — |
| FR-Q4 — postojeći ZEV-ovi | §6 FR | — | **odlučeno:** prelazni režim „Za provjeru” | — |
| FR-Q5 — 100% za sve jedinice ili samo za one sa pravom glasa | §6 FR | — | **zatvoreno (K-03):** 100% samo kao osnova troškova; glasanje ne koristi procente | — |
| V-Q5 — vlasnik vidi imena drugih vlasnika i zakupaca | 02 | zaštita ličnih podataka | ne, dok se ne potvrdi osnov | F8 |
| R-Q1 — uplate: tab ili stavka menija | 03 | vidljivost vs. dužina menija | stavka menija | F5 / F9 |
| R-Q3 — najčešći kanal priliva | 03 | redoslijed na stranici uplata | pitati računovođu ili brojati uvoze | F5b |
| R-Q4, R-Q5, R-Q6 — avans, dospijeće u prošlosti, djelimično plaćanje troška | 03 | računovodstvena pravila, ne dizajn | upozoriti; ostalo zasebno | F1 (opciono) |
| X-Q5 — „Evidencije” kao stavka menija | 01 | jasnoća vs. još jedna stavka | stavka menija | F7 |
| X-Q6 — vlasniku „Podešavanja” u meni naloga | 01 | kraći meni | da, uz D8 | F9 |

---

## 9. Šta ovaj pregled namjerno ne radi

- Ne mijenja kod i ne pravi implementacioni plan ni za jednu fazu prije Vašeg odobrenja.
- Ne predlaže novu boju, veličinu teksta, razmak ni težinu dugmeta. Dopune (§5) su kompozicije ili proširenja postojećeg.
- Ne odlučuje pravna pitanja (glasanje u aplikaciji, rokovi, ovlašćenja, vidljivost ličnih podataka); samo ih imenuje i opisuje posljedice.
- Ne tvrdi da su mockupi testirani sa korisnicima. To su statični prikazi za odluku, provjereni u pregledaču na obje širine.
- Ne pokriva ad-hoc prikupljanje sredstava, jer nema UI-ja (prilog 03).

---

## Prilozi

- [01 — Zajedničko: školjka, navigacija, prijava, podešavanja, admin](design-review/01-zajednicko-skoljka-admin.md)
- [02 — Etažni vlasnik](design-review/02-vlasnik.md)
- [03 — Računovođa](design-review/03-racunovodja.md)
- [04 — Predsjednik](design-review/04-predsjednik.md)
- Mockupi:
  - X: [X-M01](design-review/mockups/X-M01-navigacija-po-ulogama.html) · [X-M02](design-review/mockups/X-M02-podesavanja-i-evidencije.html) · [X-M03](design-review/mockups/X-M03-admin-zev-detalj.html) · [X-M04](design-review/mockups/X-M04-registar-posebnih-dijelova.html) (registar posebnih dijelova, faza FR)
  - V: [V-M01](design-review/mockups/V-M01-pocetna-vlasnika.html) · [V-M02](design-review/mockups/V-M02-faktura-kako-platiti.html) · [V-M03](design-review/mockups/V-M03-e-glasacki-listic.html)
  - R: [R-M01](design-review/mockups/R-M01-radni-red-racunovodje.html) · [R-M02](design-review/mockups/R-M02-uvoz-izvoda-i-uparivanje.html) · [R-M03](design-review/mockups/R-M03-detalj-serije-faktura.html)
  - P: [P-M01](design-review/mockups/P-M01-sjednica-sljedeci-korak.html) · [P-M02](design-review/mockups/P-M02-pocetna-predsjednika.html) · [P-M03](design-review/mockups/P-M03-uzivo-kvorum.html)
- Zatečeno stanje: [`design-review/zateceno/`](design-review/zateceno/) (91 screenshot, 1440 i 375)
