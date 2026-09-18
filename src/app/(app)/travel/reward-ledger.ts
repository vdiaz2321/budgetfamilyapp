import type { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase-result";

// Not a "use server" file on purpose: everything exported from one of those is
// a callable endpoint, and this must only ever run inside a save action.

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// What a stay is currently drawing from a card.
export type RewardDraw = { accountId: string | null; points: number; credit: number };

// Every change to a stay — created, edited, cancelled, restored, deleted —
// comes through here. It compares what the stay used to draw from a card with
// what it draws now and posts the difference to the card's rewards ledger, so
// the Accounts balances always match the Travel Log. A spend is a negative
// delta; handing points back is a positive one.
//
// A stay keeps ONE ledger row (travel_stays.reward_activity_id). A change on
// the same card is folded into that row instead of stacking a new one on every
// save — correcting a typo used to leave a +15,700 and a -11,700 behind a net
// +4,000. The AFTER UPDATE trigger moves the card's balance by the difference,
// and a row whose net comes back to zero is deleted (the DELETE trigger hands
// back what it held). Returns the row that now stands for the stay, or null.
export async function syncRewardLedger(
  supabase: SupabaseClient,
  householdId: string,
  before: RewardDraw,
  after: RewardDraw,
  meta: { occurredOn: string; bookedOn: string | null; note: string },
  stayActivityId: string | null = null,
  // What a points spend is called on the card's ledger. Stays have always
  // written 'free_night_booking'; flights write their own label.
  spendType: "free_night_booking" | "flight_booking" | "car_booking" = "free_night_booking",
): Promise<{ error: string | null; activityId: string | null }> {
  const moves: Array<{ accountId: string; points: number; credit: number }> = [];

  if (before.accountId && before.accountId !== after.accountId) {
    // The stay moved to a different card (or to none): give the old card back
    // everything this stay had taken, then charge the new one in full.
    if (before.points || before.credit) {
      moves.push({ accountId: before.accountId, points: before.points, credit: before.credit });
    }
    if (after.accountId && (after.points || after.credit)) {
      moves.push({ accountId: after.accountId, points: -after.points, credit: -after.credit });
    }
  } else if (after.accountId) {
    const points = before.points - after.points;
    const credit = before.credit - after.credit;
    if (points || credit) moves.push({ accountId: after.accountId, points, credit });
  }

  // Nothing moved: the stay keeps whatever row it already had.
  if (moves.length === 0) return { error: null, activityId: stayActivityId };

  const linked = stayActivityId
    ? unwrap(
        await supabase
          .from("credit_card_reward_activities")
          .select("id, account_id, points_delta, hotel_credit_delta_cents")
          .eq("id", stayActivityId)
          .eq("household_id", householdId)
          .maybeSingle(),
        "credit_card_reward_activities",
      )
    : null;

  // Only the first draw on a stay is a booking. A later correction (an
  // imported stay whose points are fixed, say) must not stamp the card's
  // "Booked" date.
  const firstDraw = !before.points && !before.credit;
  const shape = (points: number, credit: number, stamp: boolean) => {
    const refund = points > 0 || credit > 0;
    return {
      activity_type: refund ? "reward_refund" : points < 0 ? spendType : "hotel_credit_redemption",
      booked_on: refund || !stamp ? null : meta.bookedOn,
      note: refund ? `${meta.note} (returned)` : meta.note,
    };
  };

  let activityId: string | null = linked?.id ?? null;
  for (const move of moves) {
    // A card can't go below what it holds, so check before drawing on it.
    if (move.points < 0 || move.credit < 0) {
      const details = unwrap(
        await supabase
          .from("credit_card_details")
          .select("current_points, free_night_credit_cents")
          .eq("account_id", move.accountId)
          .eq("household_id", householdId)
          .maybeSingle(),
        "credit_card_details",
      );
      if (!details) return { error: "That card has no rewards details to draw from.", activityId: null };
      if (-move.points > (details.current_points ?? 0)) {
        return {
          error: `That card only has ${(details.current_points ?? 0).toLocaleString()} points available.`,
          activityId: null,
        };
      }
      if (-move.credit > (details.free_night_credit_cents ?? 0)) {
        return {
          error: `That card only has ${formatCents(details.free_night_credit_cents ?? 0)} of hotel credit available.`,
          activityId: null,
        };
      }
    }

    if (linked && linked.account_id === move.accountId) {
      const points = linked.points_delta + move.points;
      const credit = Number(linked.hotel_credit_delta_cents) + move.credit;
      if (!points && !credit) {
        const { error } = await supabase
          .from("credit_card_reward_activities")
          .delete()
          .eq("id", linked.id)
          .eq("household_id", householdId);
        if (error) {
          console.error("[syncRewardLedger:fold-delete]", error);
          return { error: `Couldn't update that card's rewards — ${error.message}`, activityId: null };
        }
        if (activityId === linked.id) activityId = null;
      } else {
        const { error } = await supabase
          .from("credit_card_reward_activities")
          .update({ ...shape(points, credit, false), occurred_on: meta.occurredOn, points_delta: points, hotel_credit_delta_cents: credit })
          .eq("id", linked.id)
          .eq("household_id", householdId);
        if (error) {
          console.error("[syncRewardLedger:fold]", error);
          return { error: `Couldn't update that card's rewards — ${error.message}`, activityId: null };
        }
      }
      continue;
    }

    const { data, error } = await supabase
      .from("credit_card_reward_activities")
      .insert({
        household_id: householdId,
        account_id: move.accountId,
        occurred_on: meta.occurredOn,
        points_delta: move.points,
        hotel_credit_delta_cents: move.credit,
        ...shape(move.points, move.credit, firstDraw),
      })
      .select("id")
      .single();
    if (error) {
      console.error("[syncRewardLedger]", error);
      return { error: `Couldn't update that card's rewards — ${error.message}`, activityId: null };
    }
    // The stay's row is the one on the card it is on now.
    if (move.accountId === after.accountId || !activityId) activityId = data.id;
  }

  return { error: null, activityId };
}

// A free-night certificate is a status on the card, not points: using one
// sets the card's Booked date to the stay's check-in. Moving the certificate
// off a stay (unticked, another card, a new date, cancelled, deleted) clears
// the old stamp — but only when the card still shows THIS stay's date, so a
// date typed on the card by hand is never wiped.
export async function syncFreeNightStamp(
  supabase: SupabaseClient,
  householdId: string,
  before: { accountId: string | null; checkIn: string } | null,
  after: { accountId: string | null; checkIn: string } | null,
) {
  const same = before && after && before.accountId === after.accountId && before.checkIn === after.checkIn;
  if (same) return null;
  if (before?.accountId) {
    const { error } = await supabase
      .from("credit_card_details")
      .update({ benefit_used_on: null, updated_at: new Date().toISOString() })
      .eq("account_id", before.accountId)
      .eq("household_id", householdId)
      .eq("benefit_used_on", before.checkIn);
    if (error) return `Couldn't update the card's Booked date — ${error.message}`;
  }
  if (after?.accountId) {
    const { error } = await supabase
      .from("credit_card_details")
      .update({ benefit_used_on: after.checkIn, updated_at: new Date().toISOString() })
      .eq("account_id", after.accountId)
      .eq("household_id", householdId);
    if (error) return `Couldn't update the card's Booked date — ${error.message}`;
  }
  return null;
}
