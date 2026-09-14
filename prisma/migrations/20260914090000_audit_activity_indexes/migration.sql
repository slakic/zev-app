-- Faza 1 of the curated activity feed (Plans/user-activity-log-plan.md §5, §8).
--
-- AuditEvent currently has only @@index([targetType, targetId]) and @@index([action])
-- (schema.prisma). The feed's read pattern is `where: { zevId, ... }, orderBy: {
-- createdAt: "desc" }` with an optional `actorId` filter — neither existing index
-- covers that, so today's query is a sequential scan plus a full sort of the entire
-- platform-wide, append-only-and-growing audit table. These two indexes must exist
-- before any paginated feed is built on top of this table.
--
-- Hand-written for the same reason as every other non-init migration in this project:
-- the bundled schema-engine-wasm cannot introspect this database (PL/pgSQL trigger
-- functions from append_only_guards break its Postgres catalog scan).
CREATE INDEX "AuditEvent_zevId_createdAt_idx" ON "AuditEvent" ("zevId", "createdAt" DESC);
CREATE INDEX "AuditEvent_zevId_actorId_createdAt_idx" ON "AuditEvent" ("zevId", "actorId", "createdAt" DESC);
