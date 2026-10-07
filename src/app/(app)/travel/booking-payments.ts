import type { createClient } from "@/lib/supabase/server";
import { syncFreeNightStamp, syncRewardLedger } from "./reward-ledger";
import { parseShares, shareOut } from "@/lib/share-out";

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
 * What the transactions linked to a booking add up to (a refund comes off),
 * or null when none are linked. A booking with linked payments takes its
 * Pocket cost from them — the booking forms show it locked, and saving a form
 * keeps this total rather than whatever the form sent.
 */
export async function linkedPaidCents(
  supabase: SupabaseClient,
  householdId: string,
  kind: BookingKind,
  id: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount_cents")
    .eq("household_id", householdId)
    .eq(BOOKING_COLUMN[kind], id);
  if (error) throw new Error(`Couldn't read the booking's payments — ${error.message}`);
  if (!data || data.length === 0) return null;
  return Math.max(0, data.reduce((sum, p) => sum + Number(p.amount_cents), 0));
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
  // The card on the booking — a payment on a card links it when none was.
  account_id?: string | null;
  // Flights: each passenger's points and Spent figures, since payments
  // rewrite them, and the fares added up. Matched back by name too: saving
  // the flight form rewrites the passenger rows with new ids.
  flight_cost_cents?: number;
  passengers?: Array<{
    id: string; name?: string; points_used: boolean; points_cost: number;
    fare_cents?: number; cash_paid_cents?: number | null; fare_eur_cents?: number | null;
  }>;
  flight_cost_eur_cents?: number | null;
  foreign_currency?: string | null;
  points_value_micros?: number | null;
};

/** Points typed per passenger on the transaction form, by name. */
export type PassengerPoints = { name: string; points: number };

type PaxRow = {
  id: string; name: string; sort_order: number; fare_cents: number; fare_eur_cents: number | null; planned_fare_cents: number | null;
  points_used: boolean; points_cost: number; cash_paid_cents: number | null;
};
type Seat = {
  id: string; points_used: boolean; points_cost: number; fare_cents: number; cash_paid_cents: number | null;
  // Left out when no payment gave a foreign figure, so a typed one stays.
  fare_eur_cents?: number | null;
};

/**
 * Each passenger's seat as the payments linked to the flight make it. Every
 * payment is shared out by the split saved on it (scaled to its amount, so a
 * split purchase's parts and a refund each take their share), or — saved
 * before splits existed — by the passengers' planned fares. A cash seat's
 * Spent fare is its share; a points seat keeps its fare (what the seat would
 * have cost, which values the points) and its share is the cash paid on top.
 * Points typed on the form replace a passenger's points; the rest keep theirs.
 */
function flightSeats(
  pax: PaxRow[],
  payments: Array<{ amount_cents: number; booking_passengers?: unknown }>,
  paxPoints: PassengerPoints[] | null,
): Seat[] {
  const key = (n: string) => n.trim().toLowerCase();
  const paid = pax.map(() => 0);
  const paidForeign = pax.map(() => 0);
  let anyForeign = false;
  for (const tx of payments) {
    const shares = parseShares(tx.booking_passengers);
    let weights = pax.map(() => 0);
    const foreign = pax.map(() => 0);
    if (shares) {
      const used = new Set<number>();
      shares.forEach((s, j) => {
        let i = pax.findIndex((p, n) => !used.has(n) && key(p.name) === key(s.name));
        // A passenger renamed since: the same place in the list.
        if (i < 0 && j < pax.length && !used.has(j)) i = j;
        if (i < 0) return;
        used.add(i);
        weights[i] = s.cents;
        if (s.foreignCents != null) {
          foreign[i] = s.foreignCents;
          anyForeign = true;
        }
      });
    }
    // The foreign figures are what was typed for the whole purchase; a split
    // part or a refund takes its share of them, as of the dollars.
    const typedCents = weights.reduce((a, b) => a + b, 0);
    if (typedCents > 0) {
      const scale = Number(tx.amount_cents) / typedCents;
      foreign.forEach((f, i) => (paidForeign[i] += Math.round(f * scale)));
    }
    if (!weights.some((w) => w > 0)) weights = pax.map((p) => Number(p.planned_fare_cents ?? p.fare_cents ?? 0));
    shareOut(Number(tx.amount_cents), weights).forEach((c, i) => (paid[i] += c));
  }
  const typed = new Map((paxPoints ?? []).map((p) => [key(p.name), p.points]));
  return pax.map((p, i) => {
    const points = typed.get(key(p.name)) ?? (p.points_used ? Number(p.points_cost ?? 0) : 0);
    const onPoints = points > 0;
    const share = Math.max(0, paid[i]);
    return {
      id: p.id,
      points_used: onPoints,
      points_cost: points,
      fare_cents: onPoints ? Number(p.planned_fare_cents ?? p.fare_cents ?? 0) : share,
      cash_paid_cents: onPoints ? share || null : null,
      ...(anyForeign ? { fare_eur_cents: Math.max(0, paidForeign[i]) || null } : {}),
    };
  });
}

async function saveSeats(supabase: SupabaseClient, householdId: string, seats: Seat[]): Promise<string | null> {
  for (const { id, ...seat } of seats) {
    const { error } = await supabase.from("travel_flight_passengers").update(seat).eq("id", id).eq("household_id", householdId);
    if (error) return `Couldn't save the passengers' fares — ${error.message}`;
  }
  return null;
}

/** The account, when it is a credit card — the only kind a booking is put on. */
async function cardAccount(supabase: SupabaseClient, householdId: string, accountId: string | null | undefined) {
  if (!accountId) return null;
  const { data, error } = await supabase
    .from("accounts")
    .select("id, kind")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the payment's card: ${error.message}`);
  return data?.kind === "credit_card" ? (data.id as string) : null;
}

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
  // Flights: points typed per passenger. Any booking: the card the payment
  // was on, linked to the booking when it has no card yet.
  // Also a flight's currency for the foreign figures, and a value per point
  // typed on the form (kept over the worked-out one).
  extra: {
    paxPoints?: PassengerPoints[] | null; paymentAccountId?: string | null;
    currency?: string | null; pointsValueMicros?: number | null;
  } = {},
): Promise<string | null> {
  const { data: payments, error: payError } = await supabase
    .from("transactions")
    .select("amount_cents, booking_passengers")
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

  // Flights: every passenger's seat, rebuilt from the payments below.
  let pax: PaxRow[] = [];
  if (ref.kind === "flight") {
    const { data, error: paxError } = await supabase
      .from("travel_flight_passengers")
      .select("id, name, sort_order, fare_cents, fare_eur_cents, planned_fare_cents, points_used, points_cost, cash_paid_cents")
      .eq("flight_id", ref.id)
      .eq("household_id", householdId)
      .order("sort_order");
    if (paxError) return `Couldn't read the flight's passengers — ${paxError.message}`;
    pax = (data ?? []) as PaxRow[];
  }

  // First payment on a booking whose figures are the user's: remember them.
  if (b.payment_restore == null) {
    const restore: PaymentRestore = {
      pocket_cost_cents: Number(b.pocket_cost_cents ?? 0),
      is_estimate: Boolean(b.is_estimate),
      points_cost: Number(b.points_cost ?? 0),
      points_used: Boolean(b.points_used),
      reward_activity_id: (b.reward_activity_id as string | null) ?? null,
      account_id: (b.account_id as string | null) ?? null,
    };
    if (ref.kind === "flight") {
      restore.flight_cost_cents = Number(b.flight_cost_cents ?? 0);
      restore.flight_cost_eur_cents = (b.flight_cost_eur_cents as number | null) ?? null;
      restore.foreign_currency = (b.foreign_currency as string | null | undefined) ?? null;
      restore.passengers = pax.map((p) => ({
        id: p.id, name: p.name, points_used: Boolean(p.points_used), points_cost: Number(p.points_cost ?? 0),
        fare_cents: Number(p.fare_cents ?? 0), cash_paid_cents: p.cash_paid_cents, fare_eur_cents: p.fare_eur_cents,
      }));
    }
    if (b.points_value_micros !== undefined) {
      restore.points_value_micros = (b.points_value_micros as number | null) ?? null;
    }
    update.payment_restore = restore;
  }

  // A booking with no card takes the card this payment was made on, so its
  // points come off the card that paid.
  let accountId = (b.account_id as string | null) ?? null;
  if (!accountId && !b.cancelled_at) {
    const card = await cardAccount(supabase, householdId, extra.paymentAccountId);
    if (card) {
      accountId = card;
      update.account_id = card;
    }
  }

  // A flight's points are its passengers' points added up, and its cost
  // their fares added up — the same rule the flight form saves by.
  // (A flight with no passengers on record keeps its own figures.)
  const isFlight = ref.kind === "flight" && pax.length > 0;
  const seats = isFlight ? flightSeats(pax, payments, extra.paxPoints ?? null) : [];
  if (isFlight) {
    const points = seats.reduce((sum, p) => sum + p.points_cost, 0);
    const pointsFares = seats.reduce((sum, p) => sum + (p.points_used ? p.fare_cents : 0), 0);
    pointsTyped = points;
    update.flight_cost_cents = seats.reduce((sum, p) => sum + p.fare_cents, 0);
    if (seats.some((p) => p.fare_eur_cents !== undefined)) {
      update.flight_cost_eur_cents = seats.some((p) => p.fare_eur_cents != null)
        ? seats.reduce((sum, p) => sum + (p.fare_eur_cents ?? 0), 0)
        : null;
      if (extra.currency) update.foreign_currency = extra.currency;
    }
    // The value per point follows the points, unless one was typed by hand.
    const oldPoints = Number(b.points_cost ?? 0);
    const oldFares = pax.reduce((sum, p) => sum + (p.points_used ? Number(p.fare_cents ?? 0) : 0), 0);
    const oldImplied = oldPoints > 0 && oldFares > 0 ? Math.round((oldFares / oldPoints) * 10_000) : null;
    if (b.points_value_micros == null || Number(b.points_value_micros) === oldImplied) {
      update.points_value_micros = points > 0 && pointsFares > 0 ? Math.round((pointsFares / points) * 10_000) : null;
    }
  }
  if (pointsTyped != null) {
    update.points_cost = pointsTyped;
    update.points_used = pointsTyped > 0;
  }
  if (extra.pointsValueMicros != null) update.points_value_micros = extra.pointsValueMicros;

  // The payment says it is booked now. Points and hotel credit leave the card
  // exactly as the form's Booked switch would make them — and a points figure
  // typed on a booking already Booked moves the card by the difference.
  if (!b.cancelled_at) {
    // The card that drew before: none, when this payment just linked one.
    const accountBefore = (b.account_id as string | null) ?? null;
    const wasBooked = !b.is_estimate && accountBefore != null;
    const drawnBefore = wasBooked && b.points_used ? Number(b.points_cost ?? 0) : 0;
    const creditBefore = wasBooked && ref.kind === "stay" ? Number(b.hotel_credit_cents ?? 0) : 0;
    const points = pointsTyped ?? (b.points_used ? Number(b.points_cost ?? 0) : 0);
    const credit = ref.kind === "stay" ? Number(b.hotel_credit_cents ?? 0) : 0;
    let activityId = (b.reward_activity_id as string | null) ?? null;
    if (b.moves_card_points && accountId && (accountId !== accountBefore || points !== drawnBefore || credit !== creditBefore)) {
      const sync = await syncRewardLedger(
        supabase,
        householdId,
        { accountId: accountBefore, points: drawnBefore, credit: creditBefore },
        { accountId, points, credit },
        ledgerMeta(ref.kind, b),
        activityId,
        SPEND_TYPE[ref.kind],
      );
      if (sync.error) {
        // The card can't cover it: keep the payment and the pocket cost,
        // leave the booking's card, status and points as they were, and say
        // why. Each passenger's Spent figure still follows the payments.
        const { pocket_cost_cents, updated_at, payment_restore } = update;
        const partialUpdate: Record<string, unknown> = { pocket_cost_cents, updated_at };
        if (payment_restore !== undefined) partialUpdate.payment_restore = payment_restore;
        if (isFlight) {
          const cashOnly = flightSeats(pax, payments, null);
          const seatError = await saveSeats(supabase, householdId, cashOnly);
          if (seatError) return seatError;
          partialUpdate.flight_cost_cents = cashOnly.reduce((sum, p) => sum + p.fare_cents, 0);
        }
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

  if (isFlight) {
    const seatError = await saveSeats(supabase, householdId, seats);
    if (seatError) return seatError;
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
  // The card it had before: none, when the first payment linked this one.
  const accountThen = restore.account_id !== undefined ? restore.account_id : accountId;
  let activityId = (b.reward_activity_id as string | null) ?? null;

  if (!b.cancelled_at && accountId) {
    const credit = ref.kind === "stay" ? Number(b.hotel_credit_cents ?? 0) : 0;
    const drawnNow = !b.is_estimate && b.points_used ? Number(b.points_cost ?? 0) : 0;
    const creditNow = !b.is_estimate ? credit : 0;
    const drawnThen = accountThen && !restore.is_estimate && restore.points_used ? restore.points_cost : 0;
    const creditThen = accountThen && !restore.is_estimate ? credit : 0;
    if (b.moves_card_points && (accountThen !== accountId || drawnNow !== drawnThen || creditNow !== creditThen)) {
      const sync = await syncRewardLedger(
        supabase,
        householdId,
        { accountId, points: drawnNow, credit: creditNow },
        { accountId: accountThen, points: drawnThen, credit: creditThen },
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
    const { data: now, error: paxError } = await supabase
      .from("travel_flight_passengers")
      .select("id, name")
      .eq("flight_id", ref.id)
      .eq("household_id", householdId);
    if (paxError) return `Couldn't read the flight's passengers — ${paxError.message}`;
    const byName = (name: string | undefined) =>
      name ? (now ?? []).find((n) => n.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
    for (const p of restore.passengers) {
      // By id, or by name once the flight form has saved new passenger rows.
      const row = (now ?? []).find((n) => n.id === p.id) ?? byName(p.name);
      if (!row) continue;
      const { error: paxSave } = await supabase
        .from("travel_flight_passengers")
        .update({
          points_used: p.points_used,
          points_cost: p.points_cost,
          ...(p.fare_cents !== undefined ? { fare_cents: p.fare_cents, cash_paid_cents: p.cash_paid_cents ?? null } : {}),
          ...(p.fare_eur_cents !== undefined ? { fare_eur_cents: p.fare_eur_cents } : {}),
        })
        .eq("id", row.id)
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
      ...(restore.account_id !== undefined ? { account_id: restore.account_id } : {}),
      ...(ref.kind === "flight" && restore.flight_cost_cents !== undefined ? { flight_cost_cents: restore.flight_cost_cents } : {}),
      ...(ref.kind === "flight" && restore.flight_cost_eur_cents !== undefined ? { flight_cost_eur_cents: restore.flight_cost_eur_cents } : {}),
      ...(ref.kind === "flight" && restore.foreign_currency !== undefined ? { foreign_currency: restore.foreign_currency } : {}),
      ...(restore.points_value_micros !== undefined ? { points_value_micros: restore.points_value_micros } : {}),
      payment_restore: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ref.id)
    .eq("household_id", householdId);
  if (saveError) return `Couldn't put that booking back — ${saveError.message}`;
  return null;
}
