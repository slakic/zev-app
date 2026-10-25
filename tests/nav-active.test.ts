import { describe, it, expect } from "vitest";
import { activeHref } from "@/components/nav-active";

const TENANT = ["/", "/zgrade", "/fakture", "/skupstina", "/podesavanja"];
const PLATFORM = ["/admin", "/admin/aktivnosti", "/"];

describe("activeHref — sidebar active entry", () => {
  it("marks / only on exactly /", () => {
    expect(activeHref("/", TENANT)).toBe("/");
    expect(activeHref("/nepoznato", TENANT)).toBeUndefined();
    expect(activeHref("/zgrade", TENANT)).toBe("/zgrade");
  });

  it("marks the parent entry on sub-pages", () => {
    expect(activeHref("/fakture/uplate/123", TENANT)).toBe("/fakture");
    expect(activeHref("/podesavanja/audit", TENANT)).toBe("/podesavanja");
    expect(activeHref("/admin/abc", PLATFORM)).toBe("/admin");
  });

  it("the longest matching href wins", () => {
    expect(activeHref("/admin/aktivnosti", PLATFORM)).toBe("/admin/aktivnosti");
    expect(activeHref("/admin/aktivnosti/x", PLATFORM)).toBe("/admin/aktivnosti");
  });

  it("does not match a path that merely shares a prefix", () => {
    expect(activeHref("/fakture-xyz", TENANT)).toBeUndefined();
    expect(activeHref("/administracija", PLATFORM)).toBeUndefined();
  });

  it("returns undefined for an unknown route", () => {
    expect(activeHref("/nesto/drugo", TENANT)).toBeUndefined();
  });
});
