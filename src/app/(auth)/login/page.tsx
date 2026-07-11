import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {isSignup ? "Create your account" : "Sign in"}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {isSignup
              ? "Pick an email and a password. You'll use these on every device."
              : "Enter your email and password."}
          </p>

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

            <button
              type="submit"
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
            >
              {isSignup ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
            {isSignup ? (
              <>
                Already have an account?{" "}
                <a
                  href="/login"
                  className="font-medium text-indigo-700 underline hover:text-indigo-800 dark:text-indigo-400"
                >
                  Sign in
                </a>
              </>
            ) : (
              <>
                First time here?{" "}
                <a
                  href="/login?mode=signup"
                  className="font-medium text-indigo-700 underline hover:text-indigo-800 dark:text-indigo-400"
                >
                  Create an account
                </a>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
