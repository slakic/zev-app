import Link from "next/link";
import { requireActor, isManagement } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { prisma } from "@/lib/prisma";
import { totalCash, reserveFundBalance } from "@/server/services/finance";
import { receivablesReport, unpaidSupplierInvoices } from "@/server/services/reports";
import { ownerBalance, ownerAdvance } from "@/server/services/payments";
import { formatMoney, formatWeight, dec, ZERO } from "@/lib/money";
import { formatDate, formatDateTime, tEnum, t, tf } from "@/lib/i18n";
import { ownerTasks, type OwnerTask, type OwnerTaskVoting } from "@/lib/ownerTasks";
import { presidentTasks, PLAN_ITEM_LOOKBACK_DAYS } from "@/lib/presidentTasks";
import { mergeTasks, type HomeTask } from "@/lib/accountantTasks";
import { getAccountantTasks } from "@/server/services/accountantHome";
import { paymentWhereForFilter, PAYMENT_FILTER_TO_MATCH } from "@/server/services/payments";
import { meetingNextStep } from "@/lib/meetingNextStep";
import { calendarDaysBetween } from "@/lib/paymentInstructions";
import { isOneForm } from "@/lib/plural";
import { partyDisplayName } from "@/server/services/ownership";
import { Card, Stat, StatusBadge, PageHeader, Flash, BtnLink, RowLink, TaskList, type TaskRowData } from "@/components/ui";
import { getZev } from "@/server/services/property";
import { computeProposalResult, getMeetingNextStepInput } from "@/server/services/meetings";
import type { IssueStatus } from "@/generated/prisma/client";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireActor();
  const { err } = await searchParams;
  const flash = err === "forbidden" ? <Flash err="Nemate pravo pristupa toj stranici." /> : null;
  // F6.5: the president gets "Za Vas sada" before the balance (merged with the accountant's list when he is both, F5-Q2);
  // F5a: the accountant-only user gets his own "Za Vas sada".
  if (actor.roles.includes("PRESIDENT")) {
    return <>{flash}<PresidentDashboard actor={actor} /></>;
  }
  if (isManagement(actor)) {
    return <>{flash}<AccountantDashboard actor={actor} /></>;
  }
  return <>{flash}<OwnerDashboard actor={actor} /></>;
}

/** Početna računovođe (F5a, odluka D1 A): „Za Vas sada” prije salda; broj uz svaku stavku je isti kao na odredištu. */
async function AccountantDashboard({ actor }: { actor: Awaited<ReturnType<typeof requireActor>> }) {
  const zevId = requireZev(actor);
  const now = new Date();
  const [cash, receivables, supplierUnpaid, taskResult, lastPayments, lastBatches] = await Promise.all([
    totalCash(actor),
    receivablesReport(actor),
    unpaidSupplierInvoices(actor),
    getAccountantTasks(actor, now),
    prisma.payment.findMany({ where: { zevId, reversedAt: null }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 5, include: { payer: true } }),
    prisma.invoiceBatch.findMany({ where: { zevId }, orderBy: { createdAt: "desc" }, take: 3, include: { _count: { select: { invoices: true } } } }),
  ]);
  const supplierUnpaidTotal = supplierUnpaid.reduce((a, e) => a + Number(e.amount) - Number(e.paidAmount), 0);

  return (
    <div>
      <PageHeader title={t("accountantHome.title")} subtitle={`Stanje na dan ${formatDate(now)}`} />
      <TaskList
        title={t("accountantHome.forNow")}
        rows={taskResult.tasks.map(homeTaskRow)}
        empty={taskResult.allClear ? { text: t("accountantHome.empty") } : undefined}
        doneNote={taskResult.restDone ? t("accountantHome.restDone") : undefined}
      />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("accountantHome.stats.cash")} value={formatMoney(cash)} tone="ok" />
        <Stat label={t("accountantHome.stats.receivables")} value={formatMoney(receivables.totalOpen)} tone="neutral" />
        <Stat label={t("accountantHome.stats.overdue")} value={formatMoney(receivables.totalOverdue)} tone={Number(receivables.totalOverdue) > 0 ? "bad" : "ok"} />
        <Stat label={t("accountantHome.stats.suppliers")} value={formatMoney(supplierUnpaidTotal.toFixed(2))} tone={supplierUnpaidTotal > 0 ? "warn" : "ok"} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("accountantHome.lastPayments.title")}>
          {lastPayments.length === 0 && <p className="text-sm text-slate-600">{t("accountantHome.lastPayments.empty")}</p>}
          <ul className="space-y-2">
            {lastPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <RowLink href={`/fakture/uplate/${p.id}`}>
                  {p.payer ? partyDisplayName(p.payer) : p.payerNameRaw ?? t("accountantHome.lastPayments.unknownPayer")} — {formatDate(p.date)}
                </RowLink>
                <span className="tabular-nums">{formatMoney(p.amount.toString())}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3"><BtnLink href="/fakture/uplate" variant="secondary">{t("accountantHome.lastPayments.all")}</BtnLink></div>
        </Card>
        <Card title={t("accountantHome.batches.title")}>
          {lastBatches.length === 0 && <p className="text-sm text-slate-600">{t("accountantHome.batches.empty")}</p>}
          <ul className="space-y-2">
            {lastBatches.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                <RowLink href={`/fakture/serija/${b.id}`}>{b.period}</RowLink>
                <span className="flex items-center gap-2">
                  <span className="text-[13px] text-slate-600">{b._count.invoices} faktura</span>
                  <StatusBadge status={b.status} label={b.status === "DRAFT" ? "Nacrt" : b.status === "ISSUED" ? "Izdata" : "Stornirana"} />
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3"><BtnLink href="/fakture?tab=naknade" variant="secondary">{t("accountantHome.batches.all")}</BtnLink></div>
        </Card>
      </div>
    </div>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Issues from "Odobreno" until they are paid: a decision still missing for them is worth a line (F6.4). */
const ISSUE_STATUSES_IN_EXECUTION: IssueStatus[] = [
  "APPROVED", "OFFERS_REQUESTED", "CONTRACTOR_SELECTED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "VERIFIED", "INVOICED",
];

/** Početna predsjednika (F6.5, odluka D1 A): "Za Vas sada" prvo, tek onda saldo. */
async function PresidentDashboard({ actor }: { actor: Awaited<ReturnType<typeof requireActor>> }) {
  const zevId = requireZev(actor);
  const now = new Date();
  const horizon30 = new Date(now.getTime() + 30 * DAY_MS);
  const lookback = new Date(now.getTime() - (PLAN_ITEM_LOOKBACK_DAYS + 1) * DAY_MS);
  const alsoAccountant = actor.roles.includes("ACCOUNTANT");
  const planItemBase = { zevId, type: { in: ["INSPECTION" as const, "PREVENTIVE_MAINTENANCE" as const] }, plan: { status: "APPROVED" as const } };

  const [cash, receivables, supplierUnpaid, fund, zev, openProposals, meetings30, upcomingItems, passedItems, executionIssues, reportedIssues, openIssues, unmatchedPayments, accountantResult] = await Promise.all([
    totalCash(actor),
    receivablesReport(actor),
    unpaidSupplierInvoices(actor),
    reserveFundBalance(actor),
    getZev(actor),
    prisma.proposal.findMany({
      where: { zevId, status: "VOTING_OPEN" },
      orderBy: [{ votingClosesAt: "asc" }, { code: "asc" }],
      take: 5,
      include: { meeting: { select: { id: true, title: true } } },
    }),
    prisma.meeting.findMany({
      where: { zevId, status: { notIn: ["MINUTES_FINALIZED", "ARCHIVED"] }, scheduledAt: { gte: new Date(now.getTime() - DAY_MS), lte: horizon30 } },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: 20,
    }),
    prisma.planItem.findMany({
      where: { ...planItemBase, scheduledDate: { gte: new Date(now.getTime() - DAY_MS), lte: horizon30 } },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
      take: 20,
    }),
    prisma.planItem.findMany({
      where: { ...planItemBase, scheduledDate: { gte: lookback, lt: now } },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
      take: 50,
    }),
    prisma.maintenanceIssue.findMany({
      where: { zevId, approvalProposalId: { not: null }, status: { in: ISSUE_STATUSES_IN_EXECUTION } },
      select: { id: true, title: true, status: true, approvalProposalId: true },
      take: 50,
    }),
    prisma.maintenanceIssue.count({ where: { zevId, status: "REPORTED" } }),
    prisma.maintenanceIssue.findMany({ where: { zevId, status: { notIn: ["CLOSED", "REJECTED", "PAID"] } }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, title: true, status: true } }),
    alsoAccountant
      ? prisma.payment.findMany({ where: paymentWhereForFilter(zevId, PAYMENT_FILTER_TO_MATCH), take: 6 })
      : Promise.resolve([]),
    alsoAccountant ? getAccountantTasks(actor, now) : Promise.resolve(null),
  ]);
  const supplierUnpaidTotal = supplierUnpaid.reduce((a, e) => a + Number(e.amount) - Number(e.paidAmount), 0);

  // Open votes: result (quorum, votes cast) from the one engine, at most 5 as before.
  const votings = await Promise.all(
    openProposals.map(async (p) => {
      const r = await computeProposalResult(zevId, p.id);
      return {
        proposalId: p.id, code: p.code, title: p.title, meetingId: p.meeting.id, meetingTitle: p.meeting.title,
        closesAt: p.votingClosesAt, voted: r.votesCast, voters: r.totalEligibleOwners, quorumReached: r.quorumReached,
        quorumNeeded: r.quorumRequiredOwners !== null ? String(r.quorumRequiredOwners) : r.quorumRequiredWeight ? formatWeight(r.quorumRequiredWeight) : null,
      };
    })
  );

  // Meetings in the next 7 days: the next step comes from the same model as the panel on the meeting page.
  const soonMeetings = (
    await Promise.all(
      meetings30
        .filter((m) => m.scheduledAt && calendarDaysBetween(now, m.scheduledAt) >= 0 && calendarDaysBetween(now, m.scheduledAt) <= 7)
        .map(async (m) => {
          const step = meetingNextStep((await getMeetingNextStepInput(actor, m.id, now)).input);
          return step && m.scheduledAt
            ? { id: m.id, title: m.title, scheduledAt: m.scheduledAt, nextStepLabel: step.label, warnings: step.preconditions.filter((p) => !p.ok).map((p) => p.text) }
            : null;
        })
    )
  ).filter((m): m is NonNullable<typeof m> => m !== null);

  // Execution before the decision (F6.4): the linked proposal is not adopted yet.
  const linkedProposals = executionIssues.length
    ? await prisma.proposal.findMany({ where: { zevId, id: { in: executionIssues.map((i) => i.approvalProposalId!) } }, select: { id: true, code: true, status: true } })
    : [];
  const proposalById = new Map(linkedProposals.map((p) => [p.id, p]));
  const issuesBeforeDecision = executionIssues.flatMap((i) => {
    const p = proposalById.get(i.approvalProposalId!);
    return p && p.status !== "ACCEPTED" ? [{ id: i.id, title: i.title, status: i.status, proposalCode: p.code }] : [];
  });

  // Inspections whose date passed and for which no maintenance issue was recorded (F6-Q2 (a), no migration).
  const linkedItemIds = passedItems.length
    ? new Set((await prisma.maintenanceIssue.findMany({ where: { zevId, planItemId: { in: passedItems.map((i) => i.id) } }, select: { planItemId: true } })).map((i) => i.planItemId))
    : new Set<string | null>();
  const planItemsPassed = passedItems
    .filter((i) => i.scheduledDate && !linkedItemIds.has(i.id))
    .map((i) => ({ id: i.id, planId: i.planId, name: i.name, scheduledDate: i.scheduledDate! }));

  const presidentResult = presidentTasks({
    now,
    registerStatus: zev?.unitRegisterStatus ?? null,
    votings,
    meetings: soonMeetings,
    issuesBeforeDecision,
    planItemsPassed,
    reportedIssues,
  });
  // F5-Q2 (a): predsjednik + računovođa ima jednu rangiranu listu (predsjednikove stavke 1–3, računovođine, ostale).
  const tasks: HomeTask[] = accountantResult ? mergeTasks(presidentResult.tasks, accountantResult.tasks) : presidentResult.tasks;
  const allClear = tasks.every((task) => task.actionLabel === undefined);

  // "Narednih 30 dana": meetings and planned inspections, chronologically.
  type Upcoming = { key: string; at: Date; href: string; title: string; kind: string };
  const upcoming: Upcoming[] = [
    ...meetings30.flatMap((m): Upcoming[] => (m.scheduledAt && calendarDaysBetween(now, m.scheduledAt) >= 0 ? [{ key: `m:${m.id}`, at: m.scheduledAt, href: `/skupstina/${m.id}`, title: m.title, kind: t("presidentHome.next30.meeting") }] : [])),
    ...upcomingItems.flatMap((i): Upcoming[] => (i.scheduledDate && calendarDaysBetween(now, i.scheduledDate) >= 0 ? [{ key: `p:${i.id}`, at: i.scheduledDate, href: `/planovi/${i.planId}`, title: i.name, kind: tEnum("presidentHome.next30", i.type) }] : [])),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));

  return (
    <div>
      <PageHeader title={t("presidentHome.title")} subtitle={`Stanje na dan ${formatDate(now)}`} />
      <TaskList
        title={t("presidentHome.forNow")}
        rows={tasks.map(homeTaskRow)}
        empty={
          allClear
            ? { text: t("presidentHome.empty"), meta: upcoming[0] ? tf("presidentHome.nextEvent", { naslov: upcoming[0].title, datum: formatDate(upcoming[0].at) }) : null }
            : undefined
        }
        doneNote={accountantResult?.restDone ? t("accountantHome.restDone") : undefined}
      />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("presidentHome.stats.cash")} value={formatMoney(cash)} tone="ok" />
        <Stat label={t("presidentHome.stats.overdue")} value={formatMoney(receivables.totalOverdue)} tone={Number(receivables.totalOverdue) > 0 ? "bad" : "ok"} />
        <Stat label={t("presidentHome.stats.suppliers")} value={formatMoney(supplierUnpaidTotal.toFixed(2))} tone={supplierUnpaidTotal > 0 ? "warn" : "ok"} />
        <Stat label={t("presidentHome.stats.fund")} value={formatMoney(fund.balance)} tone="neutral" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("presidentHome.next30.title")}>
          {upcoming.length === 0 && <p className="text-sm text-slate-600">{t("presidentHome.next30.empty")}</p>}
          <ul className="space-y-2">
            {upcoming.map((u) => (
              <li key={u.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <RowLink href={u.href}>{u.title}</RowLink>
                  <span className="ml-2 text-[13px] text-slate-600">{u.kind}</span>
                </span>
                <span className="shrink-0 text-[13px] text-slate-600">{formatDateTime(u.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t("presidentHome.votes.title")}>
          {votings.length === 0 && <p className="text-sm text-slate-600">{t("presidentHome.votes.empty")}</p>}
          <ul className="space-y-2">
            {votings.map((v) => (
              <li key={v.proposalId} className="flex items-center justify-between gap-2 text-sm">
                <RowLink href={`/skupstina/prijedlog/${v.proposalId}`}>{v.code} — {v.title}</RowLink>
                <span className="shrink-0 text-[13px] text-slate-600">{tf("presidentHome.votes.voted", { glasalo: v.voted, ukupno: v.voters })}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t("presidentHome.issues.title")}>
          {openIssues.length === 0 && <p className="text-sm text-slate-600">{t("presidentHome.issues.empty")}</p>}
          <ul className="space-y-2">
            {openIssues.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                <RowLink href={`/odrzavanje/${i.id}`}>{i.title}</RowLink>
                <StatusBadge status={i.status} label={tEnum("issueStatus", i.status)} />
              </li>
            ))}
          </ul>
        </Card>
        {alsoAccountant && (
          <Card title={t("presidentHome.payments.title")}>
            {unmatchedPayments.length === 0 && <p className="text-sm text-slate-600">{t("presidentHome.payments.empty")}</p>}
            <ul className="space-y-2">
              {unmatchedPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <RowLink href={`/fakture/uplate/${p.id}`}>{p.payerNameRaw ?? t("presidentHome.payments.unknownPayer")} — {formatDate(p.date)}</RowLink>
                  <span className="tabular-nums">{formatMoney(p.amount.toString())}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

async function OwnerDashboard({ actor }: { actor: Awaited<ReturnType<typeof requireActor>> }) {
  const partyId = actor.partyId;
  if (!partyId) {
    return <p className="text-slate-500">Vaš nalog nije povezan sa evidencijom vlasnika. Obratite se predsjedniku ZEV.</p>;
  }
  const zevId = requireZev(actor);
  const now = new Date();
  const [balance, advance] = await Promise.all([
    ownerBalance(actor, partyId),
    ownerAdvance(actor, partyId),
  ]);
  // invoice/payment/eligibleVoter/maintenanceIssue queries below are filtered by
  // partyId, which is itself tenant-unique (a Party belongs to exactly one Zev, and
  // actor.partyId above is now resolveActiveContext's per-tenant resolution — see
  // Plans/party-per-tenant-plan.md §4, not a stale global User.partyId), so they can't
  // cross tenants even without an explicit zevId — meeting/document below have no such
  // implicit scoping and did need the fix (see ManagementDashboard above).
  const [unpaid, recentPayments, openVoting, boardTerm, party, decisions, myIssues] = await Promise.all([
    prisma.invoice.findMany({ where: { debtorId: partyId, status: "ISSUED" }, include: { allocations: true, unit: true }, orderBy: { dueDate: "asc" } }),
    prisma.payment.findMany({ where: { payerId: partyId, reversedAt: null }, orderBy: { date: "desc" }, take: 5 }),
    prisma.eligibleVoter.findMany({
      where: { OR: [{ ownerId: partyId }, { proxyId: partyId }, { memberPartyIds: { has: partyId } }], proposal: { status: "VOTING_OPEN" } },
      include: { proposal: true, owner: true, votes: { where: { invalid: false } }, tokens: { where: { status: "ACTIVE" }, select: { id: true } } },
    }),
    // V-N18: sjednice upravnog odbora vide samo aktivni članovi odbora (ili predsjednik).
    prisma.officeTerm.findFirst({
      where: { zevId, partyId, role: { in: ["BOARD_MEMBER", "PRESIDENT"] }, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
      select: { id: true },
    }),
    prisma.party.findUnique({ where: { id: partyId, zevId }, select: { eVoteConsentStatus: true } }),
    prisma.document.findMany({ where: { zevId, type: "DECISION", publishedToOwners: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.maintenanceIssue.findMany({ where: { reporterId: partyId }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const isBoard = Boolean(boardTerm);
  const [meetings, ballots] = await Promise.all([
    prisma.meeting.findMany({
      where: { zevId, ...(isBoard ? {} : { body: "ASSEMBLY" as const }), status: { in: ["SCHEDULED", "INVITATIONS_SENT", "VOTING_OPEN"] } },
      orderBy: { scheduledAt: "asc" }, take: 5,
    }),
    openVoting.length
      ? prisma.ballot.findMany({
          where: { zevId, recipientPartyId: partyId, status: "ACTIVE", meetingId: { in: [...new Set(openVoting.map((ev) => ev.proposal.meetingId))] } },
          select: { meetingId: true },
        })
      : Promise.resolve([] as { meetingId: string }[]),
  ]);

  // "Za Vas sada" (F3.4): iste podatke koje stranica ionako učitava, rangirane čistom funkcijom.
  const unpaidOpen = unpaid
    .map((inv) => ({
      id: inv.id,
      number: inv.number,
      unitLabel: inv.unit.label,
      dueDate: inv.dueDate,
      remainingDec: dec(inv.total.toString()).minus(inv.allocations.reduce((a, x) => a.plus(dec(x.amount.toString())), ZERO)),
    }))
    .filter((i) => i.remainingDec.greaterThan(ZERO));
  const ballotMeetings = new Set(ballots.map((b) => b.meetingId));
  const votings: OwnerTaskVoting[] = openVoting.map((ev) => {
    const canVote = ev.ownerId === partyId || ev.proxyId === partyId;
    const units = ((ev.basis as { units?: { label: string }[] } | null)?.units ?? []).map((u) => u.label).join(", ");
    return {
      proposalId: ev.proposalId,
      code: ev.proposal.code,
      title: ev.proposal.title,
      closesAt: ev.proposal.votingClosesAt,
      canVote,
      voted: ev.votes.length > 0,
      representative: !canVote && ev.memberPartyIds.includes(partyId) ? { name: partyDisplayName(ev.owner), units } : null,
      linkSent: ballotMeetings.has(ev.proposal.meetingId) || ev.tokens.length > 0,
    };
  });
  const { tasks, allClear, unpaidLater } = ownerTasks({
    now,
    invoices: unpaidOpen.map((i) => ({ id: i.id, number: i.number, unitLabel: i.unitLabel, dueDate: i.dueDate, remaining: i.remainingDec.toFixed(2) })),
    votings,
    eVoteConsentStatus: party?.eVoteConsentStatus ?? "NONE",
  });
  const lastPayment = recentPayments[0];

  return (
    <div>
      <PageHeader title="Moj pregled" subtitle={actor.displayName} />
      <TaskList
        title={t("ownerHome.title")}
        rows={tasks.map(ownerTaskRow)}
        empty={
          allClear
            ? {
                text: t(unpaidLater ? "ownerHome.empty.nothingSoon" : "ownerHome.empty.allPaid"),
                meta: lastPayment ? tf("ownerHome.empty.lastPayment", { datum: formatDate(lastPayment.date), iznos: formatMoney(lastPayment.amount.toString()) }) : null,
              }
            : undefined
        }
      />
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Stat label={t("ownerHome.stats.owed")} value={formatMoney(balance.balance)} tone={Number(balance.balance) > 0 ? "warn" : "ok"} />
        <Stat label={t("ownerHome.stats.advance")} value={formatMoney(advance)} tone="neutral" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Moje nedavne uplate">
          {recentPayments.length === 0 && <p className="text-sm text-slate-500">Nema evidentiranih uplata.</p>}
          <ul className="space-y-2">
            {recentPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span>{formatDate(p.date)}</span>
                <span className="tabular-nums">{formatMoney(p.amount.toString())}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Predstojeće sjednice">
          <ul className="space-y-2">
            {meetings.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <Link className="text-blue-700 hover:underline" href={`/skupstina/${m.id}`}>{m.title}</Link>
                  {isBoard && <span className="ml-2 text-[13px] text-slate-500">{tEnum("ownerHome.body", m.body)}</span>}
                </span>
                <span className="text-[13px] text-slate-500">{formatDateTime(m.scheduledAt)}</span>
              </li>
            ))}
            {meetings.length === 0 && <p className="text-sm text-slate-500">Nema zakazanih sjednica.</p>}
          </ul>
        </Card>
        <Card title="Objavljene odluke">
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={d.id} className="text-sm">
                <a className="text-blue-700 hover:underline" href={`/api/dokumenti/${d.id}`}>{d.title}</a>
              </li>
            ))}
            {decisions.length === 0 && <p className="text-sm text-slate-500">Nema objavljenih odluka.</p>}
          </ul>
        </Card>
        <Card title="Moje prijave održavanja">
          <ul className="space-y-2">
            {myIssues.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                <Link className="text-blue-700 hover:underline" href={`/odrzavanje/${i.id}`}>{i.title}</Link>
                <StatusBadge status={i.status} label={tEnum("issueStatus", i.status)} />
              </li>
            ))}
            {myIssues.length === 0 && <p className="text-sm text-slate-500">Nemate prijava.</p>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

type TaskVariant = "primary" | "secondary" | "tonal";

/** Red „Za Vas sada” iz zajedničkog oblika stavki predsjednika/računovođe (`HomeTask`); bez `actionLabel` je informativan. */
function homeTaskRow(task: HomeTask): TaskRowData {
  return {
    key: task.key,
    chip: task.chip,
    text: task.sentence,
    meta: task.meta,
    count: task.count,
    action: task.actionLabel ? { href: task.href, label: task.actionLabel, variant: task.primary ? "primary" : "secondary" } : null,
  };
}

function ownerTaskRow(task: OwnerTask): TaskRowData {
  const row = ownerTaskRowData(task);
  return { ...row, key: task.key };
}

function ownerTaskRowData(task: OwnerTask): TaskRowData {
  const variant: TaskVariant = task.primary ? "primary" : "secondary";
  switch (task.kind) {
    case "overdue": {
      const i = task.invoice;
      return {
        chip: { status: "UNPAID", label: t("ownerHome.overdue.badge") },
        text: tf("ownerHome.overdue.text", {
          broj: i.number, jedinica: i.unitLabel, iznos: formatMoney(i.remaining), datum: formatDate(i.dueDate),
          kada: tf(isOneForm(task.overdueDays) ? "pay.daysAgo.one" : "pay.daysAgo.other", { dana: task.overdueDays }),
        }),
        action: { href: `/fakture/${i.id}`, label: t("ownerHome.pay"), variant },
      };
    }
    case "dueSoon": {
      const i = task.invoice;
      return {
        chip: { status: "ISSUED", label: t("ownerHome.dueSoon.badge") },
        text: tf("ownerHome.dueSoon.text", { broj: i.number, jedinica: i.unitLabel, iznos: formatMoney(i.remaining), datum: formatDate(i.dueDate) }),
        action: { href: `/fakture/${i.id}`, label: t("ownerHome.pay"), variant },
      };
    }
    case "voting": {
      const v = task.voting;
      return {
        chip: { status: "VOTING_OPEN", label: t("ownerHome.voting.badge") },
        text: tf("ownerHome.voting.text", { sifra: v.code, naslov: v.title }),
        meta: [v.closesAt ? tf("ownerHome.voting.deadline", { datum: formatDate(v.closesAt) }) : null, v.linkSent ? t("ownerHome.voting.linkSent") : null]
          .filter(Boolean).join(" · ") || null,
        action: { href: `/skupstina/prijedlog/${v.proposalId}`, label: t("ownerHome.voting.view"), variant },
      };
    }
    case "evoteConsent":
      return {
        chip: { status: "NONE", label: t("ownerHome.consent.badge") },
        text: t("ownerHome.consent.text"),
        action: { href: "/podesavanja", label: t("ownerHome.consent.button"), variant: "tonal" },
      };
    case "viaRepresentative": {
      const v = task.voting;
      return {
        chip: { status: "NONE", label: t("ownerHome.representative.badge") },
        text: tf("votingSubject.owner.viaRepresentative", { units: v.representative?.units ?? "", name: v.representative?.name ?? "" }),
        meta: `${v.code} — ${v.title}`,
      };
    }
  }
}
