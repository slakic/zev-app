// "Promijeni" for a co-owner community's representative (K-03a) — a ConfirmAction (trigger `caution`,
// confirm `caution`: a corrective step), shared by the register's owners card and the "Vlasništvo" tab.
import { ConfirmAction, Field, inputCls } from "@/components/ui";
import { setVotingRepresentativeAction } from "@/server/actions/votingRepresentative";
import { t, tf } from "@/lib/i18n";

export function RepresentativeChange({
  unitId, unitLabels, members, currentId, returnTo,
}: {
  unitId: string;
  unitLabels: string[];
  members: { partyId: string; name: string }[];
  currentId: string;
  returnTo: "zgrade" | "vlasnici";
}) {
  return (
    <ConfirmAction
      trigger={t("register.rep.change")}
      title={t("register.rep.title")}
      body={<p className="text-sm text-slate-700">{tf("register.rep.body", { units: unitLabels.join(", ") })}</p>}
      confirmLabel={t("register.rep.confirm")}
      action={setVotingRepresentativeAction}
      hiddenFields={{ unitId, returnTo }}
    >
      <Field label={t("register.rep.label")}>
        <select name="partyId" defaultValue={currentId} className={inputCls}>
          {members.map((m) => <option key={m.partyId} value={m.partyId}>{m.name}</option>)}
        </select>
      </Field>
    </ConfirmAction>
  );
}
