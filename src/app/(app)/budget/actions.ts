"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
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

// ---------- Planned amounts (per subcategory per month) ----------

export async function upsertPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? ""); // YYYY-MM-01
  if (!subcategoryId || !month) return;

  const plannedCents = displayToCents(String(formData.get("planned") ?? "0"));

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

// ---------- Subcategories (the budget rows) ----------

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

export async function updateSubcategory(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const rawDue = String(formData.get("dueDay") ?? "").trim();
  const dueDay = rawDue === "" ? null : Math.min(31, Math.max(1, parseInt(rawDue, 10)));

  await supabase
    .from("subcategories")
    .update({ name, due_day: dueDay })
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

  await supabase.from("savings_goals").upsert(
    {
      household_id: householdId,
      subcategory_id: subcategoryId,
      goal_cents: goalCents,
      start_cents: startCents,
      monthly_contribution_cents: monthlyCents,
    },
    { onConflict: "household_id,subcategory_id" },
  );

  revalidatePath("/budget");
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

  await supabase.from("debts").upsert(
    {
      household_id: householdId,
      subcategory_id: subcategoryId,
      current_balance_cents: balanceCents,
      min_payment_cents: minPaymentCents,
      apr: Number.isNaN(apr) ? 0 : apr,
      due_day: dueDay,
      account_id: accountId,
    },
    { onConflict: "household_id,subcategory_id" },
  );

  await captureSnapshots(supabase, householdId);
  revalidatePath("/budget");
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

  await supabase.from("transactions").insert({
    household_id: householdId,
    occurred_on: occurredOn,
    amount_cents: amountCents,
    category_id: sub.category_id,
    subcategory_id: subcategoryId,
    payee_id: payeeId,
    account_id: accountId,
    memo,
    source: "manual",
  });

  revalidatePath("/budget");
  revalidatePath("/transactions");
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
  if (!id || !subcategoryId || !occurredOn || amountCents <= 0) return;

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

  await supabase
    .from("transactions")
    .update({
      occurred_on: occurredOn,
      amount_cents: amountCents,
      category_id: sub.category_id,
      subcategory_id: subcategoryId,
      payee_id: payeeId,
      account_id: accountId,
      memo,
    })
    .eq("id", id)
    .eq("household_id", householdId);

  revalidatePath("/budget");
  revalidatePath("/transactions");
}

export async function deleteTransaction(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  revalidatePath("/budget");
  revalidatePath("/transactions");
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
