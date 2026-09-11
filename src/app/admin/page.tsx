import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSuperAdminActor } from "@/server/actor";
import { listTenants, createTenant } from "@/server/services/admin";
import { switchActiveZev } from "@/server/services/memberships";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";
import { PasswordField } from "@/components/password-field";
import { t } from "@/lib/i18n";

const TIER_LABELS: Record<string, string> = {
  BASIC: "Basic",
  BASIC_FINANCE: "Basic + finansije",
  FULL: "Full (+ e-glasanje)",
};

async function createTenantAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  let zev;
  try {
    zev = await createTenant(actor, {
      legalName: String(formData.get("legalName") ?? ""),
      shortName: (formData.get("shortName") as string) || null,
      jib: (formData.get("jib") as string) || null,
      registeredAddress: (formData.get("registeredAddress") as string) || null,
      city: (formData.get("city") as string) || null,
      municipality: (formData.get("municipality") as string) || null,
      tier: formData.get("tier") as never,
      presidentFirstName: String(formData.get("presidentFirstName") ?? ""),
      presidentLastName: String(formData.get("presidentLastName") ?? ""),
      presidentEmail: String(formData.get("presidentEmail") ?? ""),
      presidentPhone: (formData.get("presidentPhone") as string) || null,
      presidentPassword: String(formData.get("presidentPassword") ?? ""),
    });
  } catch (e) {
    redirect(`/admin?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/admin/${zev.id}`);
}

async function enterZevAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const zevId = String(formData.get("zevId") ?? "");
  try {
    await switchActiveZev(actor, zevId);
  } catch (e) {
    redirect(`/admin?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect("/");
}

export default async function AdminHomePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireSuperAdminActor();
  const { err } = await searchParams;
  const tenants = await listTenants(actor);
  return (
    <div>
      <PageHeader title="ZEV nalozi" subtitle={`Prijavljeni kao ${actor.email}`} />
      <Flash err={err} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Svi ZEV nalozi" className="lg:col-span-2">
          <Table
            headers={["Naziv", "Paket", "Predsjednik", "Zgrade", "Vlasnici", "Status", ""]}
            empty={tenants.length === 0}
          >
            {tenants.map((z) => {
              const president = z.memberships[0]?.user;
              return (
                <tr key={z.id}>
                  <Td>
                    <Link href={`/admin/${z.id}`} className="font-medium text-blue-700 hover:underline">
                      {z.legalName}
                    </Link>
                    {z.shortName && <div className="text-xs text-slate-400">{z.shortName}</div>}
                  </Td>
                  <Td>{TIER_LABELS[z.tier] ?? z.tier}</Td>
                  <Td>{president?.email ?? "—"}</Td>
                  <Td right>{z._count.buildings}</Td>
                  <Td right>{z._count.parties}</Td>
                  <Td>
                    <StatusBadge status={z.active ? "ACTIVE" : "SUSPENDED"} label={z.active ? "Aktivan" : "Suspendovan"} />
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/${z.id}`} className="text-blue-700 hover:underline">
                        Detalji
                      </Link>
                      {z.hasMyMembership && (
                        <form action={enterZevAction}>
                          <input type="hidden" name="zevId" value={z.id} />
                          <button type="submit" className="text-blue-700 hover:underline">
                            {t("tenant.enter")}
                          </button>
                        </form>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title="Novi ZEV nalog">
          <form action={createTenantAction} className="space-y-3">
            <Field label="Naziv ZEV-a">
              <input name="legalName" required className={inputCls} placeholder="Zajednica etažnih vlasnika..." />
            </Field>
            <Field label="Skraćeni naziv" hint="opciono">
              <input name="shortName" className={inputCls} />
            </Field>
            <Field label="Paket">
              <select name="tier" className={inputCls} defaultValue="FULL">
                <option value="BASIC">Basic</option>
                <option value="BASIC_FINANCE">Basic + finansije</option>
                <option value="FULL">Full (+ e-glasanje)</option>
              </select>
            </Field>
            <Field label="JIB" hint="opciono">
              <input name="jib" className={inputCls} />
            </Field>
            <Field label="Adresa sjedišta" hint="opciono">
              <input name="registeredAddress" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Grad" hint="opciono">
                <input name="city" className={inputCls} />
              </Field>
              <Field label="Opština" hint="opciono">
                <input name="municipality" className={inputCls} />
              </Field>
            </div>
            <hr className="border-slate-200" />
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Predsjednik</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ime">
                <input name="presidentFirstName" required className={inputCls} />
              </Field>
              <Field label="Prezime">
                <input name="presidentLastName" required className={inputCls} />
              </Field>
            </div>
            <Field label="E-mail">
              <input name="presidentEmail" type="email" required className={inputCls} />
            </Field>
            <Field label="Telefon" hint="opciono">
              <input name="presidentPhone" className={inputCls} />
            </Field>
            <Field label="Početna lozinka" hint="bar 8 znakova — saopštite je predsjedniku odvojenim putem">
              <PasswordField name="presidentPassword" required />
            </Field>
            <SubmitBtn>Kreiraj ZEV nalog</SubmitBtn>
          </form>
        </Card>
      </div>
    </div>
  );
}
