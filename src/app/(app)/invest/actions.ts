"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { adjustBucketBalance } from "@/lib/buckets";
import { captureSnapshots } from "@/lib/snapshots";

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

// Store (or override) one investment account's contributed / accrued for a year.
// Writing a row "locks in" that year — the /invest page shows the stored value
// (plus live current-year transactions) instead of the live-derived one alone.
// When bucketId is passed, the row is bucket-level (Fidelity → Roth IRA Vic);
// otherwise it's account-level.
export async function setInvestmentYear(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();

  const accountId = String(formData.get("accountId") ?? "");
  const bucketIdRaw = String(formData.get("bucketId") ?? "");
  const bucketId = bucketIdRaw && bucketIdRaw !== "null" ? bucketIdRaw : null;
  const year = Number(formData.get("year"));
  const field = String(formData.get("field") ?? "");
  if (!accountId || !Number.isInteger(year) || year < 2000 || year > 2100) return;
  if (!["contributed", "accrued", "start", "end"].includes(field)) return;

  const valueCents = displayToCents(String(formData.get("value") ?? "0"));

  // Confirm the account belongs to this household before writing.
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!account) return;

  // If a bucket was passed, confirm it belongs to this account.
  if (bucketId) {
    const { data: bucket } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketId)
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .maybeSingle();
    if (!bucket) return;
  }

  // Preserve sibling columns when a row already exists for this bucket slot.
  // Two partial unique indexes back this — one for bucket_id IS NULL and one
  // for bucket_id IS NOT NULL — so a plain upsert can't target both. Instead
  // we select first, then update (by id) or insert.
  let existingQuery = supabase
    .from("investment_years")
    .select("id, contributed_cents, accrued_cents, est_contribute_cents, start_cents, end_cents")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .eq("year", year);
  existingQuery = bucketId
    ? existingQuery.eq("bucket_id", bucketId)
    : existingQuery.is("bucket_id", null);
  const { data: existing } = await existingQuery.maybeSingle();

  const patch = {
    contributed_cents:
      field === "contributed" ? valueCents : existing?.contributed_cents ?? 0,
    accrued_cents: field === "accrued" ? valueCents : existing?.accrued_cents ?? 0,
    est_contribute_cents: existing?.est_contribute_cents ?? 0,
    start_cents: field === "start" ? valueCents : (existing?.start_cents ?? null),
    end_cents: field === "end" ? valueCents : (existing?.end_cents ?? null),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase.from("investment_years").update(patch).eq("id", existing.id);
  } else {
    await supabase.from("investment_years").insert({
      household_id: householdId,
      account_id: accountId,
      bucket_id: bucketId,
      year,
      ...patch,
    });
  }

  revalidatePath("/invest");
}

// Transfer money from an investment account (optionally a specific bucket)
// into a banking account. Creates a withdrawal transaction for the audit
// trail, adjusts both account balances, and captures snapshots.
export async function transferFromInvestment(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();

  const sourceAccountId = String(formData.get("sourceAccountId") ?? "");
  const sourceBucketId = String(formData.get("sourceBucketId") ?? "").trim() || null;
  const destAccountId = String(formData.get("destAccountId") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const occurredOn = String(formData.get("date") ?? "");
  const memo = String(formData.get("memo") ?? "").trim() || null;
  if (!sourceAccountId || !destAccountId || !occurredOn || amountCents <= 0) return;

  // Validate source is an investment account in this household.
  const { data: srcAcct } = await supabase
    .from("accounts")
    .select("id, kind")
    .eq("id", sourceAccountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!srcAcct || srcAcct.kind !== "investment") return;

  // Validate destination is a non-investment account in this household.
  const { data: destAcct } = await supabase
    .from("accounts")
    .select("id, kind, current_balance_cents")
    .eq("id", destAccountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!destAcct || destAcct.kind === "investment") return;

  // Validate bucket belongs to the source account (when provided).
  let validBucketId: string | null = null;
  if (sourceBucketId) {
    const { data: bucket } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", sourceBucketId)
      .eq("account_id", sourceAccountId)
      .eq("household_id", householdId)
      .maybeSingle();
    validBucketId = bucket?.id ?? null;
  }

  // 1. Create an audit transaction: withdrawal from the investment account,
  //    paid_to the destination banking account (mirrors the card-payment pattern).
  await supabase.from("transactions").insert({
    household_id: householdId,
    occurred_on: occurredOn,
    amount_cents: amountCents,
    account_id: sourceAccountId,
    bucket_id: validBucketId,
    paid_to_account_id: destAccountId,
    is_withdrawal: true,
    memo: memo ?? `Transfer to ${destAcct.kind === "checking" || destAcct.kind === "savings_bucket" ? "banking" : "account"}`,
    source: "manual",
  });

  // 2. Decrement the investment side.
  if (validBucketId) {
    await adjustBucketBalance(supabase, householdId, validBucketId, -amountCents);
  } else {
    // No bucket — adjust the account balance directly.
    const { data: acctBal } = await supabase
      .from("accounts")
      .select("current_balance_cents")
      .eq("id", sourceAccountId)
      .single();
    await supabase
      .from("accounts")
      .update({
        current_balance_cents: (acctBal?.current_balance_cents ?? 0) - amountCents,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sourceAccountId)
      .eq("household_id", householdId);
  }

  // 3. Increment the destination banking account.
  await supabase
    .from("accounts")
    .update({
      current_balance_cents: (destAcct.current_balance_cents ?? 0) + amountCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", destAccountId)
    .eq("household_id", householdId);

  // 4. Snapshot & revalidate.
  await captureSnapshots(supabase, householdId);
  revalidatePath("/invest");
  revalidatePath("/accounts");
  revalidatePath("/networth");
  revalidatePath("/transactions");
}
