// Sažetak nacrta novog ZEV-a (mockup O-M04 ①②③): jedna kartica sa `dl` po koracima. Isti prikaz
// koristi korak „Pregled i objava” (sa vezama „Izmijeni”) i pregled nacrta u adminu (samo čitanje).
import { Card, RowActionLink, StatusBadge } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { sharesSum } from "@/lib/registerRules";
import { draftPartyName, type OnboardingDraftData } from "@/lib/onboarding/draft";
import { ONBOARDING_STEPS, type OnboardingStepKey } from "@/lib/onboarding/progress";
import { formatDate, t, tf } from "@/lib/i18n";

const slug = (k: OnboardingStepKey) => ONBOARDING_STEPS.find((s) => s.key === k)!.slug;

export function OnboardingSummary({ data, editable }: { data: OnboardingDraftData; editable: boolean }) {
  const locked = Boolean(data.registerConfirmedAt);
  const z = data.zev;
  const acc = data.offices.accountant;
  const disputed = data.units.filter((u) => data.disputedUnits.includes(u.key));
  const rows: { key: OnboardingStepKey; label: string; body: React.ReactNode; lockable?: boolean }[] = [
    {
      key: "zev", label: t("onboarding.steps.zev"),
      body: (
        <>
          {z.legalName}
          <div className="text-[13px] text-slate-600">
            {t("onboarding.zev.jib")} {z.jib || "—"} · {t("onboarding.zev.registrationNumber")} {z.registrationNumber || "—"} · {z.registeredAddress}, {z.city}
          </div>
        </>
      ),
    },
    {
      key: "accounts", label: t("onboarding.steps.accounts"),
      body: data.accounts.length === 0 ? t("onboarding.check.noAccountsAck") : data.accounts.map((a) => (
        <div key={a.key}>
          {a.name}{a.bankName ? ` — ${a.bankName}` : ""}
          <div className="text-[13px] text-slate-600">{a.number ?? t("onboarding.accounts.typeCash")} · {formatMoney(a.openingBalance)} · {formatDate(a.openingDate)}</div>
        </div>
      )),
    },
    {
      key: "buildings", label: t("onboarding.steps.buildings"), lockable: true,
      body: data.buildings.map((b) => (
        <div key={b.key}>{b.name}{b.entrances.length > 0 ? ` · ${t("onboarding.buildings.entrances")} ${b.entrances.map((e) => e.name).join(", ")}` : ""}</div>
      )),
    },
    {
      key: "units", label: t("onboarding.steps.units"), lockable: true,
      body: tf("onboarding.summary.units", { broj: data.units.length, zbir: sharesSum(data.units.map((u) => u.ownershipShare)).toFixed(2).replace(".", ",") }),
    },
    { key: "commonAssets", label: t("onboarding.steps.commonAssets"), lockable: true, body: data.commonAssets.map((c) => c.name).join(", ") || "—" },
    {
      key: "register", label: t("onboarding.steps.register"),
      body: data.registerConfirmedAt ? tf("onboarding.register.confirmed", { datum: formatDate(data.registerConfirmedAt) }) : t("onboarding.check.registerMissing"),
    },
    {
      key: "owners", label: t("onboarding.steps.owners"),
      body: (
        <>
          {tf("onboarding.summary.owners", { lica: new Set(data.stakes.map((s) => s.partyKey)).size, udjela: data.stakes.length })}
          {disputed.length > 0 && (
            <div className="mt-1 text-[13px] text-slate-600">
              {disputed.map((u) => u.label).join(", ")}: <StatusBadge status="OWNER_DISPUTED" label={t("onboarding.owners.disputedChip")} /> {t("onboarding.summary.disputedNote")}
            </div>
          )}
        </>
      ),
    },
    {
      key: "offices", label: t("onboarding.steps.offices"),
      body: (
        <>
          {t("onboarding.offices.president")}: {draftPartyName(data, "president")}
          {" · "}
          {t("onboarding.offices.accountant")}: {acc === "LATER" || !acc ? t("onboarding.summary.accountantLater") : `${draftPartyName(data, acc.partyKey)}${acc.loginEmail ? ` (${t("onboarding.summary.withLogin")})` : ""}`}
          {data.offices.board.length > 0 && <> · {t("onboarding.offices.board")}: {data.offices.board.map((b) => draftPartyName(data, b.partyKey)).join(", ")}</>}
        </>
      ),
    },
  ];
  return (
    <Card title={t("onboarding.summary.title")}>
      <dl className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-1 gap-1 py-3 md:grid-cols-[12rem_1fr_auto] md:items-start md:gap-4">
            <dt className="text-[13px] font-medium text-slate-500 md:text-sm md:text-slate-700">{r.label}</dt>
            <dd className="text-sm text-slate-800">{r.body}</dd>
            {editable && (
              <dd className="md:text-right">
                {r.lockable && locked ? (
                  <span className="text-[13px] text-slate-500">{t("onboarding.summary.lockedEdit")}</span>
                ) : (
                  <RowActionLink href={`/onboarding/${slug(r.key)}`}>{t("onboarding.summary.edit")}</RowActionLink>
                )}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </Card>
  );
}
