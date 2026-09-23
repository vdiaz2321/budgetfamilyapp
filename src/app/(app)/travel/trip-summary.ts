// Everything the Trip Log knows about one trip, worked out from its bookings
// and its Misc spending. Kept apart from the components so the table and the
// trip's own popup can never add a trip up two different ways.

import {
  EXPENSE_CATEGORIES,
  actualCents,
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

/**
 * A booking as planned against actual, the way trip spending reads. A flight
 * not bought yet is all plan; a bought one keeps the estimate it replaced, if
 * it ever was one. Stays and rentals work the same way.
 */
export function bookingPlanActual(b: Booking): { planned: number | null; actual: number | null } {
  if (b.kind === "flight") {
    return b.flight.isEstimate
      ? { planned: b.pocket, actual: null }
      : { planned: b.flight.plannedCostCents, actual: b.pocket };
  }
  const booking = b.kind === "stay" ? b.stay : b.car;
  return booking.isEstimate
    ? { planned: b.pocket, actual: null }
    : { planned: booking.plannedCostCents, actual: b.pocket };
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
  /** Everything above added up — spent AND still-planned money. */
  total: number;
  /** The part of each figure that is only a plan so far: a booking not
   *  bought yet, or a spending row with a plan and no actual. The log greys
   *  these out and keeps them out of "Spent". */
  planOnly: {
    flights: number;
    hotels: number;
    rentals: number;
    misc: Record<ExpenseCategory, number>;
    bookings: number;
    miscTotal: number;
    total: number;
  };
  /** Money that actually left the wallet: total less planOnly.total. */
  spent: number;
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

      // Plan-only parts, for "Spent" vs "Planned".
      const estimatePart = (kind: Booking["kind"]) =>
        live
          .filter((b) => b.kind === kind && (b.kind === "flight" ? b.flight : b.kind === "stay" ? b.stay : b.car).isEstimate)
          .reduce((sum, b) => sum + b.pocket, 0);
      const planMisc = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, 0])) as Record<ExpenseCategory, number>;
      tripExpenses.forEach((e) => {
        if (actualCents(e) == null) planMisc[e.category] += e.plannedCents ?? 0;
      });
      const planFlights = estimatePart("flight");
      const planHotels = estimatePart("stay");
      const planRentals = estimatePart("car");
      const planMiscTotal = Object.values(planMisc).reduce((a, b) => a + b, 0);
      const planTotal = planFlights + planHotels + planRentals + planMiscTotal;

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
        actualMisc: tripExpenses.reduce((s, e) => s + (actualCents(e) ?? 0), 0),
        // A spending plan with no actual yet, or a flight not bought yet.
        hasEstimates:
          tripExpenses.some((e) => e.plannedCents != null && actualCents(e) == null) ||
          live.some((b) => (b.kind === "flight" ? b.flight : b.kind === "stay" ? b.stay : b.car).isEstimate),
        total: flightsPaid + hotelsPaid + rentalsPaid + miscTotal,
        planOnly: {
          flights: planFlights,
          hotels: planHotels,
          rentals: planRentals,
          misc: planMisc,
          bookings: planFlights + planHotels + planRentals,
          miscTotal: planMiscTotal,
          total: planTotal,
        },
        spent: flightsPaid + hotelsPaid + rentalsPaid + miscTotal - planTotal,
        saved: Math.max(0, cashValue - (flightsPaid + hotelsPaid + rentalsPaid)),
        points: live.reduce((sum, b) => sum + b.points, 0),
        counts,
      };
    })
    // Newest first; a trip with no dates yet (just made) sits at the top.
    .sort((a, b) => (b.start ?? "9999").localeCompare(a.start ?? "9999"));
}

/**
 * One trip's bookings added up per kind, planned against actual — the same
 * rule `bookingPlanActual` uses, applied straight to the records so the Trip
 * spending table can show Stays / Flights / Rental beside the typed
 * categories. Cancelled bookings count for nothing.
 */
export function bookingTotalsFor(
  tripId: string,
  stays: TravelStay[],
  flights: TravelFlight[],
  cars: TravelCar[],
): Record<"stay" | "flight" | "car", { planned: number; actual: number }> {
  const add = (
    rows: { tripId: string | null; cancelledAt: string | null; isEstimate: boolean; plannedCostCents: number | null; pocketCostCents: number }[],
  ) =>
    rows
      .filter((r) => r.tripId === tripId && !r.cancelledAt)
      .reduce(
        (totals, r) => ({
          // Not booked yet: the price on it IS the plan, and nothing is spent.
          planned: totals.planned + (r.isEstimate ? r.pocketCostCents : r.plannedCostCents ?? 0),
          actual: totals.actual + (r.isEstimate ? 0 : r.pocketCostCents),
        }),
        { planned: 0, actual: 0 },
      );
  return { stay: add(stays), flight: add(flights), car: add(cars) };
}
