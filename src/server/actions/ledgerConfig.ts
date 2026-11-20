"use server";
// Server akcije taba „Pravila knjiženja” (A2). Samo čitaju formu i zovu ledgerConfig.ts, koji provjerava prava i
// pravila; greška se vraća kao `err`, uspjeh kao `msg` (ključ poruke iz `ledger.msg`).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import * as lc from "@/server/services/ledgerConfig";
import type { ControlRole, GatedSchema } from "@/generated/prisma/client";

const BACK = "/knjigovodstvo?tab=pravila";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => (fd.get(k) ? String(fd.get(k)) : null);

async function run(msg: string, fn: () => Promise<unknown>, anchor = "") {
  let target = `${BACK}&msg=${msg}${anchor}`;
  try {
    await fn();
  } catch (e) {
    target = `${BACK}&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}${anchor}`;
  }
  revalidatePath("/knjigovodstvo");
  redirect(target);
}

export async function starterSetupAction() {
  const actor = await requireActor("ACCOUNTANT");
  await run("starter", () => lc.applyStarterSetup(actor), "#vrste");
}

export async function createPurposeAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("purposeAdded", () =>
    lc.createPurpose(actor, { code: str(fd, "code"), name: str(fd, "name"), isCommonReserve: fd.get("isCommonReserve") === "1", decisionRef: opt(fd, "decisionRef") }),
  "#vrste");
}

export async function createChargeTypeAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("chargeTypeAdded", () => lc.createChargeType(actor, { code: str(fd, "code"), name: str(fd, "name"), defaultPurposeId: opt(fd, "defaultPurposeId") }), "#vrste");
}

export async function setChargeItemTypeAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("saved", () => lc.setChargeItemType(actor, str(fd, "chargeItemId"), opt(fd, "chargeTypeId")), "#stavke");
}

export async function setControlAccountAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("controlSet", () =>
    lc.setControlAccount(actor, {
      role: str(fd, "role") as ControlRole,
      accountId: str(fd, "accountId"),
      moneyAccountId: opt(fd, "moneyAccountId"),
      purposeId: opt(fd, "purposeId"),
      validFrom: str(fd, "validFrom"),
      reason: opt(fd, "reason"),
    }),
  "#kontrolna");
}

export async function applySuggestedControlsAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("controlSet", () => lc.applySuggestedControlAccounts(actor, str(fd, "validFrom")), "#kontrolna");
}

export async function createRuleDraftAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("ruleDraft", () =>
    lc.createRuleDraft(actor, {
      kind: str(fd, "kind"),
      chargeTypeId: opt(fd, "chargeTypeId"),
      categoryId: opt(fd, "categoryId"),
      counterAccountId: str(fd, "counterAccountId"),
      purposeId: opt(fd, "purposeId"),
      validFrom: str(fd, "validFrom"),
      reason: str(fd, "reason"),
      expertRef: opt(fd, "expertRef"),
    }),
  "#pravila");
}

export async function confirmRuleAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("ruleConfirmed", () => lc.confirmRule(actor, str(fd, "id"), str(fd, "expertRef")), "#pravila");
}

export async function withdrawRuleAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("ruleWithdrawn", () => lc.withdrawRule(actor, str(fd, "id"), str(fd, "reason")), "#pravila");
}

export async function recordSchemaApprovalAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("schemaApproved", () =>
    lc.recordSchemaApproval(actor, {
      schema: str(fd, "schema") as GatedSchema,
      description: str(fd, "description"),
      expertName: str(fd, "expertName"),
      approvedAt: str(fd, "approvedAt"),
    }),
  "#kapije");
}

export async function revokeSchemaApprovalAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("schemaRevoked", () => lc.revokeSchemaApproval(actor, str(fd, "schema") as GatedSchema, str(fd, "reason")), "#kapije");
}

export async function setAllocationRuleAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("saved", () => lc.setAllocationRule(actor, str(fd, "value")), "#raspodjela");
}
