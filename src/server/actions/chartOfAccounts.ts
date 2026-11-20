"use server";
// Server akcije kontnog plana (A1): /knjigovodstvo, /knjigovodstvo/konto/[id] i /admin/kontni-okviri.
// Svaka akcija samo čita formu i zove servis (chartOfAccounts.ts), koji provjerava prava i pravila;
// greška servisa se vraća na istu stranicu kao `err`, uspjeh kao `msg` (ključ poruke, ne tekst).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor, requireSuperAdminActor } from "@/server/actor";
import * as coa from "@/server/services/chartOfAccounts";
import { parseLengthList, type CodeRules } from "@/lib/accountCodes";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => (fd.get(k) ? String(fd.get(k)) : null);

function withParam(path: string, key: string, value: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/** Pokreće radnju; greška → `err` na `back`, uspjeh → `msg` na `next` (podrazumijevano isto mjesto). */
async function run(back: string, msg: string, fn: () => Promise<unknown>, next?: string) {
  let target = withParam(next ?? back, "msg", msg);
  try {
    const res = await fn();
    if (typeof res === "string") target = withParam(res, "msg", msg);
  } catch (e) {
    target = withParam(back, "err", e instanceof Error ? e.message : "Greška");
  }
  revalidatePath("/knjigovodstvo", "layout");
  revalidatePath("/admin/kontni-okviri", "layout");
  redirect(target);
}

// ---- ZEV: kontni plan -------------------------------------------------------

export async function assignChartAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("/knjigovodstvo", "assigned", () => coa.assignChart(actor, str(fd, "templateId")));
}

export async function activateChartAction() {
  const actor = await requireActor("ACCOUNTANT");
  await run("/knjigovodstvo", "activated", () => coa.activateChart(actor));
}

export async function retireChartAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("/knjigovodstvo", "retired", () => coa.retireChart(actor, str(fd, "reason")));
}

export async function addAccountAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  const back = str(fd, "back") === "account" && fd.get("parentId") ? `/knjigovodstvo/konto/${str(fd, "parentId")}` : "/knjigovodstvo";
  await run(back, "added", () =>
    coa.addAccount(actor, {
      parentId: opt(fd, "parentId"),
      code: str(fd, "code"),
      name: str(fd, "name"),
      description: opt(fd, "description"),
      nature: opt(fd, "nature"),
      postable: str(fd, "postable") === "1",
    })
  );
}

export async function updateAccountAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  const id = str(fd, "id");
  const structural = str(fd, "structural") === "1";
  await run(`/knjigovodstvo/konto/${id}`, "saved", () =>
    coa.updateAccount(actor, id, {
      name: str(fd, "name"),
      description: opt(fd, "description"),
      ...(structural
        ? { code: str(fd, "code"), nature: str(fd, "nature"), postable: str(fd, "postable") === "1", parentId: opt(fd, "parentId") }
        : {}),
    })
  );
}

export async function deactivateAccountAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  const id = str(fd, "id");
  await run(`/knjigovodstvo/konto/${id}`, "deactivated", () => coa.deactivateAccount(actor, id, str(fd, "reason")));
}

export async function reactivateAccountAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  const id = str(fd, "id");
  await run(`/knjigovodstvo/konto/${id}`, "reactivated", () => coa.reactivateAccount(actor, id));
}

export async function replaceAccountAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  const id = str(fd, "id");
  await run(`/knjigovodstvo/konto/${id}`, "replaced", async () => {
    const created = await coa.replaceAccount(
      actor,
      id,
      { code: str(fd, "code"), name: str(fd, "name"), description: opt(fd, "description"), nature: str(fd, "nature"), postable: str(fd, "postable") === "1" },
      str(fd, "reason")
    );
    return `/knjigovodstvo/konto/${created.id}`;
  });
}

export async function deleteAccountAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  const id = str(fd, "id");
  await run(`/knjigovodstvo/konto/${id}`, "deleted", () => coa.deleteAccount(actor, id), "/knjigovodstvo");
}

export async function openFiscalYearAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("/knjigovodstvo?tab=godine", "yearOpened", () =>
    coa.openFiscalYear(actor, {
      label: str(fd, "label"),
      startDate: str(fd, "startDate"),
      endDate: str(fd, "endDate"),
      periodicity: str(fd, "periodicity") === "YEARLY" ? "YEARLY" : "MONTHLY",
    })
  );
}

// ---- Platforma: kontni predlošci -----------------------------------------------

function codeRulesFrom(fd: FormData): CodeRules {
  const lengths = parseLengthList(str(fd, "allowedLengths"));
  if (lengths === null) throw new Error("Dozvoljene dužine šifre: unesite cijele brojeve odvojene zarezom.");
  const maxDepth = str(fd, "maxDepth").trim();
  if (maxDepth && !(Number.isInteger(Number(maxDepth)) && Number(maxDepth) > 0)) throw new Error("Najviše nivoa: unesite pozitivan cijeli broj.");
  return {
    digitsOnly: fd.get("digitsOnly") === "1",
    childExtendsParent: fd.get("childExtendsParent") === "1",
    allowedLengths: lengths,
    maxDepth: maxDepth ? Number(maxDepth) : null,
  };
}

function templateMeta(fd: FormData) {
  return {
    name: str(fd, "name"),
    jurisdiction: str(fd, "jurisdiction"),
    source: opt(fd, "source"),
    note: opt(fd, "note"),
    validFrom: opt(fd, "validFrom"),
    validTo: opt(fd, "validTo"),
    codeRules: codeRulesFrom(fd),
  };
}

export async function createTemplateAction(fd: FormData) {
  const actor = await requireSuperAdminActor();
  await run("/admin/kontni-okviri", "created", async () => {
    const tpl = await coa.createTemplate(actor, { ...templateMeta(fd), key: str(fd, "key") });
    return `/admin/kontni-okviri/${tpl.id}`;
  });
}

export async function updateTemplateAction(fd: FormData) {
  const actor = await requireSuperAdminActor();
  const id = str(fd, "id");
  await run(`/admin/kontni-okviri/${id}`, "saved", () => coa.updateTemplateDraft(actor, id, templateMeta(fd)));
}

export async function importTemplateAccountsAction(fd: FormData) {
  const actor = await requireSuperAdminActor();
  const id = str(fd, "id");
  const back = `/admin/kontni-okviri/${id}`;
  const file = fd.get("file");
  let target: string;
  try {
    if (!(file instanceof File) || file.size === 0) throw new Error("Izaberite CSV fajl.");
    const res = await coa.importTemplateAccounts(actor, id, await file.text());
    if (res.ok) {
      target = withParam(withParam(back, "msg", "imported"), "n", String(res.count));
    } else {
      const shown = res.errors.slice(0, 8).join(" ");
      const more = res.errors.length > 8 ? ` (još ${res.errors.length - 8} grešaka)` : "";
      target = withParam(back, "err", `Ništa nije uvezeno. ${shown}${more}`);
    }
  } catch (e) {
    target = withParam(back, "err", e instanceof Error ? e.message : "Greška");
  }
  revalidatePath("/admin/kontni-okviri", "layout");
  redirect(target);
}

export async function setTemplateStatusAction(fd: FormData) {
  const actor = await requireSuperAdminActor();
  const id = str(fd, "id");
  const target = str(fd, "target") as "DEMO" | "REVIEWED" | "RETIRED";
  await run(`/admin/kontni-okviri/${id}`, "status", () =>
    coa.setTemplateStatus(actor, id, target, { source: opt(fd, "source"), reviewedBy: opt(fd, "reviewedBy"), reviewedAt: opt(fd, "reviewedAt") })
  );
}

export async function createTemplateVersionAction(fd: FormData) {
  const actor = await requireSuperAdminActor();
  const id = str(fd, "id");
  await run(`/admin/kontni-okviri/${id}`, "versioned", async () => {
    const tpl = await coa.createTemplateVersion(actor, id);
    return `/admin/kontni-okviri/${tpl.id}`;
  });
}

export async function applyChartUpdateAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await run("/knjigovodstvo/izmjene", "synced", () =>
    coa.applyChartUpdate(actor, str(fd, "targetId"), {
      addCodes: fd.getAll("add").map(String),
      renameCodes: fd.getAll("rename").map(String),
    }),
  "/knjigovodstvo");
}

// ---- Platforma: pojedinačna konta u nacrtu predloška -------------------------------

function templateAccountInput(fd: FormData) {
  return {
    parentId: opt(fd, "parentId"),
    code: str(fd, "code"),
    name: str(fd, "name"),
    description: opt(fd, "description"),
    nature: str(fd, "nature"),
    postable: str(fd, "postable") === "1",
  };
}

export async function addTemplateAccountAction(fd: FormData) {
  const actor = await requireSuperAdminActor();
  const templateId = str(fd, "templateId");
  await run(`/admin/kontni-okviri/${templateId}`, "added", () => coa.addTemplateAccount(actor, templateId, templateAccountInput(fd)));
}

export async function updateTemplateAccountAction(fd: FormData) {
  const actor = await requireSuperAdminActor();
  const id = str(fd, "id");
  await run(`/admin/kontni-okviri/${str(fd, "templateId")}/konto/${id}`, "saved", () => coa.updateTemplateAccount(actor, id, templateAccountInput(fd)));
}

export async function deleteTemplateAccountAction(fd: FormData) {
  const actor = await requireSuperAdminActor();
  const id = str(fd, "id");
  const templateId = str(fd, "templateId");
  await run(`/admin/kontni-okviri/${templateId}/konto/${id}`, "deleted", () => coa.deleteTemplateAccount(actor, id), `/admin/kontni-okviri/${templateId}`);
}
