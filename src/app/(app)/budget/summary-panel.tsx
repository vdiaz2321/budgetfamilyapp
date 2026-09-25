"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import type { GroupData, ViewMode } from "./types";

// Each arc takes its group's own category color — the same --viz-* token as
// the row dot and hero bar (see DOT in category-icons.tsx) — so Expenses is
// sky in the donut AND on its row. Assigning by position used to hand out
// amber and swap Bills/Debt colors. A second group of the same kind (a custom
// "+ Cat Group") falls through to these extra cool tones so arcs stay apart.
const KIND_COLOR: Partial<Record<CategoryKind, string>> = {
  savings: "var(--viz-savings)",
  bills: "var(--viz-bills)",
  expenses: "var(--viz-expenses)",
  debt: "var(--viz-debt)",
};
const EXTRA = ["var(--viz-soft)", "var(--chart-5)", "var(--viz-income)", "var(--cat-lime)"];

type Props = {
  groups: GroupData[];
  currency: string;
};

export function SummaryPanel({ groups, currency }: Props) {
  // The donut has its own Spent/Remaining view now that the budget rows show
  // both columns at once.
  const [mode, setMode] = useState<ViewMode>("remaining");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("budget-summary-mode") as ViewMode | null;
    // Browser-only preference hydration; the initial state is SSR-safe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "spent" || saved === "remaining" || saved === "ytd") setMode(saved);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) sessionStorage.setItem("budget-summary-mode", mode);
  }, [mode, hydrated]);
  // The donut mirrors EveryDollar: outflow only (income has its own line up
  // top). Each segment's size uses the current shared mode value.
  const outflow = groups.filter((g) => g.kind !== "income");

  // Donut geometry — deliberately identical to the Insights page's Total
  // outflow donut (see Donut in insights-charts.tsx): same radius, same thick
  // ring, butt caps and a hairline gap, so the two pages read as one chart
  // shown twice rather than two different charts.
  const R = 54; // radius of the inner circle (center of stroke)
  const STROKE = 15; // stroke width of the ring
  const C = 2 * Math.PI * R;

  const usedKinds = new Set<CategoryKind>();
  let extraIdx = 0;
  const colors = outflow.map((g) => {
    const own = KIND_COLOR[g.kind];
    if (own && !usedKinds.has(g.kind)) {
      usedKinds.add(g.kind);
      return own;
    }
    return EXTRA[extraIdx++ % EXTRA.length];
  });

  // Year to date per group comes off the rows, which carry the same
  // v_monthly_actuals figure the board's Total Yr column and the Annual
  // Overview both read.
  const ytdTotalOf = (g: GroupData) => g.rows.reduce((sum, r) => sum + (r.ytdSpentCents ?? 0), 0);
  const base = outflow.map((g, i) => {
    const value = mode === "spent" ? g.spentTotal : mode === "ytd" ? ytdTotalOf(g) : g.plannedTotal;
    return {
      categoryId: g.categoryId,
      name: g.name,
      color: colors[i],
      // Negative "remaining" (overspent) can't size an arc — clamp to 0 for the
      // ring, but keep the true value for the legend.
      arcValue: Math.max(0, value),
      value,
    };
  });

  const total = base.reduce((sum, s) => sum + s.arcValue, 0);
  const modeLabel = mode === "spent" ? "Spent" : mode === "ytd" ? "Total Yr" : "Planned";
  // "Total Total Yr" — the donut's centre prefixes "Total", so the year view
  // supplies its own wording.
  const centerTotalLabel = mode === "ytd" ? "Year to date" : `Total ${modeLabel}`;

  // Precompute each arc's dash length + offset via prefix sums so the render
  // body never mutates a running accumulator (React-compiler-safe).
  const lens = base.map((s) => (total > 0 ? (s.arcValue / total) * C : 0));
  // Hairline gap between segments so neighbours never blend — the same 2
  // units the Insights donut shaves off each arc.
  const visibleCount = lens.filter((l) => l > 0).length;
  const GAP = visibleCount > 1 ? 2 : 0;
  const segments = base.map((s, i) => ({
    ...s,
    len: Math.max(0.1, lens[i] - GAP),
    // Offset = negative sum of all preceding arc lengths.
    arcOffset: -lens.slice(0, i).reduce((sum, l) => sum + l, 0),
  }));

  const [active, setActive] = useState<string | null>(null);
  const activeSeg = segments.find((s) => s.categoryId === active) ?? null;

  // Clicking a legend row expands it to show that category's line items, valued
  // by the current mode (spent vs remaining). Non-zero items only.
  const [expanded, setExpanded] = useState<string | null>(null);
  const subRowsFor = (categoryId: string) => {
    const group = groups.find((g) => g.categoryId === categoryId);
    return (group?.rows ?? [])
      .map((r) => ({
        subId: r.subId,
        name: r.name,
        value: mode === "spent" ? r.spentCents : mode === "ytd" ? (r.ytdSpentCents ?? 0) : r.plannedCents,
        isKids: r.isKids ?? false,
      }))
      .filter((r) => r.value !== 0)
      .sort((a, b) => b.value - a.value);
  };

  const sectionedFor = (categoryId: string) => {
    const rows = subRowsFor(categoryId);
    const group = groups.find((g) => g.categoryId === categoryId);
    if (group?.kind !== "savings") return null;
    const kids = rows.filter((r) => r.isKids);
    const mine = rows.filter((r) => !r.isKids);
    if (kids.length === 0 || mine.length === 0) return null;
    const totalOf = (rs: typeof rows) => rs.reduce((s, r) => s + r.value, 0);
    return [
      { label: "My Savings/Investments", rows: mine, subtotal: totalOf(mine) },
      { label: "Kids Funding", rows: kids, subtotal: totalOf(kids) },
    ];
  };

  // Line-item percentages use the SAME denominator as the category rows above
  // them — the donut total — so one column means one thing everywhere and a
  // group's children visibly add up to the group's own share. A tiny non-zero
  // item reads "<1%" rather than a dead "0%".
  const pctLabel = (value: number, total: number) => {
    if (total <= 0) return "0%";
    const exact = (value / total) * 100;
    const rounded = Math.round(exact);
    if (rounded === 0 && exact > 0) return "<1%";
    return `${rounded}%`;
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-bold">Summary</h2>
        {/* Three views now, so this is a real select rather than a two-way
            toggle: the year one answers "how much has this category taken all
            year" without a trip to the Annual Overview. */}
        <div className="relative flex items-center">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ViewMode)}
            aria-label="What the summary charts"
            // Fixed width, sized to the longest option: an auto-width select
            // re-measures itself on every choice, which slid the whole control
            // left and right as the label changed length.
            className="w-40 cursor-pointer appearance-none truncate rounded-md bg-transparent py-0.5 pl-1.5 pr-5 text-xs text-muted transition hover:bg-black/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:hover:bg-white/10"
          >
            <option value="remaining">Planned by category</option>
            <option value="spent">Spent by category</option>
            <option value="ytd">Total Yr by category</option>
          </select>
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            className="pointer-events-none absolute right-1 text-muted"
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {total <= 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-muted">
            Nothing to chart yet.
            <br />
            {mode === "spent"
              ? "Log some transactions to see the breakdown."
              : mode === "ytd"
                ? "Nothing has been spent this year yet."
                : "Plan some categories to see the breakdown."}
          </p>
        </div>
      ) : (
        <>
          {/* Donut */}
          <div className="flex justify-center px-4 pt-5">
            <div className="relative mx-auto aspect-square w-full max-w-[190px]">
              <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
                <circle cx="64" cy="64" r={R} fill="none" stroke="var(--viz-grid)" strokeWidth={STROKE} />
                {segments.map((s) => {
                  if (s.arcValue <= 0) return null;
                  const dim = active != null && active !== s.categoryId;
                  return (
                    <circle
                      key={s.categoryId}
                      cx="64"
                      cy="64"
                      r={R}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={active === s.categoryId ? STROKE + 4 : STROKE}
                      strokeDasharray={`${s.len} ${C - s.len}`}
                      strokeDashoffset={s.arcOffset}
                      className="cursor-pointer transition-[stroke-width,opacity]"
                      style={{ opacity: dim ? 0.35 : 1 }}
                      // A slice opens its own category in the legend below and
                      // closes it again — the arc already looked clickable
                      // (cursor-pointer) but only ever highlighted itself.
                      onClick={() =>
                        setExpanded((id) => (id === s.categoryId ? null : s.categoryId))
                      }
                      onMouseEnter={() => setActive(s.categoryId)}
                      onMouseLeave={() => setActive(null)}
                    />
                  );
                })}
              </svg>
              {/* Center label */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="max-w-[110px] truncate text-[10px] font-medium uppercase tracking-wide text-muted">
                  {activeSeg ? activeSeg.name : centerTotalLabel}
                </span>
                <span className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
                  {formatMoney(activeSeg ? activeSeg.value : total, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Legend — sorted by share (highest % → lowest) for whichever mode
              is active (Planned or Spent). The donut order above is left alone;
              only this list reorders. */}
          <ul className="divide-y divide-line px-2 py-3">
            {[...segments].sort((a, b) => b.arcValue - a.arcValue).map((s) => {
              const pct = total > 0 ? Math.round((s.arcValue / total) * 100) : 0;
              const isOpen = expanded === s.categoryId;
              const subRows = isOpen ? subRowsFor(s.categoryId) : [];
              return (
                <li key={s.categoryId}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((id) => (id === s.categoryId ? null : s.categoryId))
                    }
                    onMouseEnter={() => setActive(s.categoryId)}
                    onMouseLeave={() => setActive(null)}
                    aria-expanded={isOpen}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                      active === s.categoryId ? "bg-brand-soft/40" : "hover:bg-brand-soft/25"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                    <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">
                      {formatMoney(s.value, currency)}
                    </span>
                    <span
                      className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums"
                      style={{ color: s.color }}
                    >
                      {pct}%
                    </span>
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                      className={`shrink-0 text-muted transition-transform ${isOpen ? "" : "-rotate-90"}`}
                      aria-hidden
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {isOpen ? (() => {
                    const sections = sectionedFor(s.categoryId);
                    if (sections) {
                      return (
                        <div className="mb-1 ml-5 border-l border-line pl-3 pr-2">
                          {sections.map((sec) => (
                            <div key={sec.label} className="mb-1">
                              {/* Section header for the Kids / Mine split, in
                                  the category's own donut colour (never the
                                  indigo brand, which is chrome, not data) and
                                  at the size of the rows it sums. */}
                              <div
                                className="mt-1 flex items-center gap-2 rounded px-1 py-0.5"
                                style={{ backgroundColor: `color-mix(in oklab, ${s.color} 14%, transparent)` }}
                              >
                                <span
                                  className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wide"
                                  style={{ color: s.color }}
                                >
                                  {sec.label}
                                </span>
                                <span className="w-24 shrink-0 text-right text-xs font-bold tabular-nums" style={{ color: s.color }}>
                                  {formatMoney(sec.subtotal, currency)}
                                </span>
                                {/* Keeps the subtotal in the same column as the
                                    item amounts below it, which are followed by
                                    a % and the chevron's placeholder. */}
                                <span className="w-9 shrink-0" aria-hidden />
                                <span className="w-3 shrink-0" aria-hidden />
                              </div>
                              <ul className="divide-y divide-line">
                                {sec.rows.map((r) => (
                                  <li key={r.subId} className="flex items-center gap-2.5 py-1">
                                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{r.name}</span>
                                    <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">{formatMoney(r.value, currency)}</span>
                                    <span
                                      className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums"
                                      style={{ color: s.color }}
                                    >
                                      {pctLabel(r.value, total)}
                                    </span>
                                    {/* Stands in for the category row's chevron so the
                                        percent columns line up down the panel. */}
                                    <span className="w-3 shrink-0" aria-hidden />
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    return (
                      <ul className="mb-1 ml-5 divide-y divide-line border-l border-line pl-3 pr-2">
                        {subRows.length === 0 ? (
                          <li className="py-1 text-xs text-muted">
                            {mode === "spent"
                              ? "Nothing spent here yet."
                              : mode === "ytd"
                                ? "Nothing spent here this year."
                                : "Nothing remaining here."}
                          </li>
                        ) : (
                          subRows.map((r) => (
                            <li key={r.subId} className="flex items-center gap-2.5 py-1">
                              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{r.name}</span>
                              <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">{formatMoney(r.value, currency)}</span>
                              <span
                                className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums"
                                style={{ color: s.color }}
                              >
                                {pctLabel(r.value, total)}
                              </span>
                              {/* Stands in for the category row's chevron so the
                                  percent columns line up down the panel. */}
                              <span className="w-3 shrink-0" aria-hidden />
                            </li>
                          ))
                        )}
                      </ul>
                    );
                  })() : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
