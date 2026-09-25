"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { unwrap } from "@/lib/supabase-result";
import { centsPerPointToMicros } from "./points-value";
import { syncFreeNightStamp, syncRewardLedger, type RewardDraw } from "./reward-ledger";
import { discardNewTrip, resolveTripId, tripDateError } from "./trip-resolve";

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
const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim() || null;
const int = (formData: FormData, key: string) =>
  Math.max(0, Math.trunc(Number(String(formData.get(key) ?? "0").replace(/,/g, "")) || 0));



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
  // Points only leave a card when they were actually redeemed. On a stay
  // recorded to compare against cash, the figure is a what-if and must not
  // reach the reward ledger.
  // A free night is paid by the certificate, so its points figure is only
  // ever a what-if — the two can't both be true.
  const freeNightUsed = formData.get("freeNightUsed") === "on";
  const freeNightPoints = int(formData, "freeNightPoints") || null;
  const pointsUsed = formData.get("pointsUsed") === "on" && pointsCost > 0 && !freeNightUsed;
  const money = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v ? Math.max(0, displayToCents(v)) : null;
  };
  // Booked once a Spent figure or the reservation date is in (isPlannedOnly
  // in travel-form); a plan until then. A plan takes nothing — points, night
  // credit or certificate — off a card.
  const isEstimate = money("pocketCost") == null && money("spentForeign") == null && !reservedOn;
  const plannedCost = money("plannedCost");
  const pointsDrawn = pointsUsed && !isEstimate ? pointsCost : 0;
  const hotelCredit = Math.max(0, displayToCents(String(formData.get("hotelCredit") ?? "0")));
  const creditDrawn = isEstimate ? 0 : hotelCredit;
  const certificateUsed = freeNightUsed && !isEstimate;
  // The pocket column holds what the stay costs now — the plan until it is
  // booked — so every total that reads it is unchanged.
  const pocketCost = (isEstimate ? plannedCost : money("pocketCost")) ?? 0;
  const foreignCurrency = String(formData.get("foreignCurrency") ?? "");

  // How the out-of-pocket half was settled is not a choice any more: it is
  // whatever the numbers say. Money paid means the card; nothing paid means
  // the points or the night credit covered it.
  const pocketPaidWith =
    pocketCost > 0 ? "card" : pointsDrawn > 0 || freeNightUsed ? "points" : hotelCredit > 0 ? "credit" : "card";

  if (!propertyName) return { error: "Enter the hotel or apartment name." };
  if (!isDate(checkIn)) return { error: "Enter a valid check-in date." };
  if (reservedOn && !isDate(reservedOn)) return { error: "Enter a valid reservation date." };
  // You cannot check in before you booked. Without this the usual slip — a
  // check-in typed with last year's year — saves silently and then lands the
  // stay in the wrong year's totals and out of "Coming up".
  if (reservedOn && checkIn < reservedOn) {
    return {
      error: `Check-in (${checkIn}) is before the reservation date (${reservedOn}) — check the year on both.`,
    };
  }

  // Absent from the form (the stay form opened from Accounts has no trip
  // picker), the trip is left as it was rather than cleared.
  const tripField = formData.has("tripId") || formData.has("newTripName");
  const trip = tripField
    ? await resolveTripId(supabase, householdId, text(formData, "tripId"), text(formData, "newTripName"))
    : { tripId: null, error: null };
  if (trip.error) return { error: trip.error };
  // A trip this save just created goes away again if the save fails.
  const fail = async (error: string) => {
    await discardNewTrip(supabase, householdId, trip);
    return { error };
  };
  const dateError = await tripDateError(supabase, householdId, trip, [checkIn], `The check-in (${checkIn})`);
  if (dateError) return fail(dateError);

  const row = {
    household_id: householdId,
    ...(tripField ? { trip_id: trip.tripId } : {}),
    account_id: accountId,
    card_label: text(formData, "cardLabel"),
    holder: text(formData, "holder"),
    property_name: propertyName,
    city: text(formData, "city"),
    brand: text(formData, "brand"),
    reserved_on: reservedOn || null,
    check_in: checkIn,
    nights,
    pax: paxRaw > 0 ? paxRaw : null,
    points_value_micros: centsPerPointToMicros(String(formData.get("pointsValueCents") ?? "")),
    hotel_credit_cents: hotelCredit,
    hotel_cost_cents: Math.max(0, displayToCents(String(formData.get("hotelCost") ?? "0"))),
    pocket_cost_cents: pocketCost,
    points_cost: pointsCost,
    points_used: pointsUsed,
    pocket_paid_with: pocketPaidWith,
    is_estimate: isEstimate,
    // While planned, its cost is the plan; once booked, the Planned figure
    // stays beside what was paid.
    planned_cost_cents: isEstimate ? pocketCost : plannedCost,
    planned_cost_foreign_cents: money("plannedCostForeign"),
    cost_foreign_cents: isEstimate ? money("plannedCostForeign") : money("spentForeign"),
    // Absent from a form that doesn't offer it; the column's default holds.
    ...(/^[A-Z]{3}$/.test(foreignCurrency) ? { foreign_currency: foreignCurrency } : {}),
    remarks: text(formData, "remarks"),
    breakfast_included: formData.get("breakfastIncluded") === "on",
    free_night_used: freeNightUsed,
    free_night_points: freeNightUsed ? freeNightPoints : null,
    updated_at: new Date().toISOString(),
  };

  // ---- Editing an existing stay. Points, hotel credit and the card can all
  // change now; the ledger is handed the difference so the card's balance
  // follows the edit instead of drifting away from it.
  if (id) {
    const prev = unwrap(
      await supabase
        .from("travel_stays")
        .select("account_id, check_in, points_cost, points_used, hotel_credit_cents, cancelled_at, reward_activity_id, moves_card_points, free_night_used, is_estimate")
        .eq("id", id)
        .eq("household_id", householdId)
        .maybeSingle(),
      "travel_stays",
    );
    if (!prev) return fail("That stay was not found.");

    // A cancelled stay has already handed everything back, so it starts from
    // zero and editing it draws again.
    const before: RewardDraw = prev.cancelled_at || prev.is_estimate
      ? { accountId: prev.account_id, points: 0, credit: 0 }
      : {
          accountId: prev.account_id,
          points: prev.points_used ? prev.points_cost ?? 0 : 0,
          credit: prev.hotel_credit_cents ?? 0,
        };

    // Imported stays never took their points off a card, so editing one
    // fixes the record only — see 20260913140000.
    let activityId = prev.reward_activity_id;
    if (prev.moves_card_points) {
      const sync = await syncRewardLedger(
        supabase,
        householdId,
        before,
        { accountId, points: pointsDrawn, credit: creditDrawn },
        { occurredOn: reservedOn || checkIn, bookedOn: checkIn, note: propertyName },
        prev.reward_activity_id,
      );
      if (sync.error) return fail(sync.error);
      activityId = sync.activityId;
    }

    const { error } = await supabase
      .from("travel_stays")
      .update({ ...row, reward_activity_id: activityId, payment_restore: null })
      .eq("id", id)
      .eq("household_id", householdId);
    if (error) {
      console.error("[saveTravelStay:update]", error);
      return fail(`Couldn't save that stay — ${error.message}`);
    }
    // A cancelled stay holds no certificate until it is restored.
    const stampError = await syncFreeNightStamp(
      supabase,
      householdId,
      prev.free_night_used && !prev.cancelled_at && !prev.is_estimate ? { accountId: prev.account_id, checkIn: prev.check_in } : null,
      certificateUsed && !prev.cancelled_at ? { accountId, checkIn } : null,
    );
    if (stampError) return fail(stampError);
    revalidate();
    return { error: null };
  }

  // ---- New stay. Points and hotel credit come off the card through the same
  // ledger, so a stay and the card balance can never disagree.
  const sync = await syncRewardLedger(
    supabase,
    householdId,
    { accountId, points: 0, credit: 0 },
    { accountId, points: pointsDrawn, credit: creditDrawn },
    { occurredOn: reservedOn || checkIn, bookedOn: checkIn, note: propertyName },
  );
  if (sync.error) return fail(sync.error);

  const { error } = await supabase
    .from("travel_stays")
    .insert({ ...row, reward_activity_id: sync.activityId ?? null, moves_card_points: true });
  if (error) {
    console.error("[saveTravelStay:insert]", error);
    return fail(`Couldn't save that stay — ${error.message}`);
  }
  if (certificateUsed) {
    const stampError = await syncFreeNightStamp(supabase, householdId, null, { accountId, checkIn });
    if (stampError) return fail(stampError);
  }
  revalidate();
  return { error: null };
}

// Removes the reservation from the log entirely, and hands back whatever it
// had drawn from a card — a deleted stay never happened. (To keep a booking
// on record but out of the totals, cancel it instead.)
export async function deleteTravelStay(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "That stay was not found." };

  const stay = unwrap(
    await supabase
      .from("travel_stays")
      .select("account_id, points_cost, points_used, hotel_credit_cents, cancelled_at, property_name, check_in, reserved_on, reward_activity_id, moves_card_points, free_night_used, is_estimate")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "travel_stays",
  );
  if (!stay) return { error: "That stay was not found." };

  // A planned stay drew nothing, so deleting it hands nothing back.
  if (!stay.cancelled_at && !stay.is_estimate && stay.free_night_used) {
    const stampError = await syncFreeNightStamp(
      supabase,
      householdId,
      { accountId: stay.account_id, checkIn: stay.check_in },
      null,
    );
    if (stampError) return { error: stampError };
  }
  if (!stay.cancelled_at && !stay.is_estimate && stay.moves_card_points) {
    const sync = await syncRewardLedger(
      supabase,
      householdId,
      {
        accountId: stay.account_id,
        points: stay.points_used ? stay.points_cost ?? 0 : 0,
        credit: stay.hotel_credit_cents ?? 0,
      },
      { accountId: stay.account_id, points: 0, credit: 0 },
      {
        occurredOn: stay.reserved_on ?? stay.check_in,
        bookedOn: null,
        note: stay.property_name,
      },
      stay.reward_activity_id,
    );
    if (sync.error) return { error: sync.error };
  }

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

// ---- The "Booked thru / Brand" list behind the stay form's picker. It is a
// table rather than the distinct values already in travel_stays so a brand can
// exist before its first stay, and so a typo can be deleted outright.
export async function addTravelBrand(name: string) {
  const { supabase, householdId } = await requireHousehold();
  const clean = name.trim();
  if (!clean) return { error: "Type a name first." };

  const { error } = await supabase
    .from("travel_brands")
    .insert({ household_id: householdId, name: clean });
  if (error) {
    console.error("[addTravelBrand]", error);
    // The unique index is case-insensitive, so this is the "already there" case.
    if (error.code === "23505") return { error: `${clean} is already on the list.` };
    return { error: `Couldn't add that — ${error.message}` };
  }
  revalidate();
  return { error: null };
}

// Deleting a brand only removes it from the picker: stays already tagged with
// it keep the name they were saved with.
export async function deleteTravelBrand(id: string) {
  const { supabase, householdId } = await requireHousehold();
  if (!id) return { error: "That brand was not found." };

  const { error } = await supabase
    .from("travel_brands")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);
  if (error) {
    console.error("[deleteTravelBrand]", error);
    return { error: `Couldn't delete that — ${error.message}` };
  }
  revalidate();
  return { error: null };
}

// Cancelling keeps the reservation in the archive and takes it out of every
// total. The points and the night credit go back to the card, because the room
// was never actually taken; restoring draws them again.
export async function setTravelStayCancelled(id: string, cancelled: boolean) {
  const { supabase, householdId } = await requireHousehold();
  if (!id) return { error: "That stay was not found." };

  const stay = unwrap(
    await supabase
      .from("travel_stays")
      .select("account_id, points_cost, points_used, hotel_credit_cents, cancelled_at, property_name, check_in, reserved_on, reward_activity_id, moves_card_points, free_night_used, is_estimate")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "travel_stays",
  );
  if (!stay) return { error: "That stay was not found." };
  if (Boolean(stay.cancelled_at) === cancelled) return { error: null };

  const drawn = {
    points: stay.points_used ? stay.points_cost ?? 0 : 0,
    credit: stay.hotel_credit_cents ?? 0,
  };
  const none = { accountId: stay.account_id, points: 0, credit: 0 };
  const full = { accountId: stay.account_id, ...drawn };

  let activityId = stay.reward_activity_id;
  // A planned stay draws nothing, so cancelling or restoring moves nothing.
  if (stay.moves_card_points && !stay.is_estimate) {
    const sync = await syncRewardLedger(
      supabase,
      householdId,
      cancelled ? full : none,
      cancelled ? none : full,
      {
        occurredOn: stay.reserved_on ?? stay.check_in,
        bookedOn: cancelled ? null : stay.check_in,
        note: stay.property_name,
      },
      stay.reward_activity_id,
    );
    if (sync.error) return { error: sync.error };
    activityId = sync.activityId;
  }
  if (stay.free_night_used && !stay.is_estimate) {
    const stamp = { accountId: stay.account_id, checkIn: stay.check_in };
    const stampError = await syncFreeNightStamp(
      supabase,
      householdId,
      cancelled ? stamp : null,
      cancelled ? null : stamp,
    );
    if (stampError) return { error: stampError };
  }

  const { error } = await supabase
    .from("travel_stays")
    .update({ cancelled_at: cancelled ? new Date().toISOString() : null, reward_activity_id: activityId, payment_restore: null })
    .eq("id", id)
    .eq("household_id", householdId);
  if (error) {
    console.error("[setTravelStayCancelled]", error);
    return { error: `Couldn't update that booking — ${error.message}` };
  }
  revalidate();
  return { error: null };
}

// ---- Linking the imported history to real cards. The CC Info column came
// over as free text ("Hilton Aspire", "Chase IHG"), so a stay knows which card
// paid for it but the app doesn't. This assigns a real account to every stay
// carrying a given label.
//
// It deliberately writes NO reward-ledger entries: these stays were paid for
// years ago and the card balances already reflect them. Linking is about
// reporting, not about spending points again.
export async function linkTravelCardLabels(
  mappings: Array<{ label: string; accountId: string | null }>,
) {
  const { supabase, householdId } = await requireHousehold();
  if (mappings.length === 0) return { error: null, linked: 0 };

  let linked = 0;
  for (const { label, accountId } of mappings) {
    const clean = label.trim();
    if (!clean) continue;

    const { data, error } = await supabase
      .from("travel_stays")
      .update({ account_id: accountId || null, payment_restore: null })
      .eq("household_id", householdId)
      .eq("card_label", clean)
      .select("id");
    if (error) {
      console.error("[linkTravelCardLabels]", error);
      return { error: `Couldn't link ${clean} — ${error.message}` };
    }
    linked += data?.length ?? 0;
  }

  revalidate();
  return { error: null, linked };
}
