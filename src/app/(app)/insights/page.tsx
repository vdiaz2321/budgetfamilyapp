import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { getSessionContext } from "@/lib/auth-context";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { InsightsBoard } from "./insights-board";
import {
  bucketLabel,
  currentPeriodKey,
  keyOfDate,
  periodLabel,
  periodRange,
  priorKey,
  seriesKeys,
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
import { throwIfAny } from "@/lib/supabase-result";

export const metadata = { title: "Insights · Capitall" };

type SearchParams = Promise<{ g?: string; p?: string }>;

const OUTFLOW_ORDER: OutflowKind[] = [
  "savings", "bills", "expenses", "debt", "uncategorized",
];

const isGranularity = (v: string | undefined): v is Granularity =>
  v === "weekly" || v === "monthly" || v === "quarterly" || v === "yearly";

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

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { supabase, household } = await getSessionContext();
  const sp = await searchParams;
  const now = new Date();

  const granularity: Granularity = isGranularity(sp.g) ? sp.g : "monthly";
  const periodKey = sp.p || currentPeriodKey(granularity, now);
  const prior = priorKey(granularity, periodKey);
  const selRange = periodRange(granularity, periodKey);
  const priRange = periodRange(granularity, prior);

  const categories = await ensureCategories(supabase, household.id);
  const kindByCat = new Map(categories.map((c) => [c.id, c.kind as CategoryKind]));

  const seedSeries = seriesKeys(granularity, periodKey, now.getFullYear() - 8, now);
  const seriesFrom = periodRange(granularity, seedSeries[0]).from;
  const minStr = (a: string, b: string) => (a < b ? a : b);
  const maxStr = (a: string, b: string) => (a > b ? a : b);
  const fetchFrom = minStr(minStr(seriesFrom, priRange.from), selRange.from);
  const fetchTo = maxStr(maxStr(selRange.to, priRange.to), periodRange(granularity, seedSeries[seedSeries.length - 1]).to);

  const [
    { data: subs, error: subsError },
    { data: payees, error: payeesError },
    { data: accounts, error: accountsError },
    txRows,
    { data: annualRows, error: annualRowsError },
  ] = await Promise.all([
    supabase.from("subcategories").select("id, name, category_id").eq("household_id", household.id),
    supabase.from("payees").select("id, name").eq("household_id", household.id),
    supabase.from("accounts").select("id, is_kids_account").eq("household_id", household.id),
    // The window here widens with the chosen range and granularity, so it can
    // pass PostgREST's 1000-row cap. Paged on a stable key; the amount ordering
    // the callers rely on is applied below, after every page is in.
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
        .gte("occurred_on", fetchFrom)
        .lte("occurred_on", fetchTo)
        .order("id")
        .range(from, to),
    ).then((rows) => rows.sort((a, b) => b.amount_cents - a.amount_cents)),
    // Imported multi-year annual totals (2018–2025). Yearly line items per kind.
    supabase
      .from("annual_breakdown_history")
      .select("year, kind, line_label, amount_cents")
      .eq("household_id", household.id),
  ]);
  throwIfAny({ subs: subsError, payees: payeesError, accounts: accountsError, annualRows: annualRowsError });

  const subName = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const subCat = new Map((subs ?? []).map((s) => [s.id, s.category_id]));
  const payeeName = new Map((payees ?? []).map((p) => [p.id, p.name]));
  const kidsAccounts = new Set(
    (accounts ?? []).filter((a) => a.is_kids_account).map((a) => a.id),
  );

  const kindOf = (subId: string | null): CategoryKind | null => {
    if (!subId) return null;
    const catId = subCat.get(subId);
    return catId ? kindByCat.get(catId) ?? null : null;
  };
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
  for (const r of annualRows ?? []) {
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

  for (const t of txRows ?? []) {
    if (t.paid_to_account_id) continue; // card payment (transfer)
    if (t.is_withdrawal) continue; // savings withdrawal (transfer)
    if (t.account_id && kidsAccounts.has(t.account_id)) continue; // kids money

    const kind = kindOf(t.subcategory_id);
    const flowKind: CategoryKind | "uncategorized" = kind ?? "uncategorized";
    const amount = t.amount_cents;

    const bi = bucketIdx.get(keyOfDate(granularity, t.occurred_on));
    if (bi != null) addFlow(bucketFlows[bi], flowKind, amount);

    const inSel = t.occurred_on >= selRange.from && t.occurred_on <= selRange.to;
    const inPri = t.occurred_on >= priRange.from && t.occurred_on <= priRange.to;
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
    const merchant = t.payee_id ? payeeName.get(t.payee_id) ?? null : null;
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
        sub: t.subcategory_id ? subName.get(t.subcategory_id) ?? "—" : "Uncategorized",
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
      selected: k === periodKey,
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
    if (hasFlow || b.key === periodKey || b.key === currentKey) {
      firstKeep = i;
      break;
    }
  }
  const buckets: ChartBucket[] = rawBuckets.slice(firstKeep);

  // Selected / prior period flows: annual history wins for historical years.
  const selAnnual = annualForKey(periodKey);
  const priAnnual = annualForKey(prior);
  const totals = selAnnual ?? txSel;
  const priorFlows = priAnnual ?? txPri;
  const detailAvailable = selAnnual == null; // historical years have no tx detail

  // Donut + categories: from annual line items for historical years, else tx.
  let kinds: KindSlice[];
  let categoriesList: CategoryRow[];
  let merchants: MerchantRow[];
  if (selAnnual) {
    kinds = OUTFLOW_ORDER.map((k) => {
      const amount =
        k === "savings" ? selAnnual.savings
          : k === "bills" ? selAnnual.bills
          : k === "expenses" ? selAnnual.expenses
          : k === "debt" ? selAnnual.debt
          : 0;
      return { kind: k, label: k, amount };
    }).filter((k) => k.amount > 0);
    const priorYearLines = annualLineTotals.get(Number(prior));
    const selYearLines = annualLineTotals.get(Number(periodKey));
    categoriesList = [...(selYearLines?.entries() ?? [])]
      .map(([label, r]) => ({
        subId: `${periodKey}:${label}`,
        name: label,
        kind: r.kind,
        amount: r.amount,
        priorAmount: priorYearLines?.get(label)?.amount ?? null,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
    merchants = [];
  } else {
    kinds = OUTFLOW_ORDER.map((k) => ({
      kind: k,
      label: k,
      amount: kindTotals.get(k) ?? 0,
    })).filter((k) => k.amount > 0);
    // For the current-period (2026+) path, cross-source the prior amount:
    // if the prior period is a historical year, pull that year's annual line
    // with the same subcategory name (best-effort match).
    const priorAnnualLines =
      priAnnual && granularity === "yearly"
        ? annualLineTotals.get(Number(prior)) ?? null
        : null;
    categoriesList = [...subTotals.entries()]
      .map(([subId, amount]) => {
        const name = subName.get(subId) ?? "—";
        const txPrior = subTotalsPrior.get(subId);
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
    periodLabel: periodLabel(granularity, periodKey),
    priorLabel: periodLabel(granularity, prior),
    minYear,
    totals,
    prior: priorFlows,
    buckets,
    kinds,
    categories: categoriesList,
    merchants,
    purchases: detailAvailable ? purchases : [],
    detailAvailable,
    currency: household.currency,
  };

  return <InsightsBoard data={data} />;
}
