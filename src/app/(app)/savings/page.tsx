import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCategories } from "@/lib/categories";
import { SavingsBoard, type SavingsCardData } from "./savings-board";

export const metadata = { title: "Savings · Capitall" };

// Whole calendar months from today to a YYYY-MM-DD target date (day-of-month
// ignored — Monthly contributions are a monthly cadence, so day precision
// inside a month isn't meaningful here). Negative means the date has passed.
function monthsUntil(target: string): number {
  const [ty, tm] = target.split("-").map(Number);
  const now = new Date();
  return (ty - now.getFullYear()) * 12 + (tm - 1 - now.getMonth());
}

export default async function SavingsPage() {
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
    .select("id, currency")
    .eq("id", profile.household_id)
    .single();
  if (!household) redirect("/onboarding");

  const categories = await ensureCategories(supabase, household.id);
  const savingsCategoryIds = categories.filter((c) => c.kind === "savings").map((c) => c.id);

  const { data: subs } = await supabase
    .from("subcategories")
    .select("id, category_id, name, sort_order, linked_bucket_id, linked_account_id")
    .eq("household_id", household.id)
    .order("sort_order");

  const savingsSubs = (subs ?? []).filter((s) => savingsCategoryIds.includes(s.category_id));
  const savingsSubIds = savingsSubs.map((s) => s.id);

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: savingsGoals }, { data: savingsTx }, { data: plans }, { data: buckets }, { data: accounts }] = await Promise.all([
    savingsSubIds.length
      ? supabase
          .from("savings_goals")
          .select("subcategory_id, goal_cents, start_cents, monthly_contribution_cents, target_date")
          .eq("household_id", household.id)
      : Promise.resolve({ data: [] }),
    savingsSubIds.length
      ? supabase
          .from("transactions")
          .select("id, subcategory_id, amount_cents, is_withdrawal, payee, occurred_on, account_id")
          .eq("household_id", household.id)
          .in("subcategory_id", savingsSubIds)
      : Promise.resolve({ data: [] }),
    savingsSubIds.length
      ? supabase
          .from("budget_plans")
          .select("subcategory_id, planned_cents")
          .eq("household_id", household.id)
          .eq("month", monthKey)
          .in("subcategory_id", savingsSubIds)
      : Promise.resolve({ data: [] }),
    supabase.from("buckets").select("id, account_id").eq("household_id", household.id),
    supabase.from("accounts").select("id, is_kids_account").eq("household_id", household.id),
  ]);

  const isKidsAccountById = new Map((accounts ?? []).map((a) => [a.id, a.is_kids_account ?? false]));
  const accountIdByBucket = new Map((buckets ?? []).map((b) => [b.id, b.account_id]));

  const goalBySub = new Map((savingsGoals ?? []).map((g) => [g.subcategory_id, g]));
  const plannedBySub = new Map((plans ?? []).map((p) => [p.subcategory_id, p.planned_cents as number]));
  const contribBySub = new Map<string, number>();
  for (const t of savingsTx ?? []) {
    const delta = t.is_withdrawal ? -t.amount_cents : t.amount_cents;
    contribBySub.set(t.subcategory_id, (contribBySub.get(t.subcategory_id) ?? 0) + delta);
  }

  // Build per-subcategory transaction lists for the card dropdown (most recent first, cap at 10)
  const txsBySub = new Map<string, SavingsCardData["transactions"]>();
  for (const t of savingsTx ?? []) {
    if (!txsBySub.has(t.subcategory_id)) txsBySub.set(t.subcategory_id, []);
    txsBySub.get(t.subcategory_id)!.push({
      id: t.id,
      date: t.occurred_on,
      payee: t.payee,
      amountCents: t.amount_cents,
      isWithdrawal: t.is_withdrawal,
    });
  }
  for (const [k, arr] of txsBySub) {
    arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    txsBySub.set(k, arr.slice(0, 10));
  }

  const cards: SavingsCardData[] = savingsSubs.map((s) => {
    const linkedAccountId = (s as { linked_account_id?: string | null }).linked_account_id ?? null;
    const bucketAccountId = s.linked_bucket_id ? accountIdByBucket.get(s.linked_bucket_id) : null;
    const resolvedAccountId = bucketAccountId ?? linkedAccountId ?? null;
    const isKids = resolvedAccountId ? (isKidsAccountById.get(resolvedAccountId) ?? false) : false;

    const g = goalBySub.get(s.id);
    const goalCents = g?.goal_cents ?? 0;
    const startCents = g?.start_cents ?? 0;
    const monthlyCents = g?.monthly_contribution_cents ?? 0;
    const targetDate = (g?.target_date as string | null) ?? null;
    // Saved tracks progress toward the Goal, so it's Start + everything
    // logged under this item — not the linked bucket's account balance,
    // which can include market movement or funds beyond this goal.
    const savedCents = startCents + (contribBySub.get(s.id) ?? 0);
    const leftToSaveCents = goalCents - savedCents;
    const reached = goalCents > 0 && leftToSaveCents <= 0;

    const plannedCents = plannedBySub.get(s.id) ?? 0;

    let pace: SavingsCardData["pace"] = "none";
    let requiredMonthlyCents: number | null = null;
    if (reached) {
      pace = "reached";
    } else if (targetDate && goalCents > 0) {
      const months = monthsUntil(targetDate);
      if (months <= 0) {
        pace = "overdue";
        requiredMonthlyCents = leftToSaveCents;
      } else {
        // Treat this month's planned contribution as already made — Victor
        // logs savings at end of month, so give the month a chance to land
        // before flagging behind. Required = what's needed each future month
        // after this month's planned amount comes through.
        const projectedLeft = Math.max(0, leftToSaveCents - plannedCents);
        requiredMonthlyCents = Math.ceil(projectedLeft / months);
        pace = plannedCents >= requiredMonthlyCents ? "on_track" : "behind";
      }
    }

    return {
      id: s.id,
      name: s.name,
      goalCents,
      startCents,
      savedCents,
      monthlyCents,
      plannedCents,
      leftToSaveCents,
      targetDate,
      pace,
      requiredMonthlyCents,
      transactions: txsBySub.get(s.id) ?? [],
      isKids,
    };
  });

  return <SavingsBoard cards={cards} currency={household.currency} />;
}
