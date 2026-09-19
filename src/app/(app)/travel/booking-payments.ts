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
 * The booking as it stood just before its first linked payment — kept in the
 * booking's `payment_restore` column so removing the last payment can put it
 * back. NULL there means the figures are the user's own (never linked, or saved
 * by hand in the Travel Log since) and unlinking leaves them alone.
 */
type PaymentRestore = {
  pocket_cost_cents: number;
  is_estimate: boolean;
  points_cost: number;
  points_used: boolean;
  reward_activity_id: string | null;
  // Flights: each passenger's points, since a typed points figure rewrites them.
  passengers?: Array<{ id: string; points_used: boolean; points_cost: number }>;
};

// What the card's rewards ledger calls this booking.
function ledgerMeta(kind: BookingKind, b: Record<string, unknown>) {
  return kind === "stay"
    ? { occurredOn: (b.reserved_on as string | null) ?? (b.check_in as string), bookedOn: b.check_in as string, note: b.property_name as string }
    : kind === "flight"
      ? { occurredOn: (b.reserved_on as string | null) ?? (b.first_flight_on as string), bookedOn: null, note: [b.airline, b.booking_code].filter(Boolean).join(" ") }
      : { occurredOn: (b.reserved_on as string | null) ?? (b.pickup_on as string), bookedOn: null, note: [b.company ?? "Car rental", b.booking_code].filter(Boolean).join(" ") };
}
const SPEND_TYPE = { stay: "free_night_booking", flight: "flight_booking", car: "car_booking" } as const;

/**
 * Brings a booking in line with the payments linked to it: its Pocket cost is
 * what those payments add up to (a refund is negative and comes off), and the
 * first payment marks it Booked — drawing its points off the card through the
 * same ledger the booking form uses, so the two can never disagree.
 *
 * With no payments left (the last link deleted or moved) a booking that
 * payments had set is put back as it was before the first one — pocket cost,
 * Booked status, points, and any points drawn off the card. One whose figures
 * were typed by hand is left exactly as it was.
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

  const { data: booking, error } = await supabase
    .from(TABLE[ref.kind])
    .select("*")
    .eq("id", ref.id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) return `Couldn't read that booking — ${error.message}`;
  if (!booking) return null;
  const b = booking as Record<string, unknown>;

  if (!payments || payments.length === 0) {
    const restore = (b.payment_restore as PaymentRestore | null) ?? null;
    return restore ? restoreBooking(supabase, householdId, ref, b, restore) : null;
  }
  const paid = Math.max(0, payments.reduce((sum, p) => sum + Number(p.amount_cents), 0));

  const update: Record<string, unknown> = { pocket_cost_cents: paid, updated_at: new Date().toISOString() };

  // First payment on a booking whose figures are the user's: remember them.
  if (b.payment_restore == null) {
    const restore: PaymentRestore = {
      pocket_cost_cents: Number(b.pocket_cost_cents ?? 0),
      is_estimate: Boolean(b.is_estimate),
      points_cost: Number(b.points_cost ?? 0),
      points_used: Boolean(b.points_used),
      reward_activity_id: (b.reward_activity_id as string | null) ?? null,
    };
    if (ref.kind === "flight") {
      const { data: pax, error: paxError } = await supabase
        .from("travel_flight_passengers")
        .select("id, points_used, points_cost")
        .eq("flight_id", ref.id)
        .eq("household_id", householdId);
      if (paxError) return `Couldn't read the flight's passengers — ${paxError.message}`;
      restore.passengers = (pax ?? []).map((p) => ({ id: p.id, points_used: Boolean(p.points_used), points_cost: Number(p.points_cost ?? 0) }));
    }
    update.payment_restore = restore;
  }

  if (pointsTyped != null) {
    update.points_cost = pointsTyped;
    update.points_used = pointsTyped > 0;
    // A flight's points are its passengers' points added up; the form
    // rebuilds the total from them on its next save, so the typed figure
    // goes on the first passenger and the rest are cleared.
    if (ref.kind === "flight") {
      const { data: pax, error: paxError } = await supabase
        .from("travel_flight_passengers")
        .select("id, sort_order")
        .eq("flight_id", ref.id)
        .eq("household_id", householdId)
        .order("sort_order");
      if (paxError) return `Couldn't read the flight's passengers — ${paxError.message}`;
      for (const [i, p] of (pax ?? []).entries()) {
        const { error: paxSave } = await supabase
          .from("travel_flight_passengers")
          .update({ points_used: i === 0 && pointsTyped > 0, points_cost: i === 0 ? pointsTyped : 0 })
          .eq("id", p.id)
          .eq("household_id", householdId);
        if (paxSave) return `Couldn't set the flight's points — ${paxSave.message}`;
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
      const sync = await syncRewardLedger(
        supabase,
        householdId,
        { accountId, points: drawnBefore, credit: creditBefore },
        { accountId, points, credit },
        ledgerMeta(ref.kind, b),
        activityId,
        SPEND_TYPE[ref.kind],
      );
      if (sync.error) {
        // The card can't cover it: keep the payment and the pocket cost,
        // leave the booking's status and points as they were, and say why.
        const { pocket_cost_cents, updated_at, payment_restore } = update;
        const partialUpdate: Record<string, unknown> = { pocket_cost_cents, updated_at };
        if (payment_restore !== undefined) partialUpdate.payment_restore = payment_restore;
        const { error: partial } = await supabase.from(TABLE[ref.kind]).update(partialUpdate).eq("id", ref.id).eq("household_id", householdId);
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

/**
 * The last linked payment is gone: undo what the payments did. Points and
 * hotel credit go back to the card through the same ledger that drew them, the
 * free-night Booked date the first payment stamped is cleared, and the
 * booking's own figures return to what they were before the first payment.
 */
async function restoreBooking(
  supabase: SupabaseClient,
  householdId: string,
  ref: BookingRef,
  b: Record<string, unknown>,
  restore: PaymentRestore,
): Promise<string | null> {
  const accountId = (b.account_id as string | null) ?? null;
  let activityId = (b.reward_activity_id as string | null) ?? null;

  if (!b.cancelled_at && accountId) {
    const credit = ref.kind === "stay" ? Number(b.hotel_credit_cents ?? 0) : 0;
    const drawnNow = !b.is_estimate && b.points_used ? Number(b.points_cost ?? 0) : 0;
    const creditNow = !b.is_estimate ? credit : 0;
    const drawnThen = !restore.is_estimate && restore.points_used ? restore.points_cost : 0;
    const creditThen = !restore.is_estimate ? credit : 0;
    if (b.moves_card_points && (drawnNow !== drawnThen || creditNow !== creditThen)) {
      const sync = await syncRewardLedger(
        supabase,
        householdId,
        { accountId, points: drawnNow, credit: creditNow },
        { accountId, points: drawnThen, credit: creditThen },
        ledgerMeta(ref.kind, b),
        activityId,
        SPEND_TYPE[ref.kind],
      );
      if (sync.error) return `Payment removed, but the card's points couldn't be handed back: ${sync.error}`;
      activityId = sync.activityId;
    }
    // The first payment stamped the card's free-night Booked date; undo it.
    if (ref.kind === "stay" && restore.is_estimate && !b.is_estimate && b.free_night_used) {
      const stampError = await syncFreeNightStamp(supabase, householdId, { accountId, checkIn: b.check_in as string }, null);
      if (stampError) return stampError;
    }
  }

  if (ref.kind === "flight" && restore.passengers) {
    for (const p of restore.passengers) {
      const { error: paxSave } = await supabase
        .from("travel_flight_passengers")
        .update({ points_used: p.points_used, points_cost: p.points_cost })
        .eq("id", p.id)
        .eq("household_id", householdId);
      if (paxSave) return `Couldn't put the flight's points back — ${paxSave.message}`;
    }
  }

  const { error: saveError } = await supabase
    .from(TABLE[ref.kind])
    .update({
      pocket_cost_cents: restore.pocket_cost_cents,
      is_estimate: restore.is_estimate,
      points_cost: restore.points_cost,
      points_used: restore.points_used,
      reward_activity_id: activityId,
      payment_restore: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ref.id)
    .eq("household_id", householdId);
  if (saveError) return `Couldn't put that booking back — ${saveError.message}`;
  return null;
}
