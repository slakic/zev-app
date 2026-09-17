import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor, isManagement } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { listInvoices, listChargeItems, createChargeItem, updateChargeItem, createDraftBatch, invoicePaidAmount } from "@/server/services/billing";
import { prisma } from "@/lib/prisma";
import { listBuildings } from "@/server/services/property";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDate, t, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash, BtnLink, ToggleBtn, RowLink, type ColumnSpec } from "@/components/ui";

const chargeItemHeaders: ColumnSpec[] = [
  { label: "Naziv", priority: "primary" },
  { label: "Metoda" },
  { label: "Stopa/iznos", align: "right", nowrap: true },
  { label: "Obuhvat", priority: "detail" },
  { label: "Frekvencija", priority: "detail" },
  { label: "Fond", priority: "detail" },
  { label: "Radnje" },
];

const batchHeaders: ColumnSpec[] = [
  { label: "Period" },
  { label: "Status" },
  { label: "Faktura", align: "right" },
  { label: "Kreirana" },
];

const invoiceHeaders: ColumnSpec[] = [
  { label: "Broj", priority: "primary", nowrap: true },
  { label: "Jedinica" },
  { label: "Dužnik" },
  { label: "Period", priority: "detail" },
  { label: "Dospijeće" },
  { label: "Iznos", align: "right", nowrap: true },
  { label: "Plaćeno", align: "right", nowrap: true },
  { label: "Status" },
];
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
        prisma.invoiceBatch.findMany({ where: { zevId: requireZev(actor) }, orderBy: { createdAt: "desc" }, take: 10, include: { _count: { select: { invoices: true } } } }),
        listBuildings(actor),
      ])
    : [[], [], []];

  return (
    <div>
      <PageHeader
        title={t("nav.invoices")}
        subtitle={management ? "Stavke naknada, serije faktura, uplate i salda" : "Vaše fakture i uplate"}
        actions={management ? <BtnLink href="/fakture/uplate" variant="secondary">Uplate i uparivanje</BtnLink> : <BtnLink href="/fakture/uplate" variant="secondary">Moje uplate</BtnLink>}
      />
      <Flash err={err} msg={msg} />

      {management && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Stavke naknada (konfigurabilne)">
            <Table id="charge-items-table" caption="Stavke naknada" headers={chargeItemHeaders} empty={chargeItems.length === 0}>
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
            <details className="group mt-3">
              <ToggleBtn>Nova stavka naknade</ToggleBtn>
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
            <Table id="batches-table" caption="Serije faktura" headers={batchHeaders} empty={batches.length === 0}>
              {batches.map((b) => (
                <tr key={b.id}>
                  <Td><RowLink href={`/fakture/serija/${b.id}`}>{b.period}</RowLink></Td>
                  <Td><StatusBadge status={b.status} label={b.status === "DRAFT" ? "Nacrt" : b.status === "ISSUED" ? "Izdata" : "Stornirana"} /></Td>
                  <Td>{b._count.invoices}</Td>
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
          <Table id="invoices-table" caption={management ? "Sve fakture" : "Moje fakture"} headers={invoiceHeaders} empty={invoices.length === 0}>
            {invoices.map((inv) => {
              const paid = invoicePaidAmount(inv);
              const overdue = inv.status === "ISSUED" && inv.dueDate < new Date();
              return (
                <tr key={inv.id}>
                  <Td><RowLink href={`/fakture/${inv.id}`}>{inv.number}</RowLink></Td>
                  <Td>{inv.unit.building.name} / {inv.unit.label}</Td>
                  <Td>{inv.debtor.kind === "PERSON" ? `${inv.debtor.firstName ?? ""} ${inv.debtor.lastName ?? ""}` : inv.debtor.orgName}</Td>
                  <Td>{inv.periodLabel ?? "—"}</Td>
                  <Td>{formatDate(inv.dueDate)}</Td>
                  <Td>{formatMoney(inv.total.toString())}</Td>
                  <Td>{formatMoney(paid.toFixed(2))}</Td>
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
