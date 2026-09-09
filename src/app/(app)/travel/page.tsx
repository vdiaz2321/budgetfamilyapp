import { getSessionContext } from "@/lib/auth-context";
import { loadCreditCardBoardData } from "@/lib/credit-card-data";
import { throwIfAny } from "@/lib/supabase-result";
import { TravelBoard } from "./travel-board";
import type { PocketPaidWith, TravelBrand, TravelCard, TravelStay } from "./types";

export const metadata = { title: "Travel Log · Capitall" };

export default async function TravelPage() {
  const { supabase, household } = await getSessionContext();

  const [stays, brands, rewards] = await Promise.all([
    supabase
      .from("travel_stays")
      .select(
        "id, account_id, card_label, holder, property_name, city, brand, booking_channel, reserved_on, check_in, nights, pax, points_cost, points_value_micros, hotel_credit_cents, hotel_cost_cents, pocket_cost_cents, pocket_paid_with, remarks, breakfast_included, cancelled_at, reward_activity_id",
      )
      .eq("household_id", household.id)
      .order("check_in", { ascending: false }),
    supabase
      .from("travel_brands")
      .select("id, name")
      .eq("household_id", household.id)
      .order("name"),
    // The rewards board below the charts, and the card list the Add stay
    // form offers — one read for both, and the same one Accounts uses for
    // its card list, so the two pages can't disagree about a card.
    loadCreditCardBoardData(supabase, household.id),
  ]);
  throwIfAny({
    travel_stays: stays.error,
    travel_brands: brands.error,
  });

  // Closed cards stay selectable only if they already carry a stay — a booking
  // made on a card that has since been closed still belongs in the log.
  const usedAccountIds = new Set(
    (stays.data ?? []).map((s) => s.account_id).filter(Boolean) as string[],
  );
  const cards: TravelCard[] = rewards.cards
    .filter((a) => !a.dateClosed || usedAccountIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      holder: a.holder ?? null,
      currentPoints: a.cardDetails?.currentPoints ?? 0,
      pointsValueMicros: a.cardDetails?.pointsValueMicros ?? null,
      freeNightCreditCents: a.cardDetails?.freeNightCreditCents ?? null,
      freeNightPointsLimit: a.cardDetails?.freeNightPointsLimit ?? null,
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
    pocketPaidWith: (s.pocket_paid_with ?? "card") as PocketPaidWith,
    remarks: s.remarks ?? null,
    breakfastIncluded: s.breakfast_included ?? false,
    cancelledAt: s.cancelled_at ?? null,
    rewardActivityId: s.reward_activity_id ?? null,
  }));

  return (
    <TravelBoard
      today={new Date().toISOString().slice(0, 10)}
      stays={rows}
      cards={cards}
      brands={(brands.data ?? []) as TravelBrand[]}
      currency={household.currency ?? "$"}
      rewards={rewards}
    />
  );
}
