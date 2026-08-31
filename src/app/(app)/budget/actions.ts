"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents, moneyExpressionToCents } from "@/lib/money";
import { captureSnapshots } from "@/lib/snapshots";
import { resolvePayeeId } from "@/lib/payees";
import { adjustBucketBalance } from "@/lib/buckets";
import { adjustDebtBalance } from "@/lib/debts";
import { saveDebt } from "@/lib/save-debt";
import { adjustAccountLedger, categoryKindOf, ledgerDelta } from "@/lib/account-ledger";
import { unwrap } from "@/lib/supabase-result";

// The bucket a Savings subcategory contributes to, if any linked — null when
// not a savings item or not linked, so callers can skip the bucket math.
async function getLinkedBucketId(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  subcategoryId: string,
): Promise<string | null> {
  const data = unwrap(
    await supabase
      .from("subcategories")
      .select("linked_bucket_id")
      .eq("id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "subcategories",
  );
  return data?.linked_bucket_id ?? null;
}

// Same, but for the direct-account link used by Savings items pointing at a
// bare investment account (TSP, M1, Charles Schwab, …) with no buckets.
async function getLinkedAccountId(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  subcategoryId: string,
): Promise<string | null> {
  const data = unwrap(
    await supabase
      .from("subcategories")
      .select("linked_account_id")
      .eq("id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "subcategories",
  );
  return (data as { linked_account_id?: string | null } | null)?.linked_account_id ?? null;
}

// Move an investment account's balance directly (contributions/withdrawals
// from a linked savings sub). Bypasses the usual "investment accounts are
// hand-reconciled" guard in adjustAccountLedger because the user opted in by
// linking. Still refuses if the account has buckets — those are the source
// of truth for their parent.
async function adjustLinkedAccountBalance(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  accountId: string,
  deltaCents: number,
): Promise<boolean> {
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, current_balance_cents")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (accountError) throw new Error(`Could not read the linked account: ${accountError.message}`);
  if (!account) return false;

  // A failed count is falsy, which would let a bucketed account fall through
  // to the direct balance write below — same trap as adjustAccountLedger.
  const { count, error: countError } = await supabase
    .from("buckets")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (countError) throw new Error(`Could not check the account's buckets: ${countError.message}`);
  if (count) return false;

  await supabase
    .from("accounts")
    .update({
      current_balance_cents: (account.current_balance_cents ?? 0) + deltaCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("household_id", householdId);
  return true;
}

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

const CUSTOM_GROUP_KINDS = new Set(["bills", "expenses", "savings"]);

// Payee autocomplete list, fetched on demand instead of shipped with every
// budget page render — the full list is ~28KB of RSC payload for a control
// most page loads never open. Read-only, so no revalidate.
export async function listPayees(): Promise<{ id: string; name: string }[]> {
  const { supabase, householdId } = await requireHousehold();
  const data = unwrap(
    await supabase
      .from("payees")
      .select("id, name")
      .eq("household_id", householdId),
    "payees",
  );
  return data ?? [];
}


export async function addCategoryGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  if (!name) return { error: "Enter a group name." };
  if (!CUSTOM_GROUP_KINDS.has(kind)) return { error: "Choose Bills, Expenses, or Savings." };

  const last = unwrap(
    await supabase
      .from("categories")
      .select("sort_order")
      .eq("household_id", householdId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "categories",
  );

  const { error } = await supabase.from("categories").insert({
    household_id: householdId,
    name,
    kind,
    sort_order: (last?.sort_order ?? -1) + 1,
    is_system: false,
  });
  if (error) {
    if (error.code === "23505") return { error: "A group with that name already exists." };
    return { error: "The group could not be created." };
  }

  revalidatePath("/budget");
  revalidatePath("/annual");
  return {};
}

export async function renameCategoryGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { error: "Enter a group name." };

  // System groups rename too. `kind` is what every query keys off — the name is
  // a label, so "Savings" can read "Invest/Savings" without changing behaviour.
  // The old `.eq("is_system", false)` guard matched zero rows for those groups
  // and returned no error, so the modal reported success and changed nothing.
  const { data: renamed, error } = await supabase
    .from("categories")
    .update({ name })
    .eq("id", id)
    .eq("household_id", householdId)
    .select("id");
  if (error?.code === "23505") return { error: "A group with that name already exists." };
  if (error) return { error: "The group could not be renamed." };
  if (!renamed?.length) return { error: "That group no longer exists." };

  revalidatePath("/budget");
  revalidatePath("/annual");
  return {};
}

export async function moveCategoryGroup(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!id || !["up", "down"].includes(direction)) return;

  const target = unwrap(
    await supabase
      .from("categories")
      .select("id, is_system")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "categories",
  );
  if (!target || target.is_system) return;

  const categories = unwrap(
    await supabase
      .from("categories")
      .select("id")
      .eq("household_id", householdId)
      .order("sort_order")
      .order("name"),
    "categories",
  );
  const orderedIds = (categories ?? []).map((category) => category.id);
  const index = orderedIds.indexOf(id);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= orderedIds.length) return;
  [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[index]];

  await Promise.all(
    orderedIds.map((categoryId, sortOrder) =>
      supabase
        .from("categories")
        .update({ sort_order: sortOrder })
        .eq("id", categoryId)
        .eq("household_id", householdId),
    ),
  );
  revalidatePath("/budget");
  revalidatePath("/annual");
}

export async function deleteCategoryGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Group not found." };

  const { count } = await supabase
    .from("subcategories")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("category_id", id);
  if ((count ?? 0) > 0) return { error: "Move or delete the group’s items first." };

  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId)
    .eq("is_system", false);
  if (error) return { error: "The group could not be deleted." };

  revalidatePath("/budget");
  revalidatePath("/annual");
  return {};
}

// ---------- Planned amounts (per subcategory per month) ----------

/**
 * Move planned dollars from one budget item to another within a month.
 *
 * Covering an overspent category by taking the money from somewhere that has
 * room is the single most-used action in an envelope budget, and there was no
 * way to do it here — the only route was editing two Planned fields by hand and
 * remembering what the numbers had been.
 *
 * The two writes aren't wrapped in a transaction: PostgREST has no cross-call
 * transaction, and the failure mode is benign (the source keeps its money and
 * nothing is created from nothing). Guarding the source amount matters more,
 * and that is enforced below.
 */
export async function coverOverspend(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const fromSubId = String(formData.get("fromSubcategoryId") ?? "");
  const toSubId = String(formData.get("toSubcategoryId") ?? "");
  const month = String(formData.get("month") ?? "");
  const amountCents = moneyExpressionToCents(String(formData.get("amount") ?? "0"));

  if (!fromSubId || !toSubId || !month) return { error: "Missing details." };
  if (fromSubId === toSubId) return { error: "Pick a different category to move from." };
  if (amountCents <= 0) return { error: "Enter an amount above zero." };

  const plans = unwrap(
    await supabase
      .from("budget_plans")
      .select("subcategory_id, planned_cents")
      .eq("household_id", householdId)
      .eq("month", month)
      .in("subcategory_id", [fromSubId, toSubId]),
    "budget_plans",
  );

  const plannedOf = (id: string) =>
    (plans ?? []).find((p) => p.subcategory_id === id)?.planned_cents ?? 0;
  const fromPlanned = plannedOf(fromSubId);
  if (fromPlanned < amountCents) {
    return { error: "That category doesn't have enough planned to move." };
  }

  const now = new Date().toISOString();
  await supabase.from("budget_plans").upsert(
    { household_id: householdId, month, subcategory_id: fromSubId, planned_cents: fromPlanned - amountCents, updated_at: now },
    { onConflict: "household_id,month,subcategory_id" },
  );
  await supabase.from("budget_plans").upsert(
    { household_id: householdId, month, subcategory_id: toSubId, planned_cents: plannedOf(toSubId) + amountCents, updated_at: now },
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
  return {};
}

/**
 * Add to an item's planned amount, rather than replacing it.
 *
 * Used when assigning unallocated income from the hero card — the money has no
 * source category to come out of, so this is a one-sided increase rather than
 * the two-sided move that `coverOverspend` performs.
 */
export async function addToPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? "");
  const addCents = moneyExpressionToCents(String(formData.get("addAmount") ?? "0"));
  if (!subcategoryId || !month || addCents <= 0) return { error: "Missing details." };

  // This read is the base of the number written back, so a swallowed error
  // wouldn't add to the plan — it would REPLACE it with just `addCents`.
  const { data: existing, error: existingError } = await supabase
    .from("budget_plans")
    .select("planned_cents")
    .eq("household_id", householdId)
    .eq("month", month)
    .eq("subcategory_id", subcategoryId)
    .maybeSingle();
  if (existingError) return { error: "Couldn't read the current plan. Try again." };

  await supabase.from("budget_plans").upsert(
    {
      household_id: householdId,
      month,
      subcategory_id: subcategoryId,
      planned_cents: (existing?.planned_cents ?? 0) + addCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
  return {};
}

/**
 * Reduce an item's planned amount — the mirror of `addToPlan`.
 *
 * Used from the hero card when planned outflow exceeds income: the money isn't
 * moving anywhere in particular, it's just being un-budgeted, so this is a
 * one-sided decrease rather than the two-sided move `coverOverspend` performs.
 * Refuses to cut below zero or below what the item has already spent, which
 * would silently manufacture an overspent row.
 */
export async function trimFromPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? "");
  const trimCents = moneyExpressionToCents(String(formData.get("trimAmount") ?? "0"));
  if (!subcategoryId || !month || trimCents <= 0) return { error: "Missing details." };

  const existing = unwrap(
    await supabase
      .from("budget_plans")
      .select("planned_cents")
      .eq("household_id", householdId)
      .eq("month", month)
      .eq("subcategory_id", subcategoryId)
      .maybeSingle(),
    "budget_plans",
  );

  const planned = existing?.planned_cents ?? 0;
  if (planned < trimCents) return { error: "That item doesn't have that much planned." };

  const actual = unwrap(
    await supabase
      .from("v_monthly_actuals")
      .select("actual_cents")
      .eq("household_id", householdId)
      .eq("month", month)
      .eq("subcategory_id", subcategoryId)
      .maybeSingle(),
    "v_monthly_actuals",
  );

  const spent = actual?.actual_cents ?? 0;
  if (planned - trimCents < spent) {
    return { error: "That would drop the plan below what's already spent." };
  }

  await supabase.from("budget_plans").upsert(
    {
      household_id: householdId,
      month,
      subcategory_id: subcategoryId,
      planned_cents: planned - trimCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
  return {};
}

export async function upsertPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01
  if (!subcategoryId || !month) return;

  const plannedCents = moneyExpressionToCents(String(formData.get("planned") ?? "0"));

  await supabase.from("budget_plans").upsert(
    {
      household_id: householdId,
      month,
      subcategory_id: subcategoryId,
      planned_cents: plannedCents,
    },
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
}

// Move `amountCents` of planned budget from one subcategory to another for a
// given month. Both rows in budget_plans are updated atomically-ish (best effort
// — Supabase JS lacks true multi-row transactions from the client; we upsert in
// sequence and swallow no errors). Read the source's current planned amount,
// subtract, then upsert both.
export async function reassignPlanned(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const fromSubId = String(formData.get("fromSubId") ?? "");
  const toSubId = String(formData.get("toSubId") ?? "");
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01
  const amountCents = moneyExpressionToCents(String(formData.get("amount") ?? "0"));

  if (!fromSubId || !toSubId || !month || amountCents <= 0 || fromSubId === toSubId) {
    return { error: "Missing or invalid inputs" };
  }

  // Both plans are rewritten from this one read; losing it would zero the
  // source item and overwrite the destination with just the moved amount.
  const { data: existing, error: existingError } = await supabase
    .from("budget_plans")
    .select("subcategory_id, planned_cents")
    .eq("household_id", householdId)
    .eq("month", month)
    .in("subcategory_id", [fromSubId, toSubId]);
  if (existingError) return { error: "Couldn't read the current plans. Try again." };

  const fromPlan = existing?.find((r) => r.subcategory_id === fromSubId)?.planned_cents ?? 0;
  const toPlan = existing?.find((r) => r.subcategory_id === toSubId)?.planned_cents ?? 0;

  await supabase.from("budget_plans").upsert(
    [
      { household_id: householdId, month, subcategory_id: fromSubId, planned_cents: Math.max(0, fromPlan - amountCents) },
      { household_id: householdId, month, subcategory_id: toSubId, planned_cents: toPlan + amountCents },
    ],
    { onConflict: "household_id,month,subcategory_id" },
  );

  revalidatePath("/budget");
  return { ok: true };
}

// ---------- Subcategories (the budget rows) ----------

export async function reorderSubcategories(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const orderedIds = JSON.parse(String(formData.get("orderedIds") ?? "[]")) as string[];
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;

  await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from("subcategories")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("household_id", householdId),
    ),
  );
  revalidatePath("/budget");
}

export async function addSubcategory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const categoryId = String(formData.get("categoryId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!categoryId || !name) return;

  const rawDue = String(formData.get("dueDay") ?? "").trim();
  const dueDay = rawDue ? Math.min(31, Math.max(1, parseInt(rawDue, 10))) : null;
  const isRecurring = formData.get("isRecurring") === "on";

  const siblings = unwrap(
    await supabase
      .from("subcategories")
      .select("sort_order")
      .eq("household_id", householdId)
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: false })
      .limit(1),
    "subcategories",
  );

  const nextSort = (siblings?.[0]?.sort_order ?? -1) + 1;

  await supabase.from("subcategories").insert({
    household_id: householdId,
    category_id: categoryId,
    name,
    due_day: dueDay,
    sort_order: nextSort,
    is_recurring: isRecurring,
  });

  revalidatePath("/budget");
}

// Flip an existing item's recurring flag. Items created before this feature
// (Internet, Mobile, the paycheck deductions) all start false, so this is the
// only way to opt them in without re-creating them.
export async function setSubcategoryRecurring(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return;
  const isRecurring = formData.get("isRecurring") === "on";

  await supabase
    .from("subcategories")
    .update({ is_recurring: isRecurring })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);

  revalidatePath("/budget");
}

export async function moveSubcategoryToGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const targetCategoryId = String(formData.get("categoryId") ?? "");
  if (!subcategoryId || !targetCategoryId) return { error: "Choose a category group." };

  const subcategory = unwrap(
    await supabase
      .from("subcategories")
      .select("category_id")
      .eq("id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "subcategories",
  );
  if (!subcategory || subcategory.category_id === targetCategoryId) return {};

  const categories = unwrap(
    await supabase
      .from("categories")
      .select("id, kind")
      .eq("household_id", householdId)
      .in("id", [subcategory.category_id, targetCategoryId]),
    "categories",
  );
  const kindById = new Map((categories ?? []).map((category) => [category.id, category.kind]));
  if (!kindById.has(targetCategoryId) || kindById.get(subcategory.category_id) !== kindById.get(targetCategoryId)) {
    return { error: "Items can move only between groups of the same type." };
  }

  const last = unwrap(
    await supabase
      .from("subcategories")
      .select("sort_order")
      .eq("household_id", householdId)
      .eq("category_id", targetCategoryId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "subcategories",
  );

  const { error } = await supabase
    .from("subcategories")
    .update({ category_id: targetCategoryId, sort_order: (last?.sort_order ?? -1) + 1 })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);
  if (error?.code === "23505") return { error: "That group already has an item with this name." };
  if (error) return { error: "The item could not be moved." };

  revalidatePath("/budget");
  revalidatePath("/annual");
  return {};
}

// Creates one subcategory per non-empty pasted line, skipping names that
// already exist in that category (case-insensitive) — a paste-a-list
// accelerator for entering many items at once instead of one at a time.
export async function addSubcategoriesBulk(
  formData: FormData,
): Promise<{ added: number; skipped: number }> {
  const { supabase, householdId } = await requireHousehold();
  const categoryId = String(formData.get("categoryId") ?? "");
  const raw = String(formData.get("names") ?? "");
  const names = raw
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
  if (!categoryId || names.length === 0) return { added: 0, skipped: 0 };

  // This read is the duplicate check. Losing it makes every existing name look
  // new, and the bulk add then inserts a second copy of each one.
  const { data: existing, error: existingError } = await supabase
    .from("subcategories")
    .select("name, sort_order")
    .eq("household_id", householdId)
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: false });
  if (existingError) throw new Error(`Could not read existing items: ${existingError.message}`);

  const existingLower = new Set((existing ?? []).map((s) => s.name.toLowerCase()));
  let nextSort = (existing?.[0]?.sort_order ?? -1) + 1;

  const rows: { household_id: string; category_id: string; name: string; sort_order: number }[] = [];
  const seenThisBatch = new Set<string>();
  let skipped = 0;
  for (const name of names) {
    const key = name.toLowerCase();
    if (existingLower.has(key) || seenThisBatch.has(key)) {
      skipped++;
      continue;
    }
    seenThisBatch.add(key);
    rows.push({ household_id: householdId, category_id: categoryId, name, sort_order: nextSort++ });
  }

  if (rows.length > 0) {
    await supabase.from("subcategories").insert(rows);
  }

  revalidatePath("/budget");
  return { added: rows.length, skipped };
}

export async function updateSubcategory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  // Accept either "subcategoryId" (preferred — a hidden input named "id" in a
  // React 19 form breaks the form action, see PlannedForm) or "id" for older
  // callers like the inline rename form.
  const id = String(formData.get("subcategoryId") ?? formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const rawDue = String(formData.get("dueDay") ?? "").trim();
  const dueDay = rawDue === "" ? null : Math.min(31, Math.max(1, parseInt(rawDue, 10)));

  const update: { name: string; due_day: number | null; payment_account_id?: string | null } = { name, due_day: dueDay };
  // The small inline rename form does not carry this input. Only change the
  // payment link when the full item form submitted one.
  if (formData.has("paymentAccountId")) {
    const rawPaymentAccountId = String(formData.get("paymentAccountId") ?? "").trim();
    if (!rawPaymentAccountId) {
      update.payment_account_id = null;
    } else {
      const { data: account, error: accountError } = await supabase
        .from("accounts")
        .select("id")
        .eq("id", rawPaymentAccountId)
        .eq("household_id", householdId)
        .in("kind", ["checking", "savings_bucket", "cash", "credit_card"])
        .maybeSingle();
      // Falling back to null here would silently unlink the payment account
      // the user just picked, on what they think is a rename.
      if (accountError) throw new Error(`Could not verify the payment account: ${accountError.message}`);
      update.payment_account_id = account?.id ?? null;
    }
  }

  await supabase
    .from("subcategories")
    .update(update)
    .eq("id", id)
    .eq("household_id", householdId);

  // If this subcategory is bound to any active subscriptions, shift each
  // subscription's next_renewal_date to the new day-of-month. Without this
  // sync, the "Due this week" strip and the Subscriptions page keep showing
  // the old due date because they read next_renewal_date, not due_day.
  if (dueDay != null) {
    const subs = unwrap(
      await supabase
        .from("subscriptions")
        .select("id, next_renewal_date")
        .eq("household_id", householdId)
        .eq("subcategory_id", id),
      "subscriptions",
    );
    for (const sub of subs ?? []) {
      if (!sub.next_renewal_date) continue;
      const [y, m] = sub.next_renewal_date.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const day = Math.min(dueDay, lastDay);
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (iso === sub.next_renewal_date) continue;
      await supabase
        .from("subscriptions")
        .update({ next_renewal_date: iso, updated_at: new Date().toISOString() })
        .eq("id", sub.id)
        .eq("household_id", householdId);
    }
  }

  revalidatePath("/budget");
}

export async function deleteSubcategory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabase
    .from("subcategories")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  revalidatePath("/budget");
}

// ---------- Savings & sinking funds (detail panel) ----------

export async function upsertSavingsGoal(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return;

  const goalCents = displayToCents(String(formData.get("goal") ?? "0"));
  const startCents = displayToCents(String(formData.get("start") ?? "0"));
  const monthlyCents = displayToCents(String(formData.get("monthly") ?? "0"));
  const targetDate = String(formData.get("targetDate") ?? "").trim() || null;

  await supabase.from("savings_goals").upsert(
    {
      household_id: householdId,
      subcategory_id: subcategoryId,
      goal_cents: goalCents,
      start_cents: startCents,
      monthly_contribution_cents: monthlyCents,
      target_date: targetDate,
    },
    { onConflict: "household_id,subcategory_id" },
  );

  revalidatePath("/budget");
  revalidatePath("/invest");
}

// Links (or unlinks) a Savings item to a real bucket in Accounts. Once
// linked, transactions logged under this item add straight to the bucket's
// balance — no re-typing the contribution over on Accounts.
export async function updateSavingsLink(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return;

  // The form sends `linkTarget` — a plain UUID for a bucket, or
  // `account:<uuid>` for a bare investment account. Legacy callers may still
  // send `bucketId`; treat it as a bucket UUID.
  const raw = String(
    formData.get("linkTarget") ?? formData.get("bucketId") ?? "",
  ).trim();

  let bucketId: string | null = null;
  let accountId: string | null = null;

  if (raw.startsWith("account:")) {
    const candidate = raw.slice("account:".length);
    // Both branches feed the update below, which writes BOTH columns — so a
    // swallowed error unlinks the savings goal from its bucket/account and the
    // item just stops tracking, with no sign anything went wrong.
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", candidate)
      .eq("household_id", householdId)
      .maybeSingle();
    if (accountError) throw new Error(`Could not verify the account: ${accountError.message}`);
    accountId = account?.id ?? null;
  } else if (raw) {
    const { data: bucket, error: bucketError } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", raw)
      .eq("household_id", householdId)
      .maybeSingle();
    if (bucketError) throw new Error(`Could not verify the bucket: ${bucketError.message}`);
    bucketId = bucket?.id ?? null;
  }

  await supabase
    .from("subcategories")
    .update({ linked_bucket_id: bucketId, linked_account_id: accountId })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);

  revalidatePath("/budget");
  revalidatePath("/accounts");
}

// Combined save for the Savings panel: goal fields + bucket link in one
// action, so there's a single Save button instead of two.
export async function upsertSavingsGoalAndLink(formData: FormData) {
  await Promise.all([
    upsertSavingsGoal(formData),
    upsertPlan(formData),
    updateSavingsLink(formData),
  ]);
}

// ---------- Debt (detail panel) ----------

export async function upsertDebt(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return;

  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));
  const minPaymentCents = displayToCents(String(formData.get("minPayment") ?? "0"));
  const aprRaw = String(formData.get("apr") ?? "").trim();
  const apr = aprRaw === "" ? 0 : parseFloat(aprRaw);
  const rawDue = String(formData.get("dueDay") ?? "").trim();
  const dueDay = rawDue === "" ? null : Math.min(31, Math.max(1, parseInt(rawDue, 10)));
  const debtKind = String(formData.get("debtKind") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const promoAprEndsOn = String(formData.get("promoAprEndsOn") ?? "").trim() || null;

  // Linked account (only if it belongs to this household).
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  let accountId: string | null = null;
  if (accountIdRaw) {
    // Same reasoning as resolvePayeeId: a failed lookup used to collapse to
    // `null` and write an account-less row. Only a genuine "not in this
    // household" answer is allowed to null it out.
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    if (accountError) throw new Error(`Could not verify the account: ${accountError.message}`);
    accountId = account?.id ?? null;
  }

  // `paid_off_at` is stamped/cleared inside saveDebt, so a debt zeroed out here
  // still drops off the Snowball page next year without this action repeating
  // the rule.
  const existing = unwrap(
    await supabase
      .from("debts")
      .select("original_balance_cents")
      .eq("subcategory_id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle(),
    "debts",
  );
  // Seed the opening balance when the debt is first created here. Debts made
  // from Budget used to leave `original_balance_cents` at 0 forever — only the
  // Accounts editor set it — so Snowball's "principal paid" percentage was
  // measured against a zero baseline and reported progress that never happened.
  // An existing value is preserved: it's the historical opening balance and a
  // later balance edit must not overwrite it.
  const originalBalanceCents =
    existing?.original_balance_cents && existing.original_balance_cents > 0
      ? existing.original_balance_cents
      : balanceCents;

  // Single shared write path (lib/save-debt.ts). Fields this editor doesn't
  // manage — escrow, term, loan start, interest method, target payment — are
  // omitted and therefore preserved, instead of being blanked by a partial
  // upsert as they were before.
  await saveDebt(supabase, householdId, {
    subcategoryId,
    balanceCents,
    minPaymentCents,
    apr: Number.isNaN(apr) ? 0 : apr,
    originalBalanceCents,
    accountId,
    dueDay,
    debtKind,
    notes,
    promoAprEndsOn,
  });

  // Keep subcategories.due_day in sync — the budget row list badge and the
  // Rename form read from there, not from debts.due_day. Without this, the
  // due day set here silently didn't show up anywhere else.
  await supabase
    .from("subcategories")
    .update({ due_day: dueDay })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId, { force: true });
  revalidatePath("/budget");
}

// Combined save for the Debt panel: planned amount + debt details + optional
// linked bucket in one action, so there's a single Save button. The bucket
// link reuses subcategories.linked_bucket_id — the same column savings goals
// use — so `addTransaction` already routes payments through the right bucket
// via `getLinkedBucketId`.
export async function upsertDebtAndPlan(formData: FormData) {
  await upsertPlan(formData);
  await upsertDebt(formData);
  await updateSavingsLink(formData);
}

// ---------- Transactions (the Log, right rail) ----------

export async function addTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const occurredOn = String(formData.get("date") ?? "");
  const enteredCents = displayToCents(String(formData.get("amount") ?? "0"));
  const payeeName = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const bucketIdRaw = String(formData.get("bucketId") ?? "").trim();
  const isWithdrawal = formData.get("isWithdrawal") === "on";
  const isRefund = formData.get("isRefund") === "on";
  const cleared = formData.get("cleared") === "on";
  if (!subcategoryId || !occurredOn || enteredCents <= 0) return;
  // Refund posts as a negative amount on the same subcategory + account.
  // Everything downstream — v_monthly_actuals (sums), account ledger
  // (via ledgerDelta which multiplies by ±1 per kind), Annual Overview,
  // Insights — handles the sign naturally, so no other code has to know.
  const amountCents = isRefund ? -enteredCents : enteredCents;

  // Pull every subcategory field the rest of this action needs in ONE query
  // — the linked bucket/account ids and the category's kind (via FK join),
  // so the follow-up helpers below can read them from memory instead of
  // firing three more sequential lookups (each ~150ms from Frankfurt/EU).
  const sub = unwrap(
    await supabase
      .from("subcategories")
      .select("category_id, name, linked_bucket_id, linked_account_id, categories(kind)")
      .eq("id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle<{
        category_id: string;
        name: string;
        linked_bucket_id: string | null;
        linked_account_id: string | null;
        categories: { kind: string } | null;
      }>(),
    "subcategories",
  );
  if (!sub) return;

  // Case-insensitive: "aldi" reuses the existing "Aldi" rather than creating a
  // second payee that then splits the shop's totals on the Annual Overview.
  const payeeId = payeeName ? await resolvePayeeId(supabase, householdId, payeeName) : null;

  // Only attach the account if it belongs to this household.
  let accountId: string | null = null;
  if (accountIdRaw) {
    // Same reasoning as resolvePayeeId: a failed lookup used to collapse to
    // `null` and write an account-less row. Only a genuine "not in this
    // household" answer is allowed to null it out.
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    if (accountError) throw new Error(`Could not verify the account: ${accountError.message}`);
    accountId = account?.id ?? null;
  }

  // Choosing the shared Irregular Bills budget item is intentionally enough to
  // start tracking a one-off bill. The entered payee becomes a managed detail
  // row automatically, while its transaction still posts to the single Bills
  // subcategory that Budget and Annual Overview already use.
  if (sub.name.toLowerCase() === "irregular bills" && payeeName) {
    const existingBill = unwrap(
      await supabase
        .from("irregular_bills")
        .select("id")
        .eq("household_id", householdId)
        .eq("subcategory_id", subcategoryId)
        .ilike("name", payeeName)
        .maybeSingle(),
      "irregular_bills",
    );
    if (!existingBill) {
      const lastBill = unwrap(
        await supabase
          .from("irregular_bills")
          .select("sort_order")
          .eq("household_id", householdId)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "irregular_bills",
      );
      await supabase.from("irregular_bills").insert({
        household_id: householdId,
        name: payeeName,
        typical_amount_cents: amountCents,
        subcategory_id: subcategoryId,
        account_id: accountId,
        sort_order: (lastBill?.sort_order ?? 0) + 1,
      });
    }
  }

  // Optional direct bucket attribution (investment sub-accounts like
  // Fidelity → Roth IRA Vic). Only valid when the bucket belongs to the
  // account we just verified. Distinct from the subcategory.linked_bucket_id
  // path used by savings goals below.
  let directBucketId: string | null = null;
  if (bucketIdRaw && accountId) {
    const { data: b, error: bucketError } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketIdRaw)
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .maybeSingle();
    if (bucketError) throw new Error(`Could not verify the bucket: ${bucketError.message}`);
    directBucketId = b?.id ?? null;
  }

  await supabase.from("transactions").insert({
    household_id: householdId,
    occurred_on: occurredOn,
    amount_cents: amountCents,
    category_id: sub.category_id,
    subcategory_id: subcategoryId,
    payee_id: payeeId,
    account_id: accountId,
    bucket_id: directBucketId,
    memo,
    is_withdrawal: isWithdrawal,
    cleared,
    source: "manual",
  });

  // A contribution adds to the linked bucket; a withdrawal (e.g. using the
  // Real Estate bucket for a down payment) subtracts from it instead. All
  // of these ids come from the enriched sub select above — no extra queries.
  // Refunds are skipped: they only affect the source account + monthly
  // spend actuals; touching a savings bucket or a debt principal on a refund
  // would double-count.
  const bucketId = sub.linked_bucket_id;
  if (!isRefund && bucketId) {
    await adjustBucketBalance(supabase, householdId, bucketId, isWithdrawal ? -amountCents : amountCents);
    await captureSnapshots(supabase, householdId, { force: true });
  }

  // Direct-bucket attribution (investment sub-account). adjustBucketBalance
  // also rolls the parent account total via syncAccountFromBuckets.
  if (!isRefund && directBucketId && directBucketId !== bucketId) {
    await adjustBucketBalance(supabase, householdId, directBucketId, isWithdrawal ? -amountCents : amountCents);
    await captureSnapshots(supabase, householdId, { force: true });
  }

  // Bare investment account link (TSP, M1, …) — contribution posts straight
  // to the account balance. Only fires when there's no linked bucket.
  if (!isRefund && !bucketId && sub.linked_account_id) {
    await adjustLinkedAccountBalance(supabase, householdId, sub.linked_account_id, isWithdrawal ? -amountCents : amountCents);
    await captureSnapshots(supabase, householdId, { force: true });
  }

  // A payment logged against a debt lowers its outstanding balance.
  const touchedDebt = !isRefund
    ? await adjustDebtBalance(supabase, householdId, subcategoryId, -amountCents)
    : false;
  if (touchedDebt) {
    await captureSnapshots(supabase, householdId, { force: true });
    revalidatePath("/snowball");
  }

  // Post to the chosen account's running ledger (income adds, everything
  // else spends out) — skipped for investment/bucketed accounts, which stay
  // manual. Kind comes from the sub's joined category, no extra query.
  if (accountId) {
    if (await adjustAccountLedger(supabase, householdId, accountId, ledgerDelta(sub.categories?.kind ?? null, amountCents))) {
      await captureSnapshots(supabase, householdId, { force: true });
    }
  }

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/annual");
  revalidatePath("/invest");
}

export async function updateTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const occurredOn = String(formData.get("date") ?? "");
  const enteredCents = displayToCents(String(formData.get("amount") ?? "0"));
  const payeeName = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const bucketIdRaw = String(formData.get("bucketId") ?? "").trim();
  const isWithdrawal = formData.get("isWithdrawal") === "on";
  const isRefund = formData.get("isRefund") === "on";
  if (!id || !subcategoryId || !occurredOn || enteredCents <= 0) return;
  // Refund posts as negative on the same sub/account; toggling the pill
  // off restores a positive spend. Bucket/debt side-effects are skipped in
  // both directions so we never double-count.
  const amountCents = isRefund ? -enteredCents : enteredCents;

  // Snapshot the pre-edit values so we can undo their bucket effect below —
  // the old subcategory/amount/direction may differ from the new ones. Pull
  // the linked bucket/account ids for the OLD subcategory in the same round
  // trip via FK join, so the undo path doesn't need extra lookups.
  const prevTx = unwrap(
    await supabase
      .from("transactions")
      .select(
        "subcategory_id, category_id, account_id, bucket_id, amount_cents, is_withdrawal, subcategories(linked_bucket_id, linked_account_id), categories(kind)",
      )
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle<{
        subcategory_id: string;
        category_id: string;
        account_id: string | null;
        bucket_id: string | null;
        amount_cents: number;
        is_withdrawal: boolean;
        subcategories: { linked_bucket_id: string | null; linked_account_id: string | null } | null;
        categories: { kind: string } | null;
      }>(),
    "transactions",
  );

  // New subcategory's category + link ids + kind, all in one query. The rest
  // of this action reads these fields from memory instead of firing three
  // more sequential lookups (getLinkedBucketId, getLinkedAccountId,
  // categoryKindOf) as it used to — the biggest source of save latency.
  const sub = unwrap(
    await supabase
      .from("subcategories")
      .select("category_id, linked_bucket_id, linked_account_id, categories(kind)")
      .eq("id", subcategoryId)
      .eq("household_id", householdId)
      .maybeSingle<{
        category_id: string;
        linked_bucket_id: string | null;
        linked_account_id: string | null;
        categories: { kind: string } | null;
      }>(),
    "subcategories",
  );
  if (!sub) return;
  const prevLinkedBucketId = prevTx?.subcategories?.linked_bucket_id ?? null;
  const prevLinkedAccountId = prevTx?.subcategories?.linked_account_id ?? null;
  const prevKind = prevTx?.categories?.kind ?? null;
  // A previous refund was stored as a negative amount, and we deliberately
  // never wrote to its bucket or debt at add time (see addTransaction). Skip
  // the undo of those side effects here so we don't credit balances that
  // were never debited.
  const wasRefund = (prevTx?.amount_cents ?? 0) < 0;

  // Case-insensitive: "aldi" reuses the existing "Aldi" rather than creating a
  // second payee that then splits the shop's totals on the Annual Overview.
  const payeeId = payeeName ? await resolvePayeeId(supabase, householdId, payeeName) : null;

  let accountId: string | null = null;
  if (accountIdRaw) {
    // Same reasoning as resolvePayeeId: a failed lookup used to collapse to
    // `null` and write an account-less row. Only a genuine "not in this
    // household" answer is allowed to null it out.
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    if (accountError) throw new Error(`Could not verify the account: ${accountError.message}`);
    accountId = account?.id ?? null;
  }

  let directBucketId: string | null = null;
  if (bucketIdRaw && accountId) {
    const { data: b, error: bucketError } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketIdRaw)
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .maybeSingle();
    if (bucketError) throw new Error(`Could not verify the bucket: ${bucketError.message}`);
    directBucketId = b?.id ?? null;
  }

  await supabase
    .from("transactions")
    .update({
      occurred_on: occurredOn,
      amount_cents: amountCents,
      category_id: sub.category_id,
      subcategory_id: subcategoryId,
      payee_id: payeeId,
      account_id: accountId,
      bucket_id: directBucketId,
      memo,
      is_withdrawal: isWithdrawal,
    })
    .eq("id", id)
    .eq("household_id", householdId);

  // Undo the old transaction's bucket effect (it may have hit a different
  // bucket, or none at all), then apply the new one's. All linked-id lookups
  // come from the enriched selects above — no extra round trips. Refunds
  // (both the previous and new sides) skip bucket/debt writes entirely.
  let touchedBucket = false;
  if (prevTx && !wasRefund) {
    if (prevLinkedBucketId) {
      const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
      await adjustBucketBalance(supabase, householdId, prevLinkedBucketId, undoDelta);
      touchedBucket = true;
    }
    // Undo previous direct-bucket attribution (investment sub-account).
    if (prevTx.bucket_id && prevTx.bucket_id !== prevLinkedBucketId) {
      const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
      await adjustBucketBalance(supabase, householdId, prevTx.bucket_id, undoDelta);
      touchedBucket = true;
    }
  }
  const bucketId = sub.linked_bucket_id;
  if (!isRefund && bucketId) {
    await adjustBucketBalance(supabase, householdId, bucketId, isWithdrawal ? -amountCents : amountCents);
    touchedBucket = true;
  }
  // Apply new direct-bucket attribution.
  if (!isRefund && directBucketId && directBucketId !== bucketId) {
    await adjustBucketBalance(supabase, householdId, directBucketId, isWithdrawal ? -amountCents : amountCents);
    touchedBucket = true;
  }

  // Bare-account link (TSP/M1/…) — same undo-then-reapply pattern. Only
  // fires on the leg where there's no linked bucket for that sub.
  if (prevTx && !wasRefund && !prevLinkedBucketId && prevLinkedAccountId) {
    const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
    await adjustLinkedAccountBalance(supabase, householdId, prevLinkedAccountId, undoDelta);
    touchedBucket = true;
  }
  if (!isRefund && !bucketId && sub.linked_account_id) {
    await adjustLinkedAccountBalance(supabase, householdId, sub.linked_account_id, isWithdrawal ? -amountCents : amountCents);
    touchedBucket = true;
  }
  if (touchedBucket) await captureSnapshots(supabase, householdId, { force: true });

  // Undo the old payment's effect on its debt balance, then apply the new one's
  // — the edit may have changed the amount or moved it off/onto a debt entirely.
  // Skip both sides when refund is involved: refunds never wrote to a debt
  // principal, and reversing that non-write would credit the debt in error.
  let touchedDebt = false;
  if (prevTx && !wasRefund) {
    touchedDebt = await adjustDebtBalance(supabase, householdId, prevTx.subcategory_id, prevTx.amount_cents);
  }
  if (!isRefund) {
    if (await adjustDebtBalance(supabase, householdId, subcategoryId, -amountCents)) touchedDebt = true;
  }
  if (touchedDebt) {
    await captureSnapshots(supabase, householdId, { force: true });
    revalidatePath("/snowball");
  }

  // Undo the old posting to its account (may be a different account than the
  // new one, or none), then post the new one. Both category kinds come from
  // the enriched selects above — no per-post categoryKindOf query.
  let touchedAccount = false;
  if (prevTx?.account_id) {
    if (await adjustAccountLedger(supabase, householdId, prevTx.account_id, -ledgerDelta(prevKind, prevTx.amount_cents))) {
      touchedAccount = true;
    }
  }
  if (accountId) {
    if (await adjustAccountLedger(supabase, householdId, accountId, ledgerDelta(sub.categories?.kind ?? null, amountCents))) {
      touchedAccount = true;
    }
  }
  if (touchedAccount) await captureSnapshots(supabase, householdId, { force: true });

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/annual");
  revalidatePath("/invest");
}

// Lightweight inline edit used by the transaction register. It changes only
// the amount while preserving the same ledger, bucket, and debt side effects
// as the full transaction editor.
export async function updateTransactionAmount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  if (!id || amountCents <= 0) return;

  const tx = unwrap(
    await supabase
      .from("transactions")
      .select("occurred_on, amount_cents, memo, subcategory_id, category_id, account_id, bucket_id, paid_to_account_id, paid_to_bucket_id, movement_type, is_withdrawal")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "transactions",
  );
  if (!tx || tx.amount_cents === amountCents) return;

  if (tx.movement_type === "account_transfer") {
    const { error } = await supabase.rpc("mutate_account_transfer", {
      p_action: "update",
      p_transaction_id: id,
      p_occurred_on: tx.occurred_on,
      p_amount_cents: amountCents,
      p_from_account_id: tx.account_id,
      p_to_account_id: tx.paid_to_account_id,
      p_from_bucket_id: tx.bucket_id,
      p_to_bucket_id: tx.paid_to_bucket_id,
      p_memo: tx.memo,
    });
    if (!error) await captureSnapshots(supabase, householdId, { force: true });
    revalidatePath("/budget");
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/networth");
    return;
  }

  const deltaCents = amountCents - tx.amount_cents;
  await supabase
    .from("transactions")
    .update({ amount_cents: amountCents })
    .eq("id", id)
    .eq("household_id", householdId);

  const signedDelta = tx.is_withdrawal ? -deltaCents : deltaCents;
  let touchedSnapshot = false;
  if (tx.subcategory_id) {
    const linkedBucketId = await getLinkedBucketId(supabase, householdId, tx.subcategory_id);
    if (linkedBucketId) {
      await adjustBucketBalance(supabase, householdId, linkedBucketId, signedDelta);
      touchedSnapshot = true;
    }
    if (tx.bucket_id && tx.bucket_id !== linkedBucketId) {
      await adjustBucketBalance(supabase, householdId, tx.bucket_id, signedDelta);
      touchedSnapshot = true;
    }
    if (!linkedBucketId) {
      const linkedAccountId = await getLinkedAccountId(supabase, householdId, tx.subcategory_id);
      if (linkedAccountId) {
        await adjustLinkedAccountBalance(supabase, householdId, linkedAccountId, signedDelta);
        touchedSnapshot = true;
      }
    }
    if (await adjustDebtBalance(supabase, householdId, tx.subcategory_id, -deltaCents)) {
      touchedSnapshot = true;
      revalidatePath("/snowball");
    }
  }
  if (tx.account_id) {
    const kind = tx.category_id ? await categoryKindOf(supabase, tx.category_id) : null;
    if (await adjustAccountLedger(supabase, householdId, tx.account_id, ledgerDelta(kind, deltaCents))) {
      touchedSnapshot = true;
    }
  }
  if (touchedSnapshot) await captureSnapshots(supabase, householdId, { force: true });

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/annual");
  revalidatePath("/invest");
}

/**
 * Undo the balance side effects of a movement row (a transaction with a
 * `paid_to_account_id`: card payment or investment transfer), then delete it.
 *
 * Account transfers are NOT handled here — they have their own RPC that moves
 * both legs inside one database transaction.
 *
 * This exists because the generic delete path below only knows about
 * `account_id`; it never touches `paid_to_account_id`. Deleting a card payment
 * or an investment transfer through it left the destination leg untouched —
 * the money came back to the source account and *also* stayed on the card /
 * in the destination bank, quietly inventing cash. Worse, for a bucketed
 * source it re-applied the debit instead of reversing it, because
 * `is_withdrawal` is false on a card payment.
 */
async function reverseMovementTransaction(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  tx: {
    id: string;
    amount_cents: number;
    account_id: string | null;
    bucket_id: string | null;
    paid_to_account_id: string | null;
    movement_type: string | null;
  },
) {
  const amount = tx.amount_cents;

  if (tx.movement_type === "card_payment") {
    // payCard debited the source (bucket when the source has buckets, else the
    // account ledger) — give it back.
    if (tx.bucket_id) {
      await adjustBucketBalance(supabase, householdId, tx.bucket_id, amount);
    } else if (tx.account_id) {
      await adjustAccountLedger(supabase, householdId, tx.account_id, amount);
    }
    // payCard also paid down any debt tracked against the card. Deleting the
    // payment puts that balance back on the debt.
    if (tx.paid_to_account_id) {
      const linkedDebt = unwrap(
        await supabase
          .from("debts")
          .select("subcategory_id")
          .eq("household_id", householdId)
          .eq("account_id", tx.paid_to_account_id)
          .maybeSingle(),
        "debts",
      );
      if (linkedDebt?.subcategory_id) {
        await adjustDebtBalance(supabase, householdId, linkedDebt.subcategory_id, amount);
      }
    }
    // The card's "owed" tally is derived from the payment rows themselves, so
    // deleting the row below is all the card side needs.
  } else if (tx.movement_type === "investment_transfer") {
    // Investment side was decremented on create. adjustAccountLedger refuses
    // investment accounts by design (their balances are hand-reconciled), so
    // a bare investment account is written directly here.
    if (tx.bucket_id) {
      await adjustBucketBalance(supabase, householdId, tx.bucket_id, amount);
    } else if (tx.account_id) {
      // Read-modify-write on a real balance: a lost read would persist
      // `0 + amount` over the account's actual balance.
      const { data: source, error: sourceError } = await supabase
        .from("accounts")
        .select("current_balance_cents")
        .eq("id", tx.account_id)
        .eq("household_id", householdId)
        .maybeSingle();
      if (sourceError) throw new Error(`Could not read the source account: ${sourceError.message}`);
      await supabase
        .from("accounts")
        .update({
          current_balance_cents: (source?.current_balance_cents ?? 0) + amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.account_id)
        .eq("household_id", householdId);
    }
    // Destination banking account was incremented on create — take it back.
    if (tx.paid_to_account_id) {
      const { data: dest, error: destError } = await supabase
        .from("accounts")
        .select("current_balance_cents")
        .eq("id", tx.paid_to_account_id)
        .eq("household_id", householdId)
        .maybeSingle();
      if (destError) throw new Error(`Could not read the destination account: ${destError.message}`);
      await supabase
        .from("accounts")
        .update({
          current_balance_cents: (dest?.current_balance_cents ?? 0) - amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.paid_to_account_id)
        .eq("household_id", householdId);
    }
  }

  await supabase.from("transactions").delete().eq("id", tx.id).eq("household_id", householdId);
  await captureSnapshots(supabase, householdId, { force: true });
}

export async function deleteTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const tx = unwrap(
    await supabase
      .from("transactions")
      .select("subcategory_id, category_id, account_id, bucket_id, paid_to_account_id, amount_cents, is_withdrawal, movement_type")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "transactions",
  );

  if (tx?.movement_type === "account_transfer") {
    const { error } = await supabase.rpc("mutate_account_transfer", {
      p_action: "delete",
      p_transaction_id: id,
      p_occurred_on: null,
      p_amount_cents: null,
      p_from_account_id: null,
      p_to_account_id: null,
      p_from_bucket_id: null,
      p_to_bucket_id: null,
      p_memo: null,
    });
    // A failed reversal must not look like a success: the RPC leaves the row
    // in place when it throws, so silently returning here showed the user a
    // transfer that "wouldn't delete" with no reason given.
    if (error) return { error: error.message || "Couldn't delete that transfer — please try again." };
    await captureSnapshots(supabase, householdId, { force: true });
    revalidatePath("/budget");
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/networth");
    revalidatePath("/annual");
    revalidatePath("/invest");
    return;
  }

  // Card payments and investment transfers also carry a destination leg. They
  // must not fall through to the generic path below, which only reverses
  // `account_id` and would leave the destination holding money that no longer
  // has a transaction behind it.
  if (tx?.paid_to_account_id) {
    await reverseMovementTransaction(supabase, householdId, { ...tx, id });
    revalidatePath("/budget");
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/networth");
    revalidatePath("/annual");
    revalidatePath("/invest");
    revalidatePath("/invest");
    revalidatePath("/snowball");
    return;
  }

  await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  let linkedBucketId: string | null = null;
  if (tx?.subcategory_id) {
    linkedBucketId = await getLinkedBucketId(supabase, householdId, tx.subcategory_id);
    if (linkedBucketId) {
      const undoDelta = tx.is_withdrawal ? tx.amount_cents : -tx.amount_cents;
      await adjustBucketBalance(supabase, householdId, linkedBucketId, undoDelta);
      await captureSnapshots(supabase, householdId, { force: true });
    } else {
      // No bucket, but maybe a bare-account link — undo that too.
      const linkedAccountId = await getLinkedAccountId(supabase, householdId, tx.subcategory_id);
      if (linkedAccountId) {
        const undoDelta = tx.is_withdrawal ? tx.amount_cents : -tx.amount_cents;
        await adjustLinkedAccountBalance(supabase, householdId, linkedAccountId, undoDelta);
        await captureSnapshots(supabase, householdId, { force: true });
      }
    }

    // Deleting a debt payment adds its amount back to the outstanding balance.
    if (await adjustDebtBalance(supabase, householdId, tx.subcategory_id, tx.amount_cents)) {
      await captureSnapshots(supabase, householdId, { force: true });
      revalidatePath("/snowball");
    }
  }

  // Undo direct-bucket attribution (investment sub-account) — skip if this
  // was the same bucket the savings-linked path already reversed.
  if (tx?.bucket_id && tx.bucket_id !== linkedBucketId) {
    const undoDelta = tx.is_withdrawal ? tx.amount_cents : -tx.amount_cents;
    await adjustBucketBalance(supabase, householdId, tx.bucket_id, undoDelta);
    await captureSnapshots(supabase, householdId, { force: true });
  }

  if (tx?.account_id) {
    const kind = tx.category_id ? await categoryKindOf(supabase, tx.category_id) : null;
    if (await adjustAccountLedger(supabase, householdId, tx.account_id, -ledgerDelta(kind, tx.amount_cents))) {
      await captureSnapshots(supabase, householdId, { force: true });
    }
  }

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/annual");
  revalidatePath("/invest");
}

export async function deleteTransactions(ids: string[]) {
  if (!ids.length) return;
  for (const id of ids) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteTransaction(fd);
  }
}

// The Log tab's Clear column: checked = verified against the bank/card app.
export async function toggleCleared(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabase
    .from("transactions")
    .update({ cleared: formData.get("cleared") === "true" })
    .eq("id", id)
    .eq("household_id", householdId);

  revalidatePath("/budget");
  revalidatePath("/transactions");
}

// ---------- Snowball extra periods (time-varying extra) ----------

// A date input gives YYYY-MM-DD; snap to first-of-month.
function toFirstOfMonth(value: string): string | null {
  const v = value.trim();
  if (!/^\d{4}-\d{2}/.test(v)) return null;
  return `${v.slice(0, 7)}-01`;
}

export async function addSnowballPeriod(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const start = toFirstOfMonth(String(formData.get("startMonth") ?? ""));
  const end = toFirstOfMonth(String(formData.get("endMonth") ?? ""));
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  if (!start) return;

  await supabase.from("snowball_extra_periods").insert({
    household_id: householdId,
    start_month: start,
    end_month: end,
    amount_cents: amountCents,
  });

  revalidatePath("/snowball");
}

export async function deleteSnowballPeriod(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabase
    .from("snowball_extra_periods")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  revalidatePath("/snowball");
}

// ---------- Household globals (settings popover) ----------

export async function updateGlobals(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const currency = String(formData.get("currency") ?? "$").trim() || "$";
  const snowballStart = String(formData.get("snowballStartDate") ?? "").trim() || null;
  const snowballExtra = displayToCents(String(formData.get("snowballMonthlyExtra") ?? "0"));

  await supabase
    .from("households")
    .update({
      currency,
      snowball_start_date: snowballStart,
      snowball_monthly_extra_cents: snowballExtra,
    })
    .eq("id", householdId);

  revalidatePath("/budget");
  revalidatePath("/snowball");
}

// ---------- Rollover (carry a month's leftover cash into the next) ----------

export async function deletePayee(id: string) {
  const { supabase, householdId } = await requireHousehold();
  await supabase.from("payees").delete().eq("id", id).eq("household_id", householdId);
  revalidatePath("/budget");
}

// Bulk-copy every planned amount from the previous month into the given month.
// Overwrites existing plans for that month so a re-click stays idempotent
// against last month's numbers.
export async function copyPlansFromPreviousMonth(
  formData: FormData,
): Promise<{ snapshot: Array<{ subcategory_id: string; planned_cents: number | null }>; touchedSubIds: string[] }> {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01 (destination month)
  if (!/^\d{4}-\d{2}-01$/.test(month)) return { snapshot: [], touchedSubIds: [] };

  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)); // JS month is 0-indexed; prev = m-2
  const prevMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const prevPlans = unwrap(
    await supabase
      .from("budget_plans")
      .select("subcategory_id, planned_cents")
      .eq("household_id", householdId)
      .eq("month", prevMonth),
    "budget_plans",
  );

  const positivePrevPlans = (prevPlans ?? []).filter((p) => (p.planned_cents ?? 0) > 0);
  const candidateSubIds = positivePrevPlans.map((p) => p.subcategory_id as string);
  let paidOffDebtSubIds = new Set<string>();
  if (candidateSubIds.length > 0) {
    const paidOffDebts = unwrap(
      await supabase
        .from("debts")
        .select("subcategory_id")
        .eq("household_id", householdId)
        .in("subcategory_id", candidateSubIds)
        .lte("current_balance_cents", 0),
      "debts",
    );
    paidOffDebtSubIds = new Set((paidOffDebts ?? []).map((debt) => debt.subcategory_id as string));
  }

  // Once a card or loan reaches $0, its old payment plan must not silently
  // reappear in a later month or cross into a new calendar year.
  const rows = positivePrevPlans
    .filter((p) => !paidOffDebtSubIds.has(p.subcategory_id as string))
    .map((p) => ({
      household_id: householdId,
      month,
      subcategory_id: p.subcategory_id,
      planned_cents: p.planned_cents,
    }));

  // Snapshot the destination month's current plans for the sub-ids about to be
  // overwritten, so Undo can restore prior values (or delete rows that didn't
  // exist before).
  const touchedSubIds = rows.map((r) => r.subcategory_id as string);
  let snapshot: Array<{ subcategory_id: string; planned_cents: number | null }> = [];
  if (touchedSubIds.length > 0) {
    const existing = unwrap(
      await supabase
        .from("budget_plans")
        .select("subcategory_id, planned_cents")
        .eq("household_id", householdId)
        .eq("month", month)
        .in("subcategory_id", touchedSubIds),
      "budget_plans",
    );
    const existingMap = new Map(
      (existing ?? []).map((e) => [e.subcategory_id as string, e.planned_cents as number | null]),
    );
    snapshot = touchedSubIds.map((id) => ({
      subcategory_id: id,
      planned_cents: existingMap.has(id) ? (existingMap.get(id) ?? null) : null,
    }));

    await supabase
      .from("budget_plans")
      .upsert(rows, { onConflict: "household_id,month,subcategory_id" });
  }

  revalidatePath("/budget");
  return { snapshot, touchedSubIds };
}

export async function restorePlansSnapshot(
  month: string,
  snapshot: Array<{ subcategory_id: string; planned_cents: number | null }>,
) {
  const { supabase, householdId } = await requireHousehold();
  if (!/^\d{4}-\d{2}-01$/.test(month)) return;

  const toUpsert = snapshot
    .filter((s) => s.planned_cents != null && s.planned_cents > 0)
    .map((s) => ({
      household_id: householdId,
      month,
      subcategory_id: s.subcategory_id,
      planned_cents: s.planned_cents!,
    }));
  const toDelete = snapshot.filter((s) => s.planned_cents == null).map((s) => s.subcategory_id);

  if (toUpsert.length > 0) {
    await supabase
      .from("budget_plans")
      .upsert(toUpsert, { onConflict: "household_id,month,subcategory_id" });
  }
  if (toDelete.length > 0) {
    await supabase
      .from("budget_plans")
      .delete()
      .eq("household_id", householdId)
      .eq("month", month)
      .in("subcategory_id", toDelete);
  }

  revalidatePath("/budget");
}

export async function setRollover(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01 (source month)
  const enable = formData.get("enable") === "on";
  if (!/^\d{4}-\d{2}-01$/.test(month)) return;

  if (enable) {
    await supabase
      .from("budget_rollovers")
      .upsert({ household_id: householdId, month }, { onConflict: "household_id,month" });
  } else {
    await supabase
      .from("budget_rollovers")
      .delete()
      .eq("household_id", householdId)
      .eq("month", month);
  }

  revalidatePath("/budget");
}

export async function setRolloverOverride(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}-01$/.test(month)) return;
  const raw = String(formData.get("override") ?? "").trim();
  // Empty string = clear override (back to live calc). Number = cents override.
  const overrideCents = raw === "" ? null : Math.round(parseFloat(raw) * 100);
  if (overrideCents !== null && isNaN(overrideCents)) return;

  await supabase
    .from("budget_rollovers")
    .upsert({ household_id: householdId, month, override_cents: overrideCents }, { onConflict: "household_id,month" });

  revalidatePath("/budget");
}
