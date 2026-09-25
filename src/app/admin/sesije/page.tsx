import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSuperAdminActor } from "@/server/actor";
import { listActiveSessions, revokeSession, describeUserAgent } from "@/server/services/sessions";
import { tEnum, formatDateTime, formatRelativeTime } from "@/lib/i18n";
import { PageHeader, Card, Stat, Table, Td, StatusBadge, FilterBar, ConfirmAction, Flash, type ColumnSpec } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

const sessionHeaders: ColumnSpec[] = [
  { label: "Korisnik" },
  { label: "ZEV i uloge" },
  { label: "IP adresa" },
  { label: "Uređaj" },
  { label: "Prijava", nowrap: true },
  { label: "Posljednja aktivnost", nowrap: true },
  { label: "Ističe", nowrap: true },
  { label: "Radnje" },
];

async function revokeAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const sessionId = String(formData.get("sessionId") ?? "");
  try {
    await revokeSession(actor, sessionId);
  } catch (e) {
    redirect(`/admin/sesije?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/admin/sesije");
  redirect(`/admin/sesije?msg=${encodeURIComponent("Sesija je odjavljena.")}`);
}

/**
 * Super-admin, live view of currently logged-in sessions (Plans/live-sessions-admin-plan.md,
 * Faza 1 + Faza 2 + Faza 3) — same page pattern as /admin/aktivnosti (guard, layout,
 * Card+Table), auto-refreshing via <LiveRefresh /> rather than a manual reload.
 */
export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ aktivni?: string; err?: string; msg?: string }>;
}) {
  const actor = await requireSuperAdminActor();
  const sp = await searchParams;
  const activeOnly = sp.aktivni === "1";
  const sessions = await listActiveSessions(actor, { activeOnly });
  const activeNowCount = sessions.filter((s) => s.isActiveNow).length;
  const distinctUserCount = new Set(sessions.map((s) => s.userId)).size;

  return (
    <div>
      <PageHeader
        title="Sesije — trenutno prijavljeni korisnici"
        subtitle="Uživo, do 200 najnovijih aktivnih sesija na cijeloj platformi"
      />
      <Flash err={sp.err} msg={sp.msg} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Sesije" value={String(sessions.length)} />
        <Stat label="Korisnici" value={String(distinctUserCount)} />
        <Stat label="Aktivno sada" value={String(activeNowCount)} tone={activeNowCount > 0 ? "ok" : "neutral"} />
      </div>
      <FilterBar submitLabel="Primijeni">
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="aktivni" value="1" defaultChecked={activeOnly} />
          Samo aktivni sada (zadnjih 15 min)
        </label>
      </FilterBar>
      <LiveRefresh />
      <Card>
        <Table
          id="admin-sessions-table"
          caption="Sesije — trenutno prijavljeni korisnici"
          headers={sessionHeaders}
          empty={sessions.length === 0}
          emptyTitle="Nema aktivnih sesija."
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
              <Td className="text-xs">
                <span className="inline-flex items-center gap-1.5">
                  {s.isActiveNow && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />}
                  {s.lastSeenAt ? formatRelativeTime(s.lastSeenAt) : "—"}
                </span>
              </Td>
              <Td className="text-xs">{formatRelativeTime(s.expiresAt)}</Td>
              <Td>
                {s.id === actor.sessionId ? (
                  <span className="text-xs text-slate-400">Vi (ova sesija)</span>
                ) : (
                  <ConfirmAction
                    trigger="Odjavi"
                    triggerVariant="caution"
                    title="Odjava ove sesije je trenutna"
                    body={
                      <p className="text-sm text-amber-900">
                        Korisnik {s.displayName} će odmah biti odjavljen sa ovog uređaja. Ovo ne sprečava ponovnu prijavu —
                        za trajno onemogućavanje pristupa koristite deaktivaciju naloga.
                      </p>
                    }
                    confirmLabel="Odjavi sesiju"
                    confirmVariant="caution"
                    action={revokeAction}
                    hiddenFields={{ sessionId: s.id }}
                  />
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
