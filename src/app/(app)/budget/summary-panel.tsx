"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { GroupData, ViewMode } from "./types";

// Distinct arc colors, assigned to outflow groups in order. Chosen to read
// well on both light and dark surfaces (used as raw SVG stroke / CSS values).
const PALETTE = [
  "#6366f1", // indigo
  "#ef4444", // red
  "#f59e0b", // amber
  "#22c55e", // green
  "#0ea5e9", // sky
  "#a855f7", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#84cc16", // lime
];

type Props = {
  groups: GroupData[];
  currency: string;
};

export function SummaryPanel({ groups, currency }: Props) {
  // The donut has its own Spent/Remaining view now that the budget rows show
  // both columns at once.
  const [mode, setMode] = useState<ViewMode>("spent");
  // The donut mirrors EveryDollar: outflow only (income has its own line up
  // top). Each segment's size uses the current shared mode value.
  const outflow = groups.filter((g) => g.kind !== "income");

  // Donut geometry.
  const R = 60; // radius of the inner circle (center of stroke)
  const STROKE = 18; // stroke width of the ring
  const C = 2 * Math.PI * R;

  const base = outflow.map((g, i) => {
    const value = mode === "spent" ? g.spentTotal : g.plannedTotal - g.spentTotal;
    return {
      categoryId: g.categoryId,
      name: g.name,
      color: PALETTE[i % PALETTE.length],
      // Negative "remaining" (overspent) can't size an arc — clamp to 0 for the
      // ring, but keep the true value for the legend.
      arcValue: Math.max(0, value),
      value,
    };
  });

  const total = base.reduce((sum, s) => sum + s.arcValue, 0);
  const modeLabel = mode === "spent" ? "Spent" : "Remaining";

  // Precompute each arc's dash length + offset via prefix sums so the render
  // body never mutates a running accumulator (React-compiler-safe).
  const lens = base.map((s) => (total > 0 ? (s.arcValue / total) * C : 0));
  // Breathing room between segments (YNAB-style): shave a small gap off the
  // end of each visible arc — only when there's more than one to separate.
  const visibleCount = lens.filter((l) => l > 0).length;
  const GAP = visibleCount > 1 ? 3 : 0;
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
        value: mode === "spent" ? r.spentCents : r.plannedCents - r.spentCents,
      }))
      .filter((r) => r.value !== 0)
      .sort((a, b) => b.value - a.value);
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-bold">Summary</h2>
        <button
          type="button"
          onClick={() => setMode((m) => (m === "spent" ? "remaining" : "spent"))}
          title="Switch Spent / Remaining"
          className="flex items-center gap-0.5 text-xs text-muted hover:text-foreground"
        >
          {modeLabel} by category
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {total <= 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-muted">
            Nothing to chart yet.
            <br />
            {mode === "spent"
              ? "Log some transactions to see the breakdown."
              : "Plan some categories to see the breakdown."}
          </p>
        </div>
      ) : (
        <>
          {/* Donut */}
          <div className="flex justify-center px-4 pt-5">
            <div className="relative h-[150px] w-[150px]">
              <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
                <circle
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  strokeWidth={STROKE}
                  className="stroke-line/60"
                />
                {segments.map((s) => {
                  if (s.arcValue <= 0) return null;
                  const dim = active != null && active !== s.categoryId;
                  return (
                    <circle
                      key={s.categoryId}
                      cx="70"
                      cy="70"
                      r={R}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={active === s.categoryId ? STROKE + 4 : STROKE}
                      strokeDasharray={`${s.len} ${C - s.len}`}
                      strokeDashoffset={s.arcOffset}
                      className="cursor-pointer transition-[stroke-width,opacity]"
                      style={{ opacity: dim ? 0.35 : 1 }}
                      onMouseEnter={() => setActive(s.categoryId)}
                      onMouseLeave={() => setActive(null)}
                    />
                  );
                })}
              </svg>
              {/* Center label */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="max-w-[90px] truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {activeSeg ? activeSeg.name : "Total"}
                </span>
                <span className="text-base font-bold tabular-nums">
                  {formatMoney(activeSeg ? activeSeg.value : total, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <ul className="divide-y divide-line px-2 py-3">
            {segments.map((s) => {
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
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatMoney(s.value, currency)}
                    </span>
                    <span className="w-9 shrink-0 text-right text-xs text-muted tabular-nums">
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

                  {isOpen ? (
                    <ul className="mb-1 ml-5 border-l border-line pl-3">
                      {subRows.length === 0 ? (
                        <li className="py-1 text-xs text-muted">
                          {mode === "spent" ? "Nothing spent here yet." : "Nothing remaining here."}
                        </li>
                      ) : (
                        subRows.map((r) => (
                          <li
                            key={r.subId}
                            className="flex items-center gap-2 py-1"
                          >
                            <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.name}</span>
                            <span className="shrink-0 text-xs tabular-nums">
                              {formatMoney(r.value, currency)}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
