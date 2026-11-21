// Faza B1b — nalog početnog stanja (Plans/kontni-plan-b1-nalozi-plan.md §4).
//
// Prijedlog se pravi iz operativne evidencije NA KRAJ DANA prije datuma početka: stanja računa novca, otvorene
// fakture po namjeni, korekcije salda, avansi, neidentifikovane uplate i neplaćeni računi dobavljača. Svaka stavka
// pamti izvor (`openingSourceType`/`openingSourceId`), pa isti dokument ne može ući dvaput. Stavke koje evidencija
// ne zna (razgraničena sredstva, rezultat ranijih godina, razlika) računovođa dodaje ručno (B1-Q4 (a)).
// Knjiženje je dozvoljeno tek kad su nalog uravnotežen i glavna knjiga, analitika i evidencija usklađeni po svakom
// kontrolnom kontu — to provjerava i `postEntry`, ne samo ekran.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireCapability, requireZev, type Actor } from "@/server/auth/guards";
import { Prisma, type ControlRole } from "@/generated/prisma/client";
import { dec, sumDecimals, ZERO } from "@/lib/money";
import { endOfDay, formatDate } from "@/lib/i18n";
import { checkLines, normalizeLines, type JournalLineInput } from "@/server/services/journal";
import { allocationSplitRule, chargeTypePurpose, purposeSplit } from "@/server/services/purposeSplit";

type Tx = Prisma.TransactionClient;
type Decimal = Prisma.Decimal;

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
function dayBefore(iso: string) {
  const d = dateOnly(iso);
  d.setUTCDate(d.getUTCDate() - 1);
  return isoOf(d);
}

/** Zapis evidencije važi na dan ako je nastao do tog trenutka i nije poništen do tada. */
const liveAt = (asOf: Date, cancelledAt: Date | null) => !cancelledAt || cancelledAt > asOf;
/** Zapis sa statusom poništenja važi na dan samo ako je poništen POSLIJE tog dana (bez datuma — ne važi). */
const cancelledAfter = (asOf: Date, cancelledAt: Date | null) => !!cancelledAt && cancelledAt > asOf;

// ---------------------------------------------------------------------------
// Operativna evidencija na dan
// ---------------------------------------------------------------------------

/** Jedna stavka prijedloga: izvor, uloga kontrolnog konta, strana i iznos, analitika. */
export type OpeningItem = {
  sourceType: "MONEY" | "INVOICE" | "CORRECTION" | "ADVANCE" | "UNIDENTIFIED" | "SUPPLIER";
  sourceId: string;
  role: ControlRole;
  moneyAccountId: string | null;
  purposeId: string | null;
  side: "D" | "P";
  amount: Decimal;
  partyId: string | null;
  unitId: string | null;
  supplierId: string | null;
  description: string;
};

/** Kad potraživanje/korekcija nema namjenu (fakture prije A2): prva aktivna namjena koja nije rezerva (B1-Q3 (c)). */
export async function defaultPurposeId(tx: Tx | typeof prisma, zevId: string) {
  const p = await tx.fundPurpose.findFirst({ where: { zevId, active: true, isCommonReserve: false }, orderBy: { code: "asc" } });
  return p?.id ?? null;
}

/**
 * Stanja iz operativne evidencije na kraj dana `asOfIso` (B1b „funkcije na dan”). Za razliku od postojećih
 * izvještaja, poništenja POSLIJE tog dana ne brišu zapis iz stanja na taj dan (storno uplate, storno troška…).
 */
export async function operationalSnapshot(tx: Tx | typeof prisma, zevId: string, asOfIso: string): Promise<OpeningItem[]> {
  const asOf = endOfDay(asOfIso);
  const items: OpeningItem[] = [];
  const fallbackPurpose = await defaultPurposeId(tx, zevId);

  // Računi novca: početno stanje računa + promet do dana.
  const accounts = await tx.moneyAccount.findMany({ where: { zevId }, orderBy: { name: "asc" } });
  for (const a of accounts) {
    const txs = await tx.finTransaction.findMany({ where: { zevId, accountId: a.id, date: { lte: asOf } } });
    let bal = a.openingDate <= asOf ? dec(a.openingBalance.toString()) : ZERO;
    for (const t of txs) {
      if (t.status !== "ACTIVE" && !cancelledAfter(asOf, t.cancelledAt)) continue;
      if (t.type === "INCOME") bal = bal.plus(dec(t.amount.toString()));
      else if (t.type === "EXPENSE") bal = bal.minus(dec(t.amount.toString()));
    }
    if (bal.isZero()) continue;
    items.push({
      sourceType: "MONEY", sourceId: a.id, role: "MONEY_ACCOUNT", moneyAccountId: a.id, purposeId: null,
      side: bal.gt(0) ? "D" : "P", amount: bal.abs(), partyId: null, unitId: null, supplierId: null,
      description: `Stanje računa „${a.name}” na ${formatDate(asOf)}`,
    });
  }

  // Otvorene fakture: iznos − raspoređene uplate do dana, po namjeni linija (pravilo vrste, pa podrazumijevana
  // namjena vrste, pa ZEV-a). Naplaćeni dio se po namjeni dijeli istim pravilom raspodjele kao u automatskom
  // knjiženju (B2-Q7), pa početno stanje i kasniji rasporedi ostaju usklađeni po namjeni.
  const splitRule = await allocationSplitRule(tx, zevId);
  const invoices = await tx.invoice.findMany({
    where: { zevId, issueDate: { lte: asOf }, status: { in: ["ISSUED", "PAID", "CANCELLED", "CORRECTED"] } },
    include: {
      allocations: { where: { createdAt: { lte: asOf } }, select: { amount: true } },
      lines: { orderBy: { order: "asc" }, select: { amount: true, chargeTypeId: true, chargeItem: { select: { chargeTypeId: true } } } },
    },
    orderBy: { issueDate: "asc" },
  });
  for (const inv of invoices) {
    if ((inv.status === "CANCELLED" || inv.status === "CORRECTED") && !cancelledAfter(asOf, inv.cancelledAt)) continue;
    const paid = sumDecimals(inv.allocations.map((a) => dec(a.amount.toString())));
    const open = dec(inv.total.toString()).minus(paid);
    if (open.lte(0)) continue;
    const weights = new Map<string, Decimal>();
    for (const l of inv.lines) {
      const typeId = l.chargeTypeId ?? l.chargeItem?.chargeTypeId ?? null;
      const purpose = (typeId ? await chargeTypePurpose(tx, zevId, typeId, inv.issueDate) : null) ?? fallbackPurpose ?? "";
      weights.set(purpose, (weights.get(purpose) ?? ZERO).plus(dec(l.amount.toString())));
    }
    if (weights.size === 0) weights.set(fallbackPurpose ?? "", dec(inv.total.toString()));
    const paidBy = purposeSplit(splitRule, weights, paid);
    for (const [purpose, full] of weights) {
      const amount = full.minus(paidBy.get(purpose) ?? ZERO);
      if (amount.isZero()) continue;
      items.push({
        sourceType: "INVOICE", sourceId: purpose ? `${inv.id}:${purpose}` : inv.id, role: "OWNER_RECEIVABLE", moneyAccountId: null,
        purposeId: purpose || null, side: amount.gt(0) ? "D" : "P", amount: amount.abs(),
        partyId: inv.debtorId, unitId: inv.unitId, supplierId: null, description: `Faktura ${inv.number}`,
      });
    }
  }

  // Korekcije salda: neto po licu (namjena nije poznata → podrazumijevana).
  const corrections = await tx.balanceCorrection.groupBy({ by: ["partyId"], where: { zevId, createdAt: { lte: asOf } }, _sum: { amount: true } });
  for (const c of corrections) {
    const net = dec(c._sum.amount?.toString() ?? "0");
    if (net.isZero()) continue;
    items.push({
      sourceType: "CORRECTION", sourceId: c.partyId, role: "OWNER_RECEIVABLE", moneyAccountId: null, purposeId: fallbackPurpose,
      side: net.gt(0) ? "D" : "P", amount: net.abs(), partyId: c.partyId, unitId: null, supplierId: null, description: "Korekcije salda",
    });
  }

  // Uplate: neraspoređeni dio do dana — avans poznatog platioca (po licu) ili neidentifikovana uplata (po uplati).
  const payments = await tx.payment.findMany({
    where: { zevId, date: { lte: asOf } },
    include: { allocations: { where: { createdAt: { lte: asOf } }, select: { amount: true } } },
    orderBy: { date: "asc" },
  });
  const advances = new Map<string, Decimal>();
  for (const p of payments) {
    if (!liveAt(asOf, p.reversedAt)) continue;
    const free = dec(p.amount.toString()).minus(sumDecimals(p.allocations.map((a) => dec(a.amount.toString()))));
    if (free.isZero()) continue;
    if (p.payerId) {
      advances.set(p.payerId, (advances.get(p.payerId) ?? ZERO).plus(free));
    } else {
      items.push({
        sourceType: "UNIDENTIFIED", sourceId: p.id, role: "UNIDENTIFIED_RECEIPTS", moneyAccountId: null, purposeId: null,
        side: free.gt(0) ? "P" : "D", amount: free.abs(), partyId: null, unitId: null, supplierId: null,
        description: `Neidentifikovana uplata ${formatDate(p.date)}${p.payerNameRaw ? ` — ${p.payerNameRaw}` : ""}`,
      });
    }
  }
  for (const [partyId, free] of advances) {
    if (free.isZero()) continue;
    items.push({
      sourceType: "ADVANCE", sourceId: partyId, role: "OWNER_ADVANCE", moneyAccountId: null, purposeId: null,
      side: free.gt(0) ? "P" : "D", amount: free.abs(), partyId, unitId: null, supplierId: null, description: "Avans (neraspoređene uplate)",
    });
  }

  // Računi dobavljača: iznos − plaćanja (promet sa vezom na trošak) do dana.
  const expenses = await tx.expense.findMany({
    where: { zevId, OR: [{ invoiceDate: { lte: asOf } }, { invoiceDate: null, createdAt: { lte: asOf } }] },
    include: { supplier: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const paidTx = await tx.finTransaction.findMany({ where: { zevId, type: "EXPENSE", expenseId: { not: null }, date: { lte: asOf } } });
  const paidBy = new Map<string, Decimal>();
  for (const t of paidTx) {
    if (t.status !== "ACTIVE" && !cancelledAfter(asOf, t.cancelledAt)) continue;
    paidBy.set(t.expenseId!, (paidBy.get(t.expenseId!) ?? ZERO).plus(dec(t.amount.toString())));
  }
  for (const e of expenses) {
    if (e.status === "CANCELLED" && !cancelledAfter(asOf, e.cancelledAt)) continue;
    const open = dec(e.amount.toString()).minus(paidBy.get(e.id) ?? ZERO);
    if (open.lte(0)) continue;
    items.push({
      sourceType: "SUPPLIER", sourceId: e.id, role: "SUPPLIER_PAYABLE", moneyAccountId: null, purposeId: null,
      side: "P", amount: open, partyId: null, unitId: null, supplierId: e.supplierId,
      description: `Račun ${e.supplier?.name ?? "bez dobavljača"}${e.invoiceNumber ? ` br. ${e.invoiceNumber}` : ""}`,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Kontrolna konta na datum početka
// ---------------------------------------------------------------------------

type ControlRow = { role: ControlRole; moneyAccountId: string | null; purposeId: string | null; accountId: string };
export const controlKey = (r: { role: ControlRole; moneyAccountId: string | null; purposeId: string | null }) =>
  `${r.role}:${r.moneyAccountId ?? "-"}:${r.purposeId ?? "-"}`;

/** Važeće kontrolno konto po ključu (uloga, račun novca, namjena) na datum — najkasnije `validFrom` do tog dana. */
export async function controlAccountsAt(tx: Tx | typeof prisma, zevId: string, at: Date) {
  const rows = await tx.zevControlAccount.findMany({ where: { zevId, validFrom: { lte: at } }, orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }] });
  const map = new Map<string, ControlRow>();
  for (const r of rows) if (!map.has(controlKey(r))) map.set(controlKey(r), r);
  return map;
}

export const ROLE_LABEL: Record<ControlRole, string> = {
  MONEY_ACCOUNT: "račun novca", OWNER_RECEIVABLE: "potraživanja od vlasnika", OWNER_ADVANCE: "avansi vlasnika",
  UNIDENTIFIED_RECEIPTS: "neidentifikovane uplate", SUPPLIER_PAYABLE: "obaveze prema dobavljačima",
};

// ---------------------------------------------------------------------------
// Prijedlog (nacrt), ručne stavke, brisanje
// ---------------------------------------------------------------------------

/** Nacrt ili proknjižen (nestorniran) nalog početnog stanja godine u koju pada datum. */
export async function openingStatus(actor: Actor) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const entries = await prisma.journalEntry.findMany({
    where: { zevId, kind: "OPENING" },
    include: { reversedBy: { select: { id: true, number: true } }, year: { select: { label: true } } },
    orderBy: { createdAt: "desc" },
  });
  const draft = entries.find((e) => e.status === "DRAFT") ?? null;
  const posted = entries.find((e) => e.status === "POSTED" && !e.reversedBy) ?? null;
  return { draft, posted, history: entries };
}

/**
 * „Pripremi prijedlog”: nacrt naloga početnog stanja sa datumom početka, iz evidencije na kraj prethodnog dana.
 * Druga priprema zamjenjuje stavke iz evidencije u postojećem nacrtu, a ručno dodate stavke ostaju.
 */
export async function prepareOpening(actor: Actor, input: { startDate: string }) {
  requireCapability(actor, "journal.prepare");
  const zevId = requireZev(actor);
  if (!isDate(input.startDate)) throw new Error("Unesite datum početka knjiženja.");
  const start = dateOnly(input.startDate);
  const asOfIso = dayBefore(input.startDate);

  const result = await prisma.$transaction(async (tx) => {
    const chart = await tx.zevChart.findFirst({ where: { zevId, status: "ACTIVE" } });
    if (!chart) throw new Error("Kontni plan ZEV-a nije aktivan.");
    const period = await tx.fiscalPeriod.findFirst({ where: { zevId, startDate: { lte: start }, endDate: { gte: start } }, include: { year: true } });
    if (!period) throw new Error("Za datum početka ne postoji poslovna godina — otvorite je na tabu „Poslovne godine”.");
    if (period.status !== "OPEN" || period.year.status !== "OPEN") throw new Error(`Period ${period.label} je zatvoren.`);

    const existing = await tx.journalEntry.findMany({ where: { zevId, kind: "OPENING" }, include: { reversedBy: { select: { id: true } } } });
    if (existing.some((e) => e.status === "POSTED" && !e.reversedBy)) {
      throw new Error("Početno stanje je već proknjiženo. Za ispravku ga prvo stornirajte.");
    }
    const draft = existing.find((e) => e.status === "DRAFT") ?? null;
    if (draft && draft.yearId !== period.yearId) throw new Error("Postoji nacrt početnog stanja za drugu godinu — obrišite ga prije nove pripreme.");
    // Poslije storna novo početno stanje samo dok u godini nema ručnih proknjiženih naloga (plan §4). Automatski
    // nalozi (B2) nastaju iz evidencije poslije datuma početka i ne zavise od iznosa početnog stanja — ali novo
    // početno stanje tada mora imati isti datum početka, inače bi se događaji između dva datuma brojali dvaput.
    const reversed = existing.filter((e) => e.status === "POSTED");
    if (reversed.length > 0) {
      const manual = await tx.journalEntry.count({ where: { zevId, yearId: period.yearId, status: "POSTED", kind: "MANUAL" } });
      if (manual > 0) throw new Error("U godini već postoje proknjiženi ručni nalozi — novo početno stanje više nije moguće.");
      const auto = await tx.journalEntry.count({ where: { zevId, status: "POSTED", kind: "AUTO" } });
      const lastStart = reversed.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0].postingDate;
      if (auto > 0 && lastStart.getTime() !== start.getTime()) {
        throw new Error(`Već postoje automatski nalozi od ${formatDate(lastStart)} — novo početno stanje mora imati isti datum početka.`);
      }
    }

    const items = await operationalSnapshot(tx, zevId, asOfIso);
    const controls = await controlAccountsAt(tx, zevId, start);
    const missing = new Set<string>();
    const generated = items.map((it) => {
      const c = controls.get(controlKey(it));
      if (!c) missing.add(ROLE_LABEL[it.role]);
      return { it, accountId: c?.accountId ?? "" };
    });
    if (missing.size > 0) {
      throw new Error(`Nedostaje kontrolno konto (${[...missing].join(", ")}) važeće na ${formatDate(start)} — postavite ga na tabu „Pravila knjiženja”.`);
    }

    const header = {
      yearId: period.yearId, periodId: period.id, documentDate: start, postingDate: start,
      description: draft?.description ?? `Početno stanje na ${formatDate(start)}`,
    };
    const entry = draft
      ? await tx.journalEntry.update({ where: { id: draft.id }, data: header })
      : await tx.journalEntry.create({ data: { ...header, zevId, kind: "OPENING", createdById: actor.userId } });
    await tx.journalLine.deleteMany({ where: { entryId: entry.id, openingSourceType: { not: null } } });
    const manualCount = await tx.journalLine.count({ where: { entryId: entry.id } });
    await tx.journalLine.createMany({
      data: generated.map(({ it, accountId }, i) => ({
        entryId: entry.id, zevId, order: i, accountId,
        debit: it.side === "D" ? it.amount.toFixed(2) : "0", credit: it.side === "P" ? it.amount.toFixed(2) : "0",
        partyId: it.partyId, unitId: it.unitId, supplierId: it.supplierId, purposeId: it.purposeId,
        description: it.description, openingSourceType: it.sourceType, openingSourceId: it.sourceId,
      })),
    });
    // Ručne stavke idu iza stavki iz evidencije.
    if (manualCount > 0) {
      const manual = await tx.journalLine.findMany({ where: { entryId: entry.id, openingSourceType: null }, orderBy: { order: "asc" } });
      for (const [k, l] of manual.entries()) await tx.journalLine.update({ where: { id: l.id }, data: { order: generated.length + k } });
    }
    return { entry, lines: generated.length, replaced: !!draft };
  });
  await audit(actor, {
    action: "journal.opening_prepare", targetType: "JournalEntry", targetId: result.entry.id,
    after: { startDate: input.startDate, asOf: asOfIso, lines: result.lines, replaced: result.replaced },
  });
  return result.entry;
}

/** Ručne stavke nacrta početnog stanja (razgraničena sredstva, rezultat ranijih godina, razlika) i opis naloga. */
export async function saveOpeningManualLines(actor: Actor, id: string, input: { description: string; lines: JournalLineInput[] }) {
  requireCapability(actor, "journal.prepare");
  const zevId = requireZev(actor);
  if (!input.description.trim()) throw new Error("Opis naloga je obavezan.");
  const lines = normalizeLines(input.lines);
  await prisma.$transaction(async (tx) => {
    const e = await tx.journalEntry.findUniqueOrThrow({ where: { id, zevId } });
    if (e.kind !== "OPENING" || e.status !== "DRAFT") throw new Error("Ručne stavke se dodaju samo u nacrt početnog stanja.");
    // Kontrolna konta dolaze samo iz evidencije — inače analitika i glavna knjiga ne bi bile usklađene.
    if (lines.length > 0) await checkLines(tx, zevId, "MANUAL", lines, "U početnom stanju kontrolna konta dolaze samo iz evidencije (dugme „Pripremi prijedlog”).");
    await tx.journalLine.deleteMany({ where: { entryId: id, openingSourceType: null } });
    const offset = await tx.journalLine.count({ where: { entryId: id } });
    if (lines.length > 0) {
      await tx.journalLine.createMany({
        data: lines.map((l, i) => ({
          entryId: id, zevId, order: offset + i, accountId: l.accountId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2),
          partyId: l.partyId, unitId: l.unitId, supplierId: l.supplierId, projectId: l.projectId, purposeId: l.purposeId, description: l.description,
        })),
      });
    }
    await tx.journalEntry.update({ where: { id }, data: { description: input.description.trim() } });
  });
  const t = { debit: sumDecimals(lines.map((l) => l.debit)), credit: sumDecimals(lines.map((l) => l.credit)) };
  await audit(actor, { action: "journal.update", targetType: "JournalEntry", targetId: id, after: { manualLines: lines.length, debit: t.debit.toFixed(2), credit: t.credit.toFixed(2) } });
}

// ---------------------------------------------------------------------------
// Usklađivanje
// ---------------------------------------------------------------------------

export type ReconciliationRow = {
  accountId: string; code: string; name: string; roleLabel: string;
  ledger: string; analytics: string; operational: string; ok: boolean;
};

const DIMENSION_OF: Partial<Record<ControlRole, "partyId" | "supplierId">> = {
  OWNER_RECEIVABLE: "partyId", OWNER_ADVANCE: "partyId", SUPPLIER_PAYABLE: "supplierId",
};
const isLiability = (r: ControlRole) => r === "OWNER_ADVANCE" || r === "UNIDENTIFIED_RECEIPTS" || r === "SUPPLIER_PAYABLE";

/**
 * Po kontrolnom kontu: glavna knjiga (saldo svih stavki naloga na tom kontu), analitika (saldo stavki koje nose
 * dimenziju uloge — vlasnika ili dobavljača; za račune novca i neidentifikovane uplate isto što i knjiga) i
 * operativna evidencija na dan (svježe izračunata, pa se vidi i promjena evidencije poslije pripreme).
 * Saldo je u prirodnoj strani konta: imovina D−P, obaveze P−D.
 */
export async function reconcileOpeningInTx(tx: Tx | typeof prisma, zevId: string, entryId: string) {
  const e = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId, zevId }, include: { lines: { include: { account: { select: { code: true, name: true } } } } } });
  const asOfIso = dayBefore(isoOf(e.postingDate));
  const controls = await controlAccountsAt(tx, zevId, e.postingDate);
  const items = await operationalSnapshot(tx, zevId, asOfIso);

  type Acc = { roleLabel: string; role: ControlRole; ledger: Decimal; analytics: Decimal; operational: Decimal };
  const byAccount = new Map<string, Acc>();
  const acc = (accountId: string, role: ControlRole) => {
    let a = byAccount.get(accountId);
    if (!a) byAccount.set(accountId, (a = { role, roleLabel: ROLE_LABEL[role], ledger: ZERO, analytics: ZERO, operational: ZERO }));
    return a;
  };
  const roleOfAccount = new Map<string, ControlRole>();
  for (const c of controls.values()) roleOfAccount.set(c.accountId, c.role);
  for (const c of controls.values()) acc(c.accountId, c.role);

  const signed = (role: ControlRole, debit: Decimal, credit: Decimal) => (isLiability(role) ? credit.minus(debit) : debit.minus(credit));
  for (const l of e.lines) {
    const role = roleOfAccount.get(l.accountId);
    if (!role) continue;
    const v = signed(role, dec(l.debit.toString()), dec(l.credit.toString()));
    const a = acc(l.accountId, role);
    a.ledger = a.ledger.plus(v);
    const dim = DIMENSION_OF[role];
    if (!dim || l[dim]) a.analytics = a.analytics.plus(v);
  }
  for (const it of items) {
    const c = controls.get(controlKey(it));
    if (!c) continue;
    const v = it.side === "D" ? signed(it.role, it.amount, ZERO) : signed(it.role, ZERO, it.amount);
    const a = acc(c.accountId, it.role);
    a.operational = a.operational.plus(v);
  }
  const accounts = await tx.zevAccount.findMany({ where: { id: { in: [...byAccount.keys()] } }, select: { id: true, code: true, name: true } });
  const meta = new Map(accounts.map((a) => [a.id, a]));
  const rows: ReconciliationRow[] = [...byAccount.entries()]
    .filter(([, a]) => !(a.ledger.isZero() && a.analytics.isZero() && a.operational.isZero()))
    .map(([id, a]) => ({
      accountId: id, code: meta.get(id)?.code ?? "?", name: meta.get(id)?.name ?? "", roleLabel: a.roleLabel,
      ledger: a.ledger.toFixed(2), analytics: a.analytics.toFixed(2), operational: a.operational.toFixed(2),
      ok: a.ledger.eq(a.analytics) && a.ledger.eq(a.operational),
    }))
    .sort((x, y) => x.code.localeCompare(y.code));

  const debit = sumDecimals(e.lines.map((l) => dec(l.debit.toString())));
  const credit = sumDecimals(e.lines.map((l) => dec(l.credit.toString())));
  // Isti izvor ne smije ući dvaput (plan §4.5).
  const seen = new Set<string>();
  let duplicate = false;
  for (const l of e.lines) {
    if (!l.openingSourceType) continue;
    const k = `${l.openingSourceType}:${l.openingSourceId}`;
    if (seen.has(k)) duplicate = true;
    seen.add(k);
  }
  const problems: string[] = [];
  if (!debit.eq(credit)) problems.push(`Nalog nije uravnotežen: razlika ${debit.minus(credit).abs().toFixed(2)} KM. Dodajte stavku razlike na konto koje izaberete.`);
  const bad = rows.filter((r) => !r.ok);
  if (bad.length > 0) problems.push(`Glavna knjiga, analitika i evidencija se ne slažu na kontima: ${bad.map((r) => r.code).join(", ")}. Pripremite prijedlog ponovo.`);
  if (duplicate) problems.push("Isti dokument je u nalogu više puta — pripremite prijedlog ponovo.");
  return { rows, asOfIso, debit: debit.toFixed(2), credit: credit.toFixed(2), problems, ready: problems.length === 0 };
}

export async function reconcileOpening(actor: Actor, entryId: string) {
  requireCapability(actor, "ledger.view");
  return reconcileOpeningInTx(prisma, requireZev(actor), entryId);
}
