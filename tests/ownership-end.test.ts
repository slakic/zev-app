// v2.43.1: zatvaranje postojeceg vlasnickog udjela bez kreiranja novog ("Zatvori udio") — za jedinicu
// na 200% kad je novi vlasnik upisan kao "Dodaj udio" umjesto kroz "Promjena vlasništva".
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture } from "./helpers";
import { addOwnershipStake, endOwnershipStake, unitOwnershipWarnings, assemblyVotingSubjects } from "@/server/services/ownership";
import { ForbiddenError } from "@/server/auth/guards";

const PROOF = { buffer: Buffer.from("ugovor o kupoprodaji"), filename: "ugovor.pdf", mime: "application/pdf" };
const SALE = new Date("2026-10-01T00:00:00.000Z");

describe("endOwnershipStake", () => {
  it("closes the previous owner's stake of a unit at 200%, removes the warning and the old owner's vote", async () => {
    const f = await createFixture("end-sale");
    // u1 belongs to A (100%); the buyer C is entered as a second 100% stake instead of a transfer
    await addOwnershipStake(f.president, { unitId: f.u1.id, ownerId: f.ownerC.id, sharePercent: "100", validFrom: SALE }, PROOF);
    expect((await unitOwnershipWarnings(f.zev.id)).find((w) => w.unitId === f.u1.id)?.kind).toBe("OVER");

    const old = await prisma.ownershipStake.findFirstOrThrow({ where: { unitId: f.u1.id, ownerId: f.ownerA.id, validTo: null } });
    const closed = await endOwnershipStake(f.president, old.id, { validTo: SALE, reason: "Prodaja garaže — ugovor od 01.10.2026." });
    expect(closed.validTo?.toISOString()).toBe(SALE.toISOString());

    expect((await unitOwnershipWarnings(f.zev.id)).find((w) => w.unitId === f.u1.id)).toBeUndefined();
    const subjects = await assemblyVotingSubjects(f.zev.id, [f.u1.id]);
    expect(subjects.map((s) => s.ownerId)).toEqual([f.ownerC.id]);

    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "ownership.stake.end", targetId: old.id } });
    expect(ev.reason).toContain("Prodaja");
    // the row is closed, never deleted
    expect(await prisma.ownershipStake.count({ where: { unitId: f.u1.id } })).toBe(2);
  });

  it("refuses an empty reason, a date not after validFrom, an already closed stake and a non-president", async () => {
    const f = await createFixture("end-refuse");
    const stake = await prisma.ownershipStake.findFirstOrThrow({ where: { unitId: f.u1.id, validTo: null } });

    await expect(endOwnershipStake(f.accountant, stake.id, { validTo: SALE, reason: "x" })).rejects.toThrow(ForbiddenError);
    await expect(endOwnershipStake(f.president, stake.id, { validTo: SALE, reason: "  " })).rejects.toThrow(/razlog/);
    await expect(endOwnershipStake(f.president, stake.id, { validTo: stake.validFrom, reason: "greška" })).rejects.toThrow(/poslije datuma/);

    await endOwnershipStake(f.president, stake.id, { validTo: SALE, reason: "prodaja" });
    await expect(endOwnershipStake(f.president, stake.id, { validTo: SALE, reason: "prodaja" })).rejects.toThrow(/već zatvoren/);
  });

  it("closing the explicit voting representative's stake falls back to the default representative", async () => {
    const f = await createFixture("end-rep");
    // fixture: u3 co-owned by B and C, C named representative explicitly
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: f.u3.id } })).votingRepresentativeId).toBe(f.ownerC.id);
    const cStake = await prisma.ownershipStake.findFirstOrThrow({ where: { unitId: f.u3.id, ownerId: f.ownerC.id, validTo: null } });
    await endOwnershipStake(f.president, cStake.id, { validTo: SALE, reason: "C prodao svoj dio" });
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: f.u3.id } })).votingRepresentativeId).toBeNull();
  });
});
