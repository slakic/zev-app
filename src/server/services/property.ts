// ZEV, buildings, entrances, units, allocation groups, common assets.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireAnyUser, requireZev, type Actor } from "@/server/auth/guards";
import type { Prisma, UnitType, CommonAssetKind } from "@/generated/prisma/client";

export async function getZev(actor: Actor) {
  requireAnyUser(actor);
  return prisma.zev.findUnique({ where: { id: requireZev(actor) }, include: { accounts: true, buildings: true } });
}

export async function upsertZev(
  actor: Actor,
  data: {
    legalName: string;
    shortName?: string | null;
    registrationNumber?: string | null;
    jib?: string | null;
    registeredAddress?: string | null;
    city?: string | null;
    municipality?: string | null;
    foundingDate?: Date | null;
    registrationDate?: Date | null;
    note?: string | null;
  }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const existing = await prisma.zev.findUnique({ where: { id: zevId } });
  // The create() branch is a defensive fallback only (today's session invariants mean
  // actor.zevId is never populated without an existing Zev row — see docs/multitenancy-plan.md
  // §5) — but if it's ever reached, create the row AT the actor's own zevId rather than a
  // fresh cuid, so it never drifts from the tenant the actor is already scoped to.
  const zev = existing
    ? await prisma.zev.update({ where: { id: zevId }, data })
    : await prisma.zev.create({ data: { id: zevId, ...data } });
  await audit(actor, {
    action: existing ? "zev.update" : "zev.create",
    targetType: "Zev",
    targetId: zev.id,
    before: existing ? { legalName: existing.legalName, jib: existing.jib } : undefined,
    after: { legalName: zev.legalName, jib: zev.jib },
  });
  return zev;
}

// ---- Buildings / entrances ----

export async function listBuildings(actor: Actor) {
  requireAnyUser(actor);
  return prisma.building.findMany({
    where: { zevId: requireZev(actor) },
    include: { entrances: true, _count: { select: { units: true } } },
    orderBy: { name: "asc" },
  });
}

export async function createBuilding(
  actor: Actor,
  data: { name: string; address: string; cadastralRef?: string | null; yearBuilt?: number | null; floorsCount?: number | null }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const b = await prisma.building.create({ data: { ...data, zevId } });
  await audit(actor, { action: "building.create", targetType: "Building", targetId: b.id, after: { name: b.name, address: b.address } });
  return b;
}

export async function updateBuilding(actor: Actor, id: string, data: Prisma.BuildingUpdateInput) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const before = await prisma.building.findUniqueOrThrow({ where: { id, zevId } });
  const b = await prisma.building.update({ where: { id, zevId }, data });
  await audit(actor, {
    action: "building.update", targetType: "Building", targetId: id,
    before: { name: before.name, address: before.address },
    after: { name: b.name, address: b.address },
  });
  return b;
}

export async function createEntrance(
  actor: Actor,
  data: { buildingId: string; name: string; address?: string | null }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  await prisma.building.findUniqueOrThrow({ where: { id: data.buildingId, zevId } });
  const e = await prisma.entrance.create({ data: { ...data, zevId } });
  await audit(actor, { action: "entrance.create", targetType: "Entrance", targetId: e.id, after: { name: e.name } });
  return e;
}

// ---- Units ----

export async function listUnits(actor: Actor, filter?: { buildingId?: string; entranceId?: string }) {
  requireAnyUser(actor);
  return prisma.unit.findMany({
    where: { zevId: requireZev(actor), buildingId: filter?.buildingId, entranceId: filter?.entranceId },
    include: {
      building: true,
      entrance: true,
      ownershipStakes: {
        where: { validTo: null },
        include: { owner: true },
      },
      occupancies: { where: { validTo: null }, include: { party: true } },
    },
    orderBy: [{ building: { name: "asc" } }, { label: "asc" }],
  });
}

export async function createUnit(
  actor: Actor,
  data: {
    buildingId: string;
    entranceId?: string | null;
    type: UnitType;
    label: string;
    floor?: number | null;
    usableArea: string;
    ownershipShare: string;
    occupantCount?: number;
    typeCoefficient?: string;
  }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  await prisma.building.findUniqueOrThrow({ where: { id: data.buildingId, zevId } });
  if (data.entranceId) {
    await prisma.entrance.findUniqueOrThrow({ where: { id: data.entranceId, zevId } });
  }
  const u = await prisma.unit.create({
    data: {
      zevId,
      buildingId: data.buildingId,
      entranceId: data.entranceId ?? null,
      type: data.type,
      label: data.label,
      floor: data.floor ?? null,
      usableArea: data.usableArea,
      ownershipShare: data.ownershipShare,
      occupantCount: data.occupantCount ?? 0,
      typeCoefficient: data.typeCoefficient ?? "1",
    },
  });
  await audit(actor, { action: "unit.create", targetType: "Unit", targetId: u.id, after: { label: u.label, type: u.type } });
  return u;
}

export async function updateUnit(actor: Actor, id: string, data: Prisma.UnitUncheckedUpdateInput) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const before = await prisma.unit.findUniqueOrThrow({ where: { id, zevId } });
  const u = await prisma.unit.update({ where: { id, zevId }, data });
  await audit(actor, {
    action: "unit.update", targetType: "Unit", targetId: id,
    before: { label: before.label, usableArea: String(before.usableArea), occupantCount: before.occupantCount },
    after: { label: u.label, usableArea: String(u.usableArea), occupantCount: u.occupantCount },
  });
  return u;
}

// ---- Allocation groups ----

export async function listAllocationGroups(actor: Actor) {
  requireAnyUser(actor);
  return prisma.allocationGroup.findMany({
    where: { zevId: requireZev(actor) },
    include: { members: { include: { unit: true } } },
  });
}

export async function createAllocationGroup(
  actor: Actor,
  data: { name: string; note?: string | null; members: { unitId: string; weight?: string }[] }
) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  if (data.members.length > 0) {
    const count = await prisma.unit.count({ where: { zevId, id: { in: data.members.map((m) => m.unitId) } } });
    if (count !== new Set(data.members.map((m) => m.unitId)).size) {
      throw new Error("Jedna ili više jedinica ne pripadaju ovom ZEV-u.");
    }
  }
  const g = await prisma.allocationGroup.create({
    data: {
      zevId,
      name: data.name,
      note: data.note ?? null,
      members: { create: data.members.map((m) => ({ unitId: m.unitId, weight: m.weight ?? "1" })) },
    },
  });
  await audit(actor, { action: "allocation_group.create", targetType: "AllocationGroup", targetId: g.id, after: { name: g.name } });
  return g;
}

// ---- Common assets ----

export async function listCommonAssets(actor: Actor) {
  requireAnyUser(actor);
  return prisma.commonAsset.findMany({
    where: { zevId: requireZev(actor) },
    include: { building: true },
    orderBy: { name: "asc" },
  });
}

export async function createCommonAsset(
  actor: Actor,
  data: { buildingId?: string | null; kind: CommonAssetKind; name: string; description?: string | null; warrantyUntil?: Date | null }
) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  if (data.buildingId) {
    await prisma.building.findUniqueOrThrow({ where: { id: data.buildingId, zevId } });
  }
  const a = await prisma.commonAsset.create({ data: { ...data, zevId } });
  await audit(actor, { action: "common_asset.create", targetType: "CommonAsset", targetId: a.id, after: { name: a.name, kind: a.kind } });
  return a;
}

/** Units in a charge/proposal/plan scope — always scoped to the caller's tenant. */
export async function unitsInScope(
  zevId: string,
  scope: {
    scopeType: "ZEV" | "BUILDING" | "ENTRANCE" | "UNITS" | "GROUP";
    buildingId?: string | null;
    entranceId?: string | null;
    allocationGroupId?: string | null;
    unitIds?: string[];
  }
) {
  switch (scope.scopeType) {
    case "ZEV":
      return prisma.unit.findMany({ where: { zevId, active: true } });
    case "BUILDING":
      return prisma.unit.findMany({ where: { zevId, active: true, buildingId: scope.buildingId ?? undefined } });
    case "ENTRANCE":
      return prisma.unit.findMany({ where: { zevId, active: true, entranceId: scope.entranceId ?? undefined } });
    case "UNITS":
      return prisma.unit.findMany({ where: { zevId, active: true, id: { in: scope.unitIds ?? [] } } });
    case "GROUP": {
      const members = await prisma.allocationGroupMember.findMany({
        where: { groupId: scope.allocationGroupId ?? "", group: { zevId } },
        include: { unit: true },
      });
      return members.map((m) => m.unit).filter((u) => u.active);
    }
  }
}
