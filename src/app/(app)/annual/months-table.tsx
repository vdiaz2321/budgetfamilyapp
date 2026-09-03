"use client";

import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";

// Color per category kind — matches the hero cards' value color so a reader
// can scan a column and its total tint reads as one thing. Uses the --viz-*
// tokens (never --brand, which is purple) per the app-wide chart color rule.
const KIND_COLOR: Record<CategoryKind, string> = {
  income: "var(--positive)",
  savings: "var(--viz-savings)",
  bills: "var(--negative)",
  expenses: "var(--negative)",
  debt: "var(--negative)",
};

export type MonthRow = {
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
  currency: string;
  gridCols: string;
};

export function MonthsTable({
  columns,
  rows,
  totals,
  totalNet,
  currency,
  gridCols,
}: Props) {
  // Default expanded on fresh login; toggle state survives within-session nav.
  const [collapse, setCollapse] = useSessionCollapse("annual-months", () => ({ open: true }));
  const open = collapse.open;
  const setOpen = (v: boolean) => setCollapse({ open: v });
  const shareOfIncome = (value: number) =>
    totals.income === 0 ? null : (value / totals.income) * 100;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
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
            <div className="mx-auto w-full min-w-[42rem] max-w-[78rem] 2xl:max-w-[108rem]">
              {/* Header */}
              <div className={`grid ${gridCols} items-center gap-1 border-b border-line px-4 py-2.5`}>
                <span className="text-[13px] 2xl:text-[18px] font-medium uppercase tracking-wide text-muted">Month</span>
                {columns.map((c) => (
                  <span key={c.kind} className="text-center text-[13px] 2xl:text-[18px] font-medium uppercase tracking-wide text-muted">
                    {c.label}
                  </span>
                ))}
                <span className="text-center text-[13px] 2xl:text-[18px] font-medium uppercase tracking-wide text-muted">Net</span>
              </div>

              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <li
                    key={r.idx}
                    className={`grid ${gridCols} items-center gap-1 px-4 py-2 ${
                      r.status === "current" ? "bg-black/[0.04] dark:bg-white/[0.06]" : ""
                    } ${r.status === "future" ? "text-muted" : ""}`}
                  >
                    <span className="text-[15px] 2xl:text-[21px] font-medium">{r.name.slice(0, 3)}</span>
                    {columns.map((c) => (
                      <span key={c.kind} className="text-center text-[13px] 2xl:text-[18px] tabular-nums">
                        {r.values[c.kind] !== 0 ? (
                          formatMoney(r.values[c.kind], currency)
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </span>
                    ))}
                    <span
                      className={`text-center text-[13px] 2xl:text-[18px] font-semibold tabular-nums ${
                        !r.hasData ? "" : r.net >= 0 ? "text-positive" : "text-negative"
                      }`}
                    >
                      {r.hasData ? formatMoney(r.net, currency) : "—"}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Totals */}
              <div className={`grid ${gridCols} items-center gap-1 border-t border-line bg-black/[0.03] px-4 py-3 dark:bg-white/[0.05]`}>
                <span className="flex flex-col items-center text-[15px] 2xl:text-[21px] font-bold">
                  <span className="self-start">Total</span>
                  <span className="mt-1 w-full whitespace-nowrap border-t border-line pt-1 text-center text-[13px] 2xl:text-[18px] font-medium uppercase tracking-wide text-muted">
                    Total % from income
                  </span>
                </span>
                {columns.map((c) => {
                  const percent = shareOfIncome(totals[c.kind]);
                  return (
                    <span key={c.kind} className="flex flex-col items-center text-center tabular-nums">
                      <span className="text-[13px] 2xl:text-[18px] font-bold">
                        {formatMoney(totals[c.kind], currency)}
                      </span>
                      {c.kind === "income" ? null : (
                        <span
                          className="mt-1 w-full border-t border-line pt-1 text-[12px] 2xl:text-[16px] font-semibold"
                          style={{ color: KIND_COLOR[c.kind] }}
                        >
                          {percent === null ? "—" : `${percent.toFixed(1)}%`}
                        </span>
                      )}
                      {c.kind === "income" ? (
                        <span
                          aria-hidden
                          className="mt-1 w-full border-t border-line pt-1 text-[12px] 2xl:text-[16px] text-transparent"
                        >
                          &nbsp;
                        </span>
                      ) : null}
                    </span>
                  );
                })}
                <span className="flex flex-col items-center text-center tabular-nums">
                  <span
                    className={`text-[13px] 2xl:text-[18px] font-bold ${
                      totalNet >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {formatMoney(totalNet, currency)}
                  </span>
                  <span
                    className={`mt-1 w-full border-t border-line pt-1 text-[12px] 2xl:text-[16px] font-semibold ${
                      totalNet >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {shareOfIncome(totalNet) === null ? "—" : `${shareOfIncome(totalNet)!.toFixed(1)}%`}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
