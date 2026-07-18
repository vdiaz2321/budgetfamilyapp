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
    .select("current_balance_cents, paid_off_at")
    .eq("subcategory_id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!debt) return false;

  const newBalance = (debt.current_balance_cents ?? 0) + deltaCents;
  // Stamp the payoff date the moment the balance first reaches $0, and clear
  // it if a payment gets undone and the balance rises back above $0 — keeps
  // it in sync with whatever the balance actually is right now.
  const paidOffAt =
    newBalance <= 0 ? debt.paid_off_at ?? new Date().toISOString().slice(0, 10) : null;

  await supabase
    .from("debts")
    .update({ current_balance_cents: newBalance, paid_off_at: paidOffAt })
    .eq("subcategory_id", subcategoryId)
    .eq("household_id", householdId);

  return true;
}
