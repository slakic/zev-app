"use client";
// Reusable "initial password" input — plain text (not masked) on purpose, so a
// super admin/predsjednik can read back and hand over the value they just set,
// same as the raw <input type="text"> this replaces on /vlasnici. Adds an
// in-browser generator + copy button. See
// Plans/tenant-switching-admin-accounts-plan.md §6.3 for why generation happens
// client-side rather than on the server (a server-generated value would have to
// come back through a redirect URL or rendered page, both easy ways for a
// password to end up logged or in browser history).
import { useId, useState } from "react";
import { inputCls } from "@/components/ui";
import { t } from "@/lib/i18n";

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const GENERATED_LENGTH = 12;

function generatePassword(): string {
  const bytes = new Uint32Array(GENERATED_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => PASSWORD_CHARS[n % PASSWORD_CHARS.length]).join("");
}

const smallBtnCls =
  "shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 " +
  "transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-blue-500/40";

export function PasswordField({
  name,
  defaultValue,
  required,
  placeholder,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue ?? "");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the value is still
      // selectable/copyable by hand from the text input itself.
    }
  }

  return (
    <div className="flex gap-1.5">
      <input
        id={id}
        name={name}
        type="text"
        autoComplete="new-password"
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={inputCls}
      />
      <button type="button" onClick={() => setValue(generatePassword())} className={smallBtnCls}>
        {t("common.generate")}
      </button>
      <button type="button" onClick={copy} disabled={!value} className={smallBtnCls}>
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
}
