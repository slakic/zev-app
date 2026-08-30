# LEGAL_AND_FINANCIAL_ASSUMPTIONS

Ovaj dokument popisuje pravne izvore, mapiranje članova zakona na funkcionalnosti, otvorena tumačenja,
konfigurabilne pravne parametre i finansijske pretpostavke MVP aplikacije za upravljanje jednom
Zajednicom etažnih vlasnika (ZEV) u Republici Srpskoj.

> **Aplikacija ne garantuje pravnu usklađenost.** Ona modeluje zakonske zahtjeve i čini sporna
> pravila konfigurabilnim. Sve stavke označene **[PRAVNA PROVJERA]** ili **[RAČUNOVODSTVENA PROVJERA]**
> mora pregledati advokat, odnosno računovođa licenciran u Republici Srpskoj.

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
| ZEV kao pravno lice sa registracijom (čl. o osnivanju i registraciji ZEV) | Matični podaci ZEV: naziv, JIB, registarski broj, sjedište, osnivački akti, podaci za prijavu u registar; generisanje dokumenta „Podaci za prijavu u registar" | Tačan sadržaj prijave zavisi od opštinskog obrasca — šablon je uredljiv. **[PRAVNA PROVJERA]** |
| Organi ZEV: skupština, predsjednik i upravni odbor | Uloge PREDSJEDNIK, ČLAN SKUPŠTINE/VLASNIK i ČLAN UPRAVNOG ODBORA; evidencija mandata sa datumima važenja za sve funkcije; stranica „Organi ZEV" prikazuje trenutni sastav i istoriju | Broj članova i trajanje mandata upravnog odbora konfigurabilni — vidi §7. |
| Etažni vlasnici kao članovi skupštine | Članstvo u skupštini izvodi se isključivo iz aktivnih vlasničkih udjela (`OwnershipStake`), nikada iz stanovanja | Stanar/zakupac nema pravo glasa. |
| Odlučivanje skupštine, kvorum i većina | Konfigurabilna pravila kvoruma i većine po prijedlogu + snimak pravila u trenutku otvaranja glasanja | ZOZ RS ne uređuje sve tipove odluka jednoznačno; **podrazumijevana vrijednost** u seed-u: kvorum >50% vlasničkih udjela, obična većina prisutnih po udjelu. **[PRAVNA PROVJERA]** |
| Pismeno izjašnjavanje / glasanje van sjednice | Elektronsko odobravanje sa pojedinačnim linkovima, evidencija papirnih glasova | Zakon iz 2011. ne poznaje elektronsko glasanje; modelovano kao *dokaziva evidencija izjašnjavanja*, ne kao kvalifikovani potpis. **[PRAVNA PROVJERA]** |
| Punomoć za zastupanje vlasnika | `Proxy` sa obimom (sve/sjednica/prijedlog), datumima važenja i referencom na dokument punomoći | Formu punomoći (ovjera) aplikacija ne provjerava — polje napomene. **[PRAVNA PROVJERA]** |
| Zapisnik i odluke skupštine | Generisanje zapisnika i odluka iz podataka o sjednici; finalizovani dokumenti su verzionisani i nepromjenjivi | |
| Obaveza održavanja i naknada za održavanje | Konfigurabilne stavke naknade (redovno održavanje, rezervni fond/fond održavanja…) sa 9 metoda obračuna | Zakonski minimalni iznos naknade, ako je propisan podzakonskim aktom, unosi se ručno kao parametar. **[PRAVNA PROVJERA]** |
| Hitne intervencije | Poseban „hitni put" u toku održavanja uz obavezno evidentiranje razloga, ovlašćenja i naknadne ratifikacije | Prag iznosa za hitne radove konfigurabilan. |
| Upravljanje sredstvima ZEV | Evidencija računa, prihoda, rashoda, fonda održavanja | Nije zakonsko knjigovodstvo — vidi §5. |

*Reference na brojeve članova namjerno su date na nivou oblasti: brojevi članova moraju se potvrditi
prema službenom prečišćenom tekstu ZOZ RS 101/11 prije citiranja u dokumentima.* **[PRAVNA PROVJERA]**

## 3. Nerazjašnjena tumačenja (aplikacija NE izmišlja pravilo)

1. **Kvorum i većina po tipu odluke** (redovno upravljanje vs. raspolaganje vs. kapitalni radovi):
   konfigurabilno po prijedlogu; podrazumijevane vrijednosti su samo seed podaci.
2. **Težina glasa** (po vlasniku / po vlasničkom udjelu / po površini): konfigurabilno; snimak po prijedlogu.
3. **Da li suvlasnici glasaju srazmjerno udjelu ili jedinica ima jedan glas**: MVP računa težinu po
   udjelu suvlasnika; alternativa "jedna jedinica – jedan glas" je podržana izborom metode PER_OWNER
   uz napomenu. **[PRAVNA PROVJERA]**
4. **Pravna snaga elektronskog izjašnjavanja**: evidencija je dokaziva (hash sadržaja, žig vremena,
   identifikacija), ali status prema propisima o e-potpisu mora ocijeniti pravnik. UI označava
   postupak kao „elektronsko odobravanje", ne „elektronski potpis".
5. **Zatezna kamata na dugovanja vlasnika**: NIJE implementirano računanje kamate; postoji samo
   konfigurabilni prekidač (isključen) i polje za ručno unesenu stavku. **[PRAVNA + RAČUNOVODSTVENA PROVJERA]**
6. **Rokovi čuvanja podataka** (zapisnici, glasanje, finansije, logovi pristupa): konfigurabilni
   parametri u Podešavanjima; podrazumijevano 11 godina za finansijske dokumente, 30 dana za IP
   metapodatke glasanja. **[PRAVNA PROVJERA]**
7. **JMBG**: aplikacija namjerno NE evidentira JMBG; identifikacija lica vodi se preko imena,
   kontakta i internog ID-a. Ako registarski organ zahtijeva JMBG u obrascu, unosi se ručno u
   generisani dokument. **[PRAVNA PROVJERA]**
8. **Sastav i mandat upravnog odbora, glasanje u odboru**: vidi detaljno §7 — broj članova,
   trajanje mandata, da li je predsjednik ZEV ujedno i predsjednik odbora, i način odlučivanja
   odbora nisu mogli biti potvrđeni iz dostupnih izvora i implementirani su kao konfigurabilni
   parametri sa razumnim podrazumijevanim vrijednostima. **[PRAVNA PROVJERA]**

## 4. Konfigurabilni pravni parametri (Podešavanja)

* pravila kvoruma (tip + procenat) po tipu odluke;
* pravila većine (od glasalih / od prisutnih / od ukupne baze) + procenat;
* metoda težine glasa (po vlasniku / udjelu / površini);
* trajanje elektronskog glasanja i rok važenja linkova;
* prag i ovlašćenja za hitne radove;
* rokovi čuvanja (finansije, glasanje, IP metapodaci, logovi);
* format broja fakture i dokumenata;
* dan dospijeća fakture;
* metoda zaokruživanja (podrazumijevano: polovina naviše, 2 decimale, KM);
* zatezna kamata (isključena; bez formule);
* broj članova upravnog odbora (podrazumijevano: 3);
* trajanje mandata upravnog odbora u godinama (podrazumijevano: 4);
* da li je predsjednik ZEV ujedno i predsjednik upravnog odbora (podrazumijevano: da).

## 5. Finansijske pretpostavke

1. **Valuta:** BAM (konvertibilna marka, oznaka „KM"), 2 decimale. Sva aritmetika u `Decimal`
   (PostgreSQL `numeric`), nikada binarni floating-point.
2. **Ovo nije zakonsko knjigovodstvo.** Nema dvojnog knjigovodstva, kontnog plana, glavne knjige,
   obračunskih perioda ni finansijskih izvještaja po MRS/MSFI. Zakonske poslovne knjige ZEV vodi
   eksterno. Aplikacija je operativna evidencija: stanje računa, prihodi, rashodi, zaduženja,
   uplate, dugovi, obaveze prema dobavljačima, plan vs. realizacija. **[RAČUNOVODSTVENA PROVJERA]**
3. **Saldo vlasnika** = početno stanje + izdata zaduženja − alocirane uplate ± evidentirane korekcije.
   Preplate i avansi stoje kao nealocirani iznosi ili pretplata na kartici vlasnika.
4. **Promjena vlasništva ne prenosi istorijski dug** automatski na novog vlasnika; dug ostaje na
   pravno odgovornoj strani. Prenos duga moguć je samo izričitom, auditovanom korekcijom.
   **[PRAVNA PROVJERA]** (ugovorni odnosi kupca i prodavca).
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
2. **Šta NIJE moglo biti potvrđeno iz dostupnih izvora u ovoj sesiji:** tačan broj članova upravnog
   odbora, tačno trajanje mandata, tačna podjela nadležnosti između skupštine i odbora (šta odbor
   može odlučiti samostalno, a šta mora na skupštinu), i da li je predsjednik ZEV po zakonu ujedno i
   predsjednik upravnog odbora. Dostupni izvori nisu obuhvatali zvanični prečišćeni tekst zakona, a
   postoje naznake da je tokom 2025. bio u toku proces izmjene propisa o održavanju zgrada u RS —
   što dodatno nalaže da se prije produkcijske upotrebe ovi parametri provjere kod pravnika sa
   važećim, prečišćenim tekstom zakona. **[PRAVNA PROVJERA]**
3. **Implementirano rješenje — sve sporno je konfigurabilno, ništa nije izmišljeno kao fiksno
   pravilo:**
   - Članstvo u upravnom odboru vodi se kroz isti mehanizam mandata sa datumima važenja
     (`OfficeTerm`) kao i predsjednik/računovođa, ali kao **višečlana** funkcija (više aktivnih
     mandata istovremeno), za razliku od predsjednika/računovođe gdje je uvijek tačno jedno lice
     aktivno.
   - Broj članova (podrazumijevano 3) i trajanje mandata u godinama (podrazumijevano 4) su
     parametri u Podešavanjima — aplikacija ih ne provjerava (ne sprječava manje/više članova),
     samo ih prikazuje kao preporuku dok se pravno ne potvrde. **[PRAVNA PROVJERA]**
   - Pretpostavka da je predsjednik ZEV ujedno i predsjednik upravnog odbora je takođe
     konfigurabilna (prekidač, podrazumijevano uključen) i samo informativno prikazana — ne mijenja
     ovlašćenja u aplikaciji. **[PRAVNA PROVJERA]**
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

1. Kvorum, većine i težina glasa po tipu odluke (§3.1–3.3).
2. Pravna snaga elektronskog odobravanja i uslovi identifikacije (§3.4).
3. Zatezna kamata (§3.5).
4. Rokovi čuvanja i obim metapodataka glasanja (§3.6).
5. Obavezni sadržaj poziva, zapisnika, odluka i prijave u registar (šabloni su uredljivi).
6. Minimalna naknada za održavanje, ako je propisana (§2).
7. Tretman fonda održavanja i PDV status (§5.7, §5.8).
8. Prenos duga pri prometu jedinice (§5.4).
9. Broj članova, trajanje mandata i nadležnosti upravnog odbora; da li je predsjednik ZEV ujedno i
   predsjednik odbora; način glasanja u odboru (jedan član — jedan glas) i isključenje punomoćja za
   članove odbora (§7).
