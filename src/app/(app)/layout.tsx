import { redirect } from "next/navigation";
import { t, tf } from "@/lib/i18n";
import { maybeActor } from "@/server/actor";
import { getMyDraft, landingPath } from "@/server/services/onboarding";
import Link from "next/link";
import { Flash } from "@/components/ui";
import { TenantShell } from "@/components/shells";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await maybeActor();
  if (!actor) redirect("/login");
  // A super admin with no Membership has no tenant dashboard to show (every service
  // call below is zevId-scoped) — send them to their own area instead of letting them
  // hit a ForbiddenError deep in a page. A super admin who *also* holds a Membership
  // somewhere falls through normally — they're acting as a member there by choice.
  // Isto za pozvanog klijenta koji još popunjava nacrt novog ZEV-a (nema članstvo dok ga ne objavi).
  if (!actor.zevId) {
    const path = await landingPath(actor);
    if (path !== "/") redirect(path);
  }
  const draft = await getMyDraft(actor);
  return (
    <TenantShell actor={actor}>
      {/* Postojeći korisnik koji osniva još jedan ZEV (D3) ima svoj aktivni ZEV, pa ne dolazi u čarobnjak
          sam od sebe: ova poruka je ulaz dok nacrt ne bude objavljen ili odbačen. */}
      {draft && (
        <Flash
          msg={
            <>
              {tf("onboarding.resume.text", { naziv: draft.data.zev.legalName })}{" "}
              <Link href="/onboarding" className="font-medium underline underline-offset-2">{t("onboarding.resume.link")}</Link>
            </>
          }
        />
      )}
      {children}
    </TenantShell>
  );
}
