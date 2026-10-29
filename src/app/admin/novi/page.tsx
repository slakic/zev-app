import { redirect } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import { createTenant } from "@/server/services/admin";
import { PageHeader, Card, Field, inputCls, SubmitBtn, Flash, ToggleBtn } from "@/components/ui";
import { PasswordField } from "@/components/password-field";
import { InviteForm } from "@/components/invite-form";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";

const TIER_OPTIONS = [
  { value: "BASIC", label: "Basic" },
  { value: "BASIC_FINANCE", label: "Basic + finansije" },
  { value: "FULL", label: "Full (+ e-glasanje)" },
];

// Forma „Novi ZEV nalog” je dobila svoju stranicu (F9, X-R16): lista naloga na /admin je prvo,
// a kreiranje je rijetka radnja iza jednog `primary` dugmeta u zaglavlju liste. Od v2.57.0 stranica
// nudi dva puta (Plans/zev-onboarding-wizard-plan.md §3.1, mockup O-M01): poziv klijentu (čarobnjak,
// iza ONBOARDING_INVITES_ENABLED dok ne može da objavi ZEV) i asistirano kreiranje — današnja forma.
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

function AssistedForm() {
  return (
    <form action={createTenantAction} className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
      <Field label="Naziv ZEV-a">
        <input name="legalName" required className={inputCls} placeholder="Zajednica etažnih vlasnika..." />
      </Field>
      <Field label="Skraćeni naziv" hint="opciono">
        <input name="shortName" className={inputCls} />
      </Field>
      <Field label="Paket">
        <select name="tier" className={inputCls} defaultValue="FULL">
          {TIER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="JIB" hint="opciono, 13 cifara">
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
  );
}

export default async function AdminNewTenantPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireSuperAdminActor();
  const { err } = await searchParams;
  const invitesEnabled = getEnv().ONBOARDING_INVITES_ENABLED === "true";
  if (!invitesEnabled) {
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
          <AssistedForm />
        </Card>
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title={t("onboarding.newPage.title")}
        subtitle={t("onboarding.newPage.subtitle")}
        backHref="/admin"
        backLabel={t("admin.newTenant.back")}
      />
      <Flash err={err} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title={t("onboarding.newPage.inviteTitle")}>
          <p className="max-w-[68ch] text-sm text-slate-700">{t("onboarding.newPage.inviteBody")}</p>
          <details className="group mt-4">
            <ToggleBtn variant="secondary">{t("onboarding.newPage.inviteToggle")}</ToggleBtn>
            <div className="mt-4">
              <InviteForm tierOptions={TIER_OPTIONS} />
            </div>
          </details>
        </Card>
        <Card title={t("onboarding.newPage.assistedTitle")}>
          <p className="max-w-[68ch] text-sm text-slate-700">{t("onboarding.newPage.assistedBody")}</p>
          <details className="group mt-4" open={Boolean(err)}>
            <ToggleBtn variant="secondary">{t("onboarding.newPage.assistedToggle")}</ToggleBtn>
            <div className="mt-4">
              <AssistedForm />
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
