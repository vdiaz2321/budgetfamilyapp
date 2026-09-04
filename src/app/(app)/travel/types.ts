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
  pointsValueMicros: number | null;
  hotelCreditCents: number;
  hotelCostCents: number;
  pocketCostCents: number;
  pocketPaidWith: PocketPaidWith;
  remarks: string | null;
  // Set when the stay's points were deducted from a card's balance. Its
  // presence is what locks the points fields against later editing.
  rewardActivityId: string | null;
};

export type PocketPaidWith = "cash" | "points" | "credit" | "tbd";

export const POCKET_PAID_LABELS: Record<PocketPaidWith, string> = {
  cash: "Cash",
  points: "Points",
  credit: "Hotel credit",
  tbd: "TBD",
};

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

// Cash value of the points spent on a stay, using the rate recorded with it.
export function pointsValueCents(stay: TravelStay): number {
  if (!stay.pointsCost || !stay.pointsValueMicros) return 0;
  return Math.round((stay.pointsCost * stay.pointsValueMicros) / 10_000);
}

export function stayYear(stay: TravelStay): string {
  return stay.checkIn.slice(0, 4);
}
