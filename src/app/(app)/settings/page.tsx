import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { GlobalsCard } from "./globals-card";
import { CategoriesGrid } from "./categories-grid";
import { SavingsTable } from "./savings-table";
import { DebtTable } from "./debt-table";

export const metadata = { title: "Settings · Budget Family App" };

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  const { data: household } = await supabase
    .from("households")
    .select("id, name, currency, year, snowball_start_date, snowball_monthly_extra_cents")
    .eq("id", profile.household_id)
    .single();

  if (!household) redirect("/onboarding");

  const categories = await ensureCategories(supabase, household.id);

  const [{ data: subs }, { data: goals }, { data: debts }] = await Promise.all([
    supabase
      .from("subcategories")
      .select("id, category_id, name, due_day, sort_order")
      .eq("household_id", household.id)
      .order("sort_order"),
    supabase
      .from("savings_goals")
      .select("subcategory_id, goal_cents, start_cents, monthly_contribution_cents")
      .eq("household_id", household.id),
    supabase
      .from("debts")
      .select("subcategory_id, current_balance_cents, min_payment_cents, apr, due_day")
      .eq("household_id", household.id),
  ]);

  const catByKind = new Map(categories.map((c) => [c.kind as CategoryKind, c]));
  const savingsCatId = catByKind.get("savings")?.id;
  const debtCatId = catByKind.get("debt")?.id;

  const savingsSubs = (subs ?? []).filter((s) => s.category_id === savingsCatId);
  const debtSubs = (subs ?? []).filter((s) => s.category_id === debtCatId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          The Start-tab hub. Add your categories, savings funds, and debts here;
          they populate every other tab.
        </p>
      </div>

      <GlobalsCard
        currency={household.currency}
        year={household.year}
        snowballStartDate={household.snowball_start_date}
        snowballMonthlyExtraCents={household.snowball_monthly_extra_cents ?? 0}
      />

      <CategoriesGrid
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind as CategoryKind,
        }))}
        subcategories={(subs ?? []).map((s) => ({
          id: s.id,
          category_id: s.category_id,
          name: s.name,
          due_day: s.due_day,
        }))}
      />

      <SavingsTable
        currency={household.currency}
        savingsSubcategories={savingsSubs.map((s) => ({ id: s.id, name: s.name }))}
        goals={(goals ?? []).map((g) => ({
          subcategory_id: g.subcategory_id,
          goal_cents: g.goal_cents,
          start_cents: g.start_cents,
          monthly_contribution_cents: g.monthly_contribution_cents,
        }))}
      />

      <DebtTable
        currency={household.currency}
        debtSubcategories={debtSubs.map((s) => ({
          id: s.id,
          name: s.name,
          due_day: s.due_day,
        }))}
        debts={(debts ?? []).map((d) => ({
          subcategory_id: d.subcategory_id,
          current_balance_cents: d.current_balance_cents,
          min_payment_cents: d.min_payment_cents,
          apr: Number(d.apr),
          due_day: d.due_day,
        }))}
      />
    </div>
  );
}
