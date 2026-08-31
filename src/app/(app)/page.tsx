import Link from "next/link";
import { requireActor, isManagement } from "@/server/actor";
import { prisma } from "@/lib/prisma";
import { totalCash, reserveFundBalance } from "@/server/services/finance";
import { receivablesReport, unpaidSupplierInvoices } from "@/server/services/reports";
import { ownerBalance, ownerAdvance } from "@/server/services/payments";
import { planVsActual } from "@/server/services/plans";
import { formatMoney, dec } from "@/lib/money";
import { formatDate, formatDateTime, tEnum } from "@/lib/i18n";
import { Card, Stat, StatusBadge, PageHeader, Flash } from "@/components/ui";

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
  const [cash, receivables, supplierUnpaid, fund] = await Promise.all([
    totalCash(actor),
    receivablesReport(actor),
    unpaidSupplierInvoices(actor),
    reserveFundBalance(actor),
  ]);
  const supplierUnpaidTotal = supplierUnpaid.reduce((a, e) => a + Number(e.amount) - Number(e.paidAmount), 0);

  const [upcomingMeetings, openProposals, openIssues, draftBatches, unmatchedPayments] = await Promise.all([
    prisma.meeting.findMany({ where: { status: { in: ["SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT", "VOTING_OPEN"] } }, orderBy: { scheduledAt: "asc" }, take: 5 }),
    prisma.proposal.findMany({ where: { status: "VOTING_OPEN" }, include: { eligibleVoters: { include: { votes: true } } }, take: 5 }),
    prisma.maintenanceIssue.findMany({ where: { status: { notIn: ["CLOSED", "REJECTED", "PAID"] } }, orderBy: { createdAt: "desc" }, take: 6, include: { reporter: true } }),
    prisma.invoiceBatch.findMany({ where: { status: "DRAFT" }, take: 3 }),
    prisma.payment.findMany({ where: { status: { in: ["UNAPPLIED", "PARTIALLY_APPLIED"] }, reversedAt: null }, take: 6 }),
  ]);

  const approvedPlan = await prisma.annualPlan.findFirst({ where: { status: "APPROVED", year: new Date().getFullYear() }, orderBy: { version: "desc" } });
  const pva = approvedPlan ? await planVsActual(actor, approvedPlan.id) : null;
  const inspections = await prisma.planItem.findMany({
    where: { type: { in: ["INSPECTION", "PREVENTIVE_MAINTENANCE"] }, scheduledDate: { gte: new Date() } },
    orderBy: { scheduledDate: "asc" }, take: 5,
  });

  return (
    <div>
      <PageHeader title={isPresident ? "Pregled — predsjednik" : "Pregled — računovođa"} subtitle={`Stanje na dan ${formatDate(new Date())}`} />
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
          {openProposals.length === 0 && <p className="text-sm text-slate-400">Nema otvorenih glasanja.</p>}
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
          {upcomingMeetings.length === 0 && <p className="text-sm text-slate-400">Nema zakazanih sjednica.</p>}
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
          {openIssues.length === 0 && <p className="text-sm text-slate-400">Nema otvorenih prijava.</p>}
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
          {unmatchedPayments.length === 0 && <p className="text-sm text-slate-400">Sve uplate su raspoređene.</p>}
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
          {inspections.length === 0 && <p className="text-sm text-slate-400">Nema zakazanih pregleda.</p>}
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
  const [balance, advance] = await Promise.all([
    ownerBalance(actor, partyId),
    ownerAdvance(actor, partyId),
  ]);
  const [unpaid, recentPayments, openVoting, meetings, decisions, myIssues] = await Promise.all([
    prisma.invoice.findMany({ where: { debtorId: partyId, status: "ISSUED" }, include: { allocations: true, unit: true }, orderBy: { dueDate: "asc" } }),
    prisma.payment.findMany({ where: { payerId: partyId, reversedAt: null }, orderBy: { date: "desc" }, take: 5 }),
    prisma.eligibleVoter.findMany({
      where: { OR: [{ ownerId: partyId }, { proxyId: partyId }], proposal: { status: "VOTING_OPEN" } },
      include: { proposal: true, votes: { where: { invalid: false } } },
    }),
    prisma.meeting.findMany({ where: { status: { in: ["SCHEDULED", "INVITATIONS_SENT", "VOTING_OPEN"] } }, orderBy: { scheduledAt: "asc" }, take: 5 }),
    prisma.document.findMany({ where: { type: "DECISION", publishedToOwners: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.maintenanceIssue.findMany({ where: { reporterId: partyId }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  return (
    <div>
      <PageHeader title="Moj pregled" subtitle={actor.displayName} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Moj saldo (dugujem)" value={formatMoney(balance.balance)} tone={Number(balance.balance) > 0 ? "warn" : "ok"} />
        <Stat label="Ukupno zaduženo" value={formatMoney(balance.charged)} tone="neutral" />
        <Stat label="Ukupno plaćeno" value={formatMoney(balance.paid)} tone="ok" />
        <Stat label="Avans / preplata" value={formatMoney(advance)} tone="neutral" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Moje neplaćene fakture">
          {unpaid.length === 0 && <p className="text-sm text-slate-400">Nemate neplaćenih faktura.</p>}
          <ul className="space-y-2">
            {unpaid.map((inv) => {
              const paid = inv.allocations.reduce((a, x) => a + Number(x.amount), 0);
              return (
                <li key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link className="text-blue-700 hover:underline" href={`/fakture/${inv.id}`}>
                    {inv.number} ({inv.unit.label})
                  </Link>
                  <span className="text-xs text-slate-500">rok {formatDate(inv.dueDate)}</span>
                  <span className="tabular-nums">{formatMoney((Number(inv.total) - paid).toFixed(2))}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Otvorena glasanja">
          {openVoting.length === 0 && <p className="text-sm text-slate-400">Trenutno nema otvorenih izjašnjavanja.</p>}
          <ul className="space-y-2">
            {openVoting.map((ev) => (
              <li key={ev.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{ev.proposal.code} — {ev.proposal.title}</span>
                {ev.votes.length > 0
                  ? <StatusBadge status="ACCEPTED" label="Izjašnjeni ste" />
                  : <span className="text-xs text-amber-700">Link ste dobili e-poštom</span>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Moje nedavne uplate">
          {recentPayments.length === 0 && <p className="text-sm text-slate-400">Nema evidentiranih uplata.</p>}
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
              <li key={m.id} className="flex items-center justify-between text-sm">
                <Link className="text-blue-700 hover:underline" href={`/skupstina/${m.id}`}>{m.title}</Link>
                <span className="text-xs text-slate-500">{formatDateTime(m.scheduledAt)}</span>
              </li>
            ))}
            {meetings.length === 0 && <p className="text-sm text-slate-400">Nema zakazanih sjednica.</p>}
          </ul>
        </Card>
        <Card title="Objavljene odluke">
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={d.id} className="text-sm">
                <a className="text-blue-700 hover:underline" href={`/api/dokumenti/${d.id}`}>{d.title}</a>
              </li>
            ))}
            {decisions.length === 0 && <p className="text-sm text-slate-400">Nema objavljenih odluka.</p>}
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
            {myIssues.length === 0 && <p className="text-sm text-slate-400">Nemate prijava.</p>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
