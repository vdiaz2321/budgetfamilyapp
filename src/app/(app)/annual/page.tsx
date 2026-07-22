import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_KINDS, ensureCategories, type CategoryKind } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import { MonthsTable } from "./months-table";
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

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-01`;

  // Live 2026+ range for the Annual Breakdown card — queried straight from
  // `transactions` (not `v_monthly_actuals`) so we can honor Victor's
  // "deposits only, no withdrawals" rule for Savings/Investment. See
  // buildBreakdown() for the merge logic and kind mapping.
  const liveRangeStart = "2026-01-01";
  const liveRangeEnd = `${currentYear}-12-31`;

  const [
    { data: subs },
    { data: plans },
    { data: actuals },
    { data: breakdownRows },
    { data: liveTxRows },
  ] = await Promise.all([
    supabase
      .from("subcategories")
      .select("id, category_id, name, sort_order")
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
    supabase
      .from("transactions")
      .select("subcategory_id, amount_cents, occurred_on, is_withdrawal")
      .eq("household_id", household.id)
      .gte("occurred_on", liveRangeStart)
      .lte("occurred_on", liveRangeEnd)
      .not("subcategory_id", "is", null),
  ]);

  const kindBySub = new Map(
    (subs ?? []).map((s) => [s.id, kindByCat.get(s.category_id) ?? null]),
  );
  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));

  // Per-subcategory actuals by month (cents), for the Category by Months table.
  const actualBySub = new Map<string, number[]>();

  // planned[monthIdx][kind] and actual[monthIdx][kind], all cents.
  const emptyKinds = (): Record<CategoryKind, number> => ({
    income: 0, savings: 0, bills: 0, expenses: 0, debt: 0,
  });
  const planned = Array.from({ length: 12 }, emptyKinds);
  const actual = Array.from({ length: 12 }, emptyKinds);

  for (const p of plans ?? []) {
    const kind = kindBySub.get(p.subcategory_id);
    if (!kind) continue;
    planned[parseInt(p.month.slice(5, 7), 10) - 1][kind] += p.planned_cents;
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
    // Past & current months show what actually happened; future months show
    // the plan (the "projected" part of the year picture).
    const source = status === "future" ? planned[idx] : actual[idx];
    const net =
      source.income - OUTFLOW_KINDS.reduce((sum, k) => sum + source[k], 0);
    const hasData =
      COLUMNS.some(({ kind }) => planned[idx][kind] !== 0 || actual[idx][kind] !== 0);
    return { idx, name, values: source, net, status, hasData };
  });

  const totals = emptyKinds();
  for (const r of rows) {
    for (const { kind } of COLUMNS) totals[kind] += r.values[kind];
  }
  const totalNet = totals.income - OUTFLOW_KINDS.reduce((sum, k) => sum + totals[k], 0);
  const hasFuture = rows.some((r) => r.status === "future" && r.hasData);

  // Category by Months: each subcategory as a row (actuals only), grouped by
  // kind. Only include rows/groups that have at least one non-zero actual.
  const subIdsByKind = new Map<CategoryKind, string[]>();
  for (const s of subs ?? []) {
    const kind = kindBySub.get(s.id);
    if (!kind) continue;
    const list = subIdsByKind.get(kind) ?? [];
    list.push(s.id);
    subIdsByKind.set(kind, list);
  }

  const categoryGroups: CatMonthGroup[] = CATEGORY_KINDS.flatMap((c) => {
    const rows: CatMonthRow[] = (subIdsByKind.get(c.kind) ?? [])
      .map((subId) => {
        const months = actualBySub.get(subId) ?? Array(12).fill(0);
        const total = months.reduce((sum, v) => sum + v, 0);
        return { subId, name: nameBySub.get(subId) ?? "—", months, total };
      })
      // Any non-zero month keeps the row — checking total alone would hide a
      // row whose entries offset to zero (e.g. a charge and its refund).
      .filter((r) => r.months.some((v) => v !== 0));

    if (!rows.length) return [];

    const monthTotals = Array(12).fill(0);
    for (const r of rows) for (let i = 0; i < 12; i++) monthTotals[i] += r.months[i];
    const total = monthTotals.reduce((sum, v) => sum + v, 0);

    return [{ kind: c.kind, label: c.name, rows, monthTotals, total }];
  });

  const monthLabels = MONTH_NAMES.map((m) => m.slice(0, 3));

  // Aggregate 2026+ transactions per subcategory per year for the Annual
  // Breakdown card. Savings-kind Budget subs skip withdrawals (Victor tracks
  // "how much I paid in"); every other kind takes all rows.
  const liveDepositsBySub = new Map<string, Map<number, number>>();
  for (const t of liveTxRows ?? []) {
    if (!t.subcategory_id) continue;
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

  const budgetSubsForLive: LiveBudgetSub[] = [];
  for (const s of subs ?? []) {
    const kind = kindBySub.get(s.id);
    if (!kind) continue;
    const byYear = liveDepositsBySub.get(s.id);
    if (!byYear || byYear.size === 0) continue;
    budgetSubsForLive.push({ id: s.id, name: s.name, kind, byYear });
  }

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
    netByYear[y] = get("income") - get("bills") - get("expenses") - get("debt") - get("savings") - get("investment");
  }

  const currency = household.currency;
  const gridCols = "grid-cols-[6.5rem_repeat(6,minmax(5.5rem,1fr))]";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Annual Overview</h1>
          <p className="text-sm text-muted">
            The whole year at a glance — actuals through this month, your plan beyond it.
          </p>
        </div>

        {/* Year navigator */}
        <div className="flex items-center gap-1 rounded-xl bg-surface p-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <YearArrow year={year - 1} dir="prev" />
          <YearPicker year={year} currentYear={currentYear} />
          <YearArrow year={year + 1} dir="next" />
        </div>
      </div>

      {/* Year summary */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Income" value={totals.income} currency={currency} tone="text-positive" />
        <Stat
          label="Outflow"
          value={OUTFLOW_KINDS.reduce((sum, k) => sum + totals[k], 0)}
          currency={currency}
          tone="text-negative"
        />
        <Stat
          label="Net"
          value={totalNet}
          currency={currency}
          tone={totalNet >= 0 ? "text-positive" : "text-negative"}
        />
      </div>

      {/* Months table */}
      <MonthsTable
        columns={COLUMNS}
        rows={rows}
        totals={totals}
        totalNet={totalNet}
        hasFuture={hasFuture}
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

const KIND_ORDER: BreakdownKind["kind"][] = ["income", "bills", "expenses", "debt", "savings", "investment"];
const KIND_LABEL: Record<BreakdownKind["kind"], string> = {
  income: "Income",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
  savings: "Savings",
  investment: "Investment",
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
  byYear: Map<number, number>;
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
  const ensureFromBudgetGroup = (sheetKind: string) => {
    if (!kinds.has(sheetKind)) kinds.set(sheetKind, new Map());
    const groups = kinds.get(sheetKind)!;
    if (!groups.has(FROM_BUDGET)) {
      groups.set(FROM_BUDGET, { groupSort: fromBudgetSort, lines: new Map() });
    }
    return groups.get(FROM_BUDGET)!;
  };

  const resolveSheetKind = (sub: LiveBudgetSub): BreakdownKind["kind"] => {
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

  let unmatchedSort = 0;
  for (const sub of liveBudgetSubs) {
    const sheetKind = resolveSheetKind(sub);
    const idx = lineIndex.get(sheetKind);
    const match = idx?.get(sub.name.toLowerCase());
    if (match) {
      for (const [y, v] of sub.byYear) {
        match.byYear[y] = (match.byYear[y] ?? 0) + v;
        match.total += v;
      }
    } else {
      const group = ensureFromBudgetGroup(sheetKind);
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
    }
  }
  // ----------------------------------------------------------------------

  const result: BreakdownKind[] = [];
  for (const kind of KIND_ORDER) {
    const groups = kinds.get(kind);
    if (!groups) continue;

    const groupList = [...groups.entries()]
      .sort((a, b) => a[1].groupSort - b[1].groupSort)
      .map(([label, g]) => {
        const lines = [...g.lines.entries()]
          .sort((a, b) => a[1].lineSort - b[1].lineSort)
          .map(([lineLabel, l]) => ({ label: lineLabel, byYear: l.byYear, total: l.total }));

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

function Stat({
  label,
  value,
  currency,
  tone,
}: {
  label: string;
  value: number;
  currency: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone}`}>
        {formatMoney(value, currency)}
      </p>
    </div>
  );
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
