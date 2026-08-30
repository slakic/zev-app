import { requireActor } from "@/server/actor";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/i18n";
import { PageHeader, Card, Table, Td } from "@/components/ui";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireActor("PRESIDENT", "ACCOUNTANT");
  const { q } = await searchParams;
  const events = await prisma.auditEvent.findMany({
    where: q ? { OR: [{ action: { contains: q } }, { targetType: { contains: q } }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  return (
    <div>
      <PageHeader title="Revizorski trag" subtitle="Append-only zapis svih bitnih radnji (UPDATE/DELETE blokiran na nivou baze)" />
      <form className="mb-3">
        <input name="q" defaultValue={q} placeholder="filter po radnji ili tipu (npr. vote, invoice)" className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
      </form>
      <Card>
        <Table headers={["Vrijeme", "Akter", "Radnja", "Cilj", "Razlog", "Detalji"]} empty={events.length === 0}>
          {events.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</Td>
              <Td className="text-xs">{e.actorId ? emailById.get(e.actorId) ?? e.actorId.slice(-8) : e.actorLabel ?? "—"}</Td>
              <Td className="font-mono text-xs">{e.action}</Td>
              <Td className="text-xs">{e.targetType}{e.targetId ? ` (${e.targetId.slice(-8)})` : ""}</Td>
              <Td className="text-xs">{e.reason ?? "—"}</Td>
              <Td className="max-w-md truncate text-xs text-slate-500">
                {e.after ? JSON.stringify(e.after) : ""}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
