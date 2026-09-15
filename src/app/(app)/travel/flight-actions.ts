"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth-context";
import { displayToCents } from "@/lib/money";
import { unwrap } from "@/lib/supabase-result";
import { resolveTripId } from "./trip-resolve";
import { syncRewardLedger, type RewardDraw } from "./reward-ledger";

function revalidate() {
  revalidatePath("/travel");
  // Points spent on a flight change the card balances shown on Accounts.
  revalidatePath("/accounts");
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTime = (value: string) => /^\d{2}:\d{2}(:\d{2})?$/.test(value);
const clean = (value: string | null | undefined) => (value ?? "").trim() || null;

// The form posts its whole state as one object rather than FormData: a booking
// carries a list of legs and a list of passengers, which flat form fields
// express badly.
export type FlightPayload = {
  id: string | null;
  tripId: string;
  newTripName: string;
  airline: string;
  bookingCode: string;
  reservedOn: string;
  accountId: string;
  cardLabel: string;
  holder: string;
  pointsValue: string;
  pocketCost: string;
  remarks: string;
  legs: Array<{
    flightOn: string;
    flightNumber: string;
    fromPlace: string;
    toPlace: string;
    departsAt: string;
    arrivesAt: string;
  }>;
  passengers: Array<{ travellerId: string | null; name: string; fare: string; fareEur: string; pointsUsed: boolean; points: string }>;
};

function dollarsToMicros(raw: string): number | null {
  const value = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1_000_000);
}

const flightNote = (airline: string, bookingCode: string | null) =>
  bookingCode ? `${airline} ${bookingCode}` : airline;

export async function saveTravelFlight(payload: FlightPayload) {
  const { supabase, household } = await getSessionContext();
  const householdId = household.id;

  const airline = clean(payload.airline);
  const bookingCode = clean(payload.bookingCode)?.toUpperCase() ?? null;
  const reservedOn = clean(payload.reservedOn);
  const accountId = clean(payload.accountId);

  // A leg with nothing typed in it is a row the form left open, not a flight.
  const legs = payload.legs
    .map((leg) => ({
      flightOn: leg.flightOn.trim(),
      flightNumber: clean(leg.flightNumber)?.toUpperCase() ?? null,
      fromPlace: clean(leg.fromPlace),
      toPlace: clean(leg.toPlace),
      departsAt: clean(leg.departsAt),
      arrivesAt: clean(leg.arrivesAt),
    }))
    .filter((leg) => leg.flightOn || leg.flightNumber || leg.fromPlace || leg.toPlace);
  const passengers = payload.passengers
    .map((p) => {
      const points = Math.max(0, Math.trunc(Number(p.points.replace(/,/g, "")) || 0));
      return {
        travellerId: p.travellerId || null,
        name: p.name.trim(),
        fareCents: Math.max(0, displayToCents(p.fare)),
        fareEurCents: p.fareEur.trim() ? Math.max(0, displayToCents(p.fareEur)) : null,
        // A ticket is on points only when it has points on it.
        pointsUsed: p.pointsUsed && points > 0,
        pointsCost: p.pointsUsed ? points : 0,
      };
    })
    .filter((p) => p.name);

  if (!airline) return { error: "Enter the airline." };
  if (reservedOn && !isDate(reservedOn)) return { error: "Enter a valid booking date." };
  if (legs.length === 0) return { error: "Add at least one flight." };
  for (const [i, leg] of legs.entries()) {
    if (!isDate(leg.flightOn)) return { error: `Flight ${i + 1} needs a date.` };
    if ((leg.departsAt && !isTime(leg.departsAt)) || (leg.arrivesAt && !isTime(leg.arrivesAt))) {
      return { error: `Flight ${i + 1} has a time that isn't valid.` };
    }
  }
  if (passengers.length === 0) return { error: "Add at least one passenger." };

  // Flights are listed in date order however they were typed.
  legs.sort((a, b) => (a.flightOn + (a.departsAt ?? "")).localeCompare(b.flightOn + (b.departsAt ?? "")));
  const firstFlightOn = legs[0].flightOn;
  // Same slip the stay form catches: a flight typed with last year's year.
  if (reservedOn && firstFlightOn < reservedOn) {
    return { error: `The first flight (${firstFlightOn}) is before the booking date (${reservedOn}) — check the year on both.` };
  }

  // The booking's points are its points tickets added up.
  const pointsCost = passengers.reduce((sum, p) => sum + (p.pointsUsed ? p.pointsCost : 0), 0);
  const pointsUsed = pointsCost > 0;
  const flightCost = passengers.reduce((sum, p) => sum + p.fareCents, 0);
  const pointsFares = passengers.reduce((sum, p) => sum + (p.pointsUsed ? p.fareCents : 0), 0);
  // Left blank, what came out of pocket is the cash tickets' fares. Typed, it
  // is whatever was typed (adding the taxes on an award ticket, say).
  const pocketCost = payload.pocketCost.trim()
    ? Math.max(0, displayToCents(payload.pocketCost))
    : flightCost - pointsFares;
  // Typed, the rate is what was typed; blank, it is what the points tickets
  // would have cost in cash divided by the points they took.
  const pointsValueMicros =
    dollarsToMicros(payload.pointsValue) ??
    (pointsCost > 0 && pointsFares > 0 ? Math.round((pointsFares / pointsCost) * 10_000) : null);

  const trip = await resolveTripId(supabase, householdId, payload.tripId, payload.newTripName);
  if (trip.error) return { error: trip.error };

  const row = {
    household_id: householdId,
    trip_id: trip.tripId,
    account_id: accountId,
    card_label: clean(payload.cardLabel),
    holder: clean(payload.holder),
    airline,
    booking_code: bookingCode,
    reserved_on: reservedOn,
    first_flight_on: firstFlightOn,
    points_cost: pointsCost,
    points_used: pointsUsed,
    points_value_micros: pointsValueMicros,
    flight_cost_cents: flightCost,
    // Euros add up only from the fares that have one; none typed, none kept.
    flight_cost_eur_cents: passengers.some((p) => p.fareEurCents != null)
      ? passengers.reduce((sum, p) => sum + (p.fareEurCents ?? 0), 0)
      : null,
    pocket_cost_cents: pocketCost,
    remarks: clean(payload.remarks),
    updated_at: new Date().toISOString(),
  };
  const meta = { occurredOn: reservedOn || firstFlightOn, bookedOn: null, note: flightNote(airline, bookingCode) };

  let flightId = payload.id;
  if (flightId) {
    const prev = unwrap(
      await supabase
        .from("travel_flights")
        .select("account_id, points_cost, points_used, cancelled_at, reward_activity_id, moves_card_points")
        .eq("id", flightId)
        .eq("household_id", householdId)
        .maybeSingle(),
      "travel_flights",
    );
    if (!prev) return { error: "That flight was not found." };

    // A cancelled booking has already handed its points back.
    const before: RewardDraw = {
      accountId: prev.account_id,
      points: prev.cancelled_at || !prev.points_used ? 0 : prev.points_cost ?? 0,
      credit: 0,
    };
    // A flight imported from the sheet was paid long ago; editing it fixes the
    // record and leaves the card's balance alone.
    const sync = prev.moves_card_points
      ? await syncRewardLedger(
          supabase,
          householdId,
          before,
          { accountId, points: prev.cancelled_at ? 0 : pointsUsed ? pointsCost : 0, credit: 0 },
          meta,
          prev.reward_activity_id,
          "flight_booking",
        )
      : { error: null, activityId: prev.reward_activity_id };
    if (sync.error) return { error: sync.error };

    const { error } = await supabase
      .from("travel_flights")
      .update({ ...row, reward_activity_id: sync.activityId })
      .eq("id", flightId)
      .eq("household_id", householdId);
    if (error) return { error: `Couldn't save that flight — ${error.message}` };
  } else {
    const sync = await syncRewardLedger(
      supabase,
      householdId,
      { accountId, points: 0, credit: 0 },
      { accountId, points: pointsUsed ? pointsCost : 0, credit: 0 },
      meta,
      null,
      "flight_booking",
    );
    if (sync.error) return { error: sync.error };

    const { data, error } = await supabase
      .from("travel_flights")
      .insert({ ...row, reward_activity_id: sync.activityId })
      .select("id")
      .single();
    if (error) return { error: `Couldn't save that flight — ${error.message}` };
    flightId = data.id;
  }

  // Legs and passengers are rewritten whole: they have no identity of their
  // own worth preserving, and it keeps a removed row from lingering.
  for (const table of ["travel_flight_legs", "travel_flight_passengers"] as const) {
    const { error } = await supabase.from(table).delete().eq("flight_id", flightId).eq("household_id", householdId);
    if (error) return { error: `Couldn't save that flight — ${error.message}` };
  }
  const { error: legsError } = await supabase.from("travel_flight_legs").insert(
    legs.map((leg, i) => ({
      household_id: householdId,
      flight_id: flightId,
      sort_order: i,
      flight_on: leg.flightOn,
      flight_number: leg.flightNumber,
      from_place: leg.fromPlace,
      to_place: leg.toPlace,
      departs_at: leg.departsAt,
      arrives_at: leg.arrivesAt,
    })),
  );
  if (legsError) return { error: `Couldn't save the flights — ${legsError.message}` };
  const { error: paxError } = await supabase.from("travel_flight_passengers").insert(
    passengers.map((p, i) => ({
      household_id: householdId,
      flight_id: flightId,
      sort_order: i,
      traveller_id: p.travellerId,
      name: p.name,
      fare_cents: p.fareCents,
      fare_eur_cents: p.fareEurCents,
      points_used: p.pointsUsed,
      points_cost: p.pointsCost,
    })),
  );
  if (paxError) return { error: `Couldn't save the passengers — ${paxError.message}` };

  revalidate();
  return { error: null };
}

async function loadFlightDraw(id: string) {
  const { supabase, household } = await getSessionContext();
  const flight = unwrap(
    await supabase
      .from("travel_flights")
      .select("account_id, points_cost, points_used, cancelled_at, reward_activity_id, airline, booking_code, reserved_on, first_flight_on, moves_card_points")
      .eq("id", id)
      .eq("household_id", household.id)
      .maybeSingle(),
    "travel_flights",
  );
  return { supabase, householdId: household.id, flight };
}

// Removes the booking entirely and hands its points back to the card.
export async function deleteTravelFlight(id: string) {
  const { supabase, householdId, flight } = await loadFlightDraw(id);
  if (!flight) return { error: "That flight was not found." };

  if (flight.moves_card_points && !flight.cancelled_at && flight.points_used && flight.points_cost) {
    const sync = await syncRewardLedger(
      supabase,
      householdId,
      { accountId: flight.account_id, points: flight.points_cost, credit: 0 },
      { accountId: flight.account_id, points: 0, credit: 0 },
      { occurredOn: flight.reserved_on ?? flight.first_flight_on, bookedOn: null, note: flightNote(flight.airline, flight.booking_code) },
      flight.reward_activity_id,
      "flight_booking",
    );
    if (sync.error) return { error: sync.error };
  }

  const { error } = await supabase.from("travel_flights").delete().eq("id", id).eq("household_id", householdId);
  if (error) return { error: `Couldn't delete that flight — ${error.message}` };
  revalidate();
  return { error: null };
}

// Cancelling keeps the booking on record and out of every total; its points go
// back to the card, and restoring draws them again.
export async function setTravelFlightCancelled(id: string, cancelled: boolean) {
  const { supabase, householdId, flight } = await loadFlightDraw(id);
  if (!flight) return { error: "That flight was not found." };
  if (Boolean(flight.cancelled_at) === cancelled) return { error: null };

  let activityId = flight.reward_activity_id;
  if (flight.moves_card_points && flight.points_used && flight.points_cost) {
    const none = { accountId: flight.account_id, points: 0, credit: 0 };
    const full = { accountId: flight.account_id, points: flight.points_cost, credit: 0 };
    const sync = await syncRewardLedger(
      supabase,
      householdId,
      cancelled ? full : none,
      cancelled ? none : full,
      { occurredOn: flight.reserved_on ?? flight.first_flight_on, bookedOn: null, note: flightNote(flight.airline, flight.booking_code) },
      flight.reward_activity_id,
      "flight_booking",
    );
    if (sync.error) return { error: sync.error };
    activityId = sync.activityId;
  }

  const { error } = await supabase
    .from("travel_flights")
    .update({ cancelled_at: cancelled ? new Date().toISOString() : null, reward_activity_id: activityId })
    .eq("id", id)
    .eq("household_id", householdId);
  if (error) return { error: `Couldn't update that booking — ${error.message}` };
  revalidate();
  return { error: null };
}

// ---- The family list behind the passenger picker. Passenger rows keep the
// name they were saved with, so a rename or removal never rewrites history.
export async function addTraveller(name: string) {
  const { supabase, household } = await getSessionContext();
  const first = name.trim();
  if (!first) return { error: "Type a first name." };
  const { error } = await supabase
    .from("travel_travellers")
    .insert({ household_id: household.id, name: first, sort_order: Date.now() % 1_000_000 });
  if (error) {
    if (error.code === "23505") return { error: `${first} is already on the list.` };
    return { error: `Couldn't add that name — ${error.message}` };
  }
  revalidatePath("/travel");
  return { error: null };
}

export async function renameTraveller(id: string, name: string) {
  const { supabase, household } = await getSessionContext();
  const first = name.trim();
  if (!first) return { error: "Type a first name." };
  const { error } = await supabase
    .from("travel_travellers")
    .update({ name: first })
    .eq("id", id)
    .eq("household_id", household.id);
  if (error) {
    if (error.code === "23505") return { error: `${first} is already on the list.` };
    return { error: `Couldn't rename — ${error.message}` };
  }
  revalidatePath("/travel");
  return { error: null };
}

export async function deleteTraveller(id: string) {
  const { supabase, household } = await getSessionContext();
  const { error } = await supabase.from("travel_travellers").delete().eq("id", id).eq("household_id", household.id);
  if (error) return { error: `Couldn't remove that name — ${error.message}` };
  revalidatePath("/travel");
  return { error: null };
}
