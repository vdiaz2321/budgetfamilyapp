// One row per hotel / apartment stay — the app's replacement for the travel
// tracking spreadsheet. Money is cents; `pointsValueMicros` is dollars-per-point
// x 1,000,000 ($0.006/pt -> 6000), matching credit_card_details.
export type TravelStay = {
  id: string;
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
