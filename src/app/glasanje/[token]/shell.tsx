// Shared page frame of the public voting screens (single proposal and session ballot).
import { AuthBrandHeader } from "@/components/auth-shell";
import { t } from "@/lib/i18n";

export function Shell({ zevName, children }: { zevName?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl p-4 md:py-10">
      <div className="mb-6 flex justify-center md:justify-start">
        <AuthBrandHeader />
      </div>
      {children}
      <div className="mt-6 space-y-2 text-center text-[13px] text-slate-500 md:text-left">
        <p>
          {t("ballot.footerNotice")}
        </p>
        <p>
          {zevName ? `Ovo izjašnjavanje je za ${zevName}. ` : ""}
          Ako vaš kod ne radi, link je istekao, ili imate bilo koje pitanje, obratite se
          predsjedniku vaše zajednice etažnih vlasnika.
        </p>
      </div>
    </main>
  );
}
