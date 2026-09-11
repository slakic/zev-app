import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // "server-only" (imported by session.ts, actor.ts, admin.ts, memberships.ts) only
      // resolves to its no-op empty.js under the "react-server" package-export condition,
      // which real usage gets from Next's own webpack/turbopack config — Vitest never sets
      // it, so importing the package normally always hits its index.js (an unconditional
      // `throw`). That throw is meant to catch server-only code from leaking into a
      // browser bundle; it isn't a check Vitest's plain Node module graph can ever satisfy,
      // so alias it straight to the package's own empty.js here — this doesn't weaken the
      // real Next.js build's enforcement (which is untouched), it only stops the test
      // runner from tripping a check that doesn't apply to it. Needed since Korak 2 added
      // the first test-reachable import chain into session.ts (tests/tenant-isolation.test.ts
      // -> memberships.ts -> session.ts); before that this package was never actually
      // evaluated by the test suite.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
