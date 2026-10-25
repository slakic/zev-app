"use client";
// "Izmjena registra" form (FR-Q3, mockup X-M04 ④): kind of change, a before -> after review with the
// cost-share sum that must stay 100,00 %, a mandatory reason and document, and a ConfirmAction.
// The fields live ABOVE the confirm step and join its form through the HTML `form="…"` attribute, so the
// ConfirmAction primitive is reused unchanged apart from its `formId`. The change itself travels as JSON in
// the hidden `payload` field; the service validates everything again.
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, ConfirmAction, Field, inputCls, Btn } from "@/components/ui";
import { FilePicker } from "@/components/file-picker";
import { t, tf } from "@/lib/i18n";

const FORM_ID = "register-change-form";
const MICRO = 1_000_000;

export type RegisterUnit = {
  id: string; label: string; where: string; type: string; typeLabel: string; usableArea: string; ownershipShare: string;
};
type Building = { id: string; name: string; entrances: { id: string; name: string }[] };
type NewUnit = { buildingId: string; entranceId: string; type: string; label: string; floor: string; usableArea: string; ownershipShare: string };
type Kind = "CHANGE_SHARE" | "CHANGE_AREA" | "CHANGE_LABEL" | "CHANGE_TYPE" | "ADD_UNIT" | "RETIRE_UNIT" | "MERGE_SPLIT";

const KINDS: Kind[] = ["CHANGE_SHARE", "CHANGE_AREA", "ADD_UNIT", "RETIRE_UNIT", "MERGE_SPLIT", "CHANGE_LABEL", "CHANGE_TYPE"];
const TYPES = ["APARTMENT", "BUSINESS", "GARAGE", "GARAGE_SPACE", "OTHER"];

/** "17,60" / "17.60" / "1.234,5" -> micro-units (integer), NaN when not a number. */
function toMicro(raw: string): number {
  let s = raw.trim().replace(/\s/g, "");
  if (s === "") return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * MICRO) : NaN;
}
function fmt(micro: number, digits = 2): string {
  return (micro / MICRO).toFixed(digits).replace(".", ",");
}
const emptyNew = (b: Building | undefined): NewUnit => ({
  buildingId: b?.id ?? "", entranceId: "", type: "GARAGE_SPACE", label: "", floor: "", usableArea: "", ownershipShare: "",
});

export function RegisterChangeForm({
  units, buildings, nextVersion, action,
}: {
  units: RegisterUnit[];
  buildings: Building[];
  nextVersion: number;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>("CHANGE_SHARE");
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [shares, setShares] = useState<Record<string, string>>({});
  const [area, setArea] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("APARTMENT");
  const [retire, setRetire] = useState<string[]>([]);
  const [added, setAdded] = useState<NewUnit[]>([emptyNew(buildings[0])]);
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Mirror the FilePicker's state into a real <input type="file" form=…> so the file travels with the form.
  useEffect(() => {
    if (!fileInput.current) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    fileInput.current.files = dt.files;
  }, [files]);

  const unit = units.find((u) => u.id === unitId);
  const usesShares = kind === "CHANGE_SHARE" || kind === "ADD_UNIT" || kind === "RETIRE_UNIT" || kind === "MERGE_SPLIT";
  const retiredIds = kind === "RETIRE_UNIT" ? [unitId] : kind === "MERGE_SPLIT" ? retire : [];
  // MERGE_SPLIT starts with one blank row: only rows the user actually filled in count as new units.
  const filledAdded = added.filter((n) => n.label.trim() || n.usableArea.trim() || n.ownershipShare.trim());
  const newUnits = kind === "ADD_UNIT" ? added.slice(0, 1) : kind === "MERGE_SPLIT" ? filledAdded : [];

  const shareOf = (u: RegisterUnit) => shares[u.id] ?? u.ownershipShare.replace(".", ",");
  const calc = useMemo(() => {
    const before = units.reduce((a, u) => a + toMicro(u.ownershipShare), 0);
    let after = 0;
    let invalid = false;
    for (const u of units) {
      if (retiredIds.includes(u.id)) continue;
      const m = toMicro(shareOf(u));
      if (Number.isNaN(m) || m <= 0) invalid = true;
      else after += m;
    }
    for (const n of newUnits) {
      const m = toMicro(n.ownershipShare);
      if (Number.isNaN(m) || m <= 0) invalid = true;
      else after += m;
    }
    return { before, after, invalid, ok: !invalid && Math.abs(after - 100 * MICRO) <= 0.01 * MICRO };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, shares, kind, unitId, retire, added]);

  // Rows of the before -> after review and the JSON payload per kind.
  const changes: string[] = [];
  let payload: Record<string, unknown> | null = null;
  let complete = false;
  const shareAdjustments = units
    .filter((u) => !retiredIds.includes(u.id) && shares[u.id] !== undefined && toMicro(shares[u.id]) !== toMicro(u.ownershipShare))
    .map((u) => ({ unitId: u.id, ownershipShare: shares[u.id] }));
  const newUnitPayload = (n: NewUnit) => ({
    buildingId: n.buildingId, entranceId: n.entranceId || null, type: n.type, label: n.label,
    floor: n.floor ? Number(n.floor) : null, usableArea: n.usableArea, ownershipShare: n.ownershipShare,
  });
  const newUnitsOk = (list: NewUnit[]) => list.length > 0 && list.every((n) => n.buildingId && n.label.trim() && toMicro(n.usableArea) > 0 && toMicro(n.ownershipShare) > 0);
  for (const a of shareAdjustments) {
    const u = units.find((x) => x.id === a.unitId)!;
    changes.push(`${u.label}: ${fmt(toMicro(u.ownershipShare))} % → ${fmt(toMicro(a.ownershipShare))} %`);
  }
  switch (kind) {
    case "CHANGE_SHARE":
      payload = { kind, shares: shareAdjustments };
      complete = shareAdjustments.length > 0 && calc.ok;
      break;
    case "CHANGE_AREA":
      if (unit && area.trim()) changes.push(`${unit.label}: ${fmt(toMicro(unit.usableArea))} → ${fmt(toMicro(area))} m²`);
      payload = { kind, unitId, usableArea: area };
      complete = !!unit && toMicro(area) > 0 && toMicro(area) !== toMicro(unit.usableArea);
      break;
    case "CHANGE_LABEL":
      if (unit && label.trim()) changes.push(`${unit.label} → ${label.trim()}`);
      payload = { kind, unitId, label };
      complete = !!unit && label.trim() !== "" && label.trim() !== unit.label;
      break;
    case "CHANGE_TYPE":
      if (unit) changes.push(`${unit.label}: ${unit.typeLabel} → ${t(`unitType.${type}`)}`);
      payload = { kind, unitId, type };
      complete = !!unit && type !== unit.type;
      break;
    case "ADD_UNIT":
      newUnits.forEach((n) => changes.push(tf("register.change.addedLine", { label: n.label || "?", share: fmt(toMicro(n.ownershipShare) || 0) })));
      payload = { kind, unit: newUnitPayload(added[0]), shareAdjustments };
      complete = newUnitsOk(newUnits) && calc.ok;
      break;
    case "RETIRE_UNIT":
      if (unit) changes.push(tf("register.change.retiredLine", { label: unit.label }));
      payload = { kind, unitId, shareAdjustments };
      complete = !!unit && calc.ok;
      break;
    case "MERGE_SPLIT":
      units.filter((u) => retire.includes(u.id)).forEach((u) => changes.push(tf("register.change.retiredLine", { label: u.label })));
      newUnits.forEach((n) => changes.push(tf("register.change.addedLine", { label: n.label || "?", share: fmt(toMicro(n.ownershipShare) || 0) })));
      payload = { kind, retireUnitIds: retire, addUnits: filledAdded.map(newUnitPayload), shareAdjustments };
      complete = (retire.length > 0 || filledAdded.length > 0) && (filledAdded.length === 0 || newUnitsOk(filledAdded)) && calc.ok;
      break;
  }
  const ready = complete && reason.trim().length > 0 && files.length > 0;
  const setNew = (i: number, patch: Partial<NewUnit>) => setAdded((list) => list.map((n, j) => (j === i ? { ...n, ...patch } : n)));

  // Called as a plain function (not <Component/>): a component defined inside render would remount on every keystroke.
  function newUnitFields(n: NewUnit, i: number) {
    const b = buildings.find((x) => x.id === n.buildingId);
    return (
      <div key={i} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-4">
        <Field label={t("register.change.f.building")}>
          <select value={n.buildingId} onChange={(e) => setNew(i, { buildingId: e.target.value, entranceId: "" })} className={inputCls}>
            {buildings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label={t("register.change.f.entrance")}>
          <select value={n.entranceId} onChange={(e) => setNew(i, { entranceId: e.target.value })} className={inputCls}>
            <option value="">—</option>
            {(b?.entrances ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label={t("register.change.f.type")}>
          <select value={n.type} onChange={(e) => setNew(i, { type: e.target.value })} className={inputCls}>
            {TYPES.map((x) => <option key={x} value={x}>{t(`unitType.${x}`)}</option>)}
          </select>
        </Field>
        <Field label={t("register.change.f.label")}><input value={n.label} onChange={(e) => setNew(i, { label: e.target.value })} className={inputCls} /></Field>
        <Field label={t("register.change.f.floor")}><input value={n.floor} type="number" onChange={(e) => setNew(i, { floor: e.target.value })} className={inputCls} /></Field>
        <Field label={t("register.change.f.area")}><input value={n.usableArea} onChange={(e) => setNew(i, { usableArea: e.target.value })} className={inputCls} /></Field>
        <Field label={t("register.change.f.share")}><input value={n.ownershipShare} onChange={(e) => setNew(i, { ownershipShare: e.target.value })} className={inputCls} /></Field>
      </div>
    );
  }

  return (
    <Card title={t("register.change.what")}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("register.change.kind")}>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={inputCls}>
              {KINDS.map((k) => <option key={k} value={k}>{t(`unitRegisterChangeKind.${k}`)}</option>)}
            </select>
          </Field>
          {(kind === "CHANGE_AREA" || kind === "CHANGE_LABEL" || kind === "CHANGE_TYPE" || kind === "RETIRE_UNIT") && (
            <Field label={t("register.change.unit")}>
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputCls}>
                {units.map((u) => <option key={u.id} value={u.id}>{u.label} · {u.where}</option>)}
              </select>
            </Field>
          )}
        </div>

        {kind === "CHANGE_AREA" && unit && (
          <Field label={tf("register.change.newArea", { current: fmt(toMicro(unit.usableArea)) })}>
            <input value={area} onChange={(e) => setArea(e.target.value)} className={inputCls} placeholder="15,40" />
          </Field>
        )}
        {kind === "CHANGE_LABEL" && unit && (
          <Field label={tf("register.change.newLabel", { current: unit.label })}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
          </Field>
        )}
        {kind === "CHANGE_TYPE" && unit && (
          <Field label={tf("register.change.newType", { current: unit.typeLabel })}>
            <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
              {TYPES.map((x) => <option key={x} value={x}>{t(`unitType.${x}`)}</option>)}
            </select>
          </Field>
        )}

        {kind === "MERGE_SPLIT" && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">{t("register.change.retireWhich")}</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
              {units.map((u) => (
                <label key={u.id} className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700 md:min-h-0">
                  <input
                    type="checkbox"
                    checked={retire.includes(u.id)}
                    onChange={(e) => setRetire((r) => (e.target.checked ? [...r, u.id] : r.filter((x) => x !== u.id)))}
                  />
                  {u.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {(kind === "ADD_UNIT" || kind === "MERGE_SPLIT") && (
          <div className="space-y-3">
            {(kind === "ADD_UNIT" ? added.slice(0, 1) : added).map((n, i) => newUnitFields(n, i))}
            {kind === "MERGE_SPLIT" && added.length < 4 && (
              <Btn type="button" variant="secondary" onClick={() => setAdded((l) => [...l, emptyNew(buildings[0])])}>
                {t("register.change.addAnother")}
              </Btn>
            )}
          </div>
        )}

        {usesShares && (
          <>
            <div className="overflow-x-auto rounded-lg">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">{t("register.change.reviewCaption")}</caption>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-left">
                    <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t("register.change.col.unit")}</th>
                    <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("register.change.col.before")}</th>
                    <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("register.change.col.after")}</th>
                    <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("register.change.col.diff")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {units.map((u) => {
                    const gone = retiredIds.includes(u.id);
                    const now = toMicro(shareOf(u));
                    const diff = gone ? -toMicro(u.ownershipShare) : (Number.isNaN(now) ? 0 : now - toMicro(u.ownershipShare));
                    return (
                      <tr key={u.id}>
                        <td className="px-3 py-1.5"><span className="font-medium text-slate-900">{u.label}</span> <span className="block text-[13px] text-slate-500">{u.where}</span></td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt(toMicro(u.ownershipShare))} %</td>
                        <td className="px-3 py-1.5 text-right">
                          {gone ? (
                            <span className="text-slate-500">{t("register.change.retiredCell")}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <input
                                aria-label={tf("register.change.shareFor", { unit: u.label })}
                                value={shareOf(u)}
                                onChange={(e) => setShares((s) => ({ ...s, [u.id]: e.target.value }))}
                                className={`${inputCls} w-24 min-w-[96px] shrink-0 text-right tabular-nums`}
                                inputMode="decimal"
                              />
                              %
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{diff === 0 ? "—" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}`}</td>
                      </tr>
                    );
                  })}
                  {newUnits.map((n, i) => (
                    <tr key={`new-${i}`}>
                      <td className="px-3 py-1.5"><span className="font-medium text-slate-900">{n.label || t("register.change.newUnit")}</span></td>
                      <td className="px-3 py-1.5 text-right text-slate-500">—</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Number.isNaN(toMicro(n.ownershipShare)) ? "—" : `${fmt(toMicro(n.ownershipShare))} %`}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Number.isNaN(toMicro(n.ownershipShare)) ? "—" : `+${fmt(toMicro(n.ownershipShare))}`}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50/80 font-medium">
                    <td className="px-3 py-1.5">{t("register.change.sumRow")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(calc.before)} %</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{calc.invalid ? "—" : `${fmt(calc.after)} %`}</td>
                    <td className="px-3 py-1.5 text-right">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-medium ring-1 ring-inset ${calc.ok ? "bg-emerald-50 text-emerald-800 ring-emerald-600/20" : "bg-amber-50 text-amber-800 ring-amber-600/20"}`}>
                        {calc.ok ? t("register.change.sumOk") : t("register.change.sumBad")}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="max-w-[68ch] text-[13px] text-slate-500">{t("register.change.sumHint")}</p>
          </>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field label={t("register.change.reason")}>
            <textarea
              name="reason"
              form={FORM_ID}
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputCls}
            />
          </Field>
          <div>
            <FilePicker
              label={t("register.change.document")}
              buttonLabel={t("register.change.documentPick")}
              hint={t("register.change.documentHint")}
              accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
              files={files}
              onChange={setFiles}
            />
            <input ref={fileInput} type="file" name="document" form={FORM_ID} className="sr-only" tabIndex={-1} aria-hidden="true" />
          </div>
        </div>
        <input type="hidden" name="payload" form={FORM_ID} value={JSON.stringify(payload ?? {})} />

        {ready ? (
          <ConfirmAction
            formId={FORM_ID}
            trigger={t("register.change.trigger")}
            title={tf("register.change.confirmTitle", { version: nextVersion })}
            body={
              <div className="space-y-2 text-sm text-slate-700">
                <ul className="list-disc space-y-0.5 pl-5">{changes.map((c) => <li key={c}>{c}</li>)}</ul>
                <p>{t("register.change.confirmBody")}</p>
              </div>
            }
            confirmLabel={t("register.change.confirm")}
            confirmVariant="caution"
            action={action}
          />
        ) : (
          <p className="text-[13px] text-amber-800">{t("register.change.notReady")}</p>
        )}
      </div>
    </Card>
  );
}
