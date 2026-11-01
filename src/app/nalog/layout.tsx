// Stranice na nivou NALOGA (ne ZEV-a), npr. „Povezani asistenti": rade i za klijenta u onboardingu koji još
// nema ZEV, pa ne mogu živjeti pod (app) — taj layout takvog korisnika preusmjerava. Školjka prati ko je
// korisnik: ima aktivni ZEV -> školjka ZEV-a; super admin bez ZEV-a -> platformska; ostali (klijent sa nacrtom) ->
// školjka čarobnjaka bez oznake „sačuvano".
import { requireActor } from "@/server/actor";
import { OnboardingShell, PlatformShell, TenantShell } from "@/components/shells";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (actor.zevId) return <TenantShell actor={actor}>{children}</TenantShell>;
  if (actor.isSuperAdmin) return <PlatformShell actor={actor}>{children}</PlatformShell>;
  return (
    <OnboardingShell actor={actor} showSaved={false}>
      <main className="p-4 md:p-8">
        <div className="mx-auto w-full max-w-[1440px]">{children}</div>
      </main>
    </OnboardingShell>
  );
}
