import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor, isManagement } from "@/server/actor";
import { listDocuments, publishDocument } from "@/server/services/documents";
import { listAttachments, uploadAttachment, ATTACHMENT_CATEGORIES } from "@/server/services/attachments";
import { formatDate, formatDateTime, tEnum, t, tf } from "@/lib/i18n";
import { DOCUMENT_GROUPS, documentGroupOf, parseDocumentGroup } from "@/lib/documentGroups";
import { ProofFileField } from "@/components/proof-file-field";
import { PageHeader, Card, Table, Td, StatusBadge, Flash, Field, inputCls, SubmitBtn, ToggleBtn, ConfirmAction, RowActionLink, FilterBar, type ColumnSpec } from "@/components/ui";

const attachmentHeaders: ColumnSpec[] = [
  { label: "Kategorija" },
  { label: "Naziv fajla", priority: "primary" },
  { label: "Otpremljen" },
  { label: "Preuzmi", actions: true },
];

// F8.6: uprava — „Naziv” je glavna kolona; broj bez monospace fonta.
const documentHeaders: ColumnSpec[] = [
  { label: "Naziv", priority: "primary" },
  { label: "Broj", nowrap: true },
  { label: "Vrsta", priority: "detail" },
  { label: "Verzija", align: "right" },
  { label: "Status" },
  { label: "Objavljen vlasnicima", priority: "detail" },
  { label: "Generisan", priority: "detail" },
  { label: "Radnje", actions: true },
];

// F8.6: vlasnik — samo ono što mu treba: naziv, vrsta, datum i preuzimanje (bez statusa, verzije i objave).
const ownerDocumentHeaders = (): ColumnSpec[] => [
  { label: t("docsPage.owner.name"), priority: "primary" },
  { label: t("docsPage.owner.type") },
  { label: t("docsPage.owner.date"), nowrap: true },
  { label: t("docsPage.owner.download"), actions: true },
];

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
  searchParams: Promise<{ msg?: string; err?: string; cat?: string; vrsta?: string }>;
}) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const { msg, err, cat, vrsta } = await searchParams;
  const okMsg = msg === "uploaded" ? "Dokument je otpremljen." : undefined;
  const allDocs = await listDocuments(actor);
  const group = management ? parseDocumentGroup(vrsta) : undefined;
  const docs = group ? allDocs.filter((d) => documentGroupOf(d.type) === group) : allDocs;
  // Verzija se prikazuje vlasniku samo kad postoji više verzija istog dokumenta.
  const versionCount = new Map<string, number>();
  for (const d of allDocs) versionCount.set(`${d.type}|${d.number}`, (versionCount.get(`${d.type}|${d.number}`) ?? 0) + 1);
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
      {management && (
        <FilterBar>
          {cat && <input type="hidden" name="cat" value={cat} />}
          <Field label={t("docsPage.filter.label")}>
            <select name="vrsta" defaultValue={group ?? ""} className={inputCls}>
              <option value="">{t("docsPage.filter.all")}</option>
              {DOCUMENT_GROUPS.map((g) => <option key={g} value={g}>{t(`docsPage.filter.groups.${g}`)}</option>)}
            </select>
          </Field>
        </FilterBar>
      )}
      <Card>
        {management ? (
          <Table
            id="documents-table"
            caption="Generisani dokumenti"
            headers={documentHeaders}
            empty={docs.length === 0}
            emptyTitle={t(group ? "empty.filteredQuery.title" : "empty.documents.title")}
            emptyHint={group ? t("empty.filteredQuery.hint") : undefined}
          >
            {docs.map((d) => (
              <tr key={d.id}>
                <Td>{d.title}</Td>
                <Td className="text-[13px]">{d.number}</Td>
                <Td>{tEnum("docType", d.type)}</Td>
                <Td>v{d.version}</Td>
                <Td><StatusBadge status={d.status} label={tEnum("docStatus", d.status)} /></Td>
                <Td>{d.publishedToOwners ? "Da" : "—"}</Td>
                <Td>{formatDateTime(d.createdAt)}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RowActionLink href={`/api/dokumenti/${d.id}`}>PDF</RowActionLink>
                    {!d.publishedToOwners && actor.roles.includes("PRESIDENT") && (
                      d.status === "FINAL" ? (
                        <ConfirmAction
                          trigger={t("confirm.publishDoc.trigger")}
                          triggerVariant="caution"
                          title={t("confirm.publishDoc.title")}
                          body={<p className="text-sm text-amber-950">{tf("confirm.publishDoc.body", { naslov: d.title, broj: d.number })}</p>}
                          confirmLabel={t("confirm.publishDoc.confirm")}
                          confirmVariant="primary"
                          action={publishAction}
                          hiddenFields={{ documentId: d.id }}
                        />
                      ) : (
                        <span className="text-[13px] text-slate-500">{t("confirm.publishDoc.draftNote")}</span>
                      )
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <Table
            id="documents-table"
            caption="Dokumenti"
            headers={ownerDocumentHeaders()}
            empty={docs.length === 0}
            emptyTitle={t("empty.documents.title")}
          >
            {docs.map((d) => (
              <tr key={d.id}>
                <Td>
                  {d.title}
                  {(versionCount.get(`${d.type}|${d.number}`) ?? 1) > 1 && (
                    <span className="ml-2 text-[13px] text-slate-500">{tf("docsPage.owner.version", { broj: d.version })}</span>
                  )}
                </Td>
                <Td>{tEnum("docType", d.type)}</Td>
                <Td>{formatDate(d.finalizedAt ?? d.createdAt)}</Td>
                <Td><RowActionLink href={`/api/dokumenti/${d.id}`}>{t("docsPage.owner.downloadPdf")}</RowActionLink></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {management && (
        <Card title="Otpremljeni dokumenti" className="mt-4">
          <p className="mb-3 text-[13px] text-slate-500">
            Skenirana ili primljena dokumentacija koju čuva ZEV — ugovori, izvještaji, zapisnici, prepiska i slično.
            Dokazi o vlasništvu priloženi uz vlasničke udjele takođe se čuvaju ovdje i dostupni su na stranici vlasnika.
          </p>

          <form method="get" className="mb-3 flex flex-wrap items-end gap-3">
            {group && <input type="hidden" name="vrsta" value={group} />}
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

          <Table
            id="attachments-table"
            caption="Otpremljeni dokumenti"
            headers={attachmentHeaders}
            empty={attachments.length === 0}
            emptyTitle={t("empty.attachments.title")}
            emptyHint={t("empty.attachments.hint")}
          >
            {attachments.map((a) => (
              <tr key={a.id}>
                <Td>{tEnum("attachmentCategory", a.category)}</Td>
                <Td>{a.filename}</Td>
                <Td>{formatDateTime(a.createdAt)}</Td>
                <Td><RowActionLink href={`/api/prilozi/${a.id}`}>preuzmi</RowActionLink></Td>
              </tr>
            ))}
          </Table>

          <details className="group mt-4">
            <ToggleBtn>Otpremi dokument</ToggleBtn>
            <form action={uploadAttachmentAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Kategorija">
                <select name="category" className={inputCls} defaultValue="OTHER">
                  {ATTACHMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{tEnum("attachmentCategory", c)}</option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <ProofFileField
                  name="file"
                  label={t("docsPage.upload.label")}
                  buttonLabel={t("docsPage.upload.pick")}
                  hint={t("docsPage.upload.hint")}
                  accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
                  required
                />
              </div>
              <div><SubmitBtn>Otpremi</SubmitBtn></div>
            </form>
          </details>
        </Card>
      )}
    </div>
  );
}
