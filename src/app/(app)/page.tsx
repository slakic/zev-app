import type { ReactNode } from "react";
import Link from "next/link";
import { requireActor, isManagement } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { prisma } from "@/lib/prisma";
import { totalCash, reserveFundBalance } from "@/server/services/finance";
import { receivablesReport, unpaidSupplierInvoices } from "@/server/services/reports";
import { ownerBalance, ownerAdvance } from "@/server/services/payments";
import { planVsActual } from "@/server/services/plans";
import { formatMoney, dec, ZERO } from "@/lib/money";
import { formatDate, formatDateTime, tEnum, t, tf } from "@/lib/i18n";
import { ownerTasks, type OwnerTask, type OwnerTaskVoting } from "@/lib/ownerTasks";
import { isOneForm } from "@/lib/plural";
import { partyDisplayName } from "@/server/services/ownership";
import { IconCheck } from "@/components/nav-icons";
import { Card, Stat, StatusBadge, PageHeader, Flash, BtnLink } from "@/components/ui";
import { getZev } from "@/server/services/property";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireActor();
  const { err } = await searchParams;
  const flash = err === "forbidden" ? <Flash err="Nemate pravo pristupa toj stranici." /> : null;
  if (isManagement(actor)) {
    return <>{flash}<ManagementDashboard actorRoles={actor.roles} actor={actor} /></>;
  }
  return <>{flash}<OwnerDashboard actor={actor} /></>;
}

async function ManagementDashboard({ actor, actorRoles }: { actor: Awaited<ReturnType<typeof requireActor>>; actorRoles: string[] }) {
  const isPresident = actorRoles.includes("PRESIDENT");
  const zevId = requireZev(actor);
  const [cash, receivables, supplierUnpaid, fund] = await Promise.all([
    totalCash(actor),
    receivablesReport(actor),
    unpaidSupplierInvoices(actor),
    reserveFundBalance(actor),
  ]);
  // FR-Q4: until the unit register is established ("Nacrt" / "Za provjeru") the president has one thing to do first.
  const registerStatus = isPresident ? (await getZev(actor))?.unitRegisterStatus : undefined;
  const supplierUnpaidTotal = supplierUnpaid.reduce((a, e) => a + Number(e.amount) - Number(e.paidAmount), 0);

  // BUG FIXED HERE (2026-09-09, discovered while building the second real tenant):
  // every query below was missing its zevId filter — invisible with one tenant, but
  // with two it means this dashboard silently mixes in another tenant's meetings,
  // votes, maintenance issues, draft invoice batches and unmatched payments. See
  // docs/multitenancy-plan.md, Faza 1 "Napredak" addendum.
  const [upcomingMeetings, openProposals, openIssues, draftBatches, unmatchedPayments] = await Promise.all([
    prisma.meeting.findMany({ where: { zevId, status: { in: ["SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT", "VOTING_OPEN"] } }, orderBy: { scheduledAt: "asc" }, take: 5 }),
    prisma.proposal.findMany({ where: { zevId, status: "VOTING_OPEN" }, include: { eligibleVoters: { include: { votes: true } } }, take: 5 }),
    prisma.maintenanceIssue.findMany({ where: { zevId, status: { notIn: ["CLOSED", "REJECTED", "PAID"] } }, orderBy: { createdAt: "desc" }, take: 6, include: { reporter: true } }),
    prisma.invoiceBatch.findMany({ where: { zevId, status: "DRAFT" }, take: 3 }),
    prisma.payment.findMany({ where: { zevId, status: { in: ["UNAPPLIED", "PARTIALLY_APPLIED"] }, reversedAt: null }, take: 6 }),
  ]);

  // The most severe instance of the same bug: an unscoped findFirst() picking "the
  // first approved plan in the whole database" — a president in tenant A could get
  // tenant B's plan id fed into planVsActual(), which correctly rejects it as
  // "not found" for the wrong zevId, crashing the dashboard on login.
  const approvedPlan = await prisma.annualPlan.findFirst({ where: { zevId, status: "APPROVED", year: new Date().getFullYear() }, orderBy: { version: "desc" } });
  const pva = approvedPlan ? await planVsActual(actor, approvedPlan.id) : null;
  const inspections = await prisma.planItem.findMany({
    where: { zevId, type: { in: ["INSPECTION", "PREVENTIVE_MAINTENANCE"] }, scheduledDate: { gte: new Date() } },
    orderBy: { scheduledDate: "asc" }, take: 5,
  });

  return (
    <div>
      <PageHeader title={isPresident ? "Pregled — predsjednik" : "Pregled — računovođa"} subtitle={`Stanje na dan ${formatDate(new Date())}`} />
      {isPresident && registerStatus && registerStatus !== "ESTABLISHED" && (
        <div className="mb-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={`REGISTER_${registerStatus}`} label={tEnum("unitRegisterStatus", registerStatus)} />
                <p className="max-w-[68ch] text-sm text-slate-700">{t("register.home.todo")}</p>
              </div>
              <BtnLink href="/zgrade?tab=posebni" variant="tonal">{t("register.home.link")}</BtnLink>
            </div>
          </Card>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stanje računa i blagajne" value={formatMoney(cash)} tone="ok" />
        <Stat label="Potraživanja od vlasnika" value={formatMoney(receivables.totalOpen)} tone="neutral" />
        <Stat label="Dospjelo (kasni)" value={formatMoney(receivables.totalOverdue)} tone={Number(receivables.totalOverdue) > 0 ? "bad" : "ok"} />
        <Stat label="Neplaćeno dobavljačima" value={formatMoney(supplierUnpaidTotal.toFixed(2))} tone={supplierUnpaidTotal > 0 ? "warn" : "ok"} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fond održavanja" value={formatMoney(fund.balance)} tone="neutral" />
        {pva && <Stat label={`Plan ${approvedPlan!.year} — planirano`} value={formatMoney(pva.totalPlanned)} tone="neutral" />}
        {pva && <Stat label={`Plan ${approvedPlan!.year} — realizovano`} value={formatMoney(pva.totalActual)} tone={dec(pva.totalActual).greaterThan(dec(pva.totalPlanned)) ? "bad" : "ok"} />}
        <Stat label="Nacrti serija faktura" value={String(draftBatches.length)} tone={draftBatches.length ? "warn" : "neutral"} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Prijedlozi na glasanju">
          {openProposals.length === 0 && <p className="text-sm text-slate-500">Nema otvorenih glasanja.</p>}
          <ul className="space-y-2">
            {openProposals.map((p) => {
              const voted = p.eligibleVoters.filter((ev) => ev.votes.some((v) => !v.invalid)).length;
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link className="text-blue-700 hover:underline" href={`/skupstina/prijedlog/${p.id}`}>
                    {p.code} — {p.title}
                  </Link>
                  <span className="text-xs text-slate-500">glasalo {voted}/{p.eligibleVoters.length}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Predstojeće sjednice">
          {upcomingMeetings.length === 0 && <p className="text-sm text-slate-500">Nema zakazanih sjednica.</p>}
          <ul className="space-y-2">
            {upcomingMeetings.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <Link className="text-blue-700 hover:underline" href={`/skupstina/${m.id}`}>{m.title}</Link>
                <span className="text-xs text-slate-500">{formatDateTime(m.scheduledAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Otvorene prijave održavanja">
          {openIssues.length === 0 && <p className="text-sm text-slate-500">Nema otvorenih prijava.</p>}
          <ul className="space-y-2">
            {openIssues.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                <Link className="text-blue-700 hover:underline" href={`/odrzavanje/${i.id}`}>{i.title}</Link>
                <StatusBadge status={i.status} label={tEnum("issueStatus", i.status)} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Neraspoređene uplate">
          {unmatchedPayments.length === 0 && <p className="text-sm text-slate-500">Sve uplate su raspoređene.</p>}
          <ul className="space-y-2">
            {unmatchedPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <Link className="text-blue-700 hover:underline" href={`/fakture/uplate/${p.id}`}>
                  {p.payerNameRaw ?? "Nepoznat platilac"} — {formatDate(p.date)}
                </Link>
                <span className="tabular-nums">{formatMoney(p.amount.toString())}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Predstojeći pregledi i preventivno održavanje">
          {inspections.length === 0 && <p className="text-sm text-slate-500">Nema zakazanih pregleda.</p>}
          <ul className="space-y-2">
            {inspections.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{i.name}</span>
                <span className="text-xs text-slate-500">{formatDate(i.scheduledDate)}</span>
              </li>
            ))}
          </ul>
        </Card>
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
      <Card title={t("ownerHome.title")}>
        {allClear && (
          <div className="flex items-start gap-3">
            <IconCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div>
              <p className="text-sm text-slate-800">{t(unpaidLater ? "ownerHome.empty.nothingSoon" : "ownerHome.empty.allPaid")}</p>
              {lastPayment && (
                <p className="mt-1 text-[13px] text-slate-500">
                  {tf("ownerHome.empty.lastPayment", { datum: formatDate(lastPayment.date), iznos: formatMoney(lastPayment.amount.toString()) })}
                </p>
              )}
            </div>
          </div>
        )}
        {tasks.length > 0 && (
          <ul className={`divide-y divide-border ${allClear ? "mt-4 border-t border-border" : ""}`}>
            {tasks.map((task) => (
              <TaskRow key={task.key} task={task} />
            ))}
          </ul>
        )}
      </Card>
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

/** Jedan red "Za Vas sada": chip, rečenica, (meta) i najviše jedno dugme; na telefonu dugme ide ispod teksta u punoj širini. */
function TaskRow({ task }: { task: OwnerTask }) {
  let badge: { status: string; label: string };
  let text: string;
  let meta: string | null = null;
  let action: ReactNode = null;
  switch (task.kind) {
    case "overdue": {
      const i = task.invoice;
      badge = { status: "UNPAID", label: t("ownerHome.overdue.badge") };
      text = tf("ownerHome.overdue.text", {
        broj: i.number, jedinica: i.unitLabel, iznos: formatMoney(i.remaining), datum: formatDate(i.dueDate),
        kada: tf(isOneForm(task.overdueDays) ? "pay.daysAgo.one" : "pay.daysAgo.other", { dana: task.overdueDays }),
      });
      action = <BtnLink href={`/fakture/${i.id}`} variant={task.primary ? "primary" : "secondary"}>{t("ownerHome.pay")}</BtnLink>;
      break;
    }
    case "dueSoon": {
      const i = task.invoice;
      badge = { status: "ISSUED", label: t("ownerHome.dueSoon.badge") };
      text = tf("ownerHome.dueSoon.text", { broj: i.number, jedinica: i.unitLabel, iznos: formatMoney(i.remaining), datum: formatDate(i.dueDate) });
      action = <BtnLink href={`/fakture/${i.id}`} variant={task.primary ? "primary" : "secondary"}>{t("ownerHome.pay")}</BtnLink>;
      break;
    }
    case "voting": {
      const v = task.voting;
      badge = { status: "VOTING_OPEN", label: t("ownerHome.voting.badge") };
      text = tf("ownerHome.voting.text", { sifra: v.code, naslov: v.title });
      meta = [v.closesAt ? tf("ownerHome.voting.deadline", { datum: formatDate(v.closesAt) }) : null, v.linkSent ? t("ownerHome.voting.linkSent") : null]
        .filter(Boolean).join(" · ") || null;
      action = <BtnLink href={`/skupstina/prijedlog/${v.proposalId}`} variant={task.primary ? "primary" : "secondary"}>{t("ownerHome.voting.view")}</BtnLink>;
      break;
    }
    case "evoteConsent":
      badge = { status: "NONE", label: t("ownerHome.consent.badge") };
      text = t("ownerHome.consent.text");
      action = <BtnLink href="/podesavanja" variant="tonal">{t("ownerHome.consent.button")}</BtnLink>;
      break;
    case "viaRepresentative": {
      const v = task.voting;
      badge = { status: "NONE", label: t("ownerHome.representative.badge") };
      text = tf("votingSubject.owner.viaRepresentative", { units: v.representative?.units ?? "", name: v.representative?.name ?? "" });
      meta = `${v.code} — ${v.title}`;
      break;
    }
  }
  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <StatusBadge status={badge.status} label={badge.label} />
        <p className="text-sm text-slate-800">{text}</p>
        {meta && <p className="text-[13px] text-slate-500">{meta}</p>}
      </div>
      {action && <div className="shrink-0 max-sm:[&>*]:w-full">{action}</div>}
    </li>
  );
}
