import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Set up household · Budget Family App" };

async function createHousehold(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim() || null;

  if (!name) {
    redirect("/onboarding?error=missing-name");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const existing = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing.data) redirect("/budget");

  const { error: rpcErr } = await supabase.rpc("create_household_with_profile", {
    household_name: name,
    display_name: displayName,
  });
  if (rpcErr) {
    redirect(`/onboarding?error=${encodeURIComponent(rpcErr.message)}`);
  }

  redirect("/budget");
}

async function joinHousehold(formData: FormData) {
  "use server";
  const code = String(formData.get("code") ?? "").trim();
  const displayName = String(formData.get("displayNameJoin") ?? "").trim() || null;

  if (!code) {
    redirect("/onboarding?mode=join&error=missing-code");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const existing = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing.data) redirect("/budget");

  const { error: rpcErr } = await supabase.rpc("join_household_by_code", {
    code,
    display_name: displayName,
  });
  if (rpcErr) {
    redirect(
      `/onboarding?mode=join&error=${encodeURIComponent(rpcErr.message)}`,
    );
  }

  redirect("/budget");
}

type SearchParams = Promise<{ mode?: string; error?: string }>;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { mode, error } = await searchParams;
  const isJoin = mode === "join";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const existing = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing.data) redirect("/budget");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {isJoin ? "Join a household" : "Set up your household"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {isJoin
            ? "Enter the invite code your spouse shared with you. You'll land in the same household — same budget, same accounts, same data."
            : "A one-time step. Everything in the app lives under a household so spouses (and later a mobile app) can share the same data. On the next screen you'll build your own Categories, Bills, Expenses, Savings, and Debt — just like the Start tab of a spreadsheet."}
        </p>

        <div className="mt-4 flex gap-4 text-sm">
          <a
            href="/onboarding"
            className={
              isJoin
                ? "text-zinc-500 underline dark:text-zinc-400"
                : "font-medium text-emerald-700 dark:text-emerald-400"
            }
          >
            Create a household
          </a>
          <a
            href="/onboarding?mode=join"
            className={
              isJoin
                ? "font-medium text-emerald-700 dark:text-emerald-400"
                : "text-zinc-500 underline dark:text-zinc-400"
            }
          >
            Join with a code
          </a>
        </div>

        {isJoin ? (
          <form action={joinHousehold} className="mt-8 space-y-5">
            <div>
              <label
                htmlFor="code"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Invite code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                required
                autoCapitalize="characters"
                placeholder="e.g. A1B2C3D4"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm uppercase tracking-widest shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label
                htmlFor="displayNameJoin"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Your display name
              </label>
              <input
                id="displayNameJoin"
                name="displayNameJoin"
                type="text"
                placeholder="First name"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>

            {error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : null}

            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              Join household
            </button>
          </form>
        ) : (
          <form action={createHousehold} className="mt-8 space-y-5">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Household name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                placeholder="e.g. Smith Family"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label
                htmlFor="displayName"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Your display name
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                placeholder="First name"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>

            {error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : null}

            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              Continue to Setup
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
