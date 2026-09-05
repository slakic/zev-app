# Changelog

Sve bitne izmjene u aplikaciji se evidentiraju ovdje.

## Verzionisanje

**Od verzije 0.2.0 koristi se standardni SemVer, `MAJOR.MINOR.PATCH`, sa jednom
namjernom izmjenom u odnosu na podrazumijevano ponašanje:**

- **Minor je podrazumijevani korak.** Svaka normalna, zaokružena izmjena/funkcionalnost/
  ispravka podiže minor za `1` i vraća patch na `0` — npr. `0.2.0` → `0.3.0`.
- **Patch se koristi za iteracije na nečemu što još nije završeno.** Dok se ista
  funkcionalnost/ispravka doradjuje kroz više krugova u istom poduhvatu (npr. pronađe
  se i ispravi bag, pa se u istom dijelu koda otkrije još nešto prije nego što je posao
  zaista gotov), svaki takav međukorak podiže patch — npr. `0.3.0` → `0.3.1` → `0.3.2`,
  umjesto da svaki put ide novi minor. Kad je taj rad zaista završen i stabilan,
  *sljedeća nova* izmjena opet ide kao minor.
- **Major je za značajniju prekretnicu** i vraća minor na `1` (ne na `0`), a patch na
  `0` — npr. `1.4.2` → `2.1.0`, a ne `2.0.0`. Ovo je namjerno odstupanje od
  podrazumijevanog semver/npm ponašanja: sâm `npm version major` završi na `X.0.0`, pa
  je za željeno `X.1.0` potrebno odmah nakon toga pokrenuti i `npm version minor`
  (za major izdanje: `npm version major && npm version minor`). `npm version minor` i
  `npm version patch` sami po sebi već rade tačno ono što treba za ta dva slučaja.
- Prije svake nadogradnje verzije se potvrđuje sa korisnikom da li je u pitanju patch,
  minor ili major.

**Napomena o promjeni šeme:** verzije `0.900` i `0.901` niže su nastale po staroj šemi
(`MAJOR.mmm`, minor kao trocifreni brojač 1/1000, opisano dolje radi istorijskog
konteksta) i nisu preimenovane. Od unosa `0.2.0` na dalje važi šema opisana iznad.
Nastavak brojanja minor verzija (a ne povratak na `0.1.0`) odražava da su `0.900` i
`0.901` već predstavljale dvije zaokružene isporuke pod major `0`.

<details>
<summary>Stara šema (do 0.901, radi istorijskog konteksta)</summary>

Korištena je jednostavnija šema oblika `MAJOR.mmm`:

- **Minor** (`mmm`, tri cifre) raste za `1` pri svakom manjem izdanju / zaokruženom skupu
  izmjena — npr. `0.900` → `0.901` → `0.902`. Jedan korak = 1/1000 verzije.
- **Major** raste za `1` pri značajnijoj prekretnici, i tada se minor vraća na `000`.
- Prva verzionisana isporuka je bila `0.900` (postojeća aplikacija u trenutku uvođenja
  verzionisanja), ne `0.000`.

</details>

## [0.2.0] - 2026-09-05

### Izmijenjeno

- Promijenjena šema verzionisanja sa `MAJOR.mmm` na standardni semver
  `MAJOR.MINOR.PATCH` (minor kao podrazumijevani korak, patch za međukorake dok se
  nešto dovršava, major resetuje minor na `1` umjesto na `0`). Vidjeti sekciju
  „Verzionisanje" iznad. Prethodne verzije (`0.900`, `0.901`) ostaju kako su
  zabilježene, bez preimenovanja.

## [0.901] - 2026-09-05

### Dodato

- Izvoz svih operativnih izvještaja (stanje računa, prihodi/rashodi, potraživanja,
  dobavljači, fond održavanja, pregled po zgradama/projektima) u jedan PDF dokument,
  pored postojećeg CSV izvoza po pojedinačnom izvještaju.
- Novi izvještaj „Dugovanja po vlasnicima" na stranici Izvještaji — zaduženo/plaćeno/
  korekcije/saldo po vlasniku, sa stanjem na proizvoljno izabran dan i mogućnošću da
  se prikaže za jednog, više ili sve vlasnike. Izvoz u PDF (izvod otvorenih stavki),
  verzionisan i vidljiv u Dokumentima.

### Ispravljeno

- Filter „stanje na dan" (i za dugovanja po vlasnicima) je do sada isključivao stavke
  izdate/knjižene istog dana nakon ponoći (npr. izvještaj za „danas" je znao pokazati
  sve nule) — sada obuhvata cijeli izabrani dan.

## [0.900] - 2026-09-05

Prva verzionisana isporuka — snimak trenutnog stanja aplikacije.

### Osnovna funkcionalnost

- Autentifikacija i sesije (jose + bcryptjs, sesije u bazi), RBAC (predsjednik,
  računovođa, vlasnik) sa autorizacijom isključivo na serverskom sloju.
- Imovina i vlasništvo: zgrade, jedinice, vlasnici/suvlasnici, korisnici.
- Skupština i organi ZEV-a: prijedlozi, elektronsko glasanje sa kvorumom/većinom po
  snimljenim pravilima, sigurni tokeni za glasanje, izjave o saglasnosti (PDF).
- Fakturisanje i uplate: konfigurabilne stavke naknada (9 metoda obračuna), serije
  faktura, uparivanje uplata, salda.
- Troškovi, dobavljači i godišnji planovi (planirano/realizovano).
- Održavanje: prijave kvarova, zakazivanje, preventivni pregledi.
- Dokumenti, izvještaji i notifikacije (e-mail/Viber, mock provajderi u MVP-u).
- Append-only audit trag (DB trigerima zabranjen UPDATE/DELETE nad audit tabelom i
  glasovima), sav novac kao `Decimal`.

### Izmijenjeno / poboljšano (uoči ove verzije)

- Meni preuređen: lijevi sidebar sa punom navigacijom + tanka gornja traka sa
  profilom/odjavom u gornjem desnom uglu.
- Sidebar se collapsuje/proširuje (defaultno proširen, pamti izbor po korisniku), sa
  monohromatskim pictogram ikonicama za svaku stavku menija.
- Redizajn UI komponenti (`ui.tsx`) u Material Design stilu — dugmad, kartice,
  tabele, polja, statusni bedževi.
- Dodata mogućnost uređivanja postojećih stavki naknada (do sada samo kreiranje).
- Izjava o saglasnosti (PDF) prepravljena da stane na jednu stranicu.
- Proširen tekst saglasnosti i dodana lična Podešavanja sekcija.
- Dodat ZEV logo pored imena aplikacije u meniju (prošireno i suženo stanje) i
  postavljen kao favicon/app ikonica.
