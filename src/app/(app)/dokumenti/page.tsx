import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { listDocuments, publishDocument } from "@/server/services/documents";
import { formatDateTime, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Flash } from "@/components/ui";

async function publishAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await publishDocument(actor, String(formData.get("documentId")));
  revalidatePath("/dokumenti");
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const { msg } = await searchParams;
  const docs = await listDocuments(actor);
  return (
    <div>
      <PageHeader
        title="Dokumenti"
        subtitle={management ? "Generisani dokumenti — finalizovani su verzionisani i nepromjenjivi" : "Dokumenti objavljeni članovima skupštine"}
      />
      <Flash msg={msg} />
      <Card>
        <Table headers={["Broj", "Vrsta", "Naziv", "Verzija", "Status", "Objavljen vlasnicima", "Generisan", "Radnje"]} empty={docs.length === 0}>
          {docs.map((d) => (
            <tr key={d.id}>
              <Td className="font-mono text-xs">{d.number}</Td>
              <Td>{tEnum("docType", d.type)}</Td>
              <Td>{d.title}</Td>
              <Td right>v{d.version}</Td>
              <Td><StatusBadge status={d.status} label={tEnum("docStatus", d.status)} /></Td>
              <Td>{d.publishedToOwners ? "Da" : "—"}</Td>
              <Td>{formatDateTime(d.createdAt)}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <a className="text-sm text-blue-700 hover:underline" href={`/api/dokumenti/${d.id}`}>PDF</a>
                  {management && !d.publishedToOwners && actor.roles.includes("PRESIDENT") && (
                    <form action={publishAction}>
                      <input type="hidden" name="documentId" value={d.id} />
                      <button className="text-sm text-emerald-700 hover:underline">objavi vlasnicima</button>
                    </form>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
