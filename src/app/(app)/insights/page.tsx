import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { getSessionContext } from "@/lib/auth-context";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { throwIfAny } from "@/lib/supabase-result";
import { InsightsBoard } from "./insights-board";
import type { InsightsRaw } from "./compute";

export const metadata = { title: "Insights · Capitall" };

// Loads the household's rows ONCE; the board slices them into whatever period
// and granularity the URL asks for (computeInsights, in the browser). A bar
// click only rewrites ?g=&p= with history.pushState — no server trip — so
// this page doesn't read searchParams at all.
export default async function InsightsPage() {
  const { supabase, household } = await getSessionContext();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [
    categories,
    { data: subs, error: subsError },
    { data: payees, error: payeesError },
    { data: accounts, error: accountsError },
    txRows,
    { data: annualRows, error: annualRowsError },
  ] = await Promise.all([
    ensureCategories(supabase, household.id),
    supabase.from("subcategories").select("id, name, category_id").eq("household_id", household.id),
    supabase.from("payees").select("id, name").eq("household_id", household.id),
    supabase.from("accounts").select("id, is_kids_account").eq("household_id", household.id),
    // All of it: every period and granularity is sliced from this one set.
    // Past PostgREST's 1000-row cap, so paged on a stable key.
    fetchAllRows<{
      id: string; occurred_on: string; amount_cents: number;
      subcategory_id: string | null; payee_id: string | null;
      account_id: string | null; paid_to_account_id: string | null;
      is_withdrawal: boolean | null;
    }>((from, to) =>
      supabase
        .from("transactions")
        .select(
          "id, occurred_on, amount_cents, subcategory_id, payee_id, account_id, paid_to_account_id, is_withdrawal",
        )
        .eq("household_id", household.id)
        .order("id")
        .range(from, to),
    ),
    // Imported multi-year annual totals (2018–2025). Yearly line items per kind.
    supabase
      .from("annual_breakdown_history")
      .select("year, kind, line_label, amount_cents")
      .eq("household_id", household.id),
  ]);
  throwIfAny({ subs: subsError, payees: payeesError, accounts: accountsError, annualRows: annualRowsError });

  const kindByCat = new Map(categories.map((c) => [c.id, c.kind as CategoryKind]));
  const kidsAccounts = new Set(
    (accounts ?? []).filter((a) => a.is_kids_account).map((a) => a.id),
  );

  const raw: InsightsRaw = {
    currency: household.currency,
    today,
    tx: txRows
      .filter(
        (t) =>
          // Card payments are transfers — the charges were the spending. The
          // one exception is a payment on a card carried as a debt: it's
          // booked to the debt's budget item and counts like any other debt
          // payment.
          !(t.paid_to_account_id && !t.subcategory_id) &&
          !t.is_withdrawal && // savings withdrawal (transfer)
          !(t.account_id && kidsAccounts.has(t.account_id)), // kids money
      )
      // Largest first — "Largest purchases" takes the first five it meets.
      .sort((a, b) => b.amount_cents - a.amount_cents)
      .map((t) => ({
        id: t.id,
        occurred_on: t.occurred_on,
        amount_cents: t.amount_cents,
        subcategory_id: t.subcategory_id,
        payee_id: t.payee_id,
      })),
    subs: Object.fromEntries(
      (subs ?? []).map((s) => [s.id, { name: s.name, kind: kindByCat.get(s.category_id) ?? null }]),
    ),
    payees: Object.fromEntries((payees ?? []).map((p) => [p.id, p.name])),
    annualRows: annualRows ?? [],
  };

  return <InsightsBoard raw={raw} />;
}
