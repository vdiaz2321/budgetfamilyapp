import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Sign in · Budget Family App",
};

async function sendCode(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login?error=Enter+your+email");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect(`/login?step=code&email=${encodeURIComponent(email)}`);
}

async function verifyCode(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("code") ?? "").replace(/\s/g, "");

  if (!email) redirect("/login?error=Missing+email");
  if (!token) {
    redirect(`/login?step=code&email=${encodeURIComponent(email)}&error=Enter+the+code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) {
    redirect(
      `/login?step=code&email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`,
    );
  }

  redirect("/settings");
}

type SearchParams = Promise<{
  step?: string;
  email?: string;
  error?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { step, email, error } = await searchParams;
  const onCodeStep = step === "code";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-800">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Budget Family App
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Sign in
          </h1>

          {onCodeStep ? (
            <>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                We emailed a 6-digit code to <strong>{email}</strong>. Enter it
                below — works in any browser, on any device.
              </p>

              <form action={verifyCode} className="mt-6 space-y-4">
                <input type="hidden" name="email" value={email} />
                <div>
                  <label
                    htmlFor="code"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    6-digit code
                  </label>
                  <input
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    required
                    autoFocus
                    placeholder="123456"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-center text-lg tracking-[0.4em] text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  />
                </div>

                {error ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                ) : null}

                <button
                  type="submit"
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
                >
                  Verify &amp; sign in
                </button>
              </form>

              <form action={sendCode} className="mt-4">
                <input type="hidden" name="email" value={email} />
                <button
                  type="submit"
                  className="text-sm text-zinc-500 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  Resend code
                </button>
              </form>

              <p className="mt-4 text-xs text-zinc-400">
                Wrong email?{" "}
                <a href="/login" className="underline hover:text-zinc-600">
                  Start over
                </a>
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Enter your email and we&apos;ll send you a 6-digit sign-in code.
              </p>

              <form action={sendCode} className="mt-6 space-y-4">
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
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  />
                </div>

                {error ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                ) : null}

                <button
                  type="submit"
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
                >
                  Send code
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
