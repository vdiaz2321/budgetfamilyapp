import { getSessionContext } from "@/lib/auth-context";
import { throwIfAny } from "@/lib/supabase-result";
import { TravelBoard } from "./travel-board";
import type { PocketPaidWith, TravelCard, TravelStay } from "./types";

export const metadata = { title: "Travel Log · Capitall" };

export default async function TravelPage() {
  const { supabase, household } = await getSessionContext();

  const [stays, accounts, cardDetails] = await Promise.all([
    supabase
      .from("travel_stays")
      .select(
        "id, account_id, card_label, holder, property_name, city, brand, booking_channel, reserved_on, check_in, nights, pax, points_cost, points_value_micros, hotel_credit_cents, hotel_cost_cents, pocket_cost_cents, pocket_paid_with, remarks, reward_activity_id",
      )
      .eq("household_id", household.id)
      .order("check_in", { ascending: false }),
    supabase
      .from("accounts")
      .select("id, name, holder, kind, date_closed")
      .eq("household_id", household.id)
      .eq("kind", "credit_card")
      .order("name"),
    supabase
      .from("credit_card_details")
      .select("account_id, current_points, points_value_micros, free_night_credit_cents, free_night_points_limit")
      .eq("household_id", household.id),
  ]);
  throwIfAny({
    travel_stays: stays.error,
    accounts: accounts.error,
    credit_card_details: cardDetails.error,
  });

  const detailByAccount = new Map(
    (cardDetails.data ?? []).map((d) => [d.account_id, d]),
  );
  // Closed cards stay selectable only if they already carry a stay — a booking
  // made on a card that has since been closed still belongs in the log.
  const usedAccountIds = new Set(
    (stays.data ?? []).map((s) => s.account_id).filter(Boolean) as string[],
  );
  const cards: TravelCard[] = (accounts.data ?? [])
    .filter((a) => !a.date_closed || usedAccountIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      holder: a.holder ?? null,
      currentPoints: detailByAccount.get(a.id)?.current_points ?? 0,
      pointsValueMicros: detailByAccount.get(a.id)?.points_value_micros ?? null,
      freeNightCreditCents: detailByAccount.get(a.id)?.free_night_credit_cents ?? null,
      freeNightPointsLimit: detailByAccount.get(a.id)?.free_night_points_limit ?? null,
    }));

  const rows: TravelStay[] = (stays.data ?? []).map((s) => ({
    id: s.id,
    accountId: s.account_id ?? null,
    cardLabel: s.card_label ?? null,
    holder: s.holder ?? null,
    propertyName: s.property_name,
    city: s.city ?? null,
    brand: s.brand ?? null,
    bookingChannel: s.booking_channel ?? null,
    reservedOn: s.reserved_on ?? null,
    checkIn: s.check_in,
    nights: s.nights ?? 1,
    pax: s.pax ?? null,
    pointsCost: s.points_cost ?? 0,
    pointsValueMicros: s.points_value_micros ?? null,
    hotelCreditCents: s.hotel_credit_cents ?? 0,
    hotelCostCents: s.hotel_cost_cents ?? 0,
    pocketCostCents: s.pocket_cost_cents ?? 0,
    pocketPaidWith: (s.pocket_paid_with ?? "cash") as PocketPaidWith,
    remarks: s.remarks ?? null,
    rewardActivityId: s.reward_activity_id ?? null,
  }));

  return (
    <TravelBoard stays={rows} cards={cards} currency={household.currency ?? "$"} />
  );
}
