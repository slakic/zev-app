// F8.1 — pravilo card-transforma `Table`-a (D3 A): kolona radnji uvijek daje kartice; bez nje ≤ 5 kolona ostaje tabela.
import { describe, it, expect } from "vitest";
import { buildTableCss, usesCardTransform, type ColumnSpec } from "@/components/table-css";

const three = (extra: Partial<ColumnSpec> = {}): ColumnSpec[] => [
  { label: "Naziv", priority: "primary" }, { label: "Status" }, { label: "Radnje", ...extra },
];

describe("usesCardTransform", () => {
  it("a 3-column table with an actions column becomes cards", () => {
    expect(usesCardTransform(three({ actions: true }))).toBe(true);
  });
  it("a table with <= 5 columns and no actions column stays a table", () => {
    expect(usesCardTransform(three())).toBe(false);
    expect(usesCardTransform([1, 2, 3, 4, 5].map((n) => ({ label: `K${n}` })))).toBe(false);
  });
  it("more than 5 columns still becomes cards (P5)", () => {
    expect(usesCardTransform([1, 2, 3, 4, 5, 6].map((n) => ({ label: `K${n}` })))).toBe(true);
  });
});

describe("buildTableCss", () => {
  it("emits the card CSS only when the transform is on", () => {
    expect(buildTableCss("t1", three(), false)).not.toContain("display:flex; flex-direction:column");
    const css = buildTableCss("t1", three({ actions: true }), true);
    expect(css).toContain("#t1 thead { display:none; }");
  });

  it("puts the primary column first (order:-1) and the actions column last without a label", () => {
    const css = buildTableCss("t2", three({ actions: true }), true);
    expect(css).toContain("#t2 tbody td:nth-child(1){order:-1;");
    expect(css).toContain("#t2 tbody td:nth-child(3){order:99;display:flex;flex-wrap:wrap;");
    expect(css).not.toContain('content:"Radnje"');
    expect(css).toContain('content:"Status"');
  });

  it("wraps cell children into the second grid column and keeps chips from stretching (X-N19)", () => {
    const css = buildTableCss("t3", three({ actions: true }), true);
    expect(css).toContain("#t3 tbody td > * { grid-column:2; justify-self:start;");
  });

  it("an empty actions cell is hidden in the card", () => {
    expect(buildTableCss("t4", three({ actions: true }), true)).toContain("#t4 tbody td:nth-child(3):empty{display:none;}");
  });
});
