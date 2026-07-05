"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";

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

// ---------- Globals ----------

export async function updateGlobals(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const currency = String(formData.get("currency") ?? "$").trim() || "$";
  const year = parseInt(String(formData.get("year") ?? ""), 10) || new Date().getFullYear();
  const snowballStart = String(formData.get("snowballStartDate") ?? "").trim() || null;
  const snowballExtra = displayToCents(String(formData.get("snowballMonthlyExtra") ?? "0"));

  await supabase
    .from("households")
    .update({
      currency,
      year,
      snowball_start_date: snowballStart,
      snowball_monthly_extra_cents: snowballExtra,
    })
    .eq("id", householdId);

  revalidatePath("/settings");
}

// ---------- Subcategories ----------

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

  revalidatePath("/settings");
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

  revalidatePath("/settings");
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

  revalidatePath("/settings");
}

// ---------- Savings & Sinking Funds ----------

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

  revalidatePath("/settings");
}

// ---------- Debt Snowball ----------

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

  await supabase.from("debts").upsert(
    {
      household_id: householdId,
      subcategory_id: subcategoryId,
      current_balance_cents: balanceCents,
      min_payment_cents: minPaymentCents,
      apr: Number.isNaN(apr) ? 0 : apr,
      due_day: dueDay,
    },
    { onConflict: "household_id,subcategory_id" },
  );

  revalidatePath("/settings");
}
