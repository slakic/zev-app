#!/bin/sh
# Container startup: wait for PostgreSQL, apply migrations, optionally seed,
# then start the Next.js server.
set -e

echo "Čekam PostgreSQL..."
node - <<'EOF'
const { Client } = require("pg");
const url = process.env.DATABASE_URL;
(async () => {
  for (let i = 0; i < 60; i++) {
    const c = new Client({ connectionString: url });
    try {
      await c.connect();
      await c.end();
      console.log("PostgreSQL je dostupan.");
      process.exit(0);
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error("PostgreSQL nije dostupan nakon 120s.");
  process.exit(1);
})();
EOF

echo "Primjenjujem migracije..."
node scripts/migrate.mjs apply

if [ "$SEED_ON_START" = "1" ]; then
  echo "Seed (preskače se ako baza već ima podatke)..."
  npx tsx prisma/seed.ts || true
fi

echo "Pokrećem aplikaciju..."
exec npm start
