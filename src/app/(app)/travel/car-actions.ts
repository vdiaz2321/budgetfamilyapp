"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth-context";
import { displayToCents } from "@/lib/money";
import { unwrap } from "@/lib/supabase-result";
import { centsPerPointToMicros } from "./points-value";
import { discardNewTrip, resolveTripId, tripDateError } from "./trip-resolve";
import { syncRewardLedger } from "./reward-ledger";
import { linkedPaidCents } from "./booking-payments";
import type { CarKind } from "./types";

function revalidate() {
  revalidatePath("/travel");
  revalidatePath("/accounts");
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTime = (value: string) => /^\d{2}:\d{2}(:\d{2})?$/.test(value);
const clean = (value: string | null | undefined) => (value ?? "").trim() || null;

export type CarPayload = {
  id: string | null;
  tripId: string;
  newTripName: string;
  kind: CarKind;
  company: string;
  bookingCode: string;
  reservedOn: string;
  pickupOn: string;
  pickupTime: string;
  pickupPlace: string;
  returnOn: string;
  returnTime: string;
  returnPlace: string;
  accountId: string;
  cardLabel: string;
  holder: string;
  /** Planned and Spent, each in dollars and `foreignCurrency`. */
  planned: string;
  plannedForeign: string;
  spent: string;
  spentForeign: string;
  foreignCurrency: string;
  pointsUsed: boolean;
  points: string;
  /** Typed in cents per point: "1.2" = 1.2¢. */
  pointsValueCents: string;
  remarks: string;
};


const carNote = (company: string | null, bookingCode: string | null) =>
  [company ?? "Car rental", bookingCode].filter(Boolean).join(" ");

export async function saveTravelCar(payload: CarPayload) {
  const { supabase, household } = await getSessionContext();
  // None picked: dollars only, so no second-currency figure is kept.
  const foreignCurrency = /^[A-Z]{3}$/.test(payload.foreignCurrency) ? payload.foreignCurrency : null;
  const householdId = household.id;

  const kind: CarKind = payload.kind === "own_car" ? "own_car" : "rental";
  const rental = kind === "rental";
  const company = rental ? clean(payload.company) : null;
  const bookingCode = rental ? clean(payload.bookingCode)?.toUpperCase() ?? null : null;
  const reservedOn = rental ? clean(payload.reservedOn) : null;
  const pickupOn = payload.pickupOn.trim();
  const returnOn = clean(payload.returnOn);
  const pickupTime = rental ? clean(payload.pickupTime) : null;
  const returnTime = rental ? clean(payload.returnTime) : null;
  const accountId = clean(payload.accountId);

  if (rental && !company) return { error: "Enter the rental company." };
  if (!isDate(pickupOn)) return { error: rental ? "Enter the pick-up date." : "Enter the date you leave." };
  if (returnOn && !isDate(returnOn)) return { error: "Enter a valid return date." };
  if (returnOn && returnOn < pickupOn) return { error: "The return date is before the start date — check the year." };
  if (reservedOn && !isDate(reservedOn)) return { error: "Enter a valid booking date." };
  if (reservedOn && pickupOn < reservedOn) {
    return { error: `The pick-up (${pickupOn}) is before the booking date (${reservedOn}) — check the year on both.` };
  }
  if ((pickupTime && !isTime(pickupTime)) || (returnTime && !isTime(returnTime))) return { error: "A time isn't valid." };

  const cents = (v: string) => (v.trim() ? Math.max(0, displayToCents(v)) : null);
  // Booked once a Spent figure or the booking date is in (isPlannedOnly in
  // travel-form); the family car is always a real drive.
  const isEstimate = rental && !payload.spent.trim() && !payload.spentForeign.trim() && !reservedOn;
  // Linked transactions set the pocket cost and mark it booked; a form save
  // keeps both rather than undoing what the payments did.
  const paid = payload.id ? await linkedPaidCents(supabase, householdId, "car", payload.id) : null;
  // The family car isn't paid for with points.
  const points = rental ? Math.max(0, Math.trunc(Number(payload.points.replace(/,/g, "")) || 0)) : 0;
  const pointsUsed = rental && payload.pointsUsed && points > 0;
  // The cost columns hold what it costs now — the plan until it is booked —
  // so every total that reads them is unchanged. Booked on points, its cost
  // is the Planned figure (what the points stood in for) and Spent is the
  // cash paid on top of the points.
  const cost = (isEstimate || pointsUsed ? cents(payload.planned) : cents(payload.spent)) ?? 0;
  const costForeign = isEstimate ? cents(payload.plannedForeign) : cents(payload.spentForeign);
  // Nothing leaves a card until a planned rental is booked.
  const drawPoints = pointsUsed && (!isEstimate || paid != null) ? points : 0;
  // What left the wallet: the cost, or on points only the cash paid on top.
  // Linked transactions replace it (see `paid`).
  const pocketCost = pointsUsed ? (isEstimate ? 0 : cents(payload.spent) ?? 0) : cost;
  const pointsValueMicros =
    centsPerPointToMicros(payload.pointsValueCents) ?? (points > 0 && cost > 0 ? Math.round((cost / points) * 10_000) : null);

  const trip = await resolveTripId(supabase, householdId, payload.tripId, payload.newTripName);
  if (trip.error) return { error: trip.error };
  // A trip this save just created goes away again if the save fails.
  const fail = async (error: string) => {
    await discardNewTrip(supabase, householdId, trip);
    return { error };
  };
  const dateError = await tripDateError(supabase, householdId, trip, [pickupOn, returnOn], "The pick-up or return date");
  if (dateError) return fail(dateError);

  const row = {
    household_id: householdId,
    trip_id: trip.tripId,
    kind,
    company,
    booking_code: bookingCode,
    reserved_on: reservedOn,
    pickup_on: pickupOn,
    pickup_time: pickupTime,
    pickup_place: clean(payload.pickupPlace),
    return_on: returnOn,
    return_time: returnTime,
    return_place: clean(payload.returnPlace),
    account_id: accountId,
    card_label: clean(payload.cardLabel),
    holder: clean(payload.holder),
    points_cost: points,
    points_used: pointsUsed,
    points_value_micros: points > 0 ? pointsValueMicros : null,
    cost_cents: cost,
    cost_eur_cents: foreignCurrency ? costForeign : null,
    pocket_cost_cents: paid ?? pocketCost,
    is_estimate: isEstimate && paid == null,
    foreign_currency: foreignCurrency,
    // While a plan, its cost is the plan; once booked, the Planned figure
    // stays beside what was paid.
    planned_cost_cents: isEstimate ? pocketCost : cents(payload.planned),
    planned_cost_foreign_cents: foreignCurrency ? cents(payload.plannedForeign) : null,
    remarks: clean(payload.remarks),
    updated_at: new Date().toISOString(),
  };
  const meta = { occurredOn: reservedOn || pickupOn, bookedOn: null, note: carNote(company, bookingCode) };

  if (payload.id) {
    const prev = unwrap(
      await supabase
        .from("travel_cars")
        .select("account_id, points_cost, points_used, cancelled_at, reward_activity_id, moves_card_points, is_estimate")
        .eq("id", payload.id)
        .eq("household_id", householdId)
        .maybeSingle(),
      "travel_cars",
    );
    if (!prev) return fail("That car was not found.");
    const sync = prev.moves_card_points
      ? await syncRewardLedger(
          supabase,
          householdId,
          { accountId: prev.account_id, points: prev.cancelled_at || prev.is_estimate || !prev.points_used ? 0 : prev.points_cost ?? 0, credit: 0 },
          { accountId, points: prev.cancelled_at ? 0 : drawPoints, credit: 0 },
          meta,
          prev.reward_activity_id,
          "car_booking",
        )
      : { error: null, activityId: prev.reward_activity_id };
    if (sync.error) return fail(sync.error);
    const { error } = await supabase
      .from("travel_cars")
      // Payments still linked: keep what unlinking them would restore.
      .update({ ...row, reward_activity_id: sync.activityId, ...(paid == null ? { payment_restore: null } : {}) })
      .eq("id", payload.id)
      .eq("household_id", householdId);
    if (error) return fail(`Couldn't save that car — ${error.message}`);
  } else {
    const sync = await syncRewardLedger(
      supabase,
      householdId,
      { accountId, points: 0, credit: 0 },
      { accountId, points: drawPoints, credit: 0 },
      meta,
      null,
      "car_booking",
    );
    if (sync.error) return fail(sync.error);
    const { error } = await supabase.from("travel_cars").insert({ ...row, reward_activity_id: sync.activityId });
    if (error) return fail(`Couldn't save that car — ${error.message}`);
  }

  revalidate();
  return { error: null };
}

async function loadCar(id: string) {
  const { supabase, household } = await getSessionContext();
  const car = unwrap(
    await supabase
      .from("travel_cars")
      .select("account_id, points_cost, points_used, cancelled_at, reward_activity_id, company, booking_code, reserved_on, pickup_on, moves_card_points, is_estimate")
      .eq("id", id)
      .eq("household_id", household.id)
      .maybeSingle(),
    "travel_cars",
  );
  return { supabase, householdId: household.id, car };
}

export async function deleteTravelCar(id: string) {
  const { supabase, householdId, car } = await loadCar(id);
  if (!car) return { error: "That car was not found." };
  if (car.moves_card_points && !car.cancelled_at && !car.is_estimate && car.points_used && car.points_cost) {
    const sync = await syncRewardLedger(
      supabase,
      householdId,
      { accountId: car.account_id, points: car.points_cost, credit: 0 },
      { accountId: car.account_id, points: 0, credit: 0 },
      { occurredOn: car.reserved_on ?? car.pickup_on, bookedOn: null, note: carNote(car.company, car.booking_code) },
      car.reward_activity_id,
      "car_booking",
    );
    if (sync.error) return { error: sync.error };
  }
  const { error } = await supabase.from("travel_cars").delete().eq("id", id).eq("household_id", householdId);
  if (error) return { error: `Couldn't delete that car — ${error.message}` };
  revalidate();
  return { error: null };
}

export async function setTravelCarCancelled(id: string, cancelled: boolean) {
  const { supabase, householdId, car } = await loadCar(id);
  if (!car) return { error: "That car was not found." };
  if (Boolean(car.cancelled_at) === cancelled) return { error: null };

  let activityId = car.reward_activity_id;
  if (car.moves_card_points && !car.is_estimate && car.points_used && car.points_cost) {
    const none = { accountId: car.account_id, points: 0, credit: 0 };
    const full = { accountId: car.account_id, points: car.points_cost, credit: 0 };
    const sync = await syncRewardLedger(
      supabase,
      householdId,
      cancelled ? full : none,
      cancelled ? none : full,
      { occurredOn: car.reserved_on ?? car.pickup_on, bookedOn: null, note: carNote(car.company, car.booking_code) },
      car.reward_activity_id,
      "car_booking",
    );
    if (sync.error) return { error: sync.error };
    activityId = sync.activityId;
  }
  const { error } = await supabase
    .from("travel_cars")
    .update({ cancelled_at: cancelled ? new Date().toISOString() : null, reward_activity_id: activityId, payment_restore: null })
    .eq("id", id)
    .eq("household_id", householdId);
  if (error) return { error: `Couldn't update that booking — ${error.message}` };
  revalidate();
  return { error: null };
}
