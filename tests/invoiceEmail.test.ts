// Plans/invoice-email-delivery-plan.md: the owner's choice (Party.invoiceEmailDelivery), the outbox
// rows written after issuing/correcting/cancelling, the bounded dispatch (limit, budget, daily cap),
// the PDF attachment through the mock and Mailjet providers, and the privacy of the message text.
// Mailjet is never called for real (fetch is mocked); PlatformSetting rows are global, so tests that
// change the allowlist restore it, and the env is saved/restored like in tests/emailTest.test.ts.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createAreaCharges, createSuperAdminActor } from "./helpers";
import { createDraftBatch, issueBatch, issueSingleInvoice, correctInvoice, cancelInvoice } from "@/server/services/billing";
import { updateParty } from "@/server/services/ownership";
import { adminUpdateEmailSettings } from "@/server/services/platformSettings";
import { formatMoney } from "@/lib/money";
import { ForbiddenError } from "@/server/auth/guards";
import { ALLOWLIST_BLOCKED_ERROR, dispatchNotification, enqueueNotification } from "@/server/notifications/service";
import { generateInvoicePdf } from "@/server/services/documents";
import {
  INVOICE_EMAIL_TEMPLATE,
  buildInvoiceEmail,
  countOptedInDebtors,
  dispatchInvoiceEmails,
  getBatchEmailSummary,
  getInvoiceEmailStatus,
  queueInvoiceEmails,
  retryInvoiceEmails,
  sendInvoiceEmailNow,
  setInvoiceEmailDelivery,
} from "@/server/services/invoiceEmail";

function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const MJ_OK = { Messages: [{ Status: "success", To: [{ Email: "x@y.ba", MessageID: 1 }] }] };

const ENV_KEYS = ["EMAIL_PROVIDER", "MAILJET_API_KEY", "MAILJET_API_SECRET", "MAILJET_FROM_EMAIL", "EMAIL_DAILY_SOFT_LIMIT"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function useMailjet() {
  process.env.EMAIL_PROVIDER = "mailjet";
  process.env.MAILJET_API_KEY = "test-key";
  process.env.MAILJET_API_SECRET = "test-secret";
  process.env.MAILJET_FROM_EMAIL = "noreply@zev.test";
  // Sent mail is counted over the whole (persistent) test DB for 24 h, so keep the cap out of the way.
  process.env.EMAIL_DAILY_SOFT_LIMIT = "1000000";
}

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
  await prisma.platformSetting.deleteMany({ where: { key: { startsWith: "email." } } });
});

/** A fixture with a draft+issued batch; ownerA (two units) opted in unless told otherwise. */
async function issued(tag: string, opts?: { optInA?: boolean; optInB?: boolean }) {
  const f = await createFixture(tag);
  if (opts?.optInA !== false) await setInvoiceEmailDelivery(f.actorA, f.ownerA.id, true);
  if (opts?.optInB) await setInvoiceEmailDelivery(f.actorB, f.ownerB.id, true);
  const charges = await createAreaCharges(f, "1.00");
  const { batch } = await createDraftBatch(f.accountant, "2031-05", undefined, charges);
  const invoices = await issueBatch(f.accountant, batch.id);
  return { f, batch, invoices };
}

const messagesFor = (invoiceIds: string[]) =>
  prisma.notificationMessage.findMany({ where: { relatedType: "Invoice", relatedId: { in: invoiceIds } }, orderBy: { createdAt: "asc" } });

describe("owner's choice (tests 1-4)", () => {
  it("1. an owner enables it for self: flag, timestamp, audit with the address; a repeat call audits nothing new", async () => {
    const f = await createFixture("ie-opt");
    const p = await setInvoiceEmailDelivery(f.actorA, f.ownerA.id, true);
    expect(p.invoiceEmailDelivery).toBe(true);
    expect(p.invoiceEmailDeliveryAt).not.toBeNull();
    const audits = await prisma.auditEvent.findMany({ where: { action: "party.invoice_email.enable", targetId: f.ownerA.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0].after).toMatchObject({ enabled: true, email: f.ownerA.email, byOwner: true });
    await setInvoiceEmailDelivery(f.actorA, f.ownerA.id, true);
    expect(await prisma.auditEvent.count({ where: { action: "party.invoice_email.enable", targetId: f.ownerA.id } })).toBe(1);

    const off = await setInvoiceEmailDelivery(f.actorA, f.ownerA.id, false);
    expect(off.invoiceEmailDelivery).toBe(false);
    expect(off.invoiceEmailDeliveryAt).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "party.invoice_email.disable", targetId: f.ownerA.id } })).toBe(1);
  });

  it("2. needs a valid address: empty and malformed ones are refused and nothing changes", async () => {
    const f = await createFixture("ie-addr");
    await prisma.party.update({ where: { id: f.ownerA.id }, data: { email: null } });
    await expect(setInvoiceEmailDelivery(f.actorA, f.ownerA.id, true)).rejects.toThrow(/potrebna je e-mail adresa/);
    await prisma.party.update({ where: { id: f.ownerA.id }, data: { email: "nije-adresa" } });
    await expect(setInvoiceEmailDelivery(f.actorA, f.ownerA.id, true)).rejects.toThrow(/nije ispravna/);
    const after = await prisma.party.findUniqueOrThrow({ where: { id: f.ownerA.id } });
    expect(after.invoiceEmailDelivery).toBe(false);
    expect(await prisma.auditEvent.count({ where: { action: "party.invoice_email.enable", targetId: f.ownerA.id } })).toBe(0);
  });

  it("3. an owner cannot toggle another owner; the accountant can for an owner without an account, with a note", async () => {
    const f = await createFixture("ie-who");
    await expect(setInvoiceEmailDelivery(f.actorA, f.ownerB.id, true)).rejects.toThrow(ForbiddenError);
    await setInvoiceEmailDelivery(f.accountant, f.ownerC.id, true, { reason: "pisani zahtjev od 1.5." });
    const a = await prisma.auditEvent.findFirstOrThrow({ where: { action: "party.invoice_email.enable", targetId: f.ownerC.id } });
    expect(a.reason).toBe("pisani zahtjev od 1.5.");
    expect(a.after).toMatchObject({ enabled: true, byOwner: false });
  });

  it("4. updateParty keeps the address valid while the option is on", async () => {
    const f = await createFixture("ie-upd");
    // off: blanking is fine
    await updateParty(f.actorA, f.ownerA.id, { email: null });
    await updateParty(f.actorA, f.ownerA.id, { email: `${f.t}-a2@example.com` });
    await setInvoiceEmailDelivery(f.actorA, f.ownerA.id, true);
    await expect(updateParty(f.actorA, f.ownerA.id, { email: null })).rejects.toThrow(/ne može biti prazna/);
    await expect(updateParty(f.actorA, f.ownerA.id, { email: "nije-adresa" })).rejects.toThrow(/ispravnu e-mail adresu/);
    await updateParty(f.actorA, f.ownerA.id, { phone: "065 111 222" }); // email not in data -> untouched
    await updateParty(f.actorA, f.ownerA.id, { email: `${f.t}-nova@example.com` });
    const p = await prisma.party.findUniqueOrThrow({ where: { id: f.ownerA.id } });
    expect(p.email).toBe(`${f.t}-nova@example.com`);
    expect(p.invoiceEmailDelivery).toBe(true);
  });
});

describe("outbox and dispatch (tests 5-13)", () => {
  it("5. issuing queues one invoice-delivery message per invoice of an opted-in debtor, with the PDF; none for others", async () => {
    const { f, invoices } = await issued("ie-q");
    const ofA = invoices.filter((i) => i.debtorId === f.ownerA.id);
    const ofB = invoices.filter((i) => i.debtorId === f.ownerB.id);
    expect(ofA.length).toBe(2); // u1 + u4
    const msgs = await messagesFor(ofA.map((i) => i.id));
    expect(msgs).toHaveLength(2);
    for (const m of msgs) {
      expect(m).toMatchObject({ template: INVOICE_EMAIL_TEMPLATE.ISSUED, status: "QUEUED", toAddress: f.ownerA.email, recipientId: f.ownerA.id });
      const doc = await prisma.document.findUniqueOrThrow({ where: { id: m.attachmentDocumentId! } });
      expect(doc).toMatchObject({ type: "INVOICE", sourceType: "Invoice", sourceId: m.relatedId });
    }
    expect(await messagesFor(ofB.map((i) => i.id))).toHaveLength(0);
    // the old send-to-everyone template is gone
    expect(await prisma.notificationMessage.count({ where: { zevId: f.zev.id, template: "invoice-issued" } })).toBe(0);
  });

  it("6. queueInvoiceEmails twice for the same invoice keeps one message", async () => {
    const { f, invoices } = await issued("ie-idem");
    const inv = invoices.find((i) => i.debtorId === f.ownerA.id)!;
    const r = await queueInvoiceEmails(f.accountant, [inv.id], "ISSUED");
    expect(r).toEqual({ queued: 0, skipped: 1 });
    expect(await messagesFor([inv.id])).toHaveLength(1);
  });

  it("7. mock dispatch delivers with the attachment noted; a second call does nothing; audited", async () => {
    const { f, batch, invoices } = await issued("ie-mock");
    const res = await dispatchInvoiceEmails(f.accountant, { batchId: batch.id });
    expect(res).toMatchObject({ attempted: 2, sent: 2, failed: 0, pending: 0, dailyLimitReached: false });
    const msgs = await messagesFor(invoices.map((i) => i.id));
    for (const m of msgs) {
      expect(m.status).toBe("DELIVERED");
      expect(m.attempts).toBe(1);
      expect(JSON.stringify(m.events)).toMatch(/\.pdf/);
    }
    const again = await dispatchInvoiceEmails(f.accountant, { batchId: batch.id });
    expect(again.attempted).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "invoice_email.dispatch", targetId: batch.id } })).toBe(1);
  });

  it("8. Mailjet: PDF attachment, text with the invoice number and opt-out hint, no amounts", async () => {
    useMailjet();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200, MJ_OK));
    const { f, batch, invoices } = await issued("ie-mj");
    await dispatchInvoiceEmails(f.accountant, { batchId: batch.id });
    expect(spy).toHaveBeenCalledTimes(2);
    for (const [, init] of spy.mock.calls) {
      const msg = JSON.parse(init!.body as string).Messages[0];
      const inv = invoices.find((i) => msg.TextPart.includes(i.number))!;
      expect(inv).toBeDefined();
      expect(msg.Attachments).toHaveLength(1);
      expect(msg.Attachments[0].Filename).toBe(`${inv.number}.pdf`);
      expect(msg.Attachments[0].ContentType).toBe("application/pdf");
      expect(Buffer.from(msg.Attachments[0].Base64Content, "base64").subarray(0, 4).toString()).toBe("%PDF");
      expect(msg.TextPart).toContain("Podešavanja → Moji podaci");
      expect(msg.TextPart).not.toContain(formatMoney(inv.total.toString()));
      expect(msg.TextPart.toLowerCase()).not.toContain("saldo");
    }
  });

  it("9. a Mailjet failure is FAILED with the error; retry succeeds on attempt 2 and is audited", async () => {
    useMailjet();
    const { f, batch, invoices } = await issued("ie-retry");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(400, { Messages: [{ Status: "error", Errors: [{ ErrorMessage: "Sender not validated" }] }] }));
    const first = await dispatchInvoiceEmails(f.accountant, { batchId: batch.id });
    expect(first).toMatchObject({ sent: 0, failed: 2 });
    const failed = await messagesFor(invoices.map((i) => i.id));
    expect(failed.every((m) => m.status === "FAILED" && m.lastError === "Sender not validated" && m.attempts === 1)).toBe(true);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200, MJ_OK));
    const res = await retryInvoiceEmails(f.accountant, { batchId: batch.id });
    expect(res.sent).toBe(2);
    const after = await messagesFor(invoices.map((i) => i.id));
    expect(after.every((m) => m.status === "SENT" && m.attempts === 2 && m.lastError === null)).toBe(true);
    expect(await prisma.auditEvent.count({ where: { action: "invoice_email.retry", targetId: batch.id } })).toBe(1);
  });

  it("10. the go-live allowlist blocks other addresses without calling Mailjet", async () => {
    useMailjet();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200, MJ_OK));
    const sa = await createSuperAdminActor("ie-sa");
    await adminUpdateEmailSettings(sa, { fromName: "", appendZevName: true, recipientAllowlist: "ja@primjer.ba" });
    const { f, batch, invoices } = await issued("ie-allow");
    await dispatchInvoiceEmails(f.accountant, { batchId: batch.id });
    expect(spy).not.toHaveBeenCalled();
    const msgs = await messagesFor(invoices.map((i) => i.id));
    expect(msgs.every((m) => m.status === "FAILED" && m.lastError === ALLOWLIST_BLOCKED_ERROR)).toBe(true);
  });

  it("11. max bounds one call: one sent, one still pending", async () => {
    const { f, batch } = await issued("ie-max");
    const res = await dispatchInvoiceEmails(f.accountant, { batchId: batch.id }, { max: 1 });
    expect(res).toMatchObject({ attempted: 1, sent: 1, pending: 1 });
  });

  it("12. the daily limit stops sending and keeps messages queued", async () => {
    const { f, batch, invoices } = await issued("ie-day");
    const res = await dispatchInvoiceEmails(f.accountant, { batchId: batch.id }, { dailyLimit: 0 });
    expect(res).toMatchObject({ attempted: 0, sent: 0, pending: 2, dailyLimitReached: true });
    const msgs = await messagesFor(invoices.map((i) => i.id));
    expect(msgs.every((m) => m.status === "QUEUED")).toBe(true);
  });

  it("13. two parallel dispatches of one message call the provider once", async () => {
    useMailjet();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return fakeResponse(200, MJ_OK);
    });
    const { invoices } = await issued("ie-par");
    const [m] = await messagesFor([invoices[0].id, invoices[1].id]);
    await Promise.all([dispatchNotification(m.id), dispatchNotification(m.id)]);
    expect(spy).toHaveBeenCalledTimes(1);
    const after = await prisma.notificationMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.attempts).toBe(1);
    expect(after.status).toBe("SENT");
  });

  it("13b. a dispatch arriving while another one still holds the message does not send it again; a stale lease is taken over", async () => {
    useMailjet();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200, MJ_OK));
    const { invoices } = await issued("ie-lease");
    const [m] = await messagesFor([invoices[0].id, invoices[1].id]);
    // Another dispatch claimed it a moment ago and is still sending (status still QUEUED).
    await prisma.notificationMessage.update({ where: { id: m.id }, data: { dispatchingAt: new Date(), attempts: 1 } });
    await dispatchNotification(m.id);
    expect(spy).not.toHaveBeenCalled();
    expect((await prisma.notificationMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("QUEUED");
    // That send crashed long ago: its lease expired, so a new dispatch may send (once) and releases it.
    await prisma.notificationMessage.update({ where: { id: m.id }, data: { dispatchingAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await dispatchNotification(m.id);
    expect(spy).toHaveBeenCalledTimes(1);
    const after = await prisma.notificationMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ status: "SENT", attempts: 2, dispatchingAt: null });
  });
});

describe("correction, cancellation, single invoice (tests 14-16)", () => {
  let ctx: Awaited<ReturnType<typeof issued>>;
  beforeEach(async () => {
    ctx = await issued("ie-life");
  });

  it("14. a correction queues invoice-delivery-corrected with the corrective PDF and the original's number", async () => {
    const { f, invoices } = ctx;
    const original = invoices.find((i) => i.debtorId === f.ownerA.id)!;
    const corrective = await correctInvoice(f.accountant, original.id, { newTotal: "12.00", description: "Ispravka", reason: "greška" });
    const [m] = await messagesFor([corrective.id]);
    expect(m.template).toBe(INVOICE_EMAIL_TEMPLATE.CORRECTED);
    expect(m.body).toContain(original.number);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: m.attachmentDocumentId! } });
    expect(doc.sourceId).toBe(corrective.id);
  });

  it("15. a cancellation queues a short notice without an attachment", async () => {
    const { f, invoices } = ctx;
    const inv = invoices.filter((i) => i.debtorId === f.ownerA.id)[1];
    await cancelInvoice(f.accountant, inv.id, "greškom izdata");
    const msgs = (await messagesFor([inv.id])).filter((m) => m.template === INVOICE_EMAIL_TEMPLATE.CANCELLED);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].attachmentDocumentId).toBeNull();
    expect(msgs[0].body).toContain("stornirana");
  });

  it("16. the app link is only included for an owner with an account", async () => {
    const { f } = ctx;
    await setInvoiceEmailDelivery(f.accountant, f.ownerC.id, true, { reason: "telefonom" });
    const base = { unitId: f.u3.id, dueDate: new Date(Date.now() + 864e5), description: "Jednokratno", amount: "5.00" };
    const invC = await issueSingleInvoice(f.accountant, { ...base, debtorId: f.ownerC.id });
    const invA = await issueSingleInvoice(f.accountant, { ...base, debtorId: f.ownerA.id });
    const [mC] = await messagesFor([invC.id]);
    const [mA] = await messagesFor([invA.id]);
    expect(mC.toAddress).toBe(f.ownerC.email);
    expect(mC.body).not.toContain("/fakture/");
    expect(mA.body).toContain(`http://localhost:3000/fakture/${invA.id}`);
  });
});

describe("safety and visibility (tests 17-19)", () => {
  it("17. an attachment from another ZEV is refused", async () => {
    const { f } = await issued("ie-x1");
    const other = await issued("ie-x2", { optInA: false });
    const foreignInv = other.invoices[0];
    const foreignDoc = await generateInvoicePdf(other.f.accountant, foreignInv.id);
    const m = await enqueueNotification({
      zevId: f.zev.id, channel: "EMAIL", toAddress: f.ownerA.email!, subject: "S", body: "B",
      attachmentDocumentId: foreignDoc.id,
    });
    const res = await dispatchNotification(m.id);
    expect(res.status).toBe("FAILED");
    expect(res.lastError).toBe("Prilog poruke nije pronađen.");
  });

  it("18. another ZEV's accountant cannot dispatch or retry a foreign batch", async () => {
    const { batch } = await issued("ie-iso1");
    const other = await createFixture("ie-iso2");
    await expect(dispatchInvoiceEmails(other.accountant, { batchId: batch.id })).rejects.toThrow();
    await expect(retryInvoiceEmails(other.accountant, { batchId: batch.id })).rejects.toThrow();
  });

  it("19. status is visible to the debtor and management only; the batch summary is management-only", async () => {
    const { f, batch, invoices } = await issued("ie-vis");
    const invA = invoices.find((i) => i.debtorId === f.ownerA.id)!;
    expect((await getInvoiceEmailStatus(f.actorA, invA.id))?.status).toBe("QUEUED");
    await expect(getInvoiceEmailStatus(f.actorB, invA.id)).rejects.toThrow(ForbiddenError);
    expect(await getInvoiceEmailStatus(f.actorB, invoices.find((i) => i.debtorId === f.ownerB.id)!.id)).toBeNull();
    await expect(getBatchEmailSummary(f.actorA, batch.id)).rejects.toThrow(ForbiddenError);
    const s = await getBatchEmailSummary(f.accountant, batch.id);
    expect(s).toMatchObject({ optedIn: 2, queued: 2, sent: 0, failed: 0 });
    expect(await countOptedInDebtors(f.accountant, [f.ownerA.id, f.ownerB.id])).toBe(1);
  });

  it("sendInvoiceEmailNow sends an older invoice once the debtor opts in, and refuses a debtor who did not", async () => {
    const { f, invoices } = await issued("ie-now", { optInA: false });
    const invA = invoices.find((i) => i.debtorId === f.ownerA.id)!;
    await expect(sendInvoiceEmailNow(f.accountant, invA.id)).rejects.toThrow(/nije uključio/);
    await setInvoiceEmailDelivery(f.actorA, f.ownerA.id, true);
    const r = await sendInvoiceEmailNow(f.accountant, invA.id);
    expect(r.sent).toBe(1);
  });
});

describe("message text (test 20)", () => {
  const data = {
    recipientName: "Ana Anić", zevName: "Zgrada 7", number: "FAK-2026-000001", periodLabel: "2026-08",
    dueDate: new Date("2026-08-15T12:00:00Z"), paymentReference: "202608-ABC123", link: "https://x.test/fakture/1",
    hasAccount: true, replacesNumber: "FAK-2026-000000",
  };

  it("20. subjects, link only with an account, period only when present, no amounts", () => {
    const issuedMsg = buildInvoiceEmail("ISSUED", data);
    expect(issuedMsg.subject).toBe("Faktura FAK-2026-000001 — Zgrada 7");
    expect(issuedMsg.body).toContain("za period 2026-08");
    expect(issuedMsg.body).toContain("https://x.test/fakture/1");
    expect(issuedMsg.body).toContain("Poziv na broj: 202608-ABC123");

    const noAccount = buildInvoiceEmail("ISSUED", { ...data, hasAccount: false, periodLabel: null });
    expect(noAccount.body).not.toContain("/fakture/");
    expect(noAccount.body).not.toContain("za period");

    const corrected = buildInvoiceEmail("CORRECTED", data);
    expect(corrected.subject).toBe("Korigovana faktura FAK-2026-000001 (zamjenjuje FAK-2026-000000) — Zgrada 7");
    expect(corrected.body).toContain("zamjenjuje fakturu FAK-2026-000000");

    const cancelled = buildInvoiceEmail("CANCELLED", data);
    expect(cancelled.subject).toBe("Stornirana faktura FAK-2026-000001 — Zgrada 7");
    expect(cancelled.body).toContain("stornirana i ne treba je plaćati");
    expect(buildInvoiceEmail("CANCELLED", { ...data, hasAccount: false }).body).not.toContain("/fakture/");
    for (const m of [issuedMsg, corrected, cancelled]) expect(m.body).not.toMatch(/KM|saldo|dug/i);
  });
});
