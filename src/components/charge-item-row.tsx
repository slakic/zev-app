"use client";
// A charge item's table row plus its inline edit panel — same pattern as
// building-row.tsx / unit-row.tsx.
import { useState } from "react";
import { Td, Field, inputCls, SubmitBtn } from "@/components/ui";
import { tEnum } from "@/lib/i18n";

type ChargeItemData = {
  id: string;
  name: string;
  method: string;
  rate: string | null;
  scopeType: string;
  buildingId: string | null;
  frequency: string;
  dueDayOfMonth: number;
  rounding: string;
  isReserveFund: boolean;
  displayOrder: number;
  active: boolean;
};

export function ChargeItemRow({
  item,
  buildings,
  action,
}: {
  item: ChargeItemData;
  buildings: { id: string; name: string }[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const c = item;

  return (
    <>
      <tr className={open ? "bg-slate-50" : !c.active ? "opacity-50" : undefined}>
        <Td>
          {c.name}
          {!c.active && <span className="ml-1.5 text-xs text-slate-400">(neaktivna)</span>}
        </Td>
        <Td>{tEnum("chargeMethod", c.method)}</Td>
        <Td right>{c.rate ?? "—"}</Td>
        <Td>{tEnum("scope", c.scopeType)}</Td>
        <Td>{tEnum("frequency", c.frequency)}</Td>
        <Td>{c.isReserveFund ? "Da" : "—"}</Td>
        <Td>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-sm font-medium text-blue-700 hover:underline"
          >
            {open ? "Zatvori" : "Uredi"}
          </button>
        </Td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={7} className="border-t border-slate-100 px-4 py-4">
            <form action={action} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
              <input type="hidden" name="id" value={c.id} />
              <Field label="Naziv"><input name="name" defaultValue={c.name} required className={inputCls} /></Field>
              <Field label="Metoda obračuna">
                <select name="method" defaultValue={c.method} className={inputCls}>
                  <option value="FIXED_PER_UNIT">Fiksno po jedinici</option>
                  <option value="PER_AREA">Po m²</option>
                  <option value="PER_OWNERSHIP_SHARE">Po vlasničkom udjelu</option>
                  <option value="PER_OCCUPANT">Po broju korisnika</option>
                  <option value="EQUAL_SPLIT">Jednaka raspodjela</option>
                  <option value="UNIT_TYPE_COEFFICIENT">Koeficijent tipa</option>
                  <option value="CONSUMPTION">Po potrošnji</option>
                  <option value="CUSTOM_WEIGHTS">Prilagođeni ponderi</option>
                  <option value="MANUAL">Ručni iznos</option>
                </select>
              </Field>
              <Field label="Stopa / iznos (KM)" hint="Za raspodjele: ukupan iznos; za m²/udio/korisnika: cijena po jedinici mjere.">
                <input name="rate" defaultValue={c.rate ?? ""} className={inputCls} placeholder="0.35" />
              </Field>
              <Field label="Obuhvat">
                <select name="scopeType" defaultValue={c.scopeType} className={inputCls}>
                  <option value="ZEV">Cijela ZEV</option>
                  <option value="BUILDING">Zgrada</option>
                </select>
              </Field>
              <Field label="Zgrada (ako obuhvat = zgrada)">
                <select name="buildingId" defaultValue={c.buildingId ?? ""} className={inputCls}>
                  <option value="">—</option>
                  {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Frekvencija">
                <select name="frequency" defaultValue={c.frequency} className={inputCls}>
                  <option value="MONTHLY">Mjesečno</option>
                  <option value="ANNUAL">Godišnje</option>
                  <option value="ONE_TIME">Jednokratno</option>
                </select>
              </Field>
              <Field label="Dan dospijeća u mjesecu"><input name="dueDayOfMonth" type="number" defaultValue={c.dueDayOfMonth} className={inputCls} /></Field>
              <Field label="Zaokruživanje">
                <select name="rounding" defaultValue={c.rounding} className={inputCls}>
                  <option value="HALF_UP_2">Polovina naviše (2 dec.)</option>
                  <option value="UP_2">Naviše</option>
                  <option value="DOWN_2">Naniže</option>
                </select>
              </Field>
              <Field label="Redoslijed na fakturi"><input name="displayOrder" type="number" defaultValue={c.displayOrder} className={inputCls} /></Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="isReserveFund" defaultChecked={c.isReserveFund} /> Fond održavanja
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={c.active} /> Aktivna (uključena u naredne obračune)
              </label>
              <div className="flex items-end justify-end gap-2 sm:col-span-3">
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
