// Static exhaustiveness check (Plans/user-activity-log-plan.md §2, "Test iscrpnosti"): every
// `action: "..."` literal ever passed to audit() must be classified in ACTION_CATEGORY
// (src/lib/activity/catalog.ts), so a new action introduced later fails this test instead of
// silently never appearing in /aktivnosti. This is a source-scanning test, not a DB test — it
// runs with no fixture and no Prisma client, so it isn't affected by the generated-client
// staleness that blocks most other tests in a sandbox without network access (see
// zev-mvp.md project memory).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ACTION_CATEGORY } from "@/lib/activity/catalog";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Matches both the plain form (`action: "foo.bar"`) and the ternary form used in a couple of
 * places (`action: cond ? "a" : "b"`, e.g. admin.ts's admin.tenant.activate/suspend and
 * property.ts's zev.create/zev.update). Anything else — a template literal, a variable — would
 * be missed here; there are none in source today (confirmed by hand when this test was
 * written), but a future one would need a manual addition to this scan.
 */
function findActionLiterals(root: string): Set<string> {
  const found = new Set<string>();
  const plain = /action:\s*"([a-zA-Z0-9_.]+)"/g;
  const ternary = /action:\s*[^,{}]*?\?\s*"([a-zA-Z0-9_.]+)"\s*:\s*"([a-zA-Z0-9_.]+)"/g;
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(plain)) found.add(m[1]);
    for (const m of text.matchAll(ternary)) {
      found.add(m[1]);
      found.add(m[2]);
    }
  }
  return found;
}

describe("activity catalog exhaustiveness", () => {
  const root = path.resolve(__dirname, "..");
  const found = new Set<string>();
  for (const dir of ["src/server", "src/app"]) {
    for (const a of findActionLiterals(path.join(root, dir))) found.add(a);
  }

  it("every action: literal in source is classified in ACTION_CATEGORY", () => {
    const unclassified = [...found].filter((a) => !(a in ACTION_CATEGORY)).sort();
    expect(unclassified).toEqual([]);
  });

  it("ACTION_CATEGORY has no stale entries for actions no longer used in source", () => {
    const stale = Object.keys(ACTION_CATEGORY).filter((a) => !found.has(a)).sort();
    expect(stale).toEqual([]);
  });
});
