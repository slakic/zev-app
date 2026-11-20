// Izvoz kontnog plana u Excel (.xlsx) i PDF, za slanje računovođi na stručnu provjeru (v3.4.0).
//
// Dva izvora: kontni plan ZEV-a (pregled: `ledger.view`) i kontni predložak (super admin). Prvih šest kolona
// Excel lista su tačno u formatu uvoza kontnog predloška (šifra; naziv; nadređena; vrsta; knjižno; opis), pa
// ispravljen fajl, sačuvan kao CSV, može ići nazad na uvoz u nacrt predloška. Ostale kolone su za čitanje i
// prazna „Napomena računovođe”. Izvoz se ne čuva u Dokumentima (jednokratni izlaz), ali se bilježi u tragu.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireCapability, requireSuperAdmin, requireZev, type Actor } from "@/server/auth/guards";
import { flattenTree, parseCodeRules } from "@/lib/accountCodes";
import { formatDate, tEnum } from "@/lib/i18n";
import { buildXlsx } from "@/server/xlsx";
import { renderChartPdf } from "./documents";

export type ChartExportRow = {
  code: string;
  name: string;
  parentCode: string | null;
  nature: string;
  postable: boolean;
  /** Izostavljeno za konta predloška (nemaju aktivnost). */
  active?: boolean;
  description: string | null;
  depth: number;
};

export type ChartExport = {
  title: string;
  zevName: string | null;
  meta: [string, string][];
  notice: string;
  rows: ChartExportRow[];
  sourceRef: string;
  version: number;
  status: string;
  fileBase: string;
};

const NOTICE =
  "Dokument za stručnu provjeru kontnog plana. Nije zakonsko knjigovodstvo. Šifre klasa, grupa i sintetike provjeriti u " +
  "službenom tekstu kontnog okvira. Kolona „Provjera” / „Napomena računovođe” je za vaše oznake.";

function rulesText(raw: unknown): string {
  const r = parseCodeRules(raw);
  const parts = [
    r.digitsOnly ? "samo cifre" : null,
    r.childExtendsParent ? "šifra podkonta počinje šifrom nadređenog" : null,
    r.allowedLengths.length ? `dozvoljene dužine ${r.allowedLengths.join(", ")}` : null,
    r.maxDepth ? `najviše ${r.maxDepth} nivoa` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "bez ograničenja";
}

function toRows<T extends { id: string; code: string; name: string; parentId: string | null; nature: string; postable: boolean; description: string | null; active?: boolean }>(
  accounts: T[]
): ChartExportRow[] {
  const codeById = new Map(accounts.map((a) => [a.id, a.code]));
  return flattenTree(accounts).map((a) => ({
    code: a.code,
    name: a.name,
    parentCode: a.parentId ? codeById.get(a.parentId) ?? null : null,
    nature: a.nature,
    postable: a.postable,
    active: a.active,
    description: a.description,
    depth: a.depth,
  }));
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "dj").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "kontni-plan";

/** Kontni plan ZEV-a (trenutni, ne-povučen) sa svim kontima, i neaktivnim. */
export async function zevChartExport(actor: Actor): Promise<ChartExport> {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const chart = await prisma.zevChart.findFirst({
    where: { zevId, status: { not: "RETIRED" } },
    include: { zev: true, sourceTemplate: true, syncedTemplate: true, accounts: true },
  });
  if (!chart) throw new Error("ZEV još nema kontni plan.");
  const tpl = chart.sourceTemplate;
  const zevName = chart.zev.shortName || chart.zev.legalName;
  return {
    title: "Kontni plan",
    zevName: chart.zev.legalName,
    meta: [
      ["Status plana", tEnum("zevChartStatus", chart.status)],
      ["Nastao iz predloška", `${tpl.name}, verzija ${tpl.version}`],
      ["Pregledana verzija predloška", chart.syncedTemplate ? `verzija ${chart.syncedTemplate.version}` : "—"],
      ["Izvor okvira", tpl.source ?? "—"],
      ["Stručna provjera predloška", tpl.reviewedBy ? `${tpl.reviewedBy}, ${formatDate(tpl.reviewedAt)}` : "—"],
      ["Pravila šifara", rulesText(chart.codeRules)],
      ["Broj konta", String(chart.accounts.length)],
    ],
    notice: NOTICE,
    rows: toRows(chart.accounts),
    sourceRef: `ZevChart ${chart.id}`,
    version: tpl.version,
    status: chart.status,
    fileBase: `kontni-plan-${slug(zevName)}`,
  };
}

/** Kontni predložak (bilo koji status) — super admin, prije označavanja kao stručno provjeren. */
export async function templateExport(actor: Actor, templateId: string): Promise<ChartExport> {
  requireSuperAdmin(actor);
  const tpl = await prisma.chartTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { accounts: true } });
  return {
    title: "Kontni predložak",
    zevName: null,
    meta: [
      ["Predložak", `${tpl.name} (${tpl.key}), verzija ${tpl.version}`],
      ["Status", tEnum("chartTemplateStatus", tpl.status)],
      ["Jurisdikcija", tpl.jurisdiction],
      ["Izvor (propis)", tpl.source ?? "—"],
      ["Stručna provjera", tpl.reviewedBy ? `${tpl.reviewedBy}, ${formatDate(tpl.reviewedAt)}` : "—"],
      ["Pravila šifara", rulesText(tpl.codeRules)],
      ["Broj konta", String(tpl.accounts.length)],
    ],
    notice: NOTICE,
    rows: toRows(tpl.accounts),
    sourceRef: `ChartTemplate ${tpl.key} v${tpl.version}`,
    version: tpl.version,
    status: tpl.status,
    fileBase: `kontni-predlozak-${slug(tpl.key)}-v${tpl.version}`,
  };
}

export function chartXlsx(exp: ChartExport): Buffer {
  const header = ["šifra", "naziv", "nadređena", "vrsta", "knjižno", "opis", "Vrsta (naziv)", "Nivo", "Status", "Napomena računovođe"];
  const rows = exp.rows.map((r) => [
    r.code,
    r.name,
    r.parentCode ?? "",
    r.nature,
    r.postable ? "da" : "ne",
    r.description ?? "",
    tEnum("accountNature", r.nature),
    r.depth + 1,
    r.active === undefined ? "" : r.active ? "Aktivno" : "Neaktivno",
    "",
  ]);
  const boldRows = new Set(exp.rows.map((r, i) => (r.postable ? -1 : i)).filter((i) => i >= 0));
  return buildXlsx([
    { name: exp.title, rows: [header, ...rows], widths: [10, 48, 11, 15, 9, 40, 18, 6, 11, 40], boldRows },
    {
      name: "Podaci",
      rows: [
        ["Podatak", "Vrijednost"],
        ...(exp.zevName ? [["ZEV", exp.zevName]] : []),
        ...exp.meta,
        ["Izvezeno", formatDate(new Date())],
        ["Napomena", exp.notice],
        ["Format", "Kolone A–F lista „" + exp.title + "” su u formatu uvoza kontnog predloška; ispravljen fajl se može sačuvati kao CSV (razdvojen tačkom-zarezom) i uvesti u nacrt predloška."],
      ],
      widths: [30, 110],
    },
  ]);
}

export type ExportFormat = "xlsx" | "pdf";

/** Fajl za preuzimanje + trag u revizorskom tragu. */
export async function exportChartFile(
  actor: Actor,
  source: { kind: "zev" } | { kind: "template"; templateId: string },
  format: ExportFormat
): Promise<{ filename: string; contentType: string; body: Buffer }> {
  const exp = source.kind === "zev" ? await zevChartExport(actor) : await templateExport(actor, source.templateId);
  const body = format === "xlsx" ? chartXlsx(exp) : await renderChartPdf(exp);
  await audit(actor, {
    action: source.kind === "zev" ? "zev_chart.export" : "chart_template.export",
    targetType: source.kind === "zev" ? "ZevChart" : "ChartTemplate",
    targetId: source.kind === "zev" ? exp.sourceRef.replace("ZevChart ", "") : source.templateId,
    after: { format, accounts: exp.rows.length },
  });
  return {
    filename: `${exp.fileBase}.${format}`,
    contentType: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
    body,
  };
}
