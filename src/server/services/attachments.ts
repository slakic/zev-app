// User-uploaded supporting files (scans, PDFs, photos) — distinct from the `Document` model,
// which is exclusively for PDFs the app itself generates (invoices, minutes, decisions...).
// An Attachment can optionally be linked to any other record (linkedType/linkedId, mirroring
// Document.sourceType/sourceId) or stand alone as a general library item (both null).
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireAnyUser, ForbiddenError, type Actor } from "@/server/auth/guards";
import type { Prisma } from "@/generated/prisma/client";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Tx = Prisma.TransactionClient;

export const ATTACHMENT_CATEGORIES = [
  "OWNERSHIP_PROOF",
  "INVOICE",
  "REPORT",
  "MINUTES",
  "CONTRACT",
  "CORRESPONDENCE",
  "PHOTO",
  "CONSENT",
  "OTHER",
] as const;
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export function isAttachmentCategory(v: string): v is AttachmentCategory {
  return (ATTACHMENT_CATEGORIES as readonly string[]).includes(v);
}

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export type UploadInput = {
  buffer: Buffer;
  filename: string;
  mime: string;
  category: string;
  linkedType?: string | null;
  linkedId?: string | null;
};

function assertUploadable(input: { buffer: Buffer; mime: string; category: string }) {
  if (!input.buffer || input.buffer.length === 0) {
    throw new Error("Fajl je obavezan.");
  }
  if (input.buffer.length > MAX_SIZE_BYTES) {
    throw new Error(`Fajl je prevelik (maksimalno ${MAX_SIZE_BYTES / (1024 * 1024)} MB).`);
  }
  if (!ALLOWED_MIME.has(input.mime)) {
    throw new Error("Dozvoljeni formati su PDF, JPG, PNG i WEBP.");
  }
  if (!isAttachmentCategory(input.category)) {
    throw new Error("Nepoznata kategorija dokumenta.");
  }
}

function storageDir(): string {
  const dir = path.join(process.cwd(), process.env.STORAGE_DIR ?? "./var/storage", "attachments");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write the file to disk and return everything needed for an Attachment row — does not touch the DB. */
function stageFile(input: { buffer: Buffer; filename: string }): { filePath: string; sha256: string } {
  const hash = createHash("sha256").update(input.buffer).digest("hex");
  const safeName = input.filename.replace(/[^\w.\-]+/g, "_").slice(-120);
  const filePath = path.join(storageDir(), `${Date.now()}_${hash.slice(0, 12)}_${safeName}`);
  fs.writeFileSync(filePath, input.buffer);
  return { filePath, sha256: hash };
}

/**
 * Create an Attachment row for a document tied to a specific record, INSIDE an existing
 * transaction (e.g. alongside creating the OwnershipStake it proves). Callers use this when
 * the attachment is one leg of a larger atomic operation; use uploadAttachment() otherwise.
 */
export async function createLinkedAttachmentTx(tx: Tx, actor: Actor, input: UploadInput) {
  assertUploadable(input);
  const { filePath, sha256 } = stageFile(input);
  const row = await tx.attachment.create({
    data: {
      filename: input.filename,
      mime: input.mime,
      size: input.buffer.length,
      filePath,
      sha256,
      uploadedById: actor.userId,
      category: input.category,
      linkedType: input.linkedType ?? null,
      linkedId: input.linkedId ?? null,
    },
  });
  await audit(actor, {
    action: "attachment.upload",
    targetType: "Attachment",
    targetId: row.id,
    after: { category: input.category, linkedType: input.linkedType ?? null, linkedId: input.linkedId ?? null, filename: input.filename },
  }, tx);
  return row;
}

/** Upload a general library document (report, scanned invoice, minutes, contract...). */
export async function uploadAttachment(actor: Actor, input: UploadInput) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  assertUploadable(input);
  const { filePath, sha256 } = stageFile(input);
  const row = await prisma.attachment.create({
    data: {
      filename: input.filename,
      mime: input.mime,
      size: input.buffer.length,
      filePath,
      sha256,
      uploadedById: actor.userId,
      category: input.category,
      linkedType: input.linkedType ?? null,
      linkedId: input.linkedId ?? null,
    },
  });
  await audit(actor, {
    action: "attachment.upload",
    targetType: "Attachment",
    targetId: row.id,
    after: { category: input.category, filename: input.filename },
  });
  return row;
}

export async function listAttachments(actor: Actor, filter?: { category?: string; linkedType?: string; linkedId?: string }) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return prisma.attachment.findMany({
    where: {
      category: filter?.category || undefined,
      linkedType: filter?.linkedType,
      linkedId: filter?.linkedId,
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Attachments proving a set of ownership stakes, keyed by stake id — for display alongside them. */
export async function listOwnershipProofsByStakeIds(actor: Actor, stakeIds: string[]): Promise<Map<string, { id: string; filename: string }>> {
  requireAnyUser(actor);
  if (stakeIds.length === 0) return new Map();
  const rows = await prisma.attachment.findMany({
    where: { category: "OWNERSHIP_PROOF", linkedType: "OwnershipStake", linkedId: { in: stakeIds } },
    select: { id: true, filename: true, linkedId: true },
  });
  return new Map(rows.map((r) => [r.linkedId as string, { id: r.id, filename: r.filename }]));
}

/**
 * Read an attachment's file with access control. Management can read anything; an owner can
 * read only the ownership-proof document(s) attached to their own stake(s) — mirrors the
 * self-or-management pattern used throughout (see readDocumentFile for the Document equivalent).
 */
export async function readAttachmentFile(actor: Actor, id: string): Promise<{ attachment: { filename: string; mime: string }; buffer: Buffer }> {
  requireAnyUser(actor);
  const a = await prisma.attachment.findUniqueOrThrow({ where: { id } });
  const isManagement = actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
  if (!isManagement) {
    let allowed = false;
    if (a.category === "OWNERSHIP_PROOF" && a.linkedType === "OwnershipStake" && a.linkedId) {
      const stake = await prisma.ownershipStake.findUnique({ where: { id: a.linkedId } });
      allowed = !!stake && stake.ownerId === actor.partyId;
    }
    if (a.category === "CONSENT" && a.linkedType === "Party" && a.linkedId) {
      allowed = a.linkedId === actor.partyId;
    }
    if (!allowed) throw new ForbiddenError();
  }
  await audit(actor, { action: "attachment.download", targetType: "Attachment", targetId: a.id });
  return { attachment: { filename: a.filename, mime: a.mime }, buffer: fs.readFileSync(a.filePath) };
}
