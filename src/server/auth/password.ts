import bcrypt from "bcryptjs";

const ROUNDS = 12;
const MIN_LENGTH = 8;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Single place for the password-strength rule, shared by every flow that sets a
 * password directly (resetPassword, createUserForParty, createTenant, and the
 * upcoming createTenantAccount) — see Plans/tenant-switching-admin-accounts-plan.md
 * §6.2. Threshold intentionally stays at 8 chars in this pass (matches the length
 * check resetPassword already had); tightening it is a separate decision since it
 * would change behavior of the existing reset flow too, not just new ones.
 */
export function assertPasswordStrong(password: string): void {
  if (password.length < MIN_LENGTH) {
    throw new Error(`Lozinka mora imati bar ${MIN_LENGTH} znakova.`);
  }
}
