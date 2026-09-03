"use client";

import { useRef } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { usePersistentCollapse } from "@/lib/use-session-collapse";

/** One payee's share of a row, same 12-month shape as the row itself. */
export type CatMonthDetail = {
  name: string;
  months: number[];
  total: number;
};

export type CatMonthRow = {
  subId: string;
  name: string;
  months: number[]; // 12 entries, cents
  total: number;
  /** Who the row's money actually went to. Only the roll-up lines
   *  (Subscriptions, Irregular Bills) carry this — every other row is a
   *  single thing and stays chevron-free. Absent too for pre-2026 years,
   *  which have no transactions behind them. */
  details?: CatMonthDetail[];
  /** Nothing logged this year: listed last, and greyed. */
  dormant?: boolean;
};

export type CatMonthGroup = {
  categoryId: string;
  kind: CategoryKind;
  label: string;
  rows: CatMonthRow[];
  monthTotals: number[]; // 12 entries, cents
  total: number;
};

type Props = {
  groups: CatMonthGroup[];
  monthLabels: string[]; // 12 short labels (Jan…Dec)
  currency: string;
};

// Months run newest-first, left to right: the panel is half a screen wide, so
// the columns that land in view without scrolling should be the recent ones.
// A year in progress also stops at its last month with figures — leading with
// three empty columns would defeat the point.
function visibleMonths<T>(values: T[], count: number) {
  return values.slice(0, count).reverse();
}

// subcategory label + Total + one column per visible month. Columns are sized
// to the figures they hold, matching the Annual Breakdown panel beside this
// one, so neither table strands its numbers in white space.
function gridStyle(monthCount: number) {
  return {
    gridTemplateColumns: `11rem minmax(7rem,1fr) repeat(${monthCount},minmax(6.25rem,1fr))`,
  };
}
// Enough width for every column at its minimum; narrower than a full year
// once the empty tail months are dropped.
function trackMinWidth(monthCount: number) {
  return { minWidth: `${12 + 7 + 6.25 * monthCount}rem` };
}

export function CategoryMonthsTable({ groups, monthLabels, currency }: Props) {
  // Open by default, and persistent: this panel is the year read line by
  // line, so it should be found as it was left rather than collapsed on
  // every fresh login.
  const [collapse, setCollapse] = usePersistentCollapse("annual-category-months", () => ({ open: true }));
  const open = collapse.open;
  // The last month anything was logged in, across every group — the table
  // stops there rather than running out to December with nothing in it.
  const lastActive = groups.reduce(
    (last, g) => Math.max(last, g.monthTotals.reduce((acc, v, i) => (v !== 0 ? i : acc), -1)),
    -1,
  );
  const monthCount = lastActive >= 0 ? lastActive + 1 : monthLabels.length;
  const scrollersRef = useRef<Set<HTMLDivElement>>(new Set());

  function syncScrollX(scrollLeft: number) {
    scrollersRef.current.forEach((el) => {
      if (el.scrollLeft !== scrollLeft) el.scrollLeft = scrollLeft;
    });
  }

  return (
    <section className="overflow-clip rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setCollapse({ open: !open })}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-brand-soft/25"
      >
        <Chevron open={open} />
        <span className="font-semibold">Category by Months</span>
      </button>

      {open ? (
        groups.length ? (
          <div className="space-y-3 border-t border-line bg-brand-soft/10 p-3">
            {groups.map((g) => (
              <Group
                key={g.categoryId}
                group={g}
                monthLabels={visibleMonths(monthLabels, monthCount)}
                monthCount={monthCount}
                currency={currency}
                scrollersRef={scrollersRef}
                syncScrollX={syncScrollX}
              />
            ))}
          </div>
        ) : (
          <p className="border-t border-line px-4 py-3 text-lg text-muted">
            No actuals recorded yet this year. Line items appear here once they have logged
            transactions.
          </p>
        )
      ) : null}
    </section>
  );
}

function Group({
  group,
  monthLabels,
  monthCount,
  currency,
  scrollersRef,
  syncScrollX,
}: {
  group: CatMonthGroup;
  monthLabels: string[];
  monthCount: number;
  currency: string;
  scrollersRef: React.RefObject<Set<HTMLDivElement>>;
  syncScrollX: (x: number) => void;
}) {
  const [collapse, setCollapse] = usePersistentCollapse(`annual-category-${group.categoryId}`, () => ({ open: false }));
  const open = collapse.open;
  // Which rows are showing their payee split. Per-session like every other
  // collapse on the page, so coming back to the year finds it as it was left.
  const [openRows, setOpenRows] = usePersistentCollapse(
    `annual-category-rows-${group.categoryId}`,
    () => ({}),
  );
  const toggleRow = (subId: string) =>
    setOpenRows((current) => ({ ...current, [subId]: !(current[subId] ?? false) }));
  // Only indent the plain rows when something in this group actually has a
  // chevron to line them up with.
  const anyExpandable = group.rows.some((r) => (r.details?.length ?? 0) > 0);
  const headerRef = useRef<HTMLDivElement>(null);

  function syncHeader(scrollLeft: number) {
    if (headerRef.current) headerRef.current.scrollLeft = scrollLeft;
  }

  return (
    <div
      data-category-id={group.categoryId}
      className="overflow-clip rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10"
    >
      <button
        type="button"
        onClick={() => setCollapse({ open: !open })}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-brand-soft/40 px-4 py-2 text-left transition hover:bg-brand-soft/60"
      >
        <Chevron open={open} small />
        <span className="text-[18px] font-bold uppercase tracking-wide">{group.label}</span>
        <span className="ml-auto text-[21px] tabular-nums text-muted">
          {formatMoney(group.total, currency)}
        </span>
      </button>

      {open ? (
        <>
          <div
            ref={headerRef}
            className="sticky top-0 z-20 border-y border-line bg-surface"
            style={{ overflowX: "hidden" }}
          >
            <div style={trackMinWidth(monthCount)}>
              <div className="grid items-center gap-2 pr-4 py-2" style={gridStyle(monthCount)}>
                <span className="sticky left-0 z-10 bg-surface pl-4 text-[16px] font-medium uppercase tracking-wide text-muted whitespace-nowrap">
                  Annual Cat by Mos
                </span>
                <span className="text-center text-[18px] font-bold uppercase tracking-wide text-foreground">
                  Total
                </span>
                {monthLabels.map((m) => (
                  <span
                    key={m}
                    className="text-center text-[18px] font-medium uppercase tracking-wide text-muted"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div
            ref={(el) => {
              if (el) scrollersRef.current.add(el);
            }}
            onScroll={(e) => {
              const x = e.currentTarget.scrollLeft;
              syncHeader(x);
              syncScrollX(x);
            }}
            className="scroll-handle overflow-x-auto"
          >
            <div style={trackMinWidth(monthCount)}>
              <ul className="divide-y divide-line">
                {group.rows.map((r) => {
                  const expandable = (r.details?.length ?? 0) > 0;
                  const rowOpen = expandable && openRows[r.subId] === true;
                  return (
                  <li key={r.subId}>
                    <div className="grid items-center gap-2 pr-4 py-2" style={gridStyle(monthCount)}>
                      <span className={`sticky left-0 z-10 flex min-w-0 items-center bg-surface pl-4 ${r.dormant ? "text-muted" : ""}`}>
                        {expandable ? (
                          <button
                            type="button"
                            onClick={() => toggleRow(r.subId)}
                            aria-expanded={rowOpen}
                            className="flex min-w-0 items-center gap-1.5 rounded text-left text-[21px] font-medium transition hover:text-brand"
                          >
                            <Chevron open={rowOpen} small />
                            <span className="truncate">{r.name}</span>
                          </button>
                        ) : (
                          <span className={`truncate text-[21px] font-medium ${anyExpandable ? "pl-[1.4rem]" : ""}`}>
                            {r.name}
                          </span>
                        )}
                      </span>
                      <span className={`text-center text-[18px] tabular-nums ${r.dormant ? "text-muted" : ""}`}>
                        {r.total !== 0 ? formatMoney(r.total, currency) : <span className="text-muted">—</span>}
                      </span>
                      {visibleMonths(r.months, monthCount).map((v, i) => (
                        <span key={i} className="text-center text-[18px] tabular-nums">
                          {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
                        </span>
                      ))}
                    </div>

                    {rowOpen
                      ? r.details?.map((d) => (
                          <div
                            key={d.name}
                            // `bg-background`, not a translucent tint: the
                            // name cell below is sticky and has to stay opaque
                            // as the months scroll under it, so the stripe and
                            // that cell must be the same solid colour.
                            className="grid items-center gap-2 border-t border-line/60 bg-background pr-4 py-1.5"
                            style={gridStyle(monthCount)}
                          >
                            <span
                              className="sticky left-0 z-10 truncate bg-background pl-9 text-[18px] text-muted"
                              title={d.name}
                            >
                              {d.name}
                            </span>
                            <span className="text-center text-[18px] font-medium tabular-nums text-muted">
                              {formatMoney(d.total, currency)}
                            </span>
                            {visibleMonths(d.months, monthCount).map((v, i) => (
                              <span key={i} className="text-center text-[18px] tabular-nums text-muted">
                                {v !== 0 ? formatMoney(v, currency) : "—"}
                              </span>
                            ))}
                          </div>
                        ))
                      : null}
                  </li>
                  );
                })}
              </ul>

              {/* Subtotal */}
              <div
                className="grid items-center gap-2 border-t border-line pr-4 py-2"
                style={gridStyle(monthCount)}
              >
                <span className="sticky left-0 z-10 bg-surface pl-4 text-[21px] font-bold">Total</span>
                <span className="text-center text-[18px] font-bold tabular-nums">
                  {formatMoney(group.total, currency)}
                </span>
                {visibleMonths(group.monthTotals, monthCount).map((v, i) => (
                  <span key={i} className="text-center text-[18px] font-bold tabular-nums">
                    {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Chevron({ open, small }: { open: boolean; small?: boolean }) {
  const size = small ? 13 : 15;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
