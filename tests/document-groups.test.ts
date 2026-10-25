// F8.6 — grupe vrsta dokumenata za filter na stranici „Dokumenti”.
import { describe, it, expect } from "vitest";
import { documentGroupOf, parseDocumentGroup, DOCUMENT_GROUPS } from "@/lib/documentGroups";

describe("documentGroupOf", () => {
  it("maps every DocumentType to exactly one group", () => {
    expect(documentGroupOf("MINUTES")).toBe("sjednice");
    expect(documentGroupOf("DECISION")).toBe("sjednice");
    expect(documentGroupOf("MEETING_INVITATION")).toBe("sjednice");
    expect(documentGroupOf("INVOICE")).toBe("fakture");
    expect(documentGroupOf("OWNER_STATEMENT")).toBe("fakture");
    expect(documentGroupOf("ANNUAL_REPORT")).toBe("izvjestaji");
    expect(documentGroupOf("ANNUAL_MAINTENANCE_PLAN")).toBe("izvjestaji");
    expect(documentGroupOf("WORK_ORDER")).toBe("ostalo");
    expect(documentGroupOf("OTHER")).toBe("ostalo");
  });
  it("parseDocumentGroup accepts only known groups", () => {
    for (const g of DOCUMENT_GROUPS) expect(parseDocumentGroup(g)).toBe(g);
    expect(parseDocumentGroup("x")).toBeUndefined();
    expect(parseDocumentGroup(undefined)).toBeUndefined();
  });
});
