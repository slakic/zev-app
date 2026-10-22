"use client";
// FilePicker — design-system primitive for choosing files (Plans/design-system.md §4.4). Replaces
// the bare <input type="file"> (whose look and wording differ per browser and which opens a
// dialog when the field itself is clicked) with an explicit secondary button plus a list of what
// was chosen, each removable. Files can also be dropped onto the area. Controlled: the parent
// owns the File[] and submits it however it needs (FormData, server action).
// The native input stays in the DOM, visually hidden, so the browser's own file dialog is used.
import { useId, useRef, useState } from "react";
import { btnBase, btnVariantCls } from "@/components/ui";

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function FilePicker({
  label,
  buttonLabel,
  hint,
  accept,
  multiple,
  files,
  onChange,
  disabled,
}: {
  label: string;
  buttonLabel: string;
  hint?: string;
  /** Same syntax as the input's accept attribute; also used to filter dropped files by extension/MIME. */
  accept?: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const accepts = (f: File) => {
    if (!accept) return true;
    return accept.split(",").map((a) => a.trim().toLowerCase()).some((a) =>
      a.startsWith(".") ? f.name.toLowerCase().endsWith(a) : a.endsWith("/*") ? f.type.startsWith(a.slice(0, -1)) : f.type === a
    );
  };

  function add(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter(accepts);
    if (!multiple) {
      onChange(incoming.slice(0, 1));
      return;
    }
    // Same name + size + date = the same file chosen twice.
    const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const seen = new Set(files.map(key));
    onChange([...files, ...incoming.filter((f) => !seen.has(key(f)))]);
  }

  return (
    <div>
      <span id={`${id}-label`} className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) add(e.dataTransfer.files);
        }}
        className={`rounded-xl border border-dashed p-3 transition-colors ${dragOver ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-slate-50/60"}`}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = ""; // allow picking the same file again after removing it
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            aria-describedby={`${id}-label`}
            className={`${btnBase} ${btnVariantCls.secondary}`}
          >
            {buttonLabel}
          </button>
          <span className="text-[13px] text-slate-500">
            {files.length === 0 ? (hint ?? "ili ih prevucite ovdje") : `Izabrano: ${files.length}`}
          </span>
        </div>
        {files.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {files.map((f, i) => (
              <li key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                <span className="min-w-0 truncate text-slate-800" title={f.name}>{f.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[13px] tabular-nums text-slate-500">{formatSize(f.size)}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(files.filter((_, j) => j !== i))}
                    aria-label={`Ukloni ${f.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 max-md:h-11 max-md:w-11"
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d="M5 5l10 10M15 5L5 15" />
                    </svg>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
