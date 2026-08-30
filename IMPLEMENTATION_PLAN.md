# Plan implementacije — ZEV MVP (Republika Srpska)

Sažet plan; detaljna arhitektura u `ARCHITECTURE.md`, pravne/finansijske pretpostavke u `LEGAL_AND_FINANCIAL_ASSUMPTIONS.md`.

## Stack
Next.js 15 (App Router) · TypeScript · PostgreSQL 16 · Prisma · Tailwind CSS · Zod ·
jose (potpisani sesijski kolačići + sesije u bazi) · bcryptjs · pdfkit + DejaVu font (sr-Latn PDF) · qrcode · Vitest.

## Slojevi
1. **Prisma šema** — kompletan domenski model, `Decimal` za sav novac, append-only audit (DB trigger zabranjuje UPDATE/DELETE nad audit tabelom i nad glasovima).
2. **Servisni sloj** (`src/server/services/*`) — sva poslovna logika i **server-side autorizacija**. UI nikada ne odlučuje o pravima. Testovi gađaju servisni sloj direktno nad test bazom.
3. **Motori** (čiste funkcije, unit-testirane): obračun stavki (9 metoda raspodjele), alokacija uplata i salda, kvorum/većina/težina glasa sa snimkom pravila po prijedlogu.
4. **UI** — server komponente + server akcije; sr-Latn rječnici (`src/lib/i18n`), jezik se dodaje bez izmjene logike.
5. **Integracije** — apstrakcija provajdera za e-mail i Viber; u MVP-u **mock** provajderi pišu u outbox tabelu i simuliraju događaje isporuke.

## Redoslijed rada
Šema+migracije → auth/RBAC/audit → imovina i vlasništvo → skupština i e-odobravanje →
fakturisanje/uplate/salda → troškovi/planovi/održavanje → dokumenti/izvještaji/notifikacije →
seed → testovi → lint/typecheck/build → isporuka.

## Prioriteti pri pritisku obima (zadržati prvo)
izolacija prava · dokaz o glasanju · tačan obračun faktura · tačna salda · nepromjenjivost izdatih dokumenata · audit istorija.
