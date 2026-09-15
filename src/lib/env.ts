// Central, lazily-validated access to runtime configuration.
//
// Validation happens on first access, not at module load: Dockerfile builds the
// production image with a placeholder DATABASE_URL and no other real config, and
// that must keep working (Plans/deployment-portability-plan.md §2, §13 risk 4).
// Only options that are actually consumed through this module belong in the
// schema below — EMAIL_PROVIDER/VIBER_PROVIDER, for instance, already have their
// own validated switch in src/server/notifications/providers.ts and are
// deliberately left there (§2 "Preporuka: opcija B").
//
// Deliberately NOT `import "server-only"`, unlike session.ts/actor.ts/admin.ts:
// this module is reachable from src/server/services/meetings.ts, which
// prisma/seed.ts and scripts/promote-super-admin.ts import directly under plain
// tsx — a context that never sets Next's "react-server" export condition, so
// "server-only" throws unconditionally there regardless of whether getEnv() is
// actually called (see tests/vitest.config.ts for the same tension in tests,
// worked around there with a module alias instead). Same precedent as
// src/lib/prisma.ts, which is server-only in spirit but doesn't import the
// package either, for exactly this reason.
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Public base URL — used to build approval-token links, payment QR codes and
  // password-reset links. A silent fallback to localhost in production used to
  // produce broken links instead of an error (§1.8); now it's a startup failure.
  APP_URL: z.string().url("APP_URL mora biti validan URL (npr. https://zev.example.com).").optional(),
});

export type Env = z.infer<typeof schema> & { APP_URL: string };

let cached: Env | null = null;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Nevažeća konfiguracija okruženja: ${issues}`);
  }
  const { APP_URL, ...rest } = parsed.data;
  if (APP_URL) return { ...rest, APP_URL };
  if (rest.NODE_ENV === "production") {
    throw new Error(
      "APP_URL nije postavljen. U produkciji je obavezan — koristi se za linkove u e-mailovima, QR kodove za " +
        "plaćanje i linkove za resetovanje lozinke. Postavite ga na javno dostupan URL aplikacije " +
        "(npr. https://zev.example.com)."
    );
  }
  return { ...rest, APP_URL: "http://localhost:3000" };
}

/**
 * Validated environment config. Throws a readable sr-Latn error on first bad
 * access (never at module load — see file header). Memoized: the process
 * environment doesn't change after start, so validation runs at most once.
 */
export function getEnv(): Env {
  if (!cached) cached = load();
  return cached;
}
