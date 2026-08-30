// English — demonstration that additional languages can be added without
// touching application logic. Missing keys fall back to sr-Latn.
import type srLatn from "./sr-Latn";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : string };

const en: DeepPartial<typeof srLatn> = {
  app: { name: "ZEV manager", tagline: "Homeowners' association management" },
  nav: {
    home: "Home",
    buildings: "Buildings & units",
    owners: "Owners & occupants",
    organs: "ZEV organs",
    assembly: "Assembly & decisions",
    invoices: "Invoices & payments",
    expenses: "Expenses",
    plans: "Plans",
    maintenance: "Maintenance",
    documents: "Documents",
    reports: "Reports",
    settings: "Settings",
    logout: "Log out",
    login: "Log in",
  },
};

export default en;
