import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { listParties, createParty, partyDisplayName, addOwnershipStake, setOccupancy, grantProxy, transferOwnership, setVotingRepresentative } from "@/server/services/ownership";
import { getUnitRegister } from "@/server/services/unitRegister";
import { createUserForParty } from "@/server/services/users";
import { listUnits, getZev } from "@/server/services/property";
import { prisma } from "@/lib/prisma";
import { parseMoneyInput, formatMoney } from "@/lib/money";
import { formatDate, t, tf, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, Field, inputCls, SubmitBtn, Flash, ToggleBtn, RowLink, Tabs, FilterBar, BtnLink, StatusBadge, type ColumnSpec } from "@/components/ui";
import { PreconditionList } from "@/components/precondition-list";
import { ProofFileField } from "@/components/proof-file-field";
import { shareSumChip, sumShares } from "@/lib/shareSum";
import { RepresentativeChange } from "@/components/representative-change";
import { registerWarningTexts } from "@/lib/registerWarnings";
import { PasswordField } from "@/components/password-field";
import { redirect } from "next/navigation";

const proxyHeaders: ColumnSpec[] = [
  { label: "Davalac" },
  { label: "Punomoćnik" },
  { label: "Obim" },
  { label: "Važi od" },
  { label: "Važi do" },
];

const partyHeaders: ColumnSpec[] = [
  { label: "Ime / naziv", priority: "primary", sortKey: "name" },
  { label: "Vrsta", priority: "detail" },
  { label: "E-mail", priority: "detail" },
  { label: "Račun e-poštom", priority: "detail" },
  { label: "Telefon", priority: "detail" },
  { label: "Vlasništvo (aktivno)" },
  { label: "Nalog", priority: "detail" },
];

/** F8.4: tabela aktivnih udjela — grupisana po jedinici, zbir jedinice u prvom redu grupe. */
const activeStakeHeaders = (): ColumnSpec[] => [
  // Zbir jedinice (chip) stoji u ćeliji „Jedinica”, ispod oznake: peta kolona bi na 375 px tabelu vratila na horizontalni skrol.
  { label: t("stakesTable.col.unit"), priority: "primary" },
  { label: t("stakesTable.col.owner") },
  { label: t("stakesTable.col.share"), align: "right", nowrap: true },
  { label: t("stakesTable.col.since"), priority: "secondary", nowrap: true },
];

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

/** Pull the mandatory proof-of-ownership file out of a submitted form. */
async function readProofFile(formData: FormData): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  const file = formData.get("proofFile") as File | null;
  if (!file || file.size === 0) return null;
  return { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mime: file.type };
}

async function addStakeAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const proof = await readProofFile(formData);
  let notice = t("register.msg.stakeAdded");
  try {
    if (!proof) throw new Error("Dokaz o vlasništvu (dokument) je obavezan za dodavanje vlasničkog udjela.");
    const unitId = String(formData.get("unitId"));
    const { unitShareSum } = await addOwnershipStake(actor, {
      unitId,
      ownerId: String(formData.get("ownerId")),
      sharePercent: parseMoneyInput(formData.get("sharePercent") as string | null) ?? "",
      validFrom: new Date(String(formData.get("validFrom"))),
    }, proof);
    // K-01a: a share sum other than 100 % never blocks the write — it is reported right here, with the next step.
    if (unitShareSum.minus(100).abs().greaterThan("0.0001")) {
      const unit = await prisma.unit.findUnique({ where: { id: unitId, zevId: requireZev(actor) }, select: { label: true } });
      const sum = formatMoney(unitShareSum.toString(), "").trim();
      notice += " " + tf(unitShareSum.greaterThan(100) ? "register.msg.sumOver" : "register.msg.sumUnder", { unit: unit?.label ?? "", sum });
    }
    const representativeId = (formData.get("representativeId") as string) || "";
    if (representativeId) await setVotingRepresentative(actor, unitId, representativeId);
  } catch (e) {
    redirect(`/vlasnici?tab=vlasnistvo&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/vlasnici");
  redirect(`/vlasnici?tab=vlasnistvo&msg=${encodeURIComponent(notice)}`);
}

async function transferAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const proof = await readProofFile(formData);
  try {
    if (!proof) throw new Error("Dokaz o vlasništvu (dokument) je obavezan za promjenu vlasništva.");
    await transferOwnership(actor, {
      unitId: String(formData.get("unitId")),
      fromOwnerId: String(formData.get("fromOwnerId")),
      toOwnerId: String(formData.get("toOwnerId")),
      effectiveDate: new Date(String(formData.get("effectiveDate"))),
      note: (formData.get("note") as string) || null,
    }, proof);
  } catch (e) {
    redirect(`/vlasnici?tab=vlasnistvo&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
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
    redirect(`/vlasnici?tab=punomoci&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/vlasnici");
}

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; err?: string; msg?: string; q?: string; sort?: string; dir?: string }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const isPresident = actor.roles.includes("PRESIDENT");
  const sp = await searchParams;
  const { tab, err, q } = sp;
  const okMsg = sp.msg === "representative" ? t("register.msg.representative") : sp.msg;
  const activeTab = tab === "vlasnistvo" || tab === "punomoci" ? tab : "lica";

  function licaHref(overrides: Partial<{ q: string; sort: string; dir: string }>) {
    const merged = { q: sp.q, sort: sp.sort, dir: sp.dir, ...overrides };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/vlasnici?${params.toString()}`;
  }

  const partySort = sp.sort === "name" ? "name" : undefined;
  const partyDir: "asc" | "desc" = sp.dir === "desc" ? "desc" : "asc";
  const parties = await listParties(actor);
  let displayParties = partySort
    ? [...parties].sort((a, b) => partyDisplayName(a).localeCompare(partyDisplayName(b), "sr") * (partyDir === "desc" ? -1 : 1))
    : parties;
  if (q) {
    const qLower = q.toLowerCase();
    displayParties = displayParties.filter((p) => partyDisplayName(p).toLowerCase().includes(qLower));
  }
  const units = isPresident && activeTab === "vlasnistvo" ? (await listUnits(actor)).filter((u) => u.active) : [];
  const ownershipTab = isPresident && activeTab === "vlasnistvo";
  const registerStatus = ownershipTab ? (await getZev(actor))?.unitRegisterStatus ?? "DRAFT" : "DRAFT";
  const reg = ownershipTab && registerStatus !== "DRAFT" ? await getUnitRegister(actor) : null;
  const now = new Date();
  const shareWarningByUnit = new Map((reg?.warnings ?? []).map((w) => [w.unitId, w]));
  const registerWarnings = reg ? registerWarningTexts(reg) : [];
  const communities = (reg?.subjects ?? []).filter((sub) => sub.memberPartyIds.length > 1);
  const proxies =
    isPresident && activeTab === "punomoci"
      ? await prisma.proxy.findMany({ where: { zevId, revokedAt: null }, include: { grantor: true, holder: true } })
      : [];
  return (
    <div>
      <PageHeader title={t("nav.owners")} subtitle="Etažni vlasnici, suvlasnici, stanari, zakupci i punomoćnici" />
      <Flash err={err} msg={okMsg} />
      <Tabs
        tabs={
          isPresident
            ? [
                { key: "lica", label: "Lica", count: parties.length },
                { key: "vlasnistvo", label: "Vlasništvo i korištenje" },
                { key: "punomoci", label: "Punomoći" },
              ]
            : [{ key: "lica", label: "Lica", count: parties.length }]
        }
        active={activeTab}
        hrefFor={(key) => `/vlasnici?tab=${key}`}
      />
      {activeTab === "lica" && (
      <>
      <FilterBar submitLabel="Pretraži">
        {partySort && <input type="hidden" name="sort" value={partySort} />}
        {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
        <Field label="Pretraga po imenu">
          <input type="text" name="q" defaultValue={q ?? ""} placeholder="Ime, prezime ili naziv" className={inputCls} />
        </Field>
        {q && <BtnLink href="/vlasnici" variant="secondary">Poništi filter</BtnLink>}
      </FilterBar>
      <Card title="Lica (fizička i pravna)">
        <Table
          id="parties-table"
          caption="Lica (fizička i pravna)"
          headers={partyHeaders}
          sort={{ active: partySort, dir: partyDir, hrefFor: (key, d) => licaHref({ sort: key, dir: d }) }}
          empty={displayParties.length === 0}
          emptyTitle={t(displayParties.length === 0 && q ? "empty.filteredQuery.title" : "empty.parties.title")}
          emptyHint={displayParties.length === 0 && q ? t("empty.filteredQuery.hint") : isPresident ? t("empty.parties.hint") : undefined}
        >
          {displayParties.map((p) => (
            <tr key={p.id}>
              <Td><RowLink href={`/vlasnici/${p.id}`}>{partyDisplayName(p)}</RowLink></Td>
              <Td>{p.kind === "PERSON" ? "Fizičko lice" : "Pravno lice"}</Td>
              <Td>{p.email ?? "—"}</Td>
              <Td>{p.invoiceEmailDelivery ? "Da" : "—"}</Td>
              <Td>{p.phone ?? "—"}</Td>
              <Td>{p.ownershipStakes.map((s) => `${s.unit.label} (${s.sharePercent}%)`).join(", ") || "—"}</Td>
              <Td>{p.user ? (p.user.active ? p.user.email : "deaktiviran") : "—"}</Td>
            </tr>
          ))}
        </Table>
        {isPresident && (
          <details className="group mt-4">
            <ToggleBtn>Dodaj lice</ToggleBtn>
            <form action={addPartyAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-4">
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
              <Field label="Početna lozinka" hint="bar 8 znakova"><PasswordField name="accountPassword" /></Field>
              <div className="flex items-end"><SubmitBtn>Sačuvaj lice</SubmitBtn></div>
            </form>
          </details>
        )}
      </Card>
      </>
      )}

      {ownershipTab && registerStatus === "DRAFT" && (
        <Card title={t("register.owners.lockedCardTitle")}>
          <div className="py-4 text-center">
            <p className="text-[15px] font-medium text-slate-700">{t("register.owners.lockedTitle")}</p>
            <p className="mx-auto mt-1 max-w-[68ch] text-[13px] text-slate-500">{t("register.owners.lockedHint")}</p>
            <div className="mt-4"><BtnLink href="/zgrade?tab=posebni" variant="tonal">{t("register.owners.lockedLink")}</BtnLink></div>
          </div>
        </Card>
      )}

      {ownershipTab && registerStatus !== "DRAFT" && (
        <div className="space-y-4">
        {reg && registerStatus === "REVIEW" && (
          <Card title={t("register.title")}>
            <div className="mb-3"><StatusBadge status="REGISTER_REVIEW" label={tEnum("unitRegisterStatus", "REVIEW")} /></div>
            <p className="mb-3 max-w-[68ch] text-sm text-slate-700">
              {tf("register.review.body", { units: reg.summary.unitCount, votes: reg.summary.votes, persons: reg.summary.persons })}
            </p>
            <PreconditionList
              items={[
                { ok: true, text: t("register.next.reviewOwnersOk") },
                { ok: false, text: t("register.next.reviewVotingBlocked") },
              ]}
            />
            <div className="mt-4"><BtnLink href="/zgrade?tab=posebni" variant="tonal">{t("register.review.link")}</BtnLink></div>
          </Card>
        )}
        {reg && (communities.length > 0 || registerWarnings.length > 0) && (
          <Card title={t("register.rep.cardTitle")} hint={t("register.rep.cardHint")}>
            {communities.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {communities.map((sub) => (
                  <li key={sub.subjectKey} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                    <div className="text-sm text-slate-700">
                      <div className="font-medium text-slate-900">{sub.units.map((u) => u.label).join(", ")} · {sub.ownerName}</div>
                      <div>
                        {tf("register.owners.representative", { name: sub.members.find((m) => m.partyId === sub.ownerId)?.name ?? sub.ownerName })}
                        {!sub.representativeConfirmed && <span className="ml-2 text-[13px] text-amber-800">{t("register.owners.notConfirmed")}</span>}
                      </div>
                    </div>
                    <RepresentativeChange
                      unitId={sub.units[0].unitId}
                      unitLabels={sub.units.map((u) => u.label)}
                      members={sub.members}
                      soleIds={sub.members.map((m) => m.partyId).filter((id) => !sub.actingPartyIds.includes(id))}
                      currentId={sub.ownerId}
                      returnTo="vlasnici"
                    />
                  </li>
                ))}
              </ul>
            )}
            {registerWarnings.length > 0 && (
              <div className={communities.length > 0 ? "mt-4" : ""}>
                <PreconditionList items={registerWarnings.map((text) => ({ ok: false, text }))} />
              </div>
            )}
          </Card>
        )}
        <Card title={t("stakesTable.title")} hint={t("stakesTable.hint")}>
          <Table
            id="active-stakes-table"
            caption={t("stakesTable.caption")}
            headers={activeStakeHeaders()}
            empty={units.length === 0}
            emptyTitle={t("stakesTable.emptyTitle")}
            emptyHint={t("stakesTable.emptyHint")}
          >
            {units.flatMap((u) => {
              const stakes = u.ownershipStakes.filter((st) => st.validFrom <= now);
              const warning = shareWarningByUnit.get(u.id);
              // Isto što i upozorenja iznad (`unitOwnershipWarnings`): bez upozorenja je zbir 100 %.
              const chip = warning
                ? shareSumChip(warning.sum, warning.kind === "NONE" ? 0 : 1)
                : shareSumChip(sumShares(stakes.map((st) => st.sharePercent.toString())), Math.max(stakes.length, 1));
              const unitCell = (
                <div className="space-y-1">
                  <div>{u.label}</div>
                  <div className="text-[13px] text-slate-500">{u.building.name}</div>
                  <StatusBadge status={chip.status} label={chip.label} />
                </div>
              );
              if (stakes.length === 0) {
                return [(
                  <tr key={u.id}>
                    <Td>{unitCell}</Td>
                    <Td><span className="text-slate-500">{t("stakesTable.noOwner")}</span></Td>
                    <Td>—</Td>
                    <Td>—</Td>
                  </tr>
                )];
              }
              return stakes.map((st, i) => (
                <tr key={st.id}>
                  <Td>{i === 0 ? unitCell : ""}</Td>
                  <Td>{partyDisplayName(st.owner)}</Td>
                  <Td>{formatMoney(st.sharePercent.toString(), "").trim()}</Td>
                  <Td>{formatDate(st.validFrom)}</Td>
                </tr>
              ));
            })}
          </Table>
        </Card>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Dodaj vlasnički udio">
            <details className="group">
              <ToggleBtn>Dodaj udio</ToggleBtn>
              <form action={addStakeAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="sm:col-span-2">
                  <Field label={t("register.rep.label")} hint={t("register.rep.formHint")}>
                    <select name="representativeId" defaultValue="" className={inputCls}>
                      <option value="">{t("register.rep.default")}</option>
                      {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <ProofFileField
                    name="proofFile"
                    label={t("stakesTable.proofLabel")}
                    buttonLabel={t("stakesTable.proofPick")}
                    hint={t("stakesTable.addHint")}
                    accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
                    required
                  />
                </div>
                <div className="sm:col-span-2"><SubmitBtn>Dodaj udio</SubmitBtn></div>
              </form>
            </details>
          </Card>
          <Card title="Promjena vlasništva (promet jedinice)">
            <p className="mb-3 text-[13px] text-slate-500">
              Istorijski dug ostaje na prethodnom vlasniku; prenos duga moguć je samo izričitom korekcijom salda.
            </p>
            <details className="group">
              <ToggleBtn>Evidentiraj prenos</ToggleBtn>
              <form action={transferAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="sm:col-span-2">
                  <ProofFileField
                    name="proofFile"
                    label={t("stakesTable.proofLabel")}
                    buttonLabel={t("stakesTable.proofPick")}
                    hint={t("stakesTable.transferHint")}
                    accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
                    required
                  />
                </div>
                <div className="flex items-end"><SubmitBtn variant="tonal">Evidentiraj prenos</SubmitBtn></div>
              </form>
            </details>
          </Card>
          <Card title="Evidentiraj stanara / zakupca">
            <p className="mb-3 text-[13px] text-slate-500">Stanar ili zakupac NE stiče pravo glasa stanovanjem.</p>
            <details className="group">
              <ToggleBtn>Evidentiraj</ToggleBtn>
              <form action={addOccupancyAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            </details>
          </Card>
        </div>
        </div>
      )}

      {isPresident && activeTab === "punomoci" && (
          <Card title="Punomoći">
            <Table
              id="proxies-table"
              caption="Punomoći"
              headers={proxyHeaders}
              empty={proxies.length === 0}
              emptyTitle={t("empty.proxies.title")}
              emptyHint={t("empty.proxies.hint")}
            >
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
            <details className="group mt-3">
              <ToggleBtn>Evidentiraj punomoć</ToggleBtn>
              <form action={grantProxyAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="sm:col-span-2"><SubmitBtn>Evidentiraj punomoć</SubmitBtn></div>
              </form>
            </details>
          </Card>
      )}
    </div>
  );
}
