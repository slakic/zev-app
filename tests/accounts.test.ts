// Editing a money account (v2.37.0): name, bank and account number only, audited, tenant-scoped.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture } from "./helpers";
import { updateAccount } from "@/server/services/finance";
import { ForbiddenError } from "@/server/auth/guards";

describe("updateAccount", () => {
  it("changes name, bank and account number, leaves the money fields alone, and is audited", async () => {
    const f = await createFixture("acc-edit");
    const before = await prisma.moneyAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    const a = await updateAccount(f.accountant, f.account.id, { name: "  Glavni račun  ", bankName: "Nova banka", iban: " 555-10000515469-32 " });
    expect(a).toMatchObject({ name: "Glavni račun", bankName: "Nova banka", iban: "555-10000515469-32" });
    expect(a.type).toBe(before.type);
    expect(a.openingBalance.toString()).toBe(before.openingBalance.toString());
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "account.update", targetId: f.account.id } });
    expect(JSON.stringify(ev.after)).toContain("555-10000515469-32");

    // An emptied field is stored as "no value", not an empty string.
    expect((await updateAccount(f.president, f.account.id, { name: "Glavni račun", bankName: "", iban: "" })).iban).toBeNull();
  });

  it("requires a name; an owner may not edit; another ZEV's account is not found", async () => {
    const f = await createFixture("acc-edit-guard");
    await expect(updateAccount(f.accountant, f.account.id, { name: "   " })).rejects.toThrow(/obavezan/);
    await expect(updateAccount(f.actorA, f.account.id, { name: "X" })).rejects.toThrow(ForbiddenError);
    const other = await createFixture("acc-edit-other");
    await expect(updateAccount(other.accountant, f.account.id, { name: "X" })).rejects.toThrow();
    expect((await prisma.moneyAccount.findUniqueOrThrow({ where: { id: f.account.id } })).name).not.toBe("X");
  });
});
