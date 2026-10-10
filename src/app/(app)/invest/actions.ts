"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { adjustBucketBalance } from "@/lib/buckets";
import { adjustAccountLedger } from "@/lib/account-ledger";
import { captureSnapshots } from "@/lib/snapshots";
import { unwrap } from "@/lib/supabase-result";

async function requireHousehold() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  // A failed read is not "this user has no household" — redirecting on it
  // would drop a signed-in user into onboarding and invite a second household.
  if (profileError) throw new Error(`Could not load your profile: ${profileError.message}`);
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
  const account = unwrap(
    await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "accounts",
  );
  if (!account) return;

  // If a bucket was passed, confirm it belongs to this account.
  if (bucketId) {
    const bucket = unwrap(
      await supabase
        .from("buckets")
        .select("id")
        .eq("id", bucketId)
        .eq("account_id", accountId)
        .eq("household_id", householdId)
        .maybeSingle(),
      "buckets",
    );
    if (!bucket) return;
  }

  // Preserve sibling columns when a row already exists for this bucket slot.
  // Two partial unique indexes back this — one for bucket_id IS NULL and one
  // for bucket_id IS NOT NULL — so a plain upsert can't target both. Instead
  // we select first, then update (by id) or insert.
  let existingQuery = supabase
    .from("investment_years")
    .select("id, contributed_cents, accrued_cents, accrued_manual, est_contribute_cents, start_cents, end_cents")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .eq("year", year);
  existingQuery = bucketId
    ? existingQuery.eq("bucket_id", bucketId)
    : existingQuery.is("bucket_id", null);
  // `patch` carries every sibling column forward from this read, so losing it
  // would blank contributed/accrued/est/start/end for that year instead of
  // editing the one field the user changed.
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw new Error(`Could not read the existing year: ${existingError.message}`);

  const patch = {
    contributed_cents:
      field === "contributed" ? valueCents : existing?.contributed_cents ?? 0,
    accrued_cents: field === "accrued" ? valueCents : existing?.accrued_cents ?? 0,
    // Typing a gains figure pins it — the automatic end − start − contributions
    // maths stops overwriting that year. Clearing it back to 0 hands the cell
    // back to the automatic number.
    accrued_manual:
      field === "accrued" ? valueCents !== 0 : existing?.accrued_manual ?? false,
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

// Transfer money out of an investment account into a banking account — the
// one withdrawal flow, used by both Invest / Savings and the Accounts Transfer
// popup. Creates the audit transaction, moves both balances and captures
// snapshots so Net Worth follows.
//
// Either side that has buckets must name one: a bucketed account's balance is
// the sum of its buckets, so writing the account total directly would leave
// the two disagreeing (the same rule the bank-to-bank transfer enforces).
export async function transferFromInvestment(formData: FormData): Promise<{ error: string | null }> {
  const { supabase, householdId } = await requireHousehold();

  const sourceAccountId = String(formData.get("sourceAccountId") ?? "");
  const sourceBucketId = String(formData.get("sourceBucketId") ?? "").trim() || null;
  const destAccountId = String(formData.get("destAccountId") ?? "");
  const destBucketId = String(formData.get("destBucketId") ?? "").trim() || null;
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const occurredOn = String(formData.get("date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const memo = String(formData.get("memo") ?? "").trim() || null;
  if (!sourceAccountId || !destAccountId) return { error: "Pick both accounts." };
  if (amountCents <= 0) return { error: "Enter an amount." };

  const [srcAcct, destAcct, buckets] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, kind, name")
      .eq("id", sourceAccountId)
      .eq("household_id", householdId)
      .maybeSingle()
      .then((r) => unwrap(r, "accounts")),
    supabase
      .from("accounts")
      .select("id, kind, name")
      .eq("id", destAccountId)
      .eq("household_id", householdId)
      .maybeSingle()
      .then((r) => unwrap(r, "accounts")),
    supabase
      .from("buckets")
      .select("id, account_id")
      .eq("household_id", householdId)
      .in("account_id", [sourceAccountId, destAccountId])
      .then((r) => unwrap(r, "buckets") ?? []),
  ]);
  if (!srcAcct || srcAcct.kind !== "investment") return { error: "Pick an investment account to take the money from." };
  if (!destAcct || destAcct.kind === "investment" || destAcct.kind === "credit_card") {
    return { error: "Pick a banking account to send the money to." };
  }

  const srcBuckets = buckets.filter((b) => b.account_id === sourceAccountId);
  const destBuckets = buckets.filter((b) => b.account_id === destAccountId);
  if (srcBuckets.length > 0 && !sourceBucketId) return { error: `Pick which ${srcAcct.name} bucket the money comes from.` };
  if (sourceBucketId && !srcBuckets.some((b) => b.id === sourceBucketId)) {
    return { error: "That bucket isn't part of the source account." };
  }
  if (destBuckets.length > 0 && !destBucketId) return { error: `Pick which ${destAcct.name} bucket the money goes into.` };
  if (destBucketId && !destBuckets.some((b) => b.id === destBucketId)) {
    return { error: "That bucket isn't part of the destination account." };
  }

  // 1. The audit transaction: a withdrawal from the investment, paid to the
  //    banking account (and bucket) — what Transactions lists and what a
  //    delete reverses.
  const { error: insertError } = await supabase.from("transactions").insert({
    household_id: householdId,
    occurred_on: occurredOn,
    amount_cents: amountCents,
    account_id: sourceAccountId,
    bucket_id: sourceBucketId,
    paid_to_account_id: destAccountId,
    paid_to_bucket_id: destBucketId,
    movement_type: "investment_transfer",
    is_withdrawal: true,
    memo: memo ?? `Transfer to ${destAcct.name}`,
    source: "manual",
  });
  if (insertError) return { error: `Couldn't save the transfer — ${insertError.message}` };

  // 2. Take it off the investment side.
  if (sourceBucketId) {
    await adjustBucketBalance(supabase, householdId, sourceBucketId, -amountCents);
  } else {
    await adjustInvestmentAccount(supabase, householdId, sourceAccountId, -amountCents);
  }

  // 3. Put it on the banking side — the bucket when it has them, else the
  //    account ledger.
  if (destBucketId) {
    await adjustBucketBalance(supabase, householdId, destBucketId, amountCents);
  } else {
    await adjustAccountLedger(supabase, householdId, destAccountId, amountCents);
  }

  // 4. Snapshot & revalidate.
  await captureSnapshots(supabase, householdId, { force: true });
  revalidatePath("/invest");
  revalidatePath("/accounts");
  revalidatePath("/networth");
  revalidatePath("/transactions");
  return { error: null };
}

// An investment account with no buckets: adjustAccountLedger refuses
// investments by design (their balances are hand-reconciled), so the balance
// is moved here. Read-modify-write: a lost read would persist `0 + delta` over
// the real balance, so a failed read throws.
async function adjustInvestmentAccount(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  accountId: string,
  deltaCents: number,
) {
  const { data, error } = await supabase
    .from("accounts")
    .select("current_balance_cents")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .single();
  if (error) throw new Error(`Could not read the account balance: ${error.message}`);
  const { error: updateError } = await supabase
    .from("accounts")
    .update({ current_balance_cents: (data?.current_balance_cents ?? 0) + deltaCents, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("household_id", householdId);
  if (updateError) throw new Error(`Could not update the account balance: ${updateError.message}`);
}
