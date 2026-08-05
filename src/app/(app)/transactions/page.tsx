import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { resolveMonth } from "@/lib/month";
import type { AccountOption, PayeeLineItem, SubOption, TxData } from "../budget/types";
import { TransactionsTable } from "./transactions-table";

export const metadata = { title: "Transactions · Capitall" };

type SearchParams = Promise<{ month?: string; from?: string; to?: string }>;

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

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  const { data: household } = await supabase
    .from("households")
    .select("id, currency")
    .eq("id", profile.household_id)
    .single();
  if (!household) redirect("/onboarding");

  const categories = await ensureCategories(supabase, household.id);
  const kindByCat = new Map(categories.map((c) => [c.id, c.kind as CategoryKind]));

  let txQuery = supabase
    .from("transactions")
    .select(
      "id, occurred_on, amount_cents, memo, subcategory_id, payee_id, account_id, paid_to_account_id, cleared, is_withdrawal",
    )
    .eq("household_id", household.id);
  if (hasRange) {
    if (from) txQuery = txQuery.gte("occurred_on", from);
    if (to) txQuery = txQuery.lte("occurred_on", to);
  } else {
    txQuery = txQuery.gte("occurred_on", month.firstOfMonth).lt("occurred_on", nextFirst);
  }
  txQuery = txQuery.order("occurred_on", { ascending: true }).order("created_at", { ascending: true });

  const [{ data: subs }, { data: txRows }, { data: payees }, { data: accounts }, { data: buckets }, { data: subscriptions }, { data: irregularBills }, { data: planRows }, { data: actualRows }] =
    await Promise.all([
      supabase
        .from("subcategories")
        .select("id, category_id, name, linked_bucket_id")
        .eq("household_id", household.id)
        .order("sort_order"),
      txQuery,
      supabase
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

  const transactions: TxData[] = (txRows ?? []).map((t) => ({
    id: t.id,
    date: t.occurred_on,
    amountCents: t.amount_cents,
    memo: t.memo,
    payee: t.paid_to_account_id
      ? accountNameById.get(t.paid_to_account_id) ?? "Credit card"
      : t.payee_id ? payeeById.get(t.payee_id) ?? null : null,
    subId: t.subcategory_id ?? null,
    subName: t.paid_to_account_id
      ? "Card payment"
      : t.subcategory_id
      ? nameBySub.get(t.subcategory_id) ?? "Uncategorized"
      : "Uncategorized",
    accountId: t.account_id ?? null,
    kind: t.subcategory_id ? kindBySub.get(t.subcategory_id) ?? null : null,
    isCardPayment: Boolean(t.paid_to_account_id),
    cleared: t.cleared ?? false,
    isWithdrawal: t.is_withdrawal ?? false,
  }));

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
      payeeOptions={payees ?? []}
      payeeLineItems={payeeLineItems}
      dateRange={{ from: from ?? null, to: to ?? null }}
    />
  );
}
