// Wait for PostgreSQL to accept connections. Standalone so docker-entrypoint.sh can
// *call* it rather than embedding the retry loop inline
// (Plans/deployment-portability-plan.md §5) — the entrypoint is meant to sequence
// steps, not contain their logic.
//
// Redundant with docker-compose.yml's `depends_on: db: condition: service_healthy`
// for the default Docker Compose flow, but kept as defense-in-depth for `docker run`
// without Compose, or against an external/managed Postgres not guaranteed to be up
// yet at container start.
import "dotenv/config";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const MAX_ATTEMPTS = 60;
const DELAY_MS = 2000;

let connected = false;
for (let i = 0; i < MAX_ATTEMPTS; i++) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.end();
    connected = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

if (connected) {
  console.log("PostgreSQL je dostupan.");
  process.exit(0);
} else {
  console.error(`PostgreSQL nije dostupan nakon ${(MAX_ATTEMPTS * DELAY_MS) / 1000}s.`);
  process.exit(1);
}
