import type { SupabaseClient } from "@supabase/supabase-js";

// Once an account has buckets, its top-level balance is always the sum of
// its buckets — never entered directly — so the two can never drift apart.
export async function syncAccountFromBuckets(
  supabase: SupabaseClient,
  householdId: string,
  accountId: string,
) {
  const { data: buckets } = await supabase
    .from("buckets")
    .select("balance_cents")
    .eq("account_id", accountId);
  if (!buckets || buckets.length === 0) return;

  const sum = buckets.reduce((s, b) => s + (b.balance_cents ?? 0), 0);
  await supabase
    .from("accounts")
    .update({ current_balance_cents: sum, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("household_id", householdId);
}

// Self-heals every account whose stored balance has drifted from its
// buckets' sum. Cheap enough to run on every Accounts page load.
export async function syncAllBucketedAccounts(
  supabase: SupabaseClient,
  householdId: string,
) {
  const [{ data: accounts }, { data: buckets }] = await Promise.all([
    supabase.from("accounts").select("id, current_balance_cents").eq("household_id", householdId),
    supabase.from("buckets").select("account_id, balance_cents").eq("household_id", householdId),
  ]);
  if (!accounts || !buckets || buckets.length === 0) return;

  const sums = new Map<string, number>();
  for (const b of buckets) {
    sums.set(b.account_id, (sums.get(b.account_id) ?? 0) + (b.balance_cents ?? 0));
  }

  const stale = accounts.filter(
    (a) => sums.has(a.id) && sums.get(a.id) !== a.current_balance_cents,
  );
  if (stale.length === 0) return;

  await Promise.all(
    stale.map((a) =>
      supabase
        .from("accounts")
        .update({ current_balance_cents: sums.get(a.id), updated_at: new Date().toISOString() })
        .eq("id", a.id)
        .eq("household_id", householdId),
    ),
  );
}

// Adds (or, with a negative delta, subtracts) cents from one bucket, then
// re-syncs its parent account total. No-op if the bucket isn't in this
// household. Used by Budget contributions/withdrawals against a linked
// bucket, and by direct bucket-balance edits on the Accounts page.
export async function adjustBucketBalance(
  supabase: SupabaseClient,
  householdId: string,
  bucketId: string,
  deltaCents: number,
) {
  const { data: bucket } = await supabase
    .from("buckets")
    .select("id, account_id, balance_cents")
    .eq("id", bucketId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!bucket) return;

  await supabase
    .from("buckets")
    .update({
      balance_cents: (bucket.balance_cents ?? 0) + deltaCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bucket.id);

  await syncAccountFromBuckets(supabase, householdId, bucket.account_id);
}
