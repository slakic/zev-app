"use client";
// An account's table row plus its inline edit panel — same shape as building-row.tsx: a small
// client island only so "Otkaži" can close the panel without a reload; saving goes through the
// normal server action + redirect. Only name, bank and account number are editable (see
// updateAccount in finance.ts for why type and opening balance are not).
import { useState } from "react";
import { Td, Field, inputCls, SubmitBtn, RowAction, Btn } from "@/components/ui";

type AccountRowData = {
  id: string;
  name: string;
  type: "BANK" | "CASH";
  bankName: string | null;
  iban: string | null;
  openingBalanceLabel: string;
};

export function AccountRow({
  account,
  action,
}: {
  account: AccountRowData;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const a = account;

  return (
    <>
      <tr className={open ? "bg-slate-50" : undefined}>
        <Td>
          <div>{a.name}</div>
          {a.bankName && <div className="mt-0.5 text-[13px] text-slate-500">{a.bankName}</div>}
        </Td>
        <Td>{a.type === "BANK" ? "Banka" : "Blagajna"}</Td>
        <Td className="font-mono text-xs">{a.iban ?? "—"}</Td>
        <Td>{a.openingBalanceLabel}</Td>
        <Td>
          <RowAction type="button" onClick={() => setOpen((v) => !v)}>
            {open ? "Zatvori" : "Uredi"}
          </RowAction>
        </Td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={5} className="border-t border-slate-100 px-4 py-4">
            <form action={action} className="grid max-w-md grid-cols-1 gap-3">
              <input type="hidden" name="id" value={a.id} />
              <Field label="Naziv"><input name="name" defaultValue={a.name} required className={inputCls} /></Field>
              <Field label="Banka"><input name="bankName" defaultValue={a.bankName ?? ""} className={inputCls} /></Field>
              <Field label="Broj računa" hint="Kako piše na izvodu, npr. 555-10000515469-32">
                <input name="iban" defaultValue={a.iban ?? ""} className={inputCls} />
              </Field>
              <div className="flex items-center gap-2 border-t border-slate-200 pt-3">
                <SubmitBtn>Sačuvaj izmjene</SubmitBtn>
                <Btn type="button" onClick={() => setOpen(false)}>Otkaži</Btn>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
