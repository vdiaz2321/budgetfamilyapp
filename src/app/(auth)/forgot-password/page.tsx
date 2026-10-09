import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Reset password · Capitall",
};

async function sendReset(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect("/forgot-password?error=Enter+your+email");
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) {
    redirect(
      `/forgot-password?email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`,
    );
  }

  redirect(`/forgot-password?sent=1&email=${encodeURIComponent(email)}`);
}

type SearchParams = Promise<{
  email?: string;
  error?: string;
  sent?: string;
}>;

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { email, error, sent } = await searchParams;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-medium text-brand">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">
              C
            </span>
            Capitall
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-foreground">
            Enter your email and we&apos;ll send you a link to set a new password.
          </p>

          {sent ? (
            <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300">
              Check {email ? <strong>{email}</strong> : "your inbox"} for a reset link. It expires shortly, so use it soon.
            </div>
          ) : (
            <form action={sendReset} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-foreground"
                >
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  defaultValue={email}
                  className="mt-1 w-full rounded-lg border border-line bg-sky-50 px-3 py-2 text-sm dark:bg-background text-foreground shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              {error ? (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-strong focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
              >
                Send reset link
              </button>
            </form>
          )}

          <p className="mt-6 text-sm text-foreground">
            <a
              href="/login"
              className="font-medium text-brand underline hover:text-brand-strong"
            >
              Back to sign in
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
