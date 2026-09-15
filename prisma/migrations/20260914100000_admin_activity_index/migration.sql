-- Plans/user-activity-log-plan.md §9, §8 Faza 3: super-admin cross-tenant activity view
-- (/admin/aktivnosti). A platform-wide query with no zevId filter (e.g. "svi ZEV nalozi")
-- isn't covered by AuditEvent's existing [zevId, createdAt] / [zevId, actorId, createdAt]
-- composite indexes, since both lead with zevId.
--
-- Hand-written, not `migrate.mjs create`-generated — see zev-mvp.md project memory: the
-- sandbox's local Postgres _prisma_migrations history is behind schema.prisma and the
-- bundled schema-engine-wasm cannot introspect this database (append_only_guards trigger
-- functions break its Postgres catalog scan), so `create` here produces a full from-scratch
-- schema dump instead of an incremental diff.

CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent" ("createdAt" DESC);
