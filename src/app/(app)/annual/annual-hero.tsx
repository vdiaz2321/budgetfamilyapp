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
  const outflowTotal = activeOutflow.reduce((sum, k) => sum + totals[k], 0);
  const netTotal = totals.income - outflowTotal;
  const outflowPct =
    totals.income === 0 ? null : (outflowTotal / totals.income) * 100;
  const netPct =
    totals.income === 0 ? null : (netTotal / totals.income) * 100;

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Stat label={`${year} Income`} value={totals.income} currency={currency} tone="text-positive" />
        <div className="rounded-2xl bg-surface px-4 py-3 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {year} Outflow
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-negative">
            {formatMoney(outflowTotal, currency)}
          </p>
          {outflowPct !== null ? (
            <p className="mt-0.5 flex items-center justify-center gap-1.5 whitespace-nowrap text-xs font-semibold text-brand">
              {outflowPct.toFixed(1)}% of income
              {isFiltered ? (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="cursor-pointer rounded-md bg-positive/15 px-2 py-0.5 text-[10px] font-semibold text-positive ring-1 ring-positive/40 transition hover:bg-positive/25"
                >
                  clear
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl bg-surface px-4 py-3 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {year} Net
          </p>
          <p className={`mt-0.5 text-lg font-bold tabular-nums ${netTotal >= 0 ? "text-positive" : "text-negative"}`}>
            {formatMoney(netTotal, currency)}
          </p>
          {netPct !== null && !isFiltered ? (
            <p className="mt-0.5 whitespace-nowrap text-xs font-semibold text-brand">
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
