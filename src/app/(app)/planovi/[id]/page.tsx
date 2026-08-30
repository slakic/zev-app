import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { getPlan, addPlanItem, proposePlan, approvePlan, planVsActual, createPlanRevision, listProjects } from "@/server/services/plans";
import { generatePlanPdf } from "@/server/services/documents";
import { listBuildings } from "@/server/services/property";
import { prisma } from "@/lib/prisma";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDate, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";

async function addItemAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const planId = String(formData.get("planId"));
  try {
    await addPlanItem(actor, {
      planId,
      type: formData.get("type") as never,
      name: String(formData.get("name")),
      plannedAmount: parseMoneyInput(formData.get("plannedAmount") as string | null) ?? "0",
      month: formData.get("month") ? Number(formData.get("month")) : null,
      scopeType: (formData.get("scopeType") as never) || "ZEV",
      buildingId: (formData.get("buildingId") as string) || null,
      projectId: (formData.get("projectId") as string) || null,
      categoryName: (formData.get("categoryName") as string) || null,
      scheduledDate: formData.get("scheduledDate") ? new Date(String(formData.get("scheduledDate"))) : null,
    });
  } catch (e) {
    redirect(`/planovi/${planId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/planovi/${planId}`);
}

async function planOpAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const planId = String(formData.get("planId"));
  const op = String(formData.get("op"));
  try {
    if (op === "propose") await proposePlan(actor, planId);
    else if (op === "approve") await approvePlan(actor, planId, String(formData.get("proposalId")));
    else if (op === "revise") {
      const next = await createPlanRevision(actor, planId, String(formData.get("reason") || "Nova verzija"));
      redirect(`/planovi/${next.id}`);
    } else if (op === "pdf") {
      await generatePlanPdf(actor, planId);
      redirect("/dokumenti");
    }
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(`/planovi/${planId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/planovi/${planId}`);
}

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const { err } = await searchParams;
  const actor = await requireActor();
  const management = isManagement(actor);
  const plan = await getPlan(actor, id);
  const isPresident = actor.roles.includes("PRESIDENT");
  const pva = management ? await planVsActual(actor, id) : null;
  const [buildings, projects, acceptedProposals] = isPresident
    ? await Promise.all([
        listBuildings(actor),
        listProjects(actor),
        prisma.proposal.findMany({ where: { status: "ACCEPTED" } }),
      ])
    : [[], [], []];
  return (
    <div>
      <PageHeader
        title={`${plan.title} (v${plan.version})`}
        subtitle={`${plan.year}. · ${tEnum("planKind", plan.kind)}`}
        actions={
          isPresident ? (
            <div className="flex gap-2">
              <form action={planOpAction}>
                <input type="hidden" name="planId" value={plan.id} />
                <input type="hidden" name="op" value="pdf" />
                <SubmitBtn variant="secondary">PDF</SubmitBtn>
              </form>
              {plan.status === "DRAFT" && (
                <form action={planOpAction}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <input type="hidden" name="op" value="propose" />
                  <SubmitBtn>Predloži skupštini</SubmitBtn>
                </form>
              )}
              <form action={planOpAction}>
                <input type="hidden" name="planId" value={plan.id} />
                <input type="hidden" name="op" value="revise" />
                <input type="hidden" name="reason" value="Nova verzija plana" />
                <SubmitBtn variant="secondary">Nova verzija</SubmitBtn>
              </form>
            </div>
          ) : undefined
        }
      />
      <Flash err={err} />
      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={plan.status} label={tEnum("planStatus", plan.status)} />
        {plan.approvedByProposalId && <span className="text-sm text-slate-500">Usvojen odlukom skupštine ({formatDate(plan.approvedAt)})</span>}
      </div>

      {isPresident && plan.status === "PROPOSED" && (
        <Card title="Usvajanje plana (veza sa odlukom skupštine)" className="mb-4">
          <form action={planOpAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="planId" value={plan.id} />
            <input type="hidden" name="op" value="approve" />
            <Field label="Usvojeni prijedlog skupštine">
              <select name="proposalId" className={inputCls}>
                {acceptedProposals.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.title}</option>)}
              </select>
            </Field>
            <SubmitBtn>Usvoji plan</SubmitBtn>
          </form>
          {acceptedProposals.length === 0 && <p className="mt-2 text-xs text-amber-700">Nema usvojenih prijedloga — plan se usvaja tek nakon odluke skupštine.</p>}
        </Card>
      )}

      <Card title="Stavke plana">
        <Table headers={["Stavka", "Vrsta", "Mjesec", "Obuhvat", "Planirano (KM)", "Termin"]} empty={plan.items.length === 0}>
          {plan.items.map((i) => (
            <tr key={i.id}>
              <Td>{i.name}</Td>
              <Td>{i.type === "INCOME" ? "Prihod" : i.type === "RECURRING_EXPENSE" ? "Redovni trošak" : i.type === "MAINTENANCE_EXPENSE" ? "Održavanje" : i.type === "PROJECT" ? "Projekat" : i.type === "RESERVE_ALLOCATION" ? "Fond održavanja" : i.type === "CONTINGENCY" ? "Rezerva" : i.type === "PREVENTIVE_MAINTENANCE" ? "Preventivno održavanje" : "Pregled/inspekcija"}</Td>
              <Td right>{i.month ?? "—"}</Td>
              <Td>{tEnum("scope", i.scopeType)}</Td>
              <Td right>{formatMoney(i.plannedAmount.toString(), "")}</Td>
              <Td>{formatDate(i.scheduledDate)}</Td>
            </tr>
          ))}
        </Table>
        {isPresident && (plan.status === "DRAFT" || plan.status === "PROPOSED") && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-blue-700">+ Nova stavka</summary>
            <form action={addItemAction} className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <input type="hidden" name="planId" value={plan.id} />
              <Field label="Naziv"><input name="name" required className={inputCls} /></Field>
              <Field label="Vrsta">
                <select name="type" className={inputCls}>
                  <option value="MAINTENANCE_EXPENSE">Trošak održavanja</option>
                  <option value="RECURRING_EXPENSE">Redovni trošak</option>
                  <option value="INCOME">Očekivani prihod</option>
                  <option value="PROJECT">Investicioni projekat</option>
                  <option value="RESERVE_ALLOCATION">Izdvajanje u fond</option>
                  <option value="CONTINGENCY">Rezerva za nepredviđeno</option>
                  <option value="PREVENTIVE_MAINTENANCE">Preventivno održavanje</option>
                  <option value="INSPECTION">Pregled / inspekcija</option>
                </select>
              </Field>
              <Field label="Planirani iznos (KM)"><input name="plannedAmount" className={inputCls} defaultValue="0" /></Field>
              <Field label="Mjesec (1-12, za mjesečni tok novca)"><input name="month" type="number" min={1} max={12} className={inputCls} /></Field>
              <Field label="Obuhvat">
                <select name="scopeType" className={inputCls}>
                  <option value="ZEV">Cijela ZEV</option>
                  <option value="BUILDING">Zgrada</option>
                </select>
              </Field>
              <Field label="Zgrada">
                <select name="buildingId" className={inputCls}>
                  <option value="">—</option>
                  {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Projekat">
                <select name="projectId" className={inputCls}>
                  <option value="">—</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Termin (pregledi/preventiva)"><input name="scheduledDate" type="date" className={inputCls} /></Field>
              <div className="flex items-end"><SubmitBtn>Dodaj stavku</SubmitBtn></div>
            </form>
          </details>
        )}
      </Card>

      {pva && (
        <div className="mt-4">
          <Card title={`Plan vs. realizacija (ukupno: ${formatMoney(pva.totalPlanned)} planirano / ${formatMoney(pva.totalActual)} realizovano)`}>
            <Table headers={["Stavka", "Planirano", "Realizovano", "Razlika"]} empty={pva.rows.length === 0}>
              {pva.rows.map((r) => (
                <tr key={r.planItemId}>
                  <Td>{r.name}</Td>
                  <Td right>{formatMoney(r.planned, "")}</Td>
                  <Td right>{formatMoney(r.actual, "")}</Td>
                  <Td right className={Number(r.difference) < 0 ? "text-red-700" : "text-emerald-700"}>{formatMoney(r.difference, "")}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
