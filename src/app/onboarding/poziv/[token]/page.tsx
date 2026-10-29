// Javna stranica pozivnog linka za novi ZEV (Plans/zev-onboarding-wizard-plan.md §4, korak 1, §5.4) —
// isti oblik kao /reset-lozinka/[token]: token iz linka je jedini kredencijal, provjerava se na
// serveru prije nego što se forma prikaže, i troši se pri otvaranju naloga. Posle toga čarobnjak
// radi kroz običnu prijavu (sesiju), ne kroz link.
import { redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { acceptOnboardingInvite, inspectOnboardingInvite } from "@/server/services/onboarding";
import { createSession, clientIp } from "@/server/auth/session";
import { sha256 } from "@/server/auth/tokens";
import { Field, SubmitBtn, inputCls } from "@/components/ui";
import { AuthShell } from "@/components/auth-shell";
import { PasswordInput } from "@/components/password-input";
import { t, tf } from "@/lib/i18n";

const LINK_ERRORS = ["invalid", "expired", "revoked", "used"] as const;

function errText(code: string | undefined, message?: string): string | undefined {
  if (!code) return undefined;
  if ((LINK_ERRORS as readonly string[]).includes(code)) return t(`onboarding.invite.${code}`);
  if (code === "mismatch") return t("onboarding.invite.mismatch");
  if (code === "credentials") return message || t("auth.invalidCredentials");
  if (code === "deactivated") return t("auth.accountDisabled");
  if (code === "rate_limited") return t("auth.login.rateLimited");
  return message || t("auth.reset.generic");
}

async function acceptAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const mode = formData.get("mode") === "existing" ? "existing" : "new";
  const ip = await clientIp();
  const h = await headers();
  const result = await acceptOnboardingInvite(
    token,
    mode === "existing"
      ? { mode, password: String(formData.get("password") ?? "") }
      : {
          mode,
          firstName: String(formData.get("firstName") ?? ""),
          lastName: String(formData.get("lastName") ?? ""),
          phone: String(formData.get("phone") ?? ""),
          password: String(formData.get("password") ?? ""),
          confirm: String(formData.get("confirm") ?? ""),
        },
    ip ? sha256(ip) : null
  );
  if (!result.ok) {
    const m = result.message ? `&m=${encodeURIComponent(result.message)}` : "";
    redirect(`/onboarding/poziv/${token}?err=${result.error}${m}`);
  }
  await createSession(result.userId, ip, h.get("user-agent"));
  redirect("/onboarding");
}

export default async function OnboardingInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ err?: string; m?: string }>;
}) {
  const { token } = await params;
  const { err, m } = await searchParams;
  const info = await inspectOnboardingInvite(token);

  if (!info.ok) {
    return (
      <AuthShell pageTitle={t("onboarding.invite.title")} flash={{ err: errText(info.error) }}>
        <Link href="/login" className="block text-sm text-blue-700 hover:underline">{t("auth.reset.backToLogin")}</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell pageTitle={t("onboarding.invite.title")} footnote={t("onboarding.invite.footnote")} flash={err ? { err: errText(err, m) } : undefined}>
      <p className="mb-4 text-sm text-slate-700">
        {info.existingUser
          ? tf("onboarding.invite.introExisting", { naziv: info.workingName, email: info.email })
          : tf("onboarding.invite.intro", { naziv: info.workingName })}
      </p>
      <form action={acceptAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="mode" value={info.existingUser ? "existing" : "new"} />
        <Field label={t("onboarding.invite.email")}>
          <input value={info.email} readOnly autoComplete="username" className={`${inputCls} bg-slate-50`} />
        </Field>
        {info.existingUser ? (
          <Field label={t("onboarding.invite.password")}>
            <PasswordInput name="password" required autoComplete="current-password" />
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("onboarding.account.firstName")}><input name="firstName" required autoComplete="given-name" className={inputCls} /></Field>
              <Field label={t("onboarding.account.lastName")}><input name="lastName" required autoComplete="family-name" className={inputCls} /></Field>
            </div>
            <Field label={t("onboarding.account.phone")}><input name="phone" autoComplete="tel" className={inputCls} /></Field>
            <Field label={t("onboarding.invite.password")} hint={t("onboarding.invite.passwordHint")}>
              <PasswordInput name="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <Field label={t("onboarding.invite.confirm")}>
              <PasswordInput name="confirm" required minLength={8} autoComplete="new-password" />
            </Field>
          </>
        )}
        <SubmitBtn>{info.existingUser ? t("onboarding.invite.submitExisting") : t("onboarding.invite.submitNew")}</SubmitBtn>
      </form>
    </AuthShell>
  );
}
