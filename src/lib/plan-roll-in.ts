import type { createClient } from "@/lib/supabase/server";
import { addMonths } from "@/lib/snowball";
import { unwrap } from "@/lib/supabase-result";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The plan rows a month inherits from the month before it (month = YYYY-MM-01).
 *
 * Skips $0 plans, Irregular Bills (one-off by nature, planned per month on
 * their own card, so a new month starts them at $0), items fed by the Travel
 * Log (Restaurant Travel, Traveling/Trips — the trips set their plan, so last
 * month's figure must not be copied over it) and paid-off debts (once a
 * card or loan reaches $0, its old payment plan must not silently reappear in
 * a later month or cross into a new calendar year).
 */
export async function previousMonthPlanRows(supabase: SupabaseClient, householdId: string, month: string) {
  const prevMonth = addMonths(month, -1);

  const [prevPlans, irregularSubIdRows, tripSubIdRows] = await Promise.all([
    supabase.from("budget_plans").select("subcategory_id, planned_cents").eq("household_id", householdId).eq("month", prevMonth),
    supabase.from("irregular_bills").select("subcategory_id").eq("household_id", householdId).not("subcategory_id", "is", null),
    supabase.from("subcategories").select("id").eq("household_id", householdId).eq("receives_trip_plans", true),
  ]);
  const irregularSubIds = new Set(
    (unwrap(irregularSubIdRows, "irregular_bills") ?? []).map((r) => r.subcategory_id as string),
  );
  const tripSubIds = new Set((unwrap(tripSubIdRows, "subcategories") ?? []).map((r) => r.id as string));

  const positivePrevPlans = (unwrap(prevPlans, "budget_plans") ?? [])
    .filter((p) => (p.planned_cents ?? 0) > 0)
    .filter((p) => !irregularSubIds.has(p.subcategory_id as string))
    .filter((p) => !tripSubIds.has(p.subcategory_id as string));
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
 * households.plans_rolled_month: the latest month whose roll-in Victor has
 * answered — rolled in or skipped. The Budget board hides the Roll in button
 * for that month and any before it. Nothing rolls in on its own: last month's
 * plan only lands when he says yes.
 */
export async function markRollInAnswered(supabase: SupabaseClient, householdId: string, month: string) {
  unwrap(
    await supabase
      .from("households")
      .update({ plans_rolled_month: month })
      .eq("id", householdId)
      .or(`plans_rolled_month.is.null,plans_rolled_month.lt.${month}`)
      .select("id"),
    "households roll-in answer",
  );
}

/** Undo of a roll-in: the month's question is open again. */
export async function reopenRollIn(supabase: SupabaseClient, householdId: string, month: string) {
  unwrap(
    await supabase
      .from("households")
      .update({ plans_rolled_month: addMonths(month, -1) })
      .eq("id", householdId)
      .eq("plans_rolled_month", month)
      .select("id"),
    "households roll-in reopen",
  );
}
