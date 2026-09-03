import Link from "next/link";
import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { getSessionContext } from "@/lib/auth-context";
import { PROPERTY_KIND } from "@/lib/net-worth";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { YearPicker } from "./year-picker";
import { AnnualPanels } from "./annual-panels";
import type { PropertyLine, PropertyRollup } from "./property-rollup";
import type { CatMonthGroup, CatMonthRow } from "./category-months-table";
import type { BreakdownKind } from "./annual-breakdown-history";
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
      payee_id: string | null; property_id: string | null;
    }>((from, to) =>
      supabase
        .from("transactions")
        .select("subcategory_id, account_id, bucket_id, amount_cents, occurred_on, is_withdrawal, payee_id, property_id")
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
      .select("id, name, kind, subtype, is_kids_account")
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

  const payeeName = new Map((payees ?? []).map((p) => [p.id, p.name]));

  // The two Budget lines that roll many charges into one figure. Only these
  // get a payee split — every other line is one thing, and a chevron on it
  // would be noise.
  const DETAIL_SUB_NAMES = new Set(["subscriptions", "irregular bills"]);
  const detailSubIds = new Set(
    (subs ?? [])
      .filter((s) => DETAIL_SUB_NAMES.has(s.name.toLowerCase()))
      .map((s) => s.id),
  );

  // What sits behind those two figures, split by who was paid.
  // v_monthly_actuals is a plain sum of the same transactions, so these lines
  // add back up to the row exactly. Only the viewed year counts, and only from
  // 2026 — earlier years are seeded totals with no transactions behind them.
  const NO_PAYEE_LABEL = "Unassigned";
  const payeeMonthsBySub = new Map<string, Map<string, number[]>>();
  for (const t of liveTxRows ?? []) {
    if (!t.subcategory_id || !detailSubIds.has(t.subcategory_id)) continue;
    if (parseInt(t.occurred_on.slice(0, 4), 10) !== year) continue;
    const label = (t.payee_id ? payeeName.get(t.payee_id) : null) ?? NO_PAYEE_LABEL;
    let byPayee = payeeMonthsBySub.get(t.subcategory_id);
    if (!byPayee) {
      byPayee = new Map();
      payeeMonthsBySub.set(t.subcategory_id, byPayee);
    }
    let months = byPayee.get(label);
    if (!months) {
      months = Array(12).fill(0);
      byPayee.set(label, months);
    }
    months[parseInt(t.occurred_on.slice(5, 7), 10) - 1] += t.amount_cents;
  }

  const categoryGroups: CatMonthGroup[] = categories.flatMap((category) => {
    const allRows: CatMonthRow[] = (subIdsByCategory.get(category.id) ?? [])
      .map((subId) => {
        const months = actualBySub.get(subId) ?? Array(12).fill(0);
        const total = months.reduce((sum, v) => sum + v, 0);
        const details = [...(payeeMonthsBySub.get(subId)?.entries() ?? [])]
          .map(([name, detailMonths]) => ({
            name,
            months: detailMonths,
            total: detailMonths.reduce((sum, v) => sum + v, 0),
          }))
          .sort((a, b) => b.total - a.total);
        return {
          subId,
          name: nameBySub.get(subId) ?? "—",
          months,
          total,
          // A lone detail line just restates the row it sits under, so a row
          // only becomes expandable once there is genuinely a split to see.
          ...(details.length > 1 ? { details } : {}),
        };
      });

    // Order follows the Budget page (subcategories arrive by sort_order). A
    // line with nothing logged this year drops to the bottom instead of
    // holding its slot in the middle of the list — see feedback: dormant rows
    // should shift down.
    const active = allRows.filter((r) => r.months.some((v) => v !== 0));
    if (!active.length) return [];
    const rows = [
      ...active,
      ...allRows.filter((r) => !r.months.some((v) => v !== 0)).map((r) => ({ ...r, dormant: true })),
    ];

    const monthTotals = Array(12).fill(0);
    for (const r of active) for (let i = 0; i < 12; i++) monthTotals[i] += r.months[i];
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

  // The same two roll-up lines again, this time per year for the Annual
  // Breakdown card: subcategory_id → payee_name → year → cents.
  const detailPayeeBySub = new Map<string, Map<string, Map<number, number>>>();
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

  // Per-property rollup. A rental's rent is Income and its repairs are
  // Expenses, so the two halves of one property's year live in different
  // category groups and no other panel on this page puts them side by side.
  // transactions.property_id is the join; see the transaction_property_tag
  // migration. Only 2026+ is covered — the tag did not exist before, and
  // liveTxRows starts there.
  const propertyAccounts = (investmentAccounts ?? []).filter(
    (a) => a.kind === PROPERTY_KIND,
  );
  const propertyRollups: PropertyRollup[] = [];
  if (propertyAccounts.length > 0) {
    // property id → subcategory id → 12 months of cents.
    const linesByProperty = new Map<string, Map<string, number[]>>();
    for (const t of liveTxRows ?? []) {
      if (!t.property_id || !t.subcategory_id) continue;
      if (parseInt(t.occurred_on.slice(0, 4), 10) !== year) continue;
      if (!kindBySub.get(t.subcategory_id)) continue;
      let lines = linesByProperty.get(t.property_id);
      if (!lines) {
        lines = new Map();
        linesByProperty.set(t.property_id, lines);
      }
      let months = lines.get(t.subcategory_id);
      if (!months) {
        months = Array(12).fill(0);
        lines.set(t.subcategory_id, months);
      }
      months[parseInt(t.occurred_on.slice(5, 7), 10) - 1] += t.amount_cents;
    }

    for (const account of propertyAccounts) {
      const lines: PropertyLine[] = [];
      const incomeMonths = Array(12).fill(0);
      const costMonths = Array(12).fill(0);
      for (const [subId, months] of linesByProperty.get(account.id) ?? []) {
        const kind = kindBySub.get(subId);
        if (!kind) continue;
        const target = kind === "income" ? incomeMonths : costMonths;
        for (let i = 0; i < 12; i++) target[i] += months[i];
        lines.push({
          subId,
          name: nameBySub.get(subId) ?? "—",
          kind,
          months,
          total: months.reduce((sum, v) => sum + v, 0),
        });
      }
      // Income first, then the costs, each biggest-first: the year reads as
      // "this came in, and here is what ate it".
      lines.sort((a, b) =>
        a.kind === b.kind
          ? b.total - a.total
          : a.kind === "income"
            ? -1
            : b.kind === "income"
              ? 1
              : 0,
      );
      const sum = (months: number[]) => months.reduce((acc, v) => acc + v, 0);
      propertyRollups.push({
        id: account.id,
        name: account.name,
        subtype: account.subtype ?? null,
        lines,
        incomeMonths,
        costMonths,
        netMonths: incomeMonths.map((v, i) => v - costMonths[i]),
        incomeTotal: sum(incomeMonths),
        costTotal: sum(costMonths),
        netTotal: sum(incomeMonths) - sum(costMonths),
      });
    }
    // Busiest property first; an untagged one still lists, so its empty state
    // can say the tag is what is missing.
    propertyRollups.sort(
      (a, b) => b.incomeTotal + b.costTotal - (a.incomeTotal + a.costTotal),
    );
  }

  const totalNet = totals.income - OUTFLOW_KINDS.reduce((sum, k) => sum + totals[k], 0);
  const currency = household.currency;
  // Tracks have a floor and a ceiling: they fill the panel Months now has to
  // itself (see annual-panels.tsx), but the table is capped at 78rem so six
  // figures keep reading as a row instead of drifting apart on a 2560px
  // monitor. The 2xl step matches the larger type there.
  const gridCols =
    "grid-cols-[minmax(5rem,7rem)_repeat(6,minmax(9rem,1fr))]";

  return (
    <div className="mx-auto w-full space-y-4 max-w-[1800px]">
      {/* Desktop only. Twelve months against five kinds, then the same again
          per category and per year, is more table than a phone can show
          without shrinking it past reading — and /annual is deliberately
          absent from the mobile tab bar and its More menu for the same
          reason. Below lg the page says where to find it instead of
          rendering a wall of figures nobody can use. */}
      <div className="rounded-xl bg-surface p-5 shadow-sm ring-1 ring-black/5 lg:hidden dark:ring-white/10">
        <h1 className="text-lg font-bold">Annual Overview</h1>
        <p className="mt-1 text-sm text-muted">
          This one is built for a big screen — twelve months across five kinds, plus the
          multi-year breakdown. Open it on a desktop or laptop.
        </p>
      </div>

      <div className="hidden space-y-4 lg:block">
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

      {/* The hero cards ride along inside AnnualPanels: they stay pinned over
          Months / Category by Months / Properties and release at Annual
          Breakdown, and clicking cells in Months filters them. */}
      <AnnualPanels
        year={year}
        outflowKinds={OUTFLOW_KINDS}
        columns={COLUMNS}
        monthRows={rows}
        totals={totals}
        totalNet={totalNet}
        gridCols={gridCols}
        groups={categoryGroups}
        monthLabels={monthLabels}
        properties={propertyRollups}
        kinds={breakdownKinds}
        years={breakdownYears}
        netByYear={netByYear}
        currency={currency}
      />
      </div>

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

const KIND_ORDER: BreakdownKind["kind"][] = ["income", "investment", "savings", "bills", "expenses", "debt", "kidsFunding"];
// Merged lines carry the current Budget name, not the older sheet name:
// "Fidelity" is now "Fidelity (Taxable) Vic", "TSP" is "TSP Roth". (River
// merges into Bitcoin, which keeps its own name.)
const LINE_DISPLAY_LABEL: Record<string, string> = {
  fidelity: "Fidelity (Taxable) Vic",
  tsp: "TSP Roth",
};
const displayLineLabel = (label: string) => LINE_DISPLAY_LABEL[label.toLowerCase()] ?? label;

const KIND_LABEL: Record<BreakdownKind["kind"], string> = {
  income: "Income",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
  savings: "Savings",
  investment: "Invest/Savings",
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

  // Budget subs that are the same account as a seeded history line under a
  // different name — folded onto the history row so each account is one row
  // rather than a 2026-only orphan in "From Budget".
  const LINE_ALIASES: Record<string, string> = {
    "fidelity (taxable) vic": "fidelity",
    "tsp roth": "tsp",
    river: "bitcoin",
  };
  const aliasFor = (name: string) => LINE_ALIASES[name.toLowerCase()] ?? name.toLowerCase();

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
    const nameLower = aliasFor(sub.name);
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
    const lookup = aliasFor(sub.name);
    const aliased = lookup !== sub.name.toLowerCase();
    // An aliased sub folds onto its history row even when it came from a
    // custom Budget group — the alias is the explicit instruction to merge.
    const match = sub.customGroup && !aliased ? undefined : idx?.get(lookup);
    if (match) {
      for (const [y, v] of sub.byYear) {
        match.byYear[y] = (match.byYear[y] ?? 0) + v;
        match.total += v;
      }
      mergeLiveDetails(sheetKind, lookup, sub);
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
            return { label: displayLineLabel(lineLabel), byYear: l.byYear, total: l.total, ...(merged ? { details: merged } : {}) };
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
  return mergeInvestSavings(result);
}

// Savings and Investment are the same money to Victor (see the Savings ⇄
// Investments reconciliation), so the breakdown shows them as one
// "Invest/Savings" kind: savings groups are appended to the investment entry
// (merging any same-named group) and the standalone savings entry is dropped.
function mergeInvestSavings(kinds: BreakdownKind[]): BreakdownKind[] {
  const inv = kinds.find((k) => k.kind === "investment");
  const sav = kinds.find((k) => k.kind === "savings");
  if (!sav) return kinds;
  if (!inv) {
    return kinds.map((k) => (k.kind === "savings" ? { ...k, label: KIND_LABEL.investment } : k));
  }

  const groups = [...inv.groups];
  for (const g of sav.groups) {
    const existing = groups.find((x) => x.label === g.label);
    if (!existing) {
      groups.push(g);
      continue;
    }
    const merged = { ...existing, lines: [...existing.lines, ...g.lines], subtotalByYear: { ...existing.subtotalByYear }, total: existing.total + g.total };
    for (const [y, v] of Object.entries(g.subtotalByYear)) {
      merged.subtotalByYear[Number(y)] = (merged.subtotalByYear[Number(y)] ?? 0) + v;
    }
    groups[groups.indexOf(existing)] = merged;
  }

  const totalByYear = { ...inv.totalByYear };
  for (const [y, v] of Object.entries(sav.totalByYear)) {
    totalByYear[Number(y)] = (totalByYear[Number(y)] ?? 0) + v;
  }

  const combined: BreakdownKind = {
    kind: "investment",
    label: KIND_LABEL.investment,
    groups,
    totalByYear,
    total: inv.total + sav.total,
  };
  return kinds.flatMap((k) => (k.kind === "investment" ? [combined] : k.kind === "savings" ? [] : [k]));
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
