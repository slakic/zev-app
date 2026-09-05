import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor, isManagement } from "@/server/actor";
import { listInvoices, listChargeItems, createChargeItem, updateChargeItem, createDraftBatch, invoicePaidAmount } from "@/server/services/billing";
import { prisma } from "@/lib/prisma";
import { listBuildings } from "@/server/services/property";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDate, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash, BtnLink } from "@/components/ui";
import { ChargeItemRow } from "@/components/charge-item-row";

async function addChargeItemAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  await createChargeItem(actor, {
    name: String(formData.get("name")),
    scopeType: (formData.get("scopeType") as never) ?? "ZEV",
    buildingId: (formData.get("buildingId") as string) || null,
    method: formData.get("method") as never,
    rate: parseMoneyInput(formData.get("rate") as string | null),
    effectiveFrom: new Date(String(formData.get("effectiveFrom"))),
    frequency: (formData.get("frequency") as never) || "MONTHLY",
    dueDayOfMonth: Number(formData.get("dueDayOfMonth") || 15),
    rounding: (formData.get("rounding") as never) || "HALF_UP_2",
    isReserveFund: formData.get("isReserveFund") === "on",
    displayOrder: Number(formData.get("displayOrder") || 0),
  });
  revalidatePath("/fakture");
}

async function updateChargeItemAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  const id = String(formData.get("id"));
  await updateChargeItem(actor, id, {
    name: String(formData.get("name")),
    scopeType: (formData.get("scopeType") as never) ?? "ZEV",
    buildingId: (formData.get("buildingId") as string) || null,
    method: formData.get("method") as never,
    rate: parseMoneyInput(formData.get("rate") as string | null),
    frequency: (formData.get("frequency") as never) || "MONTHLY",
    dueDayOfMonth: Number(formData.get("dueDayOfMonth") || 15),
    rounding: (formData.get("rounding") as never) || "HALF_UP_2",
    isReserveFund: formData.get("isReserveFund") === "on",
    active: formData.get("active") === "on",
    displayOrder: Number(formData.get("displayOrder") || 0),
  });
  revalidatePath("/fakture");
}

async function createBatchAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const period = String(formData.get("period"));
  try {
    const { batch } = await createDraftBatch(actor, period);
    redirect(`/fakture/serija/${batch.id}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(`/fakture?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ err?: string; msg?: string }> }) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const { err, msg } = await searchParams;
  const invoices = await listInvoices(actor);
  const [chargeItems, batches, buildings] = management
    ? await Promise.all([
        listChargeItems(actor),
        prisma.invoiceBatch.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { _count: { select: { invoices: true } } } }),
        listBuildings(actor),
      ])
    : [[], [], []];

  return (
    <div>
      <PageHeader
        title="Fakture i uplate"
        subtitle={management ? "Stavke naknada, serije faktura, uplate i salda" : "Vaše fakture i uplate"}
        actions={management ? <BtnLink href="/fakture/uplate" variant="secondary">Uplate i uparivanje</BtnLink> : <BtnLink href="/fakture/uplate" variant="secondary">Moje uplate</BtnLink>}
      />
      <Flash err={err} msg={msg} />

      {management && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Stavke naknada (konfigurabilne)">
            <Table headers={["Naziv", "Metoda", "Stopa/iznos", "Obuhvat", "Frekvencija", "Fond", "Radnje"]} empty={chargeItems.length === 0}>
              {chargeItems.map((c) => (
                <ChargeItemRow
                  key={c.id}
                  item={{
                    id: c.id,
                    name: c.name,
                    method: c.method,
                    rate: c.rate?.toString() ?? null,
                    scopeType: c.scopeType,
                    buildingId: c.buildingId,
                    frequency: c.frequency,
                    dueDayOfMonth: c.dueDayOfMonth,
                    rounding: c.rounding,
                    isReserveFund: c.isReserveFund,
                    displayOrder: c.displayOrder,
                    active: c.active,
                  }}
                  buildings={buildings}
                  action={updateChargeItemAction}
                />
              ))}
            </Table>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-blue-700">+ Nova stavka naknade</summary>
              <form action={addChargeItemAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-3">
                <Field label="Naziv"><input name="name" required className={inputCls} placeholder="Redovno održavanje" /></Field>
                <Field label="Metoda obračuna">
                  <select name="method" className={inputCls}>
                    <option value="FIXED_PER_UNIT">Fiksno po jedinici</option>
                    <option value="PER_AREA">Po m²</option>
                    <option value="PER_OWNERSHIP_SHARE">Po vlasničkom udjelu</option>
                    <option value="PER_OCCUPANT">Po broju korisnika</option>
                    <option value="EQUAL_SPLIT">Jednaka raspodjela</option>
                    <option value="UNIT_TYPE_COEFFICIENT">Koeficijent tipa</option>
                    <option value="CONSUMPTION">Po potrošnji</option>
                    <option value="CUSTOM_WEIGHTS">Prilagođeni ponderi</option>
                    <option value="MANUAL">Ručni iznos</option>
                  </select>
                </Field>
                <Field label="Stopa / iznos (KM)" hint="Za raspodjele: ukupan iznos; za m²/udio/korisnika: cijena po jedinici mjere.">
                  <input name="rate" className={inputCls} placeholder="0.35" />
                </Field>
                <Field label="Obuhvat">
                  <select name="scopeType" className={inputCls}>
                    <option value="ZEV">Cijela ZEV</option>
                    <option value="BUILDING">Zgrada</option>
                  </select>
                </Field>
                <Field label="Zgrada (ako obuhvat = zgrada)">
                  <select name="buildingId" className={inputCls}>
                    <option value="">—</option>
                    {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
                <Field label="Važi od"><input name="effectiveFrom" type="date" required className={inputCls} /></Field>
                <Field label="Frekvencija">
                  <select name="frequency" className={inputCls}>
                    <option value="MONTHLY">Mjesečno</option>
                    <option value="ANNUAL">Godišnje</option>
                    <option value="ONE_TIME">Jednokratno</option>
                  </select>
                </Field>
                <Field label="Dan dospijeća u mjesecu"><input name="dueDayOfMonth" type="number" defaultValue={15} className={inputCls} /></Field>
                <Field label="Zaokruživanje">
                  <select name="rounding" className={inputCls}>
                    <option value="HALF_UP_2">Polovina naviše (2 dec.)</option>
                    <option value="UP_2">Naviše</option>
                    <option value="DOWN_2">Naniže</option>
                  </select>
                </Field>
                <Field label="Redoslijed na fakturi"><input name="displayOrder" type="number" defaultValue={0} className={inputCls} /></Field>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="isReserveFund" /> Fond održavanja</label>
                <div className="flex items-end"><SubmitBtn>Sačuvaj stavku</SubmitBtn></div>
              </form>
            </details>
          </Card>

          <Card title="Serije faktura">
            <Table headers={["Period", "Status", "Faktura", "Kreirana"]} empty={batches.length === 0}>
              {batches.map((b) => (
                <tr key={b.id}>
                  <Td><Link href={`/fakture/serija/${b.id}`} className="text-blue-700 hover:underline">{b.period}</Link></Td>
                  <Td><StatusBadge status={b.status} label={b.status === "DRAFT" ? "Nacrt" : b.status === "ISSUED" ? "Izdata" : "Stornirana"} /></Td>
                  <Td right>{b._count.invoices}</Td>
                  <Td>{formatDate(b.createdAt)}</Td>
                </tr>
              ))}
            </Table>
            {actor.roles.includes("ACCOUNTANT") && (
              <form action={createBatchAction} className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Period (GGGG-MM)"><input name="period" required pattern="\d{4}-\d{2}" placeholder="2026-08" className={inputCls} /></Field>
                <SubmitBtn>Kreiraj nacrt serije sa pregledom obračuna</SubmitBtn>
              </form>
            )}
          </Card>
        </div>
      )}

      <div className="mt-4">
        <Card title={management ? "Sve fakture" : "Moje fakture"}>
          <Table headers={["Broj", "Jedinica", "Dužnik", "Period", "Dospijeće", "Iznos", "Plaćeno", "Status"]} empty={invoices.length === 0}>
            {invoices.map((inv) => {
              const paid = invoicePaidAmount(inv);
              const overdue = inv.status === "ISSUED" && inv.dueDate < new Date();
              return (
                <tr key={inv.id}>
                  <Td><Link href={`/fakture/${inv.id}`} className="text-blue-700 hover:underline">{inv.number}</Link></Td>
                  <Td>{inv.unit.building.name} / {inv.unit.label}</Td>
                  <Td>{inv.debtor.kind === "PERSON" ? `${inv.debtor.firstName ?? ""} ${inv.debtor.lastName ?? ""}` : inv.debtor.orgName}</Td>
                  <Td>{inv.periodLabel ?? "—"}</Td>
                  <Td>{formatDate(inv.dueDate)}</Td>
                  <Td right>{formatMoney(inv.total.toString())}</Td>
                  <Td right>{formatMoney(paid.toFixed(2))}</Td>
                  <Td>
                    <StatusBadge
                      status={overdue ? "UNPAID" : inv.status}
                      label={overdue ? tEnum("invoiceStatus", "OVERDUE") : tEnum("invoiceStatus", inv.status)}
                    />
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      </div>
    </div>
  );
}
