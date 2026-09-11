// Bootstrap script: grants platform-level super-admin access to an existing user.
//
// isSuperAdmin is a User-level flag, unrelated to any single Zev (see
// docs/multitenancy-plan.md §4.3/§8.2) — it is intentionally NOT exposed as an
// in-app route or button. The only way to grant it is this script, run manually
// against the database after deploy, by whoever operates the platform:
//
//   npx tsx scripts/promote-super-admin.ts <email>
//
// or, inside the app container:
//
//   docker compose exec app npx tsx scripts/promote-super-admin.ts <email>
//
// The user must already exist (sign them up / seed them first) — this script
// only flips the flag, it never creates accounts or sets passwords.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx scripts/promote-super-admin.ts <email>");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Nema korisnika sa email adresom "${email}".`);
    process.exitCode = 1;
    return;
  }

  if (user.isSuperAdmin) {
    console.log(`Korisnik "${email}" je već super admin. Ništa nije promijenjeno.`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isSuperAdmin: true },
  });

  console.log(`Gotovo: "${email}" je sada super admin.`);
}

main()
  .catch((e) => {
    console.error("Promocija u super admina nije uspjela:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
