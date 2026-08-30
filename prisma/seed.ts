/* Realistic demo seed for one ZEV: two buildings, three entrances, apartments,
 * garages, a business premise, owners/co-owners/occupants/proxy, president,
 * accountant, voting rules, a meeting with proposals and completed votes,
 * charge items with different formulas, an issued invoice batch, payments
 * (full/partial/over), supplier expenses, maintenance issues and annual plans.
 *
 * Run: npm run db:seed  (uses services so audits and invariants apply)
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/server/auth/password";
import { generateToken, sha256 } from "../src/server/auth/tokens";
import type { Actor } from "../src/server/auth/guards";
import * as property from "../src/server/services/property";
import * as ownership from "../src/server/services/ownership";
import * as meetings from "../src/server/services/meetings";
import * as billing from "../src/server/services/billing";
import * as payments from "../src/server/services/payments";
import * as finance from "../src/server/services/finance";
import * as expenses from "../src/server/services/expenses";
import * as plans from "../src/server/services/plans";
import * as maintenance from "../src/server/services/maintenance";
import * as documents from "../src/server/services/documents";

const PASSWORD = "Lozinka123!";

async function main() {
  // Idempotency guard: never seed on top of existing data
  // (docker-entrypoint runs the seed on every container start).
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    console.log(`Baza već sadrži ${existingUsers} korisnika — seed se preskače.`);
    return;
  }
  console.log("Seeding ZEV demo data...");
  const year = new Date().getFullYear();
  const prevMonth = new Date();
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const period = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const yearStart = new Date(Date.UTC(year, 0, 1));

  // --- Parties -------------------------------------------------------------
  const mkPerson = (firstName: string, lastName: string, email: string, extra?: object) =>
    prisma.party.create({ data: { kind: "PERSON", firstName, lastName, email, phone: "+38765000000", address: "Ulica Vojvode Mišića 10, Banja Luka", ...extra } });

  const presidentParty = await mkPerson("Milan", "Petrović", "milan.petrovic@example.com");
  const accountantParty = await mkPerson("Jelena", "Kovačević", "jelena.kovacevic@example.com");
  const ownerAna = await mkPerson("Ana", "Savić", "ana.savic@example.com");
  const ownerMarko = await mkPerson("Marko", "Jovanović", "marko.jovanovic@example.com");
  const ownerNikola = await mkPerson("Nikola", "Ilić", "nikola.ilic@example.com", { correspondenceAddress: "Kralja Petra I 5, Laktaši" });
  const ownerSara = await mkPerson("Sara", "Ilić", "sara.ilic@example.com"); // co-owner with Nikola
  const tenantIvana = await mkPerson("Ivana", "Tomić", "ivana.tomic@example.com"); // tenant, NO voting rights
  const proxyDragan = await mkPerson("Dragan", "Babić", "dragan.babic@example.com"); // proxy for Ana
  const ownerFirma = await prisma.party.create({
    data: { kind: "ORGANIZATION", orgName: "Apoteka Zdravlje d.o.o.", orgIdNumber: "4400000000000", email: "info@apoteka-zdravlje.example", address: "Gunduliceva 2, Banja Luka" },
  });

  // --- Users ---------------------------------------------------------------
  const pw = await hashPassword(PASSWORD);
  const presidentUser = await prisma.user.create({
    data: { email: "predsjednik@zev.ba", passwordHash: pw, roles: ["PRESIDENT", "OWNER"], partyId: presidentParty.id },
  });
  const accountantUser = await prisma.user.create({
    data: { email: "racunovodja@zev.ba", passwordHash: pw, roles: ["ACCOUNTANT"], partyId: accountantParty.id },
  });
  const anaUser = await prisma.user.create({
    data: { email: "vlasnik@zev.ba", passwordHash: pw, roles: ["OWNER"], partyId: ownerAna.id },
  });
  await prisma.user.create({
    data: { email: "marko@zev.ba", passwordHash: pw, roles: ["OWNER"], partyId: ownerMarko.id },
  });
  await prisma.user.create({
    data: { email: "nikola@zev.ba", passwordHash: pw, roles: ["OWNER"], partyId: ownerNikola.id },
  });

  const president: Actor = { userId: presidentUser.id, roles: ["PRESIDENT", "OWNER"], partyId: presidentParty.id };
  const accountant: Actor = { userId: accountantUser.id, roles: ["ACCOUNTANT"], partyId: accountantParty.id };

  // --- ZEV, buildings, entrances, units -------------------------------------
  const zev = await property.upsertZev(president, {
    legalName: 'Zajednica etažnih vlasnika "Vojvode Mišića 10 i 12", Banja Luka',
    shortName: "ZEV VM 10-12",
    registrationNumber: "REG-035/2019",
    jib: "4512345670001",
    registeredAddress: "Ulica Vojvode Mišića 10, 78000 Banja Luka",
    city: "Banja Luka",
    municipality: "Banja Luka",
  });

  const zgradaA = await property.createBuilding(president, { zevId: zev.id, name: "Zgrada A (Vojvode Mišića 10)", address: "Vojvode Mišića 10, Banja Luka", yearBuilt: 1987 });
  const zgradaB = await property.createBuilding(president, { zevId: zev.id, name: "Zgrada B (Vojvode Mišića 12)", address: "Vojvode Mišića 12, Banja Luka", yearBuilt: 1990 });
  const ulazA1 = await property.createEntrance(president, { buildingId: zgradaA.id, name: "Ulaz A1" });
  const ulazA2 = await property.createEntrance(president, { buildingId: zgradaA.id, name: "Ulaz A2" });
  const ulazB1 = await property.createEntrance(president, { buildingId: zgradaB.id, name: "Ulaz B1" });

  const stan1 = await property.createUnit(president, { buildingId: zgradaA.id, entranceId: ulazA1.id, type: "APARTMENT", label: "Stan 1", floor: 1, usableArea: "62.50", ownershipShare: "14.50", occupantCount: 3, typeCoefficient: "1" });
  const stan2 = await property.createUnit(president, { buildingId: zgradaA.id, entranceId: ulazA1.id, type: "APARTMENT", label: "Stan 2", floor: 2, usableArea: "48.00", ownershipShare: "11.20", occupantCount: 2, typeCoefficient: "1" });
  const stan3 = await property.createUnit(president, { buildingId: zgradaA.id, entranceId: ulazA2.id, type: "APARTMENT", label: "Stan 3", floor: 1, usableArea: "75.30", ownershipShare: "17.60", occupantCount: 4, typeCoefficient: "1" });
  const stan4 = await property.createUnit(president, { buildingId: zgradaB.id, entranceId: ulazB1.id, type: "APARTMENT", label: "Stan 4", floor: 3, usableArea: "55.00", ownershipShare: "12.80", occupantCount: 1, typeCoefficient: "1" });
  const lokal1 = await property.createUnit(president, { buildingId: zgradaB.id, entranceId: ulazB1.id, type: "BUSINESS", label: "Poslovni prostor 1", floor: 0, usableArea: "88.00", ownershipShare: "20.50", occupantCount: 0, typeCoefficient: "1.5" });
  const garaza1 = await property.createUnit(president, { buildingId: zgradaA.id, entranceId: null, type: "GARAGE", label: "Garaža 1", floor: -1, usableArea: "15.00", ownershipShare: "3.40", occupantCount: 0, typeCoefficient: "0.5" });
  const garaza2 = await property.createUnit(president, { buildingId: zgradaB.id, entranceId: null, type: "GARAGE", label: "Garaža 2", floor: -1, usableArea: "16.00", ownershipShare: "3.60", occupantCount: 0, typeCoefficient: "0.5" });
  // one more apartment for the president himself
  const stan5 = await property.createUnit(president, { buildingId: zgradaA.id, entranceId: ulazA1.id, type: "APARTMENT", label: "Stan 5", floor: 3, usableArea: "70.00", ownershipShare: "16.40", occupantCount: 2, typeCoefficient: "1" });

  await property.createCommonAsset(president, { buildingId: zgradaA.id, kind: "SYSTEM", name: "Lift — Zgrada A", description: "Kone, ugrađen 2005." });
  await property.createCommonAsset(president, { buildingId: null, kind: "AREA", name: "Zajedničko dvorište", description: "Parking i zelena površina" });
  await property.createCommonAsset(president, { buildingId: zgradaB.id, kind: "EQUIPMENT", name: "Hidrofor — Zgrada B", warrantyUntil: new Date(Date.UTC(year + 1, 5, 30)) });

  // --- Ownership (incl. co-owners, multi-unit owner), occupancy, proxy ------
  const past = new Date(Date.UTC(2019, 0, 1));
  await ownership.addOwnershipStake(president, { unitId: stan1.id, ownerId: ownerAna.id, sharePercent: "100", validFrom: past });
  await ownership.addOwnershipStake(president, { unitId: stan2.id, ownerId: ownerMarko.id, sharePercent: "100", validFrom: past });
  // co-ownership 60/40
  await ownership.addOwnershipStake(president, { unitId: stan3.id, ownerId: ownerNikola.id, sharePercent: "60", validFrom: past });
  await ownership.addOwnershipStake(president, { unitId: stan3.id, ownerId: ownerSara.id, sharePercent: "40", validFrom: past });
  await ownership.addOwnershipStake(president, { unitId: stan4.id, ownerId: ownerMarko.id, sharePercent: "100", validFrom: past }); // Marko owns two units
  await ownership.addOwnershipStake(president, { unitId: lokal1.id, ownerId: ownerFirma.id, sharePercent: "100", validFrom: past });
  await ownership.addOwnershipStake(president, { unitId: garaza1.id, ownerId: ownerAna.id, sharePercent: "100", validFrom: past });
  await ownership.addOwnershipStake(president, { unitId: garaza2.id, ownerId: presidentParty.id, sharePercent: "100", validFrom: past });
  await ownership.addOwnershipStake(president, { unitId: stan5.id, ownerId: presidentParty.id, sharePercent: "100", validFrom: past });

  await ownership.setOccupancy(president, { unitId: stan1.id, partyId: ownerAna.id, type: "OWNER_OCCUPANT", headcount: 3, validFrom: past });
  await ownership.setOccupancy(president, { unitId: stan4.id, partyId: tenantIvana.id, type: "TENANT", headcount: 1, validFrom: new Date(Date.UTC(year - 1, 8, 1)) });
  // stan2 is unoccupied — no occupancy record

  await ownership.grantProxy(president, {
    grantorId: ownerAna.id,
    holderId: proxyDragan.id,
    scope: "ALL",
    documentRef: "Ovjerena punomoć OPU-451/2026",
    validFrom: new Date(Date.UTC(year, 0, 10)),
  });

  await ownership.setOfficeTerm(president, { role: "PRESIDENT", partyId: presidentParty.id, validFrom: new Date(Date.UTC(2023, 3, 15)), decisionRef: "Odluka skupštine 02/2023" });
  await ownership.setOfficeTerm(president, { role: "ACCOUNTANT", partyId: accountantParty.id, validFrom: new Date(Date.UTC(2023, 3, 15)), decisionRef: "Ugovor o vođenju evidencija 05/2023" });

  // Upravni odbor: predsjednik (already tracked above via OfficeRole.PRESIDENT)
  // plus two elected members. See LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §Organi ZEV.
  await ownership.addBoardMember(president, { partyId: ownerMarko.id, validFrom: new Date(Date.UTC(2023, 3, 15)), decisionRef: "Odluka skupštine 02/2023" });
  await ownership.addBoardMember(president, { partyId: ownerNikola.id, validFrom: new Date(Date.UTC(2023, 3, 15)), decisionRef: "Odluka skupštine 02/2023" });
  await prisma.setting.createMany({
    data: [
      { key: "board.size", value: "3" },
      { key: "board.termYears", value: "4" },
      { key: "board.presidentIsBoardPresident", value: "true" },
    ],
  });

  // --- Money accounts -------------------------------------------------------
  const bankAcc = await finance.createAccount(accountant, {
    zevId: zev.id, type: "BANK", name: "Glavni račun — NLB banka", bankName: "NLB Banka a.d. Banja Luka",
    iban: "5620990000123456", openingBalance: "2450.00", openingDate: yearStart,
  });
  await finance.createAccount(accountant, {
    zevId: zev.id, type: "CASH", name: "Blagajna", openingBalance: "150.00", openingDate: yearStart,
  });

  // --- Charge items (different formulas) -------------------------------------
  await billing.createChargeItem(accountant, {
    name: "Redovno održavanje", method: "PER_AREA", rate: "0.30", scopeType: "ZEV",
    effectiveFrom: yearStart, frequency: "MONTHLY", dueDayOfMonth: 15, displayOrder: 1,
  });
  await billing.createChargeItem(accountant, {
    name: "Fond održavanja (rezerva)", method: "PER_OWNERSHIP_SHARE", rate: "0.80", scopeType: "ZEV",
    effectiveFrom: yearStart, frequency: "MONTHLY", displayOrder: 2, isReserveFund: true,
  });
  await billing.createChargeItem(accountant, {
    name: "Čišćenje zajedničkih prostorija", method: "FIXED_PER_UNIT", rate: "8.00", scopeType: "ZEV",
    effectiveFrom: yearStart, frequency: "MONTHLY", displayOrder: 3,
    overrides: [{ unitId: garaza1.id, exempt: true }, { unitId: garaza2.id, exempt: true }],
  });
  await billing.createChargeItem(accountant, {
    name: "Održavanje lifta — Zgrada A", method: "EQUAL_SPLIT", rate: "120.00", scopeType: "BUILDING", buildingId: zgradaA.id,
    effectiveFrom: yearStart, frequency: "MONTHLY", displayOrder: 4,
    overrides: [{ unitId: garaza1.id, exempt: true }],
  });
  await billing.createChargeItem(accountant, {
    name: "Struja zajedničkih prostorija", method: "PER_OCCUPANT", rate: "2.50", scopeType: "ZEV",
    effectiveFrom: yearStart, frequency: "MONTHLY", displayOrder: 5,
  });
  const ciVoda = await billing.createChargeItem(accountant, {
    name: "Zajednička voda (po očitanju)", method: "CONSUMPTION", rate: "1.95", scopeType: "BUILDING", buildingId: zgradaB.id,
    effectiveFrom: yearStart, frequency: "MONTHLY", displayOrder: 6,
  });
  await billing.enterMeterReading(accountant, { chargeItemId: ciVoda.id, unitId: stan4.id, period, quantity: "3.400" });
  await billing.enterMeterReading(accountant, { chargeItemId: ciVoda.id, unitId: lokal1.id, period, quantity: "8.200" });

  // --- Invoice batch: preview -> draft -> issue ------------------------------
  const { batch } = await billing.createDraftBatch(accountant, period);
  const invoices = await billing.issueBatch(accountant, batch.id);
  console.log(`Issued ${invoices.length} invoices for ${period}`);
  for (const inv of invoices) {
    await documents.generateInvoicePdf(accountant, inv.id);
  }

  // --- Payments: full, partial, overpayment, advance, csv-like ---------------
  const invAna = invoices.find((i) => i.debtorId === ownerAna.id && i.unitId === stan1.id)!;
  const invMarkoS2 = invoices.find((i) => i.debtorId === ownerMarko.id && i.unitId === stan2.id)!;
  const invMarkoS4 = invoices.find((i) => i.debtorId === ownerMarko.id && i.unitId === stan4.id)!;
  const invFirma = invoices.find((i) => i.debtorId === ownerFirma.id)!;

  // full payment (Ana, stan 1)
  const payAna = await payments.enterPayment(accountant, {
    accountId: bankAcc.id, date: new Date(), amount: invAna.total.toString(),
    payerId: ownerAna.id, payerNameRaw: "SAVIC ANA", reference: invAna.paymentReference ?? undefined,
  });
  await payments.allocatePayment(accountant, { paymentId: payAna.id, invoiceId: invAna.id, amount: invAna.total.toString() });

  // one payment covering two invoices + overpayment => advance (Marko)
  const markoTotal = Number(invMarkoS2.total) + Number(invMarkoS4.total) + 10;
  const payMarko = await payments.enterPayment(accountant, {
    accountId: bankAcc.id, date: new Date(), amount: markoTotal.toFixed(2),
    payerId: ownerMarko.id, payerNameRaw: "JOVANOVIC MARKO",
  });
  await payments.allocatePayment(accountant, { paymentId: payMarko.id, invoiceId: invMarkoS2.id, amount: invMarkoS2.total.toString() });
  await payments.allocatePayment(accountant, { paymentId: payMarko.id, invoiceId: invMarkoS4.id, amount: invMarkoS4.total.toString() });
  // remaining 10 KM stays UNAPPLIED as advance

  // partial payment (business premise)
  const payFirma = await payments.enterPayment(accountant, {
    accountId: bankAcc.id, date: new Date(), amount: (Number(invFirma.total) / 2).toFixed(2),
    payerId: ownerFirma.id, payerNameRaw: "APOTEKA ZDRAVLJE DOO",
  });
  await payments.allocatePayment(accountant, { paymentId: payFirma.id, invoiceId: invFirma.id, amount: (Number(invFirma.total) / 2).toFixed(2) });
  // Nikola/Sara (stan 3) remain unpaid -> receivables & reminder material

  // --- Suppliers & expenses ---------------------------------------------------
  const dobavljacLift = await expenses.createSupplier(accountant, { name: "Lift Servis d.o.o.", jib: "4401111110005", iban: "5551110000998877", email: "servis@liftservis.example" });
  const dobavljacCistoca = await expenses.createSupplier(accountant, { name: "Čistoća plus s.p.", jib: "4502222220003" });
  const dobavljacVodo = await expenses.createSupplier(accountant, { name: "Vodoinstalater Perić s.p.", jib: "4503333330001" });

  const expLift = await expenses.createExpense(accountant, {
    supplierId: dobavljacLift.id, invoiceNumber: `LS-${year}-081`, invoiceDate: new Date(),
    categoryId: (await finance.ensureCategory("Održavanje lifta", "EXPENSE")).id,
    amount: "120.00", dueDate: new Date(Date.now() + 20 * 86400000), buildingId: zgradaA.id,
    description: "Mjesečno održavanje lifta", recurring: true, recurrenceRule: "MONTHLY",
  });
  await expenses.payExpense(accountant, { expenseId: expLift.id, accountId: bankAcc.id, date: new Date() });

  await expenses.createExpense(accountant, {
    supplierId: dobavljacCistoca.id, invoiceNumber: `CP-${year}-330`, invoiceDate: new Date(),
    categoryId: (await finance.ensureCategory("Čišćenje", "EXPENSE")).id,
    amount: "160.00", dueDate: new Date(Date.now() + 10 * 86400000),
    description: "Čišćenje zajedničkih prostorija", recurring: true, recurrenceRule: "MONTHLY",
  }); // stays UNPAID

  // --- Annual plans -----------------------------------------------------------
  const planOdrz = await plans.createPlan(president, { year, kind: "MAINTENANCE", title: `Godišnji plan održavanja ${year}.` });
  await plans.addPlanItem(president, { planId: planOdrz.id, type: "RECURRING_EXPENSE", name: "Servis lifta — Zgrada A", plannedAmount: "1440.00", categoryName: "Održavanje lifta", buildingId: zgradaA.id, scopeType: "BUILDING" });
  const piKrov = await plans.addPlanItem(president, { planId: planOdrz.id, type: "MAINTENANCE_EXPENSE", name: "Sanacija krova — Zgrada B", plannedAmount: "4800.00", buildingId: zgradaB.id, scopeType: "BUILDING", month: 6 });
  await plans.addPlanItem(president, { planId: planOdrz.id, type: "INSPECTION", name: "Godišnji pregled protivpožarnih aparata", plannedAmount: "150.00", scheduledDate: new Date(Date.UTC(year, 10, 1)) });
  await plans.addPlanItem(president, { planId: planOdrz.id, type: "PREVENTIVE_MAINTENANCE", name: "Preventivni pregled hidrofora", plannedAmount: "80.00", scheduledDate: new Date(Date.UTC(year, 9, 15)), buildingId: zgradaB.id, scopeType: "BUILDING" });

  const planBudzet = await plans.createPlan(president, { year, kind: "BUDGET", title: `Godišnji finansijski plan ${year}.` });
  await plans.addPlanItem(president, { planId: planBudzet.id, type: "INCOME", name: "Naknade vlasnika (procjena)", plannedAmount: "9600.00" });
  await plans.addPlanItem(president, { planId: planBudzet.id, type: "RESERVE_ALLOCATION", name: "Izdvajanje u fond održavanja", plannedAmount: "960.00" });
  await plans.addPlanItem(president, { planId: planBudzet.id, type: "CONTINGENCY", name: "Rezerva za nepredviđene troškove", plannedAmount: "500.00" });

  // --- Voting rules -------------------------------------------------------------
  const ruleRegular = await meetings.createVotingRule(president, {
    name: "Redovno upravljanje (>50% udjela, prosta većina)",
    quorumType: "PERCENT_OF_TOTAL_WEIGHT", quorumPercent: "50",
    majorityType: "SIMPLE_OF_VOTES_CAST", weightMethod: "OWNERSHIP_SHARE",
  });
  await meetings.createVotingRule(president, {
    name: "Veći radovi (2/3 ukupne baze po udjelu)",
    quorumType: "PERCENT_OF_TOTAL_WEIGHT", quorumPercent: "66.67",
    majorityType: "PERCENT_OF_ELIGIBLE_WEIGHT", majorityPercent: "66.67",
    weightMethod: "OWNERSHIP_SHARE",
  });
  await meetings.createVotingRule(president, {
    name: "Po vlasniku (1 vlasnik = 1 glas)",
    quorumType: "PERCENT_OF_OWNER_COUNT", quorumPercent: "50",
    majorityType: "SIMPLE_OF_VOTES_CAST", weightMethod: "PER_OWNER",
  });

  // --- Meeting with proposals; one completed vote cycle --------------------------
  const meeting = await meetings.createMeeting(president, {
    title: `Redovna godišnja sjednica skupštine ${year}.`,
    type: "REGULAR",
    location: "Zajednička prostorija, Vojvode Mišića 10",
    scheduledAt: new Date(Date.now() + 7 * 86400000),
    eVoteOpensAt: new Date(Date.now() - 86400000),
    eVoteClosesAt: new Date(Date.now() + 14 * 86400000),
  });
  await meetings.addAgendaItem(president, { meetingId: meeting.id, title: "Usvajanje godišnjeg plana održavanja" });
  await meetings.addAgendaItem(president, { meetingId: meeting.id, title: "Sanacija krova Zgrade B" });
  await meetings.addAgendaItem(president, { meetingId: meeting.id, title: "Razno" });
  await meetings.advanceMeetingStatus(president, meeting.id, "SCHEDULED");

  const propPlan = await meetings.createProposal(president, {
    meetingId: meeting.id, code: `P-${year}-01`,
    title: `Usvajanje godišnjeg plana održavanja za ${year}.`,
    text: `Skupština ZEV usvaja godišnji plan održavanja za ${year}. godinu u ukupnom iznosu od 6.470,00 KM, prema prijedlogu u prilogu.`,
    rationale: "Plan pokriva redovno održavanje lifta, sanaciju krova Zgrade B i obavezne godišnje preglede.",
    financialImpact: "6470.00",
    scopeType: "ZEV",
    votingRuleId: ruleRegular.id,
    votingClosesAt: new Date(Date.now() + 14 * 86400000),
  });
  const propKrov = await meetings.createProposal(president, {
    meetingId: meeting.id, code: `P-${year}-02`,
    title: "Sanacija krova Zgrade B do 4.800 KM",
    text: "Odobrava se sanacija krova Zgrade B u iznosu do 4.800,00 KM iz sredstava fonda održavanja, uz izbor najpovoljnijeg izvođača.",
    rationale: "Prokišnjavanje prijavljeno u dva navrata tokom proljeća.",
    financialImpact: "4800.00",
    scopeType: "BUILDING",
    buildingId: zgradaB.id,
    votingRuleId: ruleRegular.id,
    votingClosesAt: new Date(Date.now() + 14 * 86400000),
  });
  // a draft proposal that stays draft
  await meetings.createProposal(president, {
    meetingId: meeting.id, code: `P-${year}-03`,
    title: "Nabavka video nadzora (nacrt)",
    text: "Odobrava se nabavka sistema video nadzora za zajedničke prostorije.",
    scopeType: "ZEV",
    votingRuleId: ruleRegular.id,
  });

  // Open voting on P-01: creates eligible base + hashed tokens + (mock) emails
  await meetings.advanceMeetingStatus(president, meeting.id, "INVITATIONS_PREPARED");
  await meetings.advanceMeetingStatus(president, meeting.id, "INVITATIONS_SENT");
  await meetings.advanceMeetingStatus(president, meeting.id, "VOTING_OPEN");
  await meetings.openVoting(president, propPlan.id);

  // One ELECTRONIC vote via a token with a known value (simulates the e-mail link)
  const evAnaProxy = await prisma.eligibleVoter.findFirstOrThrow({
    where: { proposalId: propPlan.id, ownerId: ownerAna.id },
  });
  const demoToken = generateToken();
  const demoCode = "123456";
  await prisma.approvalToken.updateMany({
    where: { eligibleVoterId: evAnaProxy.id, status: "ACTIVE" },
    data: { status: "SUPERSEDED", revokedAt: new Date(), revokedReason: "seed: replaced by demo token" },
  });
  await prisma.approvalToken.create({
    data: {
      eligibleVoterId: evAnaProxy.id,
      tokenHash: sha256(demoToken),
      verificationHash: sha256(demoCode),
      expiresAt: new Date(Date.now() + 14 * 86400000),
      deliveredVia: "EMAIL",
    },
  });
  const voteResult = await meetings.submitVote({
    tokenPlain: demoToken, verificationCode: demoCode, choice: "APPROVE",
  });
  if (!voteResult.ok) throw new Error(`Seed electronic vote failed: ${voteResult.error}`);

  // Paper/in-person votes for the rest
  const evs = await prisma.eligibleVoter.findMany({ where: { proposalId: propPlan.id }, include: { owner: true } });
  for (const ev of evs) {
    if (ev.ownerId === ownerAna.id) continue;
    const choice = ev.ownerId === ownerFirma.id ? "ABSTAIN" : "APPROVE";
    await meetings.recordManualVote(president, {
      eligibleVoterId: ev.id,
      choice: choice as never,
      channel: ev.ownerId === presidentParty.id ? "IN_PERSON" : "PAPER",
      note: "seed",
    });
  }
  const closed = await meetings.closeVoting(president, propPlan.id);
  console.log(`P-01 result: accepted=${closed.result.accepted}, quorum=${closed.result.quorumReached}`);
  await meetings.recordDecision(president, propPlan.id, `OD-${year}-01`);
  await documents.generateDecisionPdf(president, propPlan.id);
  await documents.generateVotingListPdf(president, propPlan.id);

  // Approve the maintenance plan based on the accepted decision
  await plans.proposePlan(president, planOdrz.id);
  await plans.approvePlan(president, planOdrz.id, propPlan.id);
  await documents.generatePlanPdf(president, planOdrz.id);

  // P-02 stays open for live voting in the demo
  await meetings.openVoting(president, propKrov.id);

  // Meeting documents
  await documents.generateMeetingInvitationPdf(president, meeting.id);
  await documents.generateMinutesPdf(president, meeting.id, { finalize: false });

  // --- Upravni odbor: voting rule + one sjednica left open for live demo -----
  const ruleBoard = await meetings.createVotingRule(president, {
    name: "Upravni odbor — prosta većina (1 član = 1 glas)",
    quorumType: "PERCENT_OF_OWNER_COUNT", quorumPercent: "50",
    majorityType: "SIMPLE_OF_VOTES_CAST", weightMethod: "PER_OWNER",
    note: "Kvorum/većina za odluke upravnog odbora — pretpostavka, vidi LEGAL_AND_FINANCIAL_ASSUMPTIONS.md.",
  });
  const boardMeeting = await meetings.createMeeting(president, {
    title: "Sjednica upravnog odbora br. 1",
    type: "REGULAR",
    body: "BOARD",
    location: "Kancelarija upravnika, Vojvode Mišića 10",
    scheduledAt: new Date(Date.now() + 3 * 86400000),
    eVoteOpensAt: new Date(Date.now() - 3600000),
    eVoteClosesAt: new Date(Date.now() + 10 * 86400000),
  });
  await meetings.addAgendaItem(president, { meetingId: boardMeeting.id, title: "Izbor izvođača za sanaciju krova Zgrade B" });
  await meetings.advanceMeetingStatus(president, boardMeeting.id, "SCHEDULED");
  const propIzvodjac = await meetings.createProposal(president, {
    meetingId: boardMeeting.id, code: `UO-${year}-01`,
    title: "Izbor izvođača za sanaciju krova Zgrade B",
    text: "Upravni odbor bira ponudu firme 'Krovoterm' d.o.o. kao najpovoljniju za sanaciju krova Zgrade B, u skladu sa odlukom skupštine P-" + year + "-02.",
    scopeType: "ZEV",
    votingRuleId: ruleBoard.id,
    votingClosesAt: new Date(Date.now() + 10 * 86400000),
  });
  await meetings.advanceMeetingStatus(president, boardMeeting.id, "INVITATIONS_PREPARED");
  await meetings.advanceMeetingStatus(president, boardMeeting.id, "INVITATIONS_SENT");
  await meetings.advanceMeetingStatus(president, boardMeeting.id, "VOTING_OPEN");
  await meetings.openVoting(president, propIzvodjac.id);
  // left open for live demo — links/codes visible in Podešavanja → Poslate poruke

  // --- Maintenance issues --------------------------------------------------------
  const anaActor: Actor = { userId: anaUser.id, roles: ["OWNER"], partyId: ownerAna.id };
  const issueRoof = await maintenance.reportIssue(anaActor, {
    title: "Prokišnjavanje krova — Zgrada B",
    description: "Poslije jakih padavina voda ulazi u hodnik trećeg sprata.",
    buildingId: zgradaB.id,
    locationNote: "hodnik, 3. sprat",
    category: "krov",
    urgency: "HIGH",
    safetyImpact: true,
  });
  await maintenance.transitionIssue(president, issueRoof.id, "TRIAGED", { note: "Pregledano na licu mjesta" });
  await maintenance.transitionIssue(president, issueRoof.id, "AUTHORIZATION_REQUIRED", { note: "Iznos zahtijeva odluku skupštine" });
  await maintenance.transitionIssue(president, issueRoof.id, "APPROVED", { approvalProposalId: propKrov.id, note: "Prijedlog P-02 na glasanju; uslovno odobreno planom" });
  await maintenance.transitionIssue(president, issueRoof.id, "OFFERS_REQUESTED", { note: "Zatražene 2 ponude" });
  await maintenance.addOffer(president, { issueId: issueRoof.id, supplierId: dobavljacVodo.id, amount: "5200.00", description: "Kompletna sanacija sa hidroizolacijom" });
  const offer2 = await maintenance.addOffer(president, { issueId: issueRoof.id, supplierId: dobavljacLift.id, amount: "4650.00", description: "Sanacija sa 5 godina garancije" });
  await maintenance.selectOffer(president, offer2.id, "Povoljnija ponuda uz dužu garanciju");
  const wo = await maintenance.createWorkOrder(president, {
    issueId: issueRoof.id, supplierId: dobavljacLift.id,
    description: "Sanacija krova Zgrade B prema ponudi br. 2",
    scheduledFrom: new Date(Date.now() + 10 * 86400000),
    scheduledTo: new Date(Date.now() + 17 * 86400000),
  });
  await documents.generateWorkOrderPdf(president, wo.id);
  await expenses.createExpense(accountant, {
    supplierId: dobavljacLift.id, invoiceNumber: `LS-${year}-095`, invoiceDate: new Date(),
    categoryId: (await finance.ensureCategory("Sanacije", "EXPENSE")).id,
    amount: "4650.00", dueDate: new Date(Date.now() + 30 * 86400000),
    buildingId: zgradaB.id, maintenanceIssueId: issueRoof.id, planItemId: piKrov.id,
    description: "Sanacija krova — Zgrada B (avansna situacija)",
  });

  // an emergency issue, closed
  const issueBurst = await maintenance.reportIssue(anaActor, {
    title: "Pucanje cijevi u podrumu — Zgrada A",
    description: "Voda ističe u podrumu, potrebna hitna intervencija.",
    buildingId: zgradaA.id,
    category: "vodovod",
    urgency: "EMERGENCY",
    safetyImpact: true,
  });
  await maintenance.markEmergency(president, issueBurst.id, {
    reason: "Izlivanje vode ugrožava elektro instalacije",
    authorizedBy: "Milan Petrović (predsjednik)",
    authority: "Ovlašćenje za hitne intervencije do 500 KM (odluka skupštine 02/2023)",
    estimatedCost: "180.00",
  });
  await maintenance.ratifyEmergency(president, issueBurst.id, `Zapisnik ${year}-01, tačka Razno`);
  const expBurst = await expenses.createExpense(accountant, {
    supplierId: dobavljacVodo.id, invoiceNumber: `VP-${year}-12`, invoiceDate: new Date(),
    categoryId: (await finance.ensureCategory("Hitne intervencije", "EXPENSE")).id,
    amount: "175.00", buildingId: zgradaA.id, maintenanceIssueId: issueBurst.id,
    description: "Hitna zamjena pukle cijevi",
  });
  await expenses.payExpense(accountant, { expenseId: expBurst.id, accountId: bankAcc.id, date: new Date() });
  for (const st of ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "VERIFIED", "INVOICED", "PAID", "CLOSED"] as const) {
    await maintenance.transitionIssue(president, issueBurst.id, st, { note: "seed" });
  }

  // Viber subscribers (opt-in demo)
  await prisma.viberSubscriber.create({ data: { partyId: ownerMarko.id, viberId: "viber-sub-marko-001", optIn: true, optInAt: new Date() } });
  await prisma.viberSubscriber.create({ data: { partyId: ownerAna.id, viberId: "viber-sub-ana-002", optIn: false, optOutAt: new Date() } });

  console.log("\n=== DEMO NALOZI (lozinka za sve: " + PASSWORD + ") ===");
  console.log("Predsjednik:  predsjednik@zev.ba");
  console.log("Računovođa:   racunovodja@zev.ba");
  console.log("Vlasnik:      vlasnik@zev.ba (Ana Savić)");
  console.log("Vlasnik:      marko@zev.ba (Marko Jovanović)");
  console.log("Vlasnik:      nikola@zev.ba (Nikola Ilić, suvlasnik 60%)");
  console.log(`\nOtvoren prijedlog za glasanje: P-${year}-02 (linkovi u Podešavanja → Poslate poruke)`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
