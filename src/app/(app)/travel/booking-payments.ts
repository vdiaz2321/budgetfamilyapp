import type { createClient } from "@/lib/supabase/server";
import { syncFreeNightStamp, syncRewardLedger } from "./reward-ledger";

// Not a "use server" file: only the transaction actions call this.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type BookingKind = "stay" | "flight" | "car";
export type BookingRef = { kind: BookingKind; id: string };

// transactions.<column> that points at each kind of booking.
export const BOOKING_COLUMN: Record<BookingKind, "travel_stay_id" | "travel_flight_id" | "travel_car_id"> = {
  stay: "travel_stay_id",
  flight: "travel_flight_id",
  car: "travel_car_id",
};
const TABLE: Record<BookingKind, "travel_stays" | "travel_flights" | "travel_cars"> = {
  stay: "travel_stays",
  flight: "travel_flights",
  car: "travel_cars",
};

/** "stay:<uuid>" ⇄ { kind, id } — how the transaction form names a booking. */
export function parseBookingRef(raw: string | null | undefined): BookingRef | null {
  const [kind, id] = String(raw ?? "").split(":");
  if ((kind === "stay" || kind === "flight" || kind === "car") && id) return { kind, id };
  return null;
}
export function bookingRefOf(row: { travel_stay_id?: string | null; travel_flight_id?: string | null; travel_car_id?: string | null }): BookingRef | null {
  if (row.travel_stay_id) return { kind: "stay", id: row.travel_stay_id };
  if (row.travel_flight_id) return { kind: "flight", id: row.travel_flight_id };
  if (row.travel_car_id) return { kind: "car", id: row.travel_car_id };
  return null;
}
/** The three columns a transaction row carries for one (or no) booking. */
export function bookingColumns(ref: BookingRef | null) {
  return {
    travel_stay_id: ref?.kind === "stay" ? ref.id : null,
    travel_flight_id: ref?.kind === "flight" ? ref.id : null,
    travel_car_id: ref?.kind === "car" ? ref.id : null,
  };
}

/**
 * A booking named on the transaction form, checked to be this household's
 * and — when the transaction is tagged to a trip — in that trip. Anything
 * else is dropped rather than linked to the wrong booking.
 */
export async function resolveBookingRef(
  supabase: SupabaseClient,
  householdId: string,
  raw: string,
  tripId: string | null,
): Promise<BookingRef | null> {
  const ref = parseBookingRef(raw);
  if (!ref) return null;
  const { data, error } = await supabase
    .from(TABLE[ref.kind])
    .select("id, trip_id")
    .eq("id", ref.id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw new Error(`Could not verify the booking: ${error.message}`);
  if (!data) return null;
  if (tripId && data.trip_id !== tripId) return null;
  return ref;
}

/**
 * Brings a booking in line with the payments linked to it: its Pocket cost is
 * what those payments add up to (a refund is negative and comes off), and the
 * first payment marks it Booked — drawing its points off the card through the
 * same ledger the booking form uses, so the two can never disagree.
 *
 * With no payments left (the last link removed) the booking is left exactly
 * as it was: a figure typed by hand is never wiped by unlinking.
 */
export async function syncBookingPayment(
  supabase: SupabaseClient,
  householdId: string,
  ref: BookingRef,
  // Points typed on the transaction form: written onto the booking as its
  // points figure, so the Travel Log never has to be visited for them.
  // Null leaves the booking's own points figure alone.
  pointsTyped: number | null = null,
): Promise<string | null> {
  const { data: payments, error: payError } = await supabase
    .from("transactions")
    .select("amount_cents")
    .eq("household_id", householdId)
    .eq(BOOKING_COLUMN[ref.kind], ref.id);
  if (payError) return `Couldn't read the booking's payments — ${payError.message}`;
  if (!payments || payments.length === 0) return null;
  const paid = Math.max(0, payments.reduce((sum, p) => sum + Number(p.amount_cents), 0));

  const { data: booking, error } = await supabase
    .from(TABLE[ref.kind])
    .select("*")
    .eq("id", ref.id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) return `Couldn't read that booking — ${error.message}`;
  if (!booking) return null;
  const b = booking as Record<string, unknown>;

  const update: Record<string, unknown> = { pocket_cost_cents: paid, updated_at: new Date().toISOString() };
  if (pointsTyped != null) {
    update.points_cost = pointsTyped;
    update.points_used = pointsTyped > 0;
    // A flight's points are its passengers' points added up; the form
    // rebuilds the total from them on its next save, so the typed figure
    // goes on the first passenger and the rest are cleared.
    if (ref.kind === "flight") {
      const { data: pax } = await supabase
        .from("travel_flight_passengers")
        .select("id, sort_order")
        .eq("flight_id", ref.id)
        .eq("household_id", householdId)
        .order("sort_order");
      for (const [i, p] of (pax ?? []).entries()) {
        await supabase
          .from("travel_flight_passengers")
          .update({ points_used: i === 0 && pointsTyped > 0, points_cost: i === 0 ? pointsTyped : 0 })
          .eq("id", p.id)
          .eq("household_id", householdId);
      }
    }
  }

  // The payment says it is booked now. Points and hotel credit leave the card
  // exactly as the form's Booked switch would make them — and a points figure
  // typed on a booking already Booked moves the card by the difference.
  if (!b.cancelled_at) {
    const accountId = (b.account_id as string | null) ?? null;
    const wasBooked = !b.is_estimate;
    const drawnBefore = wasBooked && b.points_used ? Number(b.points_cost ?? 0) : 0;
    const creditBefore = wasBooked && ref.kind === "stay" ? Number(b.hotel_credit_cents ?? 0) : 0;
    const points = pointsTyped ?? (b.points_used ? Number(b.points_cost ?? 0) : 0);
    const credit = ref.kind === "stay" ? Number(b.hotel_credit_cents ?? 0) : 0;
    let activityId = (b.reward_activity_id as string | null) ?? null;
    if (b.moves_card_points && accountId && (points !== drawnBefore || credit !== creditBefore)) {
      const meta =
        ref.kind === "stay"
          ? { occurredOn: (b.reserved_on as string | null) ?? (b.check_in as string), bookedOn: b.check_in as string, note: b.property_name as string }
          : ref.kind === "flight"
            ? { occurredOn: (b.reserved_on as string | null) ?? (b.first_flight_on as string), bookedOn: null, note: [b.airline, b.booking_code].filter(Boolean).join(" ") }
            : { occurredOn: (b.reserved_on as string | null) ?? (b.pickup_on as string), bookedOn: null, note: [b.company ?? "Car rental", b.booking_code].filter(Boolean).join(" ") };
      const sync = await syncRewardLedger(
        supabase,
        householdId,
        { accountId, points: drawnBefore, credit: creditBefore },
        { accountId, points, credit },
        meta,
        activityId,
        ref.kind === "stay" ? "free_night_booking" : ref.kind === "flight" ? "flight_booking" : "car_booking",
      );
      if (sync.error) {
        // The card can't cover it: keep the payment and the pocket cost,
        // leave the booking's status and points as they were, and say why.
        const { pocket_cost_cents, updated_at } = update;
        const { error: partial } = await supabase.from(TABLE[ref.kind]).update({ pocket_cost_cents, updated_at }).eq("id", ref.id).eq("household_id", householdId);
        return partial ? `Couldn't update that booking — ${partial.message}` : `Paid, but the points weren't taken: ${sync.error}`;
      }
      activityId = sync.activityId;
    }
    if (ref.kind === "stay" && b.is_estimate && b.free_night_used && accountId) {
      const stampError = await syncFreeNightStamp(supabase, householdId, null, { accountId, checkIn: b.check_in as string });
      if (stampError) return stampError;
    }
    update.is_estimate = false;
    update.reward_activity_id = activityId;
  }

  const { error: saveError } = await supabase.from(TABLE[ref.kind]).update(update).eq("id", ref.id).eq("household_id", householdId);
  if (saveError) return `Couldn't update that booking — ${saveError.message}`;
  return null;
}
