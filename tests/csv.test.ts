// CSV čitač za uvoz nacrta (src/lib/csv.ts): razdjelnici, navodnici, prelomi redova, kodiranje i brojevi redova.
import { describe, it, expect } from "vitest";
import { decodeText, detectDelimiter, parseCsv } from "@/lib/csv";

const enc = (s: string) => new TextEncoder().encode(s);

describe("detectDelimiter", () => {
  it("picks the most frequent delimiter of the header outside quotes, ties go to ;", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a;b,c\n")).toBe(";");
    expect(detectDelimiter("jedna kolona\n")).toBe(";");
    expect(detectDelimiter('"a,b,c,d";e;f\n')).toBe(";");
    expect(detectDelimiter("﻿a,b\n")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("splits on every supported delimiter", () => {
    for (const d of [";", ",", "\t"] as const) {
      expect(parseCsv(["a", "b", "c"].join(d) + "\n" + ["1", "2", "3"].join(d), d).map((r) => r.cells)).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    }
  });

  it("handles quotes, doubled quotes and delimiters/newlines inside quotes", () => {
    const rows = parseCsv('a;b\n"x;y";"he said ""hi"""\n"dva\nreda";kraj', ";");
    expect(rows.map((r) => r.cells)).toEqual([["a", "b"], ["x;y", 'he said "hi"'], ["dva\nreda", "kraj"]]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it("accepts CRLF and keeps physical line numbers (also after a multi-line cell and empty rows)", () => {
    const rows = parseCsv('a;b\r\n1;2\r\n\r\n"x\r\ny";3\r\n;;\r\n4;5', ";");
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4, 7]);
    expect(rows[2].cells).toEqual(["x\ny", "3"]);
    expect(rows[3].cells).toEqual(["4", "5"]);
  });

  it("skips empty rows and keeps a last row without a trailing newline", () => {
    expect(parseCsv("a;b\n\n\n1;2\n", ";")).toHaveLength(2);
    expect(parseCsv("a;b\n1;", ";")[1].cells).toEqual(["1", ""]);
  });
});

describe("decodeText", () => {
  it("strips the BOM and decodes UTF-8", () => {
    const r = decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("Šćepović;đ")]));
    expect(r).toEqual({ text: "Šćepović;đ", windows1250: false });
  });

  it("falls back to Windows-1250 for bytes that are not valid UTF-8", () => {
    // š=0x9A, đ=0xF0, č=0xE8 u Windows-1250
    const r = decodeText(new Uint8Array([0x9a, 0xf0, 0xe8]));
    expect(r.windows1250).toBe(true);
    expect(r.text).toBe("šđč");
  });
});
