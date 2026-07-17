"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";

type MonthRow = {
  idx: number;
  name: string;
  values: Record<CategoryKind, number>;
  net: number;
  status: "past" | "current" | "future";
  hasData: boolean;
};

type Props = {
  columns: { kind: CategoryKind; label: string }[];
  rows: MonthRow[];
  totals: Record<CategoryKind, number>;
  totalNet: number;
  hasFuture: boolean;
  currency: string;
  gridCols: string;
};

export function MonthsTable({ columns, rows, totals, totalNet, hasFuture, currency, gridCols }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-brand-soft/25"
      >
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="font-semibold">Months</span>
      </button>

      {open ? (
        <div className="border-t border-line">
          <div className="overflow-x-auto">
            <div className="min-w-[42rem]">
              {/* Header */}
              <div className={`grid ${gridCols} items-center gap-2 border-b border-line px-4 py-2.5`}>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Month</span>
                {columns.map((c) => (
                  <span key={c.kind} className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">
                    {c.label}
                  </span>
                ))}
                <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Net</span>
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
                    {columns.map((c) => (
                      <span key={c.kind} className="text-center text-sm tabular-nums">
                        {r.values[c.kind] !== 0 ? (
                          formatMoney(r.values[c.kind], currency)
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </span>
                    ))}
                    <span
                      className={`text-center text-sm font-semibold tabular-nums ${
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
                {columns.map((c) => (
                  <span key={c.kind} className="text-center text-sm font-bold tabular-nums">
                    {formatMoney(totals[c.kind], currency)}
                  </span>
                ))}
                <span
                  className={`text-center text-sm font-bold tabular-nums ${
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
        </div>
      ) : null}
    </section>
  );
}
