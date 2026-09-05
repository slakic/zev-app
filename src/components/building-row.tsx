"use client";
// A building's table row plus its inline edit panel. Kept as a small client island (like
// pdf-statement-import.tsx) purely so "Otkaži" can close the panel without a page reload —
// the actual save still goes through the normal server action + redirect.
import { useState } from "react";
import { Td, Field, inputCls, SubmitBtn } from "@/components/ui";

type BuildingRowData = {
  id: string;
  name: string;
  address: string;
  cadastralRef: string | null;
  yearBuilt: number | null;
  floorsCount: number | null;
  note: string | null;
  entrances: { id: string; name: string }[];
  _count: { units: number };
};

export function BuildingRow({
  building,
  canEdit,
  action,
}: {
  building: BuildingRowData;
  canEdit: boolean;
  action?: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const b = building;
  const details = [
    b.cadastralRef ? `KO: ${b.cadastralRef}` : null,
    b.yearBuilt ? `god. ${b.yearBuilt}` : null,
    b.floorsCount ? `${b.floorsCount} sprat.` : null,
  ].filter(Boolean).join(" · ");
  const colSpan = canEdit ? 5 : 4;

  return (
    <>
      <tr className={open ? "bg-slate-50" : undefined}>
        <Td>
          <div className="font-medium text-slate-900">{b.name}</div>
          {details && <div className="mt-0.5 text-xs text-slate-400">{details}</div>}
          {b.note && <div className="mt-0.5 text-xs italic text-slate-400">{b.note}</div>}
        </Td>
        <Td>{b.address}</Td>
        <Td>{b.entrances.map((e) => e.name).join(", ") || "—"}</Td>
        <Td right>{b._count.units}</Td>
        {canEdit && (
          <Td>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              {open ? "Zatvori" : "Uredi"}
            </button>
          </Td>
        )}
      </tr>
      {canEdit && open && action && (
        <tr className="bg-slate-50">
          <td colSpan={colSpan} className="border-t border-slate-100 px-4 py-4">
            <form action={action} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
              <input type="hidden" name="id" value={b.id} />
              <Field label="Naziv"><input name="name" defaultValue={b.name} required className={inputCls} /></Field>
              <Field label="Adresa"><input name="address" defaultValue={b.address} required className={inputCls} /></Field>
              <Field label="Katastarska oznaka"><input name="cadastralRef" defaultValue={b.cadastralRef ?? ""} className={inputCls} /></Field>
              <Field label="Godina izgradnje"><input name="yearBuilt" type="number" defaultValue={b.yearBuilt ?? ""} className={inputCls} /></Field>
              <Field label="Broj spratova"><input name="floorsCount" type="number" defaultValue={b.floorsCount ?? ""} className={inputCls} /></Field>
              <Field label="Napomena"><input name="note" defaultValue={b.note ?? ""} className={inputCls} /></Field>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 sm:col-span-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Otkaži
                </button>
                <SubmitBtn>Sačuvaj izmjene</SubmitBtn>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
