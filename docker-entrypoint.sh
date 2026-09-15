#!/bin/sh
# Container startup: wait for PostgreSQL, apply migrations, optionally seed,
# then start the Next.js server. Each step below is exactly the command already
# documented for manual/CI use (README, package.json) — this script only
# sequences them, it doesn't contain migration/seed/wait logic itself
# (Plans/deployment-portability-plan.md §5), so a platform without this
# entrypoint runs the same three commands directly.
set -e

echo "Čekam PostgreSQL..."
node scripts/wait-for-db.mjs

echo "Primjenjujem migracije..."
npm run db:migrate

if [ "$SEED_ON_START" = "1" ]; then
  echo "Seed (preskače se ako baza već ima podatke)..."
  npm run db:seed || true
fi

echo "Pokrećem aplikaciju..."
exec npm start
