import type { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase-result";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Trip plans on the Budget (view v_trip_budget_plans): a future trip's
 * Planned figures, counted on Restaurant Travel / Traveling/Trips in the month
 * the trip starts. They are ADDED to the item's budget_plans row, which holds
 * only what was typed on the Budget on top of the trips. Every page that
 * shows a planned amount reads this beside budget_plans so they all agree.
 */
export type TripPlanRow = {
  month: string; // YYYY-MM-01
  subcategory_id: string;
  trip_id: string;
  trip_name: string;
  planned_cents: number;
};

export async function fetchTripPlans(
  supabase: SupabaseClient,
  householdId: string,
  range: { from: string; to: string } | { months: string[] },
): Promise<TripPlanRow[]> {
  let query = supabase
    .from("v_trip_budget_plans")
    .select("month, subcategory_id, trip_id, trip_name, planned_cents")
    .eq("household_id", householdId);
  query = "months" in range ? query.in("month", range.months) : query.gte("month", range.from).lte("month", range.to);
  const rows = unwrap(await query, "trip plans") ?? [];
  return rows.map((r) => ({ ...r, planned_cents: Number(r.planned_cents) }));
}

/** Trip plan per "<subcategoryId>:<month>". */
export function tripPlanTotals(rows: TripPlanRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.subcategory_id}:${r.month}`;
    totals.set(key, (totals.get(key) ?? 0) + r.planned_cents);
  }
  return totals;
}
