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
      "id, occurred_on, amount_cents, memo, subcategory_id, payee_id, account_id, cleared, is_withdrawal",
    )
    .eq("household_id", household.id);
  if (hasRange) {
    if (from) txQuery = txQuery.gte("occurred_on", from);
    if (to) txQuery = txQuery.lte("occurred_on", to);
  } else {
    txQuery = txQuery.gte("occurred_on", month.firstOfMonth).lt("occurred_on", nextFirst);
  }
  txQuery = txQuery.order("occurred_on", { ascending: false }).order("created_at", { ascending: false });

  const [{ data: subs }, { data: txRows }, { data: payees }, { data: accounts }, { data: subscriptions }, { data: irregularBills }] =
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
        .select("id, name")
        .eq("household_id", household.id)
        .eq("active", true)
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
    ]);

  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const kindBySub = new Map(
    (subs ?? []).map((s) => [s.id, kindByCat.get(s.category_id) ?? null]),
  );
  const payeeById = new Map((payees ?? []).map((p) => [p.id, p.name]));

  const subOptions: SubOption[] = (subs ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    kind: (kindByCat.get(s.category_id) ?? "expenses") as CategoryKind,
    linkedBucketId: (s as { linked_bucket_id?: string | null }).linked_bucket_id ?? null,
  }));

  const accountOptions: AccountOption[] = (accounts ?? []).map((a) => ({
    id: a.id,
    name: a.name,
  }));

  const transactions: TxData[] = (txRows ?? []).map((t) => ({
    id: t.id,
    date: t.occurred_on,
    amountCents: t.amount_cents,
    memo: t.memo,
    payee: t.payee_id ? payeeById.get(t.payee_id) ?? null : null,
    subId: t.subcategory_id ?? null,
    subName: t.subcategory_id
      ? nameBySub.get(t.subcategory_id) ?? "Uncategorized"
      : "Uncategorized",
    accountId: t.account_id ?? null,
    kind: t.subcategory_id ? kindBySub.get(t.subcategory_id) ?? null : null,
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
      payeeOptions={(payees ?? []).map((p) => p.name)}
      payeeLineItems={payeeLineItems}
      dateRange={{ from: from ?? null, to: to ?? null }}
    />
  );
}
