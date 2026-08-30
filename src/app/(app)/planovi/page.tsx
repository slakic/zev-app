import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { listPlans, createPlan, listProjects, createProject } from "@/server/services/plans";
import { parseMoneyInput } from "@/lib/money";
import { tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn } from "@/components/ui";

async function addPlanAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await createPlan(actor, {
    year: Number(formData.get("year")),
    kind: formData.get("kind") as never,
    title: String(formData.get("title")),
  });
  revalidatePath("/planovi");
}

async function addProjectAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await createProject(actor, {
    name: String(formData.get("name")),
    description: (formData.get("description") as string) || null,
    estimatedCost: parseMoneyInput(formData.get("estimatedCost") as string | null),
  });
  revalidatePath("/planovi");
}

export default async function PlansPage() {
  const actor = await requireActor();
  const [plans, projects] = await Promise.all([listPlans(actor), listProjects(actor)]);
  return (
    <div>
      <PageHeader title="Godišnji planovi" subtitle="Plan održavanja, finansijski plan, projekti i realizacija" />
      <Card title="Planovi (verzionisani)">
        <Table headers={["Godina", "Vrsta", "Naziv", "Verzija", "Status"]} empty={plans.length === 0}>
          {plans.map((p) => (
            <tr key={p.id}>
              <Td>{p.year}.</Td>
              <Td>{tEnum("planKind", p.kind)}</Td>
              <Td><Link href={`/planovi/${p.id}`} className="text-blue-700 hover:underline">{p.title}</Link></Td>
              <Td right>v{p.version}</Td>
              <Td><StatusBadge status={p.status} label={tEnum("planStatus", p.status)} /></Td>
            </tr>
          ))}
        </Table>
        {actor.roles.includes("PRESIDENT") && (
          <form action={addPlanAction} className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="Godina"><input name="year" type="number" defaultValue={new Date().getFullYear() + 1} className={inputCls} /></Field>
            <Field label="Vrsta">
              <select name="kind" className={inputCls}>
                <option value="MAINTENANCE">Plan održavanja</option>
                <option value="BUDGET">Finansijski plan</option>
              </select>
            </Field>
            <Field label="Naziv"><input name="title" required className={inputCls} placeholder="Godišnji plan održavanja 2027." /></Field>
            <SubmitBtn>Kreiraj plan</SubmitBtn>
          </form>
        )}
      </Card>
      {isManagement(actor) && (
        <div className="mt-4">
          <Card title="Investicioni projekti">
            <Table headers={["Naziv", "Opis", "Procjena (KM)", "Status"]} empty={projects.length === 0}>
              {projects.map((p) => (
                <tr key={p.id}>
                  <Td>{p.name}</Td>
                  <Td>{p.description ?? "—"}</Td>
                  <Td right>{p.estimatedCost?.toString() ?? "—"}</Td>
                  <Td>{p.status}</Td>
                </tr>
              ))}
            </Table>
            {actor.roles.includes("PRESIDENT") && (
              <form action={addProjectAction} className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="Naziv"><input name="name" required className={inputCls} /></Field>
                <Field label="Opis"><input name="description" className={inputCls} /></Field>
                <Field label="Procjena (KM)"><input name="estimatedCost" className={inputCls} /></Field>
                <SubmitBtn>Dodaj projekat</SubmitBtn>
              </form>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
