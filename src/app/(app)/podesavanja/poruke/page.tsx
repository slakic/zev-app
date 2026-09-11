import { requireActor } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge } from "@/components/ui";

export default async function MessagesPage() {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  // zevId added 2026-09-09 — was unscoped, showing every tenant's outbox. A handful of
  // NotificationMessage rows are legitimately account-level (NULL zevId, e.g. a
  // password-reset e-mail) — those are intentionally excluded from this per-tenant view.
  // See docs/multitenancy-plan.md addendum.
  const messages = await prisma.notificationMessage.findMany({
    where: { zevId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { recipient: true },
  });
  return (
    <div>
      <PageHeader title="Poslate poruke" subtitle="Outbox e-mail i Viber poruka (mock provajderi — simulirani statusi isporuke)" />
      <Card>
        <Table headers={["Vrijeme", "Kanal", "Primalac", "Naslov / šablon", "Status", "Pokušaja"]} empty={messages.length === 0}>
          {messages.map((m) => (
            <tr key={m.id}>
              <Td className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt)}</Td>
              <Td>{m.channel === "EMAIL" ? "E-mail" : "Viber"}</Td>
              <Td className="text-xs">{m.toAddress}</Td>
              <Td className="text-xs">{m.subject ?? m.template ?? "—"}</Td>
              <Td><StatusBadge status={m.status} label={m.status === "QUEUED" ? "U redu čekanja" : m.status === "SENT" ? "Poslato" : m.status === "DELIVERED" ? "Isporučeno" : m.status === "SEEN" ? "Pročitano" : "Neuspješno"} /></Td>
              <Td right>{m.attempts}</Td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-slate-500">
          Sadržaj poruka ne uključuje salda ni lične finansijske podatke — poruke vode na prijavu u aplikaciju.
        </p>
      </Card>
    </div>
  );
}
