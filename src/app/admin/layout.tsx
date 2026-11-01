import { requireSuperAdminActor } from "@/server/actor";
import { PlatformShell } from "@/components/shells";

// Not nested under (app): a super admin acts at the platform level, outside any single
// ZEV, so the tenant NAVIGATION (zevId-scoped pages) doesn't apply here — see
// docs/multitenancy-plan.md §4.3/§8. But the visual SHELL is the same NavShell as the
// tenant area, just variant="platform" (Plans/design-system.md §7) — the two areas used
// to look like different products even though the same person moves between them
// constantly ("Super admin" link in the tenant shell, "Moj ZEV" in the platform one).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireSuperAdminActor();
  return <PlatformShell actor={actor}>{children}</PlatformShell>;
}
