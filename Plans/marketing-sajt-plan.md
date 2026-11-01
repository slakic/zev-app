# Marketinški sajt ZEV upravnika — plan, sadržaj i mockupi

**Status: PLAN, čeka odluke korisnika (2026-11-01). Implementacija nije počela.** Nastalo na
zahtjev korisnika: prezentaciona, marketinški orijentisana web stranica za ZEV upravnik koja se
može dijeliti na društvenim mrežama i u promotivnim aktivnostima, design-rich, sa osnovnim
funkcijama i komercijalnim paketima.

Zasnovano na stvarnom stanju aplikacije v2.64.1: `public/korisnicko-uputstvo.html` (najpotpuniji
opis funkcija), `CHANGELOG.md`, `Plans/*.md`, `src/lib/i18n/sr-Latn.ts`, `prisma/schema.prisma`
(`ZevTier`), `src/app/admin/**` (nazivi paketa) i `src/app/globals.css` (`@theme`). **Nijedna
funkcija u sadržaju nije izmišljena**: svaka tvrdnja ima izvor u uputstvu ili kodu (§4.9 navodi i
ono što je namjerno izostavljeno jer nije spremno za prodaju).

Mockupi: `Plans/design-review/mockups/M-M01-pocetna.html` … `M-M05-og-slike.html` (§11).

---

## 0. Rezime — pročitati prije ostatka

**1. Sajt je zaseban projekat, ne ruta u aplikaciji.** Preporuka je statički sajt (Astro) kao
poseban Vercel projekat na `www.zevupravnik.com`, dok aplikacija ostaje na `zevupravnik.com` gdje
je i danas. Tako se ne dira nijedna postojeća adresa (lični linkovi za glasanje, pozivi za novi
ZEV, SMS prijem uplata, adresa MCP servera). Jedina izmjena u aplikaciji je da neprijavljen posjetilac
na `/` ide na marketinški sajt umjesto na `/login` (§7).

**2. Pozicioniranje: „uredna zgrada, sa tragom svake odluke“.** Ne prodajemo „digitalizaciju“ nego
tri konkretne stvari koje predsjednik ZEV-a danas nosi u svesci i na oglasnoj tabli: skupštinu koja
je pravno uredna, novac koji se vidi i kvar koji se ne zaboravi. Diferencijator koji niko lokalno
ne naglašava je **nepromjenjiv trag**: izdata faktura, predat glas i uplata se ne mogu tiho
promijeniti (§2).

**3. Paketi postoje u kodu, ali ih aplikacija još ne sprovodi.** `ZevTier` (BASIC / BASIC_FINANCE /
FULL) je samo oznaka na ZEV-u: „Faza 2 — feature paketi“ iz `docs/multitenancy-plan.md`
(`requireFeature`, sakrivanje stavki menija) nije urađena. ZEV sa paketom Basic danas vidi i
fakture i e-glasanje. **Prije nego što se paketi prodaju po različitim cijenama, Faza 2 mora biti
isporučena** — ili se do tada prodaje samo jedan paket (P3, §12).

**4. Vizuelni identitet sajta polazi od loga, ne od dizajn sistema aplikacije.** Tamnoplava
`#012d55`, petrolej `#008e92` i narandžasta `#f8981c` iz `public/logo-mark.png`, font Archivo sa
promjenljivom širinom. Prikazi aplikacije unutar sajta su, naprotiv, vjerni aplikaciji (Roboto,
slate, plava `#2563eb`), da korisnik poslije prijave prepozna ono što je vidio (§5).

**5. Jedan CTA kroz cijeli sajt: „Zatražite poziv“.** Odgovara stvarnom toku: administrator
platforme šalje lični poziv, klijent sam prolazi čarobnjak i objavljuje ZEV (uputstvo §15). Forma na
sajtu pravi upit, a ne nalog (§8).

---

## 1. Ciljevi i publika

### 1.1 Ciljevi sajta

| # | Cilj | Kako se mjeri (§8) |
|---|---|---|
| C1 | Da predsjednik ZEV-a za 30 sekundi shvati šta aplikacija radi i za koga je | dubina skrolovanja Početne do sekcije „Tri uloge“, vrijeme na stranici |
| C2 | Da link podijeljen na Facebooku, Viberu, WhatsAppu i LinkedInu izgleda profesionalno i jasno | OG kartica po stranici; posjete sa `utm_source` |
| C3 | Da posjetilac zatraži poziv (prikaz aplikacije / otvaranje ZEV-a) | broj poslatih formi; stopa konverzije CTA klik → forma poslata |
| C4 | Da sajt bude referenca koju predsjednik pokaže upravnom odboru ili skupštini prije odluke | posjete stranici „Paketi“ i „Funkcije“ sa istog uređaja više puta |
| C5 | Da postojeći korisnici nađu prijavu i uputstvo | klikovi na „Prijava“ |

### 1.2 Publika

| Publika | Ko je | Šta je muči (iz uputstva i planova) | Šta treba da vidi prvo |
|---|---|---|---|
| **Predsjednik ZEV-a** (primarna) | Volonter ili plaćeni predsjednik zajednice, često penzioner ili zaposlen; odgovoran skupštini i zakonu | Sjednice, pozivi, kvorum, zapisnik; ko je platio; kvar lifta u ponoć; „ko je to odobrio“ | Skupština od poziva do zapisnika; hitni put; ništa se ne briše |
| **Profesionalni upravnik / računovođa** (sekundarna, najveća vrijednost) | Vodi finansije jednog ili više ZEV-ova | Prepisivanje izvoda, uparivanje uplata, serije faktura, izvještaji za skupštinu | Uvoz izvoda i prijedlozi uparivanja; SMS banke; više ZEV-ova sa jednim nalogom |
| **Etažni vlasnik** (utiče na odluku na skupštini) | Svaki vlasnik stana, lokala, garaže | „Koliko dugujem“, „kako da platim“, „šta je odlučeno“, „da li je iko prijavio kvar“ | Glasanje bez prijave, preko ličnog linka; svoje fakture i uplate; prijava kvara |
| **Upravni odbor / skupština** (onaj ko odobrava trošak) | Članovi koji glasaju o usvajanju alata | Cijena, sigurnost podataka, ko šta vidi | Paketi; „ko vidi moje podatke“; vlasnik nikad ne vidi tuđi glas |

Geografija: aplikacija je danas pravljena za **Republiku Srpsku** (uputstvo §1.1: „zajednice
etažnih vlasnika (ZEV) u Republici Srpskoj“; §5 se poziva na Zakon o održavanju zgrada RS). Sajt
govori tako; širenje na FBiH/Brčko je otvoreno pitanje (P8).

---

## 2. Poruka i pozicioniranje

**Jedna rečenica:** ZEV upravnik vodi zajednicu etažnih vlasnika na jednom mjestu — skupštinu i
glasanje, fakture i uplate, kvarove i dokumente — tako da svaka odluka i svaka marka ostavi trag.

**Kategorija:** aplikacija za upravljanje zajednicom etažnih vlasnika (ne „softver za upravnike
zgrada“ uopšteno, ne knjigovodstveni program).

**Tri stuba poruke** (svaki ima dokaz u aplikaciji):

| Stub | Obećanje | Dokaz (izvor) |
|---|---|---|
| **Skupština koja drži vodu** | Od poziva do potpisanog zapisnika, sa kvorumom i većinom koje aplikacija računa | statusi sjednice (§6.4), pravila glasanja (§6.2), e-listić sa verifikacionim kodom (§6.10), sjednica uživo (§6.9), zapisnik iz bilješki (§6.13) |
| **Novac koji se vidi** | Vlasnik zna koliko duguje, uprava zna ko je platio, bez prepisivanja izvoda | serija faktura sa obračunom po jedinici (§7.2), PDF fakture sa QR kodom (CHANGELOG), uvoz PDF/CSV izvoda i prijedlozi uparivanja (§7.6–7.7), SMS banke (§7.9), izvještaji i izvoz za računovođu (§12) |
| **Ništa se ne briše tiho** | Greška se ispravlja novim zapisom uz razlog; original ostaje vidljiv | §1.1, storno/korekcija (§7.4), glas se ne mijenja (§6.7, §6.10), tehnički otisak teksta (§6.6), revizorski trag (§13.6), registar sa dokazom o vlasništvu (§15.4–15.5) |

**Ton:** smiren, konkretan, domaći. Riječi iz svijeta korisnika: *sjednica, poziv, kvorum,
zapisnik, odluka, posebni dio, udio, faktura, poziv na broj, izvod, kvar, radni nalog*. Bez
anglicizama („dashboard“, „workflow“, „digitalna transformacija“) i bez superlativa. Obraćanje sa
„Vi“ velikim slovom, kao u aplikaciji.

**Šta ne tvrdimo** (pravna i poslovna sigurnost):
- da je aplikacija „usklađena sa zakonom“ — aplikacija sama kaže da „zakonski kvorum i većine po
  tipu odluke potvrđuje pravnik prije produkcijske upotrebe“ (§6.2). Govorimo: „organi i sjednice
  onako kako ih poznaje Zakon o održavanju zgrada RS“ (P7);
- da je elektronski glas kvalifikovani elektronski potpis — nije (§6.10, dno listića);
- da je ovo knjigovodstvo — nije (§1.1, napomena); to kažemo otvoreno, kao prednost jasnoće;
- broj korisnika, zgrada ili ušteda vremena — nemamo podatke.

---

## 3. Informaciona arhitektura

### 3.1 Stranice

| Stranica | Adresa | Mockup | Svrha |
|---|---|---|---|
| Početna | `/` | M-M01 | Priča od oglasne table do aplikacije; tri stuba; tri uloge; paketi ukratko; CTA |
| Funkcije | `/funkcije` | M-M02 | Moduli jedan po jedan, sa oznakom paketa; referenca za upravni odbor |
| Paketi | `/paketi` | M-M03 | Tri paketa, tabela poređenja, česta pitanja |
| Zatražite poziv | `/poziv` | M-M04 | Forma za upit + „šta se dešava poslije“ |
| Pravne napomene | `/privatnost`, `/uslovi` | — | Obrada podataka iz forme, analitika bez kolačića; uslovi korištenja (tekst daje korisnik/pravnik, P9) |
| Korisničko uputstvo | veza na `zevupravnik.com/korisnicko-uputstvo.html` | — | Postoji; ne duplira se |
| Prijava | veza na `zevupravnik.com/login` | — | Postoji |

Kasnije (nije u prvoj isporuci): `/skupstina`, `/finansije`, `/odrzavanje` kao odredišne
stranice za pojedinačne kampanje (svaka sa svojom OG slikom iz M-M05); `/za-upravnike` za
profesionalne upravnike sa više ZEV-ova.

### 3.2 Sekcije Početne (M-M01)

1. **Zaglavlje** — logo, Funkcije · Paketi · Kako počinje · Prijava, dugme „Zatražite poziv“.
2. **Hero** — naslov, podnaslov, CTA; desno fasada zgrade čiji se prozori pale kako vlasnici glasaju
   (jedini animirani trenutak na sajtu), uz karticu sa rezultatom glasanja.
3. **Od oglasne table do aplikacije** — tri papira sa oglasne table naspram onoga što aplikacija radi.
4. **Tri uloge** — predsjednik, računovođa, vlasnik.
5. **Skupština** (stub 1) — tok sjednice kao stvarni niz koraka + e-listić na telefonu.
6. **Novac** (stub 2) — prikaz uparivanja uplata + četiri činjenice.
7. **Održavanje** — tok prijave kvara + hitni put.
8. **Ništa se ne briše tiho** (stub 3) — izjava + odlomak revizorskog traga.
9. **Kako počinje** — poziv → čarobnjak (10 koraka) → uvoz iz fajla → objava.
10. **Paketi ukratko** — tri kolone, veza na `/paketi`.
11. **Završni CTA** + podnožje.

### 3.3 Funkcije (M-M02)

Lijevo ljepljivi indeks modula (na telefonu vodoravna traka), desno sekcije: Zgrade i posebni
dijelovi · Vlasnici i vlasništvo · Organi ZEV-a · Skupština i odluke · Elektronsko glasanje ·
Sjednica uživo · Fakture i uplate · Izvodi i SMS banke · Troškovi · Planovi · Održavanje ·
Dokumenti · Izvještaji · Evidencije i trag · Novi ZEV (čarobnjak i uvoz). Svaka sekcija nosi oznaku
paketa u kojem je dostupna.

### 3.4 Paketi (M-M03) i Zatražite poziv (M-M04)

Paketi: tri kolone → tabela poređenja → „Šta je isto u svim paketima“ → česta pitanja → CTA.
Poziv: forma lijevo, desno „Šta se dešava poslije“ (četiri koraka) i kontakt; stanje „poslato“.

---

## 4. Marketinški sadržaj (sr-Latn, ijekavica)

Sav tekst je izveden iz uputstva i koda; u zagradama je izvor. Tekst se u mockupima koristi
doslovno. Uglaste zagrade `[…]` su placeholderi koje popunjava korisnik.

### 4.1 Globalno

- **Naziv:** ZEV upravnik
- **Slogan (kratki):** Zgrada u redu.
- **Opis (meta, ≤155 znakova):** Aplikacija za zajednice etažnih vlasnika: skupština i e-glasanje,
  fakture i uplate, kvarovi i dokumenti — na jednom mjestu, sa tragom svake odluke.
- **Navigacija:** Funkcije · Paketi · Kako počinje · Prijava · **Zatražite poziv**
- **Podnožje:** „ZEV upravnik — aplikacija za upravljanje zajednicom etažnih vlasnika u Republici
  Srpskoj.“ · Korisničko uputstvo · Prijava · Privatnost · Uslovi · Kontakt: [e-adresa],
  [telefon] · © 2026 [pravno lice].

### 4.2 Početna

**Hero**
- Naslov: **Zgrada u redu.**
- Podnaslov: Skupština i glasanje, fakture i uplate, kvarovi i dokumenti zajednice etažnih
  vlasnika — na jednom mjestu, sa telefona i računara. Svaka odluka i svaka uplata ostavljaju trag.
- CTA: **Zatražite poziv** · sekundarno: Pogledajte funkcije
- Kartica uz fasadu: „Zamjena krovnog pokrivača — glasalo 18 od 24 · Kvorum postignut · Za 71,4 %“
  (primjer; rezultat kakav aplikacija prikazuje u §6.6).
- Ispod: „Za zajednice etažnih vlasnika u Republici Srpskoj. Predsjednik, računovođa i vlasnici —
  svako vidi svoje.“

**Od oglasne table do aplikacije**
- Naslov: Sve što je visilo na oglasnoj tabli, sada ima rok, status i trag.
- Papir 1 „Poziv na sjednicu skupštine, četvrtak u 19 h“ → Poziv nastaje kao PDF i stiže svakom
  vlasniku e-poštom. Status sjednice pokazuje šta je sljedeći korak. (§6.4)
- Papir 2 „Molimo vlasnike koji nisu platili…“ → Svaki vlasnik u aplikaciji vidi svoje fakture,
  uplate i saldo. Niko ne vidi tuđe. (§2.2, §7.8)
- Papir 3 „Lift ne radi — javite predsjedniku“ → Kvar prijavi bilo ko, a tok od prijave do plaćenog
  izvođača vidi se korak po korak. (§10)

**Tri uloge** (§1.2)
- *Predsjednik ZEV-a* — Zakazuje sjednice, otvara i zatvara glasanje, evidentira odluke, vodi
  održavanje i objavljuje dokumente vlasnicima. Početna mu pokazuje šta čeka: otvorena glasanja,
  predstojeće sjednice, otvorene kvarove, neraspoređene uplate.
- *Računovođa* — Stavke naknada, serije faktura, uplate, izvodi banke, troškovi i izvještaji.
  Može pomagati u vođenju sjednice uživo. Sa jednim nalogom radi za više ZEV-ova. (§1.6)
- *Vlasnik* — Vidi svoje fakture, uplate i saldo, glasa preko ličnog linka iz e-pošte, prijavljuje
  kvarove i čita objavljene odluke. Na vrhu mu piše šta čeka na njega: „Za Vas sada“. (§2.2)

**Skupština** (§6)
- Naslov: Sjednica od poziva do zapisnika.
- Uvod: Aplikacija vodi sjednicu kroz sve korake i u svakom trenutku kaže šta je sljedeće. Kvorum i
  većinu računa po pravilu koje sami podesite: po vlasničkom udjelu, po vlasniku ili po površini.
- Koraci (stvarni niz statusa, §6.4, skraćen za prikaz): Zakazana → Pozivi poslati → Glasanje
  otvoreno → Glasanje zatvoreno → Odluka evidentirana → Zapisnik finalizovan.
- Činjenice:
  - **Glasanje bez prijave.** Vlasnik dobija lični link i verifikacioni kod e-poštom i glasa sa
    telefona za sve prijedloge sjednice odjednom. (§6.10)
  - **Tekst se ne mijenja ispod glasača.** Kad se glasanje otvori, tekst prijedloga i pravilo
    glasanja se zamrzavaju, a tehnički otisak dokazuje da tekst nije mijenjan. (§6.6–6.7)
  - **Sala i e-pošta zajedno.** Na sjednici uživo vodite prozivku sa telefona, unosite glasove iz
    sale, a odsutni sa saglasnošću glasaju elektronski. (§6.9)
  - **Zapisnik se ne prepisuje.** Bilješke i zaključci uz tačke dnevnog reda ulaze pravo u nacrt i
    konačni zapisnik (PDF). (§6.13)
- E-listić na telefonu (mockup): „Redovna godišnja sjednica 2026. · Glasate jednom, kao etažni
  vlasnik: Stan 12 · P-2026-03 Usvajanje godišnjeg plana održavanja 2027. · Za (odobravam) /
  Protiv (odbijam) / Uzdržan/a · Izabrano 2 od 3 · Verifikacioni kod · Pregledaj i potvrdi“.

**Novac** (§7, §12)
- Naslov: Ko je platio, vidi se bez prepisivanja izvoda.
- Uvod: Računovođa izdaje fakture u serijama, a aplikacija za svaku jedinicu pokazuje kako je iznos
  izračunat — prije izdavanja.
- Činjenice:
  - **Obračun koji se može provjeriti.** Po m², po udjelu, po broju korisnika, fiksno ili ručno —
    na fakturi piše osnov, npr. „54,50 m² × 0,35 KM/m²“. (§7.1, CHANGELOG)
  - **PDF faktura sa QR kodom** za preostali iznos, i e-mail vlasniku bez iznosa u poruci. (§7.2,
    CHANGELOG)
  - **Izvod banke za minut.** Uvezite PDF ili CSV izvod, provjerite stavke i potvrdite. Aplikacija
    predlaže fakturu i kaže zašto: poziv na broj, isti platilac, broj stana u svrsi uplate. (§7.6–7.7)
  - **SMS banke kao rani signal.** Obavještenja banke sa telefona stižu u aplikaciju i čekaju
    potvrdu; ništa se ne knjiži samo. (§7.9)
  - **Izvještaji za skupštinu i računovođu:** dugovanja po vlasnicima, stanje računa, fond
    održavanja, starosna struktura dugova — PDF i CSV. (§12)

**Održavanje** (§10)
- Naslov: Kvar se prijavi jednom i ne zaboravi.
- Uvod: Svaki korisnik prijavljuje kvar sa telefona. Predsjednik ga vodi od trijaže preko ponuda
  izvođača i radnog naloga do primopredaje i plaćanja.
- Tok (stvarni niz, skraćen): Prijavljen → Odobren → Izvođač izabran → U toku → Provjereno → Plaćeno.
- **Hitni put:** pukla cijev ne čeka sjednicu. Hitna intervencija preskače odobrenje, ali traži ko
  je odobrio i na osnovu čega — a kasnije i potvrdu upravnog odbora ili skupštine. (§10.5)

**Ništa se ne briše tiho** (§1.1)
- Naslov: Ništa se ne briše tiho.
- Tekst: Izdata faktura, predat glas i evidentirana uplata ne mogu se promijeniti ni obrisati.
  Greška se ispravlja novim zapisom — korekcijom ili stornom — uz obavezan razlog, a original ostaje
  vidljiv. Revizorski trag bilježi svaku bitnu radnju: ko, kada, šta i zašto.
- Tri kratke tvrdnje: Vlasnik nikad ne vidi kako su glasali drugi. (§6.11) · Nema vlasničkog
  udjela bez dokaza o vlasništvu. (§15.5) · E-mail poruke ne sadrže salda — vode na prijavu. (§13.4)

**Kako počinje** (§15)
- Naslov: Vaš ZEV u aplikaciji — bez čekanja na nas.
- Koraci (stvarni niz): 1. **Zatražite poziv** — dobijate lični link (važi 14 dana). 2. **Unesite
  podatke u čarobnjaku** — deset koraka, od podataka o ZEV-u do vlasnika; sve se čuva, možete
  nastaviti kasnije. 3. **Imate spisak u tabeli?** Uvezite posebne dijelove i vlasnike iz CSV ili
  JSON fajla — ili zamolite AI asistenta da ga napravi iz etažnog elaborata. 4. **Objavite ZEV** —
  postajete predsjednik, a računovođa se može prijaviti odmah.

**Paketi ukratko** — vidi §4.4 (kratke verzije).

**Završni CTA**
- Naslov: Pokažite zgradi kako izgleda uredno.
- Tekst: Zatražite poziv. Javićemo se, pokazati aplikaciju na primjeru i poslati Vam lični link za
  otvaranje ZEV-a.
- Dugme: Zatražite poziv

### 4.3 Funkcije — tekst po modulu

| Modul | Paket | Tekst (uvod + 2–4 tačke) | Izvor |
|---|---|---|---|
| Zgrade i posebni dijelovi | svi | Zgrade, ulazi, stanovi, poslovni prostori, garaže i zajednički dijelovi (lift, krov, kotlovnica). • Zbir udjela se provjerava: mora biti 100 %. • Površina, udio, broj korisnika i koeficijent tipa su osnov obračuna i težine glasa. | §3 |
| Vlasnici i vlasništvo | svi | Fizička i pravna lica, suvlasnici, stanari, zakupci i punomoćnici. • Prenos vlasništva sa datumom i ugovorom. • Nema udjela bez dokaza o vlasništvu. • Kartica vlasnika (PDF). | §4, §15.5 |
| Organi ZEV-a | svi | Predsjednik, računovođa i upravni odbor, sa mandatima i osnovom. • Istorija mandata se vodi sama. | §5 |
| Skupština i odluke | svi | Sjednice skupštine i upravnog odbora, dnevni red, prijedlozi, pravila glasanja. • Kvorum i većina po udjelu, vlasniku ili površini. • Papirni i lični glasovi. • Odluka i zapisnik kao PDF. | §6.1–6.7 |
| Sjednica uživo | svi | Poseban ekran za salu, sa telefona ili tableta. • Prozivka. • Glasovi iz sale jednim dodirom. • Bilješke i zaključci po tačkama ulaze u zapisnik. | §6.9, §6.13 |
| Elektronsko glasanje | Full | Lični link i verifikacioni kod e-poštom, bez prijave. • Jedan listić za sve prijedloge sjednice. • Potvrda izjašnjavanja sa brojem. • Saglasnost vlasnika za e-glasanje se evidentira. | §6.10, §4.6 |
| Fakture i uplate | + finansije | Stavke naknada sa devet metoda obračuna. • Serija faktura sa pregledom obračuna prije izdavanja. • PDF sa QR kodom. • Korekcija i storno uz razlog. | §7.1–7.5 |
| Izvodi i SMS banke | + finansije | Uvoz PDF i CSV izvoda sa pregledom prije upisa. • Prijedlozi uparivanja sa razlogom. • SMS obavještenja banke sa iPhone-a, uz potvrdu računovođe. | §7.6–7.9 |
| Troškovi | + finansije | Dobavljači i ulazne fakture, plaćanje, upozorenje na mogući duplikat. • Veza sa stavkom godišnjeg plana i projektom. | §8 |
| Planovi | + finansije | Godišnji plan održavanja i finansijski plan, verzionisano. • Plan se usvaja samo uz usvojen prijedlog skupštine. • Plan naspram realizacije. | §9 |
| Održavanje | svi | Prijava kvara za sve. • Ponude izvođača, radni nalog (PDF), primopredaja. • Hitni put sa naknadnom ratifikacijom. | §10 |
| Dokumenti | svi | Svi PDF-ovi na jednom mjestu: pozivi, zapisnici, odluke, planovi, fakture, radni nalozi. • Objava vlasnicima jednim klikom. • Skenirana dokumentacija po kategorijama. | §11 |
| Izvještaji | + finansije | Dugovanja po vlasnicima na dan, stanje računa i tok novca, fond održavanja, neplaćene fakture po starosti, pregled po zgradama i projektima. • PDF i CSV. | §12 |
| Evidencije i trag | svi | Poslate poruke sa statusom isporuke. • Aktivnosti zajednice čitljivim jezikom. • Revizorski trag koji se ne može mijenjati. | §13.4–13.6 |
| Novi ZEV | svi | Čarobnjak u deset koraka, nacrt se čuva. • Uvoz iz CSV/JSON fajla. • Registar posebnih dijelova se utvrđuje prije upisa vlasnika. | §15 |

Napomena za „Planovi“ i „Izvještaji“: dodjela paketu slijedi komentar uz `ZevTier`
(`BASIC_FINANCE: + fakturisanje, uplate, troškovi, planovi, finansijski izvještaji`). Plan
održavanja bez finansija u Basic paketu je otvoreno pitanje (P4).

### 4.4 Paketi

Izvor: `prisma/schema.prisma` (`enum ZevTier`, komentari) i oznake u `src/app/admin/page.tsx`
(„Basic“, „Basic + finansije“, „Full (+ e-glasanje)“). Svaki paket je nadskup prethodnog.

| | **Basic** | **Basic + finansije** | **Full** |
|---|---|---|---|
| Marketinški naziv (prijedlog, P2) | Uprava | Uprava i finansije | Kompletno |
| Za koga | ZEV kome treba uredna evidencija i skupština, a finansije vodi drugdje | ZEV koji fakturiše vlasnicima i prati uplate i troškove | ZEV koji želi da vlasnici glasaju i od kuće |
| Kratko | Zgrade, vlasnici, organi, skupština i odluke, sjednica uživo, održavanje, dokumenti | Sve iz Basic + fakture, uplate, izvodi i SMS banke, troškovi, planovi, finansijski izvještaji | Sve iz Basic + finansije + elektronsko glasanje ličnim linkom |
| Cijena | **[cijena] KM / mjesečno** (P1) | **[cijena] KM / mjesečno** | **[cijena] KM / mjesečno** |
| Napomena | Korak „Računi“ u čarobnjaku je opcioni (D7 onboarding plana) | Bankovni račun je obavezan pri otvaranju | — |

**Šta je isto u svim paketima:** nalozi za predsjednika, računovođu i sve vlasnike; prijava sa
telefona i računara; korisničko uputstvo; čarobnjak i uvoz iz fajla; revizorski trag; PDF
dokumenti; e-pošta vlasnicima.

**Česta pitanja** (svaki odgovor ima izvor):
1. *Treba li nešto instalirati?* Ne. ZEV upravnik radi u pregledaču, na računaru i telefonu. (§1.3, §1.5)
2. *Šta ako vlasnik nema e-mail?* Glasa na papiru ili lično na sjednici; predsjednik unosi taj glas. (§6.7, §6.11)
3. *Može li neko promijeniti glas ili fakturu poslije?* Ne. Ispravka je novi zapis uz razlog, a original ostaje vidljiv. (§1.1, §6.7)
4. *Ko vidi moje podatke?* Vlasnik vidi samo svoje fakture, uplate i prijave. Lične podatke drugih vide predsjednik i računovođa. Kako je ko glasao ne vidi niko od vlasnika. (§4, §6.11, §13.5)
5. *Je li ovo knjigovodstveni program?* Ne. ZEV upravnik je operativna evidencija; podatke za knjigovođu izvozite iz Izvještaja (CSV). (§1.1)
6. *Imamo spisak stanova u Excelu. Moramo li sve prekucati?* Ne. Posebne dijelove i vlasnike uvezite iz CSV fajla; vlasnički udio postaje važeći kad priložite dokaz. (§15.9)
7. *Računovođa radi za više zgrada?* Jedan nalog, više ZEV-ova; podaci se nikad ne miješaju. (§1.6)
8. *Koliko košta?* [odgovor kad su cijene poznate, P1]

### 4.5 Zatražite poziv

- Naslov: Zatražite poziv.
- Uvod: Ostavite podatke i javićemo Vam se da pokažemo aplikaciju i dogovorimo otvaranje Vašeg ZEV-a.
- Polja: Ime i prezime* · E-adresa* · Telefon · Naziv ZEV-a ili adresa zgrade* · Broj posebnih
  dijelova (stanova, lokala, garaža) · Vi ste: Predsjednik ZEV-a / Član upravnog odbora / Upravnik
  ili računovođa / Vlasnik · Paket koji Vas zanima: Basic / Basic + finansije / Full / Još ne znam ·
  Poruka · ☐ Saglasan/na sam da se moji podaci koriste da bi mi se odgovorilo na upit. (veza na
  Privatnost)
- Dugme: **Pošalji upit**
- Poslije slanja: „Upit je poslat. Javićemo Vam se na [e-adresa] u roku od [rok].“
- Greška: „Upit nije poslat jer nedostaje e-adresa.“ / „Upit nije poslat. Pokušajte ponovo ili
  pišite na [e-adresa].“
- „Šta se dešava poslije“: 1. Javimo se i dogovorimo kratak prikaz aplikacije. 2. Šaljemo Vam lični
  poziv e-poštom; link važi 14 dana. 3. Vi u čarobnjaku unosite podatke o ZEV-u ili ih uvozite iz
  fajla. 4. Objavite ZEV i otvarate naloge vlasnicima. (Korak 1 je poslovni proces korisnika —
  potvrditi, P6; koraci 2–4 su §15.)

### 4.6 Naslovi i opisi za dijeljenje (OG)

| Stranica | `<title>` (≤60) | `og:title` | `og:description` (≤155) | OG slika (M-M05) |
|---|---|---|---|---|
| Početna | ZEV upravnik — zgrada u redu | Zgrada u redu. | Skupština i e-glasanje, fakture i uplate, kvarovi i dokumenti zajednice etažnih vlasnika — na jednom mjestu. | `og-pocetna.png` (fasada) |
| Funkcije | Funkcije — ZEV upravnik | Šta sve vodi ZEV upravnik | Od registra posebnih dijelova do zapisnika: svi moduli aplikacije za zajednice etažnih vlasnika. | `og-skupstina.png` |
| Paketi | Paketi — ZEV upravnik | Tri paketa za Vašu zgradu | Basic, Basic + finansije i Full: izaberite koliko ZEV upravnik vodi umjesto sveske i tabele. | `og-paketi.png` |
| Poziv | Zatražite poziv — ZEV upravnik | Otvorite ZEV u aplikaciji | Ostavite podatke i dobićete lični poziv za otvaranje Vašeg ZEV-a. | `og-pocetna.png` |
| Kampanja „glasanje“ | Glasanje bez sale — ZEV upravnik | Vlasnici glasaju sa telefona | Lični link i verifikacioni kod e-poštom, kvorum i većina računaju se sami, zapisnik se ne prepisuje. | `og-skupstina.png` |
| Kampanja „novac“ | Ko je platio — ZEV upravnik | Ko je platio, vidi se bez izvoda | Uvoz izvoda banke, prijedlozi uparivanja i saldo svakog vlasnika na jednom mjestu. | `og-finansije.png` |

### 4.7 Kratki tekstovi za objave (prijedlog)

- „Poziv na sjednicu na oglasnoj tabli, spisak dužnika u svesci, kvar lifta na papiriću. Ili: ZEV
  upravnik. Zgrada u redu. [link]“
- „Vlasnici glasaju sa telefona, kvorum se računa sam, a zapisnik nastaje iz bilješki sa sjednice.
  [link]“
- „Izdata faktura i predat glas se ne mijenjaju tiho. Greška se ispravlja novim zapisom, uz razlog.
  Tako izgleda uprava kojoj se vjeruje. [link]“

### 4.8 Mikrotekst

- Dugmad: „Zatražite poziv“ (primarno, svuda isto), „Pogledajte funkcije“, „Uporedite pakete“,
  „Pošalji upit“, „Prijava“.
- Oznake paketa na funkcijama: „Svi paketi“, „Od paketa Basic + finansije“, „Paket Full“.

### 4.9 Namjerno izostavljeno (postoji u kodu, ali nije za marketing sada)

| Šta | Zašto |
|---|---|
| Viber obavještenja | Provajder je i dalje probni (`VIBER_PROVIDER` = mock; „Viber je za sada probni“) |
| Povezani asistenti (MCP, Claude/ChatGPT čitaju nacrt) | Iza flaga `MCP_ENABLED`; samo čitanje nacrta. Spominjemo samo „asistent može napraviti fajl za uvoz“, što radi bez MCP-a (§15.9 „Kopiraj uputstvo“). Kad flag bude uključen — posebna stranica (P10) |
| Super admin, sesije, platformski dio | Interno |
| Uvoz izvoda za konkretne banke | SMS radi za Nova Banku (§7.9); koje banke PDF parser pouzdano čita treba potvrditi prije imenovanja banaka (P11). Na sajtu: „PDF ili CSV izvod“ |
| Brojke o korisnicima / zgradama | Nemamo podatke |

---

## 5. Vizuelni pravac

### 5.1 Ideja

**Zgrada kao interfejs.** Glavni vizuelni motiv je fasada stambene zgrade — mreža prozora, ulazi,
spratovi — jer je to ono što svaki predsjednik ZEV-a vidi svaki dan, i jer svaki prozor zaista jeste
posebni dio u aplikaciji. U heroju se prozori pale petrolej bojom kako vlasnici glasaju (18 od 24),
a jedan prozor svijetli narandžasto (faktura kasni). To je jedini animirani trenutak na sajtu;
sve ostalo je mirno. Drugi motiv je **oglasna tabla** iz haustora: papiri sa pribadačama kao
„prije“, naspram čistih prikaza aplikacije kao „poslije“.

### 5.2 Boje (tokeni sajta)

| Token | Hex | Izvor | Upotreba |
|---|---|---|---|
| `--navy` | `#012d55` | logo (zgrade, figure) | Hero, tamne sekcije, naslovi na svijetlom |
| `--navy-2` | `#0a3d6b` | izvedeno (+svjetlina) | Ivice i prozori na tamnoj podlozi |
| `--petrol` | `#008e92` | logo (srednja figura) | Akcenti, upaljeni prozori, ikone, oznake paketa |
| `--petrol-ink` | `#00676a` | izvedeno (tamnije) | Petrolej kao tekst na bijelom (kontrast ≥ 5,5:1) |
| `--amber` | `#f8981c` | logo (luk) | **Samo** primarno dugme i jedan signal po prikazu (kasni / hitno) |
| `--plaster` | `#eef3f3` | novo, hladni malter | Podloga svijetlih sekcija (namjerno ne krem) |
| `--paper` | `#ffffff` | — | Kartice, papiri oglasne table |
| `--ink` | `#0d2238` | izvedeno iz navy | Tekst |
| `--muted` | `#4a5d70` | izvedeno | Sekundarni tekst (≥ 6:1 na bijelom) |

Narandžasta na tamnoplavoj je primarno dugme (tekst `--navy`, kontrast ~7:1). Prikazi aplikacije
koriste **tokene aplikacije** iz `globals.css` (slate, `#2563eb`, success/warning/danger) — sajt ih
ne prefarbava.

### 5.3 Tipografija

- **Archivo** (Google Fonts, variable: širina 62–125, težina 100–900, latinica sa š đ č ć ž).
  - Naslovi: širina 72–78 (uska, „visoka kao zgrada“), težina 800, `letter-spacing -0.01em`,
    `line-height 0.95` za hero. Uski rez je tipografski odgovor na motiv fasade.
  - Tekst: širina 100, težina 400, 17–18 px, `line-height 1.6`, dužina reda ≤ 70 znakova.
  - Brojevi u prikazima: `font-variant-numeric: tabular-nums`.
- **Roboto** samo unutar prikaza aplikacije (font aplikacije, `design-system.md` §2).
- Skala (px): 15 · 17 · 20 · 26 · 34 · 48 · 72/104 (hero). Ništa što se čita ispod 13 px.
- Bez verzala za labele i bez „eyebrow“ natpisa iznad svakog naslova; jedini sitni natpisi su
  stvarne oznake (status, paket).

### 5.4 Ilustracije i prikazi aplikacije

- Fasada, prozori, oglasna tabla i ikone: ručno, CSS/inline SVG, u bojama loga; ikone u stilu
  `nav-icons.tsx` (linija 1,75 px, zaobljeni krajevi).
- Prikazi aplikacije: u mockupima su HTML/CSS rekonstrukcije stvarnih ekrana (podaci iz seeda);
  za produkciju **pravi screenshotovi** iz seed baze (Ana Savić, ZEV „…“), u okviru uređaja
  (računar / telefon), 2× rezolucija, WebP + PNG. Lične podatke u seedu provjeriti (izmišljeni).
- Nema stock fotografija ljudi. Fotografija zgrade (P5) moguća samo ako je vlastita i sa dozvolom.

### 5.5 Odnos prema dizajn sistemu aplikacije

`Plans/design-system.md` važi za **aplikaciju**. Sajt namjerno ima bogatiji izraz (vlastita paleta
iz loga, Archivo, ilustracija, veće razmake i tamne sekcije). Preuzima se:
- **pravila kvaliteta**: ništa ispod 13 px; najviše jedno primarno dugme po regiji (na sajtu je to
  uvijek „Zatražite poziv“); vidljiv fokus; mete ≥ 44 px na telefonu; `prefers-reduced-motion`;
- **vjernost prikaza**: kad sajt prikazuje aplikaciju, koristi njene tokene, Roboto, chipove
  statusa i tekstove iz `sr-Latn.ts`, da se obećanje i proizvod ne razilaze;
- **ikone**: konvencija `nav-icons.tsx`.

Kad se sajt implementira, CLAUDE.md treba dopuniti jednom rečenicom: dizajn sistem važi za
`src/`, a marketinški sajt ima svoje tokene opisane u ovom planu (P12).

---

## 6. SEO i dijeljenje na mrežama

- **Meta po stranici** iz §4.6: `<title>`, `meta description`, `og:title`, `og:description`,
  `og:image` (1200×630, PNG, < 300 KB, apsolutna adresa), `og:url`, `og:type=website`,
  `og:locale=sr_RS`, `og:site_name=ZEV upravnik`, `twitter:card=summary_large_image`.
- **Viber i WhatsApp** čitaju OG — u BiH su glavni kanal dijeljenja; Viber agresivno kešira
  pregled, pa se nova OG slika objavljuje pod novim imenom fajla (`og-pocetna-v2.png`).
- **OG slike** (M-M05): četiri šablona — fasada (Početna), e-listić (Skupština), uparivanje
  (Finansije), tri paketa (Paketi). Prave se iz HTML šablona u build koraku (Astro + Satori /
  `@vercel/og`, ili screenshot Playwrightom) da tekst ostane izmjenjiv.
- `lang="sr-Latn"`, `<link rel="canonical">`, `sitemap.xml`, `robots.txt`, favicon i
  `apple-touch-icon` iz `src/app/icon.png`.
- **Strukturirani podaci**: `Organization` i `SoftwareApplication` (JSON-LD; `offers` tek kad su
  cijene poznate).
- **Ključne riječi** (prirodno u tekstu, ne nabrajanjem): zajednica etažnih vlasnika, ZEV, upravnik
  zgrade, skupština etažnih vlasnika, elektronsko glasanje, održavanje zgrade, Republika Srpska,
  Banja Luka [i gradovi po P8].
- Prijava u Google Search Console i Bing Webmaster Tools.
- Performanse: statički HTML, fontovi sa `display=swap` i `preconnect`, slike `loading=lazy`
  ispod prvog ekrana; cilj Lighthouse ≥ 95 na telefonu.

---

## 7. Tehnologija i hosting

### 7.1 Razmotrene opcije

| Opcija | Za | Protiv |
|---|---|---|
| **A. Ruta u postojećoj Next.js aplikaciji** (`src/app/(marketing)`) | Jedan deploy, isti domen, može čitati podatke aplikacije | Svaka izmjena teksta je izdanje aplikacije (CHANGELOG + verzija po projektnoj konvenciji); marketinški vizuelni jezik se miješa sa dizajn sistemom koji CLAUDE.md strogo propisuje; marketinški bundle i fontovi u aplikaciji; `/` je danas početna prijavljenog korisnika |
| **B. Zaseban statički sajt (Astro) na `www.zevupravnik.com`, aplikacija ostaje na `zevupravnik.com`** | Nijedna adresa aplikacije se ne mijenja (lični linkovi za glasanje i pozivi iz već poslatih e-poruka, `/api/uplate/sms` na telefonima, adresa MCP servera, OAuth povratne adrese); nezavisan ritam izmjena; nula JS-a po defaultu; isti Vercel nalog | Dva projekta; neprijavljen posjetilac koji ukuca `zevupravnik.com` mora biti preusmjeren na `www` (jedna mala izmjena u aplikaciji) |
| **C. Zaseban sajt na `zevupravnik.com`, aplikacija seli na `app.zevupravnik.com`** | „Najčistija“ podjela, uobičajena za SaaS | Selidba svih adresa: već poslati lični linkovi i pozivi, SMS automatizacije na iPhone-ima, MCP konektori i OAuth klijenti moraju se preusmjeriti; POST preusmjerenja (SMS, MCP) mnogi klijenti ne prate. Visok rizik za malu korist |
| **D. Gotov graditelj (Webflow, Framer, WordPress)** | Bez koda za izmjene teksta | Mjesečna pretplata, tuđi hosting i kolačići, teže uskladiti prikaze aplikacije i verzionisati sadržaj |

### 7.2 Preporuka: B

- **Astro 5** (statički izlaz), u folderu `marketing/` ovog repozitorijuma (dijeli logo i lako prati
  uputstvo i CHANGELOG) ili u posebnom repozitorijumu (P12). Poseban Vercel projekat sa
  „Root Directory = marketing“.
- **Domen:** `www.zevupravnik.com` → marketinški sajt. `zevupravnik.com` ostaje aplikacija.
- **Jedina izmjena u aplikaciji:** `src/app/(app)/layout.tsx` danas za neprijavljenog radi
  `redirect("/login")`. Za tačno `/` (ne podstranice) neprijavljen posjetilac ide na
  `https://www.zevupravnik.com` (307, adresa iz env varijable `MARKETING_URL`; bez nje ponašanje
  ostaje kao danas). Ovo je izmjena aplikacije → CHANGELOG + verzija, kao i svaka druga.
- Forma „Zatražite poziv“: Vercel funkcija u marketinškom projektu (§8.2).
- Ako se kasnije pokaže potreba za opcijom C, ova odluka je ne blokira.

---

## 8. Mjerenje i CTA tok

### 8.1 Analitika uz privatnost

| Opcija | Kolačići / baner | Napomena |
|---|---|---|
| **Vercel Web Analytics** (preporuka za početak) | bez kolačića, bez banera | Već je na Vercelu; stranice, izvori, uređaji; prilagođeni događaji u plaćenom planu |
| Plausible (EU) | bez kolačića | Odličan za događaje i UTM; mjesečna pretplata |
| Google Analytics 4 | traži saglasnost (baner) | Ne preporučuje se: baner kvari prvi utisak, a podaci idu van EU |

- **Događaji:** `cta_click` (sa mjestom: hero / sekcija / paketi / podnožje), `form_submit`,
  `form_error`, `paket_view`, `login_click`.
- **UTM konvencija** za objave: `utm_source=facebook|viber|linkedin|instagram|email`,
  `utm_medium=social|message|newsletter`, `utm_campaign=lansiranje-2026|glasanje|novac`.
- Bez praćenja pojedinaca, bez Facebook piksela u prvoj fazi (P13).

### 8.2 CTA tok „Zatražite poziv“

1. Svako „Zatražite poziv“ vodi na `/poziv` (ne modal — link se može podijeliti, a forma radi bez JS-a).
2. Forma (§4.5) šalje POST na funkciju `/api/upit` marketinškog projekta: provjera polja, skriveno
   polje protiv botova (honeypot) + ograničenje po IP-u, bez CAPTCHA-e.
3. Funkcija šalje e-mail na prodajnu adresu (P6) preko istog provajdera e-pošte koji aplikacija već
   koristi, i kratku potvrdu podnosiocu. Podaci iz forme se ne čuvaju na sajtu.
4. Administrator platforme odgovara i, kad je klijent spreman, pravi **poziv za novi ZEV** u
   postojećem `/admin/novi` (paket se bira tamo). Od tog trenutka tok je onaj iz uputstva §15.
5. Kasnije (nije u ovom planu): upit kao zapis u „Pozivi i nacrti“ (`/admin`), da se ne prepisuje.

---

## 9. Redoslijed izrade

| Faza | Šta | Preduslov |
|---|---|---|
| **M0 — odluke** | Odgovori na P1–P13; pravna provjera tvrdnji iz §2 i Privatnosti; potvrda paketa | ovaj plan + mockupi |
| **M1 — temelj i Početna** | `marketing/` (Astro), tokeni §5.2, Archivo, zaglavlje/podnožje, Početna sa fasadom i animacijom, meta + OG Početne, Vercel projekat na preview adresi | M0 |
| **M2 — ostale stranice** | Funkcije, Paketi, Zatražite poziv + `/api/upit`, Privatnost/Uslovi, 404 | M1 |
| **M3 — prikazi i OG** | Pravi screenshotovi iz seeda (računar + telefon), četiri OG slike iz šablona, provjera pregleda na Viberu/WhatsAppu/Facebooku (Sharing Debugger)/LinkedInu (Post Inspector) | M2 |
| **M4 — puštanje** | `www.zevupravnik.com` na Vercel projekat, izmjena `/` u aplikaciji (`MARKETING_URL`, CHANGELOG + verzija), Vercel Analytics, sitemap, Search Console | M3 |
| **M5 — kampanje** | Odredišne stranice „glasanje“ i „novac“, UTM, objave iz §4.7 | M4 |
| **Paralelno, prije prodaje paketa** | „Faza 2 — feature paketi“ (`requireFeature`, meni, promjena paketa iz admina) | P3 |

---

## 10. Rizici

| Rizik | Ublažavanje |
|---|---|
| Sajt obećava paket koji aplikacija ne sprovodi (Basic vidi sve) | P3: Faza 2 prije diferenciranih cijena, ili jedan paket do tada |
| Pravna tvrdnja („po zakonu“, „glas važi“) bez provjere | §2 „Šta ne tvrdimo“; P7 pravnik pregleda tekst |
| Sadržaj zastari jer aplikacija brzo raste (v2.64) | Tabela §4.3 ima izvore; uz svako minor izdanje aplikacije provjera „da li mijenja sajt“ u zev-app-guidelines kontrolnoj listi |
| OG keš na Viberu i Facebooku pokazuje staru sliku | Novo ime fajla pri svakoj izmjeni slike |
| Forma kao vektor spama | honeypot + ograničenje po IP-u; nema čuvanja podataka |

---

## 11. Mockupi

Svi su samostalni HTML fajlovi (bez eksternih resursa osim Google Fonts), responzivni, provjereni
na računaru i na 375 px. Na vrhu svakog je uska traka „Mockup …“ koja nije dio dizajna.

| Fajl | Šta prikazuje |
|---|---|
| `M-M01-pocetna.html` | Početna: hero sa fasadom i animacijom glasanja, oglasna tabla, tri uloge, skupština (koraci + e-listić), novac (uparivanje), održavanje (tok + hitni put), trag, kako počinje, paketi ukratko, završni CTA |
| `M-M02-funkcije.html` | Funkcije: indeks modula, 15 sekcija sa oznakom paketa i kratkim prikazima |
| `M-M03-paketi.html` | Paketi: tri kolone sa placeholder cijenama, tabela poređenja, šta je isto, česta pitanja |
| `M-M04-poziv.html` | Zatražite poziv: forma, „šta se dešava poslije“, stanje „upit je poslat“ (prikazano ispod) |
| `M-M05-og-slike.html` | Četiri OG slike 1200×630 (umanjene) + kako izgledaju u pregledu poruke |

---

## 12. Otvorena pitanja (sa preporukama)

| # | Pitanje | Preporuka |
|---|---|---|
| **P1** | Cijene paketa i model (mjesečno / godišnje; po ZEV-u ili po posebnom dijelu)? | Cijena **po ZEV-u, mjesečno, sa godišnjim popustom**, uz razred po broju posebnih dijelova (npr. do 30 / do 80 / više) — predsjedniku je najlakše predložiti skupštini fiksni iznos. Do odluke: „[cijena] KM“ i „Cijena na upit“ |
| **P2** | Nazivi paketa na sajtu: zadržati „Basic / Basic + finansije / Full“ (kao u adminu) ili domaći nazivi („Uprava / Uprava i finansije / Kompletno“)? | **Domaći nazivi** na sajtu i u adminu (izmjena oznaka u `TIER_LABELS`) — engleski „Basic/Full“ je jedina strana riječ u cijeloj aplikaciji |
| **P3** | Prodavati tri paketa odmah, iako aplikacija još ne ograničava funkcije po paketu? | **Ne.** Isporučiti „Fazu 2 — feature paketi“ prije prodaje Basic/Basic + finansije po nižoj cijeni. Do tada sajt može prikazati sva tri paketa sa „Cijena na upit“ |
| **P4** | Planovi (godišnji plan održavanja) — samo uz finansije, kako kaže komentar `ZevTier`, ili i u Basic? | Plan održavanja (stavke, termini pregleda) u **Basic**, finansijski plan i „plan vs. realizacija“ uz finansije — ali to traži izmjenu komentara i Faze 2; do tada slijediti kod |
| **P5** | Da li je „sjednica uživo“ (prozivka, glasovi iz sale, bilješke) dio Basic paketa, a samo slanje ličnih linkova e-poštom dio Full? | **Da** — tako je napisano u §4.3. Potvrditi, jer Faza 2 mora povući tačnu granicu u `requireFeature` |
| **P6** | Prodajna e-adresa, telefon, pravno lice za podnožje; ko odgovara na upite i u kom roku? | Posebna adresa (npr. `info@zevupravnik.com`) i rok „u roku od 2 radna dana“ |
| **P7** | Pravna provjera formulacija o Zakonu o održavanju zgrada RS i o e-glasanju | Kratak pregled pravnika prije M4 |
| **P8** | Samo Republika Srpska ili i FBiH / Brčko? | Na sajtu **RS** dok aplikacija ne podrži propise drugih entiteta |
| **P9** | Tekst Privatnosti i Uslova korištenja | Pravnik; sajt bez kolačića olakšava Privatnost |
| **P10** | Spomenuti „Povezane asistente“ (AI) na sajtu? | Ne dok je iza flaga; tada posebna sekcija „Radi sa Vašim asistentom“ |
| **P11** | Koje banke pouzdano rade za PDF izvod i SMS? | Imenovati banke tek kad su testirane; do tada „PDF ili CSV izvod“, a SMS uz napomenu „za sada Nova Banka“ samo na stranici Funkcije |
| **P12** | `marketing/` u ovom repozitorijumu ili poseban repozitorijum; važi li za njega pravilo CHANGELOG + verzija? | **Ovaj repozitorijum**, folder `marketing/` sa svojim kratkim CHANGELOG-om i **bez** obaveznog podizanja verzije aplikacije; dopuniti CLAUDE.md jednom rečenicom |
| **P13** | Facebook/Meta piksel za oglase? | Ne u prvoj fazi; UTM + Vercel Analytics su dovoljni dok nema plaćenih kampanja |

---

## 13. Šta plan namjerno ne radi

- Ne mijenja kod aplikacije (osim jedne izmjene u M4, koja ide kroz uobičajen CHANGELOG + verzija).
- Ne uvodi online plaćanje pretplate ni samostalno otvaranje naloga bez poziva.
- Ne prevodi sajt na engleski (rječnik `en` postoji u aplikaciji, ali publika je lokalna).
- Ne pravi blog; ako zatreba, Astro ga podržava bez promjene arhitekture.
