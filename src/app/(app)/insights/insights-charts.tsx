"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { ChartBucket, OutflowKind } from "./types";

// Insights' own chart palette — the softer set from the Insights dashboard
// design (2026-11-06): light navy-blue income, muted red spending, and lifted
// flow colors, so the bars and ring read calm rather than heavy. Each is used
// for both themes. Every slice also carries a text label + percentage, so
// color is never the only cue.
export const INCOME_BAR = "#8fb0f0";
export const SPENDING_BAR = "#e08a92";

export const KIND_COLOR: Record<OutflowKind, string> = {
  savings: "#5b9bd5",
  // The Annual Overview's Kids Funding colour.
  kids: "var(--foreground)",
  bills: "#4fb8ab",
  expenses: "#7cc7ef",
  debt: "#e07c7c",
  uncategorized: "#7cc7ef",
};

export const KIND_LABEL: Record<OutflowKind, string> = {
  savings: "Savings",
  kids: "Kids funding",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
  uncategorized: "Uncategorized",
};

// Compact axis money: $0 / $5k / $15k — keeps the gutter narrow.
function axisMoney(cents: number, currency: string): string {
  const dollars = cents / 100;
  if (dollars >= 1000) {
    const k = dollars / 1000;
    return `${formatMoney(0, currency).replace(/[\d.,]/g, "")}${
      k >= 100 || Number.isInteger(k) ? Math.round(k) : k.toFixed(1)
    }k`;
  }
  return formatMoney(Math.round(dollars) * 100, currency).replace(/\.00$/, "");
}

// A round top for the y axis and the step between its gridlines: 1, 2, 2.5
// or 5 × a power of ten, so the ticks read $0 / $5k / $10k / $15k rather
// than $0 / $7.2k / $14.3k.
function niceScale(max: number, ticks = 3): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 1 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return { top: Math.ceil(max / step) * step, step };
}

// ---- Trend: grouped income-vs-spending bars, one group per period ----
// Plain HTML/CSS bars: rounded tops, a real gap between the pair, correct
// theming, gridlines behind, and a per-group hover tooltip.
// How a bar click changes the selection: that bar alone, add/remove it
// (Ctrl/⌘-click), or everything from the first pick to it (Shift-click).
export type SelectMode = "single" | "toggle" | "range";

export function TrendChart({
  buckets,
  currency,
  onSelect,
}: {
  buckets: ChartBucket[];
  currency: string;
  onSelect?: (key: string, mode: SelectMode) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.flatMap((b) => [b.income, b.spending]));
  const { top, step } = niceScale(max);
  const pct = (v: number) => (v <= 0 ? 0 : Math.max(1.5, (v / top) * 100));
  const gridlines = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => top - i * step);

  return (
    <div>
      <div className="mb-3 flex items-center gap-5 text-xs font-medium">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INCOME_BAR }} />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SPENDING_BAR }} />
          Bills &amp; Expenses
        </span>
      </div>

      <div className="flex">
        {/* Y axis */}
        <div className="relative mr-2 h-52 w-10 shrink-0 sm:h-60 sm:w-12">
          {gridlines.map((g) => (
            <span
              key={g}
              className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-muted"
              style={{ top: `${(1 - g / top) * 100}%` }}
            >
              {axisMoney(g, currency)}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div className="relative min-w-0 flex-1">
          {/* Gridlines behind the bars */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-52 sm:h-60">
            {gridlines.map((g) => (
              <span
                key={g}
                className="absolute inset-x-0 border-t"
                style={{ top: `${(1 - g / top) * 100}%`, borderColor: "var(--viz-grid)" }}
              />
            ))}
          </div>

          <div className="relative flex h-52 items-end gap-1 sm:h-60 sm:gap-2">
            {buckets.map((b, i) => (
              <button
                type="button"
                key={b.key}
                onClick={(e) =>
                  onSelect?.(b.key, e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "single")
                }
                // On a Mac, Ctrl-click opens the context menu instead of
                // firing a click — treat it as the same add/remove pick.
                onContextMenu={(e) => {
                  if (!e.ctrlKey) return;
                  e.preventDefault();
                  onSelect?.(b.key, "toggle");
                }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                className={`group relative flex h-full flex-1 cursor-pointer flex-col justify-end rounded-lg transition ${
                  b.selected ? "bg-sky-50 dark:bg-sky-950/40" : "hover:bg-sky-50/60 dark:hover:bg-sky-950/20"
                }`}
              >
                <div className="flex h-full items-end justify-center gap-[3px] px-0.5">
                  <div
                    className="w-[44%] max-w-[28px] rounded-t-[4px] transition-[height]"
                    style={{ height: `${pct(b.income)}%`, backgroundColor: INCOME_BAR }}
                  />
                  <div
                    className="w-[44%] max-w-[28px] rounded-t-[4px] transition-[height]"
                    style={{ height: `${pct(b.spending)}%`, backgroundColor: SPENDING_BAR }}
                  />
                </div>

                {hover === i ? (
                  <div
                    className={`pointer-events-none absolute bottom-full z-20 mb-2 w-max min-w-[10rem] rounded-lg bg-surface px-3 py-2 text-left text-xs text-foreground shadow-xl ring-1 ring-black/10 dark:ring-white/15 ${
                      // Keep the tooltip inside the card at either end.
                      i < 2 ? "left-0" : i > buckets.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                    }`}
                  >
                    <p className="font-semibold">{b.label}</p>
                    <TooltipRow color={INCOME_BAR} label="Income" amount={b.income} currency={currency} />
                    <TooltipRow color={SPENDING_BAR} label="Bills & Expenses" amount={b.spending} currency={currency} />
                    <TooltipRow color={KIND_COLOR.savings} label="Savings" amount={b.savings} currency={currency} />
                    <TooltipRow color={KIND_COLOR.debt} label="Debt paid" amount={b.debt} currency={currency} />
                    {b.kids ? <TooltipRow color={KIND_COLOR.kids} label="Kids funding" amount={b.kids} currency={currency} /> : null}
                    <div className="mt-1 flex items-center justify-between gap-4 border-t border-line pt-1 font-semibold">
                      <span>Net</span>
                      <span className="tabular-nums">
                        {formatMoney(
                          b.income - b.spending - b.savings - b.debt - b.kids,
                          currency,
                        )}
                      </span>
                    </div>
                  </div>
                ) : null}
              </button>
            ))}
          </div>

          {/* X axis labels — the selected period is bold and underlined */}
          <div className="mt-2 flex gap-1 sm:gap-2">
            {buckets.map((b) => (
              // min-w-0 so a long label ("September 2026") truncates instead
              // of forcing the row — and the page — wider than the phone.
              <span key={b.key} className="flex min-w-0 flex-1 justify-center">
                <span
                  className={`max-w-full truncate px-0.5 py-0.5 text-[10px] sm:px-1.5 ${
                    b.selected
                      ? "font-bold text-foreground underline decoration-2 underline-offset-4"
                      : "text-muted"
                  }`}
                >
                  {/* The year suffix is the first thing to go on a phone:
                      twelve buckets leave ~3 characters each, so "Jan '26"
                      truncated to "J…" — and Jan, Jun and Jul all read the
                      same. The period picker above already names the year. */}
                  <span className="sm:hidden">{b.label.replace(/\s'\d{2}$/, "")}</span>
                  <span className="hidden sm:inline">{b.label}</span>
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TooltipRow({
  color,
  label,
  amount,
  currency,
}: {
  color: string;
  label: string;
  amount: number;
  currency: string;
}) {
  return (
    <p className="mt-1 flex items-center justify-between gap-4 text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="tabular-nums text-foreground">{formatMoney(amount, currency)}</span>
    </p>
  );
}

// ---- Donut: outflow by kind ----
// A slim ring with a gap between slices and no track behind it.
export function Donut({
  slices,
  total,
  currency,
}: {
  slices: { kind: OutflowKind; label: string; amount: number }[];
  total: number;
  currency: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const R = 56;
  const C = 2 * Math.PI * R;

  // Each slice starts where the previous one ended. Expressed as prefix sums
  // rather than a running `let` accumulator: a mutable binding reassigned
  // during the render map outlives the render pass (react-hooks/immutability).
  const fractions = slices.map((s) => (total > 0 ? s.amount / total : 0));
  const gap = slices.length > 1 ? 2.5 : 0;
  const arcs = slices.map((s, i) => ({
    kind: s.kind,
    len: Math.max(0.5, fractions[i] * C - gap),
    dash: -fractions.slice(0, i).reduce((sum, f) => sum + f, 0) * C,
  }));

  const centerAmount = active != null ? slices[active].amount : total;
  const centerLabel =
    active != null ? KIND_LABEL[slices[active].kind] : "Total out";

  return (
    <div className="relative aspect-square w-48 shrink-0 sm:w-52">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        {arcs.map(({ kind, len, dash }, i) => (
          <circle
            key={kind}
            cx="64"
            cy="64"
            r={R}
            fill="none"
            stroke={KIND_COLOR[kind]}
            strokeWidth={active === i ? 14 : 11}
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={dash}
            className="cursor-pointer transition-[stroke-width]"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((a) => (a === i ? null : a))}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] font-semibold">{centerLabel}</span>
        <span className="mt-0.5 text-lg font-bold tabular-nums text-negative">
          {formatMoney(centerAmount, currency)}
        </span>
      </div>
    </div>
  );
}
