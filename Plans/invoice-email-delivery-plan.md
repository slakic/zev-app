# Plan: dostava računa (fakture) e-poštom, po izboru vlasnika

**Status: PLAN, odluke korisnika potvrđene (2026-10-24): sve preporuke P1–P11 prihvaćene, verzija minor 2.40.0. Implementirano u v2.40.0 (Sonnet), pregledano i dopunjeno: atomsko preuzimanje poruke koristi zakup `NotificationMessage.dispatchingAt` (dodat u istu migraciju), jer samo poređenje `attempts` nije sprečavalo slanje poziva koji stigne dok prvi još šalje.** Plan je napravljen čitanjem stvarnog koda (v2.39.0), Opus plan-only prolaz; ključni nalaz (Rezime 1) ručno provjeren.

## Rezime

1. **Fakture se već danas šalju e-poštom, i to svima, bez pitanja.** Akcija izdavanja serije (`fakture/serija/[id]/page.tsx:23-53`) šalje svakom dužniku koji ima `Party.email` poruku `invoice-issued`. Poruka nema PDF, a tekst tvrdi „PDF u prilogu u produkcijskoj konfiguraciji" (`:42`), što nije tačno. `Invoice.deliveryStatus` se postavlja na `"SENT"` bez obzira na ishod (`:46`). Logika je u stranici, a ne u servisu. Otkad je Mailjet uključen (v2.38.0), ovo bi pri prvoj stvarnoj seriji poslalo stvarne e-mailove svim vlasnicima sa adresom. Ovaj plan to zamjenjuje dostavom koju vlasnik bira sam (P1).
2. **Nova opcija u Podešavanja → Moji podaci: „Dostavi mi račun putem e-maila".** Pamti se na `Party` (po vlasniku i po ZEV-u). Koristi se adresa `Party.email`, ista koju vlasnik već uređuje u toj kartici. Opcija se ne može uključiti bez ispravne adrese, a UI piše na koju adresu stižu računi. Predsjednik i računovođa mogu je uključiti umjesto vlasnika (vlasnik bez naloga, zahtjev na papiru), uz napomenu i audit.
3. **E-mail nosi fakturu kao PDF prilog** i kratak tekst bez iznosa i salda. Vlasnicima sa nalogom ide i link na fakturu u aplikaciji. Ovo je namjeran i dokumentovan izuzetak od PRIVACY pravila (`service.ts:3-4`): prilog dobija samo lice koje je dostavu izabralo, na svoju adresu, i samo za svoju fakturu.
4. **Slanje je odvojeno od izdavanja.** Izdavanje (`issueBatch`, `issueSingleInvoice`, `correctInvoice`, `cancelInvoice`) poslije transakcije samo **upisuje poruke u outbox** (`QUEUED`, sa vezom na PDF). Stranica zatim šalje ograničen broj poruka (najviše 25 ili oko 25 s po pozivu). Ostatak čeka u redu i šalje se dugmetom „Pošalji neposlate" na stranici serije. Ista faktura se ne šalje dva puta (ključ faktura + šablon, plus atomsko „preuzimanje" poruke u `dispatchNotification`).
5. **Uprava vidi status dostave** po fakturi (serija, detalj fakture) i ko je dostavu izabrao (lista vlasnika, profil vlasnika).
6. **Migracija:** dvije kolone na `Party` i jedna na `NotificationMessage`. **Na produkciji se pokreće ručno prije deploy-a.**

## Zatečeno stanje

### Izdavanje faktura (`src/server/services/billing.ts`)
- `issueBatch` (`:288-347`): sve u jednoj `$transaction` (`timeout: 30000`, `:346`) i vraća niz faktura. Ne generiše PDF i ne šalje e-mail.
- `issueSingleInvoice` (`:350-383`): **nema pozivaoca u UI-ju** (samo testovi). Ipak se povezuje radi potpunosti.
- `cancelInvoice` (`:464-483`): samo dok nema alokacija. Status prelazi u `CANCELLED`.
- `correctInvoice` (`:489-538`): nova korektivna faktura (`correctionOfId`), a original prelazi u `CORRECTED`.
- Nijedan servis ne uvozi `billing.ts` (provjereno grep-om), pa `billing → invoiceEmail → documents` ne pravi kružni import.

### Stranice faktura
- `fakture/serija/[id]/page.tsx:23-53` (`issueBatchAction`): `issueBatch` → petlja `generateInvoicePdf` za **svaku** fakturu → `queueNotification` za svakog dužnika sa e-mailom → `deliveryStatus: "SENT"` → redirect na `/fakture?msg=...(mock e-mail)`. Sve je sekvencijalno i nema `maxDuration`.
- `fakture/[id]/page.tsx`:
  - `:25-31` „Preuzmi PDF" svaki put zove `generateInvoicePdf`, što pravi **novu verziju** dokumenta.
  - `:33-60` storno i korekcija.
  - `:93-102` kartica „Iznosi" (`dl`).
- `Invoice.documentId` / `Invoice.deliveryStatus` (`schema.prisma`, model `Invoice`):
  - `documentId` piše `generateInvoicePdf` (`documents.ts:285`).
  - `deliveryStatus` piše samo gornja petlja i ništa ga ne čita.

### PDF fakture (`src/server/services/documents.ts`)
- `generateInvoicePdf` (`:217-287`):
  - guard je `requireSelfOrRole(actor, inv.debtorId, "PRESIDENT","ACCOUNTANT")`;
  - renderuje PDF i čuva ga kroz `storeDocument` (`type: "INVOICE"`, `sourceType: "Invoice"`, `sourceId`, `finalize: true`);
  - upisuje `invoice.documentId`.
- **Korektivna faktura u PDF-u ne pominje original.** Naslov je „FAKTURA {broj}", a stavka je opis korekcije.
- `storeDocument` (`:102-158`): svaki poziv pravi novu verziju. Bajtovi su u `DocumentBlob` (`documentId` unique).
- `readDocumentFile` (`:171-196`): vlasnik smije čitati PDF svoje fakture (`:179-181`), ali tek **poslije prijave** (`requireAnyUser`).

### Slanje e-pošte
- `src/server/notifications/service.ts`:
  - `:3-4` PRIVACY napomena;
  - `:13-51` `queueNotification` (upis i odmah slanje);
  - `:53-125` `dispatchNotification`:
    - `:55` provjera statusa, **bez atomskog preuzimanja**, pa dva paralelna poziva mogu poslati istu poruku dva puta;
    - `:66-76` allowlist za probni period: `FAILED` + `ALLOWLIST_BLOCKED_ERROR`;
    - `attempts` se uvećava u tri grane (`:71`, `:106`, `:119`);
  - `:127-142` `retryFailed` (bez pozivalaca).
- `providers.ts:25-31`: `EmailProvider.send({ to, subject, body, fromName? })`, **bez priloga**. Mock je na `:41-55`.
- `mailjetEmail.ts:59-70`: Mailjet v3.1 `Messages[0]` sa `TextPart`, bez `Attachments`.
- `NotificationMessage`: `relatedType/relatedId` (indeks `[relatedType, relatedId]`), `template`, `recipientId`, `lastError`, `attempts`. **Nema polja za prilog.**
- `emailTest.ts:86-93`: zod šema za jednu e-mail adresu (`addressSchema`). Ponovo se koristi (R1).
- `meetings.ts:935-958` (`openVoting`): isti obrazac sekvencijalnog slanja poslije transakcije, uz isti rizik (Vercel limit, 200/dan).
- `poruke/page.tsx` (podnožje): „Sadržaj poruka ne uključuje salda ni lične finansijske podatke…". Mora se dopuniti.

### Vlasnik, nalog i podešavanja
- `Party.email` je kontakt adresa i može biti prazna. `Party.userId` je opcion: „most Party rows never will [have an account]" (`schema.prisma`, `Party`). `createUserForParty` (`users.ts:58`) poziva samo predsjednik i to je ručan korak. **Dakle mnogi dužnici nemaju nalog** i link u aplikaciju im ništa ne znači. Fixture `ownerC` (`tests/helpers.ts`) je baš takav: ima `email`, nema `User`.
- `podesavanja/page.tsx`:
  - `:85-100` `updateMyContactAction` (`requireOwnerParty` → `updateParty`);
  - `:130-138` `Promise.all`;
  - `:174-188` kartica „Moji podaci";
  - `:190-237` kartica „Elektronsko glasanje" (obrazac za saglasnost).
- `ownership.ts:70-90` `updateParty`: vlasnik smije mijenjati samo `email/phone/correspondenceAddress`. **Format e-maila se ne provjerava.** Audit je `party.update`.
- `evoteConsent.ts:5-7`: istorija saglasnosti se **izvodi iz append-only audit traga**, ne iz posebnih kolona. Isti princip se ovdje primjenjuje na istoriju uključenja i isključenja.
- `vlasnici/page.tsx:22-29` kolone (E-mail, Nalog…), `:203` e-mail ćelija. `vlasnici/[id]/page.tsx`: `:166-200` kartica „Kontakt", `:267` kartica saglasnosti.

### Audit, katalog i ostalo
- `catalog.ts`: OWNER sekcija `:32-40`, FINANCE `invoice.*` `:101-105`. `tests/activity-catalog.test.ts` hvata i ternarni oblik `action: c ? "a" : "b"`.
- Prevodi akcija su u `sr-Latn.ts` `auditAction.party.*` (`:393-401`), samo za OWNER i GOVERNANCE.
- Vercel: `maxDuration = 60` postoji samo na dvije API rute (`api/izvjestaji/*`). Stranica serije ga nema.
- Zadnja migracija je `20261022100000_add_platform_setting` (ručni SQL).

## Rješenje

### R1. Gdje se čuva izbor i koja adresa se koristi

| Opcija | Opis | Za | Protiv |
|---|---|---|---|
| **A** | **Kolone na `Party`** (po vlasniku po ZEV-u) | račun je vezan za `Party` (dužnik); radi i za vlasnika **bez naloga**; vlasnik u dva ZEV-a bira posebno za svaki; obrazac kao `eVoteConsent*` | jedna migracija |
| B | Kolona na `User` | jedno podešavanje za sve ZEV-ove | ne radi za vlasnike bez naloga (njima je najpotrebnije); jedna adresa za više ZEV-ova nije uvijek željena |
| C | Nova tabela `DeliveryPreference` (kanal × vrsta dokumenta) | proširivo (opomene, kartica…) | preuranjeno; više koda i join-ova |

**Preporuka: A.** Polja:
```prisma
// u model Party, ispod eVoteConsentDocumentId
/// Vlasnik je izabrao da mu se svaka faktura izdata na njegovo ime dostavlja e-poštom (PDF u prilogu)
/// na Party.email (Plans/invoice-email-delivery-plan.md). Istorija uključenja/isključenja se izvodi
/// iz audit traga (party.invoice_email.enable/disable), isto kao kod e-glasanja.
invoiceEmailDelivery   Boolean   @default(false)
invoiceEmailDeliveryAt DateTime? // kada je zadnji put uključeno; null dok je isključeno
```

**Adresa:**

| Opcija | Za | Protiv |
|---|---|---|
| **`Party.email`** (kontakt e-mail iz „Moji podaci") | postoji i za vlasnike bez naloga; vlasnik je mijenja u istoj kartici; predsjednik je unosi u profil | može biti prazna ili neispravna (nema validacije u `updateParty`) |
| `User.email` (prijava) | uvijek postoji kod korisnika sa nalogom | ne postoji za vlasnike bez naloga; adresa za prijavu nije nužno adresa za poštu |
| Posebna adresa uz opciju | puna kontrola | treće polje za e-mail i zbunjujuće; dvije adrese za isto lice |

**Preporuka: `Party.email`** (P2). Pravila:
- **Uključenje** traži da `Party.email` prođe zajedničku šemu adrese. `addressSchema` iz `emailTest.ts:86-93` se seli u `src/lib/emailAddress.ts` kao `export const emailAddressSchema` i `emailTest.ts` je uvozi. Greške:
  - prazna adresa: „Za dostavu računa e-poštom potrebna je e-mail adresa. Upišite je u kartici „Moji podaci" i sačuvajte."
  - neispravna adresa: „E-mail adresa u „Moji podaci" nije ispravna. Ispravite je pa ponovo uključite dostavu."
- **`updateParty`** (`ownership.ts:70`): ako je `before.invoiceEmailDelivery === true` i:
  - novi `email` je prazan → greška „Dok je uključena dostava računa e-poštom, e-mail adresa ne može biti prazna. Prvo isključite dostavu računa.";
  - novi `email` je neispravan → greška „Unesite ispravnu e-mail adresu.";
  - `email` je nepromijenjen ili nije u `data` → ništa.

  Promjena adrese ne gasi opciju. Sljedeći račun ide na novu adresu, a promjena je već u auditu `party.update`.
- **Trag pristanka:** dovoljna je audit stavka sa adresom u trenutku uključenja. Ne treba posebna tabela, isto kao kod e-glasanja (`evoteConsent.ts:5-7`): `after: { enabled, email, byOwner }`, `reason`. `invoiceEmailDeliveryAt` služi samo za prikaz „Uključeno od…".

### R2. Sadržaj poruke: link, PDF ili oboje

| Opcija | Za | Protiv |
|---|---|---|
| a) Samo link na fakturu u aplikaciji | poštuje PRIVACY pravilo bez izuzetka; ništa novo u provajderu | **vlasnici bez naloga ne mogu ništa** (`readDocumentFile` traži prijavu); korisnik je tražio da se *račun dostavi*, a link nije dostava |
| b) Samo PDF u prilogu | stvarna dostava; radi bez naloga; ima pravnu i praktičnu vrijednost (arhiva, štampa, QR) | prilog u `EmailProvider`/Mailjet; izuzetak od PRIVACY pravila |
| **c) PDF u prilogu + link (samo za vlasnike sa aktivnim nalogom)** | sve iz b), a vlasnik sa nalogom vidi i stanje uplata | isto kao b) |

**Preporuka: c)** (P3). Obrazloženje izuzetka: vlasnik je izričito tražio dostavu na adresu koju je sam upisao (ili je upisala uprava na njegov pisani zahtjev), a prilog je njegova vlastita faktura. To je isto što i papirna faktura u njegovom sandučetu. **Tijelo poruke i dalje nema iznos ni saldo** (P4), jer naslov i tijelo se vide u pregledu poruka i na zaključanom ekranu telefona.

**Nova PRIVACY napomena** (`service.ts:3-4` zamijeniti):
```ts
// PRIVACY: notification bodies must never contain balances, debts or other sensitive personal
// data — they link to an authenticated page instead. ONE deliberate exception
// (Plans/invoice-email-delivery-plan.md): "invoice-delivery*" messages attach the invoice PDF
// (attachmentDocumentId), and only for a Party that opted in (Party.invoiceEmailDelivery), sent
// to that Party's own Party.email, for an invoice where it is the debtor. Their body still
// carries no amounts or balances.
```
Podnožje `poruke/page.tsx` postaje: „Sadržaj poruka ne uključuje salda ni lične finansijske podatke. Izuzetak je faktura u PDF prilogu, koju dobijaju samo vlasnici koji su izabrali dostavu računa e-poštom."

**Prilog kroz outbox (bez bajtova u outbox-u).** Nova kolona:
```prisma
// u model NotificationMessage, ispod relatedId
/// Document.id čiji se PDF (DocumentBlob) šalje kao prilog. Bajtovi se čitaju pri svakom slanju,
/// pa ponovno slanje (retry) šalje isti, nepromijenjeni PDF.
attachmentDocumentId String?
```

**Provajder** (`providers.ts`):
```ts
export type EmailAttachment = { filename: string; contentType: string; content: Buffer };
export interface EmailProvider {
  name: string;
  send(msg: { to: string; subject: string; body: string; fromName?: string; attachments?: EmailAttachment[] }): Promise<SendResult>;
}
```
- Mock (`:41-55`): u `sent` događaj upisuje `detail: "mock provider; prilozi: FAK-2026-000001.pdf (34 KB)"` kad prilozi postoje. Bajtovi se ne čuvaju.
- Mailjet (`mailjetEmail.ts:59-70`), samo kad je niz neprazan:
  ```ts
  Attachments: msg.attachments.map((a) => ({ ContentType: a.contentType, Filename: sanitizeAttachmentName(a.filename), Base64Content: a.content.toString("base64") }))
  ```
  `sanitizeAttachmentName` dozvoljava samo `[A-Za-z0-9._-]`, ostalo pretvara u `_` i reže na 100 znakova.

**`dispatchNotification`** (EMAIL grana, poslije allowlist provjere, prije `send`):
- Ako je `msg.attachmentDocumentId` postavljen:
  - `prisma.document.findUnique({ where: { id }, select: { zevId, number } })` mora postojati i imati `zevId === msg.zevId`. Inače `throw new Error("Prilog poruke nije pronađen.")` (postojeći `catch` upisuje `FAILED` i `lastError`).
  - `prisma.documentBlob.findUnique({ where: { documentId } })`; bez bloba: `throw new Error("PDF fakture nije pronađen.")`.
  - Veličina preko `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024`: `throw new Error("Prilog je prevelik za slanje e-poštom.")`. Mailjet prima do 15 MB po poruci, a PDF fakture ima desetine KB.
  - `attachments: [{ filename: \`${doc.number}.pdf\`, contentType: "application/pdf", content: Buffer.from(blob.data) }]`.

**Ponovna upotreba PDF-a.** Nova funkcija u `documents.ts`:
```ts
/** Najnovija sačuvana verzija PDF-a fakture; generiše je samo ako ne postoji. */
export async function ensureInvoiceDocument(actor: Actor, invoiceId: string): Promise<{ id: string; number: string }>
// guard: requireZev(actor); invoice = findUniqueOrThrow({ id, zevId }); requireSelfOrRole(actor, invoice.debtorId, "PRESIDENT","ACCOUNTANT")
// existing = prisma.document.findFirst({ where: { zevId, type: "INVOICE", sourceType: "Invoice", sourceId: invoiceId }, orderBy: { version: "desc" } })
// return existing ?? generateInvoicePdf(actor, invoiceId)
```
Koristi je i petlja na stranici serije umjesto `generateInvoicePdf`, pa se PDF ne pravi dva puta. „Preuzmi PDF" (`fakture/[id]:25-31`) se ne mijenja (van obima).

**Korektivna faktura u PDF-u:**
- U `generateInvoicePdf` include proširiti sa `correctionOf: { select: { number: true } }`.
- Ispod „Period … Rok plaćanja" dodati, kad postoji: `doc.font("bold").text(\`Korektivna faktura — zamjenjuje fakturu ${inv.correctionOf.number}\`).font("reg")`.

### R3. Kada i kako se šalje

**Šabloni** (konstante u novom servisu):
```ts
export const INVOICE_EMAIL_TEMPLATE = { ISSUED: "invoice-delivery", CORRECTED: "invoice-delivery-corrected", CANCELLED: "invoice-delivery-cancelled" } as const;
```
Namjerno se razlikuju od starog `invoice-issued`. Stari redovi (samo link, slati svima) se nikad ne šalju ponovo i ne ulaze u status dostave.

| Događaj | Šta ide | Prilog |
|---|---|---|
| `issueBatch`, `issueSingleInvoice` | `invoice-delivery` za svaku fakturu čiji dužnik ima `invoiceEmailDelivery` | PDF te fakture |
| `correctInvoice` | `invoice-delivery-corrected` za **korektivnu** fakturu (relatedId = nova faktura) | PDF korektivne fakture (sa redom „zamjenjuje…") |
| `cancelInvoice` | `invoice-delivery-cancelled` (relatedId = stornirana faktura) | bez priloga (P5) |

Pravilo je „dužnik **sada** ima uključenu dostavu i ispravnu adresu" (`emailAddressSchema.safeParse(party.email)`). Fakture izdate prije uključenja se ne šalju same, ali se mogu poslati ručno sa detalja fakture (R4).

**Opcije za slanje:**

| Opcija | Za | Protiv |
|---|---|---|
| Sinhrono u `issueBatch` (u ili odmah poslije transakcije) | jednostavno | 60 faktura × (PDF ≈ 0,2 s + Mailjet ≈ 0,4 s) ≈ 35 s; Vercel limit; prekid ostavlja dio vlasnika bez reda u outbox-u (kao `openVoting`) |
| Cron/worker koji prazni red | najrobusnije | nova infrastruktura (Vercel Cron, ruta sa tajnom), van obima |
| **Upis u outbox poslije transakcije + ograničeno slanje na stranici + „Pošalji neposlate"** | svaka faktura odmah dobija red (vidljiv i ponovljiv); slanje nikad ne prelazi budžet; bez nove infrastrukture | ako ZEV ima više od 25 primalaca, računovođa klikne još jednom |

**Preporuka: treća opcija.** Cron se kasnije može dodati nad istom funkcijom `dispatchInvoiceEmails`.

**Novi servis `src/server/services/invoiceEmail.ts`.** Sva logika je ovdje. Ne uvozi `billing.ts`.
```ts
export const INVOICE_EMAIL_DISPATCH_MAX = 25;
export const INVOICE_EMAIL_DISPATCH_BUDGET_MS = 25_000;
/** Meki dnevni limit (Mailjet besplatni plan = 200/dan za cijelu platformu); ostavlja rezervu za reset lozinke i glasanje. */
export const INVOICE_EMAIL_DAILY_SOFT_LIMIT_DEFAULT = 180;

export type InvoiceEmailKind = "ISSUED" | "CORRECTED" | "CANCELLED";

// --- izbor vlasnika ---
export async function setInvoiceEmailDelivery(actor: Actor, partyId: string, enabled: boolean, opts?: { reason?: string | null }): Promise<Party>
//   requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT"); const zevId = requireZev(actor)
//   R1 validacija pri uključenju; bez promjene → vrati party, bez audita
//   update { invoiceEmailDelivery: enabled, invoiceEmailDeliveryAt: enabled ? new Date() : null }
//   audit(actor, { action: enabled ? "party.invoice_email.enable" : "party.invoice_email.disable",
//                  targetType: "Party", targetId: partyId, before: { enabled: before },
//                  after: { enabled, email: party.email, byOwner: actor.partyId === partyId }, reason: opts?.reason?.trim() || null })

// --- upis u outbox (zovu ga billing funkcije POSLIJE commit-a) ---
export async function queueInvoiceEmails(actor: Actor, invoiceIds: string[], kind: InvoiceEmailKind): Promise<{ queued: number; skipped: number }>
//   requireRole(actor, "ACCOUNTANT"); const zevId = requireZev(actor)
//   fakture: findMany({ id in ids, zevId }, include { debtor: { include: { user: { select: { active: true } } } }, correctionOf: { select: { number: true } }, zev: { select: { shortName, legalName } } })
//   za svaku: preskoči ako !debtor.invoiceEmailDelivery ili adresa ne prolazi šemu
//   idempotentnost: postoji li notificationMessage { relatedType: "Invoice", relatedId: inv.id, template } → preskoči
//   prilog (ISSUED/CORRECTED): try { doc = await ensureInvoiceDocument(actor, inv.id) } catch { doc = null }
//     (greška u PDF-u NE ruši izdavanje; dispatch pokušava ponovo)
//   enqueueNotification({ zevId, channel: "EMAIL", recipientId: debtor.id, toAddress: debtor.email, template, subject, body,
//                         relatedType: "Invoice", relatedId: inv.id, attachmentDocumentId: doc?.id ?? null })
//   cijela funkcija je u try/catch po fakturi; nikad ne baca prema billing-u (greška → console.error + skipped++)

// --- slanje, ograničeno ---
export type InvoiceEmailScope = { batchId: string } | { invoiceIds: string[] };
export type InvoiceEmailDispatchResult = { attempted: number; sent: number; failed: number; pending: number; dailyLimitReached: boolean };
export async function dispatchInvoiceEmails(actor: Actor, scope: InvoiceEmailScope, opts?: { max?: number; budgetMs?: number; dailyLimit?: number }): Promise<InvoiceEmailDispatchResult>
//   requireRole(actor, "ACCOUNTANT"); zevId = requireZev(actor); batch (ako je scope.batchId) findUniqueOrThrow({ id, zevId })
//   poruke: { zevId, relatedType: "Invoice", relatedId in (fakture iz scope-a, zevId), template in INVOICE_EMAIL_TEMPLATES, status: "QUEUED" }, orderBy createdAt
//   dnevni limit: limit = opts.dailyLimit ?? (currentEmailProviderKind() === "mailjet" ? Number(process.env.EMAIL_DAILY_SOFT_LIMIT) || DEFAULT : Infinity)
//     sentToday = notificationMessage.count({ channel: "EMAIL", status in [SENT, DELIVERED, SEEN], sentAt >= now-24h })  // cijela platforma: jedan Mailjet nalog
//   petlja: dok i < max && elapsed < budgetMs && sentToday < limit:
//     ako ISSUED/CORRECTED poruka nema attachmentDocumentId → ensureInvoiceDocument pa update reda (ako ne uspije: FAILED "PDF fakture nije generisan: …")
//     await dispatchNotification(id); brojanje sent/failed; sentToday++ na uspjeh
//   pending = preostali QUEUED u scope-u
//   audit(actor, { action: "invoice_email.dispatch", targetType: batchId ? "InvoiceBatch" : "Invoice", targetId: batchId ?? invoiceIds[0], after: { attempted, sent, failed, pending, dailyLimitReached } })  — samo ako attempted > 0 ili dailyLimitReached

// --- ručno ponovno slanje ---
export async function retryInvoiceEmails(actor: Actor, scope: InvoiceEmailScope): Promise<InvoiceEmailDispatchResult>
//   requireRole(actor, "ACCOUNTANT"); FAILED poruke iz scope-a (samo INVOICE_EMAIL_TEMPLATES, attempts < 5) → status QUEUED + događaj "retry";
//   audit "invoice_email.retry" { count }; pa dispatchInvoiceEmails(actor, scope)

// --- ručno slanje stare fakture (izdate prije uključenja) ---
export async function sendInvoiceEmailNow(actor: Actor, invoiceId: string): Promise<InvoiceEmailDispatchResult>
//   requireRole(actor, "ACCOUNTANT"); faktura ISSUED; queueInvoiceEmails(actor, [invoiceId], inv.correctionOfId ? "CORRECTED" : "ISSUED"); dispatchInvoiceEmails(actor, { invoiceIds: [invoiceId] })
//   greška „Dužnik nije uključio dostavu računa e-poštom." ako je preskočeno

// --- statusi za UI ---
export type InvoiceEmailStatus = { messageId: string; template: string; status: NotifStatus; toAddress: string; sentAt: Date | null; lastError: string | null; attempts: number; createdAt: Date };
export async function getInvoiceEmailStatus(actor: Actor, invoiceId: string): Promise<InvoiceEmailStatus | null>
//   requireAnyUser; zevId; invoice { id, zevId }; requireSelfOrRole(actor, invoice.debtorId, "PRESIDENT","ACCOUNTANT"); najnovija poruka iz INVOICE_EMAIL_TEMPLATES
export type BatchEmailSummary = { optedIn: number; sent: number; queued: number; failed: number; rows: { invoiceId: string; number: string; debtorName: string; toAddress: string; status: NotifStatus; lastError: string | null; sentAt: Date | null }[] };
export async function getBatchEmailSummary(actor: Actor, batchId: string): Promise<BatchEmailSummary>
//   requireRole(actor, "PRESIDENT","ACCOUNTANT"); sent = SENT+DELIVERED+SEEN
export async function countOptedInDebtors(actor: Actor, debtorIds: string[]): Promise<number>
//   requireRole(actor, "PRESIDENT","ACCOUNTANT"); za nacrt serije: „Račun e-poštom dobiće X od N dužnika."
```

**Izmjene u `service.ts`:**
- Novi `export async function enqueueNotification(input: QueueInput & { attachmentDocumentId?: string | null })` upisuje red i **ne šalje**. `queueNotification` postaje `enqueueNotification` + `dispatchNotification` (ponašanje ostaje isto za sve postojeće pozivaoce).
- **Atomsko preuzimanje** u `dispatchNotification` (zamjenjuje provjeru na `:55`):
  ```ts
  const claim = await prisma.notificationMessage.updateMany({
    where: { id, status: { in: ["QUEUED", "FAILED"] }, attempts: msg.attempts },
    data: { attempts: { increment: 1 } },
  });
  if (claim.count === 0) return prisma.notificationMessage.findUniqueOrThrow({ where: { id } });
  ```
  Iz tri kasnija `update`-a (`:71`, `:106`, `:119`) ukloniti `attempts: { increment: 1 }`. Semantika ostaje ista (jedan pokušaj = +1), ali dva paralelna dispatch-a (dupli klik na „Pošalji neposlate") više ne šalju istu poruku dva puta.

**Billing poziva upis poslije commit-a** (`billing.ts`):
- `issueBatch`: `const invoices = await prisma.$transaction(...); await queueInvoiceEmails(actor, invoices.map((i) => i.id), "ISSUED"); return invoices;` Povratni tip se ne mijenja, pa postojeći testovi ostaju isti.
- `issueSingleInvoice`: isto sa `[inv.id]`.
- `correctInvoice`: `queueInvoiceEmails(actor, [corrective.id], "CORRECTED")`.
- `cancelInvoice`: `queueInvoiceEmails(actor, [invoiceId], "CANCELLED")`.
- Fixture lica imaju `invoiceEmailDelivery=false`, pa postojeći testovi ne generišu dodatne PDF-ove.

**Stranice:**
- `fakture/serija/[id]/page.tsx`:
  - dodati `export const maxDuration = 60;`;
  - `issueBatchAction`:
    1. `issueBatch`;
    2. petlja `ensureInvoiceDocument` za sve fakture (umjesto `generateInvoicePdf`; PDF u Dokumentima ostaje kao danas);
    3. `dispatchInvoiceEmails(actor, { batchId })`;
    4. redirect na `/fakture/serija/${batchId}?msg=...`.
  - **Ukloniti** staro slanje `invoice-issued` i upis `deliveryStatus` (`:33-47`).
  - Poruka: „Serija je izdata ({n} faktura)." + ako ima primalaca „ E-poštom poslato: {sent}, čeka slanje: {pending}, neuspješno: {failed}." Kad je `pending > 0`: „ Preostale pošaljite dugmetom „Pošalji neposlate"."
  - Nova akcija `retryBatchEmailsAction` → `retryInvoiceEmails(actor, { batchId })`.
- `fakture/[id]/page.tsx`:
  - `export const maxDuration = 60;`;
  - `correctAction` i `cancelAction` poslije servisa zovu `dispatchInvoiceEmails(actor, { invoiceIds: [id] })` (za korekciju sa id-jem korektivne fakture), u istom `try`;
  - nove akcije `retryInvoiceEmailAction` → `retryInvoiceEmails(actor, { invoiceIds: [id] })` i `sendInvoiceEmailNowAction` → `sendInvoiceEmailNow`.
- `Invoice.deliveryStatus` se **više ne piše**. Status se uvijek čita iz outbox-a (jedan izvor istine). Kolona ostaje radi kompatibilnosti i može se ukloniti kasnije.

**Allowlist (probni period):** poruke na adrese van liste ostaju `FAILED` sa `ALLOWLIST_BLOCKED_ERROR`. Poslije uklanjanja liste, „Pošalji neposlate" ih šalje. Na stranici serije se vidi datum kreiranja, da računovođa ne pošalje staru fakturu nesvjesno.

### R4. Šta uprava vidi i ko smije uključiti opciju

| Opcija | Za | Protiv |
|---|---|---|
| Samo vlasnik (lično, u aplikaciji) | čist pristanak | vlasnici bez naloga nikad ne mogu dobiti fakturu e-poštom |
| **Vlasnik + predsjednik + računovođa (uz napomenu i audit)** | pokriva zahtjev na papiru ili telefonom; računovođa izdaje fakture | uprava može uključiti bez znanja vlasnika (ublaženo auditom i tekstom u e-mailu kako se isključuje) |
| Vlasnik + samo predsjednik | uže, kao uređivanje kontakta | računovođa mora zvati predsjednika |

**Preporuka: vlasnik + predsjednik + računovođa** (P6). U UI-ju uprave napomena nije obavezna, ali se preporučuje.

**Prikazi:**
- **Podešavanja → Moji podaci** (vlasnik): nova kartica „Dostava računa", odmah ispod kartice „Moji podaci" (R7).
- **`/vlasnici/[id]`**: nova kartica „Dostava računa e-poštom" uz „Saglasnost za elektronsko glasanje".
  - Status: „Uključena od {datum} — računi idu na {email}" ili „Isključena".
  - Za predsjednika, računovođu i samog vlasnika: forma sa checkbox-om „Dostavljaj račune ovom vlasniku putem e-maila", poljem „Napomena (npr. pisani zahtjev vlasnika)" i `SubmitBtn variant="tonal"` „Sačuvaj".
  - Tekst: „Uključite samo na zahtjev vlasnika. Promjena se bilježi u revizorski trag."
  - Bez adrese: checkbox `disabled` + „Prvo upišite e-mail adresu u kartici „Kontakt"."
- **`/vlasnici`** (lista): nova kolona `{ label: "Račun e-poštom", priority: "detail" }` iza „E-mail", vrijednost „Da" / „—". `listParties` već vraća cijeli `Party`, pa se servis ne mijenja.
- **Serija (`fakture/serija/[id]`)**:
  - DRAFT: ispod `StatusBadge` red teksta (`text-[13px] text-slate-600`) „Račun e-poštom (PDF) dobiće {x} od {n} dužnika." (`countOptedInDebtors`).
  - ISSUED: `Card title="Dostava e-poštom"` sa `dl` (Izabralo dostavu / Poslato / Čeka slanje / Neuspješno) i tabelom „Faktura | Dužnik | Adresa | Status" samo za fakture sa porukom. `StatusBadge` je postojeća mapa (`ui.tsx:82`), a `lastError` ide ispod badge-a kao u `poruke/page.tsx`.
  - Kad je `queued + failed > 0` i actor je ACCOUNTANT: `SubmitBtn variant="secondary"` „Pošalji neposlate ({queued+failed})".
  - Bez `primary` dugmeta u kartici (zaglavlje već ima „Izdaj").
- **Detalj fakture (`fakture/[id]`)**: u kartici „Iznosi" novi red „Dostava e-poštom:":
  - `SENT/DELIVERED/SEEN` → „Poslato {datum i vrijeme} na {adresa}";
  - `QUEUED` → „Čeka slanje";
  - `FAILED` → „Neuspješno" + `lastError` (13px);
  - nema poruke → „—".

  Ispod, samo za ACCOUNTANT: `FAILED`/`QUEUED` → `SubmitBtn variant="secondary"` „Pošalji ponovo". Ako nema poruke, faktura je ISSUED i dužnik ima uključenu dostavu → „Pošalji e-poštom". Vlasnik vidi isti red za svoju fakturu, bez dugmadi.
- **Poslate poruke**: kad red ima `attachmentDocumentId`, iza naslova dodati „ (PDF u prilogu)" (`text-[13px]`).

### R5. Odjava („unsubscribe")

| Opcija | Za | Protiv |
|---|---|---|
| **Tekst u poruci: kako se isključuje (aplikacija ili zahtjev upravi)** | bez novog koda i tokena; vlasnik bez naloga zna kome da se obrati | nema odjave jednim klikom |
| Link sa potpisanim tokenom za odjavu jednim klikom | standard za masovnu poštu (List-Unsubscribe) | nova javna ruta, tokeni, audit bez actor-a; ovo nije marketinška pošta nego poslovna dostava koju je vlasnik tražio |

**Preporuka: tekst** (P7). Tačan tekst je u R6.

### R6. Tekst poruka (sr-Latn, samo tekst)

Zajedničke promjenljive:
- `{ime}` = `partyDisplayName(debtor)`;
- `{zev}` = `zev.shortName?.trim() || zev.legalName`;
- `{period}` = `invoice.periodLabel` (npr. „2026-08", isto kao u aplikaciji);
- `{rok}` = `formatDate(dueDate)`;
- `{poziv}` = `paymentReference ?? number`;
- `{link}` = `${getEnv().APP_URL}/fakture/${invoice.id}`.

Red sa linkom se dodaje **samo** ako dužnik ima `user` i `user.active`. Funkcija je `export function buildInvoiceEmail(kind, data): { subject: string; body: string }`: čista i izvezena radi testova.

**Nova faktura (`invoice-delivery`)**
- Naslov: `Faktura {broj} — {zev}`
- Tijelo:
```
Poštovani/a {ime},

u prilogu vam dostavljamo fakturu {broj}[ za period {period}] koju je izdala {zev}.

Rok plaćanja: {rok}
Poziv na broj: {poziv}

Iznos, račun za uplatu i QR kod za plaćanje nalaze se u PDF fakturi u prilogu.
[Fakturu i stanje uplata možete pogledati i u aplikaciji nakon prijave: {link}]

Ovu poruku primate jer je za vas uključena dostava računa e-poštom. Dostavu možete isključiti u aplikaciji (Podešavanja → Moji podaci) ili zahtjevom upravi ZEV-a.

Ovo je automatska poruka. Molimo da na nju ne odgovarate.
```

**Korektivna faktura (`invoice-delivery-corrected`)**
- Naslov: `Korigovana faktura {broj} (zamjenjuje {stari broj}) — {zev}`
- Tijelo: isto kao gore, ali drugi pasus glasi:
```
u prilogu vam dostavljamo korektivnu fakturu {broj}[ za period {period}] koja zamjenjuje fakturu {stari broj}. Faktura {stari broj} više ne važi — za plaćanje koristite podatke iz fakture u prilogu.
```
Razlog korekcije se **ne** navodi (može sadržati internu napomenu računovođe).

**Stornirana faktura (`invoice-delivery-cancelled`)**, bez priloga
- Naslov: `Stornirana faktura {broj} — {zev}`
- Tijelo:
```
Poštovani/a {ime},

faktura {broj}[ za period {period}] je stornirana i ne treba je plaćati. Ako ste je već platili, obratite se upravi ZEV-a.
[Detalji su dostupni u aplikaciji nakon prijave: {link}]

Ovu poruku primate jer je za vas uključena dostava računa e-poštom. Dostavu možete isključiti u aplikaciji (Podešavanja → Moji podaci) ili zahtjevom upravi ZEV-a.

Ovo je automatska poruka. Molimo da na nju ne odgovarate.
```
Razlog storna se ne navodi.

Ni jedno tijelo ne sadrži iznos, saldo ni dug (provjerava se testom).

### R7. UI vlasnika (Podešavanja → Moji podaci)

`podesavanja/page.tsx`, nova kartica odmah iza „Moji podaci" (`:174-188`), uslov `myParty && showMoji`:
```tsx
<Card title="Dostava računa">
  <form action={setMyInvoiceEmailAction} className="space-y-3 text-sm">
    <label className="flex items-start gap-2">
      <input type="checkbox" name="invoiceEmail" defaultChecked={myParty.invoiceEmailDelivery} disabled={!myParty.email} className="mt-1" />
      <span>Dostavi mi račun putem e-maila</span>
    </label>
    {myParty.email
      ? <p className="text-slate-600">Svaka faktura izdata na vaše ime biće poslata kao PDF prilog na adresu <strong>{myParty.email}</strong>. Fakture ostaju dostupne i u aplikaciji. Adresu mijenjate u kartici „Moji podaci”.</p>
      : <p className="text-slate-600">Za ovu opciju potrebna je e-mail adresa. Upišite je u kartici „Moji podaci” i sačuvajte.</p>}
    {myParty.invoiceEmailDelivery && myParty.invoiceEmailDeliveryAt && <p className="text-[13px] text-slate-500">Uključeno od {formatDate(myParty.invoiceEmailDeliveryAt)}.</p>}
    {myParty.email && <SubmitBtn variant="tonal">Sačuvaj</SubmitBtn>}
  </form>
</Card>
```
Akcija:
```ts
async function setMyInvoiceEmailAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  try {
    const partyId = await requireOwnerParty(actor);
    await setInvoiceEmailDelivery(actor, partyId, formData.get("invoiceEmail") === "on");
  } catch (e) { redirect(`/podesavanja?tab=moji&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`); }
  revalidatePath("/podesavanja");
  redirect("/podesavanja?tab=moji&msg=saved");
}
```
Na `/vlasnici/[id]` je ista akcija sa `id` iz forme i `reason` iz polja „Napomena". Ne dodaje se nijedno novo `primary` ni `danger` dugme, a tekst nije ispod 13px (`design-system.md` §8).

### R8. Migracija

`prisma/migrations/20261023100000_add_invoice_email_delivery/migration.sql`:
```sql
-- Plans/invoice-email-delivery-plan.md
ALTER TABLE "Party" ADD COLUMN "invoiceEmailDelivery" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Party" ADD COLUMN "invoiceEmailDeliveryAt" TIMESTAMP(3);
ALTER TABLE "NotificationMessage" ADD COLUMN "attachmentDocumentId" TEXT;
```
Poslije izmjene šeme: `npx prisma generate` (generisani klijent je u repou). **Na produkciji pokrenuti ručno prije deploy-a.** Sve kolone imaju podrazumijevanu vrijednost ili su nullable, pa stari kod radi i sa novom šemom.

### R9. Audit i katalog

`catalog.ts`:
- OWNER (`:32-40`): `"party.invoice_email.disable": "OWNER"`, `"party.invoice_email.enable": "OWNER"`.
- FINANCE (`:101-105`, abecedno): `"invoice_email.dispatch": "FINANCE"`, `"invoice_email.retry": "FINANCE"`.

`sr-Latn.ts`, `auditAction.party` (`:393`): `invoice_email: { enable: "Uključena dostava računa e-poštom", disable: "Isključena dostava računa e-poštom" }`. Ugniježđeno.

Pojedinačni upis u outbox se ne audituje. Red u outbox-u je zapis, a `invoice.issue` već postoji.

## Rizici

1. **Isporučivost.** Fakture sa PDF prilogom češće završe u spamu. Mjere: SPF, DKIM i DMARC PASS (kontrolna lista iz `email-sender-name-and-test-email-plan.md`), ime pošiljaoca sa nazivom ZEV-a i bez HTML-a. Prvu seriju poslati sebi (allowlist) i provjeriti „Prikaži original".
2. **Pogrešna adresa.** Validira se format, ali ne i vlasništvo nad adresom (nema potvrde klikom). Tuđa faktura može otići na pogrešnu adresu ako je adresa pogrešno upisana. Mjere: UI tačno piše adresu, a audit čuva adresu pri uključenju. Kasnije se može dodati potvrda adrese (P8).
3. **Vlasnik bez naloga.** Rješava ga uprava (R4). Link se ne šalje, ali je PDF potpun.
4. **Velike serije i Vercel.** Slanje je ograničeno (25 poruka ili 25 s), `maxDuration = 60`, a ostatak čeka u redu. PDF-ovi svih faktura se i dalje generišu na stranici kao danas. Za ZEV sa više od 150 jedinica to treba kasnije prebaciti u red (van obima, zabilježiti).
5. **Mailjet 200 dnevno i 6.000 mjesečno.** Postoji meki limit 180 dnevno na nivou platforme (`EMAIL_DAILY_SOFT_LIMIT`). Kad se dostigne, poruke ostaju `QUEUED` uz jasnu poruku, a ostatak se šalje sutra. Vlasnik sa dvije jedinice (stan i garaža) dobija dva e-maila (P9).
6. **Duplikati.** Pokriveni su ključem (faktura, šablon) u `queueInvoiceEmails` i atomskim preuzimanjem u `dispatchNotification`. „Pošalji ponovo" postoji samo za `FAILED`/`QUEUED`, nikad za već poslato.
7. **Suvlasnici.** Faktura glasi na jednog dužnika (`previewBatch`, `billing.ts:235-249`), pa je dobija samo on. Ostali suvlasnici je ne dobijaju. To je ispravno, ali treba ga navesti u CHANGELOG-u.
8. **Prestanak slanja svima.** Uklanja se staro slanje `invoice-issued` (P1). Vlasnici koji su do sada (u mock režimu) „dobijali" obavještenje ga više ne dobijaju dok sami ne uključe dostavu.

## Testovi

Vitest, prava baza. Nov fajl `tests/invoiceEmail.test.ts` (`createFixture`, `createAreaCharges`). Mailjet `fetch` se mock-uje i env čuva i vraća kao u `tests/emailTest.test.ts`. PlatformSetting allowlist se vraća na podrazumijevano poslije testa.

**Izbor vlasnika**
1. `actorA` uključi za sebe: `invoiceEmailDelivery=true`, `invoiceEmailDeliveryAt` postavljen, audit `party.invoice_email.enable` sa `after.email` i `byOwner: true`. Drugi isti poziv ne pravi novi audit.
2. Bez adrese (`ownerA.email=null`) → greška „potrebna je e-mail adresa", ništa se ne mijenja. `email="nije-adresa"` → greška.
3. `actorA` za `ownerB` → `ForbiddenError`. Računovođa za `ownerC` (bez naloga) sa `reason` → uspjeh, audit ima `reason` i `byOwner: false`.
4. `updateParty` koji briše e-mail dok je opcija uključena → greška. Dok je isključena → prolazi. Promjena na novu ispravnu adresu → prolazi i opcija ostaje uključena.

**Upis i slanje**

5. `ownerA` uključen, `ownerB` nije, pa `issueBatch`. Za fakture dužnika A postoji po jedna poruka `invoice-delivery`, `QUEUED`, `toAddress = ownerA.email`, `recipientId = ownerA.id`, `attachmentDocumentId` = INVOICE dokument te fakture. Za B nema poruka.
6. `queueInvoiceEmails` dva puta za istu fakturu daje i dalje jednu poruku.
7. `dispatchInvoiceEmails({ batchId })` u mock režimu: poruke su `DELIVERED`, `attempts=1`, a `events` ima detalj sa `.pdf`. Drugi poziv ništa ne mijenja (`attempted=0`). Postoji audit `invoice_email.dispatch`.
8. Mailjet režim, uspjeh:
   - `fetch` body `Messages[0].Attachments[0]` ima `Filename = "{broj}.pdf"` i `ContentType = "application/pdf"`, a `Base64Content` dekodiran počinje sa `%PDF`;
   - `TextPart` sadrži broj fakture i „Podešavanja → Moji podaci";
   - `TextPart` **ne** sadrži `formatMoney(total)` ni „saldo".
9. Mailjet greška: `FAILED` + `lastError`. `retryInvoiceEmails({ batchId })` sa uspješnim `fetch`-om daje `SENT` i `attempts=2`, uz audit `invoice_email.retry`.
10. Allowlist aktivan, adresa van liste: `FAILED` + `ALLOWLIST_BLOCKED_ERROR`, a `fetch` nije pozvan.
11. Budžet: `max: 1` sa dvije poruke u redu daje `sent=1, pending=1`.
12. Dnevni limit: `dailyLimit: 0` daje `dailyLimitReached=true` i poruke ostaju `QUEUED`.
13. Paralelno slanje: `Promise.all([dispatchNotification(id), dispatchNotification(id)])` u mailjet režimu poziva `fetch` tačno jednom, a `attempts` je 1.
14. `correctInvoice` za uključenog dužnika: `invoice-delivery-corrected` sa `relatedId` korektivne fakture, tijelo sadrži broj originala, prilog je dokument korektivne fakture.
15. `cancelInvoice` (faktura bez alokacija): `invoice-delivery-cancelled`, `attachmentDocumentId=null`, tijelo sadrži „stornirana".
16. `issueSingleInvoice` za `ownerC` (bez naloga, uključen): poruka na `ownerC.email`, a tijelo **ne** sadrži `/fakture/` link. Za `ownerA` (ima nalog) tijelo sadrži `http://localhost:3000/fakture/{id}`.
17. Prilog drugog ZEV-a (ručno podmetnut `attachmentDocumentId` iz fixture-a B): `FAILED` „Prilog poruke nije pronađen.".
18. Izolacija: računovođa ZEV-a B → `dispatchInvoiceEmails`/`retryInvoiceEmails` za seriju ZEV-a A baca grešku.
19. `getInvoiceEmailStatus`: `actorA` čita svoju fakturu, `actorB` dobija `ForbiddenError` za fakturu A. `getBatchEmailSummary` za `actorA` daje `ForbiddenError`.
20. `buildInvoiceEmail`: čisti testovi za sva tri šablona (naslov, red sa linkom samo uz `hasAccount`, red sa periodom samo uz `periodLabel`).

**Regresija:** `billing.test.ts`, `payments.test.ts`, `documents-audit.test.ts`, `tenant-isolation.test.ts`, `emailTest.test.ts`, `voting.test.ts` moraju proći bez izmjena. `activity-catalog.test.ts` prolazi sa četiri nove akcije.

**Živa provjera** (`design-system.md` §8, 1440px i 375px, mock):
- Vlasnik: Podešavanja → Moji podaci. Kartica bez adrese (checkbox onemogućen), sa adresom, uključi i isključi, „Uključeno od…".
- Predsjednik: `/vlasnici/{ownerC}` uključi sa napomenom. `/vlasnici` kolona „Račun e-poštom".
- Računovođa: nacrt serije („dobiće X od N"), izdavanje i kartica „Dostava e-poštom". U „Poslate poruke" se vidi „(PDF u prilogu)".
- Detalj fakture: red „Dostava e-poštom". Korekcija i storno uključenog dužnika.
- Produkcija (allowlist = vaša adresa): jedna faktura sebi. Provjeriti prilog (otvara se, QR čitljiv), ime pošiljaoca i SPF/DKIM/DMARC PASS. Tek onda ukloniti allowlist.

## Koraci implementacije

1. `prisma/schema.prisma`: `Party.invoiceEmailDelivery`, `Party.invoiceEmailDeliveryAt`, `NotificationMessage.attachmentDocumentId`. Migracija (R8). `npx prisma generate`.
2. `src/lib/emailAddress.ts` (nov): `emailAddressSchema` (premješten iz `emailTest.ts:86-93`). `emailTest.ts` ga uvozi.
3. `src/server/notifications/providers.ts`: `EmailAttachment`, `attachments?` u `send`, mock detalj o prilozima.
4. `src/server/notifications/mailjetEmail.ts`: `Attachments` (samo ako postoje) i `sanitizeAttachmentName`.
5. `src/server/notifications/service.ts`: nova PRIVACY napomena, `enqueueNotification`, `queueNotification` preko njega, atomsko preuzimanje u `dispatchNotification` (ukloniti tri `attempts` inkrementa), učitavanje priloga (provjera `zevId`, blob, `MAX_ATTACHMENT_BYTES`).
6. `src/server/services/documents.ts`: `ensureInvoiceDocument`. U `generateInvoicePdf` red „Korektivna faktura — zamjenjuje fakturu …".
7. `src/server/services/invoiceEmail.ts` (nov): konstante, `setInvoiceEmailDelivery`, `queueInvoiceEmails`, `dispatchInvoiceEmails`, `retryInvoiceEmails`, `sendInvoiceEmailNow`, `getInvoiceEmailStatus`, `getBatchEmailSummary`, `countOptedInDebtors`, `buildInvoiceEmail` (R6).
8. `src/server/services/billing.ts`: poziv `queueInvoiceEmails` poslije commit-a u `issueBatch`, `issueSingleInvoice`, `correctInvoice`, `cancelInvoice`.
9. `src/server/services/ownership.ts` `updateParty`: zaštita e-mail adrese dok je dostava uključena.
10. `src/lib/activity/catalog.ts` (4 akcije) i `src/lib/i18n/sr-Latn.ts` (`auditAction.party.invoice_email`).
11. `src/app/(app)/podesavanja/page.tsx`: kartica „Dostava računa" i `setMyInvoiceEmailAction` (R7).
12. `src/app/(app)/vlasnici/[id]/page.tsx`: kartica „Dostava računa e-poštom" i akcija sa napomenom. `src/app/(app)/vlasnici/page.tsx`: kolona „Račun e-poštom".
13. `src/app/(app)/fakture/serija/[id]/page.tsx`: `maxDuration`, nova `issueBatchAction` (bez starog `invoice-issued` i `deliveryStatus`), DRAFT red „dobiće X od N", ISSUED kartica „Dostava e-poštom", „Pošalji neposlate".
14. `src/app/(app)/fakture/[id]/page.tsx`: `maxDuration`, dispatch poslije korekcije i storna, red „Dostava e-poštom", „Pošalji ponovo" / „Pošalji e-poštom".
15. `src/app/(app)/podesavanja/poruke/page.tsx`: „(PDF u prilogu)" i novi tekst podnožja.
16. `.env.example` i `README.md`: `EMAIL_DAILY_SOFT_LIMIT` (opciono, podrazumijevano 180) i opis dostave računa.
17. Testovi: `tests/invoiceEmail.test.ts` (testovi 1–20). Pokrenuti `npm run typecheck && npm run lint && npm test && npm run build`.
18. `CHANGELOG.md` + verzija (poslije potvrde, P10) → 2.40.0. U CHANGELOG-u **naglasiti ručnu migraciju prije deploy-a**, prestanak slanja svima i to da fakturu dobija samo dužnik.
19. Živa provjera (1440/375, mock), pa produkcija sa allowlist-om.

## Pitanja za korisnika

- **P1. Prestaje li dosadašnje obavještenje „Nova faktura" svim vlasnicima sa e-mailom?**
  - **Preporuka: da**: e-mail o fakturi dobijaju samo oni koji su izabrali dostavu. Dosadašnja poruka ide svima bez pitanja, ne nosi PDF i tvrdi da ga nosi.
  - Alternativa: ostali i dalje dobijaju kratko obavještenje sa linkom (bez priloga).
- **P2. Koja adresa?**
  - **Preporuka: kontakt e-mail iz „Moji podaci" (`Party.email`)**, jer radi i za vlasnike bez naloga.
  - Alternative: adresa za prijavu; posebna adresa samo za račune.
- **P3. Šta e-mail sadrži?**
  - **Preporuka: PDF fakture u prilogu + link na aplikaciju (samo vlasnicima koji imaju nalog)**, uz dokumentovan izuzetak od pravila „bez finansijskih podataka u porukama".
  - Alternativa: samo link (bez izuzetka, ali vlasnici bez naloga ništa ne dobijaju).
- **P4. Iznos u tekstu poruke?**
  - **Preporuka: ne**. Iznos je u PDF-u, a tekst ima broj fakture, period, rok i poziv na broj.
  - Alternativa: dodati „Iznos za plaćanje: …" u tekst.
- **P5. Storno:**
  - **Preporuka: kratko obavještenje bez priloga** svakom dužniku sa uključenom dostavom.
  - Alternativa: ne slati ništa pri stornu.
- **P6. Ko smije uključiti dostavu umjesto vlasnika?**
  - **Preporuka: predsjednik i računovođa, uz napomenu i audit** (vlasnici bez naloga, zahtjev na papiru).
  - Alternative: samo predsjednik; samo vlasnik lično.
- **P7. Odjava:**
  - **Preporuka: samo tekst u poruci** („isključite u Podešavanja → Moji podaci ili zahtjevom upravi").
  - Alternativa: link za odjavu jednim klikom (nova javna ruta i token).
- **P8. Potvrda adrese klikom na link prije prve dostave?**
  - **Preporuka: ne sada** (adresa je ona koju je vlasnik sam upisao, a audit čuva adresu). Može se dodati kasnije.
- **P9. Vlasnik sa više jedinica (npr. stan i garaža):**
  - **Preporuka: jedan e-mail po fakturi sada** (jednostavno, status po fakturi). Spajanje u jedan e-mail sa više priloga kasnije, ako dnevni limit postane problem.
  - **P9a. Meki dnevni limit:** **Preporuka: 180 dnevno za cijelu platformu** (Mailjet besplatni plan 200), podesivo kroz `EMAIL_DAILY_SOFT_LIMIT`.
- **P10. Verzija:** patch, minor ili major? **Preporuka: minor → 2.40.0.**
- **P11. Tekst opcije:** **Preporuka: tačno „Dostavi mi račun putem e-maila"** (vaša formulacija, „e-mail" sa crticom kao u ostatku aplikacije). U ostatku teksta stoji „faktura", kako aplikacija već naziva dokument.
