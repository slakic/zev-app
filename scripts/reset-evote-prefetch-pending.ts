// One-time data fix for the v2.41.0 bug: a Next.js <Link> prefetch of the e-vote consent download
// (/api/dokumenti/saglasnost/[partyId]) ran the route on mere hover / scroll, which moved owners
// from NONE ("Nije zatražena") to PENDING ("Izjava preuzeta — čeka se potpis") without anyone
// downloading anything. A prefetch and a real download cannot be told apart afterwards, so every
// unsigned PENDING goes back to NONE (decision of the user, 2026-10-24); an owner who really
// printed the form just downloads it again. SIGNED and REVOKED are never touched.
// Each reset is audited (system actor, action "party.evote_consent.reset" — shown as SYSTEM).
//
// Defaults to a dry run (reports what it would do, writes nothing). Pass --apply to write.
//
// Usage (against production, with its direct connection string):
//   DATABASE_URL="postgresql://…" npx tsx scripts/reset-evote-prefetch-pending.ts            # dry run
//   DATABASE_URL="postgresql://…" npx tsx scripts/reset-evote-prefetch-pending.ts --apply    # write
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { audit } from "../src/server/audit";

async function main() {
  const apply = process.argv.includes("--apply");
  const pending = await prisma.party.findMany({
    where: { eVoteConsentStatus: "PENDING" },
    select: { id: true, zevId: true, eVoteConsentEmail: true },
  });
  console.log(`${apply ? "Vraćam" : "[proba] Vratio bih"} ${pending.length} vlasnika iz „Izjava preuzeta" u „Nije zatražena".`);
  if (!apply) return;
  for (const p of pending) {
    const res = await prisma.party.updateMany({
      where: { id: p.id, eVoteConsentStatus: "PENDING" }, // never overwrite a status changed meanwhile
      data: { eVoteConsentStatus: "NONE", eVoteConsentEmail: null },
    });
    if (res.count === 0) continue;
    await audit(
      { label: "system" },
      {
        action: "party.evote_consent.reset",
        targetType: "Party",
        targetId: p.id,
        zevId: p.zevId,
        before: { status: "PENDING", email: p.eVoteConsentEmail },
        after: { status: "NONE" },
        reason: "v2.41.0: status postavljen prefetch-om linka, ne stvarnim preuzimanjem izjave",
      }
    );
  }
  console.log("Gotovo.");
}

main().finally(() => prisma.$disconnect());
