import { requireSuperAdminActor } from "@/server/actor";
import { listActiveSessions, describeUserAgent } from "@/server/services/sessions";
import { tEnum, formatDateTime, formatRelativeTime } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, type ColumnSpec } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

const sessionHeaders: ColumnSpec[] = [
  { label: "Korisnik" },
  { label: "ZEV i uloge" },
  { label: "IP adresa" },
  { label: "Uređaj" },
  { label: "Prijava", nowrap: true },
  { label: "Ističe", nowrap: true },
];

/**
 * Super-admin, read-only live view of currently logged-in sessions (Plans/
 * live-sessions-admin-plan.md, Faza 1) — same page pattern as /admin/aktivnosti (guard,
 * layout, Card+Table), auto-refreshing via <LiveRefresh /> rather than a manual reload.
 * Faza 2 adds a "Posljednja aktivnost" column, Faza 3 a "Radnje" revoke column — deliberately
 * not stubbed out here ahead of time.
 */
export default async function AdminSessionsPage() {
  const actor = await requireSuperAdminActor();
  const sessions = await listActiveSessions(actor);

  return (
    <div>
      <PageHeader
        title="Sesije — trenutno prijavljeni korisnici"
        subtitle="Uživo, do 200 najnovijih aktivnih sesija na cijeloj platformi"
      />
      <LiveRefresh />
      <Card>
        <Table
          id="admin-sessions-table"
          caption="Sesije — trenutno prijavljeni korisnici"
          headers={sessionHeaders}
          empty={sessions.length === 0}
          emptyTitle="Trenutno nema prijavljenih korisnika."
        >
          {sessions.map((s) => (
            <tr key={s.id}>
              <Td className="text-sm">
                <div className="font-medium text-slate-700">{s.displayName}</div>
                <div className="text-xs text-slate-500">{s.email}</div>
              </Td>
              <Td className="text-xs">
                {s.zevLabel ? (
                  <>
                    <div>{s.zevLabel}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {s.roles.map((r) => (
                        <span key={r} className="text-slate-500">
                          {tEnum("roles", r)}
                        </span>
                      ))}
                      {s.zevSuspended && <StatusBadge status="FAILED" label="ZEV suspendovan" />}
                    </div>
                  </>
                ) : (
                  <span className="text-slate-400">Nema izabran ZEV</span>
                )}
              </Td>
              <Td className="font-mono text-xs">{s.ipAddress ?? "—"}</Td>
              <Td className="text-xs">{describeUserAgent(s.userAgent)}</Td>
              <Td className="text-xs">{formatDateTime(s.createdAt)}</Td>
              <Td className="text-xs">{formatRelativeTime(s.expiresAt)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
