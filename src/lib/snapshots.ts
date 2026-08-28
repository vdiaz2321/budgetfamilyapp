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
  options: { force?: boolean } = {},
): Promise<void> {
  const month = currentMonthFirst();
  const now = new Date().toISOString();

  // Fast path: skip the seven queries + three upserts if a fresh snapshot for
  // this month already exists. Only PAGE LOADS may take it — every mutation
  // passes { force: true }, because a second edit inside the 5-minute window
  // would otherwise be skipped and leave the month's snapshot showing the
  // balance from before it. That is exactly what happened when TSP's two
  // buckets were re-typed back to back: the buckets and the account's live
  // balance moved to $61,742 while the AUG snapshot stayed at $59,346, which
  // is the figure the Accounts column reads. Page visits after that just re-render
  // whatever's in the snapshot rows — no need to rewrite them on every load.
  // A 5-minute window is long enough to collapse rapid navigation and short
  // enough that month-rollover always captures on the first visit.
  if (!options.force) {
    const { data: fresh } = await supabase
      .from("account_snapshots")
      .select("updated_at")
      .eq("household_id", householdId)
      .eq("month", month)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fresh?.updated_at) {
      const ageMs = Date.now() - new Date(fresh.updated_at).getTime();
      if (ageMs < 5 * 60 * 1000) return;
    }
  }

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
