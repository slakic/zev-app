import { redirect } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import { createTenant } from "@/server/services/admin";
import { PageHeader, Card, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";
import { PasswordField } from "@/components/password-field";
import { t } from "@/lib/i18n";

// Forma „Novi ZEV nalog” je dobila svoju stranicu (F9, X-R16): lista naloga na /admin je prvo,
// a kreiranje je rijetka radnja iza jednog `primary` dugmeta u zaglavlju liste.
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
    redirect(`/admin/novi?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/admin/${zev.id}`);
}

export default async function AdminNewTenantPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireSuperAdminActor();
  const { err } = await searchParams;
  return (
    <div>
      <PageHeader
        title={t("admin.newTenant.title")}
        subtitle={t("admin.newTenant.subtitle")}
        backHref="/admin"
        backLabel={t("admin.newTenant.back")}
      />
      <Flash err={err} />
      <Card>
        <form action={createTenantAction} className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
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
          <h2 className="border-t border-slate-200 pt-3 text-sm font-semibold text-slate-700 md:col-span-2">Predsjednik</h2>
          <Field label="Ime">
            <input name="presidentFirstName" required className={inputCls} />
          </Field>
          <Field label="Prezime">
            <input name="presidentLastName" required className={inputCls} />
          </Field>
          <Field label="E-mail">
            <input name="presidentEmail" type="email" required className={inputCls} />
          </Field>
          <Field label="Telefon" hint="opciono">
            <input name="presidentPhone" className={inputCls} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Početna lozinka" hint="bar 8 znakova — saopštite je predsjedniku odvojenim putem">
              <PasswordField name="presidentPassword" required />
            </Field>
          </div>
          <div className="flex justify-end border-t border-slate-200 pt-3 md:col-span-2">
            <SubmitBtn>Kreiraj ZEV nalog</SubmitBtn>
          </div>
        </form>
      </Card>
    </div>
  );
}
