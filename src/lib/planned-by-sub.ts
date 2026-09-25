import type { createClient } from "@/lib/supabase/server";
import { throwIfAny } from "@/lib/supabase-result";
import { fetchTripPlans, tripPlanTotals, type TripPlanRow } from "@/lib/trip-budget-plans";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * What a budget item plans in a month — the one rule every page uses, so the
 * Budget board, the Transactions picker and anything else that shows a
 * "Planned" figure can never disagree.
 *
 * Precedence, per item and month:
 *   1. Irregular Bills — the sum of its bills' per-month plans, once that month
 *      has at least one. Months from before the Irregular Bills card existed
 *      have no per-bill plans and keep their old budget_plans figure.
 *   2. Subscriptions — the sum of what each linked subscription plans that
 *      month (see subscriptionPlannedFor), when it comes to more than $0.
 *   3. Everything else — the month's budget_plans row, exactly as typed on the
 *      Budget board. Travel Log trip plans only stand in for a month that has
 *      no typed plan yet, so a trip can seed the figure but never adjust one
 *      Victor has set: the Planned cell is his to own.
 */

export type PlanSubscription = {
  id: string;
  subcategory_id: string | null;
  is_active: boolean | null;
  next_renewal_date: string | null;
  billing_cycle: string;
  amount_cents: number;
};

export type PlanInputs = {
  budgetPlans: { month: string; subcategory_id: string; planned_cents: number }[];
  tripPlans: TripPlanRow[];
  subscriptions: PlanSubscription[];
  subscriptionPlans: { month: string; subscription_id: string; planned_cents: number }[];
  irregularBills: { id: string; subcategory_id: string | null }[];
  irregularBillPlans: { month: string; bill_id: string; planned_cents: number }[];
};

// Whether a subscription charges in a month (firstOfMonth = YYYY-MM-01).
export function subscriptionChargesIn(
  sub: Pick<PlanSubscription, "subcategory_id" | "is_active" | "next_renewal_date" | "billing_cycle">,
  firstOfMonth: string,
) {
  if (!sub.subcategory_id || !sub.is_active || !sub.next_renewal_date) return false;
  if (sub.billing_cycle === "monthly") return true;
  // next_renewal_date advances by a year after each charge, so compare
  // just the month number (annual subs always charge in the same month).
  if (sub.billing_cycle === "annual") return sub.next_renewal_date.slice(5, 7) === firstOfMonth.slice(5, 7);
  // quarterly / weekly: next_renewal_date is the exact next occurrence
  return sub.next_renewal_date.slice(0, 7) === firstOfMonth.slice(0, 7);
}

export function buildPlanResolver(inputs: PlanInputs) {
  const key = (id: string, month: string) => `${id}:${month}`;

  const manual = new Map(inputs.budgetPlans.map((p) => [key(p.subcategory_id, p.month), p.planned_cents]));
  const trips = tripPlanTotals(inputs.tripPlans);
  const subOverrides = new Map(inputs.subscriptionPlans.map((p) => [key(p.subscription_id, p.month), p.planned_cents]));
  const billPlans = new Map(inputs.irregularBillPlans.map((p) => [key(p.bill_id, p.month), p.planned_cents]));

  // What one subscription plans in one month: that month's own figure (a
  // subscription_plans row) when there is one, otherwise its amount in the
  // months it charges and $0 in the rest. The override covers an off-cycle
  // charge, and it also holds a past month's old price — a price change
  // freezes the previous price into earlier months (updateSubscriptionAmount)
  // so lowering Disney in September doesn't rewrite August's plan.
  const subscriptionPlannedFor = (sub: PlanSubscription, firstOfMonth: string) =>
    subOverrides.get(key(sub.id, firstOfMonth)) ??
    (subscriptionChargesIn(sub, firstOfMonth) ? sub.amount_cents : 0);

  const subsBySub = new Map<string, PlanSubscription[]>();
  for (const s of inputs.subscriptions) {
    if (s.subcategory_id) subsBySub.set(s.subcategory_id, [...(subsBySub.get(s.subcategory_id) ?? []), s]);
  }
  const billsBySub = new Map<string, string[]>();
  for (const b of inputs.irregularBills) {
    if (b.subcategory_id) billsBySub.set(b.subcategory_id, [...(billsBySub.get(b.subcategory_id) ?? []), b.id]);
  }

  /** Subscriptions' total for the item, or undefined when it isn't driven by them this month. */
  const subscriptionTotalFor = (subId: string, firstOfMonth: string) => {
    const total = (subsBySub.get(subId) ?? []).reduce((sum, s) => sum + subscriptionPlannedFor(s, firstOfMonth), 0);
    return total > 0 ? total : undefined;
  };

  /** Irregular Bills' total for the item, or undefined in a month with no per-bill plans. */
  const irregularTotalFor = (subId: string, firstOfMonth: string) => {
    const planned = (billsBySub.get(subId) ?? [])
      .map((billId) => billPlans.get(key(billId, firstOfMonth)))
      .filter((c): c is number => c !== undefined);
    return planned.length ? planned.reduce((sum, c) => sum + c, 0) : undefined;
  };

  const manualFor = (subId: string, firstOfMonth: string) => manual.get(key(subId, firstOfMonth));
  const tripFor = (subId: string, firstOfMonth: string) => trips.get(key(subId, firstOfMonth)) ?? 0;

  const plannedFor = (subId: string, firstOfMonth: string) =>
    irregularTotalFor(subId, firstOfMonth) ??
    subscriptionTotalFor(subId, firstOfMonth) ??
    manualFor(subId, firstOfMonth) ??
    tripFor(subId, firstOfMonth);

  return { plannedFor, subscriptionPlannedFor, subscriptionTotalFor, irregularTotalFor, manualFor, tripFor };
}

export type PlanResolver = ReturnType<typeof buildPlanResolver>;

/**
 * Everything buildPlanResolver needs for the given months, in one parallel
 * batch. The Budget page fetches these alongside its own reads instead, to
 * keep its single round trip.
 */
export async function fetchPlanInputs(
  supabase: SupabaseClient,
  householdId: string,
  months: string[],
): Promise<PlanInputs> {
  const [
    { data: budgetPlans, error: budgetPlansError },
    tripPlans,
    { data: subscriptions, error: subscriptionsError },
    { data: subscriptionPlans, error: subscriptionPlansError },
    { data: irregularBills, error: irregularBillsError },
    { data: irregularBillPlans, error: irregularBillPlansError },
  ] = await Promise.all([
    supabase.from("budget_plans").select("month, subcategory_id, planned_cents").eq("household_id", householdId).in("month", months),
    fetchTripPlans(supabase, householdId, { months }),
    // Inactive ones too: a month's own override still counts after a cancel.
    supabase.from("subscriptions").select("id, subcategory_id, is_active, next_renewal_date, billing_cycle, amount_cents").eq("household_id", householdId),
    supabase.from("subscription_plans").select("month, subscription_id, planned_cents").eq("household_id", householdId).in("month", months),
    supabase.from("irregular_bills").select("id, subcategory_id").eq("household_id", householdId),
    supabase.from("irregular_bill_plans").select("month, bill_id, planned_cents").eq("household_id", householdId).in("month", months),
  ]);
  throwIfAny({ budgetPlans: budgetPlansError, subscriptions: subscriptionsError, subscriptionPlans: subscriptionPlansError, irregularBills: irregularBillsError, irregularBillPlans: irregularBillPlansError });
  return {
    budgetPlans: budgetPlans ?? [],
    tripPlans,
    subscriptions: subscriptions ?? [],
    subscriptionPlans: subscriptionPlans ?? [],
    irregularBills: irregularBills ?? [],
    irregularBillPlans: irregularBillPlans ?? [],
  };
}
