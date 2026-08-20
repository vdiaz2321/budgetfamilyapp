import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCategories } from "@/lib/categories";
import { SavingsBoard, type SavingsCardData } from "./savings-board";
import type { AccountOption, SubOption } from "../budget/types";

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
  const incomeCategoryIds = categories.filter((c) => c.kind === "income").map((c) => c.id);

  const { data: subs } = await supabase
    .from("subcategories")
    .select("id, category_id, name, sort_order, linked_bucket_id, linked_account_id")
    .eq("household_id", household.id)
    .order("sort_order");

  const savingsSubs = (subs ?? []).filter((s) => savingsCategoryIds.includes(s.category_id));
  const savingsSubIds = savingsSubs.map((s) => s.id);
  const incomeSubIds = (subs ?? []).filter((s) => incomeCategoryIds.includes(s.category_id)).map((s) => s.id);

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [
    { data: savingsGoals },
    { data: savingsTx },
    { data: plans },
    { data: buckets },
    { data: accounts },
    { data: payees },
    { data: incomeActuals },
  ] = await Promise.all([
    savingsSubIds.length
      ? supabase
          .from("savings_goals")
          .select("subcategory_id, goal_cents, start_cents, monthly_contribution_cents, target_date")
          .eq("household_id", household.id)
      : Promise.resolve({ data: [] }),
    savingsSubIds.length
      ? supabase
          .from("transactions")
          .select("id, subcategory_id, amount_cents, is_withdrawal, payee_id, occurred_on, account_id")
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
    supabase.from("accounts").select("id, name, holder, kind, is_kids_account").eq("household_id", household.id),
    supabase.from("payees").select("id, name").eq("household_id", household.id),
    incomeSubIds.length
      ? supabase
          .from("v_monthly_actuals")
          .select("subcategory_id, actual_cents")
          .eq("household_id", household.id)
          .eq("month", monthKey)
          .in("subcategory_id", incomeSubIds)
      : Promise.resolve({ data: [] }),
  ]);

  const isKidsAccountById = new Map((accounts ?? []).map((a) => [a.id, a.is_kids_account ?? false]));
  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const payeeNameById = new Map((payees ?? []).map((payee) => [payee.id, payee.name]));
  const accountIdByBucket = new Map((buckets ?? []).map((b) => [b.id, b.account_id]));
  const incomeReceivedCents = (incomeActuals ?? []).reduce(
    (sum, row) => sum + Math.max(0, row.actual_cents ?? 0),
    0,
  );
  const currentMonthKey = monthKey.slice(0, 7);
  const withdrawalSubOptions: SubOption[] = savingsSubs.map((sub) => ({
    id: sub.id,
    name: sub.name,
    kind: "savings",
    linkedBucketId: sub.linked_bucket_id ?? null,
  }));
  const withdrawalAccountOptions: AccountOption[] = (accounts ?? [])
    .filter((account) => account.kind === "checking" || account.kind === "savings_bucket" || account.kind === "cash" || account.kind === "credit_card")
    .map((account) => ({
      id: account.id,
      name: account.name,
      group: account.kind === "credit_card" ? "Credit Cards" : "Banking",
    }));

  const goalBySub = new Map((savingsGoals ?? []).map((g) => [g.subcategory_id, g]));
  const plannedBySub = new Map((plans ?? []).map((p) => [p.subcategory_id, p.planned_cents as number]));
  const monthDepositsBySub = new Map<string, number>();
  const monthWithdrawalsBySub = new Map<string, number>();
  for (const t of savingsTx ?? []) {
    if (t.occurred_on.startsWith(currentMonthKey)) {
      const target = t.is_withdrawal ? monthWithdrawalsBySub : monthDepositsBySub;
      target.set(t.subcategory_id, (target.get(t.subcategory_id) ?? 0) + t.amount_cents);
    }
  }

  // Build per-subcategory transaction lists for the expanded goal details (most recent first, cap at 12).
  const txsBySub = new Map<string, SavingsCardData["transactions"]>();
  for (const t of savingsTx ?? []) {
    if (!txsBySub.has(t.subcategory_id)) txsBySub.set(t.subcategory_id, []);
    txsBySub.get(t.subcategory_id)!.push({
      id: t.id,
      date: t.occurred_on,
      payee: t.payee_id ? payeeNameById.get(t.payee_id) ?? null : null,
      amountCents: t.amount_cents,
      isWithdrawal: t.is_withdrawal,
      accountName: t.account_id ? accountNameById.get(t.account_id) ?? null : null,
    });
  }
  for (const [k, arr] of txsBySub) {
    arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    txsBySub.set(k, arr.slice(0, 12));
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
    const plannedCents = plannedBySub.get(s.id) ?? 0;
    const monthDepositsCents = monthDepositsBySub.get(s.id) ?? 0;
    const monthWithdrawalsCents = monthWithdrawalsBySub.get(s.id) ?? 0;
    const monthNetCents = monthDepositsCents - monthWithdrawalsCents;
    // Match Budget's savings progress: the configured opening balance plus
    // this month's net contributions. Historical transactions may predate the
    // opening balance and must not be counted a second time.
    const savedCents = startCents + monthNetCents;
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
      monthDepositsCents,
      monthWithdrawalsCents,
      monthNetCents,
      transactions: txsBySub.get(s.id) ?? [],
      isKids,
    };
  });

  return (
    <SavingsBoard
      cards={cards}
      currency={household.currency}
      incomeReceivedCents={incomeReceivedCents}
      currentMonthKey={currentMonthKey}
      currentMonthLabel={now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      withdrawalSubOptions={withdrawalSubOptions}
      withdrawalAccountOptions={withdrawalAccountOptions}
      withdrawalPayeeOptions={(payees ?? []).map((payee) => ({ id: payee.id, name: payee.name }))}
      firstOfMonth={monthKey}
    />
  );
}
