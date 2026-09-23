-- Additive, safe step of the User<->Party relationship flip (Plans/party-per-tenant-plan.md
-- §3.3). One User can now have one Party PER Zev it holds a Membership in, instead of at
-- most one Party ever, globally (User.partyId, still present, still authoritative until the
-- follow-up migration <ts>_party_user_link_drop_legacy removes it).
--
-- Safe under a rolling deploy: this migration only ADDS a column, an index and a constraint.
-- Old application code (which only ever reads/writes User.partyId) is unaffected — Prisma
-- lists columns explicitly, so a column it doesn't know about is invisible to it. See §3.2/§8.1
-- for why this must stay split from the column-drop migration.

-- 1. New column, empty.
ALTER TABLE "Party" ADD COLUMN "userId" TEXT;

-- 2. Backfill from the existing link. Safe to assume a clean 1:1 today: User.partyId is
--    @unique + a real FK, so every User with a partyId points at exactly one Party.
UPDATE "Party" p SET "userId" = u."id" FROM "User" u WHERE u."partyId" = p."id";

-- 3. Loud sanity check: if any User.partyId failed to carry over, abort the whole migration
--    (it runs inside a transaction) instead of silently leaving a User whose Party doesn't
--    know about it. Same spirit as 20260908120000_drop_zevid_default's "fail loudly instead
--    of silently misattributing".
DO $$
DECLARE missing INT;
BEGIN
  SELECT count(*) INTO missing FROM "User" u
   WHERE u."partyId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Party" p WHERE p."id" = u."partyId" AND p."userId" = u."id");
  IF missing > 0 THEN
    RAISE EXCEPTION 'Backfill nepotpun: % User redova bez prenesene veze', missing;
  END IF;
END $$;

-- 4. Constraints. NULL values are NOT considered equal in a Postgres unique index by
--    default (NULLS DISTINCT) — so any number of Party rows with userId = NULL are still
--    allowed per Zev; only an actual (userId, zevId) pair must be unique.
CREATE UNIQUE INDEX "Party_userId_zevId_key" ON "Party"("userId", "zevId");
ALTER TABLE "Party" ADD CONSTRAINT "Party_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "User"."partyId" is deliberately left untouched here — see
-- <ts>_party_user_link_drop_legacy for its removal, once this column is confirmed live and
-- write paths have been switched over.
