// What the trips still ahead this year are expected to cost and have not cost
// yet — the Trip Log's "Planned" figure, limited to trips that have not ended
// and start before New Year. Net Worth takes it off the "at current pace"
// forecast: the pace is built from money that already moved, so a trip booked
// for November is invisible to it until the card is charged (Victor,
// 2026-09-29).
//
// Plan-only follows the same rule as `summarizeTrips`' planOnly.total: a
// booking still on estimate counts its price, and a Spending row counts its
// plan until it has an actual (typed, or purchases tagged to it). A booking
// already bought is out — it has left net worth already. A finished trip's
// leftover plan is out too: that money was either spent, and is in net worth,
// or never spent at all.

import type { SupabaseClient } from "@supabase/supabase-js";
import { throwIfAny } from "@/lib/supabase-result";
import { addDays } from "./trip-summary";

export async function loadUpcomingTravelPlanCents(
  supabase: SupabaseClient,
  householdId: string,
  today: string,
  year: number,
): Promise<number> {
  const [trips, stays, flights, cars, expenses, tripTx] = await Promise.all([
    supabase.from("travel_trips").select("id, start_on, end_on").eq("household_id", householdId),
    supabase
      .from("travel_stays")
      .select("trip_id, check_in, nights, is_estimate, pocket_cost_cents")
      .eq("household_id", householdId)
      .is("cancelled_at", null)
      .not("trip_id", "is", null),
    supabase
      .from("travel_flights")
      .select("trip_id, first_flight_on, is_estimate, pocket_cost_cents")
      .eq("household_id", householdId)
      .is("cancelled_at", null)
      .not("trip_id", "is", null),
    supabase
      .from("travel_cars")
      .select("trip_id, pickup_on, return_on, is_estimate, pocket_cost_cents")
      .eq("household_id", householdId)
      .is("cancelled_at", null)
      .not("trip_id", "is", null),
    supabase
      .from("travel_trip_expenses")
      .select("trip_id, category, planned_cents, actual_cents")
      .eq("household_id", householdId),
    // Purchases tagged to a trip's Spending row make it actual, as on Travel.
    supabase
      .from("transactions")
      .select("trip_id, travel_category, travel_stay_id, travel_flight_id, travel_car_id, subcategories(travel_category)")
      .eq("household_id", householdId)
      .not("trip_id", "is", null),
  ]);
  throwIfAny({
    travel_trips: trips.error,
    travel_stays: stays.error,
    travel_flights: flights.error,
    travel_cars: cars.error,
    travel_trip_expenses: expenses.error,
    transactions: tripTx.error,
  });

  // Each trip's span: its own dates, else its bookings', as the Trip Log does.
  const span = new Map<string, { start: string; end: string }>();
  const widen = (tripId: string, start: string, end: string) => {
    const cur = span.get(tripId);
    span.set(tripId, cur ? { start: start < cur.start ? start : cur.start, end: end > cur.end ? end : cur.end } : { start, end });
  };
  // Estimate price per trip, while walking the bookings.
  const planByTrip = new Map<string, number>();
  const addPlan = (tripId: string, cents: number) => planByTrip.set(tripId, (planByTrip.get(tripId) ?? 0) + cents);

  for (const s of stays.data ?? []) {
    widen(s.trip_id, s.check_in, addDays(s.check_in, s.nights ?? 1));
    if (s.is_estimate) addPlan(s.trip_id, Number(s.pocket_cost_cents ?? 0));
  }
  for (const f of flights.data ?? []) {
    widen(f.trip_id, f.first_flight_on, f.first_flight_on);
    if (f.is_estimate) addPlan(f.trip_id, Number(f.pocket_cost_cents ?? 0));
  }
  for (const c of cars.data ?? []) {
    widen(c.trip_id, c.pickup_on, c.return_on ?? c.pickup_on);
    if (c.is_estimate) addPlan(c.trip_id, Number(c.pocket_cost_cents ?? 0));
  }

  type TxRow = {
    trip_id: string;
    travel_category: string | null;
    travel_stay_id: string | null;
    travel_flight_id: string | null;
    travel_car_id: string | null;
    subcategories: { travel_category: string | null } | { travel_category: string | null }[] | null;
  };
  const tagged = new Set<string>();
  for (const t of (tripTx.data ?? []) as unknown as TxRow[]) {
    if (t.travel_stay_id || t.travel_flight_id || t.travel_car_id) continue;
    const sub = Array.isArray(t.subcategories) ? t.subcategories[0] : t.subcategories;
    const category = t.travel_category ?? sub?.travel_category;
    if (category) tagged.add(`${t.trip_id}:${category}`);
  }
  for (const e of expenses.data ?? []) {
    const hasActual = e.actual_cents != null || tagged.has(`${e.trip_id}:${e.category}`);
    if (!hasActual) addPlan(e.trip_id, Number(e.planned_cents ?? 0));
  }

  const yearEnd = `${year}-12-31`;
  let total = 0;
  for (const t of trips.data ?? []) {
    const booked = span.get(t.id);
    const start = t.start_on ?? booked?.start ?? null;
    const end = t.end_on ?? booked?.end ?? start;
    // An undated trip has nowhere to land in the year, so it stays out.
    if (!start || !end) continue;
    if (end < today || start > yearEnd) continue;
    total += Math.max(0, planByTrip.get(t.id) ?? 0);
  }
  return total;
}
