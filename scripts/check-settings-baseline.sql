-- Read-only verification before tenant-scoping the Setting table.
-- 1) Confirms which Zev is oldest (the one that inherits today's global Setting rows).
SELECT id, "legalName", "createdAt" FROM "Zev" ORDER BY "createdAt" ASC, id ASC;

-- 2) Flags any Setting row updated AFTER a newer tenant was created — a sign that
--    someone acting as the newer tenant's president saved a value that landed in
--    the (currently global) Setting table and overwrote the real ZEV's configured value.
SELECT key, value, "updatedAt" FROM "Setting" ORDER BY "updatedAt" DESC;
