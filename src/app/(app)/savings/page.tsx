import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCategories, type CategoryKind } from "@/lib/categories";
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
    .select("id, category_id, name, sort_order, linked_bucket_id")
    .eq("household_id", household.id)
    .order("sort_order");

  const savingsSubs = (subs ?? []).filter((s) => savingsCategoryIds.includes(s.category_id));
  const savingsSubIds = savingsSubs.map((s) => s.id);
  const linkedBucketIds = savingsSubs
    .map((s) => s.linked_bucket_id as string | null)
    .filter((id): id is string => id != null);

  const [{ data: savingsGoals }, { data: bucketRows }, { data: savingsTx }] = await Promise.all([
    savingsSubIds.length
      ? supabase
          .from("savings_goals")
          .select("subcategory_id, goal_cents, start_cents, monthly_contribution_cents, target_date")
          .eq("household_id", household.id)
      : Promise.resolve({ data: [] }),
    linkedBucketIds.length
      ? supabase.from("buckets").select("id, balance_cents").in("id", linkedBucketIds)
      : Promise.resolve({ data: [] }),
    savingsSubIds.length
      ? supabase
          .from("transactions")
          .select("subcategory_id, amount_cents, is_withdrawal")
          .eq("household_id", household.id)
          .in("subcategory_id", savingsSubIds)
      : Promise.resolve({ data: [] }),
  ]);

  const goalBySub = new Map((savingsGoals ?? []).map((g) => [g.subcategory_id, g]));
  const bucketBalanceById = new Map((bucketRows ?? []).map((b) => [b.id, b.balance_cents ?? 0]));
  const contribBySub = new Map<string, number>();
  for (const t of savingsTx ?? []) {
    const delta = t.is_withdrawal ? -t.amount_cents : t.amount_cents;
    contribBySub.set(t.subcategory_id, (contribBySub.get(t.subcategory_id) ?? 0) + delta);
  }

  const cards: SavingsCardData[] = savingsSubs.map((s) => {
    const g = goalBySub.get(s.id);
    const goalCents = g?.goal_cents ?? 0;
    const startCents = g?.start_cents ?? 0;
    const monthlyCents = g?.monthly_contribution_cents ?? 0;
    const targetDate = (g?.target_date as string | null) ?? null;
    const linkedBucketId = s.linked_bucket_id as string | null;
    // A linked bucket's real balance IS the running total (it already covers
    // the starting amount plus every contribution/withdrawal logged since);
    // without one, fall back to Start + everything logged under this item.
    const savedCents =
      linkedBucketId != null && bucketBalanceById.has(linkedBucketId)
        ? bucketBalanceById.get(linkedBucketId)!
        : startCents + (contribBySub.get(s.id) ?? 0);
    const leftToSaveCents = goalCents - savedCents;
    const reached = goalCents > 0 && leftToSaveCents <= 0;

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
        requiredMonthlyCents = Math.ceil(leftToSaveCents / months);
        pace = monthlyCents >= requiredMonthlyCents ? "on_track" : "behind";
      }
    }

    return {
      id: s.id,
      name: s.name,
      goalCents,
      startCents,
      savedCents,
      monthlyCents,
      leftToSaveCents,
      targetDate,
      pace,
      requiredMonthlyCents,
    };
  });

  return <SavingsBoard cards={cards} currency={household.currency} />;
}
