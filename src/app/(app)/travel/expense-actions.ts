"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth-context";
import { displayToCents } from "@/lib/money";
import { discardNewTrip, resolveTripId } from "./trip-resolve";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./types";

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const money = (raw: string) => (raw.trim() ? Math.max(0, displayToCents(raw)) : null);
const KEYS = new Set<string>(EXPENSE_CATEGORIES.map((c) => c.key));

export type ExpensePayload = {
  tripId: string;
  newTripName: string;
  startOn: string;
  endOn: string;
  /** The currency the second Planned / Spent columns are in. */
  foreignCurrency: string;
  rows: Array<{
    category: ExpenseCategory;
    planned: string;
    plannedEur: string;
    actual: string;
    actualEur: string;
    accountId: string;
  }>;
};

/**
 * Saves a trip's Misc spending: one total per category for the whole trip,
 * plus the trip's own dates (the span those totals cover). A category with
 * nothing typed in it is removed rather than kept as a row of blanks.
 */
export async function saveTripExpenses(payload: ExpensePayload) {
  const { supabase, household } = await getSessionContext();
  const householdId = household.id;

  if (!payload.tripId && !payload.newTripName.trim()) {
    return { error: "Pick the trip this spending belongs to, or name a new one." };
  }
  const startOn = payload.startOn.trim() || null;
  const endOn = payload.endOn.trim() || null;
  if ((startOn && !isDate(startOn)) || (endOn && !isDate(endOn))) return { error: "Enter valid trip dates." };
  if (startOn && endOn && endOn < startOn) return { error: "The trip ends before it starts — check the year." };

  const trip = await resolveTripId(supabase, householdId, payload.tripId, payload.newTripName);
  if (trip.error || !trip.tripId) return { error: trip.error ?? "That trip was not found." };
  const fail = async (error: string) => {
    await discardNewTrip(supabase, householdId, trip);
    return { error };
  };

  const { error: tripError } = await supabase
    .from("travel_trips")
    .update({
      start_on: startOn,
      end_on: endOn,
      ...(/^[A-Z]{3}$/.test(payload.foreignCurrency) ? { spending_currency: payload.foreignCurrency } : {}),
    })
    .eq("id", trip.tripId)
    .eq("household_id", householdId);
  if (tripError) return fail(`Couldn't save the trip dates — ${tripError.message}`);

  const rows = payload.rows
    .filter((r) => KEYS.has(r.category))
    .map((r) => ({
      household_id: householdId,
      trip_id: trip.tripId,
      category: r.category,
      planned_cents: money(r.planned),
      planned_eur_cents: money(r.plannedEur),
      actual_cents: money(r.actual),
      actual_eur_cents: money(r.actualEur),
      account_id: r.accountId || null,
      updated_at: new Date().toISOString(),
    }));
  const filled = rows.filter((r) => [r.planned_cents, r.planned_eur_cents, r.actual_cents, r.actual_eur_cents].some((v) => v != null));
  const emptied = rows.filter((r) => !filled.includes(r)).map((r) => r.category);

  if (filled.length) {
    const { error } = await supabase.from("travel_trip_expenses").upsert(filled, { onConflict: "trip_id,category" });
    if (error) return fail(`Couldn't save that spending — ${error.message}`);
  }
  if (emptied.length) {
    const { error } = await supabase
      .from("travel_trip_expenses")
      .delete()
      .eq("trip_id", trip.tripId)
      .eq("household_id", householdId)
      .in("category", emptied);
    if (error) return fail(`Couldn't clear the emptied categories — ${error.message}`);
  }

  revalidatePath("/travel");
  return { error: null };
}
