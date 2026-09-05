"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayToCents } from "@/lib/money";
import { unwrap } from "@/lib/supabase-result";

async function requireHousehold() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load your profile: ${error.message}`);
  if (!profile) redirect("/onboarding");

  return { supabase, householdId: profile.household_id };
}

function revalidate() {
  revalidatePath("/travel");
  // A points redemption changes the card balances shown on Accounts.
  revalidatePath("/accounts");
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim() || null;
const int = (formData: FormData, key: string) =>
  Math.max(0, Math.trunc(Number(String(formData.get(key) ?? "0").replace(/,/g, "")) || 0));

// Dollars-per-point typed as "0.006" -> 6000 micros. Kept in one place so the
// stay form and the card's own valuation stay on the same scale.
function dollarsToMicros(raw: string): number | null {
  const value = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1_000_000);
}


type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// What a stay is currently drawing from a card.
type RewardDraw = { accountId: string | null; points: number; credit: number };

// Every change to a stay — created, edited, cancelled, restored, deleted —
// comes through here. It compares what the stay used to draw from a card with
// what it draws now and posts the difference to the card's rewards ledger, so
// the Accounts balances always match the Travel Log. A spend is a negative
// delta; handing points back is a positive one.
async function syncRewardLedger(
  supabase: SupabaseClient,
  householdId: string,
  before: RewardDraw,
  after: RewardDraw,
  meta: { occurredOn: string; bookedOn: string | null; note: string },
): Promise<{ error: string | null; activityId?: string }> {
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

  let activityId: string | undefined;
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
      if (!details) return { error: "That card has no rewards details to draw from." };
      if (-move.points > (details.current_points ?? 0)) {
        return {
          error: `That card only has ${(details.current_points ?? 0).toLocaleString()} points available.`,
        };
      }
      if (-move.credit > (details.free_night_credit_cents ?? 0)) {
        return {
          error: `That card only has ${formatCents(details.free_night_credit_cents ?? 0)} of hotel credit available.`,
        };
      }
    }

    const refund = move.points > 0 || move.credit > 0;
    const { data, error } = await supabase
      .from("credit_card_reward_activities")
      .insert({
        household_id: householdId,
        account_id: move.accountId,
        activity_type: refund
          ? "reward_refund"
          : move.points < 0
            ? "free_night_booking"
            : "hotel_credit_redemption",
        occurred_on: meta.occurredOn,
        points_delta: move.points,
        hotel_credit_delta_cents: move.credit,
        // Only a booking stamps the card's "benefit used" date.
        booked_on: refund ? null : meta.bookedOn,
        note: refund ? `${meta.note} (returned)` : meta.note,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[syncRewardLedger]", error);
      return { error: `Couldn't update that card's rewards — ${error.message}` };
    }
    if (!refund && !activityId) activityId = data.id;
  }

  return { error: null, activityId };
}

export async function saveTravelStay(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();

  const id = String(formData.get("id") ?? "").trim() || null;
  const propertyName = text(formData, "propertyName");
  const checkIn = String(formData.get("checkIn") ?? "").trim();
  const reservedOn = String(formData.get("reservedOn") ?? "").trim();
  const accountId = String(formData.get("accountId") ?? "").trim() || null;
  const nights = Math.max(1, int(formData, "nights") || 1);
  const paxRaw = int(formData, "pax");
  const pointsCost = int(formData, "pointsCost");
  const hotelCredit = Math.max(0, displayToCents(String(formData.get("hotelCredit") ?? "0")));
  const pocketCost = Math.max(0, displayToCents(String(formData.get("pocketCost") ?? "0")));

  // How the out-of-pocket half was settled is not a choice any more: it is
  // whatever the numbers say. Money paid means the card; nothing paid means
  // the points or the night credit covered it.
  const pocketPaidWith =
    pocketCost > 0 ? "card" : pointsCost > 0 ? "points" : hotelCredit > 0 ? "credit" : "card";

  if (!propertyName) return { error: "Enter the hotel or apartment name." };
  if (!isDate(checkIn)) return { error: "Enter a valid check-in date." };
  if (reservedOn && !isDate(reservedOn)) return { error: "Enter a valid reservation date." };

  const row = {
    household_id: householdId,
    account_id: accountId,
    card_label: text(formData, "cardLabel"),
    holder: text(formData, "holder"),
    property_name: propertyName,
    city: text(formData, "city"),
    brand: text(formData, "brand"),
    reserved_on: reservedOn || null,
    check_in: checkIn,
    nights,
    pax: paxRaw > 0 ? paxRaw : null,
    points_value_micros: dollarsToMicros(String(formData.get("pointsValue") ?? "")),
    hotel_credit_cents: hotelCredit,
    hotel_cost_cents: Math.max(0, displayToCents(String(formData.get("hotelCost") ?? "0"))),
    pocket_cost_cents: pocketCost,
    points_cost: pointsCost,
    pocket_paid_with: pocketPaidWith,
    remarks: text(formData, "remarks"),
    updated_at: new Date().toISOString(),
  };

  // ---- Editing an existing stay. Points, hotel credit and the card can all
  // change now; the ledger is handed the difference so the card's balance
  // follows the edit instead of drifting away from it.
  if (id) {
    const prev = unwrap(
      await supabase
        .from("travel_stays")
        .select("account_id, points_cost, hotel_credit_cents, cancelled_at")
        .eq("id", id)
        .eq("household_id", householdId)
        .maybeSingle(),
      "travel_stays",
    );
    if (!prev) return { error: "That stay was not found." };

    // A cancelled stay has already handed everything back, so it starts from
    // zero and editing it draws again.
    const before: RewardDraw = prev.cancelled_at
      ? { accountId: prev.account_id, points: 0, credit: 0 }
      : { accountId: prev.account_id, points: prev.points_cost ?? 0, credit: prev.hotel_credit_cents ?? 0 };

    const sync = await syncRewardLedger(
      supabase,
      householdId,
      before,
      { accountId, points: pointsCost, credit: hotelCredit },
      { occurredOn: reservedOn || checkIn, bookedOn: checkIn, note: propertyName },
    );
    if (sync.error) return { error: sync.error };

    const { error } = await supabase
      .from("travel_stays")
      .update(row)
      .eq("id", id)
      .eq("household_id", householdId);
    if (error) {
      console.error("[saveTravelStay:update]", error);
      return { error: `Couldn't save that stay — ${error.message}` };
    }
    revalidate();
    return { error: null };
  }

  // ---- New stay. Points and hotel credit come off the card through the same
  // ledger, so a stay and the card balance can never disagree.
  const sync = await syncRewardLedger(
    supabase,
    householdId,
    { accountId, points: 0, credit: 0 },
    { accountId, points: pointsCost, credit: hotelCredit },
    { occurredOn: reservedOn || checkIn, bookedOn: checkIn, note: propertyName },
  );
  if (sync.error) return { error: sync.error };

  const { error } = await supabase
    .from("travel_stays")
    .insert({ ...row, reward_activity_id: sync.activityId ?? null });
  if (error) {
    console.error("[saveTravelStay:insert]", error);
    return { error: `Couldn't save that stay — ${error.message}` };
  }
  revalidate();
  return { error: null };
}

// Removes the reservation from the log entirely, and hands back whatever it
// had drawn from a card — a deleted stay never happened. (To keep a booking
// on record but out of the totals, cancel it instead.)
export async function deleteTravelStay(formData: FormData) {
  const { supabase, householdId } = await requireHousehold();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "That stay was not found." };

  const stay = unwrap(
    await supabase
      .from("travel_stays")
      .select("account_id, points_cost, hotel_credit_cents, cancelled_at, property_name, check_in, reserved_on")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "travel_stays",
  );
  if (!stay) return { error: "That stay was not found." };

  if (!stay.cancelled_at) {
    const sync = await syncRewardLedger(
      supabase,
      householdId,
      { accountId: stay.account_id, points: stay.points_cost ?? 0, credit: stay.hotel_credit_cents ?? 0 },
      { accountId: stay.account_id, points: 0, credit: 0 },
      {
        occurredOn: stay.reserved_on ?? stay.check_in,
        bookedOn: null,
        note: stay.property_name,
      },
    );
    if (sync.error) return { error: sync.error };
  }

  const { error } = await supabase
    .from("travel_stays")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);
  if (error) {
    console.error("[deleteTravelStay]", error);
    return { error: `Couldn't delete that stay — ${error.message}` };
  }
  revalidate();
  return { error: null };
}

// ---- The "Booked thru / Brand" list behind the stay form's picker. It is a
// table rather than the distinct values already in travel_stays so a brand can
// exist before its first stay, and so a typo can be deleted outright.
export async function addTravelBrand(name: string) {
  const { supabase, householdId } = await requireHousehold();
  const clean = name.trim();
  if (!clean) return { error: "Type a name first." };

  const { error } = await supabase
    .from("travel_brands")
    .insert({ household_id: householdId, name: clean });
  if (error) {
    console.error("[addTravelBrand]", error);
    // The unique index is case-insensitive, so this is the "already there" case.
    if (error.code === "23505") return { error: `${clean} is already on the list.` };
    return { error: `Couldn't add that — ${error.message}` };
  }
  revalidate();
  return { error: null };
}

// Deleting a brand only removes it from the picker: stays already tagged with
// it keep the name they were saved with.
export async function deleteTravelBrand(id: string) {
  const { supabase, householdId } = await requireHousehold();
  if (!id) return { error: "That brand was not found." };

  const { error } = await supabase
    .from("travel_brands")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);
  if (error) {
    console.error("[deleteTravelBrand]", error);
    return { error: `Couldn't delete that — ${error.message}` };
  }
  revalidate();
  return { error: null };
}

// Cancelling keeps the reservation in the archive and takes it out of every
// total. The points and the night credit go back to the card, because the room
// was never actually taken; restoring draws them again.
export async function setTravelStayCancelled(id: string, cancelled: boolean) {
  const { supabase, householdId } = await requireHousehold();
  if (!id) return { error: "That stay was not found." };

  const stay = unwrap(
    await supabase
      .from("travel_stays")
      .select("account_id, points_cost, hotel_credit_cents, cancelled_at, property_name, check_in, reserved_on")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle(),
    "travel_stays",
  );
  if (!stay) return { error: "That stay was not found." };
  if (Boolean(stay.cancelled_at) === cancelled) return { error: null };

  const drawn = { points: stay.points_cost ?? 0, credit: stay.hotel_credit_cents ?? 0 };
  const none = { accountId: stay.account_id, points: 0, credit: 0 };
  const full = { accountId: stay.account_id, ...drawn };

  const sync = await syncRewardLedger(
    supabase,
    householdId,
    cancelled ? full : none,
    cancelled ? none : full,
    {
      occurredOn: stay.reserved_on ?? stay.check_in,
      bookedOn: cancelled ? null : stay.check_in,
      note: stay.property_name,
    },
  );
  if (sync.error) return { error: sync.error };

  const { error } = await supabase
    .from("travel_stays")
    .update({ cancelled_at: cancelled ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("household_id", householdId);
  if (error) {
    console.error("[setTravelStayCancelled]", error);
    return { error: `Couldn't update that booking — ${error.message}` };
  }
  revalidate();
  return { error: null };
}

// ---- Linking the imported history to real cards. The CC Info column came
// over as free text ("Hilton Aspire", "Chase IHG"), so a stay knows which card
// paid for it but the app doesn't. This assigns a real account to every stay
// carrying a given label.
//
// It deliberately writes NO reward-ledger entries: these stays were paid for
// years ago and the card balances already reflect them. Linking is about
// reporting, not about spending points again.
export async function linkTravelCardLabels(
  mappings: Array<{ label: string; accountId: string | null }>,
) {
  const { supabase, householdId } = await requireHousehold();
  if (mappings.length === 0) return { error: null, linked: 0 };

  let linked = 0;
  for (const { label, accountId } of mappings) {
    const clean = label.trim();
    if (!clean) continue;

    const { data, error } = await supabase
      .from("travel_stays")
      .update({ account_id: accountId || null })
      .eq("household_id", householdId)
      .eq("card_label", clean)
      .select("id");
    if (error) {
      console.error("[linkTravelCardLabels]", error);
      return { error: `Couldn't link ${clean} — ${error.message}` };
    }
    linked += data?.length ?? 0;
  }

  revalidate();
  return { error: null, linked };
}
