// "Za Vas sada" (F3.4, odluka D1 A): rangirana lista onoga što traži radnju vlasnika. Čista funkcija —
// stranica joj daje podatke koje ionako učitava, a redoslijed je determinističan (isti ulaz, isti izlaz),
// pa se početna ne "mijenja sama". Tekstove i dugmad slaže stranica; ovdje su samo vrsta, rang i `primary`.
import { calendarDaysBetween } from "@/lib/paymentInstructions";

export const DUE_SOON_DAYS = 14;

export type OwnerTaskInvoice = {
  id: string;
  number: string;
  unitLabel: string;
  dueDate: Date;
  /** Preostali iznos (Decimal kao string); fakture bez preostalog iznosa se ne šalju. */
  remaining: string;
};

export type OwnerTaskVoting = {
  /** Proposal.id */
  proposalId: string;
  code: string;
  title: string;
  closesAt: Date | null;
  /** Vlasnik (ili njegov punomoćnik) lično glasa za ovaj subjekt. */
  canVote: boolean;
  /** Za subjekt postoji važeći glas. */
  voted: boolean;
  /** Suvlasnik koji nije predstavnik: ime predstavnika i posebni dijelovi za koje predstavnik glasa. */
  representative: { name: string; units: string } | null;
  /** Lični link (listić sjednice ili token) je poslat. */
  linkSent: boolean;
};

export type OwnerTasksInput = {
  now: Date;
  /** Neplaćene izdate fakture vlasnika sa preostalim iznosom > 0. */
  invoices: OwnerTaskInvoice[];
  votings: OwnerTaskVoting[];
  eVoteConsentStatus: string;
};

export type OwnerTask =
  | { kind: "overdue"; key: string; primary: boolean; invoice: OwnerTaskInvoice; overdueDays: number }
  | { kind: "voting"; key: string; primary: boolean; voting: OwnerTaskVoting }
  | { kind: "evoteConsent"; key: string; primary: boolean }
  | { kind: "dueSoon"; key: string; primary: boolean; invoice: OwnerTaskInvoice; daysLeft: number }
  | { kind: "viaRepresentative"; key: string; primary: boolean; voting: OwnerTaskVoting };

export type OwnerTasksResult = {
  /** Rangirano: dospjele, glasanja, uključivanje e-glasanja, uskoro dospijeva, informativni redovi. */
  tasks: OwnerTask[];
  /** Nema nijedne stavke koja traži radnju (informativni redovi ne računaju). */
  allClear: boolean;
  /** Postoje neplaćene fakture, ali nijedna nije dospjela ni u prozoru "uskoro". */
  unpaidLater: boolean;
};

const byDueThenNumber = (a: OwnerTaskInvoice, b: OwnerTaskInvoice) =>
  a.dueDate.getTime() - b.dueDate.getTime() || a.number.localeCompare(b.number);

const byDeadlineThenCode = (a: OwnerTaskVoting, b: OwnerTaskVoting) => {
  const ad = a.closesAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bd = b.closesAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return ad - bd || a.code.localeCompare(b.code) || a.proposalId.localeCompare(b.proposalId);
};

export function ownerTasks(input: OwnerTasksInput): OwnerTasksResult {
  const overdue: OwnerTask[] = [];
  const soon: OwnerTask[] = [];
  for (const inv of [...input.invoices].sort(byDueThenNumber)) {
    const daysLate = calendarDaysBetween(inv.dueDate, input.now);
    if (daysLate > 0) {
      overdue.push({ kind: "overdue", key: `inv:${inv.id}`, primary: false, invoice: inv, overdueDays: daysLate });
    } else if (-daysLate <= DUE_SOON_DAYS) {
      soon.push({ kind: "dueSoon", key: `inv:${inv.id}`, primary: false, invoice: inv, daysLeft: -daysLate });
    }
  }

  // Jedno glasanje po prijedlogu: ako vlasnik za isti prijedlog ima dva subjekta, računa se onaj koji traži radnju.
  const pending = new Map<string, OwnerTaskVoting>();
  for (const v of input.votings) {
    if (!v.canVote || v.voted) continue;
    if (!pending.has(v.proposalId)) pending.set(v.proposalId, v);
  }
  const voting: OwnerTask[] = [...pending.values()]
    .sort(byDeadlineThenCode)
    .map((v) => ({ kind: "voting", key: `vote:${v.proposalId}`, primary: false, voting: v }));

  // Saglasnost za e-glasanje ima smisla samo ako postoji glasanje u kojem vlasnik lično učestvuje.
  const hasOpenVote = input.votings.some((v) => v.canVote);
  const consent: OwnerTask[] =
    hasOpenVote && input.eVoteConsentStatus !== "SIGNED" ? [{ kind: "evoteConsent", key: "evote-consent", primary: false }] : [];

  const info: OwnerTask[] = input.votings
    .filter((v) => !v.canVote && !v.voted && v.representative)
    .sort(byDeadlineThenCode)
    .map((v) => ({ kind: "viaRepresentative", key: `rep:${v.proposalId}`, primary: false, voting: v }));

  const actionable = [...overdue, ...voting, ...consent, ...soon];
  // `primary` samo na najhitnijoj stavki koja ima dugme "puna težina"; saglasnost je uvijek tonalna.
  if (actionable.length > 0 && actionable[0].kind !== "evoteConsent") actionable[0].primary = true;

  return {
    tasks: [...actionable, ...info],
    allClear: actionable.length === 0,
    unpaidLater: input.invoices.length > 0 && overdue.length + soon.length === 0,
  };
}
