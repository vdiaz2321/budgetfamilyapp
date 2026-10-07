import type { createClient } from "@/lib/supabase/server";
import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { throwIfAny } from "@/lib/supabase-result";
import { buildPlanResolver, fetchPlanInputs } from "@/lib/planned-by-sub";
import { cardOwedMap, pickerBalanceCents } from "@/lib/account-picker-balance";
import type { AccountOption, PayeeLineItem, SubOption } from "@/app/(app)/budget/types";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type TxFormOptions = {
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  propertyOptions: AccountOption[];
  bucketsByAccount: Record<string, { id: string; name: string }[]>;
  payeeLineItems: PayeeLineItem[];
};

// The one place the transaction modal's pickers are built — budget items
// (with Planned/Remaining for `firstOfMonth`), accounts (with balance/owed),
// properties, investment buckets and payee auto-fill items. Used by the
// Transactions page and by any page that opens the modal on demand (Travel
// Log's "Add transaction"), so the two can never drift apart. The raw rows
// come back too, for a page that also labels its own transactions.
export async function loadTxFormData(supabase: SupabaseClient, householdId: string, firstOfMonth: string) {
  const categoriesPromise = ensureCategories(supabase, householdId);

  const [
    { data: subs, error: subsError },
    { data: accounts, error: accountsError },
    { data: buckets, error: bucketsError },
    { data: subscriptions, error: subscriptionsError },
    { data: irregularBills, error: irregularBillsError },
    planInputs,
    { data: actualRows, error: actualRowsError },
    { data: cardOwedRows, error: cardOwedError },
  ] = await Promise.all([
    supabase
      .from("subcategories")
      .select("id, category_id, name, linked_bucket_id, travel_category, receives_trip_plans")
      .eq("household_id", householdId)
      .order("sort_order"),
    supabase
      .from("accounts")
      .select("id, name, kind, is_kids_account, sort_order, current_balance_cents")
      .eq("household_id", householdId)
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, sort_order")
      .eq("household_id", householdId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("subscriptions")
      .select("name, amount_cents, subcategory_id")
      .eq("household_id", householdId)
      .eq("is_active", true),
    supabase.from("irregular_bills").select("name, subcategory_id").eq("household_id", householdId),
    fetchPlanInputs(supabase, householdId, [firstOfMonth]),
    supabase
      .from("v_monthly_actuals")
      .select("subcategory_id, actual_cents")
      .eq("household_id", householdId)
      .eq("month", firstOfMonth),
    supabase.from("v_card_balances").select("account_id, owed_cents").eq("household_id", householdId),
  ]);
  const categories = await categoriesPromise;
  throwIfAny({
    subs: subsError,
    accounts: accountsError,
    buckets: bucketsError,
    subscriptions: subscriptionsError,
    irregularBills: irregularBillsError,
    actualRows: actualRowsError,
    cardOwed: cardOwedError,
  });

  const kindByCat = new Map(categories.map((c) => [c.id, c.kind as CategoryKind]));
  const plan = buildPlanResolver(planInputs);
  const actualBySub = new Map<string, number>(
    (actualRows ?? []).map((a) => [a.subcategory_id as string, a.actual_cents ?? 0]),
  );

  const subOptions: SubOption[] = (subs ?? []).map((s) => {
    const planned = plan.plannedFor(s.id, firstOfMonth);
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

  const investmentAccountIds = new Set((accounts ?? []).filter((a) => a.kind === "investment").map((a) => a.id));
  const bucketsByAccount: Record<string, { id: string; name: string }[]> = {};
  for (const b of buckets ?? []) {
    if (!investmentAccountIds.has(b.account_id)) continue;
    (bucketsByAccount[b.account_id] ??= []).push({ id: b.id, name: b.name });
  }

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

  return {
    options: { subOptions, accountOptions, propertyOptions, bucketsByAccount, payeeLineItems } satisfies TxFormOptions,
    subs: subs ?? [],
    accounts: accounts ?? [],
    buckets: buckets ?? [],
    kindByCat,
  };
}
