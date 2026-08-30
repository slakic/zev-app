import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Generate a cryptographically secure URL-safe token (default 32 bytes = 256 bits). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Short numeric one-time code for identity confirmation (6 digits, CSPRNG). */
export function generateVerificationCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

/** Only hashes are ever stored or logged. */
export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
