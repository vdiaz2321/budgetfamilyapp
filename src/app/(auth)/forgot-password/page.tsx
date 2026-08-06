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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-800">
          <p className="flex items-center gap-2 text-sm font-medium text-indigo-600 dark:text-indigo-400">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white">
              C
            </span>
            Capitall
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
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
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
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
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>

              {error ? (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
              >
                Send reset link
              </button>
            </form>
          )}

          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
            <a
              href="/login"
              className="font-medium text-indigo-700 underline hover:text-indigo-800 dark:text-indigo-400"
            >
              Back to sign in
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
