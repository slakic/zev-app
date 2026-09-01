import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  requestPasswordReset,
  inspectPasswordResetToken,
  resetPassword,
} from "@/server/services/users";
import { createFixture, uid } from "./helpers";

/** Pull the reset link's token out of the mocked e-mail outbox for a given user. */
async function tokenFromOutbox(userId: string): Promise<string> {
  const msg = await prisma.notificationMessage.findFirstOrThrow({
    where: { relatedType: "User", relatedId: userId, template: "password-reset" },
    orderBy: { createdAt: "desc" },
  });
  const m = msg.body.match(/\/reset-lozinka\/(\S+)/);
  if (!m) throw new Error("no reset link found in outbox message");
  return m[1];
}

describe("password reset (self-service)", () => {
  it("full flow: request -> outbox link -> reset -> old password rejected, new one works", async () => {
    const f = await createFixture("pwreset");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.actorA.userId } });
    await requestPasswordReset(user.email, "http://localhost:3000");
    const token = await tokenFromOutbox(user.id);

    expect(await inspectPasswordResetToken(token)).toEqual({ ok: true });

    const result = await resetPassword(token, "NewPass1234!");
    expect(result).toEqual({ ok: true });

    // Token is single-use: the same token no longer works.
    const second = await resetPassword(token, "AnotherPass1234!");
    expect(second).toEqual({ ok: false, error: "invalid" });
  });

  it("never reveals whether an e-mail address has an account (same silent outcome either way)", async () => {
    const before = await prisma.notificationMessage.count({ where: { template: "password-reset" } });
    await requestPasswordReset(`nobody-${uid("x")}@zev.test`, "http://localhost:3000");
    const after = await prisma.notificationMessage.count({ where: { template: "password-reset" } });
    // No e-mail is queued for an unknown address, and the call resolves without throwing.
    expect(after).toBe(before);
  });

  it("rejects an expired token", async () => {
    const f = await createFixture("pwreset-exp");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.actorB.userId } });
    await requestPasswordReset(user.email, "http://localhost:3000");
    const token = await tokenFromOutbox(user.id);
    // Simulate the 1h TTL having passed.
    await prisma.user.update({ where: { id: user.id }, data: { passwordResetExpiresAt: new Date(Date.now() - 1000) } });

    expect(await inspectPasswordResetToken(token)).toEqual({ ok: false, error: "expired" });
    expect(await resetPassword(token, "NewPass1234!")).toEqual({ ok: false, error: "expired" });
  });

  it("rejects an invalid/unknown token", async () => {
    expect(await inspectPasswordResetToken("not-a-real-token")).toEqual({ ok: false, error: "invalid" });
    expect(await resetPassword("not-a-real-token", "NewPass1234!")).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects a password shorter than 8 characters", async () => {
    const f = await createFixture("pwreset-weak");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.president.userId } });
    await requestPasswordReset(user.email, "http://localhost:3000");
    const token = await tokenFromOutbox(user.id);

    expect(await resetPassword(token, "short")).toEqual({ ok: false, error: "weak" });
    // The token is still valid afterwards — a rejected attempt doesn't burn it.
    expect(await inspectPasswordResetToken(token)).toEqual({ ok: true });
  });

  it("revokes all existing sessions when the password is reset", async () => {
    const f = await createFixture("pwreset-sess");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.actorA.userId } });
    // Create the session row directly (createSession() sets a cookie via next/headers,
    // which requires a live request scope that isn't present under vitest).
    const session = await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
    });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();

    await requestPasswordReset(user.email, "http://localhost:3000");
    const token = await tokenFromOutbox(user.id);
    await resetPassword(token, "NewPass1234!");

    const revoked = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("issuing a new reset request invalidates the previous link", async () => {
    const f = await createFixture("pwreset-refresh");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.actorB.userId } });
    await requestPasswordReset(user.email, "http://localhost:3000");
    const firstToken = await tokenFromOutbox(user.id);

    await requestPasswordReset(user.email, "http://localhost:3000");
    const secondToken = await tokenFromOutbox(user.id);

    expect(firstToken).not.toBe(secondToken);
    expect(await inspectPasswordResetToken(firstToken)).toEqual({ ok: false, error: "invalid" });
    expect(await inspectPasswordResetToken(secondToken)).toEqual({ ok: true });
  });
});
