-- Tenant-scope the Setting table (docs/multitenancy-plan.md §6.3/§8 addendum,
-- 2026-09-09). Setting was the one model deliberately left untouched by the earlier
-- multitenancy steps (flat key-value config: retention.*, emergency.*, interest.*,
-- invoice.dueDay, board.*) — invisible with a single tenant, but shared globally
-- across tenants once a second one exists (tenant B reading/overwriting tenant A's
-- configured values, since `key` alone was the primary key).
--
-- Confirmed with the user before writing this: verified against the live database
-- that (a) only one Zev row exists and (b) zero Setting rows exist at all (nobody has
-- ever saved a value through /podesavanja's "Konfigurabilni pravni i finansijski
-- parametri" panel) — so there is no live "current settings" data to preserve or risk
-- contaminating. "Set current settings as default for all tenants" therefore reduces
-- to: every tenant (existing and future) starts from the same hardcoded baseline now
-- consolidated in src/lib/settings-defaults.ts. The backfill logic below is still
-- written generally (attribute any pre-existing global rows to the oldest Zev, then
-- give every tenant a full copy of the baseline) so this migration is also correct to
-- run against a database that isn't in that exact empty state.
--
-- Composite PK (zevId, key) rather than this schema's usual surrogate id +
-- @@unique([zevId, key]): Setting is never referenced by FK from anywhere else and is
-- only ever addressed as (tenant, key) — see the schema.prisma comment on the model.
--
-- Hand-written for the same reason as every other non-init migration in this project:
-- the bundled schema-engine-wasm cannot introspect this database (PL/pgSQL trigger
-- functions from append_only_guards break its Postgres catalog scan).

-- 1. Add the column, nullable for now so existing rows (if any) can be backfilled.
ALTER TABLE "Setting" ADD COLUMN "zevId" TEXT;

-- 2. Attach any pre-existing global rows to the oldest tenant — the same "earliest
--    Zev" rule the now-dropped default_zev_id() used for every other table.
UPDATE "Setting"
   SET "zevId" = (SELECT "id" FROM "Zev" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
 WHERE "zevId" IS NULL;

-- 3. Only reachable on a database with zero Zev rows (fresh db:reset before db:seed),
--    where Setting is necessarily empty too — a no-op safety net so step 4 never fails.
DELETE FROM "Setting" WHERE "zevId" IS NULL;

-- 4. Lock the column down and swap the primary key before inserting anything, so the
--    ON CONFLICT below has a real (zevId, key) constraint to target.
ALTER TABLE "Setting" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey";
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("zevId", "key");

-- 5. Give every existing tenant the full default baseline. ON CONFLICT preserves
--    whatever the oldest tenant already had from step 2 (i.e. nothing is overwritten).
--    Values are JSON strings (the app stores/reads Setting.value via String(value)),
--    so each literal here must stay double-quoted — '"3"'::jsonb, not '3'::jsonb.
INSERT INTO "Setting" ("zevId", "key", "value", "updatedAt")
SELECT z."id", d.key, d.value::jsonb, NOW()
  FROM "Zev" z
 CROSS JOIN (VALUES
   ('retention.financialYears',        '"11"'),
   ('retention.voteIpDays',            '"30"'),
   ('emergency.costThreshold',         '"500"'),
   ('interest.enabled',                '"false"'),
   ('invoice.dueDay',                  '"15"'),
   ('board.size',                      '"3"'),
   ('board.termYears',                 '"4"'),
   ('board.presidentIsBoardPresident', '"true"')
 ) AS d(key, value)
    ON CONFLICT ("zevId", "key") DO NOTHING;

-- 6. FK — matches every other tenant-scoped table's zevId relation.
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_zevId_fkey"
  FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
