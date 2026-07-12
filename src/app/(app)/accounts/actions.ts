"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { captureSnapshots } from "@/lib/snapshots";

// Kinds the UI lets you create. debt_loan exists in the enum but loans are
// managed from the Budget's Debt group, not here.
const ALLOWED_KINDS = ["checking", "savings_bucket", "cash", "investment", "credit_card"];

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
}

export async function addAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const holder = String(formData.get("holder") ?? "").trim() || null;
  const balanceCents = displayToCents(String(formData.get("balance") ?? "0"));
  if (!name || !ALLOWED_KINDS.includes(kind)) return;

  await supabase.from("accounts").insert({
    household_id: householdId,
    name,
    kind,
    holder,
    current_balance_cents: balanceCents,
  });

  await captureSnapshots(supabase, householdId);
  revalidate();
}

export async function updateAccount(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const holder = String(formData.get("holder") ?? "").trim() || null;
  const active = formData.get("active") === "on";
  if (!id || !name) return;

  await supabase
    .from("accounts")
    .update({ name, holder, active, updated_at: new Date().toISOString() })
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
  // their history — they just lose the account link.
  await supabase
    .from("accounts")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);

  revalidate();
}
