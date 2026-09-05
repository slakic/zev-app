import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor, isManagement } from "@/server/actor";
import { listDocuments, publishDocument } from "@/server/services/documents";
import { listAttachments, uploadAttachment, ATTACHMENT_CATEGORIES } from "@/server/services/attachments";
import { formatDateTime, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Flash, Field, inputCls, SubmitBtn } from "@/components/ui";

async function publishAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await publishDocument(actor, String(formData.get("documentId")));
  revalidatePath("/dokumenti");
}

async function uploadAttachmentAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const file = formData.get("file") as File | null;
  const category = String(formData.get("category") ?? "OTHER");
  try {
    if (!file || file.size === 0) throw new Error("Odaberite fajl.");
    await uploadAttachment(actor, {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      mime: file.type,
      category,
    });
  } catch (e) {
    redirect(`/dokumenti?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/dokumenti");
  redirect("/dokumenti?msg=uploaded");
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; err?: string; cat?: string }>;
}) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const { msg, err, cat } = await searchParams;
  const okMsg = msg === "uploaded" ? "Dokument je otpremljen." : undefined;
  const docs = await listDocuments(actor);
  const attachments = management
    ? await listAttachments(actor, cat ? { category: cat } : undefined)
    : [];

  return (
    <div>
      <PageHeader
        title="Dokumenti"
        subtitle={management ? "Generisani dokumenti — finalizovani su verzionisani i nepromjenjivi" : "Dokumenti objavljeni članovima skupštine"}
      />
      <Flash err={err} msg={okMsg} />
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

      {management && (
        <Card title="Otpremljeni dokumenti" className="mt-4">
          <p className="mb-3 text-xs text-slate-500">
            Skenirana ili primljena dokumentacija koju čuva ZEV — ugovori, izvještaji, zapisnici, prepiska i slično.
            Dokazi o vlasništvu priloženi uz vlasničke udjele takođe se čuvaju ovdje i dostupni su na stranici vlasnika.
          </p>

          <form method="get" className="mb-3 flex flex-wrap items-end gap-3">
            <Field label="Filtriraj po kategoriji">
              <select name="cat" defaultValue={cat ?? ""} className={inputCls}>
                <option value="">Sve kategorije</option>
                {ATTACHMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{tEnum("attachmentCategory", c)}</option>
                ))}
              </select>
            </Field>
            <SubmitBtn variant="secondary">Filtriraj</SubmitBtn>
          </form>

          <Table headers={["Kategorija", "Naziv fajla", "Otpremljen", "Preuzmi"]} empty={attachments.length === 0}>
            {attachments.map((a) => (
              <tr key={a.id}>
                <Td>{tEnum("attachmentCategory", a.category)}</Td>
                <Td>{a.filename}</Td>
                <Td>{formatDateTime(a.createdAt)}</Td>
                <Td><a className="text-blue-700 hover:underline" href={`/api/prilozi/${a.id}`}>preuzmi</a></Td>
              </tr>
            ))}
          </Table>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-blue-700">+ Otpremi dokument</summary>
            <form action={uploadAttachmentAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Kategorija">
                <select name="category" className={inputCls} defaultValue="OTHER">
                  {ATTACHMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{tEnum("attachmentCategory", c)}</option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Fajl" hint="PDF, JPG, PNG ili WEBP, do 15 MB.">
                  <input name="file" type="file" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp" required className={inputCls} />
                </Field>
              </div>
              <div><SubmitBtn>Otpremi</SubmitBtn></div>
            </form>
          </details>
        </Card>
      )}
    </div>
  );
}
