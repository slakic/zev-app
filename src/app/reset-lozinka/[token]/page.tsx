// Public, token-authenticated "set a new password" page — same shape as the /glasanje/[token]
// voting page: the token from the e-mail link is the only credential, checked server-side
// before any form is shown, and consumed (single-use) on success.
import { redirect } from "next/navigation";
import Link from "next/link";
import { inspectPasswordResetToken, resetPassword } from "@/server/services/users";
import { getAuthContext } from "@/server/auth/session";
import { Field, SubmitBtn } from "@/components/ui";
import { AuthShell } from "@/components/auth-shell";
import { PasswordInput } from "@/components/password-input";
import { t } from "@/lib/i18n";

const ERR_KEYS = ["invalid", "expired", "weak", "mismatch"] as const;
const errText = (code: string | undefined): string =>
  code && (ERR_KEYS as readonly string[]).includes(code) ? t(`auth.reset.${code}`) : t("auth.reset.generic");

async function resetAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token"));
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) {
    redirect(`/reset-lozinka/${token}?err=mismatch`);
  }
  const result = await resetPassword(token, password);
  if (!result.ok) {
    redirect(`/reset-lozinka/${token}?err=${result.error}`);
  }
  redirect("/login?msg=password_reset_done");
}

export default async function ResetPasswordPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const ctx = await getAuthContext();
  if (ctx) redirect("/");
  const { token } = await params;
  const { err } = await searchParams;
  const info = await inspectPasswordResetToken(token);

  return (
    <AuthShell
      pageTitle={t("auth.reset.title")}
      flash={!info.ok ? { err: errText(info.error) } : err ? { err: errText(err) } : undefined}
    >
      {!info.ok ? (
        <Link href="/zaboravljena-lozinka" className="block text-sm text-blue-700 hover:underline">
          {t("auth.reset.requestNew")}
        </Link>
      ) : (
        <form action={resetAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <Field label={t("auth.reset.newPassword")} hint={t("auth.reset.newPasswordHint")}>
            <PasswordInput name="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label={t("auth.reset.confirm")}>
            <PasswordInput name="confirm" required minLength={8} autoComplete="new-password" />
          </Field>
          <SubmitBtn>{t("auth.reset.submit")}</SubmitBtn>
        </form>
      )}

      <p className="mt-4 text-sm">
        <Link href="/login" className="text-blue-700 hover:underline">{t("auth.reset.backToLogin")}</Link>
      </p>
    </AuthShell>
  );
}
