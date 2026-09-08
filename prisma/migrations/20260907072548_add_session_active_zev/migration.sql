-- Auth cutover, part 1: Session tracks which Zev (tenant) it's currently acting within.
-- Hand-written for the same reason as add_multitenancy_foundations (see that migration
-- and the "Stack & environment facts" note in zev-app-guidelines: `scripts/migrate.mjs
-- create` cannot introspect this database once it has PL/pgSQL trigger functions).
--
-- No data backfill here on purpose: unlike the soft zevId columns added earlier,
-- `activeZevId` is resolved lazily and persisted the first time each session is read
-- (see getAuthContext in src/server/auth/session.ts) rather than backfilled up front —
-- existing sessions simply pick up their tenant on their next request. Sessions are
-- short-lived (12h TTL) so this self-heals almost immediately either way.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "activeZevId" TEXT;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_activeZevId_fkey" FOREIGN KEY ("activeZevId") REFERENCES "Zev"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Session_activeZevId_idx" ON "Session"("activeZevId");
