"use server";
// Server actions for the two-step PDF bank-statement import: parse (preview only, writes
// nothing) then commit (writes exactly what the reviewer confirmed/edited). Split into two
// actions — rather than one big <form action> like the CSV import — because a PDF's
// transaction rows are read off a text layer, not structured columns, so a human always
// gets a chance to check/correct them before anything becomes a Payment record.
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { importPdfPreview, commitPdfImport, type PdfImportPreview } from "@/server/services/payments";

export type ParsePdfResult = { ok: true; preview: PdfImportPreview } | { ok: false; error: string };

export async function parsePdfPreviewAction(formData: FormData): Promise<ParsePdfResult> {
  // Filled in once the file is read, so a failure can be logged with what actually arrived.
  let received: { size: number; sha256: string; expectedSha256: string | null } | null = null;
  try {
    const actor = await requireActor("ACCOUNTANT");
    const file = formData.get("file") as File | null;
    const accountId = String(formData.get("accountId") || "");
    if (!file || file.size === 0) return { ok: false, error: "Odaberite PDF fajl." };
    if (!accountId) return { ok: false, error: "Odaberite račun." };
    const buffer = Buffer.from(await file.arrayBuffer());
    // The browser sends the file's SHA-256 alongside it. A mismatch means the bytes were damaged
    // between the browser and this action — not a PDF the parser can't read. Production showed
    // the same statement failing on every other upload with varying pdf.js errors (v2.36.1).
    const expected = String(formData.get("sha256") || "").toLowerCase() || null;
    received = { size: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), expectedSha256: expected };
    if (expected && expected !== received.sha256) {
      console.error("[pdf-import] uploaded file differs from what the browser sent", { ...received, browserSize: file.size });
      return { ok: false, error: "PDF nije stigao do servera neoštećen. Pokušajte ponovo; ako se ponavlja, javite administratoru." };
    }
    const preview = await importPdfPreview(actor, { accountId, filename: file.name, buffer });
    if (preview.rows.length === 0) {
      return { ok: false, error: "Nije prepoznata nijedna uplata na izvodu (provjerite da li je izvod ispravan PDF)." };
    }
    return { ok: true, preview };
  } catch (e) {
    // Logged (the message alone used to reach only the browser, so production logs had nothing).
    console.error("[pdf-import] preview failed", { received, error: e instanceof Error ? e.stack ?? e.message : String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri čitanju PDF-a." };
  }
}

export type CommitPdfResult = { ok: true; imported: number; linkedToSms: number } | { ok: false; error: string };

export async function commitPdfImportAction(input: {
  accountId: string;
  filename: string;
  rawText: string;
  rows: {
    direction: "IN" | "OUT";
    date: string;
    amount: string;
    payerNameRaw: string;
    purposeRaw: string;
    reference: string;
    invoiceId?: string | null;
    expenseId?: string | null;
    categoryName?: string | null;
  }[];
  /** smsId of rows left un-ticked as "already booked from SMS" — linked, not booked. */
  skippedSmsIds?: string[];
}): Promise<CommitPdfResult> {
  try {
    const actor = await requireActor("ACCOUNTANT");
    if (!input.accountId) return { ok: false, error: "Odaberite račun." };
    const res = await commitPdfImport(actor, input);
    revalidatePath("/fakture/uplate");
    revalidatePath("/troskovi");
    revalidatePath("/fakture/uplate/uskladjivanje");
    return { ok: true, imported: res.imported, linkedToSms: res.linkedToSms };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri uvozu." };
  }
}
