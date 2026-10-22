// Plans/email-sender-name-and-test-email-plan.md (v2.38.0): sender display name, Mailjet error
// parsing, the outbox's lastError, platform e-mail settings (super admin), the go-live allowlist
// and the "Probna e-mail poruka" service. Mailjet is never called for real (fetch is mocked).
// PlatformSetting rows are global, so every test that changes them restores the defaults.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createSuperAdminActor, uid } from "./helpers";
import { MailjetEmailProvider, sanitizeFromName } from "@/server/notifications/mailjetEmail";
import { describeEmailProvider } from "@/server/notifications/providers";
import { queueNotification, ALLOWLIST_BLOCKED_ERROR } from "@/server/notifications/service";
import {
  adminGetEmailSettings,
  adminUpdateEmailSettings,
  isRecipientAllowed,
  parseRecipientAllowlist,
} from "@/server/services/platformSettings";
import { buildFromName } from "@/lib/emailFromName";
import {
  sendTestEmail,
  getTestEmailStatus,
  adminSendTestEmail,
  TEST_EMAIL_PER_USER_HOUR,
} from "@/server/services/emailTest";
import { ForbiddenError } from "@/server/auth/guards";

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const ENV_KEYS = ["EMAIL_PROVIDER", "MAILJET_API_KEY", "MAILJET_API_SECRET", "MAILJET_FROM_EMAIL", "MAILJET_FROM_NAME"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function useMailjet() {
  process.env.EMAIL_PROVIDER = "mailjet";
  process.env.MAILJET_API_KEY = "test-key";
  process.env.MAILJET_API_SECRET = "test-secret";
  process.env.MAILJET_FROM_EMAIL = "noreply@zev.test";
}

async function resetPlatformEmailSettings() {
  await prisma.platformSetting.deleteMany({ where: { key: { startsWith: "email." } } });
}

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
  await resetPlatformEmailSettings();
});

describe("sender name and Mailjet errors", () => {
  beforeEach(useMailjet);

  it("sends From.Name: the given name, else MAILJET_FROM_NAME, else „ZEV upravnik”", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200, { Messages: [{ Status: "success", To: [{ Email: "a@b.ba" }] }] }));
    const p = new MailjetEmailProvider();
    await p.send({ to: "a@b.ba", subject: "S", body: "B" });
    process.env.MAILJET_FROM_NAME = "Upravnik iz env-a";
    await p.send({ to: "a@b.ba", subject: "S", body: "B" });
    await p.send({ to: "a@b.ba", subject: "S", body: "B", fromName: "ZEV upravnik – Zgrada 7" });
    const names = spy.mock.calls.map(([, init]) => JSON.parse(init!.body as string).Messages[0].From.Name);
    expect(names).toEqual(["ZEV upravnik", "Upravnik iz env-a", "ZEV upravnik – Zgrada 7"]);
  });

  it("sanitizes the display name and builds the ZEV variant", () => {
    expect(sanitizeFromName('Zgrada "7"\r\nBcc: <x@y.ba>')).toBe("Zgrada 7 Bcc: x@y.ba");
    expect(sanitizeFromName("a".repeat(100))).toHaveLength(70);
    expect(buildFromName("ZEV upravnik", { shortName: "Kneza Miloša 12", legalName: "ZEV Kneza Miloša 12 Banja Luka" })).toBe("ZEV upravnik – Kneza Miloša 12");
    expect(buildFromName("ZEV upravnik", { shortName: null, legalName: "X".repeat(60) })).toMatch(/^ZEV upravnik – X{39}…$/);
    expect(buildFromName("ZEV upravnik", null)).toBe("ZEV upravnik");
  });

  it("reports a request-level Mailjet error (wrong API key) by its message, not just the HTTP code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(401, { ErrorMessage: "API key authentication/authorization failure", StatusCode: 401 }));
    const r = await new MailjetEmailProvider().send({ to: "a@b.ba", subject: "S", body: "B" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("API key authentication/authorization failure");
  });

  it("describeEmailProvider never exposes the key or the secret", () => {
    const info = describeEmailProvider();
    expect(info).toMatchObject({ kind: "mailjet", configured: true, fromEmail: "noreply@zev.test" });
    expect(JSON.stringify(info)).not.toMatch(/test-key|test-secret/);
    delete process.env.MAILJET_API_SECRET;
    expect(describeEmailProvider().configured).toBe(false);
  });

  it("the outbox now keeps the provider's error in lastError (it was lost before)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse(200, { Messages: [{ Status: "error", Errors: [{ ErrorMessage: "Sender is not validated" }] }] })
    );
    const f = await createFixture("et-lasterr");
    const msg = await queueNotification({ zevId: f.zev.id, channel: "EMAIL", toAddress: "a@b.ba", subject: "S", body: "B" });
    expect(msg.status).toBe("FAILED");
    expect(msg.lastError).toContain("Sender is not validated");
  });
});

describe("platform e-mail settings (super admin)", () => {
  it("only a super admin reads or changes them; changes are audited and validated", async () => {
    const sa = await createSuperAdminActor("et-sa");
    const f = await createFixture("et-settings");
    await expect(adminUpdateEmailSettings(f.president, { fromName: "X", appendZevName: true, recipientAllowlist: "" })).rejects.toThrow(ForbiddenError);
    await expect(adminGetEmailSettings(f.accountant)).rejects.toThrow(ForbiddenError);

    const before = await adminGetEmailSettings(sa);
    expect(before).toMatchObject({ fromName: null, appendZevName: true, recipientAllowlist: [], effectiveFromName: "ZEV upravnik" });

    const after = await adminUpdateEmailSettings(sa, { fromName: "Upravnik", appendZevName: false, recipientAllowlist: "Ja@Primjer.ba\n@zevupravnik.com" });
    expect(after).toEqual({ fromName: "Upravnik", appendZevName: false, recipientAllowlist: ["ja@primjer.ba", "@zevupravnik.com"] });
    expect(await prisma.auditEvent.count({ where: { action: "platform.email_settings.update", actorId: sa.userId } })).toBe(1);

    await expect(adminUpdateEmailSettings(sa, { fromName: "", appendZevName: true, recipientAllowlist: "nije adresa" })).rejects.toThrow(/Neispravna stavka/);
  });

  it("allowlist matching: exact address or @domain; empty = everyone", () => {
    const list = parseRecipientAllowlist("ja@primjer.ba, @zevupravnik.com");
    expect(isRecipientAllowed("JA@primjer.ba", list)).toBe(true);
    expect(isRecipientAllowed("info@zevupravnik.com", list)).toBe(true);
    expect(isRecipientAllowed("drugi@primjer.ba", list)).toBe(false);
    expect(isRecipientAllowed("bilo@ko.ba", [])).toBe(true);
  });

  it("with Mailjet on and an allowlist set, other recipients are blocked without calling Mailjet", async () => {
    useMailjet();
    const sa = await createSuperAdminActor("et-allow");
    await adminUpdateEmailSettings(sa, { fromName: "", appendZevName: true, recipientAllowlist: "ja@primjer.ba" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200, { Messages: [{ Status: "success", To: [{ Email: "ja@primjer.ba" }] }] }));
    const f = await createFixture("et-allow-z");

    const blocked = await queueNotification({ zevId: f.zev.id, channel: "EMAIL", toAddress: "vlasnik@primjer.ba", subject: "S", body: "B" });
    expect(blocked.status).toBe("FAILED");
    expect(blocked.lastError).toBe(ALLOWLIST_BLOCKED_ERROR);
    expect(spy).not.toHaveBeenCalled();

    const sent = await queueNotification({ zevId: f.zev.id, channel: "EMAIL", toAddress: "ja@primjer.ba", subject: "S", body: "B" });
    expect(sent.status).toBe("SENT");
    // appendZevName (default on): the ZEV's own message carries its name.
    const name = JSON.parse(spy.mock.calls[0][1]!.body as string).Messages[0].From.Name;
    expect(name).toBe(buildFromName("ZEV upravnik", { shortName: null, legalName: f.zev.legalName }));
    expect(name).toContain("ZEV upravnik – ");
  });
});

describe("„Probna e-mail poruka”", () => {
  it("president → own login address: an outbox row, simulated in mock mode, audited, fixed text", async () => {
    const f = await createFixture("et-self");
    const res = await sendTestEmail(f.president, { target: "self" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.president.userId } });
    expect(res).toMatchObject({ ok: true, simulated: true, provider: "mock", toAddress: user.email, status: "DELIVERED" });
    const msg = await prisma.notificationMessage.findUniqueOrThrow({ where: { id: res.messageId } });
    expect(msg).toMatchObject({ zevId: f.zev.id, template: "test-email", subject: "Probna poruka — ZEV upravnik" });
    expect(msg.body).toContain(f.zev.legalName);
    expect(msg.body).toContain("http://localhost:3000");
    expect(msg.body).toContain("Molimo da na nju ne odgovarate.");
    expect(msg.body).not.toContain(user.email); // the sender's own address is never in the body
    expect(await prisma.auditEvent.count({ where: { action: "notification.test_email.send", targetId: res.messageId } })).toBe(1);
    expect((await getTestEmailStatus(f.president)).usedLastHour).toBe(1);
  });

  it("accountant may send to a typed address; an owner may not; bad addresses create nothing", async () => {
    const f = await createFixture("et-addr");
    const res = await sendTestEmail(f.accountant, { target: "address", address: "  Neko@Primjer.BA " });
    expect(res.toAddress).toBe("neko@primjer.ba");
    await expect(sendTestEmail(f.actorA, { target: "self" })).rejects.toThrow(ForbiddenError);
    for (const address of ["", "nije-adresa", "a@b.ba, c@d.ba", "a@b.ba\nBcc: x@y.ba", `${"a".repeat(250)}@b.ba`]) {
      await expect(sendTestEmail(f.accountant, { target: "address", address })).rejects.toThrow();
    }
    expect(await prisma.notificationMessage.count({ where: { zevId: f.zev.id, template: "test-email" } })).toBe(1);
  });

  it(`stops at ${TEST_EMAIL_PER_USER_HOUR} per hour per user (counted in the database) and audits the refusal`, async () => {
    const f = await createFixture("et-limit");
    for (let i = 0; i < TEST_EMAIL_PER_USER_HOUR; i++) await sendTestEmail(f.president, { target: "self" });
    await expect(sendTestEmail(f.president, { target: "self" })).rejects.toThrow(/limit/);
    expect(await prisma.auditEvent.count({ where: { action: "notification.test_email.rate_limited", actorId: f.president.userId } })).toBe(1);
    await expect(sendTestEmail(f.accountant, { target: "self" })).resolves.toMatchObject({ ok: true }); // per user
  });

  it("Mailjet failure comes back verbatim, with the outbox row FAILED", async () => {
    useMailjet();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse(200, { Messages: [{ Status: "error", Errors: [{ ErrorMessage: "Sender is not validated" }] }] })
    );
    const f = await createFixture("et-mjfail");
    const res = await sendTestEmail(f.president, { target: "self" });
    expect(res).toMatchObject({ ok: false, simulated: false, provider: "mailjet", status: "FAILED" });
    expect(res.error).toContain("Sender is not validated");
  });

  it("super admin sends at platform level (no ZEV); a ZEV user cannot use the admin variant", async () => {
    const sa = await createSuperAdminActor("et-adm");
    const res = await adminSendTestEmail(sa, { target: "address", address: `${uid("adm")}@primjer.ba` });
    const msg = await prisma.notificationMessage.findUniqueOrThrow({ where: { id: res.messageId } });
    expect(msg.zevId).toBeNull();
    expect(msg.body).toContain("administrator platforme");
    const f = await createFixture("et-adm-z");
    await expect(adminSendTestEmail(f.president, { target: "self" })).rejects.toThrow(ForbiddenError);
  });
});
