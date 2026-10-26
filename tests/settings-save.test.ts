// saveSettings (F7, X-R10): jedna forma, server upisuje samo promijenjene vrijednosti i ništa ako je ijedna neispravna.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture } from "./helpers";
import { getSettings, saveSettings } from "@/server/services/settings";
import { ForbiddenError } from "@/server/auth/guards";

const auditCount = (zevId: string) => prisma.auditEvent.count({ where: { zevId, action: "setting.update" } });

describe("saveSettings", () => {
  it("upisuje samo promijenjene vrijednosti, jedan audit zapis po izmjeni, sa prije/poslije", async () => {
    const f = await createFixture("set-save");
    const zevId = f.president.zevId!;
    const before = await auditCount(zevId);
    const r = await saveSettings(f.president, {
      "retention.financialYears": "11", // nepromijenjeno
      "emergency.costThreshold": "600,00",
      "invoice.dueDay": "20",
      "board.size": "3", // nepromijenjeno
    });
    expect(r).toEqual({
      ok: true,
      changes: [
        { key: "emergency.costThreshold", before: "500", after: "600" },
        { key: "invoice.dueDay", before: "15", after: "20" },
      ],
    });
    const s = await getSettings(f.president);
    expect(s["emergency.costThreshold"]).toBe("600");
    expect(s["invoice.dueDay"]).toBe("20");
    expect(s["board.size"]).toBe("3");
    expect(await auditCount(zevId)).toBe(before + 2);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { zevId, action: "setting.update", targetId: "emergency.costThreshold" } });
    expect(ev.before).toEqual({ value: "500" });
    expect(ev.after).toEqual({ value: "600" });
  });

  it("ništa nije promijenjeno: ne upisuje se ništa i nema audit zapisa", async () => {
    const f = await createFixture("set-save-none");
    const zevId = f.president.zevId!;
    const before = await auditCount(zevId);
    const r = await saveSettings(f.president, { "emergency.costThreshold": "500,00", "invoice.dueDay": "15" });
    expect(r).toEqual({ ok: true, changes: [] });
    expect(await auditCount(zevId)).toBe(before);
  });

  it("neispravan unos ne snima NIJEDNU vrijednost, ni ispravne", async () => {
    const f = await createFixture("set-save-bad");
    const zevId = f.president.zevId!;
    const before = await auditCount(zevId);
    const r = await saveSettings(f.president, { "emergency.costThreshold": "900", "invoice.dueDay": "", "board.size": "tri" });
    expect(r.ok).toBe(false);
    const s = await getSettings(f.president);
    expect(s["emergency.costThreshold"]).toBe("500");
    expect(s["invoice.dueDay"]).toBe("15");
    expect(await auditCount(zevId)).toBe(before);
  });

  it("računovođa i vlasnik ne mogu da snime; drugi ZEV ostaje netaknut", async () => {
    const f = await createFixture("set-save-guard");
    const other = await createFixture("set-save-other");
    await expect(saveSettings(f.accountant, { "board.size": "9" })).rejects.toThrow(ForbiddenError);
    await expect(saveSettings(f.actorA, { "board.size": "9" })).rejects.toThrow(ForbiddenError);
    await saveSettings(f.president, { "board.size": "7" });
    expect((await getSettings(other.president))["board.size"]).toBe("3");
  });
});
