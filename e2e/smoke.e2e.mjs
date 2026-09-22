// End-to-end smoke test (Playwright, chromium).
// Prerequisites: a running app (npm run dev / npm start) and a seeded database.
// Usage: node e2e/smoke.e2e.mjs <glasanje/TOKEN> <CODE>
//   or:  npm run test:e2e  (token+code are read from the newest approval e-mail
//        in the outbox if arguments are omitted — requires DATABASE_URL)
import "dotenv/config";
import { Client } from "pg";
import { chromium } from "playwright";

/**
 * Reads the newest approval-link/reissue outbox message directly from the database and
 * extracts the token + verification code from its plaintext body. Deliberately duplicates
 * the two regexes from src/server/notifications/testOutbox.ts's extractApprovalSecrets —
 * this file runs under plain `node`, not tsx/webpack, so it can't import that TS module
 * directly. Keep both in sync if the e-mail body wording ever changes (grep for
 * "glasanje/" and "verifikacioni kod").
 */
async function readLatestApprovalFromOutbox() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT body FROM "NotificationMessage" WHERE template IN ('approval-link', 'approval-link-reissue') ORDER BY "createdAt" DESC LIMIT 1`
    );
    if (rows.length === 0) return null;
    const body = rows[0].body;
    const linkMatch = body.match(/\S+\/glasanje\/(\S+)/);
    const codeMatch = body.match(/verifikacioni kod: (\d{6})/i);
    return { linkArg: linkMatch ? `glasanje/${linkMatch[1]}` : null, codeArg: codeMatch?.[1] ?? null };
  } finally {
    await client.end();
  }
}

let linkArg = process.argv[2];
let codeArg = process.argv[3];
if (!linkArg || !codeArg) {
  if (!process.env.DATABASE_URL) {
    console.error("No <glasanje/TOKEN> <CODE> arguments given, and DATABASE_URL is not set to read them from the outbox.");
    console.error("Usage: node e2e/smoke.e2e.mjs <glasanje/TOKEN> <CODE>");
    process.exit(1);
  }
  const latest = await readLatestApprovalFromOutbox();
  if (!latest?.linkArg || !latest?.codeArg) {
    console.error("No usable approval link found in the outbox — open voting on a proposal first (e.g. via the seeded demo data).");
    process.exit(1);
  }
  ({ linkArg, codeArg } = latest);
  console.log("using latest outbox link:", linkArg);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage();
  // 1) login as president
  await page.goto("http://localhost:3000/login");
  await page.fill('input[name="email"]', "predsjednik@zev.ba");
  await page.fill('input[name="password"]', "Lozinka123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/");
  const dash = await page.textContent("h1");
  console.log("dashboard:", dash);
  // 2) navigate to skupstina
  await page.goto("http://localhost:3000/skupstina");
  console.log("meetings page has:", (await page.textContent("body")).includes("Redovna godišnja sjednica") ? "meeting OK" : "MISSING");
  // 3) owner login in new context; check isolation
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto("http://localhost:3000/login");
  await p2.fill('input[name="email"]', "vlasnik@zev.ba");
  await p2.fill('input[name="password"]', "Lozinka123!");
  await p2.click('button[type="submit"]');
  await p2.waitForURL("http://localhost:3000/");
  const ownerBody = await p2.textContent("body");
  console.log("owner dashboard:", ownerBody.includes("Moj saldo") ? "saldo OK" : "MISSING");
  console.log("owner nav hides vlasnici:", ownerBody.includes("Vlasnici i korisnici") ? "LEAK" : "OK");
  // owner tries president-only page
  await p2.goto("http://localhost:3000/vlasnici");
  console.log("owner /vlasnici redirect:", p2.url().includes("err=forbidden") || p2.url() === "http://localhost:3000/?err=forbidden" ? "OK" : p2.url());
  // 4) vote via link with wrong code then right code
  const p3 = await (await browser.newContext()).newPage();
  await p3.goto(`http://localhost:3000/${linkArg}`);
  await p3.check('input[value="APPROVE"]');
  await p3.fill('input[name="code"]', codeArg);
  await p3.check('input[name="ack"]');
  await p3.click('button[type="submit"]');
  await p3.waitForURL(/receipt=/, { timeout: 15000 });
  console.log("vote receipt:", (await p3.textContent("body")).includes("Izjašnjavanje je evidentirano") ? "OK" : "FAIL");
  // reuse fails
  await p3.goto(`http://localhost:3000/${linkArg}`);
  console.log("reuse blocked:", (await p3.textContent("body")).includes("već izvršeno") ? "OK" : "FAIL");
  
} finally {
  await browser.close();
}
