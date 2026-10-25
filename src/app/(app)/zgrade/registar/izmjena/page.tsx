import { requireActor } from "@/server/actor";
import { getUnitRegister, registerChangeBlocker } from "@/server/services/unitRegister";
import { listBuildings, listUnits } from "@/server/services/property";
import { changeUnitRegisterAction } from "@/server/actions/unitRegister";
import { formatDate, t, tf, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Flash, BtnLink } from "@/components/ui";
import { RegisterChangeForm } from "@/components/register-change-form";

export default async function RegisterChangePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireActor("PRESIDENT");
  const { err } = await searchParams;
  const [reg, blocker, buildings, units] = await Promise.all([
    getUnitRegister(actor),
    registerChangeBlocker(actor),
    listBuildings(actor),
    listUnits(actor),
  ]);
  const active = units.filter((u) => u.active);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("register.change.title")}
        subtitle={tf("register.change.subtitle", { version: reg.version + 1 })}
        backHref="/zgrade?tab=posebni"
        backLabel={t("register.change.back")}
      />
      <Flash err={err} />
      {reg.status !== "ESTABLISHED" ? (
        <Card title={t("register.change.title")}>
          <p className="text-sm text-slate-700">{t("register.change.notEstablished")}</p>
          <div className="mt-3"><BtnLink href="/zgrade?tab=posebni" variant="secondary">{t("register.change.back")}</BtnLink></div>
        </Card>
      ) : blocker ? (
        <Card title={t("register.change.title")} hint={<StatusLine version={reg.version} />}>
          <p className="text-sm text-amber-800">
            {tf("register.change.blocked", { code: blocker.code, date: blocker.votingClosesAt ? formatDate(blocker.votingClosesAt) : "—", version: reg.version })}
          </p>
          <div className="mt-3"><BtnLink href={`/skupstina/prijedlog/${blocker.id}`} variant="secondary">{tf("register.change.openProposal", { code: blocker.code })}</BtnLink></div>
        </Card>
      ) : (
        <RegisterChangeForm
          action={changeUnitRegisterAction}
          nextVersion={reg.version + 1}
          units={active.map((u) => ({
            id: u.id,
            label: u.label,
            where: [u.building.name, u.entrance?.name].filter(Boolean).join(", "),
            type: u.type,
            typeLabel: tEnum("unitType", u.type),
            usableArea: u.usableArea.toString(),
            ownershipShare: u.ownershipShare.toString(),
          }))}
          buildings={buildings.map((b) => ({ id: b.id, name: b.name, entrances: b.entrances.map((e) => ({ id: e.id, name: e.name })) }))}
        />
      )}
    </div>
  );
}

function StatusLine({ version }: { version: number }) {
  return <>{tf("register.status.established", { version })}</>;
}
