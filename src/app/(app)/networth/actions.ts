"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { currentMonthFirst } from "@/lib/snapshots";
import { syncAccountFromBuckets } from "@/lib/buckets";

const MONTH_RE = /^\d{4}-\d{2}-01$/;

async function requireHousehold() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  return { supabase, householdId: profile.household_id };
}

// The grid edits history, so the Net Worth page revalidates. Current-month edits
// also touch live balances, so Accounts + the sidebar layout need it too.
function revalidate() {
  revalidatePath("/networth");
  revalidatePath("/accounts");
  revalidatePath("/", "layout");
}

// Recompute one month's parent account_snapshots row from that month's bucket
// snapshots — the historical analogue of syncAccountFromBuckets (which only
// touches the live balance). Keeps a bucketed account's column equal to the sum
// of its buckets in every past month, not just the current one.
async function syncAccountSnapshotFromBuckets(
  supabase: SupabaseClient,
  householdId: string,
  accountId: string,
  month: string,
) {
  const { data: account } = await supabase
    .from("accounts")
    .select("kind")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!account) return;

  const { data: snaps } = await supabase
    .from("bucket_snapshots")
    .select("balance_cents")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .eq("month", month);
  const sum = (snaps ?? []).reduce((s, b) => s + (b.balance_cents ?? 0), 0);

  await supabase.from("account_snapshots").upsert(
    {
      household_id: householdId,
      month,
      account_id: accountId,
      kind: account.kind,
      balance_cents: sum,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,account_id" },
  );
}

// Set one account's balance for one month. Editing the CURRENT month also writes
// the live balance, so the Accounts page stays in sync and captureSnapshots
// re-derives the same value on its next run (no clobber). Editing a PAST month is
// a pure history correction — the live balance is left alone.
export async function setAccountSnapshot(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const accountId = String(formData.get("accountId") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!accountId || !MONTH_RE.test(month)) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));

  const { data: account } = await supabase
    .from("accounts")
    .select("kind")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!account) return;

  await supabase.from("account_snapshots").upsert(
    {
      household_id: householdId,
      month,
      account_id: accountId,
      kind: account.kind,
      balance_cents: balanceCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,account_id" },
  );

  if (month === currentMonthFirst()) {
    await supabase
      .from("accounts")
      .update({ current_balance_cents: balanceCents, updated_at: new Date().toISOString() })
      .eq("id", accountId)
      .eq("household_id", householdId);
  }

  revalidate();
}

// Set one bucket's balance for one month, then re-derive that month's parent
// account total from all its bucket snapshots. Current-month edits also update
// the live bucket balance (and its parent), matching the Accounts page.
export async function setBucketSnapshot(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const bucketId = String(formData.get("bucketId") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!bucketId || !MONTH_RE.test(month)) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));

  const { data: bucket } = await supabase
    .from("buckets")
    .select("account_id")
    .eq("id", bucketId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!bucket) return;

  await supabase.from("bucket_snapshots").upsert(
    {
      household_id: householdId,
      month,
      bucket_id: bucketId,
      account_id: bucket.account_id,
      balance_cents: balanceCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,bucket_id" },
  );

  await syncAccountSnapshotFromBuckets(supabase, householdId, bucket.account_id, month);

  if (month === currentMonthFirst()) {
    await supabase
      .from("buckets")
      .update({ balance_cents: balanceCents, updated_at: new Date().toISOString() })
      .eq("id", bucketId)
      .eq("household_id", householdId);
    await syncAccountFromBuckets(supabase, householdId, bucket.account_id);
  }

  revalidate();
}

// Section-level totals for a month that predates per-account tracking. Used only
// as a fallback for months with no account_snapshots (see networth/page.tsx).
export async function setNetworthHistory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? "");
  if (!MONTH_RE.test(month)) return { error: "Pick a valid month." };
  if (month > currentMonthFirst()) return { error: "Historical months only — no future months." };

  const row = {
    household_id: householdId,
    month,
    savings_cents: displayToCents(String(formData.get("savings") ?? "0")),
    bank_cents: displayToCents(String(formData.get("bank") ?? "0")),
    stocks_cents: displayToCents(String(formData.get("stocks") ?? "0")),
    debt_cents: displayToCents(String(formData.get("debt") ?? "0")),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("networth_history")
    .upsert(row, { onConflict: "household_id,month" });
  if (error) return { error: "Couldn't save that — please try again." };

  revalidatePath("/networth");
  return { error: null };
}

// Saves a single year-end (December) net worth total to networth_history.
// For years where only the total is known (no section breakdown), the full
// amount is stored in bank_cents so net = bank_cents = total.
export async function upsertNetworthYear(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const year = Number(formData.get("year"));
  const nowYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1990 || year >= nowYear) {
    return { error: "Enter a valid past year." };
  }
  const totalCents = displayToCents(String(formData.get("total") ?? "0"));
  const month = `${year}-12-01`;

  const { error } = await supabase
    .from("networth_history")
    .upsert(
      {
        household_id: householdId,
        month,
        bank_cents: totalCents,
        savings_cents: 0,
        stocks_cents: 0,
        debt_cents: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id,month" },
    );
  if (error) return { error: "Couldn't save — try again." };

  revalidatePath("/networth");
  return { error: null };
}

export async function deleteNetworthHistory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? "");
  if (!MONTH_RE.test(month)) return;

  await supabase
    .from("networth_history")
    .delete()
    .eq("household_id", householdId)
    .eq("month", month);

  revalidatePath("/networth");
}
