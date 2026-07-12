import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { formatMoney } from "@/lib/money";

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

  const [{ data: subs }, { data: plans }, { data: actuals }] = await Promise.all([
    supabase
      .from("subcategories")
      .select("id, category_id")
      .eq("household_id", household.id),
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
  ]);

  const kindBySub = new Map(
    (subs ?? []).map((s) => [s.id, kindByCat.get(s.category_id) ?? null]),
  );

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
    actual[parseInt(a.month.slice(5, 7), 10) - 1][kind] += a.actual_cents;
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
          <span className="min-w-[3.5rem] text-center text-sm font-bold">{year}</span>
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
          tone="text-foreground"
        />
        <Stat
          label="Net"
          value={totalNet}
          currency={currency}
          tone={totalNet >= 0 ? "text-positive" : "text-negative"}
        />
      </div>

      {/* Months table */}
      <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <div className="overflow-x-auto">
          <div className="min-w-[42rem]">
            {/* Header */}
            <div className={`grid ${gridCols} items-center gap-2 border-b border-line px-4 py-2.5`}>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Month</span>
              {COLUMNS.map((c) => (
                <span key={c.kind} className="text-right text-[11px] font-medium uppercase tracking-wide text-muted">
                  {c.label}
                </span>
              ))}
              <span className="text-right text-[11px] font-medium uppercase tracking-wide text-muted">Net</span>
            </div>

            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li
                  key={r.idx}
                  className={`grid ${gridCols} items-center gap-2 px-4 py-2 ${
                    r.status === "current" ? "bg-brand-soft/40" : ""
                  } ${r.status === "future" ? "text-muted" : ""}`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {r.name.slice(0, 3)}
                    {r.status === "current" ? (
                      <span className="rounded bg-brand px-1 py-0.5 text-[9px] font-bold uppercase text-white">
                        Now
                      </span>
                    ) : null}
                  </span>
                  {COLUMNS.map((c) => (
                    <span key={c.kind} className="text-right text-sm tabular-nums">
                      {r.hasData || r.values[c.kind] !== 0
                        ? formatMoney(r.values[c.kind], currency)
                        : "—"}
                    </span>
                  ))}
                  <span
                    className={`text-right text-sm font-semibold tabular-nums ${
                      !r.hasData ? "" : r.net >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {r.hasData ? formatMoney(r.net, currency) : "—"}
                  </span>
                </li>
              ))}
            </ul>

            {/* Totals */}
            <div className={`grid ${gridCols} items-center gap-2 border-t border-line px-4 py-2.5`}>
              <span className="text-sm font-bold">Total</span>
              {COLUMNS.map((c) => (
                <span key={c.kind} className="text-right text-sm font-bold tabular-nums">
                  {formatMoney(totals[c.kind], currency)}
                </span>
              ))}
              <span
                className={`text-right text-sm font-bold tabular-nums ${
                  totalNet >= 0 ? "text-positive" : "text-negative"
                }`}
              >
                {formatMoney(totalNet, currency)}
              </span>
            </div>
          </div>
        </div>
        {hasFuture ? (
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            Grayed months haven&apos;t happened yet — their numbers are your plan (projected),
            and they update automatically as you budget those months.
          </p>
        ) : null}
      </section>
    </div>
  );
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
