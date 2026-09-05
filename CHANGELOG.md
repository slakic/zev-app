# Changelog

Sve bitne izmjene u aplikaciji se evidentiraju ovdje.

## Verzionisanje

Ne koristi se standardni SemVer nego jednostavnija šema oblika `MAJOR.mmm`:

- **Minor** (`mmm`, tri cifre) raste za `1` pri svakom manjem izdanju / zaokruženom skupu
  izmjena — npr. `0.900` → `0.901` → `0.902`. Jedan korak = 1/1000 verzije.
- **Major** raste za `1` pri značajnijoj prekretnici (veći redizajn, nova cjelina
  funkcionalnosti i sl.), i tada se minor vraća na `000` — npr. `0.999` → `1.000`,
  pa dalje `1.001`, `1.002`, ..., sljedeća prekretnica bi bila `2.000`.
- Prva verzionisana isporuka je `0.900` (postojeća aplikacija u trenutku uvođenja
  verzionisanja), ne `0.000`, jer je aplikacija u tom trenutku već funkcionalna i
  korištena — brojevi ispod `0.900` nisu iskorišteni.

U `package.json` ista verzija se zapisuje kao standardan tročlani semver
`MAJOR.mmm.0` (treće polje je rezervisano, trenutno se ne koristi). Zahvaljujući tome
uobičajene npm komande rade tačno ovu šemu bez dodatnih skripti:

```bash
npm version minor   # 0.900.0 -> 0.901.0  (minor +1)
npm version major   # 0.999.0 -> 1.0.0    (major +1, minor se resetuje)
```

Nakon `npm version ...` dodati odgovarajući unos ispod i napraviti commit/tag kako npm
i predlaže.

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
