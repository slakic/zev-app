// Informaciona arhitektura menija po ulogama (F9, odluka D8 opcija B: redoslijed po ulozi + naslov
// grupe). Čista funkcija, bez React-a i bez `t()`: vraća ključeve rječnika, a layout ih prevodi.
// Meni je samo PREDSTAVLJANJE — svaka stranica i servis i dalje sami provjeravaju ulogu i `zevId`
// (server je autoritet); ovdje se samo bira šta se prikazuje.
//
// Struktura se bira po NAJJAČOJ ulozi korisnika (PRESIDENT > ACCOUNTANT > OWNER), a svaka stavka
// se prikazuje samo ako je bar jedna uloga korisnika smije otvoriti.

export type NavRole = "PRESIDENT" | "ACCOUNTANT" | "OWNER";

export type NavItemSpec = { href: string; labelKey: string };
export type NavGroupSpec = {
  /** Ključ naslova grupe; izostavljen = grupa bez naslova (ravna lista, npr. platformski admin). */
  labelKey?: string;
  items: NavItemSpec[];
};

const MANAGEMENT: readonly NavRole[] = ["PRESIDENT", "ACCOUNTANT"];

type Rule = NavItemSpec & { roles?: readonly NavRole[] };

const item = (href: string, labelKey: string, roles?: readonly NavRole[]): Rule => ({ href, labelKey, roles });

const HOME = item("/", "nav.home");
const INVOICES = item("/fakture", "nav.invoices");
// Management has "Uplate" as its own item (R-Q1), so its invoices item is named for what the page holds.
const INVOICES_MGMT = item("/fakture", "nav.invoicesManagement");
const PAYMENTS = item("/fakture/uplate", "nav.payments", MANAGEMENT);
const EXPENSES = item("/troskovi", "nav.expenses", MANAGEMENT);
const REPORTS = item("/izvjestaji", "nav.reports", MANAGEMENT);
const OWNERS = item("/vlasnici", "nav.owners", MANAGEMENT);
const BUILDINGS = item("/zgrade", "nav.buildings");
const ORGANS = item("/organi", "nav.organs");
const ASSEMBLY = item("/skupstina", "nav.assembly");
const ASSEMBLY_OWNER = item("/skupstina", "nav.assemblyOwner");
const PLANS = item("/planovi", "nav.plans");
const MAINTENANCE = item("/odrzavanje", "nav.maintenance");
const DOCUMENTS = item("/dokumenti", "nav.documents");
const RECORDS = item("/evidencije", "nav.records", MANAGEMENT);
const SETTINGS_ZEV = item("/podesavanja", "nav.settingsZev", MANAGEMENT);

type GroupRule = { labelKey?: string; items: Rule[] };

const OWNER_LAYOUT: GroupRule[] = [
  { labelKey: "nav.group.mine", items: [HOME, INVOICES, ASSEMBLY_OWNER, MAINTENANCE, DOCUMENTS] },
  { labelKey: "nav.group.community", items: [BUILDINGS, ORGANS, PLANS] },
];

const PRESIDENT_LAYOUT: GroupRule[] = [
  { labelKey: "nav.group.daily", items: [HOME, INVOICES_MGMT, PAYMENTS, EXPENSES, ASSEMBLY, MAINTENANCE] },
  { labelKey: "nav.group.community", items: [OWNERS, BUILDINGS, ORGANS, PLANS, DOCUMENTS] },
  { labelKey: "nav.group.management", items: [REPORTS, RECORDS, SETTINGS_ZEV] },
];

const ACCOUNTANT_LAYOUT: GroupRule[] = [
  { labelKey: "nav.group.finance", items: [HOME, INVOICES_MGMT, PAYMENTS, EXPENSES, REPORTS] },
  { labelKey: "nav.group.community", items: [OWNERS, BUILDINGS, PLANS, MAINTENANCE, ASSEMBLY, ORGANS, DOCUMENTS] },
  { labelKey: "nav.group.management", items: [RECORDS, SETTINGS_ZEV] },
];

function layoutFor(roles: readonly NavRole[]): GroupRule[] {
  if (roles.includes("PRESIDENT")) return PRESIDENT_LAYOUT;
  if (roles.includes("ACCOUNTANT")) return ACCOUNTANT_LAYOUT;
  return OWNER_LAYOUT;
}

/** Meni prijavljene aplikacije (jedan ZEV) za date uloge. Super admin koji ujedno ima članstvo
 *  dobija dodatnu grupu „Platforma” (povratak na /admin) na kraju. Prazne grupe se izostavljaju. */
export function buildTenantNav(roles: readonly NavRole[], opts: { isSuperAdmin?: boolean } = {}): NavGroupSpec[] {
  const allowed = (r: Rule) => !r.roles || r.roles.some((x) => roles.includes(x));
  const groups: NavGroupSpec[] = layoutFor(roles)
    .map((g) => ({
      labelKey: g.labelKey,
      items: g.items.filter(allowed).map(({ href, labelKey }) => ({ href, labelKey })),
    }))
    .filter((g) => g.items.length > 0);
  if (opts.isSuperAdmin) {
    groups.push({ labelKey: "nav.group.platform", items: [{ href: "/admin", labelKey: "nav.superAdmin" }] });
  }
  return groups;
}

/** Vlasnik nema „Podešavanja” u bočnom meniju (X-Q6): ista stranica živi u meniju naloga kao
 *  „Moji podaci”. Svako ko ima stavku /podesavanja u bočnom meniju je ne dobija i tamo. */
export function settingsInAccountMenu(roles: readonly NavRole[]): boolean {
  return !buildTenantNav(roles).some((g) => g.items.some((i) => i.href === "/podesavanja"));
}

/** Platformska školjka (/admin): ravna lista; „Moj ZEV” samo kad super admin ima aktivni ZEV. */
export function buildPlatformNav(opts: { hasZev: boolean }): NavGroupSpec[] {
  const items: NavItemSpec[] = [
    { href: "/admin", labelKey: "admin.accounts" },
    { href: "/admin/aktivnosti", labelKey: "admin.activity" },
    { href: "/admin/sesije", labelKey: "admin.sessions" },
    { href: "/admin/podesavanja", labelKey: "admin.settings" },
  ];
  if (opts.hasZev) items.push({ href: "/", labelKey: "admin.myZev" });
  return [{ items }];
}
