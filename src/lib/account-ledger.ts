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
  // Every error below is thrown rather than swallowed. Returning false on a
  // failed read looked identical to "this account is manual by design", so the
  // transaction saved and the balance silently never moved.
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, kind, current_balance_cents")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (accountError) throw new Error(`Could not read the account: ${accountError.message}`);
  if (!account || account.kind === "investment") return false;

  // This one was worse than a no-op: a failed count read as `null`, which is
  // falsy, so a BUCKETED account fell through to the direct write below — the
  // second competing source of truth this helper exists to prevent.
  const { count, error: countError } = await supabase
    .from("buckets")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (countError) throw new Error(`Could not check the account's buckets: ${countError.message}`);
  if (count) return false;

  const { error: updateError } = await supabase
    .from("accounts")
    .update({
      current_balance_cents: (account.current_balance_cents ?? 0) + deltaCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("household_id", householdId);
  if (updateError) throw new Error(`Could not update the account balance: ${updateError.message}`);

  return true;
}

// Income adds to the account; every other category kind (bills, expenses,
// debt, savings) spends out of it — matches the +/- shown on the
// transactions table (which keys off category kind, not is_withdrawal).
export async function categoryKindOf(
  supabase: SupabaseClient,
  categoryId: string,
): Promise<string | null> {
  // A failed read used to return null, and ledgerDelta below reads null as an
  // outflow — so a blip flipped the sign of an income transaction against the
  // account balance.
  const { data, error } = await supabase.from("categories").select("kind").eq("id", categoryId).maybeSingle();
  if (error) throw new Error(`Could not read the category kind: ${error.message}`);
  return data?.kind ?? null;
}

export function ledgerDelta(kind: string | null, amountCents: number): number {
  return kind === "income" ? amountCents : -amountCents;
}
