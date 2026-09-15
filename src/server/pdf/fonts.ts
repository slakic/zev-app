// Centralized, memoized loading of the PDF fonts pdfkit needs — one fs read per
// process instance instead of one per generated document (renderPdf used to call
// registerFont with a raw path on every PDF).
//
// outputFileTracingIncludes in next.config.ts makes Next bundle assets/fonts/**
// into the traced output; this module is what actually reads the bytes, and it
// fails at the first PDF generation with a clear message instead of a cryptic
// pdfkit error deep in registerFont. FONT_DIR lets a deployment override the
// location entirely. See Plans/deployment-portability-plan.md §4 (options A+B).
import fs from "node:fs";
import path from "node:path";

const FONT_DIR = process.env.FONT_DIR ?? path.join(process.cwd(), "assets/fonts");

export type FontSet = { regular: Buffer; bold: Buffer };

let cached: FontSet | null = null;

function readFont(filename: string): Buffer {
  const filePath = path.join(FONT_DIR, filename);
  try {
    return fs.readFileSync(filePath);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Font "${filename}" nije pronađen na "${filePath}". Provjerite FONT_DIR ili ` +
        `outputFileTracingIncludes u next.config.ts. (${detail})`
    );
  }
}

/** Regular + bold DejaVu Sans as buffers, read once per process and reused for every PDF. */
export function getFonts(): FontSet {
  if (!cached) {
    cached = { regular: readFont("DejaVuSans.ttf"), bold: readFont("DejaVuSans-Bold.ttf") };
  }
  return cached;
}
