"use server";

import { revalidatePath } from "next/cache";
import { displayToCents } from "@/lib/money";
import { getSessionContext } from "@/lib/auth-context";

// Uses the shared, request-cached session context rather than re-running the
// getUser → profile → household chain by hand (see AGENTS.md). The chain was
// duplicated here, costing extra auth round-trips on every debt action.
async function requireHousehold() {
  const { supabase, household } = await getSessionContext();
  return { supabase, householdId: household.id };
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


/**
 * Commit a simulated payment to the plan.
 *
 * The Payoff Simulator could show that paying $X clears a debt N months
 * sooner, but nothing carried that answer anywhere — the figure had to be
 * remembered and re-typed into the Budget page by hand, which is where most of
 * its value leaked away.
 *
 * Writes both places the payment is read from:
 *   - `budget_plans` for the given month, which is what Budget displays and
 *     what Snowball's "My Plan" mode projects from;
 *   - `debts.target_payment_cents`, the standing amount used as a fallback for
 *     months that haven't been planned yet.
 */
export async function applyPayoffPlan(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  const month = String(formData.get("month") ?? "");
  const paymentCents = displayToCents(String(formData.get("payment") ?? "0"));

  if (!subcategoryId || !month) return { error: "Missing details." };
  if (paymentCents <= 0) return { error: "Enter a payment above zero." };

  // A payment below the minimum isn't a plan the lender will accept, and
  // silently storing one would make every downstream projection optimistic.
  const { data: debt } = await supabase
    .from("debts")
    .select("min_payment_cents")
    .eq("household_id", householdId)
    .eq("subcategory_id", subcategoryId)
    .maybeSingle();
  const minCents = debt?.min_payment_cents ?? 0;
  if (paymentCents < minCents) {
    return { error: "That's below this debt's minimum payment." };
  }

  const now = new Date().toISOString();
  const { error: planError } = await supabase.from("budget_plans").upsert(
    {
      household_id: householdId,
      month,
      subcategory_id: subcategoryId,
      planned_cents: paymentCents,
      updated_at: now,
    },
    { onConflict: "household_id,month,subcategory_id" },
  );
  if (planError) return { error: "Couldn't update the budget plan." };

  await supabase
    .from("debts")
    .update({ target_payment_cents: paymentCents, updated_at: now })
    .eq("household_id", householdId)
    .eq("subcategory_id", subcategoryId);

  revalidatePath("/snowball");
  revalidatePath("/budget");
  return { error: null };
}
