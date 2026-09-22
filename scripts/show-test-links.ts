// Test-only helper: prints the newest voting-invitation links + verification codes from
// the outbox, so the assembly/voting flow can be exercised end-to-end in a real browser
// without a real e-mail provider. Refuses (with an explanation) unless SHOW_TEST_LINKS="1"
// plus the other two conditions in src/server/notifications/testOutbox.ts are all met —
// see Plans/skupstina-draft-management-and-test-outbox-plan.md §B.3 for why.
//
//   npx tsx scripts/show-test-links.ts
//
// or, inside the app container:
//
//   docker compose exec app npm run test:links
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { isTestOutboxEnabled, listApprovalLinks } from "../src/server/notifications/testOutbox";

async function main() {
  if (!isTestOutboxEnabled()) {
    console.error("Testni prikaz linkova je isključen. Potrebna su OBA uslova:");
    console.error(`  SHOW_TEST_LINKS="1"        trenutno: ${JSON.stringify(process.env.SHOW_TEST_LINKS ?? null)}`);
    console.error(`  EMAIL_PROVIDER == "mock"   trenutno: ${JSON.stringify(process.env.EMAIL_PROVIDER ?? "mock")}`);
    console.error("Ovo je namjerno — vidi Plans/skupstina-draft-management-and-test-outbox-plan.md §B.3.");
    process.exitCode = 1;
    return;
  }

  const rows = await listApprovalLinks({ limit: 20 });
  if (rows.length === 0) {
    console.log("Outbox je prazan — još nijedno glasanje nije otvoreno.");
    return;
  }

  console.log(`Posljednjih ${rows.length} glasačkih poruka (najnovije prvo):\n`);
  for (const r of rows) {
    console.log(`- ${r.toAddress}  [${r.template ?? "?"}, poruka: ${r.status}, token: ${r.tokenStatus ?? "nepoznat"}]  ${r.createdAt.toISOString()}`);
    console.log(`    link: ${r.link ?? "(nije pronađen u tijelu poruke)"}`);
    console.log(`    kod:  ${r.code ?? "(nije pronađen u tijelu poruke)"}`);
  }
}

main()
  .catch((e) => {
    console.error("Čitanje testnih linkova nije uspjelo:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
