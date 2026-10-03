"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionContext } from "@/lib/auth-context";
import { displayToCents } from "@/lib/money";
import { captureSnapshots, currentMonthFirst } from "@/lib/snapshots";
import { syncAccountFromBuckets } from "@/lib/buckets";
import { unwrap } from "@/lib/supabase-result";

// Month-end update (Accounts → "Month-end update").
//
// Saving a value for the CURRENT month is the same as typing it into the
// Accounts row: it moves the live balance. Saving (or ticking) it for LAST
// month writes that month's snapshot and carries the value forward into this
// month too — unless this month's row is already ticked done, so a finished
// value is never overwritten. That carry-forward is the fix for Oct 2026, when
// Sep values typed on Oct 1 left October still showing August's.
//
// The carry keeps whatever this month has already done: the live balance is
// set to last month's new close PLUS the movement since the old close (live −
// old snapshot). Overwriting it outright would wipe an October contribution
// logged before the September statement was typed in.

const MONTH_RE = /^\d{4}-\d{2}-01$/;

function monthBefore(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function revalidate() {
  revalidatePath("/accounts");
  revalidatePath("/networth");
  revalidatePath("/invest");
  revalidatePath("/", "layout");
}

// Re-sum one month's account snapshot from its bucket snapshots.
async function resumAccountSnapshot(
  supabase: SupabaseClient,
  householdId: string,
  accountId: string,
  kind: string,
  month: string,
) {
  const { data: snaps, error } = await supabase
    .from("bucket_snapshots")
    .select("balance_cents")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .eq("month", month);
  if (error) throw new Error(`Could not read bucket snapshots: ${error.message}`);
  const sum = (snaps ?? []).reduce((s, b) => s + (b.balance_cents ?? 0), 0);
  const { error: upsertError } = await supabase.from("account_snapshots").upsert(
    { household_id: householdId, month, account_id: accountId, kind, balance_cents: sum, updated_at: new Date().toISOString() },
    { onConflict: "household_id,month,account_id" },
  );
  if (upsertError) throw new Error(`Could not save the account total: ${upsertError.message}`);
}

// A month's recorded close for one account or bucket, before it is replaced.
async function snapshotCents(
  supabase: SupabaseClient,
  householdId: string,
  month: string,
  target: { accountId?: string; bucketId?: string },
): Promise<number | null> {
  const q = target.bucketId
    ? supabase.from("bucket_snapshots").select("balance_cents").eq("bucket_id", target.bucketId)
    : supabase.from("account_snapshots").select("balance_cents").eq("account_id", target.accountId!);
  const { data, error } = await q.eq("household_id", householdId).eq("month", month).maybeSingle();
  if (error) throw new Error(`Could not read the month's balance: ${error.message}`);
  return data?.balance_cents ?? null;
}

// Is this row already ticked done for `month`?
async function isTicked(
  supabase: SupabaseClient,
  householdId: string,
  month: string,
  target: { accountId: string; bucketId: string | null },
): Promise<boolean> {
  let q = supabase
    .from("month_end_checks")
    .select("id")
    .eq("household_id", householdId)
    .eq("month", month);
  q = target.bucketId ? q.eq("bucket_id", target.bucketId) : q.eq("account_id", target.accountId);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(`Could not read checkmarks: ${error.message}`);
  return (data ?? []).length > 0;
}

async function tick(
  supabase: SupabaseClient,
  householdId: string,
  month: string,
  target: { accountId: string | null; bucketId: string | null },
) {
  const { error } = await supabase.from("month_end_checks").insert({
    household_id: householdId,
    month,
    account_id: target.bucketId ? null : target.accountId,
    bucket_id: target.bucketId,
  });
  // 23505 = already ticked; that's the state we wanted.
  if (error && error.code !== "23505") throw new Error(`Could not save the checkmark: ${error.message}`);
}

/** Save one account's (or bucket's) balance for `month` and tick it done. */
export async function saveMonthEndValue(input: {
  month: string;
  accountId: string;
  bucketId: string | null;
  balance: string;
}): Promise<{ error: string | null }> {
  const { supabase, household } = await getSessionContext();
  const householdId = household.id;
  const { month, accountId, bucketId } = input;
  const current = currentMonthFirst();
  if (!MONTH_RE.test(month) || month > current) return { error: "Pick this month or last month." };
  const balanceCents = displayToCents(input.balance);
  const now = new Date().toISOString();

  const account = unwrap(
    await supabase
      .from("accounts")
      .select("id, kind, current_balance_cents")
      .eq("id", accountId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "accounts",
  );
  if (!account) return { error: "Account not found." };

  if (bucketId) {
    const bucket = unwrap(
      await supabase
        .from("buckets")
        .select("id, balance_cents")
        .eq("id", bucketId)
        .eq("account_id", accountId)
        .eq("household_id", householdId)
        .maybeSingle(),
      "buckets",
    );
    if (!bucket) return { error: "Bucket not found." };

    let moveLive = month === current;
    let liveCents = balanceCents;
    if (month < current) {
      const oldClose = await snapshotCents(supabase, householdId, month, { bucketId });
      if (oldClose != null) liveCents = balanceCents + ((bucket.balance_cents ?? 0) - oldClose);
      const { error } = await supabase.from("bucket_snapshots").upsert(
        { household_id: householdId, month, bucket_id: bucketId, account_id: accountId, balance_cents: balanceCents, updated_at: now },
        { onConflict: "household_id,month,bucket_id" },
      );
      if (error) return { error: error.message };
      await resumAccountSnapshot(supabase, householdId, accountId, account.kind, month);
      // Carry forward from last month unless this month is already ticked done.
      moveLive =
        month === monthBefore(current) && !(await isTicked(supabase, householdId, current, { accountId, bucketId }));
    }
    if (moveLive) {
      const { error } = await supabase
        .from("buckets")
        .update({ balance_cents: liveCents, updated_at: now })
        .eq("id", bucketId)
        .eq("household_id", householdId);
      if (error) return { error: error.message };
      await syncAccountFromBuckets(supabase, householdId, accountId);
      await captureSnapshots(supabase, householdId, { force: true });
    }
  } else {
    let moveLive = month === current;
    let liveCents = balanceCents;
    if (month < current) {
      const oldClose = await snapshotCents(supabase, householdId, month, { accountId });
      if (oldClose != null) liveCents = balanceCents + ((account.current_balance_cents ?? 0) - oldClose);
      const { error } = await supabase.from("account_snapshots").upsert(
        { household_id: householdId, month, account_id: accountId, kind: account.kind, balance_cents: balanceCents, updated_at: now },
        { onConflict: "household_id,month,account_id" },
      );
      if (error) return { error: error.message };
      moveLive =
        month === monthBefore(current) && !(await isTicked(supabase, householdId, current, { accountId, bucketId: null }));
    }
    if (moveLive) {
      const { error } = await supabase
        .from("accounts")
        .update({ current_balance_cents: liveCents, updated_at: now })
        .eq("id", accountId)
        .eq("household_id", householdId);
      if (error) return { error: error.message };
      await captureSnapshots(supabase, householdId, { force: true });
    }
  }

  // A typed balance, for this month or last month's close: either way the
  // figure was just checked, which is what "updated … days ago" reports.
  const { error: stampError } = bucketId
    ? await supabase.from("buckets").update({ balance_updated_at: now }).eq("id", bucketId).eq("household_id", householdId)
    : await supabase.from("accounts").update({ balance_updated_at: now }).eq("id", accountId).eq("household_id", householdId);
  if (stampError) return { error: stampError.message };

  await tick(supabase, householdId, month, { accountId, bucketId });
  revalidate();
  return { error: null };
}

/** Clear a row's checkmark (the balance is left as it is). */
export async function clearMonthEndCheck(input: {
  month: string;
  accountId: string;
  bucketId: string | null;
}): Promise<{ error: string | null }> {
  const { supabase, household } = await getSessionContext();
  if (!MONTH_RE.test(input.month)) return { error: "Bad month." };
  let q = supabase.from("month_end_checks").delete().eq("household_id", household.id).eq("month", input.month);
  q = input.bucketId ? q.eq("bucket_id", input.bucketId) : q.eq("account_id", input.accountId);
  const { error } = await q;
  if (error) return { error: error.message };
  revalidatePath("/accounts");
  return { error: null };
}
