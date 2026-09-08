"use client";
// Checkbox-based multiselect dropdown for picking owners inside a plain GET
// form (e.g. the "Dugovanja po vlasnicima" filter on Izvještaji). Renders as
// real <input type="checkbox" name={name}> elements, so it needs no client-side
// submit handling — the browser serializes checked boxes as repeated
// `name=value` query params exactly like the native <select multiple> it
// replaces. Only the open/closed panel and the "select all"/"clear" bulk
// actions are client-side state.
import { useEffect, useRef, useState } from "react";

export type OwnerOption = { id: string; label: string };

export function OwnerMultiSelect({
  name,
  label,
  options,
  defaultSelected,
  helperText,
}: {
  name: string;
  label: string;
  options: OwnerOption[];
  defaultSelected: string[];
  helperText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(options.map((o) => o.id)));
  const clearAll = () => setSelected(new Set());

  const summary =
    selected.size === 0
      ? "Svi vlasnici"
      : selected.size === options.length
        ? `Svi vlasnici (${options.length})`
        : `${selected.size} izabrano`;

  return (
    <div ref={ref} className="relative">
      <label className="mb-1 block text-sm text-slate-700">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-w-[260px] items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 py-1 text-left text-sm text-slate-700 hover:border-slate-400"
      >
        <span className="truncate">{summary}</span>
        <span className="text-slate-400" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-30 mt-1 max-h-80 w-96 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <button type="button" onClick={selectAll} className="text-xs font-medium text-blue-600 hover:underline">
              Izaberi sve
            </button>
            <button type="button" onClick={clearAll} className="text-xs font-medium text-slate-500 hover:underline">
              Obriši izbor
            </button>
          </div>
          {options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">Nema vlasnika.</p>
          ) : (
            options.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  name={name}
                  value={o.id}
                  checked={selected.has(o.id)}
                  onChange={() => toggleOne(o.id)}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))
          )}
        </div>
      )}
      {helperText && <p className="mt-1 text-xs text-slate-500">{helperText}</p>}
    </div>
  );
}
