// Dostava računa (fakture) e-poštom po izboru vlasnika — Plans/invoice-email-delivery-plan.md.
// Izbor se čuva na Party (invoiceEmailDelivery); izdavanje samo UPISUJE poruke u outbox, a slanje je
// odvojeno i ograničeno (broj poruka, vrijeme, dnevni limit) da stane u Vercel limit i Mailjet kvotu.
// PRIVACY: tijelo poruke nema iznos ni saldo; jedini izuzetak od pravila platforme je PDF fakture u
// prilogu, i to samo za dužnika koji je dostavu izabrao (vidi notifications/service.ts).
// Ovaj servis ne uvozi billing.ts (billing ga zove poslije commit-a).
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireAnyUser, requireRole, requireSelfOrRole, requireZev, type Actor } from "@/server/auth/guards";
import { emailAddressSchema } from "@/lib/emailAddress";
import { getEnv } from "@/lib/env";
import { formatDate } from "@/lib/i18n";
import { enqueueNotification } from "@/server/notifications/service";
import { dispatchQueued, requeueFailed, EMAIL_DAILY_SOFT_LIMIT_DEFAULT, SENT_STATUSES } from "@/server/notifications/dailyBudget";
import { ensureInvoiceDocument } from "./documents";
import { partyDisplayName } from "./ownership";
import type { NotifStatus, Party } from "@/generated/prisma/client";

export const INVOICE_EMAIL_TEMPLATE = {
  ISSUED: "invoice-delivery",
  CORRECTED: "invoice-delivery-corrected",
  CANCELLED: "invoice-delivery-cancelled",
} as const;
// Namjerno različito od starog "invoice-issued" (slato svima): stari redovi se nikad ne šalju ponovo
// i ne ulaze u status dostave.
const INVOICE_EMAIL_TEMPLATES: string[] = Object.values(INVOICE_EMAIL_TEMPLATE);

export const INVOICE_EMAIL_DISPATCH_MAX = 25;
export const INVOICE_EMAIL_DISPATCH_BUDGET_MS = 25_000;
/** Meki dnevni limit — od v2.44.0 zajednički (notifications/dailyBudget.ts); izvoz ostaje radi kompatibilnosti. */
export const INVOICE_EMAIL_DAILY_SOFT_LIMIT_DEFAULT = EMAIL_DAILY_SOFT_LIMIT_DEFAULT;

export type InvoiceEmailKind = "ISSUED" | "CORRECTED" | "CANCELLED";

// ---------------------------------------------------------------------------
// Tekst poruka (R6) — čista funkcija, izvezena radi testova
// ---------------------------------------------------------------------------

export type InvoiceEmailTextData = {
  recipientName: string;
  zevName: string;
  number: string;
  periodLabel: string | null;
  dueDate: Date;
  paymentReference: string;
  /** Link na fakturu u aplikaciji; ulazi u tekst samo kad `hasAccount`. */
  link: string;
  /** Dužnik ima aktivan nalog, pa mu link nešto znači. */
  hasAccount: boolean;
  /** Samo za CORRECTED: broj fakture koju korektivna zamjenjuje. */
  replacesNumber?: string | null;
};

const FOOTER_OPT_OUT =
  "Ovu poruku primate jer je za vas uključena dostava računa e-poštom. Dostavu možete isključiti u aplikaciji (Podešavanja → Moji podaci) ili zahtjevom upravi ZEV-a.";
const FOOTER_AUTO = "Ovo je automatska poruka. Molimo da na nju ne odgovarate.";

export function buildInvoiceEmail(kind: InvoiceEmailKind, d: InvoiceEmailTextData): { subject: string; body: string } {
  const period = d.periodLabel ? ` za period ${d.periodLabel}` : "";
  const greeting = `Poštovani/a ${d.recipientName},`;
  if (kind === "CANCELLED") {
    return {
      subject: `Stornirana faktura ${d.number} — ${d.zevName}`,
      body: [
        greeting,
        "",
        `faktura ${d.number}${period} je stornirana i ne treba je plaćati. Ako ste je već platili, obratite se upravi ZEV-a.`,
        ...(d.hasAccount ? [`Detalji su dostupni u aplikaciji nakon prijave: ${d.link}`] : []),
        "",
        FOOTER_OPT_OUT,
        "",
        FOOTER_AUTO,
      ].join("\n"),
    };
  }
  const intro =
    kind === "CORRECTED"
      ? `u prilogu vam dostavljamo korektivnu fakturu ${d.number}${period} koja zamjenjuje fakturu ${d.replacesNumber ?? ""}. Faktura ${d.replacesNumber ?? ""} više ne važi — za plaćanje koristite podatke iz fakture u prilogu.`
      : `u prilogu vam dostavljamo fakturu ${d.number}${period} koju je izdala ${d.zevName}.`;
  return {
    subject:
      kind === "CORRECTED"
        ? `Korigovana faktura ${d.number} (zamjenjuje ${d.replacesNumber ?? ""}) — ${d.zevName}`
        : `Faktura ${d.number} — ${d.zevName}`,
    body: [
      greeting,
      "",
      intro,
      "",
      `Rok plaćanja: ${formatDate(d.dueDate)}`,
      `Poziv na broj: ${d.paymentReference}`,
      "",
      "Iznos, račun za uplatu i QR kod za plaćanje nalaze se u PDF fakturi u prilogu.",
      ...(d.hasAccount ? [`Fakturu i stanje uplata možete pogledati i u aplikaciji nakon prijave: ${d.link}`] : []),
      "",
      FOOTER_OPT_OUT,
      "",
      FOOTER_AUTO,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Izbor vlasnika
// ---------------------------------------------------------------------------

/**
 * Uključuje/isključuje dostavu računa e-poštom. Vlasnik za sebe, ili predsjednik/računovođa umjesto
 * vlasnika (bez naloga, zahtjev na papiru) — tada uz napomenu. Audit čuva adresu u trenutku uključenja
 * (to je trag pristanka; posebna tabela ne treba, isto kao kod e-glasanja).
 */
export async function setInvoiceEmailDelivery(
  actor: Actor,
  partyId: string,
  enabled: boolean,
  opts?: { reason?: string | null }
): Promise<Party> {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId, zevId } });
  if (party.invoiceEmailDelivery === enabled) return party;
  if (enabled) {
    const email = party.email?.trim() ?? "";
    if (!email) throw new Error("Za dostavu računa e-poštom potrebna je e-mail adresa. Upišite je u kartici „Moji podaci” i sačuvajte.");
    if (!emailAddressSchema.safeParse(email).success) {
      throw new Error("E-mail adresa u „Moji podaci” nije ispravna. Ispravite je pa ponovo uključite dostavu.");
    }
  }
  const updated = await prisma.party.update({
    where: { id: partyId, zevId },
    data: { invoiceEmailDelivery: enabled, invoiceEmailDeliveryAt: enabled ? new Date() : null },
  });
  await audit(actor, {
    action: enabled ? "party.invoice_email.enable" : "party.invoice_email.disable",
    targetType: "Party",
    targetId: partyId,
    before: { enabled: party.invoiceEmailDelivery },
    after: { enabled, email: updated.email, byOwner: actor.partyId === partyId },
    reason: opts?.reason?.trim() || null,
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Upis u outbox (zovu ga billing funkcije POSLIJE commit-a)
// ---------------------------------------------------------------------------

export async function queueInvoiceEmails(
  actor: Actor,
  invoiceIds: string[],
  kind: InvoiceEmailKind
): Promise<{ queued: number; skipped: number }> {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds }, zevId },
    include: {
      debtor: { include: { user: { select: { active: true } } } },
      correctionOf: { select: { number: true } },
      zev: { select: { shortName: true, legalName: true } },
    },
  });
  const template = INVOICE_EMAIL_TEMPLATE[kind];
  const appUrl = getEnv().APP_URL;
  let queued = 0;
  let skipped = 0;
  for (const inv of invoices) {
    // Greška ovdje nikad ne smije srušiti izdavanje koje je već commit-ovano.
    try {
      const to = inv.debtor.email?.trim() ?? "";
      if (!inv.debtor.invoiceEmailDelivery || !emailAddressSchema.safeParse(to).success) {
        skipped++;
        continue;
      }
      const existing = await prisma.notificationMessage.findFirst({
        where: { relatedType: "Invoice", relatedId: inv.id, template },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      // Greška u PDF-u ne ruši upis; dispatch pokušava ponovo.
      let docId: string | null = null;
      if (kind !== "CANCELLED") {
        try {
          docId = (await ensureInvoiceDocument(actor, inv.id)).id;
        } catch (e) {
          console.error("invoiceEmail: PDF fakture nije generisan", e);
        }
      }
      const { subject, body } = buildInvoiceEmail(kind, {
        recipientName: partyDisplayName(inv.debtor),
        zevName: inv.zev.shortName?.trim() || inv.zev.legalName,
        number: inv.number,
        periodLabel: inv.periodLabel,
        dueDate: inv.dueDate,
        paymentReference: inv.paymentReference ?? inv.number,
        link: `${appUrl}/fakture/${inv.id}`,
        hasAccount: Boolean(inv.debtor.user?.active),
        replacesNumber: inv.correctionOf?.number ?? null,
      });
      await enqueueNotification({
        zevId,
        channel: "EMAIL",
        recipientId: inv.debtor.id,
        toAddress: to,
        template,
        subject,
        body,
        relatedType: "Invoice",
        relatedId: inv.id,
        attachmentDocumentId: docId,
      });
      queued++;
    } catch (e) {
      console.error("invoiceEmail: poruka nije upisana u red", e);
      skipped++;
    }
  }
  return { queued, skipped };
}

// ---------------------------------------------------------------------------
// Slanje, ograničeno
// ---------------------------------------------------------------------------

export type InvoiceEmailScope = { batchId: string } | { invoiceIds: string[] };
export type InvoiceEmailDispatchResult = { attempted: number; sent: number; failed: number; pending: number; dailyLimitReached: boolean };

/** Fakture iz opsega, uvijek ograničene na ZEV pozivaoca (serija iz tuđeg ZEV-a baca grešku). */
async function scopeInvoiceIds(zevId: string, scope: InvoiceEmailScope): Promise<string[]> {
  if ("batchId" in scope) {
    await prisma.invoiceBatch.findUniqueOrThrow({ where: { id: scope.batchId, zevId }, select: { id: true } });
    const rows = await prisma.invoice.findMany({ where: { batchId: scope.batchId, zevId }, select: { id: true } });
    return rows.map((r) => r.id);
  }
  const rows = await prisma.invoice.findMany({ where: { id: { in: scope.invoiceIds }, zevId }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function dispatchInvoiceEmails(
  actor: Actor,
  scope: InvoiceEmailScope,
  opts?: { max?: number; budgetMs?: number; dailyLimit?: number }
): Promise<InvoiceEmailDispatchResult> {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const invoiceIds = await scopeInvoiceIds(zevId, scope);
  const where = { zevId, relatedType: "Invoice", relatedId: { in: invoiceIds }, template: { in: INVOICE_EMAIL_TEMPLATES } };

  // Limit, vrijeme i red su u zajedničkom dispečeru (notifications/dailyBudget.ts) — fakture, listići i pozivi
  // troše isti dnevni limit. Ovdje ostaje samo priprema PDF-a faktur prije slanja.
  const { attempted, sent, failed, pending, dailyLimitReached } = await dispatchQueued(where, {
    max: opts?.max ?? INVOICE_EMAIL_DISPATCH_MAX,
    budgetMs: opts?.budgetMs ?? INVOICE_EMAIL_DISPATCH_BUDGET_MS,
    dailyLimit: opts?.dailyLimit,
    prepare: async (m) => {
      if (m.attachmentDocumentId || m.template === INVOICE_EMAIL_TEMPLATE.CANCELLED || !m.relatedId) return;
      try {
        const docId = (await ensureInvoiceDocument(actor, m.relatedId)).id;
        await prisma.notificationMessage.update({ where: { id: m.id }, data: { attachmentDocumentId: docId } });
      } catch (e) {
        return { error: `PDF fakture nije generisan: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });
  if (attempted > 0 || dailyLimitReached) {
    await audit(actor, {
      action: "invoice_email.dispatch",
      targetType: "batchId" in scope ? "InvoiceBatch" : "Invoice",
      targetId: "batchId" in scope ? scope.batchId : (invoiceIds[0] ?? null),
      after: { attempted, sent, failed, pending, dailyLimitReached },
    });
  }
  return { attempted, sent, failed, pending, dailyLimitReached };
}

/** Vraća neuspjele poruke iz opsega u red i pokušava ponovo (dugme „Pošalji neposlate” / „Pošalji ponovo”). */
export async function retryInvoiceEmails(actor: Actor, scope: InvoiceEmailScope): Promise<InvoiceEmailDispatchResult> {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const invoiceIds = await scopeInvoiceIds(zevId, scope);
  const count = await requeueFailed({ zevId, relatedType: "Invoice", relatedId: { in: invoiceIds }, template: { in: INVOICE_EMAIL_TEMPLATES } });
  if (count > 0) {
    await audit(actor, {
      action: "invoice_email.retry",
      targetType: "batchId" in scope ? "InvoiceBatch" : "Invoice",
      targetId: "batchId" in scope ? scope.batchId : (invoiceIds[0] ?? null),
      after: { count },
    });
  }
  return dispatchInvoiceEmails(actor, scope);
}

/** Ručno slanje fakture izdate prije nego što je dužnik uključio dostavu. */
export async function sendInvoiceEmailNow(actor: Actor, invoiceId: string): Promise<InvoiceEmailDispatchResult> {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId, zevId }, include: { debtor: true } });
  if (inv.status !== "ISSUED") throw new Error("Samo izdata faktura može biti poslata e-poštom.");
  if (!inv.debtor.invoiceEmailDelivery) throw new Error("Dužnik nije uključio dostavu računa e-poštom.");
  const { queued, skipped } = await queueInvoiceEmails(actor, [invoiceId], inv.correctionOfId ? "CORRECTED" : "ISSUED");
  if (queued === 0 && skipped > 0) {
    const existing = await prisma.notificationMessage.count({
      where: { zevId, relatedType: "Invoice", relatedId: invoiceId, template: { in: INVOICE_EMAIL_TEMPLATES } },
    });
    // Postojeća poruka se samo šalje/ponavlja; inače adresa dužnika nije ispravna.
    if (existing === 0) throw new Error("Dužnik nema ispravnu e-mail adresu.");
  }
  return dispatchInvoiceEmails(actor, { invoiceIds: [invoiceId] });
}

// ---------------------------------------------------------------------------
// Statusi za UI
// ---------------------------------------------------------------------------

export type InvoiceEmailStatus = {
  messageId: string;
  template: string;
  status: NotifStatus;
  toAddress: string;
  sentAt: Date | null;
  lastError: string | null;
  attempts: number;
  createdAt: Date;
};

export async function getInvoiceEmailStatus(actor: Actor, invoiceId: string): Promise<InvoiceEmailStatus | null> {
  requireAnyUser(actor);
  const zevId = requireZev(actor);
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId, zevId }, select: { id: true, debtorId: true } });
  requireSelfOrRole(actor, inv.debtorId, "PRESIDENT", "ACCOUNTANT");
  const m = await prisma.notificationMessage.findFirst({
    where: { zevId, relatedType: "Invoice", relatedId: inv.id, template: { in: INVOICE_EMAIL_TEMPLATES } },
    orderBy: { createdAt: "desc" },
  });
  if (!m) return null;
  return {
    messageId: m.id,
    template: m.template ?? "",
    status: m.status,
    toAddress: m.toAddress,
    sentAt: m.sentAt,
    lastError: m.lastError,
    attempts: m.attempts,
    createdAt: m.createdAt,
  };
}

export type BatchEmailSummary = {
  optedIn: number;
  sent: number;
  queued: number;
  failed: number;
  rows: { invoiceId: string; number: string; debtorName: string; toAddress: string; status: NotifStatus; lastError: string | null; sentAt: Date | null; createdAt: Date }[];
};

export async function getBatchEmailSummary(actor: Actor, batchId: string): Promise<BatchEmailSummary> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  await prisma.invoiceBatch.findUniqueOrThrow({ where: { id: batchId, zevId }, select: { id: true } });
  const invoices = await prisma.invoice.findMany({
    where: { batchId, zevId },
    include: { debtor: true },
    orderBy: { number: "asc" },
  });
  const messages = await prisma.notificationMessage.findMany({
    where: { zevId, relatedType: "Invoice", relatedId: { in: invoices.map((i) => i.id) }, template: { in: INVOICE_EMAIL_TEMPLATES } },
    orderBy: { createdAt: "desc" },
  });
  const latest = new Map<string, (typeof messages)[number]>();
  for (const m of messages) if (m.relatedId && !latest.has(m.relatedId)) latest.set(m.relatedId, m);
  const rows: BatchEmailSummary["rows"] = [];
  for (const inv of invoices) {
    const m = latest.get(inv.id);
    if (!m) continue;
    rows.push({
      invoiceId: inv.id,
      number: inv.number,
      debtorName: partyDisplayName(inv.debtor),
      toAddress: m.toAddress,
      status: m.status,
      lastError: m.lastError,
      sentAt: m.sentAt,
      createdAt: m.createdAt,
    });
  }
  return {
    optedIn: invoices.filter((i) => i.debtor.invoiceEmailDelivery).length,
    sent: rows.filter((r) => SENT_STATUSES.includes(r.status)).length,
    queued: rows.filter((r) => r.status === "QUEUED").length,
    failed: rows.filter((r) => r.status === "FAILED").length,
    rows,
  };
}

/** Za nacrt serije: koliko od datih dužnika je uključilo dostavu („Račun e-poštom dobiće X od N dužnika”). */
export async function countOptedInDebtors(actor: Actor, debtorIds: string[]): Promise<number> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  return prisma.party.count({ where: { id: { in: debtorIds }, zevId, invoiceEmailDelivery: true } });
}
