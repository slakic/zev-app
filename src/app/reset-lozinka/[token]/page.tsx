// Public, token-authenticated "set a new password" page — same shape as the /glasanje/[token]
// voting page: the token from the e-mail link is the only credential, checked server-side
// before any form is shown, and consumed (single-use) on success.
import { redirect } from "next/navigation";
import Link from "next/link";
import { inspectPasswordResetToken, resetPassword } from "@/server/services/users";
import { getAuthContext } from "@/server/auth/session";
import { Field, inputCls, SubmitBtn } from "@/components/ui";

const ERR_TEXT: Record<string, string> = {
  invalid: "Link nije prepoznat ili je već iskorišten. Zatražite novi link.",
  expired: "Link je istekao (važi 1 sat od slanja). Zatražite novi link.",
  weak: "Lozinka mora imati najmanje 8 karaktera.",
  mismatch: "Unijete lozinke se ne poklapaju.",
};

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
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">ZEV upravnik</h1>
        <p className="mb-5 text-sm text-slate-500">Nova lozinka</p>

        {!info.ok ? (
          <div className="space-y-3">
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {ERR_TEXT[info.error]}
            </div>
            <Link href="/zaboravljena-lozinka" className="block text-sm text-blue-700 hover:underline">
              Zatraži novi link
            </Link>
          </div>
        ) : (
          <>
            {err && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {ERR_TEXT[err] ?? "Greška."}
              </div>
            )}
            <form action={resetAction} className="space-y-4">
              <input type="hidden" name="token" value={token} />
              <Field label="Nova lozinka" hint="Najmanje 8 karaktera.">
                <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
              </Field>
              <Field label="Ponovite novu lozinku">
                <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
              </Field>
              <SubmitBtn>Postavi novu lozinku</SubmitBtn>
            </form>
          </>
        )}

        <p className="mt-4 text-sm">
          <Link href="/login" className="text-blue-700 hover:underline">‹ Nazad na prijavu</Link>
        </p>
      </div>
    </main>
  );
}
