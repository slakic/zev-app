"use client";
// A unit's table row plus its inline edit panel — same pattern as building-row.tsx.
import { useState } from "react";
import { Td, Field, inputCls, SubmitBtn } from "@/components/ui";

const UNIT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "APARTMENT", label: "Stan" },
  { value: "BUSINESS", label: "Poslovni prostor" },
  { value: "GARAGE", label: "Garaža" },
  { value: "OTHER", label: "Ostalo" },
];

type UnitRowData = {
  id: string;
  buildingId: string;
  entranceId: string | null;
  type: string;
  label: string;
  floor: number | null;
  usableArea: string;
  ownershipShare: string;
  occupantCount: number;
  typeCoefficient: string;
  buildingName: string;
  entranceName: string | null;
  typeLabel: string;
  ownersDisplay: string;
  occupantsDisplay: string;
};

export function UnitRow({
  unit,
  buildings,
  entrances,
  canEdit,
  action,
}: {
  unit: UnitRowData;
  buildings: { id: string; name: string }[];
  entrances: { id: string; name: string; buildingName: string }[];
  canEdit: boolean;
  action?: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const u = unit;
  const colSpan = canEdit ? 11 : 10;

  return (
    <>
      <tr className={open ? "bg-slate-50" : undefined}>
        <Td>{u.buildingName}</Td>
        <Td>{u.entranceName ?? "—"}</Td>
        <Td>{u.label}</Td>
        <Td>{u.typeLabel}</Td>
        <Td right>{u.floor ?? "—"}</Td>
        <Td right>{u.usableArea}</Td>
        <Td right>{u.ownershipShare}</Td>
        <Td right>{u.occupantCount}</Td>
        <Td>{u.ownersDisplay}</Td>
        <Td>{u.occupantsDisplay}</Td>
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
            <form action={action} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
              <input type="hidden" name="id" value={u.id} />
              <Field label="Zgrada">
                <select name="buildingId" defaultValue={u.buildingId} className={inputCls}>
                  {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Ulaz (opciono)">
                <select name="entranceId" defaultValue={u.entranceId ?? ""} className={inputCls}>
                  <option value="">—</option>
                  {entrances.map((e) => <option key={e.id} value={e.id}>{e.buildingName} / {e.name}</option>)}
                </select>
              </Field>
              <Field label="Tip">
                <select name="type" defaultValue={u.type} className={inputCls}>
                  {UNIT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Oznaka"><input name="label" defaultValue={u.label} required className={inputCls} /></Field>
              <Field label="Sprat"><input name="floor" type="number" defaultValue={u.floor ?? ""} className={inputCls} /></Field>
              <Field label="Površina (m²)"><input name="usableArea" defaultValue={u.usableArea} required className={inputCls} /></Field>
              <Field label="Udio u ZEV (%)"><input name="ownershipShare" defaultValue={u.ownershipShare} required className={inputCls} /></Field>
              <Field label="Broj korisnika"><input name="occupantCount" type="number" defaultValue={u.occupantCount} className={inputCls} /></Field>
              <Field label="Koeficijent tipa"><input name="typeCoefficient" defaultValue={u.typeCoefficient} className={inputCls} /></Field>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 sm:col-span-4">
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
