import type { SupabaseClient } from "@supabase/supabase-js";

// First day of the current month as YYYY-MM-01 (local time).
export function currentMonthFirst(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

// Upsert this month's snapshot rows from live balances. Idempotent — safe to
// call on every balance change and every Networth load. Prior months are never
// touched, so they freeze into history once the month rolls over.
//
// This coexists with the Net Worth grid's per-month editing (networth/actions.ts):
// a current-month grid edit also writes the live balance, so the value re-derived
// here matches what was typed (no clobber); past-month grid edits touch only the
// snapshot row, which this never overwrites.
export async function captureSnapshots(
  supabase: SupabaseClient,
  householdId: string,
): Promise<void> {
  const month = currentMonthFirst();
  const now = new Date().toISOString();

  const [{ data: accounts }, { data: debts }, { data: buckets }] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, kind, current_balance_cents")
      .eq("household_id", householdId)
      .eq("active", true),
    supabase
      .from("debts")
      .select("subcategory_id, current_balance_cents")
      .eq("household_id", householdId),
    supabase
      .from("buckets")
      .select("id, account_id, balance_cents")
      .eq("household_id", householdId),
  ]);

  if (accounts?.length) {
    await supabase.from("account_snapshots").upsert(
      accounts.map((a) => ({
        household_id: householdId,
        month,
        account_id: a.id,
        kind: a.kind,
        balance_cents: a.current_balance_cents ?? 0,
        updated_at: now,
      })),
      { onConflict: "household_id,month,account_id" },
    );
  }

  if (debts?.length) {
    await supabase.from("debt_snapshots").upsert(
      debts.map((d) => ({
        household_id: householdId,
        month,
        subcategory_id: d.subcategory_id,
        balance_cents: d.current_balance_cents ?? 0,
        updated_at: now,
      })),
      { onConflict: "household_id,month,subcategory_id" },
    );
  }

  if (buckets?.length) {
    await supabase.from("bucket_snapshots").upsert(
      buckets.map((b) => ({
        household_id: householdId,
        month,
        bucket_id: b.id,
        account_id: b.account_id,
        balance_cents: b.balance_cents ?? 0,
        updated_at: now,
      })),
      { onConflict: "household_id,month,bucket_id" },
    );
  }
}
