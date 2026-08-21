"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { MonthsTable } from "./months-table";

type MonthRow = {
  idx: number;
  name: string;
  values: Record<CategoryKind, number>;
  net: number;
  status: "past" | "current" | "future";
  hasData: boolean;
};

type Props = {
  year: number;
  columns: { kind: CategoryKind; label: string }[];
  outflowKinds: CategoryKind[];
  rows: MonthRow[];
  totals: Record<CategoryKind, number>;
  currency: string;
  gridCols: string;
};

export function AnnualHero({
  year,
  columns,
  outflowKinds,
  rows,
  totals,
  currency,
  gridCols,
}: Props) {
  const [selected, setSelected] = useState<Set<CategoryKind>>(new Set());

  function toggle(kind: CategoryKind) {
    if (!outflowKinds.includes(kind)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const isFiltered = selected.size > 0;
  const activeOutflow = isFiltered
    ? outflowKinds.filter((k) => selected.has(k))
    : outflowKinds;
  // Group totals (independent of the filter). Investment contributions get
  // folded into "savings" upstream, so the Savings card already reflects both.
  const spendingTotal = totals.bills + totals.expenses;
  const savingsTotal = totals.savings;
  const debtTotal = totals.debt;
  // Net honors the outflow filter — clicking column totals in the months
  // table lets you see "what would net look like if only these outflows
  // counted", which is the whole point of the filter interaction.
  const outflowTotal = activeOutflow.reduce((sum, k) => sum + totals[k], 0);
  const netTotal = totals.income - outflowTotal;
  const pct = (v: number) =>
    totals.income === 0 ? null : (v / totals.income) * 100;
  const netPct = pct(netTotal);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label={`${year} Income`}
          value={totals.income}
          currency={currency}
          tone="text-positive"
        />
        <Stat
          label={`${year} Spending`}
          value={spendingTotal}
          currency={currency}
          tone="text-negative"
          subtitleTone="text-negative"
          subtitle={
            pct(spendingTotal) === null
              ? null
              : `${pct(spendingTotal)!.toFixed(1)}% of income`
          }
        />
        <Stat
          label={`${year} Savings`}
          value={savingsTotal}
          currency={currency}
          color="var(--viz-savings)"
          subtitleColor="var(--viz-savings)"
          subtitle={
            pct(savingsTotal) === null
              ? null
              : `${pct(savingsTotal)!.toFixed(1)}% of income`
          }
        />
        <Stat
          label={`${year} Debt`}
          value={debtTotal}
          currency={currency}
          tone="text-negative"
          subtitleTone="text-negative"
          subtitle={
            pct(debtTotal) === null
              ? null
              : `${pct(debtTotal)!.toFixed(1)}% of income`
          }
        />
        <div className="rounded-2xl bg-surface px-4 py-3 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {year} Net
          </p>
          <p
            className={`mt-0.5 text-lg font-bold tabular-nums ${
              netTotal >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            {formatMoney(netTotal, currency)}
          </p>
          {isFiltered ? (
            <p className="mt-0.5 flex items-center justify-center gap-1.5 whitespace-nowrap text-xs font-semibold text-foreground">
              filtered
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="cursor-pointer rounded-md bg-positive/15 px-2 py-0.5 text-[10px] font-semibold text-positive ring-1 ring-positive/40 transition hover:bg-positive/25"
              >
                clear
              </button>
            </p>
          ) : netPct !== null ? (
            <p
              className={`mt-0.5 whitespace-nowrap text-xs font-semibold ${
                netTotal >= 0 ? "text-positive" : "text-negative"
              }`}
            >
              {netPct.toFixed(1)}% of income remaining
            </p>
          ) : null}
        </div>
      </div>

      <MonthsTable
        columns={columns}
        rows={rows}
        totals={totals}
        totalNet={netTotal}
        currency={currency}
        gridCols={gridCols}
        outflowKinds={outflowKinds}
        selectedOutflow={selected}
        onToggleOutflow={toggle}
      />
    </>
  );
}

function Stat({
  label,
  value,
  currency,
  tone,
  color,
  subtitle,
  subtitleTone,
  subtitleColor,
}: {
  label: string;
  value: number;
  currency: string;
  // Either `tone` (Tailwind semantic class like text-positive) or `color`
  // (an explicit CSS var / hex — used when the color isn't a semantic token
  // and NEVER for our indigo brand token, which reads as purple in charts).
  tone?: string;
  color?: string;
  subtitle?: string | null;
  // Same shape as tone/color, but for the subtitle line. Default is muted
  // foreground; caller passes matching color when the subtitle should track
  // the value color above it.
  subtitleTone?: string;
  subtitleColor?: string;
}) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-0.5 text-lg font-bold tabular-nums ${tone ?? ""}`}
        style={color ? { color } : undefined}
      >
        {formatMoney(value, currency)}
      </p>
      {subtitle ? (
        <p
          className={`mt-0.5 whitespace-nowrap text-xs font-semibold ${
            subtitleTone ?? (subtitleColor ? "" : "text-foreground")
          }`}
          style={subtitleColor ? { color: subtitleColor } : undefined}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
