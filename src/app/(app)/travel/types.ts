// One row per hotel / apartment stay — the app's replacement for the travel
// tracking spreadsheet. Money is cents; `pointsValueMicros` is dollars-per-point
// x 1,000,000 ($0.006/pt -> 6000), matching credit_card_details.
export type TravelStay = {
  id: string;
  tripId: string | null;
  accountId: string | null;
  cardLabel: string | null;
  holder: string | null;
  propertyName: string;
  city: string | null;
  brand: string | null;
  bookingChannel: string | null;
  reservedOn: string | null;
  checkIn: string;
  nights: number;
  pax: number | null;
  pointsCost: number;
  // Whether those points were actually redeemed. False means the figure is
  // what the room *would* have cost in points on a stay that was paid in
  // cash — recorded to compare the two, never counted as spend, and never
  // deducted from a card's balance.
  pointsUsed: boolean;
  pointsValueMicros: number | null;
  hotelCreditCents: number;
  hotelCostCents: number;
  pocketCostCents: number;
  pocketPaidWith: PocketPaidWith;
  remarks: string | null;
  // Breakfast came with the room. Lived inside `remarks` on the imported
  // sheet; a flag of its own so it can be filtered and toggled from the log.
  breakfastIncluded: boolean;
  // Set when the booking fell through. A cancelled stay stays in the archive
  // but is left out of every total, chart and tally.
  cancelledAt: string | null;
  // Set when the stay's points were deducted from a card's balance. Its
  // presence is what locks the points fields against later editing.
  rewardActivityId: string | null;
  // Paid with the card's free-night certificate. Sets that card's Booked date;
  // takes no points. freeNightPoints is the certificate's cap for this stay.
  freeNightUsed: boolean;
  freeNightPoints: number | null;
  // True only for stays created in the app. Imported stays never took points
  // off a card, so editing them must not move a balance.
  movesCardPoints: boolean;
};

export type PocketPaidWith = "card" | "points" | "credit";

export const POCKET_PAID_LABELS: Record<PocketPaidWith, string> = {
  card: "Credit card",
  points: "Points",
  credit: "Hotel credit",
};

// One row of the managed "Booked thru / Brand" list.
export type TravelBrand = { id: string; name: string };

// Cards available to book against, in the stay form's dropdown.
export type TravelCard = {
  id: string;
  name: string;
  holder: string | null;
  currentPoints: number;
  // The card's own cents-per-point valuation, pre-filled into a new stay so the
  // redemption is valued the same way the Accounts page values the balance.
  pointsValueMicros: number | null;
  // What else the card still has to spend on a stay, shown the moment it is
  // picked: the dollar night credit, and the yearly free-night points cap.
  freeNightCreditCents: number | null;
  freeNightPointsLimit: number | null;
  freeNightCategoryMax: number | null;
};

// What the room would have cost minus what actually left the wallet. This is
// the sheet's "Total Saved" column and it reproduces every year in it.
export function savedCents(stay: TravelStay): number {
  return stay.hotelCostCents - stay.pocketCostCents;
}

/**
 * Dollars-per-point on a stay, in micros.
 *
 * The sheet's column E was a formula — hotel cost ÷ points — and a few rows
 * never got it filled in. Rather than showing a dash and dropping those points
 * out of every total, the same division is done here when the rate is missing
 * but both halves of it are present. A stay that cost points but has no hotel
 * cost still has nothing to divide, so it stays blank.
 */
export function effectivePointsValueMicros(stay: TravelStay): number | null {
  if (stay.pointsValueMicros) return stay.pointsValueMicros;
  if (stay.pointsCost > 0 && stay.hotelCostCents > 0) {
    // cents / points = dollars-per-point ÷ 100 → ×10,000 gives micros.
    return Math.round((stay.hotelCostCents / stay.pointsCost) * 10_000);
  }
  return null;
}

// Cash value of the points spent on a stay, using the rate recorded with it —
// or the one implied by what the room would have cost.
export function pointsValueCents(stay: TravelStay): number {
  const micros = effectivePointsValueMicros(stay);
  if (!stay.pointsCost || !micros) return 0;
  return Math.round((stay.pointsCost * micros) / 10_000);
}

export function stayYear(stay: TravelStay): string {
  return stay.checkIn.slice(0, 4);
}

// ---- Flights. One TravelFlight is one booking (one booking code): a round
// trip on one receipt is one entry with two legs, costing one amount.
export type FlightLeg = {
  flightOn: string;
  flightNumber: string | null;
  fromPlace: string | null;
  toPlace: string | null;
  departsAt: string | null; // "HH:MM"
  arrivesAt: string | null;
};

export type FlightPassenger = {
  travellerId: string | null;
  name: string;
  // Each person's own fare — adult and child fares differ. Kept on a points
  // ticket too, as what the seat would have cost in cash.
  fareCents: number;
  fareEurCents: number | null;
  pointsUsed: boolean;
  pointsCost: number;
};

export type TravelFlight = {
  id: string;
  tripId: string | null;
  accountId: string | null;
  cardLabel: string | null;
  holder: string | null;
  airline: string;
  bookingCode: string | null;
  reservedOn: string | null;
  firstFlightOn: string;
  pointsCost: number;
  pointsUsed: boolean;
  pointsValueMicros: number | null;
  // The passengers' fares added up.
  flightCostCents: number;
  flightCostEurCents: number | null;
  // False for flights brought in from the Google Sheet: editing one fixes the
  // record and never moves a card's points.
  movesCardPoints: boolean;
  pocketCostCents: number;
  remarks: string | null;
  cancelledAt: string | null;
  rewardActivityId: string | null;
  legs: FlightLeg[];
  passengers: FlightPassenger[];
};

// A first name on the managed family list the passenger picker offers.
export type Traveller = { id: string; name: string };

// ---- Cars: a rental booking, or a drive in the family car (fuel and tolls).
export type CarKind = "rental" | "own_car";

export type TravelCar = {
  id: string;
  tripId: string | null;
  kind: CarKind;
  company: string | null;
  bookingCode: string | null;
  reservedOn: string | null;
  pickupOn: string;
  pickupTime: string | null;
  pickupPlace: string | null;
  returnOn: string | null;
  returnTime: string | null;
  returnPlace: string | null;
  accountId: string | null;
  cardLabel: string | null;
  holder: string | null;
  pointsCost: number;
  pointsUsed: boolean;
  pointsValueMicros: number | null;
  // Rental: the cash price. Own car: fuel and tolls.
  costCents: number;
  costEurCents: number | null;
  movesCardPoints: boolean;
  pocketCostCents: number;
  remarks: string | null;
  cancelledAt: string | null;
  rewardActivityId: string | null;
};

// A trip: a name, and optionally its own dates. Without dates they are read
// from the bookings in it. Totals always come from the bookings and expenses.
export type TravelTrip = {
  id: string;
  name: string;
  startOn: string | null;
  endOn: string | null;
  notes: string | null;
};

// A trip's day-to-day spending, one total per category for the whole trip.
export const EXPENSE_CATEGORIES = [
  { key: "restaurants", label: "Restaurants" },
  { key: "groceries", label: "Groceries" },
  { key: "entertainment", label: "Entertainment" },
  { key: "transport", label: "Public transport" },
  { key: "fuel_tolls", label: "Fuel & tolls" },
  { key: "parking", label: "Parking" },
  { key: "cash", label: "Cash / currency" },
  { key: "other", label: "Gifts & other" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["key"];

export type TripExpense = {
  tripId: string;
  category: ExpenseCategory;
  plannedCents: number | null;
  plannedEurCents: number | null;
  actualCents: number | null;
  actualEurCents: number | null;
  accountId: string | null;
  note: string | null;
};

// What a category counts toward the trip: the real figure once there is one,
// the estimate until then.
export function expenseCents(e: TripExpense): number {
  return e.actualCents ?? e.plannedCents ?? 0;
}
