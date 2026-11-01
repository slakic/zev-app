import { redirect } from "next/navigation";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { authenticate } from "@/server/services/users";
import { createSession, getAuthContext, clientIp } from "@/server/auth/session";
import { sha256 } from "@/server/auth/tokens";
import { landingPath } from "@/server/services/onboarding";
import { Field, inputCls, SubmitBtn } from "@/components/ui";
import { AuthShell } from "@/components/auth-shell";
import { PasswordInput } from "@/components/password-input";
import { headers } from "next/headers";
import { getEnv } from "@/lib/env";
import { isSafeOAuthNext } from "@/lib/mcp/oauth";

/** `next` se poštuje samo ako vodi na /oauth/authorize ove aplikacije (povratak na ekran saglasnosti MCP OAuth-a). */
function safeNext(raw: unknown): string | undefined {
  return isSafeOAuthNext(raw, getEnv().APP_URL) ? raw : undefined;
}

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const ip = await clientIp();
  const h = await headers();
  const result = await authenticate(email, password, ip ? sha256(ip) : null);
  if (!result.ok) {
    redirect(`/login?err=${result.error}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
  await createSession(result.user.id, ip, h.get("user-agent"));
  // A super admin who also has a Membership (e.g. president of their own ZEV, per
  // docs/multitenancy-plan.md §4.3 — isSuperAdmin and Membership are independent)
  // lands on their own tenant dashboard like anyone else; only a super admin with
  // no tenant at all has nowhere else useful to land, so goes to /admin.
  // Pozvani klijent koji još popunjava nacrt novog ZEV-a (nema nijedno članstvo) ide na čarobnjak.
  const ctx = await getAuthContext();
  redirect(next ?? (ctx ? await landingPath(ctx) : "/"));
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string; msg?: string; next?: string }> }) {
  const { err, msg, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  const ctx = await getAuthContext();
  if (ctx) redirect(next ?? (await landingPath(ctx)));
  const errMsg =
    err === "invalid" ? t("auth.invalidCredentials")
    : err === "deactivated" ? t("auth.accountDisabled")
    : err === "rate_limited" ? t("auth.login.rateLimited")
    : err === "zev_suspended" ? t("auth.login.zevSuspended")
    : undefined;
  const okMsg = msg === "password_reset_done" ? t("auth.login.resetDone") : undefined;
  return (
    <AuthShell
      pageTitle={t("auth.loginTitle")}
      footnote={next ? t("oauth.loginFootnote") : t("auth.login.footnote")}
      flash={{ err: errMsg, msg: okMsg }}
    >
      <form action={loginAction} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label={t("auth.email")}>
          <input name="email" type="email" required autoComplete="username" className={inputCls} />
        </Field>
        <Field label={t("auth.password")}>
          <PasswordInput name="password" required autoComplete="current-password" />
        </Field>
        <SubmitBtn>{t("auth.login.submit")}</SubmitBtn>
      </form>
      <p className="mt-4 text-sm">
        <Link href="/zaboravljena-lozinka" className="text-blue-700 hover:underline">{t("auth.login.forgotLink")}</Link>
      </p>
    </AuthShell>
  );
}
