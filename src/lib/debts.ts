import type { SupabaseClient } from "@supabase/supabase-js";

// Adjusts a debt's outstanding balance, keyed by its Budget subcategory. A
// logged payment passes a negative delta so the balance drops (pay more →
// balance falls further → the Snowball payoff date moves in); undoing/deleting
// that payment passes the positive amount back. No-op when the subcategory
// isn't a debt, so callers can fire it for every transaction without checking
// first (mirrors adjustBucketBalance in lib/buckets). Returns whether a debt
// was actually touched, so the caller can decide to recapture net-worth
// snapshots. Balance is intentionally left un-clamped (it can dip below zero on
// an over-payment) so the effect is exactly reversible — the UI clamps the
// displayed value at zero instead.
export async function adjustDebtBalance(
  supabase: SupabaseClient,
  householdId: string,
  subcategoryId: string,
  deltaCents: number,
): Promise<boolean> {
  if (!subcategoryId) return false;

  const { data: debt } = await supabase
    .from("debts")
    .select("current_balance_cents")
    .eq("subcategory_id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!debt) return false;

  await supabase
    .from("debts")
    .update({ current_balance_cents: (debt.current_balance_cents ?? 0) + deltaCents })
    .eq("subcategory_id", subcategoryId)
    .eq("household_id", householdId);

  return true;
}
