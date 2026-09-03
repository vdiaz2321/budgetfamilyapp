"use client";

import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { MoneyCell } from "./annual-cell";
import {
  KIND_COLOR,
  monthsCellKey,
  type Selection,
  type SelectedCell,
} from "./annual-selection";

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
  /** Cells currently driving the hero cards, across both tables. */
  selected: Selection;
  onToggleCell: (key: string, cell: SelectedCell) => void;
  onClearSelection: () => void;
};

export function MonthsTable({
  columns,
  rows,
  totals,
  totalNet,
  currency,
  gridCols,
  selected,
  onToggleCell,
  onClearSelection,
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
        {selected.size > 0 ? (
          <span className="ml-auto flex items-center gap-2">
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onClearSelection();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onClearSelection();
                }
              }}
              className="rounded-md bg-black/5 px-2 py-1 text-[12px] font-semibold transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
            >
              Clear
            </span>
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="border-t border-line">
          <div className="overflow-x-auto">
            <div className="mx-auto w-full min-w-[42rem] max-w-[108rem]">
              {/* Header */}
              <div className={`grid ${gridCols} items-center gap-1 border-b border-line px-4 py-2.5`}>
                <span className="text-[13px] font-medium uppercase tracking-wide text-muted">Month</span>
                {columns.map((c) => (
                  <span key={c.kind} className="text-center text-[13px] font-medium uppercase tracking-wide text-muted">
                    {c.label}
                  </span>
                ))}
                <span className="text-center text-[13px] font-medium uppercase tracking-wide text-muted">Net</span>
              </div>

              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <li
                    key={r.idx}
                    className={`grid ${gridCols} items-center gap-1 px-4 py-2 ${
                      r.status === "current" ? "bg-black/[0.04] dark:bg-white/[0.06]" : ""
                    } ${r.status === "future" ? "text-muted" : ""}`}
                  >
                    <span className="text-[15px] font-medium">{r.name.slice(0, 3)}</span>
                    {columns.map((c) => (
                      <MoneyCell
                        key={c.kind}
                        empty={r.values[c.kind] === 0}
                        color={KIND_COLOR[c.kind]}
                        active={selected.has(monthsCellKey(r.idx, c.kind))}
                        onToggle={() =>
                          onToggleCell(monthsCellKey(r.idx, c.kind), {
                            kind: c.kind,
                            amountCents: r.values[c.kind],
                            monthIdx: r.idx,
                            source: "months",
                          })
                        }
                      >
                        {formatMoney(r.values[c.kind], currency)}
                      </MoneyCell>
                    ))}
                    <MoneyCell
                      empty={!r.hasData}
                      color={r.net >= 0 ? "var(--positive)" : "var(--negative)"}
                      className={r.net >= 0 ? "text-positive" : "text-negative"}
                      active={selected.has(monthsCellKey(r.idx, "net"))}
                      onToggle={() =>
                        onToggleCell(monthsCellKey(r.idx, "net"), {
                          kind: "net",
                          amountCents: r.net,
                          monthIdx: r.idx,
                          source: "months",
                        })
                      }
                    >
                      {formatMoney(r.net, currency)}
                    </MoneyCell>
                  </li>
                ))}
              </ul>

              {/* Totals */}
              <div className={`grid ${gridCols} items-center gap-1 border-t border-line bg-black/[0.03] px-4 py-3 dark:bg-white/[0.05]`}>
                <span className="flex flex-col items-center text-[15px] font-bold">
                  <span className="self-start">Total</span>
                  <span className="mt-1 w-full whitespace-nowrap border-t border-line pt-1 text-center text-[13px] font-medium uppercase tracking-wide text-muted">
                    Total % from income
                  </span>
                </span>
                {columns.map((c) => {
                  const percent = shareOfIncome(totals[c.kind]);
                  return (
                    <span key={c.kind} className="flex flex-col items-center text-center tabular-nums">
                      <span className="text-[18px] font-bold">
                        {formatMoney(totals[c.kind], currency)}
                      </span>
                      {c.kind === "income" ? null : (
                        <span
                          className="mt-1 w-full border-t border-line pt-1 text-[11px] font-semibold"
                          style={{ color: KIND_COLOR[c.kind] }}
                        >
                          {percent === null ? "—" : `${percent.toFixed(1)}%`}
                        </span>
                      )}
                      {c.kind === "income" ? (
                        <span
                          aria-hidden
                          className="mt-1 w-full border-t border-line pt-1 text-[11px] text-transparent"
                        >
                          &nbsp;
                        </span>
                      ) : null}
                    </span>
                  );
                })}
                <span className="flex flex-col items-center text-center tabular-nums">
                  <span
                    className={`text-[18px] font-bold ${
                      totalNet >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {formatMoney(totalNet, currency)}
                  </span>
                  <span
                    className={`mt-1 w-full border-t border-line pt-1 text-[11px] font-semibold ${
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
