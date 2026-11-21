// Tab „Događaji” (B2, Plans/kontni-plan-b2-automatsko-knjizenje-plan.md §5): automatsko knjiženje — stanje
// događaja, šta čeka i zašto, „Obradi na čekanju” i knjiženje događaja iz zatvorenog perioda u tekući.
import { hasCapability } from "@/lib/accountingCapabilities";
import { listEvents } from "@/server/services/ledgerEvents";
import { formatMoney } from "@/lib/money";
import { formatDate, t, tEnum, tf } from "@/lib/i18n";
import { Card, ConfirmAction, Field, FilterBar, inputCls, RowLink, StatusBadge, SubmitBtn, Table, Td, type ColumnSpec } from "@/components/ui";
import { postEventIntoPeriodAction, processPendingAction } from "@/server/actions/journal";
import type { requireActor } from "@/server/actor";

type Actor = Awaited<ReturnType<typeof requireActor>>;
const E = (k: string) => t(`ledger.events.${k}`);

const headers: ColumnSpec[] = [
  { label: E("colDate") },
  { label: E("colKind"), priority: "primary" },
  { label: E("colSource"), priority: "secondary" },
  { label: E("colAmount"), align: "right" },
  { label: E("colStatus") },
  { label: E("colReason"), priority: "detail" },
];

const WAITING = ["WAITING_RULE", "WAITING_SCHEMA", "WAITING_PREDECESSOR", "WAITING_PERIOD"] as const;

export async function EventsTab({ actor, filter }: { actor: Actor; filter: string }) {
  const canPost = hasCapability(actor.roles, "journal.post");
  const view = filter === "POSTED" || filter === "ALL" ? filter : "WAITING";
  const { start, counts, rows } = await listEvents(actor, { status: view });

  return (
    <div className="space-y-6">
      <p className="max-w-[68ch] text-sm text-slate-600">{E("intro")}</p>
      <Card title={E("countsTitle")}>
        <div className="space-y-4">
          <p className="text-sm">{start ? tf("ledger.events.active", { datum: formatDate(start) }) : E("inactive")}</p>
          {start && (
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="POSTED" label={`${tEnum("eventStatus", "POSTED")}: ${counts.POSTED ?? 0}`} />
              {WAITING.map((s) => (counts[s] ?? 0) > 0 && <StatusBadge key={s} status={s} label={`${tEnum("eventStatus", s)}: ${counts[s]}`} />)}
            </div>
          )}
          {start && canPost && (
            <form action={processPendingAction} className="flex flex-wrap items-center gap-3">
              <SubmitBtn variant="primary">{E("process")}</SubmitBtn>
              <span className="max-w-[60ch] text-hint text-slate-500">{E("processHint")}</span>
            </form>
          )}
        </div>
      </Card>

      {start && (
        <Card title={E("listTitle")}>
          <div className="space-y-3">
            <FilterBar>
              <input type="hidden" name="tab" value="dogadjaji" />
              <Field label={E("filter")}>
                <select name="prikaz" defaultValue={view} key={view} className={inputCls}>
                  <option value="WAITING">{E("filterWaiting")}</option>
                  <option value="POSTED">{E("filterPosted")}</option>
                  <option value="ALL">{E("filterAll")}</option>
                </select>
              </Field>
            </FilterBar>
            <Table id="ledger-events" caption={E("listTitle")} headers={headers} empty={rows.length === 0} emptyTitle={view === "WAITING" ? E("empty") : E("emptyAll")}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{formatDate(r.eventDate)}</Td>
                  <Td>{tEnum("eventKind", r.kind)}</Td>
                  <Td>{r.sourceHref ? <RowLink href={r.sourceHref}>{r.sourceLabel}</RowLink> : r.sourceLabel}</Td>
                  <Td><span className="whitespace-nowrap tabular-nums">{formatMoney(r.amount)}</span></Td>
                  <Td><StatusBadge status={r.status} label={tEnum("eventStatus", r.status)} /></Td>
                  <Td>
                    {r.entryId ? (
                      <RowLink href={`/knjigovodstvo/nalozi/${r.entryId}`}>{r.entryNumber}</RowLink>
                    ) : (
                      <div className="space-y-2">
                        <span className="text-sm text-slate-600">{r.statusDetail}</span>
                        {r.status === "WAITING_PERIOD" && canPost && (
                          <ConfirmAction
                            trigger={E("intoPeriod")}
                            title={E("intoPeriodTitle")}
                            body={<p className="text-sm text-amber-900">{E("intoPeriodBody")}</p>}
                            confirmLabel={E("intoPeriodConfirm")}
                            confirmVariant="primary"
                            action={postEventIntoPeriodAction}
                            hiddenFields={{ eventId: r.id }}
                          />
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
