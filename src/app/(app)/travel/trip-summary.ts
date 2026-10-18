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

/** "28-Mar": a date inside a trip popup, whose header already gives the
 *  year. Keeps the year ("5-Oct-26") when the date falls in another one. */
export function tripDate(iso: string, tripYear: string | null | undefined): string {
  if (tripYear && iso.slice(0, 4) !== tripYear) return sheetDate(iso);
  const [, m, d] = iso.split("-");
  return `${Number(d)}-${MONTHS[Number(m) - 1]}`;
}

/**
 * When a booking happens, for its row in the trip popup: `date` sits beside
 * the title ("28-Mar", or "8-Oct – 12-Oct" for a round trip), and a flight's
 * `legs` go under it as columns — the leg's day (only when the booking spans
 * more than one day), its depart time and its arrive time.
 */
export type WhenLeg = { day: string | null; depart: string | null; arrive: string | null };
export function bookingWhen(b: Booking, tripYear: string | null | undefined): { date: string; legs: WhenLeg[] } {
  const date = b.end === b.start ? tripDate(b.start, tripYear) : `${tripDate(b.start, tripYear)} – ${tripDate(b.end, tripYear)}`;
  if (b.kind !== "flight") return { date, legs: [] };
  const manyDays = b.start !== b.end;
  const legs = b.flight.legs
    .map((leg) => ({ day: manyDays ? tripDate(leg.flightOn, tripYear) : null, depart: leg.departsAt, arrive: leg.arrivesAt }))
    .filter((leg) => leg.day || leg.depart || leg.arrive);
  return { date, legs };
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
  // Reserved but paid at check-in: all plan until the charge is linked.
  if (b.kind === "stay" && stayDueAtHotel(b.stay)) return { planned: b.stay.plannedCostCents, actual: null };
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

/**
 * The same booking's figures in its other currency (euros, pounds, …), for the
 * "$810 / €700" pair. Null where that side was never typed.
 */
export function bookingForeign(b: Booking): { code: string; planned: number | null; actual: number | null } {
  if (b.kind === "flight") {
    const f = b.flight;
    return f.isEstimate
      ? { code: f.foreignCurrency, planned: f.flightCostEurCents, actual: null }
      : { code: f.foreignCurrency, planned: f.plannedCostForeignCents, actual: f.flightCostEurCents };
  }
  if (b.kind === "stay") {
    const s = b.stay;
    if (stayDueAtHotel(s)) return { code: s.foreignCurrency, planned: s.plannedCostForeignCents, actual: null };
    return s.isEstimate
      ? { code: s.foreignCurrency, planned: s.costForeignCents, actual: null }
      : { code: s.foreignCurrency, planned: s.plannedCostForeignCents, actual: s.costForeignCents };
  }
  const c = b.car;
  return c.isEstimate
    ? { code: c.foreignCurrency, planned: c.costEurCents, actual: null }
    : { code: c.foreignCurrency, planned: c.plannedCostForeignCents, actual: c.costEurCents };
}

/**
 * Booked at a hotel that takes the card at check-in, and nothing paid yet —
 * no charge linked and no Spent typed. Its plan is money still to go, not
 * money saved.
 */
export function stayDueAtHotel(s: TravelStay): boolean {
  return s.payAtProperty && !s.isEstimate && !s.cancelledAt && s.paidCents == null && s.pocketCostCents === 0;
}

/** Still only planned — no booking date and nothing spent on it yet. */
export function bookingPlannedOnly(b: Booking): boolean {
  return b.kind === "stay" ? b.stay.isEstimate : b.kind === "flight" ? b.flight.isEstimate : b.car.isEstimate;
}

/** Free cancellation still open on this booking: its last day, or null. */
export function freeCancelOpen(s: TravelStay, todayIso: string): string | null {
  return s.freeCancelUntil && !s.cancelledAt && s.freeCancelUntil >= todayIso ? s.freeCancelUntil : null;
}

/**
 * The trip's bookings as the popup lists them: a family needing two rooms
 * books the same hotel several times (a cash room, plus a second room night by
 * night on points and free-night certificates), and each reservation is its
 * own stay. Those are gathered into one line per hotel — same name, dates
 * that touch — with each reservation under it and the room picked for it on
 * the stay form (null when none was picked: then no room is claimed). Everything
 * else stays a line of its own, in the same order.
 */
export type BookingLine =
  | { type: "single"; booking: Booking }
  | {
      type: "rooms";
      key: string;
      title: string;
      start: string;
      end: string;
      /** Distinct rooms, when every reservation has one picked; else null. */
      roomCount: number | null;
      members: Array<{ booking: Booking; room: number | null }>;
    };

export function bookingLines(bookings: Booking[]): BookingLine[] {
  const norm = (name: string) => name.trim().toLowerCase();
  const groups: Booking[][] = [];
  const groupOf = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.kind !== "stay" || b.cancelled) continue;
    // Joins a group of the same hotel whose dates it touches.
    const home = groups.find(
      (g) => norm(g[0].title) === norm(b.title) && g.some((m) => b.start <= m.end && m.start <= b.end),
    );
    if (home) home.push(b);
    else groups.push([b]);
  }
  for (const g of groups) if (g.length > 1) g.forEach((b) => groupOf.set(b.id, g));

  const lines: BookingLine[] = [];
  const placed = new Set<Booking[]>();
  for (const b of bookings) {
    const g = b.kind === "stay" ? groupOf.get(b.id) : undefined;
    if (!g) {
      lines.push({ type: "single", booking: b });
      continue;
    }
    if (placed.has(g)) continue;
    placed.add(g);
    // By the room picked on each reservation, then by date.
    const ordered = [...g].sort((x, y) => x.start.localeCompare(y.start) || y.end.localeCompare(x.end));
    const members = ordered.map((m) => ({ booking: m, room: m.kind === "stay" ? m.stay.roomNo : null }));
    members.sort((x, y) => (x.room ?? 99) - (y.room ?? 99) || x.booking.start.localeCompare(y.booking.start));
    const allPicked = members.every((m) => m.room != null);
    lines.push({
      type: "rooms",
      key: g.map((m) => m.id).join("+"),
      title: ordered[0].title,
      start: ordered.reduce((min, m) => (m.start < min ? m.start : min), ordered[0].start),
      end: ordered.reduce((max, m) => (m.end > max ? m.end : max), ordered[0].end),
      roomCount: allPicked ? new Set(members.map((m) => m.room)).size : null,
      members,
    });
  }
  // Cancelled bookings sink below the live ones, keeping their order.
  const cancelled = (l: BookingLine) => l.type === "single" && l.booking.cancelled;
  return [...lines.filter((l) => !cancelled(l)), ...lines.filter(cancelled)];
}

/**
 * The hotel's other reservations in the same trip — what the trip popup lists
 * under the same hotel line — so the stay form can show them all together.
 */
export function sameHotelReservations(stay: TravelStay, stays: TravelStay[]): TravelStay[] {
  if (!stay.tripId || stay.cancelledAt) return [];
  const line = bookingLines(stays.filter((s) => s.tripId === stay.tripId).map(stayBooking)).find(
    (l) => l.type === "rooms" && l.members.some((m) => m.booking.id === stay.id),
  );
  if (!line || line.type !== "rooms") return [];
  return line.members.flatMap((m) => (m.booking.kind === "stay" && m.booking.id !== stay.id ? [m.booking.stay] : []));
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
    detail: `${s.city ? `${s.city} ` : ""}(${s.nights}\u00a0night${s.nights === 1 ? "" : "s"})`,
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
  /** The trip's whole plan: every live booking's planned cost (bought or
   *  not) plus every Spending row's plan — the popup's "Total Planned". */
  plannedTotal: number;
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
      // A hotel booked as several reservations (two rooms) counts once, as
      // the trip popup lists it.
      const counts = { flight: 0, stay: 0, car: 0 };
      bookingLines(live).forEach((l) => (counts[l.type === "rooms" ? "stay" : l.booking.kind] += 1));

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
        plannedTotal:
          live.reduce((sum, b) => sum + (bookingPlanActual(b).planned ?? 0), 0) +
          tripExpenses.reduce((s, e) => s + (e.plannedCents ?? 0), 0),
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
): Record<"stay" | "flight" | "car", { planned: number; actual: number; count: number }> {
  const add = (
    rows: { tripId: string | null; cancelledAt: string | null; isEstimate: boolean; plannedCostCents: number | null; pocketCostCents: number }[],
  ) => {
    const live = rows.filter((r) => r.tripId === tripId && !r.cancelledAt);
    return {
      // Not booked yet: the price on it IS the plan, and nothing is spent.
      planned: live.reduce((t, r) => t + (r.isEstimate ? r.pocketCostCents : r.plannedCostCents ?? 0), 0),
      actual: live.reduce((t, r) => t + (r.isEstimate ? 0 : r.pocketCostCents), 0),
      // How many live bookings of this kind — none means the row is hidden.
      count: live.length,
    };
  };
  return { stay: add(stays), flight: add(flights), car: add(cars) };
}

/**
 * The same per-kind totals in a foreign currency — only the bookings kept in
 * `code` (a booking in pounds can't be added to euros). Null where none of
 * them has a figure on that side.
 */
export function bookingForeignTotalsFor(
  tripId: string,
  stays: TravelStay[],
  flights: TravelFlight[],
  cars: TravelCar[],
  code: string,
): Record<"stay" | "flight" | "car", { planned: number | null; actual: number | null }> {
  const add = (bookings: Booking[]) => {
    const fx = bookings
      .filter((b) => !b.cancelled)
      .map(bookingForeign)
      .filter((f) => f.code === code);
    const sum = (vals: (number | null)[]) => {
      const typed = vals.filter((v): v is number => v != null);
      return typed.length ? typed.reduce((a, b) => a + b, 0) : null;
    };
    return { planned: sum(fx.map((f) => f.planned)), actual: sum(fx.map((f) => f.actual)) };
  };
  return {
    stay: add(stays.filter((s) => s.tripId === tripId).map(stayBooking)),
    flight: add(flights.filter((f) => f.tripId === tripId).map(flightBooking)),
    car: add(cars.filter((c) => c.tripId === tripId).map(carBooking)),
  };
}

/**
 * A trip's planned-against-spent difference — the trip popup's Total
 * Difference, also the Trip Log's Difference column. Each booking kind (all
 * flights, all stays, all rentals) compares its whole plan with what's been
 * paid once anything of that kind is paid — an unpaid flight's plan is money
 * still to go (Victor, 2026-10-08) — and a spending row counts once it has
 * spending. Spent with no plan is an unplanned cost (plan $0). `diff` is null
 * while nothing has been paid; positive = under plan.
 */
export function tripDifference(t: Pick<TripSummary, "bookings" | "expenses">): { planned: number; spent: number; diff: number | null } {
  const live = t.bookings.filter((b) => !b.cancelled);
  const byKind = (["flight", "stay", "car"] as const).map((kind) =>
    live
      .filter((b) => b.kind === kind)
      .map((b) => bookingPlanActual(b))
      .reduce<{ planned: number; actual: number }>(
        (sum, x) => ({ planned: sum.planned + (x.planned ?? 0), actual: sum.actual + (x.actual ?? 0) }),
        { planned: 0, actual: 0 },
      ),
  );
  const compared = [
    ...byKind.filter((k) => k.actual > 0),
    ...t.expenses
      .map((e) => ({ planned: e.plannedCents ?? (actualCents(e) ? 0 : null), actual: actualCents(e) }))
      .filter((x): x is { planned: number; actual: number } => x.planned != null && x.actual != null),
  ];
  const planned = compared.reduce((sum, x) => sum + x.planned, 0);
  const spent = compared.reduce((sum, x) => sum + x.actual, 0);
  return { planned, spent, diff: compared.length ? planned - spent : null };
}
