// Public, unauthenticated "forgot password" request page. Deliberately shows the exact same
// confirmation whether or not the e-mail belongs to an account — see requestPasswordReset()
// in users.ts for why (never reveal which addresses have accounts).
import { redirect } from "next/navigation";
import Link from "next/link";
import { requestPasswordReset } from "@/server/services/users";
import { clientIp, getAuthContext } from "@/server/auth/session";
import { sha256 } from "@/server/auth/tokens";
import { Field, inputCls, SubmitBtn } from "@/components/ui";

async function requestResetAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const ip = await clientIp();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
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
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">ZEV upravnik</h1>
        <p className="mb-5 text-sm text-slate-500">Zaboravljena lozinka</p>

        {sent ? (
          <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Ako nalog sa tom e-mail adresom postoji, poslali smo link za postavljanje nove lozinke. Link važi 1 sat.
          </div>
        ) : (
          <form action={requestResetAction} className="space-y-4">
            <p className="text-sm text-slate-600">
              Unesite e-mail adresu naloga. Ako postoji nalog sa tom adresom, poslaćemo link za postavljanje nove lozinke.
            </p>
            <Field label="E-mail adresa">
              <input name="email" type="email" required autoComplete="username" className={inputCls} />
            </Field>
            <SubmitBtn>Pošalji link za resetovanje</SubmitBtn>
          </form>
        )}

        <p className="mt-4 text-sm">
          <Link href="/login" className="text-blue-700 hover:underline">‹ Nazad na prijavu</Link>
        </p>
      </div>
    </main>
  );
}
