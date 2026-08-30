import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { getSessionContext } from "@/lib/auth-context";
import { resolveMonth } from "@/lib/month";
import type { AccountOption, PayeeLineItem, SubOption, TxData } from "../budget/types";
import { TransactionsTable } from "./transactions-table";
import { throwIfAny } from "@/lib/supabase-result";

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
  paid_to_account_id: string | null;
  paid_to_bucket_id: string | null;
  movement_type: "account_transfer" | "card_payment" | "investment_transfer" | null;
  cleared: boolean | null;
  is_withdrawal: boolean | null;
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { month: monthParam, from, to } = await searchParams;
  const month = resolveMonth(monthParam);
  const nextFirst = `${month.nextKey}-01`;
  // A custom date range overrides the month scoping entirely, so searching
  // isn't limited to whatever month happens to be selected.
  const hasRange = Boolean(from || to);

  const { supabase, household } = await getSessionContext();

  const categories = await ensureCategories(supabase, household.id);
  const kindByCat = new Map(categories.map((c) => [c.id, c.kind as CategoryKind]));

  const buildTransactionsQuery = () => {
    let query = supabase
      .from("transactions")
      .select(
        "id, occurred_on, amount_cents, memo, subcategory_id, payee_id, account_id, bucket_id, paid_to_account_id, paid_to_bucket_id, movement_type, cleared, is_withdrawal",
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

  const [{ data: subs, error: subsError }, txRows, { data: payees, error: payeesError }, { data: accounts, error: accountsError }, { data: buckets, error: bucketsError }, { data: subscriptions, error: subscriptionsError }, { data: irregularBills, error: irregularBillsError }, { data: planRows, error: planRowsError }, { data: actualRows, error: actualRowsError }] =
    await Promise.all([
      supabase
        .from("subcategories")
        .select("id, category_id, name, linked_bucket_id")
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
        .select("id, name, kind, is_kids_account, sort_order")
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
      // "Remaining" ($planned − $spent) per budget item.
      supabase
        .from("budget_plans")
        .select("subcategory_id, planned_cents")
        .eq("household_id", household.id)
        .eq("month", month.firstOfMonth),
      supabase
        .from("v_monthly_actuals")
        .select("subcategory_id, actual_cents")
        .eq("household_id", household.id)
        .eq("month", month.firstOfMonth),
    ]);
  throwIfAny({ subs: subsError, payees: payeesError, accounts: accountsError, buckets: bucketsError, subscriptions: subscriptionsError, irregularBills: irregularBillsError, planRows: planRowsError, actualRows: actualRowsError });

  const plannedBySub = new Map<string, number>(
    (planRows ?? []).map((p) => [p.subcategory_id as string, p.planned_cents ?? 0]),
  );
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
    const planned = plannedBySub.get(s.id) ?? 0;
    const actual = actualBySub.get(s.id) ?? 0;
    return {
      id: s.id,
      name: s.name,
      kind: (kindByCat.get(s.category_id) ?? "expenses") as CategoryKind,
      linkedBucketId: (s as { linked_bucket_id?: string | null }).linked_bucket_id ?? null,
      remainingCents: planned - actual,
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
  const accountOptions: AccountOption[] = (accounts ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    group: accountGroupFor(a),
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
            ? "Card payment"
            : t.subcategory_id
              ? nameBySub.get(t.subcategory_id) ?? "Uncategorized"
              : "Uncategorized",
      accountId: t.account_id ?? null,
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
    };
  });

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
      bucketsByAccount={bucketsByAccount}
      transferBuckets={(buckets ?? []).map((b) => ({ id: b.id, accountId: b.account_id, name: b.name }))}
      payeeLineItems={payeeLineItems}
      dateRange={{ from: from ?? null, to: to ?? null }}
    />
  );
}
