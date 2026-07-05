import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SEED_ACCOUNTS, SEED_CATEGORIES } from "@/lib/seed/default-household";

export const metadata = { title: "Set up household · Budget Family App" };

async function createHousehold(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim() || "Our Family";
  const displayName = String(formData.get("displayName") ?? "").trim() || null;
  const seed = formData.get("seed") === "on";

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

  const { data: household, error: hhErr } = await supabase
    .from("households")
    .insert({ name })
    .select("id")
    .single();
  if (hhErr || !household) {
    redirect(`/onboarding?error=${encodeURIComponent(hhErr?.message ?? "household-failed")}`);
  }

  const { error: profileErr } = await supabase.from("profiles").insert({
    user_id: user.id,
    household_id: household.id,
    display_name: displayName,
  });
  if (profileErr) {
    redirect(`/onboarding?error=${encodeURIComponent(profileErr.message)}`);
  }

  if (seed) {
    for (let i = 0; i < SEED_CATEGORIES.length; i++) {
      const cat = SEED_CATEGORIES[i];
      const { data: c, error: catErr } = await supabase
        .from("categories")
        .insert({
          household_id: household.id,
          name: cat.name,
          kind: cat.kind,
          sort_order: i,
        })
        .select("id")
        .single();
      if (catErr || !c) continue;

      if (cat.subcategories.length) {
        await supabase.from("subcategories").insert(
          cat.subcategories.map((s, j) => ({
            household_id: household.id,
            category_id: c.id,
            name: s,
            sort_order: j,
          })),
        );
      }
    }

    if (SEED_ACCOUNTS.length) {
      await supabase.from("accounts").insert(
        SEED_ACCOUNTS.map((a) => ({
          household_id: household.id,
          name: a.name,
          kind: a.kind,
          holder: a.holder ?? null,
        })),
      );
    }
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Set up your household
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This is a one-time step. Everything in the app lives under a household
        so spouses (and later, a mobile app) can share the same data.
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
            defaultValue="Diaz Family"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
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
            defaultValue="Victor"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          <input
            type="checkbox"
            name="seed"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-emerald-900 dark:text-emerald-100">
            <strong className="block">Seed with my spreadsheet vocabulary</strong>
            Pre-load the exact Bills / Expenses / Savings / Debt categories,
            subcategories, and credit-card accounts from your 2026 Budget
            Tracker. You can edit any of it later in Settings.
          </span>
        </label>

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}

        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
        >
          Create household
        </button>
      </form>
      </div>
    </div>
  );
}
