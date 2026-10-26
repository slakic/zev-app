# LEGAL_AND_FINANCIAL_ASSUMPTIONS

Ovaj dokument popisuje pravne izvore, mapiranje članova zakona na funkcionalnosti, otvorena tumačenja,
konfigurabilne pravne parametre i finansijske pretpostavke MVP aplikacije za upravljanje jednom
Zajednicom etažnih vlasnika (ZEV) u Republici Srpskoj.

> **Aplikacija ne garantuje pravnu usklađenost.** Ona modeluje zakonske zahtjeve i čini sporna
> pravila konfigurabilnim. Sve stavke označene **[PRAVNA PROVJERA]** ili **[RAČUNOVODSTVENA PROVJERA]**
> mora pregledati advokat, odnosno računovođa licenciran u Republici Srpskoj.
>
> **Odluke korisnika od 2026-10-26** (pravna pitanja iz ranijih verzija) označene su u tekstu kao
> **ODLUČENO (2026-10-26, korisnik)**; kod njih je oznaka [PRAVNA PROVJERA] uklonjena. Ostale oznake
> su i dalje otvorene.

## 1. Izvori

1. **Zakon o održavanju zgrada Republike Srpske**, „Službeni glasnik Republike Srpske" br. 101/11
   (u daljem tekstu: ZOZ RS). Primarni domenski osnov.
2. Podzakonski akti o registraciji ZEV (registar zajednica kod nadležnog organa jedinice lokalne
   samouprave) — korišteni samo na nivou strukture podataka za registraciju.
3. **Zakon o zaštiti ličnih podataka BiH**, „Službeni glasnik BiH" br. 12/25 — osnov za privatnost
   (minimizacija, svrha, rokovi čuvanja, prava lica).
4. Propisi o elektronskom dokumentu, elektronskoj identifikaciji i elektronskom potpisu u BiH/RS —
   korišteni kao ograničenje: elektronsko odobravanje u aplikaciji **nije kvalifikovani elektronski
   potpis** i tako je i označeno u UI i dokumentima.
5. **Napomena:** Zakon o stanovanju i održavanju zgrada Republike **Srbije** ("stambena zajednica",
   "profesionalni upravnik") **nije** korišten i njegovi instituti nisu preneseni.

## 2. Mapiranje zakona na funkcionalnosti (ZOZ RS 101/11)

| Oblast zakona | Funkcionalnost u aplikaciji | Napomena |
|---|---|---|
| ZEV kao pravno lice sa registracijom (čl. o osnivanju i registraciji ZEV) | Matični podaci ZEV: naziv, JIB, registarski broj, sjedište, osnivački akti, podaci za prijavu u registar; generisanje dokumenta „Podaci za prijavu u registar" | Tačan sadržaj prijave zavisi od opštinskog obrasca — šablon je uredljiv. **Obrasci za registraciju ZEV dodaju se naknadno** (odluka 2026-10-26, korisnik). **[PRAVNA PROVJERA]** |
| Organi ZEV: skupština, predsjednik i upravni odbor | Uloge PREDSJEDNIK, ČLAN SKUPŠTINE/VLASNIK i ČLAN UPRAVNOG ODBORA; evidencija mandata sa datumima važenja za sve funkcije; stranica „Organi ZEV" prikazuje trenutni sastav i istoriju | Broj članova upravnog odbora je preporuka (nije obavezan), trajanje mandata je konfigurabilno — vidi §7. |
| Etažni vlasnici kao članovi skupštine | Članstvo u skupštini izvodi se isključivo iz aktivnih vlasničkih udjela (`OwnershipStake`), nikada iz stanovanja. Etažni vlasnik je vlasnik **bilo kog** posebnog dijela, uključujući garaže i garažna mjesta; spisak posebnih dijelova je utvrđen u registru (verzionisan, mijenja ga predsjednik uz razlog i dokument, ne tokom glasanja) | Stanar/zakupac nema pravo glasa. Odluke korisnika K-02 i K-03 (2026-10-24). |
| Odlučivanje skupštine, kvorum i većina | Konfigurabilna pravila kvoruma i većine po prijedlogu + snimak pravila u trenutku otvaranja glasanja | ZOZ RS ne uređuje sve tipove odluka jednoznačno; **podrazumijevano pravilo: jedan etažni vlasnik — jedan glas; suvlasnici istog posebnog dijela zajedno imaju jedan glas, preko zajedničkog predstavnika** (K-03, K-03a). Kvorum i većina se računaju po broju glasova, ne po udjelima ili površini. **Lice daje najviše jedan glas ukupno** (K-03b, odluka 2026-10-26): ko je samostalni vlasnik jednog posebnog dijela, ne glasa i za zajednicu u kojoj je suvlasnik — za nju glasa drugi suvlasnik. Seed: kvorum >50% etažnih vlasnika, obična većina. **ODLUČENO (2026-10-26, korisnik)** |
| Pismeno izjašnjavanje / glasanje van sjednice | Elektronsko odobravanje sa pojedinačnim linkovima, evidencija papirnih glasova | Zakon iz 2011. ne poznaje elektronsko glasanje. **Odluka 2026-10-26 (korisnik):** e-glasanje „pravno nije validno, ali je u funkcionalnom smislu dobar alat” — služi za vođenje glasanja i pripremu dokumentacije sjednice (zapisnik, dnevni red…); opisuje se kao evidentirani izraz volje, ne kao pravno obavezujuće izjašnjavanje ni kvalifikovani potpis. |
| Punomoć za zastupanje vlasnika | `Proxy` sa obimom (sve/sjednica/prijedlog), datumima važenja i referencom na dokument punomoći | Punomoć **ne zahtijeva ovjeru** (odluka 2026-10-26, korisnik) — aplikacija je ne provjerava, postoji polje napomene. **ODLUČENO** |
| Zapisnik i odluke skupštine | Generisanje zapisnika i odluka iz podataka o sjednici; finalizovani dokumenti su verzionisani i nepromjenjivi | |
| Obaveza održavanja i naknada za održavanje | Konfigurabilne stavke naknade (redovno održavanje, rezervni fond/fond održavanja…) sa 9 metoda obračuna | **Zakonski minimum naknade za održavanje: 0,20 KM/m² za fizička lica, 0,40 KM/m² za pravna lica** (odluka 2026-10-26, korisnik). Aplikacija samo **upozorava, ne blokira**: u listi stavki naknada (stopa ispod 0,20 KM/m²) i u „Upozorenjima prije izdavanja” nacrta serije (po jedinici, prema vrsti lica dužnika). Računa se samo stavka obračunata **po m²** koja je označena kao fond održavanja ili ima „održavanje” u nazivu; stope takvih stavki jedinice se sabiraju; jedinica bez takve stavke se ne ocjenjuje. **ODLUČENO** |
| Hitne intervencije | Poseban „hitni put" u toku održavanja uz obavezno evidentiranje razloga, ovlašćenja i naknadne ratifikacije | Prag iznosa za hitne radove konfigurabilan. |
| Upravljanje sredstvima ZEV | Evidencija računa, prihoda, rashoda, fonda održavanja | Nije zakonsko knjigovodstvo — vidi §5. |

*Reference na brojeve članova namjerno su date na nivou oblasti: brojevi članova moraju se potvrditi
prema službenom prečišćenom tekstu ZOZ RS 101/11 prije citiranja u dokumentima.* **[PRAVNA PROVJERA]**

## 3. Nerazjašnjena tumačenja (aplikacija NE izmišlja pravilo)

1. **Kvorum i većina po tipu odluke** (redovno upravljanje vs. raspolaganje vs. kapitalni radovi):
   konfigurabilno po prijedlogu; podrazumijevane vrijednosti su samo seed podaci.
2. **Težina glasa**: *odgovoreno odlukom K-03 (korisnik, 2026-10-24).* Jedan etažni vlasnik ima jedan glas,
   bez obzira na broj posebnih dijelova; procenti udjela i površine se za glasanje ne koriste i težina se više
   ne bira. Snimak pravila se i dalje čuva po prijedlogu (stari snimci sa težinom po udjelu ostaju kakvi su bili).
   Potvrđeno 2026-10-26 (korisnik): „jedan etažni vlasnik, jedan glas”. **ODLUČENO**
3. **Da li suvlasnici glasaju srazmjerno udjelu ili jedinica ima jedan glas**: *odgovoreno odlukom K-03a
   (korisnik, 2026-10-24).* Suvlasnici istog posebnog dijela zajedno imaju jedan glas, preko zajedničkog
   predstavnika (podrazumijevano suvlasnik sa najvećim udjelom, predsjednik ga može odrediti izričito).
   **K-03b — ODLUČENO (2026-10-26, korisnik):** lice koje je samostalni vlasnik jednog posebnog dijela i suvlasnik
   drugog daje **najviše jedan glas ukupno**. Primjer: Nikola je sam vlasnik Garaže 4 i sa Sarom suvlasnik Stana 3 —
   Nikola ima 1 glas; zajednica Stana 3 i dalje ima svoj glas, ali ga daje predstavnik koji **ne glasa** već kao
   samostalni vlasnik (ovdje Sara). Implementacija (`assemblyVotingSubjects`, `src/server/services/ownership.ts`):
   - podrazumijevani predstavnik zajednice preskače članove koji već glasaju kao samostalni vlasnici;
   - ako je izričito određen predstavnik zajednice ujedno samostalni vlasnik, **otvaranje glasanja je blokirano**
     preduslovom (poruka imenuje zajednicu i traži od predsjednika drugog predstavnika); registar prikazuje
     isto upozorenje;
   - ako **svi** članovi zajednice već glasaju kao samostalni vlasnici, zajednica nije poseban glasački subjekt
     (nema dodatnog glasa) i registar to prikazuje kao informaciju;
   - zamrznuti snimci pravila (`ruleSnapshot`) i spiskovi birača već otvorenih i zatvorenih prijedloga se nikad
     ne preračunavaju.
4. **Pravna snaga elektronskog izjašnjavanja**: *odgovoreno 2026-10-26 (korisnik):* e-glasanje „pravno nije
   validno, ali je u funkcionalnom smislu dobar alat” za vođenje glasanja i izradu dokumentacije (zapisnici,
   dnevni red…). Tekstovi u aplikaciji (listić, prijedlog, kartica saglasnosti, izjava o saglasnosti, pozivi) ne
   tvrde pravnu valjanost; opisuju evidentirani izraz volje. Mehanika glasanja je nepromijenjena (hash sadržaja,
   žig vremena, identifikacija). UI i dalje označava postupak kao „elektronsko izjašnjavanje/odobravanje”, ne
   „elektronski potpis”. **ODLUČENO**
5. **Zatezna kamata na dugovanja vlasnika**: *odgovoreno 2026-10-26 (korisnik):* **zatezna kamata ne postoji.**
   Parametar „Zatezna kamata” je uklonjen iz Podešavanja i iz podrazumijevanih vrijednosti; stari redovi u bazi
   se ignorišu. **ODLUČENO**
6. **Rokovi čuvanja podataka** (zapisnici, glasanje, finansije, logovi pristupa): konfigurabilni
   parametri u Podešavanjima; podrazumijevano 11 godina za finansijske dokumente. **Podaci o glasanju se
   čuvaju 5 godina** (odluka 2026-10-26, korisnik): podrazumijevani i najmanji rok je 1826 dana
   (`retention.voteIpDays`); glasovi, listići i revizorski trag su trajni i ne brišu se. Rokovi za zapisnike i
   logove pristupa ostaju otvoreni. **[PRAVNA PROVJERA]** (preostali rokovi)
   - **Sirova IP adresa aktivne sesije** (`Session.ipAddress`, super-admin pregled na
     `/admin/sesije` — Plans/live-sessions-admin-plan.md §O1/§O6): namjerna, uska izuzetka od
     ovog inače isključivo heš-zasnovanog čuvanja IP adresa (`AuditEvent.ipHash`, `Vote.ipHash`,
     `Session.ipHash`). Živi isključivo dok sesija traje — briše se pri odjavi, opozivu ili
     isteku (najduže 12h, po TTL-u sesije), nikad se ne kopira u `AuditEvent`. **[PRAVNA PROVJERA]**
7. **JMBG**: aplikacija namjerno NE evidentira JMBG; identifikacija lica vodi se preko imena,
   kontakta i internog ID-a. Ako registarski organ zahtijeva JMBG u obrascu, unosi se ručno u
   generisani dokument. **[PRAVNA PROVJERA]**
8. **Sastav i mandat upravnog odbora, glasanje u odboru**: vidi detaljno §7. *Odgovoreno 2026-10-26 (korisnik):*
   preporučeni broj članova je 3, ali nije obavezan (aplikacija samo upozorava na stranici Organi); predsjednik
   ZEV vodi i upravni odbor i u njemu je jedan od jednakih (utvrđena činjenica, više nije parametar). Trajanje
   mandata i način odlučivanja odbora ostaju kao konfigurabilni parametri. **[PRAVNA PROVJERA]** (trajanje
   mandata, nadležnosti i način odlučivanja odbora)
9. **Registracija ZEV**: obrasci za registraciju ZEV će se dodati naknadno (odluka 2026-10-26, korisnik).
10. **Rok poziva na sjednicu**: *odgovoreno 2026-10-26 (korisnik):* pozivi se šalju najmanje **7 kalendarskih dana**
    prije sjednice. Aplikacija samo **upozorava, ne blokira** (⚠ u „Sljedeći korak” i u potvrdi slanja poziva).
    **ODLUČENO**

## 4. Konfigurabilni pravni parametri (Podešavanja)

* pravila kvoruma (tip + procenat) po tipu odluke;
* pravila većine (od glasalih / od prisutnih / od ukupne baze) + procenat;
* metoda težine glasa (skupština: uvijek „jedan etažni vlasnik — jedan glas”; odbor: po članu);
* trajanje elektronskog glasanja i rok važenja linkova;
* prag i ovlašćenja za hitne radove;
* rokovi čuvanja (finansije, podaci o glasanju — najmanje 5 godina / 1826 dana, logovi);
* format broja fakture i dokumenata;
* dan dospijeća fakture;
* metoda zaokruživanja (podrazumijevano: polovina naviše, 2 decimale, KM);
* preporučeni broj članova upravnog odbora (podrazumijevano: 3; nije obavezan, samo upozorenje);
* trajanje mandata upravnog odbora u godinama (podrazumijevano: 4).

*Uklonjeno 2026-10-26:* zatezna kamata (ne postoji) i „predsjednik ZEV vodi i upravni odbor” (utvrđena činjenica,
fiksno „da” u kodu).

## 5. Finansijske pretpostavke

1. **Valuta:** BAM (konvertibilna marka, oznaka „KM"), 2 decimale. Sva aritmetika u `Decimal`
   (PostgreSQL `numeric`), nikada binarni floating-point.
2. **Ovo nije zakonsko knjigovodstvo.** Nema dvojnog knjigovodstva, kontnog plana, glavne knjige,
   obračunskih perioda ni finansijskih izvještaja po MRS/MSFI. Zakonske poslovne knjige ZEV vodi
   eksterno. Aplikacija je operativna evidencija: stanje računa, prihodi, rashodi, zaduženja,
   uplate, dugovi, obaveze prema dobavljačima, plan vs. realizacija. **[RAČUNOVODSTVENA PROVJERA]**
3. **Saldo vlasnika** = početno stanje + izdata zaduženja − alocirane uplate ± evidentirane korekcije.
   Preplate i avansi stoje kao nealocirani iznosi ili pretplata na kartici vlasnika.
4. **Dug ostaje na vlasniku, a ne na jedinici** (odluka 2026-10-26, korisnik). Poslije promjene vlasništva
   raniji vlasnik duguje raniji dug; novi vlasnik ne preuzima istorijski dug automatski. U kodu je to već
   tako: faktura čuva `debtorId` (odgovorni vlasnik u trenutku izdavanja), saldo se računa po licu
   (`ownerBalance`), a sljedeća serija zadužuje novog vlasnika. Prenos duga moguć je samo izričitom,
   auditovanom korekcijom. **ODLUČENO**
5. **Zaokruživanje:** po stavci fakture, polovina naviše na 2 decimale; zbir fakture = zbir
   zaokruženih stavki (bez naknadnog poravnanja razlike). Konfigurabilno po stavci naknade.
6. **Storno i korekcije:** izdata faktura, alocirana uplata i proknjižen trošak nikada se ne brišu;
   ispravke su vidljivi korektivni zapisi (storno faktura, storno alokacije, storno transakcije).
7. **Fond održavanja:** izdvojeno praćenje preko oznake na stavkama naknade i transakcijama;
   nije poseban bankovni račun osim ako se tako ne evidentira. **[RAČUNOVODSTVENA PROVJERA]**
8. **PDV:** ZEV u pravilu nije PDV obveznik za naknade vlasnika; aplikacija ne obračunava PDV.
   **[RAČUNOVODSTVENA PROVJERA]**
9. **Uvoz izvoda:** CSV sa konfigurabilnim mapiranjem kolona; aplikacija predlaže, a čovjek
   potvrđuje uparivanje uplata.

## 7. Organi ZEV — upravni odbor (dopuna, avgust 2026.)

Dodatak uveden na izričit zahtjev korisnika da se u aplikaciji vidi ko je predsjednik, ko su članovi
upravnog odbora, i da se sjednice upravnog odbora mogu organizovati na isti način kao sjednice
skupštine.

1. **Pravni osnov koji je pronađen:** ZOZ RS (Sl. glasnik RS 101/11) i sekundarni izvori (npr. akti
   pojedinačnih ZEV i komunalnih/upravljačkih preduzeća u RS) potvrđuju da ZEV ima **dva organa**:
   **skupštinu** (svi etažni vlasnici) i **upravni odbor** — kolegijalno tijelo koje skupština bira
   iz reda vlasnika radi tekućeg upravljanja između sjednica skupštine. Ovo je već bila polazna
   pretpostavka arhitekture aplikacije (uloga PREDSJEDNIK) i sada je dopunjena eksplicitnim
   modelovanjem upravnog odbora kao kolegijalnog tijela.
2. **Šta NIJE moglo biti potvrđeno iz dostupnih izvora u ovoj sesiji:** tačno trajanje mandata i tačna
   podjela nadležnosti između skupštine i odbora (šta odbor može odlučiti samostalno, a šta mora na
   skupštinu). *Odgovoreno 2026-10-26 (korisnik):* broj članova je preporuka (3, nije obavezan), a predsjednik
   ZEV vodi i upravni odbor i u njemu je jedan od jednakih. Dostupni izvori nisu obuhvatali zvanični prečišćeni tekst zakona, a
   postoje naznake da je tokom 2025. bio u toku proces izmjene propisa o održavanju zgrada u RS —
   što dodatno nalaže da se prije produkcijske upotrebe ovi parametri provjere kod pravnika sa
   važećim, prečišćenim tekstom zakona. **[PRAVNA PROVJERA]**
3. **Implementirano rješenje — sve sporno je konfigurabilno, ništa nije izmišljeno kao fiksno
   pravilo:**
   - Članstvo u upravnom odboru vodi se kroz isti mehanizam mandata sa datumima važenja
     (`OfficeTerm`) kao i predsjednik/računovođa, ali kao **višečlana** funkcija (više aktivnih
     mandata istovremeno), za razliku od predsjednika/računovođe gdje je uvijek tačno jedno lice
     aktivno.
   - Preporučeni broj članova (podrazumijevano 3) i trajanje mandata u godinama (podrazumijevano 4) su
     parametri u Podešavanjima. Broj članova **nije obavezan** (odluka 2026-10-26): aplikacija ne
     sprječava manje/više članova, a stranica Organi ZEV upozorava kad odbor (uz predsjednika) ima
     manje članova od preporučenog. **ODLUČENO** (broj članova); trajanje mandata **[PRAVNA PROVJERA]**
   - Predsjednik ZEV vodi i upravni odbor i u njemu je jedan od jednakih (odluka 2026-10-26, korisnik).
     To je fiksna činjenica u kodu, više nije parametar. Ne mijenja ovlašćenja u aplikaciji. **ODLUČENO**
   - Sjednice upravnog odbora koriste **potpuno isti tok** kao sjednice skupštine (dnevni red,
     prijedlozi, pozivi, elektronsko odobravanje, zapisnik) — razlikuju se samo po organu (`body`:
     skupština/upravni odbor) i po krugu glasača.
   - **Glasanje u upravnom odboru:** birački osnov su isključivo aktivni članovi odbora (plus
     predsjednik, koji po pretpostavci iz tačke iznad predsjedava odborom), po principu „jedan
     član — jedan glas" (metoda težine glasa PER_OWNER), a ne po vlasničkom udjelu — jer odbor
     odlučuje kao tijelo, ne kao skup vlasnika. Ova pretpostavka (jedan-član-jedan-glas umjesto po
     udjelu) treba pravnu potvrdu. **[PRAVNA PROVJERA]**
   - Punomoćje (glasanje preko punomoćnika) **nije podržano** za članove upravnog odbora — mandat u
     odboru se smatra ličnim, neprenosivim ovlašćenjem, za razliku od glasanja na skupštini gdje je
     punomoćje uobičajeno. **[PRAVNA PROVJERA]**
   - Računovođa **nije** automatski član ili glasač upravnog odbora (osim ako nije i vlasnik/član
     odbora po posebnom mandatu) — obje funkcije su odvojeno evidentirane.
   - Postavljanje i okončavanje mandata predsjednika, računovođe i članova upravnog odbora, kao i
     sazivanje sjednica upravnog odbora, ograničeno je na ulogu PREDSJEDNIK — isto ograničenje kao i
     za sjednice skupštine.
4. **Stranica „Organi ZEV"** (`/organi`) vidljiva je svim prijavljenim korisnicima (transparentnost
   sastava organa) i prikazuje: trenutnog predsjednika i računovođu, trenutni sastav upravnog
   odbora, i punu istoriju svih mandata (ko, koja funkcija, od kada do kada, na osnovu čega).

## 8. Stavke za pravnu / računovodstvenu reviziju (zbirno)

Odlučeno 2026-10-26 (korisnik) i zato skinuto sa spiska: K-03b i broj glasova (§3.3), pravna snaga e-izjašnjavanja
(§3.4, funkcionalni alat za dokumentaciju), punomoć bez ovjere (§2), zatezna kamata ne postoji (§3.5), rok
čuvanja podataka o glasanju 5 godina (§3.6), minimalna naknada za održavanje (§2), prenos duga pri prometu
jedinice — dug ostaje na vlasniku (§5.4), broj članova odbora i predsjednik kao jedan od jednakih (§7),
rok poziva 7 dana (§3.10).

Još otvoreno:

1. Kvorum i većine po tipu odluke (§3.1).
2. Preostali rokovi čuvanja (zapisnici, logovi pristupa) i obim metapodataka glasanja (§3.6).
3. Obavezni sadržaj poziva, zapisnika, odluka i prijave u registar (šabloni su uredljivi); obrasci za
   registraciju ZEV dolaze naknadno (§3.9).
4. Tretman fonda održavanja i PDV status (§5.7, §5.8).
5. Trajanje mandata, nadležnosti upravnog odbora i način glasanja u odboru (jedan član — jedan glas), te
   isključenje punomoćja za članove odbora (§7).
