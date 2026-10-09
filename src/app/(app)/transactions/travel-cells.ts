import type { createClient } from "@/lib/supabase/server";
import { throwIfAny } from "@/lib/supabase-result";
import { EXPENSE_CATEGORIES } from "../travel/types";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// The Trip, Pays for, Points / Free night and Hotel credit columns on the
// desktop register. Points, the free night and hotel credit live on the
// booking, not the payment, so every payment toward a booking shows the
// booking's figures — the same ones its Travel Log row shows.
export type TravelCells = {
  trip: string | null;
  /** The booking it pays for ("Stay · Four Points · 3-Oct-26"), or for a
   *  trip purchase with no booking, the trip's Spending row it lands on
   *  ("Spending · Groceries"). */
  paysFor: string | null;
  points: number;
  freeNight: boolean;
  hotelCreditCents: number;
};

type Row = {
  id: string;
  trip_id: string | null;
  travel_stay_id: string | null;
  travel_flight_id: string | null;
  travel_car_id: string | null;
  travel_category: string | null;
  subcategory_id: string | null;
};

const SPENDING_LABEL = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));

// "3-Oct-26", as the transaction form's "Pays for" list reads.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string | null) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  return `${Number(d)}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
};

export async function loadTravelCells(
  supabase: SupabaseClient,
  householdId: string,
  rows: Row[],
): Promise<Record<string, TravelCells>> {
  const tagged = rows.filter((r) => r.trip_id || r.travel_stay_id || r.travel_flight_id || r.travel_car_id);
  if (tagged.length === 0) return {};

  // Whole tables, not `.in(ids)`: an all-time range can link hundreds of
  // bookings, and that many ids overflow the request URL. The travel tables
  // are small. Cancelled bookings stay in — a refund still points at one.
  const [trips, stays, flights, legs, pax, cars, subs] = await Promise.all([
    supabase.from("travel_trips").select("id, name").eq("household_id", householdId),
    supabase.from("travel_stays").select("id, property_name, check_in, points_cost, points_used, free_night_used, hotel_credit_cents").eq("household_id", householdId),
    supabase.from("travel_flights").select("id, airline, first_flight_on").eq("household_id", householdId),
    supabase.from("travel_flight_legs").select("flight_id, from_place, to_place, sort_order").eq("household_id", householdId).order("sort_order"),
    supabase.from("travel_flight_passengers").select("flight_id, points_used, points_cost").eq("household_id", householdId),
    supabase.from("travel_cars").select("id, company, pickup_on, points_cost, points_used").eq("household_id", householdId),
    supabase.from("subcategories").select("id, travel_category").eq("household_id", householdId).not("travel_category", "is", null),
  ]);
  throwIfAny({ trips: trips.error, stays: stays.error, flights: flights.error, legs: legs.error, passengers: pax.error, cars: cars.error, subcategories: subs.error });
  // A budget item's own Spending row; one picked on the purchase wins — the
  // same rule the Travel Log's Spending table adds them up by.
  const subSpending = new Map((subs.data ?? []).map((s) => [s.id, s.travel_category as string]));
  const spendingLabel = (r: Row) => {
    const key = r.travel_category ?? (r.subcategory_id ? subSpending.get(r.subcategory_id) : undefined);
    const label = key ? SPENDING_LABEL.get(key) : undefined;
    return label ? `Spending · ${label}` : "Day-to-day spending";
  };

  const tripName = new Map((trips.data ?? []).map((t) => [t.id, t.name as string]));
  const route = new Map<string, string>();
  for (const l of legs.data ?? []) {
    if (!route.has(l.flight_id) && (l.from_place || l.to_place)) route.set(l.flight_id, `${l.from_place ?? "?"} → ${l.to_place ?? "?"}`);
  }
  const flightPoints = new Map<string, number>();
  for (const p of pax.data ?? []) {
    if (p.points_used) flightPoints.set(p.flight_id, (flightPoints.get(p.flight_id) ?? 0) + Number(p.points_cost ?? 0));
  }
  const pointsOf = (b: { points_used: boolean | null; points_cost: number | null }) => (b.points_used ? Number(b.points_cost ?? 0) : 0);

  type Booking = Omit<TravelCells, "trip">;
  const bookings = new Map<string, Booking>();
  for (const s of stays.data ?? []) {
    bookings.set(`stay:${s.id}`, {
      paysFor: ["Stay", s.property_name, day(s.check_in)].filter(Boolean).join(" · "),
      points: pointsOf(s),
      freeNight: Boolean(s.free_night_used),
      hotelCreditCents: Number(s.hotel_credit_cents ?? 0),
    });
  }
  for (const f of flights.data ?? []) {
    bookings.set(`flight:${f.id}`, {
      paysFor: ["Flight", f.airline, route.get(f.id), day(f.first_flight_on)].filter(Boolean).join(" · "),
      points: flightPoints.get(f.id) ?? 0,
      freeNight: false,
      hotelCreditCents: 0,
    });
  }
  for (const c of cars.data ?? []) {
    bookings.set(`car:${c.id}`, {
      paysFor: ["Rental", c.company ?? "Car", day(c.pickup_on)].filter(Boolean).join(" · "),
      points: pointsOf(c),
      freeNight: false,
      hotelCreditCents: 0,
    });
  }

  const out: Record<string, TravelCells> = {};
  for (const r of tagged) {
    const ref = r.travel_stay_id ? `stay:${r.travel_stay_id}` : r.travel_flight_id ? `flight:${r.travel_flight_id}` : r.travel_car_id ? `car:${r.travel_car_id}` : null;
    const booking = ref ? bookings.get(ref) : undefined;
    out[r.id] = {
      trip: r.trip_id ? tripName.get(r.trip_id) ?? null : null,
      paysFor: booking?.paysFor ?? (r.trip_id ? spendingLabel(r) : null),
      points: booking?.points ?? 0,
      freeNight: booking?.freeNight ?? false,
      hotelCreditCents: booking?.hotelCreditCents ?? 0,
    };
  }
  return out;
}
