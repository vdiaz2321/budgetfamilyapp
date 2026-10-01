import type { createClient } from "@/lib/supabase/server";
import { addMonths } from "@/lib/snowball";
import { currentMonthFirst } from "@/lib/snapshots";
import { unwrap } from "@/lib/supabase-result";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The plan rows a month inherits from the month before it (month = YYYY-MM-01).
 *
 * Skips $0 plans, Irregular Bills (one-off by nature, planned per month on
 * their own card, so a new month starts them at $0) and paid-off debts (once a
 * card or loan reaches $0, its old payment plan must not silently reappear in
 * a later month or cross into a new calendar year).
 */
export async function previousMonthPlanRows(supabase: SupabaseClient, householdId: string, month: string) {
  const prevMonth = addMonths(month, -1);

  const [prevPlans, irregularSubIdRows] = await Promise.all([
    supabase.from("budget_plans").select("subcategory_id, planned_cents").eq("household_id", householdId).eq("month", prevMonth),
    supabase.from("irregular_bills").select("subcategory_id").eq("household_id", householdId).not("subcategory_id", "is", null),
  ]);
  const irregularSubIds = new Set(
    (unwrap(irregularSubIdRows, "irregular_bills") ?? []).map((r) => r.subcategory_id as string),
  );

  const positivePrevPlans = (unwrap(prevPlans, "budget_plans") ?? [])
    .filter((p) => (p.planned_cents ?? 0) > 0)
    .filter((p) => !irregularSubIds.has(p.subcategory_id as string));
  const candidateSubIds = positivePrevPlans.map((p) => p.subcategory_id as string);
  let paidOffDebtSubIds = new Set<string>();
  if (candidateSubIds.length > 0) {
    const paidOffDebts = unwrap(
      await supabase
        .from("debts")
        .select("subcategory_id")
        .eq("household_id", householdId)
        .in("subcategory_id", candidateSubIds)
        .lte("current_balance_cents", 0),
      "debts",
    );
    paidOffDebtSubIds = new Set((paidOffDebts ?? []).map((debt) => debt.subcategory_id as string));
  }

  return positivePrevPlans
    .filter((p) => !paidOffDebtSubIds.has(p.subcategory_id as string))
    .map((p) => ({
      household_id: householdId,
      month,
      subcategory_id: p.subcategory_id as string,
      planned_cents: p.planned_cents as number,
    }));
}

/**
 * Start each new month with last month's plan, so the Budget board, Snowball
 * and the Pay Card prefill never show $0 just because the calendar turned.
 *
 * Runs once per month per household: households.plans_rolled_month records the
 * last month done, and the claim is a conditional update so two tabs opening
 * at once can't both roll. Months skipped entirely (app not opened) are rolled
 * in order, so each one still inherits from the one before. Only items with no
 * plan yet in the month are filled — anything already typed, or written by a
 * travel expense or a subscription, is left alone. The Budget board's "Roll
 * in" button stays for redoing it by hand.
 */
export async function autoRollInPlans(
  supabase: SupabaseClient,
  householdId: string,
  rolledMonth: string | null,
) {
  const current = currentMonthFirst();
  if (rolledMonth && rolledMonth >= current) return;

  let claimQuery = supabase
    .from("households")
    .update({ plans_rolled_month: current })
    .eq("id", householdId);
  claimQuery = rolledMonth ? claimQuery.eq("plans_rolled_month", rolledMonth) : claimQuery.is("plans_rolled_month", null);
  const claimed = unwrap(await claimQuery.select("id"), "households roll-in claim");
  if (!claimed?.length) return; // another request already rolled this month

  // First run ever: roll just this month. After that: every month since.
  let month = rolledMonth ? addMonths(rolledMonth, 1) : current;
  for (; month <= current; month = addMonths(month, 1)) {
    const rows = await previousMonthPlanRows(supabase, householdId, month);
    if (rows.length === 0) continue;
    unwrap(
      await supabase
        .from("budget_plans")
        .upsert(rows, { onConflict: "household_id,month,subcategory_id", ignoreDuplicates: true }),
      "budget_plans auto roll-in",
    );
  }
}
