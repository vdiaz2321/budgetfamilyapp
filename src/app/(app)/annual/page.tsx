import Link from "next/link";
import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { getSessionContext } from "@/lib/auth-context";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { AnnualHero } from "./annual-hero";
import { YearPicker } from "./year-picker";
import {
  CategoryMonthsTable,
  type CatMonthGroup,
  type CatMonthRow,
} from "./category-months-table";
import {
  AnnualBreakdownHistory,
  type BreakdownKind,
} from "./annual-breakdown-history";
import { ScrollToTop } from "@/components/scroll-to-top";
import { throwIfAny } from "@/lib/supabase-result";

export const metadata = { title: "Annual Overview · Capitall" };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Column order mirrors the sheet's Year tab.
const OUTFLOW_KINDS: CategoryKind[] = ["savings", "bills", "expenses", "debt"];
const COLUMNS: { kind: CategoryKind; label: string }[] = [
  { kind: "income", label: "Income" },
  { kind: "savings", label: "Savings" },
  { kind: "bills", label: "Bills" },
  { kind: "expenses", label: "Expenses" },
  { kind: "debt", label: "Debt" },
];

type MonthRow = {
  idx: number; // 0-11
  name: string;
  // Displayed value per kind: actuals for past/current months, planned for future.
  values: Record<CategoryKind, number>;
  net: number;
  status: "past" | "current" | "future";
  hasData: boolean;
};

type SearchParams = Promise<{ year?: string }>;

export default async function AnnualOverviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { year: yearParam } = await searchParams;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = now.getMonth();
  const parsed = yearParam ? parseInt(yearParam, 10) : currentYear;
  const year = Number.isNaN(parsed) ? currentYear : Math.min(2100, Math.max(2000, parsed));

  const { supabase, household } = await getSessionContext();

  const categories = await ensureCategories(supabase, household.id);
  const kindByCat = new Map(categories.map((c) => [c.id, c.kind as CategoryKind]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-01`;

  // Live 2026+ range for the Annual Breakdown card — queried straight from
  // `transactions` (not `v_monthly_actuals`) so we can honor Victor's
  // "deposits only, no withdrawals" rule for Savings/Investment. See
  // buildBreakdown() for the merge logic and kind mapping.
  const liveRangeStart = "2026-01-01";
  const liveRangeEnd = `${currentYear}-12-31`;

  const [
    { data: subs, error: subsError },
    { data: plans, error: plansError },
    { data: actuals, error: actualsError },
    { data: breakdownRows, error: breakdownRowsError },
    liveTxRows,
    { data: investmentContributionRows, error: investmentContributionRowsError },
    { data: investmentAccounts, error: investmentAccountsError },
    { data: investmentBuckets, error: investmentBucketsError },
    { data: payees, error: payeesError },
  ] = await Promise.all([
    supabase
      .from("subcategories")
      .select("id, category_id, name, sort_order, linked_account_id, linked_bucket_id")
      .eq("household_id", household.id)
      .order("sort_order"),
    supabase
      .from("budget_plans")
      .select("subcategory_id, planned_cents, month")
      .eq("household_id", household.id)
      .gte("month", yearStart)
      .lte("month", yearEnd),
    supabase
      .from("v_monthly_actuals")
      .select("subcategory_id, actual_cents, month")
      .eq("household_id", household.id)
      .gte("month", yearStart)
      .lte("month", yearEnd),
    // Year-independent: the whole seeded Annual Breakdown history (2018–2025).
    supabase
      .from("annual_breakdown_history")
      .select("kind, group_label, line_label, year, amount_cents, group_sort, line_sort")
      .eq("household_id", household.id)
      .order("group_sort")
      .order("line_sort"),
    // A full year of transactions is already past PostgREST's 1000-row cap, so
    // this has to be paged or the year's live figures silently lose rows.
    fetchAllRows<{
      subcategory_id: string; account_id: string | null; bucket_id: string | null;
      amount_cents: number; occurred_on: string; is_withdrawal: boolean | null;
      payee_id: string | null;
    }>((from, to) =>
      supabase
        .from("transactions")
        .select("subcategory_id, account_id, bucket_id, amount_cents, occurred_on, is_withdrawal, payee_id")
        .eq("household_id", household.id)
        .gte("occurred_on", liveRangeStart)
        .lte("occurred_on", liveRangeEnd)
        .not("subcategory_id", "is", null)
        .order("id")
        .range(from, to),
    ),
    supabase
      .from("v_investment_contributions")
      .select("account_id, bucket_id, year, net_contribution_cents")
      .eq("household_id", household.id)
      .gte("year", 2026)
      .lte("year", currentYear),
    supabase
      .from("accounts")
      .select("id, name, kind, is_kids_account")
      .eq("household_id", household.id),
    supabase
      .from("buckets")
      .select("id, account_id, name")
      .eq("household_id", household.id),
    supabase
      .from("payees")
      .select("id, name")
      .eq("household_id", household.id),
  ]);
  throwIfAny({ subs: subsError, plans: plansError, actuals: actualsError, breakdownRows: breakdownRowsError, investmentContributionRows: investmentContributionRowsError, investmentAccounts: investmentAccountsError, investmentBuckets: investmentBucketsError, payees: payeesError });

  const kindBySub = new Map(
    (subs ?? []).map((s) => [s.id, kindByCat.get(s.category_id) ?? null]),
  );
  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const subcategoryInvestmentTargets = new Set(
    (subs ?? [])
      .filter((s) => s.linked_account_id || s.linked_bucket_id)
      .map((s) => s.id),
  );
  const investmentAccountIds = new Set(
    (investmentAccounts ?? [])
      .filter((a) => a.kind === "investment" || a.is_kids_account)
      .map((a) => a.id),
  );
  const investmentBucketIds = new Set(
    (investmentBuckets ?? [])
      .filter((b) => investmentAccountIds.has(b.account_id))
      .map((b) => b.id),
  );

  // Per-subcategory actuals and planned by month (cents), for the Category by Months table.
  const actualBySub = new Map<string, number[]>();
  const plannedBySub = new Map<string, number[]>();

  // planned[monthIdx][kind] and actual[monthIdx][kind], all cents.
  const emptyKinds = (): Record<CategoryKind, number> => ({
    income: 0, savings: 0, bills: 0, expenses: 0, debt: 0,
  });
  const planned = Array.from({ length: 12 }, emptyKinds);
  const actual = Array.from({ length: 12 }, emptyKinds);

  for (const p of plans ?? []) {
    const kind = kindBySub.get(p.subcategory_id);
    if (!kind) continue;
    const monthIdx = parseInt(p.month.slice(5, 7), 10) - 1;
    planned[monthIdx][kind] += p.planned_cents;

    let pMonths = plannedBySub.get(p.subcategory_id);
    if (!pMonths) {
      pMonths = Array(12).fill(0);
      plannedBySub.set(p.subcategory_id, pMonths);
    }
    pMonths[monthIdx] += p.planned_cents;
  }
  for (const a of actuals ?? []) {
    const kind = kindBySub.get(a.subcategory_id);
    if (!kind) continue;
    const monthIdx = parseInt(a.month.slice(5, 7), 10) - 1;
    actual[monthIdx][kind] += a.actual_cents;

    let months = actualBySub.get(a.subcategory_id);
    if (!months) {
      months = Array(12).fill(0);
      actualBySub.set(a.subcategory_id, months);
    }
    months[monthIdx] += a.actual_cents;
  }

  const rows: MonthRow[] = MONTH_NAMES.map((name, idx) => {
    const status: MonthRow["status"] =
      year < currentYear || (year === currentYear && idx < currentMonthIdx)
        ? "past"
        : year === currentYear && idx === currentMonthIdx
          ? "current"
          : "future";
    // All months show actuals only — no planned/projected values.
    const source = actual[idx];
    const net =
      source.income - OUTFLOW_KINDS.reduce((sum, k) => sum + source[k], 0);
    const hasData = COLUMNS.some(({ kind }) => actual[idx][kind] !== 0);
    return { idx, name, values: source, net, status, hasData };
  });

  const totals = emptyKinds();
  for (const r of rows) {
    for (const { kind } of COLUMNS) totals[kind] += r.values[kind];
  }
  // Category by Months: preserve each Budget group while its accounting kind
  // continues to feed the five summary totals above.
  const subIdsByCategory = new Map<string, string[]>();
  for (const s of subs ?? []) {
    const list = subIdsByCategory.get(s.category_id) ?? [];
    list.push(s.id);
    subIdsByCategory.set(s.category_id, list);
  }

  const categoryGroups: CatMonthGroup[] = categories.flatMap((category) => {
    const rows: CatMonthRow[] = (subIdsByCategory.get(category.id) ?? [])
      .map((subId) => {
        const months = actualBySub.get(subId) ?? Array(12).fill(0);
        const total = months.reduce((sum, v) => sum + v, 0);
        return { subId, name: nameBySub.get(subId) ?? "—", months, total };
      })
      .filter((r) => r.months.some((v) => v !== 0));

    if (!rows.length) return [];

    const monthTotals = Array(12).fill(0);
    for (const r of rows) for (let i = 0; i < 12; i++) monthTotals[i] += r.months[i];
    const total = monthTotals.reduce((sum, v) => sum + v, 0);

    return [{
      categoryId: category.id,
      kind: category.kind,
      label: category.name,
      rows,
      monthTotals,
      total,
    }];
  });

  const monthLabels = MONTH_NAMES.map((m) => m.slice(0, 3));

  // Aggregate 2026+ transactions per subcategory per year for the Annual
  // Breakdown card. Savings-kind Budget subs skip withdrawals (Victor tracks
  // "how much I paid in"); every other kind takes all rows.
  const liveDepositsBySub = new Map<string, Map<number, number>>();
  for (const t of liveTxRows ?? []) {
    if (!t.subcategory_id) continue;
    if (t.account_id && investmentAccountIds.has(t.account_id)) continue;
    if (t.bucket_id && investmentBucketIds.has(t.bucket_id)) continue;
    if (subcategoryInvestmentTargets.has(t.subcategory_id)) continue;
    const kind = kindBySub.get(t.subcategory_id);
    if (!kind) continue;
    if (kind === "savings" && t.is_withdrawal) continue;
    const y = parseInt(t.occurred_on.slice(0, 4), 10);
    let byYear = liveDepositsBySub.get(t.subcategory_id);
    if (!byYear) {
      byYear = new Map();
      liveDepositsBySub.set(t.subcategory_id, byYear);
    }
    byYear.set(y, (byYear.get(y) ?? 0) + t.amount_cents);
  }

  // Per-payee detail for line items that roll up (Subscriptions, Irregular Bills):
  // subcategory_id → payee_name → year → cents
  const DETAIL_SUB_NAMES = new Set(["subscriptions", "irregular bills"]);
  const detailPayeeBySub = new Map<string, Map<string, Map<number, number>>>();
  const payeeName = new Map((payees ?? []).map((p) => [p.id, p.name]));
  const detailSubIds = new Set(
    (subs ?? [])
      .filter((s) => DETAIL_SUB_NAMES.has(s.name.toLowerCase()))
      .map((s) => s.id),
  );
  for (const t of liveTxRows ?? []) {
    if (!t.subcategory_id || !detailSubIds.has(t.subcategory_id)) continue;
    if (!t.payee_id) continue;
    const name = payeeName.get(t.payee_id);
    if (!name) continue;
    const y = parseInt(t.occurred_on.slice(0, 4), 10);
    let byPayee = detailPayeeBySub.get(t.subcategory_id);
    if (!byPayee) {
      byPayee = new Map();
      detailPayeeBySub.set(t.subcategory_id, byPayee);
    }
    let byYear = byPayee.get(name);
    if (!byYear) {
      byYear = new Map();
      byPayee.set(name, byYear);
    }
    byYear.set(y, (byYear.get(y) ?? 0) + t.amount_cents);
  }

  const budgetSubsForLive: LiveBudgetSub[] = [];
  for (const s of subs ?? []) {
    const kind = kindBySub.get(s.id);
    if (!kind) continue;
    const category = categoryById.get(s.category_id);
    if (!category) continue;
    const byYear = liveDepositsBySub.get(s.id);
    if (!byYear || byYear.size === 0) continue;
    budgetSubsForLive.push({
      id: s.id,
      name: s.name,
      kind,
      byYear,
      groupLabel: category.name,
      groupSort: category.sort_order,
      customGroup: !category.is_system,
      ...(detailPayeeBySub.has(s.id) ? { details: detailPayeeBySub.get(s.id) } : {}),
    });
  }

  const accountById = new Map((investmentAccounts ?? []).map((a) => [a.id, a]));
  const bucketById = new Map((investmentBuckets ?? []).map((b) => [b.id, b]));
  const liveInvestmentByDestination = new Map<string, LiveBudgetSub>();
  for (const row of investmentContributionRows ?? []) {
    const account = accountById.get(row.account_id);
    if (!account) continue;
    const bucket = row.bucket_id ? bucketById.get(row.bucket_id) : null;
    const key = `${row.account_id}:${row.bucket_id ?? "_"}`;
    const target = liveInvestmentByDestination.get(key) ?? {
      id: key,
      name: bucket?.name ?? account.name,
      kind: "savings" as CategoryKind,
      isInvestment: true,
      isKids: account.is_kids_account ?? false,
      byYear: new Map<number, number>(),
    };
    target.byYear.set(row.year, (target.byYear.get(row.year) ?? 0) + row.net_contribution_cents);
    liveInvestmentByDestination.set(key, target);
  }
  budgetSubsForLive.push(...liveInvestmentByDestination.values());

  // Annual Breakdown: pivot the seeded leaf rows (2018–2025) into kind → group
  // → line, then overlay 2026+ live totals from Budget transactions.
  const breakdownKinds = buildBreakdown(breakdownRows ?? [], budgetSubsForLive);
  const seedYears = new Set((breakdownRows ?? []).map((r) => r.year));
  const liveYears = new Set<number>();
  for (let y = 2026; y <= currentYear; y++) liveYears.add(y);
  const breakdownYears = [...new Set([...seedYears, ...liveYears])].sort(
    (a, b) => b - a,
  ); // newest-first
  const netByYear: Record<number, number> = {};
  for (const y of breakdownYears) {
    const get = (k: string) => breakdownKinds.find((bk) => bk.kind === k)?.totalByYear[y] ?? 0;
    netByYear[y] = get("income") - get("bills") - get("expenses") - get("debt") - get("savings") - get("investment") - get("kidsFunding");
  }

  const currency = household.currency;
  const gridCols = "grid-cols-[6.5rem_repeat(6,minmax(5.5rem,1fr))]";

  return (
    <div className="mx-auto w-full space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Annual Overview</h1>
          <p className="text-sm text-muted">
            The whole year at a glance — actual transactions only.
          </p>
        </div>

        {/* Year navigator */}
        <div className="flex items-center gap-1 rounded-xl bg-surface p-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <YearArrow year={year - 1} dir="prev" />
          <YearPicker year={year} currentYear={currentYear} />
          <YearArrow year={year + 1} dir="next" />
        </div>
      </div>

      {/* Year summary + Months table (client wrapper so Outflow can filter by clicking column totals) */}
      <AnnualHero
        year={year}
        columns={COLUMNS}
        outflowKinds={OUTFLOW_KINDS}
        rows={rows}
        totals={totals}
        currency={currency}
        gridCols={gridCols}
      />

      {/* Category by Months */}
      <CategoryMonthsTable
        groups={categoryGroups}
        monthLabels={monthLabels}
        currency={currency}
      />

      {/* Annual Breakdown history (multi-year, seeded 2018–2025) */}
      <AnnualBreakdownHistory
        kinds={breakdownKinds}
        years={breakdownYears}
        netByYear={netByYear}
        currency={currency}
      />

      <ScrollToTop />
    </div>
  );
}

// Pivot seeded annual_breakdown_history leaf rows into the nested shape the
// AnnualBreakdownHistory component renders. Rows arrive ordered by group_sort,
// line_sort; kind order follows the sheet (income → expenses → savings → invest).
type BreakdownRow = {
  kind: string;
  group_label: string;
  line_label: string;
  year: number;
  amount_cents: number;
  group_sort: number;
  line_sort: number;
};

const KIND_ORDER: BreakdownKind["kind"][] = ["income", "bills", "expenses", "debt", "investment", "savings", "kidsFunding"];
const KIND_LABEL: Record<BreakdownKind["kind"], string> = {
  income: "Income",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
  savings: "Savings",
  investment: "Investment",
  kidsFunding: "Kids Funding",
};

// Budget's 5 kinds fold into the sheet's 4 kinds. Savings is special-cased
// below (name lookup against Investment first), so it's not in this table.
const BUDGET_TO_SHEET_KIND: Record<CategoryKind, BreakdownKind["kind"] | null> = {
  income: "income",
  bills: "bills",
  expenses: "expenses",
  debt: "debt",
  savings: null,
};

type LiveBudgetSub = {
  id: string;
  name: string;
  kind: CategoryKind;
  isInvestment?: boolean;
  isKids?: boolean;
  groupLabel?: string;
  groupSort?: number;
  customGroup?: boolean;
  byYear: Map<number, number>;
  // Per-item breakdown (payee-grouped) used by Subscriptions / Irregular Bills.
  details?: Map<string, Map<number, number>>; // itemName → year → cents
};

function buildBreakdown(
  rows: BreakdownRow[],
  liveBudgetSubs: LiveBudgetSub[] = [],
): BreakdownKind[] {
  // kind -> group_label -> line_label -> { byYear, total, lineSort } (+ groupSort)
  const kinds = new Map<
    string,
    Map<
      string,
      { groupSort: number; lines: Map<string, { byYear: Record<number, number>; total: number; lineSort: number }> }
    >
  >();

  for (const r of rows) {
    if (!kinds.has(r.kind)) kinds.set(r.kind, new Map());
    const groups = kinds.get(r.kind)!;
    if (!groups.has(r.group_label)) groups.set(r.group_label, { groupSort: r.group_sort, lines: new Map() });
    const group = groups.get(r.group_label)!;
    if (!group.lines.has(r.line_label)) group.lines.set(r.line_label, { byYear: {}, total: 0, lineSort: r.line_sort });
    const line = group.lines.get(r.line_label)!;
    line.byYear[r.year] = (line.byYear[r.year] ?? 0) + r.amount_cents;
    line.total += r.amount_cents;
  }

  // ---- Overlay live Budget data (2026+) --------------------------------
  // Precompute a lowercase label → line pointer index per kind, so we can
  // fold Budget subs onto the seeded row whose name matches (case-insensitive).
  type LineRef = { byYear: Record<number, number>; total: number; lineSort: number };
  const lineIndex = new Map<string, Map<string, LineRef>>(); // kind → nameLower → line
  for (const [kind, groups] of kinds) {
    const idx = new Map<string, LineRef>();
    for (const [, g] of groups) {
      for (const [label, l] of g.lines) idx.set(label.toLowerCase(), l);
    }
    lineIndex.set(kind, idx);
  }

  const FROM_BUDGET = "From Budget";
  const fromBudgetSort = 9_999_999; // ensure this synthetic group sinks to the end
  const ensureBudgetGroup = (sheetKind: string, label = FROM_BUDGET, groupSort = fromBudgetSort) => {
    if (!kinds.has(sheetKind)) kinds.set(sheetKind, new Map());
    const groups = kinds.get(sheetKind)!;
    if (!groups.has(label)) {
      groups.set(label, { groupSort, lines: new Map() });
    }
    return groups.get(label)!;
  };

  const resolveSheetKind = (sub: LiveBudgetSub): BreakdownKind["kind"] => {
    if (sub.isKids) return "kidsFunding";
    if (sub.isInvestment) return "investment";
    if (sub.kind !== "savings") {
      // income/bills/expenses/debt map directly; the table has no null values for them.
      return BUDGET_TO_SHEET_KIND[sub.kind]!;
    }
    // Budget "savings" is ambiguous — could be sheet Savings OR Investment.
    // Prefer Investment when the name matches a seeded investment line (e.g.
    // "Fidelity 401k", "TSP"); otherwise fall back to Savings.
    const nameLower = sub.name.toLowerCase();
    if (lineIndex.get("investment")?.has(nameLower)) return "investment";
    return "savings";
  };

  // Per-line payee-item detail (from live 2026+ transactions) — keyed by
  // "kind::lineLabelLower". Merged into detailsByParent during group build.
  const liveDetailByLine = new Map<string, Map<string, Map<number, number>>>();
  const mergeLiveDetails = (sheetKind: string, lineLabel: string, sub: LiveBudgetSub) => {
    if (!sub.details) return;
    const key = `${sheetKind}::${lineLabel.toLowerCase()}`;
    let byName = liveDetailByLine.get(key);
    if (!byName) {
      byName = new Map();
      liveDetailByLine.set(key, byName);
    }
    for (const [name, yr] of sub.details) {
      let dst = byName.get(name);
      if (!dst) {
        dst = new Map();
        byName.set(name, dst);
      }
      for (const [y, v] of yr) dst.set(y, (dst.get(y) ?? 0) + v);
    }
  };

  let unmatchedSort = 0;
  for (const sub of liveBudgetSubs) {
    const sheetKind = resolveSheetKind(sub);
    const idx = lineIndex.get(sheetKind);
    const match = sub.customGroup ? undefined : idx?.get(sub.name.toLowerCase());
    if (match) {
      for (const [y, v] of sub.byYear) {
        match.byYear[y] = (match.byYear[y] ?? 0) + v;
        match.total += v;
      }
      mergeLiveDetails(sheetKind, sub.name, sub);
    } else {
      const useNamedBudgetGroup = !sub.isKids && !sub.isInvestment && Boolean(sub.groupLabel);
      const group = ensureBudgetGroup(
        sheetKind,
        useNamedBudgetGroup ? sub.groupLabel : FROM_BUDGET,
        useNamedBudgetGroup ? sub.groupSort : fromBudgetSort,
      );
      // If a Budget sub already produced a "From Budget" line in a prior call
      // (shouldn't happen here — this only runs once per request — but keep
      // the accumulate semantics for safety).
      const existing = group.lines.get(sub.name);
      const line = existing ?? { byYear: {}, total: 0, lineSort: unmatchedSort++ };
      for (const [y, v] of sub.byYear) {
        line.byYear[y] = (line.byYear[y] ?? 0) + v;
        line.total += v;
      }
      if (!existing) group.lines.set(sub.name, line);
      // Also register in the index so a future duplicate sub with the same
      // lowercased name folds into the same "From Budget" row.
      lineIndex.get(sheetKind)?.set(sub.name.toLowerCase(), line);
      mergeLiveDetails(sheetKind, sub.name, sub);
    }
  }
  // ----------------------------------------------------------------------

  const result: BreakdownKind[] = [];
  for (const kind of KIND_ORDER) {
    const groups = kinds.get(kind);
    if (!groups) continue;

    // Extract "<LineLabel> Detail" groups first — they are attached as .details
    // on the matching parent line rather than shown as their own group.
    const detailsByParent = new Map<string, { label: string; byYear: Record<number, number>; total: number }[]>();
    const detailGroupKeys: string[] = [];
    for (const [label, g] of groups) {
      const m = label.match(/^(.+) Detail$/);
      if (!m) continue;
      const parent = m[1];
      const lines = [...g.lines.entries()]
        .sort((a, b) => a[1].lineSort - b[1].lineSort)
        .map(([lineLabel, l]) => ({ label: lineLabel, byYear: l.byYear, total: l.total }));
      const existing = detailsByParent.get(parent) ?? [];
      // Merge duplicates by label (add byYear + total).
      const byLabel = new Map(existing.map((d) => [d.label, d]));
      for (const nl of lines) {
        const cur = byLabel.get(nl.label);
        if (cur) {
          for (const [y, v] of Object.entries(nl.byYear)) cur.byYear[Number(y)] = (cur.byYear[Number(y)] ?? 0) + v;
          cur.total += nl.total;
        } else {
          byLabel.set(nl.label, { label: nl.label, byYear: { ...nl.byYear }, total: nl.total });
        }
      }
      detailsByParent.set(parent, [...byLabel.values()].sort((a, b) => b.total - a.total));
      detailGroupKeys.push(label);
    }
    for (const key of detailGroupKeys) groups.delete(key);

    const groupList = [...groups.entries()]
      .sort((a, b) => a[1].groupSort - b[1].groupSort)
      .map(([label, g]) => {
        const lines = [...g.lines.entries()]
          .sort((a, b) => a[1].lineSort - b[1].lineSort)
          .map(([lineLabel, l]) => {
            const historical = detailsByParent.get(lineLabel);
            const live = liveDetailByLine.get(`${kind}::${lineLabel.toLowerCase()}`);
            // Merge historical + live details by item name.
            let merged: { label: string; byYear: Record<number, number>; total: number }[] | undefined;
            if (historical || live) {
              const map = new Map<string, { label: string; byYear: Record<number, number>; total: number }>();
              for (const d of historical ?? []) map.set(d.label, { label: d.label, byYear: { ...d.byYear }, total: d.total });
              if (live) {
                for (const [name, yr] of live) {
                  const cur = map.get(name) ?? { label: name, byYear: {}, total: 0 };
                  for (const [y, v] of yr) {
                    cur.byYear[y] = (cur.byYear[y] ?? 0) + v;
                    cur.total += v;
                  }
                  map.set(name, cur);
                }
              }
              merged = [...map.values()].sort((a, b) => b.total - a.total);
            }
            return { label: lineLabel, byYear: l.byYear, total: l.total, ...(merged ? { details: merged } : {}) };
          });

        const subtotalByYear: Record<number, number> = {};
        let total = 0;
        for (const l of lines) {
          for (const [y, v] of Object.entries(l.byYear)) {
            subtotalByYear[Number(y)] = (subtotalByYear[Number(y)] ?? 0) + v;
          }
          total += l.total;
        }
        return { label, lines, subtotalByYear, total };
      });

    const totalByYear: Record<number, number> = {};
    let total = 0;
    for (const g of groupList) {
      for (const [y, v] of Object.entries(g.subtotalByYear)) {
        totalByYear[Number(y)] = (totalByYear[Number(y)] ?? 0) + v;
      }
      total += g.total;
    }

    result.push({ kind, label: KIND_LABEL[kind], groups: groupList, totalByYear, total });
  }
  return result;
}

function YearArrow({ year, dir }: { year: number; dir: "prev" | "next" }) {
  return (
    <Link
      href={`/annual?year=${year}`}
      aria-label={dir === "prev" ? "Previous year" : "Next year"}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-brand-soft hover:text-brand"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={dir === "prev" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />
      </svg>
    </Link>
  );
}
