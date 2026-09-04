"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { unwrap } from "@/lib/supabase-result";

async function requireHousehold() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load your profile: ${error.message}`);
  if (!profile) redirect("/onboarding");

  return { supabase, householdId: profile.household_id };
}

function revalidate() {
  revalidatePath("/travel");
  // A points redemption changes the card balances shown on Accounts.
  revalidatePath("/accounts");
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim() || null;
const int = (formData: FormData, key: string) =>
  Math.max(0, Math.trunc(Number(String(formData.get(key) ?? "0").replace(/,/g, "")) || 0));

// Dollars-per-point typed as "0.006" -> 6000 micros. Kept in one place so the
// stay form and the card's own valuation stay on the same scale.
function dollarsToMicros(raw: string): number | null {
  const value = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1_000_000);
}

export async function saveTravelStay(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();

  const id = String(formData.get("id") ?? "").trim() || null;
  const propertyName = text(formData, "propertyName");
  const checkIn = String(formData.get("checkIn") ?? "").trim();
  const reservedOn = String(formData.get("reservedOn") ?? "").trim();
  const accountId = String(formData.get("accountId") ?? "").trim() || null;
  const nights = Math.max(1, int(formData, "nights") || 1);
  const paxRaw = int(formData, "pax");
  const pointsCost = int(formData, "pointsCost");
  const pocketPaidWith = String(formData.get("pocketPaidWith") ?? "cash");

  if (!propertyName) return { error: "Enter the hotel or apartment name." };
  if (!isDate(checkIn)) return { error: "Enter a valid check-in date." };
  if (reservedOn && !isDate(reservedOn)) return { error: "Enter a valid reservation date." };
  if (!["cash", "points", "credit", "tbd"].includes(pocketPaidWith)) {
    return { error: "Choose how the out-of-pocket cost was paid." };
  }

  const row = {
    household_id: householdId,
    account_id: accountId,
    card_label: text(formData, "cardLabel"),
    holder: text(formData, "holder"),
    property_name: propertyName,
    city: text(formData, "city"),
    brand: text(formData, "brand"),
    booking_channel: text(formData, "bookingChannel"),
    reserved_on: reservedOn || null,
    check_in: checkIn,
    nights,
    pax: paxRaw > 0 ? paxRaw : null,
    points_value_micros: dollarsToMicros(String(formData.get("pointsValue") ?? "")),
    hotel_credit_cents: Math.max(0, displayToCents(String(formData.get("hotelCredit") ?? "0"))),
    hotel_cost_cents: Math.max(0, displayToCents(String(formData.get("hotelCost") ?? "0"))),
    pocket_cost_cents: Math.max(0, displayToCents(String(formData.get("pocketCost") ?? "0"))),
    pocket_paid_with: pocketPaidWith,
    remarks: text(formData, "remarks"),
    updated_at: new Date().toISOString(),
  };

  // ---- Editing an existing stay.
  // The points cost and the card are frozen after the first save: the points
  // have already been taken off the card's balance by the reward ledger, and
  // this table is not the place to reverse a redemption. Everything else about
  // the stay stays editable.
  if (id) {
    const { error } = await supabase
      .from("travel_stays")
      .update(row)
      .eq("id", id)
      .eq("household_id", householdId);
    if (error) {
      console.error("[saveTravelStay:update]", error);
      return { error: `Couldn't save that stay — ${error.message}` };
    }
    revalidate();
    return { error: null };
  }

  // ---- New stay. Points AND hotel credit come off the card through the
  // existing reward ledger, so a stay and the card balance can never disagree.
  // Either one on its own is enough to write the ledger entry: a stay that
  // burns only a night credit still has to lower that credit.
  let rewardActivityId: string | null = null;
  const spendsReward = accountId && (pointsCost > 0 || row.hotel_credit_cents > 0);
  if (spendsReward) {
    const details = unwrap(
      await supabase
        .from("credit_card_details")
        .select("current_points, free_night_credit_cents")
        .eq("account_id", accountId)
        .eq("household_id", householdId)
        .maybeSingle(),
      "credit_card_details",
    );
    if (!details) return { error: "That card has no rewards details to draw from." };
    if (pointsCost > (details.current_points ?? 0)) {
      return {
        error: `That card only has ${(details.current_points ?? 0).toLocaleString()} points available.`,
      };
    }
    if (row.hotel_credit_cents > (details.free_night_credit_cents ?? 0)) {
      return {
        error: `That card only has ${formatCents(details.free_night_credit_cents ?? 0)} of hotel credit available.`,
      };
    }

    const { data: activity, error: activityError } = await supabase
      .from("credit_card_reward_activities")
      .insert({
        household_id: householdId,
        account_id: accountId,
        // A stay that spends no points is a plain credit redemption; the
        // ledger's own filters read these two types differently.
        activity_type: pointsCost > 0 ? "free_night_booking" : "hotel_credit_redemption",
        occurred_on: reservedOn || checkIn,
        points_delta: -pointsCost,
        hotel_credit_delta_cents: -row.hotel_credit_cents,
        booked_on: checkIn,
        note: propertyName,
      })
      .select("id")
      .single();
    if (activityError) {
      console.error("[saveTravelStay:activity]", activityError);
      return { error: `Couldn't draw that from the card — ${activityError.message}` };
    }
    rewardActivityId = activity.id;
  }

  const { error } = await supabase
    .from("travel_stays")
    .insert({ ...row, points_cost: pointsCost, reward_activity_id: rewardActivityId });
  if (error) {
    console.error("[saveTravelStay:insert]", error);
    return { error: `Couldn't save that stay — ${error.message}` };
  }
  revalidate();
  return { error: null };
}

// Removes the reservation from the log. A linked points redemption is left
// alone on the card's ledger — the points really were spent, and the reward
// ledger has never reversed a redemption.
export async function deleteTravelStay(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "That stay was not found." };

  const { error } = await supabase
    .from("travel_stays")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);
  if (error) {
    console.error("[deleteTravelStay]", error);
    return { error: `Couldn't delete that stay — ${error.message}` };
  }
  revalidate();
  return { error: null };
}
