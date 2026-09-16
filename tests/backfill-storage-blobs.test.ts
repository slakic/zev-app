// scripts/backfill-storage-blobs.ts contract (Plans/deployment-portability-plan.md §3.3,
// Faza 5): a legacy filePath row gets its bytes copied into DocumentBlob/AttachmentBlob and
// filePath cleared when apply=true; a dry run (apply=false) reports it but writes nothing;
// a row whose file is missing from disk is skipped, not thrown on.
//
// backfillDocuments/backfillAttachments scan *all* legacy rows in the database, not just
// ones this test creates — assertions on the aggregate counters use >= rather than ===
// to stay correct alongside other tests' own legacy rows (e.g. document-storage.test.ts's
// fallback-read fixture) in the shared test database.
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createFixture, uid, type Fixture } from "./helpers";
import { backfillDocuments, backfillAttachments } from "../scripts/backfill-storage-blobs";

describe("backfill-storage-blobs", () => {
  const legacyFiles: string[] = [];

  afterAll(() => {
    for (const p of legacyFiles) {
      try {
        fs.unlinkSync(p);
      } catch {
        // best-effort cleanup
      }
    }
  });

  async function createLegacyDocument(f: Fixture, content: string) {
    const buffer = Buffer.from(content);
    const legacyPath = path.join(os.tmpdir(), `zev-legacy-doc-${uid("x")}.pdf`);
    fs.writeFileSync(legacyPath, buffer);
    legacyFiles.push(legacyPath);
    const row = await prisma.document.create({
      data: {
        zevId: f.zev.id,
        type: "OTHER",
        number: uid("LEGACY-DOC"),
        title: "Legacy document",
        status: "FINAL",
        filePath: legacyPath,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      },
    });
    return { row, buffer };
  }

  async function createLegacyAttachment(f: Fixture, content: string) {
    const buffer = Buffer.from(content);
    const legacyPath = path.join(os.tmpdir(), `zev-legacy-att-${uid("x")}.pdf`);
    fs.writeFileSync(legacyPath, buffer);
    legacyFiles.push(legacyPath);
    const row = await prisma.attachment.create({
      data: {
        zevId: f.zev.id,
        filename: "legacy.pdf",
        mime: "application/pdf",
        size: buffer.length,
        filePath: legacyPath,
        category: "OTHER",
      },
    });
    return { row, buffer };
  }

  it("dry run reports rows but writes nothing", async () => {
    const f = await createFixture("backfill-dryrun");
    const { row } = await createLegacyDocument(f, "dry run content");

    const result = await backfillDocuments(false);
    expect(result.migrated).toBeGreaterThanOrEqual(1);

    const stillLegacy = await prisma.document.findUniqueOrThrow({ where: { id: row.id } });
    expect(stillLegacy.filePath).not.toBeNull();
    const blob = await prisma.documentBlob.findUnique({ where: { documentId: row.id } });
    expect(blob).toBeNull();
  });

  it("apply migrates a legacy Document into DocumentBlob and clears filePath", async () => {
    const f = await createFixture("backfill-doc");
    const { row, buffer } = await createLegacyDocument(f, "real document content to migrate");

    await backfillDocuments(true);

    const migrated = await prisma.document.findUniqueOrThrow({ where: { id: row.id } });
    expect(migrated.filePath).toBeNull();
    const blob = await prisma.documentBlob.findUniqueOrThrow({ where: { documentId: row.id } });
    expect(Buffer.from(blob.data).equals(buffer)).toBe(true);
  });

  it("apply migrates a legacy Attachment into AttachmentBlob and clears filePath", async () => {
    const f = await createFixture("backfill-att");
    const { row, buffer } = await createLegacyAttachment(f, "attachment content to migrate");

    await backfillAttachments(true);

    const migrated = await prisma.attachment.findUniqueOrThrow({ where: { id: row.id } });
    expect(migrated.filePath).toBeNull();
    const blob = await prisma.attachmentBlob.findUniqueOrThrow({ where: { attachmentId: row.id } });
    expect(Buffer.from(blob.data).equals(buffer)).toBe(true);
  });

  it("skips, without erroring, a legacy row whose file no longer exists on disk", async () => {
    const f = await createFixture("backfill-missing");
    const missingPath = path.join(os.tmpdir(), `zev-legacy-missing-${uid("x")}.pdf`);
    const row = await prisma.document.create({
      data: {
        zevId: f.zev.id,
        type: "OTHER",
        number: uid("LEGACY-MISSING"),
        title: "Missing file",
        status: "FINAL",
        filePath: missingPath,
        sha256: createHash("sha256").update("x").digest("hex"),
      },
    });

    const result = await backfillDocuments(true);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    // Left untouched — not migrated, not nulled — so nothing is silently lost.
    const still = await prisma.document.findUniqueOrThrow({ where: { id: row.id } });
    expect(still.filePath).toBe(missingPath);
    const blob = await prisma.documentBlob.findUnique({ where: { documentId: row.id } });
    expect(blob).toBeNull();
  });
});
