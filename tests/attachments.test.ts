import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { addOwnershipStake, transferOwnership } from "@/server/services/ownership";
import * as property from "@/server/services/property";
import {
  uploadAttachment,
  listAttachments,
  listOwnershipProofsByStakeIds,
  readAttachmentFile,
} from "@/server/services/attachments";
import { ForbiddenError } from "@/server/auth/guards";
import { createFixture, uid, type Fixture } from "./helpers";

const PDF_PROOF = { buffer: Buffer.from("test proof content"), filename: "dokaz.pdf", mime: "application/pdf" };

/**
 * The fixture's 4 units are already fully allocated (100% each) from day one — adding another
 * stake on one of them would hit the "sum exceeds 100%" guard, not the thing under test here.
 * Create a fresh, unallocated unit per test that needs a stake actually created successfully.
 */
async function freshUnit(f: Fixture) {
  return property.createUnit(f.president, {
    buildingId: f.b1.id,
    type: "APARTMENT",
    label: `Test-${uid("u")}`,
    usableArea: "40.00",
    ownershipShare: "1.00",
    occupantCount: 1,
  });
}

describe("mandatory proof of ownership", () => {
  it("refuses to add an ownership stake with no proof document", async () => {
    const f = await createFixture("proof-missing");
    await expect(
      // @ts-expect-error — deliberately omitting the required third argument
      addOwnershipStake(f.president, { unitId: f.u4.id, ownerId: f.ownerA.id, sharePercent: "100", validFrom: new Date() })
    ).rejects.toThrow(/Dokaz o vlasništvu/);
  });

  it("refuses an empty file as proof", async () => {
    const f = await createFixture("proof-empty");
    await expect(
      addOwnershipStake(
        f.president,
        { unitId: f.u4.id, ownerId: f.ownerA.id, sharePercent: "100", validFrom: new Date() },
        { buffer: Buffer.alloc(0), filename: "empty.pdf", mime: "application/pdf" }
      )
    ).rejects.toThrow(/Dokaz o vlasništvu/);
  });

  it("does not create the stake when the proof upload is rejected (all-or-nothing)", async () => {
    const f = await createFixture("proof-atomic");
    const unit = await freshUnit(f);
    const before = await prisma.ownershipStake.count({ where: { unitId: unit.id } });
    await expect(
      addOwnershipStake(
        f.president,
        { unitId: unit.id, ownerId: f.ownerA.id, sharePercent: "100", validFrom: new Date() },
        { buffer: Buffer.from("x"), filename: "malware.exe", mime: "application/x-msdownload" }
      )
    ).rejects.toThrow(/format/);
    const after = await prisma.ownershipStake.count({ where: { unitId: unit.id } });
    expect(after).toBe(before);
  });

  it("creates the stake and a linked OWNERSHIP_PROOF attachment together", async () => {
    const f = await createFixture("proof-ok");
    const unit = await freshUnit(f);
    const stake = await addOwnershipStake(
      f.president,
      { unitId: unit.id, ownerId: f.ownerA.id, sharePercent: "100", validFrom: new Date("2020-06-01") },
      PDF_PROOF
    );
    const attachment = await prisma.attachment.findFirst({
      where: { category: "OWNERSHIP_PROOF", linkedType: "OwnershipStake", linkedId: stake.id },
    });
    expect(attachment).toBeTruthy();
    expect(attachment?.filename).toBe("dokaz.pdf");
    expect(attachment?.mime).toBe("application/pdf");
  });

  it("refuses to transfer ownership with no proof, and links the new stake's proof when given", async () => {
    const f = await createFixture("proof-transfer");
    await expect(
      // @ts-expect-error — deliberately omitting the required third argument
      transferOwnership(f.president, { unitId: f.u1.id, fromOwnerId: f.ownerA.id, toOwnerId: f.ownerC.id, effectiveDate: new Date() })
    ).rejects.toThrow(/Dokaz o vlasništvu/);

    const newStake = await transferOwnership(
      f.president,
      { unitId: f.u1.id, fromOwnerId: f.ownerA.id, toOwnerId: f.ownerC.id, effectiveDate: new Date(), note: "prodaja" },
      PDF_PROOF
    );
    const attachment = await prisma.attachment.findFirst({
      where: { category: "OWNERSHIP_PROOF", linkedType: "OwnershipStake", linkedId: newStake.id },
    });
    expect(attachment).toBeTruthy();
  });
});

describe("attachment upload validation", () => {
  it("rejects a disallowed file type", async () => {
    const f = await createFixture("upload-badmime");
    await expect(
      uploadAttachment(f.president, { buffer: Buffer.from("hi"), filename: "note.txt", mime: "text/plain", category: "OTHER" })
    ).rejects.toThrow(/format/);
  });

  it("rejects a file over the size limit", async () => {
    const f = await createFixture("upload-toobig");
    const big = Buffer.alloc(15 * 1024 * 1024 + 1);
    await expect(
      uploadAttachment(f.president, { buffer: big, filename: "big.pdf", mime: "application/pdf", category: "REPORT" })
    ).rejects.toThrow(/prevelik/);
  });

  it("rejects an unknown category", async () => {
    const f = await createFixture("upload-badcat");
    await expect(
      uploadAttachment(f.president, { buffer: Buffer.from("x"), filename: "a.pdf", mime: "application/pdf", category: "NOT_A_CATEGORY" })
    ).rejects.toThrow(/kategorija/);
  });

  it("only president/accountant can upload a general document", async () => {
    const f = await createFixture("upload-forbidden");
    await expect(
      uploadAttachment(f.actorA, { buffer: Buffer.from("x"), filename: "a.pdf", mime: "application/pdf", category: "OTHER" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("lists uploaded documents filtered by category", async () => {
    const f = await createFixture("upload-list");
    const tag = uid("rpt");
    await uploadAttachment(f.president, { buffer: Buffer.from("report"), filename: `${tag}.pdf`, mime: "application/pdf", category: "REPORT" });
    await uploadAttachment(f.accountant, { buffer: Buffer.from("contract"), filename: `${tag}-c.pdf`, mime: "application/pdf", category: "CONTRACT" });
    const reports = await listAttachments(f.president, { category: "REPORT" });
    expect(reports.some((a) => a.filename === `${tag}.pdf`)).toBe(true);
    expect(reports.some((a) => a.filename === `${tag}-c.pdf`)).toBe(false);
  });
});

describe("attachment access control", () => {
  it("an owner can download the proof attached to their own stake", async () => {
    const f = await createFixture("access-self");
    const unit = await freshUnit(f);
    const stake = await addOwnershipStake(
      f.president,
      { unitId: unit.id, ownerId: f.ownerA.id, sharePercent: "100", validFrom: new Date() },
      PDF_PROOF
    );
    const attachment = await prisma.attachment.findFirstOrThrow({ where: { linkedId: stake.id } });
    const { attachment: meta, buffer } = await readAttachmentFile(f.actorA, attachment.id);
    expect(meta.filename).toBe("dokaz.pdf");
    expect(buffer.toString()).toBe("test proof content");
  });

  it("an owner cannot download another owner's proof of ownership", async () => {
    const f = await createFixture("access-other");
    const unit = await freshUnit(f);
    const stake = await addOwnershipStake(
      f.president,
      { unitId: unit.id, ownerId: f.ownerA.id, sharePercent: "100", validFrom: new Date() },
      PDF_PROOF
    );
    const attachment = await prisma.attachment.findFirstOrThrow({ where: { linkedId: stake.id } });
    await expect(readAttachmentFile(f.actorB, attachment.id)).rejects.toThrow(ForbiddenError);
  });

  it("an owner cannot download a general (unlinked) library document", async () => {
    const f = await createFixture("access-general");
    const row = await uploadAttachment(f.president, { buffer: Buffer.from("x"), filename: "izvjestaj.pdf", mime: "application/pdf", category: "REPORT" });
    await expect(readAttachmentFile(f.actorA, row.id)).rejects.toThrow(ForbiddenError);
  });

  it("president and accountant can download any attachment", async () => {
    const f = await createFixture("access-mgmt");
    const row = await uploadAttachment(f.president, { buffer: Buffer.from("x"), filename: "izvjestaj.pdf", mime: "application/pdf", category: "REPORT" });
    await expect(readAttachmentFile(f.president, row.id)).resolves.toBeTruthy();
    await expect(readAttachmentFile(f.accountant, row.id)).resolves.toBeTruthy();
  });

  it("maps ownership proofs back to their stake ids for display", async () => {
    const f = await createFixture("access-map");
    const unit = await freshUnit(f);
    const stake = await addOwnershipStake(
      f.president,
      { unitId: unit.id, ownerId: f.ownerA.id, sharePercent: "100", validFrom: new Date() },
      PDF_PROOF
    );
    const map = await listOwnershipProofsByStakeIds(f.president, [stake.id]);
    expect(map.get(stake.id)?.filename).toBe("dokaz.pdf");
  });
});
