import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSuperAdminActor } from "@/server/actor";
import { getTenant, setTenantActive, createTenantAccount, grantMembership, revokeMembership } from "@/server/services/admin";
import { switchActiveZev } from "@/server/services/memberships";
import { formatDate, t } from "@/lib/i18n";
import { PasswordField } from "@/components/password-field";
import { PageHeader, Card, Table, Td, Stat, StatusBadge, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";
import type { Role } from "@/generated/prisma/client";

const TIER_LABELS: Record<string, string> = {
  BASIC: "Basic",
  BASIC_FINANCE: "Basic + finansije",
  FULL: "Full (+ e-glasanje)",
};

const ROLE_LABELS: Record<Role, string> = { PRESIDENT: "Predsjednik", ACCOUNTANT: "Računovođa", OWNER: "Vlasnik" };

async function setActiveAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const zevId = String(formData.get("zevId"));
  const active = formData.get("active") === "true";
  try {
    await setTenantActive(actor, zevId, active, String(formData.get("reason") || ""));
  } catch (e) {
    redirect(`/admin/${zevId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/admin/${zevId}`);
  redirect(`/admin/${zevId}?msg=${encodeURIComponent(active ? "ZEV je reaktiviran." : "ZEV je suspendovan.")}`);
}

async function enterZevAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const zevId = String(formData.get("zevId") ?? "");
  try {
    await switchActiveZev(actor, zevId);
  } catch (e) {
    redirect(`/admin/${zevId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect("/");
}

async function createAccountAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const zevId = String(formData.get("zevId") ?? "");
  try {
    await createTenantAccount(actor, zevId, {
      role: formData.get("role") as Role,
      firstName: (formData.get("firstName") as string) || null,
      lastName: (formData.get("lastName") as string) || null,
      orgName: (formData.get("orgName") as string) || null,
      email: String(formData.get("email") ?? ""),
      phone: (formData.get("phone") as string) || null,
      password: String(formData.get("password") ?? ""),
    });
  } catch (e) {
    redirect(`/admin/${zevId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/admin/${zevId}`);
  redirect(`/admin/${zevId}?msg=${encodeURIComponent("Nalog je kreiran.")}`);
}

async function grantExistingAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const zevId = String(formData.get("zevId") ?? "");
  try {
    await grantMembership(actor, zevId, {
      email: String(formData.get("email") ?? ""),
      role: formData.get("role") as Role,
      reason: (formData.get("reason") as string) || null,
    });
  } catch (e) {
    redirect(`/admin/${zevId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/admin/${zevId}`);
  redirect(`/admin/${zevId}?msg=${encodeURIComponent("Članstvo je dodijeljeno.")}`);
}

async function requestMyAccessAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const zevId = String(formData.get("zevId") ?? "");
  try {
    await grantMembership(actor, zevId, {
      email: actor.email,
      role: formData.get("role") as Role,
      reason: (formData.get("reason") as string) || null,
    });
  } catch (e) {
    redirect(`/admin/${zevId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/admin/${zevId}`);
  redirect(`/admin/${zevId}?msg=${encodeURIComponent("Dodijeljen vam je pristup.")}`);
}

async function revokeAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const zevId = String(formData.get("zevId") ?? "");
  try {
    await revokeMembership(actor, zevId, {
      userId: String(formData.get("userId") ?? ""),
      role: formData.get("role") as Role,
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (e) {
    redirect(`/admin/${zevId}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(`/admin/${zevId}`);
  redirect(`/admin/${zevId}?msg=${encodeURIComponent("Pristup je uklonjen.")}`);
}

export default async function AdminTenantDetailPage({ params, searchParams }: { params: Promise<{ zevId: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const actor = await requireSuperAdminActor();
  const { zevId } = await params;
  const { err, msg } = await searchParams;
  const zev = await getTenant(actor, zevId);
  const myMemberships = zev.memberships.filter((m) => m.userId === actor.userId);
  const hasNonAdminActivePresident = zev.memberships.some(
    (m) => m.role === "PRESIDENT" && m.user.active && !m.user.isSuperAdmin
  );

  return (
    <div>
      <PageHeader
        title={zev.legalName}
        subtitle={zev.shortName ?? undefined}
        backHref="/admin"
        backLabel="Svi ZEV nalozi"
        actions={<StatusBadge status={zev.active ? "ACTIVE" : "SUSPENDED"} label={zev.active ? "Aktivan" : "Suspendovan"} />}
      />
      <Flash err={err} msg={msg} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Paket" value={TIER_LABELS[zev.tier] ?? zev.tier} />
        <Stat label="Zgrade" value={String(zev._count.buildings)} />
        <Stat label="Jedinice" value={String(zev._count.units)} />
        <Stat label="Vlasnici/stranke" value={String(zev._count.parties)} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Matični podaci">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">JIB</dt>
              <dd>{zev.jib ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Matični broj</dt>
              <dd>{zev.registrationNumber ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Adresa sjedišta</dt>
              <dd>{zev.registeredAddress ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Grad / opština</dt>
              <dd>{[zev.city, zev.municipality].filter(Boolean).join(" / ") || "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Kreiran</dt>
              <dd>{formatDate(zev.createdAt)}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Nalozi u ovom ZEV-u">
          {!hasNonAdminActivePresident && (
            <div className="mb-3">
              <Flash err={t("tenant.noActivePresidentWarning")} />
            </div>
          )}
          <Table headers={["Korisnik", "Rola", "Nalog aktivan", "Član od", ""]} empty={zev.memberships.length === 0}>
            {zev.memberships.map((m) => (
              <tr key={m.id}>
                <Td>
                  {m.user.email}
                  {m.user.isSuperAdmin && (
                    <span className="ml-2">
                      <StatusBadge status="PLATFORM_ADMIN" label={t("tenant.platformAdmin")} />
                    </span>
                  )}
                </Td>
                <Td>{ROLE_LABELS[m.role]}</Td>
                <Td>
                  <StatusBadge status={m.user.active ? "ACTIVE" : "SUSPENDED"} label={m.user.active ? "Da" : "Ne"} />
                </Td>
                <Td>{formatDate(m.createdAt)}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-3">
                    {m.userId === actor.userId && (
                      <form action={enterZevAction}>
                        <input type="hidden" name="zevId" value={zev.id} />
                        <button type="submit" className="text-blue-700 hover:underline">
                          {t("tenant.enterThisZev")}
                        </button>
                      </form>
                    )}
                    <form action={revokeAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="zevId" value={zev.id} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <input type="hidden" name="role" value={m.role} />
                      <input
                        name="reason"
                        required
                        placeholder={t("tenant.revokeReasonPlaceholder")}
                        className={`${inputCls} w-36 py-1 text-xs`}
                      />
                      <button type="submit" className="text-red-700 hover:underline">
                        {t("tenant.revokeAccess")}
                      </button>
                    </form>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={t("tenant.addAccountTitle")}>
          <form action={createAccountAction} className="space-y-3">
            <input type="hidden" name="zevId" value={zev.id} />
            <Field label="Rola">
              <select name="role" className={inputCls} defaultValue="ACCOUNTANT">
                <option value="PRESIDENT">{ROLE_LABELS.PRESIDENT}</option>
                <option value="ACCOUNTANT">{ROLE_LABELS.ACCOUNTANT}</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ime" hint="ili naziv organizacije ispod">
                <input name="firstName" className={inputCls} />
              </Field>
              <Field label="Prezime">
                <input name="lastName" className={inputCls} />
              </Field>
            </div>
            <Field label="Naziv organizacije" hint="opciono, umjesto imena/prezimena">
              <input name="orgName" className={inputCls} />
            </Field>
            <Field label="E-mail">
              <input name="email" type="email" required className={inputCls} />
            </Field>
            <Field label="Telefon" hint="opciono">
              <input name="phone" className={inputCls} />
            </Field>
            <Field label="Početna lozinka" hint="bar 8 znakova">
              <PasswordField name="password" required />
            </Field>
            <SubmitBtn>{t("common.add")}</SubmitBtn>
          </form>
        </Card>

        <Card title={t("tenant.addExistingTitle")}>
          <form action={grantExistingAction} className="space-y-3">
            <input type="hidden" name="zevId" value={zev.id} />
            <Field label="E-mail postojećeg naloga">
              <input name="email" type="email" required className={inputCls} />
            </Field>
            <Field label="Rola">
              <select name="role" className={inputCls} defaultValue="ACCOUNTANT">
                <option value="PRESIDENT">{ROLE_LABELS.PRESIDENT}</option>
                <option value="ACCOUNTANT">{ROLE_LABELS.ACCOUNTANT}</option>
              </select>
            </Field>
            <Field label="Razlog" hint="opciono">
              <input name="reason" className={inputCls} />
            </Field>
            <SubmitBtn>{t("common.add")}</SubmitBtn>
          </form>
        </Card>

        <Card title={t("tenant.myAccessTitle")}>
          {myMemberships.length > 0 ? (
            <>
              <p className="mb-3 text-sm text-slate-600">
                {t("tenant.myAccessGranted")}
                {myMemberships.map((m) => ROLE_LABELS[m.role]).join(", ")}
              </p>
              <form action={enterZevAction} className="mb-3">
                <input type="hidden" name="zevId" value={zev.id} />
                <SubmitBtn variant="secondary">{t("tenant.enterThisZev")}</SubmitBtn>
              </form>
              <div className="space-y-2">
                {myMemberships.map((m) => (
                  <form key={m.id} action={revokeAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="zevId" value={zev.id} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <input type="hidden" name="role" value={m.role} />
                    <input
                      name="reason"
                      required
                      placeholder={t("tenant.revokeReasonPlaceholder")}
                      className={`${inputCls} py-1 text-xs`}
                    />
                    <button type="submit" className="shrink-0 text-sm text-red-700 hover:underline">
                      {t("tenant.removeMyAccess")} ({ROLE_LABELS[m.role]})
                    </button>
                  </form>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">{t("tenant.myAccessNone")}</p>
              <form action={requestMyAccessAction} className="space-y-3">
                <input type="hidden" name="zevId" value={zev.id} />
                <Field label="Rola">
                  <select name="role" className={inputCls} defaultValue="PRESIDENT">
                    <option value="PRESIDENT">{ROLE_LABELS.PRESIDENT}</option>
                    <option value="ACCOUNTANT">{ROLE_LABELS.ACCOUNTANT}</option>
                  </select>
                </Field>
                <Field label="Razlog" hint="opciono">
                  <input name="reason" className={inputCls} />
                </Field>
                <SubmitBtn variant="secondary">{t("tenant.requestMyAccess")}</SubmitBtn>
              </form>
            </>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title={zev.active ? "Suspenzija" : "Reaktivacija"}>
          {zev.active ? (
            <>
              <p className="mb-3 text-sm text-slate-600">
                Suspenzija odmah blokira prijavu svih naloga u ovom ZEV-u (postojeće sesije se
                prekidaju na sljedećem zahtjevu) — bez brisanja ijednog podatka. Koristi ovo za
                arhiviranje tenanta koji više ne koristiš (npr. demo podaci) prije nego kreiraš
                novi, prazan ZEV za stvarne podatke.
              </p>
              <form action={setActiveAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="zevId" value={zev.id} />
                <input type="hidden" name="active" value="false" />
                <Field label="Razlog suspenzije"><input name="reason" required className={inputCls} /></Field>
                <SubmitBtn variant="danger">Suspenduj ZEV</SubmitBtn>
              </form>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">Nalozi u ovom ZEV-u trenutno ne mogu da se prijave.</p>
              <form action={setActiveAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="zevId" value={zev.id} />
                <input type="hidden" name="active" value="true" />
                <Field label="Razlog reaktivacije"><input name="reason" required className={inputCls} /></Field>
                <SubmitBtn>Reaktiviraj ZEV</SubmitBtn>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
