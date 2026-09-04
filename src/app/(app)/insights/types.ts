import type { CategoryKind } from "@/lib/categories";
import type { Granularity } from "./period";
import type { CardPayment } from "@/components/card-payments-ledger";

export type { Granularity };

// A spending "kind" for Insights is the four outflow category kinds plus a
// synthetic "uncategorized" for transactions with no subcategory. Income is
// tracked separately (it's an inflow), so it never appears in the donut.
export type OutflowKind = Exclude<CategoryKind, "income"> | "uncategorized";

// Per-period money flows. `savings` folds in investment contributions;
// spending is derived as bills + expenses.
export type Flows = {
  income: number;
  bills: number;
  expenses: number;
  debt: number;
  savings: number;
};

export const emptyFlows = (): Flows => ({
  income: 0,
  bills: 0,
  expenses: 0,
  debt: 0,
  savings: 0,
});

export const spendingOf = (f: Flows): number => f.bills + f.expenses;
export const outflowOf = (f: Flows): number => f.bills + f.expenses + f.debt + f.savings;

// One bar group in the trend chart. `selected` is the period the summary
// below reflects (highlighted in the chart, clickable to change).
export type ChartBucket = {
  key: string;
  label: string;
  income: number;
  spending: number;
  savings: number;
  debt: number;
  selected: boolean;
};

export type KindSlice = { kind: OutflowKind; label: string; amount: number };

export type CategoryRow = {
  subId: string;
  name: string;
  kind: OutflowKind;
  amount: number;
  // Same category's spend in the prior comparison period; null when no prior
  // data is available (e.g. the very first year of history).
  priorAmount: number | null;
};

export type MerchantRow = { name: string; count: number; total: number; avg: number };

export type PurchaseRow = {
  id: string;
  date: string;
  payee: string;
  sub: string;
  kind: OutflowKind;
  amount: number;
};

export type InsightsData = {
  granularity: Granularity;
  periodKey: string;
  periodLabel: string;
  priorLabel: string;
  minYear: number;
  totals: Flows;
  prior: Flows;
  buckets: ChartBucket[];
  kinds: KindSlice[];
  categories: CategoryRow[];
  merchants: MerchantRow[];
  purchases: PurchaseRow[];
  // False for historical years sourced from the annual breakdown — those have
  // category totals but no per-transaction detail (merchants / purchases).
  detailAvailable: boolean;
  currency: string;
  // Card payments report — all-time, with its own year filter, so it is not
  // sliced by the page's period picker.
  cardPayments: CardPayment[];
  cardNames: Record<string, string>;
  sourceNames: Record<string, string>;
};
