// src/server/pdf/fonts.ts contract (Plans/deployment-portability-plan.md §4, §9):
// both fonts load as non-empty buffers, and pdfkit can actually render text that
// exercises the Bosnian/Montenegrin/Serbian Latin diacritics (č, ć, ž, š, đ) with them.
import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import { getFonts } from "@/server/pdf/fonts";

describe("fonts.ts", () => {
  it("loads both fonts as non-empty buffers", () => {
    const fonts = getFonts();
    expect(Buffer.isBuffer(fonts.regular)).toBe(true);
    expect(Buffer.isBuffer(fonts.bold)).toBe(true);
    expect(fonts.regular.length).toBeGreaterThan(1000);
    expect(fonts.bold.length).toBeGreaterThan(1000);
  });

  it("memoizes: repeated calls return the exact same buffers", () => {
    const a = getFonts();
    const b = getFonts();
    expect(a.regular).toBe(b.regular);
    expect(a.bold).toBe(b.bold);
  });

  it("renders a PDF containing č/ć/ž/š/đ without throwing, and produces non-trivial output", async () => {
    const fonts = getFonts();
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.registerFont("reg", fonts.regular);
    doc.registerFont("bold", fonts.bold);
    doc.font("reg").fontSize(10).text("Čest žalbeni šturi kćerkin đak.");

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    doc.end();
    const raw = await done;

    expect(raw.subarray(0, 5).toString()).toBe("%PDF-");
    expect(raw.length).toBeGreaterThan(1000);
  });
});
