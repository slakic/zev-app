import { requireActor } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { prisma } from "@/lib/prisma";
import { formatDateTime, t } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, type ColumnSpec } from "@/components/ui";
import { describeEmailProvider } from "@/server/notifications/providers";

const messageHeaders: ColumnSpec[] = [
  { label: "Vrijeme", nowrap: true },
  { label: "Kanal", priority: "detail" },
  { label: "Primalac", priority: "primary" },
  { label: "Naslov / šablon" },
  { label: "Status" },
  { label: "Pokušaja", align: "right", priority: "detail" },
];

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
      <PageHeader
        title="Poslate poruke"
        subtitle={
          describeEmailProvider().kind === "mailjet"
            ? "E-mail i Viber poruke. E-mail se stvarno šalje (Mailjet); Viber je simulacija."
            : "E-mail i Viber poruke. Slanje je simulirano — poruke ne izlaze iz aplikacije."
        }
      />
      <Card>
        <Table
          id="messages-table"
          caption="Poslate poruke"
          headers={messageHeaders}
          empty={messages.length === 0}
          emptyTitle={t("empty.messages.title")}
          emptyHint={t("empty.messages.hint")}
        >
          {messages.map((m) => (
            <tr key={m.id}>
              <Td className="text-xs">{formatDateTime(m.createdAt)}</Td>
              <Td>{m.channel === "EMAIL" ? "E-mail" : "Viber"}</Td>
              <Td className="text-xs">{m.toAddress}</Td>
              <Td className="text-xs">
                {m.subject ?? m.template ?? "—"}
                {m.attachmentDocumentId && <span className="text-[13px] text-slate-600"> (PDF u prilogu)</span>}
              </Td>
              <Td>
                <StatusBadge status={m.status} label={m.status === "QUEUED" ? "U redu čekanja" : m.status === "SENT" ? "Poslato" : m.status === "DELIVERED" ? "Isporučeno" : m.status === "SEEN" ? "Pročitano" : "Neuspješno"} />
                {m.status === "FAILED" && m.lastError && <p className="mt-1 max-w-72 text-[13px] text-slate-600">{m.lastError}</p>}
              </Td>
              <Td>{m.attempts}</Td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-[13px] text-slate-500">
          Sadržaj poruka ne uključuje salda ni lične finansijske podatke. Izuzetak je faktura u PDF prilogu, koju dobijaju samo vlasnici koji su izabrali dostavu računa e-poštom.
        </p>
      </Card>
    </div>
  );
}
