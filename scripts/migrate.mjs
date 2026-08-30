// Offline-friendly Prisma migration tool.
//
// The standard `prisma migrate` CLI downloads a native Rust schema-engine binary,
// which is not possible in offline / restricted-network environments. This script
// drives the official @prisma/schema-engine-wasm (pure WebAssembly, installed from
// npm) through the pg driver adapter instead. It reads/writes the standard
// prisma/migrations directory and the standard _prisma_migrations table, so it is
// fully interchangeable with `npx prisma migrate dev` / `migrate deploy` on
// machines with normal network access.
//
// Usage:
//   node scripts/migrate.mjs create <name>   # generate a new migration from schema changes
//   node scripts/migrate.mjs apply           # apply pending migrations (like migrate deploy)
//   node scripts/migrate.mjs reset           # drop schema & re-apply everything (dev only)
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { bindMigrationAwareSqlAdapterFactory } from "@prisma/driver-adapter-utils";

globalThis.PRISMA_WASM_PANIC_REGISTRY = {
  msg: "",
  set_message(m) { this.msg = m; console.error("WASM PANIC:", m); },
  get() { return this.msg; },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "prisma", "migrations");
const schemaPath = path.join(root, "prisma", "schema.prisma");

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const { SchemaEngine } = await import("@prisma/schema-engine-wasm");

function loadMigrationsList() {
  fs.mkdirSync(migrationsDir, { recursive: true });
  const lockfilePath = path.join(migrationsDir, "migration_lock.toml");
  const lockfile = {
    path: "migration_lock.toml",
    content: fs.existsSync(lockfilePath) ? fs.readFileSync(lockfilePath, "utf8") : null,
  };
  const migrationDirectories = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const file = path.join(migrationsDir, name, "migration.sql");
      let content;
      try {
        content = { tag: "ok", value: fs.readFileSync(file, "utf8") };
      } catch (e) {
        content = { tag: "error", value: String(e) };
      }
      return { path: name, migrationFile: { path: "migration.sql", content } };
    });
  return {
    baseDir: migrationsDir,
    lockfile,
    shadowDbInitScript: "",
    migrationDirectories,
  };
}

const filters = { externalTables: [], externalEnums: [] };
const schema = {
  files: [{ path: schemaPath, content: fs.readFileSync(schemaPath, "utf8") }],
};

const factory = new PrismaPg({ connectionString: url });
// adapter-pg's executeScript splits scripts on ";", which breaks dollar-quoted
// and quoted plpgsql bodies. Postgres happily executes multi-statement strings
// in one round-trip, so patch executeScript to send the script whole.
function patchAdapter(adapterPromise) {
  return adapterPromise.then((a) => {
    const pool = a.underlyingDriver();
    a.executeScript = async (script) => {
      await pool.query(script);
    };
    return a;
  });
}
const patchedFactory = {
  adapterName: factory.adapterName,
  provider: factory.provider,
  connect: () => patchAdapter(factory.connect()),
  connectToShadowDb: () => patchAdapter(factory.connectToShadowDb()),
};
const adapter = bindMigrationAwareSqlAdapterFactory(patchedFactory);
const engine = await SchemaEngine.new(
  { datamodels: [[schemaPath, fs.readFileSync(schemaPath, "utf8")]] },
  () => 0,
  adapter
);

const cmd = process.argv[2];

try {
  if (cmd === "create") {
    const name = process.argv[3];
    if (!name) throw new Error("Usage: node scripts/migrate.mjs create <name>");
    // Diff the live database (which must be up to date with all existing
    // migrations — run `apply` first) against the target schema. This avoids
    // the shadow database, which the WASM engine cannot create by itself.
    // Introspect the live DB to a datamodel, then diff datamodel -> datamodel.
    // (The WASM engine supports neither url diff targets nor shadow databases.)
    let fromTarget = { tag: "empty" };
    try {
      const intro = await engine.introspect({
        schema: {
          files: [
            {
              path: schemaPath,
              content: 'datasource db {\n  provider = "postgresql"\n}\n',
            },
          ],
        },
        baseDirectoryPath: root,
        force: true,
        compositeTypeDepth: -1,
        namespaces: null,
      });
      const introspected = intro.schema.files.filter((f) => f.content.trim().length > 0);
      if (introspected.length > 0) {
        fromTarget = { tag: "schemaDatamodel", files: introspected };
      }
    } catch {
      // Empty database (P4001) -> diff from empty schema.
    }
    const out = await engine.diff({
      from: fromTarget,
      to: { tag: "schemaDatamodel", files: schema.files },
      script: true,
      exitCode: null,
      filters,
    });
    const script = (out.stdout ?? "").trim();
    if (!script || script === "-- This is an empty migration.") {
      console.log("No changes detected; no migration created.");
    } else {
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const dirName = `${stamp}_${name}`;
      const dir = path.join(migrationsDir, dirName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "migration.sql"), script + "\n");
      const lockfilePath = path.join(migrationsDir, "migration_lock.toml");
      if (!fs.existsSync(lockfilePath)) {
        fs.writeFileSync(
          lockfilePath,
          `# Please do not edit this file manually\n# It should be added in your version-control system (e.g., Git)\nprovider = "postgresql"\n`
        );
      }
      console.log(`Created migration ${dirName}`);
    }
  } else if (cmd === "apply") {
    const out = await engine.applyMigrations({ migrationsList: loadMigrationsList(), filters });
    if (out.appliedMigrationNames.length === 0) console.log("Database is up to date.");
    else console.log("Applied:", out.appliedMigrationNames.join(", "));
  } else if (cmd === "reset") {
    await engine.reset({ filter: filters });
    const out = await engine.applyMigrations({ migrationsList: loadMigrationsList(), filters });
    console.log("Database reset. Applied:", out.appliedMigrationNames.join(", "));
  } else {
    console.error("Usage: node scripts/migrate.mjs <create <name>|apply|reset>");
    process.exit(1);
  }
} catch (e) {
  console.error("Migration command failed:", e);
  process.exitCode = 1;
} finally {
  engine.free();
  process.exit(process.exitCode ?? 0);
}
