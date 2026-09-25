"use client";

import { useMemo, useRef } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { usePersistentCollapse } from "@/lib/use-session-collapse";
import { MoneyCell, periodHeaderClass } from "./annual-cell";
import { ClearSelectionButton } from "./clear-selection-button";
import {
  KIND_COLOR,
  categoryCellKey,
  type Selection,
  type SelectedCell,
} from "./annual-selection";

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
  /** Label of the month we're in, or null when viewing another year. */
  currentMonthLabel: string | null;
  currency: string;
  /** Cells currently driving the hero cards, across both tables. */
  selected: Selection;
  onToggleCell: (key: string, cell: SelectedCell) => void;
  onClearSelection: () => void;
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
    // 7rem, not 6.25: the totals strip sets its figures at 18px bold, where
    // "$14,322.10" measures 104px and a 100px track cannot hold it. These
    // rows already overflow their panel, so the `1fr` never gets to stretch
    // — the track sits at its minimum and anything wider paints straight
    // over the gap into the next column's number.
    gridTemplateColumns: `13rem minmax(8rem,1fr) repeat(${monthCount},minmax(7rem,1fr))`,
  };
}
// Enough width for every column at its minimum; narrower than a full year
// once the empty tail months are dropped.
function trackMinWidth(monthCount: number) {
  return { minWidth: `${14 + 8 + 7 * monthCount}rem` };
}

export function CategoryMonthsTable({
  groups,
  monthLabels,
  currentMonthLabel,
  currency,
  selected,
  onToggleCell,
  onClearSelection,
}: Props) {
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
      {/* Same columns as the groups below, widened by their 12px inset (the
          p-3 wrapper), so Total and each month sit right over the groups'
          figures. Registered with the scrollers so it follows them sideways,
          and pinned just below the hero cards so the month names stay in
          view down a long group. */}
      <div
        ref={(el) => {
          if (el) scrollersRef.current.add(el);
        }}
        className="sticky z-20 border-b border-line bg-surface"
        style={{ overflowX: "hidden", top: "var(--annual-hero-h, 0px)" }}
      >
        <button
          type="button"
          onClick={() => setCollapse({ open: !open })}
          aria-expanded={open}
          className="grid w-full items-center gap-2 py-2.5 pr-7 text-left transition hover:bg-brand-soft/25"
          style={{
            gridTemplateColumns: `calc(13rem + 12px) minmax(8rem,1fr) repeat(${monthCount},minmax(7rem,1fr))`,
            minWidth: `calc(${14 + 8 + 7 * monthCount}rem + 24px)`,
          }}
        >
          {/* Clear drops under the title: beside it, it would run into the
              Total column (this column is sized to line up, not to fit it). */}
          <span className="sticky left-0 z-10 -my-2.5 flex flex-col justify-center gap-1 self-stretch bg-surface py-2.5 pl-4">
            <span className="flex items-center gap-2.5">
              <Chevron open={open} />
              <span className="whitespace-nowrap font-semibold">Category by Months</span>
            </span>
            {selected.size > 0 ? (
              <span className="pl-[25px]">
                <ClearSelectionButton onClear={onClearSelection} />
              </span>
            ) : null}
          </span>
          {open && groups.length ? (
            <>
              <YearBand pad="-my-2.5">
                <span className="w-full text-center text-[15px] font-bold uppercase tracking-wide text-foreground">
                  Total
                </span>
              </YearBand>
              {visibleMonths(monthLabels, monthCount).map((m) => (
                <span key={m} className={periodHeaderClass(m === currentMonthLabel)}>
                  {m}
                </span>
              ))}
            </>
          ) : null}
        </button>
      </div>

      {open ? (
        groups.length ? (
          <div className="space-y-3 bg-brand-soft/10 p-3">
            {groups.map((g) => (
              <Group
                key={g.categoryId}
                group={g}
                monthCount={monthCount}
                currency={currency}
                scrollersRef={scrollersRef}
                syncScrollX={syncScrollX}
                selected={selected}
                onToggleCell={onToggleCell}
              />
            ))}
          </div>
        ) : (
          <p className="border-t border-line px-4 py-3 text-sm text-muted">
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
  monthCount,
  currency,
  scrollersRef,
  syncScrollX,
  selected,
  onToggleCell,
}: {
  group: CatMonthGroup;
  monthCount: number;
  currency: string;
  scrollersRef: React.RefObject<Set<HTMLDivElement>>;
  syncScrollX: (x: number) => void;
  selected: Selection;
  onToggleCell: (key: string, cell: SelectedCell) => void;
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

  // What the header figure answers changes with the selection: with cells
  // picked in this group it reports their sum, so a group can be read without
  // scrolling up to the hero cards. Only this group's own cells count — the
  // selection spans every group at once. Detail rows are summed alongside
  // their parent exactly as the hero does it: whatever is clicked is added.
  const picked = useMemo(() => {
    if (selected.size === 0) return null;
    let sum = 0;
    let count = 0;
    const add = (key: string) => {
      const cell = selected.get(key);
      if (cell) {
        sum += cell.amountCents;
        count += 1;
      }
    };
    for (const r of group.rows) {
      add(categoryCellKey(r.subId, null));
      r.months.forEach((_, i) => add(categoryCellKey(r.subId, i)));
      for (const d of r.details ?? []) {
        add(categoryCellKey(`${r.subId}/${d.name}`, null));
        d.months.forEach((_, i) => add(categoryCellKey(`${r.subId}/${d.name}`, i)));
      }
    }
    return count > 0 ? { sum, count } : null;
  }, [group, selected]);


  return (
    <div
      data-category-id={group.categoryId}
      className="overflow-clip rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10"
    >
      {/* The group's bar carries its totals: the year in the Year total
          column, then each month's total under that month. It scrolls with
          the table below (it's registered with the other scrollers), so the
          figures stay in their columns. */}
      <div
        ref={(el) => {
          if (el) scrollersRef.current.add(el);
        }}
        className="bg-brand-soft/40"
        style={{ overflowX: "hidden" }}
      >
        <button
          type="button"
          onClick={() => setCollapse({ open: !open })}
          aria-expanded={open}
          className="grid w-full items-center gap-2 py-2 pr-4 text-left transition hover:bg-brand-soft/30"
          style={{ ...gridStyle(monthCount), ...trackMinWidth(monthCount) }}
        >
          {/* Solid underlay so month figures scrolling beneath don't show
              through the pinned label. */}
          <span className="sticky left-0 z-10 -my-2 flex self-stretch bg-surface">
            <span className="flex min-w-0 flex-1 items-center gap-2 bg-brand-soft/40 pl-4">
              <Chevron open={open} small />
              <span className="truncate text-[13px] font-bold uppercase tracking-wide">{group.label}</span>
              {picked ? (
                <span className="whitespace-nowrap text-[12px] font-semibold text-muted">
                  {picked.count} selected
                </span>
              ) : null}
            </span>
          </span>
          <YearBand pad="-my-2">
            <span className="flex w-full flex-col items-center tabular-nums">
              <span
                className="text-[15px] font-bold"
                style={{ color: picked ? KIND_COLOR[group.kind] : "var(--foreground)" }}
              >
                {formatMoney(picked ? picked.sum : group.total, currency)}
              </span>
              {picked ? (
                <span className="text-[11px] font-semibold text-muted">
                  of {formatMoney(group.total, currency)}
                </span>
              ) : null}
            </span>
          </YearBand>
          {visibleMonths(group.monthTotals, monthCount).map((v, i) => (
            <span key={i} className="text-center text-[15px] font-bold tabular-nums">
              {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
            </span>
          ))}
        </button>
      </div>

      {open ? (
        <>
          <div
            ref={(el) => {
              if (el) scrollersRef.current.add(el);
            }}
            onScroll={(e) => {
              const x = e.currentTarget.scrollLeft;
              syncScrollX(x);
            }}
            className="scroll-handle overflow-x-auto border-t border-line"
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
                            className="flex min-w-0 items-center gap-1.5 rounded text-left text-[15px] font-medium transition hover:text-brand"
                          >
                            <Chevron open={rowOpen} small />
                            <span className="truncate">{r.name}</span>
                          </button>
                        ) : (
                          <span className={`truncate text-[15px] font-medium ${anyExpandable ? "pl-[1.4rem]" : ""}`}>
                            {r.name}
                          </span>
                        )}
                      </span>
                      <YearBand pad="-my-2">
                      <MoneyCell
                        empty={r.total === 0}
                        color={KIND_COLOR[group.kind]}
                        className={r.dormant ? "text-muted" : ""}
                        active={selected.has(categoryCellKey(r.subId, null))}
                        onToggle={() =>
                          onToggleCell(categoryCellKey(r.subId, null), {
                            kind: group.kind,
                            amountCents: r.total,
                            monthIdx: null,
                            source: "category",
                          })
                        }
                      >
                        {formatMoney(r.total, currency)}
                      </MoneyCell>
                      </YearBand>
                      {visibleMonths(r.months, monthCount).map((v, i) => {
                        // visibleMonths slices to monthCount then reverses, so
                        // the leftmost rendered column is the newest month.
                        const monthIdx = monthCount - 1 - i;
                        return (
                          <MoneyCell
                            key={monthIdx}
                            empty={v === 0}
                            color={KIND_COLOR[group.kind]}
                            active={selected.has(categoryCellKey(r.subId, monthIdx))}
                            onToggle={() =>
                              onToggleCell(categoryCellKey(r.subId, monthIdx), {
                                kind: group.kind,
                                amountCents: v,
                                monthIdx,
                                source: "category",
                              })
                            }
                          >
                            {formatMoney(v, currency)}
                          </MoneyCell>
                        );
                      })}
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
                              className="sticky left-0 z-10 truncate bg-background pl-9 text-[13px] text-muted"
                              title={d.name}
                            >
                              {d.name}
                            </span>
                            <YearBand pad="-my-1.5">
                              <MoneyCell
                                empty={d.total === 0}
                                color={KIND_COLOR[group.kind]}
                                active={selected.has(categoryCellKey(`${r.subId}/${d.name}`, null))}
                                onToggle={() =>
                                  onToggleCell(categoryCellKey(`${r.subId}/${d.name}`, null), {
                                    kind: group.kind,
                                    amountCents: d.total,
                                    monthIdx: null,
                                    source: "category",
                                  })
                                }
                              >
                                {formatMoney(d.total, currency)}
                              </MoneyCell>
                            </YearBand>
                            {visibleMonths(d.months, monthCount).map((v, i) => {
                              const monthIdx = monthCount - 1 - i;
                              return (
                                <MoneyCell
                                  key={monthIdx}
                                  empty={v === 0}
                                  color={KIND_COLOR[group.kind]}
                                  active={selected.has(categoryCellKey(`${r.subId}/${d.name}`, monthIdx))}
                                  onToggle={() =>
                                    onToggleCell(categoryCellKey(`${r.subId}/${d.name}`, monthIdx), {
                                      kind: group.kind,
                                      amountCents: v,
                                      monthIdx,
                                      source: "category",
                                    })
                                  }
                                >
                                  {formatMoney(v, currency)}
                                </MoneyCell>
                              );
                            })}
                          </div>
                        ))
                      : null}
                  </li>
                  );
                })}
              </ul>

            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The Total column is the whole year, not another month. A grey band running
 * the full height of every row, with a rule on its right, sets it apart from
 * the month columns. `pad` cancels the row's own vertical padding so the band
 * meets the band in the row above instead of breaking into stripes.
 */
export function YearBand({ pad, children }: { pad: "-my-2" | "-my-2.5" | "-my-1.5"; children: React.ReactNode }) {
  return (
    <span
      className={`${pad} flex items-center justify-center self-stretch border-r-2 border-line bg-black/[0.035] px-1 dark:bg-white/[0.05]`}
    >
      {children}
    </span>
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
