// When a booking's Spent comes from its transactions, and when it is still
// waiting for one. Shared by the booking forms, their save actions and the
// Bookings Log, so all three agree.

import type { TravelCar, TravelFlight, TravelStay } from "./types";

/** The app's own history starts here; anything booked before is the sheet's. */
export const APP_HISTORY_START = "2026-07-15";

/**
 * Spent may still be typed by hand: a booking imported from the sheet, or one
 * booked before the app. Every other booking's Spent is its linked
 * transactions only (Victor, 2026-10-24) — a typed figure with no transaction
 * behind it never reached Budget, the card's owed or Net Worth.
 */
export function spentTypedByHand(imported: boolean, reservedOn: string | null | undefined): boolean {
  return imported || Boolean(reservedOn && reservedOn < APP_HISTORY_START);
}

/** Today in the browser's or server's own calendar, as "2026-10-24". */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type DueBase = {
  isEstimate: boolean;
  cancelledAt: string | null;
  paid: boolean;
  imported: boolean;
  reservedOn: string | null;
  /** Something is owed in cash — not a stay on points or a free night. */
  cashToPay: boolean;
};

/** Booked, with cash to pay, and no transaction logged for it yet. */
export function paymentDue(b: DueBase): boolean {
  return !b.isEstimate && !b.cancelledAt && !b.paid && !spentTypedByHand(b.imported, b.reservedOn) && b.cashToPay;
}

/** A stay on points or a free night owes nothing; one paid at the hotel owes it from check-in. */
export const stayCashToPay = (s: { pointsUsed: boolean; freeNightUsed: boolean; payAtProperty: boolean; checkIn: string }) =>
  !s.pointsUsed && !s.freeNightUsed && !(s.payAtProperty && s.checkIn > today());

export const stayPaymentDue = (s: TravelStay) =>
  paymentDue({
    isEstimate: s.isEstimate,
    cancelledAt: s.cancelledAt,
    paid: s.paidCents != null,
    imported: !s.movesCardPoints,
    reservedOn: s.reservedOn,
    cashToPay: stayCashToPay(s),
  });

/** A flight owes cash unless every seat is on points. */
export const flightPaymentDue = (f: TravelFlight) =>
  paymentDue({
    isEstimate: f.isEstimate,
    cancelledAt: f.cancelledAt,
    paid: f.paidCents != null,
    imported: !f.movesCardPoints,
    reservedOn: f.reservedOn,
    cashToPay: f.passengers.some((p) => !p.pointsUsed),
  });

/** The family car is never paid for; a rental on points owes nothing. */
export const carPaymentDue = (c: TravelCar) =>
  paymentDue({
    isEstimate: c.isEstimate,
    cancelledAt: c.cancelledAt,
    paid: c.paidCents != null,
    imported: !c.movesCardPoints,
    reservedOn: c.reservedOn,
    cashToPay: c.kind === "rental" && !c.pointsUsed,
  });

/**
 * What a saved booking hands the transaction form, so its payment is logged
 * without retyping: the booking it pays for, its trip, card, payee, date and
 * planned amount. `due` says it is booked with cash still to log.
 */
export type PaymentPrefill = {
  bookingRef: string;
  tripId: string;
  label: string;
  accountId: string | null;
  amountCents: number | null;
  payee: string;
  date: string | null;
  due: boolean;
};
