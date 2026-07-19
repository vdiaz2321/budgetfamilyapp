import type { SupabaseClient } from "@supabase/supabase-js";

// A plain checking/savings/credit account with no buckets works as a running
// ledger: transactions posted to it move the balance directly, same as a
// real bank statement. Two kinds stay manual instead:
//  - investment accounts (market swings mean the balance is reconciled by
//    hand at month/year end, not derived from contributions), and
//  - bucketed accounts (their total is always the sum of their buckets, per
//    syncAccountFromBuckets — never a second, competing source of truth).
// Returns whether the balance was actually adjusted.
export async function adjustAccountLedger(
  supabase: SupabaseClient,
  householdId: string,
  accountId: string,
  deltaCents: number,
): Promise<boolean> {
  const { data: account } = await supabase
    .from("accounts")
    .select("id, kind, current_balance_cents")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!account || account.kind === "investment") return false;

  const { count } = await supabase
    .from("buckets")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (count) return false;

  await supabase
    .from("accounts")
    .update({
      current_balance_cents: (account.current_balance_cents ?? 0) + deltaCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("household_id", householdId);

  return true;
}

// Income adds to the account; every other category kind (bills, expenses,
// debt, savings) spends out of it — matches the +/- shown on the
// transactions table (which keys off category kind, not is_withdrawal).
export async function categoryKindOf(
  supabase: SupabaseClient,
  categoryId: string,
): Promise<string | null> {
  const { data } = await supabase.from("categories").select("kind").eq("id", categoryId).maybeSingle();
  return data?.kind ?? null;
}

export function ledgerDelta(kind: string | null, amountCents: number): number {
  return kind === "income" ? amountCents : -amountCents;
}
