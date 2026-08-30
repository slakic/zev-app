# Matrica prava (RBAC)

Uloge: **P** = predsjednik ZEV, **R** = računovođa, **V** = član skupštine / vlasnik.
Sva prava se provjeravaju u servisnom sloju (`src/server/services/*` + `src/server/auth/guards.ts`).
„Svoje" znači: zapisi čiji je `partyId` jednak partiji prijavljenog korisnika.

| Radnja | P | R | V |
|---|---|---|---|
| **ZEV i imovina** |
| Matični podaci ZEV — izmjena | ✔ | – | – |
| Zgrade / ulazi / jedinice — unos i izmjena | ✔ | – | – |
| Zajednički dijelovi i oprema | ✔ | – | – |
| Pregled zgrada i jedinica | ✔ | ✔ | ✔ (pregled) |
| **Lica i vlasništvo** |
| Lica — unos, nalozi za vlasnike | ✔ | – | – |
| Vlasnički udjeli, promet jedinice (efektivni datumi) | ✔ | – | – |
| Stanari/zakupci, punomoći | ✔ | – | ✔ (svoju punomoć) |
| Lični podaci drugog lica | ✔ | ✔ | ✘ |
| Svoji podaci (kontakt) | ✔ | ✔ | ✔ (samo kontakt polja) |
| **Skupština** |
| Sjednice, dnevni red, prijedlozi, pravila glasanja | ✔ | pregled | pregled |
| Otvaranje glasanja, izdavanje/opoziv/ponovno izdavanje linkova | ✔ | – | – |
| Papirni / lični glasovi — unos | ✔ | – | – |
| Elektronsko izjašnjavanje (lični link + kod) | – | – | ✔ (svoje) |
| Izmjena podnesenog glasa | ✘ (samo append korekcija uz razlog + osnov) | ✘ | ✘ |
| Tuđi link / tuđi dokazi o glasanju | ✘ | ✘ | ✘ |
| Zatvaranje glasanja, odluka, zapisnik | ✔ | – | – |
| **Fakturisanje** |
| Stavke naknada (metode obračuna) | ✔ | ✔ | – |
| Serija faktura: nacrt + pregled obračuna | – | ✔ | – |
| Izdavanje serije, korekcija, storno (uz razlog) | – | ✔ | – |
| Tihe izmjene/brisanje izdatih faktura | ✘ | ✘ | ✘ |
| Pregled faktura | sve | sve | samo svoje |
| **Uplate i salda** |
| Unos uplata, uvoz CSV izvoda, uparivanje, storno | – | ✔ | – |
| Salda i kartice | sva | sva | samo svoje |
| Korekcija salda (uz razlog i osnov, auditirano) | ✔ | ✔ | – |
| **Troškovi** |
| Dobavljači, troškovi, plaćanja | ✔ (nacrti) | ✔ | – |
| **Planovi** |
| Godišnji planovi, stavke, verzije | ✔ | pregled | pregled |
| Usvajanje plana (samo uz USVOJEN prijedlog skupštine) | ✔ | – | – |
| Plan vs. realizacija | ✔ | ✔ | – |
| **Održavanje** |
| Prijava kvara sa opisom | ✔ | ✔ | ✔ |
| Tok statusa, ponude, radni nalozi, hitni put | ✔ | – | – |
| Praćenje prijava | sve | sve | samo svoje |
| **Dokumenti** |
| Generisanje / finalizacija / objava vlasnicima | ✔ | fakture, kartice, opomene | – |
| Preuzimanje | sve | sve | objavljeni + svoji |
| **Sistem** |
| Izvještaji + CSV izvoz | ✔ | ✔ | – |
| Podešavanja (pravni parametri) | ✔ | pregled | – |
| Revizorski trag | ✔ | ✔ | – |
| Poslate poruke (outbox) | ✔ | ✔ | – |
| Deaktivacija naloga | ✔ | – | – |

Globalne zabrane (bez obzira na ulogu): izmjena/brisanje `Vote`, `AuditEvent` i
`PaymentAllocation` zapisa (DB trigger); plaintext tokeni se nigdje ne čuvaju niti loguju;
notifikacije ne sadrže salda ni lične finansijske podatke.
