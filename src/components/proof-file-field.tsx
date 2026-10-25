"use client";
// Polje za dokaz/sken u serverskim formama (F8.3, F8.4): `FilePicker` (dugme, spisak, prevlačenje) + pravi, vizuelno
// skriveni `<input type="file" name=…>` u istoj formi, koji dobija izabrani fajl kroz DataTransfer — server akcija i dalje
// čita `formData.get(name)` kao sa golim poljem za fajl, bez ijedne izmjene u akciji. Isti obrazac kao `RegisterChangeForm`.
import { useEffect, useRef, useState } from "react";
import { FilePicker } from "@/components/file-picker";

export function ProofFileField({
  name, label, buttonLabel, hint, accept, required,
}: {
  /** Ime polja koje server akcija čita (`formData.get(name)`). */
  name: string;
  label: string;
  buttonLabel: string;
  hint?: string;
  accept?: string;
  required?: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!input.current) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.current.files = dt.files;
  }, [files]);

  return (
    <div>
      <FilePicker label={label} buttonLabel={buttonLabel} hint={hint} accept={accept} files={files} onChange={setFiles} />
      <input ref={input} type="file" name={name} required={required} className="sr-only" tabIndex={-1} aria-hidden="true" />
    </div>
  );
}
