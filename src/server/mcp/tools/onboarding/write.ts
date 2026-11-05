// Alati za upis u nacrt, Faza O-B (Plans/mcp-onboarding-asistent-plan.md §2): koraci 2–6 i 9. Svaki alat je tanak
// omotač oko funkcije koraka čarobnjaka (src/server/services/onboarding.ts) — ista pravila polja, isti guard koraka
// (nema pisanja u korak iza trenutnog ni u korake 4–6 posle potvrde registra) i ista optimistička brava (`expected_version`).
// Namjerno NEMA alata za potvrdu ili otključavanje registra, objavu, naloge sa lozinkom ni odbacivanje nacrta.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { McpToolDef } from "@/server/mcp/tools/registry";
import type { McpRequestContext } from "@/server/mcp/auth";
import { DraftAccessError } from "@/server/services/draftAccess";
import {
  DRAFT_BATCH_MAX,
  addDraftAccount,
  addDraftBoardMember,
  addDraftBuilding,
  addDraftCommonAssets,
  addDraftEntrance,
  addDraftUnits,
  removeDraftAccount,
  removeDraftBoardMember,
  removeDraftBuilding,
  removeDraftCommonAsset,
  removeDraftEntrance,
  removeDraftUnit,
  saveZevStep,
  setAccountantLater,
  setDraftAccountant,
  updateDraftUnit,
} from "@/server/services/onboarding";
import { ASSET_KINDS, UNIT_TYPES, type DraftUnitInput } from "@/lib/onboarding/rules";
import { t } from "@/lib/i18n";
import {
  draftIdInput,
  expectedVersionInput,
  partyChoice,
  partyInput,
  runDraftWrite,
  writeAnnotations,
  type DraftWriteSpec,
} from "@/server/mcp/tools/onboarding/common";

const key = z.string().min(1).max(100);
const text = (max: number) => z.string().max(max);
/** Datum `yyyy-mm-dd`. */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum u obliku yyyy-mm-dd.");
/** Broj kao string ("62.40", "62,40") ili broj (62.4) — servis ga normalizuje istim pravilom kao forma. */
const decimal = z.union([z.string().max(30), z.number()]).transform(String);
const base = { draft_id: draftIdInput, expected_version: expectedVersionInput };

/** Jedan alat upisa: registracija sa zajedničkim ulazom i omotačem runDraftWrite. */
function writeTool<S extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  input: S;
  destructive?: boolean;
  spec: Omit<DraftWriteSpec<z.infer<z.ZodObject<S & typeof base>>>, "tool">;
}): McpToolDef {
  return {
    name: def.name,
    requires: "ONBOARDING_DRAFT",
    register(server: McpServer, ctx: McpRequestContext) {
      server.registerTool(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema: z.object({ ...base, ...def.input }),
          annotations: writeAnnotations(def.destructive),
        },
        async (args) => {
          const a = args as z.infer<z.ZodObject<S & typeof base>>;
          return runDraftWrite(ctx, (args as { draft_id?: string }).draft_id, a, { tool: def.name, ...def.spec });
        }
      );
    },
  };
}

const one = () => 1;

// ---- Korak 2 — Podaci o ZEV-u --------------------------------------------------------------------------------

const zevFields = {
  legal_name: text(200).optional(),
  short_name: text(100).optional(),
  registration_number: text(50).optional(),
  jib: text(30).optional(),
  registered_address: text(200).optional(),
  city: text(100).optional(),
  municipality: text(100).optional(),
  founding_date: date.or(z.literal("")).optional(),
  registration_date: date.or(z.literal("")).optional(),
};

export const saveZevDetailsTool = writeTool({
  name: "save_zev_details",
  title: "Podaci o ZEV-u",
  description:
    "Upisuje podatke o ZEV-u iz rješenja o registraciji (korak 2). Polja koja ne pošaljete ostaju kakva jesu. Neispravan JIB se čuva, ali korak ostaje nekompletan (`jibValid: false`) dok se ne ispravi.",
  input: zevFields,
  spec: {
    items: one,
    async run(access, draft, a) {
      const z0 = draft.data.zev;
      const pick = (v: string | undefined, cur: string) => (v === undefined ? cur : v);
      const res = await saveZevStep(access, a.expected_version, {
        legalName: pick(a.legal_name, z0.legalName), shortName: pick(a.short_name, z0.shortName),
        registrationNumber: pick(a.registration_number, z0.registrationNumber), jib: pick(a.jib, z0.jib),
        registeredAddress: pick(a.registered_address, z0.registeredAddress), city: pick(a.city, z0.city),
        municipality: pick(a.municipality, z0.municipality), foundingDate: pick(a.founding_date, z0.foundingDate),
        registrationDate: pick(a.registration_date, z0.registrationDate),
      });
      return { version: res.version, result: { jibValid: res.jibValid } };
    },
  },
});

// ---- Korak 3 — Računi ----------------------------------------------------------------------------------------

export const addBankAccountTool = writeTool({
  name: "add_bank_account",
  title: "Dodaj račun",
  description:
    "Dodaje račun ZEV-a (korak 3): BANK = bankovni račun (broj je obavezan i provjerava se kontrolni broj), CASH = blagajna. Početno stanje i datum početnog stanja su obavezni.",
  input: {
    type: z.enum(["BANK", "CASH"]),
    name: text(100),
    bank_name: text(100).optional(),
    number: text(40).optional(),
    opening_balance: decimal,
    opening_date: date,
  },
  spec: {
    items: one,
    created: (d) => d.accounts.map((x) => ({ key: x.key, name: x.name })),
    run: async (access, _d, a) => ({
      version: await addDraftAccount(access, a.expected_version, {
        type: a.type, name: a.name, bankName: a.bank_name, number: a.number, openingBalance: a.opening_balance, openingDate: a.opening_date,
      }),
    }),
  },
});

export const removeAccountTool = writeTool({
  name: "remove_account",
  title: "Ukloni račun",
  description: "Uklanja račun iz nacrta (korak 3). `key` je ključ računa iz get_draft.",
  input: { key },
  destructive: true,
  spec: { items: one, run: async (access, _d, a) => ({ version: await removeDraftAccount(access, a.expected_version, a.key) }) },
});

// ---- Korak 4 — Zgrade i ulazi --------------------------------------------------------------------------------

export const addBuildingTool = writeTool({
  name: "add_building",
  title: "Dodaj zgradu",
  description: "Dodaje zgradu (korak 4). Naziv je jedinstven u nacrtu. Vraća ključ nove zgrade (`created`) za ulaze i posebne dijelove.",
  input: {
    name: text(100),
    address: text(200),
    cadastral_ref: text(100).optional(),
    year_built: z.number().int().optional(),
    floors_count: z.number().int().optional(),
  },
  spec: {
    items: one,
    created: (d) => d.buildings.map((b) => ({ key: b.key, name: b.name })),
    run: async (access, _d, a) => ({
      version: await addDraftBuilding(access, a.expected_version, {
        name: a.name, address: a.address, cadastralRef: a.cadastral_ref,
        yearBuilt: a.year_built === undefined ? null : String(a.year_built),
        floorsCount: a.floors_count === undefined ? null : String(a.floors_count),
      }),
    }),
  },
});

export const removeBuildingTool = writeTool({
  name: "remove_building",
  title: "Ukloni zgradu",
  description: "Uklanja zgradu i sve njene ulaze, posebne i zajedničke dijelove iz nacrta (korak 4; samo dok registar nije potvrđen).",
  input: { key },
  destructive: true,
  spec: { items: one, run: async (access, _d, a) => ({ version: await removeDraftBuilding(access, a.expected_version, a.key) }) },
});

export const addEntranceTool = writeTool({
  name: "add_entrance",
  title: "Dodaj ulaz",
  description: "Dodaje ulaz u zgradu (korak 4). Naziv ulaza je jedinstven u zgradi.",
  input: { building_key: key, name: text(100) },
  spec: {
    items: one,
    created: (d) => d.buildings.flatMap((b) => b.entrances.map((e) => ({ key: e.key, buildingKey: b.key, name: e.name }))),
    run: async (access, _d, a) => ({ version: await addDraftEntrance(access, a.expected_version, a.building_key, a.name) }),
  },
});

export const removeEntranceTool = writeTool({
  name: "remove_entrance",
  title: "Ukloni ulaz",
  description: "Uklanja ulaz iz zgrade (korak 4); posebni dijelovi tog ulaza ostaju u zgradi bez ulaza.",
  input: { building_key: key, entrance_key: key },
  destructive: true,
  spec: {
    items: one,
    run: async (access, _d, a) => ({ version: await removeDraftEntrance(access, a.expected_version, a.building_key, a.entrance_key) }),
  },
});

// ---- Korak 5 — Posebni dijelovi ------------------------------------------------------------------------------

const unitFields = {
  building_key: key,
  entrance_key: key.optional(),
  type: z.enum(UNIT_TYPES),
  label: text(50),
  floor: z.number().int().optional(),
  usable_area: decimal,
  ownership_share: decimal,
};
const unitInput = (u: z.infer<z.ZodObject<typeof unitFields>>): DraftUnitInput => ({
  buildingKey: u.building_key, entranceKey: u.entrance_key ?? null, type: u.type, label: u.label,
  floor: u.floor === undefined ? null : String(u.floor), usableArea: u.usable_area, ownershipShare: u.ownership_share,
});

export const addUnitsTool = writeTool({
  name: "add_units",
  title: "Dodaj posebne dijelove",
  description: `Dodaje posebne dijelove iz etažnog elaborata (korak 5), do ${DRAFT_BATCH_MAX} u jednom pozivu. Sve ili ništa: ako ijedna stavka ne prođe pravila (oznaka jedinstvena u zgradi, površina > 0, udio u (0, 100]), ništa se ne upisuje, a \`issues\` navodi redni broj (od 1) i razlog. Udio je suvlasnički udio u %.`,
  input: { units: z.array(z.object(unitFields)).min(1).max(DRAFT_BATCH_MAX) },
  spec: {
    items: (a) => a.units.length,
    created: (d) => d.units.map((u) => ({ key: u.key, buildingKey: u.buildingKey, label: u.label })),
    run: async (access, _d, a) => ({ version: await addDraftUnits(access, a.expected_version, a.units.map(unitInput)) }),
  },
});

export const updateUnitTool = writeTool({
  name: "update_unit",
  title: "Izmijeni posebni dio",
  description: "Mijenja jedan posebni dio (korak 5; samo dok registar nije potvrđen). Šalju se sva polja dijela, kao pri dodavanju.",
  input: { key, ...unitFields },
  spec: {
    items: one,
    run: async (access, _d, a) => ({ version: await updateDraftUnit(access, a.expected_version, a.key, unitInput(a)) }),
  },
});

export const removeUnitTool = writeTool({
  name: "remove_unit",
  title: "Ukloni posebni dio",
  description: "Uklanja posebni dio iz nacrta (korak 5; samo dok registar nije potvrđen).",
  input: { key },
  destructive: true,
  spec: { items: one, run: async (access, _d, a) => ({ version: await removeDraftUnit(access, a.expected_version, a.key) }) },
});

// ---- Korak 6 — Zajednički dijelovi ---------------------------------------------------------------------------

export const addCommonAssetsTool = writeTool({
  name: "add_common_assets",
  title: "Dodaj zajedničke dijelove",
  description: `Dodaje zajedničke dijelove zgrade (korak 6), do ${DRAFT_BATCH_MAX} u jednom pozivu: AREA = prostor (stepenište, krov…), SYSTEM = instalacija, EQUIPMENT = oprema. Sve ili ništa, greške po rednom broju (\`issues\`).`,
  input: {
    assets: z
      .array(z.object({ building_key: key, kind: z.enum(ASSET_KINDS), name: text(100), description: text(500).optional() }))
      .min(1)
      .max(DRAFT_BATCH_MAX),
  },
  spec: {
    items: (a) => a.assets.length,
    created: (d) => d.commonAssets.map((c) => ({ key: c.key, buildingKey: c.buildingKey, name: c.name })),
    run: async (access, _d, a) => ({
      version: await addDraftCommonAssets(
        access,
        a.expected_version,
        a.assets.map((x) => ({ buildingKey: x.building_key, kind: x.kind, name: x.name, description: x.description }))
      ),
    }),
  },
});

export const removeCommonAssetTool = writeTool({
  name: "remove_common_asset",
  title: "Ukloni zajednički dio",
  description: "Uklanja zajednički dio iz nacrta (korak 6; samo dok registar nije potvrđen).",
  input: { key },
  destructive: true,
  spec: { items: one, run: async (access, _d, a) => ({ version: await removeDraftCommonAsset(access, a.expected_version, a.key) }) },
});

// ---- Korak 9 — Organi (bez naloga i lozinki) ------------------------------------------------------------------

export const setAccountantTool = writeTool({
  name: "set_accountant",
  title: "Računovođa",
  description:
    "Određuje računovođu (korak 9): postojeće lice (`party_key` iz get_draft, ili \"president\") ili novo lice (`new_party`). Nalog za prijavu računovođe ne otvara — to radi klijent u aplikaciji.",
  input: { ...partyInput, valid_from: date },
  spec: {
    items: one,
    async run(access, draft, a) {
      const cur = draft.data.offices.accountant;
      if (cur && cur !== "LATER" && cur.loginEmail) throw new DraftAccessError(t("assistants.errors.accountantHasLogin"));
      return { version: await setDraftAccountant(access, a.expected_version, { ...partyChoice(a), validFrom: a.valid_from }) };
    },
  },
});

export const setAccountantLaterTool = writeTool({
  name: "set_accountant_later",
  title: "Računovođa kasnije",
  description: "`later: true` = računovođu klijent dodaje kasnije (korak 9 je kompletan bez njega); `false` poništava taj izbor.",
  input: { later: z.boolean() },
  spec: {
    items: one,
    async run(access, draft, a) {
      const cur = draft.data.offices.accountant;
      if (cur && cur !== "LATER" && cur.loginEmail) throw new DraftAccessError(t("assistants.errors.accountantHasLogin"));
      return { version: await setAccountantLater(access, a.expected_version, a.later) };
    },
  },
});

export const addBoardMemberTool = writeTool({
  name: "add_board_member",
  title: "Dodaj člana upravnog odbora",
  description: "Dodaje člana upravnog odbora (korak 9): postojeće lice (`party_key`) ili novo (`new_party`). Bez naloga i lozinki.",
  input: { ...partyInput, valid_from: date },
  spec: {
    items: one,
    created: (d) => d.offices.board.map((b) => ({ key: b.key, partyKey: b.partyKey })),
    run: async (access, _d, a) => ({ version: await addDraftBoardMember(access, a.expected_version, { ...partyChoice(a), validFrom: a.valid_from }) }),
  },
});

export const removeBoardMemberTool = writeTool({
  name: "remove_board_member",
  title: "Ukloni člana upravnog odbora",
  description: "Uklanja člana upravnog odbora iz nacrta (korak 9). `key` je ključ člana iz get_draft (`offices.board`).",
  input: { key },
  destructive: true,
  spec: { items: one, run: async (access, _d, a) => ({ version: await removeDraftBoardMember(access, a.expected_version, a.key) }) },
});

export const WRITE_TOOLS: McpToolDef[] = [
  saveZevDetailsTool,
  addBankAccountTool,
  removeAccountTool,
  addBuildingTool,
  removeBuildingTool,
  addEntranceTool,
  removeEntranceTool,
  addUnitsTool,
  updateUnitTool,
  removeUnitTool,
  addCommonAssetsTool,
  removeCommonAssetTool,
  setAccountantTool,
  setAccountantLaterTool,
  addBoardMemberTool,
  removeBoardMemberTool,
];

export { writeTool };
