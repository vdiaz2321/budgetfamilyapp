import { getSessionContext } from "@/lib/auth-context";
import { loadCreditCardBoardData } from "@/lib/credit-card-data";
import { throwIfAny } from "@/lib/supabase-result";
import { TravelBoard } from "./travel-board";
import type { CarKind, ExpenseCategory, PocketPaidWith, TravelBrand, TravelCar, TravelCard, TravelFlight, TravelStay, TravelTrip, TripExpense, TripTaggedPurchase, Traveller } from "./types";

export const metadata = { title: "Travel Log · Capitall" };

export default async function TravelPage() {
  const { supabase, household } = await getSessionContext();

  const [stays, brands, rewards, flights, legs, passengers, travellers, cars, trips, expenses, tripTx] = await Promise.all([
    supabase
      .from("travel_stays")
      .select(
        "id, trip_id, account_id, card_label, holder, property_name, city, brand, booking_channel, reserved_on, check_in, nights, pax, points_cost, points_used, points_value_micros, hotel_credit_cents, hotel_cost_cents, pocket_cost_cents, pocket_paid_with, remarks, breakfast_included, cancelled_at, reward_activity_id, free_night_used, free_night_points, moves_card_points, is_estimate, planned_cost_cents, planned_cost_foreign_cents, cost_foreign_cents, foreign_currency",
      )
      .eq("household_id", household.id)
      .order("check_in", { ascending: false }),
    supabase
      .from("travel_brands")
      .select("id, name")
      .eq("household_id", household.id)
      .order("name"),
    // The rewards board below the charts, and the card list the Add stay
    // form offers — one read for both, and the same one Accounts uses for
    // its card list, so the two pages can't disagree about a card.
    loadCreditCardBoardData(supabase, household.id),
    supabase
      .from("travel_flights")
      .select(
        "id, trip_id, account_id, card_label, holder, airline, booking_code, reserved_on, first_flight_on, points_cost, points_used, points_value_micros, flight_cost_cents, flight_cost_eur_cents, moves_card_points, is_estimate, planned_cost_cents, planned_cost_foreign_cents, foreign_currency, pocket_cost_cents, remarks, cancelled_at, reward_activity_id",
      )
      .eq("household_id", household.id)
      .order("first_flight_on", { ascending: false }),
    supabase
      .from("travel_flight_legs")
      .select("flight_id, sort_order, flight_on, flight_number, from_place, to_place, departs_at, arrives_at")
      .eq("household_id", household.id)
      .order("sort_order"),
    supabase
      .from("travel_flight_passengers")
      .select("flight_id, sort_order, traveller_id, name, fare_cents, fare_eur_cents, planned_fare_cents, planned_fare_foreign_cents, points_used, points_cost")
      .eq("household_id", household.id)
      .order("sort_order"),
    supabase
      .from("travel_travellers")
      .select("id, name")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("travel_cars")
      .select(
        "id, trip_id, kind, company, booking_code, reserved_on, pickup_on, pickup_time, pickup_place, return_on, return_time, return_place, account_id, card_label, holder, points_cost, points_used, points_value_micros, cost_cents, cost_eur_cents, moves_card_points, is_estimate, planned_cost_cents, planned_cost_foreign_cents, foreign_currency, pocket_cost_cents, remarks, cancelled_at, reward_activity_id",
      )
      .eq("household_id", household.id)
      .order("pickup_on", { ascending: false }),
    supabase
      .from("travel_trips")
      .select("id, name, start_on, end_on, notes, spending_currency")
      .eq("household_id", household.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("travel_trip_expenses")
      .select("trip_id, category, planned_cents, planned_eur_cents, actual_cents, actual_eur_cents, account_id, note")
      .eq("household_id", household.id),
    // Purchases tagged to a trip on the Budget. Each lands in the Spending
    // row its budget item maps to (subcategories.travel_category); refunds
    // are negative and come off it. Untagged or unmapped ones stay out.
    supabase
      .from("transactions")
      .select("id, occurred_on, trip_id, amount_cents, travel_stay_id, travel_flight_id, travel_car_id, travel_category, subcategories(name, travel_category), payees(name)")
      .eq("household_id", household.id)
      .not("trip_id", "is", null),
  ]);
  throwIfAny({
    travel_stays: stays.error,
    travel_brands: brands.error,
    travel_flights: flights.error,
    travel_flight_legs: legs.error,
    travel_flight_passengers: passengers.error,
    travel_travellers: travellers.error,
    travel_cars: cars.error,
    travel_trips: trips.error,
    travel_trip_expenses: expenses.error,
    transactions: tripTx.error,
  });

  const sortByDate = (list: TripTaggedPurchase[]) =>
    [...list].sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);

  // Tagged purchases summed per trip and Spending row.
  const txByRow = new Map<string, { cents: number; count: number; list: TripTaggedPurchase[] }>();
  type TripTxRow = {
    id: string; occurred_on: string;
    trip_id: string | null; amount_cents: number;
    travel_stay_id: string | null; travel_flight_id: string | null; travel_car_id: string | null;
    travel_category: string | null;
    subcategories: { name: string; travel_category: string | null } | { name: string; travel_category: string | null }[] | null;
    payees: { name: string } | { name: string }[] | null;
  };
  for (const t of (tripTx.data ?? []) as unknown as TripTxRow[]) {
    // Paying for a booking is the booking's pocket cost, not spending on top.
    if (t.travel_stay_id || t.travel_flight_id || t.travel_car_id) continue;
    const sub = Array.isArray(t.subcategories) ? t.subcategories[0] : t.subcategories;
    // A row picked on the purchase itself (Parking under Traveling/Trips)
    // wins over the item's own row.
    const category = t.travel_category ?? sub?.travel_category;
    if (!t.trip_id || !category) continue;
    const key = `${t.trip_id}:${category}`;
    const cur = txByRow.get(key) ?? { cents: 0, count: 0, list: [] };
    const payee = Array.isArray(t.payees) ? t.payees[0] : t.payees;
    cur.list.push({
      id: t.id,
      date: t.occurred_on,
      payee: payee?.name ?? null,
      item: sub?.name ?? "—",
      amountCents: Number(t.amount_cents),
    });
    txByRow.set(key, { cents: cur.cents + Number(t.amount_cents), count: cur.count + 1, list: cur.list });
  }
  const expenseRows: TripExpense[] = (expenses.data ?? []).map((e): TripExpense => {
    const tx = txByRow.get(`${e.trip_id}:${e.category}`);
    return {
      tripId: e.trip_id,
      category: e.category as ExpenseCategory,
      plannedCents: e.planned_cents == null ? null : Number(e.planned_cents),
      plannedEurCents: e.planned_eur_cents == null ? null : Number(e.planned_eur_cents),
      actualCents: e.actual_cents == null ? null : Number(e.actual_cents),
      actualEurCents: e.actual_eur_cents == null ? null : Number(e.actual_eur_cents),
      accountId: e.account_id ?? null,
      note: e.note ?? null,
      txActualCents: tx?.cents ?? null,
      txCount: tx?.count ?? 0,
      txList: sortByDate(tx?.list ?? []),
    };
  });
  // A row that only exists because purchases were tagged to it — no plan
  // typed yet — still shows on the trip.
  const seen = new Set(expenseRows.map((e) => `${e.tripId}:${e.category}`));
  for (const [key, tx] of txByRow) {
    if (seen.has(key)) continue;
    const [tripId, category] = key.split(":");
    expenseRows.push({
      tripId, category: category as ExpenseCategory,
      plannedCents: null, plannedEurCents: null, actualCents: null, actualEurCents: null,
      accountId: null, note: null, txActualCents: tx.cents, txCount: tx.count, txList: sortByDate(tx.list),
    });
  }

  // Closed cards stay selectable only if they already carry a stay — a booking
  // made on a card that has since been closed still belongs in the log.
  const usedAccountIds = new Set(
    [...(stays.data ?? []), ...(flights.data ?? []), ...(cars.data ?? [])].map((s) => s.account_id).filter(Boolean) as string[],
  );
  const cards: TravelCard[] = rewards.cards
    .filter((a) => !a.dateClosed || usedAccountIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      holder: a.holder ?? null,
      currentPoints: a.cardDetails?.currentPoints ?? 0,
      pointsValueMicros: a.cardDetails?.pointsValueMicros ?? null,
      freeNightCreditCents: a.cardDetails?.freeNightCreditCents ?? null,
      freeNightPointsLimit: a.cardDetails?.freeNightPointsLimit ?? null,
      freeNightCategoryMax: a.cardDetails?.freeNightCategoryMax ?? null,
    }));

  const rows: TravelStay[] = (stays.data ?? []).map((s) => ({
    id: s.id,
    tripId: s.trip_id ?? null,
    accountId: s.account_id ?? null,
    cardLabel: s.card_label ?? null,
    holder: s.holder ?? null,
    propertyName: s.property_name,
    city: s.city ?? null,
    brand: s.brand ?? null,
    bookingChannel: s.booking_channel ?? null,
    reservedOn: s.reserved_on ?? null,
    checkIn: s.check_in,
    nights: s.nights ?? 1,
    pax: s.pax ?? null,
    pointsCost: s.points_cost ?? 0,
    pointsValueMicros: s.points_value_micros ?? null,
    hotelCreditCents: s.hotel_credit_cents ?? 0,
    hotelCostCents: s.hotel_cost_cents ?? 0,
    pocketCostCents: s.pocket_cost_cents ?? 0,
    pocketPaidWith: (s.pocket_paid_with ?? "card") as PocketPaidWith,
    remarks: s.remarks ?? null,
    pointsUsed: s.points_used ?? false,
    breakfastIncluded: s.breakfast_included ?? false,
    cancelledAt: s.cancelled_at ?? null,
    rewardActivityId: s.reward_activity_id ?? null,
    freeNightUsed: s.free_night_used ?? false,
    freeNightPoints: s.free_night_points ?? null,
    movesCardPoints: s.moves_card_points ?? false,
    isEstimate: s.is_estimate ?? false,
    plannedCostCents: s.planned_cost_cents == null ? null : Number(s.planned_cost_cents),
    plannedCostForeignCents: s.planned_cost_foreign_cents == null ? null : Number(s.planned_cost_foreign_cents),
    costForeignCents: s.cost_foreign_cents == null ? null : Number(s.cost_foreign_cents),
    foreignCurrency: s.foreign_currency ?? "EUR",
  }));

  const flightRows: TravelFlight[] = (flights.data ?? []).map((f) => ({
    id: f.id,
    tripId: f.trip_id ?? null,
    accountId: f.account_id ?? null,
    cardLabel: f.card_label ?? null,
    holder: f.holder ?? null,
    airline: f.airline,
    bookingCode: f.booking_code ?? null,
    reservedOn: f.reserved_on ?? null,
    firstFlightOn: f.first_flight_on,
    pointsCost: f.points_cost ?? 0,
    pointsUsed: f.points_used ?? false,
    pointsValueMicros: f.points_value_micros ?? null,
    flightCostCents: Number(f.flight_cost_cents ?? 0),
    flightCostEurCents: f.flight_cost_eur_cents == null ? null : Number(f.flight_cost_eur_cents),
    movesCardPoints: f.moves_card_points ?? true,
    isEstimate: f.is_estimate ?? false,
    plannedCostCents: f.planned_cost_cents == null ? null : Number(f.planned_cost_cents),
    plannedCostForeignCents: f.planned_cost_foreign_cents == null ? null : Number(f.planned_cost_foreign_cents),
    foreignCurrency: f.foreign_currency ?? "EUR",
    pocketCostCents: Number(f.pocket_cost_cents ?? 0),
    remarks: f.remarks ?? null,
    cancelledAt: f.cancelled_at ?? null,
    rewardActivityId: f.reward_activity_id ?? null,
    legs: (legs.data ?? [])
      .filter((l) => l.flight_id === f.id)
      .map((l) => ({
        flightOn: l.flight_on,
        flightNumber: l.flight_number ?? null,
        fromPlace: l.from_place ?? null,
        toPlace: l.to_place ?? null,
        departsAt: l.departs_at ? String(l.departs_at).slice(0, 5) : null,
        arrivesAt: l.arrives_at ? String(l.arrives_at).slice(0, 5) : null,
      })),
    passengers: (passengers.data ?? [])
      .filter((p) => p.flight_id === f.id)
      .map((p) => ({
        travellerId: p.traveller_id ?? null,
        name: p.name,
        fareCents: Number(p.fare_cents ?? 0),
        fareEurCents: p.fare_eur_cents == null ? null : Number(p.fare_eur_cents),
        plannedFareCents: p.planned_fare_cents == null ? null : Number(p.planned_fare_cents),
        plannedFareForeignCents: p.planned_fare_foreign_cents == null ? null : Number(p.planned_fare_foreign_cents),
        pointsUsed: p.points_used ?? false,
        pointsCost: p.points_cost ?? 0,
      })),
  }));

  const carRows: TravelCar[] = (cars.data ?? []).map((c) => ({
    id: c.id,
    tripId: c.trip_id ?? null,
    kind: (c.kind === "own_car" ? "own_car" : "rental") as CarKind,
    company: c.company ?? null,
    bookingCode: c.booking_code ?? null,
    reservedOn: c.reserved_on ?? null,
    pickupOn: c.pickup_on,
    pickupTime: c.pickup_time ? String(c.pickup_time).slice(0, 5) : null,
    pickupPlace: c.pickup_place ?? null,
    returnOn: c.return_on ?? null,
    returnTime: c.return_time ? String(c.return_time).slice(0, 5) : null,
    returnPlace: c.return_place ?? null,
    accountId: c.account_id ?? null,
    cardLabel: c.card_label ?? null,
    holder: c.holder ?? null,
    pointsCost: c.points_cost ?? 0,
    pointsUsed: c.points_used ?? false,
    pointsValueMicros: c.points_value_micros ?? null,
    costCents: Number(c.cost_cents ?? 0),
    costEurCents: c.cost_eur_cents == null ? null : Number(c.cost_eur_cents),
    movesCardPoints: c.moves_card_points ?? true,
    isEstimate: c.is_estimate ?? false,
    plannedCostCents: c.planned_cost_cents == null ? null : Number(c.planned_cost_cents),
    plannedCostForeignCents: c.planned_cost_foreign_cents == null ? null : Number(c.planned_cost_foreign_cents),
    foreignCurrency: c.foreign_currency ?? "EUR",
    pocketCostCents: Number(c.pocket_cost_cents ?? 0),
    remarks: c.remarks ?? null,
    cancelledAt: c.cancelled_at ?? null,
    rewardActivityId: c.reward_activity_id ?? null,
  }));

  return (
    <TravelBoard
      trips={(trips.data ?? []).map((t): TravelTrip => ({
        id: t.id,
        name: t.name,
        startOn: t.start_on ?? null,
        endOn: t.end_on ?? null,
        notes: t.notes ?? null,
        spendingCurrency: t.spending_currency ?? "EUR",
      }))}
      expenses={expenseRows}
      cars={carRows}
      flights={flightRows}
      travellers={(travellers.data ?? []) as Traveller[]}
      today={new Date().toISOString().slice(0, 10)}
      stays={rows}
      cards={cards}
      brands={(brands.data ?? []) as TravelBrand[]}
      currency={household.currency ?? "$"}
      rewards={rewards}
    />
  );
}
