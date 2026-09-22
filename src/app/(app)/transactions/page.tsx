import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { getSessionContext } from "@/lib/auth-context";
import { resolveMonth } from "@/lib/month";
import type { AccountOption, PayeeLineItem, SubOption, TxData } from "../budget/types";
import { TransactionsTable } from "./transactions-table";
import { throwIfAny } from "@/lib/supabase-result";
import { attachSplitParts } from "@/lib/split-parts";
import { buildPlanResolver, fetchPlanInputs } from "@/lib/planned-by-sub";
import { cardOwedMap, pickerBalanceCents } from "@/lib/account-picker-balance";

export const metadata = { title: "Transactions · Capitall" };

type SearchParams = Promise<{ month?: string; from?: string; to?: string }>;
type TransactionQueryRow = {
  id: string;
  occurred_on: string;
  amount_cents: number;
  memo: string | null;
  subcategory_id: string | null;
  payee_id: string | null;
  account_id: string | null;
  bucket_id: string | null;
  property_id: string | null;
  trip_id: string | null;
  travel_category: string | null;
  travel_stay_id: string | null;
  travel_flight_id: string | null;
  travel_car_id: string | null;
  paid_to_account_id: string | null;
  paid_to_bucket_id: string | null;
  movement_type: "account_transfer" | "card_payment" | "investment_transfer" | null;
  cleared: boolean | null;
  is_withdrawal: boolean | null;
  split_group_id: string | null;
};

// A `YYYY-MM-DD` that is also a real day — "2026-13-45" and "2026-02-30" are
// the right shape but not real dates, and Postgres rejects both.
function validDate(raw: string | undefined): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const [y, m, d] = raw.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  const roundTrips =
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d;
  return roundTrips ? raw : undefined;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { month: monthParam, from: fromParam, to: toParam } = await searchParams;
  const month = resolveMonth(monthParam);
  const nextFirst = `${month.nextKey}-01`;
  // `from`/`to` are pasted straight into the query below, so a value Postgres
  // can't parse as a date used to take the whole page down with a 500 — and
  // "/transactions?from=notadate" is one mistyped bookmark away. Anything that
  // isn't a real calendar date is dropped, falling back to the month scoping.
  const from = validDate(fromParam);
  const to = validDate(toParam);
  // A custom date range overrides the month scoping entirely, so searching
  // isn't limited to whatever month happens to be selected.
  const hasRange = Boolean(from || to);

  const { supabase, household } = await getSessionContext();

  // Started now, awaited with the other reads below — it used to run alone
  // first, one more round trip before anything else began.
  const categoriesPromise = ensureCategories(supabase, household.id);

  const buildTransactionsQuery = () => {
    let query = supabase
      .from("transactions")
      .select(
        "id, occurred_on, amount_cents, memo, subcategory_id, payee_id, account_id, bucket_id, property_id, trip_id, travel_category, travel_stay_id, travel_flight_id, travel_car_id, paid_to_account_id, paid_to_bucket_id, movement_type, cleared, is_withdrawal, split_group_id",
      )
      .eq("household_id", household.id);
    if (hasRange) {
      if (from) query = query.gte("occurred_on", from);
      if (to) query = query.lte("occurred_on", to);
    } else {
      query = query.gte("occurred_on", month.firstOfMonth).lt("occurred_on", nextFirst);
    }
    return query.order("occurred_on", { ascending: true }).order("created_at", { ascending: true });
  };

  // PostgREST responses are capped at 1,000 rows by default. Load each page
  // so an all-time range includes recent transactions beyond that first page.
  const loadTransactions = async () => {
    const pageSize = 1_000;
    const rows: TransactionQueryRow[] = [];
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await buildTransactionsQuery().range(start, start + pageSize - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < pageSize) return rows;
    }
  };
  const transactionRowsPromise = loadTransactions();

  const [{ data: subs, error: subsError }, txRows, { data: payees, error: payeesError }, { data: accounts, error: accountsError }, { data: buckets, error: bucketsError }, { data: subscriptions, error: subscriptionsError }, { data: irregularBills, error: irregularBillsError }, planInputs, { data: actualRows, error: actualRowsError }, { data: cardOwedRows, error: cardOwedError }] =
    await Promise.all([
      supabase
        .from("subcategories")
        .select("id, category_id, name, linked_bucket_id, travel_category, receives_trip_plans")
        .eq("household_id", household.id)
        .order("sort_order"),
      transactionRowsPromise,
      supabase
        // Names only — used server-side (payeeById) to label each row. The
        // autocomplete list is fetched on demand by the client (listPayees).
        .from("payees")
        .select("id, name")
        .eq("household_id", household.id),
      supabase
        .from("accounts")
        .select("id, name, kind, is_kids_account, sort_order, current_balance_cents")
        .eq("household_id", household.id)
        .eq("active", true)
        .order("sort_order")
        .order("name"),
      supabase
        .from("buckets")
        .select("id, account_id, name, sort_order")
        .eq("household_id", household.id)
        .order("sort_order")
        .order("name"),
      // Managed items for the transaction Payee autocomplete's auto-fill.
      supabase
        .from("subscriptions")
        .select("name, amount_cents, subcategory_id")
        .eq("household_id", household.id)
        .eq("is_active", true),
      supabase
        .from("irregular_bills")
        .select("name, subcategory_id")
        .eq("household_id", household.id),
      // Planned + actuals for the current month so the picker can show
      // Planned and Remaining ($planned − $spent) per budget item — planned by
      // the Budget page's own rule, so the two pages always agree.
      fetchPlanInputs(supabase, household.id, [month.firstOfMonth]),
      supabase
        .from("v_monthly_actuals")
        .select("subcategory_id, actual_cents")
        .eq("household_id", household.id)
        .eq("month", month.firstOfMonth),
      // Owed per card for the transaction modal's account picker.
      supabase
        .from("v_card_balances")
        .select("account_id, owed_cents")
        .eq("household_id", household.id),
    ]);
  const categories = await categoriesPromise;
  const kindByCat = new Map(categories.map((c) => [c.id, c.kind as CategoryKind]));
  throwIfAny({ subs: subsError, payees: payeesError, accounts: accountsError, buckets: bucketsError, subscriptions: subscriptionsError, irregularBills: irregularBillsError, actualRows: actualRowsError, cardOwed: cardOwedError });

  const plan = buildPlanResolver(planInputs);
  const actualBySub = new Map<string, number>(
    (actualRows ?? []).map((a) => [a.subcategory_id as string, a.actual_cents ?? 0]),
  );

  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const kindBySub = new Map(
    (subs ?? []).map((s) => [s.id, kindByCat.get(s.category_id) ?? null]),
  );
  const payeeById = new Map((payees ?? []).map((p) => [p.id, p.name]));
  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const accountKindById = new Map((accounts ?? []).map((a) => [a.id, a.kind]));

  const subOptions: SubOption[] = (subs ?? []).map((s) => {
    const planned = plan.plannedFor(s.id, month.firstOfMonth);
    const actual = actualBySub.get(s.id) ?? 0;
    return {
      id: s.id,
      name: s.name,
      kind: (kindByCat.get(s.category_id) ?? "expenses") as CategoryKind,
      linkedBucketId: (s as { linked_bucket_id?: string | null }).linked_bucket_id ?? null,
      remainingCents: planned - actual,
      plannedCents: planned,
      travelCategory: s.travel_category ?? null,
      receivesTripPlans: s.receives_trip_plans ?? false,
    };
  });

  const accountGroupFor = (a: { kind: string; is_kids_account?: boolean }) => {
    if (a.is_kids_account) return "Kids Funding";
    if (a.kind === "checking" || a.kind === "savings_bucket") return "Banking";
    if (a.kind === "investment") return "Investments";
    if (a.kind === "credit_card") return "Credit Cards";
    if (a.kind === "debt_loan") return "Loans";
    return "Other";
  };
  // Property accounts are a place, not somewhere money comes from: they are
  // offered as the transaction's Property tag instead of in the account picker.
  const cardOwed = cardOwedMap(cardOwedRows);
  const propertyOptions: AccountOption[] = (accounts ?? [])
    .filter((a) => a.kind === "property")
    .map((a) => ({ id: a.id, name: a.name }));
  const accountOptions: AccountOption[] = (accounts ?? [])
    .filter((a) => a.kind !== "property")
    .map((a) => ({
      id: a.id,
      name: a.name,
      group: accountGroupFor(a),
      balanceCents: pickerBalanceCents(a, cardOwed),
    }));

  // Buckets grouped by parent account, restricted to investment accounts —
  // powers the transaction modal's Bucket picker (Fidelity → Roth IRA Vic).
  const investmentAccountIds = new Set((accounts ?? []).filter((a) => a.kind === "investment").map((a) => a.id));
  const bucketsByAccount: Record<string, { id: string; name: string }[]> = {};
  for (const b of buckets ?? []) {
    if (!investmentAccountIds.has(b.account_id)) continue;
    (bucketsByAccount[b.account_id] ??= []).push({ id: b.id, name: b.name });
  }

  const transactions: TxData[] = txRows.map((t) => {
    const movementType = t.movement_type ?? (
      t.paid_to_account_id
        ? accountKindById.get(t.paid_to_account_id) === "credit_card"
          ? "card_payment"
          : accountKindById.get(t.account_id ?? "") === "investment"
            ? "investment_transfer"
            : "account_transfer"
        : null
    );
    return {
      id: t.id,
      date: t.occurred_on,
      amountCents: t.amount_cents,
      memo: t.memo,
      payee: t.paid_to_account_id
        ? accountNameById.get(t.paid_to_account_id) ?? "Destination account"
        : t.payee_id ? payeeById.get(t.payee_id) ?? null : null,
      subId: t.subcategory_id ?? null,
      subName: movementType === "account_transfer"
        ? "Transfer"
        : movementType === "investment_transfer"
          ? "Investment transfer"
          : movementType === "card_payment"
            // On a card carried as a debt the payment is booked to the debt,
            // so it reads like a debt payment entered on Budget.
            ? (t.subcategory_id ? nameBySub.get(t.subcategory_id) : null) ?? "Card payment"
            : t.subcategory_id
              ? nameBySub.get(t.subcategory_id) ?? "Uncategorized"
              : "Uncategorized",
      accountId: t.account_id ?? null,
      propertyId: t.property_id ?? null,
      tripId: t.trip_id ?? null,
      travelCategory: t.travel_category ?? null,
      bookingRef: t.travel_stay_id ? `stay:${t.travel_stay_id}` : t.travel_flight_id ? `flight:${t.travel_flight_id}` : t.travel_car_id ? `car:${t.travel_car_id}` : null,
      toAccountId: t.paid_to_account_id ?? null,
      fromBucketId: t.bucket_id ?? null,
      toBucketId: t.paid_to_bucket_id ?? null,
      kind: t.subcategory_id ? kindBySub.get(t.subcategory_id) ?? null : null,
      movementType,
      isCardPayment: movementType === "card_payment",
      isTransfer: movementType === "account_transfer",
      isInvestmentTransfer: movementType === "investment_transfer",
      cleared: t.cleared ?? false,
      isWithdrawal: t.is_withdrawal ?? false,
      splitGroupId: (t as { split_group_id?: string | null }).split_group_id ?? null,
    };
  });
  attachSplitParts(transactions);

  const payeeLineItems: PayeeLineItem[] = [
    ...(subscriptions ?? []).map((s) => ({
      name: s.name,
      amountCents: s.amount_cents,
      subcategoryId: s.subcategory_id,
      kind: "subscription" as const,
    })),
    ...(irregularBills ?? []).map((b) => ({
      name: b.name,
      amountCents: null,
      subcategoryId: b.subcategory_id,
      kind: "irregular" as const,
    })),
  ];

  return (
    <TransactionsTable
      month={{
        key: month.key,
        label: month.label,
        firstOfMonth: month.firstOfMonth,
      }}
      currency={household.currency}
      transactions={transactions}
      subOptions={subOptions}
      accountOptions={accountOptions}
      propertyOptions={propertyOptions}
      bucketsByAccount={bucketsByAccount}
      transferBuckets={(buckets ?? []).map((b) => ({ id: b.id, accountId: b.account_id, name: b.name }))}
      payeeLineItems={payeeLineItems}
      dateRange={{ from: from ?? null, to: to ?? null }}
    />
  );
}
