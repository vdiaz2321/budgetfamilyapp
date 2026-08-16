"use client";

import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";

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
  currency: string;
  gridCols: string;
  outflowKinds?: CategoryKind[];
  selectedOutflow?: Set<CategoryKind>;
  onToggleOutflow?: (kind: CategoryKind) => void;
};

export function MonthsTable({
  columns,
  rows,
  totals,
  totalNet,
  currency,
  gridCols,
  outflowKinds,
  selectedOutflow,
  onToggleOutflow,
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
              <div className={`grid ${gridCols} items-center gap-2 border-t border-brand/20 bg-brand-soft/35 px-4 py-3`}>
                <span className="flex flex-col items-center text-sm font-bold">
                  <span className="self-start">Total</span>
                  <span className="mt-1 w-full whitespace-nowrap border-t border-brand/30 pt-1 text-center text-[11px] font-bold tracking-tight text-brand">
                    Total % from income
                  </span>
                </span>
                {columns.map((c) => {
                  const percent = shareOfIncome(totals[c.kind]);
                  const isOutflow = outflowKinds?.includes(c.kind) ?? false;
                  const isSelected = selectedOutflow?.has(c.kind) ?? false;
                  const clickable = isOutflow && !!onToggleOutflow;
                  const content = (
                    <>
                      <span className="text-sm font-bold">
                        {formatMoney(totals[c.kind], currency)}
                      </span>
                      {c.kind === "income" ? null : (
                        <span
                          className="mt-1 w-full border-t border-brand/30 pt-1 text-xs font-semibold text-brand"
                          title="Percent of total income"
                        >
                          {percent === null ? "—" : `${percent.toFixed(1)}%`}
                        </span>
                      )}
                      {c.kind === "income" ? (
                        <span
                          aria-hidden
                          className="mt-1 w-full border-t border-brand/30 pt-1 text-xs text-transparent"
                        >
                          &nbsp;
                        </span>
                      ) : null}
                    </>
                  );
                  return clickable ? (
                    <button
                      key={c.kind}
                      type="button"
                      onClick={() => onToggleOutflow!(c.kind)}
                      aria-pressed={isSelected}
                      className={`flex cursor-pointer flex-col items-center rounded-md px-1 py-0.5 text-center tabular-nums ring-1 transition hover:bg-brand-soft/50 ${
                        isSelected ? "ring-2 ring-brand bg-brand-soft/70" : "ring-brand-soft"
                      }`}
                    >
                      {content}
                    </button>
                  ) : (
                    <span key={c.kind} className="flex flex-col items-center text-center tabular-nums">
                      {content}
                    </span>
                  );
                })}
                <span className="flex flex-col items-center text-center tabular-nums">
                  <span
                    className={`text-sm font-bold ${
                      totalNet >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {formatMoney(totalNet, currency)}
                  </span>
                  <span
                    className="mt-1 w-full border-t border-brand/30 pt-1 text-xs font-semibold text-brand"
                    title="Net as a percent of total income"
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
