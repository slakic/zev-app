// PDF document generation with versioning. FINAL documents are immutable —
// regenerating creates a new version row; files are content-hashed.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireSelfOrRole, requireAnyUser, type Actor } from "@/server/auth/guards";
import { formatMoney, formatWeight } from "@/lib/money";
import { formatDate, formatDateTime, tEnum } from "@/lib/i18n";
import { partyDisplayName } from "./ownership";
import {
  cashFlowReport,
  incomeExpenseReport,
  receivablesReport,
  supplierReport,
  unpaidSupplierInvoices,
  allocationSummary,
  type DateRange,
} from "./reports";
import { reserveFundBalance } from "./finance";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { DocumentType } from "@/generated/prisma/client";

const FONT_REG = path.join(process.cwd(), "assets/fonts/DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets/fonts/DejaVuSans-Bold.ttf");

function storageDir(): string {
  const dir = path.join(process.cwd(), process.env.STORAGE_DIR ?? "./var/storage", "documents");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

type PdfBuild = (doc: PDFKit.PDFDocument) => Promise<void> | void;

async function renderPdf(build: PdfBuild): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  doc.registerFont("reg", FONT_REG);
  doc.registerFont("bold", FONT_BOLD);
  doc.font("reg").fontSize(10);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  await build(doc);
  doc.end();
  return done;
}

async function zevHeader(doc: PDFKit.PDFDocument, meta: { number: string; title: string; issueDate: Date }) {
  const zev = await prisma.zev.findFirst();
  doc.font("bold").fontSize(12).text(zev?.legalName ?? "Zajednica etažnih vlasnika");
  doc.font("reg").fontSize(9)
    .text(zev?.registeredAddress ?? "")
    .text(`JIB: ${zev?.jib ?? "—"}   Registarski broj: ${zev?.registrationNumber ?? "—"}`);
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);
  doc.font("bold").fontSize(14).text(meta.title, { align: "center" });
  doc.font("reg").fontSize(9)
    .text(`Broj dokumenta: ${meta.number}`, { align: "center" })
    .text(`Datum izdavanja: ${formatDate(meta.issueDate)}`, { align: "center" });
  doc.moveDown();
}

function docFooter(doc: PDFKit.PDFDocument, info: { sourceRef: string; version: number; status: string }) {
  doc.moveDown(2);
  doc.fontSize(8).fillColor("#555")
    .text(`Izvorni zapis: ${info.sourceRef} · Verzija: ${info.version} · Status: ${info.status}`)
    .text(`Generisano: ${formatDateTime(new Date())} · Dokument generisan u aplikaciji ZEV upravnik`)
    .fillColor("#000");
}

async function nextDocNumber(type: DocumentType): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.document.count({ where: { type, createdAt: { gte: new Date(`${year}-01-01`) } } });
  const prefixes: Partial<Record<DocumentType, string>> = {
    MINUTES: "ZAP", DECISION: "ODL", MEETING_INVITATION: "POZ", INVOICE: "FAK",
    OWNER_STATEMENT: "KART", PAYMENT_REMINDER: "OPM", WORK_ORDER: "RN",
    ANNUAL_MAINTENANCE_PLAN: "GPO", ANNUAL_FINANCIAL_PLAN: "GFP", ANNUAL_REPORT: "GI",
    VOTING_LIST: "GL", ATTENDANCE_LIST: "LP", DEBT_STATEMENT: "IOS",
    OFFER_COMPARISON: "UPP", COMPLETION_RECORD: "ZPR", AGENDA: "DR",
    PROXY_AUTHORIZATION: "PUN", FOUNDING_AGREEMENT: "UO", REGISTRY_APPLICATION: "REG",
  };
  return `${prefixes[type] ?? "DOK"}-${year}-${String(count + 1).padStart(4, "0")}`;
}

/**
 * Store a generated PDF as a Document row. If a FINAL document already exists
 * for the same (type, sourceId), a new VERSION is created — never overwritten.
 */
export async function storeDocument(
  actor: Actor | null,
  input: {
    type: DocumentType;
    title: string;
    sourceType?: string;
    sourceId?: string;
    buffer: Buffer;
    finalize?: boolean;
    publishedToOwners?: boolean;
    number?: string;
  }
) {
  const existing = input.sourceId
    ? await prisma.document.findFirst({
        where: { type: input.type, sourceId: input.sourceId },
        orderBy: { version: "desc" },
      })
    : null;
  const version = (existing?.version ?? 0) + 1;
  const number = input.number ?? existing?.number ?? (await nextDocNumber(input.type));
  const hash = createHash("sha256").update(input.buffer).digest("hex");
  const filename = `${number.replace(/[^\w-]/g, "_")}_v${version}.pdf`;
  const filePath = path.join(storageDir(), filename);
  fs.writeFileSync(filePath, input.buffer);
  const docRow = await prisma.document.create({
    data: {
      type: input.type,
      number,
      title: input.title,
      status: input.finalize ? "FINAL" : "DRAFT",
      version,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      filePath,
      sha256: hash,
      publishedToOwners: input.publishedToOwners ?? false,
      createdById: actor?.userId ?? null,
      finalizedAt: input.finalize ? new Date() : null,
    },
  });
  await audit(actor, {
    action: "document.generate",
    targetType: "Document",
    targetId: docRow.id,
    after: { type: input.type, number, version, sha256: hash, final: !!input.finalize },
  });
  return docRow;
}

export async function listDocuments(actor: Actor) {
  requireAnyUser(actor);
  const isManagement = actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
  return prisma.document.findMany({
    where: isManagement ? {} : { publishedToOwners: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Read a document file with access control (owners: published docs + own invoices/statements). */
export async function readDocumentFile(actor: Actor, documentId: string): Promise<{ doc: { title: string; number: string }; buffer: Buffer }> {
  requireAnyUser(actor);
  const d = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  const isManagement = actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
  if (!isManagement && !d.publishedToOwners) {
    // Owners can read documents about their own records (invoice, statement, reminder).
    let allowed = false;
    if (d.sourceType === "Invoice" && d.sourceId) {
      const inv = await prisma.invoice.findUnique({ where: { id: d.sourceId } });
      allowed = !!inv && inv.debtorId === actor.partyId;
    } else if (d.sourceType === "Party" && d.sourceId) {
      allowed = d.sourceId === actor.partyId;
    }
    if (!allowed) {
      const { ForbiddenError } = await import("@/server/auth/guards");
      throw new ForbiddenError();
    }
  }
  await audit(actor, { action: "document.download", targetType: "Document", targetId: d.id });
  return { doc: { title: d.title, number: d.number }, buffer: fs.readFileSync(d.filePath) };
}

export async function publishDocument(actor: Actor, documentId: string) {
  requireRole(actor, "PRESIDENT");
  const d = await prisma.document.update({ where: { id: documentId }, data: { publishedToOwners: true } });
  await audit(actor, { action: "document.publish", targetType: "Document", targetId: documentId });
  return d;
}

// ---------------------------------------------------------------------------
// Concrete generators
// ---------------------------------------------------------------------------

export async function generateInvoicePdf(actor: Actor, invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { unit: { include: { building: true } }, debtor: true, lines: { orderBy: { order: "asc" } } },
  });
  requireSelfOrRole(actor, inv.debtorId, "PRESIDENT", "ACCOUNTANT");
  const zev = await prisma.zev.findFirst({ include: { accounts: { where: { type: "BANK", active: true } } } });
  const bank = zev?.accounts[0];

  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, { number: inv.number, title: `FAKTURA ${inv.number}`, issueDate: inv.issueDate });
    doc.font("bold").fontSize(10).text("Primalac (dužnik):");
    doc.font("reg")
      .text(partyDisplayName(inv.debtor))
      .text(inv.debtor.correspondenceAddress ?? inv.debtor.address ?? "")
      .moveDown(0.5)
      .text(`Jedinica: ${inv.unit.building.name}, ${inv.unit.label}`)
      .text(`Period: ${inv.periodLabel ?? "—"}    Rok plaćanja: ${formatDate(inv.dueDate)}`);
    doc.moveDown();

    // table
    const startY = doc.y;
    doc.font("bold");
    doc.text("Stavka", 50, startY, { width: 220 });
    doc.text("Osnov obračuna", 275, startY, { width: 160 });
    doc.text("Iznos (KM)", 440, startY, { width: 105, align: "right" });
    doc.font("reg");
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    for (const line of inv.lines) {
      const snap = line.calcSnapshot as { formula?: string; allocationBasis?: string } | null;
      const y = doc.y + 4;
      doc.text(line.description, 50, y, { width: 220 });
      doc.fontSize(8).text(snap?.allocationBasis ?? "", 275, y, { width: 160 }).fontSize(10);
      doc.text(formatMoney(line.amount.toString(), ""), 440, y, { width: 105, align: "right" });
      doc.moveDown(0.2);
    }
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke();
    doc.moveDown(0.5);
    doc.font("bold").text(`UKUPNO ZA PLAĆANJE: ${formatMoney(inv.total.toString())}`, 50, doc.y, { width: 495, align: "right" });
    doc.font("reg").moveDown();

    doc.fontSize(9)
      .text(`Uplatu izvršiti na račun: ${bank?.iban ?? "—"} (${bank?.bankName ?? ""})`, 50)
      .text(`Poziv na broj: ${inv.paymentReference ?? inv.number}`);
    // QR payment stub (configurable payment-slip output)
    const qrPayload = JSON.stringify({
      racun: bank?.iban ?? "", primalac: zev?.legalName ?? "", iznos: inv.total.toString(),
      pozivNaBroj: inv.paymentReference ?? inv.number, svrha: `ZEV ${inv.periodLabel ?? ""}`,
    });
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 0, width: 110 });
    const qrBuf = Buffer.from(qrDataUrl.split(",")[1], "base64");
    doc.image(qrBuf, 445, doc.y + 6, { width: 90 });
    doc.moveDown(1);
    doc.fontSize(8).fillColor("#555").text("QR kod sadrži podatke za plaćanje (informativno).", 50).fillColor("#000");
    docFooter(doc, { sourceRef: `Invoice ${inv.number}`, version: 1, status: inv.status });
  });

  const stored = await storeDocument(actor, {
    type: "INVOICE",
    title: `Faktura ${inv.number}`,
    sourceType: "Invoice",
    sourceId: inv.id,
    number: inv.number,
    buffer,
    finalize: true,
  });
  await prisma.invoice.update({ where: { id: inv.id }, data: { documentId: stored.id } });
  return stored;
}

export async function generateOwnerStatementPdf(actor: Actor, partyId: string, asOf?: Date) {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
  const invoices = await prisma.invoice.findMany({
    where: { debtorId: partyId, status: { in: ["ISSUED", "PAID", "CORRECTED", "CANCELLED"] } },
    include: { allocations: true, unit: true },
    orderBy: { issueDate: "asc" },
  });
  const { ownerBalance } = await import("./payments");
  const balance = await ownerBalance(actor, partyId, asOf);

  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, {
      number: `KART-${partyId.slice(-6).toUpperCase()}`,
      title: "KARTICA VLASNIKA — PREGLED ZADUŽENJA I UPLATA",
      issueDate: asOf ?? new Date(),
    });
    doc.font("bold").text(`Vlasnik: ${partyDisplayName(party)}`);
    doc.font("reg").moveDown(0.5);
    doc.font("bold");
    const y0 = doc.y;
    doc.text("Faktura", 50, y0, { width: 110 });
    doc.text("Jedinica", 165, y0, { width: 90 });
    doc.text("Datum", 260, y0, { width: 70 });
    doc.text("Zaduženje", 335, y0, { width: 95, align: "right" });
    doc.text("Uplaćeno", 435, y0, { width: 110, align: "right" });
    doc.font("reg");
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke();
    for (const inv of invoices) {
      const paid = inv.allocations.reduce((a, x) => a + Number(x.amount), 0);
      const y = doc.y + 4;
      doc.text(`${inv.number}${inv.status === "CANCELLED" ? " (storno)" : ""}`, 50, y, { width: 110 });
      doc.text(inv.unit.label, 165, y, { width: 90 });
      doc.text(formatDate(inv.issueDate), 260, y, { width: 70 });
      doc.text(inv.status === "CANCELLED" ? "—" : formatMoney(inv.total.toString(), ""), 335, y, { width: 95, align: "right" });
      doc.text(formatMoney(paid.toFixed(2), ""), 435, y, { width: 110, align: "right" });
    }
    doc.moveDown();
    doc.font("bold")
      .text(`Ukupno zaduženo: ${formatMoney(balance.charged)}`, 50, doc.y, { width: 495, align: "right" })
      .text(`Ukupno plaćeno: ${formatMoney(balance.paid)}`, { width: 495, align: "right" })
      .text(`Korekcije: ${formatMoney(balance.corrections)}`, { width: 495, align: "right" })
      .text(`SALDO (duguje): ${formatMoney(balance.balance)}`, { width: 495, align: "right" });
    docFooter(doc, { sourceRef: `Party ${partyId}`, version: 1, status: "FINAL" });
  });

  return storeDocument(actor, {
    type: "OWNER_STATEMENT",
    title: `Kartica vlasnika — ${partyDisplayName(party)}`,
    sourceType: "Party",
    sourceId: partyId,
    buffer,
    finalize: true,
  });
}

/**
 * Personalized, print-and-sign "Izjava o saglasnosti za elektronsko glasanje" — pre-filled with
 * this owner's name, unit address(es) and registered e-mail, with JMBG, mjesto/datum and the
 * signature left blank for physical completion. Generated on demand and NOT persisted as a
 * Document: a blank/unsigned form has no evidentiary value until the owner signs it on paper and
 * the president records that (see markEVoteConsentSigned in evoteConsent.ts). Downloading it does
 * not itself grant consent — it only moves a fresh party from NONE to PENDING so the president can
 * see who has been asked; re-downloading after SIGNED or REVOKED never resets that decision.
 */
export async function generateEVoteConsentPdf(actor: Actor, partyId: string): Promise<Buffer> {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  const party = await prisma.party.findUniqueOrThrow({
    where: { id: partyId },
    include: {
      ownershipStakes: { where: { validTo: null }, include: { unit: { include: { building: true } } } },
      user: { select: { email: true } },
    },
  });
  const zev = await prisma.zev.findFirst();
  const ownerName = partyDisplayName(party);
  const email = party.user?.email ?? party.email ?? "";
  const unitAddresses = party.ownershipStakes
    .map((s) => `${s.unit.building.name}, ${s.unit.label}${s.unit.building.address ? ` (${s.unit.building.address})` : ""}`)
    .join("; ") || "—";

  const buffer = await renderPdf(async (doc) => {
    doc.font("bold").fontSize(12).text(zev?.legalName ?? "Zajednica etažnih vlasnika");
    doc.font("reg").fontSize(9)
      .text(zev?.registeredAddress ?? "")
      .text(`JIB: ${zev?.jib ?? "—"}   Registarski broj: ${zev?.registrationNumber ?? "—"}`);
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);
    doc.font("bold").fontSize(13).text("IZJAVA O SAGLASNOSTI", { align: "center" });
    doc.font("bold").fontSize(9.5).text(
      "za elektronsko izjašnjavanje i glasanje u organima i postupcima odlučivanja zajednice etažnih vlasnika",
      { align: "center" }
    );
    doc.moveDown(0.6);

    doc.font("reg").fontSize(9).text(
      `Ja, dolje potpisani/a vlasnik posebnog dijela zgrade (u daljem tekstu: vlasnik), član zajednice etažnih ` +
      `vlasnika ${zev?.legalName ?? "[NAZIV ZEV-a]"} (u daljem tekstu: ZEV), ovom izjavom dobrovoljno i saglasno ` +
      `pristajem da se moje izjašnjenje o prijedlozima odluka i glasanje na sjednicama skupštine i upravnog odbora ` +
      `ZEV-a, kao i u svakom drugom postupku izjašnjavanja, glasanja ili prikupljanja saglasnosti koji ZEV objavi ` +
      `elektronskim putem (u daljem tekstu zajednički: elektronsko izjašnjavanje), dato u skladu sa odredbama ove ` +
      `izjave, smatra pravno valjanim i da ima istu pravnu težinu kao moje lično, fizičko izjašnjenje/potpis.`,
      { align: "justify" }
    );
    doc.moveDown(0.6);

    doc.font("bold").fontSize(10.5).text("Podaci o vlasniku");
    doc.moveDown(0.25);
    const idRow = (label: string, value: string) => {
      const y = doc.y;
      doc.font("bold").fontSize(8.5);
      const labelHeight = doc.heightOfString(label, { width: 190 });
      doc.text(label, 50, y, { width: 190 });
      doc.font("reg").fontSize(8.5);
      const valueHeight = doc.heightOfString(value, { width: 300 });
      doc.text(value, 245, y, { width: 300 });
      // Rows with a wrapped (multi-line) label or value need more space before the next row
      // than a fixed moveDown() would give — measure the taller column instead of guessing.
      doc.y = y + Math.max(labelHeight, valueHeight) + 4;
    };
    idRow("Ime i prezime vlasnika", ownerName);
    idRow("JMBG / lični broj", "________________________");
    idRow("Adresa (zgrada / stan)", unitAddresses);
    idRow("Kontakt telefon", party.phone ?? "________________________");
    idRow("E-mail adresa za elektronsko izjašnjavanje", email || "________________________");
    // idRow's last call positioned text at x=245 (the value column) — PDFKit "sticks" to that
    // x for every subsequent text() call that doesn't pass its own, so without this reset
    // everything below (headings, clauses, footer) would render indented and narrowed.
    doc.x = 50;
    doc.moveDown(0.35);

    doc.font("bold").fontSize(10.5).text("Odredbe izjave", 50, doc.y, { width: 495 });
    doc.moveDown(0.25);
    const clause = (title: string, text: string) => {
      doc.font("bold").fontSize(8.75).text(title, 50, doc.y, { width: 495 });
      doc.font("reg").fontSize(8.75).text(text, 50, doc.y, { width: 495, align: "justify" });
      doc.moveDown(0.28);
    };
    clause(
      "1. Predmet izjave",
      "Ovom izjavom vlasnik ovlašćuje ZEV da elektronska izjašnjenja (glasove, saglasnosti, primjedbe, odgovore na " +
      "ankete i slično) pristigla isključivo sa gore navedene e-mail adrese, putem sistema za elektronsko " +
      "izjašnjavanje koji ZEV koristi (jedinstveni vremenski ograničen link i verifikacioni kod dostavljeni na " +
      "navedenu adresu za svaku sjednicu, prijedlog ili drugi postupak izjašnjavanja), smatra njegovim ličnim " +
      "identitetom i ličnom izjavom volje, bez potrebe za dodatnom fizičkom potvrdom. Ova saglasnost pokriva " +
      "sjednice skupštine, sjednice upravnog odbora, kao i svaki drugi postupak elektronskog izjašnjavanja koji " +
      "ZEV objavi vlasnicima."
    );
    clause(
      "2. Pravno dejstvo elektronskog izjašnjenja",
      "Elektronsko izjašnjenje dato u skladu sa ovom izjavom uračunava se u kvorum i većinu potrebnu za donošenje " +
      "odluke organa ZEV-a (skupštine, odnosno upravnog odbora) na isti način kao fizičko prisustvo i glasanje na " +
      "sjednici. U slučaju drugih postupaka izjašnjavanja koje ZEV objavi van sjednice (npr. prikupljanje " +
      "saglasnosti ili mišljenja vlasnika), elektronsko izjašnjenje smatra se punovažnim izjašnjenjem vlasnika u " +
      "tom postupku — sve u skladu sa Pravilima o međusobnim odnosima etažnih vlasnika ZEV-a te opštim odredbama " +
      "Zakona o obligacionim odnosima o slobodi ugovaranja i Zakona o elektronskom potpisu Republike Srpske."
    );
    clause(
      "3. Odgovornost vlasnika",
      "Vlasnik je isključivo odgovoran za čuvanje pristupa navedenoj e-mail adresi i za sva izjašnjenja data putem " +
      "nje, te je dužan bez odlaganja pisanim putem obavijestiti ZEV o svakoj sumnji na neovlašćen pristup toj " +
      "adresi."
    );
    clause(
      "4. Obrada ličnih podataka",
      "Vlasnik je saglasan da ZEV obrađuje njegove lične podatke navedene u ovoj izjavi isključivo u svrhu " +
      "sprovođenja elektronskog izjašnjavanja i vođenja evidencije o radu organa i postupaka izjašnjavanja ZEV-a."
    );
    clause(
      "5. Opoziv saglasnosti",
      "Vlasnik može u svakom trenutku, bez obrazloženja, opozvati ovu saglasnost — pisanim putem ili kroz " +
      "aplikaciju ZEV upravnik. Opoziv proizvodi dejstvo počev od prve naredne sjednice organa ZEV-a ili drugog " +
      "postupka izjašnjavanja nakon prijema obavještenja, odnosno nakon unosa opoziva u aplikaciju."
    );
    clause(
      "6. Trajanje",
      "Ova izjava proizvodi pravno dejstvo od dana potpisivanja i važi za sve naredne sjednice organa ZEV-a i " +
      "druge postupke elektronskog izjašnjavanja koje ZEV objavi, do eventualnog opoziva u skladu sa tačkom 5., " +
      "odnosno do promjene e-mail adrese."
    );

    doc.moveDown(0.5);
    doc.font("reg").fontSize(9).text("Mjesto i datum: ________________________", 50, doc.y, { width: 495 });
    doc.moveDown(1.3);
    const sigY = doc.y;
    doc.text("____________________________", 50, sigY, { width: 220 });
    doc.text("____________________________", 320, sigY, { width: 220 });
    doc.fontSize(8).text("Svojeručni potpis vlasnika", 50, doc.y, { width: 220 });
    doc.text("Primio, za ZEV (predsjednik / upravnik)", 320, doc.y, { width: 220 });

    // The signature row above ends on a positioned call at x=320 — reset back to the margin
    // before the closing note so it isn't squeezed into that column's narrower width too.
    doc.x = 50;
    doc.moveDown(1.0);
    doc.fontSize(7.5).fillColor("#555").text(
      "Napomena: Ova izjava se popunjava i potpisuje u fizičkom, papirnom obliku, jednokratno, prije nego što " +
      "vlasnik prvi put iskoristi mogućnost elektronskog izjašnjavanja. Original se čuva u dokumentaciji ZEV-a, a " +
      "predsjednik u aplikaciji označava izjavu kao potpisanu i prilaže skenirani primjerak.",
      50, doc.y, { width: 495, align: "justify" }
    );
  });

  // Downloading only ever moves a fresh consent forward (NONE -> PENDING); it never disturbs an
  // already-decided SIGNED or REVOKED status, so re-printing a copy can't silently reopen it.
  if (party.eVoteConsentStatus === "NONE" || party.eVoteConsentStatus === "PENDING") {
    await prisma.party.update({
      where: { id: partyId },
      data: { eVoteConsentStatus: "PENDING", eVoteConsentEmail: email || null },
    });
  }
  await audit(actor, {
    action: "party.evote_consent.request",
    targetType: "Party",
    targetId: partyId,
    after: { email },
  });

  return buffer;
}

export async function generateMeetingInvitationPdf(actor: Actor, meetingId: string) {
  requireRole(actor, "PRESIDENT");
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: { agendaItems: { orderBy: { order: "asc" } } },
  });
  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, { number: await nextDocNumber("MEETING_INVITATION"), title: "POZIV NA SJEDNICU SKUPŠTINE", issueDate: new Date() });
    doc.text(`Sjednica: ${meeting.title} (${tEnum("meetingType", meeting.type)})`);
    doc.text(`Mjesto: ${meeting.location ?? "—"}`);
    doc.text(`Vrijeme: ${formatDateTime(meeting.scheduledAt)}`);
    if (meeting.eVoteOpensAt) {
      doc.text(`Elektronsko izjašnjavanje: od ${formatDateTime(meeting.eVoteOpensAt)} do ${formatDateTime(meeting.eVoteClosesAt)}`);
    }
    doc.moveDown().font("bold").text("Dnevni red:").font("reg");
    meeting.agendaItems.forEach((item, i) => doc.text(`${i + 1}. ${item.title}`));
    doc.moveDown().text("Materijali za sjednicu dostupni su u aplikaciji nakon prijave.");
    docFooter(doc, { sourceRef: `Meeting ${meeting.id}`, version: 1, status: "FINAL" });
  });
  return storeDocument(actor, {
    type: "MEETING_INVITATION",
    title: `Poziv — ${meeting.title}`,
    sourceType: "Meeting",
    sourceId: meeting.id,
    buffer,
    finalize: true,
    publishedToOwners: true,
  });
}

export async function generateMinutesPdf(actor: Actor, meetingId: string, opts?: { finalize?: boolean }) {
  requireRole(actor, "PRESIDENT");
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: {
      agendaItems: { orderBy: { order: "asc" } },
      attendances: { include: { party: true } },
      proposals: { where: { status: { in: ["ACCEPTED", "REJECTED", "VOTING_CLOSED"] } } },
    },
  });
  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, { number: await nextDocNumber("MINUTES"), title: "ZAPISNIK SA SJEDNICE SKUPŠTINE", issueDate: new Date() });
    doc.text(`Sjednica: ${meeting.title}`);
    doc.text(`Vrijeme: ${formatDateTime(meeting.scheduledAt)}   Mjesto: ${meeting.location ?? "—"}`);
    doc.moveDown().font("bold").text("Prisutni:").font("reg");
    const present = meeting.attendances.filter((a) => a.present);
    present.forEach((a) => doc.text(`• ${partyDisplayName(a.party)}${a.viaProxyId ? " (putem punomoćnika)" : ""}`));
    if (present.length === 0) doc.text("— (pismeno/elektronsko izjašnjavanje)");
    doc.moveDown().font("bold").text("Dnevni red:").font("reg");
    meeting.agendaItems.forEach((item, i) => doc.text(`${i + 1}. ${item.title}`));
    doc.moveDown().font("bold").text("Rezultati izjašnjavanja:").font("reg");
    for (const p of meeting.proposals) {
      const r = p.resultSummary as { approveWeight?: string; rejectWeight?: string; abstainWeight?: string; quorumReached?: boolean; accepted?: boolean } | null;
      doc.moveDown(0.3).font("bold").text(`${p.code} v${p.version}: ${p.title}`).font("reg");
      doc.fontSize(9).text(p.text, { indent: 10 }).fontSize(10);
      if (r) {
        doc.text(
          `Za: ${formatWeight(r.approveWeight ?? "0")} · Protiv: ${formatWeight(r.rejectWeight ?? "0")} · Uzdržani: ${formatWeight(r.abstainWeight ?? "0")} · ` +
          `Kvorum: ${r.quorumReached ? "postignut" : "nije postignut"} · Ishod: ${r.accepted ? "USVOJENO" : "NIJE USVOJENO"}` +
          (p.decisionNumber ? ` · Odluka br. ${p.decisionNumber}` : "")
        );
      }
    }
    if (meeting.discussionNotes) {
      doc.moveDown().font("bold").text("Tok rasprave:").font("reg").text(meeting.discussionNotes);
    }
    doc.moveDown(2);
    doc.text("Predsjednik ZEV: ______________________", 50);
    doc.text("Zapisničar: ______________________", 300, doc.y - 12);
    docFooter(doc, { sourceRef: `Meeting ${meeting.id}`, version: 1, status: opts?.finalize ? "FINAL" : "DRAFT" });
  });
  return storeDocument(actor, {
    type: "MINUTES",
    title: `Zapisnik — ${meeting.title}`,
    sourceType: "Meeting",
    sourceId: meeting.id,
    buffer,
    finalize: opts?.finalize,
    publishedToOwners: opts?.finalize ?? false,
  });
}

export async function generateDecisionPdf(actor: Actor, proposalId: string) {
  requireRole(actor, "PRESIDENT");
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId }, include: { meeting: true } });
  if (p.status !== "ACCEPTED" && p.status !== "REJECTED") throw new Error("Odluka se generiše nakon zatvaranja glasanja.");
  const r = p.resultSummary as { approveWeight?: string; rejectWeight?: string; abstainWeight?: string; totalEligibleWeight?: string; accepted?: boolean } | null;
  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, { number: p.decisionNumber ?? (await nextDocNumber("DECISION")), title: "ODLUKA SKUPŠTINE ZAJEDNICE ETAŽNIH VLASNIKA", issueDate: new Date() });
    doc.text(`Na osnovu izjašnjavanja o prijedlogu ${p.code} (verzija ${p.version}) na sjednici „${p.meeting.title}",`);
    doc.text(`skupština ZEV donosi sljedeću odluku:`);
    doc.moveDown().font("bold").text(p.title).font("reg").moveDown(0.3);
    doc.text(p.text);
    doc.moveDown();
    if (r) {
      doc.fontSize(9).text(
        `Rezultat: Za ${formatWeight(r.approveWeight ?? "0")} / Protiv ${formatWeight(r.rejectWeight ?? "0")} / Uzdržani ${formatWeight(r.abstainWeight ?? "0")} od ukupno ${formatWeight(r.totalEligibleWeight ?? "0")}. ` +
        `Prijedlog je ${p.status === "ACCEPTED" ? "USVOJEN" : "ODBIJEN"}.`
      ).fontSize(10);
    }
    doc.text(`Hash sadržaja prijedloga (SHA-256): ${p.contentHash ?? "—"}`, { width: 495 });
    doc.moveDown(2).text("Predsjednik ZEV: ______________________");
    docFooter(doc, { sourceRef: `Proposal ${p.code} v${p.version}`, version: p.version, status: "FINAL" });
  });
  return storeDocument(actor, {
    type: "DECISION",
    title: `Odluka — ${p.title}`,
    sourceType: "Proposal",
    sourceId: p.id,
    number: p.decisionNumber ?? undefined,
    buffer,
    finalize: true,
    publishedToOwners: true,
  });
}

export async function generateVotingListPdf(actor: Actor, proposalId: string) {
  requireRole(actor, "PRESIDENT");
  const p = await prisma.proposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { eligibleVoters: { include: { owner: true, proxy: true, votes: { where: { invalid: false } } } } },
  });
  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, { number: await nextDocNumber("VOTING_LIST"), title: `GLASAČKA LISTA — ${p.code} v${p.version}`, issueDate: new Date() });
    doc.font("bold");
    const y0 = doc.y;
    doc.text("Vlasnik", 50, y0, { width: 180 });
    doc.text("Punomoćnik", 235, y0, { width: 120 });
    doc.text("Težina", 360, y0, { width: 70, align: "right" });
    doc.text("Izjašnjenje", 435, y0, { width: 110, align: "right" });
    doc.font("reg");
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke();
    for (const ev of p.eligibleVoters) {
      const vote = ev.votes.find((v) => !v.correctionOfId) ?? ev.votes[0];
      const y = doc.y + 4;
      doc.text(partyDisplayName(ev.owner), 50, y, { width: 180 });
      doc.text(ev.proxy ? partyDisplayName(ev.proxy) : "—", 235, y, { width: 120 });
      doc.text(formatWeight(ev.weight), 360, y, { width: 70, align: "right" });
      doc.text(vote ? tEnum("vote", vote.choice) : "nije glasao", 435, y, { width: 110, align: "right" });
    }
    docFooter(doc, { sourceRef: `Proposal ${p.code} v${p.version}`, version: p.version, status: "FINAL" });
  });
  return storeDocument(actor, {
    type: "VOTING_LIST",
    title: `Glasačka lista ${p.code} v${p.version}`,
    sourceType: "Proposal",
    sourceId: p.id,
    buffer,
    finalize: true,
  });
}

export async function generatePlanPdf(actor: Actor, planId: string) {
  requireRole(actor, "PRESIDENT");
  const plan = await prisma.annualPlan.findUniqueOrThrow({ where: { id: planId }, include: { items: true } });
  const type = plan.kind === "MAINTENANCE" ? "ANNUAL_MAINTENANCE_PLAN" : "ANNUAL_FINANCIAL_PLAN";
  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, {
      number: await nextDocNumber(type),
      title: `${plan.kind === "MAINTENANCE" ? "GODIŠNJI PLAN ODRŽAVANJA" : "GODIŠNJI FINANSIJSKI PLAN"} — ${plan.year}. (verzija ${plan.version})`,
      issueDate: new Date(),
    });
    doc.text(`Status: ${tEnum("planStatus", plan.status)}`);
    doc.moveDown(0.5);
    let total = 0;
    for (const item of plan.items) {
      const y = doc.y + 4;
      doc.text(`${item.name}${item.month ? ` (mjesec ${item.month})` : ""}`, 50, y, { width: 350 });
      doc.text(formatMoney(item.plannedAmount.toString(), ""), 420, y, { width: 125, align: "right" });
      total += Number(item.plannedAmount);
    }
    doc.moveDown().font("bold").text(`UKUPNO PLANIRANO: ${formatMoney(total.toFixed(2))}`, 50, doc.y, { width: 495, align: "right" });
    docFooter(doc, { sourceRef: `AnnualPlan ${plan.year}/${plan.kind} v${plan.version}`, version: plan.version, status: plan.status });
  });
  return storeDocument(actor, {
    type,
    title: `${plan.title} (v${plan.version})`,
    sourceType: "AnnualPlan",
    sourceId: plan.id,
    buffer,
    finalize: plan.status === "APPROVED",
    publishedToOwners: plan.status === "APPROVED",
  });
}

export async function generatePaymentReminderPdf(actor: Actor, partyId: string) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
  const overdue = await prisma.invoice.findMany({
    where: { debtorId: partyId, status: "ISSUED", dueDate: { lt: new Date() } },
    include: { allocations: true, unit: true },
  });
  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, { number: await nextDocNumber("PAYMENT_REMINDER"), title: "OPOMENA ZA PLAĆANJE", issueDate: new Date() });
    doc.text(`Poštovani ${partyDisplayName(party)},`);
    doc.moveDown(0.5).text("evidentirali smo sljedeće dospjele, a neplaćene fakture:");
    doc.moveDown(0.5);
    let total = 0;
    for (const inv of overdue) {
      const paid = inv.allocations.reduce((a, x) => a + Number(x.amount), 0);
      const open = Number(inv.total) - paid;
      if (open <= 0) continue;
      total += open;
      doc.text(`• ${inv.number} (${inv.unit.label}) — dospjela ${formatDate(inv.dueDate)} — otvoreno ${formatMoney(open.toFixed(2))}`);
    }
    doc.moveDown().font("bold").text(`Ukupno dospjelo: ${formatMoney(total.toFixed(2))}`).font("reg");
    doc.moveDown().text("Molimo da dug izmirite u roku od 8 dana. Detalji su dostupni u aplikaciji nakon prijave.");
    docFooter(doc, { sourceRef: `Party ${partyId}`, version: 1, status: "FINAL" });
  });
  return storeDocument(actor, {
    type: "PAYMENT_REMINDER",
    title: `Opomena — ${partyDisplayName(party)}`,
    sourceType: "Party",
    sourceId: partyId,
    buffer,
    finalize: true,
  });
}

export async function generateWorkOrderPdf(actor: Actor, workOrderId: string) {
  requireRole(actor, "PRESIDENT");
  const wo = await prisma.workOrder.findUniqueOrThrow({
    where: { id: workOrderId },
    include: { supplier: true, issue: { include: { unit: true } } },
  });
  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, { number: wo.number, title: `RADNI NALOG ${wo.number}`, issueDate: wo.createdAt });
    doc.text(`Izvođač: ${wo.supplier.name} (JIB: ${wo.supplier.jib ?? "—"})`);
    doc.text(`Prijava: ${wo.issue.title}`);
    doc.text(`Lokacija: ${wo.issue.locationNote ?? wo.issue.unit?.label ?? "—"}`);
    doc.text(`Termin: ${formatDate(wo.scheduledFrom)} — ${formatDate(wo.scheduledTo)}`);
    doc.moveDown().font("bold").text("Opis radova:").font("reg").text(wo.description);
    doc.moveDown(2).text("Naručilac: ______________________", 50);
    doc.text("Izvođač: ______________________", 300, doc.y - 12);
    docFooter(doc, { sourceRef: `WorkOrder ${wo.number}`, version: 1, status: "FINAL" });
  });
  const stored = await storeDocument(actor, {
    type: "WORK_ORDER",
    title: `Radni nalog ${wo.number}`,
    sourceType: "WorkOrder",
    sourceId: wo.id,
    number: wo.number,
    buffer,
    finalize: true,
  });
  await prisma.workOrder.update({ where: { id: wo.id }, data: { documentId: stored.id } });
  return stored;
}

/**
 * Consolidated financial report (cash flow, income/expense, receivables aging,
 * suppliers, reserve fund, per-building/per-project breakdown) for a date range —
 * the printable counterpart to the CSV exports on the Izvještaji page. Stored as
 * a versioned Document (type ANNUAL_REPORT) so it shows up in Dokumenti and can
 * be re-downloaded later, same as the other formal PDFs in this file.
 */
export async function generateFinancialReportPdf(actor: Actor, range?: DateRange) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const [cashFlow, incExp, receivables, suppliers, supplierUnpaid, fund, byBuilding, byProject] = await Promise.all([
    cashFlowReport(actor, range),
    incomeExpenseReport(actor, range),
    receivablesReport(actor, range?.to ?? new Date()),
    supplierReport(actor, range),
    unpaidSupplierInvoices(actor),
    reserveFundBalance(actor),
    allocationSummary(actor, "building", range),
    allocationSummary(actor, "project", range),
  ]);
  const periodLabel = range?.from || range?.to
    ? `${range?.from ? formatDate(range.from) : "početak"} — ${range?.to ? formatDate(range.to) : "danas"}`
    : "cijeli period";

  type Col = { label: string; x: number; width: number; right?: boolean };
  const buffer = await renderPdf(async (doc) => {
    await zevHeader(doc, {
      number: await nextDocNumber("ANNUAL_REPORT"),
      title: "FINANSIJSKI IZVJEŠTAJ",
      issueDate: new Date(),
    });
    doc.font("reg").fontSize(9).text(`Period: ${periodLabel}`, 50, doc.y, { width: 495, align: "center" });
    doc.moveDown();

    const section = (title: string) => {
      if (doc.y > 680) doc.addPage();
      doc.font("bold").fontSize(11).text(title, 50, doc.y, { width: 495 });
      doc.moveDown(0.3);
    };
    const table = (cols: Col[], rows: string[][], empty: string) => {
      if (doc.y > 700) doc.addPage();
      doc.font("bold").fontSize(8.5);
      const hy = doc.y;
      cols.forEach((c) => doc.text(c.label, c.x, hy, { width: c.width, align: c.right ? "right" : "left" }));
      doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke();
      doc.moveDown(0.25);
      doc.font("reg").fontSize(9);
      if (rows.length === 0) {
        doc.fillColor("#777").text(empty, 50, doc.y, { width: 495 }).fillColor("#000");
      }
      for (const r of rows) {
        if (doc.y > 760) {
          doc.addPage();
          doc.font("bold").fontSize(8.5);
          const hy2 = doc.y;
          cols.forEach((c) => doc.text(c.label, c.x, hy2, { width: c.width, align: c.right ? "right" : "left" }));
          doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke();
          doc.moveDown(0.25);
          doc.font("reg").fontSize(9);
        }
        const ry = doc.y + 2;
        // Measure the tallest cell first — a wrapped (multi-line) name in any
        // column must not let the next row's y creep up and overlap it.
        const rowHeight = Math.max(...cols.map((c, i) => doc.heightOfString(r[i], { width: c.width })));
        cols.forEach((c, i) => doc.text(r[i], c.x, ry, { width: c.width, align: c.right ? "right" : "left" }));
        doc.y = ry + rowHeight;
      }
      doc.x = 50;
      doc.moveDown(1);
    };

    section("Stanje računa i tok novca");
    table(
      [
        { label: "Račun", x: 50, width: 160 },
        { label: "Početno", x: 210, width: 75, right: true },
        { label: "Prilivi", x: 285, width: 75, right: true },
        { label: "Odlivi", x: 360, width: 75, right: true },
        { label: "Trenutno stanje", x: 435, width: 110, right: true },
      ],
      cashFlow.map((r) => [r.accountName, formatMoney(r.opening, ""), formatMoney(r.income, ""), formatMoney(r.expense, ""), formatMoney(r.currentBalance, "")]),
      "Nema aktivnih računa."
    );

    section("Prihodi i rashodi po kategorijama");
    table(
      [
        { label: "Kategorija", x: 50, width: 300 },
        { label: "Vrsta", x: 350, width: 95 },
        { label: "Iznos", x: 445, width: 100, right: true },
      ],
      incExp.map((r) => [r.category, r.kind === "INCOME" ? "Prihod" : "Rashod", formatMoney(r.total, "")]),
      "Nema knjiženja u odabranom periodu."
    );

    section(`Neplaćene fakture vlasnika (otvoreno: ${formatMoney(receivables.totalOpen)} · dospjelo: ${formatMoney(receivables.totalOverdue)})`);
    table(
      [
        { label: "Faktura", x: 50, width: 85 },
        { label: "Dužnik", x: 140, width: 140 },
        { label: "Jedinica", x: 285, width: 70 },
        { label: "Dospijeće", x: 360, width: 65 },
        { label: "Otvoreno", x: 430, width: 60, right: true },
        { label: "Starost", x: 495, width: 50 },
      ],
      receivables.rows.map((r) => [r.number, r.debtor, r.unit, formatDate(r.dueDate), formatMoney(r.open, ""), r.bucket]),
      "Nema otvorenih potraživanja."
    );

    section("Dobavljači");
    table(
      [
        { label: "Dobavljač", x: 50, width: 280 },
        { label: "Faktura", x: 330, width: 60, right: true },
        { label: "Ukupno", x: 400, width: 70, right: true },
        { label: "Neplaćeno", x: 475, width: 70, right: true },
      ],
      suppliers.map((s) => [s.supplier, String(s.count), formatMoney(s.total, ""), formatMoney(s.unpaid, "")]),
      "Nema troškova dobavljača u odabranom periodu."
    );

    section(`Fond održavanja — uplaćeno ${formatMoney(fund.income)}, utrošeno ${formatMoney(fund.spent)}, stanje ${formatMoney(fund.balance)}`);
    doc.moveDown(0.5);

    section("Neplaćene fakture dobavljača");
    table(
      [
        { label: "Dobavljač", x: 50, width: 220 },
        { label: "Br. fakture", x: 275, width: 120 },
        { label: "Rok", x: 400, width: 70 },
        { label: "Otvoreno", x: 475, width: 70, right: true },
      ],
      supplierUnpaid.map((e) => [
        e.supplier?.name ?? "—",
        e.invoiceNumber ?? "—",
        formatDate(e.dueDate),
        formatMoney((Number(e.amount) - Number(e.paidAmount)).toFixed(2), ""),
      ]),
      "Nema neplaćenih faktura dobavljača."
    );

    section("Pregled po zgradama");
    table(
      [
        { label: "Zgrada", x: 50, width: 250 },
        { label: "Prilivi", x: 305, width: 90, right: true },
        { label: "Odlivi", x: 400, width: 70, right: true },
        { label: "Neto", x: 475, width: 70, right: true },
      ],
      byBuilding.map((r) => [r.name, formatMoney(r.income, ""), formatMoney(r.expense, ""), formatMoney(r.net, "")]),
      "Nema knjiženja po zgradama u odabranom periodu."
    );

    section("Pregled po projektima");
    table(
      [
        { label: "Projekat", x: 50, width: 250 },
        { label: "Prilivi", x: 305, width: 90, right: true },
        { label: "Odlivi", x: 400, width: 70, right: true },
        { label: "Neto", x: 475, width: 70, right: true },
      ],
      byProject.map((r) => [r.name, formatMoney(r.income, ""), formatMoney(r.expense, ""), formatMoney(r.net, "")]),
      "Nema knjiženja po projektima u odabranom periodu."
    );

    docFooter(doc, { sourceRef: `Financial report ${periodLabel}`, version: 1, status: "FINAL" });
  });

  return storeDocument(actor, {
    type: "ANNUAL_REPORT",
    title: `Finansijski izvještaj — ${periodLabel}`,
    buffer,
    finalize: true,
  });
}
