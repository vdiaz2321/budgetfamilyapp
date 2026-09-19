import { currentMonthFirst } from "@/lib/snapshots";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { AccountsBoard, type AccountData, type BudgetDebt, type CardDetails, type RewardActivity } from "./accounts-board";
import type { CardPayment } from "@/components/card-payments-ledger";
import { syncAllBucketedAccounts } from "./actions";
import { getSessionContext } from "@/lib/auth-context";
import { loadDebtMonthPlans } from "@/lib/debt-month-plan";
import { throwIfAny } from "@/lib/supabase-result";

// N months before firstOfMonth, as YYYY-MM-01. n=1 → previous month.
function monthsBefore(firstOfMonth: string, n: number): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export const metadata = { title: "Accounts · Capitall" };

export default async function AccountsPage() {
  const { supabase, household } = await getSessionContext();

  // Self-heal any account whose top-level balance drifted from its buckets'
  // sum before this sync existed (e.g. a manually-entered total that never
  // matched the buckets underneath it).
  await syncAllBucketedAccounts(supabase, household.id);

  const currentMonth = currentMonthFirst();
  const prevMonth = monthsBefore(currentMonth, 1);
  const prev2Month = monthsBefore(currentMonth, 2);

  const [
    { data: rows, error: rowsError },
    { data: bucketRows, error: bucketRowsError },
    { data: debtRows, error: debtRowsError },
    { data: subRows, error: subRowsError },
    { data: cardDetailRowsInitial, error: cardDetailsError },
    { data: rewardActivityRowsInitial, error: rewardActivitiesError },
    acctSnapshotRows,
    bktSnapshotRows,
    debtSnapshotRows,
    cardPaymentRows,
    { data: eoyHistoryRow, error: eoyHistoryError },
    debtMonth,
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, kind, subtype, holder, institution, account_number, ownership, debt_tracking_mode, active, is_kids_account, bank_group, current_balance_cents, annual_fee_cents, fee_waived, date_opened, date_closed, tax_treatment, retirement_kind")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, balance_cents, bank_group, tax_treatment, retirement_kind, holder")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("debts")
      .select("subcategory_id, account_id, current_balance_cents, min_payment_cents, target_payment_cents, apr, due_day, debt_kind, tracking_enabled, promo_apr_ends_on")
      .eq("household_id", household.id),
    supabase
      .from("subcategories")
      .select("id, name")
      .eq("household_id", household.id),
    supabase
      .from("credit_card_details")
      .select("account_id, bank, auth_user, charging, bonus_info, bonus_spend_cents, bonus_spend_deadline, bonus_earned, current_points, fees_paid_cents, free_night_credit_cents, free_night_expires_on, free_night_points_limit, free_night_category_max, benefit_used_on, spending_limit_cents, remarks, is_revolving_debt, debt_subcategory_id, rewards_category, rewards_program, points_value_micros, five24_countable, card_url, benefit_cadence")
      .eq("household_id", household.id),
    supabase
      .from("credit_card_reward_activities")
      .select("id, account_id, activity_type, occurred_on, points_delta, hotel_credit_delta_cents, booked_on, note")
      .eq("household_id", household.id)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
    // Pull ALL account_snapshots (not just historyMonths) so the period
    // picker on the header can resolve balances back to any historical
    // month/quarter/year. Small table — a household has one row per
    // account per month, ~103 rows for 2026. Bucket snapshots are pulled in
    // full for the same reason: the bucket rows' three balance columns are
    // anchored on the selected period, so they have to resolve months
    // outside the current 3-month window.
    // Paged. These four grow by one row per account/bucket/debt per month and
    // are read across ALL history, which is precisely the shape fetch-all-rows
    // exists for — at ~29 account rows a month this crosses PostgREST's 1000
    // cap in 2029 and every historical period figure would quietly go wrong,
    // with no error to notice. (The same truncation already bit this page's
    // card balances once.)
    fetchAllRows<{ account_id: string; month: string; balance_cents: number }>((from, to) =>
      supabase
        .from("account_snapshots")
        .select("account_id, month, balance_cents")
        .eq("household_id", household.id)
        .order("month")
        .order("account_id")
        .range(from, to),
    ),
    fetchAllRows<{ bucket_id: string; month: string; balance_cents: number }>((from, to) =>
      supabase
        .from("bucket_snapshots")
        .select("bucket_id, month, balance_cents")
        .eq("household_id", household.id)
        .order("month")
        .order("bucket_id")
        .range(from, to),
    ),
    // Pull ALL debt_snapshots (matching account_snapshots above) so the header
    // period picker can compute a real "% vs last period" delta on the Debts
    // and Net Worth cards.
    fetchAllRows<{ subcategory_id: string; month: string; balance_cents: number }>((from, to) =>
      supabase
        .from("debt_snapshots")
        .select("subcategory_id, month, balance_cents")
        .eq("household_id", household.id)
        .order("month")
        .order("subcategory_id")
        .range(from, to),
    ),
    // Card payments only — the transactions that move money TO a credit card.
    // The charges made ON a card are deliberately left out: this feeds the
    // "Card payments" report, which tracks what leaves the bank per card, not
    // the register. Read-only; nothing here writes back to balances.
    fetchAllRows<{
      id: string; occurred_on: string; amount_cents: number; memo: string | null;
      account_id: string | null; paid_to_account_id: string | null; movement_type: string | null;
    }>((from, to) =>
      supabase
        .from("transactions")
        .select("id, occurred_on, amount_cents, memo, account_id, paid_to_account_id, movement_type")
        .eq("household_id", household.id)
        .not("paid_to_account_id", "is", null)
        .order("occurred_on", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    // Last year's closing net worth for the "EOY <year>" hero tile. Only the
    // fallback: the board derives it from Dec snapshots when they exist, the
    // same precedence /networth uses (snapshots win over imported history).
    supabase
      .from("networth_history")
      .select("savings_cents, bank_cents, stocks_cents, debt_cents")
      .eq("household_id", household.id)
      .eq("month", `${Number(currentMonth.slice(0, 4)) - 1}-12-01`)
      .maybeSingle(),
    // This month's Budget plan per debt item — the Pay Card prefill.
    loadDebtMonthPlans(supabase, household.id),
  ]);
  // cardDetails and rewardActivities are deliberately NOT in this list: both
  // have a fallback below for the case where the migration behind them hasn't
  // been applied yet, and throwIfAny would throw before either could run —
  // the two recoveries underneath were unreachable code. Every other read
  // still fails the page loudly rather than rendering a misleading $0.
  throwIfAny({ eoyHistory: eoyHistoryError, rows: rowsError, bucketRows: bucketRowsError, debtRows: debtRowsError, subRows: subRowsError, });

  // "That column/table isn't there yet" — the only failures these two reads
  // are allowed to swallow. Anything else (auth, network, RLS) still throws,
  // because silently blanking the rewards data would read as "no points".
  const schemaNotMigrated = (code: string | undefined) =>
    code === "PGRST204" || code === "PGRST205" || code === "42703" || code === "42P01";

  // Captured before the narrowing below: inside `if (cardDetailsError)` the
  // Supabase result type collapses `data` to null, so the legacy rows have
  // nothing left to be cast to.
  type CardDetailRows = typeof cardDetailRowsInitial;

  // Keep the Accounts page usable before the user applies the new SQL in
  // Supabase. The existing rewards columns remain fully supported.
  let cardDetailRows: CardDetailRows = cardDetailRowsInitial;
  if (cardDetailsError) {
    if (!schemaNotMigrated(cardDetailsError.code)) {
      throw new Error(`Could not read cardDetails: ${cardDetailsError.message}`);
    }
    const legacy = await supabase
      .from("credit_card_details")
      .select("account_id, bank, auth_user, charging, bonus_info, bonus_spend_cents, bonus_spend_deadline, bonus_earned, current_points, fees_paid_cents, free_night_credit_cents, free_night_expires_on, free_night_points_limit, benefit_used_on, spending_limit_cents, remarks, is_revolving_debt, debt_subcategory_id")
      .eq("household_id", household.id);
    if (legacy.error) {
      throw new Error(`Could not read cardDetails: ${legacy.error.message}`);
    }
    cardDetailRows = legacy.data as CardDetailRows;
  }
  // Migration 0037 adds the rewards ledger. Keep the rest of Accounts usable
  // until it has been applied in Supabase.
  if (rewardActivitiesError && !schemaNotMigrated(rewardActivitiesError.code)) {
    throw new Error(`Could not read rewardActivities: ${rewardActivitiesError.message}`);
  }
  const rewardActivityRows = rewardActivitiesError ? [] : rewardActivityRowsInitial ?? [];
  // (accountId, month) -> cents.
  const acctHistory = new Map<string, number>();
  for (const s of acctSnapshotRows ?? []) {
    acctHistory.set(`${s.account_id}:${s.month}`, s.balance_cents ?? 0);
  }

  const subName = new Map((subRows ?? []).map((s) => [s.id, s.name]));
  const debtHistory = new Map<string, number>();
  for (const s of debtSnapshotRows ?? []) {
    debtHistory.set(`${s.subcategory_id}:${s.month}`, s.balance_cents ?? 0);
  }
  // Per-subcategory balance history keyed by "YYYY-MM-01", built from ALL
  // debt_snapshots so the header period picker can resolve Debts and Net
  // Worth cards back to a historical month.
  const debtBalancesBySub = new Map<string, Record<string, number>>();
  for (const s of debtSnapshotRows ?? []) {
    const map = debtBalancesBySub.get(s.subcategory_id) ?? {};
    map[s.month] = s.balance_cents ?? 0;
    debtBalancesBySub.set(s.subcategory_id, map);
  }
  const budgetDebts: BudgetDebt[] = (debtRows ?? []).filter((d) => d.tracking_enabled !== false).map((d) => ({
    subcategoryId: d.subcategory_id,
    name: subName.get(d.subcategory_id) ?? "Debt",
    balanceCents: d.current_balance_cents ?? 0,
    prevMonthCents: debtHistory.get(`${d.subcategory_id}:${prevMonth}`) ?? null,
    prev2MonthCents: debtHistory.get(`${d.subcategory_id}:${prev2Month}`) ?? null,
    balancesByMonth: debtBalancesBySub.get(d.subcategory_id) ?? {},
    debtKind: d.debt_kind ?? null,
    accountId: d.account_id ?? null,
  }));

  const cardDetailsByAccount = new Map<string, CardDetails>();
  const rewardActivitiesByAccount = new Map<string, AccountData["rewardActivities"]>();
  for (const activity of rewardActivityRows) {
    const items = rewardActivitiesByAccount.get(activity.account_id) ?? [];
    items.push({
      id: activity.id,
      type: activity.activity_type as RewardActivity["type"],
      occurredOn: activity.occurred_on,
      pointsDelta: activity.points_delta ?? 0,
      hotelCreditDeltaCents: activity.hotel_credit_delta_cents ?? 0,
      bookedOn: activity.booked_on ?? null,
      note: activity.note ?? null,
    });
    rewardActivitiesByAccount.set(activity.account_id, items);
  }
  const debtByAccount = new Map((debtRows ?? []).filter((debt) => debt.account_id).map((debt) => [debt.account_id as string, debt]));
  for (const d of cardDetailRows ?? []) {
    const payoff = debtByAccount.get(d.account_id);
    cardDetailsByAccount.set(d.account_id, {
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
      freeNightCategoryMax: "free_night_category_max" in d ? (d.free_night_category_max ?? null) : null,
      benefitUsedOn: d.benefit_used_on ?? null,
      spendingLimitCents: d.spending_limit_cents ?? null,
      remarks: d.remarks ?? null,
      // Derived from the `debts` table, not from
      // `credit_card_details.is_revolving_debt` / `debt_subcategory_id`. Those
      // were a second encoding of "this card carries a tracked debt" and had
      // already drifted out of sync — 3191 VentureJ held a live debt row while
      // its detail flags said otherwise, so the card showed no Debt badge.
      // One ledger, one answer (see lib/debt-identity.ts).
      isRevolvingDebt: debtByAccount.has(d.account_id),
      debtSubcategoryId: debtByAccount.get(d.account_id)?.subcategory_id ?? null,
      cardUrl: d.card_url ?? null,
      benefitCadence: d.benefit_cadence ?? null,
      payoffBalanceCents: payoff?.current_balance_cents ?? 0,
      payoffMinimumCents: payoff?.min_payment_cents ?? 0,
      payoffPlannedCents: payoff?.target_payment_cents ?? 0,
      debtMonthPlannedCents: payoff ? debtMonth.get(payoff.subcategory_id)?.plannedCents ?? 0 : 0,
      debtMonthPaidCents: payoff ? debtMonth.get(payoff.subcategory_id)?.paidCents ?? 0 : 0,
      payoffApr: Number(payoff?.apr ?? 0),
      payoffDueDay: payoff?.due_day ?? null,
      promoAprEndsOn: payoff?.promo_apr_ends_on ?? null,
    });
  }

  // Auto-computed "owed" per credit card:
  //   sum(non-imported charges: account_id = card AND paid_to_account_id IS NULL)
  // minus sum(payments: paid_to_account_id = card)
  // CSV imports are historical budget records and are intentionally excluded
  // from the live card balance. Account balances/snapshots remain unchanged.
  const creditCardIds = (rows ?? [])
    .filter((a) => a.kind === "credit_card")
    .map((a) => a.id);

  const cardOwed = new Map<string, number>();
  const cardMonthSpend = new Map<string, number>();
  if (creditCardIds.length > 0) {
    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    // Summed in Postgres by v_card_balances / v_card_month_spend (migration
    // 20260826183000) rather than by adding up every charge here. The response
    // is one row per card, so this costs the same at 900 transactions or
    // 900,000 — and it can't be silently truncated by the 1000-row response
    // cap the way the old client-side tally was.
    const [{ data: balanceRows, error: balanceRowsError }, { data: monthRows, error: monthRowsError }] = await Promise.all([
      supabase
        .from("v_card_balances")
        .select("account_id, owed_cents")
        .eq("household_id", household.id),
      supabase
        .from("v_card_month_spend")
        .select("account_id, spend_cents")
        .eq("household_id", household.id)
        .eq("month", firstOfMonth),
    ]);
    throwIfAny({ balanceRows: balanceRowsError, monthRows: monthRowsError });
    for (const r of balanceRows ?? []) {
      cardOwed.set(r.account_id as string, (r.owed_cents as number) ?? 0);
    }
    for (const r of monthRows ?? []) {
      cardMonthSpend.set(r.account_id as string, (r.spend_cents as number) ?? 0);
    }
  }

  const accounts: AccountData[] = (rows ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    subtype: a.subtype,
    holder: a.holder,
    institution: a.institution ?? null,
    accountNumber: a.account_number ?? null,
    ownership: a.ownership === "joint" ? "joint" : "sole",
    debtTrackingMode: a.debt_tracking_mode === "account" ? "account" : "budget",
    active: a.active,
    isKidsAccount: a.is_kids_account ?? false,
    bankGroup: (a.bank_group as "savings" | "spending" | null) ?? null,
    taxTreatment: (a.tax_treatment as string | null) ?? null,
    retirementKind: (a.retirement_kind as string | null) ?? null,
    balanceCents: a.current_balance_cents ?? 0,
    annualFeeCents: a.annual_fee_cents ?? null,
    feeWaived: a.fee_waived ?? false,
    dateOpened: a.date_opened ?? null,
    dateClosed: a.date_closed ?? null,
    cardDetails: cardDetailsByAccount.get(a.id) ?? null,
    rewardActivities: rewardActivitiesByAccount.get(a.id) ?? [],
    owedCents: cardOwed.get(a.id) ?? 0,
    monthSpendCents: cardMonthSpend.get(a.id) ?? 0,
    prevMonthCents: acctHistory.get(`${a.id}:${prevMonth}`) ?? null,
    prev2MonthCents: acctHistory.get(`${a.id}:${prev2Month}`) ?? null,
    // Per-account snapshots keyed by "YYYY-MM-01" so the header's period
    // picker can resolve section totals back to any historical month.
    // Filled from account_snapshots (unfiltered — small table).
    balancesByMonth: (() => {
      const map: Record<string, number> = {};
      for (const s of acctSnapshotRows ?? []) {
        if (s.account_id === a.id) map[s.month] = s.balance_cents ?? 0;
      }
      return map;
    })(),
    buckets: (bucketRows ?? [])
      .filter((b) => b.account_id === a.id)
      .map((b) => ({
        id: b.id,
        accountId: b.account_id,
        name: b.name,
        balanceCents: b.balance_cents ?? 0,
        bankGroup: (b.bank_group as "savings" | "spending" | null) ?? null,
        taxTreatment: (b.tax_treatment as string | null) ?? null,
        retirementKind: (b.retirement_kind as string | null) ?? null,
        holder: (b.holder as string | null) ?? null,
        // Keyed "YYYY-MM-01", so a bucket row can show (and write) the month
        // the period picker is pointing at rather than only the last three.
        balancesByMonth: (() => {
          const map: Record<string, number> = {};
          for (const s of bktSnapshotRows ?? []) {
            if (s.bucket_id === b.id) map[s.month] = s.balance_cents ?? 0;
          }
          return map;
        })(),
      })),
  }));

  // Accounts a card can be paid from, for the Pay Card modal's "From" dropdown:
  // your own bank accounts. Not investment accounts — their balance is kept by
  // hand, so the payment never came off it and Invest counted it as money in —
  // and not kids' accounts, which aren't household money (payCard refuses both).
  const nonCardAccounts = accounts
    .filter((a) => a.kind !== "credit_card" && a.kind !== "investment" && !a.isKidsAccount && a.active)
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      hasBuckets: a.buckets.length > 0,
    }));

  // Keep only the movements that land on a credit card. `movement_type` is
  // null on rows written before that column existed, so fall back to the same
  // rule the register uses: destination account is a credit card.
  const cardIds = new Set((rows ?? []).filter((a) => a.kind === "credit_card").map((a) => a.id));
  const cardPayments: CardPayment[] = (cardPaymentRows ?? [])
    .filter(
      (t) =>
        t.paid_to_account_id &&
        cardIds.has(t.paid_to_account_id) &&
        (t.movement_type === "card_payment" || t.movement_type == null),
    )
    .map((t) => ({
      id: t.id,
      date: t.occurred_on,
      amountCents: t.amount_cents,
      cardId: t.paid_to_account_id as string,
      fromAccountId: t.account_id ?? null,
      memo: t.memo ?? null,
    }));

  return (
    <AccountsBoard
      accounts={accounts}
      budgetDebts={budgetDebts}
      currency={household.currency}
      nonCardAccounts={nonCardAccounts}
      historyMonths={[currentMonth, prevMonth, prev2Month]}
      cardPayments={cardPayments}
      eoyHistoryNetCents={
        eoyHistoryRow
          ? eoyHistoryRow.savings_cents + eoyHistoryRow.bank_cents + eoyHistoryRow.stocks_cents - eoyHistoryRow.debt_cents
          : null
      }
    />
  );
}
