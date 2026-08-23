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

/**
 * Record the IRS contribution caps for a tax year, from the Savings page.
 *
 * These are federal figures published each autumn. Storing them here means a
 * new tax year no longer needs a code change — the card would otherwise go
 * blank on 1 January of any year not compiled into
 * lib/contribution-limits.ts.
 *
 * Validated rather than trusted: a mistyped cap silently rewrites every pace
 * figure on the card, so the amounts have to be positive and inside a range
 * that a real IRS limit could plausibly occupy. The year is bounded too — a
 * typo like 20267 would file the caps under a year nothing ever reads.
 */
export async function saveContributionCaps(formData: FormData) {
  const { supabase, household } = await getSessionContext();

  const taxYear = Number(formData.get("taxYear"));
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(taxYear) || taxYear < currentYear - 1 || taxYear > currentYear + 2) {
    return { error: "That tax year looks wrong." };
  }

  const electiveDeferralCents = displayToCents(String(formData.get("electiveDeferral") ?? "0"));
  const iraCents = displayToCents(String(formData.get("ira") ?? "0"));

  // Wide enough to never argue with a real figure, tight enough to catch a
  // decimal-point slip (750 or 75000 instead of 7500).
  if (electiveDeferralCents < 1000000 || electiveDeferralCents > 10000000) {
    return { error: "The elective deferral cap looks wrong — check the IRS page." };
  }
  if (iraCents < 300000 || iraCents > 5000000) {
    return { error: "The IRA cap looks wrong — check the IRS page." };
  }

  const { error } = await supabase.from("contribution_caps").upsert(
    {
      household_id: household.id,
      tax_year: taxYear,
      elective_deferral_cents: electiveDeferralCents,
      ira_cents: iraCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,tax_year" },
  );
  if (error) return { error: "Couldn't save the caps." };

  revalidatePath("/savings");
  return { error: null };
}
