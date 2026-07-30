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

function revalidate() {
  // The management UI now lives in a modal on Budget itself; the payee
  // autocomplete + auto-fill in the transaction modal lives on both pages.
  revalidatePath("/budget");
  revalidatePath("/transactions");
}

// After any subscription change, recompute the total monthly-equivalent cost of
// all active subscriptions and write it as the planned amount for the current
// month on the "Subscriptions" Bills subcategory — so the budget row never
// shows an unexpected overspent state.
async function syncSubscriptionsPlanned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  subcategoryId: string,
) {
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("amount_cents, billing_cycle, is_active")
    .eq("household_id", householdId)
    .eq("is_active", true);

  const monthlyTotal = (subs ?? []).reduce((sum, s) => {
    let mo = s.amount_cents;
    if (s.billing_cycle === "annual") mo = Math.round(s.amount_cents / 12);
    else if (s.billing_cycle === "quarterly") mo = Math.round(s.amount_cents / 3);
    else if (s.billing_cycle === "weekly") mo = Math.round(s.amount_cents * (52 / 12));
    return sum + mo;
  }, 0);

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  await supabase.from("budget_plans").upsert(
    { household_id: householdId, month, subcategory_id: subcategoryId, planned_cents: monthlyTotal },
    { onConflict: "household_id,month,subcategory_id" },
  );
}

async function findOrCreateBillsSubcategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  name: "Subscriptions" | "Irregular Bills",
): Promise<string> {
  const { data: billsCat } = await supabase
    .from("categories")
    .select("id")
    .eq("household_id", householdId)
    .eq("kind", "bills")
    .single();
  if (!billsCat) throw new Error("Bills category not found");

  const { data: existing } = await supabase
    .from("subcategories")
    .select("id")
    .eq("household_id", householdId)
    .eq("category_id", billsCat.id)
    .ilike("name", name)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: maxRow } = await supabase
    .from("subcategories")
    .select("sort_order")
    .eq("category_id", billsCat.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? 0) + 1;

  const { data: created } = await supabase
    .from("subcategories")
    .insert({ household_id: householdId, category_id: billsCat.id, name, sort_order: nextSort })
    .select("id")
    .single();
  if (!created) throw new Error(`Failed to create "${name}" subcategory`);
  return created.id;
}

export async function upsertSubscription(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const billingCycle = String(formData.get("billingCycle") ?? "monthly");
  const nextRenewalDate = String(formData.get("nextRenewalDate") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const isActive = formData.get("isActive") === "on";
  const accountId = String(formData.get("accountId") ?? "").trim() || null;
  if (!name) return { error: "Name is required." };

  const subcategoryId = await findOrCreateBillsSubcategory(supabase, householdId, "Subscriptions");

  const row = {
    household_id: householdId,
    name,
    amount_cents: amountCents,
    billing_cycle: billingCycle,
    next_renewal_date: nextRenewalDate,
    subcategory_id: subcategoryId,
    account_id: accountId,
    notes,
    is_active: isActive,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    await supabase.from("subscriptions").update(row).eq("id", id).eq("household_id", householdId);
  } else {
    await supabase.from("subscriptions").insert(row);
  }
  await syncSubscriptionsPlanned(supabase, householdId, subcategoryId);
  revalidate();
}

export async function deleteSubscription(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  await supabase.from("subscriptions").delete().eq("id", id).eq("household_id", householdId);
  const subcategoryId = await findOrCreateBillsSubcategory(supabase, householdId, "Subscriptions");
  await syncSubscriptionsPlanned(supabase, householdId, subcategoryId);
  revalidate();
}

export async function upsertIrregularBill(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const typicalAmountCents = displayToCents(String(formData.get("typicalAmount") ?? "0"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const accountId = String(formData.get("accountId") ?? "").trim() || null;
  if (!name) return { error: "Name is required." };

  const subcategoryId = await findOrCreateBillsSubcategory(supabase, householdId, "Irregular Bills");

  const row = {
    household_id: householdId,
    name,
    typical_amount_cents: typicalAmountCents,
    subcategory_id: subcategoryId,
    account_id: accountId,
    notes,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    await supabase.from("irregular_bills").update(row).eq("id", id).eq("household_id", householdId);
  } else {
    await supabase.from("irregular_bills").insert(row);
  }
  revalidate();
}

export async function deleteIrregularBill(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  await supabase.from("irregular_bills").delete().eq("id", id).eq("household_id", householdId);
  revalidate();
}

export async function reorderSubscription(id: string, direction: "up" | "down") {
  const { supabase, householdId } = await requireHousehold();
  const { data: rows } = await supabase
    .from("subscriptions")
    .select("id, sort_order")
    .eq("household_id", householdId)
    .order("sort_order")
    .order("name");
  if (!rows) return;

  const idx = rows.findIndex((r) => r.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= rows.length) return;

  const a = rows[idx];
  const b = rows[swapIdx];
  await Promise.all([
    supabase.from("subscriptions").update({ sort_order: b.sort_order }).eq("id", a.id),
    supabase.from("subscriptions").update({ sort_order: a.sort_order }).eq("id", b.id),
  ]);
  revalidate();
}

export async function reorderIrregularBill(id: string, direction: "up" | "down") {
  const { supabase, householdId } = await requireHousehold();
  const { data: rows } = await supabase
    .from("irregular_bills")
    .select("id, sort_order")
    .eq("household_id", householdId)
    .order("sort_order")
    .order("name");
  if (!rows) return;

  const idx = rows.findIndex((r) => r.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= rows.length) return;

  const a = rows[idx];
  const b = rows[swapIdx];
  await Promise.all([
    supabase.from("irregular_bills").update({ sort_order: b.sort_order }).eq("id", a.id),
    supabase.from("irregular_bills").update({ sort_order: a.sort_order }).eq("id", b.id),
  ]);
  revalidate();
}
