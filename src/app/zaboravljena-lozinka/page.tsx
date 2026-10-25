// Public, unauthenticated "forgot password" request page. Deliberately shows the exact same
// confirmation whether or not the e-mail belongs to an account — see requestPasswordReset()
// in users.ts for why (never reveal which addresses have accounts).
import { redirect } from "next/navigation";
import Link from "next/link";
import { requestPasswordReset } from "@/server/services/users";
import { clientIp, getAuthContext } from "@/server/auth/session";
import { sha256 } from "@/server/auth/tokens";
import { Field, inputCls, SubmitBtn } from "@/components/ui";
import { AuthShell } from "@/components/auth-shell";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";

async function requestResetAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const ip = await clientIp();
  const appUrl = getEnv().APP_URL;
  if (email) {
    await requestPasswordReset(email, appUrl, ip ? sha256(ip) : null);
  }
  redirect("/zaboravljena-lozinka?sent=1");
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const ctx = await getAuthContext();
  if (ctx) redirect("/");
  const { sent } = await searchParams;

  return (
    <AuthShell
      pageTitle={t("auth.forgot.title")}
      flash={sent ? { msg: t("auth.forgot.sent") } : undefined}
    >
      {!sent && (
        <form action={requestResetAction} className="space-y-4">
          <p className="text-sm text-slate-600">{t("auth.forgot.intro")}</p>
          <Field label={t("auth.forgot.emailLabel")}>
            <input name="email" type="email" required autoComplete="username" className={inputCls} />
          </Field>
          <SubmitBtn>{t("auth.forgot.submit")}</SubmitBtn>
        </form>
      )}

      <p className="mt-4 text-sm">
        <Link href="/login" className="text-blue-700 hover:underline">{t("auth.forgot.backToLogin")}</Link>
      </p>
    </AuthShell>
  );
}
