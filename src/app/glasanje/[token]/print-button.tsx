"use client";
import { Btn } from "@/components/ui";
import { t } from "@/lib/i18n";

export function PrintButton() {
  return (
    <div className="mt-3 print:hidden">
      <Btn type="button" variant="secondary" onClick={() => window.print()}>{t("ballot.receipt.print")}</Btn>
    </div>
  );
}
