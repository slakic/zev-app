import "dotenv/config";
import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  // Reset the test database and apply all migrations (WASM schema engine).
  execSync("node scripts/migrate.mjs reset", {
    env: { ...process.env, MIGRATE_DATABASE_URL: url },
    stdio: "inherit",
  });
}
