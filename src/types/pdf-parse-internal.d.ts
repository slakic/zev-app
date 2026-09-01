// pdf-parse@1.1.1's package root (index.js) runs a debug self-test on import when it
// thinks it's the entry module (`!module.parent`), which crashes under Vite/Vitest's
// module loader. We import the internal module directly instead — this declares its
// shape, mirroring @types/pdf-parse's declaration for the package root.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
  }
  interface PdfParseOptions {
    pagerender?: (pageData: unknown) => string | Promise<string>;
    max?: number;
  }
  function pdfParse(dataBuffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
  export = pdfParse;
}
