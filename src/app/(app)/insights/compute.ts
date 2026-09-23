// Everything the Insights page shows, computed from one load of raw rows.
//
// This used to run on the server for every period click: each bar tap was a
// full round trip (~1s) that re-downloaded the same transactions just to
// re-slice them. The server now sends the rows once (page.tsx) and the board
// calls computeInsights() in the browser, so switching periods is instant.
// It is plain TypeScript with no server-only imports, so it runs either side.
import type { CategoryKind } from "@/lib/categories";
import {
  bucketLabel,
  currentPeriodKey,
  keyOfDate,
  periodLabel,
  periodRange,
  priorKey,
  priorToDate,
  seriesKeys,
  shortRangeLabel,
  type Granularity,
} from "./period";
import {
  emptyFlows,
  spendingOf,
  type CategoryRow,
  type ChartBucket,
  type Flows,
  type InsightsData,
  type KindSlice,
  type MerchantRow,
  type OutflowKind,
  type PurchaseRow,
} from "./types";

// One transaction, already filtered to real flows (no card payments, savings
// withdrawals or kids money) and sorted largest amount first — "Largest
// purchases" takes the first five it meets.
export type InsightsTx = {
  id: string;
  occurred_on: string;
  amount_cents: number;
  subcategory_id: string | null;
  payee_id: string | null;
};

export type InsightsRaw = {
  currency: string;
  // The server's date (YYYY-MM-DD). "This month" and the mid-month prior
  // cut-off key off this, so the server render and the browser agree.
  today: string;
  tx: InsightsTx[];
  subs: Record<string, { name: string; kind: CategoryKind | null }>;
  payees: Record<string, string>;
  annualRows: { year: number; kind: string; line_label: string; amount_cents: number }[];
};

const OUTFLOW_ORDER: OutflowKind[] = [
  "savings", "bills", "expenses", "debt", "uncategorized",
];

// Add an amount to a flows bucket by category kind. Investment folds into
// savings; uncategorized outflow folds into expenses so no money is dropped.
function addFlow(f: Flows, kind: CategoryKind | "uncategorized" | "investment", amount: number) {
  switch (kind) {
    case "income": f.income += amount; break;
    case "savings": f.savings += amount; break;
    case "investment": f.savings += amount; break;
    case "bills": f.bills += amount; break;
    case "debt": f.debt += amount; break;
    default: f.expenses += amount; // expenses + uncategorized
  }
}

// The server's "today" as a local-noon Date, so the browser's idea of the
// current period matches the server render's.
export function todayDate(today: string): Date {
  return new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)), 12);
}

// Label for a multi-period selection: "Jun–Aug 2026" when the picks run
// back to back, "Jan, Mar 2026" for up to three scattered ones, else "5 months".
function selectionLabel(g: Granularity, keys: string[], series: string[]): string {
  if (keys.length === 1) return periodLabel(g, keys[0]);
  const idx = keys.map((k) => series.indexOf(k));
  const contiguous = idx.every((v, i) => v >= 0 && (i === 0 || v === idx[i - 1] + 1));
  const years = new Set(keys.map((k) => k.slice(0, 4)));
  const oneYear = years.size === 1;
  // Monthly short labels carry no year; add it once at the end when every
  // pick shares one. Quarterly labels already say '26; weeks read fine as
  // plain dates ("Weeks of Aug 31–Sep 14").
  const bl = (k: string) => bucketLabel(g, k, g === "monthly" && !oneYear);
  const yearSuffix = oneYear && g === "monthly" ? ` ${keys[0].slice(0, 4)}` : "";
  const unit = g === "weekly" ? "weeks" : g === "monthly" ? "months" : g === "quarterly" ? "quarters" : "years";
  const prefix = g === "weekly" ? "Weeks of " : "";
  if (contiguous) return `${prefix}${bl(keys[0])}–${bl(keys[keys.length - 1])}${yearSuffix}`;
  if (keys.length <= 3) return `${prefix}${keys.map(bl).join(", ")}${yearSuffix}`;
  return `${keys.length} ${unit}`;
}

// `periodKeys` is one period, or several picked with Ctrl/⌘-click on the
// chart — the page then shows their combined total. A comparison with "the
// prior period" only means something for a single pick, so a multi-pick
// returns comparable: false and the board hides the deltas.
export function computeInsights(
  raw: InsightsRaw,
  granularity: Granularity,
  periodKeys: string[],
): InsightsData {
  const today = raw.today;
  const now = todayDate(today);
  const keys = [...periodKeys].sort();
  const periodKey = keys[0];
  const multi = keys.length > 1;
  const prior = priorKey(granularity, periodKey);
  const selRange = periodRange(granularity, periodKey);
  const priFull = periodRange(granularity, prior);
  // Mid-period, the prior window stops at the same day (Aug 1–23 for Sept
  // 1–23) so "Change" compares like with like; see priorToDate.
  const priToDate = priorToDate(selRange, priFull, today);
  const priRange = priToDate ?? priFull;

  const kindOf = (subId: string | null): CategoryKind | null =>
    subId ? raw.subs[subId]?.kind ?? null : null;
  const outflowKindOf = (subId: string | null): OutflowKind => {
    const k = kindOf(subId);
    return k && k !== "income" ? k : "uncategorized";
  };
  const annualKindToOutflow = (kind: string): OutflowKind =>
    kind === "investment" ? "savings"
      : kind === "bills" ? "bills"
      : kind === "expenses" ? "expenses"
      : kind === "debt" ? "debt"
      : "savings"; // savings

  // ---- Annual history: per-year flows + line items ----
  const annualFlows = new Map<number, Flows>();
  // Per year → per line_label totals, so we can look up a prior year's same
  // line item to compute the "Change" column.
  const annualLineTotals = new Map<number, Map<string, { kind: OutflowKind; amount: number }>>();
  for (const r of raw.annualRows) {
    const f = annualFlows.get(r.year) ?? emptyFlows();
    addFlow(f, r.kind as CategoryKind | "investment", r.amount_cents);
    annualFlows.set(r.year, f);
    if (r.kind !== "income") {
      let byLabel = annualLineTotals.get(r.year);
      if (!byLabel) {
        byLabel = new Map();
        annualLineTotals.set(r.year, byLabel);
      }
      byLabel.set(r.line_label, {
        kind: annualKindToOutflow(r.kind),
        amount: r.amount_cents,
      });
    }
  }
  const annualYears = [...annualFlows.keys()];
  const minYear = annualYears.length
    ? Math.min(...annualYears, now.getFullYear())
    : now.getFullYear();

  // Does a yearly key resolve to imported annual data (vs. live transactions)?
  const annualForKey = (key: string): Flows | null => {
    if (granularity !== "yearly") return null;
    return annualFlows.get(Number(key)) ?? null;
  };

  // Years with imported annual history take that total over the sparse
  // transactions for the same year; every other pick sums its transactions.
  const annualKeys = keys.filter((k) => annualForKey(k) != null);
  const txKeys = keys.filter((k) => annualForKey(k) == null);
  const txRanges = txKeys.map((k) => periodRange(granularity, k));
  const inTxSel = (d: string) => txRanges.some((r) => d >= r.from && d <= r.to);

  // ---- Trend series ----
  const series = seriesKeys(granularity, periodKey, minYear, now);
  const seriesMultiYear = series[0].slice(0, 4) !== series[series.length - 1].slice(0, 4);
  const bucketIdx = new Map(series.map((k, i) => [k, i]));
  const bucketFlows: Flows[] = series.map(() => emptyFlows());

  // ---- Selected + prior period accumulators (from transactions) ----
  const txSel = emptyFlows();
  const txPri = emptyFlows();
  const kindTotals = new Map<OutflowKind, number>();
  const subTotals = new Map<string, number>();
  const subTotalsPrior = new Map<string, number>();
  const merchantAgg = new Map<string, { total: number; count: number }>();
  const purchases: PurchaseRow[] = [];

  for (const t of raw.tx) {
    // (Card payments, savings withdrawals and kids money were already
    // dropped on the server — see page.tsx.)
    const kind = kindOf(t.subcategory_id);
    const flowKind: CategoryKind | "uncategorized" = kind ?? "uncategorized";
    const amount = t.amount_cents;

    const bi = bucketIdx.get(keyOfDate(granularity, t.occurred_on));
    if (bi != null) addFlow(bucketFlows[bi], flowKind, amount);

    const inSel = inTxSel(t.occurred_on);
    const inPri = !multi && t.occurred_on >= priRange.from && t.occurred_on <= priRange.to;
    if (inSel) addFlow(txSel, flowKind, amount);
    if (inPri) addFlow(txPri, flowKind, amount);

    // Prior-period per-subcategory total, for the "Change" column below.
    if (inPri && kind !== "income" && t.subcategory_id) {
      subTotalsPrior.set(t.subcategory_id, (subTotalsPrior.get(t.subcategory_id) ?? 0) + amount);
    }

    if (!inSel || kind === "income") continue;

    // Outflow detail for the selected period (transactions only).
    const ok = outflowKindOf(t.subcategory_id);
    kindTotals.set(ok, (kindTotals.get(ok) ?? 0) + amount);
    if (t.subcategory_id) {
      subTotals.set(t.subcategory_id, (subTotals.get(t.subcategory_id) ?? 0) + amount);
    }
    const merchant = t.payee_id ? raw.payees[t.payee_id] ?? null : null;
    if (merchant) {
      const m = merchantAgg.get(merchant) ?? { total: 0, count: 0 };
      m.total += amount;
      m.count += 1;
      merchantAgg.set(merchant, m);
    }
    if (purchases.length < 5) {
      purchases.push({
        id: t.id,
        date: t.occurred_on,
        payee: merchant ?? "Uncategorized",
        sub: t.subcategory_id ? raw.subs[t.subcategory_id]?.name ?? "—" : "Uncategorized",
        kind: ok,
        amount,
      });
    }
  }

  // For yearly buckets that have imported annual data, that data wins over the
  // sparse transaction rows for the same year.
  const rawBuckets: ChartBucket[] = series.map((k, i) => {
    const annual = annualForKey(k);
    const f = annual ?? bucketFlows[i];
    return {
      key: k,
      label: bucketLabel(granularity, k, seriesMultiYear),
      income: f.income,
      spending: spendingOf(f),
      savings: f.savings,
      debt: f.debt,
      selected: keys.includes(k),
    };
  });

  // Trim leading empty buckets so the axis doesn't waste space on pre-history
  // periods (weekly/monthly/quarterly views start ~12 buckets back, but
  // transactions only exist from 2026 forward). Never trim past the selected
  // period or the current one — those must always appear on the chart.
  const currentKey = currentPeriodKey(granularity, now);
  let firstKeep = 0;
  for (let i = 0; i < rawBuckets.length; i++) {
    const b = rawBuckets[i];
    const hasFlow = b.income > 0 || b.spending > 0 || b.savings > 0 || b.debt > 0;
    if (hasFlow || keys.includes(b.key) || b.key === currentKey) {
      firstKeep = i;
      break;
    }
  }
  const buckets: ChartBucket[] = rawBuckets.slice(firstKeep);

  // Selected / prior period flows: annual history wins for historical years.
  const annualSum = emptyFlows();
  for (const k of annualKeys) {
    const f = annualForKey(k)!;
    annualSum.income += f.income;
    annualSum.bills += f.bills;
    annualSum.expenses += f.expenses;
    annualSum.debt += f.debt;
    annualSum.savings += f.savings;
  }
  const totals: Flows = {
    income: annualSum.income + txSel.income,
    bills: annualSum.bills + txSel.bills,
    expenses: annualSum.expenses + txSel.expenses,
    debt: annualSum.debt + txSel.debt,
    savings: annualSum.savings + txSel.savings,
  };
  const priAnnual = multi ? null : annualForKey(prior);
  const priorFlows = multi ? emptyFlows() : priAnnual ?? txPri;
  // Historical years have category totals but no per-transaction detail, so
  // merchants / purchases only show when every pick is transaction-backed.
  const detailAvailable = annualKeys.length === 0;

  // Donut: annual kind totals plus transaction kind totals.
  const annualKindAmount = (k: OutflowKind): number =>
    k === "savings" ? annualSum.savings
      : k === "bills" ? annualSum.bills
      : k === "expenses" ? annualSum.expenses
      : k === "debt" ? annualSum.debt
      : 0;
  const kinds: KindSlice[] = OUTFLOW_ORDER.map((k) => ({
    kind: k,
    label: k,
    amount: annualKindAmount(k) + (kindTotals.get(k) ?? 0),
  })).filter((k) => k.amount > 0);

  let categoriesList: CategoryRow[];
  let merchants: MerchantRow[];
  if (annualKeys.length > 0) {
    // Annual line items summed by label across the picked years; transaction
    // subcategories from any 2026+ pick fold in by matching name.
    const priorYearLines = multi ? undefined : annualLineTotals.get(Number(prior));
    const byName = new Map<string, { kind: OutflowKind; amount: number }>();
    for (const k of annualKeys) {
      for (const [label, r] of annualLineTotals.get(Number(k))?.entries() ?? []) {
        const cur = byName.get(label);
        byName.set(label, { kind: r.kind, amount: (cur?.amount ?? 0) + r.amount });
      }
    }
    for (const [subId, amount] of subTotals) {
      const name = raw.subs[subId]?.name ?? "—";
      const cur = byName.get(name);
      byName.set(name, { kind: cur?.kind ?? outflowKindOf(subId), amount: (cur?.amount ?? 0) + amount });
    }
    categoriesList = [...byName.entries()]
      .map(([label, r]) => ({
        subId: `${keys.join("+")}:${label}`,
        name: label,
        kind: r.kind,
        amount: r.amount,
        priorAmount: priorYearLines?.get(label)?.amount ?? null,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
    merchants = [];
  } else {
    // For the current-period (2026+) path, cross-source the prior amount:
    // if the prior period is a historical year, pull that year's annual line
    // with the same subcategory name (best-effort match).
    const priorAnnualLines =
      priAnnual && granularity === "yearly"
        ? annualLineTotals.get(Number(prior)) ?? null
        : null;
    categoriesList = [...subTotals.entries()]
      .map(([subId, amount]) => {
        const name = raw.subs[subId]?.name ?? "—";
        const txPrior = multi ? undefined : subTotalsPrior.get(subId);
        const annualPrior = priorAnnualLines?.get(name)?.amount;
        const priorAmount =
          txPrior != null ? txPrior : annualPrior != null ? annualPrior : null;
        return {
          subId,
          name,
          kind: outflowKindOf(subId),
          amount,
          priorAmount,
        };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
    merchants = [...merchantAgg.entries()]
      .map(([name, m]) => ({ name, count: m.count, total: m.total, avg: Math.round(m.total / m.count) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }

  const data: InsightsData = {
    granularity,
    periodKey,
    periodKeys: keys,
    comparable: !multi,
    periodLabel: selectionLabel(granularity, keys, series),
    // Imported annual history is one total per year, so it can't be cut to
    // a matching stretch; it's labelled as the whole year it is.
    priorLabel:
      priToDate && !priAnnual
        ? shortRangeLabel(priToDate.from, priToDate.to)
        : periodLabel(granularity, prior),
    minYear,
    totals,
    prior: priorFlows,
    buckets,
    kinds,
    categories: categoriesList,
    merchants,
    purchases: detailAvailable ? purchases : [],
    detailAvailable,
    currency: raw.currency,
  };

  return data;
}
