"use server";

import { getSessionContext } from "@/lib/auth-context";
import { investItemsFrom } from "@/lib/invest-items";
import { throwIfAny } from "@/lib/supabase-result";
import type { MoveAccount } from "./move-money";

// Move Money's lists for a page that doesn't already hold every account
// (Transactions). Loaded in the background once the page is up, so it adds
// nothing to the page's own load.
export async function loadMoveMoneyOptions() {
  const { supabase, household } = await getSessionContext();
  const [
    { data: accountRows, error: accountsError },
    { data: bucketRows, error: bucketsError },
    { data: subRows, error: subsError },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, kind, active, is_kids_account, current_balance_cents")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, balance_cents")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("subcategories")
      .select("id, name, active, linked_bucket_id, linked_account_id, categories(kind)")
      .eq("household_id", household.id)
      .order("sort_order"),
  ]);
  throwIfAny({ accounts: accountsError, buckets: bucketsError, subcategories: subsError });

  const accounts: MoveAccount[] = (accountRows ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    active: a.active !== false,
    isKidsAccount: a.is_kids_account ?? false,
    balanceCents: a.current_balance_cents ?? 0,
    buckets: (bucketRows ?? [])
      .filter((b) => b.account_id === a.id)
      .map((b) => ({ id: b.id, name: b.name, balanceCents: b.balance_cents ?? 0 })),
  }));
  return {
    accounts,
    investItems: investItemsFrom(subRows ?? [], bucketRows ?? []),
    currency: household.currency,
  };
}
