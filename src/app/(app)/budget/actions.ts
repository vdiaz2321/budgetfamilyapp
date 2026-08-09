"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents, moneyExpressionToCents } from "@/lib/money";
import { captureSnapshots } from "@/lib/snapshots";
import { adjustBucketBalance } from "@/lib/buckets";
import { adjustDebtBalance } from "@/lib/debts";
import { adjustAccountLedger, categoryKindOf, ledgerDelta } from "@/lib/account-ledger";

// The bucket a Savings subcategory contributes to, if any linked — null when
// not a savings item or not linked, so callers can skip the bucket math.
async function getLinkedBucketId(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  subcategoryId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("subcategories")
    .select("linked_bucket_id")
    .eq("id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  return data?.linked_bucket_id ?? null;
}

// Same, but for the direct-account link used by Savings items pointing at a
// bare investment account (TSP, M1, Charles Schwab, …) with no buckets.
async function getLinkedAccountId(
  supabase: Awaited<ReturnType<typeof requireHousehold>>["supabase"],
  householdId: string,
  subcategoryId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("subcategories")
    .select("linked_account_id")
    .eq("id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
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
  const { data: account } = await supabase
    .from("accounts")
    .select("id, current_balance_cents")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!account) return false;

  const { count } = await supabase
    .from("buckets")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  return { supabase, householdId: profile.household_id };
}

const CUSTOM_GROUP_KINDS = new Set(["bills", "expenses", "savings"]);

export async function addCategoryGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  if (!name) return { error: "Enter a group name." };
  if (!CUSTOM_GROUP_KINDS.has(kind)) return { error: "Choose Bills, Expenses, or Savings." };

  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

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

  const { error } = await supabase
    .from("categories")
    .update({ name })
    .eq("id", id)
    .eq("household_id", householdId)
    .eq("is_system", false);
  if (error?.code === "23505") return { error: "A group with that name already exists." };
  if (error) return { error: "The group could not be renamed." };

  revalidatePath("/budget");
  revalidatePath("/annual");
  return {};
}

export async function moveCategoryGroup(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!id || !["up", "down"].includes(direction)) return;

  const { data: target } = await supabase
    .from("categories")
    .select("id, is_system")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!target || target.is_system) return;

  const { data: categories } = await supabase
    .from("categories")
    .select("id")
    .eq("household_id", householdId)
    .order("sort_order")
    .order("name");
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

  const { data: existing } = await supabase
    .from("budget_plans")
    .select("subcategory_id, planned_cents")
    .eq("household_id", householdId)
    .eq("month", month)
    .in("subcategory_id", [fromSubId, toSubId]);

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

  const { data: siblings } = await supabase
    .from("subcategories")
    .select("sort_order")
    .eq("household_id", householdId)
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSort = (siblings?.[0]?.sort_order ?? -1) + 1;

  await supabase.from("subcategories").insert({
    household_id: householdId,
    category_id: categoryId,
    name,
    due_day: dueDay,
    sort_order: nextSort,
  });

  revalidatePath("/budget");
}

export async function moveSubcategoryToGroup(formData: FormData): Promise<{ error?: string }> {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const targetCategoryId = String(formData.get("categoryId") ?? "");
  if (!subcategoryId || !targetCategoryId) return { error: "Choose a category group." };

  const { data: subcategory } = await supabase
    .from("subcategories")
    .select("category_id")
    .eq("id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!subcategory || subcategory.category_id === targetCategoryId) return {};

  const { data: categories } = await supabase
    .from("categories")
    .select("id, kind")
    .eq("household_id", householdId)
    .in("id", [subcategory.category_id, targetCategoryId]);
  const kindById = new Map((categories ?? []).map((category) => [category.id, category.kind]));
  if (!kindById.has(targetCategoryId) || kindById.get(subcategory.category_id) !== kindById.get(targetCategoryId)) {
    return { error: "Items can move only between groups of the same type." };
  }

  const { data: last } = await supabase
    .from("subcategories")
    .select("sort_order")
    .eq("household_id", householdId)
    .eq("category_id", targetCategoryId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

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

  const { data: existing } = await supabase
    .from("subcategories")
    .select("name, sort_order")
    .eq("household_id", householdId)
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: false });

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
  const id = String(formData.get("id") ?? "");
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
      const { data: account } = await supabase
        .from("accounts")
        .select("id")
        .eq("id", rawPaymentAccountId)
        .eq("household_id", householdId)
        .in("kind", ["checking", "savings_bucket", "cash", "credit_card"])
        .maybeSingle();
      update.payment_account_id = account?.id ?? null;
    }
  }

  await supabase
    .from("subcategories")
    .update(update)
    .eq("id", id)
    .eq("household_id", householdId);

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
  revalidatePath("/savings");
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
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", candidate)
      .eq("household_id", householdId)
      .maybeSingle();
    accountId = account?.id ?? null;
  } else if (raw) {
    const { data: bucket } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", raw)
      .eq("household_id", householdId)
      .maybeSingle();
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
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    accountId = account?.id ?? null;
  }

  // Manual balance edits stamp/clear paid_off_at the same way a payment does,
  // so a debt zeroed out here still drops off the Snowball page next year.
  const { data: existing } = await supabase
    .from("debts")
    .select("paid_off_at")
    .eq("subcategory_id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  const paidOffAt =
    balanceCents <= 0 ? existing?.paid_off_at ?? new Date().toISOString().slice(0, 10) : null;

  await supabase.from("debts").upsert(
    {
      household_id: householdId,
      subcategory_id: subcategoryId,
      current_balance_cents: balanceCents,
      paid_off_at: paidOffAt,
      min_payment_cents: minPaymentCents,
      apr: Number.isNaN(apr) ? 0 : apr,
      due_day: dueDay,
      debt_kind: debtKind,
      notes,
      promo_apr_ends_on: promoAprEndsOn,
      account_id: accountId,
    },
    { onConflict: "household_id,subcategory_id" },
  );

  // Keep subcategories.due_day in sync — the budget row list badge and the
  // Rename form read from there, not from debts.due_day. Without this, the
  // due day set here silently didn't show up anywhere else.
  await supabase
    .from("subcategories")
    .update({ due_day: dueDay })
    .eq("id", subcategoryId)
    .eq("household_id", householdId);

  await captureSnapshots(supabase, householdId);
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
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const payeeName = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const bucketIdRaw = String(formData.get("bucketId") ?? "").trim();
  const isWithdrawal = formData.get("isWithdrawal") === "on";
  const cleared = formData.get("cleared") === "on";
  if (!subcategoryId || !occurredOn || amountCents <= 0) return;

  // Keep category_id consistent with the chosen subcategory.
  const { data: sub } = await supabase
    .from("subcategories")
    .select("category_id")
    .eq("id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!sub) return;

  let payeeId: string | null = null;
  if (payeeName) {
    const { data: payee } = await supabase
      .from("payees")
      .upsert(
        { household_id: householdId, name: payeeName },
        { onConflict: "household_id,name" },
      )
      .select("id")
      .single();
    payeeId = payee?.id ?? null;
  }

  // Only attach the account if it belongs to this household.
  let accountId: string | null = null;
  if (accountIdRaw) {
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    accountId = account?.id ?? null;
  }

  // Optional direct bucket attribution (investment sub-accounts like
  // Fidelity → Roth IRA Vic). Only valid when the bucket belongs to the
  // account we just verified. Distinct from the subcategory.linked_bucket_id
  // path used by savings goals below.
  let directBucketId: string | null = null;
  if (bucketIdRaw && accountId) {
    const { data: b } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketIdRaw)
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .maybeSingle();
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
  // Real Estate bucket for a down payment) subtracts from it instead.
  const bucketId = await getLinkedBucketId(supabase, householdId, subcategoryId);
  if (bucketId) {
    await adjustBucketBalance(supabase, householdId, bucketId, isWithdrawal ? -amountCents : amountCents);
    await captureSnapshots(supabase, householdId);
  }

  // Direct-bucket attribution (investment sub-account). adjustBucketBalance
  // also rolls the parent account total via syncAccountFromBuckets.
  if (directBucketId && directBucketId !== bucketId) {
    await adjustBucketBalance(supabase, householdId, directBucketId, isWithdrawal ? -amountCents : amountCents);
    await captureSnapshots(supabase, householdId);
  }

  // Bare investment account link (TSP, M1, …) — contribution posts straight
  // to the account balance. Only fires when there's no linked bucket.
  if (!bucketId) {
    const linkedAccountId = await getLinkedAccountId(supabase, householdId, subcategoryId);
    if (linkedAccountId) {
      await adjustLinkedAccountBalance(supabase, householdId, linkedAccountId, isWithdrawal ? -amountCents : amountCents);
      await captureSnapshots(supabase, householdId);
    }
  }

  // A payment logged against a debt lowers its outstanding balance.
  const touchedDebt = await adjustDebtBalance(supabase, householdId, subcategoryId, -amountCents);
  if (touchedDebt) {
    await captureSnapshots(supabase, householdId);
    revalidatePath("/snowball");
  }

  // Post to the chosen account's running ledger (income adds, everything
  // else spends out) — skipped for investment/bucketed accounts, which stay
  // manual.
  if (accountId) {
    const kind = await categoryKindOf(supabase, sub.category_id);
    if (await adjustAccountLedger(supabase, householdId, accountId, ledgerDelta(kind, amountCents))) {
      await captureSnapshots(supabase, householdId);
    }
  }

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
}

export async function updateTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const occurredOn = String(formData.get("date") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const payeeName = String(formData.get("payee") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const bucketIdRaw = String(formData.get("bucketId") ?? "").trim();
  const isWithdrawal = formData.get("isWithdrawal") === "on";
  if (!id || !subcategoryId || !occurredOn || amountCents <= 0) return;

  // Snapshot the pre-edit values so we can undo their bucket effect below —
  // the old subcategory/amount/direction may differ from the new ones.
  const { data: prevTx } = await supabase
    .from("transactions")
    .select("subcategory_id, category_id, account_id, bucket_id, amount_cents, is_withdrawal")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();

  const { data: sub } = await supabase
    .from("subcategories")
    .select("category_id")
    .eq("id", subcategoryId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!sub) return;

  let payeeId: string | null = null;
  if (payeeName) {
    const { data: payee } = await supabase
      .from("payees")
      .upsert(
        { household_id: householdId, name: payeeName },
        { onConflict: "household_id,name" },
      )
      .select("id")
      .single();
    payeeId = payee?.id ?? null;
  }

  let accountId: string | null = null;
  if (accountIdRaw) {
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountIdRaw)
      .eq("household_id", householdId)
      .maybeSingle();
    accountId = account?.id ?? null;
  }

  let directBucketId: string | null = null;
  if (bucketIdRaw && accountId) {
    const { data: b } = await supabase
      .from("buckets")
      .select("id")
      .eq("id", bucketIdRaw)
      .eq("account_id", accountId)
      .eq("household_id", householdId)
      .maybeSingle();
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
  // bucket, or none at all), then apply the new one's.
  let touchedBucket = false;
  if (prevTx) {
    const prevBucketId = await getLinkedBucketId(supabase, householdId, prevTx.subcategory_id);
    if (prevBucketId) {
      const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
      await adjustBucketBalance(supabase, householdId, prevBucketId, undoDelta);
      touchedBucket = true;
    }
    // Undo previous direct-bucket attribution (investment sub-account).
    if (prevTx.bucket_id && prevTx.bucket_id !== (prevBucketId ?? null)) {
      const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
      await adjustBucketBalance(supabase, householdId, prevTx.bucket_id, undoDelta);
      touchedBucket = true;
    }
  }
  const bucketId = await getLinkedBucketId(supabase, householdId, subcategoryId);
  if (bucketId) {
    await adjustBucketBalance(supabase, householdId, bucketId, isWithdrawal ? -amountCents : amountCents);
    touchedBucket = true;
  }
  // Apply new direct-bucket attribution.
  if (directBucketId && directBucketId !== bucketId) {
    await adjustBucketBalance(supabase, householdId, directBucketId, isWithdrawal ? -amountCents : amountCents);
    touchedBucket = true;
  }

  // Bare-account link (TSP/M1/…) — same undo-then-reapply pattern. Only
  // fires on the leg where there's no linked bucket for that sub.
  if (prevTx) {
    const prevBucketId = await getLinkedBucketId(supabase, householdId, prevTx.subcategory_id);
    if (!prevBucketId) {
      const prevAccountLink = await getLinkedAccountId(supabase, householdId, prevTx.subcategory_id);
      if (prevAccountLink) {
        const undoDelta = prevTx.is_withdrawal ? prevTx.amount_cents : -prevTx.amount_cents;
        await adjustLinkedAccountBalance(supabase, householdId, prevAccountLink, undoDelta);
        touchedBucket = true;
      }
    }
  }
  if (!bucketId) {
    const linkedAccountId = await getLinkedAccountId(supabase, householdId, subcategoryId);
    if (linkedAccountId) {
      await adjustLinkedAccountBalance(supabase, householdId, linkedAccountId, isWithdrawal ? -amountCents : amountCents);
      touchedBucket = true;
    }
  }
  if (touchedBucket) await captureSnapshots(supabase, householdId);

  // Undo the old payment's effect on its debt balance, then apply the new one's
  // — the edit may have changed the amount or moved it off/onto a debt entirely.
  let touchedDebt = false;
  if (prevTx) {
    touchedDebt = await adjustDebtBalance(supabase, householdId, prevTx.subcategory_id, prevTx.amount_cents);
  }
  if (await adjustDebtBalance(supabase, householdId, subcategoryId, -amountCents)) touchedDebt = true;
  if (touchedDebt) {
    await captureSnapshots(supabase, householdId);
    revalidatePath("/snowball");
  }

  // Undo the old posting to its account (may be a different account than the
  // new one, or none), then post the new one.
  let touchedAccount = false;
  if (prevTx?.account_id) {
    const prevKind = prevTx.category_id ? await categoryKindOf(supabase, prevTx.category_id) : null;
    if (await adjustAccountLedger(supabase, householdId, prevTx.account_id, -ledgerDelta(prevKind, prevTx.amount_cents))) {
      touchedAccount = true;
    }
  }
  if (accountId) {
    const kind = await categoryKindOf(supabase, sub.category_id);
    if (await adjustAccountLedger(supabase, householdId, accountId, ledgerDelta(kind, amountCents))) {
      touchedAccount = true;
    }
  }
  if (touchedAccount) await captureSnapshots(supabase, householdId);

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
}

// Lightweight inline edit used by the transaction register. It changes only
// the amount while preserving the same ledger, bucket, and debt side effects
// as the full transaction editor.
export async function updateTransactionAmount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  if (!id || amountCents <= 0) return;

  const { data: tx } = await supabase
    .from("transactions")
    .select("amount_cents, subcategory_id, category_id, account_id, bucket_id, is_withdrawal")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!tx || tx.amount_cents === amountCents) return;

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
  if (touchedSnapshot) await captureSnapshots(supabase, householdId);

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
}

export async function deleteTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { data: tx } = await supabase
    .from("transactions")
    .select("subcategory_id, category_id, account_id, bucket_id, amount_cents, is_withdrawal")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();

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
      await captureSnapshots(supabase, householdId);
    } else {
      // No bucket, but maybe a bare-account link — undo that too.
      const linkedAccountId = await getLinkedAccountId(supabase, householdId, tx.subcategory_id);
      if (linkedAccountId) {
        const undoDelta = tx.is_withdrawal ? tx.amount_cents : -tx.amount_cents;
        await adjustLinkedAccountBalance(supabase, householdId, linkedAccountId, undoDelta);
        await captureSnapshots(supabase, householdId);
      }
    }

    // Deleting a debt payment adds its amount back to the outstanding balance.
    if (await adjustDebtBalance(supabase, householdId, tx.subcategory_id, tx.amount_cents)) {
      await captureSnapshots(supabase, householdId);
      revalidatePath("/snowball");
    }
  }

  // Undo direct-bucket attribution (investment sub-account) — skip if this
  // was the same bucket the savings-linked path already reversed.
  if (tx?.bucket_id && tx.bucket_id !== linkedBucketId) {
    const undoDelta = tx.is_withdrawal ? tx.amount_cents : -tx.amount_cents;
    await adjustBucketBalance(supabase, householdId, tx.bucket_id, undoDelta);
    await captureSnapshots(supabase, householdId);
  }

  if (tx?.account_id) {
    const kind = tx.category_id ? await categoryKindOf(supabase, tx.category_id) : null;
    if (await adjustAccountLedger(supabase, householdId, tx.account_id, -ledgerDelta(kind, tx.amount_cents))) {
      await captureSnapshots(supabase, householdId);
    }
  }

  revalidatePath("/budget");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
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

  const { data: prevPlans } = await supabase
    .from("budget_plans")
    .select("subcategory_id, planned_cents")
    .eq("household_id", householdId)
    .eq("month", prevMonth);

  const positivePrevPlans = (prevPlans ?? []).filter((p) => (p.planned_cents ?? 0) > 0);
  const candidateSubIds = positivePrevPlans.map((p) => p.subcategory_id as string);
  let paidOffDebtSubIds = new Set<string>();
  if (candidateSubIds.length > 0) {
    const { data: paidOffDebts } = await supabase
      .from("debts")
      .select("subcategory_id")
      .eq("household_id", householdId)
      .in("subcategory_id", candidateSubIds)
      .lte("current_balance_cents", 0);
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
    const { data: existing } = await supabase
      .from("budget_plans")
      .select("subcategory_id, planned_cents")
      .eq("household_id", householdId)
      .eq("month", month)
      .in("subcategory_id", touchedSubIds);
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
