"use server";

import { revalidatePath } from "next/cache";
import { displayToCents } from "@/lib/money";
import { getSessionContext } from "@/lib/auth-context";

/**
 * Edit the three goal fields the Savings page shows, from the Savings page.
 *
 * Deliberately narrower than Budget's `upsertSavingsGoal`, which also writes
 * `start_cents` and the bucket link. This editor manages neither, so it reads
 * the stored `start_cents` and writes it back untouched rather than letting an
 * absent form field blank it — the same partial-editor trap that used to wipe
 * escrow and loan terms off a debt (see lib/save-debt.ts).
 *
 * `start_cents` matters less than it did — savings progress is now summed from
 * transactions inside the goal's period, and the opening balance is only a
 * fallback for goals with nothing logged yet — but silently zeroing a stored
 * value is still wrong.
 */
export async function updateSavingsGoalFields(formData: FormData) {
  const { supabase, household } = await getSessionContext();
  const subcategoryId = String(formData.get("subcategoryId") ?? "");
  if (!subcategoryId) return { error: "Missing goal." };

  const goalCents = displayToCents(String(formData.get("goal") ?? "0"));
  const monthlyCents = displayToCents(String(formData.get("monthly") ?? "0"));
  const targetDate = String(formData.get("targetDate") ?? "").trim() || null;

  if (goalCents < 0 || monthlyCents < 0) {
    return { error: "Amounts can't be negative." };
  }

  const { data: existing } = await supabase
    .from("savings_goals")
    .select("start_cents")
    .eq("household_id", household.id)
    .eq("subcategory_id", subcategoryId)
    .maybeSingle();

  const { error } = await supabase.from("savings_goals").upsert(
    {
      household_id: household.id,
      subcategory_id: subcategoryId,
      goal_cents: goalCents,
      monthly_contribution_cents: monthlyCents,
      target_date: targetDate,
      // Preserved, not managed here.
      start_cents: existing?.start_cents ?? 0,
    },
    { onConflict: "household_id,subcategory_id" },
  );
  if (error) return { error: "Couldn't save the goal." };

  revalidatePath("/savings");
  revalidatePath("/budget");
  return { error: null };
}
