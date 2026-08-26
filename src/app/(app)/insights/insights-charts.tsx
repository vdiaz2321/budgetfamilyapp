"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { ChartBucket, OutflowKind } from "./types";

// Flow colors — cool, low-drama, and separated by lightness as well as hue so
// adjacent donut slices stay tellable apart. Every slice also carries a text
// label + percentage, so color is never the only cue.
export const KIND_COLOR: Record<OutflowKind, string> = {
  savings: "var(--viz-savings)",
  bills: "var(--viz-bills)",
  expenses: "var(--viz-expenses)",
  debt: "var(--viz-debt)",
  uncategorized: "var(--muted)",
};

export const KIND_LABEL: Record<OutflowKind, string> = {
  savings: "Savings",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
  uncategorized: "Uncategorized",
};

// Compact axis money: $0 / $9.8k / $19.7k — keeps the gutter narrow.
function axisMoney(cents: number, currency: string): string {
  const dollars = cents / 100;
  if (dollars >= 1000) {
    const k = dollars / 1000;
    return `${formatMoney(0, currency).replace(/[\d.,]/g, "")}${
      k >= 100 ? Math.round(k) : k.toFixed(1)
    }k`;
  }
  return formatMoney(Math.round(dollars) * 100, currency).replace(/\.00$/, "");
}

// ---- Trend: grouped income-vs-spending bars, one group per period ----
// Plain HTML/CSS bars: rounded tops, a real gap between the pair, correct
// theming, gridlines behind, and a per-group hover tooltip.
export function TrendChart({
  buckets,
  currency,
  onSelect,
}: {
  buckets: ChartBucket[];
  currency: string;
  onSelect?: (key: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.flatMap((b) => [b.income, b.spending]));
  const pct = (v: number) => (v <= 0 ? 0 : Math.max(1.5, (v / max) * 100));
  // Three reference lines, like the Rocket chart: 0, half, full.
  const gridlines = [1, 0.5, 0];

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-5 text-[11px] font-medium text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "var(--viz-income)" }}
          />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "var(--viz-spending)" }}
          />
          Spending
        </span>
      </div>

      <div className="flex">
        {/* Y axis */}
        <div className="relative mr-2 h-36 w-12 shrink-0">
          {gridlines.map((g) => (
            <span
              key={g}
              className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-muted"
              style={{ top: `${(1 - g) * 100}%` }}
            >
              {axisMoney(max * g, currency)}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div className="relative min-w-0 flex-1">
          {/* Gridlines behind the bars */}
          <div className="pointer-events-none absolute inset-0 h-36">
            {gridlines.map((g) => (
              <span
                key={g}
                className="absolute inset-x-0 border-t"
                style={{ top: `${(1 - g) * 100}%`, borderColor: "var(--viz-grid)" }}
              />
            ))}
          </div>

          <div className="relative flex h-36 items-end gap-1">
            {buckets.map((b, i) => (
              <button
                type="button"
                key={b.key}
                onClick={() => onSelect?.(b.key)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                className="group relative flex h-full flex-1 cursor-pointer flex-col justify-end rounded-t-md transition"
                style={b.selected ? { backgroundColor: "var(--viz-sel)" } : undefined}
              >
                <div className="flex h-full items-end justify-center gap-1">
                  <div
                    className="w-[38%] max-w-[14px] rounded-t-[4px] transition-[height]"
                    style={{
                      height: `${pct(b.income)}%`,
                      backgroundColor: "var(--viz-income)",
                    }}
                  />
                  <div
                    className="w-[38%] max-w-[14px] rounded-t-[4px] transition-[height]"
                    style={{
                      height: `${pct(b.spending)}%`,
                      backgroundColor: "var(--viz-spending)",
                    }}
                  />
                </div>

                {hover === i ? (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max min-w-[10rem] -translate-x-1/2 rounded-lg bg-surface px-3 py-2 text-left text-xs text-foreground shadow-xl ring-1 ring-black/10 dark:ring-white/15">
                    <p className="font-semibold">{b.label}</p>
                    <TooltipRow color="var(--viz-income)" label="Income" amount={b.income} currency={currency} />
                    <TooltipRow color="var(--viz-spending)" label="Spending" amount={b.spending} currency={currency} />
                    <TooltipRow color="var(--viz-savings)" label="Savings" amount={b.savings} currency={currency} />
                    <TooltipRow color="var(--viz-debt)" label="Debt paid" amount={b.debt} currency={currency} />
                    <div className="mt-1 flex items-center justify-between gap-4 border-t border-line pt-1 font-semibold">
                      <span>Net</span>
                      <span className="tabular-nums">
                        {formatMoney(
                          b.income - b.spending - b.savings - b.debt,
                          currency,
                        )}
                      </span>
                    </div>
                  </div>
                ) : null}
              </button>
            ))}
          </div>

          {/* X axis labels — selected period gets the dark pill */}
          <div className="mt-2 flex gap-1">
            {buckets.map((b) => (
              <span key={b.key} className="flex flex-1 justify-center">
                <span
                  className={`truncate rounded-md px-1.5 py-0.5 text-[10px] ${
                    b.selected
                      ? "bg-foreground font-semibold text-background"
                      : "text-muted"
                  }`}
                >
                  {b.label}
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
  const R = 54;
  const C = 2 * Math.PI * R;

  // Each slice starts where the previous one ended. Expressed as prefix sums
  // rather than a running `let` accumulator: a mutable binding reassigned
  // during the render map outlives the render pass (react-hooks/immutability).
  const fractions = slices.map((s) => (total > 0 ? s.amount / total : 0));
  const arcs = slices.map((s, i) => ({
    kind: s.kind,
    // Leave a hairline gap between slices so neighbours never blend.
    len: Math.max(0, fractions[i] * C - 2),
    dash: -fractions.slice(0, i).reduce((sum, f) => sum + f, 0) * C,
  }));

  const centerAmount = active != null ? slices[active].amount : total;
  const centerLabel =
    active != null ? KIND_LABEL[slices[active].kind] : "Total out";

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[220px]">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--viz-grid)" strokeWidth="15" />
        {arcs.map(({ kind, len, dash }, i) => {
          return (
            <circle
              key={kind}
              cx="64"
              cy="64"
              r={R}
              fill="none"
              stroke={KIND_COLOR[kind]}
              strokeWidth={active === i ? 19 : 15}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={dash}
              className="cursor-pointer transition-[stroke-width]"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((a) => (a === i ? null : a))}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
          {centerLabel}
        </span>
        <span className="mt-0.5 text-lg font-bold tabular-nums text-negative">
          {formatMoney(centerAmount, currency)}
        </span>
      </div>
    </div>
  );
}
