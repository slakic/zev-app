"use server";
// Server actions for the two-step PDF bank-statement import: parse (preview only, writes
// nothing) then commit (writes exactly what the reviewer confirmed/edited). Split into two
// actions — rather than one big <form action> like the CSV import — because a PDF's
// transaction rows are read off a text layer, not structured columns, so a human always
// gets a chance to check/correct them before anything becomes a Payment record.
// Since v2.39.0 both take several statements at once (one review table, grouped by statement).
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import {
  importPdfPreviews,
  commitPdfImports,
  type PdfStatementPreview,
  type StatementRowInput,
} from "@/server/services/payments";

export type ParsePdfResult =
  | { ok: true; previews: PdfStatementPreview[]; failures: { filename: string; error: string }[] }
  | { ok: false; error: string };

/** FormData: `accountId`, then one `file` and one `sha256` per statement, in the same order. */
export async function parsePdfPreviewsAction(formData: FormData): Promise<ParsePdfResult> {
  try {
    const actor = await requireActor("ACCOUNTANT");
    const accountId = String(formData.get("accountId") || "");
    if (!accountId) return { ok: false, error: "Odaberite račun." };
    const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { ok: false, error: "Odaberite bar jedan PDF izvod." };
    const shas = formData.getAll("sha256").map((v) => String(v).toLowerCase());

    // The browser sends each file's SHA-256 with it; a mismatch means the bytes were damaged on
    // the way, not a PDF the parser cannot read (v2.36.1). Such a file is reported, not parsed.
    const damaged: { filename: string; error: string }[] = [];
    const intact: { filename: string; buffer: Buffer }[] = [];
    for (const [i, file] of files.entries()) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      if (shas[i] && shas[i] !== sha256) {
        console.error("[pdf-import] uploaded file differs from what the browser sent", {
          filename: file.name, size: buffer.length, sha256, expectedSha256: shas[i], browserSize: file.size,
        });
        damaged.push({ filename: file.name, error: "Fajl nije stigao do servera neoštećen. Pokušajte ponovo." });
        continue;
      }
      intact.push({ filename: file.name, buffer });
    }

    const res = intact.length > 0 ? await importPdfPreviews(actor, { accountId, files: intact }) : { previews: [], failures: [] };
    const failures = [...damaged, ...res.failures];
    // Logged (the message alone used to reach only the browser, so production logs had nothing).
    if (failures.length > 0) console.error("[pdf-import] preview failed for some files", { failures });
    if (res.previews.length === 0) {
      return { ok: false, error: failures.map((f) => `${f.filename}: ${f.error}`).join(" · ") || "Nijedan izvod nije pročitan." };
    }
    return { ok: true, previews: res.previews, failures };
  } catch (e) {
    console.error("[pdf-import] preview failed", { error: e instanceof Error ? e.stack ?? e.message : String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri čitanju PDF-a." };
  }
}

export type CommitPdfResult =
  | { ok: true; imported: number; statements: number; linkedToSms: number }
  | { ok: false; error: string };

export async function commitPdfImportsAction(input: {
  accountId: string;
  statements: {
    filename: string;
    rawText: string;
    rows: StatementRowInput[];
    /** smsId of rows left un-ticked as "already booked from SMS" — linked, not booked. */
    skippedSmsIds?: string[];
  }[];
}): Promise<CommitPdfResult> {
  try {
    const actor = await requireActor("ACCOUNTANT");
    if (!input.accountId) return { ok: false, error: "Odaberite račun." };
    const res = await commitPdfImports(actor, input);
    revalidatePath("/fakture/uplate");
    revalidatePath("/troskovi");
    revalidatePath("/fakture/uplate/uskladjivanje");
    return { ok: true, imported: res.imported, statements: res.statements, linkedToSms: res.linkedToSms };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri uvozu." };
  }
}
