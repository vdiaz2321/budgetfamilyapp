"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { captureSnapshots } from "@/lib/snapshots";
import { syncAccountFromBuckets, syncAllBucketedAccounts } from "@/lib/buckets";

// Kinds the UI lets you create — asset accounts only. Debts (credit cards /
// loans) live in the Budget Debt group and flow to Net Worth + Snowball from
// there, so they're never entered here (single source of truth).
const ALLOWED_KINDS = ["checking", "savings_bucket", "investment"];

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

function revalidate() {
  revalidatePath("/accounts");
  // The transaction modal's account dropdown lives on /budget.
  revalidatePath("/budget");
  // The sidebar's account totals live in the shared (app) layout.
  revalidatePath("/", "layout");
}

export { syncAllBucketedAccounts };

export async function addAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const holder = String(formData.get("holder") ?? "").trim() || null;
  const subtype = String(formData.get("subtype") ?? "").trim() || null;
  const isKidsAccount = formData.get("kidsAccount") === "on";
  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));
  if (!name) return { error: "Account name is required." };
  if (!ALLOWED_KINDS.includes(kind)) return { error: "Invalid account type." };

  const { error } = await supabase.from("accounts").insert({
    household_id: householdId,
    name,
    kind,
    holder,
    subtype,
    is_kids_account: isKidsAccount,
    include_net_worth: !isKidsAccount,
    current_balance_cents: balanceCents,
  });

  if (error) {
    return {
      error: error.code === "23505"
        ? `You already have an account named "${name}". Pick a different name.`
        : "Couldn't save that account — please try again.",
    };
  }

  await captureSnapshots(supabase, householdId);
  revalidate();
  return { error: null };
}

export async function updateAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const holder = String(formData.get("holder") ?? "").trim() || null;
  const subtype = String(formData.get("subtype") ?? "").trim() || null;
  const isKidsAccount = formData.get("kidsAccount") === "on";
  const active = formData.get("active") === "on";
  if (!id || !name) return;

  await supabase
    .from("accounts")
    .update({
      name,
      holder,
      subtype,
      is_kids_account: isKidsAccount,
      include_net_worth: !isKidsAccount,
      active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId);
  revalidate();
}

export async function updateBalance(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));

  await supabase
    .from("accounts")
    .update({ current_balance_cents: balanceCents, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId);
  revalidate();
}

export async function deleteAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // transactions.account_id is ON DELETE SET NULL, so past transactions keep
  // their history — they just lose the account link. buckets/bucket_snapshots
  // cascade-delete with the account.
  await supabase
    .from("accounts")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  revalidate();
}

// ---- Buckets: virtual sinking funds inside one account (Amex Savings case) ----

export async function addBucket(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const accountId = String(formData.get("accountId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));
  if (!accountId) return { error: "Missing account." };
  if (!name) return { error: "Bucket name is required." };

  const { error } = await supabase.from("buckets").insert({
    household_id: householdId,
    account_id: accountId,
    name,
    balance_cents: balanceCents,
  });

  if (error) {
    return {
      error: error.code === "23505"
        ? `This account already has a bucket named "${name}". Pick a different name.`
        : "Couldn't save that bucket — please try again.",
    };
  }

  await syncAccountFromBuckets(supabase, householdId, accountId);
  await captureSnapshots(supabase, householdId);
  revalidate();
  return { error: null };
}

export async function updateBucket(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { error: "Bucket name is required." };

  const { error } = await supabase
    .from("buckets")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);

  if (error) {
    return {
      error: error.code === "23505"
        ? `This account already has a bucket named "${name}". Pick a different name.`
        : "Couldn't rename that bucket — please try again.",
    };
  }

  revalidate();
  return { error: null };
}

export async function updateBucketBalance(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));

  const { data: bucket } = await supabase
    .from("buckets")
    .update({ balance_cents: balanceCents, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId)
    .select("account_id")
    .single();

  if (bucket) await syncAccountFromBuckets(supabase, householdId, bucket.account_id);
  await captureSnapshots(supabase, householdId);
  revalidate();
}

export async function deleteBucket(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { data: bucket } = await supabase
    .from("buckets")
    .select("account_id")
    .eq("id", id)
    .eq("household_id", householdId)
    .single();

  // bucket_snapshots cascade-delete with the bucket.
  await supabase
    .from("buckets")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  if (bucket) await syncAccountFromBuckets(supabase, householdId, bucket.account_id);
  await captureSnapshots(supabase, householdId);
  revalidate();
}
