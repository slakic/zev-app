# Arhitektura — ZEV upravnik MVP

## Slojevi

```
┌────────────────────────────────────────────────────────────┐
│ UI (Next.js App Router, server komponente + server akcije) │
│   src/app/(app)/*  – zaštićene stranice po modulima        │
│   src/app/glasanje/[token] – javna stranica e-odobravanja  │
│   src/app/api/*    – preuzimanje PDF/CSV                   │
├────────────────────────────────────────────────────────────┤
│ Servisni sloj (SVA poslovna logika + autorizacija)         │
│   src/server/services/* – property, ownership, meetings,   │
│     billing, payments, finance, expenses, plans,           │
│     maintenance, documents, reports, users                 │
│   src/server/engines/*  – čisti motori: voting, billing    │
│   src/server/notifications/* – outbox + mock provajderi    │
│   src/server/audit.ts   – append-only revizorski trag      │
│   src/server/auth/*     – lozinke, sesije, tokeni, guardi  │
├────────────────────────────────────────────────────────────┤
│ Prisma 7 (WASM query compiler + pg driver adapter)         │
│   prisma/schema.prisma  – ~50 modela                       │
│   scripts/migrate.mjs   – WASM schema-engine migracije     │
├────────────────────────────────────────────────────────────┤
│ PostgreSQL 16 (numeric za novac, triggeri append-only)     │
└────────────────────────────────────────────────────────────┘
```

## Ključne odluke

**Autorizacija na serveru.** Svaka servisna funkcija prima `Actor` (userId, roles, partyId)
i sama poziva guard (`requireRole`, `requireSelfOrRole`). UI nikada nije tačka odluke;
testovi pozivaju servise direktno sa različitim akterima i dokazuju izolaciju.

**Novac.** Isključivo `Prisma.Decimal` / Postgres `numeric`. Pomoćnici u `src/lib/money.ts`
(zaokruživanje HALF_UP/UP/DOWN na 2 decimale, formatiranje „1.234,56 KM").

**Nepromjenjivost.** Tri tabele su append-only i na nivou BAZE (trigger odbija UPDATE/DELETE):
`Vote`, `AuditEvent`, `PaymentAllocation`. Ispravke su uvijek novi zapisi sa referencom i
razlogom (korekcija glasa, storno alokacije, korektivna faktura, storno transakcije).

**Sigurno e-odobravanje.** Token 256-bit CSPRNG; čuva se samo SHA-256 hash. Identitet se
potvrđuje odvojeno isporučenim jednokratnim kodom (takođe samo hash; 5 pogrešnih pokušaja
auto-opoziva token). Pri otvaranju glasanja zamrzava se snimak pravila + glasačke baze +
hash sadržaja prijedloga; materijalna izmjena = nova verzija prijedloga + poništenje svih
linkova. Trošenje tokena i upis glasa su u istoj DB transakciji (duplikat pada na unique
ograničenju). IP se čuva samo kao hash (konfigurabilna retencija).

**Efektivno datiranje.** `OwnershipStake`, `Occupancy`, `Proxy`, `OfficeTerm` imaju
`validFrom/validTo`; istorija se zatvara, nikad ne prepravlja. Izdate fakture pamte
dužnika u trenutku izdavanja — promet jedinice ne prepisuje istorijski dug.

**Obračun naknada.** Čisti motor `engines/billing.ts` (9 metoda raspodjele) vraća po
jedinici iznos + potpun snimak (formula, ulazi, osnov, zaokruživanje). Snimak se čuva u
`InvoiceLine.calcSnapshot` i prikazuje u pregledu prije izdavanja.

**Glasanje.** Čisti motor `engines/voting.ts` računa kvorum/težinu/većinu isključivo iz
snimka pravila (`Proposal.ruleSnapshot`), nikad iz „trenutnog" stanja.

**Dokumenti.** pdfkit sa ugrađenim DejaVu fontovima (š č ć ž đ). FINAL dokumenti se ne
prepisuju — regeneracija pravi novu verziju; svaki fajl ima SHA-256. Preuzimanje ide kroz
autorizovanu API rutu (vlasnik vidi objavljene dokumente + svoje fakture/kartice).

**Notifikacije.** Outbox obrazac: poruka se najprije upiše (QUEUED) pa predaje provajderu;
događaji isporuke se dopisuju. Mock provajderi simuliraju sent/delivered/seen, pa je cijeli
tok funkcionalan bez kredencijala. Poruke ne sadrže salda ni lične finansijske podatke.

**Multi-tenant kasnije.** Sve je vezano za jednu `Zev`; domenske tabele su čiste (bez
tenant ID-a), pa se SaaS sloj može dodati uvođenjem tenant kolone + RLS bez promjene logike.

## Šema baze (grupe)

* **Lica i pristup:** User, Session, Party
* **Imovina:** Zev, Building, Entrance, Unit, AllocationGroup(+Member), CommonAsset
* **Vlasništvo:** OwnershipStake, Occupancy, Proxy, OfficeTerm
* **Skupština:** Meeting, AgendaItem, Attendance, VotingRule, Proposal(+Unit),
  EligibleVoter, ApprovalToken, Vote
* **Finansije:** MoneyAccount, FinTransaction, TransactionCategory, ChargeItem(+Override),
  MeterReading, InvoiceBatch, Invoice(+Line), BankImportBatch, Payment,
  PaymentAllocation, BalanceCorrection
* **Troškovi:** Supplier, Expense
* **Planiranje:** AnnualPlan, PlanItem(+Unit), Project
* **Održavanje:** MaintenanceIssue, IssueComment, IssueStatusEvent, ContractorOffer, WorkOrder
* **Dokumenti/komunikacija:** Document, Attachment, NotificationMessage, ViberSubscriber
* **Sistem:** AuditEvent (append-only), Setting

## Sesije i lozinke

bcrypt (12 rundi); sesija = red u tabeli `Session` (opoziva se) + potpisani JWT kolačić
(HttpOnly, SameSite=Lax, Secure u produkciji) koji nosi samo ID sesije. Rate limit prijave:
10 pokušaja / 15 min po e-mailu. Server akcije Next.js-a imaju ugrađenu origin zaštitu
(POST + same-origin provjera), što pokriva CSRF za mutacije.

## Backup i restore

* Backup: `pg_dump -Fc zev > backup-$(date +%F).dump` + kopija direktorija
  `var/storage/documents` (generisani PDF-ovi; sadržaj je reproducibilan iz baze, ali
  finalizovani dokumenti su dokazni materijal — čuvati ih).
* Restore: `pg_restore -d zev --clean backup.dump` pa vratiti `var/storage`.
* Preporuka: dnevni automatski dump + sedmična proba restauracije (backlog #7).

## Struktura direktorija

```
prisma/            šema, migracije, seed
scripts/migrate.mjs  offline-friendly migracije (WASM schema engine)
src/app/           stranice i API rute
src/components/    dijeljene UI komponente
src/lib/           prisma klijent, novac, i18n
src/server/        servisi, motori, auth, audit, notifikacije
tests/             Vitest (integracioni + unit)
e2e/               Playwright smoke
assets/fonts/      DejaVu (PDF sa dijakritikom)
var/storage/       generisani dokumenti (git-ignorisano)
```
