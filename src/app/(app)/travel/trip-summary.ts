// Everything the Trip Log knows about one trip, worked out from its bookings
// and its Misc spending. Kept apart from the components so the table and the
// trip's own popup can never add a trip up two different ways.

import {
  EXPENSE_CATEGORIES,
  expenseCents,
  type ExpenseCategory,
  type TravelCar,
  type TravelFlight,
  type TravelStay,
  type TravelTrip,
  type TripExpense,
} from "./types";

export type Booking =
  | { kind: "flight"; id: string; start: string; end: string; title: string; detail: string; cost: number; pocket: number; points: number; cancelled: boolean; flight: TravelFlight }
  | { kind: "stay"; id: string; start: string; end: string; title: string; detail: string; cost: number; pocket: number; points: number; cancelled: boolean; stay: TravelStay }
  | { kind: "car"; id: string; start: string; end: string; title: string; detail: string; cost: number; pocket: number; points: number; cancelled: boolean; car: TravelCar };

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function sheetDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
}

/** "28-Mar – 2-Apr-27": the year once when both ends share it, on both ends
 *  when the span crosses New Year, and a single date when they're the same. */
export function sheetDateRange(start: string, end: string | null | undefined): string {
  if (!end || end === start) return sheetDate(start);
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${sheetDate(start)} – ${sheetDate(end)}`;
  const [, m, d] = start.split("-");
  return `${Number(d)}-${MONTHS[Number(m) - 1]} – ${sheetDate(end)}`;
}

export function flightRoute(f: TravelFlight): string {
  const stops: string[] = [];
  for (const leg of f.legs) {
    if (leg.fromPlace && stops[stops.length - 1] !== leg.fromPlace) stops.push(leg.fromPlace);
    if (leg.toPlace) stops.push(leg.toPlace);
  }
  return stops.join(" → ");
}

function flightBooking(f: TravelFlight): Booking {
  const start = f.legs[0]?.flightOn ?? f.firstFlightOn;
  return {
    kind: "flight",
    id: f.id,
    start,
    end: f.legs[f.legs.length - 1]?.flightOn ?? start,
    title: flightRoute(f) || f.airline,
    detail: `${f.airline} · ${f.passengers.length} pax`,
    cost: f.flightCostCents,
    pocket: f.pocketCostCents,
    points: f.pointsUsed ? f.pointsCost : 0,
    cancelled: Boolean(f.cancelledAt),
    flight: f,
  };
}
function stayBooking(s: TravelStay): Booking {
  return {
    kind: "stay",
    id: s.id,
    start: s.checkIn,
    end: addDays(s.checkIn, s.nights),
    title: s.propertyName,
    detail: `${s.nights}n${s.city ? ` · ${s.city}` : ""}`,
    cost: s.hotelCostCents,
    pocket: s.pocketCostCents,
    points: s.pointsUsed ? s.pointsCost : 0,
    cancelled: Boolean(s.cancelledAt),
    stay: s,
  };
}
function carBooking(c: TravelCar): Booking {
  return {
    kind: "car",
    id: c.id,
    start: c.pickupOn,
    end: c.returnOn ?? c.pickupOn,
    title: c.company ?? "Rental car",
    detail: [c.pickupPlace, c.returnPlace && c.returnPlace !== c.pickupPlace ? c.returnPlace : null].filter(Boolean).join(" → ") || "Rental",
    cost: c.costCents,
    pocket: c.pocketCostCents,
    points: c.pointsUsed ? c.pointsCost : 0,
    cancelled: Boolean(c.cancelledAt),
    car: c,
  };
}

export type TripSummary = {
  trip: TravelTrip;
  bookings: Booking[];
  expenses: TripExpense[];
  start: string | null;
  end: string | null;
  nights: number | null;
  pax: number | null;
  /** What left the wallet, per part of the trip. Misc counts its actual
   *  figure, or its plan until there is one. */
  flights: number;
  hotels: number;
  rentals: number;
  misc: Record<ExpenseCategory, number>;
  miscTotal: number;
  plannedMisc: number;
  actualMisc: number;
  /** Anything still on estimate: a category with a plan and no actual. */
  hasEstimates: boolean;
  total: number;
  /** Cash value of flights, hotels and rentals, less what was paid for them. */
  saved: number;
  points: number;
  counts: { flight: number; stay: number; car: number };
};

export function summarizeTrips(
  trips: TravelTrip[],
  stays: TravelStay[],
  flights: TravelFlight[],
  cars: TravelCar[],
  expenses: TripExpense[],
): TripSummary[] {
  const byTrip = new Map<string, Booking[]>();
  const push = (tripId: string | null, booking: Booking) => {
    if (!tripId) return;
    byTrip.set(tripId, [...(byTrip.get(tripId) ?? []), booking]);
  };
  flights.forEach((f) => push(f.tripId, flightBooking(f)));
  stays.forEach((s) => push(s.tripId, stayBooking(s)));
  cars.forEach((c) => push(c.tripId, carBooking(c)));

  const order = ["flight", "car", "stay"];
  return trips
    .map((trip): TripSummary => {
      const bookings = (byTrip.get(trip.id) ?? []).sort(
        (a, b) => a.start.localeCompare(b.start) || order.indexOf(a.kind) - order.indexOf(b.kind),
      );
      const live = bookings.filter((b) => !b.cancelled);
      const tripExpenses = expenses.filter((e) => e.tripId === trip.id);
      const counts = { flight: 0, stay: 0, car: 0 };
      live.forEach((b) => (counts[b.kind] += 1));

      // The trip's own dates win; without them, the bookings' span.
      const start = trip.startOn ?? (live.length ? live.reduce((m, b) => (b.start < m ? b.start : m), live[0].start) : null);
      const end = trip.endOn ?? (live.length ? live.reduce((m, b) => (b.end > m ? b.end : m), live[0].end) : null);

      const part = (kind: Booking["kind"], key: "pocket" | "cost") =>
        live.filter((b) => b.kind === kind).reduce((sum, b) => sum + b[key], 0);
      const misc = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, 0])) as Record<ExpenseCategory, number>;
      tripExpenses.forEach((e) => (misc[e.category] += expenseCents(e)));
      const miscTotal = Object.values(misc).reduce((a, b) => a + b, 0);

      const flightsPaid = part("flight", "pocket");
      const hotelsPaid = part("stay", "pocket");
      const rentalsPaid = part("car", "pocket");
      const cashValue = part("flight", "cost") + part("stay", "cost") + part("car", "cost");
      const paxCounts = live.map((b) => (b.kind === "flight" ? b.flight.passengers.length : b.kind === "stay" ? b.stay.pax ?? 0 : 0));

      return {
        trip,
        bookings,
        expenses: tripExpenses,
        start,
        end,
        nights: start && end ? Math.max(0, daysBetween(start, end)) : null,
        pax: paxCounts.length ? Math.max(...paxCounts) || null : null,
        flights: flightsPaid,
        hotels: hotelsPaid,
        rentals: rentalsPaid,
        misc,
        miscTotal,
        plannedMisc: tripExpenses.reduce((s, e) => s + (e.plannedCents ?? 0), 0),
        actualMisc: tripExpenses.reduce((s, e) => s + (e.actualCents ?? 0), 0),
        hasEstimates: tripExpenses.some((e) => e.plannedCents != null && e.actualCents == null),
        total: flightsPaid + hotelsPaid + rentalsPaid + miscTotal,
        saved: Math.max(0, cashValue - (flightsPaid + hotelsPaid + rentalsPaid)),
        points: live.reduce((sum, b) => sum + b.points, 0),
        counts,
      };
    })
    // Newest first; a trip with no dates yet (just made) sits at the top.
    .sort((a, b) => (b.start ?? "9999").localeCompare(a.start ?? "9999"));
}
