import type { CategoryKind } from "@/lib/categories";
import type { Granularity } from "./period";

export type { Granularity };

// A spending "kind" for Insights is the four outflow category kinds plus a
// synthetic "uncategorized" for transactions with no subcategory. Income is
// tracked separately (it's an inflow), so it never appears in the donut.
export type OutflowKind = Exclude<CategoryKind, "income"> | "kids" | "uncategorized";

// Per-period money flows. `savings` folds in investment contributions;
// spending is derived as bills + expenses. `kids` is the 529 deposits (Budget
// items linked to a kids account): money out, but never "saved" — the same
// split the Annual Overview makes (Victor, 2026-09-28).
export type Flows = {
  income: number;
  bills: number;
  expenses: number;
  debt: number;
  savings: number;
  kids: number;
};

export const emptyFlows = (): Flows => ({
  income: 0,
  bills: 0,
  expenses: 0,
  debt: 0,
  savings: 0,
  kids: 0,
});

export const spendingOf = (f: Flows): number => f.bills + f.expenses;
export const outflowOf = (f: Flows): number => f.bills + f.expenses + f.debt + f.savings + f.kids;

// One bar group in the trend chart. `selected` is the period the summary
// below reflects (highlighted in the chart, clickable to change).
export type ChartBucket = {
  key: string;
  label: string;
  income: number;
  spending: number;
  savings: number;
  debt: number;
  kids: number;
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
  // First (earliest) selected period; `periodKeys` holds every pick when
  // several bars are Ctrl/⌘-clicked together.
  periodKey: string;
  periodKeys: string[];
  // False for a multi-pick: there's no single "prior period" to compare to,
  // so deltas and the "vs" column are hidden.
  comparable: boolean;
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
};
