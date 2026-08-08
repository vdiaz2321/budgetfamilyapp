"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { displayToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

async function requireHousehold() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");
  return { supabase, householdId: profile.household_id as string };
}

// Manual statement interest is authoritative for revolving cards and is also
// available as a lender-statement correction for standard loans.
export async function recordDebtInterest(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const debtId = String(formData.get("debtId") ?? "");
  const amountCents = displayToCents(String(formData.get("amount") ?? "0"));
  const occurredOn = String(formData.get("date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const memo = String(formData.get("memo") ?? "").trim() || null;
  if (!debtId || amountCents <= 0) return { error: "Enter an interest amount greater than zero." };

  const { data: debt } = await supabase
    .from("debts")
    .select("id, current_balance_cents, interest_paid_cents")
    .eq("id", debtId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!debt) return { error: "Debt not found." };

  const { data: entry, error: entryError } = await supabase
    .from("debt_interest_entries")
    .insert({ household_id: householdId, debt_id: debtId, occurred_on: occurredOn, amount_cents: amountCents, memo })
    .select("id")
    .single();
  if (entryError || !entry) return { error: "Couldn't record the interest charge." };

  const { error: updateError } = await supabase
    .from("debts")
    .update({
      current_balance_cents: Number(debt.current_balance_cents) + amountCents,
      interest_paid_cents: Number(debt.interest_paid_cents ?? 0) + amountCents,
      paid_off_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", debtId)
    .eq("household_id", householdId);
  if (updateError) {
    await supabase.from("debt_interest_entries").delete().eq("id", entry.id).eq("household_id", householdId);
    return { error: "Couldn't update the debt balance." };
  }

  revalidatePath("/snowball");
  revalidatePath("/budget");
  revalidatePath("/accounts");
  revalidatePath("/networth");
  return { error: null };
}

