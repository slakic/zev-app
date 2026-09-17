import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { listBuildings, listUnits, createBuilding, createEntrance, createUnit, getZev, listCommonAssets, createCommonAsset } from "@/server/services/property";
import { partyDisplayName } from "@/server/services/ownership";
import { updateBuildingAction, updateUnitAction } from "@/server/actions/property";
import { parseMoneyInput, formatMoney } from "@/lib/money";
import { t, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, Field, inputCls, SubmitBtn, Flash, ToggleBtn, Tabs, type ColumnSpec } from "@/components/ui";
import { BuildingRow } from "@/components/building-row";
import { UnitRow } from "@/components/unit-row";

async function addBuildingAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await createBuilding(actor, {
    name: String(formData.get("name")),
    address: String(formData.get("address")),
    yearBuilt: formData.get("yearBuilt") ? Number(formData.get("yearBuilt")) : null,
  });
  revalidatePath("/zgrade");
}

async function addEntranceAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await createEntrance(actor, {
    buildingId: String(formData.get("buildingId")),
    name: String(formData.get("name")),
    address: (formData.get("address") as string) || null,
  });
  revalidatePath("/zgrade");
}

async function addUnitAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await createUnit(actor, {
    buildingId: String(formData.get("buildingId")),
    entranceId: (formData.get("entranceId") as string) || null,
    type: formData.get("type") as never,
    label: String(formData.get("label")),
    floor: formData.get("floor") ? Number(formData.get("floor")) : null,
    usableArea: parseMoneyInput(formData.get("usableArea") as string | null) ?? "",
    ownershipShare: parseMoneyInput(formData.get("ownershipShare") as string | null) ?? "",
    occupantCount: Number(formData.get("occupantCount") ?? 0),
    typeCoefficient: parseMoneyInput(formData.get("typeCoefficient") as string | null) ?? "1",
  });
  revalidatePath("/zgrade");
}

async function addAssetAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await createCommonAsset(actor, {
    buildingId: (formData.get("buildingId") as string) || null,
    kind: formData.get("kind") as never,
    name: String(formData.get("name")),
    description: (formData.get("description") as string) || null,
  });
  revalidatePath("/zgrade");
}

export default async function BuildingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; err?: string; msg?: string }>;
}) {
  const actor = await requireActor();
  const isPresident = actor.roles.includes("PRESIDENT");
  const { tab, err, msg } = await searchParams;
  const okMsg = msg === "saved" ? "Sačuvano." : undefined;
  const activeTab = ["ulazi", "posebni", "zajednicki"].includes(tab ?? "") ? (tab as string) : "zgrade";
  const [zev, buildings] = await Promise.all([getZev(actor), listBuildings(actor)]);
  const units = activeTab === "posebni" ? await listUnits(actor) : [];
  const assets = activeTab === "zajednicki" ? await listCommonAssets(actor) : [];
  const entrances = buildings.flatMap((b) => b.entrances.map((e) => ({ ...e, buildingName: b.name })));
  const totalArea = units.reduce((sum, u) => sum + Number(u.usableArea), 0);
  const totalShare = units.reduce((sum, u) => sum + Number(u.ownershipShare), 0);
  const shareBalanced = Math.abs(totalShare - 100) < 0.01;
  const buildingHeaders: ColumnSpec[] = [
    { label: "Naziv" },
    { label: "Adresa" },
    { label: "Ulazi" },
    { label: "Jedinica", align: "right" },
    ...(isPresident ? [{ label: "Radnje" } as ColumnSpec] : []),
  ];
  const entranceHeaders: ColumnSpec[] = [{ label: "Zgrada" }, { label: "Ulaz" }, { label: "Adresa" }];
  const assetHeaders: ColumnSpec[] = [{ label: "Naziv" }, { label: "Vrsta" }, { label: "Zgrada" }, { label: "Opis" }];
  const unitHeaders: ColumnSpec[] = [
    { label: "Zgrada" },
    { label: "Ulaz", priority: "detail" },
    { label: "Oznaka", priority: "primary" },
    { label: "Tip" },
    { label: "Sprat", align: "right", priority: "detail" },
    { label: "Površina m²", align: "right", nowrap: true },
    { label: "Udio %", align: "right", nowrap: true },
    { label: "Korisnika", align: "right", priority: "detail" },
    { label: "Vlasnici" },
    { label: "Stanari/zakupci", priority: "detail" },
    ...(isPresident ? [{ label: "Radnje" } as ColumnSpec] : []),
  ];
  return (
    <div>
      <PageHeader title={t("nav.buildings")} subtitle={zev?.legalName ?? undefined} />
      {!zev && <Flash err="ZEV još nije konfigurisana — unesite matične podatke u Podešavanjima." />}
      <Flash err={err} msg={okMsg} />
      <Tabs
        tabs={[
          { key: "zgrade", label: "Zgrade", count: buildings.length },
          { key: "ulazi", label: "Ulazi", count: entrances.length },
          { key: "posebni", label: "Posebni dijelovi" },
          { key: "zajednicki", label: "Zajednički dijelovi" },
        ]}
        active={activeTab}
        hrefFor={(key) => `/zgrade?tab=${key}`}
      />

      {activeTab === "zgrade" && (
        <Card title="Zgrade">
          <Table
            id="buildings-table"
            caption="Zgrade"
            headers={buildingHeaders}
            empty={buildings.length === 0}
            emptyTitle={t("empty.buildings.title")}
            emptyHint={isPresident ? t("empty.buildings.hint") : undefined}
          >
            {buildings.map((b) => (
              <BuildingRow key={b.id} building={b} canEdit={isPresident} action={updateBuildingAction} />
            ))}
          </Table>
          {isPresident && (
            <details className="group mt-4">
              <ToggleBtn>Dodaj zgradu</ToggleBtn>
              <form action={addBuildingAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Naziv zgrade"><input name="name" required className={inputCls} /></Field>
                <Field label="Adresa"><input name="address" required className={inputCls} /></Field>
                <Field label="Godina izgradnje"><input name="yearBuilt" type="number" className={inputCls} /></Field>
                <div className="flex items-end"><SubmitBtn>Dodaj zgradu</SubmitBtn></div>
              </form>
            </details>
          )}
        </Card>
      )}

      {activeTab === "ulazi" && (
        <Card title="Ulazi / lamele">
          <Table
            id="entrances-table"
            caption="Ulazi / lamele"
            headers={entranceHeaders}
            empty={entrances.length === 0}
            emptyTitle={t(buildings.length === 0 ? "empty.entrancesNoBuilding.title" : "empty.entrances.title")}
            emptyHint={
              buildings.length === 0
                ? t("empty.entrancesNoBuilding.hint")
                : isPresident
                  ? t("empty.entrances.hint")
                  : undefined
            }
          >
            {entrances.map((e) => (
              <tr key={e.id}>
                <Td>{e.buildingName}</Td>
                <Td>{e.name}</Td>
                <Td>{e.address ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          {isPresident && buildings.length > 0 && (
            <details className="group mt-4">
              <ToggleBtn>Dodaj ulaz</ToggleBtn>
              <form action={addEntranceAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Zgrada">
                  <select name="buildingId" className={inputCls}>
                    {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
                <Field label="Naziv ulaza"><input name="name" required className={inputCls} /></Field>
                <Field label="Adresa"><input name="address" className={inputCls} /></Field>
                <div className="flex items-end"><SubmitBtn>Dodaj ulaz</SubmitBtn></div>
              </form>
            </details>
          )}
        </Card>
      )}

      {activeTab === "posebni" && (
        <Card
          title="Posebni dijelovi (stanovi, poslovni prostori, garaže)"
          hint={
            units.length > 0 ? (
              <>
                {units.length} jedinica · {formatMoney(totalArea, "")}m² ·{" "}
                <span className={shareBalanced ? "font-semibold text-slate-700" : "font-semibold text-amber-700"}>
                  ukupan udio {formatMoney(totalShare, "")}%
                </span>
                {!shareBalanced && " — provjerite raspodjelu, zbir treba biti 100%"}
              </>
            ) : undefined
          }
        >
          <Table
            id="units-table"
            caption="Posebni dijelovi — stanovi, poslovni prostori i garaže"
            headers={unitHeaders}
            empty={units.length === 0}
            emptyTitle={t(buildings.length === 0 ? "empty.unitsNoBuilding.title" : "empty.units.title")}
            emptyHint={
              buildings.length === 0
                ? t("empty.unitsNoBuilding.hint")
                : isPresident
                  ? t("empty.units.hint")
                  : undefined
            }
          >
            {units.map((u) => (
              <UnitRow
                key={u.id}
                canEdit={isPresident}
                action={updateUnitAction}
                buildings={buildings.map((b) => ({ id: b.id, name: b.name }))}
                entrances={entrances.map((e) => ({ id: e.id, name: e.name, buildingName: e.buildingName }))}
                unit={{
                  id: u.id,
                  buildingId: u.buildingId,
                  entranceId: u.entranceId,
                  type: u.type,
                  label: u.label,
                  floor: u.floor,
                  usableArea: u.usableArea.toString(),
                  ownershipShare: u.ownershipShare.toString(),
                  occupantCount: u.occupantCount,
                  typeCoefficient: u.typeCoefficient.toString(),
                  buildingName: u.building.name,
                  entranceName: u.entrance?.name ?? null,
                  typeLabel: tEnum("unitType", u.type),
                  ownersDisplay: u.ownershipStakes.map((s) => `${partyDisplayName(s.owner)} (${s.sharePercent}%)`).join(", ") || "—",
                  occupantsDisplay: u.occupancies.map((o) => `${partyDisplayName(o.party)} (${tEnum("occupancy", o.type)})`).join(", ") || "—",
                }}
              />
            ))}
          </Table>
          {isPresident && buildings.length > 0 && (
            <details className="group mt-4">
              <ToggleBtn>Dodaj jedinicu</ToggleBtn>
              <form action={addUnitAction} className="mt-3 space-y-4">
                <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Lokacija</legend>
                  <Field label="Zgrada">
                    <select name="buildingId" className={inputCls}>
                      {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Ulaz (opciono)">
                    <select name="entranceId" className={inputCls}>
                      <option value="">—</option>
                      {entrances.map((e) => <option key={e.id} value={e.id}>{e.buildingName} / {e.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Oznaka"><input name="label" required className={inputCls} placeholder="Stan 12" /></Field>
                </fieldset>
                <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Tip i mjere</legend>
                  <Field label="Tip">
                    <select name="type" className={inputCls}>
                      <option value="APARTMENT">Stan</option>
                      <option value="BUSINESS">Poslovni prostor</option>
                      <option value="GARAGE">Garaža</option>
                      <option value="OTHER">Ostalo</option>
                    </select>
                  </Field>
                  <Field label="Sprat"><input name="floor" type="number" className={inputCls} /></Field>
                  <Field label="Korisna površina (m²)"><input name="usableArea" required className={inputCls} placeholder="54.50" /></Field>
                </fieldset>
                <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Obračun</legend>
                  <Field label="Vlasnički udio u ZEV (%)"><input name="ownershipShare" required className={inputCls} placeholder="3.25" /></Field>
                  <Field label="Broj korisnika"><input name="occupantCount" type="number" defaultValue={0} className={inputCls} /></Field>
                  <Field label="Koeficijent tipa"><input name="typeCoefficient" defaultValue="1" className={inputCls} /></Field>
                </fieldset>
                <div className="flex items-end justify-end"><SubmitBtn>Dodaj jedinicu</SubmitBtn></div>
              </form>
            </details>
          )}
        </Card>
      )}

      {activeTab === "zajednicki" && (
        <Card title="Zajednički dijelovi, sistemi i oprema">
          <Table
            id="assets-table"
            caption="Zajednički dijelovi, sistemi i oprema"
            headers={assetHeaders}
            empty={assets.length === 0}
            emptyTitle={t("empty.assets.title")}
            emptyHint={isPresident ? t("empty.assets.hint") : undefined}
          >
            {assets.map((a) => (
              <tr key={a.id}>
                <Td>{a.name}</Td>
                <Td>{a.kind === "AREA" ? "Zajednički prostor" : a.kind === "SYSTEM" ? "Sistem" : "Oprema"}</Td>
                <Td>{a.building?.name ?? "Cijela ZEV"}</Td>
                <Td>{a.description ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          {isPresident && (
            <details className="group mt-4">
              <ToggleBtn>Dodaj zajednički dio</ToggleBtn>
              <form action={addAssetAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-5">
                <Field label="Naziv"><input name="name" required className={inputCls} placeholder="Lift — ulaz A" /></Field>
                <Field label="Vrsta">
                  <select name="kind" className={inputCls}>
                    <option value="AREA">Zajednički prostor</option>
                    <option value="SYSTEM">Sistem</option>
                    <option value="EQUIPMENT">Oprema</option>
                  </select>
                </Field>
                <Field label="Zgrada">
                  <select name="buildingId" className={inputCls}>
                    <option value="">Cijela ZEV</option>
                    {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
                <Field label="Opis"><input name="description" className={inputCls} /></Field>
                <div className="flex items-end"><SubmitBtn>Dodaj</SubmitBtn></div>
              </form>
            </details>
          )}
        </Card>
      )}
    </div>
  );
}
