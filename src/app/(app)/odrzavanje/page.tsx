import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { listIssues, reportIssue } from "@/server/services/maintenance";
import { listBuildings, listUnits } from "@/server/services/property";
import { partyDisplayName } from "@/server/services/ownership";
import { formatDate, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";

async function reportAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  try {
    await reportIssue(actor, {
      title: String(formData.get("title")),
      description: String(formData.get("description")),
      buildingId: (formData.get("buildingId") as string) || null,
      unitId: (formData.get("unitId") as string) || null,
      locationNote: (formData.get("locationNote") as string) || null,
      category: (formData.get("category") as string) || null,
      urgency: (formData.get("urgency") as never) || "NORMAL",
      safetyImpact: formData.get("safetyImpact") === "on",
    });
  } catch (e) {
    redirect(`/odrzavanje?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/odrzavanje");
}

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const { err } = await searchParams;
  const [issues, buildings, units] = await Promise.all([
    listIssues(actor),
    listBuildings(actor),
    listUnits(actor),
  ]);
  return (
    <div>
      <PageHeader title="Održavanje" subtitle={management ? "Prijave, trijaža, ponude, radni nalozi i realizacija" : "Vaše prijave kvarova"} />
      <Flash err={err} />
      <Card title="Prijavi kvar / problem">
        <form action={reportAction} className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Field label="Naslov"><input name="title" required className={inputCls} placeholder="Curenje u podrumu" /></Field>
          <Field label="Zgrada">
            <select name="buildingId" className={inputCls}>
              <option value="">—</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Jedinica (ako se odnosi na jedinicu)">
            <select name="unitId" className={inputCls}>
              <option value="">—</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.building.name} / {u.label}</option>)}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Opis problema"><textarea name="description" required rows={2} className={inputCls} /></Field>
          </div>
          <Field label="Lokacija (napomena)"><input name="locationNote" className={inputCls} placeholder="podrum, kod liftovskog okna" /></Field>
          <Field label="Kategorija"><input name="category" className={inputCls} placeholder="vodovod / struja / lift..." /></Field>
          <Field label="Hitnost">
            <select name="urgency" className={inputCls}>
              <option value="NORMAL">Normalna</option>
              <option value="LOW">Niska</option>
              <option value="HIGH">Visoka</option>
              <option value="EMERGENCY">Hitno</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="safetyImpact" /> utiče na bezbjednost</label>
          <div className="flex items-end"><SubmitBtn>Pošalji prijavu</SubmitBtn></div>
        </form>
      </Card>

      <div className="mt-4">
        <Card title={management ? "Sve prijave" : "Moje prijave"}>
          <Table headers={["Naslov", "Prijavio", "Kategorija", "Hitnost", "Status", "Prijavljena"]} empty={issues.length === 0}>
            {issues.map((i) => (
              <tr key={i.id}>
                <Td><Link href={`/odrzavanje/${i.id}`} className="text-blue-700 hover:underline">{i.title}</Link></Td>
                <Td>{partyDisplayName(i.reporter)}</Td>
                <Td>{i.category ?? "—"}</Td>
                <Td>{tEnum("urgency", i.urgency)}{i.isEmergency ? " ⚠" : ""}</Td>
                <Td><StatusBadge status={i.status} label={tEnum("issueStatus", i.status)} /></Td>
                <Td>{formatDate(i.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
