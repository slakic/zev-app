// Onboarding novog ZEV-a (Plans/zev-onboarding-wizard-plan.md): pozivni link, nalog pozvanog i
// nacrt koji klijent puni kroz čarobnjak. ZEV ne postoji dok se nacrt ne objavi (Faza C), pa ništa
// ovdje nije tenant-scoped: poziv vodi super admin (requireSuperAdmin), a nacrt sme da čita i
// mijenja samo njegov vlasnik (ownerUserId). Svako pravilo koraka živi u čistim modulima
// (src/lib/onboarding/*, identifiers, shareSum), da isto važi i u nacrtu i u aplikaciji.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireSuperAdmin, type Actor } from "@/server/auth/guards";
import { generateToken, sha256 } from "@/server/auth/tokens";
import { hashPassword, assertPasswordStrong } from "@/server/auth/password";
import { authenticate } from "@/server/services/users";
import { emailAddressSchema } from "@/lib/emailAddress";
import { assertBankAccount, isValidJib } from "@/lib/identifiers";
import { parseMoneyInput } from "@/lib/money";
import { t, tf } from "@/lib/i18n";
import {
  parseDraftData,
  initialDraftData,
  type OnboardingDraftData,
} from "@/lib/onboarding/draft";
import {
  onboardingProgress,
  isStepReachable,
  ONBOARDING_STEPS,
  type OnboardingProgress,
  type OnboardingStepKey,
  type OnboardingTier,
} from "@/lib/onboarding/progress";
import type { ZevTier } from "@/generated/prisma/client";

/** Rok važenja pozivnog linka (D1). */
export const INVITE_TTL_DAYS = 14;
const DAY_MS = 86400000;

/** Greška zastarjelog nacrta (optimistička brava): neko je u međuvremenu sačuvao noviju verziju. */
export class StaleDraftError extends Error {
  constructor() {
    super(t("onboarding.stale"));
    this.name = "StaleDraftError";
  }
}

function normalizeEmail(raw: string): string {
  const parsed = emailAddressSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Unesite ispravnu e-mail adresu.");
  return parsed.data;
}

function newExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
}

/** Audit poziva ne pripada nijednom ZEV-u (ZEV još ne postoji), i kad super admin ima aktivan ZEV. */
function platformActor(actor: Actor): Actor {
  return { ...actor, zevId: null };
}

// ---- Super admin: pozivi ---------------------------------------------------------------

export async function createOnboardingInvite(
  actor: Actor,
  data: { workingName: string; tier: ZevTier; email: string; note?: string | null }
): Promise<{ inviteId: string; token: string; expiresAt: Date }> {
  requireSuperAdmin(actor);
  const workingName = data.workingName.trim();
  if (!workingName) throw new Error("Radni naziv ZEV-a je obavezan.");
  const email = normalizeEmail(data.email);
  const now = new Date();
  const open = await prisma.onboardingInvite.findFirst({
    where: { email, status: "ACTIVE", expiresAt: { gt: now } },
  });
  if (open) throw new Error(`Za ${email} već postoji aktivan poziv („${open.workingName}”). Izdajte novi link na listi poziva.`);
  const inProgress = await prisma.onboardingDraft.findFirst({ where: { status: "IN_PROGRESS", invite: { email } } });
  if (inProgress) throw new Error(`${email} već popunjava nacrt novog ZEV-a.`);

  const token = generateToken();
  const invite = await prisma.onboardingInvite.create({
    data: {
      email,
      workingName,
      tier: data.tier,
      note: data.note?.trim() || null,
      tokenHash: sha256(token),
      expiresAt: newExpiry(now),
      createdById: actor.userId,
    },
  });
  await audit(platformActor(actor), {
    action: "onboarding.invite.create",
    targetType: "OnboardingInvite",
    targetId: invite.id,
    after: { email, workingName, tier: invite.tier, expiresAt: invite.expiresAt.toISOString() },
  });
  return { inviteId: invite.id, token, expiresAt: invite.expiresAt };
}

/** Novi link za poziv koji klijent još nije prihvatio; stari link time prestaje da važi. */
export async function reissueOnboardingInvite(actor: Actor, inviteId: string): Promise<{ token: string; expiresAt: Date; email: string }> {
  requireSuperAdmin(actor);
  const invite = await prisma.onboardingInvite.findUniqueOrThrow({ where: { id: inviteId } });
  if (invite.status !== "ACTIVE") throw new Error("Novi link se može izdati samo za poziv koji klijent još nije prihvatio.");
  const token = generateToken();
  const expiresAt = newExpiry();
  const res = await prisma.onboardingInvite.updateMany({
    where: { id: inviteId, status: "ACTIVE" },
    data: { tokenHash: sha256(token), expiresAt, openedAt: null },
  });
  if (res.count === 0) throw new Error("Poziv je u međuvremenu prihvaćen ili opozvan.");
  await audit(platformActor(actor), {
    action: "onboarding.invite.reissue",
    targetType: "OnboardingInvite",
    targetId: inviteId,
    before: { expiresAt: invite.expiresAt.toISOString() },
    after: { expiresAt: expiresAt.toISOString() },
  });
  return { token, expiresAt, email: invite.email };
}

export async function revokeOnboardingInvite(actor: Actor, inviteId: string, reason: string): Promise<void> {
  requireSuperAdmin(actor);
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Razlog je obavezan.");
  const res = await prisma.onboardingInvite.updateMany({
    where: { id: inviteId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: trimmed },
  });
  if (res.count === 0) throw new Error("Opozvati se može samo poziv koji klijent još nije prihvatio.");
  await audit(platformActor(actor), {
    action: "onboarding.invite.revoke",
    targetType: "OnboardingInvite",
    targetId: inviteId,
    reason: trimmed,
  });
}

export type InviteListState = "ACTIVE" | "EXPIRED" | "REVOKED" | "IN_PROGRESS" | "PUBLISHED" | "DISCARDED";

export type InviteListRow = {
  id: string;
  email: string;
  workingName: string;
  tier: ZevTier;
  state: InviteListState;
  expiresAt: Date;
  openedAt: Date | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  updatedAt: Date;
  /** Samo za nacrt u toku: trenutni korak iz iste funkcije koju vidi klijent. */
  currentStep: { number: number; label: string } | null;
};

export async function listOnboardingInvites(actor: Actor): Promise<InviteListRow[]> {
  requireSuperAdmin(actor);
  const invites = await prisma.onboardingInvite.findMany({ orderBy: { createdAt: "desc" }, include: { draft: true } });
  const now = Date.now();
  return invites.map((inv) => {
    const d = inv.draft;
    let state: InviteListState;
    if (d) state = d.status === "IN_PROGRESS" ? "IN_PROGRESS" : d.status;
    else if (inv.status === "REVOKED") state = "REVOKED";
    else state = inv.expiresAt.getTime() <= now ? "EXPIRED" : "ACTIVE";
    let currentStep: InviteListRow["currentStep"] = null;
    if (d && d.status === "IN_PROGRESS") {
      const p = onboardingProgress(parseDraftData(d.data), inv.tier);
      const s = p.steps.find((x) => x.key === p.currentStep)!;
      currentStep = { number: s.number, label: s.label };
    }
    return {
      id: inv.id, email: inv.email, workingName: inv.workingName, tier: inv.tier, state,
      expiresAt: inv.expiresAt, openedAt: inv.openedAt, acceptedAt: inv.acceptedAt, revokedAt: inv.revokedAt,
      updatedAt: d?.updatedAt ?? inv.revokedAt ?? inv.createdAt, currentStep,
    };
  });
}

// ---- Javno: link poziva --------------------------------------------------------------

export type InviteInspection =
  | { ok: true; workingName: string; email: string; maskedEmail: string; existingUser: boolean }
  | { ok: false; error: "invalid" | "expired" | "revoked" | "used" };

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const shown = local.length <= 2 ? local[0] ?? "" : `${local[0]}${local[1]}`;
  return `${shown}${"•".repeat(Math.max(1, local.length - shown.length))}@${domain}`;
}

async function findInviteByToken(token: string) {
  if (!token) return null;
  return prisma.onboardingInvite.findUnique({ where: { tokenHash: sha256(token) } });
}

function inviteError(inv: { status: string; expiresAt: Date }): "expired" | "revoked" | "used" | null {
  if (inv.status === "REVOKED") return "revoked";
  if (inv.status === "ACCEPTED") return "used";
  if (inv.expiresAt.getTime() <= Date.now()) return "expired";
  return null;
}

/** Bez prijave: šta stranica poziva smije da pokaže. Prvo otvaranje se bilježi (`openedAt`). */
export async function inspectOnboardingInvite(token: string): Promise<InviteInspection> {
  const inv = await findInviteByToken(token);
  if (!inv) return { ok: false, error: "invalid" };
  const err = inviteError(inv);
  if (err) return { ok: false, error: err };
  if (!inv.openedAt) await prisma.onboardingInvite.update({ where: { id: inv.id }, data: { openedAt: new Date() } });
  const existingUser = Boolean(await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
  return { ok: true, workingName: inv.workingName, email: inv.email, maskedEmail: maskEmail(inv.email), existingUser };
}

export type AcceptInviteInput =
  | { mode: "new"; firstName: string; lastName: string; phone?: string | null; password: string; confirm: string }
  | { mode: "existing"; password: string };

export type AcceptInviteResult =
  | { ok: true; userId: string }
  | { ok: false; error: "invalid" | "expired" | "revoked" | "used" | "mismatch" | "credentials" | "deactivated" | "rate_limited"; message?: string };

/**
 * Korak 1: pozvani otvara nalog (ili se prijavljuje postojećim) i dobija nacrt. Token se troši —
 * od ovog trenutka čarobnjak radi kroz običnu prijavu (§0.3). Nalog NEMA članstvo dok se nacrt ne
 * objavi. Sesiju pravi pozivalac (stranica), jer servis ne smije da piše kolačiće.
 */
export async function acceptOnboardingInvite(token: string, input: AcceptInviteInput, ipHash?: string | null): Promise<AcceptInviteResult> {
  const inv = await findInviteByToken(token);
  if (!inv) return { ok: false, error: "invalid" };
  const early = inviteError(inv);
  if (early) return { ok: false, error: early };

  let userId: string;
  let names = { firstName: "", lastName: "", phone: "" };
  const existing = await prisma.user.findUnique({ where: { email: inv.email } });
  if (existing) {
    if (input.mode !== "existing") return { ok: false, error: "credentials" };
    const auth = await authenticate(inv.email, input.password, ipHash);
    if (!auth.ok) return { ok: false, error: auth.error === "invalid" ? "credentials" : auth.error };
    userId = auth.user.id;
    const party = await prisma.party.findFirst({ where: { userId, kind: "PERSON" }, orderBy: { createdAt: "desc" } });
    if (party) names = { firstName: party.firstName ?? "", lastName: party.lastName ?? "", phone: party.phone ?? "" };
  } else {
    if (input.mode !== "new") return { ok: false, error: "credentials" };
    if (input.password !== input.confirm) return { ok: false, error: "mismatch" };
    try {
      assertPasswordStrong(input.password);
    } catch (e) {
      return { ok: false, error: "credentials", message: (e as Error).message };
    }
    names = { firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone: input.phone?.trim() ?? "" };
    userId = "";
  }
  const passwordHash = existing ? null : await hashPassword((input as { password: string }).password);

  const result = await prisma.$transaction(async (tx) => {
    // Ponovna provjera u transakciji: dva istovremena prihvatanja — samo jedno prolazi.
    const claimed = await tx.onboardingInvite.updateMany({
      where: { id: inv.id, status: "ACTIVE", expiresAt: { gt: new Date() } },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (claimed.count === 0) return null;
    let uid = userId;
    if (!existing) {
      const user = await tx.user.create({ data: { email: inv.email, passwordHash: passwordHash!, roles: [] } });
      uid = user.id;
    }
    await tx.onboardingDraft.create({
      data: {
        inviteId: inv.id,
        ownerUserId: uid,
        data: initialDraftData({ workingName: inv.workingName, ...names }) as object,
      },
    });
    return uid;
  });
  if (!result) return { ok: false, error: "used" };
  await audit({ userId: result }, {
    action: "onboarding.invite.accept",
    targetType: "OnboardingInvite",
    targetId: inv.id,
    after: { email: inv.email, existingUser: Boolean(existing) },
    ipHash,
  });
  return { ok: true, userId: result };
}

// ---- Klijent: nacrt ----------------------------------------------------------------------

export type MyDraft = {
  id: string;
  version: number;
  tier: OnboardingTier;
  email: string;
  data: OnboardingDraftData;
  progress: OnboardingProgress;
};

/** Nacrt u toku koji pripada prijavljenom korisniku, ili null. */
export async function getMyDraft(actor: Pick<Actor, "userId">): Promise<MyDraft | null> {
  const d = await prisma.onboardingDraft.findFirst({
    where: { ownerUserId: actor.userId, status: "IN_PROGRESS" },
    include: { invite: { select: { tier: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!d) return null;
  const data = parseDraftData(d.data);
  return { id: d.id, version: d.version, tier: d.invite.tier, email: d.invite.email, data, progress: onboardingProgress(data, d.invite.tier) };
}

export async function hasDraftInProgress(userId: string): Promise<boolean> {
  return (await prisma.onboardingDraft.count({ where: { ownerUserId: userId, status: "IN_PROGRESS" } })) > 0;
}

/** Gdje korisnik ide posle prijave: super admin bez ZEV-a na /admin, pozvani sa nacrtom na čarobnjak. */
export async function landingPath(ctx: { userId: string; zevId?: string | null; isSuperAdmin?: boolean }): Promise<string> {
  if (ctx.zevId) return "/";
  if (await hasDraftInProgress(ctx.userId)) return "/onboarding";
  return ctx.isSuperAdmin ? "/admin" : "/";
}

function stepLabel(key: OnboardingStepKey): string {
  return t(`onboarding.steps.${key}`);
}

/**
 * Jedini put kojim se nacrt mijenja: provjera vlasnika, guard koraka (korak iza trenutnog se odbija,
 * §5.3), izmjena i upis sa optimističkom bravom (`version`). Vraća novu verziju.
 */
async function updateDraft(
  actor: Pick<Actor, "userId">,
  step: OnboardingStepKey,
  version: number,
  mutate: (data: OnboardingDraftData) => OnboardingDraftData
): Promise<number> {
  const draft = await getMyDraft(actor);
  if (!draft) throw new Error("Nemate nacrt novog ZEV-a u toku.");
  if (!isStepReachable(draft.progress, step)) {
    throw new Error(tf("onboarding.stepLocked", { korak: stepLabel(draft.progress.currentStep) }));
  }
  if (draft.version !== version) throw new StaleDraftError();
  const next = parseDraftData(mutate(structuredClone(draft.data)));
  const res = await prisma.onboardingDraft.updateMany({
    where: { id: draft.id, version, status: "IN_PROGRESS" },
    data: { data: next as object, version: version + 1 },
  });
  if (res.count === 0) throw new StaleDraftError();
  return version + 1;
}

/** Stranica koraka: korak iza trenutnog se ne otvara (preusmjerava se na trenutni). */
export function reachableStepOrCurrent(draft: MyDraft, step: OnboardingStepKey): OnboardingStepKey {
  return isStepReachable(draft.progress, step) ? step : draft.progress.currentStep;
}

export function stepSlug(key: OnboardingStepKey): string {
  return ONBOARDING_STEPS.find((s) => s.key === key)!.slug;
}

const trimOr = (v: string | null | undefined) => (v ?? "").trim();

// Korak 1 — Vaš nalog
export async function saveAccountStep(actor: Pick<Actor, "userId">, version: number, input: { firstName: string; lastName: string; phone?: string | null }) {
  return updateDraft(actor, "account", version, (d) => ({
    ...d,
    president: { firstName: trimOr(input.firstName), lastName: trimOr(input.lastName), phone: trimOr(input.phone) },
  }));
}

// Korak 2 — Podaci o ZEV-u. Neispravan JIB se NE odbija ovdje (forma bi izgubila sve ostale unesene
// podatke): čuva se, a korak ostaje nekompletan sa ⚠ iz istog pravila kao upsertZev (isValidJib, D5),
// pa ZEV sa neispravnim JIB-om ne može biti objavljen. `jibValid` kaže stranici da to i napiše.
export async function saveZevStep(actor: Pick<Actor, "userId">, version: number, input: OnboardingDraftData["zev"]): Promise<{ version: number; jibValid: boolean }> {
  const jib = trimOr(input.jib);
  const jibValid = !jib || isValidJib(jib);
  const next = await updateDraft(actor, "zev", version, (d) => ({
    ...d,
    zev: {
      legalName: trimOr(input.legalName), shortName: trimOr(input.shortName), registrationNumber: trimOr(input.registrationNumber),
      jib, registeredAddress: trimOr(input.registeredAddress), city: trimOr(input.city), municipality: trimOr(input.municipality),
      foundingDate: trimOr(input.foundingDate), registrationDate: trimOr(input.registrationDate),
    },
  }));
  return { version: next, jibValid };
}

// Korak 3 — Računi
export async function addDraftAccount(
  actor: Pick<Actor, "userId">,
  version: number,
  input: { type: "BANK" | "CASH"; name: string; bankName?: string | null; number?: string | null; openingBalance: string; openingDate: string }
) {
  const name = trimOr(input.name);
  if (!name) throw new Error("Naziv računa je obavezan.");
  const number = trimOr(input.number);
  if (input.type === "BANK") {
    if (!number) throw new Error(t("onboarding.accounts.numberRequired"));
    assertBankAccount(number); // isto pravilo kao createAccount (D5)
  }
  const openingBalance = parseMoneyInput(input.openingBalance) ?? "0";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.openingDate)) throw new Error("Unesite datum početnog stanja.");
  return updateDraft(actor, "accounts", version, (d) => ({
    ...d,
    accounts: [
      ...d.accounts,
      {
        key: randomUUID(), type: input.type, name,
        bankName: input.type === "BANK" ? trimOr(input.bankName) || null : null,
        number: input.type === "BANK" ? number : null,
        openingBalance, openingDate: input.openingDate,
      },
    ],
    acks: { ...d.acks, noAccounts: false },
  }));
}

export async function removeDraftAccount(actor: Pick<Actor, "userId">, version: number, key: string) {
  return updateDraft(actor, "accounts", version, (d) => ({ ...d, accounts: d.accounts.filter((a) => a.key !== key) }));
}

/** Samo paket BASIC (D7): nastavak bez računa je izričit izbor, ne prazan korak. */
export async function setNoAccounts(actor: Pick<Actor, "userId">, version: number, value: boolean) {
  const draft = await getMyDraft(actor);
  if (draft && draft.tier !== "BASIC" && value) throw new Error("Uz paket sa finansijama bankovni račun je obavezan.");
  return updateDraft(actor, "accounts", version, (d) => ({ ...d, acks: { ...d.acks, noAccounts: value } }));
}

// Korak 4 — Zgrade i ulazi
function assertBuildingsEditable(d: OnboardingDraftData) {
  if (d.registerConfirmedAt) throw new Error(t("onboarding.buildings.locked"));
}

function optionalInt(raw: string | null | undefined, label: string): number | null {
  const s = trimOr(raw);
  if (!s) return null;
  if (!/^-?\d+$/.test(s)) throw new Error(`${label}: unesite cijeli broj.`);
  return Number(s);
}

export async function addDraftBuilding(
  actor: Pick<Actor, "userId">,
  version: number,
  input: { name: string; address: string; cadastralRef?: string | null; yearBuilt?: string | null; floorsCount?: string | null }
) {
  const name = trimOr(input.name);
  const address = trimOr(input.address);
  if (!name) throw new Error("Naziv zgrade je obavezan.");
  if (!address) throw new Error("Adresa zgrade je obavezna.");
  const yearBuilt = optionalInt(input.yearBuilt, t("onboarding.buildings.yearBuilt"));
  const floorsCount = optionalInt(input.floorsCount, t("onboarding.buildings.floorsCount"));
  return updateDraft(actor, "buildings", version, (d) => {
    assertBuildingsEditable(d);
    if (d.buildings.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(tf("onboarding.buildings.duplicateName", { naziv: name }));
    }
    return {
      ...d,
      buildings: [...d.buildings, { key: randomUUID(), name, address, cadastralRef: trimOr(input.cadastralRef) || null, yearBuilt, floorsCount, entrances: [] }],
    };
  });
}

/** Uklanja zgradu i sve što na nju upućuje u nacrtu (jedinice i zajedničke dijelove, kad ih bude). */
export async function removeDraftBuilding(actor: Pick<Actor, "userId">, version: number, key: string) {
  return updateDraft(actor, "buildings", version, (d) => {
    assertBuildingsEditable(d);
    return {
      ...d,
      buildings: d.buildings.filter((b) => b.key !== key),
      units: d.units.filter((u) => u.buildingKey !== key),
      commonAssets: d.commonAssets.filter((c) => c.buildingKey !== key),
    };
  });
}

export async function addDraftEntrance(actor: Pick<Actor, "userId">, version: number, buildingKey: string, name: string) {
  const n = trimOr(name);
  if (!n) throw new Error("Naziv ulaza je obavezan.");
  return updateDraft(actor, "buildings", version, (d) => {
    assertBuildingsEditable(d);
    const b = d.buildings.find((x) => x.key === buildingKey);
    if (!b) throw new Error("Zgrada nije pronađena u nacrtu.");
    if (b.entrances.some((e) => e.name.toLowerCase() === n.toLowerCase())) throw new Error(tf("onboarding.buildings.duplicateEntrance", { naziv: n }));
    b.entrances.push({ key: randomUUID(), name: n });
    return d;
  });
}

export async function removeDraftEntrance(actor: Pick<Actor, "userId">, version: number, buildingKey: string, entranceKey: string) {
  return updateDraft(actor, "buildings", version, (d) => {
    assertBuildingsEditable(d);
    const b = d.buildings.find((x) => x.key === buildingKey);
    if (b) b.entrances = b.entrances.filter((e) => e.key !== entranceKey);
    return { ...d, units: d.units.map((u) => (u.entranceKey === entranceKey ? { ...u, entranceKey: null } : u)) };
  });
}

// Korak 5 — Posebni dijelovi. Ista pravila polja kao createUnit/registar (oznaka, vrsta, površina > 0,
// udio u (0, 100]); oznaka je jedinstvena u zgradi (kao @@unique([buildingId, label])).
const UNIT_TYPES = ["APARTMENT", "BUSINESS", "GARAGE", "GARAGE_SPACE", "OTHER"] as const;
type DraftUnitType = (typeof UNIT_TYPES)[number];

export type DraftUnitInput = {
  buildingKey: string;
  entranceKey?: string | null;
  type: string;
  label: string;
  floor?: string | null;
  usableArea: string;
  ownershipShare: string;
};

function positiveDecimal(raw: string | null | undefined, label: string): string {
  const s = parseMoneyInput(raw ?? "");
  if (!s || !/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) throw new Error(`${label}: unesite broj veći od nule.`);
  return s;
}

function assertRegisterOpen(d: OnboardingDraftData) {
  if (d.registerConfirmedAt) throw new Error(t("onboarding.units.locked"));
}

function validUnit(d: OnboardingDraftData, input: DraftUnitInput, selfKey: string | null) {
  const building = d.buildings.find((b) => b.key === input.buildingKey);
  if (!building) throw new Error("Zgrada nije pronađena u nacrtu.");
  const entranceKey = trimOr(input.entranceKey) || null;
  if (entranceKey && !building.entrances.some((e) => e.key === entranceKey)) throw new Error("Ulaz ne pripada izabranoj zgradi.");
  if (!(UNIT_TYPES as readonly string[]).includes(input.type)) throw new Error("Izaberite vrstu posebnog dijela.");
  const label = trimOr(input.label);
  if (!label) throw new Error("Oznaka posebnog dijela je obavezna.");
  if (d.units.some((u) => u.key !== selfKey && u.buildingKey === building.key && u.label.toLowerCase() === label.toLowerCase())) {
    throw new Error(tf("onboarding.units.duplicateLabel", { oznaka: label, zgrada: building.name }));
  }
  const usableArea = positiveDecimal(input.usableArea, t("onboarding.units.usableArea"));
  const ownershipShare = positiveDecimal(input.ownershipShare, t("onboarding.units.ownershipShare"));
  if (Number(ownershipShare) > 100) throw new Error(`${t("onboarding.units.ownershipShare")}: najviše 100 %.`);
  return {
    buildingKey: building.key, entranceKey, type: input.type as DraftUnitType, label,
    floor: optionalInt(input.floor, t("onboarding.units.floor")), usableArea, ownershipShare,
  };
}

export async function addDraftUnit(actor: Pick<Actor, "userId">, version: number, input: DraftUnitInput) {
  return updateDraft(actor, "units", version, (d) => {
    assertRegisterOpen(d);
    return { ...d, units: [...d.units, { key: randomUUID(), ...validUnit(d, input, null) }] };
  });
}

export async function updateDraftUnit(actor: Pick<Actor, "userId">, version: number, key: string, input: DraftUnitInput) {
  return updateDraft(actor, "units", version, (d) => {
    assertRegisterOpen(d);
    if (!d.units.some((u) => u.key === key)) throw new Error("Posebni dio nije pronađen u nacrtu.");
    const next = validUnit(d, input, key);
    return { ...d, units: d.units.map((u) => (u.key === key ? { key, ...next } : u)) };
  });
}

export async function removeDraftUnit(actor: Pick<Actor, "userId">, version: number, key: string) {
  return updateDraft(actor, "units", version, (d) => {
    assertRegisterOpen(d);
    return { ...d, units: d.units.filter((u) => u.key !== key) };
  });
}

// Korak 6 — Zajednički dijelovi (D4: bar jedan zajednički prostor po zgradi).
const ASSET_KINDS = ["AREA", "SYSTEM", "EQUIPMENT"] as const;

export async function addDraftCommonAsset(
  actor: Pick<Actor, "userId">,
  version: number,
  input: { buildingKey: string; kind: string; name: string; description?: string | null }
) {
  const name = trimOr(input.name);
  if (!name) throw new Error("Naziv zajedničkog dijela je obavezan.");
  if (!(ASSET_KINDS as readonly string[]).includes(input.kind)) throw new Error("Izaberite vrstu zajedničkog dijela.");
  return updateDraft(actor, "commonAssets", version, (d) => {
    assertRegisterOpen(d);
    if (!d.buildings.some((b) => b.key === input.buildingKey)) throw new Error("Zgrada nije pronađena u nacrtu.");
    return {
      ...d,
      commonAssets: [
        ...d.commonAssets,
        { key: randomUUID(), buildingKey: input.buildingKey, kind: input.kind as (typeof ASSET_KINDS)[number], name, description: trimOr(input.description) || null },
      ],
    };
  });
}

export async function removeDraftCommonAsset(actor: Pick<Actor, "userId">, version: number, key: string) {
  return updateDraft(actor, "commonAssets", version, (d) => {
    assertRegisterOpen(d);
    return { ...d, commonAssets: d.commonAssets.filter((c) => c.key !== key) };
  });
}

// Korak 7 — Utvrđivanje registra. U nacrtu je to potvrda koja zaključava korake 4–6; pravo
// utvrđivanje (UnitRegisterChange ESTABLISH, verzija 1) radi objava u Fazi C. Korak 7 je dostupan
// samo kad su koraci 5 i 6 kompletni, pa su preduslovi registra tada već ispunjeni.
export async function confirmDraftRegister(actor: Pick<Actor, "userId">, version: number) {
  return updateDraft(actor, "register", version, (d) => {
    if (d.registerConfirmedAt) throw new Error("Registar je već potvrđen.");
    return { ...d, registerConfirmedAt: new Date().toISOString() };
  });
}

/** „Otključaj registar” (§4.1): u nacrtu nema pravne posljedice, pa se potvrda može povući. */
export async function unlockDraftRegister(actor: Pick<Actor, "userId">, version: number) {
  return updateDraft(actor, "register", version, (d) => {
    if (!d.registerConfirmedAt) throw new Error("Registar nije potvrđen.");
    return { ...d, registerConfirmedAt: null };
  });
}
