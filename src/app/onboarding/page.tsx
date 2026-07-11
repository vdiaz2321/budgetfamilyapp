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
  if (existing.data) redirect("/settings");

  const { error: rpcErr } = await supabase.rpc("create_household_with_profile", {
    household_name: name,
    display_name: displayName,
  });
  if (rpcErr) {
    redirect(`/onboarding?error=${encodeURIComponent(rpcErr.message)}`);
  }

  redirect("/settings");
}

type SearchParams = Promise<{ error?: string }>;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error } = await searchParams;

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
  if (existing.data) redirect("/settings");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Set up your household
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          A one-time step. Everything in the app lives under a household so
          spouses (and later a mobile app) can share the same data. On the next
          screen you&apos;ll build your own Categories, Bills, Expenses,
          Savings, and Debt — just like the Start tab of a spreadsheet.
        </p>

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
      </div>
    </div>
  );
}
