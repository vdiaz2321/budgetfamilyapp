import { getSessionContext } from "@/lib/auth-context";
import { resolveMonth } from "@/lib/month";
import type { TxData } from "../budget/types";
import { TransactionsTable } from "./transactions-table";
import { throwIfAny } from "@/lib/supabase-result";
import { attachSplitParts } from "@/lib/split-parts";
import { loadTxFormData } from "@/lib/tx-form-options";
import { loadTravelCells } from "./travel-cells";

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

  // The modal's pickers (budget items, accounts, buckets, payee auto-fill)
  // come from the shared loader Travel Log's "Add transaction" also uses.
  // The Trip / Pays for columns' bookings load as soon as the rows are in,
  // alongside the pickers rather than after them.
  const [txForm, txRows, travelCells, { data: payees, error: payeesError }] = await Promise.all([
    loadTxFormData(supabase, household.id, month.firstOfMonth),
    transactionRowsPromise,
    transactionRowsPromise.then((rows) => loadTravelCells(supabase, household.id, rows)),
    supabase
      // Names only — used server-side (payeeById) to label each row. The
      // autocomplete list is fetched on demand by the client (listPayees).
      .from("payees")
      .select("id, name")
      .eq("household_id", household.id),
  ]);
  throwIfAny({ payees: payeesError });
  const { subs, accounts, buckets, kindByCat } = txForm;
  const { subOptions, accountOptions, propertyOptions, bucketsByAccount, payeeLineItems } = txForm.options;

  const nameBySub = new Map(subs.map((s) => [s.id, s.name]));
  const kindBySub = new Map(
    subs.map((s) => [s.id, kindByCat.get(s.category_id) ?? null]),
  );
  const payeeById = new Map((payees ?? []).map((p) => [p.id, p.name]));
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const accountKindById = new Map(accounts.map((a) => [a.id, a.kind]));

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
      transferBuckets={buckets.map((b) => ({ id: b.id, accountId: b.account_id, name: b.name }))}
      payeeLineItems={payeeLineItems}
      dateRange={{ from: from ?? null, to: to ?? null }}
      travelCells={travelCells}
    />
  );
}
