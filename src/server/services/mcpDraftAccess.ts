// Pristup super admina tuđem nacrtu novog ZEV-a kroz njegovog MCP asistenta (Plans/mcp-onboarding-asistent-plan.md,
// Faza O-A). Pristup se odobrava odmah, bez saglasnosti klijenta (odluka Q1), ali ga klijent vidi na /nalog/asistenti i
// može ukloniti, a svako dodavanje i uklanjanje ulazi u audit. Red u OnboardingDraftAdminAccess je jedini izvor istine:
// veza sa opsegom `draft:<id>` radi dok red nije uklonjen (access.ts), pa uklanjanje djeluje odmah na sve admin veze.
// Admin može ponovo dodati pristup poslije uklanjanja; to pravi novi red, a stare veze sa tim opsegom opet rade (Q8).
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireAnyUser, requireSuperAdmin, type Actor } from "@/server/auth/guards";
import { displayNameFor } from "@/server/auth/displayName";
import { t } from "@/lib/i18n";
import { accountActor } from "@/server/services/mcpConnections";
import { draftScopeLabel } from "@/server/mcp/access";

/** Dodaje pristup administratora nacrtu (idempotentno: aktivan pristup se ne udvostručuje i ne ulazi opet u audit). */
export async function grantDraftAdminAccess(actor: Actor, draftId: string): Promise<{ id: string; created: boolean }> {
  requireSuperAdmin(actor);
  const draft = await prisma.onboardingDraft.findUnique({ where: { id: draftId }, select: { id: true, status: true, ownerUserId: true } });
  if (!draft || draft.status !== "IN_PROGRESS") throw new Error(t("assistants.adminAccess.errors.draftNotActive"));
  if (draft.ownerUserId === actor.userId) throw new Error(t("assistants.adminAccess.errors.ownDraft"));

  const existing = () => prisma.onboardingDraftAdminAccess.findFirst({ where: { draftId, adminUserId: actor.userId, revokedAt: null }, select: { id: true } });
  const already = await existing();
  if (already) return { id: already.id, created: false };
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.onboardingDraftAdminAccess.create({ data: { draftId, adminUserId: actor.userId }, select: { id: true } });
      await audit(
        accountActor(actor),
        { action: "mcp.draft_access.grant", targetType: "OnboardingDraft", targetId: draftId, after: { adminUserId: actor.userId } },
        tx
      );
      return created;
    });
    return { id: row.id, created: true };
  } catch (e) {
    // Dva istovremena dodavanja: parcijalni jedinstveni indeks propušta samo jedno, drugo se tretira kao postojeće.
    if ((e as { code?: string }).code === "P2002") {
      const again = await existing();
      if (again) return { id: again.id, created: false };
    }
    throw e;
  }
}

/** Uklanja pristup: vlasnik nacrta ili bilo koji super admin. Uklonjeni pristup se ne može „oživjeti"; dodaje se novi. */
export async function revokeDraftAdminAccess(actor: Actor, accessId: string): Promise<{ draftId: string; by: "OWNER" | "ADMIN" }> {
  requireAnyUser(actor);
  return prisma.$transaction(async (tx) => {
    const row = await tx.onboardingDraftAdminAccess.findFirst({
      where: { id: accessId, revokedAt: null },
      select: { id: true, draftId: true, adminUserId: true, draft: { select: { ownerUserId: true } } },
    });
    const isOwner = row?.draft.ownerUserId === actor.userId;
    // Treće lice dobija istu poruku kao za nepostojeći pristup.
    if (!row || !(isOwner || actor.isSuperAdmin)) throw new Error(t("assistants.errors.notFound"));
    const res = await tx.onboardingDraftAdminAccess.updateMany({
      where: { id: accessId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: actor.userId },
    });
    if (res.count === 0) throw new Error(t("assistants.errors.notFound"));
    const by = isOwner ? "OWNER" : "ADMIN";
    await audit(
      accountActor(actor),
      {
        action: "mcp.draft_access.revoke",
        targetType: "OnboardingDraft",
        targetId: row.draftId,
        before: { draftId: row.draftId, adminUserId: row.adminUserId },
        after: { by },
      },
      tx
    );
    return { draftId: row.draftId, by };
  });
}

export type MyDraftAdminAccessRow = { id: string; draftId: string; adminName: string; draftLabel: string; grantedAt: Date; lastUsedAt: Date | null };

/** Aktivni pristupi administratora nacrtima koje korisnik sam popunjava (za karticu na /nalog/asistenti). */
export async function listAdminAccessToMyDrafts(actor: Actor): Promise<MyDraftAdminAccessRow[]> {
  requireAnyUser(actor);
  const rows = await prisma.onboardingDraftAdminAccess.findMany({
    where: { revokedAt: null, draft: { ownerUserId: actor.userId, status: "IN_PROGRESS" } },
    select: {
      id: true, draftId: true, adminUserId: true, grantedAt: true, lastUsedAt: true,
      draft: { select: { data: true, invite: { select: { workingName: true } } } },
    },
    orderBy: { grantedAt: "desc" },
  });
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      draftId: r.draftId,
      // Ovo je web prikaz klijentu, pa je e-pošta kao rezervno ime dozvoljena (za razliku od odgovora asistentu).
      adminName: (await displayNameFor(r.adminUserId)) || t("assistants.whoami.unnamed"),
      draftLabel: draftScopeLabel(r.draft),
      grantedAt: r.grantedAt,
      lastUsedAt: r.lastUsedAt,
    }))
  );
}

export type DraftAdminAccessRow = { id: string; isMine: boolean; adminName: string; grantedAt: Date; lastUsedAt: Date | null };

/** Aktivni pristupi administratora jednom nacrtu (admin stranica nacrta). */
export async function listDraftAdminAccess(actor: Actor, draftId: string): Promise<DraftAdminAccessRow[]> {
  requireSuperAdmin(actor);
  const rows = await prisma.onboardingDraftAdminAccess.findMany({
    where: { draftId, revokedAt: null },
    select: { id: true, adminUserId: true, grantedAt: true, lastUsedAt: true },
    orderBy: { grantedAt: "asc" },
  });
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      isMine: r.adminUserId === actor.userId,
      adminName: (await displayNameFor(r.adminUserId)) || t("assistants.whoami.unnamed"),
      grantedAt: r.grantedAt,
      lastUsedAt: r.lastUsedAt,
    }))
  );
}

/** Broj aktivnih pristupa administratora nacrtu — za obavještenje u čarobnjaku. */
export async function countActiveAdminAccess(draftId: string): Promise<number> {
  return prisma.onboardingDraftAdminAccess.count({ where: { draftId, revokedAt: null } });
}
