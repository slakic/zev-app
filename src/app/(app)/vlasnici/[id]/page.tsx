import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { getParty, partyDisplayName, updateParty } from "@/server/services/ownership";
import { updateUserRoles, activateUser, deactivateUser } from "@/server/services/users";
import { ownerBalance, ownerAdvance } from "@/server/services/payments";
import { formatDate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { PageHeader, Card, Table, Td, Stat, BtnLink, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";
import type { Role, Prisma } from "@/generated/prisma/client";

const ROLE_LABELS: Record<Role, string> = { PRESIDENT: "Predsjednik", ACCOUNTANT: "Računovođa", OWNER: "Vlasnik" };
const ALL_ROLES: Role[] = ["PRESIDENT", "ACCOUNTANT", "OWNER"];

async function updatePartyAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  const id = String(formData.get("id"));
  const isPresident = actor.roles.includes("PRESIDENT");
  const data: Prisma.PartyUpdateInput = {
    email: (formData.get("email") as string) || null,
    phone: (formData.get("phone") as string) || null,
    correspondenceAddress: (formData.get("correspondenceAddress") as string) || null,
    ...(isPresident
      ? {
          firstName: (formData.get("firstName") as string) || null,
          lastName: (formData.get("lastName") as string) || null,
          orgName: (formData.get("orgName") as string) || null,
          address: (formData.get("address") as string) || null,
        }
      : {}),
  };
  try {
    await updateParty(actor, id, data);
  } catch (e) {
    redirect(`/vlasnici/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/vlasnici/${id}?msg=saved`);
}

async function updateRolesAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("id"));
  const userId = String(formData.get("userId"));
  const roles = formData.getAll("roles") as Role[];
  try {
    await updateUserRoles(actor, userId, roles);
  } catch (e) {
    redirect(`/vlasnici/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/vlasnici/${id}?msg=saved`);
}

async function toggleActiveAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("id"));
  const userId = String(formData.get("userId"));
  const nextActive = formData.get("nextActive") === "1";
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    redirect(`/vlasnici/${id}?err=${encodeURIComponent("Razlog je obavezan.")}`);
  }
  try {
    if (nextActive) {
      await activateUser(actor, userId, reason);
    } else {
      await deactivateUser(actor, userId, reason);
    }
  } catch (e) {
    redirect(`/vlasnici/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/vlasnici/${id}?msg=saved`);
}

export default async function PartyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ err?: string; msg?: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const { err, msg } = await searchParams;
  const party = await getParty(actor, id);
  const [balance, advance] = await Promise.all([ownerBalance(actor, id), ownerAdvance(actor, id)]);
  const isPresident = actor.roles.includes("PRESIDENT");
  const isSelf = actor.partyId === id;
  const canEditContact = isPresident || isSelf;
  const okMsg = msg === "saved" ? "Sačuvano." : undefined;

  return (
    <div>
      <PageHeader
        title={partyDisplayName(party)}
        subtitle={party.kind === "PERSON" ? "Fizičko lice" : "Pravno lice"}
        backHref={isPresident || actor.roles.includes("ACCOUNTANT") ? "/vlasnici" : undefined}
        backLabel="Nazad na vlasnike i korisnike"
        actions={<BtnLink href={`/api/dokumenti/kartica/${party.id}`} variant="secondary">Kartica vlasnika (PDF)</BtnLink>}
      />
      <Flash err={err} msg={okMsg} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo (duguje)" value={formatMoney(balance.balance)} tone={Number(balance.balance) > 0 ? "warn" : "ok"} />
        <Stat label="Zaduženo" value={formatMoney(balance.charged)} tone="neutral" />
        <Stat label="Plaćeno" value={formatMoney(balance.paid)} tone="ok" />
        <Stat label="Avans" value={formatMoney(advance)} tone="neutral" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Kontakt">
          {canEditContact ? (
            <form action={updatePartyAction} className="space-y-3">
              <input type="hidden" name="id" value={party.id} />
              {isPresident && party.kind === "PERSON" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Ime"><input name="firstName" defaultValue={party.firstName ?? ""} className={inputCls} /></Field>
                  <Field label="Prezime"><input name="lastName" defaultValue={party.lastName ?? ""} className={inputCls} /></Field>
                </div>
              )}
              {isPresident && party.kind === "ORGANIZATION" && (
                <Field label="Naziv"><input name="orgName" defaultValue={party.orgName ?? ""} className={inputCls} /></Field>
              )}
              <Field label="E-mail"><input name="email" type="email" defaultValue={party.email ?? ""} className={inputCls} /></Field>
              <Field label="Telefon"><input name="phone" defaultValue={party.phone ?? ""} className={inputCls} /></Field>
              {isPresident && (
                <Field label="Adresa nekretnine"><input name="address" defaultValue={party.address ?? ""} className={inputCls} /></Field>
              )}
              <Field label="Adresa za prepisku (ako je različita)">
                <input name="correspondenceAddress" defaultValue={party.correspondenceAddress ?? ""} className={inputCls} />
              </Field>
              {!isPresident && (
                <p className="text-xs text-slate-400">Kao vlasnik možete mijenjati samo svoje kontakt podatke.</p>
              )}
              <SubmitBtn>Sačuvaj</SubmitBtn>
            </form>
          ) : (
            <dl className="space-y-1 text-sm">
              <div><dt className="inline font-medium">E-mail: </dt><dd className="inline">{party.email ?? "—"}</dd></div>
              <div><dt className="inline font-medium">Telefon: </dt><dd className="inline">{party.phone ?? "—"}</dd></div>
              <div><dt className="inline font-medium">Adresa: </dt><dd className="inline">{party.address ?? "—"}</dd></div>
              <div><dt className="inline font-medium">Adresa za prepisku: </dt><dd className="inline">{party.correspondenceAddress ?? party.address ?? "—"}</dd></div>
            </dl>
          )}
        </Card>
        <Card title="Vlasnički udjeli (istorija se čuva)">
          <Table headers={["Jedinica", "Udio %", "Od", "Do"]} empty={party.ownershipStakes.length === 0}>
            {party.ownershipStakes.map((s) => (
              <tr key={s.id} className={s.validTo ? "text-slate-400" : ""}>
                <Td>{s.unit.building.name} / {s.unit.label}</Td>
                <Td right>{s.sharePercent.toString()}</Td>
                <Td>{formatDate(s.validFrom)}</Td>
                <Td>{s.validTo ? formatDate(s.validTo) : "aktivno"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Korištenje jedinica">
          <Table headers={["Jedinica", "Vrsta", "Od", "Do"]} empty={party.occupancies.length === 0}>
            {party.occupancies.map((o) => (
              <tr key={o.id}>
                <Td>{o.unit.label}</Td>
                <Td>{o.type === "OWNER_OCCUPANT" ? "Vlasnik stanuje" : o.type === "TENANT" ? "Zakupac" : "Korisnik"}</Td>
                <Td>{formatDate(o.validFrom)}</Td>
                <Td>{o.validTo ? formatDate(o.validTo) : "aktivno"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Punomoći">
          <div className="text-sm">
            <p className="font-medium">Date punomoći:</p>
            <ul className="mb-2 list-inside list-disc text-slate-600">
              {party.proxiesGiven.length === 0 && <li className="list-none text-slate-400">Nema</li>}
              {party.proxiesGiven.map((p) => (
                <li key={p.id}>{partyDisplayName(p.holder)} — {p.revokedAt ? "OPOZVANA" : "aktivna"} od {formatDate(p.validFrom)}</li>
              ))}
            </ul>
            <p className="font-medium">Primljene punomoći:</p>
            <ul className="list-inside list-disc text-slate-600">
              {party.proxiesHeld.length === 0 && <li className="list-none text-slate-400">Nema</li>}
              {party.proxiesHeld.map((p) => (
                <li key={p.id}>za {partyDisplayName(p.grantor)} — {p.revokedAt ? "OPOZVANA" : "aktivna"}</li>
              ))}
            </ul>
          </div>
        </Card>
        {isPresident && party.user && (
          <Card title="Korisnički nalog">
            <p className="mb-3 text-sm">
              <span className="font-medium">{party.user.email}</span>{" "}
              {party.user.active ? (
                <span className="text-emerald-700">(aktivan)</span>
              ) : (
                <span className="text-red-700">(deaktiviran)</span>
              )}
            </p>
            <form action={updateRolesAction} className="mb-4 space-y-2 border-b border-slate-100 pb-4">
              <input type="hidden" name="id" value={party.id} />
              <input type="hidden" name="userId" value={party.user.id} />
              <fieldset className="space-y-1 text-sm">
                <legend className="mb-1 font-medium text-slate-700">Role naloga</legend>
                {ALL_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2">
                    <input type="checkbox" name="roles" value={r} defaultChecked={party.user!.roles.includes(r)} />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
              </fieldset>
              <SubmitBtn variant="secondary">Sačuvaj role</SubmitBtn>
            </form>
            <form action={toggleActiveAction} className="space-y-2">
              <input type="hidden" name="id" value={party.id} />
              <input type="hidden" name="userId" value={party.user.id} />
              <input type="hidden" name="nextActive" value={party.user.active ? "0" : "1"} />
              <Field label="Razlog" hint="Obavezno; upisuje se u evidenciju (audit log).">
                <input
                  name="reason"
                  required
                  className={inputCls}
                  placeholder={party.user.active ? "npr. prodaja stana" : "npr. ponovo vlasnik / greškom deaktiviran"}
                />
              </Field>
              <SubmitBtn variant={party.user.active ? "danger" : "primary"}>
                {party.user.active ? "Deaktiviraj nalog" : "Aktiviraj nalog"}
              </SubmitBtn>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
