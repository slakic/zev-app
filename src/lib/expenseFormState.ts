// Stanje forme „Novi trošak” (F5b.3): upozorenje o duplikatu više ne ide kroz redirect (koji je gubio svih 11 polja),
// nego kroz `useActionState` — akcija vraća duplikate I unesene vrijednosti, pa se forma ponovo crta popunjena.

export type ExpenseDuplicateView = {
  id: string;
  invoiceNumber: string | null;
  amount: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceDate: string | null;
};

/** Polja forme koja se vraćaju nazad u formu (sve tekstualne vrijednosti; checkbox = "on" ili ""). `allowDuplicate` je namjerno izostavljen. */
export const EXPENSE_FORM_FIELDS = [
  "supplierId", "invoiceNumber", "invoiceDate", "amount", "dueDate", "description",
  "categoryName", "buildingId", "recurring", "projectId", "planItemId",
] as const;

export type ExpenseFormValues = Partial<Record<(typeof EXPENSE_FORM_FIELDS)[number], string>>;

export type ExpenseFormState =
  | { status: "idle"; nonce: number }
  | { status: "saved"; nonce: number }
  | { status: "duplicate"; nonce: number; duplicates: ExpenseDuplicateView[]; values: ExpenseFormValues }
  | { status: "error"; nonce: number; error: string; values: ExpenseFormValues };

export const EXPENSE_FORM_INITIAL: ExpenseFormState = { status: "idle", nonce: 0 };

/** Sve unesene vrijednosti iz `FormData` (bez `allowDuplicate`), za ponovno popunjavanje forme. */
export function expenseValuesFromForm(get: (name: string) => FormDataEntryValue | null): ExpenseFormValues {
  const out: ExpenseFormValues = {};
  for (const f of EXPENSE_FORM_FIELDS) {
    const v = get(f);
    out[f] = typeof v === "string" ? v : "";
  }
  return out;
}
