/**
 * Everything the Travel & Credit Card Rewards board needs, in one read.
 *
 * The Accounts page used to build this inline. It now lives on /travel, and
 * both pages still need the same card facts — Accounts to say what a card
 * owes, Travel to say what its points are worth. One loader, so the two can't
 * answer the question differently: the `is_revolving_debt` flag had already
 * drifted from the `debts` table once, and a second copy of this assembly is
 * how that happens again.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountData, BucketData, CardDetails, NonCardAccount, RewardActivity } from "@/app/(app)/accounts/types";
import { suggestPointsValues, type PointsSuggestion } from "@/lib/points-value";
import { throwIfAny } from "@/lib/supabase-result";
import type { TravelBrand } from "@/app/(app)/travel/types";

export type CreditCardBoardData = {
  /** Every credit card, closed ones included. */
  cards: AccountData[];
  /** Non-card accounts, for the Pay Card modal's "From" dropdown. */
  nonCardAccounts: NonCardAccount[];
  /** Buckets on those accounts, for the same modal's "From bucket". */
  allBuckets: BucketData[];
  pointsSuggestions: PointsSuggestion[];
  travelBrands: TravelBrand[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadCreditCardBoardData(
  supabase: SupabaseClient<any, any, any>,
  householdId: string,
): Promise<CreditCardBoardData> {
  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [accountRows, bucketRows, cardDetailRows, rewardRows, debtRows, brandRows, stayRows, balanceRows, monthRows] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, kind, subtype, holder, institution, account_number, ownership, active, is_kids_account, current_balance_cents, annual_fee_cents, fee_waived, date_opened, date_closed")
        .eq("household_id", householdId)
        .order("sort_order")
        .order("name"),
      supabase
        .from("buckets")
        .select("id, account_id, name, balance_cents")
        .eq("household_id", householdId)
        .order("sort_order")
        .order("name"),
      supabase
        .from("credit_card_details")
        .select("account_id, bank, auth_user, charging, bonus_info, bonus_spend_cents, bonus_spend_deadline, bonus_earned, current_points, fees_paid_cents, free_night_credit_cents, free_night_expires_on, free_night_points_limit, benefit_used_on, spending_limit_cents, remarks, is_revolving_debt, debt_subcategory_id, rewards_category, rewards_program, points_value_micros, five24_countable, card_url, benefit_cadence")
        .eq("household_id", householdId),
      supabase
        .from("credit_card_reward_activities")
        .select("id, account_id, activity_type, occurred_on, points_delta, hotel_credit_delta_cents, booked_on, note")
        .eq("household_id", householdId)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("debts")
        .select("subcategory_id, account_id, current_balance_cents, min_payment_cents, target_payment_cents, apr, due_day, promo_apr_ends_on")
        .eq("household_id", householdId),
      supabase
        .from("travel_brands")
        .select("id, name")
        .eq("household_id", householdId)
        .order("name"),
      // What the points actually redeemed at, so a card's valuation can be
      // measured instead of guessed. Cancelled stays never happened.
      supabase
        .from("travel_stays")
        .select("account_id, brand, points_cost, points_value_micros, hotel_cost_cents")
        .eq("household_id", householdId)
        .is("cancelled_at", null),
      // Summed in Postgres, one row per card — the same cost at 900
      // transactions or 900,000, and never silently truncated by the
      // 1000-row response cap.
      supabase
        .from("v_card_balances")
        .select("account_id, owed_cents")
        .eq("household_id", householdId),
      supabase
        .from("v_card_month_spend")
        .select("account_id, spend_cents")
        .eq("household_id", householdId)
        .eq("month", firstOfMonth),
    ]);

  throwIfAny({
    accounts: accountRows.error,
    buckets: bucketRows.error,
    credit_card_details: cardDetailRows.error,
    debts: debtRows.error,
    travel_brands: brandRows.error,
    travel_stays: stayRows.error,
    v_card_balances: balanceRows.error,
    v_card_month_spend: monthRows.error,
  });
  // Migration 0037 added the rewards ledger. A household whose database
  // predates it still gets a working card list, minus the activity log.
  const rewardActivityRows = rewardRows.error ? [] : rewardRows.data ?? [];

  const owed = new Map((balanceRows.data ?? []).map((r: any) => [r.account_id as string, (r.owed_cents as number) ?? 0]));
  const monthSpend = new Map((monthRows.data ?? []).map((r: any) => [r.account_id as string, (r.spend_cents as number) ?? 0]));
  const debtByAccount = new Map(
    (debtRows.data ?? []).filter((d: any) => d.account_id).map((d: any) => [d.account_id as string, d]),
  );

  const rewardsByAccount = new Map<string, RewardActivity[]>();
  for (const a of rewardActivityRows as any[]) {
    const items = rewardsByAccount.get(a.account_id) ?? [];
    items.push({
      id: a.id,
      type: a.activity_type as RewardActivity["type"],
      occurredOn: a.occurred_on,
      pointsDelta: a.points_delta ?? 0,
      hotelCreditDeltaCents: a.hotel_credit_delta_cents ?? 0,
      bookedOn: a.booked_on ?? null,
      note: a.note ?? null,
    });
    rewardsByAccount.set(a.account_id, items);
  }

  const detailsByAccount = new Map<string, CardDetails>();
  for (const d of (cardDetailRows.data ?? []) as any[]) {
    const payoff = debtByAccount.get(d.account_id);
    detailsByAccount.set(d.account_id, {
      rewardsCategory: d.rewards_category === "travel" || d.rewards_category === "hotel" ? d.rewards_category : null,
      rewardsProgram: d.rewards_program ?? null,
      pointsValueMicros: d.points_value_micros == null ? null : Number(d.points_value_micros),
      five24Countable: d.five24_countable ?? true,
      bank: d.bank ?? null,
      authUser: d.auth_user ?? null,
      charging: d.charging ?? null,
      bonusInfo: d.bonus_info ?? null,
      bonusSpendCents: d.bonus_spend_cents ?? null,
      bonusSpendDeadline: d.bonus_spend_deadline ?? null,
      bonusEarned: d.bonus_earned ?? false,
      currentPoints: d.current_points ?? 0,
      feesPaidCents: d.fees_paid_cents ?? 0,
      freeNightCreditCents: d.free_night_credit_cents ?? null,
      freeNightExpiresOn: d.free_night_expires_on ?? null,
      freeNightPointsLimit: d.free_night_points_limit ?? null,
      benefitUsedOn: d.benefit_used_on ?? null,
      spendingLimitCents: d.spending_limit_cents ?? null,
      remarks: d.remarks ?? null,
      // Derived from the `debts` table, not from the detail row's own flags —
      // those were a second encoding of the same fact and had already drifted
      // (see lib/debt-identity.ts).
      isRevolvingDebt: debtByAccount.has(d.account_id),
      debtSubcategoryId: payoff?.subcategory_id ?? null,
      cardUrl: d.card_url ?? null,
      benefitCadence: d.benefit_cadence ?? null,
      payoffBalanceCents: payoff?.current_balance_cents ?? 0,
      payoffMinimumCents: payoff?.min_payment_cents ?? 0,
      payoffPlannedCents: payoff?.target_payment_cents ?? 0,
      payoffApr: Number(payoff?.apr ?? 0),
      payoffDueDay: payoff?.due_day ?? null,
      promoAprEndsOn: payoff?.promo_apr_ends_on ?? null,
    });
  }

  const allBuckets: BucketData[] = ((bucketRows.data ?? []) as any[]).map((b) => ({
    id: b.id,
    accountId: b.account_id,
    name: b.name,
    balanceCents: b.balance_cents ?? 0,
    bankGroup: null,
    taxTreatment: null,
    retirementKind: null,
    holder: null,
    balancesByMonth: {},
  }));
  const bucketAccountIds = new Set(allBuckets.map((b) => b.accountId));

  const rows = (accountRows.data ?? []) as any[];
  const cards: AccountData[] = rows
    .filter((a) => a.kind === "credit_card")
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      subtype: a.subtype,
      holder: a.holder,
      institution: a.institution ?? null,
      accountNumber: a.account_number ?? null,
      ownership: a.ownership === "joint" ? "joint" : "sole",
      debtTrackingMode: "budget",
      active: a.active,
      isKidsAccount: a.is_kids_account ?? false,
      bankGroup: null,
      taxTreatment: null,
      retirementKind: null,
      balanceCents: a.current_balance_cents ?? 0,
      annualFeeCents: a.annual_fee_cents ?? null,
      feeWaived: a.fee_waived ?? false,
      dateOpened: a.date_opened ?? null,
      dateClosed: a.date_closed ?? null,
      cardDetails: detailsByAccount.get(a.id) ?? null,
      rewardActivities: rewardsByAccount.get(a.id) ?? [],
      owedCents: owed.get(a.id) ?? 0,
      monthSpendCents: monthSpend.get(a.id) ?? 0,
      prevMonthCents: null,
      prev2MonthCents: null,
      balancesByMonth: {},
      buckets: [],
    }));

  const nonCardAccounts: NonCardAccount[] = rows
    .filter((a) => a.kind !== "credit_card" && a.active)
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      hasBuckets: bucketAccountIds.has(a.id),
    }));

  const pointsSuggestions = suggestPointsValues(
    cards
      .filter((c) => c.cardDetails)
      .map((c) => ({
        id: c.id,
        name: c.name,
        currentPoints: c.cardDetails?.currentPoints ?? 0,
        pointsValueMicros: c.cardDetails?.pointsValueMicros ?? null,
      })),
    ((stayRows.data ?? []) as any[]).map((s) => ({
      accountId: s.account_id ?? null,
      brand: s.brand ?? null,
      pointsCost: s.points_cost ?? 0,
      // Same fallback the Travel Log shows: when the rate wasn't typed in,
      // the room's cash rate divided by the points is the rate.
      pointsValueMicros:
        s.points_value_micros ??
        ((s.points_cost ?? 0) > 0 && (s.hotel_cost_cents ?? 0) > 0
          ? Math.round((s.hotel_cost_cents / s.points_cost) * 10_000)
          : null),
    })),
  );

  return {
    cards,
    nonCardAccounts,
    allBuckets,
    pointsSuggestions,
    travelBrands: (brandRows.data ?? []) as TravelBrand[],
  };
}
