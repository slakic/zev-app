"use client";
// A unit's table row plus its inline edit panel — same pattern as building-row.tsx.
import { useState } from "react";
import { Td, Field, inputCls, SubmitBtn, RowAction, Btn, StatusBadge } from "@/components/ui";

const UNIT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "APARTMENT", label: "Stan" },
  { value: "BUSINESS", label: "Poslovni prostor" },
  { value: "GARAGE", label: "Garaža" },
  { value: "GARAGE_SPACE", label: "Garažno mjesto" },
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
  /** Sum-of-owner-shares chip ("100 %", "Zbir 150 %", "Upisano 60 %") and its next-step sentence; absent in a draft register. */
  ownerSum?: { label: string; ok: boolean; note?: string };
};

export function UnitRow({
  unit,
  buildings,
  entrances,
  canEdit,
  registerLocked = false,
  action,
}: {
  unit: UnitRowData;
  buildings: { id: string; name: string }[];
  entrances: { id: string; name: string; buildingName: string }[];
  canEdit: boolean;
  /** Established register (K-02): label, type, building, area and cost share are shown read-only
   *  and resent unchanged; only the billing inputs (floor, entrance, occupants, coefficient) are editable. */
  registerLocked?: boolean;
  action?: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const u = unit;
  const colSpan = (canEdit ? 11 : 10) + (u.ownerSum ? 1 : 0);

  return (
    <>
      <tr className={open ? "bg-slate-50" : undefined}>
        <Td>{u.buildingName}</Td>
        <Td>{u.entranceName ?? "—"}</Td>
        <Td>{u.label}</Td>
        <Td>{u.typeLabel}</Td>
        <Td>{u.floor ?? "—"}</Td>
        <Td>{u.usableArea}</Td>
        <Td>{u.ownershipShare}</Td>
        <Td>{u.occupantCount}</Td>
        <Td>{u.ownersDisplay}</Td>
        {u.ownerSum && (
          <Td>
            <StatusBadge status={u.ownerSum.ok ? "OWNER_SUM_OK" : "OWNER_SUM_WARN"} label={u.ownerSum.label} />
            {u.ownerSum.note && <div className="mt-1 text-[13px] text-amber-800">{u.ownerSum.note}</div>}
          </Td>
        )}
        <Td>{u.occupantsDisplay}</Td>
        {canEdit && (
          <Td>
            <RowAction type="button" onClick={() => setOpen((v) => !v)}>
              {open ? "Zatvori" : "Uredi"}
            </RowAction>
          </Td>
        )}
      </tr>
      {canEdit && open && action && (
        <tr className="bg-slate-50">
          <td colSpan={colSpan} className="border-t border-slate-100 px-4 py-4">
            <form action={action} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
              <input type="hidden" name="id" value={u.id} />
              {registerLocked ? (
                <>
                  <input type="hidden" name="buildingId" value={u.buildingId} />
                  <input type="hidden" name="type" value={u.type} />
                  <input type="hidden" name="label" value={u.label} />
                  <input type="hidden" name="usableArea" value={u.usableArea} />
                  <input type="hidden" name="ownershipShare" value={u.ownershipShare} />
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:col-span-4 sm:grid-cols-4">
                    <div><dt className="text-[13px] text-slate-500">Zgrada</dt><dd>{u.buildingName}</dd></div>
                    <div><dt className="text-[13px] text-slate-500">Oznaka · tip</dt><dd>{u.label} · {u.typeLabel}</dd></div>
                    <div><dt className="text-[13px] text-slate-500">Površina (m²)</dt><dd className="tabular-nums">{u.usableArea}</dd></div>
                    <div><dt className="text-[13px] text-slate-500">Udio u troškovima (%)</dt><dd className="tabular-nums">{u.ownershipShare}</dd></div>
                    <p className="col-span-2 text-[13px] text-slate-500 sm:col-span-4">Ovi podaci su dio utvrđenog registra i mijenjaju se kroz Izmjenu registra.</p>
                  </dl>
                </>
              ) : (
                <>
                  <Field label="Zgrada">
                    <select name="buildingId" defaultValue={u.buildingId} className={inputCls}>
                      {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Tip">
                    <select name="type" defaultValue={u.type} className={inputCls}>
                      {UNIT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Oznaka"><input name="label" defaultValue={u.label} required className={inputCls} /></Field>
                  <Field label="Površina (m²)"><input name="usableArea" defaultValue={u.usableArea} required className={inputCls} /></Field>
                  <Field label="Udio u troškovima (%)"><input name="ownershipShare" defaultValue={u.ownershipShare} required className={inputCls} /></Field>
                </>
              )}
              <Field label="Ulaz (opciono)">
                <select name="entranceId" defaultValue={u.entranceId ?? ""} className={inputCls}>
                  <option value="">—</option>
                  {entrances.map((e) => <option key={e.id} value={e.id}>{e.buildingName} / {e.name}</option>)}
                </select>
              </Field>
              <Field label="Sprat"><input name="floor" type="number" defaultValue={u.floor ?? ""} className={inputCls} /></Field>
              <Field label="Broj korisnika"><input name="occupantCount" type="number" defaultValue={u.occupantCount} className={inputCls} /></Field>
              <Field label="Koeficijent tipa"><input name="typeCoefficient" defaultValue={u.typeCoefficient} className={inputCls} /></Field>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 sm:col-span-4">
                <Btn type="button" onClick={() => setOpen(false)}>Otkaži</Btn>
                <SubmitBtn>Sačuvaj izmjene</SubmitBtn>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
