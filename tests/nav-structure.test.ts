import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildTenantNav, buildPlatformNav, settingsInAccountMenu, type NavRole } from "@/lib/nav-structure";
import { activeHref } from "@/components/nav-active";
import { t } from "@/lib/i18n";

const hrefs = (roles: NavRole[], opts?: { isSuperAdmin?: boolean }) =>
  buildTenantNav(roles, opts).flatMap((g) => g.items.map((i) => i.href));
const shape = (roles: NavRole[], opts?: { isSuperAdmin?: boolean }) =>
  buildTenantNav(roles, opts).map((g) => [g.labelKey, g.items.map((i) => i.href)] as const);

describe("buildTenantNav — meni po ulozi (F9, D8)", () => {
  it("vlasnik: Moje / Zajednica, bez stavki uprave i bez Podešavanja", () => {
    expect(shape(["OWNER"])).toEqual([
      ["nav.group.mine", ["/", "/fakture", "/skupstina", "/odrzavanje", "/dokumenti"]],
      ["nav.group.community", ["/zgrade", "/organi", "/planovi"]],
    ]);
    expect(settingsInAccountMenu(["OWNER"])).toBe(true);
  });

  it("predsjednik: Svakodnevno / Zajednica / Uprava, Uplate pored Faktura, Evidencije u Upravi", () => {
    expect(shape(["PRESIDENT"])).toEqual([
      ["nav.group.daily", ["/", "/fakture", "/fakture/uplate", "/troskovi", "/skupstina", "/odrzavanje"]],
      ["nav.group.community", ["/vlasnici", "/zgrade", "/organi", "/planovi", "/dokumenti"]],
      ["nav.group.management", ["/izvjestaji", "/evidencije", "/podesavanja"]],
    ]);
    expect(settingsInAccountMenu(["PRESIDENT"])).toBe(false);
  });

  it("računovođa: Finansije prvo, pa Zajednica i Uprava", () => {
    expect(shape(["ACCOUNTANT"])).toEqual([
      ["nav.group.finance", ["/", "/fakture", "/fakture/uplate", "/troskovi", "/izvjestaji"]],
      ["nav.group.community", ["/vlasnici", "/zgrade", "/planovi", "/odrzavanje", "/skupstina", "/organi", "/dokumenti"]],
      ["nav.group.management", ["/evidencije", "/podesavanja"]],
    ]);
  });

  it("svaka uloga vidi isti skup ruta kao ranije (osim Uplata za upravu) — ništa ne nestaje ni se ne dodaje tuđe", () => {
    const old = {
      OWNER: ["/", "/zgrade", "/organi", "/skupstina", "/fakture", "/planovi", "/odrzavanje", "/dokumenti", "/podesavanja"],
      MGMT: ["/", "/zgrade", "/vlasnici", "/organi", "/skupstina", "/fakture", "/troskovi", "/planovi", "/odrzavanje", "/dokumenti", "/izvjestaji", "/podesavanja", "/evidencije"],
    };
    // vlasnik: Podešavanja prelaze u meni naloga, ostalo isto
    expect(hrefs(["OWNER"]).sort()).toEqual(old.OWNER.filter((h) => h !== "/podesavanja").sort());
    for (const r of ["PRESIDENT", "ACCOUNTANT"] as const) {
      expect(hrefs([r]).sort()).toEqual([...old.MGMT, "/fakture/uplate"].sort());
    }
  });

  it("Uplate samo za upravu; vlasnik ih ne dobija kao stavku", () => {
    expect(hrefs(["OWNER"])).not.toContain("/fakture/uplate");
    expect(hrefs(["PRESIDENT"])).toContain("/fakture/uplate");
    expect(hrefs(["ACCOUNTANT"])).toContain("/fakture/uplate");
  });

  it("više uloga: najjača bira raspored, ništa se ne ponavlja", () => {
    expect(shape(["OWNER", "PRESIDENT"])).toEqual(shape(["PRESIDENT"]));
    const all = hrefs(["OWNER", "PRESIDENT", "ACCOUNTANT"]);
    expect(new Set(all).size).toBe(all.length);
    expect(shape(["OWNER", "ACCOUNTANT"])).toEqual(shape(["ACCOUNTANT"]));
  });

  it("super admin dobija zasebnu grupu Platforma na kraju (kroz t(), ne tvrdo kodirano)", () => {
    const groups = buildTenantNav(["OWNER"], { isSuperAdmin: true });
    const last = groups[groups.length - 1];
    expect(last.labelKey).toBe("nav.group.platform");
    expect(last.items).toEqual([{ href: "/admin", labelKey: "nav.superAdmin" }]);
    expect(t("nav.superAdmin")).toBe("Super admin");
    expect(buildTenantNav(["OWNER"]).some((g) => g.labelKey === "nav.group.platform")).toBe(false);
  });

  it("svaki ključ iz menija postoji u rječniku (t() ne vraća sam ključ) i svaka ruta ima stranicu", () => {
    const groups = [
      ...buildTenantNav(["OWNER"], { isSuperAdmin: true }),
      ...buildTenantNav(["PRESIDENT"]),
      ...buildTenantNav(["ACCOUNTANT"]),
      ...buildPlatformNav({ hasZev: true }),
    ];
    for (const g of groups) {
      if (g.labelKey) expect(t(g.labelKey)).not.toBe(g.labelKey);
      for (const i of g.items) {
        expect(t(i.labelKey)).not.toBe(i.labelKey);
        const base = i.href.startsWith("/admin") ? join("src/app", i.href) : join("src/app/(app)", i.href);
        expect(existsSync(join(process.cwd(), base, "page.tsx")), i.href).toBe(true);
      }
    }
  });
});

describe("aktivna stavka po prefiksu", () => {
  const mgmt = hrefs(["PRESIDENT"]);
  it("/fakture/uplate/... aktivira Uplate, ne Fakture", () => {
    expect(activeHref("/fakture/uplate", mgmt)).toBe("/fakture/uplate");
    expect(activeHref("/fakture/uplate/sms", mgmt)).toBe("/fakture/uplate");
  });
  it("detalj fakture ostaje pod Fakture", () => {
    expect(activeHref("/fakture/123", mgmt)).toBe("/fakture");
    expect(activeHref("/fakture/serija", mgmt)).toBe("/fakture");
  });
  it("vlasnik (bez Uplata) na /fakture/uplate ostaje na Fakture", () => {
    expect(activeHref("/fakture/uplate", hrefs(["OWNER"]))).toBe("/fakture");
  });
});

describe("buildPlatformNav", () => {
  it("ravna lista sa Podešavanjima platforme; Moj ZEV samo uz ZEV", () => {
    const flat = (z: boolean) => buildPlatformNav({ hasZev: z }).flatMap((g) => g.items.map((i) => i.href));
    expect(flat(false)).toEqual(["/admin", "/admin/aktivnosti", "/admin/sesije", "/admin/podesavanja"]);
    expect(flat(true)).toEqual([...flat(false), "/"]);
    expect(buildPlatformNav({ hasZev: true })).toHaveLength(1);
    expect(buildPlatformNav({ hasZev: true })[0].labelKey).toBeUndefined();
  });
  it("ZEV detalj i novi nalog aktiviraju ZEV naloge, podešavanja svoju stavku", () => {
    const h = buildPlatformNav({ hasZev: true })[0].items.map((i) => i.href);
    expect(activeHref("/admin/abc123", h)).toBe("/admin");
    expect(activeHref("/admin/novi", h)).toBe("/admin");
    expect(activeHref("/admin/podesavanja", h)).toBe("/admin/podesavanja");
  });
});
