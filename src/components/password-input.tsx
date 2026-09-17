"use client";
// Masked password input with a "show/hide" toggle — distinct from PasswordField
// (src/components/password-field.tsx), which is a different tool: an *admin-assigns-a-
// password* field that stays plain text with generate/copy buttons, for handing a fresh
// login to someone else. This one is for a person typing their own password on /login or
// /reset-lozinka, where staying masked by default matters (shoulder-surfing) but being
// able to check what was typed matters too, especially for older users (Plans/
// ui-ux-redesign-plan.md §6.2).
import { useState } from "react";
import { inputCls } from "@/components/ui";

export function PasswordInput({
  name, autoComplete, required, minLength,
}: { name: string; autoComplete?: string; required?: boolean; minLength?: number }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        name={name}
        type={visible ? "text" : "password"}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        className={`${inputCls} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Sakrij lozinku" : "Prikaži lozinku"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded-r-lg"
      >
        {visible ? (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
            <path d="M2 10c1.8-3.6 5-5.5 8-5.5s6.2 1.9 8 5.5c-1.8 3.6-5 5.5-8 5.5S3.8 13.6 2 10Z" />
            <circle cx="10" cy="10" r="2.3" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5">
            <path d="M2 10c1.8-3.6 5-5.5 8-5.5s6.2 1.9 8 5.5c-1.8 3.6-5 5.5-8 5.5S3.8 13.6 2 10Z" />
            <circle cx="10" cy="10" r="2.3" />
            <path d="M3 3l14 14" />
          </svg>
        )}
      </button>
    </div>
  );
}
