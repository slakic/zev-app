// Contract test for the DB-backed document storage introduced in
// Plans/deployment-portability-plan.md §3 (Faza 1): storeDocument/readDocumentFile
// must round-trip through DocumentBlob, and must still serve pre-existing Docker
// rows that only have an on-disk filePath (§3.3 backward compatibility).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createFixture, uid, type Fixture } from "./helpers";
import { storeDocument, readDocumentFile } from "@/server/services/documents";

describe("document storage (DB blob + legacy filePath fallback)", () => {
  let f: Fixture;
  const legacyFiles: string[] = [];

  beforeAll(async () => {
    f = await createFixture("docstorage");
  });

  afterAll(() => {
    for (const p of legacyFiles) {
      try {
        fs.unlinkSync(p);
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("stores the buffer in DocumentBlob and reads the exact same bytes back", async () => {
    const buffer = Buffer.from(`test pdf content ${uid("x")}`);
    const { row } = await storeDocument(f.president, {
      type: "OTHER",
      title: "Round-trip test",
      buffer,
      finalize: true,
    });
    const { buffer: read } = await readDocumentFile(f.president, row.id);
    expect(read.equals(buffer)).toBe(true);
    expect(row.sha256).toBe(createHash("sha256").update(buffer).digest("hex"));
    // filePath stays null for new rows — bytes live only in DocumentBlob (§3.3).
    expect(row.filePath).toBeNull();
  });

  it("falls back to fs.readFileSync for a legacy row that has filePath but no DocumentBlob", async () => {
    const buffer = Buffer.from(`legacy docker content ${uid("x")}`);
    const legacyPath = path.join(os.tmpdir(), `zev-legacy-${uid("doc")}.pdf`);
    fs.writeFileSync(legacyPath, buffer);
    legacyFiles.push(legacyPath);

    const row = await prisma.document.create({
      data: {
        zevId: f.zev.id,
        type: "OTHER",
        number: uid("LEGACY"),
        title: "Legacy Docker row",
        status: "FINAL",
        filePath: legacyPath,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      },
    });

    const { buffer: read } = await readDocumentFile(f.president, row.id);
    expect(read.equals(buffer)).toBe(true);
  });

  it("throws when a row has neither a DocumentBlob nor a filePath", async () => {
    const row = await prisma.document.create({
      data: {
        zevId: f.zev.id,
        type: "OTHER",
        number: uid("BROKEN"),
        title: "Neither blob nor filePath",
        status: "FINAL",
        sha256: createHash("sha256").update("x").digest("hex"),
      },
    });

    await expect(readDocumentFile(f.president, row.id)).rejects.toThrow();
  });
});
