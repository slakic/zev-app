// „Evidencije” (F7, X-R13): izbor taba, adrese, potpunost prevoda radnji i straničen/scoped revizorski trag.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture } from "./helpers";
import { audit } from "@/server/audit";
import { ForbiddenError } from "@/server/auth/guards";
import { ACTION_CATEGORY, actionsMatchingQuery, labelForAction, labelForTarget, summarize } from "@/lib/activity/catalog";
import { availableRecordTabs, isIsoDate, recordsHref, resolveRecordTab } from "@/lib/records";
import { AUDIT_PAGE_SIZE, listAuditTrail, listSentMessages } from "@/server/services/records";

describe("tabovi i adrese", () => {
  it("računovođa nema Aktivnosti; zatraženi nedostupni tab pada na prvi dostupni", () => {
    expect(availableRecordTabs(true)).toEqual(["aktivnosti", "poruke", "audit"]);
    expect(availableRecordTabs(false)).toEqual(["poruke", "audit"]);
    expect(resolveRecordTab(undefined, true)).toBe("aktivnosti");
    expect(resolveRecordTab("audit", true)).toBe("audit");
    expect(resolveRecordTab("aktivnosti", false)).toBe("poruke");
    expect(resolveRecordTab("nesto", false)).toBe("poruke");
  });

  it("recordsHref izostavlja prazno i ponavlja višestruke vrijednosti", () => {
    expect(recordsHref("audit")).toBe("/evidencije?tab=audit");
    expect(recordsHref("aktivnosti", { from: "2026-10-01", kat: ["OWNER", "FINANCE"], akter: "", str: "2" })).toBe(
      "/evidencije?tab=aktivnosti&from=2026-10-01&kat=OWNER&kat=FINANCE&str=2",
    );
  });

  it("isIsoDate odbija prazno, pogrešan oblik i nepostojeće datume", () => {
    expect(isIsoDate("2026-10-25")).toBe(true);
    for (const bad of [undefined, "", "25.10.2026", "2026-02-31", "2026-13-01", "abc"]) expect(isIsoDate(bad)).toBe(false);
  });
});

describe("prevedene radnje", () => {
  it("svaka radnja iz kataloga ima prevod (nijedna ne pada na sirovi kod)", () => {
    const untranslated = Object.keys(ACTION_CATEGORY).filter((a) => !labelForAction(a).translated);
    expect(untranslated).toEqual([]);
  });

  it("šifre koje su i prefiks druge radnje imaju svoj prevod", () => {
    expect(labelForAction("auth.login.failed").label).toBe("Neuspjela prijava");
    expect(labelForAction("ballot.revoke").label).not.toBe(labelForAction("ballot.revoke.auto").label);
    expect(labelForAction("nepoznata.radnja")).toEqual({ label: "nepoznata.radnja", translated: false });
  });

  it("pretraga po prevedenom tekstu nalazi šifre; vrste zapisa su prevedene", () => {
    expect(actionsMatchingQuery("plaćanje")).toContain("expense.pay");
    expect(actionsMatchingQuery("PLAĆANJE")).toContain("expense.pay");
    expect(actionsMatchingQuery("")).toEqual([]);
    expect(labelForTarget("PlanItem")).toBe("Stavka plana");
    expect(labelForTarget("NovaVrsta")).toBe("NovaVrsta");
  });

  it("setting.update se sažima u „naziv: staro → novo”, i ne ruši se na starom zapisu", () => {
    expect(
      summarize({ action: "setting.update", targetId: "emergency.costThreshold", before: { value: "500" }, after: { value: "600" } }),
    ).toBe("Prag za hitne radove bez skupštine: 500,00 KM → 600,00 KM");
    expect(summarize({ action: "setting.update", targetId: "emergency.costThreshold", before: { value: "pet" }, after: { value: "x" } })).toContain("pet → x");
    expect(summarize({ action: "setting.update", targetId: "nepoznat", before: { value: "1" }, after: { value: "2" } })).toBeNull();
  });
});

describe("listAuditTrail / listSentMessages", () => {
  it("straničenje, redoslijed i scoping po ZEV-u; samo uprava", async () => {
    const f = await createFixture("rec-audit");
    const other = await createFixture("rec-audit-other");
    for (let i = 0; i < AUDIT_PAGE_SIZE + 3; i++) {
      await audit(f.president, { action: "expense.pay", targetType: "Expense", targetId: `e${i}`, after: { n: i } });
    }
    await audit(other.president, { action: "expense.pay", targetType: "Expense", targetId: "tuđe" });

    const p1 = await listAuditTrail(f.accountant, { q: "plaćanje" });
    expect(p1.rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(p1.total).toBe(AUDIT_PAGE_SIZE + 3);
    expect(p1.pageCount).toBe(2);
    // Najnovije prvo; red sa istim vremenom ima stabilan redoslijed (id), pa se stranice ne preklapaju.
    const times = p1.rows.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const p2 = await listAuditTrail(f.president, { q: "plaćanje", page: 2 });
    expect(p2.rows).toHaveLength(3);
    const ids = [...p1.rows, ...p2.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(AUDIT_PAGE_SIZE + 3);
    expect([...p1.rows, ...p2.rows].some((r) => r.targetId === "tuđe")).toBe(false);

    // Filter po šifri radi i bez prevoda; nepostojeća stranica ne ruši upit.
    expect((await listAuditTrail(f.president, { q: "expense.pay" })).total).toBe(AUDIT_PAGE_SIZE + 3);
    expect((await listAuditTrail(f.president, { q: "plaćanje", page: 99 })).rows).toEqual([]);

    await expect(listAuditTrail(f.actorA)).rejects.toThrow(ForbiddenError);
    await expect(listSentMessages(f.actorA)).rejects.toThrow(ForbiddenError);
  });

  it("poruke: scoping po ZEV-u, filter po primaocu i statusu", async () => {
    const f = await createFixture("rec-msg");
    const other = await createFixture("rec-msg-other");
    const mk = (zevId: string, toAddress: string, status: "SENT" | "FAILED") =>
      prisma.notificationMessage.create({ data: { zevId, channel: "EMAIL", toAddress, body: "x", status } });
    await mk(f.president.zevId!, "ana@primjer.test", "SENT");
    await mk(f.president.zevId!, "marko@primjer.test", "FAILED");
    await mk(other.president.zevId!, "ana@tudje.test", "SENT");

    const all = await listSentMessages(f.president);
    expect(all.rows.map((m) => m.toAddress).sort()).toEqual(["ana@primjer.test", "marko@primjer.test"]);
    expect((await listSentMessages(f.accountant, { q: "ANA" })).rows).toHaveLength(1);
    expect((await listSentMessages(f.accountant, { status: "FAILED" })).rows.map((m) => m.toAddress)).toEqual(["marko@primjer.test"]);
    expect((await listSentMessages(f.accountant, { status: "NEPOZNAT" })).total).toBe(2);
  });
});
