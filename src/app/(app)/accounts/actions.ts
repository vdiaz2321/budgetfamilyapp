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
  // Net Worth mirrors account names/grouping in its grid.
  revalidatePath("/networth");
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

  const { data: maxRow } = await supabase
    .from("accounts")
    .select("sort_order")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  // Banking accounts get their Checking/Savings badge set immediately from
  // the type picked in the add form, instead of staying null until someone
  // opens Edit — that gap made the badge look like it needed a Holder value
  // to "unlock" it, when the two were unrelated.
  const bankGroup =
    kind === "savings_bucket" ? "savings" : kind === "checking" ? "spending" : null;

  const { error } = await supabase.from("accounts").insert({
    household_id: householdId,
    name,
    kind,
    holder,
    subtype,
    is_kids_account: isKidsAccount,
    include_net_worth: !isKidsAccount,
    current_balance_cents: balanceCents,
    sort_order: sortOrder,
    bank_group: bankGroup,
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

  // Only the Banking edit form submits bankGroup; leave it untouched otherwise.
  const update: Record<string, unknown> = {
    name,
    holder,
    subtype,
    is_kids_account: isKidsAccount,
    include_net_worth: !isKidsAccount,
    active,
    updated_at: new Date().toISOString(),
  };
  if (formData.has("bankGroup")) {
    const bankGroup = String(formData.get("bankGroup") ?? "");
    update.bank_group = bankGroup === "savings" ? "savings" : "spending";
  }

  await supabase
    .from("accounts")
    .update(update)
    .eq("id", id)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId);
  revalidate();
}

// Rename-only, for inline editing from the Net Worth grid — unlike
// updateAccount, this never touches holder/subtype/active/kidsAccount, so a
// quick rename there can't accidentally clear those fields.
export async function renameAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  await supabase
    .from("accounts")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);

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

// Persist a manual drag/arrow reorder of a section's accounts. `orderedIds` is
// that section's account ids in their new top-to-bottom order — only those
// rows' sort_order changes, so other sections are untouched.
export async function reorderAccounts(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const orderedIds = JSON.parse(String(formData.get("orderedIds") ?? "[]")) as string[];
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { error: null };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from("accounts")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("household_id", householdId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { error: `Couldn't save the new order — ${failed.error.message}` };
  }

  revalidate();
  return { error: null };
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
  const bankGroupRaw = String(formData.get("bankGroup") ?? "");
  const bankGroup = bankGroupRaw === "savings" || bankGroupRaw === "spending" ? bankGroupRaw : null;
  if (!accountId) return { error: "Missing account." };
  if (!name) return { error: "Bucket name is required." };

  const { data: maxRow } = await supabase
    .from("buckets")
    .select("sort_order")
    .eq("account_id", accountId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("buckets").insert({
    household_id: householdId,
    account_id: accountId,
    name,
    balance_cents: balanceCents,
    sort_order: sortOrder,
    bank_group: bankGroup,
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

// Persist a manual reorder of one account's buckets — `orderedIds` is that
// account's bucket ids in their new top-to-bottom order.
export async function reorderBuckets(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const orderedIds = JSON.parse(String(formData.get("orderedIds") ?? "[]")) as string[];
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { error: null };

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from("buckets")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("household_id", householdId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { error: `Couldn't save the new order — ${failed.error.message}` };
  }

  revalidate();
  return { error: null };
}

// Lets one bucket carry its own Checking/Savings tag — e.g. an account with
// both a "Checking" and a "Savings" bucket no longer has to force the whole
// account into one type.
export async function updateBucketBankGroup(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const bankGroupRaw = String(formData.get("bankGroup") ?? "");
  const bankGroup = bankGroupRaw === "savings" || bankGroupRaw === "spending" ? bankGroupRaw : null;

  await supabase
    .from("buckets")
    .update({ bank_group: bankGroup, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("household_id", householdId);

  revalidate();
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
