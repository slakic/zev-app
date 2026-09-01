import { redirect } from "next/navigation";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { authenticate } from "@/server/services/users";
import { createSession, getAuthContext, clientIp } from "@/server/auth/session";
import { sha256 } from "@/server/auth/tokens";
import { Flash, Field, inputCls, SubmitBtn } from "@/components/ui";
import { headers } from "next/headers";

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ip = await clientIp();
  const h = await headers();
  const result = await authenticate(email, password, ip ? sha256(ip) : null);
  if (!result.ok) {
    redirect(`/login?err=${result.error}`);
  }
  await createSession(result.user.id, ip, h.get("user-agent"));
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string; msg?: string }> }) {
  const ctx = await getAuthContext();
  if (ctx) redirect("/");
  const { err, msg } = await searchParams;
  const errMsg =
    err === "invalid" ? t("auth.invalidCredentials")
    : err === "deactivated" ? t("auth.accountDisabled")
    : err === "rate_limited" ? "Previše pokušaja prijave. Pokušajte ponovo za 15 minuta."
    : undefined;
  const okMsg = msg === "password_reset_done" ? "Lozinka je uspješno promijenjena. Prijavite se novom lozinkom." : undefined;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">{t("app.name")}</h1>
        <p className="mb-5 text-sm text-slate-500">{t("auth.loginTitle")}</p>
        <Flash err={errMsg} msg={okMsg} />
        <form action={loginAction} className="space-y-4">
          <Field label={t("auth.email")}>
            <input name="email" type="email" required autoComplete="username" className={inputCls} />
          </Field>
          <Field label={t("auth.password")}>
            <input name="password" type="password" required autoComplete="current-password" className={inputCls} />
          </Field>
          <SubmitBtn>{t("auth.login")}</SubmitBtn>
        </form>
        <p className="mt-4 text-sm">
          <Link href="/zaboravljena-lozinka" className="text-blue-700 hover:underline">Zaboravili ste lozinku?</Link>
        </p>
      </div>
    </main>
  );
}
