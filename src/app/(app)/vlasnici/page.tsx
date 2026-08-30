import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { listParties, createParty, partyDisplayName, addOwnershipStake, setOccupancy, grantProxy, transferOwnership } from "@/server/services/ownership";
import { createUserForParty } from "@/server/services/users";
import { listUnits } from "@/server/services/property";
import { prisma } from "@/lib/prisma";
import { parseMoneyInput } from "@/lib/money";
import { formatDate } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";
import { redirect } from "next/navigation";

async function addPartyAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const kind = formData.get("kind") as "PERSON" | "ORGANIZATION";
  const party = await createParty(actor, {
    kind,
    firstName: kind === "PERSON" ? String(formData.get("firstName") ?? "") : null,
    lastName: kind === "PERSON" ? String(formData.get("lastName") ?? "") : null,
    orgName: kind === "ORGANIZATION" ? String(formData.get("orgName") ?? "") : null,
    email: (formData.get("email") as string) || null,
    phone: (formData.get("phone") as string) || null,
    address: (formData.get("address") as string) || null,
    correspondenceAddress: (formData.get("correspondenceAddress") as string) || null,
  });
  const email = formData.get("accountEmail") as string;
  const password = formData.get("accountPassword") as string;
  if (email && password) {
    await createUserForParty(actor, { partyId: party.id, email, password, roles: ["OWNER"] });
  }
  revalidatePath("/vlasnici");
}

async function addStakeAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  try {
    await addOwnershipStake(actor, {
      unitId: String(formData.get("unitId")),
      ownerId: String(formData.get("ownerId")),
      sharePercent: parseMoneyInput(formData.get("sharePercent") as string | null) ?? "",
      validFrom: new Date(String(formData.get("validFrom"))),
    });
  } catch (e) {
    redirect(`/vlasnici?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/vlasnici");
}

async function transferAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  try {
    await transferOwnership(actor, {
      unitId: String(formData.get("unitId")),
      fromOwnerId: String(formData.get("fromOwnerId")),
      toOwnerId: String(formData.get("toOwnerId")),
      effectiveDate: new Date(String(formData.get("effectiveDate"))),
      note: (formData.get("note") as string) || null,
    });
  } catch (e) {
    redirect(`/vlasnici?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/vlasnici");
}

async function addOccupancyAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await setOccupancy(actor, {
    unitId: String(formData.get("unitId")),
    partyId: String(formData.get("partyId")),
    type: formData.get("type") as never,
    headcount: Number(formData.get("headcount") ?? 1),
    validFrom: new Date(String(formData.get("validFrom"))),
  });
  revalidatePath("/vlasnici");
}

async function grantProxyAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  try {
    await grantProxy(actor, {
      grantorId: String(formData.get("grantorId")),
      holderId: String(formData.get("holderId")),
      scope: formData.get("scope") as never,
      documentRef: (formData.get("documentRef") as string) || null,
      validFrom: new Date(String(formData.get("validFrom"))),
      validTo: formData.get("validTo") ? new Date(String(formData.get("validTo"))) : null,
    });
  } catch (e) {
    redirect(`/vlasnici?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/vlasnici");
}

export default async function OwnersPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const isPresident = actor.roles.includes("PRESIDENT");
  const { err } = await searchParams;
  const [parties, units, proxies] = await Promise.all([
    listParties(actor),
    listUnits(actor),
    prisma.proxy.findMany({ where: { revokedAt: null }, include: { grantor: true, holder: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Vlasnici i korisnici" subtitle="Etažni vlasnici, suvlasnici, stanari, zakupci i punomoćnici" />
      <Flash err={err} />
      <Card title="Lica (fizička i pravna)">
        <Table headers={["Ime / naziv", "Vrsta", "E-mail", "Telefon", "Vlasništvo (aktivno)", "Nalog"]} empty={parties.length === 0}>
          {parties.map((p) => (
            <tr key={p.id}>
              <Td><Link href={`/vlasnici/${p.id}`} className="text-blue-700 hover:underline">{partyDisplayName(p)}</Link></Td>
              <Td>{p.kind === "PERSON" ? "Fizičko lice" : "Pravno lice"}</Td>
              <Td>{p.email ?? "—"}</Td>
              <Td>{p.phone ?? "—"}</Td>
              <Td>{p.ownershipStakes.map((s) => `${s.unit.label} (${s.sharePercent}%)`).join(", ") || "—"}</Td>
              <Td>{p.user ? (p.user.active ? p.user.email : "deaktiviran") : "—"}</Td>
            </tr>
          ))}
        </Table>
        {isPresident && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-blue-700">+ Dodaj lice</summary>
            <form action={addPartyAction} className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Field label="Vrsta">
                <select name="kind" className={inputCls}>
                  <option value="PERSON">Fizičko lice</option>
                  <option value="ORGANIZATION">Pravno lice</option>
                </select>
              </Field>
              <Field label="Ime"><input name="firstName" className={inputCls} /></Field>
              <Field label="Prezime"><input name="lastName" className={inputCls} /></Field>
              <Field label="Naziv (pravno lice)"><input name="orgName" className={inputCls} /></Field>
              <Field label="E-mail"><input name="email" type="email" className={inputCls} /></Field>
              <Field label="Telefon"><input name="phone" className={inputCls} /></Field>
              <Field label="Adresa nekretnine"><input name="address" className={inputCls} /></Field>
              <Field label="Adresa za prepisku (ako je različita)"><input name="correspondenceAddress" className={inputCls} /></Field>
              <Field label="Korisnički nalog — e-mail (opciono)"><input name="accountEmail" type="email" className={inputCls} /></Field>
              <Field label="Početna lozinka"><input name="accountPassword" type="text" className={inputCls} /></Field>
              <div className="flex items-end"><SubmitBtn>Sačuvaj lice</SubmitBtn></div>
            </form>
          </details>
        )}
      </Card>

      {isPresident && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Dodaj vlasnički udio">
            <form action={addStakeAction} className="grid grid-cols-2 gap-3">
              <Field label="Jedinica">
                <select name="unitId" className={inputCls}>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.building.name} / {u.label}</option>)}
                </select>
              </Field>
              <Field label="Vlasnik">
                <select name="ownerId" className={inputCls}>
                  {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                </select>
              </Field>
              <Field label="Udio na jedinici (%)"><input name="sharePercent" required className={inputCls} placeholder="100 ili 50" /></Field>
              <Field label="Važi od"><input name="validFrom" type="date" required className={inputCls} /></Field>
              <div className="col-span-2"><SubmitBtn>Dodaj udio</SubmitBtn></div>
            </form>
          </Card>
          <Card title="Promjena vlasništva (promet jedinice)">
            <p className="mb-3 text-xs text-slate-500">
              Istorijski dug ostaje na prethodnom vlasniku; prenos duga moguć je samo izričitom korekcijom salda.
            </p>
            <form action={transferAction} className="grid grid-cols-2 gap-3">
              <Field label="Jedinica">
                <select name="unitId" className={inputCls}>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.building.name} / {u.label}</option>)}
                </select>
              </Field>
              <Field label="Dosadašnji vlasnik">
                <select name="fromOwnerId" className={inputCls}>
                  {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                </select>
              </Field>
              <Field label="Novi vlasnik">
                <select name="toOwnerId" className={inputCls}>
                  {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                </select>
              </Field>
              <Field label="Datum prenosa"><input name="effectiveDate" type="date" required className={inputCls} /></Field>
              <Field label="Napomena / osnov"><input name="note" className={inputCls} placeholder="kupoprodajni ugovor br..." /></Field>
              <div className="flex items-end"><SubmitBtn variant="danger">Evidentiraj prenos</SubmitBtn></div>
            </form>
          </Card>
          <Card title="Evidentiraj stanara / zakupca">
            <p className="mb-3 text-xs text-slate-500">Stanar ili zakupac NE stiče pravo glasa stanovanjem.</p>
            <form action={addOccupancyAction} className="grid grid-cols-2 gap-3">
              <Field label="Jedinica">
                <select name="unitId" className={inputCls}>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.building.name} / {u.label}</option>)}
                </select>
              </Field>
              <Field label="Lice">
                <select name="partyId" className={inputCls}>
                  {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                </select>
              </Field>
              <Field label="Vrsta">
                <select name="type" className={inputCls}>
                  <option value="OWNER_OCCUPANT">Vlasnik stanuje</option>
                  <option value="TENANT">Zakupac</option>
                  <option value="OTHER_OCCUPANT">Korisnik</option>
                </select>
              </Field>
              <Field label="Broj lica u domaćinstvu"><input name="headcount" type="number" defaultValue={1} className={inputCls} /></Field>
              <Field label="Od datuma"><input name="validFrom" type="date" required className={inputCls} /></Field>
              <div className="flex items-end"><SubmitBtn>Evidentiraj</SubmitBtn></div>
            </form>
          </Card>
          <Card title="Punomoći">
            <Table headers={["Davalac", "Punomoćnik", "Obim", "Važi od", "Važi do"]} empty={proxies.length === 0}>
              {proxies.map((p) => (
                <tr key={p.id}>
                  <Td>{partyDisplayName(p.grantor)}</Td>
                  <Td>{partyDisplayName(p.holder)}</Td>
                  <Td>{p.scope === "ALL" ? "Sve sjednice" : p.scope === "MEETING" ? "Jedna sjednica" : "Jedan prijedlog"}</Td>
                  <Td>{formatDate(p.validFrom)}</Td>
                  <Td>{p.validTo ? formatDate(p.validTo) : "neograničeno"}</Td>
                </tr>
              ))}
            </Table>
            <form action={grantProxyAction} className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Davalac (vlasnik)">
                <select name="grantorId" className={inputCls}>
                  {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                </select>
              </Field>
              <Field label="Punomoćnik">
                <select name="holderId" className={inputCls}>
                  {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                </select>
              </Field>
              <Field label="Obim">
                <select name="scope" className={inputCls}>
                  <option value="ALL">Sve sjednice</option>
                  <option value="MEETING">Jedna sjednica</option>
                </select>
              </Field>
              <Field label="Referenca dokumenta"><input name="documentRef" className={inputCls} placeholder="ovjerena punomoć br..." /></Field>
              <Field label="Važi od"><input name="validFrom" type="date" required className={inputCls} /></Field>
              <Field label="Važi do (opciono)"><input name="validTo" type="date" className={inputCls} /></Field>
              <div className="col-span-2"><SubmitBtn>Evidentiraj punomoć</SubmitBtn></div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
