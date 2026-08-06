import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Set new password · Capitall",
};

async function updatePassword(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!password || password.length < 6) {
    redirect("/reset-password?error=Password+must+be+at+least+6+characters");
  }
  if (password !== confirm) {
    redirect("/reset-password?error=Passwords+do+not+match");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect("/login?error=Reset+link+expired.+Request+a+new+one.");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/reset-password?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/budget");
}

type SearchParams = Promise<{ error?: string }>;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const hasRecoverySession = !!data.user;

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
            Set a new password
          </h1>

          {!hasRecoverySession ? (
            <>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                This reset link is invalid or has expired. Request a new one.
              </p>
              <p className="mt-6 text-sm">
                <a
                  href="/forgot-password"
                  className="font-medium text-indigo-700 underline hover:text-indigo-800 dark:text-indigo-400"
                >
                  Request a new reset link
                </a>
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Pick a new password. You&apos;ll be signed in after saving.
              </p>

              <form action={updatePassword} className="mt-6 space-y-4">
                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    New password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    autoFocus
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirm"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Confirm password
                  </label>
                  <input
                    id="confirm"
                    name="confirm"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
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
                  Save new password
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
