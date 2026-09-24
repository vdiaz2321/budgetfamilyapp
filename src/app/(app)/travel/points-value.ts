// What a point has actually been worth, per card.
//
// The board already says what a point is worth in theory — the cents-per-point
// typed on the card. This says what it came out at in practice: every award
// booking's list price, less what still left the wallet, over the points it
// took. That figure is the one a redemption is judged against, and it is the
// only one that can't be wishful: it is made of bookings already taken.
//
// Kept out of the components so the per-card table, the headline tile and the
// card rows can't work it out three different ways.

import type { TravelCar, TravelFlight, TravelStay } from "./types";

export type CardRedemption = {
  /** Points handed over. */
  points: number;
  /** Cash the points stood in for: list price less pocket cost (and less any
   *  hotel credit, which is the card's money, not the points'). */
  valueCents: number;
  bookings: number;
};

export const emptyRedemption = (): CardRedemption => ({ points: 0, valueCents: 0, bookings: 0 });

/**
 * Realized cents per point, or null when nothing has been redeemed yet.
 * The value is already in cents, so dividing by points IS cents per point.
 */
export function centsPerPoint(r: CardRedemption): number | null {
  if (r.points <= 0) return null;
  return r.valueCents / r.points;
}

/** The same figure the card stores, in cents per point, for comparison. */
export function statedCentsPerPoint(pointsValueMicros: number | null | undefined): number | null {
  if (!pointsValueMicros) return null;
  return pointsValueMicros / 10_000;
}

// The key a booking with no card on it is filed under, so 760,000 points of
// award flights from before cards were tracked are still counted somewhere
// rather than silently dropped out of the totals.
export const UNLINKED = "__unlinked__";

type Awardable = {
  accountId: string | null;
  pointsUsed: boolean;
  pointsCost: number;
  cancelledAt: string | null;
};

// A booking counts only when points actually paid for it. A free-night
// certificate is a benefit, not a points spend — it has no points to divide
// by, and folding its value in would flatter every rate on the page.
const counts = (b: Awardable) => b.pointsUsed && b.pointsCost > 0 && !b.cancelledAt;

/**
 * Award bookings added up per card. Value is never negative — a stay whose
 * pocket cost exceeds its list price (a resort fee on an award night) is worth
 * zero, not a credit against the other redemptions.
 */
export function redemptionsByCard(
  stays: TravelStay[],
  flights: TravelFlight[],
  cars: TravelCar[],
): Map<string, CardRedemption> {
  const out = new Map<string, CardRedemption>();
  const add = (accountId: string | null, points: number, valueCents: number) => {
    const key = accountId ?? UNLINKED;
    const cur = out.get(key) ?? emptyRedemption();
    cur.points += points;
    cur.valueCents += Math.max(0, valueCents);
    cur.bookings += 1;
    out.set(key, cur);
  };

  for (const s of stays) {
    if (!counts(s)) continue;
    // Hotel credit is the card's annual credit spent on the room; it bought
    // part of the stay, so it is not value the points delivered.
    add(s.accountId, s.pointsCost, s.hotelCostCents - s.pocketCostCents - (s.hotelCreditCents ?? 0));
  }
  for (const f of flights) {
    if (!counts(f)) continue;
    add(f.accountId, f.pointsCost, f.flightCostCents - f.pocketCostCents);
  }
  for (const c of cars) {
    if (!counts(c)) continue;
    add(c.accountId, c.pointsCost, c.costCents - c.pocketCostCents);
  }
  return out;
}

/** Every card's redemptions rolled into one. */
export function totalRedemption(byCard: Map<string, CardRedemption>): CardRedemption {
  const total = emptyRedemption();
  for (const r of byCard.values()) {
    total.points += r.points;
    total.valueCents += r.valueCents;
    total.bookings += r.bookings;
  }
  return total;
}
