import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "./submit-button";

export const metadata = {
  title: "Sign in · Capitall",
};

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=Enter+your+email+and+password");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(
      `/login?email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`,
    );
  }

  redirect("/budget");
}

async function createAccount(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?mode=signup&error=Enter+your+email+and+password");
  }
  if (password.length < 6) {
    redirect(
      `/login?mode=signup&email=${encodeURIComponent(email)}&error=Password+must+be+at+least+6+characters`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(
      `/login?mode=signup&email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`,
    );
  }

  // With email confirmation disabled, signUp returns an active session and we
  // can go straight in. If confirmation is on, there's no session yet.
  if (!data.session) {
    redirect(
      `/login?email=${encodeURIComponent(email)}&error=${encodeURIComponent(
        "Account created. If a confirmation email was required, confirm it, then sign in.",
      )}`,
    );
  }

  redirect("/budget");
}

type SearchParams = Promise<{
  mode?: string;
  email?: string;
  error?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { mode, email, error } = await searchParams;
  const isSignup = mode === "signup";

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
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 text-sm font-semibold dark:bg-zinc-900">
            <a
              href="/login"
              className={
                "rounded-lg py-2 text-center transition " +
                (!isSignup
                  ? "bg-white text-indigo-700 shadow-sm dark:bg-zinc-800 dark:text-indigo-300"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200")
              }
            >
              Sign in
            </a>
            <a
              href="/login?mode=signup"
              className={
                "rounded-lg py-2 text-center transition " +
                (isSignup
                  ? "bg-white text-indigo-700 shadow-sm dark:bg-zinc-800 dark:text-indigo-300"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200")
              }
            >
              Register
            </a>
          </div>

          <h1 className="mt-5 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {isSignup
              ? "Pick an email and a password. You'll use these on every device."
              : "Enter your email and password."}
          </p>

          {isSignup ? (
            <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
              <p className="font-semibold">Joining someone else&apos;s household?</p>
              <p className="mt-1">
                Create your account first. Right after signup you&apos;ll be asked whether
                to start a new household or <strong>Join with a code</strong> — that&apos;s
                where you paste the invite code they shared.
              </p>
            </div>
          ) : null}

          <form
            action={isSignup ? createAccount : signIn}
            className="mt-6 space-y-4"
          >
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

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder={isSignup ? "At least 6 characters" : ""}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            {error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : null}

            <SubmitButton
              label={isSignup ? "Create account" : "Sign in"}
              pendingLabel={isSignup ? "Creating account…" : "Signing in…"}
            />

            {!isSignup ? (
              <p className="text-right text-sm">
                <a
                  href="/forgot-password"
                  className="font-medium text-indigo-700 underline hover:text-indigo-800 dark:text-indigo-400"
                >
                  Forgot password?
                </a>
              </p>
            ) : null}
          </form>

        </div>
      </main>
    </div>
  );
}
