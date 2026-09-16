// One-time backfill: legacy Docker rows that still carry an absolute on-disk `filePath`
// (from before storage moved into Postgres, Plans/deployment-portability-plan.md §3) get
// their bytes copied into DocumentBlob/AttachmentBlob, then filePath is cleared.
//
// Not needed for correctness — the pad-back read added in Phase 1 (readDocumentFile/
// readAttachmentFile falling back to fs.readFileSync when no blob exists) works
// indefinitely without this. Only run it when actually retiring the disk a Docker
// deployment's `var/storage` volume lives on — e.g. moving that deployment to a
// platform with no persistent disk.
//
// Defaults to a dry run (reports what it would do, writes nothing). Pass --apply to
// actually write.
//
// Usage:
//   npx tsx scripts/backfill-storage-blobs.ts             # dry run
//   npx tsx scripts/backfill-storage-blobs.ts --apply      # actually migrate
//
// or, inside the app container (source files must be reachable, i.e. the legacy
// filePath values must resolve on whichever filesystem this runs against):
//   docker compose exec app npx tsx scripts/backfill-storage-blobs.ts [--apply]
import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma";

export async function backfillDocuments(apply: boolean): Promise<{ migrated: number; skipped: number }> {
  const rows = await prisma.document.findMany({
    where: { filePath: { not: null } },
    select: { id: true, filePath: true, number: true },
  });
  let migrated = 0;
  let skipped = 0;
  for (const row of rows) {
    const existingBlob = await prisma.documentBlob.findUnique({ where: { documentId: row.id } });
    if (existingBlob) {
      // Already has a blob (shouldn't normally happen alongside a non-null filePath, but
      // be defensive) — just clear the now-redundant filePath.
      if (apply) await prisma.document.update({ where: { id: row.id }, data: { filePath: null } });
      skipped++;
      continue;
    }
    if (!row.filePath || !fs.existsSync(row.filePath)) {
      console.error(`  PRESKOČENO (fajl ne postoji): Document ${row.id} (${row.number}) -> ${row.filePath}`);
      skipped++;
      continue;
    }
    const buffer = fs.readFileSync(row.filePath);
    console.log(`  ${apply ? "Prebacujem" : "[dry-run] Bi prebacio"}: Document ${row.id} (${row.number}), ${buffer.length} B`);
    if (apply) {
      await prisma.$transaction(async (tx) => {
        await tx.documentBlob.create({ data: { documentId: row.id, data: new Uint8Array(buffer) } });
        await tx.document.update({ where: { id: row.id }, data: { filePath: null } });
      });
    }
    migrated++;
  }
  return { migrated, skipped };
}

export async function backfillAttachments(apply: boolean): Promise<{ migrated: number; skipped: number }> {
  const rows = await prisma.attachment.findMany({
    where: { filePath: { not: null } },
    select: { id: true, filePath: true, filename: true },
  });
  let migrated = 0;
  let skipped = 0;
  for (const row of rows) {
    const existingBlob = await prisma.attachmentBlob.findUnique({ where: { attachmentId: row.id } });
    if (existingBlob) {
      if (apply) await prisma.attachment.update({ where: { id: row.id }, data: { filePath: null } });
      skipped++;
      continue;
    }
    if (!row.filePath || !fs.existsSync(row.filePath)) {
      console.error(`  PRESKOČENO (fajl ne postoji): Attachment ${row.id} (${row.filename}) -> ${row.filePath}`);
      skipped++;
      continue;
    }
    const buffer = fs.readFileSync(row.filePath);
    console.log(`  ${apply ? "Prebacujem" : "[dry-run] Bi prebacio"}: Attachment ${row.id} (${row.filename}), ${buffer.length} B`);
    if (apply) {
      await prisma.$transaction(async (tx) => {
        await tx.attachmentBlob.create({ data: { attachmentId: row.id, data: new Uint8Array(buffer) } });
        await tx.attachment.update({ where: { id: row.id }, data: { filePath: null } });
      });
    }
    migrated++;
  }
  return { migrated, skipped };
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("Dry run (ništa se ne upisuje) — pokrenite sa --apply da stvarno prebacite.\n");
  }

  const docs = await backfillDocuments(apply);
  const attachments = await backfillAttachments(apply);

  if (docs.migrated + docs.skipped + attachments.migrated + attachments.skipped === 0) {
    console.log("Nema naslijeđenih redova sa filePath — nema šta da se prebaci.");
    return;
  }

  console.log(
    `\n${apply ? "Gotovo." : "Dry-run gotov."} ` +
      `Dokumenti: ${docs.migrated} prebačeno, ${docs.skipped} preskočeno. ` +
      `Prilozi: ${attachments.migrated} prebačeno, ${attachments.skipped} preskočeno.`
  );
}

// Only auto-run when executed directly (`tsx scripts/backfill-storage-blobs.ts`), not when
// imported — tests/backfill-storage-blobs.test.ts imports backfillDocuments/
// backfillAttachments directly and must not trigger process.exit().
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main()
    .catch((e) => {
      console.error("Backfill nije uspio:", e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
      process.exit(process.exitCode ?? 0);
    });
}
