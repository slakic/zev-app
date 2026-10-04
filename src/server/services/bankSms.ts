// Bank SMS notifications -> a human-confirmed booking queue (Plans/bank-sms-ingestion-plan.md).
//
// An iOS Shortcuts automation on the president's/accountant's phone POSTs every Nova Banka SMS
// ("Priliv na ..." / "Odliv sa ...") to /api/uplate/sms. THIS FILE NEVER BOOKS ANYTHING FROM
// THAT REQUEST: receiveBankSms() only writes an IncomingBankSms row (the queue). A Payment /
// FinTransaction exists only after an ACCOUNTANT looks at the row and confirms it
// (confirmBankSms), through the same booking code the PDF statement import uses
// (payments.ts commitStatementRowsInTx). That is deliberate: an SMS carries no proof of
// authenticity — the only thing separating a real one from a forged one is the secret in the
// Shortcut — so a leaked secret may at worst fill the queue with junk, never the books.
//
// receiveBankSms() is the app's first caller that is NOT a logged-in user: it has no Actor and
// no session, `zevId` comes ONLY from the verified secret, and every failure looks the same.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireZev, type Actor } from "@/server/auth/guards";
import { generateToken, sha256, hashesEqual } from "@/server/auth/tokens";
import { getEnv } from "@/lib/env";
import { dec } from "@/lib/money";
import { foldDiacritics } from "@/lib/text";
import { toZonedDateIso } from "@/lib/i18n";
import type { Prisma } from "@/generated/prisma/client";
import { looksLikeBankSms, normalizeSmsText, parseNovaBankaSms } from "@/server/services/bankSmsParser";
import {
  accountDigitsMatch,
  assertStatementRowsCommittable,
  commitStatementRowsInTx,
  fetchOpenInvoiceCandidates,
  scoreExpenseMatch,
  scoreInvoiceMatch,
  type StatementRowInput,
} from "@/server/services/payments";
import { partyDisplayName } from "@/server/services/ownership";

/** Setting row holding this tenant's webhook secret (as a hash). Deliberately NOT one of the
 *  SettingKeys in settings-defaults.ts, so the generic "Parametri" form can neither show nor
 *  overwrite it — this file is the only code that touches this key. */
const WEBHOOK_SETTING_KEY = "bankSms.webhook";

type WebhookConfig = {
  tokenHash: string;
  issuedAt: string;
  issuedById: string | null;
  revokedAt: string | null;
  lastTestAt: string | null;
};

function readConfig(value: unknown): WebhookConfig | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.tokenHash !== "string") return null;
  return {
    tokenHash: v.tokenHash,
    issuedAt: typeof v.issuedAt === "string" ? v.issuedAt : "",
    issuedById: typeof v.issuedById === "string" ? v.issuedById : null,
    revokedAt: typeof v.revokedAt === "string" ? v.revokedAt : null,
    lastTestAt: typeof v.lastTestAt === "string" ? v.lastTestAt : null,
  };
}

async function loadWebhookConfig(zevId: string): Promise<WebhookConfig | null> {
  const row = await prisma.setting.findUnique({ where: { zevId_key: { zevId, key: WEBHOOK_SETTING_KEY } } });
  return row ? readConfig(row.value) : null;
}

async function saveWebhookConfig(zevId: string, config: WebhookConfig) {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { zevId_key: { zevId, key: WEBHOOK_SETTING_KEY } },
    create: { zevId, key: WEBHOOK_SETTING_KEY, value },
    update: { value },
  });
}

export function webhookUrl(): string {
  return `${getEnv().APP_URL.replace(/\/+$/, "")}/api/uplate/sms`;
}

// ---- Key management (PRESIDENT or ACCOUNTANT) -------------------------------------------

/** Generates (or replaces) the tenant's webhook key. The plain key is returned ONCE, here, and
 *  never stored or logged — only its hash is kept; the old key stops working immediately. */
export async function issueBankSmsToken(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const existing = await loadWebhookConfig(zevId);
  const secret = generateToken(32);
  await saveWebhookConfig(zevId, {
    tokenHash: sha256(secret),
    issuedAt: new Date().toISOString(),
    issuedById: actor.userId,
    revokedAt: null,
    lastTestAt: null,
  });
  await audit(actor, {
    action: "bank_sms.token.issue",
    targetType: "Setting",
    targetId: WEBHOOK_SETTING_KEY,
    after: { replaced: Boolean(existing && !existing.revokedAt) },
  });
  return { token: `${zevId}.${secret}`, url: webhookUrl() };
}

export async function revokeBankSmsToken(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const existing = await loadWebhookConfig(zevId);
  if (!existing || existing.revokedAt) throw new Error("Automatski prijem SMS poruka nije uključen.");
  await saveWebhookConfig(zevId, { ...existing, revokedAt: new Date().toISOString() });
  await audit(actor, { action: "bank_sms.token.revoke", targetType: "Setting", targetId: WEBHOOK_SETTING_KEY });
}

export type BankSmsStatus = {
  url: string;
  active: boolean;
  issuedAt: string | null;
  lastTestAt: string | null;
  lastReceivedAt: string | null;
  pending: number;
  rejected: number;
};

export async function getBankSmsStatus(actor: Actor): Promise<BankSmsStatus> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const [config, last, pending, rejected] = await Promise.all([
    loadWebhookConfig(zevId),
    prisma.incomingBankSms.aggregate({ where: { zevId }, _max: { receivedAt: true } }),
    prisma.incomingBankSms.count({ where: { zevId, status: "PENDING" } }),
    prisma.incomingBankSms.count({ where: { zevId, status: "REJECTED" } }),
  ]);
  return {
    url: webhookUrl(),
    active: Boolean(config && !config.revokedAt),
    issuedAt: config && !config.revokedAt ? config.issuedAt || null : null,
    lastTestAt: config?.lastTestAt ?? null,
    lastReceivedAt: last._max.receivedAt ? last._max.receivedAt.toISOString() : null,
    pending,
    rejected,
  };
}

// ---- The webhook ---------------------------------------------------------------------------

const AUTH_FAIL_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAIL_MAX = 10;
const OK_WINDOW_MS = 60 * 60 * 1000;
const OK_MAX = 60;
// In-memory, best effort — the same lightweight pattern as the login/reset limiters in users.ts.
// What actually bounds the damage from a leaked key is the design (nothing is booked without a
// person), not this limiter.
const authFailures = new Map<string, { count: number; first: number }>();
const okRequests = new Map<string, { count: number; first: number }>();

function windowAllows(map: Map<string, { count: number; first: number }>, key: string, windowMs: number, max: number): boolean {
  const e = map.get(key);
  return !e || Date.now() - e.first > windowMs || e.count < max;
}
function windowRecord(map: Map<string, { count: number; first: number }>, key: string, windowMs: number) {
  const now = Date.now();
  const e = map.get(key);
  if (!e || now - e.first > windowMs) map.set(key, { count: 1, first: now });
  else e.count++;
}

export type ReceiveResult = { httpStatus: number; body: Record<string, unknown> };

const UNAUTHORIZED: ReceiveResult = { httpStatus: 401, body: { error: "unauthorized" } };

/**
 * Entry point for POST /api/uplate/sms. `authorization` is the raw Authorization header,
 * `text` the SMS text, `test` the optional dry-run flag. Every authentication failure returns
 * the SAME 401 so nothing leaks about which part was wrong.
 */
export async function receiveBankSms(input: {
  authorization: string | null;
  text: unknown;
  test?: boolean;
  ipHash: string | null;
}): Promise<ReceiveResult> {
  const ipKey = input.ipHash ?? "unknown";
  if (!windowAllows(authFailures, ipKey, AUTH_FAIL_WINDOW_MS, AUTH_FAIL_MAX)) {
    await audit(null, { action: "bank_sms.rate_limited", targetType: "Setting", targetId: WEBHOOK_SETTING_KEY, ipHash: input.ipHash });
    return { httpStatus: 429, body: { error: "rate_limited" } };
  }

  const fail = async (): Promise<ReceiveResult> => {
    windowRecord(authFailures, ipKey, AUTH_FAIL_WINDOW_MS);
    // zevId stays null: the key was not verified, so nothing it names can be trusted.
    await audit(null, { action: "bank_sms.auth.failed", targetType: "Setting", targetId: WEBHOOK_SETTING_KEY, ipHash: input.ipHash });
    return UNAUTHORIZED;
  };

  const header = /^Bearer ([a-z0-9]{20,40})\.([A-Za-z0-9_-]{32,64})$/.exec(input.authorization ?? "");
  if (!header) return fail();
  const [, zevId, secret] = header;
  const [zev, config] = await Promise.all([
    prisma.zev.findUnique({ where: { id: zevId }, select: { id: true, active: true } }),
    loadWebhookConfig(zevId),
  ]);
  if (!zev || !zev.active || !config || config.revokedAt || !hashesEqual(sha256(secret), config.tokenHash)) return fail();

  // --- From here on `zevId` is trusted (it came from a verified key) ---
  if (!windowAllows(okRequests, zevId, OK_WINDOW_MS, OK_MAX)) {
    await audit({ label: "sms-webhook" }, { action: "bank_sms.rate_limited", targetType: "Setting", targetId: WEBHOOK_SETTING_KEY, zevId, ipHash: input.ipHash });
    return { httpStatus: 429, body: { error: "rate_limited" } };
  }
  windowRecord(okRequests, zevId, OK_WINDOW_MS);

  if (typeof input.text !== "string" || !input.text.trim()) {
    return { httpStatus: 400, body: { error: "text_required" } };
  }
  const text = input.text;

  if (input.test) {
    const parsed = parseNovaBankaSms(text);
    await saveWebhookConfig(zevId, { ...config, lastTestAt: new Date().toISOString() });
    const accounts = await prisma.moneyAccount.findMany({ where: { zevId, active: true, type: "BANK" }, select: { iban: true } });
    return {
      httpStatus: 200,
      body: {
        status: "test_ok",
        parsed: {
          kind: parsed.kind,
          amount: parsed.amount ? parsed.amount.toFixed(2) : null,
          purpose: parsed.purposeRaw,
          counterpartyName: parsed.counterpartyName,
          accountRecognized: accounts.some((a) => accountDigitsMatch(a.iban, parsed.ownAccount)),
          error: parsed.error,
        },
      },
    };
  }

  const normalized = normalizeSmsText(text);
  const rawHash = sha256(normalized);
  const fromBank = looksLikeBankSms(normalized);
  const parsed = fromBank ? parseNovaBankaSms(normalized) : null;
  const understood = parsed && parsed.kind !== "UNKNOWN";

  let accountId: string | null = null;
  if (understood) {
    const accounts = await prisma.moneyAccount.findMany({ where: { zevId, active: true, type: "BANK" }, select: { id: true, iban: true } });
    const hits = accounts.filter((a) => accountDigitsMatch(a.iban, parsed.ownAccount));
    accountId = hits.length === 1 ? hits[0].id : null; // none or ambiguous -> the reviewer picks
  }

  try {
    const row = await prisma.incomingBankSms.create({
      data: {
        zevId,
        // A message that does not even claim to be from the bank is never stored with its text:
        // it may be somebody's private message (a wrongly configured Shortcut filter).
        rawText: fromBank ? normalized : null,
        rawHash,
        kind: understood ? parsed.kind : "UNKNOWN",
        status: understood ? "PENDING" : "REJECTED",
        parseError: understood ? null : (parsed?.error ?? "Poruka nije od Nova Banke."),
        ownAccount: understood ? parsed.ownAccount : null,
        accountId,
        amount: understood && parsed.amount ? parsed.amount.toFixed(2) : null,
        purposeRaw: understood ? parsed.purposeRaw : null,
        counterpartyAccount: understood ? parsed.counterpartyAccount : null,
        counterpartyName: understood ? parsed.counterpartyName : null,
        balanceAfter: understood && parsed.balanceAfter ? parsed.balanceAfter.toFixed(2) : null,
        ipHash: input.ipHash,
      },
    });
    await audit({ label: "sms-webhook" }, {
      action: "bank_sms.receive",
      targetType: "IncomingBankSms",
      targetId: row.id,
      zevId,
      after: { kind: row.kind, status: row.status, amount: row.amount ? row.amount.toString() : null, accountId },
    });
    return { httpStatus: 200, body: { status: understood ? "queued" : "rejected" } };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      // Same message again (a retry, or a second phone with the same key): count it, nothing else.
      await prisma.incomingBankSms.updateMany({
        where: { zevId, rawHash },
        data: { duplicateHits: { increment: 1 }, lastDuplicateAt: new Date() },
      });
      return { httpStatus: 200, body: { status: "duplicate" } };
    }
    throw e;
  }
}

// ---- Review queue (PRESIDENT/ACCOUNTANT read, ACCOUNTANT books) --------------------------

export type BankSmsReviewRow = {
  id: string;
  kind: "PRILIV" | "ODLIV";
  /** Receipt moment, ISO (for display) — `date` below is the editable booking date. */
  receivedAt: string;
  /** yyyy-mm-dd on the Bosnia wall clock, pre-filled as the booking date. */
  date: string;
  accountId: string;
  ownAccount: string | null;
  amount: string;
  payerNameRaw: string;
  counterpartyAccount: string | null;
  purposeRaw: string;
  invoiceId: string | null;
  expenseId: string | null;
  categoryName: string;
  matchHint: string | null;
  warnings: string[];
  /** Pre-ticked only when there is nothing to double-check (known account, no warnings). */
  include: boolean;
};

export type BankSmsReview = {
  rows: BankSmsReviewRow[];
  accounts: { id: string; name: string; iban: string | null }[];
  invoiceOptions: { id: string; label: string }[];
  expenseOptions: { id: string; label: string }[];
};

function namesSimilar(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = foldDiacritics((a ?? "").trim());
  const y = foldDiacritics((b ?? "").trim());
  return Boolean(x && y && (x.includes(y) || y.includes(x)));
}

export async function listBankSmsReview(actor: Actor): Promise<BankSmsReview> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const [pending, accounts, invoiceCandidates, unpaidExpenses] = await Promise.all([
    prisma.incomingBankSms.findMany({ where: { zevId, status: "PENDING" }, orderBy: { receivedAt: "asc" }, take: 200 }),
    prisma.moneyAccount.findMany({ where: { zevId, active: true, type: "BANK" }, orderBy: { name: "asc" } }),
    fetchOpenInvoiceCandidates(zevId),
    prisma.expense.findMany({ where: { zevId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, include: { supplier: true } }),
  ]);

  // Already booked through another channel (a PDF statement imported before this SMS was
  // looked at)? Same account + amount, within a couple of days, and a similar name.
  const day = 86400000;
  const minAt = pending.length ? Math.min(...pending.map((p) => p.receivedAt.getTime())) - 2 * day : 0;
  const maxAt = pending.length ? Math.max(...pending.map((p) => p.receivedAt.getTime())) + 3 * day : 0;
  // (With no pending rows the window is empty — minAt = maxAt = 0 — so these return nothing.)
  const [bookedPayments, bookedExpenses, smsLinkedTx] = await Promise.all([
    prisma.payment.findMany({
      where: { zevId, reversedAt: null, date: { gte: new Date(minAt), lt: new Date(maxAt) }, OR: [{ importBatchId: null }, { importBatch: { sourceType: { not: "SMS" } } }] },
      select: { accountId: true, amount: true, date: true, payerNameRaw: true },
    }),
    prisma.finTransaction.findMany({
      where: { zevId, type: "EXPENSE", paymentMethod: "BANK", date: { gte: new Date(minAt), lt: new Date(maxAt) } },
      select: { id: true, accountId: true, amount: true, date: true, counterpartyName: true },
    }),
    prisma.incomingBankSms.findMany({ where: { zevId, transactionId: { not: null } }, select: { transactionId: true } }),
  ]);
  const smsTxIds = new Set(smsLinkedTx.map((s) => s.transactionId));

  // A ZEV with exactly one bank account and no account number entered on it: suggest that account
  // for messages whose number matched nothing (suggested only — never pre-ticked).
  const soleBlankAccount = accounts.length === 1 && !(accounts[0].iban ?? "").replace(/\D/g, "") ? accounts[0] : null;

  const rows: BankSmsReviewRow[] = pending.map((s) => {
    const amount = dec((s.amount ?? 0).toString());
    const kind = s.kind === "ODLIV" ? "ODLIV" : "PRILIV";
    const warnings: string[] = [];
    let invoiceId: string | null = null;
    let expenseId: string | null = null;
    let matchHint: string | null = null;

    if (kind === "PRILIV") {
      const best = invoiceCandidates
        .map(({ inv, open }) => scoreInvoiceMatch(inv, open, { reference: null, payerId: null, payerNameRaw: s.counterpartyName, purposeRaw: s.purposeRaw, amount }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      invoiceId = best && best.score >= 70 ? best.invoiceId : null;
      matchHint = best ? `${best.number} (${best.unitLabel}) — ${best.reasons.join(", ")}` : null;
    } else {
      const best = unpaidExpenses
        .map((e) => scoreExpenseMatch(e, { payerNameRaw: s.counterpartyName, purposeRaw: s.purposeRaw, amount }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      expenseId = best && best.score >= 50 ? best.expenseId : null;
      matchHint = best ? `${best.label} — ${best.reasons.join(", ")}` : null;
    }

    let accountId = s.accountId ?? "";
    if (!s.accountId) {
      warnings.push("Račun iz poruke nije upisan ni na jednom računu ZEV-a — izaberite račun.");
      if (soleBlankAccount) accountId = soleBlankAccount.id; // suggested only; never auto-ticked
    }

    const near = (d: Date) => Math.abs(d.getTime() - s.receivedAt.getTime()) <= 2 * day + day / 2;
    const alreadyBooked =
      kind === "PRILIV"
        ? bookedPayments.some((p) => p.accountId === s.accountId && dec(p.amount.toString()).equals(amount) && near(p.date) && namesSimilar(p.payerNameRaw, s.counterpartyName))
        : bookedExpenses.some((t) => !smsTxIds.has(t.id) && t.accountId === s.accountId && dec(t.amount.toString()).equals(amount) && near(t.date) && (!s.counterpartyName || namesSimilar(t.counterpartyName, s.counterpartyName)));
    if (alreadyBooked) warnings.push("Moguće je da je ova stavka već uvezena (izvod/ručni unos) — provjerite prije potvrde.");

    return {
      id: s.id,
      kind,
      receivedAt: s.receivedAt.toISOString(),
      date: toZonedDateIso(s.receivedAt),
      accountId,
      ownAccount: s.ownAccount,
      amount: amount.toFixed(2),
      payerNameRaw: s.counterpartyName ?? "",
      counterpartyAccount: s.counterpartyAccount,
      purposeRaw: s.purposeRaw ?? "",
      invoiceId,
      expenseId,
      categoryName: "",
      matchHint,
      warnings,
      include: warnings.length === 0 && Boolean(s.accountId),
    };
  });

  return {
    rows,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, iban: a.iban })),
    invoiceOptions: invoiceCandidates.map(({ inv, open }) => ({
      id: inv.id,
      label: `${inv.number} — ${partyDisplayName(inv.debtor)} (${inv.unit.label}) — otvoreno ${open.toFixed(2)} KM`,
    })),
    expenseOptions: unpaidExpenses.map((e) => {
      const open = dec(e.amount.toString()).minus(dec(e.paidAmount.toString()));
      return {
        id: e.id,
        label: `${e.supplier?.name ?? "bez dobavljača"}${e.invoiceNumber ? " — " + e.invoiceNumber : ""} — otvoreno ${open.toFixed(2)} KM`,
      };
    }),
  };
}

export type BankSmsListItem = {
  id: string;
  receivedAt: string;
  kind: string;
  status: string;
  amount: string | null;
  counterpartyName: string | null;
  purposeRaw: string | null;
  rawText: string | null;
  parseError: string | null;
  paymentId: string | null;
  transactionId: string | null;
  dismissReason: string | null;
};

function toListItem(s: Prisma.IncomingBankSmsGetPayload<object>): BankSmsListItem {
  return {
    id: s.id,
    receivedAt: s.receivedAt.toISOString(),
    kind: s.kind,
    status: s.status,
    amount: s.amount ? s.amount.toString() : null,
    counterpartyName: s.counterpartyName,
    purposeRaw: s.purposeRaw,
    rawText: s.rawText,
    parseError: s.parseError,
    paymentId: s.paymentId,
    transactionId: s.transactionId,
    dismissReason: s.dismissReason,
  };
}

/** The two read-only tabs: confirmed ones (link to the booking) and unrecognized/rejected ones. */
export async function listBankSmsOther(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const [confirmed, rejected] = await Promise.all([
    prisma.incomingBankSms.findMany({ where: { zevId, status: "CONFIRMED" }, orderBy: { receivedAt: "desc" }, take: 100 }),
    prisma.incomingBankSms.findMany({ where: { zevId, status: "REJECTED" }, orderBy: { receivedAt: "desc" }, take: 100 }),
  ]);
  return { confirmed: confirmed.map(toListItem), rejected: rejected.map(toListItem) };
}

// ---- Booking (ACCOUNTANT) ---------------------------------------------------------------

export type ConfirmBankSmsItem = {
  smsId: string;
  accountId: string;
  date: string;
  amount: string;
  payerNameRaw: string;
  purposeRaw: string;
  invoiceId?: string | null;
  expenseId?: string | null;
  categoryName?: string | null;
};

/**
 * The only way an SMS becomes a booking. Per account, ONE transaction does: flip the rows
 * PENDING -> CONFIRMING (an updateMany whose count must equal the number of rows — so a double
 * submit from two tabs cannot book the same SMS twice), book them through
 * commitStatementRowsInTx (IN -> Payment [+ allocation], OUT -> expense-side FinTransaction
 * [+ settles a chosen Trošak]), then link each SMS row to what it became (CONFIRMED).
 */
export async function confirmBankSms(actor: Actor, input: { items: ConfirmBankSmsItem[] }) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const items = input.items;
  if (items.length === 0) throw new Error("Nijedna stavka nije označena.");
  if (items.length > 200) throw new Error("Previše stavki odjednom (najviše 200).");

  const smsRows = await prisma.incomingBankSms.findMany({
    where: { zevId, id: { in: items.map((i) => i.smsId) }, status: "PENDING", kind: { in: ["PRILIV", "ODLIV"] } },
  });
  if (smsRows.length !== items.length) throw new Error("Neke poruke više nisu na čekanju. Osvježite stranicu.");
  const byId = new Map(smsRows.map((s) => [s.id, s]));

  const accounts = await prisma.moneyAccount.findMany({ where: { zevId, active: true, type: "BANK" }, select: { id: true } });
  const accountIds = new Set(accounts.map((a) => a.id));

  const rows: (StatementRowInput & { smsId: string; accountId: string })[] = items.map((it) => {
    const sms = byId.get(it.smsId);
    if (!sms) throw new Error("Poruka nije pronađena.");
    if (!it.accountId || !accountIds.has(it.accountId)) throw new Error("Izaberite bankovni račun za svaku označenu stavku.");
    return {
      smsId: it.smsId,
      accountId: it.accountId,
      direction: sms.kind === "ODLIV" ? "OUT" : "IN",
      date: it.date,
      amount: it.amount,
      payerNameRaw: it.payerNameRaw,
      purposeRaw: it.purposeRaw,
      reference: "",
      invoiceId: it.invoiceId ?? null,
      expenseId: it.expenseId ?? null,
      categoryName: it.categoryName ?? null,
    };
  });
  await assertStatementRowsCommittable(zevId, rows);

  const today = toZonedDateIso(new Date());
  await prisma.$transaction(
    async (tx) => {
      const groups = new Map<string, typeof rows>();
      for (const r of rows) groups.set(r.accountId, [...(groups.get(r.accountId) ?? []), r]);
      for (const [accountId, group] of groups) {
        const ids = group.map((g) => g.smsId);
        const flipped = await tx.incomingBankSms.updateMany({
          where: { id: { in: ids }, zevId, status: "PENDING" },
          data: { status: "CONFIRMING" },
        });
        if (flipped.count !== ids.length) throw new Error("Neke poruke su u međuvremenu potvrđene ili odbačene. Osvježite stranicu.");
        const result = await commitStatementRowsInTx(tx, actor, zevId, {
          source: "SMS",
          accountId,
          filename: `SMS obavještenja (${group.length}) — ${today}`,
          rawText: group.map((g) => byId.get(g.smsId)?.rawText ?? "").filter(Boolean).join("\n"),
          rows: group,
          smsIds: ids,
        });
        for (let i = 0; i < group.length; i++) {
          await tx.incomingBankSms.update({
            where: { id: group[i].smsId },
            data: {
              status: "CONFIRMED",
              paymentId: result.committed[i].paymentId,
              transactionId: result.committed[i].transactionId,
              importBatchId: result.batchId,
              accountId,
              reviewedById: actor.userId,
              reviewedAt: new Date(),
            },
          });
        }
      }
    },
    { timeout: 30000 }
  );
  return { confirmed: items.length };
}

/** Closes a queue row without booking anything (a message that is not a payment, a duplicate of a
 *  manual entry, junk). The reason is mandatory and ends up in the audit trail. */
export async function dismissBankSms(actor: Actor, smsId: string, reason: string) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const why = reason.trim();
  if (!why) throw new Error("Razlog odbacivanja je obavezan.");
  const res = await prisma.incomingBankSms.updateMany({
    where: { id: smsId, zevId, status: { in: ["PENDING", "REJECTED"] } },
    data: { status: "DISMISSED", dismissReason: why, reviewedById: actor.userId, reviewedAt: new Date() },
  });
  if (res.count !== 1) throw new Error("Poruka više nije na čekanju.");
  await audit(actor, { action: "bank_sms.dismiss", targetType: "IncomingBankSms", targetId: smsId, reason: why });
}

/** "Provjeri poruku" tool on the settings card: runs the parser (and the account lookup) on a
 *  pasted SMS and reports what would happen — writes nothing, needs no webhook key. Lets the
 *  president/accountant check a real message before the first one arrives from the phone. */
export async function checkBankSmsText(actor: Actor, text: string) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const parsed = parseNovaBankaSms(text);
  const accounts = await prisma.moneyAccount.findMany({ where: { zevId, active: true, type: "BANK" }, select: { iban: true } });
  return {
    kind: parsed.kind,
    amount: parsed.amount ? parsed.amount.toFixed(2) : null,
    purpose: parsed.purposeRaw,
    counterpartyName: parsed.counterpartyName,
    counterpartyAccount: parsed.counterpartyAccount,
    balanceAfter: parsed.balanceAfter ? parsed.balanceAfter.toFixed(2) : null,
    accountRecognized: accounts.some((a) => accountDigitsMatch(a.iban, parsed.ownAccount)),
    error: parsed.error,
  };
}
