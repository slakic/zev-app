import { redirect } from "next/navigation";
import { requireZev } from "@/server/auth/guards";
import { requireActor } from "@/server/actor";
import { getParty, partyDisplayName, updateParty, votingRoleByUnit, endOwnershipStake, unitOwnershipWarnings } from "@/server/services/ownership";
import { updateUserRoles, activateUser, deactivateUser } from "@/server/services/users";
import { ownerBalance, ownerAdvance } from "@/server/services/payments";
import { listOwnershipProofsByStakeIds } from "@/server/services/attachments";
import { setInvoiceEmailDelivery } from "@/server/services/invoiceEmail";
import { markEVoteConsentSigned, revokeEVoteConsent, getEVoteConsentHistory } from "@/server/services/evoteConsent";
import { formatDate, formatDateTime, tEnum, t, tf, toZonedDateIso } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { shareSumChip } from "@/lib/shareSum";
import { ProofFileField } from "@/components/proof-file-field";
import { PageHeader, Card, Table, Td, Stat, BtnLink, StatusBadge, Field, inputCls, SubmitBtn, ConfirmAction, Flash, RowActionLink, RowLink, ToggleBtn, type ColumnSpec } from "@/components/ui";
import type { Role, Prisma } from "@/generated/prisma/client";

const occupancyHeaders: ColumnSpec[] = [
  { label: "Jedinica" },
  { label: "Vrsta" },
  { label: "Od" },
  { label: "Do" },
];

const stakeHeaders: ColumnSpec[] = [
  { label: "Jedinica" },
  { label: "Udio %", align: "right" },
  { label: "Glasanje" },
  { label: "Od" },
  { label: "Do" },
  { label: "Dokaz o vlasništvu" },
];
const stakeActionHeader: ColumnSpec = { label: "Radnje", actions: true };

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

/** v2.43.1: closes one active stake without creating a new one ("Zatvori udio"). */
async function endStakeAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("partyId"));
  try {
    await endOwnershipStake(actor, String(formData.get("stakeId")), {
      validTo: new Date(String(formData.get("validTo"))),
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (e) {
    redirect(`/vlasnici/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/vlasnici/${id}?msg=stakeEnded`);
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

async function markConsentSignedAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const id = String(formData.get("id"));
  const file = formData.get("scanFile") as File | null;
  if (!file || file.size === 0) {
    redirect(`/vlasnici/${id}?err=${encodeURIComponent("Skenirani dokument je obavezan.")}`);
  }
  try {
    await markEVoteConsentSigned(actor, id, {
      buffer: Buffer.from(await file!.arrayBuffer()),
      filename: file!.name,
      mime: file!.type,
    });
  } catch (e) {
    redirect(`/vlasnici/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/vlasnici/${id}?msg=saved`);
}

async function revokeConsentAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  const id = String(formData.get("id"));
  const reason = (formData.get("reason") as string) || null;
  try {
    await revokeEVoteConsent(actor, id, reason);
  } catch (e) {
    redirect(`/vlasnici/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect(`/vlasnici/${id}?msg=saved`);
}

async function setInvoiceEmailAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  const id = String(formData.get("id"));
  try {
    await setInvoiceEmailDelivery(actor, id, formData.get("invoiceEmail") === "on", {
      reason: (formData.get("reason") as string) || null,
    });
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
  const [balance, advance, proofsByStake, consentHistory, votingRoles] = await Promise.all([
    ownerBalance(actor, id),
    ownerAdvance(actor, id),
    listOwnershipProofsByStakeIds(actor, party.ownershipStakes.map((s) => s.id)),
    getEVoteConsentHistory(actor, id),
    votingRoleByUnit(actor, id),
  ]);
  const isPresident = actor.roles.includes("PRESIDENT");
  const isAccountant = actor.roles.includes("ACCOUNTANT");
  // F8.3: zbir udjela svake jedinice na kojoj lice ima aktivan udio (upozorenje = zbir ≠ 100 %, kao na tabu „Vlasništvo”).
  const shareWarningByUnit = new Map(
    (await unitOwnershipWarnings(requireZev(actor), party.ownershipStakes.filter((st) => !st.validTo).map((st) => st.unitId))).map((w) => [w.unitId, w]),
  );
  const isSelf = actor.partyId === id;
  const canEditContact = isPresident || isSelf;
  const okMsg = msg === "saved" ? "Sačuvano." : msg === "stakeEnded" ? t("ownershipEnd.done") : undefined;

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
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Vlasnički udjeli" hint="Istorija se čuva — raniji udjeli ostaju vidljivi." className="lg:col-span-2">
          <Table
            id="stakes-table"
            caption="Vlasnički udjeli"
            headers={isPresident ? [...stakeHeaders, stakeActionHeader] : stakeHeaders}
            empty={party.ownershipStakes.length === 0}
            emptyTitle={t("empty.stakes.title")}
            emptyHint={isPresident ? <BtnLink href="/vlasnici?tab=vlasnistvo" variant="tonal">Dodaj vlasnički udio</BtnLink> : undefined}
          >
            {party.ownershipStakes.map((s) => {
              const proof = proofsByStake.get(s.id);
              return (
                <tr key={s.id} className={s.validTo ? "text-slate-500" : ""}>
                  <Td>
                    {s.unit.building.name} / {s.unit.label}
                    {!s.validTo && (() => {
                      // F8.3: zbir udjela te jedinice (isti chip kao na tabu „Vlasništvo”).
                      const w = shareWarningByUnit.get(s.unitId);
                      const chip = w ? shareSumChip(w.sum, w.kind === "NONE" ? 0 : 1) : shareSumChip(100, 1);
                      return <StatusBadge status={chip.status} label={chip.label} />;
                    })()}
                  </Td>
                  <Td>{s.sharePercent.toString()}</Td>
                  <Td>
                    {s.validTo ? "—" : (() => {
                      const r = votingRoles.get(s.unitId);
                      if (!r) return "—";
                      return r.sole
                        ? t("register.vote.sole")
                        : r.noExtraVote
                          ? t("register.vote.noExtraVote")
                          : r.isRepresentative
                          ? t("register.vote.youRepresent")
                          : tf("register.vote.coOwner", { name: r.representativeName ?? "—" });
                    })()}
                  </Td>
                  <Td>{formatDate(s.validFrom)}</Td>
                  <Td>{s.validTo ? formatDate(s.validTo) : "aktivno"}</Td>
                  <Td>
                    {proof ? (
                      <RowActionLink href={`/api/prilozi/${proof.id}`}>dokument</RowActionLink>
                    ) : (
                      "—"
                    )}
                  </Td>
                  {isPresident && (
                    <Td>
                      {!s.validTo && (
                        <ConfirmAction
                          trigger={t("ownershipEnd.trigger")}
                          triggerVariant="caution"
                          title={t("ownershipEnd.title")}
                          body={
                            <p className="text-sm text-amber-900">
                              {tf("ownershipEnd.body", {
                                ime: partyDisplayName(party),
                                jedinica: s.unit.label,
                                // "100.000000" -> "100", "33.333300" -> "33,3333" (Number drops only trailing decimal zeros)
                                udio: String(Number(s.sharePercent.toString())).replace(".", ","),
                              })}
                            </p>
                          }
                          confirmLabel={t("ownershipEnd.confirm")}
                          confirmVariant="caution"
                          action={endStakeAction}
                          hiddenFields={{ stakeId: s.id, partyId: party.id }}
                        >
                          <Field label={t("ownershipEnd.dateLabel")} hint={t("ownershipEnd.dateHint")}>
                            <input name="validTo" type="date" required defaultValue={toZonedDateIso(new Date())} className={inputCls} />
                          </Field>
                          <Field label={t("ownershipEnd.reasonLabel")}>
                            <input name="reason" required className={inputCls} />
                          </Field>
                        </ConfirmAction>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </Table>
        </Card>
        <Card title="Punomoći">
          <div className="text-sm">
            <p className="font-medium">Date punomoći:</p>
            <ul className="mb-2 list-inside list-disc text-slate-600">
              {party.proxiesGiven.length === 0 && <li className="list-none text-slate-500">Nema</li>}
              {party.proxiesGiven.map((p) => (
                <li key={p.id}>{partyDisplayName(p.holder)} — {p.revokedAt ? "OPOZVANA" : "aktivna"} od {formatDate(p.validFrom)}</li>
              ))}
            </ul>
            <p className="font-medium">Primljene punomoći:</p>
            <ul className="list-inside list-disc text-slate-600">
              {party.proxiesHeld.length === 0 && <li className="list-none text-slate-500">Nema</li>}
              {party.proxiesHeld.map((p) => (
                <li key={p.id}>za {partyDisplayName(p.grantor)} — {p.revokedAt ? "OPOZVANA" : "aktivna"}</li>
              ))}
            </ul>
          </div>
        </Card>
        <Card title="Saglasnost za elektronsko glasanje">
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={party.eVoteConsentStatus} label={tEnum("eVoteConsentStatus", party.eVoteConsentStatus)} />
            </div>
            <dl className="space-y-1">
              <div><dt className="inline font-medium">E-mail na izjavi: </dt><dd className="inline">{party.eVoteConsentEmail ?? "—"}</dd></div>
              {consentHistory.signedAt && (
                <div><dt className="inline font-medium">Potpisana: </dt><dd className="inline">{formatDateTime(consentHistory.signedAt)}</dd></div>
              )}
              {consentHistory.revokedAt && (
                <div>
                  <dt className="inline font-medium">Povučena: </dt>
                  <dd className="inline">
                    {formatDateTime(consentHistory.revokedAt)}
                    {consentHistory.revokeReason ? ` — ${consentHistory.revokeReason}` : ""}
                  </dd>
                </div>
              )}
              {party.eVoteConsentDocumentId && (
                <div>
                  <dt className="inline font-medium">Skenirani dokument: </dt>
                  <dd className="inline">
                    <RowLink href={`/api/prilozi/${party.eVoteConsentDocumentId}`}>pregledaj</RowLink>
                  </dd>
                </div>
              )}
            </dl>

            {(isPresident || isSelf) && (
              <p>
                <BtnLink href={`/api/dokumenti/saglasnost/${party.id}`} variant="secondary">
                  Preuzmi izjavu (PDF)
                </BtnLink>
              </p>
            )}

            {(isPresident || isAccountant) && (
              <form action={markConsentSignedAction} className="space-y-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="id" value={party.id} />
                <ProofFileField
                  name="scanFile"
                  label={t("ownerPage.scanLabel")}
                  buttonLabel={t("ownerPage.scanPick")}
                  hint={t("ownerPage.scanHint")}
                  accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
                  required
                />
                <SubmitBtn variant="secondary">Označi kao potpisanu i sačuvaj sken</SubmitBtn>
              </form>
            )}

            {(isPresident || isSelf) && party.eVoteConsentStatus !== "NONE" && party.eVoteConsentStatus !== "REVOKED" && (
              <div className="border-t border-slate-100 pt-3">
                <ConfirmAction
                  trigger="Povuci saglasnost za elektronsko glasanje"
                  title="Nakon opoziva vlasnik više neće moći da glasa elektronski"
                  body={<p className="text-sm text-amber-900">Saglasnost se može ponovo dati istim postupkom (izjava predsjedniku) u bilo kom trenutku.</p>}
                  confirmLabel="Da, povuci saglasnost"
                  action={revokeConsentAction}
                  hiddenFields={{ id: party.id }}
                >
                  <Field label="Razlog opoziva (opciono)">
                    <input name="reason" className={inputCls} />
                  </Field>
                </ConfirmAction>
              </div>
            )}
          </div>
        </Card>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Saldo (duguje)" value={formatMoney(balance.balance)} tone={Number(balance.balance) > 0 ? "warn" : "neutral"} />
          <Stat label="Zaduženo" value={formatMoney(balance.charged)} tone="neutral" />
          <Stat label="Plaćeno" value={formatMoney(balance.paid)} tone="ok" />
          <Stat label="Avans" value={formatMoney(advance)} tone="neutral" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Kontakt">
          <dl className="space-y-1 text-sm">
            <div><dt className="inline font-medium">E-mail: </dt><dd className="inline">{party.email ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Telefon: </dt><dd className="inline">{party.phone ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Adresa: </dt><dd className="inline">{party.address ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Adresa za prepisku: </dt><dd className="inline">{party.correspondenceAddress ?? party.address ?? "—"}</dd></div>
          </dl>
          {canEditContact && (
            <details className="group mt-4">
              <ToggleBtn>{t("ownerPage.editContact")}</ToggleBtn>
              <form action={updatePartyAction} className="mt-3 space-y-3">
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
                  <p className="text-[13px] text-slate-500">Kao vlasnik možete mijenjati samo svoje kontakt podatke.</p>
                )}
                <SubmitBtn variant="tonal">Sačuvaj</SubmitBtn>
              </form>
            </details>
          )}
        </Card>
        <Card title="Korištenje jedinica">
          <Table
            id="occupancies-table"
            caption="Korištenje jedinica"
            headers={occupancyHeaders}
            empty={party.occupancies.length === 0}
            emptyTitle={t("empty.occupancies.title")}
            emptyHint={isPresident ? <BtnLink href="/vlasnici?tab=vlasnistvo" variant="tonal">Evidentiraj korišćenje</BtnLink> : undefined}
          >
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
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Dostava računa e-poštom">
          <form action={setInvoiceEmailAction} className="space-y-3 text-sm">
            <input type="hidden" name="id" value={party.id} />
            <p className="text-slate-600">
              {party.invoiceEmailDelivery
                ? `Uključena${party.invoiceEmailDeliveryAt ? ` od ${formatDate(party.invoiceEmailDeliveryAt)}` : ""} — računi idu na ${party.email ?? "—"}.`
                : "Isključena."}
            </p>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="invoiceEmail" defaultChecked={party.invoiceEmailDelivery} disabled={!party.email && !party.invoiceEmailDelivery} className="mt-1" />
              <span>{isSelf ? "Dostavi mi račun putem e-maila" : "Dostavljaj račune ovom vlasniku putem e-maila"}</span>
            </label>
            {!party.email && !party.invoiceEmailDelivery && (
              <p className="text-slate-600">Prvo upišite e-mail adresu u kartici „Kontakt”.</p>
            )}
            {!isSelf && (
              <Field label="Napomena (npr. pisani zahtjev vlasnika)">
                <input name="reason" className={inputCls} />
              </Field>
            )}
            <p className="text-[13px] text-slate-500">
              {isSelf ? "Promjena se bilježi u revizorski trag." : "Uključite samo na zahtjev vlasnika. Promjena se bilježi u revizorski trag."}
            </p>
            <SubmitBtn variant="tonal">Sačuvaj</SubmitBtn>
          </form>
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
    </div>
  );
}
