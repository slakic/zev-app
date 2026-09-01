"use server";
// Server actions for the two-step PDF bank-statement import: parse (preview only, writes
// nothing) then commit (writes exactly what the reviewer confirmed/edited). Split into two
// actions — rather than one big <form action> like the CSV import — because a PDF's
// transaction rows are read off a text layer, not structured columns, so a human always
// gets a chance to check/correct them before anything becomes a Payment record.
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { importPdfPreview, commitPdfImport, type PdfImportPreview } from "@/server/services/payments";

export type ParsePdfResult = { ok: true; preview: PdfImportPreview } | { ok: false; error: string };

export async function parsePdfPreviewAction(formData: FormData): Promise<ParsePdfResult> {
  try {
    const actor = await requireActor("ACCOUNTANT");
    const file = formData.get("file") as File | null;
    const accountId = String(formData.get("accountId") || "");
    if (!file || file.size === 0) return { ok: false, error: "Odaberite PDF fajl." };
    if (!accountId) return { ok: false, error: "Odaberite račun." };
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await importPdfPreview(actor, { accountId, filename: file.name, buffer });
    if (preview.rows.length === 0) {
      return { ok: false, error: "Nije prepoznata nijedna uplata na izvodu (provjerite da li je izvod ispravan PDF)." };
    }
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri čitanju PDF-a." };
  }
}

export type CommitPdfResult = { ok: true; imported: number } | { ok: false; error: string };

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
}): Promise<CommitPdfResult> {
  try {
    const actor = await requireActor("ACCOUNTANT");
    if (!input.accountId) return { ok: false, error: "Odaberite račun." };
    const res = await commitPdfImport(actor, input);
    revalidatePath("/fakture/uplate");
    revalidatePath("/troskovi");
    return { ok: true, imported: res.imported };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri uvozu." };
  }
}
