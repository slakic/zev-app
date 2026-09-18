import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor, isManagement } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { listInvoices, listChargeItems, createChargeItem, updateChargeItem, createDraftBatch, invoicePaidAmount, type InvoiceSortKey } from "@/server/services/billing";
import { prisma } from "@/lib/prisma";
import { listBuildings, listUnits } from "@/server/services/property";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDate, t, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash, BtnLink, ToggleBtn, RowLink, Tabs, FilterBar, Pagination, type ColumnSpec } from "@/components/ui";

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

function invoiceHeadersFor(management: boolean): ColumnSpec[] {
  return [
    { label: "Broj", priority: "primary", nowrap: true, sortKey: "number" },
    { label: "Jedinica" },
    ...(management ? [{ label: "Dužnik" } as ColumnSpec] : []),
    { label: "Period", priority: "detail" },
    { label: "Dospijeće", sortKey: "dueDate" },
    { label: "Iznos", align: "right", nowrap: true, sortKey: "total" },
    { label: "Plaćeno", align: "right", nowrap: true, sortKey: "paid" },
    { label: "Status" },
  ];
}
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
    redirect(`/fakture?tab=naknade&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
}

const INVOICE_SORT_KEYS: InvoiceSortKey[] = ["number", "dueDate", "total", "paid"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; err?: string; msg?: string; status?: string; period?: string; unit?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const sp = await searchParams;
  const { tab, err, msg } = sp;
  const activeTab = tab === "fakture" ? "fakture" : "naknade";

  function fakturaHref(overrides: Partial<{ status: string; period: string; unit: string; sort: string; dir: string; page: string }>) {
    const merged = { status: sp.status, period: sp.period, unit: sp.unit, sort: sp.sort, dir: sp.dir, page: sp.page, ...overrides };
    const params = new URLSearchParams({ tab: "fakture" });
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/fakture?${params.toString()}`;
  }

  const invoiceSortBy = INVOICE_SORT_KEYS.includes(sp.sort as InvoiceSortKey) ? (sp.sort as InvoiceSortKey) : undefined;
  const invoiceDir = sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined;
  const invoicePage = Math.max(1, Number(sp.page) || 1);
  const invoiceFilter = management ? { status: sp.status || undefined, period: sp.period || undefined, unitId: sp.unit || undefined } : undefined;
  const invoiceResult =
    !management || activeTab === "fakture"
      ? await listInvoices(actor, invoiceFilter, { sortBy: invoiceSortBy, sortDir: invoiceDir, page: invoicePage })
      : { rows: [], page: 1, pageCount: 1 };
  const invoices = invoiceResult.rows;
  const [chargeItems, batches, buildings] =
    management && activeTab === "naknade"
      ? await Promise.all([
          listChargeItems(actor),
          prisma.invoiceBatch.findMany({ where: { zevId: requireZev(actor) }, orderBy: { createdAt: "desc" }, take: 10, include: { _count: { select: { invoices: true } } } }),
          listBuildings(actor),
        ])
      : [[], [], []];
  const filterUnits = management && activeTab === "fakture" ? await listUnits(actor) : [];

  return (
    <div>
      <PageHeader
        title={t("nav.invoices")}
        subtitle={management ? "Stavke naknada, serije faktura, uplate i salda" : "Vaše fakture i uplate"}
        actions={management ? <BtnLink href="/fakture/uplate" variant="secondary">Uplate i uparivanje</BtnLink> : <BtnLink href="/fakture/uplate" variant="secondary">Moje uplate</BtnLink>}
      />
      <Flash err={err} msg={msg} />

      {management && (
        <Tabs
          tabs={[
            { key: "naknade", label: "Naknade i serije" },
            { key: "fakture", label: "Fakture" },
          ]}
          active={activeTab}
          hrefFor={(key) => `/fakture?tab=${key}`}
        />
      )}

      {management && activeTab === "naknade" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Stavke naknada (konfigurabilne)" className="lg:col-span-2">
            <Table
              id="charge-items-table"
              caption="Stavke naknada"
              headers={chargeItemHeaders}
              empty={chargeItems.length === 0}
              emptyTitle={t("empty.chargeItems.title")}
              emptyHint={t("empty.chargeItems.hint")}
            >
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
              <form action={addChargeItemAction} className="mt-3 space-y-4">
                <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Osnovno</legend>
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
                </fieldset>
                <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Obračun</legend>
                  <Field label="Stopa / iznos (KM)" hint="Za raspodjele: ukupan iznos; za m²/udio/korisnika: cijena po jedinici mjere.">
                    <input name="rate" className={inputCls} placeholder="0.35" />
                  </Field>
                  <Field label="Zaokruživanje">
                    <select name="rounding" className={inputCls}>
                      <option value="HALF_UP_2">Polovina naviše (2 dec.)</option>
                      <option value="UP_2">Naviše</option>
                      <option value="DOWN_2">Naniže</option>
                    </select>
                  </Field>
                  <Field label="Redoslijed na fakturi"><input name="displayOrder" type="number" defaultValue={0} className={inputCls} /></Field>
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="isReserveFund" /> Fond održavanja</label>
                </fieldset>
                <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Dospijeće i prikaz</legend>
                  <Field label="Važi od"><input name="effectiveFrom" type="date" required className={inputCls} /></Field>
                  <Field label="Frekvencija">
                    <select name="frequency" className={inputCls}>
                      <option value="MONTHLY">Mjesečno</option>
                      <option value="ANNUAL">Godišnje</option>
                      <option value="ONE_TIME">Jednokratno</option>
                    </select>
                  </Field>
                  <Field label="Dan dospijeća u mjesecu"><input name="dueDayOfMonth" type="number" defaultValue={15} className={inputCls} /></Field>
                </fieldset>
                <div className="flex items-end justify-end"><SubmitBtn>Sačuvaj stavku</SubmitBtn></div>
              </form>
            </details>
          </Card>

          <Card title="Serije faktura">
            <Table
              id="batches-table"
              caption="Serije faktura"
              headers={batchHeaders}
              empty={batches.length === 0}
              emptyTitle={t("empty.batches.title")}
              emptyHint={actor.roles.includes("ACCOUNTANT") ? t("empty.batches.hint") : undefined}
            >
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

      {(!management || activeTab === "fakture") && (
      <div className="mt-4">
        {management && (
          <FilterBar>
            <input type="hidden" name="tab" value="fakture" />
            {invoiceSortBy && <input type="hidden" name="sort" value={invoiceSortBy} />}
            {invoiceDir && <input type="hidden" name="dir" value={invoiceDir} />}
            <Field label="Status">
              <select name="status" defaultValue={sp.status ?? ""} className={inputCls}>
                <option value="">Svi</option>
                <option value="ISSUED">{tEnum("invoiceStatus", "ISSUED")}</option>
                <option value="PAID">{tEnum("invoiceStatus", "PAID")}</option>
                <option value="CANCELLED">{tEnum("invoiceStatus", "CANCELLED")}</option>
                <option value="CORRECTED">{tEnum("invoiceStatus", "CORRECTED")}</option>
              </select>
            </Field>
            <Field label="Period (GGGG-MM)">
              <input type="text" name="period" defaultValue={sp.period ?? ""} pattern="\d{4}-\d{2}" placeholder="2026-08" className={inputCls} />
            </Field>
            <Field label="Jedinica">
              <select name="unit" defaultValue={sp.unit ?? ""} className={inputCls}>
                <option value="">Sve</option>
                {filterUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.building.name} / {u.label}</option>
                ))}
              </select>
            </Field>
            {(sp.status || sp.period || sp.unit) && (
              <BtnLink href="/fakture?tab=fakture" variant="secondary">Poništi filter</BtnLink>
            )}
          </FilterBar>
        )}
        <Card title={management ? "Sve fakture" : "Moje fakture"}>
          <Table
            id="invoices-table"
            caption={management ? "Sve fakture" : "Moje fakture"}
            headers={invoiceHeadersFor(management)}
            sort={{ active: invoiceSortBy, dir: invoiceDir, hrefFor: (key, d) => fakturaHref({ sort: key, dir: d }) }}
            empty={invoices.length === 0}
            emptyTitle={t(
              invoices.length === 0 && (sp.status || sp.period || sp.unit)
                ? "empty.filteredQuery.title"
                : management
                  ? "empty.invoicesManagement.title"
                  : "empty.invoicesOwner.title"
            )}
            emptyHint={
              invoices.length === 0 && (sp.status || sp.period || sp.unit)
                ? t("empty.filteredQuery.hint")
                : management
                  ? <BtnLink href="/fakture?tab=naknade" variant="tonal">Naknade i serije</BtnLink>
                  : undefined
            }
          >
            {invoices.map((inv) => {
              const paid = invoicePaidAmount(inv);
              const overdue = inv.status === "ISSUED" && inv.dueDate < new Date();
              return (
                <tr key={inv.id}>
                  <Td><RowLink href={`/fakture/${inv.id}`}>{inv.number}</RowLink></Td>
                  <Td>{management ? `${inv.unit.building.name} / ${inv.unit.label}` : inv.unit.label}</Td>
                  {management && (
                    <Td>{inv.debtor.kind === "PERSON" ? `${inv.debtor.firstName ?? ""} ${inv.debtor.lastName ?? ""}` : inv.debtor.orgName}</Td>
                  )}
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
          <Pagination page={invoiceResult.page} pageCount={invoiceResult.pageCount} hrefFor={(p) => fakturaHref({ page: String(p) })} />
        </Card>
      </div>
      )}
    </div>
  );
}
